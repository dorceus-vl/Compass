import { Hono, type Context } from 'hono';
import type { Env, Variables } from '../types.ts';
import { now, audit } from '../lib/db.ts';
import { requireStepUp } from '../lib/step-up.ts';
import { newToken, hashToken, findToken, overLimit, deviceName, timerAction, MAX_ACTIVE_TOKENS } from '../lib/widget.ts';
import { loadTask, completeTask } from './tasks.ts';
import { createEntry, stopEntry } from './time.ts';

// The iPhone and iPad widgets' tick token (v2.3, W5). Vlad's side (session; creating needs the passkey): create, list, revoke.
// The widget's side: POST /api/widget/tasks/:id/done and (v2.5, T8) POST /api/widget/tasks/:id/timer with `Authorization: Bearer <token>`. The auth guard lets
// exactly those methods and paths through (no cookie, no Origin); the token is checked here. It can do two things to a live, open task: mark it done, start or stop its timer.
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

// Every answered widget call counts against the token's limits, whatever its action.
const count = async (env: Env, token: string, since: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'widget' AND action IN ('widget.done', 'widget.timer') AND at > ?1 AND json_extract(detail, '$.token') = ?2`).bind(since, token).first<{ n: number }>())?.n ?? 0;

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
/** The token check both widget routes share: the token's row, or the answer to send (401 with nothing written, or 429 not audited). Sets last_used_at. */
async function widgetToken(c: Ctx): Promise<{ tok: Row } | { res: Response }> {
  const m = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(c.req.header('authorization') ?? '');
  // A bad, missing or revoked token gets 401 and nothing else: no audit row, no last_used_at, not counted.
  const { results } = m ? await c.env.DB.prepare('SELECT id, device_name, token_hash, created_at, last_used_at, revoked_at FROM widget_tokens WHERE revoked_at IS NULL LIMIT 50').all<Row>() : { results: [] as Row[] };
  const tok = m ? findToken(results, await hashToken(m[1])) : null;
  if (!tok) return { res: c.json({ error: 'Unauthorized' }, 401) };
  const t = Date.now();
  // Only calls that were answered are audited (below), so a flood past the limit can't grow the log.
  if (overLimit(await count(c.env, tok.id, new Date(t - 60_000).toISOString()), await count(c.env, tok.id, new Date(t - 86_400_000).toISOString()))) return { res: c.json({ error: 'rate_limited' }, 429) };
  await c.env.DB.prepare('UPDATE widget_tokens SET last_used_at = ?2 WHERE id = ?1').bind(tok.id, now()).run();
  return { tok };
}

widget.post('/tasks/:id/done', async (c) => {
  const auth = await widgetToken(c);
  if ('res' in auth) return auth.res;
  const { tok } = auth, env = c.env, id = c.req.param('id');
  const task = await loadTask(env, id);
  // Missing, trashed and already done look the same. Any live open task of Vlad's will do (a subtask on a widget is fine).
  if (!task || task.status === 'done') { await audit(env, 'widget', 'widget.done', id, { token: tok.id, refused: 'not_found' }); return c.json({ error: 'Not found' }, 404); }
  await completeTask(env, task, [], 'you', { via: 'widget' }); // recurrence and the unblock push run as for any tick
  await audit(env, 'widget', 'widget.done', id, { token: tok.id, ok: true }); // the id, never the text
  return c.json({ ok: true });
});

// T8: start or stop the task's timer. `at` is when the widget was tapped (clamped like any time; a start is never in the future). The start and stop rules are
// POST /api/time's own (createEntry, stopEntry): 409 timer_running / timer_limit come back as they are, audited as refused. Stop with none running is 200, stopped false.
widget.post('/tasks/:id/timer', async (c) => {
  const auth = await widgetToken(c);
  if ('res' in auth) return auth.res;
  const { tok } = auth, env = c.env, id = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as { action?: unknown; at?: unknown } | null;
  const action = timerAction(body), at = typeof body?.at === 'string' ? body.at : undefined;
  const refuse = async (status: 400 | 404 | 409, refused: string, out: Record<string, unknown>) => {
    await audit(env, 'widget', 'widget.timer', id, { token: tok.id, action, refused });
    return c.json(out, status);
  };
  if (!action) return refuse(400, 'bad_action', { error: 'bad_action', message: 'action is start or stop' });
  const task = await loadTask(env, id);
  if (!task || task.status === 'done') return refuse(404, 'not_found', { error: 'Not found' });
  if (action === 'start') {
    const r = await createEntry(env, { task_id: id, started_at: at }, 'widget');
    if (r.status !== 201) return refuse(r.status === 409 ? 409 : 400, String(r.body.error), r.body);
    await audit(env, 'widget', 'widget.timer', id, { token: tok.id, action, ok: true });
    return c.json({ ok: true, entry_id: (r.body.entry as { id: string }).id });
  }
  const run = await env.DB.prepare('SELECT id FROM time_entries WHERE task_id = ?1 AND ended_at IS NULL AND deleted_at IS NULL LIMIT 1').bind(id).first<{ id: string }>();
  if (run) await stopEntry(env, run.id, at ?? new Date().toISOString()); // idempotent: a stop racing another lands once
  await audit(env, 'widget', 'widget.timer', id, { token: tok.id, action, ok: true });
  return c.json({ ok: true, stopped: !!run });
});

export default widget;
