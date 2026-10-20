import assert from 'node:assert/strict';
import { projectContext, boundaryOf, projectAccess } from '../worker/lib/project-context.ts';

// A stub D1 answering the eight context queries in order; plain (enc_v 0) rows, so no key is needed.
const project = { id: 'p1', name: 'Fibre  rollout', kind: 'personal', status: 'active', phase: 'Execution', rag: 'amber', rag_reason: 'Vendor late', sponsor: 'Ann',
  start_at: '2026-09-01', end_at: null, budget_planned: 1000, budget_spent: null, objectives: 'Ship\nit', scope_in: null, scope_out: null, success_criteria: null, enc_v: 0 };
const answers = [[project], [{ name: 'Go-live', due_at: '2026-11-01', gate: 1, enc_v: 0 }], [{ title: 'Call vendor', status: 'waiting', due_at: '2026-10-20', waiting_on: 'Bob', enc_v: 0 }],
  [{ type: 'risk', text: 'Late kit', probability: 4, impact: 5, owner: null, response: 'Chase', enc_v: 0 }], [], [{ decided_at: '2026-10-01', text: 'Go with A', enc_v: 0 }], [],
  [{ title: 'Kickoff', summary: 'x'.repeat(700), received_at: '2026-10-02T10:00:00Z', enc_v: 0 }]];
const env = (first: unknown) => ({ DB: {
  prepare: () => ({ bind: () => ({ first: async () => first }) }),
  batch: async () => answers.map((results) => ({ results })),
} }) as never;

const ctx = (await projectContext(env(null), 'p1'))!;
assert.match(ctx, /^Project: Fibre rollout \(personal\)\nStatus: active; phase Execution\nRAG: amber - Vendor late\nSponsor: Ann\nDates: start 2026-09-01\nBudget: planned 1000\nObjectives: Ship it\n/);
assert.match(ctx, /Open milestones:\n- Go-live; due 2026-11-01; gate/);
assert.match(ctx, /Open tasks:\n- Call vendor; status waiting; due 2026-10-20; waiting on Bob/);
assert.match(ctx, /Open RAID:\n- risk: Late kit; P 4; I 5; response Chase/);
assert.match(ctx, /Last decisions:\n- 2026-10-01 Go with A/);
assert.match(ctx, /Last meeting reviews:\n- Kickoff \(2026-10-02\): x{600}$/);
assert.ok(!/Pending change requests|Last lessons|Scope in|owner/.test(ctx), 'empty sections and fields are left out');
assert.equal(await boundaryOf(env(null), null), 'cloud', 'no project → cloud');
assert.equal(await boundaryOf(env(null), 'gone'), null, 'unknown or trashed → null');
assert.equal(await boundaryOf(env({ data_boundary: 'offline' }), 'w1'), 'offline');
// The copilot seals with the kind from this one read (fix round 1): a work project stays work, a vanished one is null (404), never personal.
assert.deepEqual(await projectAccess(env({ data_boundary: 'cloud', kind: 'work' }), 'w2'), { boundary: 'cloud', kind: 'work' });
assert.deepEqual(await projectAccess(env(null), null), { boundary: 'cloud', kind: 'personal' }, 'no project → personal');
assert.equal(await projectAccess(env(null), 'gone'), null, 'trashed → null, not personal');
// Defence in depth (final review): the project read itself requires a live cloud project, so an Offline switch between the boundary check and this read sends nothing.
const offlineEnv = { DB: {
  prepare: (sql: string) => ({ bind: () => ({ sql }) }),
  batch: async (stmts: { sql: string }[]) => answers.map((results, i) => ({ results: i === 0 && stmts[0].sql.includes(`data_boundary = 'cloud'`) ? [] : results })),
} } as never;
assert.equal(await projectContext(offlineEnv, 'p1'), null, 'an Offline (or trashed) project gives no context');
console.log('project-context: ok');
