# Compass, feature catalogue (2026-10-19)

The complete scope list, before the spec. Each line has a tier: **v1** (first release, the five phases already agreed),
**v2** (the release after), **later** (worth keeping on the list, not promised). "From" names the tool the idea is
borrowed from so you can look it up: Jira, Asana, monday.com, ClickUp, Notion, Linear, Microsoft Project / Planner,
Smartsheet, Trello, Basecamp, Wrike, Todoist, Things.

What already exists in your other apps and gets reused rather than rebuilt:

| Capability | Where it lives today | What Compass adds |
| --- | --- | --- |
| Meeting transcription + notes (title, summary, decisions, action items with owner and due, important notes, open questions) | Knocturn ID (`transcription.ts`, `notes.ts`), fed by SonarFlow Mac and iOS | A "notes ready" hook and a review screen that turns action items into tasks |
| Email reading, Gmail and Outlook, with triage into needs-reply / FYI / skip | Kelly-Cloud (`inbox.ts`, connected accounts) | A rule that turns "needs reply" and detected commitments into tasks |
| Calendar events and meeting prep cards 15 minutes before a meeting | Kelly-Cloud (`meeting_preps`) | The prep card shows the project's open items and last meeting's actions |
| Document text indexing with embeddings (PDF, Word, text) | Kelly-Cloud (`documents.ts`, Voyage) | The library reuses the same indexing for your own PM documents |
| Cross-app notifications with per-app secrets | Kelly-Cloud `/api/notifications` | A forwarder to Compass's inbox, plus the rule engine |
| Push: APNs, Web Push, FCM | Kelly-Cloud (APNs), Aura/Finance (Web Push), Hollow Android (FCM) | Reuse the code, Compass sends its own |
| Sign-in, passkeys, device list, agent scopes | Knocturn ID | App id `compass`, resource scopes for Kelly |

Nothing in the family generates Word, Excel or PowerPoint files today. That part is new (section 7).

---

## 1. Your six questions

| Question | Answer | Tier |
| --- | --- | --- |
| **Gantt chart?** | Yes. A Timeline view per project and across projects: bars from start to due, milestones as diamonds, finish-to-start dependencies drawn as arrows, drag to reschedule, a baseline you can save and compare against, critical path highlighted, today line, zoom day / week / month. Personal horizons can show on the same timeline. Built with plain SVG, no chart library. | v1 basic (bars, milestones, drag), v2 dependencies, baseline, critical path |
| **Link back to the source app?** | Yes. Every task created from another app keeps a deep link: the Finance task opens the subscription row, the Health task the medication, the Hollow task the folder, the Aura task the device, the meeting task the transcript at the right minute. On the phone the link opens the native app when installed, else the site. | v1 |
| **Tasks from email?** | Yes, through Kelly-Cloud's connected Gmail and Outlook accounts. Three sources of tasks: (1) "needs a reply" emails become a Waiting-on-me task with the sender and subject; (2) commitments detected in your own sent mail ("I'll send the SOW Friday") become tasks with the due date; (3) a forward-to address (`tasks@compass…` via Cloudflare Email Routing) turns any email you forward into a task with the email attached. **Bell caveat below.** | v1 forward-to address and needs-reply rule, v2 commitments |
| **Use-cases in Athena?** | Yes. You describe a situation ("vendor slipping, steering nervous, 3 weeks to cutover") and Athena answers with a diagnosis, options with trade-offs, a recommended plan with tasks and dates, the stakeholders to inform, and the risk entries to add, each grounded in library pages and your own post-mortems. One tap puts the plan on the board. Also: estimate a WBS, build a schedule from a scope statement, write a status report from the board, review a plan for gaps, prepare a difficult conversation, rehearse a steering question. | v1 |
| **Create documents and summaries?** | Yes. Markdown, Word, Excel, PowerPoint and PDF, generated on the device (no file goes to a server you don't own). Summaries of a project, a week, a meeting, a thread of emails. | v1 Markdown + Word + PDF, v2 Excel + PowerPoint |
| **My own template, filled in?** | Yes for Word and Excel: you upload a `.docx` or `.xlsx` with placeholders like `{{project.name}}`, `{{risks.table}}`, `{{status.summary}}`, Compass fills it from the project and the copilot writes the prose parts. PowerPoint templates are harder (no good filler library): v1 generates slides from a layout you pick, v2 fills a `.pptx` template slide by slide using its placeholders. | v1 Word, v2 Excel + PowerPoint |

**SonarFlow meetings at Bell.** When a meeting's notes are done in Knocturn ID, it posts "notes ready" to Compass.
Compass opens a Meeting review: the summary, the decisions, the action items as suggested tasks (accept, edit owner
and date, dismiss), the open questions as suggested follow-ups, important notes attachable to the project. Accepted
items land on the board with a link back to the transcript minute. Kelly's meeting-prep card the next time that
meeting recurs shows what was decided and which actions are still open.

**Bell caveat, decide before build.** Bell's Microsoft 365 tenant very likely blocks third-party OAuth consent, so
Kelly-Cloud cannot connect your Bell mailbox or calendar the way it connects personal accounts. The forward-to
address and SonarFlow recordings still work. Separately, Bell's data policy governs whether work transcripts and
emails may be sent to Claude's or Gemini's API at all. Compass therefore has a per-project **data boundary** setting:
*Cloud AI allowed*, *Offline only* (library search and templates, no model), or *On-this-Mac only* (local model
through the Mac app, later). Work projects default to Offline only until you change it.

---

## 2. Capture and inbox

| Feature | From | Tier |
| --- | --- | --- |
| Quick add from anywhere (⌘K / global hotkey on Mac, share sheet on iOS and Android, widget) | Things, Todoist | v1 |
| Natural-language dates and tags in quick add ("nudge Acme wed #erp @work") | Todoist | v1 |
| Inbox: everything unsorted (manual, apps, email, meetings) in one triage list, keep / snooze / dismiss, keyboard-driven | Linear triage | v1 |
| Rules: source + pattern → horizon, kind, project, due offset; dedupe key so repeats update instead of duplicate | Asana rules, monday automations | v1 |
| Voice capture through SonarFlow dictation ("Dictate with SonarFlow" intent) and Kelly ("Kelly, add a task") | | v1 |
| Email forward-to address; email attached to the task | Asana, Todoist | v1 |
| Clip from a web page (bookmarklet / share), screenshot attached | ClickUp | v2 |
| Siri and Shortcuts: add task, what's due today, start focus | Things | v2 |

## 3. Tasks

| Feature | From | Tier |
| --- | --- | --- |
| Title, notes (Markdown), kind personal / work, horizon short / medium / long, status, project, due, start, priority, estimate, tags | all | v1 |
| Subtasks and checklists; progress bar from subtasks | Trello, Asana | v1 |
| Recurring tasks (every N days, weekdays, monthly on the Nth, after completion) | Todoist | v1 |
| Waiting on: a person or vendor, asked-on date, nudge reminder every N days | | v1 |
| Blocked by / blocks (dependencies between tasks) | Jira, Asana | v2 |
| Attachments and links (files kept in R2, Hollow links for big files) | | v1 |
| Comments and activity log per task (your own notes over time, Kelly's additions) | all | v1 |
| Custom fields per project (number, text, choice, date, person) | ClickUp, monday | v2 |
| Task templates (new project kickoff, release, vendor onboarding) and checklists | Asana | v2 |
| Time tracking: start / stop, manual entries, per project totals | ClickUp, Wrike | v2 |
| Focus mode: pick 3 for today, Pomodoro timer, Do Not Disturb hint to Aura | Things | later |

## 4. Views

| Feature | From | Tier |
| --- | --- | --- |
| Today: three horizons, Added-by-your-apps strip, Kelly brief, overdue, stats | Things, Todoist | v1 (Kelly brief done, Phase 5) |
| Board: New / In progress / On hold / Waiting on / Done, drag and drop, WIP limits, swimlanes by project or kind | Trello, Jira, Kanban | v1 |
| List / table with sort, group, filter and saved views ("Work, due this week, by project") | Asana, ClickUp | v1 |
| Calendar: month and week, drag to reschedule, Kelly's calendar events overlaid | Asana, Notion | v1 (done, Phase 5) |
| Timeline / Gantt (section 1) | MS Project, Asana, Smartsheet | v1 basic, v2 full |
| Upcoming: the next 14 days as a scrolling list | Things | v1 |
| Workload: hours per week vs capacity you set, across projects | Asana, monday | v2 |
| Portfolio: every project with RAG, % done, next milestone, open risks, budget line | Asana portfolios, MS Project Online | v1 simple, v2 full |
| Dashboard widgets: burndown, throughput, cycle time, overdue trend, done-this-week | Jira, monday | v2 |
| Hill chart (what's figured out vs what's left, per task group) | Basecamp | later |
| Keyboard-first navigation and command palette for every action | Linear | v1 |

## 5. Projects, programs, governance

| Feature | From | Tier |
| --- | --- | --- |
| Project record: charter summary, sponsor, objectives, scope in / out, success criteria, RAG with reason, budget planned / spent, start / end | PMBOK, PRINCE2 | v1 |
| Milestones with dates and gates (go / no-go), shown on timeline and portfolio | MS Project | v1 |
| Phases or stages (initiation, planning, execution, closing, or your own) | PRINCE2 stages | v1 |
| WBS editor (outline tree, numbered 1.2.3), tasks hang off work packages | MS Project | v2 |
| RAID log: risks (probability × impact, response, owner, trigger), assumptions, issues, dependencies | PMBOK | v1 |
| Change requests: description, impact on scope / time / cost, decision, approver, date | PMBOK, PRINCE2 | v1 |
| Decision log and action log, linked to the meeting they came from | | v1 |
| Stakeholder register: power / interest grid, communication plan per stakeholder | PMBOK | v2 |
| Lessons learned per project, searchable across projects, fed to Athena | PMBOK closing | v1 |
| Programs: group projects, roll up RAG, milestones and risks | PgMP | v2 |
| Baselines: save schedule and compare (slip per task, per milestone) | MS Project | v2 |
| Earned value: PV, EV, AC, SPI, CPI from estimates and % complete | PMBOK | later |
| Sprints / cycles for Agile projects, velocity, burndown | Jira, Linear | v2 |
| OKRs / goals: personal and work objectives with key results, tasks linked to them, the long horizon shows them | Asana goals | v2 |
| Budget tracking by project with lines from Finance where relevant (Knocturn Labs costs) | | later |

## 6. Meetings

| Feature | From | Tier |
| --- | --- | --- |
| Meeting review from SonarFlow / Knocturn ID notes (section 1) | | v1 |
| Meeting prep card: agenda from open items, last meeting's decisions and actions, who owes what | Kelly meeting prep | v1 |
| Minutes document generated from review (Word / Markdown) and sent through Kelly with Confirm-Before-Acting | | v1 |
| Recurring meeting series: running list of decisions and actions across occurrences | | v2 |
| Follow-up nudges for action items owned by others (waiting-on rules) | | v1 |
| Agenda builder with time boxes, shared as a document | | v2 |

## 7. Documents and reports

| Feature | From | Tier |
| --- | --- | --- |
| Generate: Markdown, Word (.docx), PDF; Excel (.xlsx) and PowerPoint (.pptx) | ClickUp docs, Notion | v1 md/docx/pdf, v2 xlsx/pptx |
| Your own Word / Excel templates with placeholders, filled from project data and Athena's prose | | v1 Word, v2 Excel, v2 pptx |
| Built-in templates: charter, RAID log, RACI, WBS, status report, change request, exception report, lessons learned, communication plan, risk register, project closure, business case outline, steering deck | PMBOK, PRINCE2 | v1 (first 8), v2 (rest) |
| Status report in one tap: RAG, progress, milestones, risks, decisions needed, generated from the board for a date range | Asana status updates | v1 |
| Weekly summary (personal and work) and project summary on demand | | v1 |
| Export everything: CSV, JSON, Markdown bundle; print-friendly views | all | v1 |
| Project wiki pages (Markdown, linked to tasks) | Notion, Confluence | v2 |

## 8. Athena (the PM copilot)

| Feature | From | Tier |
| --- | --- | --- |
| Chat per project with Claude or Gemini, second read from the other model | | v1 |
| Use-case resolution: diagnosis, options, plan, stakeholders, risks, one tap to the board (section 1) | | v1 |
| Plan from scope: WBS, estimates, schedule proposal, milestone suggestions | | v1 draft, v2 with dependencies |
| Status report, exception report, escalation email, steering summary written from the board | | v1 |
| Plan review: gaps, missing risks, unrealistic durations, unowned actions | | v1 |
| Retrospective analysis across lessons learned: "what went wrong on vendor-led projects before" | | v2 |
| Estimation help: three-point (PERT), analogies from your past projects | | v2 |
| Library citations on every answer; "show me the page" opens it | | v1 |
| Offline mode: library search, templates, saved answers; no model | | v1 |
| Data boundary per project (Cloud AI / Offline only / On-this-Mac only) | | v1 (first two), later (local model) |
| Daily brief and weekly review written by Athena (through Kelly where you prefer her voice) | | v1 |
| Prompt library: your reusable prompts ("write my status in Bell's format") | | v2 |
| Athena: the copilot's name and persona, a screen of her own (`/athena`), four one-tap helps | | done, Phase 5b |
| Any document in the chat: PDF, Word, Excel, PowerPoint, CSV, Markdown, text, PNG and JPG (images go to the model as pictures), under the same data boundary | | done, Phase 5b |
| Athena's face: your own idle, listening, thinking and speaking loops and a still portrait, uploaded in Settings → Athena | | done, Phase 5b |
| Voice: she reads an answer aloud and you dictate a question (ElevenLabs, called only from the Worker, counted against the monthly cap, boundary checked on the server) | | done, Phase 5b |
| Split an email into tasks: Athena proposes, you tick and edit, nothing is created until you add them; the original can go to Trash | | done, Phase 5b |

## 9. Knowledge library

| Feature | Tier |
| --- | --- |
| Bundled, offline: PMBOK 7 performance domains and principles, PMBOK 6 process groups and knowledge areas, PRINCE2 principles / themes / processes, Agile manifesto and Scrum guide concepts, Kanban, SAFe basics, hybrid, earned value, estimation techniques, stakeholder and communication management, risk management, procurement and contracts (SOW, T&M vs fixed price), change control, quality, closing. Written as summaries in Compass's words, not the copyrighted texts. | v1 |
| Templates with guidance on each field | v1 |
| French ↔ English glossary of PM terms (Bell works in both) | v1 |
| Your imports: PDFs, Word, Markdown, notes, past decks, indexed with Kelly's document pipeline | v1 |
| Post-mortems and lessons learned feed Athena | v1 |
| PDU / certification tracker (PMP renewal cycle, PgMP plan) | v2 |
| Flashcards / quick review for certification study | later |

## 10. Integrations

| App | What flows | Tier |
| --- | --- | --- |
| Kelly | Reads and writes tasks (agent scopes), daily brief, meeting prep, email triage → tasks, sends minutes and emails with confirm | v1 (agent scopes, brief, calendar and document hand-off done, Phase 5; the rest follows) |
| Finance | Subscription review, bill due, budget breach → tasks with deep link | v1 |
| Health | Refill, appointment due, preventive care, lab results to follow up → tasks | v1 |
| Hollow | New files to sort, backup overdue, disk warning → tasks; task attachments can be Hollow links | v1 (needs a small "new files" signal in Hollow if absent) |
| Aura | Device battery low, maintenance reminders (filters, smoke detector test) → tasks; Compass "today" kiosk card on the wall tablet | v1 tasks, v2 kiosk |
| SonarFlow / Knocturn ID | Meeting notes ready → review; dictation into any field | v1 |
| NightOwl | Nothing automatic; optional "watch later" is not a task | none |
| Calendar (Google, personal) | Events on the calendar view (done, Phase 5), meeting prep | v1 |
| Email (Gmail, personal Outlook) | Needs-reply and commitments → tasks | v1 |
| Bell M365 (work) | Forward-to address only, unless Bell allows consent | v1 |
| Jira / Planner / Teams at Bell | Not in v1. If Bell allows an API token: import of your assigned Jira issues into the work board, read-only | later |
| Home Assistant | Maintenance tasks (already posts to the bus as `home`) | v1 |

## 11. Automation and notifications

| Feature | From | Tier |
| --- | --- | --- |
| Push: due today (your time), overdue, waiting-on nudges, meeting review ready, app-created task, milestone in 7 days | | v1 |
| Quiet hours and per-source switches; urgent can break quiet hours (same rule as Kelly) | | v1 |
| Rules engine with conditions and actions (when status → Done and project has a follow-up template, create it) | monday, Asana | v1 simple, v2 full |
| Auto-snooze and auto-escalate (overdue 3 days → high priority, 7 days → Kelly asks you) | | v2 |
| Weekly review every Sunday: a guided screen (inbox zero, overdue, next week, horizons) | Things, GTD | v1 |
| Daily digest email or Kelly voice brief | | v1 |

## 12. Platforms

| Feature | Tier |
| --- | --- |
| Web PWA at compass.knocturnlabs.com, installable, offline | v1 |
| Mac app (Tauri): menu-bar quick add, global hotkey, notifications, Spotlight-like palette | v1 |
| iPhone and iPad (Capacitor): push, share sheet, widgets (Today, next task), Siri intents | v1 app, v2 widgets and Siri |
| Android (Capacitor): push (FCM), share, widget | v1 app, v2 widget |
| Apple Watch complication (next task, done) | later |
| Aura wall tablet kiosk card | v2 |
| Keyboard shortcuts everywhere, full accessibility (focus rings, 44px targets, reduced motion) | v1 |

## 13. Security, privacy, admin

| Feature | Tier |
| --- | --- |
| Knocturn ID sign-in, 72-hour sessions, device list, passkey step-up for delete-project, export, data-boundary changes | v1 |
| Work data encrypted at rest field-level (like Health), separate key | v1 |
| Data boundary per project (cloud AI / offline only), default offline for work | v1 |
| Audit log of every automation and every Kelly write | v1 |
| Full export and restore (JSON bundle to Hollow nightly) | v1 export, v2 restore |
| Trash with 30-day recovery, no hard delete from the API (Hollow's rule) | v1 |
| Cost caps per AI feature and per month (like Health's hourly cap) | v1 |

---

## What is deliberately not in Compass

- Multi-user collaboration, assignees who log in, comments from others. It's your tool; "owner" on a task is a name, not an account.
- Habit and health tracking (Health owns it), money (Finance owns it), files (Hollow owns it). Compass links to them.
- A general chat with Kelly (Kelly owns it); Athena (Compass's copilot) is project-scoped.
- Bundling PMBOK, PRINCE2 or the Scrum Guide verbatim.
