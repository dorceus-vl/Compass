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

A `ref` ties repeated posts about one thing together. When a rule says `update` (the usual), a post with a `ref` that already has an open task updates that task's title, notes and link instead of making another; `skip` only notes that it was seen again; `always` makes a new task each time. A finished task gives its `ref` up, so the next occurrence makes a fresh task.

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
