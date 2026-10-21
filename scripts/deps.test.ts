// node --experimental-strip-types scripts/deps.test.ts
import assert from 'node:assert/strict';
import { wouldCycle, isBlocked, parseBlockedBy, blockedIds, openBlockers, blocksOf, MAX_BLOCKERS } from '../shared/deps.ts';

// wouldCycle(graph, from, to): would "from is blocked by to" close a loop? graph maps a task to the ids it waits on.
const g = (o: Record<string, string[]>) => new Map(Object.entries(o));
assert.equal(wouldCycle(g({}), 'a', 'a'), true, 'a task cannot block itself');
assert.equal(wouldCycle(g({ b: ['a'] }), 'a', 'b'), true, 'direct: b waits on a, so a cannot wait on b');
assert.equal(wouldCycle(g({ b: ['c'], c: ['d'], d: ['e'], e: ['a'] }), 'a', 'b'), true, 'long chain');
assert.equal(wouldCycle(g({ b: ['x'], x: ['a'] }), 'a', 'b'), true, 'two hops');
assert.equal(wouldCycle(g({ b: ['c', 'd'], c: ['e'], d: ['e'] }), 'a', 'b'), false, 'diamond with no loop');
assert.equal(wouldCycle(g({ b: ['c', 'd'], c: ['e'], d: ['e'] }), 'e', 'b'), true, 'diamond: e waits on b would loop');
assert.equal(wouldCycle(g({}), 'a', 'b'), false, 'unknown tasks are fine');
assert.equal(wouldCycle(g({ b: ['c'], c: ['b'] }), 'a', 'b'), false, 'an existing loop elsewhere does not hang or count');

// isBlocked: any blocker that is live and open.
const by = new Map([
  ['open', { status: 'progress', deleted_at: null }],
  ['done', { status: 'done', deleted_at: null }],
  ['gone', { status: 'new', deleted_at: '2026-10-01T00:00:00.000Z' }],
]);
assert.equal(isBlocked({ blocked_by: '["open"]' }, by), true);
assert.equal(isBlocked({ blocked_by: '["done"]' }, by), false);
assert.equal(isBlocked({ blocked_by: '["gone"]' }, by), false, 'a trashed blocker is resolved');
assert.equal(isBlocked({ blocked_by: '["missing"]' }, by), false, 'a missing blocker is resolved');
assert.equal(isBlocked({ blocked_by: '["done","open"]' }, by), true, 'one open blocker is enough');
assert.equal(isBlocked({ blocked_by: null }, by), false);
assert.equal(isBlocked({ blocked_by: 'not json' }, by), false);
assert.equal(isBlocked({ blocked_by: '["open"]', status: 'done' }, by), false, 'a finished task is never blocked');

// parseBlockedBy: a JSON array (or array) of unique non-empty ids, at most 20; null means invalid.
assert.deepEqual(parseBlockedBy(null), []);
assert.deepEqual(parseBlockedBy(''), []);
assert.deepEqual(parseBlockedBy('[]'), []);
assert.deepEqual(parseBlockedBy('["a","b"]'), ['a', 'b']);
assert.deepEqual(parseBlockedBy(['a']), ['a']);
assert.equal(parseBlockedBy('["a","a"]'), null, 'duplicates');
assert.equal(parseBlockedBy('[1]'), null);
assert.equal(parseBlockedBy('[""]'), null);
assert.equal(parseBlockedBy('{"a":1}'), null);
assert.equal(parseBlockedBy('nope'), null);
const ids = Array.from({ length: MAX_BLOCKERS }, (_, i) => `t${i}`);
assert.equal(parseBlockedBy(JSON.stringify(ids))?.length, 20);
assert.equal(parseBlockedBy(JSON.stringify([...ids, 'extra'])), null, 'more than 20');
assert.equal(parseBlockedBy(JSON.stringify(['x'.repeat(65)])), null, 'an id is at most 64 characters');
// blockedIds / openBlockers / blocksOf over a list.
const list = [
  { id: 'a', status: 'new', blocked_by: '["b","c"]', deleted_at: null },
  { id: 'b', status: 'progress', blocked_by: null, deleted_at: null },
  { id: 'c', status: 'done', blocked_by: null, deleted_at: null },
  { id: 'd', status: 'new', blocked_by: '["c"]', deleted_at: null },
  { id: 'e', status: 'new', blocked_by: '["b"]', deleted_at: '2026-10-01T00:00:00.000Z' },
];
assert.deepEqual([...blockedIds(list)], ['a'], 'a waits on open b; d only on done c; trashed e is not listed');
assert.deepEqual(openBlockers(list[0], new Map(list.map((t) => [t.id, t]))).map((t) => t.id), ['b']);
assert.deepEqual(blocksOf('b', list).map((t) => t.id), ['a'], 'a trashed task is not listed');
console.log('deps: ok');
