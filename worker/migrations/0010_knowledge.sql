-- Phase 6: Knowledge (spec docs/superpowers/specs/2026-10-20-knowledge-design.md). Text columns are ciphertext when enc_v = 2 (worker/lib/enc.ts):
-- a work collection's name, its items' titles and its passages' text and locator. SQLite cannot widen a CHECK later, so the lists below are final.
CREATE TABLE knowledge_collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('work','personal')),
  boundary TEXT NOT NULL DEFAULT 'cloud' CHECK (boundary IN ('cloud','locked')),
  system INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0,1)), -- 1 = "From my apps"
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0,
  CHECK (scope = 'work' OR boundary = 'cloud') -- a personal collection is always Cloud AI
);
CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES knowledge_collections(id), document_id TEXT REFERENCES documents(id),
  source TEXT NOT NULL CHECK (source IN ('upload','meeting','email','athena','app:compass','app:finance','app:health','app:home','app:hollow')),
  title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'indexing' CHECK (state IN ('indexing','ready','failed')), error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);
-- embedded = 0 means "not in the vector index". A Locked collection's passages stay 0 for good: the embedder must join the collection's boundary.
CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES knowledge_items(id), collection_id TEXT NOT NULL REFERENCES knowledge_collections(id),
  ord INTEGER NOT NULL, locator TEXT NOT NULL, text TEXT NOT NULL, embedded INTEGER NOT NULL DEFAULT 0 CHECK (embedded IN (0,1)),
  created_at TEXT NOT NULL, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_knowledge_items_collection ON knowledge_items(collection_id, deleted_at);
CREATE INDEX idx_knowledge_items_document ON knowledge_items(document_id);
CREATE INDEX idx_knowledge_chunks_item ON knowledge_chunks(item_id);
CREATE INDEX idx_knowledge_chunks_collection ON knowledge_chunks(collection_id);
CREATE INDEX idx_knowledge_chunks_pending ON knowledge_chunks(embedded) WHERE embedded = 0;
ALTER TABLE ai_threads ADD COLUMN kind TEXT CHECK (kind IN ('personal','work')); -- null = derived from the project (KN2); read from Task 3
