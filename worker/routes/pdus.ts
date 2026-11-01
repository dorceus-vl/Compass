import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { CertRow, PduRow } from '../../shared/types.ts';
import { text, num, date, checkAll, type Check } from '../lib/validate.ts';
import { now, audit } from '../lib/db.ts';

/** v2.12 PDU tracker: certification cycles (/certs) and the PDUs earned toward them (/). Personal data, plain. Deletes are soft (rule 2). */
const pdus = new Hono<{ Bindings: Env; Variables: Variables }>();
export const MAX_CERTS = 20, MAX_PDUS = 1000;

const req = (c: Check): Check => (v, f) => (v === undefined || v === null || v === '' ? { error: `${f} is required` } : c(v, f));
const certChecks: Record<string, Check> = { name: req(text(80)), cycle_start: req(date({ nullable: false })), cycle_end: req(date({ nullable: false })), required: num(0.25, 1000, { nullable: false }) };
const pduChecks: Record<string, Check> = { title: req(text(160)), category: req(text(60)), hours: num(0.25, 100, { nullable: false }), earned_on: req(date({ nullable: false })) };

/** Creating needs every field; a patch only the ones it carries. */
function parse(b: Record<string, unknown>, checks: Record<string, Check>, partial: boolean) {
  if (!partial) for (const f of Object.keys(checks)) if (b[f] === undefined) return { error: `${f} is required` };
  return checkAll(b, checks);
}
const body = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

pdus.get('/', async (c) => {
  const certs = await c.env.DB.prepare('SELECT * FROM certs WHERE deleted_at IS NULL ORDER BY cycle_end LIMIT ?1').bind(MAX_CERTS).all<CertRow>();
  const rows = await c.env.DB.prepare('SELECT * FROM pdus WHERE deleted_at IS NULL ORDER BY earned_on DESC LIMIT ?1').bind(MAX_PDUS).all<PduRow>();
  return c.json({ certs: certs.results, pdus: rows.results });
});

pdus.post('/certs', async (c) => {
  const r = parse(await body(c), certChecks, false);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const v = r.values as Pick<CertRow, 'name' | 'cycle_start' | 'cycle_end' | 'required'>;
  if (v.cycle_end <= v.cycle_start) return c.json({ error: 'cycle_end must be after cycle_start' }, 400);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM certs WHERE deleted_at IS NULL').first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_CERTS) return c.json({ error: 'cert_limit' }, 409);
  const t = now(), row: CertRow = { id: crypto.randomUUID(), ...v, created_at: t, updated_at: t, deleted_at: null };
  await c.env.DB.prepare('INSERT INTO certs (id, name, cycle_start, cycle_end, required, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)').bind(row.id, row.name, row.cycle_start, row.cycle_end, row.required, t).run();
  await audit(c.env, 'you', 'cert.create', row.id);
  return c.json({ cert: row }, 201);
});

pdus.patch('/certs/:id', async (c) => {
  const r = parse(await body(c), certChecks, true);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const cur = await c.env.DB.prepare('SELECT * FROM certs WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<CertRow>();
  if (!cur) return c.json({ error: 'Not found' }, 404);
  const row = { ...cur, ...(r.values as Partial<CertRow>), updated_at: now() };
  if (row.cycle_end <= row.cycle_start) return c.json({ error: 'cycle_end must be after cycle_start' }, 400);
  await c.env.DB.prepare('UPDATE certs SET name = ?2, cycle_start = ?3, cycle_end = ?4, required = ?5, updated_at = ?6 WHERE id = ?1').bind(row.id, row.name, row.cycle_start, row.cycle_end, row.required, row.updated_at).run();
  await audit(c.env, 'you', 'cert.update', row.id);
  return c.json({ cert: row });
});

// A cert and its PDUs go together (same deleted_at), so Trash purges them together.
pdus.delete('/certs/:id', async (c) => {
  const id = c.req.param('id'), t = now();
  const r = await c.env.DB.prepare('UPDATE certs SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(id, t).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('UPDATE pdus SET deleted_at = ?2 WHERE cert_id = ?1 AND deleted_at IS NULL').bind(id, t).run();
  await audit(c.env, 'you', 'cert.delete', id);
  return c.json({ ok: true });
});

pdus.post('/', async (c) => {
  const b = await body(c);
  const r = parse(b, pduChecks, false);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (typeof b.cert_id !== 'string' || !(await c.env.DB.prepare('SELECT 1 FROM certs WHERE id = ?1 AND deleted_at IS NULL').bind(b.cert_id).first())) return c.json({ error: 'cert_id is not a certification' }, 400);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM pdus WHERE deleted_at IS NULL').first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_PDUS) return c.json({ error: 'pdu_limit' }, 409);
  const t = now(), row: PduRow = { id: crypto.randomUUID(), cert_id: b.cert_id, ...(r.values as Pick<PduRow, 'title' | 'category' | 'hours' | 'earned_on'>), created_at: t, updated_at: t, deleted_at: null };
  await c.env.DB.prepare('INSERT INTO pdus (id, cert_id, title, category, hours, earned_on, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)').bind(row.id, row.cert_id, row.title, row.category, row.hours, row.earned_on, t).run();
  await audit(c.env, 'you', 'pdu.create', row.id);
  return c.json({ pdu: row }, 201);
});

pdus.patch('/:id', async (c) => {
  const r = parse(await body(c), pduChecks, true);
  if ('error' in r) return c.json({ error: r.error }, 400);
  const cur = await c.env.DB.prepare('SELECT * FROM pdus WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id')).first<PduRow>();
  if (!cur) return c.json({ error: 'Not found' }, 404);
  const row = { ...cur, ...(r.values as Partial<PduRow>), updated_at: now() };
  await c.env.DB.prepare('UPDATE pdus SET title = ?2, category = ?3, hours = ?4, earned_on = ?5, updated_at = ?6 WHERE id = ?1').bind(row.id, row.title, row.category, row.hours, row.earned_on, row.updated_at).run();
  await audit(c.env, 'you', 'pdu.update', row.id);
  return c.json({ pdu: row });
});

pdus.delete('/:id', async (c) => {
  const r = await c.env.DB.prepare('UPDATE pdus SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id'), now()).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'pdu.delete', c.req.param('id'));
  return c.json({ ok: true });
});

export default pdus;
