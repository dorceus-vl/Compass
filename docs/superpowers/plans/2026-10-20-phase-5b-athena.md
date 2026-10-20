# Compass Phase 5b (Athena) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The copilot becomes **Athena**, Vlad's PM counsel. She has her own personality (a colleague, a rigorous PM, a mentor, warm), a video-loop avatar (idle, listening, thinking, speaking), an ElevenLabs voice, one-tap help (rephrase an email, executive version, optimize a spreadsheet, review a document), and she reads any document Vlad gives her: Word, PDF, Excel, CSV, PowerPoint, Markdown, text and images.

**Architecture:** Athena keeps the copilot's engine: the same `/api/ai/chat` route, threads, presets, proposals, library citations, boundary checks and `runAi`. Only user-facing names change (internal ids `copilot`, `/api/ai`, `ai_threads` stay, so no migration renames tables). New pieces:
- Chat gains `document_ids`: documents uploaded through the existing documents pipeline, read by new extractors for xlsx, pptx and csv. Images go to the model as image input.
- A new `/api/athena` route holds three things:
  - avatar clips Vlad uploads (private R2, served with HTTP Range so Safari can play them);
  - text-to-speech of an answer;
  - speech-to-text of a recording.
  
  Both voice calls go to ElevenLabs and are metered like model calls.

**Tech Stack:** As before. No new dependency: the xlsx and pptx readers reuse the zip reader that `extract.ts` already uses for `.docx`, and ElevenLabs is called with `fetch`.

**Spec:** Vlad's words in the session of 2026-10-20 (quoted below) and the approved preview `docs/athena-preview.html` (artifact https://claude.ai/artifact/B2EajS2JfPtJeQkvXkPUET, version 2). The Compass spec `docs/superpowers/specs/2026-10-19-compass-design.md` §7 (copilot), §2 (boundaries) and §12 (audit, usage) still bind.

> "I want to be able to have quick access to email rephrasing, executive rephrasing, Excel spreadsheet optimizer. I want to be able to provide any type of document and the CoPilot would be able to help me." — "Let's go with Athena … the counselor and I would exchange with her … a personality of her own, a colleague, rigorous as a PM and a mentor/assistant. She still sweet and can respond to question with Elevenlabs voice … a video that would play when she's idle, thinking, answering, similar to Kelly." — "I want the 'Ask Athena' box before the [quick help] … the video will be on the left and the answer box on the right."

## What exists today (verified 2026-10-20)

| Fact | Where |
| --- | --- |
| Copilot chat: validation → thread → `projectAccess` boundary (offline refused, 409) → history → `buildSystem` → `runAi` → sealed messages | `worker/routes/ai.ts` `/chat`, `worker/lib/prompt.ts`, `worker/lib/ai.ts` |
| Presets: `{ id, label, feature, wantsProposals, prompt }`, 7 PM presets; `AiFeature = 'copilot' \| 'status_report' \| 'plan_review' \| 'brief'` | `shared/presets.ts`, `shared/types.ts` |
| `fence(label, text)` puts untrusted text in a data block | `worker/lib/prompt.ts` |
| Uploads: pdf, docx, xlsx, md, txt are accepted, checked by name, declared type and first bytes; work files sealed in R2, 10 MB cap (20 MB for other files); `extract()` returns `''` for xlsx | `worker/lib/uploads.ts`, `worker/lib/extract.ts` |
| "Copilot" appears in the rail, palette, Today ("Write it with the copilot"), the project's Copilot tab, Settings, Trash, Report, Lessons, LibraryPage, and library pages' text | `web/src/**`, `worker/library/**` |
| Kelly's avatar: two stacked `<video>` layers, 400 ms crossfade, cycles a state's clips, `playbackRate 0.75`, states idle/listening/thinking/speaking; ElevenLabs TTS `eleven_turbo_v2_5`, best-effort (null on failure) | `Kelly-App/src/components/KellyAvatar.tsx`, `Kelly-Cloud/src/lib/elevenlabs.ts` (read only, for reference) |
| Phase 5 (Kelly) is on branch `phase-5-kelly`; this phase branches from it after its final review | git |

## Who does what

| # | Only Vlad | When | How long |
| --- | --- | --- | --- |
| 1 | Make Athena's loops: short `.mp4` clips (H.264, 720p or less, 3–10 s, silent, under 15 MB each), at least one per state (idle, listening, thinking, speaking), plus a square portrait (`.png` or `.jpg`) for her icon | Any time before Task 6 | yours |
| 2 | Put `ELEVENLABS_API_KEY` on the Compass Worker (the same key Kelly uses): `npx wrangler secret put ELEVENLABS_API_KEY` in the Compass folder | Task 6 | 1 min |
| 3 | Pick Athena's voice in Settings → Athena (paste an ElevenLabs voice id, press Test) and upload the clips there | After deploy | 5 min |
| 4 | Say "deploy" | Task 6 | — |

## Global Constraints

- Everything from Phases 1–5 holds: tokens from `assets/brand/DESIGN.md` only; CSP (no inline scripts, `on*=` or innerHTML); offline queue; passkey step-up; no hard delete; work rows encrypted; plain text never HTML; reduced motion; 44 px targets; Phase 3b look; every model call through `runAi`.
- **The data boundary is unchanged and covers voice too.** Text from Offline-only projects never reaches a model or ElevenLabs. Athena only speaks answers from threads that the model was allowed to see. An attached document must belong to the thread's project or be unfiled personal, and it is refused when its project is Offline only or in Trash. A work document never joins a personal thread.
- **Every metered call names a feature and counts against `ai_monthly_cap_micro`.** The new features are `athena_voice` (text-to-speech) and `athena_listen` (speech-to-text). The 30-calls-an-hour limit applies to them as well. Their prices are vars (`ELEVENLABS_PRICES`). ElevenLabs is only ever called from the Worker.
- **Document text is data:** it is always fenced, and anything it says is never followed.
- **The user-facing name is "Athena" everywhere.** Internal ids stay as they are (`copilot` feature, `/api/ai`, `ai_threads`, `PresetId`s). `/copilot` redirects to `/athena`.
- `ELEVENLABS_API_KEY` is a Worker secret that Vlad puts. Vars: `ATHENA_TTS_MODEL` = `eleven_turbo_v2_5`, `ATHENA_STT_MODEL` = `scribe_v1`, `ELEVENLABS_PRICES` = `{"tts_per_1k_chars":0.18,"stt_per_minute":0.40}` (USD; Vlad can change them). The voice id lives in settings (`athena.voice_id`), defaults to null, and Athena has no voice until he picks one.
- No new dependency. Never deploy, push or put secrets. Commit trailer: the implementer's model line.

## Rulings made while writing this plan

- **A1: rename, don't rebuild.** Athena is the copilot with a new face. Every existing preset, proposal, citation and boundary keeps working. Internal names stay, to avoid a migration and a churned API. Cost if wrong: a later cleanup renames the internals.
- **A2: four quick-help presets** are added to `PRESETS`:
  - `rephrase_email` ("Rephrase email"): clear, firm, friendly; keeps the facts; returns the email only, then at most two lines of advice.
  - `executive_version` ("Executive version"): decision first, RAG, the ask with a date, top risk, next milestone; under 120 words; then one line on what was left out and why.
  - `optimize_spreadsheet` ("Optimize spreadsheet"): ranked findings tagged **Fix** (changes results), **Speed** or **Tidy**, each with the cell or range and a before/after formula, using functions Excel 365 has (XLOOKUP, LET, FILTER, named cells). It never claims to have changed the file.
  - `review_document` ("Review a document"): gaps, risks, missing acceptance criteria, next steps; it cites section or page numbers.
  
  All four have `wantsProposals: false` except `review_document` (true). The seven existing PM presets stay, behind "More".
- **A3: the spreadsheet optimizer returns advice, not a new file** (Vlad applies the changes). It reads each sheet's used range as `Sheet!A1: value` and `Sheet!B2: =FORMULA → cached value`, capped at 20,000 cells or 200,000 characters, and says when it was cut. Writing a corrected `.xlsx` is a later phase if he wants it.
- **A4: images** (`.png`, `.jpg`, up to 5 MB) go to the model as image input on both providers. Other files go in as extracted text, fenced, each capped at 60,000 characters with at most 3 attachments a message. `.pptx` gives slide text in order, with slide numbers. `.csv` is read as text.
- **A5: clips are uploaded in Settings → Athena**, stored privately in R2 at `athena/<id>`, at most 15 MB each and 40 clips. They are served by `GET /api/athena/media/:id` with Range support, `Cache-Control: private, max-age=86400`, from the same origin. They are never committed to git.
- **A6: voice.** `POST /api/athena/speak { message_id }` opens the stored answer and turns it into speech text: no code blocks, no `compass-meta` block, Markdown removed, at most 2,500 characters. The audio is cached in R2 per message (`athena-tts/<message_id>`) so replaying is free. `POST /api/athena/listen` takes a recording of at most 60 s and 2 MB (`audio/webm` or `audio/mp4`) and returns the text, which goes into the Ask box. It never sends on its own.
- **A7: the avatar is a still portrait when** reduced motion is on, when no clips are uploaded, or when a clip fails to load. Its state comes from the chat:
  - listening: while recording;
  - thinking: from send until the answer arrives;
  - speaking: while the audio plays (or 4 s when voice is off);
  - idle: otherwise.
- **A8: the microphone in the shells.** The iOS and Mac `Info.plist` files get `NSMicrophoneUsageDescription` ("Athena listens when you hold the mic."), and Android gets `RECORD_AUDIO` with the web view's permission request granted only for the Compass origin. These are checked on the devices together with Phase 4's Task 7.

## File map

| Path | Responsibility |
| --- | --- |
| `shared/presets.ts`, `worker/lib/prompt.ts` | The four presets; Athena's persona in `buildSystem` |
| `worker/lib/uploads.ts`, `worker/lib/extract.ts`, `scripts/extract.test.ts` | csv, pptx, png, jpg accepted; xlsx, pptx and csv readers |
| `worker/routes/ai.ts`, `worker/lib/ai.ts` | `document_ids` on chat, image input in `runAi` |
| `worker/routes/athena.ts`, `worker/lib/voice.ts`, `scripts/voice.test.ts` | Clips, media with Range, speak, listen, metering |
| `web/src/views/Athena.tsx` (replaces `Copilot.tsx`), `web/src/ui/AthenaAvatar.tsx`, `web/src/athena-voice.ts`, `web/src/views/Settings.tsx` (Athena card), `web/src/router.ts`, `web/src/ui/Shell.tsx`, `web/src/ui/Palette.tsx`, other views' wording | UI |
| `mobile/ios/App/App/Info.plist`, `mobile/android/app/src/main/AndroidManifest.xml` and the bridge permission hook, `mac/src-tauri/Info.plist` | Microphone |
| `docs/athena-preview.html` | Visual reference (approved preview) |

---

### Task 0: Athena's name and persona, and the four presets

**Files:** modify `shared/presets.ts`, `worker/lib/prompt.ts`, every user-facing "Copilot"/"copilot" in `web/src/**` and `worker/library/**/*.md` (wording only), `web/src/router.ts` (`/athena`, `/copilot` → `/athena`), `scripts/prompt.test.ts` (or the existing prompt test)

- [ ] **Step 1: Failing test.** `buildSystem` names Athena and contains her persona lines. Each new preset id exists with its label and `wantsProposals` as in ruling A2. Fenced document text still ends its own block.
- [ ] **Step 2: Persona.** The first paragraph of `buildSystem` becomes: *"You are Athena, Vlad's project-management counsel at Compass. Vlad is a senior project manager at Bell Canada in Bell Business Markets. You are his colleague and mentor: warm and encouraging, and as rigorous as the best PM he has worked with. You say plainly when something is risky, missing or wrong, then help fix it. Keep answers practical and short; lead with what matters. When it helps him grow, add one line on why. Answer in the language of the question (English or French)."* All the existing rules lines stay.
- [ ] **Step 3: Presets** as in ruling A2: the prompts are written in that ruling's terms, each under 600 characters.
- [ ] **Step 4: Wording.** Every visible "Copilot" becomes "Athena": "Ask Athena", "Write it with Athena", the project tab "Athena", and the palette entry. Library pages that say "the copilot" now say "Athena". The redirect is added.
- [ ] **Step 5:** `npm run typecheck && npm run check && npm run build`; smoke unchanged. **Commit** `Phase 5b Task 0: Athena's name, persona and quick-help presets`.

### Task 1: Any document

**Files:** modify `worker/lib/uploads.ts`, `worker/lib/extract.ts`, `worker/routes/ai.ts`, `worker/lib/ai.ts`, `shared/types.ts`; create or extend `scripts/extract.test.ts`; `scripts/smoke.sh`

**Interfaces:**
- `DocKind` gains `csv`, `pptx`, `png`, `jpg`. First bytes: pptx starts with `PK`; png with `\x89PNG`; jpg with `\xFF\xD8\xFF`. csv is text (it has no NUL in its first 4 KB). The existing caps apply (work 10 MB, other 20 MB), and images are capped at 5 MB.
- `xlsxText(bytes): { text: string; truncated: boolean }` (ruling A3): reads shared strings and every sheet in workbook order, as `Sheet!A1: value` and `Sheet!B2: =FORMULA → cached`, with the caps from A3. It uses the same zip limits as docx (parts ≤ 10 MB, 20 MB in total).
- `pptxText(bytes)`: `Slide 1: …` in order, with notes when present. `csvText(bytes)`: UTF-8 text, at most 60,000 characters.
- `POST /api/ai/chat` gains `document_ids?: string[]` (at most 3). Each document must be live, and either in the thread's project or unfiled while the thread is personal (no project). Any other case, or a document whose project is Offline only, answers 409 `{ error: 'document_boundary' }` before anything is stored or sent. The text goes in through `fence('document ' + name, text)`. Images go in as image input: `AiCall` gains `images?: { media_type: 'image/png' | 'image/jpeg'; data: string }[]`, mapped for Claude (`image` content blocks) and Gemini (`inline_data`); the stub echoes their count. The user message stores the attachment names and ids (sealed like the message), never the extracted text.
- [ ] **Step 1: Failing tests.** Build tiny xlsx and pptx files in the test, using the same zip writer the docx test uses or a minimal stored-zip helper there. Assert:
  - xlsx: values, formulas with their cached values, multiple sheets in order, and truncation;
  - pptx: slide order;
  - csv: the text;
  - magic-byte checks for png and jpg;
  - the `document_ids` validation helper: right project ✓, unfiled while personal ✓, other project ✗, offline ✗, trashed ✗, more than 3 ✗.
- [ ] **Step 2:** Implement.
- [ ] **Step 3: Smoke** (`AI_STUB=1`):
  - upload an xlsx and ask with `optimize_spreadsheet` → 200, and the stub saw a fenced document;
  - a document from an Offline project → 409 `document_boundary`;
  - a png → the stub reports 1 image.
- [ ] **Step 4: Commit** `Phase 5b Task 1: Athena reads any document`.

### Task 2: The Athena screen

**Files:** create `web/src/views/Athena.tsx` (move and adapt `Copilot.tsx`; the project tab `ProjectCopilot.tsx` reuses the same pieces); modify `web/src/app.css`, `web/src/copilot.ts` (client calls stay where they are)

The layout follows the approved preview exactly (`docs/athena-preview.html`):
- **Desktop and tablet:** the avatar stage is on the left, about 5/12 wide and sticky, with her name, the line "Project counsel" and three trait chips. The right column holds:
  1. **the Ask Athena box**, with the attach button, the mic button and send; it is a drop zone, and the accepted types show as small mono tags;
  2. **"Or start with"** and the four quick-help cards;
  3. **"More"** for the seven PM presets;
  4. **Athena's answer**: the thread, with her greeting when it is empty.
- **Phone:** the stage becomes a short sticky banner at the top (portrait on the left, state buttons hidden), and the right column follows below.

Behaviour:
- **Quick-help cards:** a card with text in the box sends that text with its preset. A card with an empty box focuses the box and shows a placeholder for that card ("Paste the email…", "Paste your status notes or attach them…", "Attach the spreadsheet…", "Attach the document…").
- **Attaching:** a file is uploaded through the existing documents upload (unfiled, or the current project when the screen is opened from a project) and appears as a chip that can be removed. Sending passes `document_ids`.
- **Each answer** has "Copy" (the answer without the meta block), "Read it aloud" (Task 4) and "Make it shorter" (a follow-up turn: "Make that shorter, same facts."). Proposals and citations work as before.
- **Her greeting:** when the thread is empty, she greets Vlad by the part of the day and names up to two open decisions or overdue items from the local mirror. This is built on the device from shared and personal items only, and it is not a model call.

- [ ] **Step 1:** Build the screen. Keep keyboard order (box → cards → answer), give icon buttons `aria-label`s, use 44 px targets, and turn off card hover motion under reduced motion.
- [ ] **Step 2:** Screenshots at 375 and 1280 wide: empty with the greeting, the email card answered (stub), and a spreadsheet attached with its answer. **Commit** `Phase 5b Task 2: Athena screen`.

### Task 3: Avatar loops

**Files:** create `worker/routes/athena.ts` (clips part), `web/src/ui/AthenaAvatar.tsx`; modify `worker/index.ts`, `worker/types.ts`, `shared/types.ts` (`AthenaClip { id, state, name, bytes, created_at }`, `Settings.athena { voice_id: string | null; speak_answers: boolean; portrait_id: string | null }`), `web/src/views/Settings.tsx` (Athena card), `web/src/views/Athena.tsx`, `web/src/ui/Shell.tsx` (the rail icon uses the portrait when set)

**Interfaces:**
- `GET /api/athena/clips` → `{ clips: AthenaClip[], portrait_id }`.
- `POST /api/athena/clips?state=idle|listening|thinking|speaking` (raw body, `X-File-Name`, video/mp4, at most 15 MB, the first bytes contain `ftyp` at offset 4) → 201 clip.
- `DELETE /api/athena/clips/:id` sets `deleted_at` (purged with Trash).
- `POST /api/athena/portrait` (png/jpg, at most 2 MB).
- `GET /api/athena/media/:id` streams from R2 with `Range` → 206 with `Content-Range`, `Accept-Ranges: bytes`, the correct `Content-Type` and `Cache-Control: private, max-age=86400`.
- Clips are stored in a small table from migration `0007_athena.sql` (`athena_clips`: id, state, name, bytes, r2_key, created_at, deleted_at) and are not encrypted (they are Vlad's own media, not work content).

Avatar component, following Kelly's pattern: two stacked muted `playsinline` `<video>` layers, crossfading over 400 ms between clips and between states, cycling a state's clips in order, `playbackRate` 0.75. The props are `state`, `size: 'stage' | 'banner'`. The fallback is the still portrait (ruling A7). A state with no clip uses idle's clips.

- [ ] **Step 1:** Routes with a self-check for the Range parser (`parseRange('bytes=0-99', 1000)`, open-ended, suffix, invalid → 416).
- [ ] **Step 2:** The Settings → Athena card: a list of each state's clips, upload, remove, a portrait, a small live preview of the avatar cycling states, and the voice controls (Task 4 fills them in).
- [ ] **Step 3:** Wire the avatar into the Athena screen, driven by the chat state (ruling A7).
- [ ] **Step 4: Smoke:**
  - upload a tiny mp4 fixture (a valid `ftyp` header is enough for the checks);
  - Range 0–9 → 206 and 10 bytes;
  - wrong type → 415.
  
  Take screenshots with two generated test clips (ffmpeg if present, otherwise the portrait fallback). **Commit** `Phase 5b Task 3: Athena's avatar loops`.

### Task 4: Voice

**Files:** create `worker/lib/voice.ts`, `scripts/voice.test.ts`, `web/src/athena-voice.ts`; modify `worker/routes/athena.ts`, `worker/lib/ai.ts` (meter helper shared with `runAi`), `shared/types.ts` (`AiFeature` gains `athena_voice`, `athena_listen`), `worker/types.ts`, `wrangler.jsonc` (the vars from Global Constraints), Settings (voice id, Test, "Speak answers"), the Athena screen, the native files for the microphone (ruling A8)

**Interfaces:**
- `speechText(markdown): string` (pure): removes the `compass-meta` block, code blocks, links (keeping their text), Markdown symbols and tables (each table becomes "a table with N rows"); caps at 2,500 characters at a sentence end.
- `POST /api/athena/speak { message_id }`:
  - the message must be an assistant message in a live thread whose project is not Offline only (the same `projectAccess` check);
  - the R2 cache `athena-tts/<message_id>` is used if present;
  - otherwise the cap and hourly checks run (`meter(env, 'athena_voice', estimatedCost)`), then ElevenLabs `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` with `xi-api-key` and the model from `ATHENA_TTS_MODEL`; the result is stored in R2 and returned as `audio/mpeg`;
  - errors: no key or no voice → 409 `{ error: 'voice_off' }`; over the cap → 429 as `runAi` answers.
- `POST /api/athena/listen` (raw audio, at most 2 MB, `audio/webm` or `audio/mp4`, `X-Duration-Ms` ≤ 60000) → `meter('athena_listen')` → ElevenLabs `POST /v1/speech-to-text` (multipart: `file`, `model_id` from `ATHENA_STT_MODEL`) → `{ text }` (at most 8,000 characters).
- Usage and audit: one `ai_usage` row per billed call (feature, estimated micro-USD, from `ELEVENLABS_PRICES`) and an audit row with no content.
- Web: "Speak answers" on → each new answer is spoken automatically (the avatar is in `speaking` while the audio plays; stop on tap). The mic records with `MediaRecorder` (hold to talk on touch, click-to-toggle on desktop) with the avatar in `listening`, then fills the box with the text.

- [ ] **Step 1: Failing tests** for `speechText` (meta block removed, code removed, tables summarised, caps at a sentence) and for the cost estimates.
- [ ] **Step 2:** Implement. Fetch is stubbed in the self-check. With `AI_STUB=1` the routes return a short silent mp3 and the fixed text "stub transcript" without calling ElevenLabs.
- [ ] **Step 3: Native microphone** (ruling A8). Add the plist keys. On Android, add the permission and grant the web view's `RESOURCE_AUDIO_CAPTURE` request only when the origin is the Compass host, with a check in `npm test` (`CompassLink`-style). On the Mac, add the plist key.
- [ ] **Step 4: Smoke** (`AI_STUB=1`):
  - `/speak` on a personal answer → audio/mpeg, and a second call is served from R2 (no new usage row);
  - `/speak` on a message from an Offline project → 409;
  - `/listen` → `{ text: 'stub transcript' }` and one usage row.
- [ ] **Step 5: Commit** `Phase 5b Task 4: Athena's voice`.

### Task 5: Docs and full run

- [ ] **Step 1:** Add an Athena section to `CLAUDE.md` (the rules above in short), and update `docs/compass-features.md`.
- [ ] **Step 2:** Run typecheck, check, build, the full smoke, `mobile` `npm test` and `mac` `npm test`. **Commit** `Phase 5b Task 5: docs, full run`.

### Task 6: Deploy (Vlad's word) and live check

- [ ] **Step 1:** Stop and ask Vlad for "deploy" (migration 0007 and Compass) and for him to put `ELEVENLABS_API_KEY`.
- [ ] **Step 2:** After his yes, note the live version; then run `npm run db:migrate:remote` and `npm run deploy`. Check that `/api/athena/clips` without a session → 401 and `/copilot` → `/athena`.
- [ ] **Step 3:** With Vlad:
  - upload the clips and the portrait;
  - pick the voice and press Test;
  - ask for a rephrased email by voice and hear the answer;
  - attach an Excel file and get the optimizer's findings.
  
  Then write `docs/phase-5b-verification.md`.

## Coverage (self-review)

| Vlad asked | Task |
| --- | --- |
| Quick access: email rephrasing, executive rephrasing, spreadsheet optimizer | 0 (A2), 2 |
| Any type of document | 1 (A3, A4), 2 |
| Rename to Athena, owl-related | 0 |
| Her own personality: colleague, rigorous PM, mentor, sweet | 0 |
| Avatar video loops for idle, thinking, answering | 3 (A5, A7) |
| ElevenLabs voice, using the key Kelly uses | 4 (A6) |
| Ask box before the quick help; video left, answer right | 2 |

Not in 5b: writing a corrected `.xlsx` back (A3), Athena acting on the board without "Add to the board", or Athena talking to Kelly.
