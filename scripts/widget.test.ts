import assert from 'node:assert/strict';
import { newToken, hashToken, sameHash, findToken, overLimit, deviceName, MAX_PER_MINUTE, MAX_PER_DAY } from '../worker/lib/widget.ts';

// A token is 256 random bits, base64url (the shape the iOS Keychain check accepts: 16 to 200 of A-Za-z0-9-_), never repeated.
const t = newToken();
assert.match(t, /^[A-Za-z0-9_-]{43}$/);
assert.notEqual(newToken(), t);

// The server keeps SHA-256 only: 64 hex characters, stable, and not the token.
const h = await hashToken(t);
assert.match(h, /^[0-9a-f]{64}$/);
assert.equal(h, await hashToken(t));
assert.notEqual(h, t);
assert.equal(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); // the SHA-256 test vector

// Compare: equal only when equal; a length difference or one changed character is false.
assert.equal(sameHash(h, h), true);
assert.equal(sameHash(h, h.slice(0, -1)), false);
assert.equal(sameHash(h, h.slice(0, -1) + (h.endsWith('0') ? '1' : '0')), false);
assert.equal(sameHash('', ''), true);

// findToken: the live row with that hash; a revoked token, another hash and no rows give null.
const rows = [
  { id: 'a', token_hash: await hashToken('one'), revoked_at: null },
  { id: 'b', token_hash: await hashToken('two'), revoked_at: '2026-10-21T00:00:00.000Z' },
];
assert.equal(findToken(rows, await hashToken('one'))?.id, 'a');
assert.equal(findToken(rows, await hashToken('two')), null, 'a revoked token is refused');
assert.equal(findToken(rows, await hashToken('three')), null);
assert.equal(findToken([], h), null);

// Limits count the calls already made: 60 a minute and 300 a day pass, the next one doesn't.
assert.equal(overLimit(MAX_PER_MINUTE - 1, 0), false);
assert.equal(overLimit(MAX_PER_MINUTE, 0), true);
assert.equal(overLimit(0, MAX_PER_DAY - 1), false);
assert.equal(overLimit(0, MAX_PER_DAY), true);

// The device name: trimmed, at most 60, else the default.
assert.equal(deviceName('  Vlad iPhone '), 'Vlad iPhone');
assert.equal(deviceName('x'.repeat(61)), 'iPhone or iPad');
assert.equal(deviceName(''), 'iPhone or iPad');
assert.equal(deviceName(7), 'iPhone or iPad');
console.log('widget: all checks passed');
