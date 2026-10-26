import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types.ts';
import { getSession, touchSession, checkWithId } from '../lib/session.ts';
import { sameOrigin } from '../lib/access.ts';

// Only /api/* reaches the Worker (wrangler.jsonc run_worker_first); the app shell is static and holds no data.
const PUBLIC = new Set(['/api/auth/login', '/api/auth/dev-login', '/api/auth/native']);

export async function authGuard(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  // POST /api/inbox is sent by other servers (no cookie, no Origin); the route checks the per-sender secret itself.
  if (c.req.method === 'POST' && new URL(c.req.url).pathname.replace(/\/$/, '') === '/api/inbox') return next();
  // /api/agent/* is called by Kelly (server to server, no cookie, no Origin); the agent routes check the bearer secret themselves.
  if (/^\/api\/agent(\/|$)/.test(new URL(c.req.url).pathname)) return next();
  // POST /api/widget/tasks/:id/done and /timer are sent by the widgets (no cookie, no Origin); the route checks the bearer token itself. Exactly these methods and paths.
  if (c.req.method === 'POST' && /^\/api\/widget\/tasks\/[^/]+\/(done|timer)$/.test(new URL(c.req.url).pathname)) return next();
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  if (PUBLIC.has(new URL(c.req.url).pathname)) return next();
  const session = await getSession(c);
  if (!session || !(await checkWithId(c, session))) return c.json({ error: 'Unauthorized' }, 401);
  await touchSession(c, session.id);
  c.set('session', session);
  return next();
}
