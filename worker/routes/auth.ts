import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, Variables } from '../types.ts';
import { createSession, endSession, clearSessionCookie } from '../lib/session.ts';
import { idFetch, ID_MESSAGES } from '../lib/knocturn-id.ts';
import { subOf, userAllowed } from '../lib/access.ts';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

function deviceName(ua = ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `Compass · ${browser} on ${os}`;
}

// Username + password; on passkey_required the page runs Touch ID / Face ID and posts the same body plus `passkey`.
auth.post('/login', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) return c.json({ error: 'invalid_request', message: 'Enter your username and password.' }, 400);
  const r = await idFetch(c, '/v1/auth/login', {
    username, password, app: 'compass',
    device: { id: String(body.deviceId ?? ''), name: deviceName(c.req.header('user-agent')), platform: 'web' },
    ...(body.passkey ? { passkey: body.passkey } : {}),
  }).catch(() => null);
  if (!r || r.status >= 500) return c.json({ error: 'id_unavailable', message: "Can't reach Knocturn ID right now. Try again in a minute." }, 503);
  const data = await r.json<{ error?: string; options?: unknown; access_token: string; refresh_token: string }>().catch(() => null);
  if (r.ok && data) {
    if (!userAllowed(c.env.COMPASS_USERS, subOf(data.access_token))) {
      await idFetch(c, '/v1/auth/logout', { refresh_token: data.refresh_token }).catch(() => null);
      return c.json({ error: 'not_allowed', message: "This Knocturn ID account can't use Compass." }, 403);
    }
    await createSession(c, data);
    return c.json({ ok: true });
  }
  const error = data?.error ?? 'server_error';
  if (error === 'passkey_required') return c.json({ stage: 'passkey', options: data!.options });
  return c.json({ error, message: ID_MESSAGES[error] ?? 'Sign-in failed. Try again.' }, r.status as ContentfulStatusCode);
});

// A shell app (iPhone, iPad, Android, Mac) signs in on Knocturn ID's own page (INTEGRATION.md §8d) and posts the one-time code it got back
// with its PKCE verifier. Same allow-list and session as /login; the cookie lands in the shell's web view, which loads this site.
auth.post('/native', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const code = typeof body.code === 'string' ? body.code : '';
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
  if (!code || code.length > 200 || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return c.json({ error: 'invalid_request', message: ID_MESSAGES.invalid_request }, 400);
  const r = await idFetch(c, '/v1/auth/token', { code, code_verifier: verifier }).catch(() => null);
  if (!r || r.status >= 500) return c.json({ error: 'id_unavailable', message: "Can't reach Knocturn ID right now. Try again in a minute." }, 503);
  const data = await r.json<{ error?: string; access_token: string; refresh_token: string }>().catch(() => null);
  if (r.ok && data?.access_token) {
    if (!userAllowed(c.env.COMPASS_USERS, subOf(data.access_token))) {
      await idFetch(c, '/v1/auth/logout', { refresh_token: data.refresh_token }).catch(() => null);
      return c.json({ error: 'not_allowed', message: "This Knocturn ID account can't use Compass." }, 403);
    }
    await createSession(c, data);
    return c.json({ ok: true });
  }
  const error = data?.error ?? 'invalid_grant';
  return c.json({ error, message: error === 'invalid_grant' ? 'That sign-in expired. Try again.' : (ID_MESSAGES[error] ?? 'Sign-in failed. Try again.') }, error === 'rate_limited' ? 429 : 401);
});

// wrangler dev only: a session without Knocturn ID, so the smoke test and local work need no real sign-in.
auth.post('/dev-login', async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== '1' || (host !== 'localhost' && host !== '127.0.0.1')) return c.json({ error: 'Not found' }, 404);
  await createSession(c, null);
  return c.json({ ok: true, dev: true });
});

auth.post('/logout', async (c) => {
  await endSession(c, c.get('session'));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get('/me', (c) => c.json({ ok: true, sessionId: c.get('session').id, dev: !c.get('session').id_tokens_enc }));

export default auth;
