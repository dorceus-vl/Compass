// node --experimental-strip-types scripts/templates.test.ts
import assert from 'node:assert/strict';
import { applyOffsets, addDays, daysBetween, parseBody, snapshotProject, snapshotTask, BUILTINS, MAX_TEMPLATE_TASKS, MAX_TEMPLATE_MILESTONES, type ProjectBody, type TaskBody } from '../shared/templates.ts';

// date maths: calendar days, month and year ends, no time zone drift
assert.equal(addDays('2026-10-30', 3), '2026-11-02');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(addDays('2028-02-28', 1), '2028-02-29');
assert.equal(addDays('2026-10-05', -5), '2026-09-30');
assert.equal(daysBetween('2026-10-01', '2026-10-15'), 14);

const t = (title: string, o: object = {}) => ({ title, notes: null, horizon: 'short', priority: 0, estimate_minutes: null, checklist: [], start_offset: null, due_offset: null, ...o });
const body: ProjectBody = {
  project: { name: 'P', sponsor: null, phase: null, objectives: null, scope_in: null, scope_out: null, success_criteria: null },
  milestones: [{ name: 'M', gate: 1, offset_days: 10 }],
  tasks: [t('a', { start_offset: 0, due_offset: 3 }), t('b', { due_offset: null }), t('c', { due_offset: 7, parent_index: 0 })] as ProjectBody['tasks'],
};
// applyOffsets: dates shift with the start; an item without an offset keeps null
const d1 = applyOffsets(body, '2026-11-01'), d2 = applyOffsets(body, '2026-11-10');
assert.deepEqual(d1.tasks.map((x) => [x.start_at, x.due_at]), [['2026-11-01', '2026-11-04'], [null, null], [null, '2026-11-08']]);
assert.deepEqual(d2.tasks.map((x) => x.due_at), ['2026-11-13', null, '2026-11-17'], 'a later start shifts every date');
assert.equal(d1.milestones[0].due_at, '2026-11-11');
assert.deepEqual(d1.tasks.map((x) => x.parent_index), [null, null, 0]);
// a task template flattens: the task first, subtasks pointing at it
const tb: TaskBody = { task: t('main', { due_offset: 2 }) as TaskBody['task'], subtasks: [t('sub', { due_offset: 5 }) as TaskBody['task']] };
const dt = applyOffsets(tb, '2026-11-01');
assert.deepEqual(dt.tasks.map((x) => [x.title, x.due_at, x.parent_index]), [['main', '2026-11-03', null], ['sub', '2026-11-06', 0]]);
assert.equal(dt.project, null);

// snapshot: offsets from the earliest date, null stays null, checklists unticked, no ids or blockers
const src = (title: string, o: object = {}) => ({ id: title, parent_id: null as string | null, title, notes: 'n', horizon: 'medium' as const, priority: 2, estimate_minutes: 30, checklist: '[{"id":"x","text":"step","done":true}]' as string | null, start_at: null as string | null, due_at: null as string | null, ...o });
const snap = snapshotProject({ name: 'Proj', sponsor: 's', phase: null, objectives: 'o', scope_in: null, scope_out: null, success_criteria: null },
  [{ name: 'Gate', gate: 1, due_at: '2026-03-20' }, { name: 'Open', gate: 0, due_at: null }],
  [src('one', { start_at: '2026-03-10', due_at: '2026-03-12' }), src('two', { due_at: '2026-03-15', parent_id: 'one' }), src('three'), src('four', { parent_id: 'two' })]);
assert.deepEqual(snap.tasks.map((x) => [x.start_offset, x.due_offset]), [[0, 2], [null, 5], [null, null], [null, null]]);
assert.deepEqual(snap.milestones.map((m) => m.offset_days), [10, null]);
assert.deepEqual(snap.tasks.map((x) => x.parent_index ?? null), [null, 0, null, null], 'a subtask of a subtask is lifted to top level');
assert.deepEqual(snap.tasks[0].checklist, [{ id: 'x', text: 'step', done: false }], 'unticked');
assert.ok(!JSON.stringify(snap).includes('blocked_by') && !JSON.stringify(snap).includes('"id":"one"'));
assert.deepEqual(parseBody('project', snap), snap, 'a snapshot validates');
const sn = snapshotTask(src('main', { due_at: '2026-04-02' }), [src('sub', { due_at: '2026-04-05' })]);
assert.deepEqual([sn.task.due_offset, sn.subtasks[0].due_offset], [0, 3]);
assert.deepEqual(parseBody('task', JSON.stringify(sn)), sn);
const none = snapshotTask(src('x'), []);
assert.equal(none.task.due_offset, null, 'no dates, no offsets');

// validators
assert.equal(parseBody('project', 'not json'), null);
assert.equal(parseBody('project', null), null);
assert.equal(parseBody('task', { task: t('x'), subtasks: 'no' }), null);
assert.equal(parseBody('task', { task: t(' '), subtasks: [] }), null, 'blank title');
assert.equal(parseBody('task', { task: t('x', { horizon: 'never' }), subtasks: [] }), null);
assert.equal(parseBody('task', { task: t('x', { priority: 4 }), subtasks: [] }), null);
assert.equal(parseBody('task', { task: t('x', { due_offset: 1.5 }), subtasks: [] }), null);
assert.equal(parseBody('task', { task: t('x', { due_offset: 99999 }), subtasks: [] }), null);
assert.equal(parseBody('task', { task: t('x', { checklist: [{ id: 'a', text: '', done: false }] }), subtasks: [] }), null, 'bad checklist');
assert.ok(parseBody('task', { task: t('x', { checklist: [{ id: 'a', text: 'ok', done: true }] }), subtasks: [] }), 'a ticked item is accepted and unticked');
assert.equal((parseBody('task', { task: t('x', { checklist: [{ id: 'a', text: 'ok', done: true }], blocked_by: ['q'] }), subtasks: [] }) as TaskBody).task.checklist[0].done, false);
assert.ok(!('blocked_by' in (parseBody('task', { task: t('x', { blocked_by: ['q'] }), subtasks: [] }) as TaskBody).task), 'unknown keys (blocked_by) are dropped');
const proj = (o: object) => ({ ...body, ...o });
const many = (n: number) => Array.from({ length: n }, (_, i) => t('t' + i));
assert.ok(parseBody('project', proj({ tasks: many(MAX_TEMPLATE_TASKS) })), '200 tasks ok');
assert.equal(parseBody('project', proj({ tasks: many(MAX_TEMPLATE_TASKS + 1) })), null, '201 tasks');
const ms = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'm' + i, gate: 0, offset_days: i }));
assert.ok(parseBody('project', proj({ milestones: ms(MAX_TEMPLATE_MILESTONES) })), '50 milestones ok');
assert.equal(parseBody('project', proj({ milestones: ms(MAX_TEMPLATE_MILESTONES + 1) })), null, '51 milestones');
assert.equal(parseBody('project', proj({ milestones: [{ name: '', gate: 0, offset_days: 1 }] })), null, 'blank milestone name');
assert.equal(parseBody('project', proj({ tasks: [t('a', { parent_index: 0 })] })), null, 'its own parent');
assert.equal(parseBody('project', proj({ tasks: [t('a'), t('b', { parent_index: 5 })] })), null, 'parent out of range');
assert.equal(parseBody('project', proj({ tasks: [t('a'), t('b', { parent_index: 0 }), t('c', { parent_index: 1 })] })), null, 'a subtask of a subtask');
assert.equal(parseBody('project', proj({ project: { ...body.project, name: 'x'.repeat(201) } })), null, 'project name too long');

// the built-ins
assert.deepEqual(BUILTINS.map((b) => b.name), ['Project kickoff', 'Vendor onboarding', 'Change / release']);
assert.equal(new Set(BUILTINS.map((b) => b.id)).size, 3);
for (const b of BUILTINS) {
  assert.ok(b.id.startsWith('builtin:'));
  const ok = parseBody('project', JSON.stringify(b.body));
  assert.deepEqual(ok, b.body, `${b.name} validates and is unchanged`);
  assert.ok(b.body.tasks.length >= 6 && b.body.milestones.length === 3, `${b.name}: tasks and three milestones`);
  const dated = applyOffsets(b.body, '2026-11-02');
  assert.ok(dated.tasks.every((x) => x.due_at && x.due_at >= '2026-11-02'), `${b.name}: every task is dated`);
  assert.ok(!JSON.stringify(b.body).includes('blocked_by'));
}
assert.deepEqual(BUILTINS[0].body.milestones.map((m) => m.name), ['Kickoff', 'Plan baselined', 'First status']);
console.log('templates.test.ts ok');
