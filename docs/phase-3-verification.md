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
