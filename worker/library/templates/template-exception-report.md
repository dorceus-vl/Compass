---
title: Template guide: exception report
section: Templates
---
The exception report template gives you the frame for the document you write when a tolerance is forecast to break. Compass fills the parts that are facts already on the project: the situation, the overdue work and late milestones, and the open risks and issues. It leaves the parts that need your judgement blank: the cause, the options and, unless you have a drafted summary, the recommendation. You generate it from the Templates list on the project's Report tab, as Word, Markdown or PDF, and finish it in Word. When to write one, and how the decision that follows works, is in [[exception-reports]].

## Situation

Three fields: project, RAG and its reason, from the project page.

- **Good**: by the time you write an exception report the RAG is usually red, and the reason names the tolerance and the size of the forecast breach: "Red: final cutover forecast 18 working days late against a tolerance of 10."
- **Mistakes**: generating the report while the RAG still says green, which tells the sponsor the project page is out of date; a reason that blames without informing ("vendor issues").
- **Tip**: update the RAG and reason first, then generate.

## Cause

Left blank. Write what happened in facts, and separate the trigger from the underlying cause.

- **Good**: "Trigger: the router distributor cut our wave 3 allocation by 40%. Underlying cause: a single supply source with no buffer stock, a risk logged in October with a response that was never carried out."
- **Mistakes**: a cause that is really a symptom ("cutovers delayed"); naming people instead of the conditions that let it happen.

## Consequences

Compass lists the project's overdue tasks and late milestones, the evidence already visible in the plan.

- **Good**: add, in a few lines, what happens if nothing changes: the forecast dates, the cost, the customer's position, the effect on the business case and on other projects. The lists support the story; they do not tell it.
- **Mistakes**: pasting the lists with no explanation; leaving out the consequence the sponsor cares most about, which is often the customer relationship or a contractual penalty.

## Options

Left blank, with space for options A, B and C and their trade-offs. This is the heart of the report.

- **Good**: options that are genuinely different, each stated in the same terms: dates, cost, scope, risk and customer impact. Include "accept the slip" when it is realistic, so its cost is visible next to the others.
- **Mistakes**: one real option and two straw men; options without numbers; an option that needs someone else's approval without saying whose.

For a router shortage on a 60-site rollout, the three might be:

- A: pay for air freight from a second distributor; +$38,000, recovers 12 of the 18 days.
- B: re-sequence, cutting over the 20 sites with equipment in hand first; no cost, 10 days late, more night work.
- C: accept the slip and negotiate the date with the customer; no cost, 18 days late, contract penalty to be discussed.

On a project that allows cloud AI, Athena's "Exception report" preset can draft causes, options with trade-offs and a recommendation for you to check and rewrite.

## Recommendation

If you had Athena write the summary on the Report tab, Compass places that text here as a starting point; otherwise the section is blank. Either way, rewrite it as a recommendation.

- **Good**: which option, why, and the decision you need from whom by when: "Recommend B, with A held in reserve. Decision needed from the sponsor by Thursday to book night crews."
- **Mistakes**: no deadline, so the decision drifts; a recommendation that is not one of the options.

## Risks and issues

Two tables from the RAID tab: open risks, highest score first, and open issues.

- **Good**: trim them to the items that bear on the decision, and add any new risk each option creates, such as crew fatigue under option B.
- **Mistakes**: sending forty rows that bury the two that matter.

## After the decision

Log the decision and its conditions in the Decisions tab, create tasks for the actions, adjust milestones and the RAG, and raise a change request if scope, time or cost tolerances move.

## In practice

- Log the agreed tolerances for the current stage in the Decisions tab, so a breach can be measured against them.
- If a tolerance is forecast to break, update the RAG and generate the report today.
- Write three options with numbers before you choose one.
- Put the decision deadline in the first line of the recommendation.
- After the decision, raise the change request the same day.

## Related

- [[exception-reports]]
- [[prince2-processes]]
- [[issues-and-escalation]]
- [[template-change-request]]
- [[template-status-report]]
