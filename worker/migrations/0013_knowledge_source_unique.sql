-- Phase 6 Task 3 fix: one live item per source per collection, enforced (0012's index was not unique; 0012 is committed, so it is replaced here).
DROP INDEX IF EXISTS idx_knowledge_items_source;
CREATE UNIQUE INDEX idx_knowledge_items_source ON knowledge_items(collection_id, source, source_id) WHERE deleted_at IS NULL AND source_id IS NOT NULL;
