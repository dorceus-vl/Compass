-- v2.14 (Aura wall tablet kiosk card): the read-only kiosk token. One row per display; only the SHA-256 (hex) of the token is kept.
-- Its scope is one read: GET /api/kiosk/today (personal tasks due today or overdue; work tasks as a count). This file is never edited after commit.
CREATE TABLE kiosk_tokens (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
);
