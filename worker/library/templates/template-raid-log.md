---
title: Template guide: RAID log
section: Templates
---
The RAID log template prints the project's RAID tab as four tables, one per type, so you can send it to a working group, attach it to a gate pack or walk through it at a steering committee. Compass builds it on your device and you download it from the Templates list on the project's Report tab as Word, Markdown or PDF. Open risks and issues are included and closed ones are left out; risks come highest score first. The document is only as good as the log behind it, so most of the advice below is about what to type on the RAID tab. For how to run the log itself, see [[raid-log]].

## Risks

One row per open risk, with the columns Risk, P, I, Score, Owner and Response. P and I are the 1 to 5 probability and impact you set on the tab, and the score is P × I.

- **Good**: the text reads as cause, event and effect, so a reader can tell what would actually happen. Probability and impact use scales you agreed with the sponsor, not a fresh guess each week. The owner is one person, and the response says what is being done and by when.
- **Mistakes**: one-word risks ("Vendor"); scores that never move; "monitor" as the only response; the same risk written twice by two people.
- **Example**: "Router supply relies on a single distributor, so a shortage could delay wave 3 shipments by four weeks or more and push the last cutovers past the contract date." P 3, I 4, score 12. Owner: vendor manager. Response: confirm stock for waves 3 and 4 by 15 January and ask for a second source quote.

The trigger you record on the RAID tab, the early sign that a risk is about to happen, stays on the tab; mention it in the response when the reader needs to watch for it.

## Assumptions

One row per assumption, text only.

- **Good**: written so it can be proven wrong, with who confirms it and by when inside the text. An assumption that turns out false becomes an issue or a risk, so check them on a schedule rather than waiting.
- **Mistakes**: wishes ("the customer will be cooperative"); assumptions that were confirmed months ago and still sit in the log.
- **Example**: "The customer provides rack space and power at every site before its survey; the customer's facilities lead confirms site by site, wave 1 by 30 November."

## Issues

One row per open issue, with its text, impact, owner and response.

- **Good**: what happened, what it affects now, and what decision or action is needed. Impact uses the same 1 to 5 scale as risks. If an issue needs someone above you, say so in the response and follow your escalation path (see [[issues-and-escalation]]).
- **Mistakes**: issues kept open after they are fixed; future events logged as issues; an owner who has not been told.
- **Example**: "Twelve routers for wave 2 held at customs since 4 December; four cutovers cannot go ahead next week." Impact 4. Owner: vendor manager. Response: broker has the missing commercial invoice; new delivery date to be confirmed Friday; the four sites move to the next window if it slips.

## Dependencies

One row per dependency, with its text and owner.

- **Good**: names the other party, what they must deliver and the date you need it. The owner is the person on your side who chases it, not the other team.
- **Mistakes**: dependencies with no date; internal tasks of your own project listed as dependencies.
- **Example**: "The billing team's release must be in production before the first cutover, needed by 15 January, so that new service charges start correctly." Owner: project manager.

## Using the document

- Generate it on the morning of the meeting, so it matches the tab.
- For a steering committee, send only what needs its help; the full log suits the working group.
- Decisions taken while reviewing the log go into the Decisions tab; new actions become tasks with an owner and a due date.

## In practice

- Open the RAID tab and rewrite the three highest risks as cause, event and effect.
- Give every open item an owner, then generate the log and check no row has a blank owner.
- Confirm or close one assumption this week.
- Add a date to every dependency.
- Agree with the sponsor which score counts as high and use it in your next status report.

## Related

- [[raid-log]]
- [[risk-management]]
- [[issues-and-escalation]]
- [[meetings-and-governance]]
- [[template-status-report]]
