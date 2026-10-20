export class SignedOut extends Error {}
export class ApiError extends Error {
  status: number; stepUp: boolean; code: string; // spelled out (no parameter properties) so the self-checks can load this file with Node's type stripping
  constructor(status: number, message: string, stepUp = false, code = '') { super(message); this.status = status; this.stepUp = stepUp; this.code = code; }
}

/** One per browser, kept for life (Knocturn ID INTEGRATION.md §2). */
export function deviceId(): string {
  let id = localStorage.getItem('compass.device');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('compass.device', id); }
  return id;
}

export const online = () => navigator.onLine;

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, stepUpAnswer?: string): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  if (stepUpAnswer) headers['X-Step-Up'] = stepUpAnswer;
  const r = await fetch(`/api${path}`, { ...init, headers, body, credentials: 'same-origin' });
  // Login's (and native sign-in's) own 401 is "wrong password", not "session ended": it falls through to ApiError with Knocturn ID's message.
  if (r.status === 401 && path !== '/auth/login' && path !== '/auth/native') throw new SignedOut();
  const data = (await r.json().catch(() => ({}))) as { error?: string; message?: string; step_up?: boolean };
  if (r.status === 403 && data.step_up && !stepUpAnswer) return api<T>(path, init, await passkeyAnswer());
  if (!r.ok) throw new ApiError(r.status, data.message ?? data.error ?? `Request failed (${r.status})`, !!data.step_up, data.error);
  return data as T;
}

/** Touch ID / Face ID through Knocturn ID's step-up; the answer rides in X-Step-Up on the retry. A local dev session answers `dev`. */
async function passkeyAnswer(): Promise<string> {
  const { options, dev } = await api<{ options: unknown; dev?: boolean }>('/step-up/challenge', { method: 'POST' });
  if (dev) return 'dev';
  const cred = (await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON) })) as PublicKeyCredential;
  return JSON.stringify(cred.toJSON());
}

export const login = (body: Record<string, unknown>) => api<{ ok?: boolean; stage?: 'passkey'; options?: unknown }>('/auth/login', { method: 'POST', json: body });
export const logout = () => api('/auth/logout', { method: 'POST' });
