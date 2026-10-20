-- Phase 4 (rulings N2, N3): device push (Apple, Firebase) beside Web Push, and an outbox the Mac app polls.
-- SQLite cannot drop NOT NULL in place, so push_subscriptions is rebuilt; every existing row stays kind 'web', platform 'web'.
-- For devices `endpoint` holds the token; p256dh and auth are null.
CREATE TABLE push_subscriptions_new (
  id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT, auth TEXT,
  device_name TEXT, created_at TEXT NOT NULL, last_ok_at TEXT, failed_count INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'web' CHECK (kind IN ('web','apns','fcm')),
  env TEXT CHECK (env IN ('development','production')),
  platform TEXT CHECK (platform IN ('web','ios','ipados','android','mac'))
);
INSERT INTO push_subscriptions_new (id, endpoint, p256dh, auth, device_name, created_at, last_ok_at, failed_count, kind, env, platform)
  SELECT id, endpoint, p256dh, auth, device_name, created_at, last_ok_at, failed_count, 'web', NULL, 'web' FROM push_subscriptions;
DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- One row per pushed message (not per device), generic text for work; the Mac app reads it every minute. Purged after 7 days.
CREATE TABLE push_outbox (id TEXT PRIMARY KEY, at TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL);
CREATE INDEX idx_push_outbox_at ON push_outbox (at);
