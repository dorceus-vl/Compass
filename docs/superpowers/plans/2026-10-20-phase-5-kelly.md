# Compass Phase 5 (Kelly) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kelly can read today's Compass tasks and projects, add a task and mark one done (by voice or chat, with her usual confirm step for writes); Vlad grants each permission in Compass's Settings and can see every call Kelly made; Today shows Kelly's brief when she's connected; a new Calendar view shows tasks by day with Kelly's calendar events overlaid; personal library imports can also be indexed by Kelly.

**Architecture:** Compass is the authority for its own data. A secret-authenticated agent API (`/api/agent/*`, the inbox's pattern: one bearer secret per caller, constant-time compare, exempt from the session and same-origin checks) checks the scopes Vlad granted in Settings on every call, filters out anything from Offline-only or work-without-cloud projects, caps writes, writes `task_events` with `actor: 'kelly'` and an `audit_log` row per call. Kelly-Cloud gets a Compass client and tools (fenced like its SonarFlow tools, writes through Confirm-Before-Acting), plus two small secret-gated relay routes that Compass's Worker calls server-to-server: Kelly's brief and her calendar for a date range, and one intake route for documents. No Knocturn ID change.

**Tech Stack:** As before; no new dependency in either repo.

**Spec:** `docs/superpowers/specs/2026-10-19-compass-design.md` §10 (Kelly), §6 (Today brief, Calendar), §2 (passkey step-up on revoking Kelly's scopes), §12 (audit of Kelly writes), §13 step 5; catalogue §10. Outside references (read only): `~/Documents/Kelly-Cloud/src/lib/knocturn-agent.ts`, `src/lib/kelly-agent.ts` (TOOLS, WRITE_TOOLS, executeReadTool, SONARFLOW fence and taint), `src/lib/write-action-executors.ts`, `src/lib/today.ts`, `src/lib/show.ts`, `src/routes/home-relay.ts` (secret-header relay pattern), `src/lib/documents.ts` (`addDocument`), `scripts/verify-sonarflow-*.ts`; `~/Documents/Knocturn-ID/INTEGRATION.md` §14 (why it isn't reused, ruling K1).

## What exists today (verified 2026-10-20)

| Fact | Where |
| --- | --- |
| Knocturn ID's agent access (§14) keeps grants, codes, audit and the resource's data checks inside Knocturn ID; `RESOURCE = 'sonarflow'` is hardcoded; there is no introspection endpoint | `Knocturn-ID/src/index.ts` ~1700–2100, `migrations/0010_agent_access.sql` |
| Kelly-Cloud's agent client (`knocturn-agent.ts`) is built around that flow; its SonarFlow tools are fenced (`SONARFLOW_READS`, `fenceSonarflow`) and withdraw web tools after a read; writes go through `WRITE_TOOLS` + Confirm-Before-Acting + `WRITE_ACTION_EXECUTORS` | `Kelly-Cloud/src/lib/kelly-agent.ts`, `write-action-executors.ts` |
| Kelly has no single "daily brief"; her day comes from `src/lib/today.ts` (`/api/today/agenda`: events + Todoist) and the Morning Show `day` segment (`show.ts`); calendar events (`CalendarCardEvent`) only for today through routes; `eventsBetweenDays(from, to)` exists internally | Kelly-Cloud |
| Kelly's document pipeline (`addDocument`) extracts, encrypts and embeds passages; it never returns text, so it can't feed Compass's library | `Kelly-Cloud/src/lib/documents.ts` |
| Compass: `task_events.actor` already allows `kelly`; `SourceApp` has `kelly`; `addEvent(env, task, actor, …)` exists but `completeTask()` hardcodes `you`; `audit()` exists with no viewer; the brief route's `shared()` filter already keeps Offline-only and work items out of AI | `worker/migrations/0002_core.sql`, `worker/routes/tasks.ts`, `worker/lib/db.ts`, `worker/routes/ai.ts` |
| Compass has no Calendar view | `web/src/views/` |
| Live code is on branch `phase-4-shells` (not `main`); this phase branches from it | git |

## Who does what

| # | Only Vlad | When | How long |
| --- | --- | --- | --- |
| 1 | Say "deploy" for Compass and Kelly-Cloud (Task 6); the two new secret pairs are generated into `.secrets/compass-inbox.env` and put on both Workers in that step with your yes | After Task 5 | 1 min |
| 2 | In Compass → Settings → Kelly, turn on the permissions you want (each change asks for your passkey) | After deploy | 1 min |
| 3 | Ask Kelly "what's on my Compass today?", "add a task to call the vendor Friday", "mark it done" | After deploy | 5 min |

## Global Constraints

- Everything from Phases 1–4 holds (tokens, CSP, step-up, no hard delete, encrypted work rows, reduced motion, 44 px, no work content in pushes, every AI call through `runAi`).
- **Data boundary:** Kelly is a cloud AI. The agent API only ever returns or touches tasks with no project that are personal, and tasks or projects whose `data_boundary = 'cloud'` (the brief route's `shared()` rule). Everything else is invisible to Kelly: not listed, not counted by name, not completable, not a valid target project.
- **Scopes** (stored in settings, named in Knocturn ID's format for later compatibility): `compass:read.tasks`, `compass:write.tasks`, `compass:read.projects`. No delete scope; Kelly can never trash, edit a title, or reopen a task. All off until Vlad turns them on. Changing any scope needs the passkey step-up (spec §2). A master "Kelly can use Compass" switch turns all off at once (also step-up).
- **Agent API auth:** `Authorization: Bearer <AGENT_SECRET_KELLY>`, constant-time compare, a missing secret never matches; only `/api/agent/*` uses it; rate limit 60 calls a minute and 30 writes an hour (counted from `audit_log` rows with actor `kelly`); every call (allowed or refused) writes one `audit_log` row (`actor 'kelly'`, action `agent.<route>`, target id, detail without task text).
- **Kelly's writes** carry `actor: 'kelly'` in `task_events`, `source_app: 'kelly'` on tasks she creates.
- **Relay calls Compass makes to Kelly-Cloud** (brief, calendar, document intake) send `X-Relay-Secret: <KELLY_RELAY_SECRET>` server-to-server; nothing from Kelly-Cloud is rendered as HTML; calendar and brief text are data.
- Outside repo: Kelly-Cloud only, branch `compass-phase-5` from its `main`; never deploy, push or put secrets; follow its CLAUDE.md and its verify-script pattern.
- No new dependency. Commit trailer: the implementer's own model line.

## Rulings made while writing this plan

- **K1 Compass is the authority, not Knocturn ID's agent access** (spec §10 says "a resource in Knocturn ID agent access"). §14's machinery assumes the resource's data lives in Knocturn ID (SonarFlow's does); reusing it for Compass means rewriting SonarFlow's live, hardcoded agent code and adding a proxy or an introspection endpoint. Compass's own secret-authenticated API delivers what §10 asks (per-scope grants in Compass Settings, every call logged, no delete scope, instant revocation, passkey on changes) with no Knocturn ID change. Cost if wrong: if more agents or users arrive, the API moves behind Knocturn ID agent tokens later; the scope names already use §14's format.
- **K2 Kelly's brief** comes from a new Kelly-Cloud relay route `GET /api/compass-relay/brief?date=` that returns one short paragraph Kelly writes from her calendar for the day plus Compass's shared items (through the agent API, so the same boundary applies), cached per day in Kelly-Cloud and counted in Kelly's own AI budget. Compass shows it on Today with the eyebrow "Kelly" when the relay answers; otherwise Compass's own brief, as today.
- **K3 Calendar overlay** comes from `GET /api/compass-relay/calendar?from=&to=` (at most 62 days) built on Kelly-Cloud's `eventsBetweenDays`; Compass proxies it at `GET /api/kelly/calendar` (session-gated) and caches it in IndexedDB `meta` for offline reading.
- **K4 "Index with Kelly"** becomes "Also let Kelly search it": on importing a personal document to the library, Compass can send its bytes to `POST /api/compass-relay/documents` (Kelly-Cloud runs `addDocument`); Compass's own extraction stays the library's source (Kelly's pipeline returns no text).
- **K5 Kelly's daily day** includes Compass: Kelly-Cloud's `today.ts` agenda (and so the Morning Show `day` segment) adds Compass's shared tasks for today next to Todoist's, when the read scope is on.
- **K6 The Calendar view** is month and week, tasks on their due date (overdue on today), drag a task to another day to reschedule (through the offline queue), Kelly's events read-only; in the Phase 3b style (cards with accents, lens off — grid layout).

## File map

| Path | Responsibility |
| --- | --- |
| `worker/lib/agent.ts`, `scripts/agent.test.ts` | Pure: scope checks, the shared-item filter, input validation, rate/write-cap decisions |
| `worker/routes/agent.ts` | `/api/agent/today`, `/tasks`, `/tasks/:id/done`, `/projects` (secret-authenticated) |
| `worker/routes/kelly.ts` | Session routes: Kelly settings (scopes, step-up), activity log, brief and calendar proxies, document hand-off |
| `worker/middleware/auth-guard.ts`, `worker/types.ts`, `shared/types.ts`, `wrangler.jsonc` | Carve-out, secrets/vars, `Settings.kelly` |
| `web/src/views/Settings.tsx` (Kelly card), `web/src/views/KellyLog.tsx`, `web/src/views/Today.tsx`, `web/src/views/Calendar.tsx`, `web/src/ui/Shell.tsx`, `web/src/router.ts` | UI |
| `scripts/setup-phase2.sh` → extended (or `scripts/setup-secrets.sh`) | Generates `AGENT_SECRET_KELLY` and `KELLY_RELAY_SECRET` |
| Kelly-Cloud: `src/lib/compass-agent.ts`, `kelly-agent.ts`, `write-action-executors.ts`, `today.ts`, `src/routes/compass-relay.ts`, `src/middleware/auth-guard.ts`, `scripts/verify-compass-*.ts` | Kelly's side |

---

### Task 0: The agent API in Compass

**Files:** Create `worker/lib/agent.ts`, `worker/routes/agent.ts`, `scripts/agent.test.ts`; modify `worker/middleware/auth-guard.ts`, `worker/index.ts`, `worker/types.ts` (`AGENT_SECRET_KELLY?`), `worker/routes/tasks.ts` (`completeTask(env, id, actor = 'you')`), `shared/types.ts` (`Settings.kelly: { enabled: boolean; scopes: AgentScope[] }`, default `{ enabled: false, scopes: [] }`; `AgentScope`), `scripts/smoke.sh`, `docs/integration.md` (an "Agent API" section)

**Interfaces:**
- `agent.ts` (pure): `AGENT_SCOPES = ['compass:read.tasks', 'compass:write.tasks', 'compass:read.projects'] as const`; `allowed(settings: Settings['kelly'], scope): boolean` (enabled and scope listed); `shared(task, project | null): boolean` (no project and kind personal, or project live with `data_boundary 'cloud'`); `parseNewTask(body): { title; due_at: string | null; horizon: Horizon; project_id: string | null; notes: string | null } | { error }` (title 1–120 trimmed, due `YYYY-MM-DD`, notes ≤ 2000, horizon default `short`); `overLimit(callsLastMinute, writesLastHour, isWrite): 'rate' | 'writes' | null` (60 / 30).
- Routes (all under `/api/agent`, bearer secret, JSON):
  - `GET /today` (`read.tasks`) → `{ date, due_today: AgentTask[], overdue: AgentTask[], waiting: AgentTask[], next_milestones: { name, project, due_at }[], hidden: number }` — `AgentTask = { id, title, due_at, horizon, status, project: string | null, priority }`, decrypted, shared items only; `hidden` counts items left out by the boundary (a number, never names).
  - `GET /tasks?view=today|overdue|upcoming|waiting&limit=` (`read.tasks`), same shape, limit ≤ 50.
  - `POST /tasks` (`write.tasks`) → 201 `{ task: AgentTask }`; a `project_id` must be a shared project; the task is personal unless its project is work-and-cloud (then sealed as work); `source_app 'kelly'`, event `created` by `kelly`.
  - `POST /tasks/:id/done` (`write.tasks`) → `{ task }`; only a shared, open task; recurrence handled as for Vlad; event by `kelly`.
  - `GET /projects` (`read.projects`) → `{ projects: { id, name, rag, rag_reason, pct_done, next_milestone, open_risks }[] }`, shared projects only.
  - Refusals: 401 bad secret (no audit detail beyond "bad secret"); 403 `{ error: 'scope_not_granted', scope }`; 403 `{ error: 'kelly_disabled' }`; 404 for a task or project Kelly can't see (same as missing); 429 `{ error: 'rate_limited' | 'write_limit' }`.
- [ ] **Step 1: Failing test `scripts/agent.test.ts`** for `allowed`, `shared` (personal no project ✓; work no project ✗; project offline ✗; project cloud ✓; trashed project ✗), `parseNewTask` (limits, defaults, bad date), `overLimit` (60th call ok, 61st rate; 30th write ok, 31st writes).
- [ ] **Step 2:** Implement `agent.ts`, then the routes; auth-guard carve-out for `/api/agent/*` exactly like `POST /api/inbox` (before the session and same-origin checks); `completeTask` gains the actor.
- [ ] **Step 3: Smoke** (`AGENT_SECRET_KELLY` in `.dev.vars`): wrong secret 401; scopes off → 403 `kelly_disabled`; enable read only (directly in local D1 settings) → `/today` lists a personal task and leaves out a work-offline task while `hidden` counts it; `POST /tasks` → 403 `scope_not_granted`; enable write → create (201, `source_app kelly`, event actor `kelly`), done (200); done on a hidden task → 404; `audit_log` has one row per call with actor `kelly`; 31 writes in an hour → 429.
- [ ] **Step 4: Commit** `Phase 5 Task 0: agent API`.

### Task 1: Kelly in Compass's Settings, the activity log, Kelly's brief on Today

**Files:** Create `worker/routes/kelly.ts`, `web/src/views/KellyLog.tsx`; modify `web/src/views/Settings.tsx`, `web/src/views/Today.tsx`, `web/src/router.ts`, `worker/index.ts`, `worker/types.ts` (`KELLY_RELAY_URL` var, `KELLY_RELAY_SECRET?`), `wrangler.jsonc` (`KELLY_RELAY_URL: "https://kelly.knocturnlabs.com/api/compass-relay"`)

**Interfaces:** `GET /api/kelly` → `{ enabled, scopes, last_call_at, calls_today, relay: boolean }`; `PUT /api/kelly { enabled?, scopes? }` (passkey step-up; audit `kelly.scopes` with before/after); `GET /api/kelly/log?before=&limit=` → audit rows with actor `kelly` (newest first, 100 max, detail shown as structured fields, never HTML); `GET /api/kelly/brief?date=` → proxies the relay with the secret, `{ text, generated_at } | { unavailable: true }`, 5 s timeout, cached in the Worker per date for 1 hour.

- [ ] **Step 1:** Routes.
- [ ] **Step 2: Settings → Kelly card** (Phase 3b style, an icon, one line of help): the master switch and three permission switches ("See your shared tasks", "Add and complete tasks", "See your shared projects"), each change through `api()` (passkey prompt), a line saying what "shared" means (personal tasks and cloud-AI projects; Offline-only stays private), last call and calls today, "See Kelly's activity" → `/kelly/log`.
- [ ] **Step 3: Activity log screen**: a list of Kelly's calls (time, action in words — "Listed today's tasks", "Added a task", "Completed a task", "Refused: no permission" — and a link to the task when it still exists).
- [ ] **Step 4: Today's brief card**: when `/api/kelly/brief` answers, the card shows Kelly's paragraph with the eyebrow "Kelly"; otherwise Compass's own brief exactly as now; cached for the day in `meta`.
- [ ] **Step 5:** Screenshots (375/1280) of the Kelly card, the log, Today with a stub brief (a local stub relay via `KELLY_RELAY_URL` pointing at a tiny local handler in the smoke, or a test double). **Commit** `Phase 5 Task 1: Kelly settings, activity, brief`.

### Task 2: Calendar view

**Files:** Create `web/src/views/Calendar.tsx`, `web/src/calendar-math.ts`, `scripts/calendar.test.ts`; modify `worker/routes/kelly.ts` (`GET /api/kelly/calendar?from=&to=` proxy, ≤ 62 days, 5 s timeout), `web/src/router.ts`, `web/src/ui/Shell.tsx` (Calendar in the rail after Upcoming; on the phone in More), `web/src/app.css`

**Interfaces:** `calendar-math.ts` (pure, tested): `monthGrid(year, month, weekStartsMonday = true): string[][]` (6 rows × 7 ISO dates), `weekDays(anyDate): string[]`, `placeTasks(tasks, days, today): Record<string, Task[]>` (due date; overdue open tasks on today), `placeEvents(events, days)`.

- [ ] **Step 1:** Test then `calendar-math.ts`.
- [ ] **Step 2: Calendar screen** (ruling K6): Month / Week switch, previous / next / Today, each day a cell with task chips (accent colour, swipe-free; click opens the task sheet) and Kelly's events (dim, with time, read-only, "Kelly · Google" label); drag a task chip to another day → `updateTask(id, { due_at })` through the queue; keyboard: arrows move focus between days, Enter opens the day; phone: week view by default, month as dots.
- [ ] **Step 3:** Offline: tasks from the mirror; events from the cached proxy answer.
- [ ] **Step 4:** Screenshots (375/1280, month and week, a drag mid-way). **Commit** `Phase 5 Task 2: calendar`.

### Task 3: Kelly-Cloud: Compass tools and her day

**Files (Kelly-Cloud, branch `compass-phase-5`):** Create `src/lib/compass-agent.ts`, `scripts/verify-compass-tools.ts`, `scripts/verify-compass-data-fence.ts`; modify `src/lib/kelly-agent.ts`, `src/lib/write-action-executors.ts`, `src/lib/today.ts`, `src/types.ts` (`COMPASS_AGENT_URL` var = `https://compass.knocturnlabs.com/api/agent`, `COMPASS_AGENT_SECRET?`), `wrangler.jsonc`, the system prompt paragraph

- [ ] **Step 1: Client** `compass-agent.ts`: `compassCall(env, method, path, body?)` with the bearer secret, 8 s timeout, errors turned into sentences Kelly can say ("Compass hasn't given me permission to add tasks. You can turn it on in Compass → Settings → Kelly."), no secret in logs.
- [ ] **Step 2: Tools** (copy the SonarFlow pattern exactly): `compass_today` (read), `compass_tasks` (read, view), `compass_projects` (read), `compass_add_task` and `compass_complete_task` (writes: `WRITE_TOOLS`, confirm summaries built from what Compass says it wrote, executors in `write-action-executors.ts`); a `COMPASS_READS` set with `fenceCompass` and the same taint rule as SonarFlow (after a Compass read, web tools are withdrawn and writes always ask); the system-prompt line; not in `PUBLIC_TOOLS`.
- [ ] **Step 3: Her day** (ruling K5): `today.ts` adds Compass's shared due-today and overdue tasks next to Todoist's when `compass_today` succeeds (silently skipped when not permitted or unreachable), so the agenda and the Morning Show `day` segment include them.
- [ ] **Step 4:** `scripts/verify-compass-tools.ts` (stubbed fetch: tool shapes, confirm summaries, error sentences) and `verify-compass-data-fence.ts` (a task title with instructions stays fenced; web tools withdrawn after a read). Kelly-Cloud's own checks pass. **Commit** in Kelly-Cloud: `Compass tools for Kelly (prepared, not deployed)`.

### Task 4: Kelly-Cloud relay routes and Compass's document hand-off

**Files:** Kelly-Cloud: create `src/routes/compass-relay.ts`, `scripts/verify-compass-relay.ts`; modify `src/index.ts` (mount), `src/middleware/auth-guard.ts` (public prefix `/api/compass-relay/*`, secret-checked in the route), `src/types.ts` (`COMPASS_RELAY_SECRET?`). Compass: modify `worker/routes/library.ts` (import gains `also_kelly?: boolean`), `worker/routes/kelly.ts`, `web/src/views/project/Documents.tsx` and the Settings unfiled documents (the checkbox).

- [ ] **Step 1: Relay routes** (`X-Relay-Secret` = `COMPASS_RELAY_SECRET`, `timingSafeEqualStr`, home-relay's pattern): `GET /brief?date=` (ruling K2: one paragraph from her calendar for that date plus `compass_today`, via her usual model and budget, cached per date for 6 hours; `{ text, generated_at }`), `GET /calendar?from=&to=` (ruling K3: `eventsBetweenDays`, ≤ 62 days, `{ events: { title, start, end, all_day, location, source }[] }`, no guests), `POST /documents` (ruling K4: raw bytes ≤ 20 MB, `X-File-Name`, runs `addDocument`, never sensitive-flagged; `{ id }`).
- [ ] **Step 2: Compass hand-off:** a personal document's library import can carry `also_kelly: true`; the Worker then streams the bytes to the relay `POST /documents` (work documents never; Offline-only projects never); the UI's checkbox "Also let Kelly search it" appears only where import is allowed.
- [ ] **Step 3:** `verify-compass-relay.ts` (bad secret 401, range limit, shapes); Compass smoke uses a local stub relay for the hand-off. Commits in both repos.

### Task 5: Secrets, docs, full run

- [ ] **Step 1:** The setup script generates `AGENT_SECRET_KELLY` (Compass) = `COMPASS_AGENT_SECRET` (Kelly-Cloud) and `KELLY_RELAY_SECRET` (Compass) = `COMPASS_RELAY_SECRET` (Kelly-Cloud) into `.secrets/compass-inbox.env`; `--put` sets Compass's; the Kelly-Cloud puts are listed for Task 6.
- [ ] **Step 2:** `CLAUDE.md` Phase 5 section; `docs/integration.md` agent API section; Kelly-Cloud's docs line.
- [ ] **Step 3:** Full local runs in both repos (Compass typecheck, check, build, smoke; Kelly-Cloud typecheck and its verify scripts). **Commit** `Phase 5 Task 5: secrets, docs, full run`.

### Task 6: Deploy (Vlad's word) and live check

- [ ] **Step 1: Stop and ask Vlad** for "deploy" (Compass from `phase-5-kelly`, Kelly-Cloud from `compass-phase-5`, the four secret puts).
- [ ] **Step 2:** After his yes: note versions; deploy Compass, put its two secrets; deploy Kelly-Cloud (live version must match its `main` first), put its two secrets; check `/api/agent/today` without the secret → 401 and with Kelly's scopes off → 403; the relay without the secret → 401.
- [ ] **Step 3:** With Vlad: turn on the permissions, ask Kelly for today's Compass tasks, add one, complete it; see the calls in the activity log; Today shows Kelly's brief; Calendar shows her events.
- [ ] **Step 4:** `docs/phase-5-verification.md`; merge `compass-phase-5` into Kelly-Cloud's `main` with `--ff-only` after the check.

## Spec coverage (self-review)

| Spec | Task |
| --- | --- |
| §10 scopes `tasks:read`, `tasks:write`, `projects:read`, granted in Compass Settings, no delete | 0, 1 (ruling K1, §14 names) |
| §10 every call logged to `audit_log` | 0, 1 |
| §10 Kelly tools: list today's tasks, add a task, mark done | 0, 3 |
| §10 the daily brief includes the day's horizon | 3 (K5), 4 (K2) |
| §10 Kelly's writes carry `actor: kelly` | 0 |
| §2 passkey step-up on revoking Kelly's scopes | 1 |
| §6 Today: Kelly's brief when she has the scope, else Compass's | 1 (K2) |
| §6 Calendar: month and week, drag to reschedule, Kelly's events read-only | 2, 4 (K3, K6) |
| Phase 3 R9 "index with Kelly" | 4 (K4) |

Not in Phase 5: Knocturn ID agent tokens for Compass (K1), more agents or users, Kelly editing or deleting tasks.
