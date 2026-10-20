import type { Env } from '../types.ts';
import type { PushType, InboxItem, MeetingReview, Task } from '../../shared/types.ts';
import { getSettings, now } from './db.ts';
import { inQuietHours } from './schedule.ts';
import { sendPush, type PushMessage, type Sent } from './webpush.ts';
import { sendApns } from './apns.ts';
import { sendFcm } from './fcm.ts';

const MAX_FAILS = 10;
type Sub = { id: string; kind: 'web' | 'apns' | 'fcm'; endpoint: string; env: string | null; p256dh: string | null; auth: string | null };

/**
 * Sends to every device by its kind, then keeps the books: gone is deleted; a failure counts, 10 in a row delete; a success resets the count.
 * A kind whose secret is missing is 'local' (not the device's fault) and touches nothing. The message also goes to the outbox once (the Mac app
 * reads it), whether or not any device is reachable; `key` makes a retry of the same push write it once. Returns how many devices got it.
 */
export async function deliver(env: Env, message: PushMessage, key?: string): Promise<number> {
  await env.DB.prepare('INSERT OR IGNORE INTO push_outbox (id, at, title, body, url) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(key ?? crypto.randomUUID(), now(), message.title, message.body, message.url).run();
  const { results } = await env.DB.prepare('SELECT id, kind, endpoint, env, p256dh, auth FROM push_subscriptions').all<Sub>();
  if (!results.length) return 0; // D1 refuses an empty batch
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subj } = env;
  const outcomes = await Promise.all(results.map((s): Promise<Sent> =>
    s.kind === 'apns' ? sendApns(env, s, message)
      : s.kind === 'fcm' ? sendFcm(env, s, message)
        : pub && priv && subj && s.p256dh && s.auth ? sendPush({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subj }, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, message)
          : Promise.resolve('local')));
  // Subscriptions are device configuration, not user content, so a dead one is hard-deleted. 'local' touches nothing.
  const writes = results.flatMap((s, i) => outcomes[i] === 'sent'
    ? [env.DB.prepare('UPDATE push_subscriptions SET failed_count = 0, last_ok_at = ?2 WHERE id = ?1').bind(s.id, now())]
    : outcomes[i] === 'gone'
      ? [env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(s.id)]
      : outcomes[i] === 'failed'
        ? [env.DB.prepare('UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ?1').bind(s.id)]
        : []);
  if (writes.length) await env.DB.batch([...writes, env.DB.prepare('DELETE FROM push_subscriptions WHERE failed_count >= ?1').bind(MAX_FAILS)]);
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
  const sent = await deliver(env, message, key);
  if (sent > 0) await env.DB.prepare('INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?1, ?2)').bind(key, now()).run();
  return sent;
}

const APP_NAMES: Record<string, string> = { finance: 'Finance', health: 'Health', home: 'Home', nightowl: 'Night Owl', kelly: 'Kelly', sonarflow: 'Sonarflow', hollow: 'Hollow', email: 'email' };
export const appName = (app: string) => APP_NAMES[app] ?? app;

type Ingested = { item: InboxItem; task?: Task; review?: MeetingReview; created: boolean };

/** What to push for a fresh ingest, or null. Work content never goes in a push (Q8): work tasks and meetings get generic text. */
export function ingestMessage(result: Ingested, app: string): { type: PushType; key: string; message: PushMessage } | null {
  if (!result.created) return null; // updates and dedupes never push
  const { task, review } = result;
  if (task) {
    const work = task.kind === 'work' || !!result.item.work;
    return { type: 'app_task', key: 'task:' + task.id, message: { title: work ? 'New work task' : task.title, body: 'Added by ' + appName(app), url: '/' } };
  }
  if (review) return { type: 'meeting', key: 'meeting:' + review.id, message: { title: 'Meeting notes ready', body: 'Open Compass to read', url: '/meetings/' + review.id } };
  return null;
}

/** After `ingest`: a new task from a rule, or a new meeting review, pushes once. Never throws. */
export async function notifyIngest(env: Env, result: Ingested, app: string): Promise<void> {
  try {
    const m = ingestMessage(result, app);
    if (m) await pushAll(env, m.type, m.key, m.message);
  } catch (e) {
    console.error(`[push] notifyIngest failed: ${(e as Error).name}`); // a push problem never fails the ingest
  }
}
