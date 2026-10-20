-- Phase 6 Task 3 fix (KN16): an item saved from a meeting review or an email remembers its source, so search and the sweep follow that source's
-- project (Offline only or Trash takes it out, like a document item) and a second save of the same source into a collection returns the first item.
ALTER TABLE knowledge_items ADD COLUMN source_id TEXT; -- meeting_reviews.id (source 'meeting') or inbox_items.id (source 'email'); null otherwise
CREATE INDEX idx_knowledge_items_source ON knowledge_items(collection_id, source_id) WHERE source_id IS NOT NULL;
