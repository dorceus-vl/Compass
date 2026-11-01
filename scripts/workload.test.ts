import assert from 'node:assert/strict';
import { parseEstimate, formatEstimate, MAX_ESTIMATE_MINUTES, workload, type WTask } from '../shared/workload.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

assert.equal(parseEstimate('90', 8), 90);
assert.equal(parseEstimate('1h/2h/6h', 8), 150); // PERT (60+4*120+360)/6
assert.equal(parseEstimate('2h/1h/6h', 8), null); // out of order
assert.equal(parseEstimate('1h/2h', 8), null);

assert.equal(parseEstimate('30m', 8), 30);
assert.equal(parseEstimate('2h', 8), 120);
assert.equal(parseEstimate('1.5h', 8), 90);
assert.equal(parseEstimate('1h 30m', 8), 90);
assert.equal(parseEstimate('1d', 8), 480);
assert.equal(parseEstimate('1.5D', 6), 540);
assert.equal(parseEstimate('', 8), null);
assert.equal(parseEstimate('abc', 8), null);
assert.equal(parseEstimate('-2h', 8), null);
assert.equal(parseEstimate('41d', 8), null, 'over 40 days of day_hours');
assert.equal(parseEstimate('40d', 8), 19_200);
assert.equal(formatEstimate(90), '1h 30m');
assert.equal(formatEstimate(45), '45m');
assert.equal(formatEstimate(120), '2h');
assert.equal(formatEstimate(0), '0m');
assert.equal(MAX_ESTIMATE_MINUTES, 57_600);

// workload() (P5). Today is Wednesday 2026-10-28 in Toronto; the clocks go back on Sunday 2026-11-01.
const TZ = 'America/Toronto', TODAY = '2026-10-28';
const S = DEFAULT_SETTINGS.workload;
assert.deepEqual(S, { work_hours: 40, personal_hours: 8, day_hours: 8, default_estimate_minutes: 60, overrides: {} });
const t = (id: string, o: Partial<WTask> = {}): WTask => ({ id, parent_id: null, project_id: null, kind: 'work', status: 'new', title: id, start_at: null, due_at: null, estimate_minutes: 60, deleted_at: null, ...o });
const run = (tasks: WTask[], s = S, weeks = 12, filter?: { project_ids: string[] }) => workload(tasks, s, TODAY, TZ, weeks, filter);
const daysOf = (w: ReturnType<typeof run>, id: string) => w.weeks.flatMap((wk) => [...wk.work, ...wk.personal].filter((e) => e.task_id === id).map((e) => [wk.start, e.minutes]));

// 12 weeks from the Monday of today.
{
  const w = run([]);
  assert.equal(w.weeks.length, 12);
  assert.equal(w.weeks[0].start, '2026-10-26');
  assert.equal(w.weeks[11].start, '2027-01-11');
  assert.equal(run([], S, 4).weeks.length, 4);
}
// A 10 h task Mon 10-26 to Fri 10-30: Mon and Tue are past, so 600 min over Wed, Thu, Fri, all in the week of 10-26.
{
  const w = run([t('a', { estimate_minutes: 600, start_at: '2026-10-26T13:00:00.000Z', due_at: '2026-10-30T21:00:00.000Z' })]);
  assert.deepEqual(daysOf(w, 'a'), [['2026-10-26', 600]]);
  assert.equal(w.weeks[0].minutes.work, 600);
  assert.deepEqual(w.weeks[0].work[0], { task_id: 'a', project_id: null, minutes: 600, estimated: true, overdue: false });
}
// 4 h from Fri 10-30 to Tue 11-03 across the DST change: Fri, Mon, Tue get 80 min each, so 80 in one week and 160 in the next.
// The start is late Friday evening in Toronto (already Saturday in UTC): it is read in the user's zone.
{
  const w = run([t('b', { estimate_minutes: 240, start_at: '2026-10-31T03:00:00.000Z', due_at: '2026-11-03T22:00:00.000Z' })]);
  assert.deepEqual(daysOf(w, 'b'), [['2026-10-26', 80], ['2026-11-02', 160]]);
}
// Due only, on Saturday 10-31: it stays on that Saturday.
{
  const w = run([t('c', { due_at: '2026-10-31' })]);
  assert.deepEqual(daysOf(w, 'c'), [['2026-10-26', 60]]);
}
// Start Sat 10-31, due Sun 11-01: no weekday in the range, so all of it on Sunday (the week of 10-26).
{
  const w = run([t('d', { estimate_minutes: 120, start_at: '2026-10-31', due_at: '2026-11-01' })]);
  assert.deepEqual(daysOf(w, 'd'), [['2026-10-26', 120]]);
}
// Overdue (due 10-20, with or without a start): today, flagged.
{
  const w = run([t('e', { due_at: '2026-10-20' }), t('e2', { start_at: '2026-10-01', due_at: '2026-10-20' })]);
  assert.deepEqual(daysOf(w, 'e'), [['2026-10-26', 60]]);
  assert.equal(w.weeks[0].work.find((x) => x.task_id === 'e')!.overdue, true);
  assert.equal(w.weeks[0].work.find((x) => x.task_id === 'e2')!.overdue, true);
}
// Start only, or no dates: unscheduled, with its kind.
{
  const w = run([t('f', { start_at: '2026-10-29' }), t('g', { kind: 'personal', estimate_minutes: 30 })]);
  assert.deepEqual(daysOf(w, 'f'), []);
  assert.deepEqual(w.unscheduled, [
    { task_id: 'f', project_id: null, minutes: 60, estimated: true, overdue: false, kind: 'work' },
    { task_id: 'g', project_id: null, minutes: 30, estimated: true, overdue: false, kind: 'personal' },
  ]);
}
// No estimate: the default, listed in not_estimated (placed or unscheduled).
{
  const s = { ...S, default_estimate_minutes: 90 };
  const w = run([t('h', { estimate_minutes: null, due_at: '2026-10-29' }), t('i', { estimate_minutes: null }), t('j', { due_at: '2026-10-29' })], s);
  assert.deepEqual(daysOf(w, 'h'), [['2026-10-26', 90]]);
  assert.equal(w.weeks[0].work.find((x) => x.task_id === 'h')!.estimated, false);
  assert.equal(w.unscheduled[0].minutes, 90);
  assert.deepEqual(w.not_estimated, ['h', 'i']);
}
// On hold, done and trashed tasks are absent.
{
  const w = run([t('k', { status: 'hold', due_at: '2026-10-29' }), t('l', { status: 'done', due_at: '2026-10-29' }), t('m', { deleted_at: '2026-10-27T00:00:00Z', due_at: '2026-10-29' }), t('n', { status: 'hold' })]);
  assert.equal(w.weeks[0].minutes.work, 0);
  assert.deepEqual(w.unscheduled, []);
}
// Leaf rule: a parent with an open subtask doesn't count (the subtask does); with only done (or trashed) subtasks the parent counts.
{
  const w = run([t('p', { due_at: '2026-10-29' }), t('p1', { parent_id: 'p', due_at: '2026-10-29', estimate_minutes: 30 }), t('p2', { parent_id: 'p', status: 'done', due_at: '2026-10-29' })]);
  assert.deepEqual(w.weeks[0].work.map((x) => x.task_id), ['p1']);
  const w2 = run([t('q', { due_at: '2026-10-29' }), t('q1', { parent_id: 'q', status: 'done' }), t('q2', { parent_id: 'q', deleted_at: '2026-10-27T00:00:00Z' })]);
  assert.deepEqual(w2.weeks[0].work.map((x) => x.task_id), ['q']);
}
// Capacity in minutes: the current week is cut to the weekdays left (Wed, Thu, Fri = 3/5); an override replaces a week; over = minutes beyond.
{
  const s = { ...S, overrides: { '2026-11-02': { work: 10, personal: 0 } } };
  const w = run([t('r', { estimate_minutes: 1500, due_at: '2026-10-30' }), t('s', { estimate_minutes: 720, due_at: '2026-11-04' }), t('u', { kind: 'personal', estimate_minutes: 60, due_at: '2026-11-04' })], s);
  assert.deepEqual(w.weeks[0].capacity, { work: 40 * 60 * 3 / 5, personal: 8 * 60 * 3 / 5 });
  assert.deepEqual(w.weeks[0].over, { work: 1500 - 1440, personal: 0 });
  assert.deepEqual(w.weeks[1].capacity, { work: 600, personal: 0 });
  assert.deepEqual(w.weeks[1].over, { work: 120, personal: 60 });
  assert.deepEqual(w.weeks[2].capacity, { work: 2400, personal: 480 });
  assert.deepEqual(w.weeks[2].over, { work: 0, personal: 0 });
  // An override on the current week is cut to the weekdays left too (3/5 on a Wednesday).
  const cw = run([], { ...S, overrides: { '2026-10-26': { work: 20, personal: 5 } } });
  assert.deepEqual(cw.weeks[0].capacity, { work: 20 * 60 * 3 / 5, personal: 5 * 60 * 3 / 5 });
  // On a weekend nothing is left of the current week.
  const sat = workload([t('v', { due_at: '2026-10-31' })], S, '2026-10-31', TZ);
  assert.deepEqual(sat.weeks[0].capacity, { work: 0, personal: 0 });
  assert.equal(sat.weeks[0].over.work, 60);
}
// Filter by project: only those projects; unfiled tasks are out.
{
  const w = run([t('x', { project_id: 'P1', due_at: '2026-10-29' }), t('y', { project_id: 'P2', due_at: '2026-10-29' }), t('z', { due_at: '2026-10-29' }), t('z2', { project_id: 'P1' })], S, 12, { project_ids: ['P1'] });
  assert.deepEqual(w.weeks[0].work.map((x) => x.task_id), ['x']);
  assert.deepEqual(w.unscheduled.map((x) => x.task_id), ['z2']);
}
// A task beyond the 12 weeks is left out (not unscheduled, not in not_estimated).
{
  const w = run([t('far', { estimate_minutes: null, due_at: '2027-03-01' })]);
  assert.deepEqual(daysOf(w, 'far'), []);
  assert.deepEqual(w.unscheduled, []);
  assert.deepEqual(w.not_estimated, []);
}
// An uneven split keeps whole minutes and the total.
{
  const w = run([t('odd', { estimate_minutes: 100, start_at: '2026-10-28', due_at: '2026-10-30' })]);
  assert.equal(w.weeks[0].minutes.work, 100);
}
console.log('workload: ok');
