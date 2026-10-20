# Sending things to Compass (sender contract)

Compass has one public door: `POST https://compass.knocturnlabs.com/api/inbox`. Finance, Health, Home Assistant, Night Owl, Hollow and SonarFlow meetings post here; forwarded email arrives through the email handler, which calls the same code.

## Request

```
POST /api/inbox
Authorization: Bearer <your secret>
Content-Type: application/json
```

No cookie and no `Origin` header are needed (a server sends it). Every other `/api/inbox*` route needs a signed-in session from Compass's own pages.

| Field | Type | Rule |
|---|---|---|
| `app` | string | `finance`, `health`, `home`, `nightowl`, `kelly`, `sonarflow`, `hollow`. Must be allowed for your secret (below). |
| `kind` | string | `notification`, `meeting` (sonarflow only) or `email` (kelly only) |
| `title` | string | required, 1-120 characters, trimmed |
| `body` | string | optional, at most 500 characters |
| `url` | string | optional, `https:` only, at most 2048 characters |
| `ref` | string | optional, at most 200 characters. The same `ref` means "the same thing again" (see Dedupe). Required for `meeting`, which must be `sonarflow:recording:<id>`. |
| `suggest` | string | optional, at most 40 characters, e.g. `pay_bill`, `review_budget`, `log_meds`; rules can match on it |
| `payload` | any JSON | optional, at most 64 KB when serialised. Kept as data and never rendered as HTML. |

A `meeting` post's `payload` must be `{ title, summary, decisions: [{text, at}], action_items: [{text, owner, due, at}], important_notes: [{text, at}], open_questions: [{text, at}] }`. A `kelly` `email` post may carry `payload.from`, `payload.account` (the mailbox; an address at a work domain from Settings makes it work content) and `payload.text`.

Medication names never cross this bus: Health sends the `log_meds` suggestion with a generic title.

## Which secret may post which app

| Secret (Worker secret) | Apps |
|---|---|
| `INBOX_SECRET_KELLY` | `finance`, `health`, `home`, `nightowl`, `kelly` |
| `INBOX_SECRET_ID` | `sonarflow` |
| `INBOX_SECRET_HOLLOW` | `hollow` |

Secrets are compared in constant time. A secret that is not set never matches.

## Responses

| Status | Meaning |
|---|---|
| `201` `{ id, state, task_id }` | Accepted. `state` is `new` (waits in the inbox), `added` (a task was made or updated; `task_id` is set) or `dismissed` (a rule ignored it). |
| `400` `{ error }` | The body failed a rule above (the message says which). |
| `401` | Missing or wrong secret. |
| `403` | `app` is not one this secret may post. |
| `413` | Body over 200 KB. |
| `429` | More than 120 posts in the last minute. Retry later. |
| `500` | Compass failed. Retry with backoff; the same `ref` makes a retry safe. |

## Refs and dedupe

A `ref` ties repeated posts about one thing together, within the posting app only (another app's `ref` is never matched). When a rule says `update` (the usual), a post with a `ref` that already has an open task updates that task instead of making another: the due date only ever moves earlier, and the title, notes and link refresh only while you haven't edited the task yourself; `skip` only notes that it was seen again; `always` makes a new task each time. A finished task gives its `ref` up, so the next occurrence makes a fresh task. Email is the exception: an `email` post makes at most one task per `ref`, ever, so a needs-reply email reposted every hour doesn't bring back a task you finished or trashed, or rewrite it while it's open.

Conventions:

- `kelly:<app>:<url>` for Kelly Cloud notifications, e.g. `kelly:finance:https://finance.knocturnlabs.com/subscriptions.html#watch-netflix`
- `email:<provider>:<id>` for email
- `sonarflow:recording:<id>` for a meeting: the only ref a meeting may have, `<id>` is 1-100 characters with no colon or space and is the recording id. Only `sonarflow` may post `meeting`, and only `kelly` may post `email`.
- `hollow:inbox`, `hollow:disk:<letter>` for Hollow

## Example

```bash
curl -s -X POST https://compass.knocturnlabs.com/api/inbox \
  -H "Authorization: Bearer $INBOX_SECRET_KELLY" \
  -H 'Content-Type: application/json' \
  -d '{"app":"finance","kind":"notification","title":"Netflix went up","body":"$16.49 to $18.99","url":"https://finance.knocturnlabs.com/subscriptions.html#watch-netflix","ref":"kelly:finance:https://finance.knocturnlabs.com/subscriptions.html#watch-netflix","suggest":"review_budget"}'
# {"id":"...","state":"added","task_id":"..."}
```

## Agent API (Kelly)

Kelly reads and adds to Compass through `/api/agent/*`, a separate door from the inbox. It is off until Vlad switches it on (Settings JSON `kelly`: `{ enabled, scopes }`; both off by default, changed only through the passkey-guarded Kelly route, never `PATCH /api/settings`, which answers 400 `use_kelly_route`).

Auth: `Authorization: Bearer <AGENT_SECRET_KELLY>` (a Worker secret; local value in `.dev.vars`), compared in constant time; unset never matches. No cookie. A bad or missing secret is a plain 401: no audit row, not counted against the limits.

Scopes (all off by default; there is no delete scope, and Kelly never edits titles, trashes or reopens):

| Scope | Routes |
|---|---|
| `compass:read.tasks` | `GET /today`, `GET /tasks?view=today\|overdue\|upcoming\|waiting&limit=` (limit 1 to 50, default 20) |
| `compass:write.tasks` | `POST /tasks` `{ title (1-120), due_at?: YYYY-MM-DD, horizon?: short\|medium\|long, project_id?, notes? (2000) }` -> 201 `{ task }`; `POST /tasks/:id/done` -> `{ task }` |
| `compass:read.projects` | `GET /projects` -> `{ projects: [{ id, name, rag, rag_reason, pct_done, next_milestone, open_risks }] }` |

`AgentTask` is `{ id, title, due_at, horizon, status, project, priority }` (decrypted). `/today` returns `{ date, due_today, overdue, waiting, next_milestones: [{ name, project, due_at }], hidden }`; `/tasks` returns `{ date, view, tasks, hidden }`.

Only shared items are visible: a task with no project if it is personal; otherwise only a task or project whose project is live (not in Trash) with the `cloud` data boundary. Everything else answers 404 as if missing (create with such a `project_id`, done on such a task, or on a task that is already done) and shows up only as the number `hidden`. A task made in a work-and-cloud project is sealed like any work row. Kelly's tasks have `source_app` `kelly`; their events have actor `kelly`.

Refusals: `401` bad secret; `403 { error: 'kelly_disabled' }`; `403 { error: 'scope_not_granted', scope }`; `400 { error }` bad body; `404`; `429 { error: 'rate_limited' }` (more than 60 calls in 60 seconds) or `{ error: 'write_limit' }` (more than 30 creates and dones in an hour).

Audit: every authenticated call writes one `audit_log` row: actor `kelly`, action `agent.today`, `agent.tasks.list`, `agent.tasks.create`, `agent.tasks.done` or `agent.projects`, target the task id when there is one, detail `{ "ok": true }` or `{ "refused": "kelly_disabled" | "scope_not_granted" | "not_found" | "rate_limited" | "write_limit" | "invalid" | "error" }`. Never task text. If the handler fails after the checks, the row says `error` and the call answers 500 `{ error: 'internal' }`.

Only top-level tasks are visible: a subtask is never listed and `done` on one is a 404 (subtasks do not inherit their parent's project or kind).

## Kelly's relay (Compass → Kelly-Cloud)

Compass calls Kelly-Cloud's `KELLY_RELAY_URL` (`/api/compass-relay`) server to server with `X-Relay-Secret` (`KELLY_RELAY_SECRET` here, `COMPASS_RELAY_SECRET` there); redirects are never followed. `GET /brief?date=` and `GET /calendar?from=&to=` feed Today (worker/routes/kelly.ts). `POST /documents` (raw bytes, `X-File-Name` URI-encoded, up to 20 MB, answers `{ id }`) is the document hand-off: `POST /api/library/import` with `also_kelly: true` sends the file to Kelly's own document search, only for a personal document with no project or in a live cloud-boundary project, and only after the library import itself succeeded. A failed hand-off never fails the import (the answer carries `kelly: "failed"`); each attempt is one `kelly.document` audit row with no content. Work, Offline-only and trashed documents are never sent.
