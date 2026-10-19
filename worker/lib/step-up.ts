import type { Context } from 'hono';
import type { Env, Variables } from '../types.ts';
import { idFetch } from './knocturn-id.ts';
import { idTokens } from './session.ts';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

/** A dev session has no Knocturn ID tokens and only exists with DEV_LOGIN=1 (wrangler dev). Decided from the column, never from an error. */
const isDev = (c: Ctx) => !c.get('session').id_tokens_enc && c.env.DEV_LOGIN === '1';

/** navigator.credentials.get() options from Knocturn ID (INTEGRATION.md §8b step-up). */
export async function stepUpChallenge(c: Ctx): Promise<Response> {
  if (isDev(c)) return c.json({ options: null, dev: true });
  const tokens = await idTokens(c, c.get('session')); // a throw (bad key, corrupt column) fails closed as a 500
  if (!tokens) return c.json({ error: 'Confirm with your passkey to continue.', step_up: true }, 403);
  const r = await idFetch(c, '/v1/passkeys/challenge', {}, tokens.access_token).catch(() => null);
  if (!r?.ok) return c.json({ error: r?.status === 403 ? 'Add a passkey to your Knocturn ID first.' : "Can't reach Knocturn ID right now." }, r?.status === 403 ? 403 : 503);
  return c.json(await r.json());
}

/** null when the request carries an accepted passkey answer in X-Step-Up (JSON), else the 403 to send. */
export async function requireStepUp(c: Ctx): Promise<Response | null> {
  if (isDev(c)) return null;
  const tokens = await idTokens(c, c.get('session')); // a throw (bad key, corrupt column) fails closed as a 500
  if (!tokens) return c.json({ error: 'Confirm with your passkey to continue.', step_up: true }, 403);
  const raw = c.req.header('x-step-up');
  if (!raw) return c.json({ error: 'Confirm with your passkey to continue.', step_up: true }, 403);
  let credential: unknown;
  try { credential = JSON.parse(raw); } catch { return c.json({ error: 'Bad step-up answer.', step_up: true }, 403); }
  const r = await idFetch(c, '/v1/passkeys/verify', { credential }, tokens.access_token).catch(() => null);
  if (!r) return c.json({ error: "Can't reach Knocturn ID right now." }, 503);
  if (r.status === 429) return c.json({ error: 'Too many attempts. Wait 15 minutes.' }, 429);
  if (r.status !== 204) return c.json({ error: "That passkey wasn't accepted. Try again.", step_up: true }, 403);
  return null;
}
