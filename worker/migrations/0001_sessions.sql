-- Compass's own sessions on top of a Knocturn ID sign-in (worker/lib/session.ts). ISO-8601 strings.
CREATE TABLE auth_sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  user_agent    TEXT,
  ip            TEXT,
  revoked       INTEGER NOT NULL DEFAULT 0,
  id_tokens_enc TEXT,
  id_checked_at TEXT
);
