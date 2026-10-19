import type { Context } from 'hono';
import type { Env, Variables } from '../types.ts';

// Knocturn ID (~/Documents/Knocturn-ID, contract in its INTEGRATION.md) owns the username, password and passkeys —
// the same account for every Knocturn app. This app signs in through it as app "compass", then keeps its own
// cp_session cookie on top (worker/lib/session.ts). Calls go over the ID service binding; the visitor's IP and browser
// are passed along so Knocturn ID's rate limit and audit log see the real client, not this Worker.
export type IdTokens = { access_token: string; refresh_token: string };

export function idFetch(c: Context<{ Bindings: Env; Variables: Variables }>, path: string, body: unknown = {}, accessToken?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const h of ['cf-connecting-ip', 'user-agent']) {
    const v = c.req.header(h);
    if (v) headers[h] = v;
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return c.env.ID.fetch(`https://id.knocturnlabs.com${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

// What the login page shows for each Knocturn ID error code.
export const ID_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong username or password.',
  invalid_passkey: "That passkey wasn't accepted. Enter your password again.",
  passkey_not_enrolled: 'Add a passkey to your Knocturn ID first: Manage your Knocturn ID → Passkeys → Add this device.',
  rate_limited: 'Too many attempts. Wait 15 minutes, then try again.',
  invalid_request: 'Sign-in failed. Reload the page and try again.',
};
