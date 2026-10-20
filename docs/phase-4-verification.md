# Phase 4 (native apps) verification (2026-10-20)

## Live

| Piece | State | Version (rollback) |
| --- | --- | --- |
| Compass migration 0006 | applied to `compass-db`; the existing web subscription kept as kind `web`; `push_outbox` created | — |
| Compass Worker | deployed from `phase-4-shells` (device push, `/api/auth/native`, outbox, trust files) | 70227f82 (was 2895fed5) |
| Knocturn ID | deployed from `compass-phase-4`: `APP_REDIRECTS` gains `compass=compass://auth`; checkout returned to `main` | 00065ca4 (was 2797a5c0) |
| knocturnlabs.com | deployed from a clean copy of `compass-phase-4` (only the two trust files uploaded; also carries main's undeployed Aura assetlinks entry); Vlad's uncommitted landing files untouched; checkout returned to `main` | 361fcdb5 (was 2af7cc1c) |

## Verified in production

- Trust files: `knocturnlabs.com` and `compass.knocturnlabs.com` serve `apple-app-site-association` and `assetlinks.json` as `application/json` (200), each listing `com.knocturnlabs.compass`; Aura's entry kept.
- Compass: security headers unchanged; `POST /api/auth/native` with no body → 400; `/api/push/device`, `/api/push/outbox`, `/api/today` without a session → 401.
- Locally before deploy: typecheck, self-checks, build, smoke; iOS simulator builds, Android debug APK and release guard, Mac app bundle, `cargo test`.

## Waiting on Vlad

- Apple push key on the Compass Worker: `APNS_KEY_P8`, `APNS_KEY_ID` (not yet set).
- Optional Firebase project for Android push (`google-services.json`, `FCM_SERVICE_ACCOUNT`).
- Xcode signed in; iPhone, iPad and Samsung connected — then Task 7 (install and device checklists in `mobile/README.md` and `mac/README.md`).
- After the install: remove the old browser push subscription on devices that get the app (otherwise pushes arrive twice); install Debug builds only.
