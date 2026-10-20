import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Task, Project, Milestone } from '../../shared/types.ts';
import { open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { requireStepUp } from '../lib/step-up.ts';
import { purgeVectors } from '../lib/knowledge.ts';

const trash = new Hono<{ Bindings: Env; Variables: Variables }>();
const TABLES = { tasks: 'tasks', projects: 'projects', milestones: 'milestones', raid_items: 'raid_items', change_requests: 'change_requests', decisions: 'decisions', lessons: 'lessons', documents: 'documents', ai_threads: 'ai_threads', knowledge_collections: 'knowledge_collections', knowledge_items: 'knowledge_items' } as const;
// Phase 3 rows show "name · project": the list query joins the project (name, enc_v) and this opens it.
const PM_TABLES = ['raid_items', 'change_requests', 'decisions', 'lessons', 'documents', 'ai_threads'] as const;
const TRASH_DAYS = 30, AUDIT_DAYS = 90, SESSION_DAYS = 30;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

trash.get('/', async (c) => {
  const t = await c.env.DB.prepare('SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<Task>();
  const p = await c.env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<Project>();
  const m = await c.env.DB.prepare('SELECT * FROM milestones WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<Milestone>();
  const pm: Record<string, unknown[]> = {};
  for (const table of PM_TABLES) {
    const rows = await c.env.DB.prepare(`SELECT x.*, p.name AS project_name, p.enc_v AS project_enc_v FROM ${table} x LEFT JOIN projects p ON p.id = x.project_id WHERE x.deleted_at IS NOT NULL ORDER BY x.deleted_at DESC`)
      .all<{ project_name: string | null; project_enc_v: number; enc_v: number }>();
    pm[table] = await Promise.all((await openAll(c.env, table, rows.results)).map(async (r) => {
      const { project_enc_v, ...row } = r;
      return { ...row, project_name: row.project_name === null ? null : (await open(c.env, 'projects', { name: row.project_name, enc_v: project_enc_v })).name };
    }));
  }
  // Knowledge: a collection by name, an item by title and its collection's name (both sealed for work).
  const kc = await c.env.DB.prepare('SELECT * FROM knowledge_collections WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all<{ enc_v: number }>();
  const ki = await c.env.DB.prepare('SELECT x.*, k.name AS collection_name, k.enc_v AS collection_enc_v FROM knowledge_items x JOIN knowledge_collections k ON k.id = x.collection_id WHERE x.deleted_at IS NOT NULL ORDER BY x.deleted_at DESC')
    .all<{ collection_name: string; collection_enc_v: number; enc_v: number }>();
  pm.knowledge_collections = await openAll(c.env, 'knowledge_collections', kc.results);
  pm.knowledge_items = await Promise.all((await openAll(c.env, 'knowledge_items', ki.results)).map(async ({ collection_enc_v, ...r }) => ({ ...r, collection_name: (await open(c.env, 'knowledge_collections', { name: r.collection_name, enc_v: collection_enc_v })).name })));
  return c.json({ tasks: await openAll(c.env, 'tasks', t.results), projects: await openAll(c.env, 'projects', p.results), milestones: await openAll(c.env, 'milestones', m.results), ...pm, purge_after_days: TRASH_DAYS });
});

trash.post('/:table/:id/restore', async (c) => {
  const table = c.req.param('table');
  if (!Object.hasOwn(TABLES, table)) return c.json({ error: 'Not found' }, 404);
  const id = c.req.param('id');
  // A task's source_ref is unique among live tasks: if a newer task took it while this one was in Trash, the restored one lets go of it (restore never fails).
  const [, r] = await c.env.DB.batch([
    c.env.DB.prepare(table === 'tasks'
      ? `UPDATE tasks SET source_ref = NULL WHERE id = ?1 AND deleted_at IS NOT NULL AND source_ref IS NOT NULL AND EXISTS (SELECT 1 FROM tasks o WHERE o.source_ref = tasks.source_ref AND o.deleted_at IS NULL AND o.id != tasks.id)`
      : 'SELECT ?1').bind(id),
    c.env.DB.prepare(`UPDATE ${table} SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NOT NULL`).bind(now(), id),
  ]);
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
 * Order respects the foreign keys: events, task parents, tasks, copilot messages then threads, library imports then documents,
 * knowledge passages, items, collections (before the documents they came from),
 * project logs (RAID, changes, lessons, decisions), milestones, project links (tasks, meeting reviews), projects.
 */
export async function purgeTrash(env: Env, all = false): Promise<Record<string, number>> {
  const cutoff = all ? '9999' : daysAgo(TRASH_DAYS);
  const goneTasks = 'SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1';
  const goneProjects = 'SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?1';
  const goneThreads = `SELECT id FROM ai_threads WHERE (deleted_at IS NOT NULL AND deleted_at < ?1) OR project_id IN (${goneProjects})`;
  const goneDocs = `SELECT id FROM documents WHERE (deleted_at IS NOT NULL AND deleted_at < ?1) OR project_id IN (${goneProjects})`;
  // An item goes when it, its collection, or its document is gone; a passage goes with its item or collection.
  const goneColls = 'SELECT id FROM knowledge_collections WHERE deleted_at IS NOT NULL AND deleted_at < ?1';
  const goneItems = `SELECT id FROM knowledge_items WHERE (deleted_at IS NOT NULL AND deleted_at < ?1) OR collection_id IN (${goneColls}) OR document_id IN (${goneDocs})`;
  const goneRows = `(deleted_at IS NOT NULL AND deleted_at < ?1) OR project_id IN (${goneProjects})`;
  const q = (sql: string) => env.DB.prepare(sql).bind(cutoff);
  // One transaction: a concurrent trash or restore can't slip between the steps.
  const [events, , , tasks, messages, threads, kchunks, kitems, kcolls, , , docs, raid, changes, lessons, decisions, milestones, , , projects, clips] = await env.DB.batch([
    q(`DELETE FROM task_events WHERE task_id IN (${goneTasks})`),
    q(`UPDATE tasks SET parent_id = NULL WHERE parent_id IN (${goneTasks})`),
    q(`UPDATE inbox_items SET task_id = NULL WHERE task_id IN (${goneTasks})`), // the row outlives its task (FK)
    q(`DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1 RETURNING id`),
    q(`DELETE FROM ai_messages WHERE thread_id IN (${goneThreads}) RETURNING id`), // their read-aloud audio goes below
    q(`DELETE FROM ai_threads WHERE id IN (${goneThreads})`),
    q(`DELETE FROM knowledge_chunks WHERE item_id IN (${goneItems}) OR collection_id IN (${goneColls}) RETURNING id`), // their vectors go below
    q(`DELETE FROM knowledge_items WHERE id IN (${goneItems})`),
    q(`DELETE FROM knowledge_collections WHERE id IN (${goneColls})`),
    q(`DELETE FROM library_pages WHERE deleted_at IS NOT NULL AND deleted_at < ?1`),
    q(`DELETE FROM library_pages WHERE import_doc_id IN (${goneDocs})`), // an import goes with its document (FK)
    q(`DELETE FROM documents WHERE id IN (${goneDocs}) RETURNING r2_key`),
    q(`DELETE FROM raid_items WHERE ${goneRows}`),
    q(`DELETE FROM change_requests WHERE ${goneRows}`),
    q(`DELETE FROM lessons WHERE ${goneRows}`),
    q(`DELETE FROM decisions WHERE ${goneRows}`), // a project's decisions go with it (FK)
    q(`DELETE FROM milestones WHERE ${goneRows}`),
    q(`UPDATE tasks SET project_id = NULL WHERE project_id IN (${goneProjects})`),
    q(`UPDATE meeting_reviews SET project_id = NULL WHERE project_id IN (${goneProjects})`), // the review stays, unfiled (FK)
    q(`DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?1`),
    q(`DELETE FROM athena_clips WHERE deleted_at IS NOT NULL AND deleted_at < ?1 RETURNING r2_key`), // Athena's removed clips and portraits
  ]);
  // best effort, only after the rows are gone
  await Promise.all((tasks.results as { id: string }[]).map(({ id }) => env.FILES.delete(`email/${id}.eml`).catch(() => console.warn('[trash] could not delete a kept email'))));
  await Promise.all((docs.results as { r2_key: string }[]).map(({ r2_key }) => env.FILES.delete(r2_key).catch(() => console.warn('[trash] could not delete a document file'))));
  await Promise.all((clips.results as { r2_key: string }[]).map(({ r2_key }) => env.FILES.delete(r2_key).catch(() => console.warn('[trash] could not delete an Athena clip'))));
  await purgeVectors(env, (kchunks.results as { id: string }[]).map(({ id }) => id)).catch(() => console.warn('[trash] could not delete knowledge vectors'));
  const tts = (messages.results as { id: string }[]).map(({ id }) => `athena-tts/${id}`); // R2 deletes up to 1,000 keys a call; a missing key is fine
  for (let i = 0; i < tts.length; i += 1000) await env.FILES.delete(tts.slice(i, i + 1000)).catch(() => console.warn('[trash] could not delete an answer\'s audio'));
  return {
    task_events: events.meta.changes, tasks: tasks.results.length, ai_messages: messages.results.length, ai_threads: threads.meta.changes, documents: docs.results.length,
    raid_items: raid.meta.changes, change_requests: changes.meta.changes, lessons: lessons.meta.changes, decisions: decisions.meta.changes,
    milestones: milestones.meta.changes, projects: projects.meta.changes, athena_clips: clips.results.length,
    knowledge_chunks: kchunks.results.length, knowledge_items: kitems.meta.changes, knowledge_collections: kcolls.meta.changes,
  };
}
export async function purgeAudit(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM audit_log WHERE at < ?1').bind(daysAgo(AUDIT_DAYS)).run();
  await env.DB.prepare('DELETE FROM ai_usage WHERE at < ?1').bind(daysAgo(400)).run(); // usage counts only feed the monthly cap
  await env.DB.prepare('DELETE FROM push_log WHERE sent_at < ?1').bind(daysAgo(30)).run(); // push dedupe keys outlive nothing useful past 30 days
  await env.DB.prepare('DELETE FROM push_outbox WHERE at < ?1').bind(daysAgo(7)).run(); // the Mac app polls it every minute; a week covers a closed lid
}
/**
 * Inbox rows that were dealt with (dismissed, kept, added) over 30 days ago can still hold email text, so they go. New and snoozed rows stay,
 * and so does a row whose task is still open (not done, not trashed): it is that task's dedupe anchor.
 */
export async function purgeInbox(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM inbox_items WHERE state IN ('dismissed','kept','added') AND updated_at < ?1
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = inbox_items.task_id AND t.deleted_at IS NULL AND t.status != 'done')`).bind(daysAgo(30)).run();
}
/** Sessions that expired (or were revoked and last seen) over 30 days ago. */
export async function purgeSessions(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE (revoked = 1 AND last_seen_at < ?1) OR expires_at < ?1').bind(daysAgo(SESSION_DAYS)).run();
}
export default trash;
