import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { AgentScope, Settings } from '../../shared/types.ts';
import { AGENT_SCOPES, allowed } from '../lib/agent.ts';
import { cleanBrief, cleanEvents, isYmd, rangeError } from '../lib/kelly.ts';
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
  // `at` keys the Worker's relay caches (relayGet): any change leaves the brief and calendar Kelly sent before it behind, in every data centre.
  const after = { enabled: (body.enabled as boolean | undefined) ?? before.enabled === true, scopes: body.scopes ? AGENT_SCOPES.filter((s) => (body.scopes as string[]).includes(s)) : before.scopes ?? [], at: now() };
  await patchSettings(c.env, { kelly: after });
  await audit(c.env, 'you', 'kelly.scopes', null, { before, after });
  return c.json({ enabled: after.enabled, scopes: after.scopes });
});

type Row = { id: string; at: string; actor: string; action: string; target: string | null; detail: string | null };
/** Kelly's calls, changes to her access and the documents Vlad gave her, newest first. `task_live` says whether the task a call named still exists (so the screen can link it). */
kelly.get('/log', async (c) => {
  const n = Number(c.req.query('limit') ?? 50), before = c.req.query('before') ?? '9999';
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'limit must be a whole number from 1 to 100' }, 400);
  const limit = Math.min(n, 100);
  const { results } = await c.env.DB.prepare(`SELECT id, at, actor, action, target, detail FROM audit_log WHERE (${CALL} OR action IN ('kelly.scopes', 'kelly.document')) AND at < ?1 ORDER BY at DESC LIMIT ?2`).bind(before, limit).all<Row>();
  const ids = [...new Set(results.filter((r) => r.action.startsWith('agent.tasks.') && r.target).map((r) => r.target!))];
  const live = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) { // D1 binds at most 100 parameters a statement; the page can name 100 tasks
    const part = ids.slice(i, i + 50);
    for (const t of (await c.env.DB.prepare(`SELECT id FROM tasks WHERE deleted_at IS NULL AND id IN (${part.map((_, j) => `?${j + 1}`).join(',')})`).bind(...part).all<{ id: string }>()).results) live.add(t.id);
  }
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return c.json({ rows: results.map((r) => ({ ...r, detail: parse(r.detail), task_live: !!r.target && live.has(r.target) })), next: results.length === limit ? results[results.length - 1].at : null });
});

type Gate = { relay: string; secret: string; gen?: string } | null;
/** The relay when both its URL and secret are set. */
export const relayOf = (env: Env): Gate => (env.KELLY_RELAY_URL && env.KELLY_RELAY_SECRET ? { relay: env.KELLY_RELAY_URL.replace(/\/$/, ''), secret: env.KELLY_RELAY_SECRET } : null);
/** Kelly on, compass:read.tasks granted, and a relay configured; checked before any cache read or relay call so turning her off ends it at once. */
function gate(env: Env, s: Settings): Gate { const g = allowed(s.kelly, 'compass:read.tasks') ? relayOf(env) : null; return g && { ...g, gen: s.kelly.at ?? '0' }; }
/** Every call to the relay: its secret, a 3xx is never followed, a timeout (5 s unless the call needs longer). */
export const relayFetch = (g: NonNullable<Gate>, path: string, init: RequestInit & { headers?: Record<string, string> } = {}, ms = 5000) =>
  fetch(`${g.relay}${path}`, { ...init, headers: { ...init.headers, 'X-Relay-Secret': g.secret }, redirect: 'manual', signal: AbortSignal.timeout(ms) });
/** A document Vlad chose to share goes to Kelly's own search (relay POST /documents); true only when she answers with its id. The caller has already checked the document may leave Compass. Nothing is logged but the failure. */
export async function sendDocument(env: Env, name: string, bytes: Uint8Array): Promise<boolean> {
  const g = relayOf(env);
  if (!g) return false;
  try {
    const r = await relayFetch(g, '/documents', { method: 'POST', body: bytes, headers: { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' } }, 60_000);
    if (!r.ok) { console.error('kelly relay document: status', r.status); return false; } // the status only, never the body
    return typeof ((await r.json().catch(() => null)) as { id?: unknown } | null)?.id === 'string';
  } catch (e) { console.error('kelly relay document', e); return false; }
}
/** One relay GET, cached in the Worker's own cache (not D1) under `name` and the last change to Kelly's access (`gen`), so a change starts afresh. `clean` turns the body into what we keep (null = unusable). 3xx counts as unavailable, never followed. */
async function relayGet<T>(g: NonNullable<Gate>, name: string, path: string, maxAge: number, clean: (body: unknown) => T | null, ms?: number): Promise<T | null> {
  const key = new Request(`https://compass.invalid/${encodeURIComponent(g.gen ?? '0')}/${name}`), cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as T;
  try {
    const r = await relayFetch(g, path, {}, ms);
    const out = r.ok ? clean(await r.json().catch(() => null)) : null;
    if (out) await cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${maxAge}` } }));
    return out;
  } catch (e) { console.error('kelly relay', name, e); return null; }
}

/** Kelly's paragraph for today from Kelly-Cloud's relay; `{ unavailable: true }` for anything else (off, no read permission, no relay, slow, bad answer).
 * Up to 15 s: a first build reads her calendar and Compass (3 s at most) and writes it with a model; Today shows Compass's own brief meanwhile. */
kelly.get('/brief', async (c) => {
  const q = c.req.query('date');
  if (q !== undefined && !isYmd(q)) return c.json({ error: 'date must be like 2026-10-20' }, 400);
  const un = () => c.json({ unavailable: true }, 200, { 'Cache-Control': 'private, no-store' });
  const s = await getSettings(c.env), g = gate(c.env, s);
  if (!g) return un();
  const date = q ?? localDate(s.tz);
  const out = await relayGet(g, `kelly-brief/${date}`, `/brief?date=${date}`, 3600, (b) => cleanBrief(b, now()), 15_000);
  return out ? c.json(out, 200, { 'Cache-Control': 'private, no-store' }) : un();
});

/** Kelly's calendar events for from..to (YYYY-MM-DD, at most 62 days) from the relay: `{ events }`, read-only, or `{ unavailable: true }` like the brief. Cached 5 minutes. */
kelly.get('/calendar', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to'), bad = rangeError(from, to);
  if (bad) return c.json({ error: bad }, 400);
  const un = () => c.json({ unavailable: true }, 200, { 'Cache-Control': 'private, no-store' });
  const g = gate(c.env, await getSettings(c.env));
  if (!g) return un();
  const events = await relayGet(g, `kelly-cal/${from}/${to}`, `/calendar?from=${from}&to=${to}`, 300, (b) => { const e = cleanEvents(b); return e && { events: e }; });
  return events ? c.json(events, 200, { 'Cache-Control': 'private, no-store' }) : un();
});

export default kelly;
