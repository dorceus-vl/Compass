---
title: Project life cycle and stage gates
section: Delivery
---
A project life cycle is the series of phases a project passes through from idea to close. A stage-gate model puts a formal decision point, the gate, between phases: the project may only move on when the evidence for the next phase is good enough. Gates protect the organisation from spending heavily on work that should have been stopped or reshaped earlier.

## Typical phases

Names vary by organisation; the shape is usually the same:

1. **Concept** (idea, opportunity): is there a problem worth solving or a deal worth pursuing?
2. **Feasibility and business case**: options, rough cost, benefits, risks.
3. **Planning and design**: detailed scope, solution design, schedule, budget, contracts.
4. **Build and test** (or execution): the work itself, including pilots.
5. **Deploy and transition**: cutover, go-live, handover to operations.
6. **Close**: acceptance, lessons, contract and financial closure, benefits handed to an owner.

Predictive projects go through these phases once. Adaptive work repeats the build, test and deploy cycle many times inside one phase; hybrid projects do both.

## Gates: go or no-go

At each gate a decision body, usually the sponsor or the steering committee (comité directeur), chooses one of four outcomes:

- **Go**: proceed as planned.
- **Conditional go**: proceed, but named conditions must be met by a date.
- **Hold or recycle**: more work needed in the current phase before deciding.
- **No-go (kill)**: stop the project and release the resources.

A gate that has never said no is not a gate. The value lies in being willing to stop or redirect.

## What evidence each gate wants

| Gate | Decision | Evidence |
|---|---|---|
| Gate 1 | Start feasibility | Problem or opportunity statement, sponsor named, rough size |
| Gate 2 | Approve the business case | Options compared, cost and benefit estimates, key risks, charter draft |
| Gate 3 | Commit to build | Approved design, baselined schedule and budget, contracts or POs ready, resources confirmed, risk register reviewed |
| Gate 4 | Go live | Test and acceptance results, cutover and rollback plan rehearsed, operations ready, customer informed, change approval obtained |
| Gate 5 | Close | Customer acceptance, handover to operations signed, open issues transferred, lessons recorded, budget reconciled |

On a telecom project, gate 3 is often the expensive one, because it releases long-lead equipment orders and vendor commitments. Gate 4 typically lines up with the change advisory board's approval for the maintenance window and a final go / no-go call a few hours before the cutover (bascule).

## Making gates useful

- Publish the evidence list before the phase starts, so the team knows what to produce.
- Keep gate packs short: a page of summary, then the evidence.
- Separate the gate decision from the status update; the gate asks "should we continue?", not "how are we doing?".
- Record the decision, its conditions and who decided.
- Re-baseline after a gate if the plan changed.

## How Compass's milestone gates work

In Compass, a gate is a milestone marked as a gate. The marker only says "a go / no-go decision happens here"; it does not record which way the decision went.

- Each project has a list of milestones, each with a name, a due date and a done date. A milestone marked as a gate shows a ◆ before its name on the project page.
- Ticking a milestone done records the date it was met. Untick it if the gate was reopened.
- Milestones appear in the project's timeline, in the portfolio as the next milestone, and in the status report, where each is labelled Done, Late, Due this period or Upcoming.
- The outcome (go, conditional go, hold or no-go) belongs in the project's Decisions log, with its conditions and who decided, so the "why" sits next to the date. Conditions become tasks with due dates; risks raised at the gate go in the RAID log.
- A no-go is a decision too: log it, then update the project's status and RAG reason.

## In practice

- List the gates left on your project, add each as a milestone with its date and mark it as a gate.
- For the next gate, write the evidence list and share it with the team today.
- Check the decision body for that gate: who attends, who decides, and whether they have the authority.
- After the next gate, log the outcome in Decisions within 24 hours.
- Look at the portfolio for any project whose next milestone is a gate within two weeks, and prepare the pack now.

## Related

- [[hybrid-delivery]]
- [[prince2-processes]]
- [[pmbok6-process-groups]]
- [[charter-and-business-case]]
