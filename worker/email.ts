import PostalMime from 'postal-mime';
import type { Env } from './types.ts';
import type { Settings } from '../shared/types.ts';
import type { InboxPost } from './lib/inbox-parse.ts';
import { ingest } from './routes/inbox.ts';
import { getSettings, audit } from './lib/db.ts';
import { sealBytes } from './lib/enc.ts';

const PREFIX = /^\s*((fwd?|fw|tr)\s*:\s*)+/i; // forwarding prefixes in English and French (TR:)

export const senderAllowed = (from: string, list: string | undefined) =>
  !!from && (list ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(from.trim().toLowerCase());

const MAX_RAW = 2 * 1024 * 1024, MAX_PER_HOUR = 30;
const domainOf = (a: string) => a.trim().toLowerCase().split('@')[1] ?? '';
const kv = (seg: string) => Object.fromEntries([...seg.replace(/\([^)]*\)/g, ' ').matchAll(/([\w.-]+)=("[^"]*"|\S+)/g)].map((m) => [m[1].toLowerCase(), m[2].replace(/^"|"$/g, '').toLowerCase()]));

/**
 * True when Cloudflare's Authentication-Results vouches for the sender: dmarc=pass, or dkim=pass signed by the sender's domain (or a parent of it),
 * or spf=pass for the envelope sender's domain. The header From must also equal the envelope sender. Only the topmost header counts (the one our edge added).
 */
export function authenticated(headerValue: string | null | undefined, envelopeFrom: string, headerFrom: string | undefined): boolean {
  const env = envelopeFrom.trim().toLowerCase(), dom = domainOf(env);
  if (!env || !dom || (headerFrom ?? '').trim().toLowerCase() !== env || !headerValue) return false;
  const top = headerValue.split(/,\s*(?=[\w.-]+\s*;)/)[0]; // headers.get() joins repeated headers with ", "
  return top.split(';').slice(1).some((seg) => {
    const f = kv(seg);
    if (f.dmarc === 'pass') return true;
    if (f.dkim === 'pass' && f['header.d']) return dom === f['header.d'] || dom.endsWith('.' + f['header.d']);
    if (f.spf === 'pass' && f['smtp.mailfrom']) return domainOf(f['smtp.mailfrom'].includes('@') ? f['smtp.mailfrom'] : '@' + f['smtp.mailfrom']) === dom;
    return false;
  });
}

const htmlToText = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');

export function emailToPost(parsed: { subject?: string; text?: string; html?: string; messageId?: string; from?: { address?: string; name?: string } }, settings: Pick<Settings, 'work_email_domains'>) {
  const title = ((parsed.subject ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').replace(PREFIX, '').trim() || '(no subject)').slice(0, 120);
  const address = (parsed.from?.address ?? '').toLowerCase();
  const domain = address.split('@')[1] ?? '';
  const work = settings.work_email_domains.some((d) => domain === d.toLowerCase() || domain.endsWith('.' + d.toLowerCase()));
  const text = (parsed.text || (parsed.html ? htmlToText(parsed.html) : '')).trim();
  const id = (parsed.messageId ?? '').trim();
  const post: InboxPost = { app: 'email', kind: 'email', title, body: text.slice(0, 500) || null, url: null, ref: id ? ('email:' + id).slice(0, 200) : null, suggest: null, payload: { from: address, text: text.slice(0, 20_000) } };
  return { post, work, from: parsed.from?.name || address || null };
}

/** Cloudflare Email Routing → this Worker. Only an allowed sender whose mail is authenticated gets in; anything else is dropped with a reason code (never addresses or content). */
export async function email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
  const drop = (reason: string) => console.warn(`[email] dropped: ${reason}`);
  if (!senderAllowed(message.from, env.ALLOWED_FORWARDERS)) return drop('sender-not-allowed');
  if (message.rawSize > MAX_RAW) return drop('too-large');
  let item, task;
  try {
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM inbox_items WHERE app = 'email' AND received_at > ?1`).bind(new Date(Date.now() - 3_600_000).toISOString()).first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_PER_HOUR) return drop('rate-limit');
    const raw = await new Response(message.raw).arrayBuffer();
    if (raw.byteLength > MAX_RAW) return drop('too-large');
    const parsed = await PostalMime.parse(raw);
    if (!authenticated(message.headers.get('authentication-results'), message.from, parsed.from?.address)) return drop('not-authenticated');
    const { post, work, from } = emailToPost(parsed, await getSettings(env));
    ({ item, task } = await ingest(env, post, { work, from }));
    if (task) {
      try { await env.FILES.put(`email/${task.id}.eml`, await sealBytes(env, raw, 'email.eml'), { httpMetadata: { contentType: 'text/plain' } }); }
      catch { console.error('[email] could not keep the raw email'); } // the task stays; only the download is missing
    }
    await audit(env, 'email', 'inbox.email', item.id, { work });
  } catch {
    console.error('[email] failed'); // no content in the log
  }
}
