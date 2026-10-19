---
title: Template guide: project charter
section: Templates
---
The charter template turns what you have already typed on a project into a document a sponsor can read and sign. Compass builds it on your device from the project's Overview fields, its milestones and its RAID tab, and you download it from the Templates list on the project's Report tab as Word, Markdown or PDF. The generator copies what is there and adds nothing, so a vague field becomes a vague charter (charte de projet). This guide goes through the document section by section: what Compass puts in it, what good looks like, and the mistakes to avoid. For why the charter matters and how it differs from the business case, see [[charter-and-business-case]].

## Summary

Compass fills six fields from the project record: project name, sponsor, phase, start, end and the planned budget.

- **Good**: the sponsor (commanditaire) is one named person who can stop the project; the phase says where you are in the life cycle; the dates are the ones you will be held to; the budget says what it covers.
- **Mistakes**: a department as sponsor ("Enterprise Sales"); an end date that does not match the last milestone; a blank budget because "finance has it".
- **Example**: sponsor, director of enterprise network delivery; phase, Planning; 2026-11-02 to 2027-04-30; $480,000 one-time, covering internal labour and vendor installation, not the customer's monthly service fees.

## Objectives

Taken from the Objectives field on the Overview.

- **Good**: three to five outcomes, each with a measure and a date, each traceable to a benefit in the business case.
- **Mistakes**: activities instead of results ("deploy SD-WAN"), or a list of fifteen items that nobody can rank.
- **Example**: "All 38 branch sites carried on the managed SD-WAN service by 30 April, with the old MPLS circuits disconnected and their billing stopped within 30 days of each cutover."

## Scope

Two parts, from the In scope and Out of scope fields.

- **Good**: in scope names deliverables, not tasks. Out of scope names the things someone will plausibly ask for later, which is what makes it useful in an argument six months from now.
- **Mistakes**: an empty out-of-scope list; an in-scope list that repeats the objectives.
- **Example**: in, site surveys, router install and configuration, ten night cutover windows, two weeks of post-cutover support. Out, LAN cabling inside the customer's buildings, Wi-Fi redesign, rewriting firewall rules beyond the agreed standard policy.

## Success criteria

From the Success criteria field. These are how the sponsor will judge the whole project at closure; acceptance criteria for single deliverables belong in the contract or the quality plan (see [[quality-management]]).

- **Good**: measurable, with someone named to measure them, and a date when they can be measured.
- **Mistakes**: "customer satisfied"; criteria that only become measurable a year after closure, with nobody assigned to check.
- **Example**: 95% of sites cut over in their first planned window; no Severity 1 incident caused by the migration during the support period; final cost within 5% of budget.

## Milestones

A table of the project's milestones with their dates.

- **Good**: five to ten summary milestones, each an event that is either met or not. Include the gates: in Compass, mark a gate milestone so it shows the ◆ marker, and record each gate's outcome in the Decisions tab.
- **Mistakes**: forty rows copied from a vendor's schedule; milestones that are really ongoing activities ("testing").
- **Example**: design approved; pilot of five sites live; Gate 3, commit to build; waves 2 to 4 live; old circuits disconnected; closure.

## Key risks

The five highest-scoring open risks from the RAID tab, with probability, impact, score, owner and response.

- **Good**: each risk names a cause, an event and an effect; each has one owner and a response that is already under way.
- **Mistakes**: generic risks ("resources may be unavailable"); issues that have already happened listed as risks; responses that say "monitor".
- **Example**: "Building landlords control after-hours access, so a landlord may refuse night entry, pushing cutovers into business hours and needing the customer's approval for downtime." P 3, I 4, score 12; owner, site coordinator; response, collect access letters during the surveys.

## Approvals

Three blank fields: sponsor, project manager and date. Compass leaves them empty on purpose; a signature has to come from the person.

- **Good**: the sponsor signs before major spending starts. Log the sign-off, with its date, in the Decisions tab so it can be found later.
- **Mistakes**: the PM signs alone; an email saying "looks good" taken as approval and never recorded.
- **Note**: on customer-facing work, the customer usually signs the statement of work instead; the internal charter still needs your own sponsor's signature.

## In practice

- Fill in every Overview field on your current project, then generate the charter and read it as the sponsor would.
- Rewrite any objective that starts with a verb like "deploy" or "install" as an outcome with a date.
- Add three likely customer requests to Out of scope.
- Check the top five risks in the generated table each have an owner and a real response.
- After the sponsor signs, add the sign-off to Decisions.

## Related

- [[charter-and-business-case]]
- [[project-lifecycle]]
- [[risk-management]]
- [[template-raci]]
- [[stakeholder-management]]
