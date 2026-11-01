-- 0024_prompts.sql (v2.11): Athena's prompt library, Vlad's own reusable prompts. Plain (not sealed): a prompt is a template, never work content.
-- A removed prompt gets deleted_at and is purged with Trash after 30 days.
CREATE TABLE prompts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_prompts_live ON prompts(deleted_at, title);
