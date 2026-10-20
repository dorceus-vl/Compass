---
title: Lessons learned
section: Closing
---
Most organisations hold a lessons learned session at the end of a project, write a document, file it, and never open it again. The next project then repeats the same mistakes with the same vendor. Lessons learned (leçons apprises in Québec; retour d'expérience, or REX, is more common in France) are only worth the effort if they are collected while memories are fresh, written so someone else can act on them, and stored where the next PM will actually find them.

## Collect during the project, not only at the end

By the closing session, people remember the last month and the most dramatic week. The small, useful lessons from the design phase are gone, and half the team has moved on. Collect as you go:

- **At each gate or phase end**: fifteen minutes in the working group on "what should we keep, and what should we change for the next phase?".
- **After any significant event**: a failed cutover, a vendor escalation, a pilot. A short review within a week, while the details are clear and people are still there.
- **In retrospectives** for agile workstreams, where the habit already exists. Pull the lessons that matter beyond the team into the project's list.
- **When you notice one**: a two-line note the moment something surprises you. It takes thirty seconds.

The closing session then becomes a review of a list that already exists, plus the overall view: did the project meet its objectives, and what would we do differently from the start?

## Running a session that people are honest in

- Agree up front that it is about the system, not about blame. People will not tell you what went wrong if they expect to be named for it.
- Invite the vendor and the customer's team for at least part of it; their view is the one you cannot get alone.
- Use a simple structure: what went well, what did not, what we would do differently. Spend most of the time on the third.
- Start from facts: the timeline, the milestones, the issues log. Memory alone favours the dramatic.

## A format that can be reused

A lesson that says "communication could have been better" teaches nothing. Write each one so a PM who was not there can act on it:

| Part | Example |
|---|---|
| Context | Multi-site SD-WAN rollout, 60 sites, two install vendors |
| What happened | Twelve sites failed first-visit installs because the customer's site contacts had not confirmed rack space and power |
| Effect | Each failed visit cost a second truck roll and about a week; wave 2 slipped three weeks |
| Lesson | Treat site readiness as a deliverable owned by the customer, with a signed checklist per site, not an assumption |
| Action for next time | Add a site readiness checklist and a confirmation call 10 days before each install to the standard plan |
| Category | Site readiness |

The category matters more than it seems. It is what lets someone searching later find all the lessons about vendors, site readiness, cutovers or billing, regardless of which project they came from. Keep a short, stable set of categories rather than inventing a new one each time.

Turn each important lesson into a change somewhere: a checklist, a template, a standard risk, a contract clause. A lesson that changes nothing has only been recorded, not learned.

## Making them findable in Compass

Each project has a Lessons tab: add a lesson with its text and a category, and edit it in place at any time during the project, not only at the end. Write the lesson in the format above, condensed into the text.

- **Lessons from personal projects** are searchable in the library, under Lessons, alongside these pages.
- **Lessons from work projects** stay inside their project and are encrypted with the rest of its work data, so they do not appear in the library.
- **Athena** reads a project's lessons when it answers questions about that project, as part of the project's context.
- **The lessons learned template** builds a closing document from the project: a project summary, what went well, what to improve, the lessons table with categories, and actions for next time.

Before starting a new project, search the library for the relevant category and read what your past self wrote.

## In practice

- Add three lessons from your current project to its Lessons tab this week, each with a category.
- Agree a list of six to ten categories and use only those.
- Add a fifteen-minute lessons slot to the agenda of the next phase-end or gate meeting.
- Pick one lesson from a past project and turn it into a change in your standard plan or checklist.
- Before your next project kick-off, search for lessons in its main category.

## Related

- [[project-closing]]
- [[risk-management]]
- [[meetings-and-governance]]
- [[scrum-essentials]]
