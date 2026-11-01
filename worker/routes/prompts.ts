import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { PromptRow } from '../../shared/types.ts';
import { text } from '../lib/validate.ts';
import { now, audit } from '../lib/db.ts';

const prompts = new Hono<{ Bindings: Env; Variables: Variables }>();
export const MAX_PROMPTS = 100, MAX_TITLE = 120, MAX_BODY = 4000;

const fields = (b: Record<string, unknown>, partial: boolean) => {
  const out: { title?: string; body?: string } = {};
  for (const [k, max] of [['title', MAX_TITLE], ['body', MAX_BODY]] as const) {
    if (partial && b[k] === undefined) continue;
    const r = text(max)(b[k], k);
    if ('error' in r) return { error: r.error };
    if (!r.value) return { error: `${k} is required` };
    out[k] = r.value as string;
  }
  return { out };
};

prompts.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM prompts WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE LIMIT ?1').bind(MAX_PROMPTS).all<PromptRow>();
  return c.json({ prompts: results });
});

prompts.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const f = fields(b, false);
  if ('error' in f) return c.json({ error: f.error }, 400);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM prompts WHERE deleted_at IS NULL').first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_PROMPTS) return c.json({ error: 'prompt_limit' }, 409);
  const t = now(), row: PromptRow = { id: crypto.randomUUID(), title: f.out.title!, body: f.out.body!, created_at: t, updated_at: t, deleted_at: null };
  await c.env.DB.prepare('INSERT INTO prompts (id, title, body, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)').bind(row.id, row.title, row.body, t, t).run();
  await audit(c.env, 'you', 'prompt.create', row.id);
  return c.json({ prompt: row }, 201);
});

prompts.patch('/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const f = fields(b, true);
  if ('error' in f) return c.json({ error: f.error }, 400);
  const cur = await c.env.DB.prepare('SELECT * FROM prompts WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<PromptRow>();
  if (!cur) return c.json({ error: 'Not found' }, 404);
  const row = { ...cur, ...f.out, updated_at: now() };
  await c.env.DB.prepare('UPDATE prompts SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1').bind(row.id, row.title, row.body, row.updated_at).run();
  await audit(c.env, 'you', 'prompt.update', row.id);
  return c.json({ prompt: row });
});

// Soft delete (rule 2): the cron purges it after 30 days.
prompts.delete('/:id', async (c) => {
  const r = await c.env.DB.prepare('UPDATE prompts SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id'), now()).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'prompt.delete', c.req.param('id'));
  return c.json({ ok: true });
});

export default prompts;
