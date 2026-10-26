import { useEffect, useState } from 'react';
import { idb, type Store } from './db.ts';
import { enqueue, onChange, notify } from './sync.ts';
import type { Task, Project, Milestone, Status, TimeEntry, Kind, Goal, KeyResult, GoalLink, GoalCheckin, KrType, Confidence } from '../../../shared/types.ts';
import { clampTs, stopAt } from '../../../shared/time.ts';

export function useStore() {
  const [state, set] = useState<{ tasks: Task[]; projects: Project[]; milestones: Milestone[]; time: TimeEntry[]; goals: Goal[]; krs: KeyResult[]; goalLinks: GoalLink[]; checkins: GoalCheckin[]; ready: boolean }>(
    { tasks: [], projects: [], milestones: [], time: [], goals: [], krs: [], goalLinks: [], checkins: [], ready: false });
  const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at); // v2.6: children of a trashed goal stay; shared/goals.ts hides them (G2)
  const refresh = async () => set({ tasks: await idb.all<Task>('tasks'), projects: await idb.all<Project>('projects'), milestones: await idb.all<Milestone>('milestones'),
    time: live(await idb.all<TimeEntry>('time')), goals: live(await idb.all<Goal>('goals')), krs: live(await idb.all<KeyResult>('krs')),
    goalLinks: live(await idb.all<GoalLink>('goal_links')), checkins: live(await idb.all<GoalCheckin>('checkins')), ready: true });
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

// v2.5 time entries (T5): optimistic rows with temp ids through the queue; the reply's `entry` gives the real id.
type TimeTarget = { task_id: string } | { project_id: string; note: string };
async function newEntry(target: TimeTarget, started_at: string, ended_at: string | null, note: string | null, source: TimeEntry['source']): Promise<void> {
  const t = now();
  const owner = 'task_id' in target
    ? { task_id: await resolveId('tasks', target.task_id), project_id: null }
    : { task_id: null, project_id: await resolveId('projects', target.project_id) };
  const from = owner.task_id ? await idb.get<{ kind: Kind }>('tasks', owner.task_id) : await idb.get<{ kind: Kind }>('projects', owner.project_id!);
  const e: TimeEntry = { id: tmp(), ...owner, kind: from?.kind ?? 'personal', started_at, ended_at, note, source, auto_stopped: 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null };
  const json = { ...(owner.task_id ? { task_id: owner.task_id } : { project_id: owner.project_id }), started_at, note, ...(ended_at ? { ended_at } : { source }) };
  await enqueue({ method: 'POST', path: '/time', json, tempId: e.id, store: 'time' }, e);
}
/** `source` is 'widget' when the app drains a widget's offline start (Task 4); `startedAt` is then the tap time (clamped as the server clamps it). */
export async function startTimer(target: TimeTarget, source: 'timer' | 'widget' = 'timer', startedAt?: string): Promise<void> {
  await newEntry(target, startedAt ? clampTs(startedAt, Date.now()) : now(), null, 'note' in target ? target.note : null, source);
}
/** `endedAt`: a widget stop drained later keeps its tap time (stopAt: clamped, never before the start, at most 24 h; the server gives the same answer). */
export async function stopTimer(id: string, endedAt?: string): Promise<void> {
  id = await resolveId('time', id);
  const cur = await idb.get<TimeEntry>('time', id); if (!cur || cur.ended_at) return;
  const ended_at = endedAt ? stopAt(cur.started_at, endedAt, Date.now()) : now();
  await idb.put('time', { ...cur, ended_at, updated_at: ended_at }); notify();
  await enqueue({ method: 'POST', path: `/time/${id}/stop`, json: { ended_at } });
}
export async function addTime(target: TimeTarget, started_at: string, ended_at: string, note: string | null): Promise<void> {
  await newEntry(target, started_at, ended_at, note ?? ('note' in target ? target.note : null), 'manual');
}
export async function editTime(id: string, patch: Partial<Pick<TimeEntry, 'started_at' | 'ended_at' | 'note'>>): Promise<void> {
  id = await resolveId('time', id);
  const cur = await idb.get<TimeEntry>('time', id); if (!cur) return;
  await idb.put('time', { ...cur, ...patch, auto_stopped: 0, updated_at: now() }); notify();
  await enqueue({ method: 'PATCH', path: `/time/${id}`, json: patch });
}
export async function deleteTime(id: string): Promise<void> {
  id = await resolveId('time', id);
  await idb.del('time', id); notify();
  await enqueue({ method: 'DELETE', path: `/time/${id}` });
}

// v2.6 goals: optimistic rows with temp ids through the queue, as time entries; replies are `goal`, `kr`, `link`, `checkin` (G7).
export async function addGoal(input: Pick<Goal, 'kind' | 'title' | 'starts_on' | 'ends_on'> & { description?: string | null }): Promise<string> {
  const t = now();
  const g: Goal = { id: tmp(), description: null, status: 'active', sort: 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null, ...input };
  await enqueue({ method: 'POST', path: '/goals', json: input, tempId: g.id, store: 'goals' }, g);
  return g.id;
}
export async function editGoal(id: string, patch: Partial<Pick<Goal, 'title' | 'description' | 'starts_on' | 'ends_on' | 'status' | 'sort'>>): Promise<void> {
  id = await resolveId('goals', id);
  const cur = await idb.get<Goal>('goals', id); if (!cur) return;
  await idb.put('goals', { ...cur, ...patch, updated_at: now() }); notify();
  await enqueue({ method: 'PATCH', path: `/goals/${id}`, json: patch });
}
export async function deleteGoal(id: string): Promise<void> {
  id = await resolveId('goals', id);
  await idb.del('goals', id); notify();
  await enqueue({ method: 'DELETE', path: `/goals/${id}` });
}
/** G3: the values follow the type; a number key result passes start, target and unit. */
export async function addKr(goalId: string, input: { title: string; type: KrType; start_value?: number; target_value?: number; unit?: string | null }): Promise<void> {
  goalId = await resolveId('goals', goalId);
  const t = now(), n = input.type === 'number';
  const values = input.type === 'tasks' ? { start_value: null, target_value: null, current_value: null }
    : input.type === 'percent' ? { start_value: 0, target_value: 100, current_value: 0 }
    : input.type === 'done' ? { start_value: 0, target_value: 1, current_value: 0 }
    : { start_value: input.start_value ?? 0, target_value: input.target_value ?? 1, current_value: input.start_value ?? 0 };
  const k: KeyResult = { id: tmp(), goal_id: goalId, title: input.title, type: input.type, ...values, unit: n ? input.unit ?? null : null, sort: 0, enc_v: 0, created_at: t, updated_at: t, deleted_at: null };
  await enqueue({ method: 'POST', path: `/goals/${goalId}/krs`, json: input, tempId: k.id, store: 'krs' }, k);
}
export async function editKr(id: string, patch: Partial<Pick<KeyResult, 'title' | 'start_value' | 'target_value' | 'unit' | 'sort'>>): Promise<void> {
  id = await resolveId('krs', id);
  const cur = await idb.get<KeyResult>('krs', id); if (!cur) return;
  await idb.put('krs', { ...cur, ...patch, updated_at: now() }); notify();
  await enqueue({ method: 'PATCH', path: `/goals/krs/${id}`, json: patch });
}
export async function deleteKr(id: string): Promise<void> {
  id = await resolveId('krs', id);
  await idb.del('krs', id); notify();
  await enqueue({ method: 'DELETE', path: `/goals/krs/${id}` });
}
export async function linkKr(krId: string, target: { task_id: string } | { project_id: string }): Promise<void> {
  krId = await resolveId('krs', krId);
  const owner = 'task_id' in target ? { task_id: await resolveId('tasks', target.task_id), project_id: null } : { task_id: null, project_id: await resolveId('projects', target.project_id) };
  const t = now();
  const l: GoalLink = { id: tmp(), kr_id: krId, ...owner, created_at: t, updated_at: t, deleted_at: null };
  await enqueue({ method: 'POST', path: `/goals/krs/${krId}/links`, json: owner.task_id ? { task_id: owner.task_id } : { project_id: owner.project_id }, tempId: l.id, store: 'goal_links' }, l);
}
export async function unlink(id: string): Promise<void> {
  id = await resolveId('goal_links', id);
  await idb.del('goal_links', id); notify();
  await enqueue({ method: 'DELETE', path: `/goals/links/${id}` });
}
/** G4: a check-in on a number, percent or done key result also moves its value here at once. */
export async function checkIn(krId: string, input: { value: number | null; confidence: Confidence; note: string | null }): Promise<void> {
  krId = await resolveId('krs', krId);
  const t = now();
  const c: GoalCheckin = { id: tmp(), kr_id: krId, ...input, at: t, enc_v: 0, created_at: t, updated_at: t, deleted_at: null };
  const kr = await idb.get<KeyResult>('krs', krId);
  if (kr && input.value !== null && kr.type !== 'tasks') await idb.put('krs', { ...kr, current_value: input.value, updated_at: t });
  await enqueue({ method: 'POST', path: `/goals/krs/${krId}/checkins`, json: { ...input, at: t }, tempId: c.id, store: 'checkins' }, c);
}
export async function deleteCheckin(id: string): Promise<void> {
  id = await resolveId('checkins', id);
  await idb.del('checkins', id); notify();
  await enqueue({ method: 'DELETE', path: `/goals/checkins/${id}` });
}
