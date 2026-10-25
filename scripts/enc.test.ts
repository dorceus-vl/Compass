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

// Phase 3 tables: every listed column changes when sealed as work, round-trips, and stays put as personal.
for (const [table, row] of [
  ['raid_items', { id: 'r1', text: 'Vendor slips', response: 'Escalate', owner: 'Sam', trigger: 'No PO by Friday', probability: 3, enc_v: 0 }],
  ['knowledge_collections', { id: 'k1', name: 'Acme programme', enc_v: 0 }],
  ['knowledge_items', { id: 'ki1', title: 'Steering minutes.docx', enc_v: 0 }],
  ['knowledge_chunks', { id: 'kc1', locator: '§ Budget risks', text: 'The vendor will slip.', embedded: 0, enc_v: 0 }],
  ['baselines', { id: 'b1', project_id: 'p1', name: 'Kickoff plan', snapshot: '{"tasks":[],"milestones":[],"project":{"start_at":null,"end_at":null}}', task_count: 0, enc_v: 0 }],
  ['stakeholders', { id: 's1', project_id: 'p1', name: 'Dana Whitfield', role: 'Sponsor, Finance', channel: 'Weekly call', notes: 'Wary of the budget', power: 'high', enc_v: 0 }],
  ['ai_messages', { id: 'a1', content: 'Plan looks tight', proposals: '{"tasks":[]}', citations: '[]', enc_v: 0 }],
] as const) {
  const w = await seal(env, table, { ...row }, 'work') as any;
  assert.equal(w.enc_v, 2);
  for (const col of ENC_COLS[table]) assert.notEqual(w[col], (row as any)[col], `${table}.${col} sealed`);
  assert.deepEqual(await open(env, table, { ...w }), { ...row, enc_v: 2 });
  assert.deepEqual(await seal(env, table, { ...row }, 'personal'), row, `${table} personal untouched`);
}
// v2.4: a work program's name, RAG reason and notes are sealed; rag and kind stay plain; a personal program is untouched.
const prog = { id: 'g1', kind: 'work', name: 'Acme migration', rag: 'amber', rag_reason: 'Vendor late', notes: 'Watch the cutover', sort: 0, enc_v: 0 };
const sp = await seal(env, 'programs', { ...prog }) as any;
assert.equal(sp.enc_v, 2);
for (const col of ['name', 'rag_reason', 'notes']) assert.notEqual(sp[col], (prog as any)[col], `programs.${col} sealed`);
assert.equal(sp.rag, 'amber'); assert.equal(sp.kind, 'work');
assert.deepEqual(await open(env, 'programs', { ...sp }), { ...prog, enc_v: 2 });
const ownProg = { ...prog, id: 'g2', kind: 'personal' };
assert.deepEqual(await seal(env, 'programs', { ...ownProg }), ownProg, 'a personal program is untouched');
for (const t of ['raid_items', 'change_requests', 'lessons', 'documents', 'ai_threads', 'ai_messages'] as const) assert.ok(ENC_COLS[t].length > 0);

// Raw bytes (every byte value, bigger than one base64 chunk) round-trip; the context binds them.
const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
const box = await sealBytes(env, bytes, 'email.eml');
assert.ok(box.startsWith('v2:a:'));
assert.deepEqual(await openBytes(env, box, 'email.eml'), bytes);
await assert.rejects(openBytes(env, box, 'tasks.notes'), 'wrong context fails');
console.log('enc: ok');
