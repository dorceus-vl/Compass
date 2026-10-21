import type { Env } from '../types.ts';
import type { PushType, InboxItem, MeetingReview, Task } from '../../shared/types.ts';
import { getSettings, now } from './db.ts';
import { inQuietHours, localNow } from './schedule.ts';
import { sendPush, type PushMessage, type Sent } from './webpush.ts';
import { sendApns } from './apns.ts';
import { sendFcm } from './fcm.ts';
import { parseBlockedBy, isBlocked } from '../../shared/deps.ts';
import { isDue, stakeholderPush } from '../../shared/stakeholders.ts';

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

/** V3: "unblocked" for a task whose last live blocker was just finished. Work text carries nothing of the task (Q8); a personal one names it. */
export function unblockedMessage(task: Pick<Task, 'id' | 'title' | 'kind'>): PushMessage {
  return { title: task.kind === 'work' ? 'A task is unblocked' : `${task.title} is unblocked`, body: 'Ready to start', url: '/?task=' + task.id };
}

/**
 * After `done` was finished (by you, a rule or Kelly): one push for each open task that waited on it and now waits on nothing else.
 * Honours settings.push.unblocked and quiet hours through pushAll. The key holds the finish time, so a retry sends once and a task
 * finished again later can push again. Never throws: a push problem never fails the completion.
 */
export async function notifyUnblocked(env: Env, done: Task): Promise<void> {
  try {
    const { results } = await env.DB.prepare(`SELECT id, title, kind, status, blocked_by FROM tasks WHERE deleted_at IS NULL AND status != 'done' AND blocked_by IS NOT NULL AND instr(blocked_by, ?1) > 0`).bind(done.id).all<Task>();
    for (const t of results) {
      const ids = parseBlockedBy(t.blocked_by);
      if (!ids?.includes(done.id)) continue;
      const others = ids.filter((id) => id !== done.id);
      const rows = others.length ? (await env.DB.prepare(`SELECT id, status, deleted_at FROM tasks WHERE id IN (${others.map((_, i) => `?${i + 1}`).join(',')})`).bind(...others).all<{ id: string; status: string; deleted_at: string | null }>()).results : [];
      if (isBlocked(t, new Map(rows.map((r) => [r.id, r])))) continue; // still waiting on another
      // Personal titles are plain in D1; a work title is sealed and never used.
      await pushAll(env, 'unblocked', `unblocked:${t.id}:${done.id}:${done.done_at}`, unblockedMessage(t));
    }
  } catch (e) {
    console.error(`[push] notifyUnblocked failed: ${(e as Error).name}`);
  }
}

/**
 * C7: once a day, from digest_hour (in settings.tz) on, "N stakeholder updates due": a count, never a name (not even a personal one). Only live projects that are not closed.
 * The deep link is the Stakeholders tab of the first of them (by project order). "Once a day" is the push_outbox row `stakeholder:<local date>` (deliver writes it whether or not a device
 * is reachable; a switch-off or quiet hours write nothing, so those retry at the next tick). Never throws.
 */
export async function notifyStakeholders(env: Env, at: Date): Promise<void> {
  try {
    const s = await getSettings(env), t = localNow(s.tz, at);
    if (+t.hhmm.slice(0, 2) < s.digest_hour || s.push.stakeholder === false) return;
    // The outbox row (written by deliver, with or without a device) is the once-a-day guard, so no device has to receive it. A switch-off or quiet hours write nothing and retry at the next tick.
    const key = `stakeholder:${t.date}`;
    if (await env.DB.prepare('SELECT 1 FROM push_outbox WHERE id = ?1').bind(key).first()) return;
    // One query, no bound lists (rule 9); the LIMIT is the most cadenced stakeholders it reads.
    const { results } = await env.DB.prepare(`SELECT x.project_id, x.last_contact_at, x.cadence_days FROM stakeholders x JOIN projects p ON p.id = x.project_id
      WHERE x.deleted_at IS NULL AND x.cadence_days IS NOT NULL AND p.deleted_at IS NULL AND p.status != 'closed' ORDER BY p.sort, p.created_at, x.created_at LIMIT ?1`).bind(5000)
      .all<{ project_id: string; last_contact_at: string | null; cadence_days: number }>();
    const due = results.filter((r) => isDue(r, t.date, s.tz));
    const m = stakeholderPush(due.length, due[0] ? `/projects/${due[0].project_id}/stakeholders` : null);
    if (m) await pushAll(env, 'stakeholder', key, m);
  } catch (e) {
    console.error(`[push] notifyStakeholders failed: ${(e as Error).name}`); // never stops the rest of the cron
  }
}
