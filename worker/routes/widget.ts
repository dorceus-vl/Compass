import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { now, audit } from '../lib/db.ts';
import { requireStepUp } from '../lib/step-up.ts';
import { newToken, hashToken, findToken, overLimit, deviceName, MAX_ACTIVE_TOKENS } from '../lib/widget.ts';
import { loadTask, completeTask } from './tasks.ts';

// The iPhone and iPad widgets' tick token (v2.3, W5). Vlad's side (session; creating needs the passkey): create, list, revoke.
// The widget's side: POST /api/widget/tasks/:id/done with `Authorization: Bearer <token>`. The auth guard lets exactly that method and path through
// (no cookie, no Origin); the token is checked here. It can do one thing: mark a live, open task done.
const widget = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = { id: string; device_name: string; token_hash: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

widget.post('/token', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { device_name?: unknown } | null;
  const refused = await requireStepUp(c); // passkey: this is what lets a widget act for Vlad
  if (refused) return refused;
  const name = deviceName(body?.device_name);
  const { results } = await c.env.DB.prepare('SELECT id, device_name FROM widget_tokens WHERE revoked_at IS NULL').all<Pick<Row, 'id' | 'device_name'>>();
  const t = now();
  // One token per device: the same name replaces its old token (a reinstall has lost the Keychain item).
  const same = results.filter((r) => r.device_name === name);
  if (results.length - same.length >= MAX_ACTIVE_TOKENS) return c.json({ error: `Up to ${MAX_ACTIVE_TOKENS} devices. Revoke one first.` }, 409);
  const token = newToken(), id = crypto.randomUUID();
  await c.env.DB.batch([
    ...same.map((r) => c.env.DB.prepare('UPDATE widget_tokens SET revoked_at = ?2 WHERE id = ?1').bind(r.id, t)),
    c.env.DB.prepare('INSERT INTO widget_tokens (id, device_name, token_hash, created_at) VALUES (?1, ?2, ?3, ?4)').bind(id, name, await hashToken(token), t),
  ]);
  await audit(c.env, 'you', 'widget.token.create', id, { device: name });
  return c.json({ id, token }, 201, { 'Cache-Control': 'no-store' }); // the only time the token is shown
});

widget.get('/tokens', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, device_name, created_at, last_used_at FROM widget_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 50').all<Pick<Row, 'id' | 'device_name' | 'created_at' | 'last_used_at'>>();
  return c.json({ tokens: results }, 200, { 'Cache-Control': 'private, no-store' });
});

widget.delete('/token/:id', async (c) => {
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('UPDATE widget_tokens SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL').bind(id, now()).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'widget.token.revoke', id);
  return c.json({ ok: true });
});

const count = async (env: Env, token: string, since: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'widget' AND action = 'widget.done' AND at > ?1 AND json_extract(detail, '$.token') = ?2`).bind(since, token).first<{ n: number }>())?.n ?? 0;

widget.post('/tasks/:id/done', async (c) => {
  const m = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(c.req.header('authorization') ?? '');
  // A bad, missing or revoked token gets 401 and nothing else: no audit row, no last_used_at, not counted.
  const { results } = m ? await c.env.DB.prepare('SELECT id, device_name, token_hash, created_at, last_used_at, revoked_at FROM widget_tokens WHERE revoked_at IS NULL LIMIT 50').all<Row>() : { results: [] as Row[] };
  const tok = m ? findToken(results, await hashToken(m[1])) : null;
  if (!tok) return c.json({ error: 'Unauthorized' }, 401);
  const env = c.env, id = c.req.param('id'), t = Date.now();
  // Only calls that were answered are audited (below), so a flood past the limit can't grow the log.
  if (overLimit(await count(env, tok.id, new Date(t - 60_000).toISOString()), await count(env, tok.id, new Date(t - 86_400_000).toISOString()))) return c.json({ error: 'rate_limited' }, 429);
  await env.DB.prepare('UPDATE widget_tokens SET last_used_at = ?2 WHERE id = ?1').bind(tok.id, now()).run();
  const task = await loadTask(env, id);
  // Missing, trashed and already done look the same. Any live open task of Vlad's will do (a subtask on a widget is fine).
  if (!task || task.status === 'done') { await audit(env, 'widget', 'widget.done', id, { token: tok.id, refused: 'not_found' }); return c.json({ error: 'Not found' }, 404); }
  await completeTask(env, task, [], 'you', { via: 'widget' }); // recurrence and the unblock push run as for any tick
  await audit(env, 'widget', 'widget.done', id, { token: tok.id, ok: true }); // the id, never the text
  return c.json({ ok: true });
});

export default widget;
