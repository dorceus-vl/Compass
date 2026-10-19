import { api, ApiError, SignedOut, online } from '../api.ts';
import { idb } from './db.ts';
import { mergeComplete, mergeRows, rewriteTmp, tmpIds } from './merge.ts';
import type { Task, Project, Milestone } from '../../../shared/types.ts';

/** A queued write. `tempId` maps an optimistic create to the server's id when the reply comes back. */
export interface QueuedOp { seq?: number; method: 'POST' | 'PATCH' | 'DELETE'; path: string; json?: unknown; tempId?: string; store?: 'tasks' | 'projects' | 'milestones' }
const listeners = new Set<() => void>();
export const onChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const notify = () => listeners.forEach((l) => l());
let replaying = false, again = false;

/** Drops local rows the merged list no longer holds, then writes the rest. Deleting (not clearing) keeps readers from seeing an empty store. */
async function replaceAll<T extends { id: string }>(store: 'projects' | 'milestones', local: T[], next: T[]) {
  const keep = new Set(next.map((r) => r.id));
  await Promise.all(local.filter((r) => !keep.has(r.id)).map((r) => idb.del(store, r.id)));
  await idb.putAll(store, next);
}

export async function pull(): Promise<void> {
  const since = (await idb.get<{ id: string; at: string }>('meta', 'last_pull'))?.at;
  const [t, p] = await Promise.all([
    api<{ tasks: Task[] }>(`/tasks?status=all${since ? `&since=${encodeURIComponent(since)}` : ''}`),
    api<{ projects: Project[] }>('/projects'),
  ]);
  // Tasks: incremental. A pull with `since` also returns trashed rows, which must leave the device.
  const merged = mergeRows(await idb.all<Task>('tasks'), t.tasks);
  await idb.putAll('tasks', merged.filter((r) => !r.deleted_at));
  await Promise.all(merged.filter((r) => r.deleted_at).map((r) => idb.del('tasks', r.id)));
  // Projects and milestones: the remote list is complete.
  const lp = await idb.all<Project>('projects');
  await replaceAll('projects', lp, mergeComplete(lp, p.projects));
  const ms = (await Promise.all(p.projects.map((pr) => api<{ milestones: Milestone[] }>(`/projects/${pr.id}`).then((r) => r.milestones)))).flat();
  const lm = await idb.all<Milestone>('milestones');
  await replaceAll('milestones', lm, mergeComplete(lm, ms));
  // Server clock, so client skew cannot make a later pull skip rows.
  const last = t.tasks.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
  if (last) await idb.put('meta', { id: 'last_pull', at: last });
  notify();
}

export async function enqueue(op: QueuedOp): Promise<void> { await idb.put('queue', op); if (online()) void replay(); }

/** The server gave an offline create its real id: swap the local row and repoint rows that referenced the temporary id. */
async function adopt(op: QueuedOp, real: { id: string }) {
  const tmp = op.tempId!, store = op.store!;
  await idb.put('meta', { id: `idmap:${tmp}`, real: real.id });
  if (await idb.get(store, tmp)) { await idb.del(store, tmp); await idb.put(store, real); } // trashed meanwhile: its queued DELETE follows
  if (store !== 'milestones') for (const t of await idb.all<Task>('tasks')) {
    if (t.project_id === tmp || t.parent_id === tmp) await idb.put('tasks', { ...t, project_id: t.project_id === tmp ? real.id : t.project_id, parent_id: t.parent_id === tmp ? real.id : t.parent_id });
  }
  if (store === 'projects') for (const m of await idb.all<Milestone>('milestones')) if (m.project_id === tmp) await idb.put('milestones', { ...m, project_id: real.id });
}

/** Sends queued writes in order; stops at the first network failure and retries when back online. */
export async function replay(onSignedOut?: () => void): Promise<void> {
  if (replaying) { again = true; return; }
  replaying = true;
  try {
    const ops = (await idb.all<QueuedOp>('queue')).sort((a, b) => a.seq! - b.seq!);
    for (const op of ops) {
      // Temporary ids may sit in the path and the body; the map lives in `meta` so ops queued across separate replays resolve.
      const raw = JSON.stringify({ path: op.path, json: op.json });
      const map: Record<string, string> = {};
      for (const id of new Set(tmpIds(raw))) { const m = await idb.get<{ real: string }>('meta', `idmap:${id}`); if (m) map[id] = m.real; }
      const { path, json } = JSON.parse(rewriteTmp(raw, map)) as { path: string; json?: unknown };
      try {
        const r = await api<Record<string, { id: string } | undefined>>(path, { method: op.method, json });
        if (op.tempId && op.store) await adopt(op, (r.task ?? r.project ?? r.milestone)!);
        await idb.del('queue', op.seq!);
      } catch (e) {
        if (e instanceof SignedOut) { onSignedOut?.(); return; }
        if (e instanceof TypeError || (e instanceof ApiError && e.status >= 500)) return; // offline or server down: keep the op, try later
        await idb.del('queue', op.seq!); // 4xx: the server refused it; drop it rather than block the queue
        console.error('dropped queued write', op, e);
      }
    }
  } finally {
    replaying = false; notify();
    if (again) { again = false; void replay(onSignedOut); }
  }
}

export function startSync(onSignedOut: () => void): () => void {
  const run = () => { if (!online()) return; replay(onSignedOut).then(pull).catch((e) => { if (e instanceof SignedOut) onSignedOut(); }); };
  run();
  window.addEventListener('online', run);
  const timer = setInterval(run, 60_000);
  return () => { window.removeEventListener('online', run); clearInterval(timer); };
}
