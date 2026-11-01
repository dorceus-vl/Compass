// node --experimental-strip-types scripts/sprints.test.ts
import assert from 'node:assert/strict';
import { parseSprints, startSprint, closeSprint, velocity, burndown, type Sprint } from '../shared/sprints.ts';

const s = (id: string, state: Sprint['state'], start = '2026-11-02', end = '2026-11-06'): Sprint => ({ id, name: id.toUpperCase(), goal: '', start, end, state });

assert.deepEqual(parseSprints(null), []);
const ok = [s('a', 'closed'), s('b', 'active'), s('c', 'planned')];
assert.deepEqual(parseSprints(JSON.stringify(ok)), ok, 'round trip');
assert.equal(parseSprints([s('a', 'active'), s('b', 'active')]), null, 'one active only');
assert.equal(parseSprints([s('a', 'planned'), s('a', 'planned')]), null, 'repeated id');
assert.equal(parseSprints([s('a', 'planned', '2026-11-06', '2026-11-02')]), null, 'end before start');
assert.equal(parseSprints([s('a', 'planned', '2026-02-30', '2026-03-02')]), null, 'not a real date');
assert.equal(parseSprints([{ ...s('a', 'planned'), name: ' ' }]), null, 'blank name');
assert.equal(parseSprints([{ ...s('a', 'planned'), state: 'x' }]), null, 'unknown state');
assert.equal(parseSprints([s('a', 'planned', '2026-01-01', '2027-01-03')]), null, 'over 366 days');
assert.equal(parseSprints('{bad'), null);

assert.equal(startSprint(ok, 'c'), null, 'another is active');
assert.equal(startSprint([s('a', 'closed')], 'a'), null, 'not planned');
assert.equal(startSprint([s('c', 'planned')], 'c')![0].state, 'active');
assert.equal(closeSprint(ok, 'c', 1, 1), null, 'only an active sprint closes');
const closed = closeSprint(ok, 'b', 5, 3)!;
assert.deepEqual([closed[1].state, closed[1].total, closed[1].done], ['closed', 5, 3]);

assert.deepEqual(velocity([s('c', 'planned')]), { points: [], mean: 0 });
assert.equal(velocity([{ ...s('a', 'closed'), done: 3 }, { ...s('b', 'closed'), done: 4 }]).mean, 3.5);

// burndown: 4 tasks over 2026-11-02..06; one done on the 3rd, one on the 5th; today is the 4th
const b = burndown({ start: '2026-11-02', end: '2026-11-06' }, ['2026-11-03T15:00:00.000Z', '2026-11-05T09:00:00.000Z', null, null], '2026-11-04');
assert.deepEqual(b.map((r) => r.remaining), [4, 3, 3, null, null]);
assert.deepEqual(b.map((r) => r.ideal), [4, 3, 2, 1, 0]);
assert.equal(burndown({ start: '2026-11-02', end: '2026-11-02' }, [null], '2026-11-02')[0].ideal, 0, 'one-day sprint');
console.log('sprints ok');
