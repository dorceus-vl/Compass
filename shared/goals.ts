// v2.6 goals and OKRs: limits shared by the Worker and the device, and every progress figure (pure, computed on the device).
import type { Goal, KeyResult, GoalLink, GoalCheckin, Confidence, Task } from './types.ts';
import { addDaysYmd, localDay } from './dashboard.ts';
export const MAX_KRS = 10; // live key results per goal
export const MAX_LINKS = 200; // live links per key result
export const MAX_NOTE = 500;
export const MAX_TITLE = 200;
const DAY_MS = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
type Ctx = { links: GoalLink[]; tasks: Task[] };

/** A calendar quarter as two dates (Q1 = Jan to Mar). */
export function quarterRange(year: number, q: 1 | 2 | 3 | 4): { starts_on: string; ends_on: string } {
  const m = (q - 1) * 3, pad = (n: number) => String(n).padStart(2, '0');
  const end = new Date(Date.UTC(year, m + 3, 0)); // day 0 of the next quarter = its last day
  return { starts_on: `${year}-${pad(m + 1)}-01`, ends_on: end.toISOString().slice(0, 10) };
}
export function currentQuarter(today: string): { year: number; q: 1 | 2 | 3 | 4 } {
  return { year: Number(today.slice(0, 4)), q: (Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** 0..1. `tasks`: done over live tasks across its live links (a project counts its live tasks; a task reached twice counts once). */
export function krProgress(kr: KeyResult, ctx: Ctx): number {
  if (kr.type === 'tasks') {
    const links = ctx.links.filter((l) => l.kr_id === kr.id && !l.deleted_at);
    const ids = new Set(links.flatMap((l) => (l.task_id ? [l.task_id] : [])));
    const projects = new Set(links.flatMap((l) => (l.project_id ? [l.project_id] : [])));
    const reached = ctx.tasks.filter((t) => !t.deleted_at && (ids.has(t.id) || (t.project_id !== null && projects.has(t.project_id))));
    return reached.length ? reached.filter((t) => t.status === 'done').length / reached.length : 0;
  }
  const { start_value: s, target_value: g, current_value: c } = kr;
  if (s === null || g === null || c === null || s === g) return 0;
  return clamp01((c - s) / (g - s)); // a decreasing target (10 → 0) works the same way
}

/** Mean of the goal's live key results; none yet = 0. `krs` may hold other goals' rows. */
export function goalProgress(goal: Goal, krs: KeyResult[], ctx: Ctx): number {
  const own = krs.filter((k) => k.goal_id === goal.id && !k.deleted_at);
  return own.length ? own.reduce((n, k) => n + krProgress(k, ctx), 0) / own.length : 0;
}

/** G10: the share of the period gone by `today` (a local date), 0..1. */
export function expected(goal: Pick<Goal, 'starts_on' | 'ends_on'>, today: string): number {
  const total = days(goal.starts_on, goal.ends_on);
  return total <= 0 ? (today >= goal.ends_on ? 1 : 0) : clamp01(days(goal.starts_on, today) / total);
}
export const isBehind = (progress: number, exp: number) => progress < exp - 0.1;

const ownCheckins = (krId: string, checkins: GoalCheckin[]) => checkins.filter((c) => c.kr_id === krId && !c.deleted_at).sort((a, b) => a.at.localeCompare(b.at));
/** The latest check-in's confidence, or null with none. */
export function confidence(krId: string, checkins: GoalCheckin[]): Confidence | null {
  return ownCheckins(krId, checkins).at(-1)?.confidence ?? null;
}
/** Check-ins with a value, oldest first: the trend line's points. */
export function trend(krId: string, checkins: GoalCheckin[]): { at: string; value: number }[] {
  return ownCheckins(krId, checkins).flatMap((c) => (c.value === null ? [] : [{ at: c.at, value: c.value }]));
}

/** Weekly Review: key results of live, active goals with no check-in in the last `n` days (local dates in `tz`). */
export function staleKrs(goals: Goal[], krs: KeyResult[], checkins: GoalCheckin[], today: string, tz: string, n = 7): KeyResult[] {
  const active = new Set(goals.filter((g) => !g.deleted_at && g.status === 'active').map((g) => g.id));
  const since = addDaysYmd(today, -n);
  return krs.filter((k) => !k.deleted_at && active.has(k.goal_id) && !ownCheckins(k.id, checkins).some((c) => localDay(c.at, tz) > since));
}
