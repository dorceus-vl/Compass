import type { Task } from '../../shared/types.ts';
// Calendar maths on YYYY-MM-DD strings, via UTC day arithmetic so DST cannot shift a day. No window, so scripts/calendar.test.ts runs it in Node.
const utc = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
export const add = (ymd: string, n: number) => new Date(utc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (ymd: string, monday: boolean) => (new Date(utc(ymd)).getUTCDay() + (monday ? 6 : 0)) % 7; // 0 = first day of the week

/** The 6 weeks that show a month (month is 1-12): 6 rows of 7 ISO dates, starting on the week's first day before the 1st. */
export function monthGrid(year: number, month: number, weekStartsMonday = true): string[][] {
  const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`, start = add(first, -dow(first, weekStartsMonday));
  return Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => add(start, r * 7 + c)));
}
/** The 7 days (Monday first) of the week that holds `anyDate`. */
export const weekDays = (anyDate: string): string[] => Array.from({ length: 7 }, (_, i) => add(anyDate, i - dow(anyDate, true)));

/** Tasks by day shown: a task sits on its due date; an open task already overdue sits on `today` (when that day is shown) instead. Trashed tasks and subtasks are left out. */
export function placeTasks<T extends Pick<Task, 'due_at' | 'status' | 'deleted_at' | 'parent_id'>>(tasks: T[], days: string[], today: string): Record<string, T[]> {
  const out: Record<string, T[]> = Object.fromEntries(days.map((d) => [d, []]));
  for (const t of tasks) {
    if (!t.due_at || t.deleted_at || t.parent_id) continue;
    const d = t.due_at < today && t.status !== 'done' ? today : t.due_at;
    out[d]?.push(t);
  }
  return out;
}

export interface CalEvent { title: string; start: string; end: string; all_day: boolean; location: string | null; source: string }
/** The date an instant falls on in `tz` (the browser's zone when omitted); a bare date stays as written. */
export function dayOf(iso: string, tz?: string): string {
  if (iso.length === 10) return iso;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
/** Events by day shown: all-day first, then by start. A multi-day event sits on each of its days (an end is exclusive, as Google writes it). */
export function placeEvents(events: CalEvent[], days: string[], tz?: string): Record<string, CalEvent[]> {
  const out: Record<string, CalEvent[]> = Object.fromEntries(days.map((d) => [d, []]));
  for (const e of events) {
    const s = dayOf(e.start, tz);
    let last = e.all_day || e.end.length === 10 ? dayOf(e.end, tz) : dayOf(new Date(Math.max(Date.parse(e.start), Date.parse(e.end) - 1)).toISOString(), tz); // ends are exclusive: a meeting to 00:00 stays on its own day
    if ((e.all_day || e.end.length === 10) && last > s) last = add(last, -1);
    if (last < s) last = s;
    for (let d = s; d <= last && d <= days[days.length - 1]; d = add(d, 1)) out[d]?.push(e);
  }
  for (const d of days) out[d].sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
  return out;
}
/** "14:30" for a timed event in `tz`; '' for all-day. */
export const eventTime = (e: CalEvent, tz?: string) => e.all_day || e.start.length === 10 ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(e.start));
/** "Kelly · Google": the label every event carries. */
export const eventLabel = (e: CalEvent) => `Kelly · ${e.source ? e.source[0].toUpperCase() + e.source.slice(1) : 'Google'}`;
