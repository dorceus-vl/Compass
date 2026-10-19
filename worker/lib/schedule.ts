import type { PushType, Settings, Task } from '../../shared/types.ts';
import type { PushMessage } from './webpush.ts';
import { addDays, localDate } from './dates.ts';

/** True when `hhmm` ("HH:MM", 24 h) falls in [from, to). The window may wrap midnight (22:00 to 07:00); from === to means never quiet. */
export function inQuietHours(hhmm: string, from: string, to: string): boolean {
  if (from === to) return false;
  return from < to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}

/** The user's wall clock: date, "HH:MM" (never 24:xx) and weekday (0 = Sunday, like weekly_review_day). */
export function localNow(tz: string, at = new Date()): { date: string; hhmm: string; weekday: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: localDate(tz, at), hhmm: `${p.hour}:${p.minute}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

type DueTask = Pick<Task, 'id' | 'title' | 'status' | 'due_at' | 'waiting_on' | 'waiting_since' | 'nudge_every_days' | 'deleted_at' | 'parent_id' | 'kind'>;
type DueMilestone = { id: string; name: string; due_at: string | null; done_at: string | null; work?: boolean };
export type DuePush = { type: PushType; key: string; message: PushMessage };

const minutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const inSlot = (hhmm: string, slot: string) => minutes(hhmm) - minutes(slot) >= 0 && minutes(hhmm) - minutes(slot) < 15;
/** Whole local days from timestamp `ts` (ISO, any zone) to local date `date`, both read in `tz`. */
const dayDiff = (date: string, ts: string, tz: string) => Math.round((Date.parse(date) - Date.parse(localDate(tz, new Date(ts)))) / 86_400_000);
/** Up to three personal titles, then a count of work tasks (never their titles: pushes carry no work content). */
const titles = (ts: DueTask[]) => {
  const work = ts.filter((t) => t.kind === 'work').length;
  return [...ts.filter((t) => t.kind !== 'work').slice(0, 3).map((t) => t.title), ...(work ? [`+${work} work task${work > 1 ? 's' : ''}`] : [])].join(' · ');
};

/** What is due to push right now. Pure: quiet hours, switches and the push_log are pushAll's business. */
export function duePushes({ now, settings, tasks, milestones }: { now: { date: string; hhmm: string; weekday: number }; settings: Settings; tasks: DueTask[]; milestones: DueMilestone[] }): DuePush[] {
  const { date, hhmm } = now;
  const open = tasks.filter((t) => t.status !== 'done' && !t.deleted_at && !t.parent_id);
  const byDue = (a: DueTask, b: DueTask) => (a.due_at! < b.due_at! ? -1 : a.due_at! > b.due_at! ? 1 : 0);
  const overdue = open.filter((t) => t.due_at && t.due_at < date).sort(byDue);
  const today = open.filter((t) => t.due_at === date);
  const out: DuePush[] = [];
  const digestSlot = String(settings.digest_hour).padStart(2, '0') + ':00';
  if (inSlot(hhmm, digestSlot)) {
    if (overdue.length + today.length) out.push({ type: 'digest', key: 'digest:' + date, message: { title: `Today: ${today.length} due · ${overdue.length} overdue`, body: titles([...overdue, ...today]), url: '/' } });
    for (const t of open) {
      const n = t.nudge_every_days, since = t.waiting_since ? dayDiff(date, t.waiting_since, settings.tz) : 0;
      if (t.status !== 'waiting' || !n || since <= 0 || since % n) continue;
      out.push({ type: 'nudge', key: `nudge:${t.id}:${date}`, message: t.kind === 'work' ? { title: 'Nudge for a work task', body: 'Waiting on someone', url: '/' } : { title: 'Nudge ' + (t.waiting_on ?? ''), body: t.title, url: '/' } });
    }
    for (const m of milestones) {
      if (m.done_at || m.due_at !== addDays(date, 7)) continue;
      out.push({ type: 'milestone', key: `milestone:${m.id}:${m.due_at}`, message: m.work ? { title: 'A work milestone is a week away', body: 'Open Compass to see it', url: '/projects' } : { title: 'Milestone in a week', body: m.name, url: '/projects' } });
    }
  }
  if (inSlot(hhmm, '13:00') && overdue.length) out.push({ type: 'overdue', key: 'overdue:' + date, message: { title: `${overdue.length} overdue`, body: titles(overdue), url: '/list?q=due:overdue' } });
  if (inSlot(hhmm, '17:00') && now.weekday === settings.weekly_review_day && (!settings.last_review_at || dayDiff(date, settings.last_review_at, settings.tz) >= 6))
    out.push({ type: 'weekly_review', key: 'review:' + date, message: { title: 'Time for your weekly review', body: 'Open Compass to start', url: '/review' } });
  return out;
}
