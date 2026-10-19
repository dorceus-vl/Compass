---
title: Earned value
section: Planning
---
"45% of the budget spent, 50% of the calendar gone" says nothing about health. Earned value management (gestion de la valeur acquise) answers the real question: for the money spent so far, how much of the planned work has actually been finished, and what does that predict for the end?

It needs a baseline that spreads the budget over time by work package, an agreed way to measure progress, and actual costs collected at the same level.

## The measures

- **PV, planned value** (valeur planifiée): the budget for the work that should have been finished by today, according to the baseline.
- **EV, earned value** (valeur acquise): the budget for the work actually finished by today, in budget dollars, not what it really cost.
- **AC, actual cost** (coût réel): what has actually been spent to finish that work.
- **BAC, budget at completion**: the total baseline budget.

Measure EV by a rule agreed in advance: 0/100 (credit only when finished), 50/50 (half at start, half at finish) or units complete (sites installed out of sites planned). The coarser the rule, the smaller the work packages should be.

## The formulas

| Measure | Formula | Reading |
|---|---|---|
| Schedule variance | SV = EV − PV | Negative: behind plan |
| Cost variance | CV = EV − AC | Negative: over budget |
| Schedule performance index | SPI = EV / PV | Below 1: behind plan |
| Cost performance index | CPI = EV / AC | Below 1: each dollar buys less than a dollar of planned work |
| Estimate at completion | EAC = BAC / CPI | Forecast total cost if the current cost efficiency continues |
| Estimate to complete | ETC = EAC − AC | What is still to be spent |
| Variance at completion | VAC = BAC − EAC | Negative: forecast overrun |

EAC has other forms, each with its own assumption:

- **EAC = AC + (BAC − EV)**: the overrun so far was a one-off, and the remaining work will cost what was planned.
- **EAC = AC + (BAC − EV) / (CPI × SPI)**: both cost and schedule pressure will continue, for example when catching up means paying overtime.
- **EAC = AC + a bottom-up ETC**: the team re-estimates the rest, when the original plan no longer describes the work.

The **to-complete performance index**, TCPI = (BAC − EV) / (BAC − AC), is the cost efficiency the remaining work needs to land on budget.

## Worked example

A managed Wi-Fi deployment at 40 customer sites has a budget (BAC) of $400,000, planned evenly at $10,000 per site and four sites a week over ten weeks. EV is measured as units complete: a site earns its $10,000 when it passes acceptance.

At the end of week 5:

- the plan called for 20 sites: **PV** = 20 × $10,000 = **$200,000**;
- 16 sites have passed acceptance: **EV** = 16 × $10,000 = **$160,000**;
- finance reports **AC** = **$180,000**.

Then:

- SV = 160,000 − 200,000 = **−$40,000** (four sites' worth of work behind).
- CV = 160,000 − 180,000 = **−$20,000**.
- SPI = 160,000 / 200,000 = **0.80**.
- CPI = 160,000 / 180,000 = **0.89** (0.888…).
- EAC = 400,000 / 0.888… = 400,000 × 180 / 160 = **$450,000**.
- ETC = 450,000 − 180,000 = **$270,000**.
- VAC = 400,000 − 450,000 = **−$50,000**.
- TCPI = (400,000 − 160,000) / (400,000 − 180,000) = 240,000 / 220,000 = **1.09**.

Reading it: each dollar buys about 89 cents of planned work, and the pace is 20% behind plan. If nothing changes, the project lands $50,000 over. Finishing on $400,000 would need the remaining work to run 9% more efficiently than planned, unlikely without a change of approach. Against the other EAC forms, a one-off overrun gives 180,000 + 240,000 = $420,000, and continued cost and schedule pressure gives 180,000 + 240,000 / (0.888… × 0.80) = $517,500. Present that range, not a single number.

## Limits worth knowing

- SPI drifts back towards 1.0 near the end, because all planned work is eventually earned, even late work. Late in a project, trust the milestone dates more than SPI.
- EV ignores quality. A site that "passed" and then needs a revisit earned value it did not deserve.
- Re-baseline after approved changes, never to hide a variance.

## In Compass

The project record holds planned and spent budget, and the portfolio shows % done. That figure counts finished tasks, all weighted equally, so it is not earned value. When a project needs EV, track PV, EV and AC per period with the cost data and put CPI, SPI and the EAC range in the status report's summary.

## In practice

- Agree the EV measurement rule for each work package type with your finance partner.
- Ask finance how far actual costs lag; a three-week lag skews CPI.
- Calculate CPI and SPI for your largest project this week, even roughly.
- Report EAC as a range from two formulas, with the assumption behind each.
- If TCPI is above 1.1, raise it with the sponsor now rather than at the next gate.

## Related

- [[estimation-techniques]]
- [[wbs-and-scheduling]]
- [[status-reporting]]
- [[change-control]]
