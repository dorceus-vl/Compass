import type { Env } from './types.ts';
import type { Milestone, Task } from '../shared/types.ts';
import { getSettings } from './lib/db.ts';
import { pushAll, notifyStakeholders } from './lib/notify.ts';
import { duePushes, localNow } from './lib/schedule.ts';
import { purgeTrash, purgeAudit, purgeSessions, purgeInbox } from './routes/trash.ts';
import { embedPending, unembedStale } from './lib/vectors.ts';
import { appsDue, claimRefresh, lastRun, refreshApps, retryOnly } from './lib/digest.ts';

/** Every 15 minutes: the purges, the knowledge embedder, then whatever pushes are due. Each part is on its own, so one failing never stops the rest. */
async function pushes(env: Env, at: Date): Promise<void> {
  const settings = await getSettings(env);
  // Titles stay encrypted on purpose: duePushes never puts a work title (or any decrypted work text) in a push.
  const tasks = (await env.DB.prepare(`SELECT id, title, status, due_at, waiting_on, waiting_since, nudge_every_days, deleted_at, parent_id, kind FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status != 'done'`).all<Task>()).results;
  const milestones = (await env.DB.prepare(`SELECT id, name, due_at, done_at, enc_v FROM milestones WHERE deleted_at IS NULL AND done_at IS NULL AND due_at IS NOT NULL`).all<Milestone>()).results
    .map((m) => ({ id: m.id, name: m.name, due_at: m.due_at, done_at: m.done_at, work: m.enc_v === 2 }));
  for (const p of duePushes({ now: localNow(settings.tz, at), settings, tasks, milestones }))
    await pushAll(env, p.type, p.key, p.message).catch((e) => console.error(`[cron] push ${p.type} failed: ${(e as Error).name}`)); // one failed push never skips the rest
  await notifyStakeholders(env, at); // v2.2 C7: once a day from digest_hour
}

/** `at` is the scheduled time, not the moment the Worker happened to run, so a late start still lands in its own 15-minute slot. */
export async function runCron(env: Env, at = new Date()): Promise<void> {
  const parts: Record<string, () => Promise<unknown>> = {
    'purge trash': () => purgeTrash(env), 'purge audit': () => purgeAudit(env), 'purge sessions': () => purgeSessions(env), 'purge inbox': () => purgeInbox(env), pushes: () => pushes(env, at),
    // Knowledge: drop vectors that may no longer be held (safety sweep), then embed what is waiting (KN5).
    knowledge: async () => { await unembedStale(env); await embedPending(env, 1000); },
    // "From my apps" (KN7): once a day after digest_hour in the user's zone, and again (hourly at most) while the day's refresh has failures; a refresh nobody asked for is claimed first, so two runs can't both go.
    apps: async () => { const s = await getSettings(env), last = await lastRun(env); if (appsDue(s, last, at) && await claimRefresh(env, 'cron', at.getTime())) await refreshApps(env, undefined, 'cron', retryOnly(s, last, at)); },
  };
  await Promise.all(Object.entries(parts).map(([name, run]) => run().catch((e) => console.error(`[cron] ${name} failed: ${(e as Error).name}`))));
}
