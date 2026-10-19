// node --experimental-strip-types scripts/crypto-box.test.ts
import assert from 'node:assert/strict';
import { encryptString, decryptString, blindIndex } from '../worker/lib/crypto-box.js';

const KEY = 'test-key-not-secret';
const ct = await encryptString('Prepare risk review', KEY, 'tasks.title');
assert.ok(ct.startsWith('v2:a:'));
assert.equal(await decryptString(ct, KEY, 'tasks.title'), 'Prepare risk review');
await assert.rejects(decryptString(ct, KEY, 'tasks.notes'), 'bound to its column');
await assert.rejects(decryptString(ct, 'other-key', 'tasks.title'));
await assert.rejects(decryptString('garbage', KEY), /unknown format/);
assert.equal(await blindIndex(' Netflix ', KEY, 'x'), await blindIndex('netflix', KEY, 'x'));
console.log('crypto-box: ok');
