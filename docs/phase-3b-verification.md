# Phase 3b (redesign) verification (2026-10-19)

## Live

| Piece | State | Version (rollback) |
| --- | --- | --- |
| Compass Worker and app | deployed from `phase-3b-redesign` (UI only; no Worker, schema or migration change) | 2895fed5 (was d9406fcd) |
| Service worker cache | `compass-1792468773612`, so devices load the new UI on their next visit | — |
| App icons | the ivory Knocturn Labs badge (192, 512, Apple touch) | — |

## Verified

- Production: `/` and `/sw.js` keep all four security headers; `/library.json` 200; `/api/today`, `/api/portfolio`, `/api/ai/usage` without a session → 401.
- Locally before deploy: typecheck, 33 self-checks, build and the full smoke pass; every screen audited at 375 px and 1280 px (no sideways scroll, 44 px targets, keyboard, reduced motion); scrolling Today at 4× CPU throttle has 1 long task (was 39 before the lens fix); JS +11.6 KB gzip over Phase 3.

## Waiting on Vlad (real devices)

- iPhone: swipe back from a project (one animation, not two); swipe a task done, undo with the check; swipe an inbox item left.
- Android: predictive back; drag a card on the board; drag a bar on the timeline.

## Decisions made during the build

| Decision | Cost if wrong |
| --- | --- |
| The compass is its own component, so sign-in reuses it. | None |
| A finished task stays struck through for the current visit of a list so the check can undo it; counts and limits count open tasks only. | None |
| The audit task also fixed the small issues that would show in daily use (on-hold projects, tap targets, active-page marker, danger-button contrast, list consistency). | None |
| The back gesture on phones plays only the phone's own animation. | None |
| Swiping a finished task does nothing; the check is the undo. | None |
| Model tiers: the strongest model for the core interaction pieces and the final review, a faster one elsewhere. | Spend only |
