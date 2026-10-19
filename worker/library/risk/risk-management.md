---
title: Risk management
section: Risk and change
---
Every plan rests on things that might not go as expected: a carrier's circuit arrives late, a customer site is not ready, a vendor's firmware has a bug, or, on the bright side, a second crew becomes free early. Risk management (gestion des risques) is the habit of asking, on a fixed rhythm: what could happen, how likely is it, how much would it hurt or help, and what are we doing about it? Its value is in acting before the event, while options are still cheap.

## Identify

Cast wide, then filter. Useful sources:

- The WBS: walk each branch and ask what could stop or slow it.
- Assumptions in the charter and estimates: each one is a risk if it turns out false.
- Dependencies on carriers, vendors, other teams, the customer, permits and landlords.
- Lessons from similar projects, your own and others' (see [[lessons-learned]]).
- The team, in a short session where nobody is judged for raising an awkward risk.

Write each risk so it can be acted on. A format that helps is cause, event, effect: "Because the building's riser is shared with another tenant (cause), access for the fibre lateral may be refused (event), delaying site 14's go-live by up to six weeks (effect)." Vague risks such as "vendor issues" or "resources" cannot be owned or measured.

## Analyse: probability × impact

Score each risk on two scales of 1 to 5:

- **Probability**: 1 is very unlikely, 5 is almost certain.
- **Impact**: 1 is minor, 5 is severe. Define what each level means for your project in schedule, cost, quality and customer terms, so two people score the same risk the same way. For example: 3 is "a milestone slips up to two weeks or costs up to 5% of the budget"; 5 is "the contract date is missed or the customer escalates to executives".

Multiply them for a score from 1 to 25 and place the risk on a 5 × 5 grid. A common reading is: 15 and above, act now and report to the sponsor; 8 to 14, plan a response and watch it; below 8, note it and review it. Scores are a way to rank and discuss, not precise measurements. Large projects sometimes add quantitative analysis, such as Monte Carlo simulation of the schedule, once the main risks are known.

## Respond

For threats, four main strategies:

- **Avoid**: change the plan so the risk cannot happen, such as choosing a different site entry or dropping an unproven feature.
- **Transfer**: move the consequence to another party, through a contract clause, a penalty, or insurance. The risk still exists; someone else pays for it.
- **Mitigate**: reduce its probability or impact, such as ordering long-lead equipment early or piloting at two sites first.
- **Accept**: do nothing now, either passively or with a contingency reserve and a fallback plan ready.

PMBOK 6 also names **escalate**, for threats and opportunities that sit outside the project's authority and belong to someone higher up.

For opportunities, the mirror strategies:

- **Exploit**: make sure it happens, such as assigning the best engineer to secure an early finish bonus.
- **Share**: partner with someone better placed to capture it.
- **Enhance**: raise its probability or benefit.
- **Accept**: take it if it comes.

Every response needs an owner and a date, and is usually a task. A response with no owner is a hope.

## Monitor

Review the top risks weekly in the working group and the full log at least monthly. For each: has the probability or impact changed, is the response happening, has its trigger fired? Close risks that have passed. Watch for new ones after every change, gate and vendor update.

## Risk or issue?

A risk has not happened yet; an issue has. "The vendor might miss the delivery date" is a risk. "The vendor missed the delivery date" is an issue, managed now (see [[issues-and-escalation]]). When a risk occurs, close it and open an issue, so the log shows both what you foresaw and what you are dealing with.

## In Compass

Each project's RAID tab scores risks on probability and impact from 1 to 5. The score shows red from 15 and amber from 8, and a 5 × 5 heat grid counts open risks per cell; tap a cell to filter. The portfolio counts open risks and high risks (score 15 or more) per project. See [[raid-log]] for the fields.

## In practice

- Rewrite your three vaguest risks as cause, event, effect.
- Agree with the sponsor what impact 3 and impact 5 mean on your project, in days and dollars.
- Make sure every risk scoring 15 or more has an owner, a dated response and a task.
- Look for one opportunity worth exploiting and log it.
- Close or convert every risk that has already happened.

## Related

- [[raid-log]]
- [[issues-and-escalation]]
- [[change-control]]
- [[pmbok7-performance-domains]]
