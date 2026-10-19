// node --experimental-strip-types scripts/position.test.ts
import assert from 'node:assert/strict';
import { positionBetween } from '../shared/position.ts';
assert.equal(positionBetween(null, null), 1000, 'empty column');
assert.equal(positionBetween(1000, null), 2000, 'at the end');
assert.equal(positionBetween(null, 1000), 0, 'at the top');
assert.equal(positionBetween(1000, 2000), 1500, 'between');
assert.ok(positionBetween(1000, 1000.0000001) > 1000, 'still strictly between');
console.log('position: ok');
