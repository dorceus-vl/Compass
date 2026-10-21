// node --experimental-strip-types scripts/baseline.test.ts
import assert from 'node:assert/strict';
import { slip, buildSnapshot, parseSnapshot, MAX_BASELINE_TASKS, MAX_BASELINE_MILESTONES, MAX_BASELINES, type Snapshot } from '../shared/baseline.ts';

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ tasks: [], milestones: [], project: { start_at: null, end_at: null }, ...o });
const t = (id: string, start_at: string | null, due_at: string | null) => ({ id, start_at, due_at });
const m = (id: string, due_at: string | null) => ({ id, due_at });
const row = (r: ReturnType<typeof slip>, id: string) => r.rows.find((x) => x.id === id)!;

// later, earlier, unchanged: a positive delta means later
const base = snap({ tasks: [t('a', '2026-03-01', '2026-03-10'), t('b', null, '2026-03-20'), t('c', null, '2026-04-01')], milestones: [m('m1', '2026-04-30'), m('m2', '2026-05-31')] });
const r = slip(base, [t('a', '2026-03-03', '2026-03-14'), t('b', null, '2026-03-18'), t('c', null, '2026-04-01')], [m('m1', '2026-05-05'), m('m2', '2026-05-31')]);
assert.equal(row(r, 'a').due_delta, 4);
assert.equal(row(r, 'a').start_delta, 2);
assert.equal(row(r, 'a').flag, null);
assert.equal(row(r, 'b').due_delta, -2);
assert.equal(row(r, 'b').start_delta, null, 'no start on either side: no start delta');
assert.equal(row(r, 'c').due_delta, 0);
assert.equal(row(r, 'm1').due_delta, 5);
assert.equal(row(r, 'm1').kind, 'milestone');
assert.equal(row(r, 'a').kind, 'task');
assert.deepEqual([row(r, 'a').baseline_due, row(r, 'a').current_due], ['2026-03-10', '2026-03-14']);
// month and year ends, leap day: calendar days, no time zone drift
assert.equal(row(slip(snap({ tasks: [t('x', null, '2027-12-30')] }), [t('x', null, '2028-03-01')], []), 'x').due_delta, 62);

// summary maths: late = delta > 0; average and maximum over the late ones (1 decimal); milestones late counted apart
assert.deepEqual(r.summary, { compared: 5, late: 2, early: 1, unchanged: 2, added: 0, dropped: 0, avg_late: 4.5, max_late: 5, milestones_late: 1, project_start_delta: null, project_end_delta: null });
const odd = slip(snap({ tasks: [t('a', null, '2026-01-01'), t('b', null, '2026-01-01'), t('c', null, '2026-01-01')] }), [t('a', null, '2026-01-02'), t('b', null, '2026-01-02'), t('c', null, '2026-01-03')], []);
assert.equal(odd.summary.avg_late, 1.3, 'rounded to one decimal');
assert.equal(odd.summary.max_late, 2);
const none = slip(base, [t('a', '2026-03-01', '2026-03-10'), t('b', null, '2026-03-20'), t('c', null, '2026-04-01')], [m('m1', '2026-04-30'), m('m2', '2026-05-31')]);
assert.equal(none.summary.late, 0); assert.equal(none.summary.avg_late, 0); assert.equal(none.summary.max_late, 0); assert.equal(none.summary.unchanged, 5);
assert.equal(slip(snap(), [], []).summary.compared, 0, 'an empty baseline');

// new and dropped: added since the baseline, or removed / trashed since
const nd = slip(snap({ tasks: [t('a', null, '2026-03-10'), t('gone', null, '2026-03-11'), t('trashed', null, '2026-03-12')], milestones: [m('mgone', '2026-04-01')] }),
  [t('a', null, '2026-03-10'), t('fresh', null, '2026-03-30'), { ...t('trashed', null, '2026-03-12'), deleted_at: '2026-03-02T00:00:00.000Z' }], [m('mnew', '2026-06-01')]);
assert.equal(row(nd, 'fresh').flag, 'new'); assert.equal(row(nd, 'fresh').baseline_due, null); assert.equal(row(nd, 'fresh').current_due, '2026-03-30'); assert.equal(row(nd, 'fresh').due_delta, null);
assert.equal(row(nd, 'gone').flag, 'dropped'); assert.equal(row(nd, 'gone').current_due, null); assert.equal(row(nd, 'gone').baseline_due, '2026-03-11');
assert.equal(row(nd, 'trashed').flag, 'dropped', 'a trashed item counts as dropped');
assert.equal(row(nd, 'mgone').flag, 'dropped'); assert.equal(row(nd, 'mnew').flag, 'new');
assert.equal(nd.summary.added, 2); assert.equal(nd.summary.dropped, 3);
assert.equal(nd.summary.compared, 1, 'only an item with two dates has a delta');

// missing dates: a date gained or lost is flagged, no delta; an item with no date at all is skipped; an undated new/dropped item is skipped
const md = slip(snap({ tasks: [t('gain', null, null), t('lose', '2026-02-01', '2026-02-09'), t('nothing', null, null), t('dropnothing', null, null)] }),
  [t('gain', null, '2026-05-05'), t('lose', null, null), t('nothing', null, null), t('newnothing', null, null)], []);
assert.equal(row(md, 'gain').flag, 'dated'); assert.equal(row(md, 'gain').due_delta, null);
assert.equal(row(md, 'lose').flag, 'undated'); assert.equal(row(md, 'lose').due_delta, null); assert.equal(row(md, 'lose').baseline_start, '2026-02-01');
assert.ok(!md.rows.some((x) => ['nothing', 'dropnothing', 'newnothing'].includes(x.id)), 'items with no date on either side are skipped');
// only a start date: the start delta stands in for the due delta
const so = slip(snap({ tasks: [t('s', '2026-01-10', null)] }), [t('s', '2026-01-13', null)], []);
assert.equal(so.summary.late, 1); assert.equal(so.summary.max_late, 3); assert.equal(row(so, 's').start_delta, 3);

// project dates
const pd = slip(snap({ project: { start_at: '2026-01-01', end_at: '2026-06-30' } }), [], [], { start_at: '2026-01-01', end_at: '2026-07-14' });
assert.equal(pd.summary.project_end_delta, 14); assert.equal(pd.summary.project_start_delta, 0);
assert.equal(slip(snap({ project: { start_at: null, end_at: '2026-06-30' } }), [], [], { start_at: null, end_at: null }).summary.project_end_delta, null);

// order: biggest move first (later before earlier on a tie), then flagged items, then unchanged
const ord = slip(snap({ tasks: [t('u', null, '2026-01-01'), t('e3', null, '2026-01-10'), t('l1', null, '2026-01-01'), t('l3', null, '2026-01-10'), t('d', null, '2026-01-01')] }),
  [t('u', null, '2026-01-01'), t('e3', null, '2026-01-07'), t('l1', null, '2026-01-02'), t('l3', null, '2026-01-13'), t('n', null, '2026-02-01')], []);
assert.deepEqual(ord.rows.map((x) => x.id), ['l3', 'e3', 'l1', 'd', 'n', 'u']);

// snapshot: built from rows (ids and dates only), parsed back
const built = buildSnapshot({ start_at: '2026-01-01', end_at: null }, [{ id: 'a', start_at: '2026-01-02', due_at: null, title: 'secret', status: 'new' }], [{ id: 'm', due_at: '2026-02-02', name: 'secret too' }]);
assert.deepEqual(built, { tasks: [{ id: 'a', start_at: '2026-01-02', due_at: null }], milestones: [{ id: 'm', due_at: '2026-02-02' }], project: { start_at: '2026-01-01', end_at: null } });
assert.ok(!JSON.stringify(built).includes('secret'), 'no titles');
assert.deepEqual(parseSnapshot(JSON.stringify(built)), built, 'JSON text parses');
assert.deepEqual(parseSnapshot(built), built, 'an object parses');

// validation and caps
assert.equal(parseSnapshot('not json'), null);
assert.equal(parseSnapshot(null), null);
assert.equal(parseSnapshot({ ...built, tasks: 'x' }), null);
assert.equal(parseSnapshot({ ...built, project: null }), null);
assert.equal(parseSnapshot({ ...built, tasks: [{ id: '', start_at: null, due_at: null }] }), null, 'empty id');
assert.equal(parseSnapshot({ ...built, tasks: [{ id: 'a', start_at: null, due_at: '2026-02-30' }] }), null, 'not a date');
assert.equal(parseSnapshot({ ...built, tasks: [{ id: 'a', start_at: null, due_at: 5 }] }), null);
assert.equal(parseSnapshot({ ...built, tasks: [{ id: 'a', start_at: null, due_at: null }, { id: 'a', start_at: null, due_at: null }] }), null, 'duplicate id');
assert.equal(parseSnapshot({ ...built, milestones: [{ id: 'm', due_at: 'soon' }] }), null);
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, start_at: null, due_at: '2026-01-01' }));
assert.ok(parseSnapshot({ ...built, tasks: many(MAX_BASELINE_TASKS) }), '1,000 tasks fit');
assert.equal(parseSnapshot({ ...built, tasks: many(MAX_BASELINE_TASKS + 1) }), null, '1,001 do not');
const ms = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, due_at: null }));
assert.ok(parseSnapshot({ ...built, milestones: ms(MAX_BASELINE_MILESTONES) }));
assert.equal(parseSnapshot({ ...built, milestones: ms(MAX_BASELINE_MILESTONES + 1) }), null);
assert.deepEqual([MAX_BASELINE_TASKS, MAX_BASELINE_MILESTONES, MAX_BASELINES], [1000, 200, 20]);
// unknown keys are dropped, never stored
assert.deepEqual(parseSnapshot({ ...built, extra: 1, tasks: [{ id: 'a', start_at: null, due_at: null, title: 'leak' }] })!.tasks, [{ id: 'a', start_at: null, due_at: null }]);

console.log('baseline.test.ts ok');
