import type { InboxApp, InboxKind, MeetingNotes } from '../../shared/types.ts';
import type { Env } from '../types.ts';

export interface InboxPost { app: InboxApp; kind: InboxKind; title: string; body: string | null; url: string | null; ref: string | null; suggest: string | null; payload: unknown }
export const INBOX_APPS: InboxApp[] = ['finance', 'health', 'home', 'nightowl', 'kelly', 'sonarflow', 'hollow', 'email'];
const BY_SECRET: [keyof Env, InboxApp[]][] = [
  ['INBOX_SECRET_KELLY', ['finance', 'health', 'home', 'nightowl', 'kelly']],
  ['INBOX_SECRET_ID', ['sonarflow']],
  ['INBOX_SECRET_HOLLOW', ['hollow']],
];

const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
/** Constant time over the SHA-256 digests, so neither length nor content leaks through timing. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function appsForSecret(env: Env, token: string): Promise<InboxApp[] | null> {
  if (!token) return null;
  for (const [name, apps] of BY_SECRET) {
    const secret = env[name] as string | undefined;
    if (secret && (await safeEqual(secret, token))) return apps;
  }
  return null;
}

/** True when the account's address (or bare domain) is one of the work domains or a subdomain of one. */
export function isWorkAccount(account: unknown, domains: string[]): boolean {
  if (typeof account !== 'string') return false;
  const host = account.slice(account.lastIndexOf('@') + 1).trim().toLowerCase();
  return !!host && domains.some((d) => { const w = d.trim().toLowerCase(); return !!w && (host === w || host.endsWith('.' + w)); });
}

const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const arr = (v: unknown) => Array.isArray(v);

export function parseInboxBody(input: unknown): InboxPost | string {
  if (!input || typeof input !== 'object') return 'body must be a JSON object';
  const b = input as Record<string, unknown>;
  if (!INBOX_APPS.includes(b.app as InboxApp) || b.app === 'email') return 'app is not allowed';
  if (!['notification', 'meeting', 'email'].includes(b.kind as string)) return 'kind must be notification, meeting or email';
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 120) return 'title must be 1-120 characters';
  if (b.body != null && (typeof b.body !== 'string' || b.body.length > 500)) return 'body must be at most 500 characters';
  if (b.url != null && (typeof b.url !== 'string' || b.url.length > 2048 || !isHttps(b.url))) return 'url must be an https URL';
  if (b.ref != null && (typeof b.ref !== 'string' || b.ref.length > 200)) return 'ref must be at most 200 characters';
  if (b.suggest != null && (typeof b.suggest !== 'string' || b.suggest.length > 40)) return 'suggest is invalid';
  if (b.payload != null && JSON.stringify(b.payload).length > 65_536) return 'payload is too large';
  if (b.kind === 'meeting') {
    const p = b.payload as Partial<MeetingNotes> | undefined;
    if (!p || typeof p.title !== 'string' || !arr(p.decisions) || !arr(p.action_items) || !arr(p.important_notes) || !arr(p.open_questions)) return 'meeting payload is incomplete';
    if (!b.ref) return 'meeting needs a ref';
  }
  return { app: b.app as InboxApp, kind: b.kind as InboxKind, title, body: (b.body as string | undefined)?.trim() || null, url: (b.url as string | undefined) ?? null,
    ref: (b.ref as string | undefined) ?? null, suggest: (b.suggest as string | undefined) ?? null, payload: b.payload ?? null };
}
