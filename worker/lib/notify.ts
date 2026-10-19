import type { Env } from '../types.ts';
import type { PushType, InboxItem, MeetingReview, Task } from '../../shared/types.ts';
import { getSettings, now } from './db.ts';
import { inQuietHours } from './schedule.ts';
import { sendPush, type PushMessage } from './webpush.ts';

const MAX_FAILS = 10;
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** Sends to every device, then keeps the books: gone (404/410) is deleted; a failure counts, 10 in a row delete; a success resets the count. Returns how many got it. */
export async function deliver(env: Env, message: PushMessage): Promise<number> {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: sub } = env;
  if (!pub || !priv || !sub) return 0; // not set up yet
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions').all<Sub>();
  if (!results.length) return 0; // D1 refuses an empty batch
  const keys = { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: sub };
  const outcomes = await Promise.all(results.map((s) => sendPush(keys, s, message)));
  // Subscriptions are device configuration, not user content, so a dead one is hard-deleted.
  await env.DB.batch(results.map((s, i) => outcomes[i] === 'sent'
    ? env.DB.prepare('UPDATE push_subscriptions SET failed_count = 0, last_ok_at = ?2 WHERE id = ?1').bind(s.id, now())
    : outcomes[i] === 'gone'
      ? env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(s.id)
      : env.DB.prepare(`UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ?1`).bind(s.id)));
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE failed_count >= ?1').bind(MAX_FAILS).run();
  return outcomes.filter((o) => o === 'sent').length;
}

const localHHMM = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/**
 * One push per `key` (the log remembers it for 30 days), unless the type is switched off or it is quiet hours.
 * A type missing from settings counts as on. The key is recorded only once at least one device received it,
 * so a failed attempt can be retried. Returns the number of devices reached.
 */
export async function pushAll(env: Env, type: PushType, key: string, message: PushMessage): Promise<number> {
  const s = await getSettings(env);
  if (s.push[type] === false || inQuietHours(localHHMM(s.tz), s.quiet_from, s.quiet_to)) return 0;
  if (await env.DB.prepare('SELECT 1 FROM push_log WHERE key = ?1').bind(key).first()) return 0;
  const sent = await deliver(env, message);
  if (sent > 0) await env.DB.prepare('INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?1, ?2)').bind(key, now()).run();
  return sent;
}

const APP_NAMES: Record<string, string> = { finance: 'Finance', health: 'Health', home: 'Home', nightowl: 'Night Owl', kelly: 'Kelly', sonarflow: 'Sonarflow', hollow: 'Hollow', email: 'email' };
export const appName = (app: string) => APP_NAMES[app] ?? app;

/** After `ingest`: a new task from a rule, or a new meeting review, pushes once. Updates and dedupes never do. Never throws. */
export async function notifyIngest(env: Env, result: { item: InboxItem; task?: Task; review?: MeetingReview; created: boolean }, app: string): Promise<void> {
  try {
    if (!result.created) return;
    if (result.task) await pushAll(env, 'app_task', 'task:' + result.task.id, { title: result.task.title, body: 'Added by ' + appName(app), url: '/' });
    else if (result.review) await pushAll(env, 'meeting', 'meeting:' + result.review.id, { title: 'Meeting notes ready', body: result.review.title, url: '/meetings/' + result.review.id });
  } catch (e) {
    console.error(`[push] notifyIngest failed: ${(e as Error).name}`); // a push problem never fails the ingest
  }
}
