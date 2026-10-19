---
title: Exception reports
section: Reporting
---
A status report tells the sponsor where the project stands. An exception report (rapport d'exception) tells them something different: the project is about to leave the space it was allowed to operate in, and the PM no longer has the authority to fix it alone. It comes from PRINCE2's idea of management by exception (see [[prince2-processes]]), and it is useful far beyond PRINCE2 projects, because it turns a bad surprise into a structured decision.

## When to write one

Write it when a tolerance is **forecast** to break, not when it has already broken. The point is to give the decision makers time and options while both still exist.

Typical triggers, using the tolerances agreed at the start (see [[change-control]]):

- A committed milestone is forecast to slip beyond its tolerance, such as more than five working days on a customer go-live.
- The cost forecast exceeds the budget tolerance, for example an estimate at completion more than 5% over.
- A deliverable will not meet agreed scope or quality, such as a feature the contract requires that the vendor cannot deliver.
- A key benefit in the business case is no longer achievable.
- A risk with a score at or above the agreed threshold becomes very likely and its response has failed.

If you find yourself wondering whether a situation deserves an exception report, it usually deserves at least a phone call to the sponsor today, followed by the report.

An exception report is not a substitute for the escalation of an urgent issue that needs action within hours (see [[issues-and-escalation]]). It is for decisions about the plan.

## The sections

1. **Situation**: the project, its current RAG and the one-line reason. Which tolerance is forecast to break, and by how much.
2. **Cause**: what happened, in facts. Separate the trigger (the vendor missed the delivery) from any underlying cause (single-source supply with no buffer).
3. **Consequences**: what happens if nothing changes, for milestones, cost, the customer, the business case, other projects. Include the overdue tasks and late milestones that already show the problem.
4. **Options**: usually three, each with its trade-offs.
5. **Recommendation**: which option, why, and what decision is needed by when.
6. **Risks and issues**: the open items that bear on the decision.

Once a decision is made, the project often needs an exception plan (plan d'exception): a revised plan for the rest of the stage or phase, which becomes the new baseline once approved.

## Options with trade-offs

The options are the heart of the report. A sponsor given one option is being asked to rubber-stamp; one given no options is being handed your problem. Good options:

- **Are genuinely different**, not the same option at three price points.
- **Include "do nothing" or "accept the slip"** when it is realistic, so its cost is visible.
- **State the cost of each in the same terms**: dates, dollars, scope, risk, customer impact.
- **Name what each makes worse**, not only what it fixes.

Example, a managed network rollout where the vendor's equipment for wave 3 is six weeks late:

| Option | Schedule | Cost | Risk and customer impact |
|---|---|---|---|
| A. Accept the delay | Wave 3 go-live moves six weeks | No extra cost now; possible contract credit | Customer escalation likely; crews idle |
| B. Source equipment from a second distributor | Delay cut to two weeks | Higher unit price, roughly $40,000 more | New supplier untested; extra configuration checks needed |
| C. Resequence: bring wave 4 sites forward | Overall end date holds | Small replanning cost | Wave 4 sites need early readiness checks; customer must agree to the new order |

Recommendation: C, with B as a fallback if the customer cannot ready wave 4 sites by the 15th; decision needed from the steering committee by Friday to keep the install crews booked.

## Writing it

Keep it to two pages at most, with the options table on the first. Send it before the meeting where it will be decided, and walk the sponsor through it beforehand so they can support the recommendation. Record the decision and its conditions in the decision log, update the plan, and tell the team and the customer what changed.

## In Compass

The exception report template fills the situation from the project's RAG and reason, lists overdue tasks and late milestones under Consequences, and adds the open risks and issues; Cause and Options start blank for you to write. On a project that allows cloud AI, the copilot's "Exception report" preset drafts the cause, impact, options and recommendation for you to check. Record the outcome in Decisions and any approved changes in the Changes tab.

## In practice

- Check each project's forecast against its tolerances and list any that will break within a month.
- For the closest one, draft three genuinely different options with their costs.
- Call the sponsor before sending any exception report.
- After the decision, re-baseline the plan and log the decision with its conditions.

## Related

- [[status-reporting]]
- [[change-control]]
- [[issues-and-escalation]]
- [[prince2-processes]]
