// Baselines (v2.2, rulings C1 and C2). A baseline freezes the dates of a project's tasks and milestones: ids and dates only, never a title,
// so the same snapshot is safe in D1 (sealed anyway for work) and titles come from the live rows when slip is shown.
// Slip is pure and runs on the device over the offline mirror. A positive delta means later than planned.
import { daysBetween, isDate } from './templates.ts';

export const MAX_BASELINE_TASKS = 1000;
export const MAX_BASELINE_MILESTONES = 200;
export const MAX_BASELINES = 20; // live baselines per project

export interface BaselineTask { id: string; start_at: string | null; due_at: string | null }
export interface BaselineMilestone { id: string; due_at: string | null }
export interface Snapshot { tasks: BaselineTask[]; milestones: BaselineMilestone[]; project: { start_at: string | null; end_at: string | null } }

/** A calendar day, or null for anything that is not one (a stray value never makes a snapshot unreadable). */
const day = (v: string | null | undefined) => (v && isDate(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** The snapshot of a project's live rows. Extra fields on the rows (titles, status) are dropped. */
export function buildSnapshot<T extends { id: string; start_at: string | null; due_at: string | null }, M extends { id: string; due_at: string | null }>(
  project: { start_at: string | null; end_at: string | null }, tasks: T[], milestones: M[],
): Snapshot {
  return {
    tasks: tasks.map((t) => ({ id: t.id, start_at: day(t.start_at), due_at: day(t.due_at) })),
    milestones: milestones.map((m) => ({ id: m.id, due_at: day(m.due_at) })),
    project: { start_at: day(project.start_at), end_at: day(project.end_at) },
  };
}

const date = (v: unknown): v is string | null => v === null || isDate(v);
/** A stored or posted snapshot (JSON text or an object), checked and rebuilt with only the known keys; null when it is not valid or over the caps. */
export function parseSnapshot(v: unknown): Snapshot | null {
  let o: unknown = v;
  if (typeof v === 'string') { try { o = JSON.parse(v); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  const { tasks, milestones, project } = o as Record<string, unknown>;
  if (!Array.isArray(tasks) || !Array.isArray(milestones) || tasks.length > MAX_BASELINE_TASKS || milestones.length > MAX_BASELINE_MILESTONES) return null;
  if (!project || typeof project !== 'object') return null;
  const p = project as Record<string, unknown>;
  if (!date(p.start_at ?? null) || !date(p.end_at ?? null)) return null;
  const seen = new Set<string>(), outT: BaselineTask[] = [], outM: BaselineMilestone[] = [];
  for (const t of tasks) {
    const x = t as Record<string, unknown> | null;
    if (!x || typeof x.id !== 'string' || !x.id || x.id.length > 64 || seen.has(x.id) || !date(x.start_at) || !date(x.due_at)) return null;
    seen.add(x.id); outT.push({ id: x.id, start_at: x.start_at, due_at: x.due_at });
  }
  for (const m of milestones) {
    const x = m as Record<string, unknown> | null;
    if (!x || typeof x.id !== 'string' || !x.id || x.id.length > 64 || seen.has(x.id) || !date(x.due_at)) return null;
    seen.add(x.id); outM.push({ id: x.id, due_at: x.due_at });
  }
  return { tasks: outT, milestones: outM, project: { start_at: (p.start_at as string | null) ?? null, end_at: (p.end_at as string | null) ?? null } };
}

export type SlipFlag = 'new' | 'dropped' | 'dated' | 'undated';
export interface SlipRow {
  kind: 'task' | 'milestone'; id: string;
  /** new: added since the baseline. dropped: removed or trashed since. dated / undated: a date was gained / lost, so there is no delta to show. */
  flag: SlipFlag | null;
  baseline_start: string | null; current_start: string | null; start_delta: number | null;
  baseline_due: string | null; current_due: string | null; due_delta: number | null;
}
export interface SlipSummary {
  /** Items that have a delta. */
  compared: number; late: number; early: number; unchanged: number; added: number; dropped: number;
  /** Mean and largest delta over the late items, in days (0 when none is late). */
  avg_late: number; max_late: number; milestones_late: number;
  project_start_delta: number | null; project_end_delta: number | null;
}
type Cur = { id: string; start_at: string | null; due_at: string | null; deleted_at?: string | null };

/** The delta that counts: the due date's, or the start date's when there is no due date on either side. */
export const slipOf = (r: Pick<SlipRow, 'due_delta' | 'start_delta'>) => r.due_delta ?? r.start_delta;

const delta = (a: string | null, b: string | null) => (a && b ? daysBetween(day(a)!, day(b)!) : null);

/**
 * What moved since the baseline. `tasks` and `milestones` are the project's current rows (subtasks included); a row with `deleted_at` counts as dropped.
 * An item with no date on either side is skipped. Rows come biggest move first (later before earlier on a tie), then flagged items, then unchanged ones.
 */
export function slip(snapshot: Snapshot, tasks: Cur[], milestones: Omit<Cur, 'start_at'>[], project?: { start_at: string | null; end_at: string | null }): { rows: SlipRow[]; summary: SlipSummary } {
  const rows: SlipRow[] = [];
  const push = (kind: SlipRow['kind'], id: string, b: { start: string | null; due: string | null } | null, c: { start: string | null; due: string | null } | null) => {
    const bs = b?.start ?? null, bd = b?.due ?? null, cs = c?.start ?? null, cd = c?.due ?? null;
    if (!bs && !bd && !cs && !cd) return; // no date on either side
    const r: SlipRow = { kind, id, flag: null, baseline_start: bs, current_start: cs, start_delta: delta(bs, cs), baseline_due: bd, current_due: cd, due_delta: delta(bd, cd) };
    if (!b) r.flag = 'new';
    else if (!c) r.flag = 'dropped';
    else if (slipOf(r) === null) r.flag = (!bd && cd) || (!bs && cs) ? 'dated' : 'undated';
    rows.push(r);
  };
  const liveT = new Map(tasks.filter((t) => !t.deleted_at).map((t) => [t.id, t]));
  const liveM = new Map(milestones.filter((m) => !m.deleted_at).map((m) => [m.id, m]));
  for (const b of snapshot.tasks) { const c = liveT.get(b.id); push('task', b.id, { start: b.start_at, due: b.due_at }, c ? { start: c.start_at, due: c.due_at } : null); }
  for (const b of snapshot.milestones) { const c = liveM.get(b.id); push('milestone', b.id, { start: null, due: b.due_at }, c ? { start: null, due: c.due_at } : null); }
  const inT = new Set(snapshot.tasks.map((t) => t.id)), inM = new Set(snapshot.milestones.map((m) => m.id));
  for (const c of liveT.values()) if (!inT.has(c.id)) push('task', c.id, null, { start: c.start_at, due: c.due_at });
  for (const c of liveM.values()) if (!inM.has(c.id)) push('milestone', c.id, null, { start: null, due: c.due_at });

  const group = (r: SlipRow) => { const d = slipOf(r); return d === null ? 1 : d === 0 ? 2 : 0; };
  rows.sort((a, b) => group(a) - group(b) || (group(a) === 0 ? Math.abs(slipOf(b)!) - Math.abs(slipOf(a)!) || slipOf(b)! - slipOf(a)! : 0));

  const ds = rows.map(slipOf);
  const lateRows = rows.filter((r) => (slipOf(r) ?? 0) > 0);
  const lateDays = lateRows.map((r) => slipOf(r)!);
  const summary: SlipSummary = {
    compared: ds.filter((d) => d !== null).length, late: lateRows.length, early: ds.filter((d) => d !== null && d < 0).length, unchanged: ds.filter((d) => d === 0).length,
    added: rows.filter((r) => r.flag === 'new').length, dropped: rows.filter((r) => r.flag === 'dropped').length,
    avg_late: lateDays.length ? Math.round((10 * lateDays.reduce((s, d) => s + d, 0)) / lateDays.length) / 10 : 0,
    max_late: lateDays.length ? Math.max(...lateDays) : 0,
    milestones_late: lateRows.filter((r) => r.kind === 'milestone').length,
    project_start_delta: project ? delta(snapshot.project.start_at, project.start_at) : null,
    project_end_delta: project ? delta(snapshot.project.end_at, project.end_at) : null,
  };
  return { rows, summary };
}
