// node --experimental-strip-types scripts/calendar.test.ts
import assert from 'node:assert/strict';
import { monthGrid, weekDays, placeTasks, placeEvents, eventTime, eventLabel, add } from '../web/src/calendar-math.ts';

// Month grid: 6 rows x 7, Monday first (Oct 2026 starts on a Thursday), or Sunday first.
const g = monthGrid(2026, 10);
assert.equal(g.length, 6); assert.ok(g.every((r) => r.length === 7));
assert.deepEqual([g[0][0], g[0][3], g[5][6]], ['2026-09-28', '2026-10-01', '2026-11-08']);
assert.equal(monthGrid(2026, 10, false)[0][0], '2026-09-27');
assert.equal(monthGrid(2026, 2)[0][0], '2026-01-26'); // Feb 2026 starts on a Sunday: the Monday before
assert.equal(monthGrid(2026, 3)[0][0], '2026-02-23'); // 28-day February: still 6 rows
assert.equal(monthGrid(2027, 1)[0][0], '2026-12-28'); // across the year
assert.equal(add('2026-03-08', 1), '2026-03-09'); // DST start day, no slip
assert.equal(add('2026-11-01', 1), '2026-11-02');
// Weeks: Monday first, for any day in it, including a Sunday.
assert.deepEqual(weekDays('2026-10-20'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
assert.equal(weekDays('2026-10-25')[0], '2026-10-19');
assert.equal(weekDays('2026-10-19')[0], '2026-10-19');

// Tasks: by due date; overdue open ones on today; done ones stay on their day; trashed, subtasks and undated are out.
const T = (id: string, due_at: string | null, status = 'new', extra = {}) => ({ id, due_at, status, deleted_at: null, parent_id: null, ...extra }) as any;
const week = weekDays('2026-10-20');
const p = placeTasks([T('a', '2026-10-21'), T('late', '2026-10-10'), T('doneold', '2026-10-10', 'done'), T('none', null), T('gone', '2026-10-22', 'new', { deleted_at: 'x' }), T('sub', '2026-10-22', 'new', { parent_id: 'a' }), T('out', '2026-11-30')], week, '2026-10-20');
assert.deepEqual(Object.keys(p).length, 7);
assert.deepEqual(p['2026-10-21'].map((t: any) => t.id), ['a']);
assert.deepEqual(p['2026-10-20'].map((t: any) => t.id), ['late']);
assert.ok(Object.values(p).flat().every((t: any) => !['doneold', 'none', 'gone', 'sub', 'out'].includes(t.id)));
assert.deepEqual(placeTasks([T('late', '2026-10-10')], monthGrid(2026, 9).flat(), '2026-10-20')['2026-10-10'], [], 'today not shown: the task is not placed on a past day either');

// Events: timed by local day in the given zone, all-day first, multi-day spans, all-day end exclusive, clipped to the days shown.
const E = (title: string, start: string, end: string, all_day = false) => ({ title, start, end, all_day, location: null, source: 'google' });
const ev = placeEvents([
  E('late', '2026-10-21T23:30:00-04:00', '2026-10-21T23:59:00-04:00'), E('early', '2026-10-21T09:00:00-04:00', '2026-10-21T10:00:00-04:00'),
  E('holiday', '2026-10-21', '2026-10-22', true), E('trip', '2026-10-23', '2026-10-26', true), E('before', '2026-10-01', '2026-10-02', true),
], week, 'America/Toronto');
assert.deepEqual(ev['2026-10-21'].map((e) => e.title), ['holiday', 'early', 'late']);
assert.deepEqual(ev['2026-10-22'].map((e) => e.title), [], 'the holiday ends the day before its exclusive end; a meeting past midnight spills over');
assert.equal(placeEvents([E('x', '2026-10-21T20:00:00-04:00', '2026-10-22T00:00:00-04:00')], week, 'America/Toronto')['2026-10-22'].length, 0, 'a meeting that ends at midnight stays on its day');
assert.equal(placeEvents([E('x', '2026-10-21T22:00:00-04:00', '2026-10-22T01:00:00-04:00')], week, 'America/Toronto')['2026-10-22'].length, 1, 'one that runs past midnight shows on both');
assert.deepEqual(['23', '24', '25'].map((d) => ev[`2026-10-${d}`].map((e) => e.title).join()), ['trip', 'trip', 'trip']);
assert.ok(!Object.values(ev).flat().some((e) => e.title === 'before'));
assert.equal(placeEvents([E('x', '2026-10-21T02:00:00Z', '2026-10-21T03:00:00Z')], week, 'America/Toronto')['2026-10-20'].length, 1, 'UTC night belongs to the previous local day');
assert.equal(eventTime(E('x', '2026-10-21T14:30:00-04:00', '2026-10-21T15:00:00-04:00'), 'America/Toronto'), '14:30');
assert.equal(eventTime(E('x', '2026-10-21', '2026-10-22', true)), '');
assert.equal(eventLabel(E('x', '', '')), 'Kelly · Google');
assert.equal(eventLabel({ ...E('x', '', ''), source: 'Google Calendar' }), 'Kelly · Google', "Kelly's own source names, short");
assert.equal(eventLabel({ ...E('x', '', ''), source: 'Outlook Calendar' }), 'Kelly · Outlook');
const span = placeEvents([E('long', '2026-10-15', '2026-10-21', true)], week, 'America/Toronto');
assert.deepEqual(week.filter((d) => span[d].length), ['2026-10-19', '2026-10-20'], 'a multi-day event that began before the days shown sits on those it covers');
console.log('calendar.test: ok');
