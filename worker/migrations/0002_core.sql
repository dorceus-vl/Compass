-- Projects, milestones, tasks, their events, settings and the audit log (spec §3). ISO-8601 strings. Work rows'
-- text columns are ciphertext when enc_v = 2 (worker/lib/enc.ts).
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('personal','work')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','closed')),
  rag TEXT NOT NULL DEFAULT 'none' CHECK (rag IN ('green','amber','red','none')), rag_reason TEXT,
  sponsor TEXT, objectives TEXT, scope_in TEXT, scope_out TEXT, success_criteria TEXT, phase TEXT,
  start_at TEXT, end_at TEXT, budget_planned REAL, budget_spent REAL,
  data_boundary TEXT NOT NULL CHECK (data_boundary IN ('cloud','offline')), colour TEXT, sort REAL NOT NULL DEFAULT 0,
  enc_v INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE milestones (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, due_at TEXT, done_at TEXT,
  gate INTEGER NOT NULL DEFAULT 0, sort REAL NOT NULL DEFAULT 0, enc_v INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_milestones_project ON milestones(project_id);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), parent_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL, notes TEXT, kind TEXT NOT NULL CHECK (kind IN ('personal','work')),
  horizon TEXT NOT NULL DEFAULT 'short' CHECK (horizon IN ('short','medium','long')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','progress','hold','waiting','done')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  start_at TEXT, due_at TEXT, done_at TEXT, estimate_minutes INTEGER, waiting_on TEXT, waiting_since TEXT, nudge_every_days INTEGER,
  recur TEXT, source_app TEXT NOT NULL DEFAULT 'manual', source_kind TEXT, source_ref TEXT, source_url TEXT,
  sort_in_column REAL NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', enc_v INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, deleted_at);
CREATE INDEX idx_tasks_due ON tasks(due_at);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE UNIQUE INDEX idx_tasks_source_ref ON tasks(source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE task_events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('you','rule','kelly','meeting')),
  type TEXT NOT NULL CHECK (type IN ('created','moved','edited','comment','nudged','done')), data TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_task_events_task ON task_events(task_id, at);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);
