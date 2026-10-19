import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types.ts';
import { getSession, touchSession, checkWithId } from '../lib/session.ts';
import { sameOrigin } from '../lib/access.ts';

// Only /api/* reaches the Worker (wrangler.jsonc run_worker_first); the app shell is static and holds no data.
const PUBLIC = new Set(['/api/auth/login', '/api/auth/dev-login']);

export async function authGuard(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  if (PUBLIC.has(new URL(c.req.url).pathname)) return next();
  const session = await getSession(c);
  if (!session || !(await checkWithId(c, session))) return c.json({ error: 'Unauthorized' }, 401);
  await touchSession(c, session.id);
  c.set('session', session);
  return next();
}
