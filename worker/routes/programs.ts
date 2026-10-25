import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { Program, ProgramDetail } from '../../shared/types.ts';
import { checkAll, text, oneOf, num, type Check } from '../lib/validate.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { parseSnapshot } from '../../shared/baseline.ts';
import { MAX_PROGRAMS, PROGRAM_LIMITS } from '../../shared/program.ts';

/** Programs (v2.4): list, create, edit, trash, and one program's detail. Work rows are sealed. Kelly has no route here. */
const programs = new Hono<{ Bindings: Env; Variables: Variables }>();
const readBody = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

const CHECKS: Record<string, Check> = {
  name: text(PROGRAM_LIMITS.name), rag: oneOf('green', 'amber', 'red', 'none'), rag_reason: text(PROGRAM_LIMITS.rag_reason), notes: text(PROGRAM_LIMITS.notes), sort: num(),
};

/** A program's live members, as a subselect on ?1 (the program id): no id list is ever bound (rule 9). */
export const MEMBERS_SQL = 'SELECT id FROM projects WHERE program_id = ?1 AND deleted_at IS NULL';
/** P3: the latest live baseline of each live member of program ?1 (one bind). The program report (Task 3) reads it too. */
export const LATEST_BASELINES_SQL = `SELECT b.* FROM baselines b WHERE b.deleted_at IS NULL AND b.project_id IN (${MEMBERS_SQL})
  AND b.taken_at = (SELECT MAX(o.taken_at) FROM baselines o WHERE o.project_id = b.project_id AND o.deleted_at IS NULL) LIMIT 500`;

programs.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM programs WHERE deleted_at IS NULL ORDER BY sort, created_at LIMIT ?1').bind(MAX_PROGRAMS).all<Program>();
  return c.json({ programs: await openAll(c.env, 'programs', results) }, 200, { 'Cache-Control': 'private, no-store' });
});

programs.post('/', async (c) => {
  const body = await readBody(c);
  if (body.kind !== 'personal' && body.kind !== 'work') return c.json({ error: 'kind must be one of: personal, work' }, 400);
  const r = checkAll(body, CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!r.values.name) return c.json({ error: 'name is required' }, 400);
  const t = now();
  const row: Program = { id: crypto.randomUUID(), kind: body.kind, name: '', rag: 'none', rag_reason: null, notes: null, sort: Date.now(), enc_v: 0, ...r.values, created_at: t, updated_at: t, deleted_at: null } as Program;
  const s = await seal(c.env, 'programs', { ...row });
  row.enc_v = s.enc_v;
  // The cap is checked in the INSERT itself, so two creates at once can't both pass it.
  const res = await c.env.DB.prepare(
    `INSERT INTO programs (id, kind, name, rag, rag_reason, notes, sort, enc_v, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE (SELECT COUNT(*) FROM programs WHERE deleted_at IS NULL) < ?11`,
  ).bind(s.id, s.kind, s.name, s.rag, s.rag_reason ?? null, s.notes ?? null, s.sort, s.enc_v, s.created_at, s.updated_at, MAX_PROGRAMS).run();
  if (!res.meta.changes) return c.json({ error: 'program_limit', message: `Compass keeps ${MAX_PROGRAMS} programs at most` }, 409);
  await audit(c.env, 'you', 'program.create', row.id); // never the name
  return c.json({ program: row }, 201);
});

const load = (env: Env, id: string) => env.DB.prepare('SELECT * FROM programs WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Program>();

programs.patch('/:id', async (c) => {
  const stored = await load(c.env, c.req.param('id'));
  if (!stored) return c.json({ error: 'Not found' }, 404);
  const body = await readBody(c);
  if ('kind' in body) return c.json({ error: 'program_kind_fixed', message: "A program's kind can't change" }, 400); // P1
  const r = checkAll(body, CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if ('name' in r.values && !r.values.name) return c.json({ error: 'name is required' }, 400);
  const next = { ...(await open(c.env, 'programs', { ...stored })), ...r.values, updated_at: now() } as Program;
  const s = await seal(c.env, 'programs', { ...next }) as unknown as Record<string, unknown>; // by the row's own kind
  const cols = Object.keys(r.values).concat('updated_at', 'enc_v');
  await c.env.DB.prepare(`UPDATE programs SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`).bind(stored.id, ...cols.map((k) => s[k] ?? null)).run();
  await audit(c.env, 'you', 'program.edit', stored.id, Object.keys(r.values));
  return c.json({ program: { ...next, enc_v: s.enc_v as number } });
});

programs.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE programs SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL').bind(t, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'program.trash', c.req.param('id'));
  return c.json({ ok: true });
});

type RiskRow = { id: string; project_id: string; text: string; probability: number | null; impact: number | null; enc_v: number };
programs.get('/:id/detail', async (c) => {
  const id = c.req.param('id'), db = c.env.DB;
  const [p, b, r, q] = await db.batch([
    db.prepare('SELECT * FROM programs WHERE id = ?1 AND deleted_at IS NULL').bind(id),
    db.prepare(LATEST_BASELINES_SQL).bind(id),
    db.prepare(`SELECT id, project_id, text, probability, impact, enc_v FROM raid_items WHERE type = 'risk' AND status = 'open' AND deleted_at IS NULL AND project_id IN (${MEMBERS_SQL})
      ORDER BY COALESCE(probability, 0) * COALESCE(impact, 0) DESC, created_at LIMIT 10`).bind(id),
    db.prepare(`SELECT project_id, COUNT(*) AS n FROM change_requests WHERE decision = 'pending' AND deleted_at IS NULL AND project_id IN (${MEMBERS_SQL}) GROUP BY project_id LIMIT 500`).bind(id),
  ]);
  const program = (p.results as Program[])[0];
  if (!program) return c.json({ error: 'Not found' }, 404);
  const baselines: ProgramDetail['baselines'] = [];
  for (const row of await openAll(c.env, 'baselines', b.results as { project_id: string; snapshot: string; taken_at: string; enc_v: number }[])) {
    const snapshot = parseSnapshot(row.snapshot);
    if (snapshot) baselines.push({ project_id: row.project_id, snapshot, taken_at: row.taken_at });
  }
  const risks = (await openAll(c.env, 'raid_items', r.results as RiskRow[])).map((x) => ({ id: x.id, project_id: x.project_id, title: x.text, probability: x.probability, impact: x.impact }));
  const detail: ProgramDetail = { program: await open(c.env, 'programs', program), baselines, risks, pending_changes: q.results as { project_id: string; n: number }[] };
  return c.json(detail, 200, { 'Cache-Control': 'private, no-store' });
});

export default programs;
