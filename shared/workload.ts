// Task estimates (v2.4, P4): "90", "30m", "2h", "1.5h", "1d", "1h 30m" <-> whole minutes.
import type { Kind, Settings, Status } from './types.ts';
import { addDaysYmd, localDay, weekStart } from './dashboard.ts';
export const MAX_ESTIMATE_MINUTES = 57_600;

/** Whole minutes, or null for an empty, bad or over-cap (40 days of dayHours) string. */
export function parseEstimate(s: string, dayHours: number): number | null {
  const str = s.trim().toLowerCase();
  if (!str) return null;
  const unit = { d: dayHours * 60, h: 60, m: 1 } as const;
  let min: number;
  if (/^\d+(\.\d+)?$/.test(str)) min = Number(str);
  else {
    if (!/^(\d+(\.\d+)?\s*[dhm]\s*)+$/.test(str)) return null;
    min = 0;
    for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) min += Number(m[1]) * unit[m[2] as 'd' | 'h' | 'm'];
  }
  min = Math.round(min);
  return min <= 40 * dayHours * 60 ? min : null;
}

export function formatEstimate(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

// Workload (v2.4, P5): estimated hours placed on calendar days in the user's zone, summed per Monday week against capacity.

export interface WTask { id: string; parent_id: string | null; project_id: string | null; kind: Kind; status: Status; title: string; start_at: string | null; due_at: string | null; estimate_minutes: number | null; deleted_at: string | null }
export interface WEntry { task_id: string; project_id: string | null; minutes: number; estimated: boolean; overdue: boolean }
export interface WWeek { start: string; capacity: { work: number; personal: number }; work: WEntry[]; personal: WEntry[]; minutes: { work: number; personal: number }; over: { work: number; personal: number } }
export interface Workload { weeks: WWeek[]; unscheduled: (WEntry & { kind: Kind })[]; not_estimated: string[] }

const dow = (ymd: string) => (new Date(ymd + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday 0 … Sunday 6

/** Minutes per day for one task, or null when it has no due day (unscheduled). */
function place(t: WTask, minutes: number, today: string, tz: string): { days: [string, number][]; overdue: boolean } | null {
  if (!t.due_at) return null;
  const due = localDay(t.due_at, tz);
  if (due < today) return { days: [[today, minutes]], overdue: true };
  if (!t.start_at) return { days: [[due, minutes]], overdue: false };
  const start = localDay(t.start_at, tz);
  const wd: string[] = [];
  for (let d = start > today ? start : today; d <= due; d = addDaysYmd(d, 1)) if (dow(d) < 5) wd.push(d); // ponytail: walks every day of the range; ranges are task-sized
  if (!wd.length) return { days: [[due, minutes]], overdue: false };
  const base = Math.floor(minutes / wd.length), extra = minutes - base * wd.length;
  return { days: wd.map((d, i) => [d, base + (i < extra ? 1 : 0)]), overdue: false };
}

export function workload(tasks: WTask[], s: Settings['workload'], today: string, tz: string, weeks = 12, filter?: { project_ids: string[] }): Workload {
  const live = tasks.filter((t) => !t.deleted_at);
  const hasOpenChild = new Set(live.filter((t) => t.parent_id && t.status !== 'done').map((t) => t.parent_id));
  const keep = filter ? new Set(filter.project_ids) : null;
  const first = weekStart(today);
  const left = Math.max(0, 5 - dow(today)) / 5;
  const out: Workload = {
    weeks: Array.from({ length: weeks }, (_, i) => {
      const start = addDaysYmd(first, 7 * i);
      const cap = s.overrides[start] ?? { work: s.work_hours, personal: s.personal_hours };
      const f = i === 0 ? left : 1;
      return { start, capacity: { work: Math.round(cap.work * 60 * f), personal: Math.round(cap.personal * 60 * f) }, work: [], personal: [], minutes: { work: 0, personal: 0 }, over: { work: 0, personal: 0 } };
    }),
    unscheduled: [], not_estimated: [],
  };
  for (const t of live) {
    if (t.status === 'done' || t.status === 'hold' || hasOpenChild.has(t.id)) continue;
    if (keep && !(t.project_id && keep.has(t.project_id))) continue;
    const estimated = t.estimate_minutes != null;
    const minutes = t.estimate_minutes ?? s.default_estimate_minutes;
    const p = place(t, minutes, today, tz);
    let counted = false;
    if (!p) { out.unscheduled.push({ task_id: t.id, project_id: t.project_id, minutes, estimated, overdue: false, kind: t.kind }); counted = true; }
    else {
      const perWeek = new Map<number, number>();
      for (const [d, m] of p.days) {
        const i = Math.floor((Date.parse(d) - Date.parse(first)) / (7 * 86_400_000));
        if (i >= 0 && i < weeks) perWeek.set(i, (perWeek.get(i) ?? 0) + m); // beyond the range: left out
      }
      for (const [i, m] of perWeek) {
        const w = out.weeks[i];
        w[t.kind].push({ task_id: t.id, project_id: t.project_id, minutes: m, estimated, overdue: p.overdue });
        w.minutes[t.kind] += m;
        counted = true;
      }
    }
    if (counted && !estimated) out.not_estimated.push(t.id);
  }
  for (const w of out.weeks) w.over = { work: Math.max(0, w.minutes.work - w.capacity.work), personal: Math.max(0, w.minutes.personal - w.capacity.personal) };
  return out;
}
