// Pure rules for the widget tick token (v2.3, W5/W6). No Worker imports, so scripts/widget.test.ts runs them directly.
export const MAX_PER_MINUTE = 60;
export const MAX_PER_DAY = 300;
export const MAX_ACTIVE_TOKENS = 10;

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** 256 random bits as base64url (43 characters: letters, digits, - and _). */
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
/** What the server keeps: SHA-256 as 64 hex characters. */
export async function hashToken(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}
/** Constant time over two equal-length hex hashes (no early exit). */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** The row whose hash matches, checking every row so the time doesn't say which one (or whether any) matched. */
export function findToken<T extends { token_hash: string; revoked_at: string | null }>(rows: T[], hash: string): T | null {
  let found: T | null = null;
  for (const r of rows) if (sameHash(r.token_hash, hash) && !r.revoked_at) found = r;
  return found;
}
/** Counts are the calls already made, this one not included: the 60th call in a minute passes, the 61st does not. */
export const overLimit = (lastMinute: number, lastDay: number): boolean => lastMinute >= MAX_PER_MINUTE || lastDay >= MAX_PER_DAY;
/** The device's name as shown in Settings: trimmed, 1 to 60 characters; anything else is the default. */
export const deviceName = (v: unknown): string => (typeof v === 'string' && v.trim() && v.trim().length <= 60 ? v.trim() : 'iPhone or iPad');
/** The widget's timer action (v2.5 Task 4, T8): exactly 'start' or 'stop' in the body; anything else is null (400). */
export const timerAction = (body: unknown): 'start' | 'stop' | null => {
  const a = body && typeof body === 'object' ? (body as { action?: unknown }).action : undefined;
  return a === 'start' || a === 'stop' ? a : null;
};
