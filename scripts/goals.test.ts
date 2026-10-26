// node --experimental-strip-types scripts/goals.test.ts
import assert from 'node:assert/strict';
import { quarterRange, currentQuarter, krProgress, goalProgress, expected, isBehind, confidence, trend, staleKrs } from '../shared/goals.ts';
import type { Goal, KeyResult, GoalLink, GoalCheckin, Task } from '../shared/types.ts';

const T = '2026-10-01T00:00:00.000Z';
const goal = (id: string, over: Partial<Goal> = {}): Goal => ({ id, kind: 'personal', title: id, description: null, starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'active', sort: 0, enc_v: 0, created_at: T, updated_at: T, deleted_at: null, ...over });
const kr = (id: string, over: Partial<KeyResult> = {}): KeyResult => ({ id, goal_id: 'g1', title: id, type: 'number', start_value: 0, target_value: 10, current_value: 0, unit: null, sort: 0, enc_v: 0, created_at: T, updated_at: T, deleted_at: null, ...over });
const link = (id: string, over: Partial<GoalLink>): GoalLink => ({ id, kr_id: 'kt', task_id: null, project_id: null, created_at: T, updated_at: T, deleted_at: null, ...over });
const task = (id: string, over: Partial<Task> = {}) => ({ id, project_id: null, status: 'new', deleted_at: null, ...over }) as Task;
const ci = (id: string, at: string, over: Partial<GoalCheckin> = {}): GoalCheckin => ({ id, kr_id: 'k1', value: 1, confidence: 'on_track', note: null, at, enc_v: 0, created_at: at, updated_at: at, deleted_at: null, ...over });
const none = { links: [], tasks: [] };

assert.deepEqual(quarterRange(2026, 4), { starts_on: '2026-10-01', ends_on: '2026-12-31' });
assert.deepEqual(quarterRange(2027, 1), { starts_on: '2027-01-01', ends_on: '2027-03-31' });
assert.deepEqual(quarterRange(2028, 1).ends_on, '2028-03-31');
assert.deepEqual(quarterRange(2026, 2), { starts_on: '2026-04-01', ends_on: '2026-06-30' });
assert.deepEqual(currentQuarter('2026-11-15'), { year: 2026, q: 4 });
assert.deepEqual(currentQuarter('2027-03-31'), { year: 2027, q: 1 });

// number, decreasing, clamped; percent; done
assert.equal(krProgress(kr('a', { current_value: 4 }), none), 0.4);
assert.equal(krProgress(kr('a', { start_value: 10, target_value: 0, current_value: 4 }), none), 0.6);
assert.equal(krProgress(kr('a', { current_value: 14 }), none), 1);
assert.equal(krProgress(kr('a', { current_value: -3 }), none), 0);
assert.equal(krProgress(kr('a', { type: 'percent', start_value: 0, target_value: 100, current_value: 55 }), none), 0.55);
assert.equal(krProgress(kr('a', { type: 'done', start_value: 0, target_value: 1, current_value: 1 }), none), 1);

// tasks: a project link (2 live tasks, 1 done) plus a direct link to its done task → 1 of 2, not 2 of 3
const kt = kr('kt', { type: 'tasks', start_value: null, target_value: null, current_value: null });
const tasks = [task('t1', { project_id: 'p1', status: 'done' }), task('t2', { project_id: 'p1' }), task('t3', { status: 'done' }), task('t4', { project_id: 'p1', deleted_at: T })];
const links = [link('l1', { project_id: 'p1' }), link('l2', { task_id: 't1' })];
assert.equal(krProgress(kt, { links, tasks }), 0.5);
// a trashed link doesn't count; a trashed task doesn't count (t4 above)
assert.equal(krProgress(kt, { links: [...links, link('l3', { task_id: 't3', deleted_at: T })], tasks }), 0.5);
assert.equal(krProgress(kt, { links: [...links, link('l3', { task_id: 't3' })], tasks }), 2 / 3);
assert.equal(krProgress(kt, none), 0, 'no tasks yet');

// goal: mean of live key results of that goal only
const krs = [kr('a', { current_value: 4 }), kr('b', { type: 'done', start_value: 0, target_value: 1, current_value: 1 }), kr('c', { current_value: 10, deleted_at: T }), kr('d', { goal_id: 'g2', current_value: 10 })];
assert.equal(goalProgress(goal('g1'), krs, none), 0.7);
assert.equal(goalProgress(goal('g3'), krs, none), 0);

// expected: Q4 is 91 days from start to end
const q4 = goal('g1');
assert.equal(Math.round(expected(q4, '2026-11-15') * 91), 45);
assert.equal(expected(q4, '2026-09-01'), 0);
assert.equal(expected(q4, '2027-02-01'), 1);
assert.equal(expected(goal('g1', { starts_on: '2026-10-05', ends_on: '2026-10-05' }), '2026-10-05'), 1, 'a one-day goal is due on its day');
assert.equal(isBehind(0.3, 0.6), true); assert.equal(isBehind(0.55, 0.6), false);

// confidence and trend: latest by `at`, trashed skipped, null values left out of the line
const cs = [ci('c2', '2026-10-20T10:00:00.000Z', { confidence: 'at_risk', value: 3 }), ci('c1', '2026-10-10T10:00:00.000Z', { value: 1 }),
  ci('c3', '2026-10-25T10:00:00.000Z', { confidence: 'off_track', deleted_at: T }), ci('c4', '2026-10-22T10:00:00.000Z', { kr_id: 'kt', value: null })];
assert.equal(confidence('k1', cs), 'at_risk');
assert.equal(confidence('nope', cs), null);
assert.deepEqual(trend('k1', cs), [{ at: '2026-10-10T10:00:00.000Z', value: 1 }, { at: '2026-10-20T10:00:00.000Z', value: 3 }]);
assert.deepEqual(trend('kt', cs), []);

// stale: active goals only; a check-in within 7 days keeps a key result off the list
const gs = [goal('g1'), goal('g2', { status: 'achieved' }), goal('g4', { deleted_at: T })];
const sk = [kr('k1'), kr('k2'), kr('k3', { goal_id: 'g2' }), kr('k4', { goal_id: 'g4' })];
assert.deepEqual(staleKrs(gs, sk, cs, '2026-10-25', 'UTC').map((k) => k.id), ['k2'], 'k1 checked in on Oct 20');
assert.deepEqual(staleKrs(gs, sk, cs, '2026-10-28', 'UTC').map((k) => k.id), ['k1', 'k2'], 'eight days after Oct 20');
console.log('goals: ok');
