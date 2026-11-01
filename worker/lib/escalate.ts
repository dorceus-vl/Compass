import type { Env } from '../types.ts';
import type { Task } from '../../shared/types.ts';
import { getSettings, now } from './db.ts';
import { pushAll } from './notify.ts';
import { localDate } from './dates.ts';

/** v2.12: overdue 3 days → priority 3 (once per due date, so lowering it again sticks); overdue 7 days → one push. Thresholds are settings-free on purpose: they are the spec's. */
export const ESCALATE_DAYS = 3, PUSH_DAYS = 7;

type T = Pick<Task, 'id' | 'status' | 'priority' | 'due_at' | 'deleted_at' | 'parent_id' | 'kind'>;

/** Whole days `due` (YYYY-MM-DD) is behind `date` (YYYY-MM-DD); 0 or negative when not overdue. */
export const daysOverdue = (date: string, due: string) => Math.round((Date.parse(date) - Date.parse(due)) / 86_400_000);

/** Pure: which open top-level tasks cross each line today. */
export function escalations(tasks: T[], date: string): { raise: T[]; push: T[] } {
  const live = tasks.filter((t) => t.due_at && t.status !== 'done' && !t.deleted_at && !t.parent_id);
  return {
    raise: live.filter((t) => t.priority < 3 && daysOverdue(date, t.due_at!) >= ESCALATE_DAYS),
    push: live.filter((t) => daysOverdue(date, t.due_at!) >= PUSH_DAYS),
  };
}

/** Claims `key` in push_log; true only for the first caller (INSERT OR IGNORE changes 0 rows after that). */
const claim = async (env: Env, key: string) => ((await env.DB.prepare('INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?1, ?2)').bind(key, now()).run()).meta.changes ?? 0) > 0;

/** From the cron's `pushes`. Never puts a work title in a push. Never throws. */
export async function escalateOverdue(env: Env, at: Date): Promise<void> {
  try {
    const s = await getSettings(env);
    const date = localDate(s.tz, at);
    const { results } = await env.DB.prepare(`SELECT id, status, priority, due_at, deleted_at, parent_id, kind, title FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status != 'done' AND due_at IS NOT NULL AND substr(due_at, 1, 10) <= ?1 LIMIT 500`)
      .bind(date).all<T & { title: string }>();
    const { raise, push } = escalations(results, date);
    for (const t of raise) // ponytail: push_log keys expire after 30 days, so a task overdue that long can be raised again once
      if (!(await env.DB.prepare('SELECT 1 FROM push_log WHERE key = ?1').bind(`raise:${t.id}:${t.due_at}`).first())) {
        await env.DB.prepare('UPDATE tasks SET priority = 3, updated_at = ?2 WHERE id = ?1 AND priority < 3').bind(t.id, now()).run();
        await claim(env, `raise:${t.id}:${t.due_at}`); // after the update, so a failed update retries next tick
      }
    for (const t of push.slice(0, 5)) // at most 5 a tick; the rest follow in later ticks (pushAll logs each once)
      await pushAll(env, 'escalate', `escalate:${t.id}:${t.due_at}`, t.kind !== 'personal'
        ? { title: 'A work task is a week overdue', body: 'Open Compass to see it', url: '/list?q=due:overdue' }
        : { title: 'A week overdue', body: (t as T & { title: string }).title, url: '/list?q=due:overdue' }).catch(() => {});
  } catch (e) {
    console.error(`[cron] escalateOverdue failed: ${(e as Error).name}`);
  }
}
