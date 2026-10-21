-- v2.1 (Day-to-day PM): dependencies, checklists, templates, meeting series. Plain ALTERs and CREATEs; no table is rebuilt.
-- SQLite cannot widen a CHECK later, so the lists below are final. This file is never edited after commit.
-- Text columns that are ciphertext when enc_v = 2 (worker/lib/enc.ts): tasks.checklist, templates.name and body, meeting_series.name and answered.

-- A JSON array of task ids (at most 20) this task waits on. NULL = none. Same kind, validated by the server (shared/deps.ts).
ALTER TABLE tasks ADD COLUMN blocked_by TEXT;
-- A JSON array of { id, text, done } (at most 50). NULL = none. Sealed with a work task.
ALTER TABLE tasks ADD COLUMN checklist TEXT;

-- Task and project templates. Built-ins are code (shared/templates.ts) and never stored, so builtin stays 0 here.
CREATE TABLE templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal','work')),
  scope TEXT NOT NULL CHECK (scope IN ('task','project')),
  body TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_templates_scope ON templates(scope, deleted_at);

-- A meeting series: recurring meetings that share a title once dates and numbers are stripped. `key` is that normalised title
-- (for a work series store a hash of it, never the words, since only name and answered are sealed). `answered` is a JSON array of
-- question hashes, sealed for work.
CREATE TABLE meeting_series (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL, project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('personal','work')), answered TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_meeting_series_key ON meeting_series(key, project_id);
CREATE INDEX idx_meeting_series_project ON meeting_series(project_id);

ALTER TABLE meeting_reviews ADD COLUMN series_id TEXT REFERENCES meeting_series(id);
CREATE INDEX idx_meeting_reviews_series ON meeting_reviews(series_id);
