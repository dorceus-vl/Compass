import assert from 'node:assert/strict';
import { parseRange } from '../worker/lib/range.ts';

assert.equal(parseRange(null, 1000), null);
assert.equal(parseRange('', 1000), null);
assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
assert.deepEqual(parseRange('bytes=0-9', 1000), { start: 0, end: 9 });
assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 }, 'a suffix longer than the file is the whole file');
assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 }, 'an end past the file is clamped');
assert.deepEqual(parseRange('bytes=999-999', 1000), { start: 999, end: 999 });
for (const bad of ['bytes=1000-', 'bytes=2000-3000', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=a-b', 'bytes=0-1,5-9', 'items=0-1', 'bytes 0-1', '0-1'])
  assert.equal(parseRange(bad, 1000), 'bad', bad);
assert.equal(parseRange('bytes=0-0', 0), 'bad', 'nothing is satisfiable in an empty file');
import { sniffMedia } from '../worker/lib/athena-media.ts';
const b = (...x: (number | string)[]) => new Uint8Array(x.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));
assert.equal(sniffMedia(b(0, 0, 0, 0x18, 'ftypisom')), 'mp4');
assert.equal(sniffMedia(b('ftypisom')), null, 'ftyp must sit at offset 4');
assert.equal(sniffMedia(b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'png');
assert.equal(sniffMedia(b(0xff, 0xd8, 0xff, 0xe0)), 'jpg');
assert.equal(sniffMedia(b('%PDF-1.7')), null);
assert.equal(sniffMedia(b()), null);
console.log('range.test ok');
