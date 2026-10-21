# Compass v2.2 (Project control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Vlad control of his projects in three parts:
- **baselines**, which freeze a plan and show what slipped;
- a **project dashboard**: burndown, done per week, overdue trend, risks by severity and milestone slip;
- a **stakeholder register**, with a power/interest grid, a communication plan, reminders when an update is due, and an Athena draft.

**Architecture:**
- **Schema:** one migration, `0015_v2_project_control.sql`, adds the tables `baselines` and `stakeholders`.
- **Computed on the device:** slip and the dashboard numbers are pure functions in `shared/` over the offline mirror (tasks, milestones) and the project's RAID list. There's no model and no server aggregation, so they work offline.
- **Server-side:** the stakeholder reminders run in the existing daily cron.
- **Status report:** gains a "Schedule vs baseline" section and the dashboard's numbers, built on the device like the rest of the report.

**Tech Stack:** As before. Charts are hand-drawn SVG with tokens; there is no new dependency.

**Design (approved by Vlad on 2026-10-21, "Proceed"):**
- **Baselines:**
  - "Save baseline" (named) freezes every task's and milestone's dates.
  - The slip view lists what moved and by how many days, with a summary line.
  - The Timeline shows ghost bars behind the current ones.
  - The status report gets a "Schedule vs baseline" section.
  - Several baselines can be kept per project; work baselines are encrypted.
- **Dashboard (a new project tab):**
  - burndown against an ideal line to the end date;
  - done per week and the overdue trend over the last 8 weeks;
  - open risks by probability × impact;
  - milestone slip against the latest baseline.
  
  It is computed on the device. The status report, and Athena writing it, can quote the numbers.
- **Stakeholders (a new project tab):**
  - Each person has a name, role or organisation, power (high/low), interest (high/low) and attitude (supportive/neutral/resistant). Power and interest place them on the grid (manage closely / keep satisfied / keep informed / monitor).
  - The communication plan holds a channel and a frequency.
  - A reminder fires when an update is due. For work it reads "2 stakeholder updates due", with no names.
  - "Mark sent" records the date.
  - "Draft update" opens Athena under the usual rules.
  - Work registers are encrypted, and Kelly never sees them.

## What exists today (verified 2026-10-21)

| Fact | Where |
| --- | --- |
| `projects` has `start_at`, `end_at`, `rag` and `rag_reason`, budget and `kind`/`data_boundary`; `milestones` has `due_at`, `done_at`, `gate` and `sort` | `0002_core.sql` |
| `raid_items` has `type` (risk/assumption/issue/dependency), `probability` and `impact` (1–5), and `status` open/closed | `0005_pm.sql` |
| Tasks carry `created_at`, `done_at`, `start_at` and `due_at`; the mirror holds tasks, projects and milestones | `web/src/store/` |
| Project tabs: overview, raid, changes, decisions, lessons, meetings, documents, report, copilot (Athena); Timeline is a link | `web/src/views/Project.tsx` |
| The status report is built on the device (`shared/report-model.ts`, `buildReportModel(..., tz)`), Word/Markdown in `web/src/docs/`; the Athena summary goes through `POST /api/reports/status` (boundary-checked) | Phase 3 |
| The daily cron sends digest, nudge and weekly-review pushes; push text carries no work content; `settings.push` has a per-type switch | `worker/cron.ts`, `worker/lib/notify.ts` |
| The Athena hand-off: sessionStorage (`athena:ask`) plus `/athena?agenda=<project | work>`, offered only for a live cloud project or an unfiled work context (V17) | v2.1 |
| The highest migration is `0014_v2_pm.sql`. D1 rule 9: at most 100 bound parameters per statement | `worker/migrations/`, `CLAUDE.md` |

## Who does what

| # | Only Vlad | When |
| --- | --- | --- |
| 1 | Say "deploy" (migration 0015 and Compass) | After Task 3 |
| 2 | Save a baseline, look at the dashboard, add stakeholders | After deploy |

## Global Constraints

- Everything from Phases 1–6 and v2.1 holds: tokens only, CSP, the offline queue for edits, no hard delete (Trash), work rows sealed (`enc.ts`), plain text never HTML, reduced motion, 44 px, keyboard paths, no work content in push text, `runAi` and the data boundary, D1 rule 9.
- **Sealing:**
  - A baseline's `name` and `snapshot`, and a stakeholder's `name`, `role`, `channel` and `notes`, are sealed when the project is work.
  - Power, interest, attitude, cadence and dates are plain fields with fixed vocabularies; they hold no free text.
- **Kelly never sees** baselines or stakeholders: no agent route and no field.
- **Charts are accessible:** each chart has a short text summary (`aria-describedby`) and a "Show as table" toggle; colour is never the only signal (labels and patterns); and charts are complete at rest (no animation needed to read them).
- **Migration:** `0015_v2_project_control.sql` only (plain CREATE and ALTER), never edited after commit.
- No new dependency. Never deploy, push or put secrets.

## Rulings made while writing this plan

- **C1: baseline snapshot.**
  - The snapshot is JSON `{ tasks: [{ id, start_at, due_at }], milestones: [{ id, due_at }], project: { start_at, end_at } }`: ids and dates only, no titles (titles come from the live rows when slip is shown). It covers top-level and subtasks that are live and not done at save time, plus done ones with their dates.
  - Caps: 1,000 tasks and 200 milestones per baseline (409 `baseline_too_big` beyond), and 20 live baselines per project.
  - `POST /api/projects/:id/baselines { name }` builds the snapshot on the server from D1, so it's always complete, even if the device mirror is behind. Save is online-only.
- **C2: slip.** `slip(baseline, tasks, milestones)` is pure and tested. For each baselined item it gives the day delta of `due_at` (and of `start_at` for tasks). It marks items added since the baseline as "new" and items removed or trashed as "dropped", and returns a summary: late count, average and maximum slip, and milestones late. A positive delta means later. Items with no baseline date and no current date are skipped.
- **C3: Timeline ghosts.** With a project filter and a picked baseline (the latest by default, or "none"), the Timeline draws each baselined task and milestone as a faint outline bar at its baseline dates, behind the current bar. The ghosts are drawn with tokens and are also shown under reduced motion (they're static).
- **C4: dashboard functions**, in `shared/dashboard.ts`, pure and tested, using the project's live top-level tasks (subtasks excluded) in Vlad's time zone:
  - `burndown(tasks, from, to, today)`: open task count per day, from the project start (or its first task's `created_at`) to today. The ideal line runs from the count at start to 0 at `end_at`, or there's no ideal line without an end date.
  - `donePerWeek(tasks, today, 8)`: weeks start on Monday.
  - `overdueTrend(tasks, today, 8)`: at each week's end, tasks with `due_at` < that day, created on or before it, and not done by it.
  - `riskMatrix(raid)`: open risks (type risk) counted in the 5×5 grid, with severity = probability × impact (high ≥ 15, medium 8–14, low ≤ 7); unrated risks are counted apart.
  - `milestoneSlip(baseline, milestones)` reuses C2.
- **C5: report.** `buildReportModel` gains `schedule` (from C2 against the latest baseline: the summary plus the late milestones) and `metrics` (done this week, open, overdue now, burndown remaining against ideal, high risks). The Word/Markdown output and the on-screen report show them. The data sent to `POST /api/reports/status` for the Athena summary includes `metrics` and `schedule` as numbers only, through the existing boundary check (Offline-only projects get no summary, as today).
- **C6: stakeholders.**
  - Table `stakeholders(id, project_id, name, role, power 'high'|'low', interest 'high'|'low', attitude 'supportive'|'neutral'|'resistant', channel, cadence_days INTEGER NULL, last_contact_at, notes, sort, created_at, updated_at, deleted_at, enc_v)`.
  - Grid quadrants: high power + high interest = manage closely; high power + low interest = keep satisfied; low power + high interest = keep informed; low/low = monitor.
  - Due = `last_contact_at` + `cadence_days` (or "never contacted" with a cadence = due now).
  - Routes: `GET/POST /api/projects/:id/stakeholders`, `PATCH/DELETE /api/stakeholders/:id`, and `POST /api/stakeholders/:id/contacted` (sets `last_contact_at` to now; audit with no content).
  - Edits go through the offline queue like RAID items. Trashed stakeholders are listed in Trash with Restore and purged with the project or after 30 days.
- **C7: reminders.**
  - The daily cron at `digest_hour` counts stakeholders that are due, across live projects that aren't closed.
  - It sends one `stakeholder` push (a new type, on by default): "N stakeholder updates due". It always uses the count only, with no names (even for personal, which keeps the rule simple). The deep link goes to the first project's Stakeholders tab.
  - At most one push a day, and quiet hours are honoured.
- **C8: Draft update.**
  - A stakeholder's "Draft update" puts a short seed in sessionStorage (the person's role and attitude, the channel and the project's latest status line from the report model, but not their name for work) and opens Athena on that project. Vlad adds the name himself.
  - It is offered only when the project is live and cloud (V17). Otherwise the line "Offline only: write it yourself" shows.
- **C9: purge and FKs.** `baselines` and `stakeholders` reference `projects`, so the Trash purge deletes them before their project. Both are in the export, with work fields opened.

## File map

| Path | Responsibility |
| --- | --- |
| `worker/migrations/0015_v2_project_control.sql` | `baselines`, `stakeholders`, indexes |
| `shared/baseline.ts`, `scripts/baseline.test.ts` | `slip`, snapshot shape and validation |
| `shared/dashboard.ts`, `scripts/dashboard.test.ts` | C4 functions |
| `worker/routes/baselines.ts`, `worker/routes/stakeholders.ts` | Routes |
| `shared/report-model.ts`, `web/src/docs/*` | C5 |
| `worker/cron.ts`, `worker/lib/notify.ts`, `shared/types.ts` | C7 |
| `web/src/views/project/Dashboard.tsx`, `Stakeholders.tsx`, `Baselines.tsx` (or a section of Overview), `web/src/views/Timeline.tsx`, `web/src/ui/Chart*.tsx` | UI |

---

### Task 0: Schema and baselines

**Files:** create `worker/migrations/0015_v2_project_control.sql`, `shared/baseline.ts`, `scripts/baseline.test.ts`, `worker/routes/baselines.ts`. Modify `worker/index.ts`, `worker/lib/enc.ts` (`ENC_COLS`), `worker/routes/trash.ts` (purge order, list and restore), `worker/routes/export.ts`, `shared/types.ts`, the project page (a "Baselines" section on Overview: save, list, rename, delete, and the slip view), `web/src/views/Timeline.tsx` (C3), `scripts/smoke.sh`.

The migration holds both tables (`stakeholders` is used in Task 2), with their indexes on `(project_id, deleted_at)`.

- [ ] **Step 1: Failing tests** for `slip` (later, earlier, unchanged, new, dropped, missing dates, the summary maths) and snapshot validation (the caps).
- [ ] **Step 2: Server.**
  - `GET /api/projects/:id/baselines` gives the list (name, `taken_at`, counts).
  - `POST` builds the snapshot from D1 (C1) and seals it for work.
  - `GET /api/baselines/:id` gives the opened snapshot.
  - `PATCH` handles rename, and `DELETE` soft-deletes.
  - The routes respect rule 9 (the snapshot reads use plain `WHERE project_id = ?`, never id lists).
- [ ] **Step 3: UI.**
  - Overview → Baselines: "Save baseline" (a name dialog; online-only with a plain line) and a list.
  - Opening a baseline shows the slip table (task or milestone, baseline date, current date, ± days, flags), sorted by largest slip, with the summary on top.
  - Timeline gets a baseline picker when a project is selected, with ghost bars (C3).
- [ ] **Step 4: Smoke.**
  - Save a baseline, move two dates, and the slip shows +n and -m.
  - A work baseline is ciphertext in D1.
  - Trash and restore a baseline.
  - The purge of a project removes its baselines.
  
  Then screenshots at 375 and 1280, then **Commit** `v2.2 Task 0: schema and baselines`.

### Task 1: Project dashboard and the report

**Files:** create `shared/dashboard.ts`, `scripts/dashboard.test.ts`, `web/src/views/project/Dashboard.tsx`, small chart components (`web/src/ui/Chart.tsx`: line, bars, 5×5 grid). Modify `Project.tsx` (a `dashboard` tab after overview), `shared/report-model.ts` and its tests (C5), the report view and `web/src/docs/` output, `worker/routes/reports.ts` (accepts and uses `metrics` and `schedule` in the summary data, numbers only), `scripts/smoke.sh`.

- [ ] **Step 1: Failing tests** for each C4 function (week edges in `America/Toronto` across the DST change on 2026-11-01, a task done before it was due, a task without dates, no `end_at`, no risks, an unrated risk) and for C5's model fields.
- [ ] **Step 2: Charts.** SVG with tokens, sized by the container, with a text summary and "Show as table". Burndown: actual line and ideal dashed. Done per week: bars. Overdue trend: line. Risk matrix: a 5×5 grid with counts, and severity shown as labels plus a pattern (never colour alone). Milestone slip: a short ranked list with ± days.
- [ ] **Step 3: Data.** Tasks and milestones come from the mirror. RAID comes from the existing project RAID fetch, cached in `meta` for offline reading. Baselines come from Task 0's routes (the latest is opened and cached).
- [ ] **Step 4: Report.** Add the "Schedule vs baseline" and "Key numbers" sections on screen, in Word and in Markdown. The status summary request carries the numbers.
- [ ] **Step 5: Smoke.** The report route accepts the new data and an Offline-only project still gets no summary. Then screenshots of the dashboard at 375 and 1280 (with seeded data), then **Commit** `v2.2 Task 1: dashboard and report`.

### Task 2: Stakeholder register

**Files:** create `worker/routes/stakeholders.ts`, `web/src/views/project/Stakeholders.tsx`, `shared/stakeholders.ts` (quadrant and due logic), `scripts/stakeholders.test.ts`. Modify `Project.tsx` (a `stakeholders` tab), `worker/cron.ts` and `worker/lib/notify.ts` (C7), `shared/types.ts` (`PushType` `stakeholder`, default on), Settings → Notifications, Trash, export, `ENC_COLS`, the offline queue mapping for the new entity (follow how RAID items are queued), `scripts/smoke.sh`.

- [ ] **Step 1: Failing tests** for `quadrant(power, interest)`, `nextDue(last, cadence, today)`, `dueCount(stakeholders, today)` (never contacted with a cadence, no cadence, a future date) and the push text (count only).
- [ ] **Step 2: Server.** The routes (C6) with validation (vocabularies, name 1–120, role ≤ 120, channel ≤ 60, notes ≤ 2,000, cadence 1–365 or null), sealing, `contacted`, Trash, export and the purge order (C9). The cron (C7) follows the existing digest timing and honours quiet hours, the push switch and the once-a-day limit (remember the last send in settings or in an audit row).
- [ ] **Step 3: UI.**
  - **Grid view:** a 2×2 grid with the quadrant names and the people as chips, showing attitude as a word plus an icon.
  - **List view:** name, role, quadrant, channel, cadence, last contact, next due (Due now / In n days), "Mark sent", and "Draft update" (C8).
  - Add or edit in a `<dialog>`; on a phone the list comes first.
- [ ] **Step 4: Smoke.**
  - Add, then edit, then mark sent, then the next due date moves.
  - A work stakeholder is ciphertext.
  - The cron sends one "2 stakeholder updates due" with no names, and not twice the same day.
  - "Draft update" is not offered for an Offline-only project (a flag in the stakeholders list response: `athena`).
  
  Then screenshots, then **Commit** `v2.2 Task 2: stakeholders`.

### Task 3: Docs and full run

- [ ] Add a "v2.2: project control" section to `CLAUDE.md`, mark the rows in `docs/compass-features.md`, and keep the rule 9 audit current for the new routes.
- [ ] Run typecheck, check, build and the full smoke twice. Write `deploy-steps.md` in the workspace (bookmark and counts, then migration 0015, then deploy, then checks and rollback). **Commit** `v2.2 Task 3: docs, full run`.

### Task 4: Deploy (Vlad's word)

- [ ] Ask, then deploy as `deploy-steps.md` says, then do live checks with Vlad. Write `docs/v2-2-verification.md`.

## Coverage

| Approved design | Task |
| --- | --- |
| Save baseline, slip view and summary, Timeline ghosts, several per project, encrypted | 0 |
| Schedule vs baseline in the status report | 1 (C5) |
| Dashboard: burndown, done per week, overdue trend, risks by severity, milestone slip; on the device; numbers in the report and Athena's summary | 1 |
| Stakeholders: grid, attitude, communication plan, reminders without names, Mark sent, Draft update, encrypted, never Kelly | 2 |
