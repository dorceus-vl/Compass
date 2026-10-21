-- v2.3 (iPhone and iPad widgets): the tick token. One row per device; the token itself is never stored, only its SHA-256 (hex).
-- Its scope is one action: mark a live, open task done (POST /api/widget/tasks/:id/done). task_events is not touched (W5: a widget tick is actor 'you', data {"via":"widget"}).
-- This file is never edited after commit.
CREATE TABLE widget_tokens (
  id TEXT PRIMARY KEY, device_name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
);
