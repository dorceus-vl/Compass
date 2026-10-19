import PostalMime from 'postal-mime';
import type { Env } from './types.ts';
import type { Settings } from '../shared/types.ts';
import { safeEqual, type InboxPost } from './lib/inbox-parse.ts';
import { notifyIngest } from './lib/notify.ts';
import { ingest } from './routes/inbox.ts';
import { getSettings, audit } from './lib/db.ts';
import { sealBytes } from './lib/enc.ts';

const PREFIX = /^\s*((fwd?|fw|tr)\s*:\s*)+/i; // forwarding prefixes in English and French (TR:)

export const senderAllowed = (from: string, list: string | undefined) =>
  !!from && (list ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(from.trim().toLowerCase());

const MAX_RAW = 2 * 1024 * 1024, MAX_PER_HOUR = 30;

/** The envelope recipient must be the secret inbox address (EMAIL_INBOX_ADDRESS); unset means nothing gets in. Constant time, case-insensitive. */
export const recipientOk = async (to: string | undefined, configured: string | undefined) =>
  !!configured?.trim() && !!to?.trim() && safeEqual(to.trim().toLowerCase(), configured.trim().toLowerCase());

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

/**
 * Cloudflare Email Routing → this Worker. Only mail sent to the secret address, from an allowed sender, whose header From matches the envelope
 * sender gets in; anything else is dropped with a reason code (never addresses or content).
 */
export async function email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
  const drop = (reason: string) => console.warn(`[email] dropped: ${reason}`);
  if (!(await recipientOk(message.to, env.EMAIL_INBOX_ADDRESS))) return drop('wrong-recipient');
  if (!senderAllowed(message.from, env.ALLOWED_FORWARDERS)) return drop('sender-not-allowed');
  if (message.rawSize > MAX_RAW) return drop('too-large');
  let item, task;
  try {
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM inbox_items WHERE app = 'email' AND received_at > ?1`).bind(new Date(Date.now() - 3_600_000).toISOString()).first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_PER_HOUR) return drop('rate-limit');
    const raw = await new Response(message.raw).arrayBuffer();
    if (raw.byteLength > MAX_RAW) return drop('too-large');
    const parsed = await PostalMime.parse(raw);
    if ((parsed.from?.address ?? '').trim().toLowerCase() !== message.from.trim().toLowerCase()) return drop('from-mismatch');
    const { post, work, from } = emailToPost(parsed, await getSettings(env));
    const result = await ingest(env, post, { work, from });
    ({ item, task } = result);
    if (task) {
      try { await env.FILES.put(`email/${task.id}.eml`, await sealBytes(env, raw, 'email.eml'), { httpMetadata: { contentType: 'text/plain' } }); }
      catch { console.error('[email] could not keep the raw email'); } // the task stays; only the download is missing
    }
    await audit(env, 'email', 'inbox.email', item.id, { work });
    await notifyIngest(env, result, 'email'); // after the raw email is kept; never throws
  } catch {
    console.error('[email] failed'); // no content in the log
  }
}
