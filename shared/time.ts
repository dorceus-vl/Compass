// v2.5 time tracking: limits and the timestamp clamp shared by the Worker and the device, so both give the same answer (T3).
import type { Settings, Task, TimeEntry } from './types.ts';
import { addDaysYmd, localDay, weekStart } from './dashboard.ts';
import type { WWeek } from './workload.ts';
export const MAX_RUNNING = 5; // running timers at once, across everything
export const MAX_ENTRY_MINUTES = 1440; // one entry is at most 24 h
export const MAX_NOTE = 500;
export const FUTURE_SLACK_MS = 300_000; // a device clock may run 5 min ahead
const FLOOR_MS = Date.parse('2020-01-01T00:00:00.000Z');

/** An ISO string within [2020-01-01, now + 5 min]; anything unparseable is now. */
export function clampTs(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  return new Date(Number.isNaN(t) ? nowMs : Math.min(Math.max(t, FLOOR_MS), nowMs + FUTURE_SLACK_MS)).toISOString();
}

// Task 1: what the timer, the bar and the task sheet show.
type Span = { started_at: string; ended_at: string | null };
/** Whole minutes (floor) of an entry; a running one counts up to `nowMs`; never negative. */
export function entryMinutes(e: Span, nowMs: number): number {
  const end = e.ended_at ? Date.parse(e.ended_at) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(e.started_at)) / 60_000));
}
/** `0:07`, `1:42`, `25:00`. */
export const formatElapsed = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
type LTask = { id: string; parent_id: string | null; deleted_at: string | null };
type LEntry = Span & { task_id: string | null; deleted_at: string | null };
/** A task's live entries plus its live subtasks'; trashed entries and entries of trashed tasks are left out. */
export function taskLogged(entries: LEntry[], taskId: string, tasks: LTask[], nowMs: number): number {
  const ids = new Set(tasks.filter((t) => !t.deleted_at && (t.id === taskId || t.parent_id === taskId)).map((t) => t.id));
  return entries.reduce((n, e) => (!e.deleted_at && e.task_id && ids.has(e.task_id) ? n + entryMinutes(e, nowMs) : n), 0);
}

// `<input type="datetime-local">` values ("YYYY-MM-DDTHH:mm") read as wall time in settings.tz, not the browser's zone.
const offsetMs = (ms: number, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};
/** The ISO instant of a wall time in `tz`; null when the value is not a datetime-local string. */
export function zonedToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = wall - offsetMs(wall, tz);
  return new Date(wall - offsetMs(first, tz)).toISOString(); // second pass settles a DST edge
}
/** The datetime-local value of an instant in `tz`. */
export function isoToZoned(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  return new Date(ms + offsetMs(ms, tz)).toISOString().slice(0, 16);
}

// Task 3: reporting. Pure, over the device mirror (or the report's server load), so every screen works offline.
// Totals leave out trashed entries and entries whose task is trashed or missing; a task entry follows its task's current project.

/** The first minute after `from` whose local day is no longer `day` (binary search over 26 h; days are monotonic in time). */
function dayEnd(from: number, day: string, tz: string): number {
  let lo = from, hi = from + 26 * 3_600_000;
  while (hi - lo > 60_000) { const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000; if (localDay(new Date(mid).toISOString(), tz) === day) lo = mid; else hi = mid; }
  return hi;
}
/** Minutes per local day (YYYY-MM-DD in tz), split at local midnights; the pieces add up to entryMinutes. */
export function splitByDay(e: Span, tz: string, nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  const s = Date.parse(e.started_at), total = entryMinutes(e, nowMs);
  let cur = s, done = 0;
  for (let i = 0; done < total && i < 400; i++) { // ponytail: 400 days per entry at most; entries are capped at 24 h (running ones auto-stop at 12 h)
    const day = localDay(new Date(cur).toISOString(), tz);
    let next = Date.parse(zonedToIso(`${addDaysYmd(day, 1)}T00:00`, tz)!);
    if (next <= cur) next = dayEnd(cur, day, tz); // local midnight doesn't exist (a DST change at 00:00): find where the day really ends
    const upto = Math.min(total, Math.floor((next - s) / 60_000));
    if (upto > done) out[day] = (out[day] ?? 0) + upto - done;
    done = upto; cur = next;
  }
  return out;
}

type TTask = { id: string; project_id: string | null; deleted_at: string | null };
/** What the report's server load reads of an entry (never the note). */
export type REntry = Pick<TimeEntry, 'task_id' | 'project_id' | 'started_at' | 'ended_at' | 'deleted_at'>;
/** Ids of projects in Trash (`gone`): their entries, and their tasks' entries, count nowhere, like a trashed task's. */
export type Gone = ReadonlySet<string>;
const NONE: Gone = new Set();
export const goneProjects = (projects: { id: string; deleted_at: string | null }[]): Gone => new Set(projects.filter((p) => p.deleted_at).map((p) => p.id));
/** The one rule for where an entry counts: its own project (a project entry) or its live task's current one; undefined when it counts nowhere
 *  (the entry or its task is trashed or missing, or the project is in `gone`). */
export function entryProject(e: REntry, byId: Map<string, TTask>, gone: Gone = NONE): string | null | undefined {
  if (e.deleted_at) return undefined;
  let p: string | null;
  if (!e.task_id) p = e.project_id;
  else { const t = byId.get(e.task_id); if (!t || t.deleted_at) return undefined; p = t.project_id; }
  return p && gone.has(p) ? undefined : p;
}
const index = <T extends { id: string }>(tasks: T[]) => new Map(tasks.map((t) => [t.id, t]));
const inRange = (e: REntry, nowMs: number, range?: { from: string; to: string; tz: string }) =>
  !range ? entryMinutes(e, nowMs) : Object.entries(splitByDay(e, range.tz, nowMs)).reduce((n, [d, m]) => (d >= range.from && d <= range.to ? n + m : n), 0);

export function projectMinutes(entries: REntry[], tasks: TTask[], projectId: string, nowMs: number, range?: { from: string; to: string; tz: string }, gone: Gone = NONE): number {
  const byId = index(tasks);
  return entries.reduce((n, e) => (entryProject(e, byId, gone) === projectId ? n + inRange(e, nowMs, range) : n), 0);
}
export function programMinutes(entries: REntry[], tasks: TTask[], projectIds: string[], nowMs: number, gone: Gone = NONE): number {
  const byId = index(tasks), keep = new Set(projectIds);
  return entries.reduce((n, e) => { const p = entryProject(e, byId, gone); return p && keep.has(p) ? n + entryMinutes(e, nowMs) : n; }, 0);
}

export interface Accuracy { tasks: number; logged: number; estimated: number; ratio: number | null; label: string }
/** Done, live, top-level tasks with an estimate and some logged time (subtasks roll up), in projectIds (null: everywhere). */
export function accuracy(entries: REntry[], tasks: Task[], projectIds: string[] | null, nowMs: number): Accuracy {
  const keep = projectIds && new Set(projectIds);
  let n = 0, logged = 0, estimated = 0;
  for (const t of tasks) {
    if (t.deleted_at || t.parent_id || t.status !== 'done' || !t.estimate_minutes || (keep && !(t.project_id && keep.has(t.project_id)))) continue;
    const l = taskLogged(entries, t.id, tasks, nowMs);
    if (!l) continue;
    n++; logged += l; estimated += t.estimate_minutes;
  }
  if (n < 3) return { tasks: n, logged, estimated, ratio: null, label: 'Not enough done tasks with estimates yet' };
  const ratio = Math.round((logged / estimated) * 100) / 100, pct = Math.round(Math.abs(logged / estimated - 1) * 100);
  return { tasks: n, logged, estimated, ratio, label: ratio > 1.05 ? `You run ${pct}% over` : ratio < 0.95 ? `You run ${pct}% under` : 'Right on your estimates' };
}

/** T9: the n Monday weeks before today's week, oldest first, from logged time; whole capacity (past weeks are whole). A project entry has task_id ''. */
export function actualWeeks(entries: TimeEntry[], tasks: Task[], s: Settings['workload'], today: string, tz: string, n = 4, filter?: { project_ids: string[] }, gone: Gone = NONE): WWeek[] {
  const first = addDaysYmd(weekStart(today), -7 * n), end = weekStart(today);
  const endMs = Date.parse(zonedToIso(`${end}T00:00`, tz)!); // a running entry counts up to this week's start; later minutes are not in these weeks
  const byId = index(tasks), keep = filter && new Set(filter.project_ids);
  const weeks: WWeek[] = Array.from({ length: n }, (_, i) => {
    const start = addDaysYmd(first, 7 * i);
    const cap = s.overrides[start] ?? { work: s.work_hours, personal: s.personal_hours };
    return { start, capacity: { work: Math.round(cap.work * 60), personal: Math.round(cap.personal * 60) }, work: [], personal: [], minutes: { work: 0, personal: 0 }, over: { work: 0, personal: 0 } };
  });
  for (const e of entries) {
    const p = entryProject(e, byId, gone);
    if (p === undefined || (keep && !(p && keep.has(p))) || e.started_at >= new Date(endMs).toISOString()) continue;
    for (const [d, m] of Object.entries(splitByDay(e, tz, endMs))) {
      if (d < first || d >= end) continue;
      const w = weeks[Math.floor((Date.parse(d) - Date.parse(first)) / (7 * 86_400_000))];
      const tid = e.task_id ?? '', row = w[e.kind].find((x) => x.task_id === tid && x.project_id === p);
      if (row) row.minutes += m; else w[e.kind].push({ task_id: tid, project_id: p, minutes: m, estimated: true, overdue: false });
      w.minutes[e.kind] += m;
    }
  }
  for (const w of weeks) w.over = { work: Math.max(0, w.minutes.work - w.capacity.work), personal: Math.max(0, w.minutes.personal - w.capacity.personal) };
  return weeks;
}

export interface GridRow { project_id: string | null; days: number[]; total: number }
/** Minutes per project (null: no project) per day of the Monday week; rows by total, "No project" last. */
export function weekGrid(entries: TimeEntry[], tasks: Task[], weekStartYmd: string, tz: string, nowMs: number, gone: Gone = NONE): { rows: GridRow[]; dayTotals: number[]; total: number } {
  const byId = index(tasks), rows = new Map<string | null, GridRow>(), dayTotals = [0, 0, 0, 0, 0, 0, 0];
  const end = addDaysYmd(weekStartYmd, 7);
  let total = 0;
  for (const e of entries) {
    const p = entryProject(e, byId, gone);
    if (p === undefined) continue;
    for (const [d, m] of Object.entries(splitByDay(e, tz, nowMs))) {
      if (d < weekStartYmd || d >= end) continue;
      const i = Math.round((Date.parse(d) - Date.parse(weekStartYmd)) / 86_400_000);
      const r = rows.get(p) ?? { project_id: p, days: [0, 0, 0, 0, 0, 0, 0], total: 0 };
      r.days[i] += m; r.total += m; dayTotals[i] += m; total += m;
      rows.set(p, r);
    }
  }
  return { rows: [...rows.values()].sort((a, b) => (a.project_id === null ? 1 : b.project_id === null ? -1 : b.total - a.total)), dayTotals, total };
}

/** RFC 4180 (CRLF, quotes doubled); a cell that a spreadsheet would read as a formula gets a leading apostrophe. */
const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
/** One row per entry that counts, oldest first (spec §3): local date of the start, local HH:mm start and end in tz (a running entry has no end), minutes, kind, project, task, note, source. */
export function toCsv(entries: TimeEntry[], names: { task: (id: string) => string; project: (id: string | null) => string }, tasks: Task[], tz: string, nowMs: number, gone: Gone = NONE): string {
  const byId = index(tasks), hm = (iso: string) => isoToZoned(iso, tz).slice(11, 16);
  const rows = entries.flatMap((e) => { const p = entryProject(e, byId, gone); return p === undefined ? [] : [{ e, p }]; }).sort((a, b) => a.e.started_at.localeCompare(b.e.started_at))
    .map(({ e, p }) => [isoToZoned(e.started_at, tz).slice(0, 10), hm(e.started_at), e.ended_at ? hm(e.ended_at) : '', entryMinutes(e, nowMs), e.kind, names.project(p), e.task_id ? names.task(e.task_id) : '', e.note ?? '', e.source]);
  return [['Date', 'Start', 'End', 'Minutes', 'Kind', 'Project', 'Task', 'Note', 'Source'], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
