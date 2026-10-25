# Compass v2.5: time tracking (design)

*2026-10-25. Builds on v2.3 (widgets, the widget token) and v2.4 (estimates, Workload, programs, the program report). Every rule in `CLAUDE.md` still holds.*

## What Vlad asked for

Time tracking from the feature catalogue (`docs/compass-features.md`): start and stop timers, manual entries, totals per project, and, following v2.4, actual against estimate and actual hours in Workload.

Decisions he made on 2026-10-25:

- **Several timers can run in parallel.**
- **Time is logged against a task, or straight against a project** (with a note) for time with no task: a steering meeting, an ad-hoc call.
- **Forgotten timers: nudge, then cap.** One push after 4 hours; the timer stops itself at 12 hours and the entry is marked for review.
- **Start and stop from:** the task sheet and task cards, a running-timers bar on every screen, and the iPhone/iPad and Android widgets. Not the Mac menu bar.
- **Reporting:** actual against estimate with an accuracy figure; Workload's past weeks with actual hours; a Time screen (week grid, edit, CSV export); hours in the status report.
- **Approach A:** time entries live in the device mirror next to tasks; start, stop and edits go through the offline queue; every total is a pure function on the device.

Default taken without a question: **Kelly never sees time entries** (no agent route, no field), as in v2.2 and v2.4.

## 1. Data and sync

Migration `0018_time.sql` is the only schema change (never edited after commit).

**`time_entries`**: `id`, `task_id` (FK tasks, nullable), `project_id` (FK projects, nullable), `kind` (`personal` | `work`), `started_at`, `ended_at` (null while running), `note`, `source` (`timer` | `manual` | `widget`), `auto_stopped` (0 | 1), `enc_v`, `created_at`, `updated_at`, `deleted_at`. A CHECK requires `task_id` or `project_id`. Indexes on `(deleted_at, updated_at)`, `task_id`, `project_id`, and a partial one on running entries (`ended_at IS NULL AND deleted_at IS NULL`).

**Sealing:** `note` is sealed when the entry's kind is work (`ENC_COLS.time_entries = ['note']`). Times, ids, source and flags are plain.

**Ownership:**

- An entry with a task takes the task's kind at creation and follows the task: project totals use the task's *current* project, so moving a task moves its hours. `project_id` stays null on such an entry.
- An entry with only a project takes the project's kind; its note is required (1 to 500 characters).
- An entry on a subtask counts toward its parent's total too.

**Rules:**

- At most **5 running** entries (409 `timer_limit`).
- A task has at most one running entry (409 `timer_running`).
- No entry on a done or trashed task, or a trashed project (409 `time_target`).
- An entry lasts at most 24 hours (400 `bad_time`). A manual entry must have an end, and no end later than the server's now + 5 minutes (400 `bad_time`).
- Every client timestamp is clamped to [2020-01-01, server now + 5 minutes] so a drifting device clock can't write the future.
- **Stop is idempotent:** `UPDATE … SET ended_at = ? WHERE id = ? AND ended_at IS NULL`; a second stop changes nothing and answers 200 with the stored row.

**Routes** (`worker/routes/time.ts`):

- `GET /api/time?since=` incremental, exactly like `GET /api/tasks?since=` (`updated_at >= since`; with `since`, trashed rows come back too so other devices learn about deletes; without it, live rows only; opened; one constant bind, no row cap, as the tasks pull).
- `POST /api/time {task_id? | project_id?, started_at, ended_at?, note?, source}`: a start when `ended_at` is absent, a manual entry when present.
- `POST /api/time/:id/stop {ended_at}`.
- `PATCH /api/time/:id {started_at?, ended_at?, note?}` (re-sealed by the row's kind; an edit clears `auto_stopped`).
- `DELETE /api/time/:id` sets `deleted_at`.

**Device mirror:** a new IndexedDB store `time` (database version bump in `web/src/store/db.ts`); `pull()` adds the incremental time fetch with its own `last_pull_time` mark; creates use the queue's temp-id path like tasks.

**Trash, purge, export:** deleted entries are listed in Trash under "Time entries" (task or project name opened, duration, no note), restore through the generic route (a restore that would make a sixth running entry, or a second on its task, is refused with the same 409s), and are purged after 30 days. The Trash purge deletes a purged task's or project's entries before the task or project (FK). `GET /api/export` includes `time_entries` with work notes opened.

**Kelly:** no agent route reads `time_entries`; the seven-key agent task shape is unchanged.

## 2. Timers on screen, forgotten timers, widgets

**Task cards and sheet:** a start button on task cards (Today, Board, List) and in the task sheet; while running it is a stop button with elapsed time (`0:42`). The task sheet gains a **Time** section: "2h 15m of 3h" (or "3h 40m of 3h · +40m"), the task's entries (start, end, note, edit in place, delete), and "Add time" (date, duration read with the existing `parseEstimate`, optional note).

**Running-timers bar:** on every screen while anything runs: each running entry's task or project name, elapsed time, a stop button. Updated once a minute (no animation, so reduced motion changes nothing). It reads the mirror, so it works offline.

**Project "Log time":** on the project page, the same manual-entry form with no task; the note is required.

**Forgotten timers** (the existing 15-minute cron):

- At 4 hours running: one push "A timer has been running 4h" (never a task or project name, for any kind), guarded by the `push_outbox` key `timer:<id>:4h` written whether or not a device receives it; honours quiet hours (retried at the next tick) and a new switch `settings.push.timer` (default on).
- At 12 hours: `ended_at = started_at + 12h`, `auto_stopped = 1`. The entry shows "Stopped automatically, check the time" until edited. No push.

**Widgets** (iPhone/iPad and Android):

- The snapshot (`shared/widget-snapshot.ts`) gains `timers`: running entries with `started_at` and a title that follows the same fail-closed rule as items (`null` unless the task has no project or its project is present, live and cloud; project-only entries use the project name under the same rule) and the same `work` / `privacySensitive` handling.
- The medium and large Today widgets show running timers with a stop button; task rows gain a start button. The Lock Screen widgets show elapsed time only.
- **Second widget-token action:** `POST /api/widget/tasks/:id/timer {action: 'start' | 'stop', at}` (Bearer token, no cookie), same 60 a minute and 300 a day, same 401 rules; success audits `widget.timer` (target id, `{token, action, ok}`), never task text. Start follows the same rules as `POST /api/time` (409s); stop stops the task's running entry. The auth carve-out grows to exactly these two paths.
- A widget action that can't reach the server waits in a pending file with ticks (`pending-ticks.json` gains `{ id, at, action }` entries, still at most 200) and the app sends it at start or foreground through the queue. Only a 200 settles it.
- Native changes on both platforms (Swift, Java), `CompassNative` unchanged except the pending file's shape (`takeWidgetTicks` returns the actions too), their `npm test`, and `scripts/native.test.ts`.

## 3. Reporting

**Pure functions** (`shared/time.ts`, `scripts/time.test.ts`), on the device:

- `entryMinutes(e, now)`: a running entry counts to now.
- `splitByDay(e, tz, now)`: minutes per local calendar day in `settings.tz` (an entry over midnight splits).
- `taskMinutes`, `projectMinutes`, `programMinutes`: a subtask's minutes count toward its parent; project totals follow the task's current project plus the project's own entries; program totals sum its live members.

**Actual against estimate:**

- A task shows "2h 15m of 3h"; over the estimate, "+40m".
- A project's Dashboard and a program page show "Logged 42h of 60h estimated".
- **Accuracy** = logged ÷ estimated over *done* tasks that have both an estimate and some logged time: "You run 30% over" / "You run 10% under" / with fewer than 3 such tasks "Not enough done tasks with estimates yet".

**Workload:** the charts gain the **4 weeks before** the current one: actual minutes logged per project (from `splitByDay`) against that week's capacity, labelled "Actual"; the current and future weeks keep planned hours. The week picker and table include them.

**Time screen** (`/time`, in the rail after Workload):

- a week grid: days (Monday to Sunday) × projects ("No project" for unfiled tasks), day and row totals, previous / next week;
- choosing a cell lists its entries, edited in place or deleted (to Trash);
- **Export CSV** for a date range, built on the device: `date, start, end, minutes, kind, project, task, note, source` (RFC 4180 quoting; times in `settings.tz`); work notes are opened because the file stays on Vlad's device.

Reads come from the mirror; edits go through the queue.

**Status report:** the project report gains "Time this period" (hours logged in the report's range; logged against estimated for done tasks); the program report gains hours per project. Athena's summary text gets these as numbers only, in the existing name-free form.

## 4. Testing

In `npm run check`:

- `scripts/time.test.ts`: running minutes; `splitByDay` over midnight and the 2026-11-01 DST change in `America/Toronto`; subtask roll-up; project totals after a task moves; program totals; accuracy (under 3 → not enough); the week grid; CSV quoting (comma, quote, newline in a note); Workload past weeks.
- additions: `enc` (sealed note), `agent` (task shape unchanged), `notify` (the 4 h text has no name; outbox guard), `widget-snapshot` (timers fail closed), `widget` (timer action, limits, audit), `native` (pending actions), `report-model` (time numbers only).

`scripts/smoke.sh` sections (t0) to (t3): start, stop, stop again (unchanged); the 5-running cap; a second start on one task 409; a work note is ciphertext in D1; a manual entry in the future 400; the 4 h push once, no name; the 12 h auto-stop marked; the widget timer action with a good token and 401 with a bad one; Trash, restore, a purge following its task; export holds the entries. The smoke removes what it makes.

`cd mobile && npm test`: Swift and Java checks for the timer action and the pending file.

## 5. Delivery

Branch `v2-5-time`. Tasks, each ending with `npm run typecheck && npm run check` and a commit:

1. Migration 0018, types, sealing, routes, Trash, purge, export, the mirror store and pull.
2. Timers in the UI: cards, the task sheet's Time section, the running-timers bar, project "Log time".
3. Forgotten timers in the cron (push, auto-stop, the `push.timer` switch).
4. `shared/time.ts`, actual against estimate, accuracy, Workload past weeks, the Time screen, CSV, the status report.
5. Widgets: snapshot, token action, Swift and Java.
6. Docs (`CLAUDE.md` v2.5 section, the feature catalogue), full run, `deploy-steps.md`.

Nothing is deployed, migrated remotely or installed without Vlad's word.

## Not in v2.5

The Mac menu bar timer; Pomodoro or focus mode; billing rates or invoices; idle detection; Siri; Kelly access to time.
