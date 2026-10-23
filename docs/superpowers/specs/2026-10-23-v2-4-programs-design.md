# Compass v2.4: programs, portfolio budget, workload (design)

*2026-10-23. Builds on v2.1 (dependencies, templates), v2.2 (baselines, dashboard, report metrics) and v2.3 (widgets). Every rule in `CLAUDE.md` still holds.*

## What Vlad asked for

The next release after widgets, from the feature catalogue (`docs/compass-features.md`): **Programs** (group projects, roll up RAG, milestones and risks), the **full Portfolio** (budget line, roll-ups) and **Workload** (hours per week against the capacity he sets, across projects).

Decisions he made on 2026-10-23:

- **One kind per program.** A work program holds only work projects, a personal one only personal projects; a work program is sealed like any work row.
- **Workload counts estimate hours, with a default.** The task sheet gets an Estimate field; a task without one counts as a default he sets and is marked "not estimated".
- **Hours are spread from start to due** over the weekdays; a task with only a due date lands on that day; an overdue open task counts in the current week.
- **Capacity is two weekly numbers**, work and personal, plus a per-week override (vacation, a short week).
- **Budget gets a forecast and a currency**, rolled up per program and on the Portfolio. No spend entries.
- **A program page has a roll-up, its own RAG and a report.** His RAG and reason for the program sit beside the worst of its projects; a program status report exports to Word, Markdown and PDF, with Athena's summary when every project allows it.
- **Approach A:** a `programs` table; roll-ups, Workload and budget totals are pure functions on the device mirror (as the v2.2 Dashboard), so they work offline.

Default taken without a question: **Kelly never sees programs, workload or budget figures** (no agent route, no new field), as in v2.2.

## 1. Data

Migration `0017_programs.sql` is the only schema change (never edited after commit).

**`programs`** (new): `id`, `kind` (`personal` | `work`), `name`, `rag` (`green` | `amber` | `red` | `none`, default `none`), `rag_reason`, `notes`, `sort`, `enc_v`, `created_at`, `updated_at`, `deleted_at`. `name`, `rag_reason` and `notes` are sealed for a work program (`ENC_COLS.programs`); `rag` stays plain, as on projects.

**`projects`** gains:

- `program_id` (FK to `programs`, nullable);
- `budget_forecast` REAL (forecast at completion, nullable);
- `currency` TEXT, a three-letter code, default `CAD` (checked against `^[A-Z]{3}$`).

Budget numbers stay plain, as today.

**Rules:**

- **Same kind.** A project joins only a live program of its own kind: 400 `program_kind` otherwise. When a project's kind changes, its `program_id` is cleared in the same update.
- **Trashed program.** Its projects keep `program_id` until the purge, but every roll-up and grouping treats a trashed program as absent ("No program"). Restoring it brings the grouping back.
- **Limits.** 50 live programs (409 `program_limit`, on create and on restore, counted with a subselect). Name 120 characters, reason 500, notes 4,000. A program has no cap on projects: each project holds one `program_id`, so no id list is ever bound.

**Estimates.** `tasks.estimate_minutes` already exists and is mirrored; it gets an editor (section 3). No migration.

**Settings** (no migration), a new key with defaults in `DEFAULT_SETTINGS`:

```ts
workload: {
  work_hours: 40, personal_hours: 8,          // per week, 0 to 168
  day_hours: 8,                               // what "1d" means in an estimate, 1 to 24
  default_estimate_minutes: 60,               // 0 to 2,400
  overrides: Record<string /* Monday, YYYY-MM-DD */, { work: number; personal: number }>, // at most 104
}
```

`PATCH /api/settings` validates the shape (400 on a bad key, value or a non-Monday date). The keys are plain numbers, never task content.

**Kelly.** No agent route reads `programs`. The agent API's project shape (`compass:read.projects`, from `portfolioRows`) does not gain `program_id`, `budget_forecast` or `currency`; the seven-key task shape is unchanged (`estimate_minutes` was never in it). `scripts/agent.test.ts` asserts both.

**Trash, purge, export.** Programs are listed in Trash (name opened, no notes), restore through the generic route (with the 50 cap), and are purged after 30 days. The purge first sets `program_id = NULL` on projects that point at a purged program, then deletes the program, in one `DB.batch`. A project purged before its program needs nothing extra (the FK is on the project). `GET /api/export` includes `programs` with work text opened.

## 2. Programs and Portfolio

**Routes** (`worker/routes/programs.ts`):

- `GET /api/programs` (live programs, opened, `LIMIT 50`), `POST /api/programs {kind, name, rag?, rag_reason?, notes?}`, `PATCH /api/programs/:id` (kind is fixed after creation), `DELETE /api/programs/:id` (sets `deleted_at`).
- `GET /api/programs/:id/detail`: the program, opened, and for its live member projects:
  - each project's latest live baseline snapshot (ids and dates only, opened, as v2.2);
  - the 10 open risks with the highest probability × impact (title opened, project id);
  - the count of pending changes per project.
  
  Every read selects members with `project_id IN (SELECT id FROM projects WHERE program_id = ?1 AND deleted_at IS NULL)`, so the binds are constant (rule 9). `Cache-Control: private, no-store`.
- Assigning a project is the existing `PATCH /api/projects/:id {program_id}` (null leaves), with the same-kind check. `budget_forecast` and `currency` are patched the same way.

**Roll-up** (`shared/program.ts`, pure, `scripts/program.test.ts`), over the device mirror (projects, tasks, milestones) plus the detail answer:

- per project: RAG, % done (live top-level tasks), next milestone, slip summary from `slip()` against its latest baseline (none if no baseline);
- the program's **worst RAG** (red over amber over green; `none` ignored), shown beside the RAG Vlad set; when the two differ the page says so in words ("You say green; one project is red");
- milestones due in the next 30 days across the program, in `settings.tz` calendar days;
- the budget table: planned, spent, forecast, variance (forecast − planned; positive = over) and % spent per project. **Totals are per currency** and never converted: a program with CAD and USD projects shows two total rows. A project with no planned budget is listed with dashes and left out of the totals' percentages.

**Screens:**

- `/programs` (in the rail under Portfolio): one card per program with its RAG, project count, % done and budget used per currency; "New program" (online only).
- `/programs/:id`: tabs **Overview** (RAG pair, projects with their RAG, % done, slip and next milestone, upcoming milestones, top risks), **Budget** (the table and a hand-drawn SVG bar per project: spent and forecast against planned, value labels and patterns, never colour alone, text summary and "Show as table") and **Report** (section 4). Edit name, RAG, reason and notes in place; delete goes to Trash.
- Project editor: a **Program** picker listing only live programs of the project's kind, plus "No program".
- **Portfolio**: a "Group by program" toggle (sections in program order, "No program" last; the choice remembered in `localStorage`, wrapped in try/catch) and a budget bar on each project card when it has a planned budget.

**Offline** (as RAID and stakeholders, C12): `GET /api/programs` and the detail are network-first and cached in IndexedDB `meta` (`programs`, `program:<id>`); writes are online-only, their buttons disabled offline with a plain line. Roll-ups run on whatever was last cached plus the live mirror.

## 3. Workload

**Pure function** `workload(tasks, projects, settings, today)` in `shared/workload.ts` (`scripts/workload.test.ts`). No network, no model.

**Which tasks count:** live, not done, status not `hold`. Leaves only: a task with live, not-done subtasks counts through them, so hours are never counted twice; a parent's own estimate is then ignored (the sheet says so under the Estimate field).

**Hours:** `estimate_minutes`, else `default_estimate_minutes` with the task marked "not estimated".

**Placement** (calendar days in `settings.tz`, a stored timestamp read in that zone first; weeks start Monday):

- start and due: spread evenly over the Monday-to-Friday days from the start day to the due day; if the range has no weekday, all on the due day;
- due only: on the due day;
- due before today (overdue): on today, flagged "overdue";
- start only, or neither: not placed; counted in **Unscheduled** with its hours;
- days before today inside a range are dropped and their share moves onto the remaining days (so an in-progress task's hours are not lost to the past).

**Capacity:** per week, work hours against `work_hours` and personal hours against `personal_hours`, or that week's override. The current week's capacity is pro-rated by the weekdays left including today (Wednesday: 3/5).

**Screen `/workload`** (in the rail under Calendar):

- the current week and the next 11, two charts (Work, Personal): stacked bars per project (unfiled tasks as "No project") against a dashed capacity line; an over-capacity week carries "+6h over" as text;
- choosing a week lists its tasks with their hours that week, marks, and a link to each task;
- **Unscheduled** total, a "Not estimated: N" filter that lists those tasks for fixing, and a week-override editor (pick a Monday, two numbers);
- a filter to one program or one project;
- chart rules as the Dashboard: text summary (`aria-describedby`), "Show as table", patterns and labels, complete at rest and under reduced motion.

**Estimate field** in the task sheet: `parseEstimate('30m' | '2h' | '1.5d' | '90')` in `shared/workload.ts` (bare number = minutes, `d` = `day_hours`), at most 40 days of `day_hours`, shown back formatted (`1h 30m`). The server checks `estimate_minutes` is an integer from 0 to 57,600 (400 `bad_estimate`). Saving goes through the offline queue like any task edit. Templates keep estimates (plain per-task numbers; `shared/templates.ts` snapshots them).

## 4. Program report

`buildReportModel` gains a program form (`shared/report-model.ts`): the program's name, RAG pair and reason, then per project RAG, % done, slip summary and late milestones, the top risks, and the budget table per currency. Preview, Word, Markdown and PDF are built on the device from it, as the project report; `settings.tz` is passed.

Athena's summary: `POST /api/reports/status {program_id}` loads the program and its members on the server. If any member is Offline-only or the program is trashed, it returns the data with `ai_refused: 'offline_boundary'` and no summary. Otherwise the text sent through `runAi` (feature `copilot`) holds numbers and RAG values only (per project: RAG, % done, slip days, counts), never a program, project, task, milestone or risk name. Kind: a work program's summary is a work call (sealed history rules as any report).

## 5. Testing

In `npm run check`:

- `scripts/program.test.ts`: worst RAG, the RAG-pair sentence, per-currency totals and variance, trashed-program grouping, upcoming milestones across the DST change;
- `scripts/workload.test.ts`: weekday spread in `settings.tz` across the DST change, past days moved forward, current-week pro-rating, leaf-only counting, default estimates, overdue, unscheduled, `hold` left out, overrides, `parseEstimate` and its limits;
- additions: `enc` (sealed program columns), `agent` (project and task shapes unchanged), `report-model` (program form; summary text holds no names), `templates` (estimates kept).

`scripts/smoke.sh` section (g): create a work and a personal program; a cross-kind assignment answers 400 `program_kind`; a project's kind change clears its program; a program of 60 projects answers the detail route (constant binds); the 50 cap on create and on restore; a program report with an Offline-only member is refused; a bad estimate answers 400; Trash, restore, and a purge that clears `program_id`. The smoke removes what it creates.

Rule 9: every new statement binds a fixed number of parameters or uses a subselect; the plan lists each one.

## 6. Delivery

Branch `v2-4-programs`. Tasks, each ending with `npm run typecheck && npm run check` and a commit:

1. Migration 0017, types, sealing, programs routes, settings validation, Trash, purge, export.
2. Budget forecast and currency on projects; the Estimate field.
3. `shared/program.ts`, the Programs screens, the project picker, Portfolio grouping and budget bars.
4. The program report and its summary route.
5. `shared/workload.ts`, the Workload screen, capacity settings.
6. Docs (`CLAUDE.md` v2.4 section, the feature catalogue; `docs/integration.md` unchanged), full smoke run, `deploy-steps.md` in the SDD workspace.

Nothing is deployed, migrated remotely or installed without Vlad's word.

## Not in v2.4

Spend entries and spend-over-time charts; currency conversion; per-weekday capacity; time tracking (actual hours); programs of mixed kinds; Kelly access to any of it.
