// node --experimental-strip-types scripts/timeline.test.ts
import assert from 'node:assert/strict';
import { dayIndex, layout, shiftDates } from '../web/src/timeline-math.ts';
assert.equal(dayIndex('2026-10-19', '2026-10-19'), 0);
assert.equal(dayIndex('2026-10-22', '2026-10-19'), 3);
const rows = layout([{ id: 'a', title: 'A', start_at: '2026-10-20', due_at: '2026-10-24' } as any, { id: 'b', title: 'B', start_at: null, due_at: '2026-10-21' } as any], '2026-10-19', 10);
assert.deepEqual(rows.map((r) => [r.id, r.x, r.w]), [['a', 10, 50], ['b', 20, 10]], 'a bar spans start..due inclusive; a due-only task is one day');
assert.deepEqual(shiftDates({ start_at: '2026-10-20', due_at: '2026-10-24' }, 2), { start_at: '2026-10-22', due_at: '2026-10-26' });
assert.deepEqual(shiftDates({ start_at: null, due_at: '2026-10-24' }, -1), { start_at: null, due_at: '2026-10-23' });
console.log('timeline: ok');
