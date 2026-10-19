# Compass, v1 design

*Decided with Vlad on 2026-10-19. The full scope list, with v2 and later items, is `docs/compass-features.md`. This
spec covers v1 only. Previews: `docs/previews.html`.*

Compass is the Knocturn Labs task and project-management app: one place for personal and work tasks across three
horizons, a board, projects with PM governance, tasks that other Knocturn apps create by themselves, a meeting review
fed by SonarFlow, a PM copilot on Claude or Gemini with an offline library, and document generation. Single user.
Web, Mac, iPhone, iPad, Android, with push on all of them.

- Domain: `compass.knocturnlabs.com`. Knocturn ID app id: `compass`.
- Accent: ivory `#EDE3C9`. Everything else from Hollow's DESIGN.md (copied to `assets/brand/DESIGN.md` in Phase 1).
- Interface language English. Content is whatever the user writes, French or English.

## 1. Architecture

```
iPhone / iPad / Android (mobile/, Capacitor, server.url = the site)      Mac (mac/, Tauri, loads the site)
                      \                         |                          /
                       web/   React + Vite + TypeScript PWA, served as Worker static assets
                                                |
                      worker/  Cloudflare Worker, Hono 4, D1 (compass-db), R2 (compass-files), cron
                                                |
   Knocturn ID (sign-in, agent scopes)   Kelly-Cloud (notification forwarder, email triage, APNs key)
   Knocturn ID transcription (meeting notes ready)      Anthropic API / Gemini API (copilot)
```

One repo, `~/Documents/Compass`:

| Dir | What |
| --- | --- |
| `worker/` | API, cron, email handler, migrations under `worker/migrations/NNNN_description.sql` |
| `web/` | The app. Plain CSS with tokens (no Tailwind), no component library. Service worker written by hand, as Kelly-Cloud's `sw.js` is. |
| `shared/` | TypeScript types for API bodies, used by both |
| `mobile/` | Capacitor project (iOS + Android) pointing at the site, like Aura's `mobile/` |
| `mac/` | Tauri shell, like Kelly's `src-tauri/` |
| `assets/brand/` | DESIGN.md, the ivory badge (hue/saturation pass on the finance badge), app icons |
| `docs/` | This spec, the feature catalogue, the previews, `integration.md` (the inbox contract other apps follow) |
| `scripts/*.test.ts` | Self-checks, run with `node --experimental-strip-types`, Health's pattern |

Standing rules, written into `CLAUDE.md` in Phase 1:

1. Settings over hardcoding: hosts, secrets, limits in `wrangler.jsonc` vars and secrets.
2. Nothing is hard-deleted from the API. Delete moves to Trash; Trash purges after 30 days by cron.
3. Notification, email and transcript text is data: fenced in prompts, never followed.
4. Every AI call names a feature, is counted against a monthly cost cap, and respects the project's data boundary.
5. Work project content is encrypted at rest (section 3).
6. No `alert()` / `confirm()`, no inline scripts (CSP), `<dialog>` for modals, edit in place.
7. Every phase ends with a commit.

## 2. Sign-in and sessions

Knocturn ID, exactly per `~/Documents/Knocturn-ID/INTEGRATION.md`: username + password + passkey, `device_id` per
install, 72-hour access tokens, single-use refresh tokens, hourly check so a revoke there ends the session here. The
Worker keeps its own session cookie (HttpOnly, SameSite=Lax) holding the encrypted Knocturn tokens, as Health does
(`src/lib/session.ts`, `checkWithId`). Passkey step-up (Health's `requireStepUp`) on: emptying Trash, changing a
project's data boundary, exporting everything, revoking Kelly's scopes.

To add the app: append `compass` to `APPS` in Knocturn-ID's `wrangler.jsonc` and redeploy. That is the only Knocturn
ID change in Phase 1.

## 3. Data model (D1)

All timestamps ISO-8601 strings from `new Date().toISOString()`. Ids are UUIDs. Every table with user content has
`created_at`, `updated_at`, `deleted_at` (Trash). Columns marked **enc** hold AES-GCM ciphertext (Health's
`crypto-box`, key `COMPASS_DATA_KEY`) when the row belongs to a project whose `kind` is `work`; personal rows are
plain. The same column is used either way; `enc_v` says which.

**projects**: id, name (enc), kind `personal|work`, status `active|on_hold|closed`, rag `green|amber|red|none`,
rag_reason (enc), sponsor (enc), objectives (enc, markdown), scope_in (enc), scope_out (enc), success_criteria (enc),
phase (free text), start_at, end_at, budget_planned, budget_spent, data_boundary `cloud|offline` (default `offline`
for work, `cloud` for personal), colour (optional), sort.

**milestones**: id, project_id, name (enc), due_at, done_at, gate `0|1` (a go / no-go), sort.

**tasks**: id, project_id (nullable), parent_id (nullable: subtask), title (enc), notes (enc, markdown), kind
`personal|work`, horizon `short|medium|long`, status `new|progress|hold|waiting|done`, priority `0..3`, start_at,
due_at, done_at, estimate_minutes, waiting_on (enc), waiting_since, nudge_every_days, recur (JSON rule or null),
source_app (`finance|health|hollow|aura|home|sonarflow|kelly|email|manual`), source_kind, source_ref (the dedupe
key, e.g. `health:medication:42`), source_url (https deep link), sort_in_column, tags (JSON array).

**task_events**: id, task_id, at, actor `you|rule|kelly|meeting`, type `created|moved|edited|comment|nudged`, data
(enc JSON). This is the activity log and the comment thread.

**raid_items**: id, project_id, type `risk|assumption|issue|dependency`, text (enc), probability `1..5`, impact
`1..5`, response (enc), owner (enc), trigger (enc), status `open|closed`, from_meeting_id.

**change_requests**: id, project_id, title (enc), description (enc), impact_scope (enc), impact_time (enc),
impact_cost (enc), decision `pending|approved|rejected`, approver (enc), decided_at.

**decisions**: id, project_id, text (enc), decided_at, from_meeting_id, at_ref (transcript reference).

**lessons**: id, project_id, text (enc), category, created_at. Personal-project lessons are indexed into
`library_fts`; work-project lessons are searched on the device (section 12).

**inbox_items**: id, app, kind (`notification|meeting|email`), title (enc), body (enc), url, payload (enc JSON),
received_at, state `new|kept|dismissed|snoozed`, snoozed_until, task_id (when kept). The "Added by your apps" strip
reads `state = 'new'`.

**rules**: id, name, app, kind, match (JSON: `suggest`, `title_regex`, `kind`), set (JSON: horizon, kind, project_id,
due_offset_days, priority), dedupe `update|skip|always`, enabled, sort. Seeded in Phase 2 with the six rules in
section 5.

**meeting_reviews**: id, recording_id, title (enc), summary (enc), decisions (enc JSON), action_items (enc JSON),
open_questions (enc JSON), important_notes (enc JSON), project_id (nullable until you pick one), state
`new|reviewed`, reviewed_at.

**library_pages**: id, slug, section, title, body (markdown), source `bundled|import`, import_doc_id. Plus
`library_fts` (FTS5 virtual table over title and body) and `lessons` joined in at query time.

**documents**: id, name, kind `pdf|docx|xlsx|md|txt`, size, r2_key, project_id (nullable), is_template `0|1`,
placeholders (JSON, for templates), text_indexed `0|1`.

**ai_threads**: id, project_id (nullable), title, provider `claude|gemini`, created_at. **ai_messages**: id,
thread_id, role, content (enc), citations (JSON), cost_micro, created_at.

**push_subscriptions**: id, platform `web|ios|android|mac`, endpoint_or_token (enc), keys (enc), device_name,
quiet_from, quiet_to, created_at, failed_count.

**settings** (one row): day_start_hour, digest_hour, quiet_from, quiet_to, weekly_review_day, ai_monthly_cap_micro,
default_provider, per-source push switches (JSON).

**audit_log**: id, at, actor, action, target, detail (enc JSON). Every rule run, every Kelly write, every AI call,
every secret-authenticated inbox post (never the secret).

## 4. API (Worker, Hono)

All routes under `/api`, session-gated unless noted. Bodies validated with a small `validate.ts` (Health's) before
binding. `secureHeaders()` with CSP, HSTS, frame deny.

| Route | What |
| --- | --- |
| `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/move` | CRUD, move = status + column position. DELETE sets `deleted_at`. |
| `POST /tasks/:id/done`, `/snooze`, `/nudge` | Done handles recurrence (creates the next occurrence); nudge logs a `nudged` event and resets `waiting_since`. |
| `GET /today` | Three horizons, overdue, new inbox items, stats, next milestones: one call for the home screen. |
| `GET /board?kind=&project=` | Columns with cards, respects WIP limits from settings. |
| `GET /timeline?project=` | Tasks with start/due and milestones for the SVG timeline. |
| `GET/POST /projects`, `GET/PATCH /projects/:id`, `/milestones`, `/raid`, `/changes`, `/decisions`, `/lessons` | Project record and governance logs. |
| `GET /portfolio` | Every active project with RAG, % done, next milestone, open risks. |
| `GET /inbox`, `POST /inbox/:id/keep`, `/dismiss`, `/snooze` | Triage. `keep` creates the task from the rule's result (or defaults) and links it. |
| `POST /inbox` | **Secret-authenticated, allowlisted in the auth guard**, section 5. |
| `GET/POST /rules`, `PATCH/DELETE /rules/:id` | Rule editor. |
| `GET /meetings`, `GET /meetings/:id`, `POST /meetings/:id/accept` | Review screen; accept takes a list of action items with edits and creates tasks + decisions. |
| `GET /library?q=`, `GET /library/:slug` | FTS search and page. |
| `POST /documents`, `GET /documents/:id`, `GET /documents/:id/file` | Upload (`checkUpload`), metadata, gated stream from R2 (`fileResponse`). Templates are documents with `is_template`. |
| `POST /ai/chat` | Copilot (section 7). |
| `POST /reports/status` | Builds the status-report data for a project and date range; the document itself is made on the device. |
| `GET /export` | Full JSON bundle (step-up). |
| `GET/POST /push/subscribe`, `DELETE /push/:id`, `GET/PATCH /settings` | |
| `GET /search?q=` | Tasks, projects, library, documents in one list. |
| `POST /email` (Worker `email()` handler, not HTTP) | Forward-to address, section 5. |

## 5. Tasks created by other apps

### 5.1 The inbox contract (`docs/integration.md`)

```
POST https://compass.knocturnlabs.com/api/inbox
Authorization: Bearer <that sender's secret>
{ "app": "finance", "kind": "notification", "title": "…", "body": "…", "url": "https://…",
  "ref": "finance:subscription:17", "suggest": "review_budget", "payload": { … } }
```

Secrets, one per sender, compared in constant time (`timingSafeEqualStr`), each only allowed to post its own `app`:
`INBOX_SECRET_KELLY` (Kelly-Cloud forwards the bus and posts email items), `INBOX_SECRET_ID` (Knocturn ID posts
meeting notes). Limits as Kelly's bus: title 1–120, body ≤ 500, url must be `https:`. Rejections logged, never
the secret. Only this route is allowlisted in the auth guard.

### 5.2 Kelly-Cloud forwarder (the one change in Kelly-Cloud)

In `src/routes/notifications.ts`, after a notification is stored: `ctx.waitUntil(forwardToCompass(row))`, a POST to
the inbox with `app` set to the original app (`finance`, `health`, `hollow`, `aura`, `home`, `nightowl`), `kind:
"notification"`, and `ref` = the notification's `url` when present, else its id. Compass's URL and secret are
`COMPASS_INBOX_URL` / `COMPASS_INBOX_SECRET` in Kelly-Cloud. Fire and forget: a lost forward is acceptable because
every source re-alerts (Health daily until refilled, Finance before each renewal). No change in Finance, Health,
Aura or Home Assistant.

**Hollow**: Phase 2 checks whether Hollow posts a "new files since your last visit" notification. If it doesn't,
Hollow's Worker gets a daily cron that posts one to Kelly's bus (`app: "hollow"`, allowed already) when the index
has files newer than the last Hollow sign-in. That is Hollow's only change.

### 5.3 Rules

Run on every inbox post. Match on `app`, optional `suggest`, optional title regex. Result: horizon, kind, project,
due offset, priority. Dedupe on `source_ref`: `update` (the default) refreshes title, body, url and due on the
existing open task and logs an event; `skip` ignores the repeat; `always` creates a new task. A matched item is
created as a task **and** stays visible in the strip for a day as "added", so you see what happened; an unmatched
item waits in the strip for keep / dismiss. Seeded rules:

| App | Match | Result |
| --- | --- | --- |
| health | any | short, personal, due = item's date or +3 days, ref dedupe |
| finance | suggest `pay_bill` | short, personal, due = renewal date |
| finance | suggest `review_budget` or title contains "subscription" | short, personal, due +5 days |
| hollow | any | short, personal, no due |
| aura, home | any | short, personal, due +7 days |
| kelly (email) | kind `email`, label `needs_reply` | short, waiting on = sender, due +2 days, kind from the account (work or personal) |

### 5.4 Meetings (Knocturn ID, one change)

In Knocturn ID's `transcription.ts`, when a meeting reaches `done` and notes are saved: POST to the inbox with
`app: "sonarflow"`, `kind: "meeting"`, `ref: "sonarflow:recording:<id>"`, `url` = the SonarFlow-Web page for that
recording, and `payload` = the notes JSON (title, summary, decisions, action_items, important_notes, open_questions).
Compass stores a `meeting_reviews` row and pushes "Meeting notes ready: <title>". The review screen shows the summary,
decisions, action items as suggested tasks (owner, due, transcript minute, accept / edit / dismiss), open questions as
suggested follow-ups. Accepting writes tasks (`source_app: sonarflow`, `source_url` = recording page with `#t=<ref>`),
decisions, and optional RAID entries, all linked by `from_meeting_id`. Meeting payloads are work data unless you
file the meeting under a personal project, so they are encrypted and never sent to a cloud model while the project's
boundary is `offline`.

### 5.5 Email

- **Needs-reply → task**: after Kelly-Cloud's inbox triage runs, it posts each `needs_reply` message to the Compass
  inbox (`app: "kelly"`, `kind: "email"`, `ref: "<provider>:<message id>"`, title = subject, body = sender + the
  12-word gist, `url` = the message's web link, `payload.account` tells personal from work). Kelly-Cloud change: one
  POST at the end of `inbox.ts`'s triage. Email bodies never leave Kelly-Cloud.
- **Forward-to address**: Cloudflare Email Routing sends `compass@knocturnlabs.com` to the Worker's `email()`
  handler. Accepted only from the sender addresses listed in `ALLOWED_FORWARDERS` (your personal and Bell
  addresses); anything else is dropped and logged. The subject becomes the title, the text body is stored as the
  task's notes, the raw `.eml` goes to R2 as an attachment. Kind `work` when the forwarder is the Bell address.
- **Bell**: no OAuth to the Bell tenant. The forward-to address is the work-email path. Decided 2026-10-19.

### 5.6 Deep links

`source_url` is always an https link to the exact row in the source app (the subscription, the medication, the Hollow
folder, the Aura device, the recording). The task card shows the source chip; tapping it opens the url. The
Capacitor shells open these hosts in the system browser, which hands them to the installed app when that app
registers universal links (Hollow and Aura already do; Finance and Health open on the web). No per-app URL mapping in
Compass.

## 6. Views (web, v1)

| View | Notes |
| --- | --- |
| Today | As previewed: horizons, Added-by-your-apps strip, Kelly's brief (from Kelly-Cloud's daily brief when she has the `compass` scope, else Compass's own one-paragraph summary), overdue, stats. Phone: Today, Board, Projects, Kelly, More in the tab bar. |
| Inbox | The full triage list (the strip shows the first four). Keyboard: `k` keep, `d` dismiss, `s` snooze, `e` edit before keeping. |
| Board | Five columns, drag and drop (pointer events, no library), WIP limit per column from settings, swimlanes by project or by kind, filter Personal / Work / All, saved views. |
| List | Table with sort, group, filter; saved views stored in settings. |
| Calendar | Month and week, drag to reschedule, Kelly's calendar events overlaid read-only (via Kelly-Cloud's calendar route when the scope exists, Phase 5). |
| Timeline | SVG: a row per task with start and due (tasks with only a due date show as a diamond), milestones as diamonds on the project row, today line, zoom day / week / month, drag a bar to move it, drag its end to resize. Dependencies, baselines and critical path are v2. |
| Upcoming | Next 14 days, grouped by day. |
| Projects, Project | Portfolio list; project page with record, milestones, RAID, change requests, decisions, lessons, meetings, documents, timeline tab. |
| Library | Tree by section, search, page view, "Ask about this page". |
| Copilot | As previewed. |
| Weekly review | A guided screen on the day you set: inbox to zero, overdue, next week's due, each horizon reviewed, one Done button. |
| Settings | Sources and rules, push and quiet hours, AI providers and caps, data boundary defaults, Kelly's scopes (links to Knocturn ID), devices, export, Trash. |
| Command palette | `⌘K`: quick add with natural-language date and tags, jump to anything, run actions. |

Quick-add grammar: `title [#project] [@work|@personal] [!1-3] [date words]`. Date words: today, tomorrow, mon…sun,
next week, in N days, a date like `oct 24` or `24/10`, `every day|week|month`.

## 7. Copilot, library, documents

**Providers**: `POST /api/ai/chat` with `{ threadId?, projectId?, provider, message }`. Claude uses
`claude-sonnet-5` by default (the model Knocturn ID's notes use; `AI_MODEL_CLAUDE` var), Gemini uses `AI_MODEL_GEMINI`.
Keys are Worker secrets. Every call names a feature (`copilot`, `status_report`, `plan_review`, `brief`), is logged
with its cost, and is refused with a clear message when the month's cap is reached.

**Data boundary**: when the thread's project has `data_boundary = offline`, the route refuses the cloud call and the
UI shows the Offline mode instead: library search results for the message, matching templates, and your saved
answers. A personal thread with no project is `cloud`. Changing a project's boundary needs the passkey step-up.

**Context**: system prompt = the copilot's role + the library pages retrieved by FTS for the message (top 6, with
slugs so the model can cite them) + the project's record and open items as a fenced data block + the last 20 messages.
Notification, email and transcript text inside that block is fenced as data. Answers end with a `citations` list of
slugs the UI turns into chips; one tap opens the page.

**Actions from an answer**: the model may return a `proposals` block (tasks with title, horizon, due; RAID entries;
decisions). The UI shows them as checkboxes; nothing is written until you tap "Add to the board". Model output is
checked against the schema before use.

**Use-case mode**: a preset prompt ("Describe the situation; I'll answer with a diagnosis, options with trade-offs, a
recommended plan with dated tasks, who to inform, and risks to log"). Other presets: plan from scope, review this
plan, status report, exception report, escalation note, prepare for a difficult conversation.

**Library**: Markdown pages under `worker/library/` bundled into D1 by a migration script (`npm run library:sync`),
cached on the device by the service worker as one JSON bundle so search works offline (a small inverted index built
on the client, no library). Sections and first pages are in `docs/compass-features.md` section 9. Written as
summaries in our own words; no copyrighted text. Your imports go through Kelly-Cloud's document pipeline when you
choose "index with Kelly", else plain text extraction in the Worker (PDF via `unpdf`, docx via `fflate` + XML, as
Kelly does) into `library_pages` with `source = 'import'`.

**Documents**: generated on the device. Markdown natively; Word with the `docx` package; PDF through the browser's
print pipeline with a print stylesheet (the Mac and web); templates with `docxtemplater` reading `{{…}}` placeholders
from an uploaded `.docx`, filled from a `report model` (`project`, `milestones`, `risks`, `tasks`, `status`,
`decisions`, `meetings`, each with `.table` and `.list` renderings) and `{{ai.summary}}`-style fields that the
copilot writes on request. Built-in Word templates for v1: charter, RAID log, RACI, WBS outline, status report,
change request, exception report, lessons learned. Excel and PowerPoint are v2.

## 8. Offline and sync

- Service worker caches the app shell and the library bundle (cache name bumped per deploy, Kelly-Cloud's pattern).
- An IndexedDB store (hand-written wrapper, ~100 lines) mirrors tasks, projects, milestones, inbox, rules and settings.
  Reads come from IndexedDB first, then refresh from the network.
- Writes go to IndexedDB and a queue; the queue replays on reconnect. Conflict rule: single user, last write wins
  by `updated_at`; the server returns the winning row and the client replaces its copy.
- The copilot, uploads and push subscriptions are online only and say so.

## 9. Push and cron

Compass sends its own pushes; no runtime dependency on Kelly.

- **Web Push** (site, Android via the PWA or the Capacitor shell's web view): VAPID keys as secrets, Finance's `push.ts`
  reused.
- **APNs** (iPhone, iPad, Mac): Kelly-Cloud's `apns.ts` reused with the same Apple key; the Capacitor and Tauri
  shells register the token with `POST /push/subscribe`.
- **Cron** (`scheduled()`, every 15 minutes): due-today digest at `digest_hour`, overdue notice once a day, waiting-on
  nudges when `nudge_every_days` has passed, milestone in 7 days, weekly review on its day, Trash purge, audit-log and
  inbox purge after 90 days. Each push type has a switch in settings and respects quiet hours.
- Immediate pushes: app-created task (from a rule), meeting notes ready.

## 10. Kelly (Phase 5)

Compass becomes a resource in Knocturn ID agent access (INTEGRATION.md §14), implemented the way SonarFlow-Web
implements the SonarFlow side: scopes `tasks:read`, `tasks:write`, `projects:read`, each granted in Compass's Settings,
every call logged to `audit_log`, no delete scope. Kelly-Cloud gets the matching tools: list today's tasks, add a
task, mark done, and the daily brief includes the day's horizon. Kelly's writes carry `actor: kelly` in the events.

## 11. Platforms

- **Web**: PWA, installable, keyboard first, 44px targets, focus rings, reduced motion respected, prints cleanly.
- **Mac** (Tauri): the site in a window plus a menu-bar quick add (global hotkey), native notifications, APNs via
  the Tauri plugin. Signed with the Apple developer account.
- **iPhone / iPad / Android** (Capacitor): `server.url` = the site, push plugin, share sheet to quick add. Universal
  links for `compass.knocturnlabs.com`. Widgets and Siri are v2.

## 12. Security and privacy

- CSP without inline scripts, `secureHeaders()`, request bodies validated, uploads checked and streamed privately
  from R2, constant-time secret compare, rate limit on `/api/inbox` (60/min) and `/api/ai/chat` (30/hour).
- Work rows encrypted at rest (section 3). The search index for work content is built on the device, not in D1 FTS,
  so plaintext never sits in a server index. Personal content uses D1 FTS.
- Data boundary per project; work defaults to `offline`. The AI route enforces it server-side, not just in the UI.
- Audit log of automations, Kelly writes, AI calls and inbox posts. Export bundle behind the passkey step-up.

## 13. Build order (v1)

Each phase is one implementation plan and ends with a commit and a deploy to the preview URL
(`wrangler versions upload`), production on your word.

1. **Foundation**: repo, `CLAUDE.md`, DESIGN.md, Worker + D1 + migrations, Knocturn ID sign-in, tasks, projects,
   milestones, Today, Board, List, Upcoming, Timeline (basic), command palette with quick add, Trash, settings,
   offline store and sync, PWA.
2. **Sources**: inbox route and contract, rules, Kelly-Cloud forwarder, Hollow signal if needed, meeting review
   from Knocturn ID, email forward-to address and Kelly needs-reply posts, deep links, Web Push, cron, weekly review.
3. **PM**: project page with RAID, change requests, decisions, lessons; portfolio; library bundle and search;
   copilot (Claude, Gemini, offline, data boundary, proposals to board); documents and templates; status report.
4. **Shells**: Capacitor iOS and Android, Tauri Mac, APNs, share sheet, universal links, store-ready icons.
5. **Kelly**: agent scopes, Kelly-Cloud tools, brief, calendar overlay.

## 14. Testing

- `scripts/*.test.ts` self-checks for every non-trivial module: rules matching and dedupe, quick-add parser,
  recurrence, inbox auth (no header 401, wrong secret 401, app mismatch 403), data-boundary refusal, crypto round
  trip, sync conflict rule, timeline date math, docx template fill. Run with `node --experimental-strip-types`.
- `npm run typecheck` (`tsc --noEmit`) in Worker and web.
- Smoke: `wrangler dev` + a `scripts/smoke.sh` that signs in with a test Knocturn ID session, posts an inbox item
  with the Kelly secret, and checks it appears in `/api/today`.
- Manual on each phase: the preview URL on the phone and the Mac, one offline round trip (airplane mode, add a task,
  reconnect, see it on the other device).

## 15. Out of v1 (listed so nobody builds them early)

Dependencies, baselines, critical path, workload, dashboards, WBS editor, stakeholder register, programs, sprints,
OKRs, time tracking, custom fields, task templates, Excel and PowerPoint generation, PowerPoint templates,
commitment detection in sent mail, widgets, Siri, kiosk card, local on-Mac model, Jira import. All in
`docs/compass-features.md` with their tier.
