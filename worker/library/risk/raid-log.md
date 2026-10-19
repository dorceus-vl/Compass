---
title: The RAID log
section: Risk and change
---
A RAID log keeps four kinds of project uncertainty in one place: **risks**, **assumptions**, **issues** and **dependencies**. They belong together because they turn into each other. An assumption that proves false becomes an issue; a dependency that looks shaky is a risk; a risk that happens is an issue. One log, reviewed on a rhythm, stops those transitions from going unnoticed.

## The four types

**Risks**: things that might happen and would affect the project, for better or worse. "The customer's change freeze in December may push wave 4 into January."

**Assumptions**: things the plan treats as true without proof. "The customer provides rack space and power at every site." Each assumption needs an owner who will confirm it, and a date by which it must be confirmed. Unchecked assumptions are where many telecom projects quietly lose months.

**Issues**: problems happening now that need action. "Site 22's landlord has refused access for the fibre lateral." Issues get an owner, a response and a deadline, and sometimes an escalation (see [[issues-and-escalation]]).

**Dependencies**: things the project needs from outside its control, or that others need from it. "The ordering portal release from the IT team, needed before the first customer order." Name the person on the other side, not just their team.

Some organisations read the D as decisions instead. Compass keeps decisions in their own tab, so here D means dependencies.

## Fields worth keeping

| Field | Why it matters |
|---|---|
| Type | Risk, assumption, issue or dependency |
| Description | Specific enough to act on; for risks, cause, event and effect |
| Probability (risks) | 1–5 |
| Impact | 1–5, against agreed definitions |
| Score (risks) | Probability × impact, used to rank |
| Owner | One person who will act, not a team |
| Response | What is being done: the strategy and the concrete actions |
| Trigger | The sign that a risk is about to happen or needs a decision |
| Due date | When the response or confirmation is due |
| Status | Open or closed |

More fields, such as category, date raised, proximity or residual score, help on very large programmes. On most projects they mainly make the log slower to keep up to date, and an out-of-date log is worse than a short one.

## Review rhythm

- **Weekly**, in the working group: new items, everything scoring 15 or more, every open issue, assumptions due for confirmation this week, and dependencies due in the next two weeks. Ten to fifteen minutes.
- **Monthly**, or at each phase: the full log. Rescore, close what has passed, retire stale items, and look for gaps.
- **At each gate**: the log is part of the evidence. What is open, what is the exposure, and is it acceptable to go ahead?
- **After any change, incident or vendor update**: add what it raised.

The steering committee should see only the items that need its help, not the whole log.

## How Compass's RAID tab works

Every project has a RAID tab.

- **Adding**: choose the type, describe the item, and add it. Each row then holds owner, response, due date (and a trigger for risks) and an Open / Closed toggle; text fields save when you leave them.
- **Scoring**: a risk has probability and impact selects from 1 to 5 and a score chip, red at 15 or more and amber from 8 to 14. An issue has impact only.
- **Heat grid**: a 5 × 5 grid of open risks, impact across and probability up, with a count in each cell. Tap a cell to filter the list to it; tap again to clear.
- **Filters**: chips by type, and "Show closed" to include closed items.
- **Make a task**: turns an item into a task on the board with the item's text, so the response is tracked where you work.
- **From meetings**: when you accept a meeting review into a project, open questions and notes marked Risk or Issue land here with a "from meeting" chip.
- **Elsewhere**: the portfolio shows each project's open risks and high risks; the status report lists open risks by score, and the RAID log template exports all four types as tables.
- **Trash**: deleting moves an item to Trash, where it can be restored for 30 days.

## In practice

- Add an owner and a confirmation date to every assumption in your log.
- For each dependency, write the name of the person on the other side.
- Book a fifteen-minute RAID slot in this week's working group.
- Close or convert every risk that has already happened.
- Use "Make a task" for every open item scoring 15 or more that does not yet have one.

## Related

- [[risk-management]]
- [[issues-and-escalation]]
- [[change-control]]
- [[meetings-and-governance]]
