import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env, SessionRow, Variables } from '../types.ts';
import { encryptString, decryptString } from './crypto-box.js';
import { idFetch, type IdTokens } from './knocturn-id.ts';
import { subOf, userAllowed } from './access.ts';

export const SESSION_COOKIE = 'cp_session';
const IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const ID_CHECK_MS = 60 * 60 * 1000;
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
const now = () => new Date().toISOString();

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const isSecure = (c: Ctx) => new URL(c.req.url).protocol === 'https:';
function setSessionCookie(c: Ctx, token: string, maxAgeMs: number) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: isSecure(c), sameSite: 'Lax', path: '/', maxAge: Math.floor(maxAgeMs / 1000) });
}
export function clearSessionCookie(c: Ctx) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function getSession(c: Ctx): Promise<SessionRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).first<SessionRow>();
  if (!row || row.revoked) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > IDLE_TIMEOUT_MS) return null;
  return row;
}

const encryptTokens = (c: Ctx, t: IdTokens) =>
  encryptString(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token }), c.env.COMPASS_DATA_KEY, 'auth_sessions.id_tokens_enc');

/** tokens = null makes a dev session with no Knocturn ID behind it (dev-login only). */
export async function createSession(c: Ctx, tokens: IdTokens | null): Promise<void> {
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO auth_sessions (id, token_hash, created_at, last_seen_at, expires_at, user_agent, ip, revoked, id_tokens_enc, id_checked_at)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, 0, ?7, ?3)`,
  )
    .bind(crypto.randomUUID(), await sha256Hex(token), t, new Date(Date.now() + ACTIVE_LIFETIME_MS).toISOString(),
      c.req.header('user-agent') ?? null, c.req.header('cf-connecting-ip') ?? null, tokens ? await encryptTokens(c, tokens) : null)
    .run();
  setSessionCookie(c, token, ACTIVE_LIFETIME_MS);
}

export async function idTokens(c: Ctx, session: SessionRow): Promise<IdTokens | null> {
  if (!session.id_tokens_enc) return null;
  return JSON.parse(await decryptString(session.id_tokens_enc, c.env.COMPASS_DATA_KEY, 'auth_sessions.id_tokens_enc'));
}

/** Hourly: refresh the Knocturn ID tokens; a refusal ends the session here, an outage doesn't (INTEGRATION.md §3). */
export async function checkWithId(c: Ctx, session: SessionRow): Promise<boolean> {
  if (session.id_checked_at && Date.now() - new Date(session.id_checked_at).getTime() < ID_CHECK_MS) return true;
  const claimed = await c.env.DB.prepare('UPDATE auth_sessions SET id_checked_at = ?1 WHERE id = ?2 AND id_checked_at IS ?3')
    .bind(now(), session.id, session.id_checked_at).run();
  if (!claimed.meta.changes) return true;
  const tokens = await idTokens(c, session);
  if (!tokens) return true;
  const r = await idFetch(c, '/v1/auth/refresh', { refresh_token: tokens.refresh_token }).catch(() => null);
  if (r?.ok) {
    const fresh = await r.json<IdTokens>();
    if (!userAllowed(c.env.COMPASS_USERS, subOf(fresh.access_token))) { await revokeSession(c.env.DB, session.id); return false; }
    await c.env.DB.prepare('UPDATE auth_sessions SET id_tokens_enc = ?1 WHERE id = ?2').bind(await encryptTokens(c, fresh), session.id).run();
    return true;
  }
  if (r?.status === 401) { await revokeSession(c.env.DB, session.id); return false; }
  return true;
}

export async function touchSession(c: Ctx, sessionId: string) {
  await c.env.DB.prepare('UPDATE auth_sessions SET last_seen_at = ?1 WHERE id = ?2').bind(now(), sessionId).run();
  const token = getCookie(c, SESSION_COOKIE);
  if (token) setSessionCookie(c, token, ACTIVE_LIFETIME_MS);
}
export async function revokeSession(db: D1Database, sessionId: string) {
  await db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE id = ?1').bind(sessionId).run();
}
export async function endSession(c: Ctx, session: SessionRow) {
  const tokens = await idTokens(c, session).catch(() => null);
  if (tokens) await idFetch(c, '/v1/auth/logout', { refresh_token: tokens.refresh_token }).catch(() => null);
  await revokeSession(c.env.DB, session.id);
}
