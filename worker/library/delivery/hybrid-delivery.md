---
title: Hybrid delivery
section: Delivery
---
Hybrid delivery combines a predictive frame (phases, gates, a baselined budget and contract dates) with adaptive delivery inside it (iterations, backlogs, frequent demos). It is the normal state of B2B telecom work: the customer signs a contract with dates, part of the solution is physical and hard to change, and part is software that benefits from short feedback loops. The goal is to use each approach where it fits, not to average them.

## Predictive governance around agile delivery

The outer layer stays predictive because the business needs it:

- A business case and charter approved before money is committed.
- Phase gates where the steering committee (comité directeur) decides go or no-go.
- A milestone plan the customer can see, tied to contract dates and billing.
- Change control on scope that affects price, contract or other teams.
- Regular status reporting in RAG terms.

Inside, the agile teams keep their autonomy:

- The product owner orders the backlog within the agreed scope and budget.
- Teams plan sprint by sprint and show working increments.
- Detailed requirements emerge; only changes that affect contract, budget or milestones go to formal change control.

The PM's job is to translate between the two: sprint outcomes become milestone progress, and gate decisions become backlog priorities.

## Gates, milestones and sprints in one plan

A workable hybrid plan has three layers:

1. **Gates** at the phase boundaries, each with defined evidence (see [[project-lifecycle|the life cycle page]]).
2. **Milestones** for external commitments: equipment delivered, site ready, pilot live, customer acceptance, go-live. These are the dates you report and protect.
3. **Sprints** inside the software workstream, each with a goal. Map the sprint goals to the milestones they serve, so a missed sprint goal shows up as a milestone risk early.

Keep the physical and the digital workstreams on one timeline, so the dependency between them is visible: the portal must be able to order the new service before the first customer site goes live.

## Typical telecom examples

**Network build predictive, portal agile.** A customer is moving 80 branches to a managed SD-WAN service. Site surveys, equipment orders, installs and cutovers follow a predictive plan in waves, because truck rolls, maintenance windows and lead times do not iterate well. In parallel, the customer self-serve portal that shows site status and lets the customer request changes is built in two-week sprints, with the customer's IT team at every sprint review. Gate 3 (go for rollout) needs both the pilot sites working and the portal's minimum feature set accepted.

**Data centre migration with automation sprints.** The migration runs in planned move events, each with a method of procedure and rollback. A small team builds the automation scripts and validation checks in sprints ahead of each move, so every event uses the improved tooling.

**Vendor delivery with an agile integration layer.** The vendor delivers hardware to a fixed contract schedule; the integration with ordering and billing systems is delivered iteratively, with the definition of done including end-to-end order testing.

## Common traps

- **Water-Scrum-fall.** A long requirements phase, sprints in the middle, a long testing phase at the end: the sprints add ceremony without feedback.
- **Two plans that disagree.** The steering committee sees the milestone plan, the teams follow the backlog, and nobody reconciles them.
- **Gates that ask for the wrong evidence.** Asking an agile team for a complete design document at gate 2 forces fiction; ask for a working demo and a release plan instead.
- **Change control on everything.** If every backlog change needs a change request, the agile part stops being agile.

## In practice

- Draw your project on one page: gates on top, milestones in the middle, sprints or work waves underneath.
- Agree with the sponsor which changes need a formal change request and which the product owner can decide.
- Link each upcoming sprint goal to the milestone it serves.
- Add a risk for every dependency between the physical and digital workstreams.
- Invite the customer's IT contact to the next sprint review.

## Related

- [[project-lifecycle]]
- [[scrum-essentials]]
- [[agile-values-principles]]
- [[prince2-processes]]
- [[pmbok7-performance-domains]]
