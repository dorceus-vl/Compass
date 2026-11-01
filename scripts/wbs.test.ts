// node --experimental-strip-types scripts/wbs.test.ts
import assert from 'node:assert/strict';
import { parseWbs, numbers, addNode, shift, move, removeNode, subtreeIds, stored, MAX_WBS_NODES, type WbsNode } from '../shared/wbs.ts';

const n = (id: string, depth: number): WbsNode => ({ id, title: id.toUpperCase(), depth });
const ids = (x: WbsNode[]) => x.map((v) => v.id).join();
const tree = [n('a', 0), n('a1', 1), n('a2', 1), n('a21', 2), n('b', 0), n('b1', 1)];

// parse
assert.deepEqual(parseWbs(null), [], 'none');
assert.deepEqual(parseWbs(JSON.stringify(tree)), tree, 'round trip');
assert.equal(parseWbs([n('a', 1)]), null, 'first node must be top level');
assert.equal(parseWbs([n('a', 0), n('b', 2)]), null, 'no skipped level');
assert.equal(parseWbs([n('a', 0), n('a', 0)]), null, 'repeated id');
assert.equal(parseWbs([{ id: 'a', title: ' ', depth: 0 }]), null, 'blank title');
assert.equal(parseWbs([{ id: 'a', title: 'A', depth: 0.5 }]), null, 'integer depth');
assert.equal(parseWbs('{bad'), null, 'bad JSON');
assert.equal(parseWbs(Array.from({ length: MAX_WBS_NODES + 1 }, (_, i) => n(`x${i}`, 0))), null, 'over the cap');
assert.equal(parseWbs(Array.from({ length: 7 }, (_, i) => n(`x${i}`, i))), null, 'over 6 levels');

// numbering
assert.deepEqual(numbers(tree), ['1', '1.1', '1.2', '1.2.1', '2', '2.1']);
assert.deepEqual(numbers([n('a', 0), n('b', 0), n('b1', 1), n('c', 0)]), ['1', '2', '2.1', '3']);

// add
assert.equal(ids(addNode(tree, { id: 'c', title: 'C' }, null)!), 'a,a1,a2,a21,b,b1,c');
assert.equal(ids(addNode(tree, { id: 'x', title: 'X' }, 'a')!), 'a,a1,a2,a21,x,b,b1', 'last child goes after the subtree');
assert.equal(addNode(tree, { id: 'x', title: 'X' }, 'a')![4].depth, 1);
assert.equal(addNode(tree, { id: 'x', title: 'X' }, 'zz'), null, 'unknown parent');
assert.equal(addNode(Array.from({ length: 6 }, (_, i) => n(`d${i}`, i)), { id: 'x', title: 'X' }, 'd5'), null, 'too deep');

// indent / outdent
assert.equal(shift(tree, 'a', 1), null, 'first node cannot nest');
assert.equal(shift(tree, 'a1', 1), null, 'first child has no sibling above');
const inB = shift(tree, 'b', 1)!;
assert.deepEqual(numbers(inB), ['1', '1.1', '1.2', '1.2.1', '1.3', '1.3.1'], 'b joins a with its child');
assert.equal(shift(tree, 'a21', -1)!.find((x) => x.id === 'a21')!.depth, 1);
assert.equal(shift(tree, 'a', -1), null, 'top level cannot go out');
assert.ok(parseWbs(shift(tree, 'a2', -1)), 'outdent leaves a valid outline');
assert.ok(parseWbs(inB), 'indent leaves a valid outline');

// move
assert.equal(ids(move(tree, 'b', -1)!), 'b,b1,a,a1,a2,a21', 'block swaps with the sibling above');
assert.equal(ids(move(tree, 'a', 1)!), 'b,b1,a,a1,a2,a21');
assert.equal(ids(move(tree, 'a1', 1)!), 'a,a2,a21,a1,b,b1', 'subtree travels');
assert.equal(move(tree, 'a', -1), null, 'top edge');
assert.equal(move(tree, 'b', 1), null, 'bottom edge');
assert.equal(move(tree, 'a2', 1), null, 'last child cannot jump out');
assert.equal(move(tree, 'a1', -1), null, 'first child cannot jump out');
assert.ok(parseWbs(move(tree, 'a1', 1)));

// remove
const r = removeNode(tree, 'a2');
assert.equal(ids(r.nodes), 'a,a1,b,b1');
assert.deepEqual(r.gone, ['a2', 'a21']);
assert.deepEqual(removeNode(tree, 'zz'), { nodes: tree, gone: [] });
assert.deepEqual(subtreeIds(tree, 'a'), ['a', 'a1', 'a2', 'a21']);
assert.equal(stored([]), null);
assert.equal(typeof stored(tree), 'string');
console.log('wbs ok');
