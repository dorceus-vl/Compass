import { useEffect, useState } from 'react';
import { idb, type Store } from './db.ts';
import { enqueue, onChange, notify } from './sync.ts';
import type { Task, Project, Milestone, Status } from '../../../shared/types.ts';

export function useStore() {
  const [state, set] = useState<{ tasks: Task[]; projects: Project[]; milestones: Milestone[]; ready: boolean }>({ tasks: [], projects: [], milestones: [], ready: false });
  const refresh = async () => set({ tasks: await idb.all<Task>('tasks'), projects: await idb.all<Project>('projects'), milestones: await idb.all<Milestone>('milestones'), ready: true });
  useEffect(() => { void refresh(); return onChange(() => void refresh()); }, []);
  return { ...state, refresh };
}

const now = () => new Date().toISOString();
const tmp = () => `tmp-${crypto.randomUUID()}`;

/** A caller may still hold `tmp-…` after replay gave the row its real id; follow the saved map so the edit is not lost. */
export async function resolveId(store: Store, id: string): Promise<string> {
  if (!id.startsWith('tmp-') || await idb.get(store, id)) return id;
  return (await idb.get<{ real: string }>('meta', `idmap:${id}`))?.real ?? id;
}

/** `send` adds request-only fields the server reads (e.g. `from_message`), never stored on the local copy. */
export async function createTask(input: Partial<Task> & { title: string }, send: Record<string, unknown> = {}): Promise<Task> {
  const t = now();
  const task: Task = { id: tmp(), project_id: null, parent_id: null, notes: null, kind: 'personal', horizon: 'short', status: 'new', priority: 0, start_at: null, due_at: null, done_at: null,
    estimate_minutes: null, waiting_on: null, waiting_since: null, nudge_every_days: null, recur: null, source_app: 'manual', source_kind: null, source_ref: null, source_url: null, blocked_by: null, checklist: null,
    sort_in_column: Number.MAX_SAFE_INTEGER, tags: '[]', enc_v: 0, created_at: t, updated_at: t, deleted_at: null, ...input };
  const { id: _id, created_at: _c, updated_at: _u, deleted_at: _d, enc_v: _e, sort_in_column: _s, done_at: _dn, waiting_since: _w, ...json } = task;
  await enqueue({ method: 'POST', path: '/tasks', json: { ...json, ...send }, tempId: task.id, store: 'tasks' }, task);
  return task;
}
export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  id = await resolveId('tasks', id);
  const cur = await idb.get<Task>('tasks', id); if (!cur) return;
  await idb.put('tasks', { ...cur, ...patch, updated_at: now() }); notify();
  await enqueue({ method: 'PATCH', path: `/tasks/${id}`, json: patch });
}
export async function moveTask(id: string, status: Status, before: string | null, sort_in_column: number): Promise<void> {
  id = await resolveId('tasks', id);
  const cur = await idb.get<Task>('tasks', id); if (!cur) return;
  await idb.put('tasks', { ...cur, status, sort_in_column, done_at: status === 'done' ? (cur.done_at ?? now()) : null, updated_at: now() }); notify();
  await enqueue({ method: 'POST', path: `/tasks/${id}/move`, json: { status, before } });
}
export async function completeTask(id: string): Promise<void> {
  id = await resolveId('tasks', id);
  const cur = await idb.get<Task>('tasks', id); if (!cur) return;
  await idb.put('tasks', { ...cur, status: 'done', done_at: now(), updated_at: now() }); notify();
  await enqueue({ method: 'POST', path: `/tasks/${id}/done` }); // the recurrence's next task arrives with the next pull
}
export async function trashTask(id: string): Promise<void> {
  id = await resolveId('tasks', id);
  await idb.del('tasks', id); notify();
  await enqueue({ method: 'DELETE', path: `/tasks/${id}` });
}
export async function createProject(input: Partial<Project> & { name: string; kind: 'personal' | 'work' }): Promise<Project> {
  const t = now();
  const p: Project = { id: tmp(), status: 'active', rag: 'none', rag_reason: null, sponsor: null, objectives: null, scope_in: null, scope_out: null, success_criteria: null, phase: null,
    start_at: null, end_at: null, budget_planned: null, budget_spent: null, program_id: null, budget_forecast: null, currency: 'CAD', data_boundary: input.kind === 'work' ? 'offline' : 'cloud', colour: null, sort: 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null, ...input };
  await enqueue({ method: 'POST', path: '/projects', json: { name: p.name, kind: p.kind }, tempId: p.id, store: 'projects' }, p);
  return p;
}
export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  id = await resolveId('projects', id);
  const cur = await idb.get<Project>('projects', id); if (!cur) return;
  await idb.put('projects', { ...cur, ...patch, updated_at: now() }); notify();
  await enqueue({ method: 'PATCH', path: `/projects/${id}`, json: patch });
}
export async function trashProject(id: string): Promise<void> {
  id = await resolveId('projects', id);
  await idb.del('projects', id); notify();
  await enqueue({ method: 'DELETE', path: `/projects/${id}` });
}
export async function createMilestone(projectId: string, input: { name: string; due_at: string | null; gate?: number }): Promise<void> {
  const t = now();
  const m: Milestone = { id: tmp(), project_id: projectId, name: input.name, due_at: input.due_at, done_at: null, gate: input.gate ?? 0, sort: 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null };
  await enqueue({ method: 'POST', path: `/projects/${projectId}/milestones`, json: input, tempId: m.id, store: 'milestones' }, m);
}
export async function updateMilestone(id: string, patch: Partial<Milestone>): Promise<void> {
  id = await resolveId('milestones', id);
  const cur = await idb.get<Milestone>('milestones', id); if (!cur) return;
  await idb.put('milestones', { ...cur, ...patch, updated_at: now() }); notify();
  await enqueue({ method: 'PATCH', path: `/milestones/${id}`, json: patch });
}
