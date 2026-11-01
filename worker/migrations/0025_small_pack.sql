-- 0025_small_pack.sql (v2.12): PDU tracker (certs + the PDUs earned toward each) and a task link on documents for clipped screenshots.
-- Plain (not sealed): certification progress is personal. Removed rows get deleted_at and are purged with Trash after 30 days.
CREATE TABLE certs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, cycle_start TEXT NOT NULL, cycle_end TEXT NOT NULL, required REAL NOT NULL CHECK (required > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE pdus (
  id TEXT PRIMARY KEY, cert_id TEXT NOT NULL REFERENCES certs(id), title TEXT NOT NULL, category TEXT NOT NULL, hours REAL NOT NULL CHECK (hours > 0),
  earned_on TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_pdus_cert ON pdus(cert_id, deleted_at);
ALTER TABLE documents ADD COLUMN task_id TEXT REFERENCES tasks(id);
CREATE INDEX idx_documents_task ON documents(task_id);
