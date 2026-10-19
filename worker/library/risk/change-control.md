---
title: Change control
section: Risk and change
---
Change is normal on any project that lasts more than a few weeks: the customer adds sites, a vendor discontinues a model, a security review asks for a new firewall rule set. The danger is not change itself but change that slips in without anyone weighing its cost. Change control (maîtrise des changements) is the small, fixed routine that makes every significant change visible, assessed and decided by someone with the authority to decide, before the work starts.

## Baselines: what you change against

You can only control change against something agreed. The baselines are the approved versions of:

- **Scope**: the deliverables and the WBS, including what is out of scope.
- **Schedule**: the milestone dates and the plan behind them.
- **Cost**: the budget, spread over time.

Once a baseline is approved, usually at a gate, it changes only through an approved change request. Progress is measured against it, so moving it quietly every time something slips hides exactly the information the sponsor needs. Re-baseline when an approved change requires it, and record which change caused it.

## Tolerances: what the PM may absorb

Not every variation should go to a board. Tolerances (tolérances) set how far the project may drift before it needs a decision from higher up. For example: schedule ± 5 working days on any customer milestone, cost ± 5% of the budget, no change to contractual scope without the sponsor. Within tolerance, the PM decides and records it. When a change would push the project beyond tolerance, it goes to the sponsor or the change board, and if the project is forecast to break tolerance anyway, an exception report goes up (see [[exception-reports]]).

Agree the numbers in writing at the start. "Use your judgement" is not a tolerance.

## The change request

Anyone can raise a change request (demande de changement). It should say:

- **What** is being asked for and **why**, and who asked.
- **Impact on scope**: what is added, removed or altered, including knock-on effects on other deliverables.
- **Impact on time**: which milestones move and by how much.
- **Impact on cost**: one-time and recurring, internal and vendor, and who pays. On customer projects, whether this is billable under the contract.
- **Other effects**: on risk, quality, operations after handover, other projects.
- **Options**: including not doing it, or doing it later as a separate phase.
- **Recommendation**.

The PM's job is to get an honest impact assessment from the people who will do the work, quickly. A change request that waits three weeks for an estimate is a change control process that people will learn to bypass.

## The change board

Decisions go to whoever holds the authority for the size of the change: the PM within tolerance, the sponsor above it, the steering committee or a formal change control board (comité des changements) for large or contractual changes. On customer projects, contractual changes usually also need a signed amendment or change order with the customer, which the account team owns.

The board can approve, reject, or defer pending more information. Each outcome is recorded with its date and who decided. Approved changes then update the baselines, the plan, the RAID log and the communications; rejected ones are communicated back to the requester with the reason.

Keep the routine proportionate. On a hybrid project, backlog changes inside the agreed scope and budget belong to the product owner, not the change board (see [[hybrid-delivery]]).

## Common failures

- **Change by email.** A customer asks a site engineer for "one small extra" and it is done. Fifty small extras later, the budget is gone.
- **Assessing only cost.** Schedule and risk impacts are often larger.
- **No record of rejections**, so the same request comes back every month.
- **Approving without re-planning**: the change is accepted but the dates and the budget stay the same.

## In Compass

The project's Changes tab holds each request: title, decision (pending, approved or rejected), approver, and an expandable block for the description and the three impacts on scope, time and cost. Setting a decision to approved or rejected records the decision date; setting it back to pending clears it. The portfolio counts pending changes per project, the status report lists pending changes under "Decisions needed", and the change request template builds a document from any change.

## In practice

- Write down your project's tolerances for schedule, cost and scope, and get the sponsor's agreement by email.
- Log every change agreed informally in the last month as a change request, even after the fact.
- For each pending request, check that all three impacts are filled in.
- Agree with the account team how contractual changes reach the customer for signature.
- Tell the team, and the customer's contacts, that any extra request goes through you.

## Related

- [[raid-log]]
- [[exception-reports]]
- [[procurement-and-contracts]]
- [[prince2-processes]]
- [[earned-value]]
