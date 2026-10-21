import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { parseStakeholderInput, type Stakeholder } from '../../shared/stakeholders.ts';

type App = Hono<{ Bindings: Env; Variables: Variables }>;
const readBody = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
/** A project keeps this many live stakeholders (the list reads them with this LIMIT, so every bind has a cap: CLAUDE.md rule 9). */
export const MAX_STAKEHOLDERS = 500;

/** Stakeholder register (v2.2, C6): list and add under a project, edit, trash and "contacted" by id. Work rows are sealed. Kelly has no route here. */
export const byProject: App = new Hono(), byId: App = new Hono();

async function liveProject(env: Env, id: string) {
  return env.DB.prepare('SELECT kind, data_boundary FROM projects WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<{ kind: 'personal' | 'work'; data_boundary: 'cloud' | 'offline' }>();
}

byProject.get('/:id/stakeholders', async (c) => {
  const p = await liveProject(c.env, c.req.param('id'));
  if (!p) return c.json({ error: 'Not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM stakeholders WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY sort, created_at LIMIT ?2').bind(c.req.param('id'), MAX_STAKEHOLDERS).all<Stakeholder>();
  // C8: "Draft update" is offered only when Athena may see this project (live and Cloud); the device never works it out itself.
  return c.json({ items: await openAll(c.env, 'stakeholders', results), athena: p.data_boundary === 'cloud' }, 200, { 'Cache-Control': 'private, no-store' });
});

byProject.post('/:id/stakeholders', async (c) => {
  const project_id = c.req.param('id');
  const p = await liveProject(c.env, project_id);
  if (!p) return c.json({ error: 'Not found' }, 404);
  const r = parseStakeholderInput(await readBody(c), true);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM stakeholders WHERE project_id = ?1 AND deleted_at IS NULL').bind(project_id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_STAKEHOLDERS) return c.json({ error: 'stakeholder_limit', message: `A project keeps ${MAX_STAKEHOLDERS} stakeholders at most` }, 409);
  const t = now();
  const row = { id: crypto.randomUUID(), project_id, ...r.values, last_contact_at: null, sort: Date.now(), created_at: t, updated_at: t, deleted_at: null, enc_v: 0 } as Record<string, unknown> & { enc_v: number };
  const s = await seal(c.env, 'stakeholders', { ...row }, p.kind);
  row.enc_v = s.enc_v;
  const cols = Object.keys(row);
  await c.env.DB.prepare(`INSERT INTO stakeholders (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...cols.map((k) => s[k] ?? null)).run();
  await audit(c.env, 'you', 'stakeholder.create', row.id as string); // never the name
  return c.json({ item: row }, 201);
});

const load = (env: Env, id: string) => env.DB.prepare('SELECT * FROM stakeholders WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Stakeholder>();

byId.patch('/:id', async (c) => {
  const stored = await load(c.env, c.req.param('id'));
  if (!stored) return c.json({ error: 'Not found' }, 404);
  const r = parseStakeholderInput(await readBody(c), false);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const next = { ...(await open(c.env, 'stakeholders', { ...stored })), ...r.values, updated_at: now() } as Stakeholder;
  // Seal the way the row is already held, so a patch never mixes ciphertext and plain text in one row.
  const s = await seal(c.env, 'stakeholders', { ...next }, stored.enc_v === 2 ? 'work' : 'personal') as Record<string, unknown>;
  const cols = Object.keys(r.values).concat('updated_at', 'enc_v');
  await c.env.DB.prepare(`UPDATE stakeholders SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`).bind(stored.id, ...cols.map((k) => s[k] ?? null)).run();
  await audit(c.env, 'you', 'stakeholder.edit', stored.id, Object.keys(r.values));
  return c.json({ item: next });
});

// "Mark sent": the update went out now. last_contact_at is a plain timestamp (rule 7), so nothing is sealed or opened here.
byId.post('/:id/contacted', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE stakeholders SET last_contact_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'stakeholder.contacted', c.req.param('id'));
  return c.json({ ok: true, last_contact_at: t });
});

byId.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE stakeholders SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'stakeholder.trash', c.req.param('id'));
  return c.json({ ok: true });
});
