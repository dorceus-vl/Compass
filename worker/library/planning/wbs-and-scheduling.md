---
title: WBS and scheduling
section: Planning
---
A schedule written straight from a list of activities nearly always misses work. Work in two steps. First, agree on what the project must produce and break it down until every piece can be owned and estimated: that is the work breakdown structure (WBS, structure de découpage du projet). Second, put those pieces in order and find the chain that sets the end date: that is the schedule (échéancier).

## Breaking the work down

Start from deliverables, not departments or verbs. For a managed SD-WAN rollout to 60 customer sites, the first level might be: solution design, equipment, site readiness, site installs, ordering and billing integration, customer acceptance and project management. Each branch splits again until it reaches a work package (lot de travail).

A branch is broken down far enough when:

- one person can own it and name its output;
- you can estimate it without saying "it depends" more than once;
- it finishes within one or two reporting periods;
- someone other than the owner can check that it is done.

You went too far when tasks last an hour or the WBS no longer fits on one page. Number every element (1, 1.2, 1.2.3); on larger projects, add a WBS dictionary entry per work package: description, owner, acceptance check, estimate.

## The 100% rule

The WBS holds all of the work in scope and none of the work outside it. At every level, the children add up to exactly their parent.

Two quick tests:

- **Completeness.** For each element, ask: "if every work package under it is finished, is this element finished?" If the honest answer is "almost", something is missing. The usual gaps are testing, training, documentation, handover to operations, decommissioning the old circuits, and the project management work itself.
- **Boundaries.** Read the charter's out-of-scope list. Nothing on it should appear anywhere in the WBS.

## Putting the work in order

Dependencies (dépendances) say what must happen before what. Most are finish-to-start: the access circuit must be delivered before the router can be turned up. Start-to-start and finish-to-finish links, and lags such as "48 hours of soak testing after install", cover most of the rest.

It also helps to know where each link comes from:

- **Hard logic**, set by physics or the contract: no testing before install.
- **Preferred logic**, a team's habit: challenge it when you need time back.
- **External**: a carrier, a permit, the customer's IT team, another Bell group's release. Log each as a dependency in the RAID log, with an owner on the other side.

## The critical path as a concept

Once work packages have durations and links, add up the durations along each chain from start to finish. The chain with the biggest total leaves no room: a day lost anywhere on it is a day lost on the project. That chain is the critical path (chemin critique). Every other chain has float (marge), slack it can lose before it touches the end date.

What this means in practice:

- Watch critical work more closely than the rest; speeding up anything else does not move the date.
- The path moves. When a side chain uses up its float, it becomes critical. Recheck after every real slip.
- There are two ways to compress. Crashing adds resources, such as a second install crew or overtime, and costs money. Fast-tracking overlaps work planned in sequence, such as starting site surveys before the design is signed, and adds a risk of rework.
- People are constraints too. If one engineer sits on two parallel chains, the true longest path runs through her calendar.

## Buffers

Safety hidden inside every estimate tends to get spent, invisibly. Estimate each work package realistically instead, and hold explicit buffers at a few points you control:

- a **project buffer** before the date you committed to the customer;
- **feeding buffers** where a side chain joins the critical path, for example where the integration work meets the first site go-live;
- **contingency** in the budget for known risks, kept apart from the management reserve that only the sponsor releases.

Report buffer used against work done: half the buffer gone with a third of the work finished is an early warning.

## In Compass

Milestones carry the deliverable dates the customer sees, and tasks carry due dates. The WBS outline template numbers each milestone with the tasks due on or before it and gathers the rest under "Other work". Compass does not draw dependency links, so keep external ones in the RAID log. On a project that allows cloud AI, the copilot's "Plan from scope" preset drafts a WBS with three-point estimates; nothing reaches the board until you tap "Add to the board".

## In practice

- Run the completeness test on your top-level deliverables and add what is missing, starting with testing, training and handover.
- Mark the five work packages you believe are critical; ask the team if they agree.
- Log every external dependency in the RAID log with a named owner on the other side.
- Take the padding out of two estimates and put it into one visible buffer before the committed date.
- Add a milestone for each deliverable the customer will see.

## Related

- [[estimation-techniques]]
- [[earned-value]]
- [[raid-log]]
- [[charter-and-business-case]]
- [[hybrid-delivery]]
