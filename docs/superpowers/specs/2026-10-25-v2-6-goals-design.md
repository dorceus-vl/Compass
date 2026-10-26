# Compass v2.6: goals and OKRs (design)

*2026-10-25. Builds on v2.4 (programs, the program report) and v2.5 (the device mirror for a new entity, Approach A). Every rule in `CLAUDE.md` still holds.*

## What Vlad asked for

OKRs / goals from the feature catalogue (`docs/compass-features.md`): personal and work objectives with key results, tasks linked to them, and the long horizon shows them.

Decisions he made on 2026-10-25:

- **Key results come in four types:** a number from a start to a target (`number`), progress from linked tasks (`tasks`), done / not done (`done`), and a percent set by hand (`percent`).
- **Period: a quarter by default, free dates allowed.** A new goal picks Q1 to Q4 of a year, which fills `starts_on` and `ends_on`; either date can then be changed.
- **Tasks and projects link to a key result.** A linked project counts all its live tasks.
- **Check-ins keep history:** each one stores a value, a note and a confidence (on track, at risk, off track); the goal shows the trend.

Defaults taken without a question:

- **Kelly never sees goals** (no agent route, no field), as in v2.2, v2.4 and v2.5. Athena does not read them either.
- **A goal has one kind** (personal or work), fixed at creation. Its key results, check-ins and links take that kind; a link to a task or project of the other kind is refused (409 `goal_kind`). Work goals are sealed (rule 5).
- **No goal tree** (no parent goals) and **no weights**: a goal's progress is the plain mean of its key results.
- **Approach A again:** goals, key results, links and check-ins live in the device mirror; edits go through the offline queue; every progress figure is a pure function on the device (`shared/goals.ts`), so work content is never needed on the server to compute it.

## 1. Data and sync

Migration `0019_goals.sql` (the only schema change):

- `goals`: `id`, `kind`, `title`, `description`, `starts_on`, `ends_on` (ISO dates, `starts_on <= ends_on` CHECK), `status` (`active`, `achieved`, `missed`, `dropped`; default `active`), `sort`, `enc_v`, `created_at`, `updated_at`, `deleted_at`.
- `key_results`: `id`, `goal_id`, `title`, `type` (`number`, `tasks`, `done`, `percent`), `start_value`, `target_value`, `current_value`, `unit` (for `number`; `start_value != target_value` CHECK so a decrease target like 10 → 0 works), `sort`, `enc_v`, timestamps, `deleted_at`. At most 10 live per goal (409 `kr_limit`).
- `goal_links`: `id`, `kr_id`, `task_id` xor `project_id` (CHECK), `created_at`, `deleted_at`. At most 200 live per key result (409 `link_limit`); a task or project links once per key result (unique index on live rows).
- `goal_checkins`: `id`, `kr_id`, `value` (nullable for `tasks`, where the value is computed), `confidence` (`on_track`, `at_risk`, `off_track`), `note` (max 500), `at`, `enc_v`, `created_at`, `deleted_at`. A check-in on a `number`, `percent` or `done` key result also sets its `current_value`.

Sealed for work (`ENC_COLS`): `goals.title`, `goals.description`, `key_results.title`, `key_results.unit`, `goal_checkins.note`. Numbers, dates, ids, types and confidence stay plain.

Routes (`worker/routes/goals.ts`): `GET /api/goals[?since=]` returns all four tables (with `since`, trashed rows too); `POST`, `PATCH /:id` (compare-and-swap on `updated_at`, 409 `goal_conflict`), `DELETE /:id` for goals and key results; `POST /api/goals/krs/:id/links`, `DELETE /api/goals/links/:id`; `POST /api/goals/krs/:id/checkins`. A goal in Trash takes its key results, links and check-ins with it and restores them together. Purge after 30 days removes check-ins, links, key results, then the goal. Export includes all four, work text opened. Trashing a task or project hides its links from progress (as v2.5 hides time); restoring brings them back.

Device: IndexedDB `VERSION 3` adds `goals`, `krs`, `goal_links`, `checkins` stores; the queue's `Entity` gains them; `pull()` reads `/goals?since=` with `meta.last_pull_goals`.

## 2. Progress (`shared/goals.ts`)

Each key result's progress is 0 to 1, clamped:

- `number`: `(current - start) / (target - start)`.
- `percent`: `current / 100`.
- `done`: 0 or 1.
- `tasks`: done tasks over live tasks across its links (a linked project counts its live tasks; a task reached twice counts once). No tasks yet = 0.

A goal's progress is the mean of its live key results. **Expected** progress is the share of the period elapsed (today between `starts_on` and `ends_on`), so a goal at 30 % with 60 % of its quarter gone reads behind. A key result's confidence is its latest check-in's; with no check-in, none is shown. Tests in `scripts/goals.test.ts`: each type, decreasing targets, a duplicated task, trashed links, the period edges.

## 3. On screen

- **Goals screen** (`/goals`, in the nav after Programs): this period's goals grouped by kind, each with a progress bar, the expected marker, and the key results' confidence dots; a period switcher (this quarter, next, past, all). Create a goal from a quarter picker or two dates.
- **Goal page:** key results with their bars, a check-in button on each (value, confidence, note), the check-in history as a small trend line per key result (plain SVG, as the Timeline), linked tasks and projects, and Close (achieved, missed, dropped).
- **Linking:** from a key result ("Link tasks", "Link a project") and from the task sheet and project page ("Supports a goal"). The task sheet and the project page show the key results they serve.
- **The long horizon:** Today's long-horizon feed shows the active goals at its top (title, progress against expected), each opening its goal page. Weekly Review gains a "Goals" step: each active key result with no check-in in 7 days, one tap to check in.
- Tokens only, from `assets/brand/DESIGN.md`; no new token.

## 4. Testing

`scripts/goals.test.ts` (progress, caps, kind refusal, sealing round trip) and additions to `enc`, `native` and the Trash tests in `npm run check`; a (k0) to (k2) section in `scripts/smoke.sh` (create, link, check in, trash and restore, purge order). `grep -rn 'bind(\.\.\.' worker` stays bounded: link inserts are one row at a time, reads use `?1` or subselects.

## 5. Delivery

Branch `v2-6-goals`. Tasks, each ending with `npm run typecheck && npm run check` and a commit:

1. Migration 0019, types, sealing, routes, caps, Trash, purge, export, the mirror stores and pull.
2. `shared/goals.ts` and its tests.
3. Goals screen and goal page, check-ins and the trend line.
4. Linking from key results, the task sheet and the project page.
5. Today's long horizon and the Weekly Review step.
6. Docs (`docs/HISTORY.md` v2.6 section, the feature catalogue), full run, `deploy-steps.md`.

Nothing is deployed, migrated remotely or installed without Vlad's word.

## Not in v2.6

Parent and child goals; weights; goals in status or program reports; push reminders to check in; Kelly or Athena access; widgets; goals on the Timeline.
