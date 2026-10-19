---
title: The Kanban method
section: Delivery
---
The Kanban method is a way to improve how work flows through an existing process, without first redesigning roles or adding new ceremonies. It grew from lean manufacturing ideas and was shaped for knowledge work by David J. Anderson and others in the late 2000s. You start with what you do now, make it visible, and improve it in small, agreed steps. It suits work that arrives continuously and varies in size, such as service activations, change requests, provisioning queues or a PM's own task list.

## The core practices

### Visualise the work

Put every piece of work on a board whose columns match the real steps the work goes through. Make different types of work look different (for example, customer installs, internal changes, escalations). Hidden work is the first thing a board exposes: requests received by email that never entered any tracker.

### Limit work in progress

Cap how many items may sit in a column (or in the whole system) at once. When a column is full, people finish or unblock something before starting something new. This is the practice that makes Kanban work; a board without WIP limits is just a to-do list with columns. Little's Law explains why: with the same throughput, more work in progress means every item takes longer.

### Manage flow

Watch how items move, not how busy people are. Useful measures are cycle time (start to done), throughput (items finished per week), and age of items in progress. Look for queues: work that piles up waiting for approval, for a vendor or for a site visit.

### Make policies explicit

Write down the rules: what "done" means for each column, who may pull work, how urgent items jump the queue, what the WIP limits are. Explicit policies let people make decisions without asking, and let you change a rule deliberately rather than by habit.

### Implement feedback loops

Hold regular, short reviews. A daily board walk (from right to left, focusing on what is blocked) is the core one; others include a replenishment meeting to choose what enters the board, and periodic reviews of delivery and risk.

### Improve collaboratively, evolve experimentally

Treat each change to the process as an experiment: state what you expect, try it, measure, keep or reverse it.

## How Compass's board maps to it

Compass's board has five columns: New, In progress, On hold, Waiting on and Done.

- **WIP limits** are set per column in Settings, as a whole number from 1 to 99, for New, In progress, On hold and Waiting on; Done has no limit. A fresh install limits In progress to five.
- The limit is a **soft limit**: the column header shows the cards in view against the limit (for example 6 / 5) and turns to the danger colour when it is exceeded, and dragging a card into a full column shows a notice. The move still happens. Kanban works the same way in practice: the limit is a signal to stop and swarm, not a lock.
- **Waiting on** is your blocked-work column. A growing Waiting on count means your flow depends on other people; chase those items before pulling new work.
- **Swimlanes** split the board by project, and the Personal / Work / All filter separates the two kinds of work, so different classes of work stay visible on one board.
- Explicit policies are yours to write: for example, a card enters In progress only when it has a due date and a next action.

## Common mistakes

- Setting WIP limits so high they never trigger.
- Ignoring the limit "just this once" every day.
- Columns that describe people rather than steps.
- No regular board review, so blocked items age silently.

## In practice

- Set an In progress limit on your Compass board that is lower than what you have now, and keep it for two weeks.
- Walk the board from right to left each morning and clear one blocked item first.
- Move everything you are waiting on into Waiting on, with the person's name.
- Write three explicit policies for your board and put them in a note on the project.
- Track how many items you finish per week for a month, then use it to set realistic dates.

## Related

- [[agile-values-principles]]
- [[scrum-essentials]]
- [[hybrid-delivery]]
- [[safe-basics]]
