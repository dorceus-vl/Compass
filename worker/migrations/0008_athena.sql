-- Phase 5b: Athena's avatar loops and her still portrait. The files live in R2 (athena/<id>); these rows say what each one is.
-- Not encrypted: they are Vlad's own media, not work content. A removed clip gets deleted_at and is purged with Trash after 30 days.
CREATE TABLE athena_clips (
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('idle','listening','thinking','speaking','portrait')),
  name TEXT NOT NULL, bytes INTEGER NOT NULL, content_type TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_athena_clips_live ON athena_clips(deleted_at, state);
