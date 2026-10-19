# Phase 2 verification (2026-10-19)

## Live

| Piece | State | Version (rollback) |
| --- | --- | --- |
| Compass migrations 0003, 0004 | applied to `compass-db`; all six new tables present | — |
| Compass Worker | deployed from `phase-2-sources` | d70c952d (was 7d7a451e) |
| Compass secrets | INBOX_SECRET_KELLY/ID/HOLLOW, VAPID pair, EMAIL_INBOX_ADDRESS, ALLOWED_FORWARDERS put | — |
| Knocturn ID | deployed from `compass-phase-2`; COMPASS_INBOX_SECRET set; posts meetings only for COMPASS_OWNER_USER_ID (Vlad's account, checked against the users table: it owns the SonarFlow recordings) | 4e6ccb6a (was 8220d06f) |
| Email Routing | rule "Compass inbox": the secret address → Worker `compass` | rule 91f79feb… |
| Hollow | deployed; COMPASS_INBOX_SECRET set | 5db1bf28 (was 6677f9b1) |
| Kelly-Cloud | deployed; COMPASS_INBOX_SECRET set | 2f766dab (was 46db53b8) |
| Health | deployed from its worktree (no new secret) | 13e58715 (was 0477713d) |
| Finance | deployed from its worktree (no new secret) | ff4e889b (was 5a2c6e06) |

Each outside app's live version matched its `main` before deploy, so a deploy adds only the Compass change.

## Verified in production

- `/` and `/sw.js`: CSP, HSTS, nosniff, `X-Frame-Options: DENY`, referrer policy present.
- `POST /api/inbox` with no secret → 401; wrong secret → 401; `GET /api/email/address` without a session → 401.
- A post with the Kelly secret ("Compass pipe test", app `kelly`) → 201, state `new` (waits in the Inbox to be dismissed).
- Scheduled run (every 15 min): two production runs watched, both outcome ok, no exceptions or error logs.

- Email: Vlad forwarded one email from his Bell address; it arrived as a Work email item and made a task.
- Push encryption: the payload Compass sends decrypts with the reference `http_ece` library; Vlad's Chrome subscription took the test push (Google answered 201) but nothing showed on the Mac, so the gap is on the device.

## Waiting on a natural trigger or on Vlad

- Meetings: the next SonarFlow meeting with notes, or "Regenerate notes" on an existing one.
- Push on the Mac: allow notifications for the browser in macOS settings, then "Send a test" again. On the phone: add Compass to the Home Screen, open it from there, turn notifications on.
- Kelly bus, Health, Finance: the next stored Kelly notification, refill check or subscription sweep. Hollow: its daily run at 13:00 UTC.
