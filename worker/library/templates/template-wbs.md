---
title: Template guide: WBS outline
section: Templates
---
The WBS outline template prints a numbered outline of the project from what Compass already holds: milestones as the top-level branches and tasks underneath them. You download it from the Templates list on the project's Report tab, as Word, Markdown or PDF. Be clear about what it is. A textbook work breakdown structure (structure de découpage du projet, SDP) is organised by deliverables; this outline is organised by time, because it groups tasks by the milestone they are due by. That makes it a strong check on your plan and a good first draft, but you will reshape it before calling it the project's WBS. The method behind a real WBS is in [[wbs-and-scheduling]].

## Milestone branches

Each milestone becomes a numbered branch: 1, 2, 3 and so on.

- **Good**: milestones that each close off a recognisable piece of the work, such as design approved, pilot live, each rollout wave live, handover done. When milestones match deliverables, the outline is already close to a real WBS.
- **Mistakes**: milestones that are only dates ("end of November") or meetings ("steering committee"), which give branches with no shape; one milestone at the end of the project, which puts every task in a single branch.
- **Example**: 1 Design approved; 2 Pilot of five sites live; 3 Wave 2 live; 4 Wave 3 live; 5 Handover to operations.

## Tasks under each milestone

Under each branch, Compass lists the tasks due on or before that milestone's date, numbered 1.1, 1.2 and onwards.

- **Good**: each task is a piece of work one person can own, with a clear output and a due date. Read every branch with the completeness test: if all these tasks are done, is the milestone really met? If the honest answer is "nearly", a task is missing. Testing, training, documentation, customer sign-off and decommissioning old services are the usual gaps.
- **Mistakes**: tasks so small that a branch runs to forty lines, which means the board is being used as a to-do list for the WBS; tasks so large ("do wave 2") that nobody can estimate them.
- **Example**: under 3 Wave 2 live: 3.1 confirm site readiness for 12 sites; 3.2 ship routers; 3.3 schedule cutover windows with the customer; 3.4 cut over sites; 3.5 obtain site acceptance; 3.6 stop billing on the old circuits.

When a task has slipped past its milestone's date, it lands under a later branch. Treat that as a signal: either the task is late, or the milestone is already at risk and belongs in the RAID log.

## Other work

Tasks that Compass could not place under any milestone are listed at the end under "Other work", for example tasks with no due date or due after the last milestone.

- **Good**: a short list of ongoing management work, such as weekly reporting or vendor meetings, which really does run across the whole project.
- **Mistakes**: a long Other work section. It usually means tasks are missing due dates, or a final milestone such as closure is missing from the plan.
- **What to do**: give the stray tasks dates, add the missing milestone, then generate the outline again.

## Turning the outline into a WBS

When you need a deliverable-based WBS, for a contract, a gate pack or a vendor's statement of work, take the Word version and reshape it:

- Regroup the branches by deliverable (design, equipment, site readiness, installs, integration, acceptance, project management) and move tasks into them.
- Check the 100% rule: everything in scope appears once, and nothing on the charter's out-of-scope list appears at all.
- Stop breaking down at work packages (lots de travail) one person can own and estimate.
- Add the estimates; three-point ranges work well here (see [[estimation-techniques]]).

On a project that allows cloud AI, the copilot's "Plan from scope" preset can propose a breakdown to work-package level with three-point estimates, working from the project's scope. Its proposals reach the board only when you choose "Add to the board", and the next outline will include them.

## In practice

- Generate the outline for your current project and count the tasks under Other work.
- Give every undated task a due date, or delete it if it no longer matters.
- Run the completeness test on the next milestone's branch and add what is missing.
- Check the last milestone is closure, not the final cutover.
- Turn the outline into a deliverable-based WBS before your next gate.

## Related

- [[wbs-and-scheduling]]
- [[estimation-techniques]]
- [[template-raci]]
- [[charter-and-business-case]]
- [[project-lifecycle]]
