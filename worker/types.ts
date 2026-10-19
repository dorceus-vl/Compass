export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  /** Knocturn ID over a service binding (worker/lib/knocturn-id.ts), and its public URL for links. */
  ID: Fetcher;
  ID_URL: string;
  /** Knocturn ID accounts (sub) allowed in, comma-separated; empty = nobody. */
  COMPASS_USERS?: string;
  /** Encrypts work rows at rest and the session's Knocturn ID tokens (worker/lib/enc.ts, session.ts). */
  COMPASS_DATA_KEY: string;
  /** "1" lets POST /api/auth/dev-login create a session on localhost without Knocturn ID (wrangler dev only). */
  DEV_LOGIN?: string;
  /** Per-sender secrets for POST /api/inbox (Kelly, Knocturn ID, Hollow), compared in constant time. */
  INBOX_SECRET_KELLY?: string;
  INBOX_SECRET_ID?: string;
  INBOX_SECRET_HOLLOW?: string;
  /** Web Push VAPID keys, base64url (node scripts/gen-vapid.mjs), and the contact subject (mailto:). */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Sender addresses allowed to forward email into the inbox, comma-separated. */
  ALLOWED_FORWARDERS?: string;
  /** Secret forward-to address (compass-<random>@knocturnlabs.com); only mail sent to it gets in. Unset = all email dropped. */
  EMAIL_INBOX_ADDRESS?: string;
  /** Phase 3 copilot keys (secrets Vlad sets himself); unset = that provider is unavailable. */
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Model ids per provider (wrangler.jsonc vars). */
  AI_MODEL_CLAUDE: string;
  AI_MODEL_GEMINI: string;
  /** JSON {"claude":{"in":usd,"out":usd},"gemini":{...}}: USD per million tokens, for the usage cost. */
  AI_PRICES: string;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
  revoked: number;
  id_tokens_enc: string | null;
  id_checked_at: string | null;
}

export type Variables = { session: SessionRow };
