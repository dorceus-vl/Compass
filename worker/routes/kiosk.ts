import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { now, audit, getSettings } from '../lib/db.ts';
import { requireStepUp } from '../lib/step-up.ts';
import { newToken, hashToken, findToken } from '../lib/widget.ts';
import { localDate } from '../lib/dates.ts';
import { kioskCard, kioskLabel, tooSoon, KIOSK_MAX_ITEMS, KIOSK_MAX_TOKENS, type KioskTask } from '../lib/kiosk.ts';
import { LIVE_PERSONAL } from '../lib/digest.ts';

// The Aura wall tablet's "today" card (v2.14). Vlad's side (session): create (passkey), list, revoke. The tablet's side: GET /api/kiosk/today with
// `Authorization: Bearer <token>` (the auth guard lets exactly that method and path through). Read-only; personal task titles in Cloud projects only, work as a count.
const kiosk = new Hono<{ Bindings: Env; Variables: Variables }>();
type Row = { id: string; label: string; token_hash: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

kiosk.post('/token', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { label?: unknown } | null;
  const refused = await requireStepUp(c);
  if (refused) return refused;
  const label = kioskLabel(body?.label);
  const { results } = await c.env.DB.prepare('SELECT id FROM kiosk_tokens WHERE revoked_at IS NULL').all<{ id: string }>();
  if (results.length >= KIOSK_MAX_TOKENS) return c.json({ error: `Up to ${KIOSK_MAX_TOKENS} displays. Revoke one first.` }, 409);
  const token = newToken(), id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO kiosk_tokens (id, label, token_hash, created_at) VALUES (?1, ?2, ?3, ?4)').bind(id, label, await hashToken(token), now()).run();
  await audit(c.env, 'you', 'kiosk.token.create', id, { label });
  return c.json({ id, token }, 201, { 'Cache-Control': 'no-store' }); // the only time the token is shown
});

kiosk.get('/tokens', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, label, created_at, last_used_at FROM kiosk_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 10').all();
  return c.json({ tokens: results }, 200, { 'Cache-Control': 'private, no-store' });
});

kiosk.delete('/token/:id', async (c) => {
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('UPDATE kiosk_tokens SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL').bind(id, now()).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'kiosk.token.revoke', id);
  return c.json({ ok: true });
});

kiosk.get('/today', async (c) => {
  const m = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(c.req.header('authorization') ?? '');
  const { results } = m ? await c.env.DB.prepare('SELECT id, label, token_hash, created_at, last_used_at, revoked_at FROM kiosk_tokens WHERE revoked_at IS NULL LIMIT 10').all<Row>() : { results: [] as Row[] };
  const tok = m ? findToken(results, await hashToken(m[1])) : null;
  if (!tok) return c.json({ error: 'Unauthorized' }, 401); // nothing written for a bad token
  if (tooSoon(tok.last_used_at, Date.now())) return c.json({ error: 'rate_limited' }, 429);
  await c.env.DB.prepare('UPDATE kiosk_tokens SET last_used_at = ?2 WHERE id = ?1').bind(tok.id, now()).run();
  const date = localDate((await getSettings(c.env)).tz);
  // ponytail: a task blocked by another still shows; filter on blocked_by when the wall card should match Today's own list.
  const [personal, work] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT t.title, t.due_at FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND t.kind = 'personal' AND t.enc_v = 0 AND t.parent_id IS NULL AND t.status != 'done' AND t.due_at IS NOT NULL AND substr(t.due_at, 1, 10) <= ?1
        AND (t.project_id IS NULL OR (${LIVE_PERSONAL})) ORDER BY t.due_at, t.priority DESC, t.created_at LIMIT ${KIOSK_MAX_ITEMS + 50}`).bind(date),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND kind = 'work' AND parent_id IS NULL AND status != 'done' AND due_at IS NOT NULL AND substr(due_at, 1, 10) <= ?1`).bind(date),
  ]);
  const rows = personal.results as KioskTask[];
  return c.json(kioskCard(date, rows, (work.results[0] as { n: number }).n), 200, { 'Cache-Control': 'private, no-store' });
});

export default kiosk;
