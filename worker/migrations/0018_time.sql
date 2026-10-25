-- 0018_time.sql (v2.5): time entries on a task or straight on a project; a running timer has no end yet.
CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id), project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('personal','work')),
  started_at TEXT NOT NULL, ended_at TEXT, note TEXT,
  source TEXT NOT NULL CHECK (source IN ('timer','manual','widget')),
  auto_stopped INTEGER NOT NULL DEFAULT 0 CHECK (auto_stopped IN (0,1)),
  enc_v INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK ((task_id IS NULL) != (project_id IS NULL))
);
CREATE INDEX time_sync ON time_entries (updated_at);
CREATE INDEX time_task ON time_entries (task_id);
CREATE INDEX time_project ON time_entries (project_id);
CREATE INDEX time_running ON time_entries (started_at) WHERE ended_at IS NULL AND deleted_at IS NULL;
