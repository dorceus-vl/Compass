-- Phase 2 (spec §3, §5, §9). ISO-8601 strings. Text columns of rows whose kind is 'work' are ciphertext when enc_v = 2.
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,                       -- finance, health, home, nightowl, kelly, sonarflow, hollow, email
  kind TEXT NOT NULL CHECK (kind IN ('notification','meeting','email')),
  work INTEGER NOT NULL DEFAULT 0,         -- 1 = work content (encrypted)
  title TEXT NOT NULL, body TEXT, url TEXT, ref TEXT, suggest TEXT,
  payload TEXT,                            -- JSON, encrypted when work
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','added','kept','dismissed','snoozed')),
  rule_id TEXT, task_id TEXT REFERENCES tasks(id),
  snoozed_until TEXT, received_at TEXT NOT NULL, updated_at TEXT NOT NULL, enc_v INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_inbox_state ON inbox_items(state, received_at);
CREATE INDEX idx_inbox_ref ON inbox_items(ref);

CREATE TABLE rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, app TEXT NOT NULL,      -- app '*' = any
  match TEXT NOT NULL DEFAULT '{}',        -- JSON RuleMatch
  then_set TEXT NOT NULL DEFAULT '{}',     -- JSON RuleSet
  mode TEXT NOT NULL CHECK (mode IN ('task','inbox','ignore')),
  dedupe TEXT NOT NULL DEFAULT 'update' CHECK (dedupe IN ('update','skip','always')),
  enabled INTEGER NOT NULL DEFAULT 1, sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE meeting_reviews (
  id TEXT PRIMARY KEY, recording_id TEXT NOT NULL UNIQUE, url TEXT,
  title TEXT NOT NULL, summary TEXT, decisions TEXT, action_items TEXT, open_questions TEXT, important_notes TEXT,
  project_id TEXT REFERENCES projects(id), state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','reviewed')),
  received_at TEXT NOT NULL, reviewed_at TEXT, updated_at TEXT NOT NULL, enc_v INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), text TEXT NOT NULL,
  decided_at TEXT NOT NULL, from_meeting_id TEXT REFERENCES meeting_reviews(id), at_ref TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, enc_v INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  device_name TEXT, created_at TEXT NOT NULL, last_ok_at TEXT, failed_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE push_log (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);   -- one row per push sent; purged after 30 days

-- Seed rules (spec §5.3 with rulings P3/P4). sort orders evaluation; the first enabled match wins.
INSERT INTO rules (id, name, app, match, then_set, mode, dedupe, sort, created_at, updated_at) VALUES
 ('rule-health-doses',   'Ignore per-dose medication reminders', 'health',  '{"suggest":"log_meds"}', '{}', 'ignore', 'skip', 10, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-health-appt',    'Appointment tomorrow → due tomorrow',   'health',  '{"title_regex":"appointment tomorrow"}', '{"horizon":"short","kind":"personal","due_offset_days":1,"priority":2}', 'task', 'update', 15, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-health',         'Health → short personal task',          'health',  '{}', '{"horizon":"short","kind":"personal","due_offset_days":3}', 'task', 'update', 20, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-finance-bills',  'Bills due → task',                      'finance', '{"suggest":"pay_bill"}', '{"horizon":"short","kind":"personal","due_offset_days":2,"priority":2}', 'task', 'update', 30, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-finance-subs',   'Subscription review → task',            'finance', '{"title_regex":"subscription|went up|free trial|listed \\d+ times|services"}', '{"horizon":"short","kind":"personal","due_offset_days":5}', 'task', 'update', 40, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-finance-budget', 'Budget warnings wait in the inbox',     'finance', '{"suggest":"review_budget"}', '{}', 'inbox', 'update', 50, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-hollow',         'Hollow → short personal task',          'hollow',  '{}', '{"horizon":"short","kind":"personal"}', 'task', 'update', 60, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-home',           'Home Assistant → task in a week',       'home',    '{}', '{"horizon":"short","kind":"personal","due_offset_days":7}', 'task', 'update', 70, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-email',          'Email that needs a reply → waiting',    'kelly',   '{"kind":"email"}', '{"horizon":"short","due_offset_days":2,"status":"waiting"}', 'task', 'update', 80, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-forwarded',      'Forwarded email → task',                'email',   '{}', '{"horizon":"short","due_offset_days":3}', 'task', 'always', 90, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z');
