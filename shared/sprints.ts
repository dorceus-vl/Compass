// Sprints per project (v2.9). `projects.sprints` is a JSON array of Sprint (newest last); `tasks.sprint_id` points a task at one.
// Effort is counted in tasks, not points: velocity = tasks done per closed sprint. At most one sprint is active at a time.
export type Sprint = {
  id: string; name: string; goal: string; start: string; end: string; // start, end: YYYY-MM-DD
  state: 'planned' | 'active' | 'closed';
  /** Set when the sprint closes: tasks it held and tasks done, so velocity survives tasks moving or being deleted. */
  total?: number; done?: number;
};
export const MAX_SPRINTS = 100;
export const MAX_SPRINT_NAME = 80;
export const MAX_SPRINT_GOAL = 300;
export const MAX_SPRINT_DAYS = 366;
/** Days from start to end. */
export const span = (start: string, end: string) => Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);

const json = (v: unknown): unknown => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } };
const day = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const count = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100000);

/** The sprints in a `sprints` value (JSON text, an array or empty): [] when none, null when not valid (over 100, a repeated id, a name empty or over 80,
 *  a goal over 300, a date not YYYY-MM-DD, an end before its start or over 366 days after it, an unknown state, or more than one active). */
export function parseSprints(v: unknown): Sprint[] | null {
  if (v === null || v === undefined || v === '') return [];
  const a = json(v);
  if (!Array.isArray(a) || a.length > MAX_SPRINTS) return null;
  const ids = new Set<string>();
  const out: Sprint[] = [];
  let active = 0;
  for (const x of a) {
    if (!x || typeof x !== 'object') return null;
    const { id, name, goal, start, end, state, total, done } = x as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id.length > 64 || ids.has(id)) return null;
    if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_SPRINT_NAME) return null;
    if (typeof goal !== 'string' || goal.length > MAX_SPRINT_GOAL) return null;
    if (!day(start) || !day(end) || end < start || span(start, end) > MAX_SPRINT_DAYS) return null;
    if (state !== 'planned' && state !== 'active' && state !== 'closed') return null;
    if (!count(total) || !count(done)) return null;
    if (state === 'active') active++;
    ids.add(id);
    out.push({ id, name, goal, start, end, state, ...(total !== undefined ? { total: total as number } : {}), ...(done !== undefined ? { done: done as number } : {}) });
  }
  return active > 1 ? null : out;
}

export const storedSprints = (s: Sprint[]) => (s.length ? JSON.stringify(s) : null);

/** Start a planned sprint; null when another is active or it is not planned. */
export function startSprint(list: Sprint[], id: string): Sprint[] | null {
  const s = list.find((x) => x.id === id);
  if (!s || s.state !== 'planned' || list.some((x) => x.state === 'active')) return null;
  return list.map((x) => (x.id === id ? { ...x, state: 'active' as const } : x));
}

/** Close the active sprint with its final counts. */
export function closeSprint(list: Sprint[], id: string, total: number, done: number): Sprint[] | null {
  const s = list.find((x) => x.id === id);
  if (!s || s.state !== 'active') return null;
  return list.map((x) => (x.id === id ? { ...x, state: 'closed' as const, total, done } : x));
}

/** Tasks done per closed sprint, oldest first, and their mean (rounded to one decimal; 0 when none). */
export function velocity(list: Sprint[]): { points: { id: string; name: string; done: number }[]; mean: number } {
  const points = list.filter((s) => s.state === 'closed').map((s) => ({ id: s.id, name: s.name, done: s.done ?? 0 }));
  const mean = points.length ? Math.round((points.reduce((a, p) => a + p.done, 0) / points.length) * 10) / 10 : 0;
  return { points, mean };
}

const DAY = 86400000;
const t = (s: string) => Date.parse(s + 'T00:00:00Z');

/** Burndown for a sprint: one row per day from start to end. `remaining` is tasks not done by the end of that day
 *  (null for days after `today`); `ideal` falls in a straight line from `total` to 0 across the sprint. */
export function burndown(s: Pick<Sprint, 'start' | 'end'>, doneAt: (string | null)[], today: string): { day: string; remaining: number | null; ideal: number }[] {
  const total = doneAt.length, days = Math.round((t(s.end) - t(s.start)) / DAY);
  const rows: { day: string; remaining: number | null; ideal: number }[] = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(t(s.start) + i * DAY).toISOString().slice(0, 10);
    const gone = doneAt.filter((x) => x !== null && x.slice(0, 10) <= d).length;
    rows.push({ day: d, remaining: d > today ? null : total - gone, ideal: days ? Math.round((total * (days - i) / days) * 10) / 10 : 0 });
  }
  return rows;
}
