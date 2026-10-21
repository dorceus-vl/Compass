import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { ExportBundle } from '../../shared/types.ts';
import { openAll, ENC_COLS, type EncTable } from '../lib/enc.ts';
import { audit, getSettings, now } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { requireStepUp } from '../lib/step-up.ts';

const exportRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// Never exported: auth_sessions, push_subscriptions, push_log, audit_log, ai_usage, documents.r2_key. `settings` holds no secrets.
const PLAIN = ['rules', 'library_pages'] as const; // no sealed columns
const dump = async (env: Env, table: EncTable | (typeof PLAIN)[number]): Promise<Record<string, unknown>[]> => {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all<{ enc_v?: number }>();
  const rows = table in ENC_COLS ? await openAll(env, table as EncTable, results) : results;
  return rows.map(({ enc_v: _, ...row }) => row as Record<string, unknown>);
};

exportRoute.get('/', async (c) => {
  const refused = await requireStepUp(c); // passkey, like Empty Trash
  if (refused) return refused;
  const env = c.env, settings = await getSettings(env);
  const [projects, milestones, tasks, task_events, raid_items, change_requests, decisions, lessons, meeting_reviews, inbox_items, rules, documents, library_pages, ai_threads, ai_messages, knowledge_collections, knowledge_items, knowledge_chunks, templates, meeting_series, baselines, stakeholders] = await Promise.all(
    (['projects', 'milestones', 'tasks', 'task_events', 'raid_items', 'change_requests', 'decisions', 'lessons', 'meeting_reviews', 'inbox_items', 'rules', 'documents', 'library_pages', 'ai_threads', 'ai_messages', 'knowledge_collections', 'knowledge_items', 'knowledge_chunks', 'templates', 'meeting_series', 'baselines', 'stakeholders'] as const).map((t) => dump(env, t)));
  const bundle = {
    exported_at: now(), version: 1, settings, projects, milestones, tasks, task_events, raid_items, change_requests, decisions, lessons, meeting_reviews, inbox_items, rules,
    documents: documents.map(({ r2_key: _, ...d }) => d), library_pages, ai_threads, ai_messages,
    knowledge_collections, knowledge_items, knowledge_chunks, templates, meeting_series, baselines, stakeholders,
  } as unknown as ExportBundle;
  await audit(env, 'you', 'export', null);
  return new Response(JSON.stringify(bundle), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="compass-export-${localDate(settings.tz)}.json"`, 'Cache-Control': 'private, no-store' },
  });
});

export default exportRoute;
