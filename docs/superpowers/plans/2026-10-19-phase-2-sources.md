# Compass Phase 2 (Sources) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks that create themselves. Finance, Health, Home Assistant, Hollow, SonarFlow meetings and email feed a Compass inbox; rules turn items into tasks with deep links; push notifications deliver digests, overdue notices, waiting-on nudges and "meeting notes ready"; a weekly review screen closes the loop.

**Architecture:** Compass gets one secret-authenticated `POST /api/inbox` (spec §5.1) and a pure rules engine. Three senders post to it: Kelly-Cloud (forwarding its notification bus, plus emails that need a reply), Knocturn ID (meeting notes), and Hollow (files waiting in its Inbox folder). Forwarded emails arrive through Cloudflare Email Routing at the Worker's `email()` handler. Pushes are Web Push with VAPID, using a dependency-free RFC 8291 sender copied from Hollow. A pure "what is due now" function drives the 15-minute cron.

**Tech Stack:** As Phase 1, plus `postal-mime` (MIME parsing in the email handler). Outside repos keep their own stacks: Kelly-Cloud and Knocturn-ID (Hono Workers, `tsx` verify scripts / `node --test`), Hollow (Hono Worker, `node --test`), Health and Finance (Hono Workers).

**Spec:** `docs/superpowers/specs/2026-10-19-compass-design.md` (§3 tables inbox_items, rules, meeting_reviews, push_subscriptions; §4 inbox, rules, meetings, push routes; §5 all; §6 Inbox, Today strip, Weekly review, Settings; §9 push and cron; §12; §13 step 2; §14). Catalogue: `docs/compass-features.md` §2, §6, §11.

## Who does what

Claude Code does everything except the items below. Each one either needs your account, or deploys outside Compass, or changes another app's behaviour, so it waits for your word:

| # | Only Vlad | When | How long |
| --- | --- | --- | --- |
| 1 | Approve each outside-repo change before it is deployed: Kelly-Cloud, Knocturn-ID, Hollow, Health, Finance (Tasks 12–16). One message can approve several. | After each task's review | 1 min each |
| 2 | Say "deploy Compass" (Task 11) | After Tasks 0–10 | 1 min |
| 3 | Create the Email Routing rule `compass@knocturnlabs.com → Worker compass` in the Cloudflare dashboard, unless Claude Code can do it through the API (Task 17 tries first and tells you which) | Task 17 | 2 min |
| 4 | Turn on notifications in Compass on the Mac and the phone (the browser asks you) | Task 17 | 1 min |
| 5 | Forward one email from your Bell address to `compass@knocturnlabs.com` to prove the path | Task 17 | 1 min |
| 6 | Tell Claude Code the addresses you'll forward from (your Bell address and any personal ones); only those are let in | Task 11 | 1 min |

## What the outside repos actually do today (verified 2026-10-19)

These facts change spec §5.2–§5.5; the rulings in the next section follow from them.

| Fact | Where |
| --- | --- |
| Kelly-Cloud's bus accepts only `finance, health, sonarflow, nightowl, home` (`NOTIFY_APPS`); `hollow` and `aura` are not accepted although the D1 CHECK allows them | `Kelly-Cloud/src/routes/notifications.ts:19` |
| The bus has no item key; a notification carries `title, body, url, priority, suggest` | same file, `parseNotification` |
| Health's low-refill alert goes to Telegram and Health's own log only, not to Kelly | `Health-Dashboard/src/lib/refill-alerts.ts:44-48` |
| Health posts "Medication time" (every dose, `log_meds`) and "Appointment tomorrow" (`open_app`) to Kelly | `medication-reminders.ts:106`, `preventive-care-alerts.ts:49` |
| Finance posts bills due (`pay_bill`, link `/bills.html` for every bill) and budget warnings (`review_budget`) to Kelly; the subscription watchdog (price went up, trial ends, duplicates) only notifies inside Finance | `notification-sweep.ts:115,147`, `subscription-watchdog.ts:122-128` |
| Kelly's email triage (`getTriage`) runs only on demand with a cache; nothing runs it on a schedule | `Kelly-Cloud/src/lib/inbox.ts:180` |
| Knocturn ID saves meeting notes in `analyze()`'s `done()`; the JSON has title, summary, decisions, action_items, important_notes, open_questions; the web page for a meeting is `https://sonarflow.knocturnlabs.com/meetings/<id>` | `Knocturn-ID/src/transcription.ts:399-403`, `SonarFlow-Web/src/App.tsx:41` |
| Hollow's standing rule 4: "Hollow never depends on Kelly". It already has a dependency-free RFC 8291 Web Push sender | `Hollow/README.md`, `Hollow/web/src/notify.ts` |
| Health and Finance are checked out on `feature/one-stop` (0 commits ahead of `main`); Health has one uncommitted file | git state |

## Global Constraints

- Everything from the Phase 1 plan's Global Constraints still holds (domain, ids, tokens, ISO timestamps, no hard delete, work-row encryption, `COMPASS_USERS`, same-origin, self-checks, typecheck before every commit).
- Dependencies: Phase 1's list plus `postal-mime` (Worker only). Nothing else; Web Push is hand-written (copied from Hollow).
- Inbox secrets, one per sender, compared in constant time: `INBOX_SECRET_KELLY` (may post apps `finance, health, home, nightowl, kelly`), `INBOX_SECRET_ID` (`sonarflow`), `INBOX_SECRET_HOLLOW` (`hollow`). A secret may only post its own apps. Rejections are logged without the secret.
- Inbox limits (spec §5.1): `title` 1–120 chars after trim, `body` ≤ 500, `url` must be `https:` (≤ 2048), `ref` ≤ 200, `payload` ≤ 64 KB of JSON. Only `POST /api/inbox` is exempt from the session guard (and from the same-origin check, since a server sends it).
- Notification, email and transcript text is data. It is never placed into a model prompt in Phase 2 and never rendered as HTML (plain text only in the UI).
- Health medication names never cross the bus (Health encrypts them; Kelly and Compass would store them in plain text).
- Pushes respect quiet hours and per-type switches from settings; each push type is sent at most once per key (a `push_log` table).
- Outside repos: never commit on a branch someone else is using without saying so; each outside task works on a new branch named `compass-phase-2` cut from that repo's current `HEAD`, runs that repo's own checks, and is deployed only after Vlad approves (Who does what #1). Never touch the outside repos' unrelated uncommitted files.
- Commit trailer: the implementer's own model attribution line.

## Rulings made while writing this plan

- **P1 Hollow posts to Compass directly** with `INBOX_SECRET_HOLLOW`, not through Kelly's bus (spec §5.2 said Kelly's bus). Hollow's rule 4 forbids depending on Kelly, and Kelly's bus rejects `hollow` today. Cost if wrong: one extra secret.
- **P2 Health and Finance each get a small change** (spec said none): Health's refill alert also posts to Kelly's bus with a name-free title; Finance's subscription watchdog also posts to Kelly's bus; both make each item's link unique with a `#fragment` (`/medications.html#med-42`, `/subscriptions.html#watch-<key>`, `/bills.html#cycle-<id>`), which gives Compass a per-item dedupe key and a better deep link without changing Kelly's bus format. Cost if wrong: one more deploy each.
- **P3 Compass dedupe key** for forwarded notifications is `kelly:<app>:<url>` when the notification has a url, else `kelly:<app>:<kelly notification id>` (a notification without a url never dedupes; acceptable for one-off alerts).
- **P4 Rules have a mode**: `task` (create or update a task), `inbox` (wait in the strip for keep/dismiss), `ignore` (stored as dismissed, never shown). Seeded rules ignore Health's per-dose "Medication time" and keep Finance budget warnings in the inbox; everything else follows spec §5.3.
- **P5 Email triage runs on a schedule in Kelly-Cloud** hourly between 07:00 and 21:00 (America/Toronto), reusing `getTriage`'s cache, and forwards each "needs reply" message once (Compass dedupes by `email:<provider>:<message id>`). Cost: about 15 small model calls a day, inside Kelly's existing monthly AI budget.
- **P6 Forwarded emails**: the raw `.eml` is kept in R2 at `email/<task id>.eml` and served by `GET /api/tasks/:id/email` (session-gated); the text body goes into the task's notes (encrypted when the sender is a Bell address, which makes the task `work`). The `documents` table is Phase 3.
- **P7 Inbox and meeting reviews are online-only** in Phase 2: their lists are cached in IndexedDB `meta` for offline reading, and keep/dismiss/accept need a connection (they create tasks on the server). Rules and push settings live in settings.
- **P8 Meeting reviews** accept action items as tasks and decisions into a new `decisions` table (spec §3); open questions become optional follow-up tasks. RAID entries from meetings wait for Phase 3's RAID log.
- **P9 Push is Web Push only** in Phase 2 (site, installed PWA on iPhone/iPad/Mac/Android). APNs for the native shells is Phase 4 with the shells.

## File map

| Path | Responsibility |
| --- | --- |
| `worker/migrations/0003_sources.sql` | inbox_items, rules (+ seed), meeting_reviews, decisions, push_subscriptions, push_log |
| `shared/types.ts` | InboxItem, Rule, RuleSet, MeetingReview, MeetingNotes, PushType; Settings gains push, work_email_domains, last_review_at |
| `worker/lib/rules.ts` | Pure: match an inbox item against rules, return the action |
| `worker/lib/inbox-parse.ts` | Pure: validate an inbox POST body and the per-secret app list |
| `worker/lib/schedule.ts` | Pure: which pushes are due now (digest, overdue, nudges, milestones, weekly review), quiet hours |
| `worker/lib/webpush.ts` | RFC 8291 + VAPID sender (copied from Hollow's notify.ts) and `pushAll(env, message)` |
| `worker/routes/inbox.ts` | `POST /api/inbox` (secret) and the session routes for the inbox and rules |
| `worker/routes/meetings.ts` | Meeting review list, detail, accept |
| `worker/routes/push.ts` | VAPID key, subscribe, unsubscribe, test push |
| `worker/email.ts` | The `email()` handler |
| `worker/cron.ts` | The 15-minute job: purges (moved from index.ts) + due pushes |
| `web/src/views/Inbox.tsx`, `Meetings.tsx`, `Meeting.tsx`, `Review.tsx` | Screens |
| `web/src/ui/AddedStrip.tsx` | Today's "Added by your apps" strip |
| `web/src/views/Settings.tsx` | + Notifications, Sources and rules, Email |
| `web/public/sw.js` | + `push` and `notificationclick` handlers |
| `scripts/rules.test.ts`, `inbox-parse.test.ts`, `schedule.test.ts`, `webpush.test.ts` | Self-checks |
| `scripts/gen-vapid.mjs`, `scripts/setup-phase2.sh` | Secrets and VAPID keys, idempotent |
| `docs/integration.md` | The inbox contract for senders (spec §5.1) |

---

### Task 0: Schema, types, settings, dependency

**Files:**
- Create: `worker/migrations/0003_sources.sql`, `scripts/gen-vapid.mjs`
- Modify: `shared/types.ts`, `worker/types.ts`, `worker/routes/settings.ts`, `package.json`, `.dev.vars.example`, `worker/lib/enc.ts`

**Interfaces:**
- Produces: tables below; types `InboxItem`, `Rule`, `RuleMatch`, `RuleSet`, `RuleMode`, `MeetingNotes`, `MeetingReview`, `Decision`, `PushType`; `Settings.push: Record<PushType, boolean>`, `Settings.work_email_domains: string[]`, `Settings.last_review_at: string | null`; `Env` gains `INBOX_SECRET_KELLY?`, `INBOX_SECRET_ID?`, `INBOX_SECRET_HOLLOW?`, `VAPID_PUBLIC_KEY?`, `VAPID_PRIVATE_KEY?`, `VAPID_SUBJECT?`, `ALLOWED_FORWARDERS?`; `ENC_COLS` gains `inbox_items: ['title','body','payload']`, `meeting_reviews: ['title','summary','decisions','action_items','open_questions','important_notes']`, `decisions: ['text']`.

- [ ] **Step 1: Migration `worker/migrations/0003_sources.sql`**

```sql
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
 ('rule-finance-subs',   'Subscription review → task',            'finance', '{"title_regex":"subscription|went up|free trial|listed \\\\d+ times|services"}', '{"horizon":"short","kind":"personal","due_offset_days":5}', 'task', 'update', 40, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-finance-budget', 'Budget warnings wait in the inbox',     'finance', '{"suggest":"review_budget"}', '{}', 'inbox', 'update', 50, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-hollow',         'Hollow → short personal task',          'hollow',  '{}', '{"horizon":"short","kind":"personal"}', 'task', 'update', 60, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-home',           'Home Assistant → task in a week',       'home',    '{}', '{"horizon":"short","kind":"personal","due_offset_days":7}', 'task', 'update', 70, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-email',          'Email that needs a reply → waiting',    'kelly',   '{"kind":"email"}', '{"horizon":"short","due_offset_days":2,"status":"waiting"}', 'task', 'update', 80, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
 ('rule-forwarded',      'Forwarded email → task',                'email',   '{}', '{"horizon":"short","due_offset_days":3}', 'task', 'always', 90, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z');
```
(Meetings never go through rules: they become a meeting review, Task 3.) Check: `cat worker/migrations/000*.sql | sqlite3 :memory:` prints nothing.

- [ ] **Step 2: `shared/types.ts` additions**

```ts
export type InboxApp = 'finance' | 'health' | 'home' | 'nightowl' | 'kelly' | 'sonarflow' | 'hollow' | 'email';
export type InboxKind = 'notification' | 'meeting' | 'email';
export interface InboxItem {
  id: string; app: InboxApp; kind: InboxKind; work: number; title: string; body: string | null; url: string | null; ref: string | null;
  suggest: string | null; payload: string | null; state: 'new' | 'added' | 'kept' | 'dismissed' | 'snoozed'; rule_id: string | null;
  task_id: string | null; snoozed_until: string | null; received_at: string; updated_at: string; enc_v: number;
}
export type RuleMode = 'task' | 'inbox' | 'ignore';
export interface RuleMatch { suggest?: string; kind?: InboxKind; title_regex?: string }
export interface RuleSet { horizon?: Horizon; kind?: Kind; project_id?: string; due_offset_days?: number; priority?: number; status?: Status }
export interface Rule { id: string; name: string; app: InboxApp | '*'; match: RuleMatch; then_set: RuleSet; mode: RuleMode; dedupe: 'update' | 'skip' | 'always'; enabled: number; sort: number }
export interface MeetingActionItem { text: string; owner: string | null; due: string | null; at: string }
export interface MeetingNotes { title: string; summary: string; decisions: { text: string; at: string }[]; action_items: MeetingActionItem[]; important_notes: { text: string; at: string }[]; open_questions: { text: string; at: string }[] }
export interface MeetingReview {
  id: string; recording_id: string; url: string | null; title: string; summary: string | null; decisions: MeetingNotes['decisions'];
  action_items: MeetingActionItem[]; open_questions: MeetingNotes['open_questions']; important_notes: MeetingNotes['important_notes'];
  project_id: string | null; state: 'new' | 'reviewed'; received_at: string; reviewed_at: string | null;
}
export interface Decision { id: string; project_id: string | null; text: string; decided_at: string; from_meeting_id: string | null; at_ref: string | null }
export type PushType = 'digest' | 'overdue' | 'nudge' | 'milestone' | 'weekly_review' | 'app_task' | 'meeting';
```
`Settings` gains `push: Record<PushType, boolean>`, `work_email_domains: string[]`, `last_review_at: string | null`; `DEFAULT_SETTINGS` gains `push: { digest: true, overdue: true, nudge: true, milestone: true, weekly_review: true, app_task: true, meeting: true }`, `work_email_domains: ['bell.ca']`, `last_review_at: null`.

- [ ] **Step 3: Settings PATCH accepts the new keys** (`worker/routes/settings.ts`): `push` merges per type (booleans only, unknown types ignored, like `wip_limits`); `work_email_domains` is an array of ≤ 10 lowercase domain strings matching `/^[a-z0-9.-]+\.[a-z]{2,}$/`; `last_review_at` is a dateTime. Send-only-changed-keys rule unchanged.

- [ ] **Step 4: `Env`, enc columns, dependency, VAPID generator**

`worker/types.ts` adds the seven optional strings in Interfaces with one-line comments. `worker/lib/enc.ts` `ENC_COLS` adds the three tables from Interfaces. `npm install postal-mime` (add to dependencies). `.dev.vars.example` adds `INBOX_SECRET_KELLY=`, `INBOX_SECRET_ID=`, `INBOX_SECRET_HOLLOW=`, `VAPID_PUBLIC_KEY=`, `VAPID_PRIVATE_KEY=`, `VAPID_SUBJECT=mailto:vladimir.bigvlad@gmail.com`, `ALLOWED_FORWARDERS=` with a comment that `node scripts/gen-vapid.mjs` prints the two VAPID values.

`scripts/gen-vapid.mjs`:
```js
// node scripts/gen-vapid.mjs -> VAPID_PUBLIC_KEY (uncompressed P-256 point, base64url) and VAPID_PRIVATE_KEY (d, base64url).
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64u = (b) => Buffer.from(b).toString('base64url');
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}\nVAPID_PRIVATE_KEY=${jwk.d}`);
```

- [ ] **Step 5: Check and commit**

Run: `npm run typecheck && npm run check && npm run db:migrate:local`
```bash
git add -A && git commit -m "Phase 2 Task 0: sources schema, types, settings, postal-mime, VAPID generator"
```

---

### Task 1: Rules engine (pure)

**Files:**
- Create: `worker/lib/rules.ts`, `scripts/rules.test.ts`

**Interfaces:**
- Consumes: `Rule`, `RuleMatch`, `RuleSet`, `InboxApp`, `InboxKind`.
- Produces: `parseRule(row)` (D1 row → `Rule`, JSON columns parsed, bad JSON → match nothing); `matchRule(rules: Rule[], item: { app, kind, suggest, title }): Rule | null` (first enabled rule by `sort` whose app is the item's app or `'*'` and whose match fields all hold; `title_regex` is case-insensitive, and an invalid regex never matches); `taskFromRule(rule, item, today: string, workDefault: boolean): Partial<Task>` (horizon, kind, project_id, priority, status, due_at = today + due_offset_days when set; `kind` from the rule, else `work` when `workDefault`, else `personal`; `waiting_on` = the email sender for `kind: 'email'` items when status is waiting).

- [ ] **Step 1: Failing test `scripts/rules.test.ts`**

```ts
// node --experimental-strip-types scripts/rules.test.ts
import assert from 'node:assert/strict';
import { matchRule, taskFromRule, parseRule } from '../worker/lib/rules.ts';

const r = (o: Record<string, unknown>) => parseRule({ id: String(o.id), name: 'x', app: o.app ?? '*', match: JSON.stringify(o.match ?? {}), then_set: JSON.stringify(o.then_set ?? {}), mode: o.mode ?? 'task', dedupe: 'update', enabled: o.enabled ?? 1, sort: o.sort ?? 0 });
const rules = [
  r({ id: 'doses', app: 'health', match: { suggest: 'log_meds' }, mode: 'ignore', sort: 10 }),
  r({ id: 'health', app: 'health', then_set: { horizon: 'short', due_offset_days: 3 }, sort: 20 }),
  r({ id: 'subs', app: 'finance', match: { title_regex: 'subscription|went up' }, then_set: { due_offset_days: 5 }, sort: 40 }),
  r({ id: 'off', app: 'finance', enabled: 0, sort: 1 }),
  r({ id: 'bad', app: 'home', match: { title_regex: '([' }, sort: 5 }),
  r({ id: 'home', app: 'home', then_set: { due_offset_days: 7 }, sort: 70 }),
  r({ id: 'mail', app: 'kelly', match: { kind: 'email' }, then_set: { status: 'waiting', due_offset_days: 2 }, sort: 80 }),
];
const it = (o: Record<string, unknown>) => ({ app: 'health', kind: 'notification', suggest: null, title: 't', ...o }) as never;
assert.equal(matchRule(rules, it({ suggest: 'log_meds' }))?.id, 'doses', 'more specific rule sorted first wins');
assert.equal(matchRule(rules, it({ suggest: 'open_app' }))?.id, 'health');
assert.equal(matchRule(rules, it({ app: 'finance', title: 'Netflix went up' }))?.id, 'subs', 'disabled rule skipped');
assert.equal(matchRule(rules, it({ app: 'finance', title: 'Hydro is due soon' })), null, 'no match → null');
assert.equal(matchRule(rules, it({ app: 'home', title: 'x' }))?.id, 'home', 'invalid regex never matches');
assert.equal(matchRule(rules, it({ app: 'kelly', kind: 'email' }))?.id, 'mail');
assert.equal(matchRule(rules, it({ app: 'kelly', kind: 'notification' })), null);
assert.deepEqual(parseRule({ id: 'j', name: 'n', app: 'x', match: '{not json', then_set: '{}', mode: 'task', dedupe: 'update', enabled: 1, sort: 0 }).match, { title_regex: '(?!)' }, 'bad JSON matches nothing');

const t = taskFromRule(rules[1], { app: 'health', kind: 'notification', title: 'Refill medication', from: null }, '2026-10-19', false);
assert.equal(t.due_at, '2026-10-22');
assert.equal(t.kind, 'personal');
assert.equal(t.horizon, 'short');
const m = taskFromRule(rules[6], { app: 'kelly', kind: 'email', title: 'Re: SOW', from: 'Marie Roy' }, '2026-10-19', true);
assert.deepEqual([m.status, m.kind, m.waiting_on, m.due_at], ['waiting', 'work', 'Marie Roy', '2026-10-21']);
console.log('rules: ok');
```
Run → FAIL (module not found).

- [ ] **Step 2: `worker/lib/rules.ts`**

```ts
import type { Rule, RuleMatch, RuleSet, InboxApp, InboxKind, Task } from '../../shared/types.ts';

type Row = { id: string; name: string; app: string; match: string; then_set: string; mode: string; dedupe: string; enabled: number; sort: number };
const json = <T>(s: string, bad: T): T => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : bad; } catch { return bad; } };

/** A rule whose JSON can't be read matches nothing (an impossible regex) rather than everything. */
export function parseRule(row: Row): Rule {
  return { ...row, app: row.app as Rule['app'], mode: row.mode as Rule['mode'], dedupe: row.dedupe as Rule['dedupe'],
    match: json<RuleMatch>(row.match, { title_regex: '(?!)' }), then_set: json<RuleSet>(row.then_set, {}) };
}

function regexHolds(src: string, title: string): boolean {
  try { return new RegExp(src, 'i').test(title); } catch { return false; }
}

export function matchRule(rules: Rule[], item: { app: InboxApp; kind: InboxKind; suggest: string | null; title: string }): Rule | null {
  for (const r of [...rules].sort((a, b) => a.sort - b.sort)) {
    if (!r.enabled || (r.app !== '*' && r.app !== item.app)) continue;
    const m = r.match;
    if (m.suggest !== undefined && m.suggest !== item.suggest) continue;
    if (m.kind !== undefined && m.kind !== item.kind) continue;
    if (m.title_regex !== undefined && !regexHolds(m.title_regex, item.title)) continue;
    return r;
  }
  return null;
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function taskFromRule(rule: Rule, item: { app: InboxApp; kind: InboxKind; title: string; from: string | null }, today: string, workDefault: boolean): Partial<Task> {
  const s = rule.then_set;
  const out: Partial<Task> = {
    horizon: s.horizon ?? 'short',
    kind: s.kind ?? (workDefault ? 'work' : 'personal'),
    priority: s.priority ?? 0,
    status: s.status ?? 'new',
    project_id: s.project_id ?? null,
    due_at: s.due_offset_days !== undefined ? addDays(today, s.due_offset_days) : null,
  };
  if (out.status === 'waiting' && item.kind === 'email' && item.from) out.waiting_on = item.from;
  return out;
}
```
Run → `rules: ok`.

- [ ] **Step 3: Commit** — `git commit -m "Phase 2 Task 1: rules engine"` after `npm run typecheck && npm run check`.

---

### Task 2: Inbox API

**Files:**
- Create: `worker/lib/inbox-parse.ts`, `worker/routes/inbox.ts`, `scripts/inbox-parse.test.ts`, `docs/integration.md`
- Modify: `worker/index.ts` (mount; guard exemption), `worker/middleware/auth-guard.ts`, `worker/routes/tasks.ts` (export `createTaskFromSource`)

**Interfaces:**
- Consumes: `matchRule`, `parseRule`, `taskFromRule`, `insertTask`, `loadTask`, `addEvent`, `seal`/`open`/`openAll`, `getSettings`, `localDate`, `timingSafeEqual` (write a constant-time compare in `inbox-parse.ts`: compare SHA-256 digests of both strings byte by byte).
- Produces:
  - `appsForSecret(env, token): InboxApp[] | null` and `parseInboxBody(input): InboxPost | string` (pure, tested).
  - `ingest(env, post: InboxPost, opts: { work: boolean; from?: string | null }): Promise<{ item: InboxItem; task?: Task; created: boolean }>` — shared by the HTTP route, the email handler (Task 4) and tests; it decides meeting vs notification vs email, applies the rule, dedupes on `ref`, writes the inbox row, creates or updates the task, and returns what happened. Pushes are sent by the caller (Task 5 wires them).
  - Routes: `POST /api/inbox` (secret) → `201 { id, state, task_id }`; session routes `GET /api/inbox?state=new|all` → `{ items }` (newest first, `new` plus `added` from the last 24 h by default), `POST /api/inbox/:id/keep` (creates the task from the item's rule or defaults) → `{ item, task }`, `POST /api/inbox/:id/dismiss` → `{ item }`, `POST /api/inbox/:id/snooze { until: ISO date }` → `{ item }`, `GET /api/rules` → `{ rules }`, `POST /api/rules`, `PATCH /api/rules/:id`, `DELETE /api/rules/:id` (hard delete is fine for rules: configuration, not user content; say so in a comment).

- [ ] **Step 1: Failing test `scripts/inbox-parse.test.ts`**

```ts
// node --experimental-strip-types scripts/inbox-parse.test.ts
import assert from 'node:assert/strict';
import { parseInboxBody, appsForSecret, safeEqual } from '../worker/lib/inbox-parse.ts';

const env = { INBOX_SECRET_KELLY: 'k-secret', INBOX_SECRET_ID: 'i-secret', INBOX_SECRET_HOLLOW: 'h-secret' } as never;
assert.deepEqual(await appsForSecret(env, 'k-secret'), ['finance', 'health', 'home', 'nightowl', 'kelly']);
assert.deepEqual(await appsForSecret(env, 'i-secret'), ['sonarflow']);
assert.deepEqual(await appsForSecret(env, 'h-secret'), ['hollow']);
assert.equal(await appsForSecret(env, 'nope'), null);
assert.equal(await appsForSecret({} as never, ''), null, 'unset secrets never match an empty token');
assert.equal(await safeEqual('abc', 'abc'), true);
assert.equal(await safeEqual('abc', 'abd'), false);

const ok = parseInboxBody({ app: 'finance', kind: 'notification', title: '  Netflix went up ', body: 'b', url: 'https://finance.knocturnlabs.com/subscriptions.html#watch-netflix', ref: 'kelly:finance:x', suggest: 'review_budget' });
assert.equal(typeof ok === 'object' && ok.title, 'Netflix went up');
for (const [bad, why] of [
  [{ app: 'finance', kind: 'notification', title: '' }, 'empty title'],
  [{ app: 'finance', kind: 'notification', title: 'x'.repeat(121) }, 'long title'],
  [{ app: 'finance', kind: 'notification', title: 't', body: 'x'.repeat(501) }, 'long body'],
  [{ app: 'finance', kind: 'notification', title: 't', url: 'http://x.y' }, 'http url'],
  [{ app: 'finance', kind: 'notification', title: 't', url: 'javascript:alert(1)' }, 'js url'],
  [{ app: 'finance', kind: 'sms', title: 't' }, 'bad kind'],
  [{ app: 'evil', kind: 'notification', title: 't' }, 'bad app'],
  [{ app: 'sonarflow', kind: 'meeting', title: 't', payload: { summary: 'no title fields' } }, 'meeting payload missing arrays'],
  [{ app: 'finance', kind: 'notification', title: 't', payload: { big: 'x'.repeat(70_000) } }, 'payload too big'],
  [null, 'null body'],
] as const) assert.equal(typeof parseInboxBody(bad), 'string', why);
const meeting = parseInboxBody({ app: 'sonarflow', kind: 'meeting', title: 'Steering', ref: 'sonarflow:recording:r1', url: 'https://sonarflow.knocturnlabs.com/meetings/r1',
  payload: { title: 'Steering', summary: 's', decisions: [], action_items: [{ text: 'Send SOW', owner: 'Vlad', due: null, at: '12:30' }], important_notes: [], open_questions: [] } });
assert.equal(typeof meeting, 'object');
console.log('inbox-parse: ok');
```

- [ ] **Step 2: `worker/lib/inbox-parse.ts`**

```ts
import type { InboxApp, InboxKind, MeetingNotes } from '../../shared/types.ts';
import type { Env } from '../types.ts';

export interface InboxPost { app: InboxApp; kind: InboxKind; title: string; body: string | null; url: string | null; ref: string | null; suggest: string | null; payload: unknown }
const APPS: InboxApp[] = ['finance', 'health', 'home', 'nightowl', 'kelly', 'sonarflow', 'hollow', 'email'];
const BY_SECRET: [keyof Env, InboxApp[]][] = [
  ['INBOX_SECRET_KELLY', ['finance', 'health', 'home', 'nightowl', 'kelly']],
  ['INBOX_SECRET_ID', ['sonarflow']],
  ['INBOX_SECRET_HOLLOW', ['hollow']],
];

const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
/** Constant time over the SHA-256 digests, so neither length nor content leaks through timing. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function appsForSecret(env: Env, token: string): Promise<InboxApp[] | null> {
  if (!token) return null;
  for (const [name, apps] of BY_SECRET) {
    const secret = env[name] as string | undefined;
    if (secret && (await safeEqual(secret, token))) return apps;
  }
  return null;
}

const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const arr = (v: unknown) => Array.isArray(v);

export function parseInboxBody(input: unknown): InboxPost | string {
  if (!input || typeof input !== 'object') return 'body must be a JSON object';
  const b = input as Record<string, unknown>;
  if (!APPS.includes(b.app as InboxApp) || b.app === 'email') return 'app is not allowed';
  if (!['notification', 'meeting', 'email'].includes(b.kind as string)) return 'kind must be notification, meeting or email';
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 120) return 'title must be 1-120 characters';
  if (b.body != null && (typeof b.body !== 'string' || b.body.length > 500)) return 'body must be at most 500 characters';
  if (b.url != null && (typeof b.url !== 'string' || b.url.length > 2048 || !isHttps(b.url))) return 'url must be an https URL';
  if (b.ref != null && (typeof b.ref !== 'string' || b.ref.length > 200)) return 'ref must be at most 200 characters';
  if (b.suggest != null && (typeof b.suggest !== 'string' || b.suggest.length > 40)) return 'suggest is invalid';
  if (b.payload != null && JSON.stringify(b.payload).length > 65_536) return 'payload is too large';
  if (b.kind === 'meeting') {
    const p = b.payload as Partial<MeetingNotes> | undefined;
    if (!p || typeof p.title !== 'string' || !arr(p.decisions) || !arr(p.action_items) || !arr(p.important_notes) || !arr(p.open_questions)) return 'meeting payload is incomplete';
    if (!b.ref) return 'meeting needs a ref';
  }
  return { app: b.app as InboxApp, kind: b.kind as InboxKind, title, body: (b.body as string | undefined)?.trim() || null, url: (b.url as string | undefined) ?? null,
    ref: (b.ref as string | undefined) ?? null, suggest: (b.suggest as string | undefined) ?? null, payload: b.payload ?? null };
}
```
(`appsForSecret` is async because of the digest.) Run → `inbox-parse: ok`.

- [ ] **Step 3: `ingest()` and the routes (`worker/routes/inbox.ts`)**

Behaviour, in order, for `ingest(env, post, { work, from })`:
1. `kind: 'meeting'` → upsert `meeting_reviews` by `recording_id` (= the part after `sonarflow:recording:`): insert when new; when it exists and `state = 'new'`, replace its notes (a regenerated summary); when `state = 'reviewed'`, leave it. Encrypt it as work unless the setting later files it under a personal project (always seal with kind `work` in Phase 2: meetings are Bell meetings by default). Also write an `inbox_items` row (`state: 'added'`, `kind: 'meeting'`) so the Today strip shows "Meeting notes ready". Return `created: true` only for a new review.
2. Otherwise load enabled rules (`SELECT * FROM rules ORDER BY sort`), `matchRule`. No rule → `mode = 'inbox'`.
3. Dedupe: if `post.ref` is set, find the newest `inbox_items` row with that ref whose task is open (`task_id` not null and task not done/trashed) or whose state is `new`:
   - rule `dedupe: 'update'` and an open task exists → update that task's title/notes(body)/source_url/due_at (only if the rule sets a due offset), write a `task_events` `edited` event with actor `rule`, refresh the inbox row (`updated_at`, title, body), return `created: false`.
   - `dedupe: 'skip'` and a match exists → touch `updated_at` only, return `created: false`.
   - `'always'` or no match → continue as new.
4. Insert the inbox row: state `dismissed` for `ignore`, `new` for `inbox`, `added` for `task`; `work` from opts (also true when the rule sets `kind: 'work'`).
5. `mode: 'task'` → `taskFromRule` + title (post title), notes (body; for `post.app === 'email'` the full `payload.text` instead), `source_app` (`post.app`, or `email` for the email handler), `source_kind` (`post.kind`), `source_ref` (`post.ref`), `source_url` (`post.url`) → `insertTask` + `addEvent(…,'rule','created',{ inbox_id })` and set `inbox_items.task_id`. The tasks table has a unique index on `source_ref` for live tasks: when step 3 found no open task but a done task holds the ref, clear `source_ref` on the old done task first (`UPDATE tasks SET source_ref = NULL WHERE source_ref = ? AND status = 'done'`) so the new occurrence can take it.
6. `audit(env, 'rule', 'inbox.ingest', item.id, { app, mode, rule_id })` (no title or body in the audit).

`POST /api/inbox`: bearer token → `appsForSecret` → 401 `{ error: 'Unauthorized' }`; body → `parseInboxBody` → 400 with the message; `post.app` not in the secret's apps → 403 `{ error: 'app does not match the secret used' }`; then `ingest(env, post, { work: post.kind === 'meeting', from: post.kind === 'email' ? (post.payload as {from?: string})?.from ?? null : null })` → 201 `{ id, state, task_id }`. Kelly-forwarded emails set `work` when `payload.account`'s domain is in `settings.work_email_domains`. Log every 4xx with the reason and caller (never the token). Rate limit: reject with 429 when more than 120 posts arrived in the last minute (count `inbox_items` with `received_at` in the last 60 s; good enough for a single user).

Auth guard: add `/api/inbox` (POST only) to the public set **and** skip the same-origin check for it (a server sends it, with no Origin). The route itself checks the secret. Keep every other inbox route behind the session.

Session routes as listed in Interfaces. `keep` on an item with no task: use the item's rule if it was `inbox` mode, else defaults (`horizon: short`, kind from `work`), mark `kept`. `dismiss` marks `dismissed` (the task, if any, is untouched). `snooze` sets `snoozed`/`snoozed_until`; `GET /api/inbox` returns snoozed items to `new` once `snoozed_until` has passed (do it in the GET, no cron needed). Items are opened (`openAll(env,'inbox_items',…)` with kind from `work`: seal/open with `kind: work ? 'work' : 'personal'`).

Rules routes validate: `name` 1–80, `app` in APPS or `'*'`, `mode`, `dedupe`, `match` and `then_set` objects with only the documented keys (reject others with 400), `title_regex` compiles (`new RegExp` in try) and ≤ 200 chars, `due_offset_days` integer 0–365, `priority` 0–3, `status` a Status, `project_id` an existing live project.

- [ ] **Step 4: `docs/integration.md`** — the sender contract: URL `https://compass.knocturnlabs.com/api/inbox`, header, body fields with the limits above, which secret may post which app, responses (201/400/401/403/429/500), the ref conventions (`kelly:<app>:<url>`, `email:<provider>:<id>`, `sonarflow:recording:<id>`, `hollow:inbox`, `hollow:disk:<letter>`), and a curl example.

- [ ] **Step 5: Local smoke and commit**

With `npm run dev:worker` and `INBOX_SECRET_KELLY=test-kelly` in `.dev.vars`: post a Health notification (task created, due +3), post it again with the same ref (no new task, the task's title updated), post a `log_meds` one (state dismissed, no task), post with the Hollow-only app using the Kelly secret (403), post with no token (401), post from another Origin with the right secret (still 201: the route is not same-origin bound). Then `GET /api/inbox` with the dev session and `keep`/`dismiss` an inbox-mode item.
Run: `npm run typecheck && npm run check`
```bash
git commit -m "Phase 2 Task 2: inbox API, ingest with rules and dedupe, rules routes, sender contract"
```

---

### Task 3: Meeting reviews API

**Files:**
- Create: `worker/routes/meetings.ts`
- Modify: `worker/index.ts` (mount)

**Interfaces:**
- Consumes: `meeting_reviews`, `decisions`, `insertTask`, `addEvent`, `seal`/`open`, `getSettings`, `localDate`.
- Produces: `GET /api/meetings?state=new|all` → `{ meetings: MeetingReview[] }` (newest first); `GET /api/meetings/:id` → `{ meeting }`; `POST /api/meetings/:id/accept` with body `{ project_id: string | null, tasks: { text: string; due: string | null; owner: string | null; at: string | null; kind?: Kind }[], decisions: { text: string; at: string | null }[] }` → `{ meeting, tasks: Task[], decisions: Decision[] }`; `POST /api/meetings/:id/dismiss` → `{ meeting }` (state reviewed, nothing created).

- [ ] **Step 1: Routes.** Accept validates every text 1–300 chars, due a date or null, at ≤ 12 chars, project_id an existing live project or null, at most 50 tasks and 50 decisions. It creates each task with `title = text`, `notes = owner ? 'Owner: ' + owner : null`, `waiting_on = owner` when the owner is someone other than the user (owner not null and not one of `Vlad`, `Vladimir`, `me`, case-insensitive) with `status: 'waiting'`, else `status: 'new'`; `kind` = the project's kind when a project is set, else the item's `kind` or `work`; `source_app: 'sonarflow'`, `source_kind: 'meeting'`, `source_ref: null` (a meeting yields many tasks), `source_url: meeting.url + (at ? '?t=' + encodeURIComponent(at) : '')`; events with actor `meeting`. Decisions get `decided_at` = the meeting's `received_at` date, `from_meeting_id`, `at_ref = at`, sealed with the project's kind (work when no project). The review becomes `reviewed`, `project_id` set, `reviewed_at` now. Accepting an already-reviewed meeting is a 409.
- [ ] **Step 2: Smoke** (post a meeting via `/api/inbox` with `INBOX_SECRET_ID`, list it, accept two action items and one decision into a work project; the tasks appear in `/api/tasks`, decisions are ciphertext in D1, a second accept is 409). Commit `Phase 2 Task 3: meeting reviews API`.

---

### Task 4: Forward-to email address

**Files:**
- Create: `worker/email.ts`, `scripts/email-parse.test.ts`
- Modify: `worker/index.ts` (export `email`), `worker/routes/tasks.ts` (`GET /api/tasks/:id/email`)

**Interfaces:**
- Consumes: `ingest` (Task 2), `getSettings`, `env.FILES`, `postal-mime`.
- Produces: `emailToPost(parsed: { subject?: string; text?: string; from?: { address?: string; name?: string } }, settings): { post: InboxPost; work: boolean; from: string | null }` (pure, exported for the test); the Worker's `email(message, env, ctx)` handler; `GET /api/tasks/:id/email` streams `email/<task id>.eml` from R2 as `message/rfc822` with `Content-Disposition: attachment; filename="email.eml"` (404 when absent).

- [ ] **Step 1: Failing test `scripts/email-parse.test.ts`**

```ts
// node --experimental-strip-types scripts/email-parse.test.ts
import assert from 'node:assert/strict';
import { emailToPost, senderAllowed } from '../worker/email.ts';

const settings = { work_email_domains: ['bell.ca'] } as never;
const a = emailToPost({ subject: 'Fwd: SOW v3 redlines', text: 'Please review by Friday.\n\n---------- Forwarded message ---------\nFrom: Acme', from: { address: 'jane.doe@bell.ca', name: 'Jane' } }, settings);
assert.equal(a.post.title, 'SOW v3 redlines');
assert.equal(a.post.app, 'email');
assert.equal(a.post.kind, 'email');
assert.equal(a.work, true, 'a Bell sender makes it work');
assert.ok(a.post.body!.length <= 500);
for (const [subject, want] of [['TR: Budget', 'Budget'], ['FW: FW: Re: x', 'Re: x'], ['Fwd:', '(no subject)'], ['', '(no subject)'], ['RE: Cutover', 'RE: Cutover']] as const)
  assert.equal(emailToPost({ subject, text: '', from: { address: 'me@gmail.com' } }, settings).post.title, want, subject);
assert.equal(emailToPost({ subject: 'x'.repeat(300), text: '', from: { address: 'me@gmail.com' } }, settings).post.title.length, 120);
assert.equal(emailToPost({ subject: 's', text: 't', from: { address: 'me@gmail.com' } }, settings).work, false);
assert.equal(senderAllowed('Jane.Doe@Bell.ca', 'jane.doe@bell.ca, me@gmail.com'), true, 'case-insensitive');
assert.equal(senderAllowed('evil@bell.ca', 'jane.doe@bell.ca'), false);
assert.equal(senderAllowed('me@gmail.com', ''), false, 'empty list allows nobody');
console.log('email-parse: ok');
```

- [ ] **Step 2: `worker/email.ts`**

```ts
import PostalMime from 'postal-mime';
import type { Env } from './types.ts';
import type { Settings } from '../shared/types.ts';
import type { InboxPost } from './lib/inbox-parse.ts';
import { ingest } from './routes/inbox.ts';
import { getSettings, audit } from './lib/db.ts';

const PREFIX = /^\s*((fwd?|fw|tr)\s*:\s*)+/i; // forwarding prefixes in English and French (TR:)

export const senderAllowed = (from: string, list: string | undefined) =>
  !!from && (list ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(from.trim().toLowerCase());

export function emailToPost(parsed: { subject?: string; text?: string; from?: { address?: string; name?: string } }, settings: Pick<Settings, 'work_email_domains'>) {
  const title = ((parsed.subject ?? '').replace(PREFIX, '').trim() || '(no subject)').slice(0, 120);
  const address = (parsed.from?.address ?? '').toLowerCase();
  const domain = address.split('@')[1] ?? '';
  const work = settings.work_email_domains.some((d) => domain === d || domain.endsWith('.' + d));
  const text = (parsed.text ?? '').trim();
  const post: InboxPost = { app: 'email', kind: 'email', title, body: text.slice(0, 500) || null, url: null, ref: null, suggest: null, payload: { from: address, text: text.slice(0, 20_000) } };
  return { post, work, from: parsed.from?.name || address || null };
}

/** Cloudflare Email Routing → this Worker. Only the addresses in ALLOWED_FORWARDERS get in; anything else is dropped and logged. */
export async function email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
  if (!senderAllowed(message.from, env.ALLOWED_FORWARDERS)) {
    console.warn('[email] dropped: sender not allowed');
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const { post, work, from } = emailToPost(parsed, await getSettings(env));
  const { item, task } = await ingest(env, post, { work, from });
  if (task) await env.FILES.put(`email/${task.id}.eml`, raw, { httpMetadata: { contentType: 'message/rfc822' } });
  await audit(env, 'email', 'inbox.email', item.id, { work });
}
```
`ingest` puts the full text (`payload.text`) into the task's notes for email items (Task 2 step 3.5: for `post.app === 'email'`, notes = payload.text). `worker/index.ts` exports `email` next to `fetch` and `scheduled`. `GET /api/tasks/:id/email` lives in tasks.ts (session-gated by the guard).

- [ ] **Step 3: Local check and commit.** `npm run check` (email-parse ok). Local `wrangler dev` can simulate an email: `curl -X POST 'http://localhost:8790/cdn-cgi/handler/email?from=me@gmail.com&to=compass@knocturnlabs.com' --data-binary @scripts/fixtures/forward.eml` with a small fixture `.eml` you write (plain text, Subject: `Fwd: Test`), and `ALLOWED_FORWARDERS=me@gmail.com` in `.dev.vars`: a task "Test" appears with the body in its notes, and `GET /api/tasks/:id/email` returns the file. A sender not in the list creates nothing. Commit `Phase 2 Task 4: forward-to email address`.

---

### Task 5: Web Push sender and subscriptions

**Files:**
- Create: `worker/lib/webpush.ts`, `worker/routes/push.ts`, `scripts/webpush.test.ts`
- Create also: `worker/lib/notify.ts` (`notifyIngest`)
- Modify: `worker/index.ts` (mount), `worker/routes/inbox.ts` and `worker/email.ts` (call `notifyIngest` after `ingest`)

**Interfaces:**
- Produces: `sendPush(env, sub: { endpoint, p256dh, auth }, message: PushMessage): Promise<'sent' | 'gone' | 'failed'>`; `pushAll(env, type: PushType, key: string, message: PushMessage): Promise<number>` (skips when the type is off in settings, when inside quiet hours, or when `push_log` already has `key`; records `key` only when at least one device received it; deletes subscriptions that answer 404/410; returns the number sent); `PushMessage = { title: string; body: string; url: string; tag?: string }`. Routes: `GET /api/push/key` → `{ publicKey }` (session-gated), `POST /api/push/subscribe { endpoint, keys: { p256dh, auth }, device_name }` → `{ id }` (upsert by endpoint), `DELETE /api/push/:id`, `GET /api/push` → `{ subscriptions: { id, device_name, created_at, last_ok_at }[] }`, `POST /api/push/test` → `{ sent }` (ignores quiet hours and the log, so you can test at any time).
- `notifyIngest(env, result)`: called after `ingest` by the HTTP route and the email handler: a new task from a rule → `pushAll(env, 'app_task', 'task:' + task.id, { title: task.title, body: 'Added by ' + appName(app), url: '/' })`; a new meeting review → `pushAll(env, 'meeting', 'meeting:' + review.id, { title: 'Meeting notes ready', body: review.title, url: '/meetings/' + review.id })`. Updates and dedupes never push.

- [ ] **Step 1: Copy the sender from Hollow.** Read `~/Documents/Hollow/web/src/notify.ts` (read-only). Copy `b64u`, `unb64u`, `concat`, `hkdf`, `encrypt` (RFC 8291 aes128gcm) and `vapid` (RFC 8292) into `worker/lib/webpush.ts` unchanged except for imports and the `Env` type (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Write `sendPush` like Hollow's Web Push sender: POST to the endpoint with `TTL: 86400`, `Content-Encoding: aes128gcm`, `Urgency: normal`, the VAPID `Authorization` header and the encrypted body (the JSON message); 201/202 → sent, 404/410 → gone, else failed. Credit Hollow in the file header comment. Do not copy APNs or FCM.

- [ ] **Step 2: Round-trip test `scripts/webpush.test.ts`.** Generate a subscriber P-256 key pair and a 16-byte auth secret with WebCrypto, call the exported `encrypt(plain, p256dh, auth)` (export it for the test), then decrypt as the browser would (RFC 8291 §3.4: ECDH with the server key from the record header, HKDF for the IKM with `WebPush: info\0` + ua_public + as_public, then the content-encryption key and nonce from the salt, AES-128-GCM, strip the 0x02 padding delimiter) and assert the plaintext comes back. Also assert `vapid()` returns `vapid t=<jwt>, k=<public key>` and that the JWT's payload `aud` is the endpoint's origin. This proves the copied code works under Node's WebCrypto.

- [ ] **Step 3: `pushAll` quiet hours.** Put `inQuietHours(hhmm: string, from: string, to: string): boolean` in `worker/lib/schedule.ts` (Task 6 owns that file; create it here with this one function and its test cases in `scripts/schedule.test.ts`: `22:00–07:00` contains `23:30` and `06:59`, not `07:00` or `21:59`; `13:00–14:00` contains `13:30`; `from === to` means never quiet). `pushAll` computes the local `HH:MM` with `Intl.DateTimeFormat('en-CA', { timeZone: settings.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`.

- [ ] **Step 4: Routes, notifyIngest wiring, purge.** `push_log` rows older than 30 days are deleted by the existing cron purge. Commit `Phase 2 Task 5: web push sender, subscriptions, pushes on new app tasks and meeting notes`.

---

### Task 6: The 15-minute cron: digest, overdue, nudges, milestones, weekly review

**Files:**
- Create: `worker/cron.ts`
- Modify: `worker/lib/schedule.ts` (add `duePushes`), `scripts/schedule.test.ts`, `worker/index.ts` (`scheduled` calls `runCron`)

**Interfaces:**
- Consumes: `pushAll`, `getSettings`, open tasks and milestones (opened), `purgeTrash`, `purgeAudit`, `purgeSessions`.
- Produces: `duePushes(input: { now: { date: string; hhmm: string; weekday: number }; settings: Settings; tasks: Pick<Task,'id'|'title'|'status'|'due_at'|'waiting_on'|'waiting_since'|'nudge_every_days'|'deleted_at'|'parent_id'>[]; milestones: { id: string; name: string; due_at: string | null; done_at: string | null }[] }): { type: PushType; key: string; message: PushMessage }[]` (pure); `runCron(env)`.

Rules for `duePushes` (each fires only inside its 15-minute slot, i.e. when `hhmm` is in `[slot, slot+15min)`):

| Type | Slot | Fires when | Key | Message |
| --- | --- | --- | --- | --- |
| digest | `digest_hour:00` | there is at least one open task due today or overdue | `digest:<date>` | "Today: N due · M overdue", body = the first three titles, url `/` |
| overdue | `13:00` | at least one open task is overdue | `overdue:<date>` | "M overdue", body = the oldest three titles, url `/list?q=due:overdue` |
| nudge | `digest_hour:00` | a `waiting` task with `nudge_every_days = n` and `waiting_since` date `w` where `(date - w)` is a positive multiple of `n` | `nudge:<task id>:<date>` | "Nudge <waiting_on>", body = title, url `/` |
| milestone | `digest_hour:00` | an undone milestone is due exactly 7 days from today | `milestone:<id>:<due>` | "Milestone in a week", body = name, url `/projects` |
| weekly_review | `17:00` on `weekly_review_day` | `last_review_at` is not within the last 6 days | `review:<date>` | "Time for your weekly review", url `/review` |

Open = not done, not trashed, no parent. Quiet hours and switches are applied by `pushAll`, not here (keeps this pure and testable).

- [ ] **Step 1: Tests first** in `scripts/schedule.test.ts` (alongside the quiet-hours cases): digest fires at 07:00 and 07:14, not 06:59 or 07:15, and not when nothing is due; overdue at 13:05 with one overdue task; nudge on day 3 and 6 for `nudge_every_days 3` but not day 0, 2 or 4; milestone exactly 7 days out only; weekly review on the right weekday at 17:00 unless reviewed 2 days ago; trashed and subtasks ignored; keys exactly as in the table.
- [ ] **Step 2: Implement `duePushes` and `runCron`** (`runCron` loads settings, open tasks (opened, titles decrypted) and milestones, computes `now` in `settings.tz`, calls `duePushes`, then `pushAll` for each; the purges move here from index.ts; everything runs under `ctx.waitUntil` with each part's failure logged by name, not `Promise.all` rejecting silently).
- [ ] **Step 3: Local check.** `npm run dev:worker` (has `--test-scheduled`), create a task due today, set `digest_hour` to the current hour, register no subscription, hit `/__scheduled?cron=*/15+*+*+*+*`: the push log gets `digest:<today>` only when a subscription exists (with none, `pushAll` returns 0 and writes nothing; say so in the report). Commit `Phase 2 Task 6: cron pushes`.

---

### Task 7: Web: notifications, sources and email settings; push in the service worker

**Files:**
- Modify: `web/public/sw.js`, `web/src/views/Settings.tsx`, `web/src/ui/TaskSheet.tsx`
- Create: `web/src/push.ts`, `web/src/views/Rules.tsx` (rendered inside Settings)

**Interfaces:**
- Consumes: `/api/push/key`, `/api/push/subscribe`, `/api/push`, `DELETE /api/push/:id`, `/api/push/test`, `/api/rules*`, `/api/settings` (push, work_email_domains).
- Produces: `enablePush(): Promise<'enabled' | 'denied' | 'unsupported'>` and `disablePush()` in `web/src/push.ts`; Settings sections "Notifications", "Sources and rules", "Email".

- [ ] **Step 1: Service worker.** Add to `web/public/sw.js`:
```js
self.addEventListener('push', (e) => {
  let m = { title: 'Compass', body: '', url: '/' };
  try { m = { ...m, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, tag: m.tag, data: { url: m.url }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.location.origin));
    return open ? open.focus().then(() => open.navigate(url)) : self.clients.openWindow(url);
  }));
});
```
Only same-origin URLs are opened (the `new URL(…, origin)` keeps relative paths on Compass; an absolute foreign URL from a message is replaced by `/`: check `url.startsWith(self.location.origin)` and fall back to `/`).

- [ ] **Step 2: `web/src/push.ts`.** `enablePush`: unsupported when `!('serviceWorker' in navigator) || !('PushManager' in window)`; on iPhone/iPad Safari, Web Push works only when Compass is installed to the Home Screen, so when `navigator.standalone === false` on iOS return `'unsupported'` with that reason (the UI says "Add Compass to your Home Screen first"). Otherwise `Notification.requestPermission()`, fetch the VAPID key, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <key as Uint8Array> })`, POST it with a device name (reuse the sign-in device-name logic: "Safari on iPhone"), remember the subscription id in `localStorage` (`compass.push.id`, wrapped in try/catch). `disablePush` unsubscribes and deletes on the server.

- [ ] **Step 3: Settings sections.**
  - **Notifications:** status line (on for this device / off / blocked by the browser / needs Home Screen), Turn on / Turn off button, "Send a test" button, the list of devices with a Remove button, and one switch per push type (Daily digest, Overdue, Waiting-on nudges, Milestones in a week, Weekly review, Tasks added by your apps, Meeting notes ready) bound to `settings.push` (send only the changed type). Quiet hours already exist; label them "Quiet hours (no notifications)".
  - **Sources and rules (`Rules.tsx`):** the rules in order: name, app, a mode select (Task / Wait in inbox / Ignore), due-offset number (days), an enabled switch, Delete (with `confirmAction`). "Add rule": name, app select, optional suggest, optional title words (turned into an escaped regex; an "Advanced" input accepts a raw regex), mode, horizon, kind, due offset. Changes PATCH one field at a time (blur-commit for text and numbers, as Settings already does).
  - **Email:** "Forward emails to compass@knocturnlabs.com", a copy button, the allowed senders shown read-only with "set by your Compass setup" (they live in a secret), and the work domains list editor (`work_email_domains`, add/remove chips).
- [ ] **Step 4: TaskSheet nudge field.** When status is `waiting`, show "Nudge me every N days" (number, empty = never) bound to `nudge_every_days` (blur-commit, 1–365).
- [ ] **Step 5: Check and commit.** typecheck, build, check; dev servers serve the files; describe the permission flow in the report. Commit `Phase 2 Task 7: push and sources settings, service worker push`.

---

### Task 8: Web: "Added by your apps" strip and the Inbox

**Files:**
- Create: `web/src/ui/AddedStrip.tsx`, `web/src/views/Inbox.tsx`, `web/src/inbox.ts`
- Modify: `web/src/views/Today.tsx`, `web/src/App.tsx`, `web/src/router.ts` (route `inbox`), `web/src/ui/Shell.tsx` (rail item "Inbox" with a count), `web/src/views/Settings.tsx` ("Go to" gains Inbox, Meetings, Weekly review)

**Interfaces:**
- Consumes: `GET /api/inbox`, `POST /api/inbox/:id/keep|dismiss|snooze`, `pull()` from the store (so a kept task appears at once), `fmtDue`, `SRC` colours.
- Produces: `useInbox()` in `web/src/inbox.ts` → `{ items, loading, offline, keep(id), dismiss(id), snooze(id, until) }`, caching the last list in IndexedDB `meta` (`cache:inbox`) and returning it with `offline: true` when the fetch fails (ruling P7); actions disabled offline with a tooltip.

- [ ] **Step 1: AddedStrip on Today** (as in `docs/previews.html` tab 2): up to four cards, newest first, source colour on the left border, title, body as plain text, and actions: `new` items → Keep / Snooze (tomorrow) / Dismiss; `added` items (last 24 h) → an "Added" chip and "Open" (opens the task sheet) / Undo (trashes the task and dismisses the item, with `confirmAction`). Meeting items → "Review" (navigates to `/meetings/<id>`). Header: "Added by your apps · N new". Hidden when empty.
- [ ] **Step 2: Inbox view** (`/inbox`): every `new` and recent `added` item; keyboard `j/k` to move, `Enter` keep, `d` dismiss, `s` snooze to tomorrow, `o` open the source link in a new tab (only `https:` URLs; render the link with `rel="noopener noreferrer"`). Empty state "Inbox zero." Buttons are `<button type="button">`; the list is a `role="listbox"` with `aria-activedescendant`.
- [ ] **Step 3: Rail and phone nav.** The rail gains "Inbox" under Today with a badge for the `new` count; on phones the count shows on the More tab and Settings' "Go to" lists Inbox, Meetings and Weekly review.
- [ ] **Step 4: Check and commit** `Phase 2 Task 8: added-by-your-apps strip and inbox`.

---

### Task 9: Web: meeting review

**Files:**
- Create: `web/src/views/Meetings.tsx`, `web/src/views/Meeting.tsx`
- Modify: `web/src/App.tsx`, `web/src/router.ts` (routes `meetings` and `meetings/:id`)

**Interfaces:**
- Consumes: `GET /api/meetings`, `GET /api/meetings/:id`, `POST /api/meetings/:id/accept|dismiss`, the store's projects, `pull()`.
- Produces: the list (new first, then reviewed, each with title, date, counts of actions/decisions) and the review screen.

- [ ] **Step 1: Review screen** (`/meetings/:id`): title, date, "Open transcript" (the meeting's `url`), summary (plain text), then three sections:
  - **Action items**: one row each with a checkbox (checked by default), editable text, owner, due date (`<input type="date">`), and the transcript reference chip.
  - **Decisions**: a checkbox per decision (checked by default) and its text.
  - **Open questions**: a checkbox per question (unchecked by default) that turns it into a follow-up task when checked.
  - **Important notes**: read-only list.
  - A project select (work projects first; "No project") and "Accept N tasks and M decisions" (primary) / "Dismiss" (secondary, `confirmAction`). Accepting posts only checked rows; questions become tasks with title `Follow up: <question>`. After accept: toast "Added N tasks", `pull()`, navigate to the project page when one was chosen, else Today.
- [ ] **Step 2: Offline:** the list is cached like the inbox (`cache:meetings`); accept/dismiss are disabled offline.
- [ ] **Step 3: Check and commit** `Phase 2 Task 9: meeting review`.

---

### Task 10: Web: weekly review

**Files:**
- Create: `web/src/views/Review.tsx`
- Modify: `web/src/App.tsx`, `web/src/router.ts` (route `review`)

**Interfaces:**
- Consumes: `useStore`, `useInbox`, `updateTask`, `completeTask`, `trashTask`, `api('/settings', PATCH)`.
- Produces: a five-step guided screen with a step indicator and Back/Next:
  1. **Inbox to zero** — the inbox list from Task 8, embedded.
  2. **Overdue** — each overdue task with "Tomorrow", "Next week", "Done", "Trash".
  3. **The next 7 days** — tasks due in the next week, read-only with the sheet on click.
  4. **Horizons** — medium and long tasks, each with "Move to this week" (horizon short).
  5. **Waiting on** — waiting tasks with how long they have waited and "Nudge in 3 days" (sets `nudge_every_days: 3`) or "Got it" (status progress).
  
  "Finish review" PATCHes `last_review_at` to now and shows "Review done. See you next week."

- [ ] **Step 1: Build it**, using `<button type="button">` everywhere and DST-safe dates from `web/src/dates.ts`.
- [ ] **Step 2: Check and commit** `Phase 2 Task 10: weekly review`.

---

### Task 11: Compass secrets, migration, smoke, deploy

**Files:**
- Create: `scripts/setup-phase2.sh`
- Modify: `scripts/smoke.sh`, `.gitignore` (`.secrets/`), `CLAUDE.md` (Phase 2 sources section)

- [ ] **Step 1: `scripts/setup-phase2.sh`** (idempotent, no prompts): create `.secrets/` (mode 700) and `.secrets/compass-inbox.env` (mode 600) if missing, holding `INBOX_SECRET_KELLY`, `INBOX_SECRET_ID`, `INBOX_SECRET_HOLLOW` (each `node scripts/gen-secret.mjs`) and the two VAPID values (`node scripts/gen-vapid.mjs`); then for each name, if `npx wrangler secret list` does not show it, pipe the value into `npx wrangler secret put <NAME>`; `VAPID_SUBJECT` is a plain var in wrangler.jsonc (`mailto:` + the email in `.dev.vars.example`). `ALLOWED_FORWARDERS` is put as a secret from `.secrets/compass-inbox.env` too, where Vlad's addresses go (Step 2). The file is the only place outside repos read their secret from in Tasks 12–14; it is never committed or printed.
- [ ] **Step 2: Ask Vlad for the forwarding addresses** (the controller asks; one message): his Bell address and any personal addresses he will forward from. Write them as `ALLOWED_FORWARDERS=a@bell.ca,b@gmail.com` into `.secrets/compass-inbox.env` and re-run the script. Until then the email path stays closed (nobody allowed), which is safe.
- [ ] **Step 3: Smoke.** Extend `scripts/smoke.sh` (local, with `.dev.vars` test secrets): post a notification with the Kelly secret and see a task; repost with the same ref and see no second task; post a meeting with the ID secret and accept it; post with the wrong secret → 401. `npm run smoke` → `smoke: ok`.
- [ ] **Step 4: Remote migration and deploy (Vlad's word).** `npm run db:migrate:remote` (0003), then ask Vlad, then `npm run deploy`, then on production: `curl -s -o /dev/null -w '%{http_code}' -X POST https://compass.knocturnlabs.com/api/inbox` → 401 (secret required), and a real post with the Kelly secret from `.secrets` with title "Compass pipe test" → 201; Vlad sees it on Today and dismisses it.
- [ ] **Step 5: Commit** `Phase 2 Task 11: secrets setup, smoke, deploy`.

---

## Outside repos (Tasks 12–16)

Common steps for each, not repeated below:
1. `git -C <repo> status --short` and note any uncommitted files (leave them alone; never stage them).
2. `git -C <repo> switch -c compass-phase-2` from the current `HEAD` (if the branch exists, switch to it).
3. Read that repo's `CLAUDE.md` and follow its standing rules; they win over this plan where they conflict (report the conflict).
4. Run that repo's own checks (named per task) before committing; commit only this task's files.
5. Set the repo's Worker secret from `.secrets/compass-inbox.env` with `npx wrangler secret put COMPASS_INBOX_SECRET` (piped, never echoed) and add `COMPASS_INBOX_URL = "https://compass.knocturnlabs.com/api/inbox"` as a var in that repo's wrangler config. Setting a secret takes effect immediately on the live Worker; that is harmless because the code that uses it isn't deployed yet.
6. Stop before deploying. The controller asks Vlad (Who does what #1); after his yes: `npm run deploy` in that repo, then merge `compass-phase-2` into the branch it came from with `--ff-only` (or report why not), and do not push unless Vlad says so.

### Task 12: Kelly-Cloud — forward the bus and emails that need a reply

**Files (in `~/Documents/Kelly-Cloud`):**
- Create: `src/lib/compass.ts`, `scripts/verify-compass-forward.ts`
- Modify: `src/routes/notifications.ts` (after the insert), `src/index.ts` (`scheduled`), `src/types.ts` (`COMPASS_INBOX_URL?`, `COMPASS_INBOX_SECRET?`), `wrangler.jsonc` (var), `docs/notifications.md` (one paragraph: "Kelly forwards every stored notification to Compass")

**Interfaces:**
- Produces: `forwardToCompass(env, n: { id, app, title, body, url, suggest }): Promise<void>` (no-op when either env value is missing, and for `app: 'sonarflow'`: SonarFlow's bus posts are about dictation, and its meetings reach Compass from Knocturn ID; Compass would refuse them from Kelly's secret anyway; 10 s timeout; logs the status on failure, never the secret or text); `compassRef(app, url, id)` = `kelly:${app}:${url}` when url else `kelly:${app}:${id}` (ruling P3); `forwardNeedsReply(env, now): Promise<number>` — runs `getTriage(env)` only between 07:00 and 21:59 America/Toronto, posts each `needsYou` message as `{ app: 'kelly', kind: 'email', title: subject || '(no subject)', body: (from + ' — ' + gist).slice(0, 500), url, ref: 'email:' + provider + ':' + id, payload: { account, from } }` where `url` is `https://mail.google.com/mail/u/?authuser=<account>#all/<id>` for Gmail and `https://outlook.live.com/mail/0/` for Outlook; swallows `BudgetExceededError` (logs once).

- [ ] **Step 1: Verify script first** (`npx tsx scripts/verify-compass-forward.ts`), using a stubbed `fetch` that records requests: `compassRef` both ways; a `sonarflow` notification is not forwarded; a notification forward sends the bearer secret, `kind: 'notification'`, the original app and the ref; nothing is sent when `COMPASS_INBOX_URL` is unset; a 500 from Compass doesn't throw; `forwardNeedsReply` posts nothing at 06:30 and 22:00 Toronto, posts each needs-reply at 09:00 with the Gmail URL and `email:gmail:<id>` ref, and returns 0 on `BudgetExceededError` (stub `getTriage` by injecting a triage function parameter: give `forwardNeedsReply` an optional third argument `triageFn = getTriage`).
- [ ] **Step 2: Implement.** In `notifications.post('/')`, after the insert and before the urgent heads-up block: `c.executionCtx.waitUntil(forwardToCompass(c.env, { id, ...parsed }).catch(() => {}))` (wrapped like the existing heads-up `try { waitUntil } catch { await }` for the offline checks). In `scheduled`, on the `'0 * * * *'` cron only, add `forwardNeedsReply(env, new Date())` to the chain with its own `.catch` logging.
- [ ] **Step 3: Checks:** `npm run typecheck`, `npx tsx scripts/verify-compass-forward.ts`, `npx tsx scripts/verify-notifications.ts` (the existing hub check still passes). Commit `Forward notifications and needs-reply emails to Compass`. Then the common steps 5–6.

### Task 13: Knocturn ID — post meeting notes when they are ready

**Files (in `~/Documents/Knocturn-ID`):**
- Create: `src/compass.ts`, `test/compass.test.mjs`
- Modify: `src/transcription.ts` (`analyze` → `done`), the Env type (`COMPASS_INBOX_URL?`, `COMPASS_INBOX_SECRET?`), `wrangler.jsonc` (var), `INTEGRATION.md` (one line under Meetings: "Finished notes are posted to Compass")

**Interfaces:**
- Produces: `compassMeeting(recordingId: string, notesJson: string): object | null` (pure: parses the notes JSON; null when unparsable; returns `{ app: 'sonarflow', kind: 'meeting', title: notes.title || 'Meeting', ref: 'sonarflow:recording:' + id, url: 'https://sonarflow.knocturnlabs.com/meetings/' + id, payload: notes }`, trimming `important_notes` then `open_questions` from the end until `JSON.stringify(payload).length <= 60000`); `postMeetingToCompass(env, recordingId, notesJson)` (no-op without config; 10 s timeout; logs only status and recording id).

- [ ] **Step 1: Test first** (`node --test test/compass.test.mjs`, matching the repo's `notes.test.mjs` style): a full notes JSON maps to the body above; a 200 KB `important_notes` list is trimmed under the limit while `action_items` survive; garbage → null.
- [ ] **Step 2: Hook.** In `done(notes)` after `reindex(...)`, when `notes` is a non-empty string: `await postMeetingToCompass(env, r.id, notes).catch(() => {})`. A regenerated summary posts again; Compass replaces an unreviewed review (Task 2 step 3.1).
- [ ] **Step 3: Checks:** `npm run typecheck`, `node --test test/*.test.mjs`. Commit `Post finished meeting notes to Compass`. Common steps 5–6; before deploying Knocturn ID the controller records the live version id so it can roll back, as it did for the Compass registration.

### Task 14: Hollow — files waiting in the Inbox folder, and critical drive alerts

**Files (in `~/Documents/Hollow/web`):**
- Create: `src/compass.ts`, `test/compass.test.mjs`
- Modify: `src/index.ts` (`scheduled`), the disk-alert path in `src/disks.ts` (only where a `critical` message is produced), the Env type, `wrangler.jsonc` (var)

**Interfaces:**
- Produces: `inboxMessage(count: number, inboxPath: string): object | null` (pure: null for 0; else `{ app: 'hollow', kind: 'notification', title: 'Sort N file(s) in your Hollow Inbox', body: inboxPath, url: 'https://hollow.knocturnlabs.com/#/files?path=' + encodeURIComponent(inboxPath), ref: 'hollow:inbox' }`); `diskMessage(m: Message, letter: string): object` (`ref: 'hollow:disk:' + letter`, the alert's title/body, url `https://hollow.knocturnlabs.com/#/storage`); `postToCompass(env, body)` (no-op without config).
- How Hollow counts the Inbox folder: use the agent API the Worker already calls for folder listings (read `src/agent-fetch.ts` and `shared/agent.openapi.yaml`; count files, not folders, directly inside `settings.inbox`). If the agent is offline, skip silently (the next day tries again).

- [ ] **Step 1: Tests first** for `inboxMessage` (0 → null; 1 → "Sort 1 file…"; 12 → "Sort 12 files…"; URL encoding of `D:\Inbox`) and `diskMessage`.
- [ ] **Step 2: Wire.** The hourly cron posts the inbox count once a day at the 13:00 UTC tick (≈ 9:00 Toronto). The critical drive alert posts alongside Hollow's own push (warnings stay in Hollow only).
- [ ] **Step 3: Checks:** `npm run typecheck`, `npm test`. Commit `Tell Compass about files waiting in the Inbox and critical drives`. Common steps 5–6. Hollow's rule 4 is respected: Hollow never depends on Compass either (every Compass call is fire-and-forget).

### Task 15: Health — low medication reaches Kelly's bus (no medication names)

**Files (in `~/Documents/Health-Dashboard`):**
- Modify: `src/lib/refill-alerts.ts`, `src/lib/preventive-care-alerts.ts`, a self-check in `scripts/` (follow the repo's pattern)

- [ ] **Step 1:** In `evaluateRefillAlerts`, after Telegram and `logNotification`, call `notifyKelly(env, { title: 'Medication running low', body: \`About ${status.days_remaining} day(s) left. Time to refill.\`, link: \`/medications.html#med-${medication.id}\`, priority: status.days_remaining <= 2 ? 'high' : 'normal', suggest: 'open_app' })`. The medication's name is never sent (ruling P2, Health's encryption rule). In `preventive-care-alerts.ts` make the appointment link unique: `/preventive-care.html#appt-${appt.id}`.
- [ ] **Step 2:** Self-check that the refill body contains no name (stub `notifyKelly` capture; assert the title and body equal the fixed strings above for a medication named "Concerta") — put it where the repo's existing checks live and run it with the repo's command.
- [ ] **Step 3: Checks:** `npm run typecheck` and the repo's self-checks loop from its README. Commit `Send low-refill alerts to Kelly without medication names`. Common steps 5–6 (no Compass secret needed here: Health posts to Kelly as it already does).

### Task 16: Finance — subscription reviews reach Kelly's bus; one link per bill

**Files (in `~/Documents/Personal Finance - Project App`):**
- Modify: `src/lib/subscription-watchdog.ts` (`notifyWatchdog`), `src/lib/notification-sweep.ts` (bill link), a self-check

- [ ] **Step 1:** In `notifyWatchdog`, for each alert it creates (only when `createNotification` says it is new, mirroring the bill path's `isNew`), also `notifyKelly(env, { title: a.title, body: a.detail, link: \`/subscriptions.html#watch-${encodeURIComponent(a.key)}\`, suggest: 'open_app' })`. In the bill path change the link to `/bills.html#cycle-${cycle.id}` (Finance's bills page ignores the fragment; it only makes each bill's link unique for Compass's dedupe).
- [ ] **Step 2:** Self-check with a stubbed `notifyKelly` capturing calls: a new watchdog alert posts once with the fragment link; an already-known alert posts nothing.
- [ ] **Step 3: Checks:** `npm run typecheck` and the repo's checks. Commit `Send subscription reviews to Kelly; one link per bill`. Common steps 5–6.

### Task 17: Email Routing and the end-to-end check

- [ ] **Step 1: Email Routing rule.** Try the API first: with the logged-in wrangler account (its token has `email_routing (write)`), find the `knocturnlabs.com` zone id (`npx wrangler` cannot list rules; use `curl` against `https://api.cloudflare.com/client/v4/zones?name=knocturnlabs.com` and `…/zones/<id>/email/routing/rules` with the OAuth token from `npx wrangler auth token`), and create a rule matching `to: compass@knocturnlabs.com` with action `worker: compass`. If any call is refused, stop and give Vlad the dashboard steps instead: Cloudflare → knocturnlabs.com → Email → Email Routing → Routing rules → Create address `compass` → Action "Send to a Worker" → `compass` → Save (Who does what #3).
- [ ] **Step 2: Pipes, one at a time,** each removed afterwards (dismissed inbox item, trashed task):
  - Compass inbox: covered by Task 11 step 4.
  - Kelly bus → Compass: watch `npx wrangler tail compass --format pretty` while Health's next scheduled refill check or Finance's sweep runs, or ask Vlad to trigger one test notification from Home Assistant (`rest_command`); confirm a task appears with the right source chip and link.
  - Email: Vlad forwards one email from his Bell address (Who does what #5); the task appears as Work with the text in its notes and the original file downloadable.
  - Meetings: the next SonarFlow meeting with notes, or Vlad presses "Regenerate notes" on an existing meeting in SonarFlow-Web; it appears under Meetings and in the strip.
  - Push: Vlad turns notifications on in Settings on the Mac and on the phone (installed to the Home Screen) and presses "Send a test" (Who does what #4); then the next 07:00 digest arrives.
- [ ] **Step 3:** Record what was verified and what is waiting on a natural trigger in `docs/phase-2-verification.md`, and commit.

## Spec coverage (self-review)

| Spec | Task |
| --- | --- |
| §3 inbox_items, rules, meeting_reviews, push_subscriptions; decisions | 0 |
| §4 `POST /inbox` (secret), `GET /inbox`, keep/dismiss/snooze, rules CRUD, meetings list/detail/accept, push subscribe, `email()` | 2, 3, 4, 5 |
| §5.1 inbox contract and limits; `docs/integration.md` | 2 |
| §5.2 Kelly-Cloud forwarder; Hollow signal | 12, 14 (Hollow direct: ruling P1) |
| §5.3 rules, dedupe, seeded rules | 0, 1, 2 (modes: ruling P4) |
| §5.4 meetings from Knocturn ID, review, accept → tasks + decisions | 3, 9, 13 (RAID from meetings: Phase 3, ruling P8) |
| §5.5 needs-reply email → task; forward-to address; Bell via forwarding | 4, 12, 17 (scheduled triage: ruling P5) |
| §5.6 deep links | 2 (source_url), 15, 16 (unique links) |
| §6 Inbox view, Today strip, Weekly review, Settings (sources, push, email) | 7, 8, 10 |
| §9 Web Push, cron digest/overdue/nudges/milestone/weekly review, quiet hours, switches, immediate pushes | 5, 6, 7 (APNs: Phase 4, ruling P9) |
| §12 rate limit on `/api/inbox`, constant-time secrets, audit | 2 |
| §13 step 2 list | all |

Not in Phase 2 (listed so nobody builds them early): APNs and native shells (Phase 4), Kelly's agent scopes and brief (Phase 5), RAID log and documents table (Phase 3), commitment detection in sent mail (v2).
