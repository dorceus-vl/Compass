// Recurring tasks: the next due date after one is done. Dates are YYYY-MM-DD; weekdays 1 = Monday ... 7 = Sunday.
export interface RecurRule { freq: 'daily' | 'weekly' | 'monthly'; interval: number; weekdays?: number[]; after_completion?: boolean }

export function parseRecur(json: string | null): RecurRule | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json);
    if (!['daily', 'weekly', 'monthly'].includes(r?.freq)) return null;
    const interval = Number.isInteger(r.interval) && r.interval >= 1 ? r.interval : 1;
    const weekdays = Array.isArray(r.weekdays) ? r.weekdays.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7) : undefined;
    return { freq: r.freq, interval, ...(weekdays?.length ? { weekdays } : {}), ...(r.after_completion ? { after_completion: true } : {}) };
  } catch { return null; }
}

const day = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

function addMonthsClamped(d: Date, n: number, dayOfMonth: number): Date {
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(dayOfMonth, last)));
}

export function nextOccurrence(dueAt: string, rule: RecurRule, doneAt: string): string | null {
  const done = day(doneAt);
  const base = rule.after_completion ? done : day(dueAt);
  let next: Date;
  if (rule.freq === 'daily') next = addDays(base, rule.interval);
  else if (rule.freq === 'monthly') next = addMonthsClamped(base, rule.interval, day(dueAt).getUTCDate());
  else if (rule.weekdays?.length) {
    const days = [...rule.weekdays].sort((a, b) => a - b);
    const wd = isoWeekday(base);
    const later = days.find((d) => d > wd);
    next = later ? addDays(base, later - wd) : addDays(base, 7 * rule.interval - wd + days[0]);
  } else next = addDays(base, 7 * rule.interval);
  // Never schedule into the past: an overdue task done today recurs from today.
  while (next.getTime() <= done.getTime()) next = rule.freq === 'daily' ? addDays(next, rule.interval) : rule.freq === 'monthly' ? addMonthsClamped(next, rule.interval, day(dueAt).getUTCDate()) : addDays(next, 7 * rule.interval);
  return ymd(next);
}
