---
title: SAFe basics
section: Delivery
---
The Scaled Agile Framework (SAFe), from Scaled Agile, Inc., is a large, prescriptive framework for running agile delivery across many teams that build one solution together. It layers lean portfolio management, programme-level planning and team-level Scrum or Kanban into one operating model. Large telecom and enterprise IT organisations often adopt it, so a PM working with IT or digital teams will meet its vocabulary even when their own project is predictive. The current major version is 6.0; details change between versions, so check which one your organisation follows.

## Agile release trains

The core unit is the **agile release train (ART)**: a long-lived team of agile teams, typically somewhere between 50 and 125 people, organised around a value stream such as "business customer ordering" or "network service activation". The train plans, builds, integrates and demonstrates together on a shared cadence. Teams within it use Scrum or Kanban, with iterations of usually two weeks.

When a solution is too big for one train, several trains coordinate in a **solution train**. Above that, **lean portfolio management** decides which large initiatives (epics) get funding, usually by funding value streams rather than individual projects.

## PI planning

Work is organised into **planning intervals (PIs)**, earlier called programme increments: commonly 8 to 12 weeks, often four development iterations followed by one innovation and planning iteration.

**PI planning** is the signature event: everyone on the train, in person or online, over roughly two days.

- Business context and vision are presented, followed by the top features for the coming PI.
- Teams draft their iteration plans, identify dependencies on other teams and raise risks.
- Dependencies and key dates are drawn on a shared board, often called the ART planning board.
- Risks are sorted with **ROAM**: resolved, owned, accepted or mitigated.
- Each team commits to **PI objectives**, and business owners assign them business value.
- The train takes a confidence vote; low confidence triggers replanning before anyone leaves.

During the PI, a **system demo** shows the integrated work each iteration, and the **inspect and adapt** event at the end reviews results and picks improvements.

## Roles

- **Release train engineer (RTE).** Facilitates the train, runs PI planning, manages risks and dependencies across teams. Often the role closest to a traditional programme manager.
- **Product management.** Owns the train's backlog of features and its priorities.
- **System architect.** Guides the technical direction across teams.
- **Business owners.** Senior stakeholders accountable for the business outcome; they assign value to PI objectives.
- **Product owner** and **Scrum master / team coach** at team level, as in Scrum.

## How a PM interacts with SAFe

On a B2B project, the PM is often a customer of one or more trains: you need a feature (for example, a new service type in the ordering portal) by a date tied to a customer contract. Get your feature into the train's backlog before PI planning, attend the relevant breakout or the final plan review, and track the dependency on the planning board. A feature not planned at PI planning will usually wait for the next PI.

## When SAFe is heavier than the problem

SAFe brings real costs: training, new roles, a quarterly two-day event, and a lot of terminology. It can be more than the work needs when:

- The work involves one or two teams; plain Scrum or Kanban with a shared backlog is enough.
- Teams do not actually depend on each other; coordinating them on one cadence adds overhead without benefit.
- The work is mostly physical (installs, builds, cutovers) and cannot be integrated every two weeks.
- Leadership wants the labels but not the decentralised decision-making; the result is waterfall with extra meetings.
- Priorities change weekly; a fixed quarterly plan fights the business rather than serving it.

Lighter alternatives include a simple Scrum of Scrums, a shared roadmap with a monthly dependency review, or Kanban with a portfolio board.

## In practice

- Find out which trains your project depends on and who their RTEs are.
- Check the date of the next PI planning and get your feature request in front of product management beforehand.
- Put each cross-train dependency in your RAID log with the PI it is planned for.
- Treat a train's PI objectives as commitments with uncertainty; add a risk if your go-live depends on one.
- If someone proposes SAFe for a small project, ask which inter-team dependency it would solve.

## Related

- [[scrum-essentials]]
- [[kanban-method]]
- [[hybrid-delivery]]
- [[agile-values-principles]]
