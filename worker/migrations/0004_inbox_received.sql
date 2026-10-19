-- Phase 2: the inbox rate limit counts rows by received_at.
CREATE INDEX idx_inbox_received ON inbox_items(received_at);
