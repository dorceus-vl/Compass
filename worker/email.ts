import PostalMime from 'postal-mime';
import type { Env } from './types.ts';
import type { Settings } from '../shared/types.ts';
import type { InboxPost } from './lib/inbox-parse.ts';
import { ingest } from './routes/inbox.ts';
import { getSettings, audit } from './lib/db.ts';

const PREFIX = /^\s*((fwd?|fw|tr)\s*:\s*)+/i; // forwarding prefixes in English and French (TR:)

export const senderAllowed = (from: string, list: string | undefined) =>
  !!from && (list ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(from.trim().toLowerCase());

export function emailToPost(parsed: { subject?: string; text?: string; from?: { address?: string; name?: string } }, settings: Pick<Settings, 'work_email_domains'>) {
  const title = ((parsed.subject ?? '').replace(PREFIX, '').trim() || '(no subject)').slice(0, 120);
  const address = (parsed.from?.address ?? '').toLowerCase();
  const domain = address.split('@')[1] ?? '';
  const work = settings.work_email_domains.some((d) => domain === d || domain.endsWith('.' + d));
  const text = (parsed.text ?? '').trim();
  const post: InboxPost = { app: 'email', kind: 'email', title, body: text.slice(0, 500) || null, url: null, ref: null, suggest: null, payload: { from: address, text: text.slice(0, 20_000) } };
  return { post, work, from: parsed.from?.name || address || null };
}

/** Cloudflare Email Routing → this Worker. Only the addresses in ALLOWED_FORWARDERS get in; anything else is dropped and logged. */
export async function email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
  if (!senderAllowed(message.from, env.ALLOWED_FORWARDERS)) {
    console.warn('[email] dropped: sender not allowed');
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const { post, work, from } = emailToPost(parsed, await getSettings(env));
  const { item, task } = await ingest(env, post, { work, from });
  if (task) await env.FILES.put(`email/${task.id}.eml`, raw, { httpMetadata: { contentType: 'message/rfc822' } });
  await audit(env, 'email', 'inbox.email', item.id, { work });
}
