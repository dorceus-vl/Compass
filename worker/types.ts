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
  /** Bearer secret for the agent API (/api/agent/*, Kelly), compared in constant time. Unset = the API answers 401 to everyone. */
  AGENT_SECRET_KELLY?: string;
  /** Kelly-Cloud's relay for Kelly's brief (GET {url}/brief?date=, header X-Relay-Secret). The URL is a var; the secret is one Vlad puts. Either missing = no Kelly brief. */
  KELLY_RELAY_URL?: string;
  KELLY_RELAY_SECRET?: string;
  /** Web Push VAPID keys, base64url (node scripts/gen-vapid.mjs), and the contact subject (mailto:). */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Phase 4 device push. Apple: the .p8 key text and its id (secrets Vlad puts), the team and the app id (vars). Firebase: the service-account JSON (secret). Unset = that kind is skipped as local. */
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APPLE_TEAM_ID: string;
  APNS_TOPIC: string;
  FCM_SERVICE_ACCOUNT?: string;
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
  /** Athena's voice (Phase 5b): the ElevenLabs key (a secret Vlad puts; unset = no voice), the text-to-speech and speech-to-text models,
   *  and their prices as JSON {"tts_per_1k_chars":usd,"stt_per_minute":usd} (vars). */
  ELEVENLABS_API_KEY?: string;
  ATHENA_TTS_MODEL: string;
  ATHENA_STT_MODEL: string;
  ELEVENLABS_PRICES: string;
  /** "1" with DEV_LOGIN=1 answers from a canned stub instead of calling a provider (local tests only). */
  AI_STUB?: string;
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
