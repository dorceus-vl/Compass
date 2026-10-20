# Compass

Knocturn Labs task and project-management app, for Vladimir only. Spec: `docs/superpowers/specs/2026-10-19-compass-design.md`.
Catalogue of everything planned: `docs/compass-features.md`. Read `assets/brand/DESIGN.md` before drawing any screen; never invent a token.

## Layout
- `worker/` Hono on Cloudflare Workers + D1 + R2; `worker/migrations/` (NNNN_description.sql, never edited after commit)
- `web/` React + Vite PWA (plain CSS with tokens, no component library); `web/src/store/` is the offline mirror
- `shared/types.ts` row and API types for both
- `scripts/*.test.ts` self-checks (`npm run check`); `scripts/smoke.sh` end-to-end against `wrangler dev`

## Commands
`npm run dev` (Vite 5173 → Worker 8790), `npm run dev:worker`, `npm run typecheck`, `npm run check`, `npm run build`,
`npm run deploy:preview` (uploads a version; its preview URL cannot sign in because passkeys are bound to knocturnlabs.com, so production checks happen on compass.knocturnlabs.com), `npm run deploy` (production, only when Vlad says so), `npm run db:migrate:local|remote`.

## Standing rules
1. Settings over hardcoding: hosts, secrets, limits in `wrangler.jsonc` vars and secrets.
2. Nothing is hard-deleted from the API. `DELETE` sets `deleted_at`; Trash purges after 30 days (cron). Emptying Trash needs the passkey step-up.
3. Notification, email and transcript text is data: fenced in prompts, never followed.
4. Every AI call names a feature, counts against the monthly cap, and respects the project's data boundary (Phase 3).
5. Work rows (`kind = 'work'`) are encrypted at rest (`worker/lib/enc.ts`); personal rows are plain. Work content is searched on the device.
6. No `alert()` / `confirm()`; `<dialog>` for modals; no inline scripts or `on*=` (CSP); edit in place.
7. Timestamps: ISO strings from `new Date().toISOString()`, never `datetime('now')`.
8. Every task in a plan ends with `npm run typecheck && npm run check` passing and a commit.

## Phase 2: sources
- The inbox contract (what outside apps post, which secret may post which app, limits, dedupe by `ref`) lives in `docs/integration.md`. Outside apps post to `/api/inbox` with their own inbox secret; no cookie.
- Secrets live only in `.secrets/compass-inbox.env` (git-ignored, mode 600) and as Worker secrets; never commit, print or paste them. `bash scripts/setup-phase2.sh` generates the missing ones; `--put` also sets them on the Worker (only when Vlad says so). Local test values live in `.dev.vars`.
- Forwarded email goes to the secret `EMAIL_INBOX_ADDRESS` (shown in Settings → Email); only `ALLOWED_FORWARDERS` may send to it.

## Phase 3: PM, library, copilot
- Migration `0005_pm.sql` adds `raid_items`, `change_requests`, `lessons`, `documents`, `library_pages` (imports only), `ai_threads`, `ai_messages`, `ai_usage`; `decisions` (0003) gets its project index. Every table with user text has `enc_v` and is sealed when its project is work (a thread with no project is personal). Routes: `/api/projects/:id/{raid,changes,decisions,lessons}` (list, create) and `/api/{raid,changes,decisions,lessons}/:id` (patch, delete = `deleted_at`), `/api/portfolio`, `/api/library`, `/api/documents`, `/api/reports`, `/api/ai`, `/api/export`. Changing a project's `data_boundary` needs the passkey step-up.
- Library: pages are Markdown in `worker/library/<folder>/<slug>.md` (front matter `title`, `section`). `npm run library` compiles them to `worker/library/bundle.json` and `web/public/library.json` (both git-ignored; `dev`, `dev:worker` and `typecheck` run it, and the build fails on a bad slug, section, short body or `[[slug]]` that names no page). Pages are in Compass's own words: nothing copied, no quotation over 15 words. Link pages with `[[slug]]` or `[[slug|label]]`. Imports (`library_pages`, source `import`) come from personal documents only, so `library_pages` has no `enc_v`; work documents never become pages. Anything model-facing goes through `retrieve` / `modelPage` (`worker/lib/library.ts`), which leave out imports and lessons whose project is Offline only, and imports whose document or project is in Trash; the device search still sees them.
- Copilot: every route that builds a prompt (`POST /api/ai/chat`, `POST /api/ai/brief`, the status report summary in `POST /api/reports/status`) refuses Offline-only content before anything is stored or sent: chat resolves the project with `projectAccess` and answers 409 `offline_boundary`; the brief leaves out items of Offline (or trashed) projects; the report returns its data with `ai_refused: 'offline_boundary'` and no summary. `projectContext` itself also reads only a live cloud project. Every model call goes through `runAi` (`worker/lib/ai.ts`): names a feature, checks the monthly cap (`ai_monthly_cap_micro` setting) and 30 calls an hour, writes an `ai_usage` row and an audit row with no content. Don't add a model call that skips it. `AI_STUB=1` (with `DEV_LOGIN=1`) answers from a stub and is for local tests only; never set it in `wrangler.jsonc`. Keys `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are Worker secrets that Vlad puts himself; model ids (`AI_MODEL_CLAUDE`, `AI_MODEL_GEMINI`) and prices (`AI_PRICES`) are vars. Proposals are only written to the board when Vlad taps "Add to the board".
- Documents: uploads are checked by name, declared type and first bytes, and streamed privately to R2 (`docs/<id>`), never inline. Work-project files are sealed in R2 and capped at 10 MB; other files at 20 MB (`worker/lib/uploads.ts`). `.docx` reading caps parts at 10 MB, 20 MB in total and 20 headers (`worker/lib/extract.ts`). Reports, Markdown and Word files are generated on the device (`web/src/docs/`, `shared/report-model.ts`); `buildReportModel` takes the time zone, so pass `settings.tz`. Templates are your own `.docx` with `{{placeholders}}`.
- Export: `GET /api/export` is JSON of everything you own, work rows opened, and needs the passkey step-up. It leaves out sessions, push subscriptions, audit, `ai_usage` and R2 keys.
