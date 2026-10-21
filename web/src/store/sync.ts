import { api, ApiError, SignedOut, online } from '../api.ts';
import { idb } from './db.ts';
import { toast } from '../ui/dialogs.tsx';
import { planPull, rewriteTmp, tmpIds } from './merge.ts';
import type { Task, Project, Milestone } from '../../../shared/types.ts';

type Entity = 'tasks' | 'projects' | 'milestones';
/** A queued write. `tempId` maps an optimistic create to the server's id when the reply comes back. */
export interface QueuedOp { seq?: number; method: 'POST' | 'PATCH' | 'DELETE'; path: string; json?: unknown; tempId?: string; store?: Entity }
const listeners = new Set<() => void>();
export const onChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const notify = () => listeners.forEach((l) => l());

/** Replay and pull never overlap: in this tab by a chain, across tabs by a Web Lock (the fallback is the chain alone where `navigator.locks` is missing). */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => (navigator.locks ? navigator.locks.request('compass-replay', fn) as Promise<T> : fn());
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function applyPlan<T extends { id: string; updated_at: string; deleted_at?: string | null }>(store: Entity, local: T[], remote: T[], claimed: Set<string>, complete: boolean) {
  const plan = planPull(local, remote, claimed, complete);
  await idb.putAll(store, plan.put);
  await Promise.all(plan.del.map((id) => idb.del(store, id)));
}

export function pull(): Promise<void> {
  return exclusive(async () => {
    const since = (await idb.get<{ id: string; at: string }>('meta', 'last_pull'))?.at;
    const [t, p] = await Promise.all([
      api<{ tasks: Task[] }>(`/tasks?status=all${since ? `&since=${encodeURIComponent(since)}` : ''}`),
      api<{ projects: Project[] }>('/projects'),
    ]);
    const ms = (await Promise.all(p.projects.map((pr) => api<{ milestones: Milestone[] }>(`/projects/${pr.id}`).then((r) => r.milestones)))).flat();
    // Local rows first, then the queue: a create queues before its row is written, so any row seen here is already claimed below.
    const [lt, lp, lm] = await Promise.all([idb.all<Task>('tasks'), idb.all<Project>('projects'), idb.all<Milestone>('milestones')]);
    const claimed = new Set((await idb.all<QueuedOp>('queue')).flatMap((o) => (o.tempId ? [o.tempId] : [])));
    await applyPlan('tasks', lt, t.tasks, claimed, false); // incremental; trashed rows come back with `deleted_at` and leave the device
    await applyPlan('projects', lp, p.projects, claimed, true);
    await applyPlan('milestones', lm, ms, claimed, true);
    // Server clock, so client skew cannot make a later pull skip rows.
    const last = t.tasks.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
    if (last) await idb.put('meta', { id: 'last_pull', at: last });
    notify();
  });
}

/** Queues a write, then (for a create) its optimistic row: the queue entry must exist before the row so a pull never mistakes the row for a phantom. */
export async function enqueue(op: QueuedOp, row?: { id: string }): Promise<void> {
  await idb.put('queue', op);
  if (row && op.store) await idb.put(op.store, row);
  notify();
  if (online()) replay().catch((e) => console.error('replay failed', e));
}

/** Stores a row the server sent back (spec §8: the winner replaces the local copy). A trashed row leaves; an update is skipped if the user trashed the row meanwhile. */
async function take(store: Entity, row: { id: string; deleted_at?: string | null }, isNew = false) {
  if (row.deleted_at) await idb.del(store, row.id);
  else if (isNew || await idb.get(store, row.id)) await idb.put(store, row);
}

/** The server gave an offline create its real id: swap the local row and repoint rows that referenced the temporary id. */
async function adopt(op: QueuedOp, real: { id: string }) {
  const tmp = op.tempId!, store = op.store!;
  if (await idb.get(store, tmp)) { await idb.del(store, tmp); await idb.put(store, real); } // trashed meanwhile: its queued DELETE follows
  if (store !== 'milestones') for (const t of await idb.all<Task>('tasks')) {
    if (t.project_id === tmp || t.parent_id === tmp) await idb.put('tasks', { ...t, project_id: t.project_id === tmp ? real.id : t.project_id, parent_id: t.parent_id === tmp ? real.id : t.parent_id });
  }
  if (store === 'projects') for (const m of await idb.all<Milestone>('milestones')) if (m.project_id === tmp) await idb.put('milestones', { ...m, project_id: real.id });
}

type Reply = { task?: Task; next?: Task; project?: Project; milestone?: Milestone };

/** The server refused a write to an existing row: fetch the winning copy and replace ours; a 404 means it is gone. */
async function refetch(path: string) {
  const m = /^\/(tasks|projects|milestones)\/([^/]+)/.exec(path);
  if (!m) return;
  const entity = m[1] as Entity, id = m[2]!;
  try {
    if (entity === 'tasks') await take('tasks', (await api<{ task: Task }>(`/tasks/${id}`)).task);
    else {
      const pid = entity === 'projects' ? id : (await idb.get<Milestone>('milestones', id))?.project_id;
      if (!pid) return;
      const r = await api<{ project: Project; milestones: Milestone[] }>(`/projects/${pid}`);
      await take('projects', r.project);
      if (entity === 'milestones') { const x = r.milestones.find((x) => x.id === id); if (x) await take('milestones', x); else await idb.del('milestones', id); }
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      await idb.del(entity, id);
      if (entity === 'projects') for (const x of await idb.all<Milestone>('milestones')) if (x.project_id === id) await idb.del('milestones', x.id);
    } else if (e instanceof SignedOut) throw e;
    // anything else (offline, 5xx): leave the row, the next pull repairs it
  }
}

/** Sends queued writes in order; stops at the first network failure and retries when back online. */
export function replay(onSignedOut?: () => void): Promise<void> {
  return exclusive(async () => {
    try {
      const ops = (await idb.all<QueuedOp>('queue')).sort((a, b) => a.seq! - b.seq!);
      for (const op of ops) {
        // Temporary ids may sit in the path and the body; the map lives in `meta` so ops queued across separate replays resolve.
        const raw = JSON.stringify({ path: op.path, json: op.json });
        const map: Record<string, string> = {};
        for (const id of new Set(tmpIds(raw))) { const m = await idb.get<{ real: string }>('meta', `idmap:${id}`); if (m) map[id] = m.real; }
        const { path, json } = JSON.parse(rewriteTmp(raw, map)) as { path: string; json?: unknown };
        let reply: Reply;
        try { reply = await api<Reply>(path, { method: op.method, json }); } // only this call decides "offline"
        catch (e) {
          if (e instanceof SignedOut) { onSignedOut?.(); return; }
          if (e instanceof TypeError || (e instanceof ApiError && e.status >= 500)) return; // offline or server down: keep the op, try later
          await idb.del('queue', op.seq!); // 4xx: the server refused it; drop it rather than block the queue
          console.error('dropped queued write', op, e);
          if (path.startsWith('/tasks/')) { // the device can't foresee every refusal (a link, a loop): say so, in plain text
            const t = await idb.get<Task>('tasks', path.split('/')[2]);
            toast(`Compass couldn't save a change to ${t?.title ?? 'a task'}: ${(e as Error).message}`);
          }
          try { if (op.tempId && op.store) await idb.del(op.store, op.tempId); else await refetch(path); }
          catch (e2) { if (e2 instanceof SignedOut) { onSignedOut?.(); return; } console.error('resync failed', e2); }
          continue;
        }
        const created = op.tempId && op.store ? (reply.task ?? reply.project ?? reply.milestone) : undefined;
        if (created) await idb.put('meta', { id: `idmap:${op.tempId}`, real: created.id }); // before dequeuing: a later op needs it
        await idb.del('queue', op.seq!);
        try { // the write is done: a local failure here must not look like "offline" or re-send it; the next pull repairs the row
          if (created) await adopt(op, created);
          else {
            if (reply.task) await take('tasks', reply.task);
            if (reply.project) await take('projects', reply.project);
            if (reply.milestone) await take('milestones', reply.milestone);
          }
          if (reply.next) await take('tasks', reply.next, true);
        } catch (e) { console.error('applying reply failed', e); }
      }
    } finally { notify(); }
  });
}

export function startSync(onSignedOut: () => void): () => void {
  const run = () => { if (!online()) return; replay(onSignedOut).then(pull).catch((e) => { if (e instanceof SignedOut) onSignedOut(); }); };
  run();
  window.addEventListener('online', run);
  const timer = setInterval(run, 60_000);
  return () => { window.removeEventListener('online', run); clearInterval(timer); };
}
