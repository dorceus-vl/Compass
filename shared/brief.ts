import type { TodayAnswer } from './types.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** Today's brief as one paragraph, no AI. `today` is the local date (YYYY-MM-DD). */
export function briefText(t: TodayAnswer, today: string): string {
  const at = new Date(utc(today));
  const out = [`${WEEKDAYS[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}.`];
  const dueToday = t.open_today - t.overdue.length;
  if (dueToday > 0) out.push(`${n(dueToday, 'task is', 'tasks are')} due today.`);
  if (t.overdue.length > 0) {
    const oldest = t.overdue.reduce((a, b) => ((b.due_at ?? '9') < (a.due_at ?? '9') ? b : a));
    const late = Math.round((utc(today) - utc(oldest.due_at!)) / 86400000);
    out.push(`${n(t.overdue.length, 'task is', 'tasks are')} overdue, the oldest "${oldest.title}" ${n(late, 'day', 'days')} late.`);
  }
  const waiting = [...t.short, ...t.medium, ...t.long].filter((x) => x.status === 'waiting').length;
  if (waiting > 0) out.push(`${n(waiting, 'task is', 'tasks are')} waiting on others.`);
  if (dueToday <= 0 && t.overdue.length === 0 && waiting === 0) out.push('Nothing urgent today.');
  const next = t.milestones.find((m) => m.due_at && m.due_at >= today) ?? t.milestones[0];
  if (next?.due_at) {
    const d = new Date(utc(next.due_at));
    out.push(`Next milestone: ${next.name} (${next.project_name}), ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}.`);
  }
  return out.join(' ');
}
