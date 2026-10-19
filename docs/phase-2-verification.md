# Phase 2 verification (2026-10-19)

## Live

| Piece | State | Version (rollback) |
| --- | --- | --- |
| Compass migrations 0003, 0004 | applied to `compass-db`; all six new tables present | — |
| Compass Worker | deployed from `phase-2-sources` | d70c952d (was 7d7a451e) |
| Compass secrets | INBOX_SECRET_KELLY/ID/HOLLOW, VAPID pair, EMAIL_INBOX_ADDRESS, ALLOWED_FORWARDERS put | — |
| Knocturn ID | deployed from `compass-phase-2`; COMPASS_INBOX_SECRET set; posts meetings only for COMPASS_OWNER_USER_ID (Vlad's account, checked against the users table: it owns the SonarFlow recordings) | 4e6ccb6a (was 8220d06f) |
| Email Routing | rule "Compass inbox": the secret address → Worker `compass` | rule 91f79feb… |
| Hollow, Kelly-Cloud, Health, Finance | prepared on `compass-phase-2`, not deployed yet | — |

Each outside app's live version matched its `main` before deploy, so a deploy adds only the Compass change.

## Verified in production

- `/` and `/sw.js`: CSP, HSTS, nosniff, `X-Frame-Options: DENY`, referrer policy present.
- `POST /api/inbox` with no secret → 401; wrong secret → 401; `GET /api/email/address` without a session → 401.
- A post with the Kelly secret ("Compass pipe test", app `kelly`) → 201, state `new` (waits in the Inbox to be dismissed).
- Scheduled run (every 15 min): two production runs watched, both outcome ok, no exceptions or error logs.

## Waiting on a natural trigger or on Vlad

- Email: forward one email from the Bell address; it should land as a Work task with the text in notes and the original downloadable.
- Meetings: the next SonarFlow meeting with notes, or "Regenerate notes" on an existing one.
- Push: turn notifications on in Settings on the Mac and the phone, press "Send a test"; then the 07:00 digest.
- Kelly bus, Hollow, Health, Finance: after those apps are deployed.
