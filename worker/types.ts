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
