import type { Env } from './types.ts';
import type { Milestone, Task } from '../shared/types.ts';
import { getSettings } from './lib/db.ts';
import { pushAll } from './lib/notify.ts';
import { duePushes, localNow } from './lib/schedule.ts';
import { purgeTrash, purgeAudit, purgeSessions, purgeInbox } from './routes/trash.ts';

/** Every 15 minutes: the purges, then whatever pushes are due. Each part is on its own, so one failing never stops the rest. */
async function pushes(env: Env): Promise<void> {
  const settings = await getSettings(env);
  // Titles stay encrypted on purpose: duePushes never puts a work title (or any decrypted work text) in a push.
  const tasks = (await env.DB.prepare(`SELECT id, title, status, due_at, waiting_on, waiting_since, nudge_every_days, deleted_at, parent_id, kind FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status != 'done'`).all<Task>()).results;
  const milestones = (await env.DB.prepare(`SELECT id, name, due_at, done_at, enc_v FROM milestones WHERE deleted_at IS NULL AND done_at IS NULL AND due_at IS NOT NULL`).all<Milestone>()).results
    .map((m) => ({ id: m.id, name: m.name, due_at: m.due_at, done_at: m.done_at, work: m.enc_v === 2 }));
  for (const p of duePushes({ now: localNow(settings.tz), settings, tasks, milestones })) await pushAll(env, p.type, p.key, p.message);
}

export async function runCron(env: Env): Promise<void> {
  const parts: Record<string, () => Promise<unknown>> = {
    'purge trash': () => purgeTrash(env), 'purge audit': () => purgeAudit(env), 'purge sessions': () => purgeSessions(env), 'purge inbox': () => purgeInbox(env), pushes: () => pushes(env),
  };
  await Promise.all(Object.entries(parts).map(([name, run]) => run().catch((e) => console.error(`[cron] ${name} failed: ${(e as Error).name}`))));
}
