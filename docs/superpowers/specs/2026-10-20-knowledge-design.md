# Compass Phase 6: Knowledge (design)

*2026-10-20. Builds on Phases 5 (Kelly) and 5b (Athena). Every rule in `CLAUDE.md` still holds.*

## What Vlad asked for

> "Build some knowledge base. 1 for work: I want to dump things like PDF, meeting transcript, OneNote notes, Word document, anything. 2 Personal: it would use all the apps + my personal data. I would ask Athena or Kelly information and they would help me. The work one would need to be secured."

Decisions he made on 2026-10-20:

- **Work security is set per collection.** A work collection is either **Cloud AI** (Athena may quote its passages to Claude or Gemini) or **Locked** (encrypted, searchable only by Vlad on his own device, never sent to any AI).
- **Both knowledge bases live in Compass.**
- **The automatic personal sources are:**
  - Compass's personal items;
  - Finance;
  - Health;
  - Home and Hollow.
  
  Nothing else for now.

## Shape

A new **Knowledge** screen in the rail, between Library and Athena, built from **collections**. Each collection has a scope:

| Collection | Scope | Boundary | Who can read it | How it's searched |
| --- | --- | --- | --- | --- |
| Work, Cloud AI | work | cloud | Vlad; Athena, but only in work threads | by meaning (Cloudflare embeddings) and keywords |
| Work, Locked | work | locked | Vlad only | keywords, on his device |
| Personal (his dumps) | personal | cloud | Vlad; Athena; Kelly with a new permission | by meaning and keywords |
| From my apps (automatic) | personal | cloud | the same as Personal | the same as Personal |

- **Kelly never reads a work collection.** No scope exists for it.
- **Passkey step-up is required to:**
  - change a work collection from Locked to Cloud AI;
  - delete a collection;
  - turn on Kelly's knowledge permission.
- **Work text is sealed at rest** (`enc.ts`, as with work tasks), including every passage.

## Getting things in

- **Drop files** on the Knowledge screen or on a collection. The accepted types are the ones Athena reads after Phase 5b: PDF, Word, Excel, PowerPoint, CSV, Markdown, text and images. Images are described once by the model; for a Locked collection they are stored but not read. OneNote comes in as a `.docx` or PDF export.
- **From Athena's box:** "Save to knowledge" next to an attachment.
- **From a meeting:** SonarFlow's meeting review gets "Add the notes to knowledge" (work meetings offer only work collections).
- **From an email:** an email inbox item gets "Save to knowledge".
- **From my apps** (automatic, once a day and on demand), as one short Markdown page per source, replaced on each refresh:
  - **Compass (personal):** personal tasks, projects, decisions and lessons, as a digest.
  - **Finance, Health, Home and Hollow:** read through Kelly-Cloud, which already reads those apps (`get_finance_summary`, `get_health_summary`, the Home relay), through a new secret-gated relay route `GET /api/compass-relay/apps-digest`.
    - Finance gives summaries only: never account or card numbers.
    - Health gives appointments and trends only: never medication names (the existing rule).
    - Hollow comes through the same route if Kelly has it; otherwise Hollow posts its digest to Compass's inbox secret.

## How it works

- **Storage:**
  - Files go to R2 through the existing documents pipeline.
  - A new `knowledge_items` table links a document (or an app source) to a collection.
  - `knowledge_chunks` holds passages of about 800 tokens, sealed when the collection is work, with `enc_v`.
  - `knowledge_collections` holds `name`, `scope`, `boundary`, `created_at` and `deleted_at`.
- **Meaning search:**
  - Cloud AI and personal passages are embedded with Workers AI (`@cf/baai/bge-m3`, multilingual English and French) inside Cloudflare, where the files already live, so no new company handles them.
  - The vectors go into a Vectorize index (`compass-knowledge`), with only the collection id and passage id as metadata.
  - Locked collections are never embedded.
- **Keyword search:**
  - Server-side for cloud and personal collections.
  - For Locked collections, passages are opened for Vlad's session and searched in the web app's offline mirror. This is the existing "work content is searched on the device" rule.
- **Asking Athena:**
  - Athena's box gets a "Use knowledge" chip, where Vlad picks the collections or leaves "all I'm allowed".
  - Retrieval finds the top passages (meaning plus keywords) and fences them as data in the prompt.
  - The answer cites each passage by document name and page or slide.
  - **A work passage only ever goes into a work thread:** a thread in a cloud work project, or a new project-less work thread. Threads gain a `kind` (a migration), so the answer is sealed as work.
  - Locked collections are never retrieved.
- **Asking Kelly:**
  - New agent scope `compass:read.knowledge`, off by default; turning it on needs the passkey step-up.
  - New route `GET /api/agent/knowledge/search?q=`, returning the top passages from **personal collections only**, with document names.
  - Kelly fences the passages and taints the turn, as with her other Compass reads.
  - Every call is audited.
- **Cost:** embeddings and search run on Cloudflare (Workers AI and Vectorize). Their usage is metered like other AI calls (`knowledge_embed`, `knowledge_search`) and counts against the monthly cap.
- **Trash:**
  - Trashing a document or collection removes it from search immediately.
  - Its passages and vectors are purged after 30 days with the rest of Trash.
- **Export:** export includes collections, items and passages, with work passages opened, behind the existing step-up.

## What Phase 6 doesn't do

- Live connectors to OneNote, SharePoint or Outlook: Bell's Microsoft tenant would need its own approval.
- Indexing work email automatically.
- Kelly reading any work collection.
- Running a model on the device, so Locked collections stay keyword-only.

## Open points for the plan

- The exact chunking rules for spreadsheets: Phase 5b's cell format is reused, with one passage per sheet region.
- Whether Hollow already reaches Kelly-Cloud, to be checked during the plan survey.
- Whether Vectorize's free allowance is enough for Vlad's volume (likely yes at one user), also checked in the survey.
