# Phase 6 (Knowledge): live verification

Deployed 2026-10-20/21 on Vlad's word ("Deploy Phase 6").

## What was deployed
- Vectorize index `compass-knowledge` (1024 dimensions, cosine) and its metadata index on `collection_id` (string), created before any upsert.
- D1 migrations 0010–0013 on `compass-db`, after Time Travel bookmark `0000008d-00000098-0000510a-51c9650f0cb4a4ad2fbb7450e0422471`. Counts unchanged: ai_usage 2, documents 0, ai_threads 1, ai_messages 3, tasks 15.
- Compass `ad4704f4-59ee-4053-bd81-e654c82385aa` (branch `phase-6-knowledge`); Kelly-Cloud `b5fadb3f-c3d4-4ad9-af4a-03d1517e36c4` (branch `compass-phase-6`).
- Rollback points: Compass `5a2fa866-04de-4461-beaa-c1b088945b63`, Kelly-Cloud `19cf7c81-1faf-4718-a8f5-c094974713a3` (see the SDD workspace `deploy-steps.md` for what an old Worker does with the new tables).

## Checks
| Check | Result |
| --- | --- |
| `/api/knowledge/collections`, `/search`, `/locked/:id/passages` without a session | 401 |
| `POST /api/knowledge/apps/refresh` without Origin | 403 |
| Kelly-Cloud `/api/compass-relay/apps-digest` without the secret / with it | 401 / 200, four sections, each ≤ 4,000 characters |
| Health section of the live digest | counts only ("0 refills due", "3 not yet taken today"); no medication name |
| Agent knowledge search with Kelly off | 403 `kelly_disabled` |
| "From my apps" refresh | 5 items ready (Compass, Finance, Health, Home, Hollow) |
| A 190 KB text file in a personal collection | 65 passages, real bge-m3 batches of 50 and 15 ($0.00061), ready; "paragraph 1234" found first (its part and the overlapping one) once Vectorize had processed the batch (a search seconds after upload found nothing yet) |
| A Locked work collection | name and passage sealed in D1 (`enc_v 2`), `embedded 0`, no vector (index count unchanged at 72); found by words on the device; "Ask Athena about this" disabled |
| Locked → Cloud AI (passkey) | the passage is embedded (index 72 → 73) |
| Athena, "No project (work)" thread with Use knowledge | cites `compass-locked-check.txt · part 1`; the thread is `kind work`, messages sealed |
| Athena, personal thread, knowledge off | does not read the work collection (as designed) |
| Cloud AI → Locked | `embedded 0` at once; index back to 72 |

## Notes for later
- The collection page once showed "Locked" highlighted while the server still had it as Cloud AI, so the first switch back did nothing; after a reload it worked. The page should refresh a collection's state when it is opened again.
- "New conversation" in Athena sits inside the closed "Conversations" list at the bottom; a visible button next to the Ask box would help.
- `wrangler tail` could not connect from this network (tail endpoint timed out); D1 and the audit log were used instead.
