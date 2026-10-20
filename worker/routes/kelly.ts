import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { AgentScope } from '../../shared/types.ts';
import { AGENT_SCOPES, allowed } from '../lib/agent.ts';
import { cleanBrief } from '../lib/kelly.ts';
import { now, audit, getSettings, patchSettings } from '../lib/db.ts';
import { localDate } from '../lib/dates.ts';
import { requireStepUp } from '../lib/step-up.ts';

// Vlad's side of Kelly: her switches (passkey to change), what she did, and her brief from Kelly-Cloud. The agent API she calls is routes/agent.ts.
const kelly = new Hono<{ Bindings: Env; Variables: Variables }>();
const CALL = `actor = 'kelly' AND action LIKE 'agent.%'`;

kelly.get('/', async (c) => {
  const s = await getSettings(c.env);
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString(), today = localDate(s.tz);
  const last = await c.env.DB.prepare(`SELECT MAX(at) AS at FROM audit_log WHERE ${CALL}`).first<{ at: string | null }>();
  const { results } = await c.env.DB.prepare(`SELECT at FROM audit_log WHERE ${CALL} AND at > ?1`).bind(since).all<{ at: string }>(); // the zone's day starts within 36 h
  return c.json({ enabled: s.kelly.enabled === true, scopes: s.kelly.scopes ?? [], last_call_at: last?.at ?? null,
    calls_today: results.filter((r) => localDate(s.tz, new Date(r.at)) === today).length, relay: !!(c.env.KELLY_RELAY_URL && c.env.KELLY_RELAY_SECRET) });
});

kelly.put('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { enabled?: unknown; scopes?: unknown } | null;
  if (!body || typeof body !== 'object' || (body.enabled === undefined && body.scopes === undefined)) return c.json({ error: 'Send enabled and/or scopes' }, 400);
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return c.json({ error: 'enabled must be true or false' }, 400);
  if (body.scopes !== undefined && (!Array.isArray(body.scopes) || !body.scopes.every((x) => AGENT_SCOPES.includes(x as AgentScope)))) return c.json({ error: `scopes must be a list of: ${AGENT_SCOPES.join(', ')}` }, 400);
  const refused = await requireStepUp(c); // passkey: this is what lets an outside app act for Vlad
  if (refused) return refused;
  const before = (await getSettings(c.env)).kelly;
  const after = { enabled: (body.enabled as boolean | undefined) ?? before.enabled === true, scopes: body.scopes ? AGENT_SCOPES.filter((s) => (body.scopes as string[]).includes(s)) : before.scopes ?? [] };
  await patchSettings(c.env, { kelly: after });
  await audit(c.env, 'you', 'kelly.scopes', null, { before, after });
  return c.json({ enabled: after.enabled, scopes: after.scopes });
});

type Row = { id: string; at: string; actor: string; action: string; target: string | null; detail: string | null };
/** Kelly's calls and changes to her access, newest first. `task_live` says whether the task a call named still exists (so the screen can link it). */
kelly.get('/log', async (c) => {
  const n = Number(c.req.query('limit') ?? 50), before = c.req.query('before') ?? '9999';
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'limit must be a whole number from 1 to 100' }, 400);
  const limit = Math.min(n, 100);
  const { results } = await c.env.DB.prepare(`SELECT id, at, actor, action, target, detail FROM audit_log WHERE (${CALL} OR action = 'kelly.scopes') AND at < ?1 ORDER BY at DESC LIMIT ?2`).bind(before, limit).all<Row>();
  const ids = [...new Set(results.filter((r) => r.action.startsWith('agent.tasks.') && r.target).map((r) => r.target!))];
  const live = new Set<string>();
  if (ids.length) for (const t of (await c.env.DB.prepare(`SELECT id FROM tasks WHERE deleted_at IS NULL AND id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`).bind(...ids).all<{ id: string }>()).results) live.add(t.id);
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return c.json({ rows: results.map((r) => ({ ...r, detail: parse(r.detail), task_live: !!r.target && live.has(r.target) })), next: results.length === limit ? results[results.length - 1].at : null });
});

/** Kelly's paragraph for today from Kelly-Cloud's relay; `{ unavailable: true }` for anything else (off, no read permission, no relay, slow, bad answer). */
kelly.get('/brief', async (c) => {
  const env = c.env, s = await getSettings(env), un = () => c.json({ unavailable: true }, 200, { 'Cache-Control': 'private, no-store' });
  if (!allowed(s.kelly, 'compass:read.tasks') || !env.KELLY_RELAY_URL || !env.KELLY_RELAY_SECRET) return un();
  const q = c.req.query('date'), date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : localDate(s.tz);
  // Cached per date for an hour in the Worker's own cache (not D1). The switch and the scope were checked first, so turning her off ends it at once.
  const key = new Request(`https://compass.invalid/kelly-brief/${date}`), cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return c.json(await hit.json(), 200, { 'Cache-Control': 'private, no-store' });
  try {
    const r = await fetch(`${env.KELLY_RELAY_URL.replace(/\/$/, '')}/brief?date=${date}`, { headers: { 'X-Relay-Secret': env.KELLY_RELAY_SECRET }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const out = r.ok ? cleanBrief(await r.json().catch(() => null), now()) : null;
    if (!out) return un();
    await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' } }));
    return c.json(out, 200, { 'Cache-Control': 'private, no-store' });
  } catch (e) { console.error("kelly brief", e); return un(); }
});

export default kelly;
