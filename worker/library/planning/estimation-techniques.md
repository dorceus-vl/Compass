---
title: Estimation techniques
section: Planning
---
An estimate is a forecast with uncertainty attached, not a promise. Pick a technique that fits how much is known, then report a range with its assumptions. "Six to nine weeks, if the carrier delivers the circuits by the 15th" is more honest, and easier to manage, than "seven weeks".

## Which technique when

| Technique | Use it when | Watch out for |
|---|---|---|
| Analogous | Early, little detail, a similar past project exists | The past project was not as similar as it looked |
| Parametric | The work repeats and you have a reliable unit rate | A rate taken from a different context |
| Three-point / PERT | Duration or cost is uncertain and the risk is mostly one-sided | Optimistic values that are really "most likely" |
| Bottom-up | The WBS is down to work packages | Missing work, and padding at every level |
| Planning poker | A team estimates its own backlog items | Treating points as hours or comparing them across teams |

## Analogous: "last time it took…"

Take a comparable piece of work and adjust for the differences. If last year's 40-site managed Wi-Fi refresh for a retail chain took five months, a 60-site refresh for a similar customer might start at seven, adjusted for the new customer's slower building access. It is quick and good enough for a business case, but only as good as the comparison: note which project you used and what you adjusted.

## Parametric: unit × quantity

When the work is made of repeated units, multiply a measured rate by the count: installs per crew per day, hours per site survey, cost per kilometre of fibre lateral. With 120 sites, two crews, and a measured rate of 1.5 installs per crew per day, installs take about 40 working days, before weather, access problems and failed site visits. The rate is the weak point: check where it came from and whether it included travel, rework and revisits.

## Three-point and PERT

Ask for three numbers, not one:

- **O**, optimistic: things go well, with no heroics.
- **M**, most likely: what usually happens.
- **P**, pessimistic: realistic trouble, but not a disaster.

Two ways to combine them:

- **Triangular average:** E = (O + M + P) / 3.
- **PERT (beta) estimate:** E = (O + 4M + P) / 6, with a spread of σ ≈ (P − O) / 6.

Example: integrating a customer's ordering portal with a new provisioning API, with O = 10 days, M = 15, P = 26. PERT gives (10 + 60 + 26) / 6 = 96 / 6 = 16 days, with σ = (26 − 10) / 6 ≈ 2.7 days. The triangular average is 51 / 3 = 17 days, because it gives the pessimistic tail more weight. Either way, the answer is above the "most likely" 15: when trouble can cost more than luck can save, the expected value sits to the right of the typical case.

As a rough guide, E ± σ is about a two-in-three chance and E ± 2σ about nineteen in twenty, if the spread behaves roughly like a bell curve. For a chain of tasks, add the expected values. For the chain's spread, add the variances (σ²) and take the square root; adding the σ values directly overstates it, as long as the tasks' risks are independent.

## Bottom-up

Estimate each work package with the people who will do it, then roll up through the WBS: the most accurate method once scope is known, and the slowest. Two traps: work missing from the WBS is missing from the estimate, and safety added at every level compounds. Ask for realistic estimates and hold the contingency in one visible place instead (see [[wbs-and-scheduling]]).

## Planning poker

For agile workstreams, the team estimates backlog items in relative points. Each person picks a card privately, everyone reveals at once, and the highest and lowest explain their reasoning before a second round. The discussion matters more than the number: a 3 and a 13 on one item mean two people pictured different work. Points describe size for one team's planning; turning them into hours or comparing velocity across teams defeats the purpose.

## Ranges over single numbers

- Give ranges, and say which end you would commit to and at what confidence.
- Narrow the range as you learn. An early estimate can easily be off by half in either direction; a range that is still wide just before build is a risk to log.
- Keep the assumptions with the estimate. When one breaks, you know which number to revisit.
- Separate estimate from commitment: the team estimates, the sponsor decides how much buffer to buy.

## In practice

- Re-estimate the riskiest work package on your project with three points and compare the PERT result with the current plan.
- For any repeated unit (sites, circuits, users), check where its rate came from and whether it includes revisits.
- Rewrite your next status report's forecast as a range with one named assumption.
- Log the assumptions behind your two largest estimates in the RAID log.

## Related

- [[wbs-and-scheduling]]
- [[earned-value]]
- [[risk-management]]
- [[scrum-essentials]]
