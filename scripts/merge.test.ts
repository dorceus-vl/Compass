// node --experimental-strip-types scripts/merge.test.ts
import assert from 'node:assert/strict';
import { mergeRows } from '../web/src/store/merge.ts';

const a = { id: '1', title: 'old', updated_at: '2026-10-19T10:00:00.000Z' };
const b = { id: '1', title: 'new', updated_at: '2026-10-19T11:00:00.000Z' };
assert.deepEqual(mergeRows([a], [b]), [b], 'newer remote wins');
assert.deepEqual(mergeRows([b], [a]), [b], 'newer local wins');
assert.deepEqual(mergeRows([a], []), [a], 'remote missing keeps local (incremental pulls are partial)');
assert.deepEqual(mergeRows([], [b]), [b]);
const c = { id: '2', title: 'x', updated_at: '2026-10-19T09:00:00.000Z' };
assert.deepEqual(mergeRows([a, c], [b]).map((r) => r.id).sort(), ['1', '2']);
console.log('merge: ok');
