// Task and project templates (v2.1, ruling V5). A template body is JSON: dates are stored as calendar-day offsets from the
// earliest date in the source, never as dates. No ids, no `blocked_by` (V10: ids are per instance), nothing done: an applied
// task is always 'new'. Built-ins are code (never stored) and are in Compass's own words.
// ponytail: calendar days only, no weekday rules; add business-day offsets if a template ever needs them.
import { parseChecklist, type ChecklistItem } from './deps.ts';
import type { Horizon } from './types.ts';

export const MAX_TEMPLATE_TASKS = 200;
export const MAX_TEMPLATE_MILESTONES = 50;
const MAX_OFFSET = 3650;
const HORIZONS: Horizon[] = ['short', 'medium', 'long'];

export interface TTask {
  title: string; notes: string | null; horizon: Horizon; priority: number; estimate_minutes: number | null;
  checklist: ChecklistItem[]; start_offset: number | null; due_offset: number | null;
  /** Project templates only: the index (in `tasks`) of the top-level task this one is a subtask of. */
  parent_index?: number | null;
}
export interface TMilestone { name: string; gate: 0 | 1; offset_days: number | null }
export interface TProject { name: string | null; sponsor: string | null; phase: string | null; objectives: string | null; scope_in: string | null; scope_out: string | null; success_criteria: string | null }
export interface TaskBody { task: TTask; subtasks: TTask[] }
export interface ProjectBody { project: TProject; milestones: TMilestone[]; tasks: TTask[] }
export type TemplateScope = 'task' | 'project';

// ---- calendar-day maths (UTC, so a time zone never shifts a date) ----
const utcDay = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
export const daysBetween = (from: string, to: string) => utcDay(to) - utcDay(from);
export const addDays = (ymd: string, n: number) => new Date((utcDay(ymd) + n) * 86_400_000).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; // 2026-02-30 is not a date

/** A template flattened for applying: one task list (a task template's subtasks point at index 0) with real dates. */
export interface Dated {
  project: TProject | null;
  milestones: (TMilestone & { due_at: string | null })[];
  tasks: (TTask & { start_at: string | null; due_at: string | null; parent_index: number | null })[];
}
/** The body with every offset turned into a date counted from `start` (YYYY-MM-DD). An item with no offset keeps null. */
export function applyOffsets(body: TaskBody | ProjectBody, start: string): Dated {
  const at = (n: number | null) => (n === null ? null : addDays(start, n));
  const isProject = 'project' in body;
  const flat: TTask[] = isProject ? body.tasks : [body.task, ...body.subtasks.map((s) => ({ ...s, parent_index: 0 }))];
  return {
    project: isProject ? body.project : null,
    milestones: isProject ? body.milestones.map((m) => ({ ...m, due_at: at(m.offset_days) })) : [],
    tasks: flat.map((t) => ({ ...t, parent_index: t.parent_index ?? null, start_at: at(t.start_offset), due_at: at(t.due_offset) })),
  };
}

// ---- snapshots (what "Save as template" stores) ----
type SrcTask = { title: string; notes: string | null; horizon: Horizon; priority: number; estimate_minutes: number | null; checklist: string | null; start_at: string | null; due_at: string | null };
type SrcMilestone = { name: string; gate: number; due_at: string | null };
/** Offsets are days from the earliest date among `dates`; with no date at all every offset is null. */
function offsetter(dates: (string | null)[]): (d: string | null) => number | null {
  const ds = dates.filter((d): d is string => !!d).sort();
  return (d) => (d && ds.length ? daysBetween(ds[0], d) : null);
}
const snapTask = (t: SrcTask, off: (d: string | null) => number | null): TTask => ({
  title: t.title, notes: t.notes ?? null, horizon: t.horizon, priority: t.priority, estimate_minutes: t.estimate_minutes ?? null,
  checklist: (parseChecklist(t.checklist) ?? []).map((i) => ({ ...i, done: false })), start_offset: off(t.start_at), due_offset: off(t.due_at),
});
export function snapshotTask(task: SrcTask, subtasks: SrcTask[]): TaskBody {
  const off = offsetter([task, ...subtasks].flatMap((t) => [t.start_at, t.due_at]));
  return { task: snapTask(task, off), subtasks: subtasks.map((s) => snapTask(s, off)) };
}
type SrcProject = { name: string; sponsor: string | null; phase: string | null; objectives: string | null; scope_in: string | null; scope_out: string | null; success_criteria: string | null };
/** `tasks` are the project's live tasks; a subtask names its parent through `id`/`parent_id`, and one whose parent is missing (or is itself a subtask) becomes top-level. */
export function snapshotProject(p: SrcProject, milestones: SrcMilestone[], tasks: (SrcTask & { id: string; parent_id: string | null })[]): ProjectBody {
  const off = offsetter([...milestones.map((m) => m.due_at), ...tasks.flatMap((t) => [t.start_at, t.due_at])]);
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const top = new Set(tasks.filter((t) => !t.parent_id || !index.has(t.parent_id)).map((t) => t.id));
  return {
    project: { name: p.name, sponsor: p.sponsor, phase: p.phase, objectives: p.objectives, scope_in: p.scope_in, scope_out: p.scope_out, success_criteria: p.success_criteria },
    milestones: milestones.map((m) => ({ name: m.name, gate: m.gate ? 1 : 0, offset_days: off(m.due_at) })),
    tasks: tasks.map((t) => {
      const s = snapTask(t, off);
      if (t.parent_id && top.has(t.parent_id)) s.parent_index = index.get(t.parent_id)!;
      return s;
    }),
  };
}

// ---- validation ----
const str = (v: unknown, max: number): string | null | undefined => (v === null || v === undefined ? null : typeof v === 'string' && v.length <= max ? v : undefined); // undefined = invalid
const off = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : Number.isInteger(v) && Math.abs(v as number) <= MAX_OFFSET ? (v as number) : undefined);
function tTask(v: unknown): TTask | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const notes = str(o.notes, 20000), start = off(o.start_offset), due = off(o.due_offset);
  const checklist = parseChecklist(o.checklist ?? null);
  const est = o.estimate_minutes === null || o.estimate_minutes === undefined ? null : o.estimate_minutes;
  if (!title || title.length > 300 || notes === undefined || start === undefined || due === undefined || !checklist) return null;
  if (!HORIZONS.includes(o.horizon as Horizon) || !Number.isInteger(o.priority) || (o.priority as number) < 0 || (o.priority as number) > 3) return null;
  if (est !== null && !(Number.isInteger(est) && (est as number) >= 0 && (est as number) <= 100000)) return null;
  const parent = o.parent_index === null || o.parent_index === undefined ? null : o.parent_index;
  if (parent !== null && !Number.isInteger(parent)) return null;
  const t: TTask = { title, notes, horizon: o.horizon as Horizon, priority: o.priority as number, estimate_minutes: est as number | null,
    checklist: checklist.map((i) => ({ ...i, done: false })), start_offset: start, due_offset: due };
  if (parent !== null) t.parent_index = parent as number;
  return t;
}
function tProject(v: unknown): TProject | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const f = { name: str(o.name, 200), sponsor: str(o.sponsor, 200), phase: str(o.phase, 100), objectives: str(o.objectives, 20000), scope_in: str(o.scope_in, 20000), scope_out: str(o.scope_out, 20000), success_criteria: str(o.success_criteria, 20000) };
  return Object.values(f).includes(undefined) ? null : (f as TProject);
}
/** A stored or posted body (JSON text or object) checked and cleaned (unknown keys dropped, checklists unticked), or null when it is not a valid task/project template. At most 200 tasks and 50 milestones. */
export function parseBody(scope: TemplateScope, v: unknown): TaskBody | ProjectBody | null {
  let o: unknown = v;
  if (typeof v === 'string') { try { o = JSON.parse(v); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  const b = o as Record<string, unknown>;
  if (scope === 'task') {
    const task = tTask(b.task);
    if (!task || !Array.isArray(b.subtasks) || b.subtasks.length > MAX_TEMPLATE_TASKS - 1) return null;
    const subtasks = b.subtasks.map(tTask);
    if (subtasks.some((s) => !s)) return null;
    const clean = (t: TTask) => { const { parent_index: _p, ...rest } = t; return rest; };
    return { task: clean(task), subtasks: (subtasks as TTask[]).map(clean) };
  }
  const project = tProject(b.project);
  if (!project || !Array.isArray(b.milestones) || !Array.isArray(b.tasks) || b.milestones.length > MAX_TEMPLATE_MILESTONES || b.tasks.length > MAX_TEMPLATE_TASKS) return null;
  const milestones: TMilestone[] = [];
  for (const m of b.milestones as Record<string, unknown>[]) {
    const name = m && typeof m.name === 'string' ? m.name.trim() : '', o2 = m ? off(m.offset_days) : undefined;
    if (!name || name.length > 200 || o2 === undefined || (m.gate !== 0 && m.gate !== 1 && m.gate !== undefined)) return null;
    milestones.push({ name, gate: m.gate === 1 ? 1 : 0, offset_days: o2 });
  }
  const tasks = b.tasks.map(tTask);
  if (tasks.some((t) => !t)) return null;
  const ts = tasks as TTask[];
  // A parent is an earlier-or-later top-level task of the same list; never itself, never a subtask (one level, like the board).
  for (const [i, t] of ts.entries()) {
    const p = t.parent_index;
    if (p === undefined || p === null) continue;
    if (p < 0 || p >= ts.length || p === i || (ts[p].parent_index ?? null) !== null) return null;
  }
  return { project, milestones, tasks: ts };
}

// ---- built-ins ----
export interface Builtin { id: string; name: string; description: string; scope: 'project'; body: ProjectBody }
const task = (title: string, due: number | null, o: Partial<TTask> & { checks?: string[] } = {}): TTask => {
  const { checks, ...rest } = o;
  return { title, notes: null, horizon: 'short', priority: 0, estimate_minutes: null, start_offset: null, due_offset: due,
    checklist: (checks ?? []).map((text, i) => ({ id: `c${i + 1}`, text, done: false })), ...rest };
};
const empty: TProject = { name: null, sponsor: null, phase: null, objectives: null, scope_in: null, scope_out: null, success_criteria: null };
export const BUILTINS: Builtin[] = [
  {
    id: 'builtin:kickoff', name: 'Project kickoff', description: 'Charter, stakeholders, kickoff meeting, RAID set-up and the first status report.',
    scope: 'project', body: {
      project: empty,
      milestones: [{ name: 'Kickoff', gate: 1, offset_days: 7 }, { name: 'Plan baselined', gate: 1, offset_days: 14 }, { name: 'First status', gate: 0, offset_days: 21 }],
      tasks: [
        task('Write the project charter', 3, { priority: 3, checks: ['Why the project exists', 'What is in and out of scope', 'How success will be measured', 'Rough budget and timeline'] }),
        task('List the stakeholders', 4, { checks: ['Who decides', 'Who is affected', 'How each one wants to hear from us'] }),
        task('Hold the kickoff meeting', 7, { priority: 2 }),
        task('Send the agenda and invitations', 5, { parent_index: 2 }),
        task('Share decisions and actions afterwards', 8, { parent_index: 2 }),
        task('Set up the RAID log', 10, { checks: ['First risks', 'Known assumptions', 'Open issues', 'Dependencies on other teams'] }),
        task('Agree and baseline the plan', 14, { priority: 2 }),
        task('Send the first status report', 21),
      ],
    },
  },
  {
    id: 'builtin:vendor', name: 'Vendor onboarding', description: 'Contract paperwork, security review, access, the vendor kickoff and the first invoice check.',
    scope: 'project', body: {
      project: empty,
      milestones: [{ name: 'Contract signed', gate: 1, offset_days: 14 }, { name: 'Access ready', gate: 0, offset_days: 21 }, { name: 'Vendor live', gate: 1, offset_days: 30 }],
      tasks: [
        task('Agree the NDA and master agreement', 10, { priority: 3 }),
        task('Review the statement of work', 12, { checks: ['Deliverables match what was asked', 'Dates and milestones', 'Price and payment terms', 'What counts as accepted'] }),
        task('Send the security questionnaire and review the answers', 14, { priority: 2 }),
        task('Request access for the vendor team', 18, { checks: ['Accounts and licences', 'Building or network access', 'Shared folders'] }),
        task('Hold the kickoff with the vendor', 25, { priority: 2 }),
        task('Check the first invoice against the agreement', 45),
      ],
    },
  },
  {
    id: 'builtin:change', name: 'Change / release', description: 'From change request to go-live and the review afterwards.',
    scope: 'project', body: {
      project: empty,
      milestones: [{ name: 'Change approved', gate: 1, offset_days: 7 }, { name: 'Go-live', gate: 1, offset_days: 14 }, { name: 'Review done', gate: 0, offset_days: 28 }],
      tasks: [
        task('Write the change request', 1, { priority: 3 }),
        task('Assess the impact on scope, time, cost and risk', 4, { priority: 2 }),
        task('Take it to the change board for approval', 7, { priority: 3 }),
        task('Get test sign-off', 11, { checks: ['Test results recorded', 'Open defects accepted or fixed', 'Tester has signed off'] }),
        task('Tell everyone affected', 12),
        task('Go live', 14, { priority: 3, checks: ['Backup taken', 'Steps run in order', 'Smoke check passed', 'Roll-back plan ready'] }),
        task('Run the post-implementation review', 28, { notes: 'What went to plan, what did not, and what to do differently next time.' }),
      ],
    },
  },
];
