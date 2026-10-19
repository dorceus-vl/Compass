// Who may use Compass, and from where. Pure, so its check runs without a Worker.

/** The Knocturn ID account in an access token. Its payload is read, not verified: the token comes straight from
 * Knocturn ID over the ID service binding (login and refresh), never from the browser. */
export function subOf(accessToken: string): string | null {
  try {
    const sub = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

/** COMPASS_USERS (wrangler.jsonc) lists the Knocturn ID accounts allowed to use Compass; empty = nobody. */
export const userAllowed = (list: string | undefined, sub: string | null) =>
  !!sub && (list ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(sub);

/** Changes (anything but GET/HEAD) and WebSockets only from Compass's own pages. The Lax cookie still reaches Compass from
 * other *.knocturnlabs.com sites (same site), so a page there could otherwise change something as you.
 * Local dev (Vite on localhost -> wrangler on localhost) passes on a local host only. */
export function sameOrigin(req: Request): boolean {
  const upgrade = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
  if ((req.method === 'GET' || req.method === 'HEAD') && !upgrade) return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const self = new URL(req.url);
  if (origin === self.origin) return true;
  const local = (h: string) => h === 'localhost' || h === '127.0.0.1';
  try {
    return local(self.hostname) && local(new URL(origin).hostname);
  } catch {
    return false;
  }
}
