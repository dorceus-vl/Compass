// node --experimental-strip-types scripts/time.test.ts
import assert from 'node:assert/strict';
import { clampTs, stopAt, MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS, entryMinutes, formatElapsed, taskLogged, zonedToIso, isoToZoned, manualSpan } from '../shared/time.ts';
import type { Task, TimeEntry } from '../shared/types.ts';

assert.deepEqual([MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS], [5, 1440, 500, 300_000]);
// T3: within [2020-01-01, now + 5 min]; unparseable means now.
const now = Date.parse('2026-10-28T15:00:00.000Z');
assert.equal(clampTs('2019-05-01T00:00:00.000Z', now), '2020-01-01T00:00:00.000Z');
// stopAt (T4, shared by the server's stop and the device's optimistic one, e.g. a widget stop drained hours later at the tap time): clamped, never before the start, at most 24 h.
{
  const n = Date.parse('2026-10-28T15:00:00.000Z');
  assert.equal(stopAt('2026-10-28T08:00:00.000Z', '2026-10-28T10:00:00.000Z', n), '2026-10-28T10:00:00.000Z', 'the tap time, not now');
  assert.equal(stopAt('2026-10-28T08:00:00.000Z', '2026-10-28T07:00:00.000Z', n), '2026-10-28T08:00:00.000Z', 'never before the start');
  assert.equal(stopAt('2026-10-28T08:00:00.000Z', '2026-10-29T08:00:00.000Z', n), '2026-10-28T15:05:00.000Z', 'a future end is clamped');
  assert.equal(stopAt('2026-10-26T08:00:00.000Z', '2026-10-28T10:00:00.000Z', n), '2026-10-27T08:00:00.000Z', 'at most 24 h');
  assert.equal(stopAt('2026-10-28T08:00:00.000Z', undefined, n), '2026-10-28T15:00:00.000Z', 'none: now');
}
assert.equal(clampTs('2026-10-28T16:00:00.000Z', now), '2026-10-28T15:05:00.000Z');
assert.equal(clampTs('2026-10-28T14:00:00.000Z', now), '2026-10-28T14:00:00.000Z');
assert.equal(clampTs('not a date', now), new Date(now).toISOString()); // unparseable → now
assert.equal(clampTs('2026-10-28T14:00:00+01:00', now), '2026-10-28T13:00:00.000Z', 'normalised to UTC ISO');

// Task 1: elapsed minutes (floor), the h:mm text, a task's total with its live subtasks.
assert.equal(entryMinutes({ started_at: '2026-10-28T14:00:00.000Z', ended_at: null }, now), 60, 'running: up to now');
assert.equal(entryMinutes({ started_at: '2026-10-28T14:00:00.000Z', ended_at: '2026-10-28T14:42:30.000Z' }, now), 42, 'finished: floor');
assert.equal(entryMinutes({ started_at: '2026-10-28T14:59:01.000Z', ended_at: null }, now), 0, '59 s is 0');
assert.equal(entryMinutes({ started_at: '2026-10-28T16:00:00.000Z', ended_at: null }, now), 0, 'a start ahead of the clock is never negative');
assert.deepEqual([formatElapsed(7), formatElapsed(102), formatElapsed(1500), formatElapsed(0)], ['0:07', '1:42', '25:00', '0:00']);
const ent = (id: string, task_id: string, s: string, e: string | null, deleted_at: string | null = null) =>
  ({ id, task_id, project_id: null, kind: 'personal', started_at: s, ended_at: e, note: null, source: 'timer', auto_stopped: 0, enc_v: 0, created_at: s, updated_at: s, deleted_at }) as TimeEntry;
const tks = [{ id: 'a', parent_id: null, deleted_at: null }, { id: 'a1', parent_id: 'a', deleted_at: null }, { id: 'a2', parent_id: 'a', deleted_at: '2026-10-27T00:00:00.000Z' }, { id: 'b', parent_id: null, deleted_at: null }];
const es = [
  ent('1', 'a', '2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z'), // 60
  ent('2', 'a1', '2026-10-28T12:00:00.000Z', '2026-10-28T12:30:00.000Z'), // subtask: 30
  ent('3', 'a', '2026-10-28T13:00:00.000Z', '2026-10-28T14:00:00.000Z', '2026-10-28T14:10:00.000Z'), // trashed entry
  ent('4', 'a2', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'), // trashed subtask
  ent('5', 'b', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'), // another task
  ent('6', 'a', '2026-10-28T14:45:00.000Z', null), // running: 15
];
assert.equal(taskLogged(es, 'a', tks, now), 105);
assert.equal(taskLogged(es, 'b', tks, now), 60);
// datetime-local values in settings.tz, both ways (DST included).
assert.equal(zonedToIso('2026-10-28T09:00', 'America/New_York'), '2026-10-28T13:00:00.000Z');
assert.equal(zonedToIso('2026-07-01T09:00', 'America/New_York'), '2026-07-01T13:00:00.000Z', 'EDT');
assert.equal(zonedToIso('2026-12-01T09:00', 'America/New_York'), '2026-12-01T14:00:00.000Z', 'EST');
assert.equal(zonedToIso('2026-10-28T09:00', 'UTC'), '2026-10-28T09:00:00.000Z');
assert.equal(zonedToIso('2026-10-28T09:00', 'Asia/Kolkata'), '2026-10-28T03:30:00.000Z');
assert.equal(zonedToIso('bad', 'UTC'), null);
// manualSpan: today 10:00 with 1h30m ends now; yesterday keeps 09:00; before 09:00 today ends now
{ const now = Date.parse('2026-10-28T14:00:00.000Z'); // 10:00 in New York
  assert.deepEqual(manualSpan('2026-10-28', 90, 'America/New_York', now), { started_at: '2026-10-28T12:30:00.000Z', ended_at: '2026-10-28T14:00:00.000Z' });
  assert.deepEqual(manualSpan('2026-10-27', 90, 'America/New_York', now), { started_at: '2026-10-27T13:00:00.000Z', ended_at: '2026-10-27T14:30:00.000Z' });
  const early = Date.parse('2026-10-28T11:00:00.000Z'); // 07:00 in New York
  assert.deepEqual(manualSpan('2026-10-28', 30, 'America/New_York', early), { started_at: '2026-10-28T10:30:00.000Z', ended_at: '2026-10-28T11:00:00.000Z' });
  assert.equal(manualSpan('bad', 30, 'UTC', now), null); }
assert.equal(isoToZoned('2026-12-01T14:00:00.000Z', 'America/New_York'), '2026-12-01T09:00');
assert.equal(isoToZoned('2026-10-28T03:30:00.000Z', 'Asia/Kolkata'), '2026-10-28T09:00');
assert.equal(isoToZoned('2026-10-28T23:30:00.000Z', 'UTC'), '2026-10-28T23:30');
console.log('time: ok');

// Task 3: reporting.
{
  const { splitByDay, projectMinutes, programMinutes, accuracy, actualWeeks, weekGrid, toCsv } = await import('../shared/time.ts');
  const TZ = 'America/Toronto';
  // 22:30 to 01:30 Toronto (EDT) on 27 Oct: half on each local day; across the 1 Nov DST change 00:30 to 02:30 local is 3 real hours on one day.
  assert.deepEqual(splitByDay({ started_at: '2026-10-28T02:30:00.000Z', ended_at: '2026-10-28T05:30:00.000Z' }, TZ, now), { '2026-10-27': 90, '2026-10-28': 90 });
  assert.deepEqual(splitByDay({ started_at: '2026-11-01T04:30:00.000Z', ended_at: '2026-11-01T07:30:00.000Z' }, TZ, now), { '2026-11-01': 180 });
  assert.deepEqual(splitByDay({ started_at: '2026-10-28T14:00:00.000Z', ended_at: null }, TZ, now), { '2026-10-28': 60 }, 'running: up to now');
  assert.deepEqual(splitByDay({ started_at: '2026-10-28T16:00:00.000Z', ended_at: null }, TZ, now), {}, 'nothing yet');

  const T = '2026-10-01T00:00:00.000Z';
  const task = (id: string, o: Partial<Task> = {}) => ({ id, project_id: null, parent_id: null, title: id, notes: null, kind: 'personal', horizon: 'short', status: 'new', priority: 0, start_at: null, due_at: null, done_at: null,
    estimate_minutes: null, waiting_on: null, waiting_since: null, nudge_every_days: null, recur: null, source_app: 'compass', source_kind: null, source_ref: null, source_url: null, blocked_by: null, checklist: null,
    sort_in_column: 0, tags: '[]', enc_v: 0, created_at: T, updated_at: T, deleted_at: null, ...o }) as Task;
  const e = (id: string, o: Partial<TimeEntry>) => ({ ...ent(id, '', '2026-10-20T13:00:00.000Z', '2026-10-20T14:00:00.000Z'), task_id: null, ...o }) as TimeEntry;
  // projectMinutes: a task entry follows its task's current project; project entries count; trashed tasks and entries don't; range is by local day.
  const pt = [task('moved', { project_id: 'P' }), task('q', { project_id: 'Q' }), task('gone', { project_id: 'P', deleted_at: T })];
  const pe = [
    e('1', { task_id: 'moved' }), // 60 on 20 Oct
    e('2', { project_id: 'P', note: 'planning', started_at: '2026-10-22T13:00:00.000Z', ended_at: '2026-10-22T13:30:00.000Z' }), // 30 on 22 Oct
    e('3', { task_id: 'q' }), e('4', { task_id: 'gone' }), e('5', { task_id: 'moved', deleted_at: T }), e('6', { task_id: 'missing' }),
  ];
  assert.equal(projectMinutes(pe, pt, 'P', now), 90);
  assert.equal(projectMinutes(pe, pt, 'Q', now), 60);
  assert.equal(projectMinutes(pe, pt, 'P', now, { from: '2026-10-21', to: '2026-10-25', tz: TZ }), 30, 'range');
  assert.equal(programMinutes(pe, pt, ['P', 'Q'], now), 150);
  assert.equal(programMinutes(pe, pt, [], now), 0);

  // accuracy: done top-level tasks with an estimate and some time; under 3 is not enough.
  const at = (id: string, est: number | null, status: Task['status'] = 'done') => task(id, { estimate_minutes: est, status, project_id: 'P' });
  const ae = (id: string, tid: string, min: number) => e(id, { task_id: tid, ended_at: new Date(Date.parse('2026-10-20T13:00:00.000Z') + min * 60_000).toISOString() });
  const two = accuracy([ae('a', 'd1', 130), ae('b', 'd2', 130)], [at('d1', 100), at('d2', 100)], null, now);
  assert.deepEqual([two.tasks, two.ratio, two.label], [2, null, 'Not enough done tasks with estimates yet']);
  const atasks = [at('d1', 100), at('d2', 100), at('d3', 100), at('noest', null), at('notime', 100), at('open', 100, 'progress')];
  const aent = [ae('a', 'd1', 130), ae('b', 'd2', 130), ae('c', 'd3', 130), ae('d', 'noest', 500), ae('f', 'open', 500)];
  const acc = accuracy(aent, atasks, null, now);
  assert.deepEqual([acc.tasks, acc.logged, acc.estimated, acc.ratio, acc.label], [3, 390, 300, 1.3, 'You run 30% over']);
  assert.equal(accuracy(aent, atasks, ['Q'], now).label, 'Not enough done tasks with estimates yet', 'project filter');
  assert.equal(accuracy([ae('a', 'd1', 90), ae('b', 'd2', 90), ae('c', 'd3', 90)], atasks, ['P'], now).label, 'You run 10% under');
  assert.equal(accuracy([ae('a', 'd1', 102), ae('b', 'd2', 100), ae('c', 'd3', 100)], atasks, null, now).label, 'Right on your estimates');

  // actualWeeks (T9): the 4 Monday weeks before today's week, whole capacity (no pro-rating), overrides, project filter.
  const wl = { work_hours: 40, personal_hours: 8, day_hours: 8, default_estimate_minutes: 60, overrides: { '2026-10-12': { work: 20, personal: 4 } } };
  const wt = [task('w', { project_id: 'P', kind: 'work' }), task('h')];
  const we = [
    e('w1', { task_id: 'w', kind: 'work', started_at: '2026-10-20T13:00:00.000Z', ended_at: '2026-10-20T15:00:00.000Z' }), // 2h work, week of 19 Oct
    e('h1', { task_id: 'h', started_at: '2026-10-06T13:00:00.000Z', ended_at: '2026-10-06T14:00:00.000Z' }), // 1h personal, week of 5 Oct
    e('h2', { task_id: 'h', started_at: '2026-10-26T13:00:00.000Z', ended_at: '2026-10-26T14:00:00.000Z' }), // this week: not actual
    e('h3', { task_id: 'h', started_at: '2026-09-20T13:00:00.000Z', ended_at: '2026-09-20T14:00:00.000Z' }), // too old
    e('p1', { project_id: 'P', kind: 'work', note: 'x', started_at: '2026-10-21T13:00:00.000Z', ended_at: '2026-10-21T13:45:00.000Z' }), // project entry 45m
  ];
  const aw = actualWeeks(we, wt, wl, '2026-10-28', TZ);
  assert.deepEqual(aw.map((x) => x.start), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  assert.deepEqual(aw.map((x) => x.capacity), [{ work: 2400, personal: 480 }, { work: 2400, personal: 480 }, { work: 1200, personal: 240 }, { work: 2400, personal: 480 }]);
  assert.deepEqual(aw.map((x) => [x.minutes.work, x.minutes.personal]), [[0, 0], [0, 60], [0, 0], [165, 0]]);
  assert.deepEqual(aw[3].work.map((x) => [x.task_id, x.project_id, x.minutes]).sort(), [['', 'P', 45], ['w', 'P', 120]]);
  const awf = actualWeeks(we, wt, wl, '2026-10-28', TZ, 4, { project_ids: ['P'] });
  assert.deepEqual(awf.map((x) => [x.minutes.work, x.minutes.personal]), [[0, 0], [0, 0], [0, 0], [165, 0]]);
  assert.equal(actualWeeks(we, wt, wl, '2026-10-28', TZ, 2).length, 2);

  // weekGrid: Monday first, "No project" row for unfiled tasks, totals; the Monday after the week is left out.
  const g = weekGrid([
    e('g1', { task_id: 'w', started_at: '2026-10-19T13:00:00.000Z', ended_at: '2026-10-19T14:00:00.000Z' }), // Mon, P, 60
    e('g2', { task_id: 'h', started_at: '2026-10-26T03:30:00.000Z', ended_at: '2026-10-26T04:30:00.000Z' }), // Sun 23:30 to Mon 00:30 Toronto: 30 on Sunday
    e('g3', { project_id: 'P', note: 'x', started_at: '2026-10-21T13:00:00.000Z', ended_at: '2026-10-21T13:15:00.000Z' }), // Wed, P, 15
  ], wt, '2026-10-19', TZ, now);
  assert.deepEqual(g.rows.find((r) => r.project_id === 'P'), { project_id: 'P', days: [60, 0, 15, 0, 0, 0, 0], total: 75 });
  assert.deepEqual(g.rows.find((r) => r.project_id === null), { project_id: null, days: [0, 0, 0, 0, 0, 0, 30], total: 30 });
  assert.deepEqual([g.dayTotals, g.total], [[60, 0, 15, 0, 0, 0, 30], 105]);

  // toCsv: header, RFC 4180 quoting, minutes, local times, a running entry has no end.
  const csv = toCsv([
    e('c2', { task_id: 'w', started_at: '2026-10-20T13:00:00.000Z', ended_at: '2026-10-20T14:30:00.000Z', note: 'Call, "vendor"\nand notes' }),
    e('c1', { project_id: 'P', started_at: '2026-10-19T12:00:00.000Z', ended_at: '2026-10-19T12:20:00.000Z', note: '=SUM(A1)' }),
    e('c3', { task_id: 'h', started_at: '2026-10-28T14:30:00.000Z', ended_at: null }),
    e('c4', { task_id: 'gone', started_at: '2026-10-21T14:30:00.000Z' }),
  ], { task: (id) => ({ w: 'Write plan', h: 'Home' } as Record<string, string>)[id] ?? 'Task', project: (id) => (id === 'P' ? 'Proj, One' : 'No project') }, [...wt, ...pt], TZ, now);
  assert.equal(csv, [
    'Date,Start,End,Minutes,Kind,Project,Task,Note,Source',
    `2026-10-19,08:00,08:20,20,personal,"Proj, One",,'=SUM(A1),timer`,
    '2026-10-20,09:00,10:30,90,personal,"Proj, One",Write plan,"Call, ""vendor""\nand notes",timer',
    '2026-10-28,10:30,,30,personal,No project,Home,,timer',
  ].join('\r\n'));

  // One trash rule (fix round 1): a project in Trash takes its own entries and its tasks' entries out of every total, the grid, Actual weeks and the CSV.
  const { entryProject, goneProjects } = await import('../shared/time.ts');
  const gone = goneProjects([{ id: 'P', deleted_at: T }, { id: 'Q', deleted_at: null }]);
  const byId = new Map(wt.map((t) => [t.id, t]));
  assert.equal(entryProject(e('x', { task_id: 'w' }), byId, gone), undefined, 'a task in a trashed project counts nowhere');
  assert.equal(entryProject(e('x', { project_id: 'P', note: 'x' }), byId, gone), undefined, 'a trashed project\'s own entry counts nowhere');
  assert.equal(entryProject(e('x', { task_id: 'h' }), byId, gone), null, 'an unfiled task still counts under No project');
  assert.equal(entryProject(e('x', { task_id: 'w' }), byId), 'P', 'without the set it counts');
  assert.equal(weekGrid(we, wt, '2026-10-19', TZ, now, gone).total, 0);
  assert.deepEqual(actualWeeks(we, wt, wl, '2026-10-28', TZ, 4, undefined, gone).map((x) => x.minutes.work), [0, 0, 0, 0]);
  assert.equal(toCsv(we, { task: () => 't', project: () => 'p' }, wt, TZ, now, gone).split('\r\n').length, 4, 'header and the three unfiled entries');
  assert.equal(projectMinutes(pe, pt, 'P', now, undefined, gone), 0);
  assert.equal(programMinutes(pe, pt, ['P', 'Q'], now, gone), 60);

  // splitByDay where local midnight doesn't exist (Santiago springs forward at 00:00 on 6 Sep 2026): 23:30 to 02:30 local is 30 + 90.
  assert.deepEqual(splitByDay({ started_at: '2026-09-06T03:30:00.000Z', ended_at: '2026-09-06T05:30:00.000Z' }, 'America/Santiago', now), { '2026-09-05': 30, '2026-09-06': 90 });
  console.log('time reporting: ok');
}
