// node --experimental-strip-types scripts/program.test.ts
import assert from 'node:assert/strict';
import { worstRag, ragPairSentence, budgetRows, budgetTotals, programRollup } from '../shared/program.ts';
import type { Milestone, Program, Project, Task } from '../shared/types.ts';

// worstRag: red > amber > green; none ignored
assert.equal(worstRag(['green', 'amber']), 'amber');
assert.equal(worstRag(['none', 'green']), 'green');
assert.equal(worstRag(['green', 'red', 'amber']), 'red');
assert.equal(worstRag([]), 'none');
assert.equal(worstRag(['none', 'none']), 'none');

// ragPairSentence
assert.equal(ragPairSentence('green', 'red', 1, 0), 'You say green; one project is red');
assert.equal(ragPairSentence('amber', 'red', 2, 1), 'You say amber; 2 projects are red');
assert.equal(ragPairSentence('green', 'amber', 0, 1), 'You say green; one project is amber');
assert.equal(ragPairSentence('red', 'red', 1, 0), null);
assert.equal(ragPairSentence('green', 'none', 0, 0), null);
assert.equal(ragPairSentence('none', 'amber', 0, 3), 'You haven’t set one; 3 projects are amber');

// budgetRows / budgetTotals
const b = (id: string, currency: string, budget_planned: number | null, budget_spent: number | null, budget_forecast: number | null) => ({ id, currency, budget_planned, budget_spent, budget_forecast });
const rows = budgetRows([b('a', 'CAD', 40000, 12000, 44000), b('b', 'USD', 10000, 5000, 9000), b('c', 'CAD', null, 300, null), b('d', 'CAD', 0, 0, 0), b('e', 'CAD', 1000, null, null)]);
assert.deepEqual(rows[0], { project_id: 'a', currency: 'CAD', planned: 40000, spent: 12000, forecast: 44000, variance: 4000, pct_spent: 30 });
assert.equal(rows[1].variance, -1000, 'under forecast is negative');
assert.equal(rows[2].planned, null, 'planned null stays in rows');
assert.equal(rows[2].variance, null);
assert.equal(rows[2].pct_spent, null);
assert.equal(rows[3].pct_spent, null, 'planned 0 gives no percentage');
assert.equal(rows[4].variance, null, 'no forecast, no variance');
const totals = budgetTotals(rows);
assert.deepEqual(totals.map((t) => t.currency), ['CAD', 'USD']);
assert.deepEqual(totals[0], { currency: 'CAD', planned: 41000, spent: 12000, forecast: 45000, variance: 4000, pct_spent: 29, projects: 3 });
assert.deepEqual(totals[1], { currency: 'USD', planned: 10000, spent: 5000, forecast: 9000, variance: -1000, pct_spent: 50, projects: 1 });
assert.equal(budgetTotals([]).length, 0);

// programRollup
const T = '2026-10-01T12:00:00.000Z';
const program: Program = { id: 'g1', kind: 'work', name: 'Prog', rag: 'green', rag_reason: null, notes: null, sort: 0, enc_v: 0, created_at: T, updated_at: T, deleted_at: null };
const proj = (id: string, o: Partial<Project> = {}): Project => ({
  id, name: id.toUpperCase(), kind: 'work', status: 'active', rag: 'green', rag_reason: null, sponsor: null, objectives: null, scope_in: null, scope_out: null,
  success_criteria: null, phase: null, start_at: null, end_at: null, budget_planned: null, budget_spent: null, data_boundary: 'cloud', colour: null, sort: 0, enc_v: 0,
  program_id: 'g1', budget_forecast: null, currency: 'CAD', created_at: T, updated_at: T, deleted_at: null, ...o,
});
const task = (id: string, project_id: string, o: Partial<Task> = {}): Task => ({
  id, project_id, parent_id: null, title: id, notes: null, kind: 'work', horizon: 'short', status: 'new', priority: 0, start_at: null, due_at: null,
  done_at: null, estimate_minutes: null, waiting_on: null, waiting_since: null, nudge_every_days: null, recur: null, source_app: 'manual', source_kind: null, source_ref: null,
  source_url: null, blocked_by: null, checklist: null, sort_in_column: 0, tags: '', enc_v: 0, created_at: T, updated_at: T, deleted_at: null, ...o,
});
const ms = (id: string, project_id: string, due_at: string | null, o: Partial<Milestone> = {}): Milestone => ({ id, project_id, name: id, due_at, done_at: null, gate: 0, sort: 0, enc_v: 0, created_at: T, updated_at: T, deleted_at: null, ...o });

const projects = [
  proj('p1', { rag: 'amber', budget_planned: 100, budget_spent: 50, budget_forecast: 120 }),
  proj('p2', { rag: 'red', currency: 'USD', budget_planned: 10, budget_spent: 1 }),
  proj('p3', { rag: 'red', deleted_at: T }), // trashed: left out
  proj('px', { rag: 'red', program_id: 'other' }), // another program
];
const tasks = [
  task('t1', 'p1', { status: 'done', done_at: T, due_at: '2026-10-10' }),
  task('t2', 'p1', { due_at: '2026-10-20' }),
  task('s1', 'p1', { parent_id: 't2', status: 'done' }), // subtask: not counted
  task('t3', 'p1', { deleted_at: T, status: 'done' }), // trashed: not counted
  task('t4', 'p2', { due_at: '2026-10-15' }),
];
const milestones = [
  ms('m1', 'p1', '2026-11-01T04:30:00.000Z'), // 2026-11-01 00:30 in Toronto, after the DST change: in the window
  ms('m2', 'p2', '2026-11-24T12:00:00.000Z'), // today + 30: in
  ms('m3', 'p2', '2026-11-25T12:00:00.000Z'), // today + 31: out
  ms('m8', 'p2', '2026-11-25T03:00:00.000Z'), // 2026-11-24 22:00 in Toronto (EST, after the change): in, though its UTC day is out
  ms('m4', 'p1', '2026-10-24T12:00:00.000Z'), // past: out
  ms('m5', 'p1', '2026-10-30T12:00:00.000Z', { done_at: T }), // done: out
  ms('m6', 'p3', '2026-10-28T12:00:00.000Z'), // trashed project: out
  ms('m7', 'p1', '2026-10-27T12:00:00.000Z', { deleted_at: T }), // trashed milestone: out
];
const baselines = [{ project_id: 'p1', taken_at: T, snapshot: { tasks: [{ id: 't1', start_at: null, due_at: '2026-10-08' }, { id: 't2', start_at: null, due_at: '2026-10-20' }], milestones: [], project: { start_at: null, end_at: null } } }];
const r = programRollup({ program, projects, tasks, milestones, detail: { baselines }, today: '2026-10-25', tz: 'America/Toronto' });
assert.deepEqual(r.projects.map((p) => p.id), ['p1', 'p2'], 'trashed and other-program projects left out');
assert.equal(r.worst, 'red');
assert.equal(r.sentence, 'You say green; one project is red');
const p1 = r.projects[0], p2 = r.projects[1];
assert.equal(p1.pct_done, 50, 'subtask and trashed task not counted');
assert.equal(p2.pct_done, 0);
assert.equal(p1.slip?.late, 1);
assert.equal(p1.slip?.max_late, 2);
assert.equal(p2.slip, null, 'no baseline: slip null');
assert.deepEqual(p1.next_milestone, { name: 'm4', due_at: '2026-10-24T12:00:00.000Z' }, 'the earliest open milestone, overdue included, as on the Portfolio');
assert.deepEqual(r.upcoming.map((u) => u.name), ['m1', 'm2', 'm8']);
assert.equal(r.upcoming[0].project_id, 'p1');
assert.deepEqual(r.budget.rows.map((x) => x.project_id), ['p1', 'p2']);
assert.deepEqual(r.budget.totals.map((x) => x.currency), ['CAD', 'USD']);
// a project with no tasks: 0, and an empty program is none
assert.equal(programRollup({ program, projects: [], tasks: [], milestones: [], detail: { baselines: [] }, today: '2026-10-25', tz: 'America/Toronto' }).worst, 'none');

console.log('program: ok');
