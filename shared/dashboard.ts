// Project dashboard numbers (v2.2, ruling C4). Pure: the same code draws the charts on the device and fills the status report.
// Everything works on calendar days (YYYY-MM-DD) so a daylight-saving change can't move a week edge; a stored timestamp is read in the user's zone first.
// Only live, top-level tasks count (a subtask or a trashed task never does). Weeks start on Monday.
import { slip, type Snapshot } from './baseline.ts';

export const MAX_DAYS = 400; // the burndown never draws more than this many points
const DAY_MS = 86_400_000;
const ms = (ymd: string) => Date.parse(ymd + 'T00:00:00Z');
export const addDaysYmd = (ymd: string, n: number) => new Date(ms(ymd) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetweenYmd = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY_MS);
/** The Monday on or before a day. */
export const weekStart = (ymd: string) => addDaysYmd(ymd, -((new Date(ms(ymd)).getUTCDay() + 6) % 7));
/** A stored timestamp as a day in the user's zone; a plain date passes through. */
export const localDay = (s: string, tz: string) =>
  s.length <= 10 ? s : new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s));
const round1 = (n: number) => Math.round(n * 10) / 10;
const VALID = /^\d{4}-\d{2}-\d{2}$/;

export interface DTask { id: string; parent_id: string | null; status: string; due_at: string | null; created_at: string; done_at: string | null; deleted_at: string | null }
export interface DRaid { type: string; status: string; probability: number | null; impact: number | null; deleted_at: string | null }

/** Per live top-level task: the day it came to exist, the day it was done (null while open), and its due day. A done task with no time recorded counts as closed from the start. */
function prep(tasks: DTask[], tz: string) {
  return tasks.filter((t) => !t.parent_id && !t.deleted_at).map((t) => {
    const created = localDay(t.created_at, tz);
    const done = t.status === 'done' ? (t.done_at ? localDay(t.done_at, tz) : created) : null;
    return { created, done, doneAt: t.status === 'done' ? t.done_at : null, due: t.due_at ? t.due_at.slice(0, 10) : null };
  });
}
type P = ReturnType<typeof prep>[number];
const openOn = (ps: P[], day: string) => ps.filter((t) => t.created <= day && !(t.done !== null && t.done <= day)).length;

export interface BurnDay { date: string; open: number | null; ideal: number | null }
export interface Burndown { days: BurnDay[]; ideal: boolean; remaining: number; ideal_now: number | null }

/**
 * Open tasks per day from `from` (the project start, else the first task's creation day) to today.
 * The ideal line (ruling C11) starts at the latest baseline: the open count on `baselineDay` falling in a straight line to 0 on `to` (end_at).
 * No baseline, no usable `to` (none, or not after the baseline day) means no ideal line at all; the line is empty before the baseline day.
 * The series runs on to `to` when that is later than today; days after today have no actual value.
 */
export function burndown(tasks: DTask[], from: string | null, to: string | null, today: string, tz: string, baselineDay: string | null = null): Burndown {
  const ps = prep(tasks, tz);
  const f0 = from?.slice(0, 10) ?? null, t0 = to?.slice(0, 10) ?? null, b0 = baselineDay?.slice(0, 10) ?? null;
  const f = f0 && VALID.test(f0) ? f0 : ps.length ? ps.map((t) => t.created).sort()[0] : today;
  const base = b0 && VALID.test(b0) ? b0 : null;
  const end = base && t0 && VALID.test(t0) && t0 > base ? t0 : null;
  const startCount = base ? openOn(ps, base) : 0;
  const idealAt = (d: string) => (end && base && d >= base ? Math.round(startCount * (1 - Math.min(1, daysBetweenYmd(base, d) / daysBetweenYmd(base, end))) * 100) / 100 : null);
  let a = f; if (daysBetweenYmd(a, today) > MAX_DAYS - 1) a = addDaysYmd(today, -(MAX_DAYS - 1)); // ponytail: very old projects show their last 400 days; add zoom if that matters
  let z = end && end > today ? end : today; if (z < a) z = a; if (daysBetweenYmd(a, z) > MAX_DAYS - 1) z = addDaysYmd(a, MAX_DAYS - 1);
  const days: BurnDay[] = [];
  for (let d = a; d <= z; d = addDaysYmd(d, 1)) days.push({ date: d, open: d <= today ? openOn(ps, d) : null, ideal: idealAt(d) });
  return { days, ideal: !!end, remaining: openOn(ps, today), ideal_now: idealAt(today) };
}

export interface Week { start: string; end: string }
const weeks = (today: string, n: number): Week[] => Array.from({ length: n }, (_, i) => { const s = addDaysYmd(weekStart(today), -7 * (n - 1 - i)); return { start: s, end: addDaysYmd(s, 6) }; });

/** Tasks finished in each of the last `n` weeks (oldest first, the last holds today). */
export function donePerWeek(tasks: DTask[], today: string, n = 8, tz = 'America/Toronto'): (Week & { done: number })[] {
  const ds = prep(tasks, tz).filter((t) => t.doneAt).map((t) => t.done!);
  return weeks(today, n).map((w) => ({ ...w, done: ds.filter((d) => d >= w.start && d <= w.end).length }));
}

/** At each week's end (today, for the current week): tasks due before that day, created by then and not done by then. */
export function overdueTrend(tasks: DTask[], today: string, n = 8, tz = 'America/Toronto'): (Week & { as_of: string; overdue: number })[] {
  const ps = prep(tasks, tz);
  return weeks(today, n).map((w) => {
    const as_of = w.end < today ? w.end : today;
    return { ...w, as_of, overdue: ps.filter((t) => t.due !== null && t.due < as_of && t.created <= as_of && !(t.done !== null && t.done <= as_of)).length };
  });
}

export type Severity = 'high' | 'medium' | 'low';
/** Score = probability × impact: high from 15, medium 8 to 14, low up to 7. */
export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const severity = (score: number): Severity => (score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low');
export interface RiskCell { p: number; i: number; count: number; score: number; severity: Severity }
export interface RiskMatrix { cells: RiskCell[]; high: number; medium: number; low: number; unrated: number; total: number }

/** Open risks on the 5×5 grid. A risk missing its probability or its impact is counted apart as unrated. */
export function riskMatrix(raid: DRaid[]): RiskMatrix {
  const risks = raid.filter((r) => r.type === 'risk' && r.status === 'open' && !r.deleted_at);
  const cells: RiskCell[] = [];
  for (let p = 5; p >= 1; p--) for (let i = 1; i <= 5; i++) cells.push({ p, i, count: risks.filter((r) => r.probability === p && r.impact === i).length, score: p * i, severity: severity(p * i) });
  const sum = (s: Severity) => cells.filter((c) => c.severity === s).reduce((n, c) => n + c.count, 0);
  const unrated = risks.filter((r) => !r.probability || !r.impact).length;
  return { cells, high: sum('high'), medium: sum('medium'), low: sum('low'), unrated, total: risks.length };
}

export interface MilestoneSlipRow { id: string; name: string; baseline_due: string; due_at: string; delta: number }
/** Milestones that have a date now and had one in the baseline, biggest move first (later before earlier); the change is in days, positive means later. */
export function milestoneSlip(snapshot: Snapshot, milestones: { id: string; name: string; due_at: string | null; deleted_at?: string | null }[]): MilestoneSlipRow[] {
  const byId = new Map(milestones.map((m) => [m.id, m.name]));
  return slip({ ...snapshot, tasks: [] }, [], milestones.map((m) => ({ id: m.id, due_at: m.due_at, deleted_at: m.deleted_at })))
    .rows.filter((r) => r.kind === 'milestone' && r.due_delta !== null)
    .map((r) => ({ id: r.id, name: byId.get(r.id) ?? '', baseline_due: r.baseline_due!, due_at: r.current_due!, delta: r.due_delta! }));
}

export interface DashboardMetrics {
  done_this_week: number; open: number; overdue_now: number;
  /** Open tasks now, the ideal count for today (null without a baseline and an end date: C11), and how far above it we are (negative: ahead). */
  remaining: number; ideal_remaining: number | null; behind_ideal: number | null;
  high_risks: number; unrated_risks: number;
}
/** The key numbers of the status report: this week is the Monday-to-Sunday week that holds today. */
export function dashboardMetrics(i: { tasks: DTask[]; raid: DRaid[]; project: { start_at: string | null; end_at: string | null }; today: string; tz: string; baselineDay?: string | null }): DashboardMetrics {
  const { tasks, today, tz } = i;
  const ps = prep(tasks, tz);
  const b = burndown(tasks, i.project.start_at, i.project.end_at, today, tz, i.baselineDay ?? null);
  const ideal = b.ideal_now === null ? null : round1(b.ideal_now);
  const mx = riskMatrix(i.raid), mon = weekStart(today);
  return {
    done_this_week: ps.filter((t) => t.doneAt && t.done! >= mon && t.done! <= addDaysYmd(mon, 6)).length,
    open: ps.filter((t) => t.done === null).length, overdue_now: ps.filter((t) => t.done === null && t.due !== null && t.due < today).length,
    remaining: b.remaining, ideal_remaining: ideal, behind_ideal: ideal === null ? null : round1(b.remaining - ideal), high_risks: mx.high, unrated_risks: mx.unrated,
  };
}
