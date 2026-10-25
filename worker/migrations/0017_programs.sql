-- 0017_programs.sql (v2.4): programs group projects of one kind; projects gain a program, a forecast and a currency.
CREATE TABLE programs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('personal','work')), name TEXT NOT NULL,
  rag TEXT NOT NULL DEFAULT 'none' CHECK (rag IN ('green','amber','red','none')), rag_reason TEXT, notes TEXT,
  sort REAL NOT NULL DEFAULT 0, enc_v INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX programs_live ON programs (deleted_at, sort);
ALTER TABLE projects ADD COLUMN program_id TEXT REFERENCES programs(id);
ALTER TABLE projects ADD COLUMN budget_forecast REAL;
ALTER TABLE projects ADD COLUMN currency TEXT NOT NULL DEFAULT 'CAD';
CREATE INDEX projects_program ON projects (program_id);
