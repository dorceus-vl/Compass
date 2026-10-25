# v2.4 (Programs, portfolio budget, workload): live verification

Deployed 2026-10-25 on Vlad's word ("Deploy v2.4"), from `main` at 53be4d3.

## What was deployed
- D1 migration `0017_programs.sql` on `compass-db`, after Time Travel bookmark `0000023b-00000762-0000510f-0d120fba08d6e90a7634ffe66c80a9a3`. Counts unchanged: tasks 26, projects 1, task_events 64; after: programs 0, projects with currency CAD 1 (every project).
- Compass `1dd5d6fc-3d1f-4040-b928-980fe7fdcbe0`.
- Rollback point: Compass `8184e530-ba87-4c4c-ac38-f03e18f8086a` (v2.3). The old code ignores `programs` and the three new project columns, so the database can stay migrated (SDD workspace `deploy-steps.md`).
- No new secrets, vars, bindings, cron changes or unauthenticated routes. Kelly-Cloud untouched.

## Checks
| Check | Result |
| --- | --- |
| `GET /api/programs`, `GET /api/programs/x/detail` without a session | 401 |
| `POST /api/reports/status {program_id}` without a session (with Origin) | 401 |
| `POST /api/widget/tasks/x/done` without a token (v2.3 still answers) | 401 |
| `/` | 200; the live bundle carries the v2.4 screens |
| `wrangler tail` during the checks | not observed: the tail connection timed out from this machine (ETIMEDOUT to Cloudflare) |

## Still to check with Vlad (signed in with his passkey)
1. Projects, Today, Board and Settings load as before; the Projects screen shows a Projects | Programs switch; Workload is in the rail after Calendar.
2. Settings → Workload shows 40 / 8 / 8 h / 60 min; a change survives a reload.
3. New work program with a RAG; a work project joins it through the Program picker, with a planned budget, forecast and currency; the program page shows the worst RAG, the project row and the budget per currency; "Show as table" works.
4. A task estimate "1h 30m" shows on its due day in Workload.
5. Program → Report: preview, Word, Markdown; "Ask Athena for a summary" (all members Cloud) answers with "Project 1", never a name; with an Offline-only member it says why not.
6. Trash a test program: its projects read "No program"; the program is in Trash with Restore.
7. Optional, read-only: `SELECT at, actor, action, target, detail FROM audit_log WHERE action LIKE 'program.%' OR action = 'report.program' ORDER BY at DESC LIMIT 10` shows ids and `{ refused }` only.
