# Compass Phase 6 (Knowledge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vlad dumps work and personal material into collections in Compass and asks Athena (and, for personal collections only, Kelly) about it. Work collections are encrypted at rest and are either **Cloud AI** or **Locked**. A "From my apps" collection keeps a daily digest of personal Compass, Finance, Health, Home and Hollow.

**Architecture:**
- **New tables:** `knowledge_collections`, `knowledge_items` and `knowledge_chunks`. Passages are sealed when the collection is work.
- **Upload path:** files go through the existing documents pipeline (R2, sealed for work). Text is extracted with `worker/lib/extract.ts` and cut into passages by a new pure chunker.
- **Embedding:** Cloud AI and personal passages are embedded with Workers AI (`@cf/baai/bge-m3`, 1024 dimensions, English and French) and stored in a Vectorize index (`compass-knowledge`). The only metadata is `collection_id` and the chunk id; no text.
- **Search:** the Vectorize top 40 is narrowed to the collections allowed, the passages are opened, and they are reranked with the existing BM25 scorer in `shared/search.ts`.
- **Locked collections are never embedded.** Their passages are opened for the session and searched in memory on the device.
- **Athena** retrieves passages into the prompt, fenced, with citations. A work passage only ever goes into a work thread, and threads gain a `kind`.
- **Kelly** gets one read-only scope over personal collections.
- **The app digest:** Kelly-Cloud already reads Finance, Health, Home and Hollow, so it serves a filtered digest through the existing Compass relay. Compass pulls it once a day.

**Tech Stack:** As before, plus two Cloudflare bindings, `AI` (Workers AI) and `VECTORIZE`. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-10-20-knowledge-design.md` (approved by Vlad on 2026-10-20). Compass spec §2 and §12; CLAUDE.md rules 2–5.

## What exists today (survey, 2026-10-20)

| Fact | Where |
| --- | --- |
| No `ai` or `vectorize` binding; one cron (`*/15 * * * *`); compat date 2026-09-30 | `wrangler.jsonc` |
| Uploads: `checkDoc`, R2 `docs/<id>`, `sealBytes` for work; `loadDoc`, `readBytes`, `cleanName` | `worker/routes/documents.ts`, `worker/lib/uploads.ts` |
| Extraction: `docText(kind, bytes)` (200 KB cap, no xlsx or images), `attachmentText` (xlsx included), `pdfText` (pages merged, so page numbers are lost), `pptxText` (`Slide N:`), `xlsxText` (`Sheet!A1: value`), `csvText`. **No chunker exists.** | `worker/lib/extract.ts` |
| Extracted text is kept only for library imports (`library_pages.body`, personal only) | `worker/routes/library.ts` |
| Athena chat: boundary through `projectAccess` (no project means cloud and personal); the sealing kind comes from the project; library retrieval at `retrieve(env, message, 6)`; citations are validated against page slugs | `worker/routes/ai.ts` 34–151, `worker/lib/library.ts`, `worker/lib/prompt.ts` |
| `ai_threads` has no `kind` column, so a thread with no project is always personal | `0005_pm.sql` |
| BM25-style search with accent folding: `buildIndex`, `search`, `snippet` | `shared/search.ts` |
| Offline mirror: IndexedDB v1 with stores tasks, projects, milestones, meta and queue; no work search on the device | `web/src/store/db.ts` |
| Meeting review: `MeetingNotes` (summary, decisions, action items, notes, questions), sealed; Word and Markdown minutes buttons | `web/src/views/Meeting.tsx`, `shared/types.ts` |
| An email inbox item has a "Split into tasks" button (Phase 5b) | `web/src/ui/AddedStrip.tsx` |
| Trash purge: one batch of `DELETE … RETURNING r2_key`, then best-effort R2 deletes | `worker/routes/trash.ts` 61–99 |
| Export: a fixed list of 15 tables, sealed columns opened through `ENC_COLS` | `worker/routes/export.ts` |
| Migrations go up to `0009_voice_usage.sql`, so this phase's is **0010** | `worker/migrations/` |
| Kelly-Cloud: `getFinanceSummary` (net worth, upcoming bills, budget status; account numbers are already filtered out by Finance) | `src/lib/finance.ts` |
| Kelly-Cloud: `getHealthSummary` (health score, appointments, screenings, **`medicationRefills[].name` and `medicationsNotYetTakenToday`, which include medication names**) | `src/lib/health.ts` |
| Kelly-Cloud: Home's `todaysBrief` and maintenance (home relay); Hollow's `getHollowDisks`, `hollowRead('hollow_recent_files')` and `hollow_events` | `src/routes/home-relay.ts`, `src/lib/hollow.ts` |
| Kelly-Cloud's Compass relay: an inline `x-relay-secret` middleware with `timingSafeEqualStr`, then `/brief`, `/calendar` and `/documents` | `src/routes/compass-relay.ts` |

## Who does what

| # | Only Vlad | When | How long |
| --- | --- | --- | --- |
| 1 | Say "deploy". The deploy runs two one-time commands that create the Vectorize index (`npx wrangler vectorize create compass-knowledge --dimensions=1024 --metric=cosine` and its `collection_id` metadata index), then the migration and the Compass and Kelly-Cloud deploys | Task 7 | 2 min |
| 2 | Create the first collections, drop a few files, and try a Locked one | After deploy | 10 min |
| 3 | Optionally turn on "Kelly can search your personal knowledge" (passkey) | After deploy | 1 min |

## Global Constraints

- Everything from Phases 1–5b holds: tokens, CSP, offline queue, passkey step-up, no hard delete, work rows encrypted, plain text never HTML, reduced motion, 44 px, every model call through `runAi`, and every metered call through `meter`.
- **Work knowledge stays work.**
  - Work collection names, item titles and passages are sealed at rest.
  - A work passage only reaches a **work thread**: a thread whose project is work, or a project-less thread created as work.
  - A **Cloud AI** work passage may go to Athena's model. A **Locked** passage never goes to any model and is never embedded; its text leaves the Worker only to Vlad's own signed-in session, and the device holds it in memory, never in IndexedDB.
  - Kelly never sees a work collection: no route returns one to her.
- **Personal app digests carry no secrets.**
  - Finance: summaries only.
  - Health: never a medication name. Refills and not-yet-taken become counts ("2 refills due"), as Kelly's Morning Show already does.
  - The digest is fenced as data wherever a model reads it.
- **Passkey step-up is required to:** change a work collection from Locked to Cloud AI; delete a collection; turn on Kelly's `compass:read.knowledge` (through the existing `PUT /api/kelly`).
- **Metering:**
  - Embedding is feature `knowledge_embed`: one meter call per ingest batch, plus one per question that embeds its query.
  - Prices come from a var `KNOWLEDGE_PRICES` = `{"embed_per_1k_tokens":0.000012}` (USD).
  - It has its own hourly bucket of 120, counts against the monthly cap, and is excluded from the 30/h model count (as in A9).
- **Trash:** an item or collection in Trash leaves search immediately. Its passages and vectors are purged with the rest of Trash after 30 days.
- **Export** includes the three tables, with work text opened.
- **Local tests never call Workers AI or Vectorize.** With `AI_STUB=1`, embeddings are deterministic hash vectors, and a local vector store in `worker/lib/vectors.ts` stands in when the `VECTORIZE` binding is absent.
- Never deploy, push, put secrets or create remote resources. Commit trailer: the implementer's model line.

## Rulings made while writing this plan

- **KN1: bindings.** `"ai": { "binding": "AI" }` and `"vectorize": [{ "binding": "VECTORIZE", "index_name": "compass-knowledge" }]`. Both are optional in `Env`, and the code runs without them (local). The index and its metadata index are created only at deploy, with Vlad's word.
- **KN2: thread kind.** `ai_threads.kind TEXT CHECK (kind IN ('personal','work'))` is added by `ALTER TABLE` (nullable; null means derived from the project, as today). Athena's project picker gains "No project (work)". The effective kind is the project's kind when there is a project, otherwise `kind` or personal. This replaces the rule "a thread with no project is personal" in CLAUDE.md.
- **KN3: the chunker** (pure): passages of about 3,200 characters with 200 characters of overlap, cut at paragraph, slide or sheet-row boundaries. Each passage carries a **locator**: `p. N` (PDF, extracted per page for knowledge), `slide N`, `Sheet!A1:F40`, `§ heading` (Markdown or Word headings when present), or `part N`. There are at most 2,000 passages per item.
- **KN4: one search path** for Cloud AI and personal collections: Vectorize `topK 40` filtered by `collection_id` `$in` the allowed list → open the passages → BM25 rerank with the query → top `k` (6 for Athena, 10 on the screen). Locked collections have their own path: `GET /api/knowledge/locked/:collection_id/passages` (session only, opened, no cache headers) feeds an in-memory index on the device, built with `shared/search.ts`.
- **KN5: ingest.** The route extracts and chunks within the request (the existing caps apply), stores the passages with `embedded = 0`, and kicks off embedding in `waitUntil` (batches of 50). The 15-minute cron finishes anything left pending. An item's state goes `indexing` → `ready` (or `failed` with a reason). Locked items go straight to `ready`.
- **KN6: boundary changes.**
  - Locked → Cloud AI (step-up): set `embedded = 0` on the collection's passages and let the embedder run.
  - Cloud AI → Locked: delete its vectors at once, then set `embedded = 0`.
- **KN7: the app digest** is a Kelly-Cloud relay route, `GET /api/compass-relay/apps-digest`, returning `{ generated_at, sections: { finance, health, home, hollow } }`. Each section is Markdown of at most 4,000 characters, or null when that source failed. Health is built from `getHealthSummary` with the two medication fields reduced to counts, never names. `get_*_detail` is never used. Compass pulls it once a day at `digest_hour` (and on "Refresh now"), together with a Compass personal digest it builds itself: open personal tasks, live personal projects with RAG, recent decisions and lessons. Each source is stored as one item in the system collection "From my apps", replaced on each refresh.
- **KN8: Kelly's access.** Scope `compass:read.knowledge` and route `GET /api/agent/knowledge/search?q=&limit=` (≤ 8) return `{ passages: { text, document, locator, collection }[] }` from **personal** collections only, audited as `agent.knowledge.search`. In Kelly-Cloud, the tool `compass_knowledge_search` follows the Compass tools' fence and taint rules.
- **KN9: the outside repo.** Kelly-Cloud work goes on branch `compass-phase-6`, created from `compass-phase-5` in the existing worktree `/Users/dorceus_v/Documents/Kelly-Cloud-compass-p5` (switch the worktree's branch; Vlad's checkout is untouched).

## File map

| Path | Responsibility |
| --- | --- |
| `worker/migrations/0010_knowledge.sql` | Three tables, `ai_threads.kind` |
| `worker/lib/chunk.ts`, `scripts/chunk.test.ts` | Chunker (KN3) |
| `worker/lib/vectors.ts`, `scripts/vectors.test.ts` | Embed and vector store (Vectorize or local stub), hybrid search (KN4) |
| `worker/routes/knowledge.ts` | Collections, items, ingest, search, locked passages, refresh |
| `worker/lib/digest.ts` | Compass personal digest, relay pull |
| `worker/routes/ai.ts`, `worker/lib/prompt.ts` | Retrieval into Athena, citations, thread kind |
| `worker/routes/agent.ts`, `worker/routes/kelly.ts` | Kelly's knowledge scope |
| `web/src/views/Knowledge.tsx`, `web/src/knowledge-search.ts` | The screen and on-device locked search |
| `web/src/views/Athena.tsx`, `Meeting.tsx`, `ui/AddedStrip.tsx`, `Settings.tsx` | "Use knowledge", "Save to knowledge", Kelly switch |
| Kelly-Cloud: `src/routes/compass-relay.ts`, `src/lib/compass-agent.ts`, `src/lib/kelly-agent.ts`, `scripts/verify-compass-knowledge.ts` | Digest route, Kelly's tool |

---

### Task 0: Schema, chunker, collections and ingest (no embeddings yet)

**Files:** create `worker/migrations/0010_knowledge.sql`, `worker/lib/chunk.ts`, `scripts/chunk.test.ts`, `worker/routes/knowledge.ts`. Modify `worker/lib/extract.ts` (`pdfPages`), `worker/lib/enc.ts` (`ENC_COLS`), `worker/routes/trash.ts`, `worker/routes/export.ts`, `shared/types.ts`, `worker/index.ts`, `scripts/smoke.sh`.

**Schema:**
- `knowledge_collections`: id, name, scope (`work`/`personal`), boundary (`cloud`/`locked`; personal is always cloud), system (0/1; 1 means "From my apps"), created_at, updated_at, deleted_at, enc_v.
- `knowledge_items`: id, collection_id, document_id (nullable, references documents), source (`upload`/`meeting`/`email`/`athena`/`app:compass|finance|health|home|hollow`), title, state (`indexing`/`ready`/`failed`), error, chunk_count, created_at, updated_at, deleted_at, enc_v.
- `knowledge_chunks`: id, item_id, collection_id, ord, locator, text, embedded (0/1), created_at, enc_v.
- Indexes on (collection_id, deleted_at), (item_id), and (embedded) where embedded = 0.
- `ALTER TABLE ai_threads ADD COLUMN kind TEXT CHECK (kind IN ('personal','work'))`.

**Interfaces:**
- `chunk(text, kind) → { locator, text }[]` (KN3). `pdfPages(bytes) → string[]` (unmerged).
- Routes:
  - `GET /api/knowledge/collections`
  - `POST /api/knowledge/collections { name, scope, boundary? }`
  - `PATCH /api/knowledge/collections/:id { name?, boundary? }`: Locked → Cloud AI needs step-up.
  - `DELETE /api/knowledge/collections/:id`: step-up, then `deleted_at`.
  - `GET /api/knowledge/collections/:id/items`
  - `POST /api/knowledge/items { collection_id, document_id }`: the document must be compatible. A work collection takes only a document of a work project or an unfiled document uploaded for it. A personal collection never takes a work document → 409 `knowledge_boundary`.
  - `DELETE /api/knowledge/items/:id`
- Ingest extracts with the existing functions (per-page PDF), chunks, and seals when the scope is work. The state is `ready` when Locked; otherwise `indexing`, with `embedded = 0`, until Task 1.
- [ ] **Step 1: Failing tests.** For the chunker: sizes, overlap, locators for each kind, the 2,000 cap, and empty input. For the compatibility helper: every scope and document pairing.
- [ ] **Step 2:** Implement. Trash lists collections and items, and the purge deletes chunks → items → collections before documents. Export adds the three tables (work text opened).
- [ ] **Step 3: Smoke.** Create a work Locked collection and a personal one. Ingest a docx and a pdf into each; the passages are sealed for work (raw D1 shows ciphertext). A work document into the personal collection → 409. A delete without step-up → 401/403 in the dev flow, as other step-up routes behave.
- [ ] **Step 4: Commit** `Phase 6 Task 0: knowledge schema, chunker and ingest`.

### Task 1: Embeddings and search

**Files:** create `worker/lib/vectors.ts`, `scripts/vectors.test.ts`. Modify `worker/routes/knowledge.ts`, `worker/cron.ts`, `worker/lib/ai.ts` (meter bucket), `worker/types.ts`, `wrangler.jsonc` (bindings from KN1, var `KNOWLEDGE_PRICES`), `shared/types.ts` (`AiFeature` gains `knowledge_embed`), `scripts/smoke.sh`.

**Interfaces:**
- `embed(env, texts: string[]) → number[][]`: Workers AI bge-m3, or deterministic hash vectors under `AI_STUB=1`.
- `upsert(env, rows: { id, values, collection_id }[])`, `remove(env, ids)`, `query(env, vector, collectionIds, topK) → { id, score }[]`: Vectorize, or the local stub when `env.VECTORIZE` is absent (an in-memory map per isolate, persisted in a dev-only D1 table created by the smoke and never by a migration; document that it's local-only).
- `hybridSearch(env, q, collectionIds, k)` (KN4): embed q, query, open the passages, BM25 rerank. A pure `rerank(q, passages, vectorScores)` is unit-tested.
- `embedPending(env, limit)`: picks passages with `embedded = 0` in live cloud or personal collections, embeds them in batches of 50 with one meter call per batch, upserts, and sets `embedded = 1`. It also sets `ready` on items whose passages are all embedded. It runs in `waitUntil` after ingest and in the cron.
- `GET /api/knowledge/search?q=&collections=` → `{ passages: { id, text, locator, item_title, collection }[] }`. Only Cloud AI and personal collections are searched here.
- `GET /api/knowledge/locked/:id/passages` → opened passages of a Locked collection (session only, `Cache-Control: no-store`).
- KN6 transitions in the PATCH.
- [ ] **Step 1: Failing tests:** `rerank` ordering, stub embed determinism, and the transition helper.
- [ ] **Step 2:** Implement.
- [ ] **Step 3: Smoke** (`AI_STUB=1`):
  - ingest → `ready` after `embedPending`;
  - search finds the right passage, from the allowed collection only;
  - a Locked collection never gets a vector, and `/locked/:id/passages` returns opened text;
  - Cloud AI → Locked removes its vectors;
  - Locked → Cloud AI (step-up) embeds.
- [ ] **Step 4: Commit** `Phase 6 Task 1: knowledge embeddings and search`.

### Task 2: The Knowledge screen

**Files:** create `web/src/views/Knowledge.tsx`, `web/src/knowledge-search.ts`. Modify `web/src/router.ts`, `web/src/ui/Shell.tsx` (the rail between Library and Athena; on the phone, under More), `web/src/app.css`.

**What it shows:**
- Collections grouped as **Work** and **Personal**. Each has a chip (Cloud AI / Locked / Personal / From my apps), an item count, and a lock icon for Locked.
- "New collection": name, then scope, then boundary (work only, with one plain line on each choice).
- Inside a collection:
  - a drop zone and "Add files" (they upload through the existing documents upload, then `POST /items`);
  - items with their state (indexing spinner, ready, failed with the reason), source icon and date, and remove (to Trash);
  - the boundary switch (step-up for Locked → Cloud AI, through the existing passkey prompt).
- **Search box** at the top: it searches all allowed collections, or the open one.
  - Cloud and personal results come from the server.
  - Locked collections are searched on the device: `knowledge-search.ts` fetches their passages when a Locked collection, or "All", is first searched in this session, builds an in-memory index, and drops it when the tab is hidden for more than 10 minutes or the user signs out.
  - Results show the passage snippet (text only), the document and locator, the collection chip, "Open file", and "Ask Athena about this" (opens Athena with the collection picked and the question filled in).
- The phone layout follows the app's patterns; Phase 3b look; reduced motion; 44 px.
- [ ] **Step 1:** Build it. **Step 2:** Screenshots at 375 and 1280: the list, a collection with items in each state, a search with mixed results, the Locked lock icon and the step-up prompt. **Commit** `Phase 6 Task 2: Knowledge screen`.

### Task 3: Athena uses knowledge; "Save to knowledge" everywhere

**Files:** modify `worker/routes/ai.ts`, `worker/lib/prompt.ts`, `shared/types.ts`, `web/src/views/Athena.tsx` (and the project tab), `web/src/views/Meeting.tsx`, `web/src/ui/AddedStrip.tsx`, `worker/routes/knowledge.ts` (`POST /items/from-meeting/:id`, `/items/from-inbox/:id`), `scripts/smoke.sh`.

**Interfaces:**
- `/chat` gains `knowledge?: { collections: string[] | 'all' }`. The server works out the allowed set:
  - personal collections in any thread;
  - Cloud AI work collections only when the thread's effective kind (KN2) is work and its boundary is cloud;
  - never Locked.
  
  Asking for a collection that isn't allowed → 409 `knowledge_boundary` before anything is sent.
- Passages are fenced as `fence('passage k:<chunk id> | <document> | <locator>', text)`. The meta block's `citations` may list `k:<chunk id>` next to library slugs, and they are validated against the passages sent. Stored answers keep the citation ids, and the UI shows them as chips (document · locator) that open the item.
- **Thread kind:** Athena's project picker gains "No project (work)", which creates a thread with `kind 'work'`, sealed as work.
- **"Save to knowledge"** (it picks a compatible collection and offers only compatible ones):
  - on an Athena attachment chip;
  - on a meeting review (the minutes Markdown from `toMarkdown` becomes the item's text, with source `meeting`; work meetings offer only work collections);
  - on an email inbox item (subject and body, source `email`, scope from `work`).
- [ ] **Step 1: Failing tests:** the allowed-set helper (every thread kind × collection type) and citation validation with `k:` ids.
- [ ] **Step 2:** Implement.
- [ ] **Step 3: Smoke:**
  - a personal thread asking "all" → only personal passages reach the stub, and the stub sees fenced `k:` blocks;
  - a work project-less thread → personal and Cloud AI work passages, never Locked;
  - a personal thread naming a work collection → 409;
  - save from meeting and email → the items are ready after the embedder runs.
- [ ] **Step 4:** Screenshots. **Commit** `Phase 6 Task 3: Athena uses knowledge`.

### Task 4: "From my apps"

**Files:** Compass: create `worker/lib/digest.ts`, `scripts/digest.test.ts`; modify `worker/cron.ts`, `worker/routes/knowledge.ts` (`POST /api/knowledge/apps/refresh`), `web/src/views/Knowledge.tsx` (the system collection with "Refresh now" and the last refresh time). Kelly-Cloud (KN9): modify `src/routes/compass-relay.ts` (`GET /apps-digest`), create `src/lib/apps-digest.ts`, `scripts/verify-compass-apps-digest.ts`.

**Interfaces:**
- Kelly-Cloud `buildAppsDigest(env)` (KN7) uses `getFinanceSummary`, `getHealthSummary` (refills and not-yet-taken become counts; the code never reads `.name` of a medication field into the output), Home's `todaysBrief` and maintenance, and Hollow's `getHollowDisks` and recent files. Each source sits in its own try/catch, and a failure leaves that section null. Behind the existing relay middleware. The verify script asserts that no medication name from a fixture appears anywhere in the output.
- Compass `compassDigest(env)`: personal only (personal tasks open or due this week, live personal projects with RAG, the last 30 days of decisions and lessons from personal projects), as Markdown.
- `refreshApps(env)`: pulls the relay through the shared relay fetch helper (secret header, `redirect: 'manual'`, 15 s timeout), then replaces each source's item in the system collection (the old item's passages are deleted, and its vectors removed). It runs in the cron once a day after `digest_hour` (Toronto time), and on demand from "Refresh now" (at most once every 10 minutes).
- [ ] **Step 1: Failing tests:** `compassDigest` never includes a work item, and the Health counts. Kelly-Cloud: the verify script above.
- [ ] **Step 2:** Implement in both repos.
- [ ] **Step 3: Smoke** with the stub relay (extend `scripts/relay-stub.mjs` with `/apps-digest`): refresh → five items ready (compass, finance, health, home, hollow), and a second refresh replaces them, not adds. **Commit** in both repos.

### Task 5: Kelly searches personal knowledge

**Files:** Compass: `worker/lib/agent.ts` (scope), `worker/routes/agent.ts` (`GET /knowledge/search`), `web/src/views/Settings.tsx` (the Kelly card gains "Search your personal knowledge"), `web/src/views/KellyLog.tsx` (wording), `docs/integration.md`, `scripts/smoke.sh`. Kelly-Cloud: `src/lib/compass-agent.ts`, `src/lib/kelly-agent.ts` (tool `compass_knowledge_search`, in `COMPASS_READS`, fenced, tainting), the system-prompt line, `scripts/verify-compass-knowledge.ts`.

- [ ] **Step 1:** Compass route (KN8): personal collections only. Even with the scope on, a work collection is never queried; the code passes only personal collection ids to `hybridSearch`. Audited.
- [ ] **Step 2:** Kelly-Cloud tool, client and verify script (fence, taint, refusal sentences).
- [ ] **Step 3: Smoke:** scope off → 403; on → personal passages only (seed a work collection with a matching passage and assert it is absent). **Commit** in both repos.

### Task 6: Docs and full run

- [ ] **Step 1:** Add a Phase 6 section to `CLAUDE.md` (the rules from the Global Constraints in short, and the thread-kind change replacing the old "thread with no project is personal" line). Update `docs/integration.md` (the apps-digest relay and the agent knowledge route) and `docs/compass-features.md`, and add a Kelly-Cloud docs line.
- [ ] **Step 2:** Full runs in both repos. Write `deploy-steps.md` in the workspace: create the Vectorize index and the metadata index, migrate (0007–0010 if Phase 5b isn't live yet), the Compass deploy, the Kelly-Cloud deploy from the worktree, and live checks. **Commit** `Phase 6 Task 6: docs, full run`.

### Task 7: Deploy (Vlad's word) and live check

- [ ] **Step 1:** Stop and ask Vlad for "deploy". It covers creating the Vectorize index, the migrations (D1 Time Travel bookmark first), Compass and Kelly-Cloud.
- [ ] **Step 2:** After his yes, run `deploy-steps.md`. Live checks: a Locked collection shows no vectors (`wrangler vectorize get-by-ids` on one of its chunk ids returns nothing), personal search works, and Athena cites a passage.
- [ ] **Step 3:** With Vlad: drop a work PDF into a Cloud AI collection and ask Athena; drop one into a Locked collection and search it on the device; refresh "From my apps" and check Health shows no medication names. Then write `docs/phase-6-verification.md`.

## Coverage (self-review)

| Design | Task |
| --- | --- |
| Work collections, Cloud AI or Locked, encrypted, step-up | 0, 1, 2 (KN6) |
| Personal collections and the automatic "From my apps" (Compass, Finance, Health, Home, Hollow) | 0, 4 (KN7) |
| Drop anything; meeting, email and Athena "Save to knowledge" | 2, 3 |
| Meaning search inside Cloudflare; Locked searched on the device only | 1 (KN4), 2 |
| Athena answers with citations; work passages only in work threads | 3 (KN2) |
| Kelly: personal only, new scope with step-up | 5 (KN8) |
| Trash, export, metering | 0, 1 |

Not in Phase 6: live OneNote, SharePoint or Outlook connectors; automatic indexing of work email; a model running on the device.
