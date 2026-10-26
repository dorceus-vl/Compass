-- 0019_goals.sql (v2.6): goals with key results, links to tasks or projects, and check-ins. Children follow their goal's kind (G2: trashed by parent).
CREATE TABLE goals (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('personal','work')),
  title TEXT NOT NULL, description TEXT, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','missed','dropped')),
  sort REAL NOT NULL DEFAULT 0, enc_v INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK (starts_on <= ends_on)
);
CREATE TABLE key_results (
  id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('number','tasks','done','percent')),
  start_value REAL, target_value REAL, current_value REAL, unit TEXT,
  sort REAL NOT NULL DEFAULT 0, enc_v INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK (start_value IS NULL OR target_value IS NULL OR start_value != target_value)
);
CREATE TABLE goal_links (
  id TEXT PRIMARY KEY, kr_id TEXT NOT NULL REFERENCES key_results(id),
  task_id TEXT REFERENCES tasks(id), project_id TEXT REFERENCES projects(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK ((task_id IS NULL) != (project_id IS NULL))
);
CREATE TABLE goal_checkins (
  id TEXT PRIMARY KEY, kr_id TEXT NOT NULL REFERENCES key_results(id), value REAL,
  confidence TEXT NOT NULL CHECK (confidence IN ('on_track','at_risk','off_track')),
  note TEXT, at TEXT NOT NULL, enc_v INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX goals_sync ON goals (updated_at);
CREATE INDEX krs_sync ON key_results (updated_at);
CREATE INDEX krs_goal ON key_results (goal_id);
CREATE INDEX links_sync ON goal_links (updated_at);
CREATE INDEX links_kr ON goal_links (kr_id);
CREATE INDEX links_task ON goal_links (task_id);
CREATE INDEX links_project ON goal_links (project_id);
CREATE UNIQUE INDEX links_kr_task ON goal_links (kr_id, task_id) WHERE deleted_at IS NULL AND task_id IS NOT NULL;
CREATE UNIQUE INDEX links_kr_project ON goal_links (kr_id, project_id) WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX checkins_sync ON goal_checkins (updated_at);
CREATE INDEX checkins_kr ON goal_checkins (kr_id, at);
