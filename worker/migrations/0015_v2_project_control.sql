-- v2.2 (Project control): baselines and the stakeholder register. Plain CREATEs; nothing is rebuilt.
-- SQLite cannot widen a CHECK later, so the vocabularies below are final. This file is never edited after commit.
-- Text columns that are ciphertext when enc_v = 2 (worker/lib/enc.ts): baselines.name and snapshot; stakeholders.name, role, channel and notes.
-- Power, interest, attitude and cadence hold no free text, so they stay plain.

-- A baseline freezes the dates of a project's tasks and milestones: a JSON snapshot of ids and dates only, never a title (shared/baseline.ts).
-- task_count and milestone_count are plain numbers so the list never has to open the snapshot.
CREATE TABLE baselines (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, snapshot TEXT NOT NULL,
  task_count INTEGER NOT NULL DEFAULT 0, milestone_count INTEGER NOT NULL DEFAULT 0, taken_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_baselines_project ON baselines(project_id, deleted_at);

-- One row per stakeholder of a project. cadence_days is how often an update is due (NULL = no plan); last_contact_at is the date of the last one sent.
CREATE TABLE stakeholders (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, role TEXT,
  power TEXT NOT NULL DEFAULT 'low' CHECK (power IN ('high','low')),
  interest TEXT NOT NULL DEFAULT 'low' CHECK (interest IN ('high','low')),
  attitude TEXT NOT NULL DEFAULT 'neutral' CHECK (attitude IN ('supportive','neutral','resistant')),
  channel TEXT, cadence_days INTEGER CHECK (cadence_days IS NULL OR cadence_days > 0), last_contact_at TEXT, notes TEXT,
  sort REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stakeholders_project ON stakeholders(project_id, deleted_at);
