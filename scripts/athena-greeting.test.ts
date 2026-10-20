import assert from 'node:assert/strict';
import { athenaGreeting, dueItems } from '../web/src/athena-greeting.ts';
import type { Project, Task } from '../shared/types.ts';

const task = (o: Partial<Task>) => ({ id: 'x', title: 'T', project_id: null, kind: 'personal', status: 'new', due_at: null, deleted_at: null, ...o }) as Task;
const proj = (o: Partial<Project>) => ({ id: 'p', kind: 'work', data_boundary: 'cloud', deleted_at: null, ...o }) as Project;
const T = '2026-10-20';

const tasks = [
  task({ id: 'a', title: 'Late one', due_at: '2026-10-17' }),
  task({ id: 'b', title: 'Today one', due_at: T }),
  task({ id: 'c', title: 'Future', due_at: '2026-10-21' }),
  task({ id: 'd', title: 'Done', due_at: T, status: 'done' }),
  task({ id: 'e', title: 'Work, no project', kind: 'work', due_at: T }),
  task({ id: 'f', title: 'Offline project', project_id: 'off', kind: 'work', due_at: T }),
  task({ id: 'g', title: 'Cloud project', project_id: 'p', kind: 'work', due_at: T }),
  task({ id: 'h', title: 'Trashed', due_at: T, deleted_at: 'x' }),
];
const projects = [proj({ id: 'p' }), proj({ id: 'off', data_boundary: 'offline' })];
const items = dueItems(tasks, projects, T);
assert.deepEqual(items.map((x) => x.id), ['a', 'g', 'b']); // oldest first; offline, work-without-project, done, future and trashed left out
assert.deepEqual(dueItems(tasks, projects, T, 'p').map((x) => x.id), ['g']);

assert.equal(athenaGreeting(9, items, T), 'Good morning, Vlad. 3 items need you: "Late one" (3 days late) and "Cloud project" (due today), and 1 more. Want to start there, or bring me something to polish?');
assert.match(athenaGreeting(14, [items[2]], T), /^Good afternoon, Vlad\. One item needs you: "Today one" \(due today\)\./);
assert.match(athenaGreeting(20, [], T), /^Good evening, Vlad\. Nothing is due or overdue\./);
console.log('athena-greeting ok');
