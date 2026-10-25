// v2.5 time tracking: limits and the timestamp clamp shared by the Worker and the device, so both give the same answer (T3).
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
