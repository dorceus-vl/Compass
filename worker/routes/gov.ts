import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { GOV, govInput, type GovTable } from '../lib/gov.ts';
import { projectKind } from './projects.ts';

type App = Hono<{ Bindings: Env; Variables: Variables }>;
type Row = Record<string, unknown> & { enc_v?: number };
const readBody = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

/** The four logs share one shape: list/create under a project, patch/trash by id. Work rows are sealed like everything else. */
function govRouter(table: GovTable): { byProject: App; byId: App } {
  const spec = GOV[table], { path } = spec;
  const byProject: App = new Hono(), byId: App = new Hono();
  const today = async (env: Env) => localDate((await getSettings(env)).tz, new Date());
  const hasMeeting = table === 'raid_items' || table === 'decisions';

  byProject.get(`/:id/${path}`, async (c) => {
    if (!(await projectKind(c.env, c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY ${spec.order}`).bind(c.req.param('id')).all<Row>();
    return c.json({ items: await openAll(c.env, table, results) });
  });

  byProject.post(`/:id/${path}`, async (c) => {
    const project_id = c.req.param('id');
    const kind = await projectKind(c.env, project_id);
    if (!kind) return c.json({ error: 'Not found' }, 404);
    const r = govInput(spec, await readBody(c), true, await today(c.env));
    if ('error' in r) return c.json({ error: r.error }, 400);
    const t = now();
    const blank = Object.fromEntries(Object.keys(spec.checks).map((k) => [k, null]));
    const row: Row = {
      id: crypto.randomUUID(), project_id, ...blank, ...(hasMeeting ? { from_meeting_id: null } : {}), ...r.values,
      created_at: t, updated_at: t, deleted_at: null, enc_v: 0,
    };
    const s = await seal(c.env, table, { ...row }, kind);
    row.enc_v = s.enc_v;
    const cols = Object.keys(row);
    await c.env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...cols.map((k) => s[k] ?? null)).run();
    await audit(c.env, 'you', `${path}.create`, row.id as string);
    return c.json({ item: row }, 201);
  });

  byId.patch('/:id', async (c) => {
    const stored = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`).bind(c.req.param('id')).first<Row>();
    if (!stored) return c.json({ error: 'Not found' }, 404);
    const current = await open(c.env, table, { ...stored });
    const r = govInput(spec, await readBody(c), false, await today(c.env), current);
    if ('error' in r) return c.json({ error: r.error }, 400);
    const next: Row = { ...current, ...r.values, updated_at: now() };
    // Seal the way the row is already held, so a patch never mixes ciphertext and plain text in one row.
    const s = await seal(c.env, table, { ...next }, stored.enc_v === 2 ? 'work' : 'personal');
    next.enc_v = s.enc_v;
    const cols = Object.keys(r.values).concat('updated_at', 'enc_v');
    await c.env.DB.prepare(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`).bind(stored.id, ...cols.map((k) => s[k] ?? null)).run();
    await audit(c.env, 'you', `${path}.edit`, stored.id as string, Object.keys(r.values));
    return c.json({ item: next });
  });

  byId.delete('/:id', async (c) => {
    const t = now();
    const r = await c.env.DB.prepare(`UPDATE ${table} SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL`).bind(t, c.req.param('id')).run();
    if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
    await audit(c.env, 'you', `${path}.trash`, c.req.param('id'));
    return c.json({ ok: true });
  });

  return { byProject, byId };
}

export const raid = govRouter('raid_items'), changes = govRouter('change_requests'), decisions = govRouter('decisions'), lessons = govRouter('lessons');
