# Compass v2.1 (Day-to-day PM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three features Vlad will use every day at Bell:
- **dependencies** between tasks (blocked by / blocks);
- **checklists** inside tasks, and **templates** for tasks and projects (with three built-in ones);
- **meeting series** that keep a running list of decisions, open actions and open questions across occurrences, with a "Prepare next session" agenda.

**Architecture:**
- **Dependencies and checklists live on the task row** as two JSON columns (`blocked_by`, `checklist`). They therefore ride the existing task API, the offline mirror and the offline queue with no new sync code. Checklist text is sealed with the rest of a work task.
- **Templates** are a new table, with a sealed body for work templates. The three built-in templates are code in `shared/`.
- **Meeting series** are a new table plus `meeting_reviews.series_id`.
- **Migrations:** one migration (`0014_v2_pm.sql`) carries all the schema.

**Tech Stack:** As before. No new dependency.

**Design (approved by Vlad on 2026-10-21, "proceed"):**
- Dependencies:
  - "Blocked by" is set from the task sheet; loops are refused.
  - A **Blocked** chip shows on Board, List and Today, and Today keeps blocked tasks out of the horizons.
  - "X is unblocked" is pushed when the last blocker is done.
  - Timeline draws arrows.
  - Only same-kind links are allowed (work to work, personal to personal).
- Checklists: quick tick-boxes inside a task, with a 3/5 count on cards.
- Templates:
  - Save a task (with its checklist and subtasks) or a project (with its tasks and milestones) as a template.
  - "New from template" asks for a start date and shifts every date.
  - Built-ins: Project kickoff, Vendor onboarding, Change / release.
  - Work templates are encrypted.
- Meeting series:
  - SonarFlow meetings are grouped automatically by title, with dates and numbers ignored, and can be moved by hand.
  - The series page lists decisions, open actions (owner, due, ticked when their task is done) and open questions (carried until marked answered).
  - "Prepare next session" builds an agenda on the device. "Ask Athena to write it" is optional.

## What exists today (verified 2026-10-21)

| Fact | Where |
| --- | --- |
| Task fields are validated by `CHECKS` (`text`, `oneOf`, `num`, `date`…) and stored by `COLS`; subtasks exist via `parent_id`; recurrence is `recur` JSON with `nextOccurrence` | `worker/routes/tasks.ts`, `worker/lib/recur.ts`, `shared/types.ts` |
| Tasks carry `source_app`, `source_kind`, `source_ref` (with a unique index when not null) and `source_url` | `0002_core.sql` |
| Meeting accept creates tasks with `source_kind 'meeting'` and `source_ref null`, and decisions and RAID items with `from_meeting_id` | `worker/routes/meetings.ts` |
| `meeting_reviews` holds title, summary, decisions, action_items, open_questions and important_notes (sealed), plus project_id, state and recording_id | `0003_sources.sql`, `worker/lib/enc.ts` |
| Push types: `digest`, `overdue`, `nudge`, `milestone`, `weekly_review`, `app_task`, `meeting`, all on by default in `settings.push`; push text carries no work content | `shared/types.ts`, `worker/lib/notify.ts` |
| Only document templates (`documents.is_template`) exist; there are no task or project templates and no checklists | `0005_pm.sql` |
| The highest migration is `0013_knowledge_source_unique.sql` | `worker/migrations/` |
| The Athena hand-off pattern: `/athena?knowledge=` plus a question in sessionStorage, read once | `web/src/views/Athena.tsx`, `Knowledge.tsx` |

## Who does what

| # | Only Vlad | When |
| --- | --- | --- |
| 1 | Say "deploy" (migration 0014 and Compass) | After Task 5 |
| 2 | Try a dependency, a checklist, a template and a meeting series | After deploy |

## Global Constraints

- Everything from Phases 1–6 holds:
  - tokens only from `assets/brand/DESIGN.md`;
  - CSP (no inline scripts, `on*=` or innerHTML);
  - the offline queue for edits;
  - no hard delete (Trash);
  - work rows sealed (`enc.ts`; checklist text, template bodies and series names included);
  - plain text never HTML;
  - reduced motion, 44 px targets and keyboard paths;
  - no work content in push text;
  - every model call through `runAi`, the data boundary, and step-up where it already applies.
- **Same-kind rule:** a dependency links two live tasks of the same `kind`. A template applies only to a destination of its own kind (a work template into a work project or as a work task). A meeting series is work if its meetings' projects are work or unfiled (meeting reviews are sealed as work today).
- **No new Kelly scope or field:** the agent API's task shape does not grow (`blocked_by` and `checklist` are not sent to Kelly).
- **Migrations:** `0014_v2_pm.sql` only, never edited after commit.
- No new dependency. Never deploy, push or put secrets. Commit trailer: the implementer's model line.

## Rulings made while writing this plan

- **V1: JSON columns on tasks.**
  - `blocked_by TEXT` holds a JSON array of task ids, at most 20.
  - `checklist TEXT` holds a JSON array of `{ id, text ≤ 200, done }`, at most 50 items, sealed with work tasks (add it to `ENC_COLS`).
  - Both are validated in `CHECKS` by small pure validators.
  - "Blocks" is computed, not stored.
  - Cost if wrong: a join table later if dependencies need metadata.
- **V2: loops.** `wouldCycle(graph, from, to)` is pure and tested. The server re-checks on every PATCH that changes `blocked_by`, and refuses with 409 `dependency_cycle`. Links to a missing, trashed, other-kind or self task are refused with 400 `bad_dependency`. When a task is trashed, its id stays in others' `blocked_by`, but it counts as resolved (a trashed blocker no longer blocks).
- **V3: blocked status.** A task is blocked when any id in `blocked_by` is a live, open task. This is computed on the device from the mirror (`isBlocked(task, byId)`, pure and tested) and on the server for pushes.
  - Push type `unblocked` is added (on by default). Completing a task finds the open tasks it was the last live blocker of, and sends one push per such task. The text is "A task is unblocked" for work and "‹title› is unblocked" for personal.
  - The deep link opens the task.
- **V4: checklists and recurrence.** A recurring task's next occurrence copies the checklist with every item unticked.
- **V5: templates.**
  - Table `templates(id, name, kind, scope 'task'|'project', body, builtin 0, created_at, updated_at, deleted_at, enc_v)`. `name` and `body` are sealed for work.
  - `body` is JSON. For a task template: `{ task: { title, notes, horizon, priority, estimate_minutes, checklist, offset_days }, subtasks: [...] }`. For a project template: `{ project: {name, objectives…}, milestones: [{name, offset_days}], tasks: [{title, …, offset_days, parent_index?}] }`.
  - Offsets are calendar days from the start date, and there are no weekday rules (`ponytail:` note: business days later if needed).
  - The built-ins live in `shared/templates.ts` (marked built-in, never stored, kind chosen at apply time).
  - `POST /api/templates/apply { template_id | builtin, start_date, kind?, project_id? }` creates the rows in one batch, with `task_events` `created` from source `template`.
- **V6: series key.** `seriesKey(title)` is pure and tested: lowercase; strip dates (ISO, "Oct 14", "14/10", weekday names), numbers, "#3" / "session 4" / "week 12", and bracketed timestamps; collapse spaces and dashes. Meetings with the same key in the same project-or-unfiled join one series. "Move to series" (pick or new) overrides it and is remembered for that meeting.
- **V7: series actions.** From this phase on, meeting accept sets each created task's `source_ref` to `meeting:<review id>:<index>`, and the series page reads the open actions through it. Tasks made before this phase are matched by `source_kind 'meeting'` plus the same project plus `source_url` starting with the review's url; this is good enough, and the brief reports how many match.
- **V8: open questions.** The series row keeps `answered TEXT` (a JSON array of SHA-256 hex prefixes of the normalised question text, sealed). A question shows as open until it is marked answered.
- **V9: agenda.** "Prepare next session" is a pure `buildAgenda(series, reviews, tasks, decisions)` on the device:
  - open actions, by owner;
  - open questions;
  - the last 3 decisions;
  - carry-overs from the last meeting's important notes.
  
  It shows Copy, Markdown and Word (reusing the minutes doc builder). "Ask Athena to write it" opens `/athena` with the agenda in sessionStorage (read once) and the project preselected (or "No project (work)" for an unfiled work series), never in the URL.

## File map

| Path | Responsibility |
| --- | --- |
| `worker/migrations/0014_v2_pm.sql` | `tasks.blocked_by`, `tasks.checklist`, `templates`, `meeting_series`, `meeting_reviews.series_id` |
| `shared/deps.ts`, `scripts/deps.test.ts` | `wouldCycle`, `isBlocked`, `parseBlockedBy`, `parseChecklist` |
| `shared/templates.ts`, `scripts/templates.test.ts` | Built-ins, `applyOffsets`, body validation |
| `shared/series.ts`, `scripts/series.test.ts` | `seriesKey`, `buildAgenda`, question hash |
| `worker/routes/tasks.ts`, `worker/lib/notify.ts` | Dependency and checklist validation, unblock push |
| `worker/routes/templates.ts` | List, save from a task or project, apply, rename, delete |
| `worker/routes/meetings.ts` | Series assignment on ingest and accept, `source_ref`, series routes |
| `web/src/ui/TaskSheet.tsx` (or the existing task sheet), Board, List, Today, Timeline, Project, Meetings, Meeting, a new `MeetingSeries.tsx`, Settings (Templates) | UI |

---

### Task 0: Schema and dependencies

**Files:** create `worker/migrations/0014_v2_pm.sql`, `shared/deps.ts`, `scripts/deps.test.ts`. Modify `worker/routes/tasks.ts`, `worker/lib/enc.ts`, `worker/lib/notify.ts` (or where pushes are composed), `shared/types.ts` (`Task.blocked_by`, `Task.checklist`, `PushType` gains `unblocked`, `DEFAULT_SETTINGS.push.unblocked = true`), the task sheet, Board, List, Today, Timeline, `scripts/smoke.sh`.

The migration holds all of v2.1's schema: the two task columns, `templates`, `meeting_series(id, key, name, project_id, kind, answered, created_at, updated_at, deleted_at, enc_v)` and `ALTER TABLE meeting_reviews ADD COLUMN series_id TEXT REFERENCES meeting_series(id)`, plus indexes. These are plain ALTERs and CREATEs; no table is rebuilt.

- [ ] **Step 1: Failing tests** for `wouldCycle` (direct, long chain, self, diamond with no cycle), `isBlocked` (open blocker yes; done, trashed or missing blocker no) and `parseBlockedBy` (array of ids ≤ 20, unique).
- [ ] **Step 2:** Server.
  - Validate `blocked_by` in PATCH and create: the same kind, live, not self, no cycle (V2).
  - The completion path sends the `unblocked` pushes (V3), honouring `settings.push.unblocked` and quiet hours like other pushes.
  - The export includes the new columns.
  - `blocked_by` and `checklist` are kept out of the agent API's `AgentTask` (no change there; add a test that the agent route's shape is unchanged).
- [ ] **Step 3:** UI.
  - **Task sheet:** a "Blocked by" field (search within same-kind open tasks; chips to remove), and a "Blocks" list (read-only, links).
  - **Board, List and Today:** a **Blocked** chip (a lock-style icon plus the word, not colour alone).
  - **Today:** blocked tasks go to a collapsed "Blocked (n)" group under the horizons.
  - **Timeline:** thin arrows from a blocker's bar to a blocked bar, using tokens, drawn in SVG behind the bars, and none under reduced motion.
- [ ] **Step 4: Smoke.** Link, then a loop is refused (409), then other kind is refused (400). Completing the blocker leaves the blocked task unblocked, and one push lands in the outbox ("A task is unblocked" for a work task). Screenshots at 375 and 1280. **Commit** `v2.1 Task 0: schema and dependencies`.

### Task 1: Checklists

**Files:** modify `shared/deps.ts` (`parseChecklist`), the task sheet, the card components (Board, List, Today), `worker/routes/tasks.ts` (recurrence copy, V4), `scripts/deps.test.ts`, `scripts/smoke.sh`.

- [ ] **Step 1: Failing tests** for `parseChecklist`: ≤ 50 items, text 1–200, ids unique, `done` boolean.
- [ ] **Step 2: Task sheet.** A Checklist section: add an item (Enter adds the next), tick, edit in place, reorder (drag, plus keyboard up and down), and delete. Every change goes through the existing offline task update path. Cards show "3/5" with a small progress bar when a checklist exists.
- [ ] **Step 3:** Recurrence copies the checklist unticked. Work checklist text is sealed (raw D1 is ciphertext).
- [ ] **Step 4: Smoke**, then screenshots, then **Commit** `v2.1 Task 1: checklists`.

### Task 2: Templates

**Files:** create `shared/templates.ts`, `scripts/templates.test.ts`, `worker/routes/templates.ts`. Modify `worker/index.ts`, the task sheet ("Save as template"), the project page ("Save as template"), the command palette and Projects ("New from template"), Settings (a Templates card: list, rename, delete), `scripts/smoke.sh`.

- [ ] **Step 1: Failing tests:** `applyOffsets(body, start)` dates, the body validators (task and project shapes, ≤ 200 tasks, ≤ 50 milestones), and that the three built-ins validate.
- [ ] **Step 2: Built-ins** (V5), in Compass's own words:
  - **Project kickoff:** charter, stakeholders, kickoff meeting, RAID set-up, first status report; milestones at Kickoff, Plan baselined and First status.
  - **Vendor onboarding:** NDA/MSA, SOW review, security questionnaire, access requests, kickoff with the vendor, the first invoice check.
  - **Change / release:** change request, impact assessment, CAB approval, test sign-off, communication, go-live, post-implementation review.
- [ ] **Step 3: Routes.**
  - `GET /api/templates` returns the user's templates plus the built-ins (built-ins flagged).
  - `POST /api/templates { from_task_id | from_project_id, name }` snapshots relative offsets from the earliest date.
  - `PATCH` (rename) and `DELETE` (`deleted_at`).
  - `POST /api/templates/apply` (V5, one batch, same-kind rule).
- [ ] **Step 4: UI.**
  - "New from template" opens a dialog: pick a template, then a start date, then (for a project) a name and the work/personal choice when it's a built-in. It creates the project or task and opens it.
  - "Save as template" in the task sheet and on the project page.
- [ ] **Step 5: Smoke.**
  - Save a project with 3 tasks and 1 milestone as a template, then apply it with a new start → dates shifted.
  - Apply a built-in as work → sealed rows.
  - A work template into a personal project → 400.
  
  Then screenshots, then **Commit** `v2.1 Task 2: templates`.

### Task 3: Meeting series

**Files:** create `shared/series.ts`, `scripts/series.test.ts`, `web/src/views/MeetingSeries.tsx`. Modify `worker/routes/meetings.ts` (and the inbox meeting ingest path that creates reviews), `web/src/views/Meetings.tsx`, `web/src/views/Meeting.tsx`, `web/src/router.ts`, `scripts/smoke.sh`.

- [ ] **Step 1: Failing tests** for `seriesKey` (V6 examples: "Weekly sync – Acme – Oct 14", "Weekly Sync - ACME (2026-10-21)" and "Weekly sync — Acme #12" share a key; "Acme steering" differs), `buildAgenda` (V9 sections and empty cases) and the question hash.
- [ ] **Step 2: Server.**
  - Ingest assigns or creates a series (by key and the review's project once known; an unfiled review uses the unfiled series for that key, and when it's accepted into a project it moves to that project's series for the key).
  - Accept sets `source_ref` (V7).
  - Routes:
    - `GET /api/meetings/series` lists series with counts.
    - `GET /api/meetings/series/:id` returns the opened reviews, decisions (`from_meeting_id` in the series), actions (V7) and questions with answered flags.
    - `PATCH /api/meetings/series/:id` handles name and answered (V8).
    - `POST /api/meetings/:id/series { series_id | new_name }` moves a meeting.
  - The series name is sealed for work.
- [ ] **Step 3: UI.**
  - **Meetings list:** groups by series (series name, number of meetings, last date, open actions count).
  - **Series page:** decisions (newest first), open actions (owner, due, done ticks when the task is done; a link to the task), open questions with "Answered" toggles, and a meetings list.
  - **"Prepare next session"** (V9): Copy, Markdown, Word, and "Ask Athena to write it".
  - **Meeting page:** "Series: X · Move".
- [ ] **Step 4: Smoke.**
  - Two meetings posted with dated titles land in one series.
  - Accepting both makes actions appear on the series; finishing one task ticks it.
  - Marking a question answered hides it from the agenda.
  - Moving a meeting to a new series works.
  
  Then screenshots, then **Commit** `v2.1 Task 3: meeting series`.

### Task 4: Docs and full run

- [ ] Add a "v2.1: day-to-day PM" section to `CLAUDE.md`, update `docs/compass-features.md` (the three rows done), and give `docs/integration.md` a line saying the agent API shape is unchanged.
- [ ] Run typecheck, check, build and the full smoke twice. Write `deploy-steps.md` in the workspace (D1 bookmark, then migration 0014, then deploy, then live checks). **Commit** `v2.1 Task 4: docs, full run`.

### Task 5: Deploy (Vlad's word)

- [ ] Ask, then deploy as `deploy-steps.md` says, then do live checks with Vlad. Write `docs/v2-1-verification.md`.

## Coverage

| Approved design | Task |
| --- | --- |
| Blocked by / blocks, loops refused, Blocked chip, Today grouping, unblock push, Timeline arrows, same kind | 0 |
| Checklists with progress on cards | 1 |
| Task and project templates, start-date shift, three built-ins, encrypted | 2 |
| Meeting series by title, move by hand, decisions, actions, questions, Prepare next session, Athena optional | 3 |
