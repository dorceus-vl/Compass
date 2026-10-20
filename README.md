# Compass

Compass is the Knocturn Labs task and project-management app: one place for personal and work tasks across three
horizons, a board, projects with PM governance, tasks that other Knocturn apps create by themselves, a meeting review
fed by SonarFlow, a PM copilot on Claude or Gemini with an offline library, and document generation. Single user.
Web, Mac, iPhone, iPad, Android, with push on all of them.

Spec: `docs/superpowers/specs/2026-10-19-compass-design.md`. Everything planned: `docs/compass-features.md`.

## What Compass does
- Tasks, board and three horizons for personal and work, with a timeline and a daily brief.
- Projects as a portfolio: record, milestones, RAID log, change requests, decisions and lessons per project.
- Library: bundled project-management pages, searchable offline on the device, plus your own imports.
- Copilot on Claude or Gemini: answers with citations from the library and the project, proposals you add to the board yourself, a monthly cap and an Offline only boundary per project.
- Documents: upload and keep files (work files sealed), generate status reports, minutes and Word documents from your templates, all on the device.
- Export of everything as JSON, behind your passkey.

## Layout
- `worker/` Hono on Cloudflare Workers + D1 + R2; `worker/migrations/` (NNNN_description.sql, never edited after commit)
- `web/` React + Vite PWA (plain CSS with tokens, no component library); `web/src/store/` is the offline mirror
- `shared/types.ts` row and API types for both
- `scripts/*.test.ts` self-checks (`npm run check`); `scripts/smoke.sh` end-to-end against `wrangler dev`

## Commands
`npm run dev` (Vite 5173 → Worker 8790), `npm run dev:worker`, `npm run typecheck`, `npm run check`, `npm run build`,
`npm run deploy:preview` (preview URL), `npm run deploy` (production), `npm run db:migrate:local|remote`.
