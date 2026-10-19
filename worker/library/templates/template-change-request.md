---
title: Template guide: change request
section: Templates
---
The change request template turns one entry on the project's Changes tab into a document an approver can read, sign and file. You generate it from the Templates list on the project's Report tab, as Word, Markdown or PDF. When the project has several change requests, Compass asks which one; with none chosen it takes the newest pending request, and with none at all it gives you the same form with blank fields to fill in by hand. Writing the request well is most of the work of change control: a clear request gets a quick decision, a vague one gets sent back. The process around it, from tolerances to the change board, is in [[change-control]].

## Request

Five fields: project, title, approver, decision and date. All but the project name come from the change on the Changes tab.

- **Title**: one line that says what would change, not why. "Add six sites to wave 3" is a title; "Customer request" is not.
- **Approver**: the person or body with authority for a change of this size, as set in the charter or your governance. A change that moves a contract date or the budget usually needs the sponsor, and sometimes the customer.
- **Decision and date**: pending until someone decides. When you mark the change approved or rejected, Compass sets the decision date; set it back to pending and the date clears.
- **Mistakes**: the PM named as approver of a change to their own budget; a decision recorded with no date.

## Description

The change's description from the Changes tab.

- **Good**: what is being asked, by whom, and why now, in a few sentences. Say what happens if it is not approved, because "no" is always an option and the approver needs to know its cost too.
- **Mistakes**: a description that is really a solution ("buy more routers") with no statement of the need; jargon only the delivery team understands.
- **Example**: "The customer has opened six new branch offices since the contract was signed and asks for them to join wave 3 rather than a later project. Without the change, the six sites stay on separate internet links with no central management until a new order is placed."

## Impact

Three fields: scope, time and cost, from the change's three impact fields.

- **Scope**: what is added, removed or altered, including deliverables nobody mentioned in the request: surveys, documentation, operations handover, billing setup.
- **Time**: the effect on milestones, in dates, not adjectives. Say whether the change touches the critical path.
- **Cost**: one-time and recurring, internal and vendor. Note who pays: the customer through a contract amendment, or the project's contingency.
- **Good**: numbers with their source ("vendor quote 14 Jan"), and an honest range when the estimate is rough.
- **Mistakes**: "minimal impact"; a time impact without checking the vendor's lead times; forgetting the effect on risk, which you can add as a line under the three fields.
- **Example**: scope, six extra surveys, installs and acceptances; time, wave 3 ends 2 weeks later, final milestone unchanged; cost, $54,000 one-time, recovered through a contract amendment.

## Recommendation

Left blank: this is the PM's view, and Compass does not write it for you.

- **Good**: approve, reject or defer, with one or two reasons and any condition ("approve, provided the amendment is signed before equipment is ordered"). If you recommend rejecting, offer a route: a later phase or a separate order.
- **Mistakes**: no recommendation, which hands your judgement to the approver; a recommendation that ignores the impact you just described.

## After the decision

Record the outcome on the Changes tab so the decision and its date are set, and log it in the Decisions tab with any conditions. Then update what the change touched: milestones, tasks, the budget fields and the RAID log. Pending requests appear in the status report under Decisions needed, so a request left pending after a verbal yes keeps asking for a decision that was already made.

## In practice

- Open the Changes tab and check every pending request has an approver.
- Rewrite one request's title so it states the change in a single line.
- Fill in time impact as dates on your next request, not "a few weeks".
- Write a recommendation before you send the document.
- Close out any change decided verbally but still pending.

## Related

- [[change-control]]
- [[charter-and-business-case]]
- [[procurement-and-contracts]]
- [[template-status-report]]
- [[meetings-and-governance]]
