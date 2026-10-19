-- Phase 3: governance logs, documents, library imports, copilot, AI usage (spec §3, §7). Text columns are
-- ciphertext when enc_v = 2 (worker/lib/enc.ts); a row's kind is its project's kind.
CREATE TABLE raid_items (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL CHECK (type IN ('risk','assumption','issue','dependency')), text TEXT NOT NULL,
  probability INTEGER CHECK (probability BETWEEN 1 AND 5), impact INTEGER CHECK (impact BETWEEN 1 AND 5),
  response TEXT, owner TEXT, trigger TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), due_at TEXT,
  from_meeting_id TEXT REFERENCES meeting_reviews(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_raid_project ON raid_items(project_id, deleted_at);
CREATE TABLE change_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, description TEXT,
  impact_scope TEXT, impact_time TEXT, impact_cost TEXT,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','rejected')), approver TEXT, decided_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_changes_project ON change_requests(project_id, deleted_at);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), text TEXT NOT NULL, category TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lessons_project ON lessons(project_id, deleted_at);
CREATE INDEX idx_decisions_project ON decisions(project_id, deleted_at);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('pdf','docx','xlsx','md','txt')),
  size INTEGER NOT NULL, content_type TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE, project_id TEXT REFERENCES projects(id),
  is_template INTEGER NOT NULL DEFAULT 0, placeholders TEXT NOT NULL DEFAULT '[]', text_indexed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_documents_project ON documents(project_id, deleted_at);
-- Imports only; bundled pages live in worker/library and are never rows (Phase 3 ruling R1). Imports are personal (R8): never sealed.
CREATE TABLE library_pages (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, section TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import' CHECK (source = 'import'), import_doc_id TEXT REFERENCES documents(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE ai_threads (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('claude','gemini')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_threads_project ON ai_threads(project_id, deleted_at);
CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES ai_threads(id), role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  provider TEXT CHECK (provider IN ('claude','gemini')), content TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '[]', proposals TEXT,
  cost_micro INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_messages_thread ON ai_messages(thread_id, created_at);
-- One row per model call, any feature: the monthly cap and the hourly rate limit count these. No content.
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, feature TEXT NOT NULL CHECK (feature IN ('copilot','status_report','plan_review','brief')),
  provider TEXT NOT NULL CHECK (provider IN ('claude','gemini')), input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cost_micro INTEGER NOT NULL
);
CREATE INDEX idx_ai_usage_at ON ai_usage(at);
