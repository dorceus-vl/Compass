import assert from 'node:assert/strict';
import { briefText } from '../shared/brief.ts';
import type { Task, TodayAnswer } from '../shared/types.ts';

const task = (title: string, due_at: string | null, status: Task['status'] = 'new'): Task => ({ title, due_at, status } as Task);
const ms = (name: string, project_name: string, due_at: string) => ({ name, project_name, due_at }) as TodayAnswer['milestones'][number];
const answer = (o: Partial<TodayAnswer>): TodayAnswer => ({ date: '2026-10-19', short: [], medium: [], long: [], overdue: [], done_this_week: 0, open_today: 0, milestones: [], ...o });

// Busy day: 2 due today, 2 overdue (oldest 5 days late), 1 waiting, a milestone.
const late = [task('Send invoice', '2026-10-14'), task('Call Ann', '2026-10-17')];
const busy = answer({
  short: [task('Draft plan', '2026-10-19'), task('Review deck', '2026-10-19'), ...late], medium: [task('Await vendor', null, 'waiting')],
  overdue: late, open_today: 4, milestones: [ms('Beta launch', 'Apollo', '2026-10-24')],
});
assert.equal(briefText(busy, '2026-10-19'),
  'Monday, October 19. 2 tasks are due today. 2 tasks are overdue, the oldest "Send invoice" 5 days late. 1 task is waiting on others. Next milestone: Beta launch (Apollo), Oct 24.');

// All clear.
assert.equal(briefText(answer({}), '2026-10-19'), 'Monday, October 19. Nothing urgent today.');

// Overdue only, one day late, no milestone.
const one = [task('Pay bill', '2026-10-18')];
assert.equal(briefText(answer({ short: one, overdue: one, open_today: 1 }), '2026-10-19'),
  'Monday, October 19. 1 task is overdue, the oldest "Pay bill" 1 day late.');

console.log('brief: ok');
