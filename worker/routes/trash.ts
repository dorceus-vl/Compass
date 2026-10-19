import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Task, Project, Milestone } from '../../shared/types.ts';
import { openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { requireStepUp } from '../lib/step-up.ts';

const trash = new Hono<{ Bindings: Env; Variables: Variables }>();
const TABLES = { tasks: 'tasks', projects: 'projects', milestones: 'milestones' } as const;
const TRASH_DAYS = 30, AUDIT_DAYS = 90, SESSION_DAYS = 30;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

trash.get('/', async (c) => {
  const t = await c.env.DB.prepare('SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<Task>();
  const p = await c.env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<Project>();
  const m = await c.env.DB.prepare('SELECT * FROM milestones WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<Milestone>();
  return c.json({ tasks: await openAll(c.env, 'tasks', t.results), projects: await openAll(c.env, 'projects', p.results), milestones: await openAll(c.env, 'milestones', m.results), purge_after_days: TRASH_DAYS });
});

trash.post('/:table/:id/restore', async (c) => {
  const table = c.req.param('table');
  if (!Object.hasOwn(TABLES, table)) return c.json({ error: 'Not found' }, 404);
  const r = await c.env.DB.prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NOT NULL`).bind(now(), c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', `${table}.restore`, c.req.param('id'));
  return c.json({ ok: true });
});

// The one place rows leave D1 for good. Passkey first (CLAUDE.md rule 2).
trash.post('/empty', async (c) => {
  const refused = await requireStepUp(c);
  if (refused) return refused;
  const purged = await purgeTrash(c.env, true);
  await audit(c.env, 'you', 'trash.empty', null, purged);
  return c.json({ purged });
});

/**
 * Cron: rows in Trash for 30 days are deleted (all = everything in Trash, for Empty Trash).
 * Order respects the foreign keys: events, then task parents, tasks, milestones, project links, projects.
 */
export async function purgeTrash(env: Env, all = false): Promise<Record<string, number>> {
  const cutoff = all ? '9999' : daysAgo(TRASH_DAYS);
  const goneTasks = 'SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1';
  const goneProjects = 'SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?1';
  const q = (sql: string) => env.DB.prepare(sql).bind(cutoff);
  // One transaction: a concurrent trash or restore can't slip between the steps.
  const [events, , tasks, milestones, , projects] = await env.DB.batch([
    q(`DELETE FROM task_events WHERE task_id IN (${goneTasks})`),
    q(`UPDATE tasks SET parent_id = NULL WHERE parent_id IN (${goneTasks})`),
    q(`DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1`),
    q(`DELETE FROM milestones WHERE (deleted_at IS NOT NULL AND deleted_at < ?1) OR project_id IN (${goneProjects})`),
    q(`UPDATE tasks SET project_id = NULL WHERE project_id IN (${goneProjects})`),
    q(`DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?1`),
  ]);
  return { task_events: events.meta.changes, tasks: tasks.meta.changes, milestones: milestones.meta.changes, projects: projects.meta.changes };
}
export async function purgeAudit(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM audit_log WHERE at < ?1').bind(daysAgo(AUDIT_DAYS)).run();
}
/** Sessions that expired (or were revoked and last seen) over 30 days ago. */
export async function purgeSessions(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE (revoked = 1 AND last_seen_at < ?1) OR expires_at < ?1').bind(daysAgo(SESSION_DAYS)).run();
}
export default trash;
