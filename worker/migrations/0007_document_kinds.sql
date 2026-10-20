-- Phase 5b: Athena also reads CSV, PowerPoint and images, so documents.kind admits csv, pptx, png and jpg.
-- SQLite cannot widen a CHECK in place, so the table is rebuilt. library_pages points at documents(id) and a parent cannot be dropped while a child row points at it,
-- so library_pages is set aside first and put back, unchanged, afterwards.
CREATE TABLE library_pages_old AS SELECT * FROM library_pages;
DROP TABLE library_pages;
CREATE TABLE documents_new (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('pdf','docx','xlsx','md','txt','csv','pptx','png','jpg')),
  size INTEGER NOT NULL, content_type TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE, project_id TEXT REFERENCES projects(id),
  is_template INTEGER NOT NULL DEFAULT 0, placeholders TEXT NOT NULL DEFAULT '[]', text_indexed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
INSERT INTO documents_new SELECT id, name, kind, size, content_type, r2_key, project_id, is_template, placeholders, text_indexed, created_at, updated_at, deleted_at, enc_v FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE INDEX idx_documents_project ON documents(project_id, deleted_at);
CREATE TABLE library_pages (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, section TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import' CHECK (source = 'import'), import_doc_id TEXT REFERENCES documents(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
INSERT INTO library_pages SELECT id, slug, section, title, body, source, import_doc_id, created_at, updated_at, deleted_at FROM library_pages_old;
DROP TABLE library_pages_old;
