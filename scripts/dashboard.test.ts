import assert from 'node:assert/strict';
import { addDaysYmd, weekStart, localDay, burndown, donePerWeek, overdueTrend, riskMatrix, severity, milestoneSlip, dashboardMetrics } from '../shared/dashboard.ts';

const TZ = 'America/Toronto';
type T = { id: string; parent_id: string | null; status: string; due_at: string | null; created_at: string; done_at: string | null; deleted_at: string | null };
const t = (id: string, o: Partial<T> = {}): T => ({ id, parent_id: null, status: 'new', due_at: null, created_at: '2026-10-01T15:00:00Z', done_at: null, deleted_at: null, ...o });

// Dates: UTC calendar arithmetic, weeks start on Monday, and a stored timestamp is read in the user's zone.
assert.equal(addDaysYmd('2026-10-31', 2), '2026-11-02');
assert.equal(weekStart('2026-10-25'), '2026-10-19', 'a Sunday belongs to the week that began on the Monday before');
assert.equal(weekStart('2026-10-26'), '2026-10-26');
assert.equal(localDay('2026-10-26T03:59:00Z', TZ), '2026-10-25', '23:59 Sunday in Toronto (EDT) is still Sunday');
assert.equal(localDay('2026-10-26T04:00:00Z', TZ), '2026-10-26');
assert.equal(localDay('2026-11-02T04:59:00Z', TZ), '2026-11-01', 'after the clocks go back (EST) 23:59 Sunday is UTC 04:59');
assert.equal(localDay('2026-11-02T05:00:00Z', TZ), '2026-11-02');
assert.equal(localDay('2026-11-02', TZ), '2026-11-02', 'a plain date passes through');

// donePerWeek: eight weeks, oldest first, the last one holds today; the DST change falls inside the week of 2026-10-26.
const done = [
  t('a', { status: 'done', done_at: '2026-10-26T04:00:00Z' }),       // Mon 26 00:00 EDT: week of 26
  t('b', { status: 'done', done_at: '2026-11-02T04:59:00Z' }),       // Sun 1 Nov 23:59 EST: still the week of 26
  t('c', { status: 'done', done_at: '2026-11-02T05:00:00Z' }),       // Mon 2 Nov 00:00 EST: next week
  t('d', { status: 'done', done_at: '2026-10-26T03:59:00Z' }),       // Sun 25 Oct 23:59 EDT: the week before
  t('s', { status: 'done', done_at: '2026-10-27T15:00:00Z', parent_id: 'a' }), // a subtask is not counted
  t('x', { status: 'done', done_at: '2026-10-27T15:00:00Z', deleted_at: '2026-10-28T00:00:00Z' }), // nor is a trashed task
  t('n', { status: 'done', done_at: null }),                         // done with no time recorded: skipped
];
const w = donePerWeek(done, '2026-11-03', 8, TZ);
assert.equal(w.length, 8);
assert.deepEqual(w.map((x) => x.start).slice(-3), ['2026-10-19', '2026-10-26', '2026-11-02']);
assert.deepEqual(w.slice(-3).map((x) => x.done), [1, 2, 1]);
assert.equal(w[0].start, '2026-09-14');
assert.equal(w[7].end, '2026-11-08');

// burndown: open count per day from the start, ideal from the count at the start down to 0 at end_at.
const bd = [
  t('1', { created_at: '2026-10-01T15:00:00Z', due_at: '2026-10-10' }),
  t('2', { created_at: '2026-10-01T15:00:00Z', status: 'done', done_at: '2026-10-03T15:00:00Z', due_at: '2026-10-09' }),  // done before it was due
  t('3', { created_at: '2026-10-03T15:00:00Z' }),                                                                         // no dates
  t('4', { created_at: '2026-10-02T15:00:00Z', deleted_at: '2026-10-04T00:00:00Z' }),                                      // trashed: never counted
  t('5', { created_at: '2026-10-02T15:00:00Z', parent_id: '1' }),                                                          // subtask
];
const b = burndown(bd, '2026-10-01', '2026-10-09', '2026-10-05', TZ);
assert.deepEqual(b.days.map((d) => d.date), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
assert.deepEqual(b.days.map((d) => d.open), [2, 2, 2, 2, 2, null, null, null, null], 'open: t1,t2 on the 1st; t2 done on the 3rd (UTC 15:00 = 11:00 Toronto) while t3 arrives');
assert.equal(b.ideal?.[0], 2); assert.equal(b.ideal?.at(-1), 0);
assert.equal(b.days[4].ideal, 1, 'halfway along the line the ideal is half of the start count');
assert.equal(b.remaining, 2); assert.equal(b.ideal_now, 1);
// No end date: no ideal line, the series still runs to today.
const noEnd = burndown(bd, '2026-10-01', null, '2026-10-03', TZ);
assert.equal(noEnd.ideal, null); assert.equal(noEnd.days.length, 3); assert.equal(noEnd.ideal_now, null); assert.ok(noEnd.days.every((d) => d.ideal === null));
// No start date: it starts at the first task's creation day; no tasks at all: today alone.
assert.equal(burndown(bd, null, null, '2026-10-05', TZ).days[0].date, '2026-10-01');
const empty = burndown([], null, null, '2026-10-05', TZ);
assert.deepEqual(empty.days.map((d) => [d.date, d.open]), [['2026-10-05', 0]]);
// End date before the start: no ideal. A project that has not started yet: the ideal runs, the actual line has no points.
assert.equal(burndown(bd, '2026-10-05', '2026-10-01', '2026-10-06', TZ).ideal, null);
const future = burndown(bd, '2026-10-20', '2026-10-24', '2026-10-05', TZ);
assert.ok(future.days.every((d) => d.open === null)); assert.equal(future.remaining, 2);
// The series is capped at 400 days so a very old start doesn't draw thousands of points.
assert.ok(burndown(bd, '2020-01-01', null, '2026-10-05', TZ).days.length <= 400);

// overdueTrend: at each week's end (today for the current week) due < that day, created by then, not done by then.
const od = [
  t('p', { due_at: '2026-10-20', created_at: '2026-10-01T15:00:00Z' }),                                                    // never done: overdue from the 21st
  t('q', { due_at: '2026-10-20', status: 'done', done_at: '2026-10-28T15:00:00Z' }),                                       // overdue until it was done
  t('r', { due_at: '2026-10-10', status: 'done', done_at: '2026-10-09T15:00:00Z' }),                                       // done before it was due: never overdue
  t('u', { created_at: '2026-10-01T15:00:00Z' }),                                                                          // no dates: never overdue
  t('v', { due_at: '2026-10-05', created_at: '2026-10-30T15:00:00Z' }),                                                    // created after its due date: counted from the week it exists
  t('z', { due_at: '2026-10-05', deleted_at: '2026-10-06T00:00:00Z' }),
];
const tr = overdueTrend(od, '2026-11-03', 8, TZ);
assert.equal(tr.length, 8);
const at = (day: string) => tr.find((x) => x.as_of === day)!.overdue;
assert.equal(at('2026-10-25'), 2, 'p and q are overdue on Sunday 25 Oct');
assert.equal(at('2026-11-01'), 2, 'q is done on the 28th, but v (created the 30th, due the 5th) arrives: p, v');
assert.equal(tr.at(-1)!.as_of, '2026-11-03', 'the current week reads as of today, not its Sunday');
assert.equal(tr.at(-1)!.overdue, 2);
assert.equal(at('2026-10-11'), 0);

// riskMatrix: open risks only, the 5×5 grid, severity = P × I; unrated counted apart.
const r = (id: string, o: Partial<{ type: string; status: string; probability: number | null; impact: number | null; deleted_at: string | null }>) => ({ id, type: 'risk', status: 'open', probability: null, impact: null, deleted_at: null, ...o });
const mx = riskMatrix([r('1', { probability: 5, impact: 3 }), r('2', { probability: 5, impact: 3 }), r('3', { probability: 2, impact: 4 }), r('4', { probability: 1, impact: 1 }),
  r('5', {}), r('6', { probability: 3 }), r('7', { type: 'issue', probability: 5, impact: 5 }), r('8', { status: 'closed', probability: 5, impact: 5 }), r('9', { probability: 5, impact: 5, deleted_at: 'x' })]);
assert.equal(mx.cells.length, 25);
assert.equal(mx.cells.find((c) => c.p === 5 && c.i === 3)!.count, 2);
assert.equal(mx.cells.find((c) => c.p === 5 && c.i === 3)!.severity, 'high');
assert.equal(mx.cells.find((c) => c.p === 2 && c.i === 4)!.severity, 'medium');
assert.equal(mx.cells.find((c) => c.p === 1 && c.i === 1)!.severity, 'low');
assert.deepEqual([mx.high, mx.medium, mx.low, mx.unrated, mx.total], [2, 1, 1, 2, 6]);
assert.deepEqual([severity(15), severity(14), severity(8), severity(7), severity(1)], ['high', 'medium', 'medium', 'low', 'low']);
const none = riskMatrix([]);
assert.deepEqual([none.high, none.medium, none.low, none.unrated, none.total], [0, 0, 0, 0, 0]); assert.ok(none.cells.every((c) => c.count === 0));

// milestoneSlip: later first, with ± days; a milestone with no date on either side, one added since and one removed have no delta and are left out.
const snap = { tasks: [], milestones: [{ id: 'm1', due_at: '2026-10-10' }, { id: 'm2', due_at: '2026-10-20' }, { id: 'm3', due_at: '2026-10-30' }, { id: 'm4', due_at: null }, { id: 'm5', due_at: '2026-11-01' }], project: { start_at: null, end_at: null } };
const ms = (id: string, name: string, due: string | null, deleted_at: string | null = null) => ({ id, name, due_at: due, deleted_at });
const sl = milestoneSlip(snap, [ms('m1', 'Pilot', '2026-10-14'), ms('m2', 'Wave 2', '2026-10-18'), ms('m3', 'Wave 3', '2026-10-30'), ms('m4', 'Undated', null), ms('m6', 'New one', '2026-12-01')]);
assert.deepEqual(sl.map((x) => [x.name, x.delta]), [['Pilot', 4], ['Wave 2', -2], ['Wave 3', 0]]);
assert.deepEqual(milestoneSlip(snap, []), []);

// Metrics: the numbers the report and the summary carry.
const tasks = [t('1', { due_at: '2026-10-01' }), t('2', { status: 'done', done_at: '2026-11-03T15:00:00Z' }), t('3', { due_at: '2026-12-01' }), t('4', { status: 'done', done_at: '2026-10-01T15:00:00Z' })];
const met = dashboardMetrics({ tasks, raid: [r('1', { probability: 4, impact: 4 }), r('2', { probability: 1, impact: 1 }), r('3', {})], project: { start_at: '2026-10-01', end_at: '2026-12-01' }, today: '2026-11-03', tz: TZ });
assert.deepEqual([met.done_this_week, met.open, met.overdue_now, met.high_risks, met.unrated_risks], [1, 2, 1, 1, 1]);
assert.equal(met.remaining, 2); assert.equal(typeof met.ideal_remaining, 'number');
assert.equal(met.behind_ideal, Math.round(10 * (met.remaining - met.ideal_remaining!)) / 10);
const bare = dashboardMetrics({ tasks: [], raid: [], project: { start_at: null, end_at: null }, today: '2026-11-03', tz: TZ });
assert.deepEqual([bare.done_this_week, bare.open, bare.overdue_now, bare.high_risks, bare.ideal_remaining, bare.behind_ideal], [0, 0, 0, 0, null, null]);
console.log('dashboard: ok');
