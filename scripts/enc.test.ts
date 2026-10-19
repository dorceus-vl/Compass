// node --experimental-strip-types scripts/enc.test.ts
import assert from 'node:assert/strict';
import { seal, open, sealBytes, openBytes, ENC_COLS } from '../worker/lib/enc.ts';

const env = { COMPASS_DATA_KEY: 'k' } as any;
const work = { id: 't1', kind: 'work', title: 'Cutover plan', notes: null, waiting_on: 'Acme', enc_v: 0 };
const sealed = await seal(env, 'tasks', { ...work });
assert.equal(sealed.enc_v, 2);
assert.notEqual(sealed.title, 'Cutover plan');
assert.equal(sealed.notes, null, 'null stays null');
assert.ok(String(sealed.waiting_on).startsWith('v2:a:'));
const opened = await open(env, 'tasks', { ...sealed });
assert.deepEqual(opened, { ...work, enc_v: 2 });

const personal = { id: 't2', kind: 'personal', title: 'Book dentist', notes: 'Dr Roy', waiting_on: null, enc_v: 0 };
assert.deepEqual(await seal(env, 'tasks', { ...personal }), personal, 'personal rows are untouched');
assert.deepEqual(await open(env, 'tasks', { ...personal }), personal);

// A milestone carries no kind of its own: the caller passes the project's.
const m = await seal(env, 'milestones', { id: 'm1', name: 'Go / no-go', enc_v: 0 }, 'work');
assert.equal(m.enc_v, 2);
assert.equal((await open(env, 'milestones', { ...m })).name, 'Go / no-go');
assert.deepEqual(ENC_COLS.projects, ['name', 'rag_reason', 'sponsor', 'objectives', 'scope_in', 'scope_out', 'success_criteria']);

// Raw bytes (every byte value, bigger than one base64 chunk) round-trip; the context binds them.
const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
const box = await sealBytes(env, bytes, 'email.eml');
assert.ok(box.startsWith('v2:a:'));
assert.deepEqual(await openBytes(env, box, 'email.eml'), bytes);
await assert.rejects(openBytes(env, box, 'tasks.notes'), 'wrong context fails');
console.log('enc: ok');
