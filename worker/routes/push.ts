import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import { deliver } from '../lib/notify.ts';
import { now } from '../lib/db.ts';
import { unb64u } from '../lib/webpush.ts';

const push = new Hono<{ Bindings: Env; Variables: Variables }>();
const B64U = /^[A-Za-z0-9_-]+$/;
const MAX_DEVICES = 20;
const PLATFORMS = ['ios', 'ipados', 'android', 'mac'];
const bytes = (s: string) => { try { return unb64u(s); } catch { return new Uint8Array(0); } };

push.get('/key', (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY ?? null })); // not secret: PushManager.subscribe needs it

push.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, device_name, kind, platform, created_at, last_ok_at FROM push_subscriptions ORDER BY created_at').all();
  return c.json({ subscriptions: results });
});

// Re-subscribing the same endpoint updates its keys and name and clears the failure count.
push.post('/subscribe', async (c) => {
  const b = await c.req.json<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; device_name?: unknown }>().catch(() => ({}) as Record<string, never>);
  const { endpoint } = b, p256dh = b.keys?.p256dh, auth = b.keys?.auth, name = b.device_name;
  let https = false;
  try { https = typeof endpoint === 'string' && endpoint.length <= 2048 && new URL(endpoint).protocol === 'https:'; } catch { /* not a URL */ }
  if (!https) return c.json({ error: 'endpoint must be an https URL (2048 characters at most)' }, 400);
  if (typeof p256dh !== 'string' || !B64U.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return c.json({ error: 'keys.p256dh is not valid' }, 400);
  if (typeof auth !== 'string' || !B64U.test(auth) || bytes(auth).length !== 16) return c.json({ error: 'keys.auth is not valid' }, 400);
  const pk = bytes(p256dh);
  if (pk.length !== 65 || pk[0] !== 4) return c.json({ error: 'keys.p256dh is not valid' }, 400); // an uncompressed P-256 point
  if (name != null && (typeof name !== 'string' || name.length > 80)) return c.json({ error: 'device_name must be text (80 characters at most)' }, 400);
  const known = await c.env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).first();
  if (!known && ((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>())?.n ?? 0) >= MAX_DEVICES) return c.json({ error: 'Too many devices; remove one in Settings' }, 409);
  const row = await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, device_name, created_at, kind, platform) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'web', 'web')
     ON CONFLICT (endpoint) DO UPDATE SET kind = 'web', platform = 'web', env = NULL, p256dh = excluded.p256dh, auth = excluded.auth, device_name = COALESCE(excluded.device_name, device_name), failed_count = 0
     RETURNING id`).bind(crypto.randomUUID(), endpoint, p256dh, auth, (name as string | null | undefined)?.trim() || null, now()).first<{ id: string }>();
  return c.json({ id: row!.id });
});

// A phone, tablet or Mac app registers its Apple (apns, hex) or Firebase (fcm) token. Re-registering the same token updates it and clears the failure count.
push.post('/device', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const { kind, token, env, platform, device_name: name } = b;
  if (kind !== 'apns' && kind !== 'fcm') return c.json({ error: 'kind must be apns or fcm' }, 400);
  if (typeof token !== 'string' || !(kind === 'apns' ? /^[0-9a-f]{64}$/ : /^[A-Za-z0-9_:-]{20,4096}$/).test(token)) return c.json({ error: 'token is not valid' }, 400);
  if (kind === 'apns' && env !== 'development' && env !== 'production') return c.json({ error: 'env must be development or production' }, 400);
  if (kind === 'fcm' && env != null) return c.json({ error: 'env is for apns only' }, 400);
  if (typeof platform !== 'string' || !PLATFORMS.includes(platform)) return c.json({ error: 'platform must be ios, ipados, android or mac' }, 400);
  if (name != null && (typeof name !== 'string' || name.length > 80)) return c.json({ error: 'device_name must be text (80 characters at most)' }, 400);
  const known = await c.env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?1').bind(token).first();
  if (!known && ((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>())?.n ?? 0) >= MAX_DEVICES) return c.json({ error: 'Too many devices; remove one in Settings' }, 409);
  const row = await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, device_name, created_at, kind, env, platform) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (endpoint) DO UPDATE SET kind = excluded.kind, env = excluded.env, platform = excluded.platform, p256dh = NULL, auth = NULL,
       device_name = COALESCE(excluded.device_name, device_name), failed_count = 0
     RETURNING id`).bind(crypto.randomUUID(), token, (name as string | null | undefined)?.trim() || null, now(), kind, kind === 'apns' ? env : null, platform).first<{ id: string }>();
  return c.json({ id: row!.id });
});

// What the Mac app shows (it gets no Apple push, ruling N3): the newest 50 pushes after `since`, oldest first.
push.get('/outbox', async (c) => {
  const since = c.req.query('since') ?? '';
  if (since && Number.isNaN(Date.parse(since))) return c.json({ error: 'since must be an ISO time' }, 400);
  const { results } = await c.env.DB.prepare('SELECT id, at, title, body, url FROM (SELECT * FROM push_outbox WHERE at > ?1 ORDER BY at DESC LIMIT 50) ORDER BY at')
    .bind(since).all();
  return c.json({ items: results });
});

// Hard delete is deliberate: a subscription is device configuration (an endpoint and keys), not user content, and a dead one must stop receiving.
push.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// Ignores quiet hours, the per-type switches and the log, so it works at any time.
push.post('/test', async (c) =>
  c.json({ sent: await deliver(c.env, { title: 'Test from Compass', body: 'Notifications reach this device.', url: '/', tag: 'test' }) }));

export default push;
