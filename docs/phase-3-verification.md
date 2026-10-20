# Phase 3 verification (2026-10-19)

## Live

| Piece | State | Version (rollback) |
| --- | --- | --- |
| Migration 0005 | applied to `compass-db`; the eight new tables present | — |
| Compass Worker | deployed from `phase-3-pm` | dea02d0f (was e71445c3) |
| AI keys | not on the Compass Worker at deploy time (`wrangler secret list` shows neither ANTHROPIC_API_KEY nor GEMINI_API_KEY); the copilot says "Not set up" until they are put | — |
| Models | `AI_MODEL_CLAUDE = claude-sonnet-5-5`, `AI_MODEL_GEMINI = gemini-3.6-flash` (vars) | — |

## Verified in production

- `/` keeps CSP, HSTS and `X-Frame-Options: DENY`.
- Scheduled runs: two production runs watched after the deploy, all outcomes ok, no exceptions or error logs.
- `/library.json` → 200 JSON with 43 pages.
- Without a session: `/api/library`, `/api/portfolio`, `/api/ai/usage`, `/api/documents`, `/api/export` → 401; `POST /api/ai/chat` → 403 (same-origin check first); `POST /api/inbox` without a secret → 401.
- Locally before deploy: typecheck, 32 self-checks, build and the full smoke (governance, library boundary, copilot with the stub, offline refusal storing nothing, sealed work rows, documents and imports, zip caps, reports, brief boundary, export) pass.

## Waiting on Vlad

- Put the AI keys on the Compass Worker (in `~/Documents/Compass`): `npx wrangler secret put ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` if wanted.
- Live copilot check: one question on a personal project; then "Ask Gemini too" and a follow-up in the same thread (alternating history fix). If Claude answers `provider_error` for `claude-sonnet-5-5`, switch the var to `claude-sonnet-5` and redeploy (ruling R6).
- One status-report PDF from the iPhone (print on `afterprint`).
- Per Bell project: whether it may use cloud AI (passkey to switch).

## Decisions made during the build

Each one was decided by Claude Code to keep the build moving; the cost column is what it costs if it was wrong.

| Decision | Cost if wrong |
| --- | --- |
| A decision's date is required (the database column never allowed it empty). | None |
| The copilot's library search never includes lessons from projects set to Offline only; the device's own library search still shows them. | None |
| Library imports refuse files from Offline-only projects, and an import whose project later goes Offline only drops out of the copilot's reach. | None |
| Work files are capped at 10 MB (encrypted), other files at 20 MB. | Large Bell files must be split or kept elsewhere |
| Uploads without a declared size are refused (browsers always declare it). | None |
| Status reports count a task as done on the local day it was finished (Toronto time), not the UTC day. | None |
| Your own Word templates can only read real report fields, never hidden object properties. | None |
| Milestones gained a Gate toggle (the flag existed but nothing set it). | One small screen change |
| The library describes a gate milestone as a marker; the go / no-go outcome is recorded as a decision. | None |
| Uploads larger than the caps, or Word files that inflate past safe limits, are refused instead of processed. | None |
| The copilot's conversation history merges back-to-back answers so Gemini always sees alternating turns. | None |
| The status-report PDF waits for the print dialog to finish before clearing its print copy (iPhone). | None |
| A trashed document's library import stops being visible to the copilot at once. | None |
| "Add to the board" records each added item as it goes, so a retry never adds duplicates. | None |
| The real-session passkey prompt on the boundary switch was checked by code review, not by a live test. | A missing prompt would go unnoticed until used |
| Model tiers: faster models for most code, the strongest for the copilot boundary, the library content and every security review. | Spend only |
