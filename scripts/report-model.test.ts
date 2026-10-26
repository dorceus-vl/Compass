import assert from 'node:assert/strict';
import { buildReportModel } from '../shared/report-model.ts';
import { fixture } from './fixtures/report-input.ts';
import type { Project } from '../shared/types.ts';

const project: Project = fixture.project;
const TZ = 'America/Toronto';

const m = buildReportModel(fixture, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', '2026-10-19T12:00:00Z', TZ);
assert.equal(m.project.rag_label, 'Amber');
assert.equal(m.project.budget_left, '60');
assert.equal(m.project.pct_done, 50);
assert.equal(m.tasks.done.count, 2);
assert.equal(m.tasks.overdue.rows[0].days_late, 3);
assert.equal(m.tasks.next.count, 2);
assert.deepEqual(m.tasks.next.rows.map((t) => t.title), ['Book window', 'Await invoice']);
assert.ok(!JSON.stringify(m).includes('Trashed task'), 'a trashed task appears nowhere');
assert.deepEqual(m.milestones.rows.map((x) => x.state), ['Done', 'Late', 'Due this period', 'Upcoming']);
assert.deepEqual(m.risks.rows.map((r) => r.score), [20, 6]);
assert.equal(m.risks.table.split('\n')[0], 'Risk | P | I | Score | Owner | Response');
assert.equal(m.risks.table.split('\n')[1], 'Router shortage / single source | 4 | 5 | 20 | Bob | Second quote', 'a bar in a cell is replaced so columns hold');
assert.equal(m.risks.list.split('\n')[0], '• Router shortage | single source (score 20)');
assert.equal(m.issues.count, 1); assert.equal(m.assumptions.count, 1); assert.equal(m.dependencies.count, 1);
assert.equal(m.changes.count, 2);
assert.equal(m.decisions.count, 1);
assert.equal(m.decisions_needed.rows[0].title, 'Add six sites');
assert.equal(m.meetings.count, 1);
assert.equal(m.lessons.count, 1);
assert.equal(m.status.headline, 'Amber: Vendor late');
assert.equal(m.status.progress, '2 tasks done this period; 3 of 6 overall (50%). 1 overdue.');
assert.equal(m.status.next_steps, 'Book window; Await invoice');
assert.equal(m.range.label, '2026-10-12 to 2026-10-25');
assert.equal(m.ai.summary, '');

// An empty project: nothing set, nothing listed, honest defaults.
const blank = buildReportModel({ project: { ...project, rag: 'none', rag_reason: null, budget_planned: 100, budget_spent: null }, milestones: [], tasks: [], raid: [], changes: [], decisions: [], lessons: [], meetings: [] },
  { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
const sections = [blank.milestones, blank.tasks.done, blank.tasks.open, blank.tasks.overdue, blank.tasks.next, blank.risks, blank.issues, blank.assumptions, blank.dependencies, blank.changes, blank.decisions, blank.decisions_needed, blank.lessons, blank.meetings];
for (const s of sections) assert.deepEqual([s.count, s.table, s.list], [0, '', '']);
assert.equal(blank.project.rag_label, 'Not set');
assert.equal(blank.project.budget_left, '');
assert.equal(blank.status.headline, 'Not set: no reason given');
assert.equal(blank.status.progress, '0 tasks done this period; 0 of 0 overall (0%). 0 overdue.');
assert.equal(blank.status.next_steps, 'Nothing due in the next two weeks.');
console.log('report-model: ok');

// A Friday-evening Toronto finish is stored as the next UTC day (fix round 1): it counts in the period ending that Friday, not the next one.
const late = { ...fixture, tasks: [...fixture.tasks, { ...fixture.tasks[0], id: 'tz', title: 'Friday night', done_at: '2026-10-24T01:00:00Z' }],
  meetings: [...fixture.meetings, { id: 'mtz', title: 'Friday call', received_at: '2026-10-24T01:30:00Z', summary: null }] };
const fri = buildReportModel(late, { from: '2026-10-12', to: '2026-10-23' }, '2026-10-19', 'now', TZ);
assert.ok(fri.tasks.done.rows.some((t) => t.title === 'Friday night' && t.done_at === '2026-10-23'), 'done 21:00 Toronto Friday is in the Friday-ending period');
assert.ok(fri.meetings.rows.some((x) => x.title === 'Friday call' && x.date === '2026-10-23'));
const next = buildReportModel(late, { from: '2026-10-24', to: '2026-10-30' }, '2026-10-25', 'now', TZ);
assert.ok(!next.tasks.done.rows.some((t) => t.title === 'Friday night') && !next.meetings.rows.some((x) => x.title === 'Friday call'), 'and not in the next one');
console.log('report-model tz: ok');

// v2.2 (C5): key numbers and the schedule against the latest baseline.
import { reportText } from '../shared/report-model.ts';
const m0 = buildReportModel(fixture, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
assert.deepEqual([m0.metrics.done_this_week, m0.metrics.open, m0.metrics.overdue_now, m0.metrics.high_risks, m0.metrics.unrated_risks], [0, 3, 1, 1, 0], 'week of Mon 19 Oct: nothing done yet; 3 open; Chase customs overdue; the 4x5 risk is high');
assert.equal(m0.metrics.remaining, 3);
assert.equal(m0.metrics.ideal_remaining, null, 'no baseline, so no ideal line (C11)'); assert.equal(m0.metrics.as_of, '2026-10-19');
assert.match(m0.metrics.line, /^0 done this week; 3 open; 1 overdue; no ideal line \(it needs a baseline and an end date\); 1 high risk\.$/);
assert.equal(m0.schedule.has_baseline, false); assert.equal(m0.schedule.summary, null); assert.equal(m0.schedule.line, 'No baseline saved.'); assert.equal(m0.schedule.late_milestones.count, 0);
const noEnd = buildReportModel({ ...fixture, project: { ...project, end_at: null } }, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
assert.equal(noEnd.metrics.ideal_remaining, null); assert.equal(noEnd.metrics.behind_ideal, null);

const baseline = { name: 'Plan v1', taken_at: '2026-09-10T15:00:00Z', snapshot: {
  tasks: [{ id: 't4', start_at: null, due_at: '2026-10-10' }, { id: 't5', start_at: null, due_at: '2026-10-24' }, { id: 'gone', start_at: null, due_at: '2026-10-01' }],
  milestones: [{ id: 'm2', due_at: '2026-10-05' }, { id: 'm3', due_at: '2026-10-22' }, { id: 'm4', due_at: '2026-11-20' }], project: { start_at: '2026-09-01', end_at: '2026-11-25' } } };
const sm = buildReportModel({ ...fixture, baseline }, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
assert.equal(typeof sm.metrics.ideal_remaining, 'number', 'with a baseline and an end date there is an ideal line'); assert.match(sm.metrics.line, /3 open against [\d.]+ ideal \(\d[\d.]* (ahead|behind)\)/);
assert.equal(sm.schedule.has_baseline, true); assert.equal(sm.schedule.baseline_name, 'Plan v1'); assert.equal(sm.schedule.taken_at, '2026-09-10');
assert.deepEqual([sm.schedule.summary!.late, sm.schedule.summary!.early, sm.schedule.summary!.dropped, sm.schedule.summary!.milestones_late, sm.schedule.summary!.project_end_delta], [3, 0, 1, 2, 6]);
assert.deepEqual(sm.schedule.late_milestones.rows.map((x) => [x.name, x.days_late]), [['Wave 3', 10], ['Pilot', 5]], 'late milestones, biggest first: Pilot 5 Oct to 10 Oct, Wave 3 20 Nov to 30 Nov');
assert.equal(sm.schedule.late_milestones.table.split('\n')[0], 'Milestone | Baseline | Now | Days late');
assert.match(sm.schedule.line, /^\d+ items compared; 3 later \(average [\d.]+ days, up to 10\); 0 earlier; 2 milestones late; project end \+6 days\.$/);
// A subtask in the baseline is compared too, while the report's own lists stay top-level.
const sub = buildReportModel({ ...fixture, tasks: [...fixture.tasks, { ...fixture.tasks[4], id: 'sub', parent_id: 't5', title: 'Sub step', due_at: '2026-10-26' }], baseline: { ...baseline, snapshot: { ...baseline.snapshot, tasks: [...baseline.snapshot.tasks, { id: 'sub', start_at: null, due_at: '2026-10-20' }] } } },
  { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
assert.equal(sub.schedule.summary!.late, 4); assert.ok(!sub.tasks.open.rows.some((t) => t.title === 'Sub step'));

// The summary request's text carries the numbers, never a baseline name or a milestone name from the schedule.
const text = reportText(sm);
assert.match(text, /Key numbers as of 2026-10-19: done this week 0, open 3, overdue now 1/);
assert.match(text, /Schedule against the baseline: compared \d+, later 3, earlier 0, unchanged \d+, added \d+, removed 1, average days late [\d.]+, most days late 10, milestones late 2, project end moved 6 days/);
assert.ok(!text.includes('Plan v1'));
assert.match(reportText(m0), /Schedule against the baseline: no baseline saved/);
console.log('report-model v2.2: ok');

// v2.5 (T10): time this period. A task entry counts for its task's project; done tasks in the period compare logged (all time) with their estimate.
{
  const te = (task_id: string | null, project_id: string | null, s: string, e: string | null) => ({ task_id, project_id, started_at: s, ended_at: e, deleted_at: null, note: 'ZZNOTE' });
  const timed = { ...fixture, tasks: fixture.tasks.map((t) => (t.id === 't1' ? { ...t, estimate_minutes: 480 } : t)), time: [
    te('t1', null, '2026-10-13T13:00:00.000Z', '2026-10-13T18:00:00.000Z'), // 5h in the period
    te('t1', null, '2026-10-01T13:00:00.000Z', '2026-10-01T17:00:00.000Z'), // 4h before it: counts for t1's total only
    te(null, 'p1', '2026-10-20T13:00:00.000Z', '2026-10-20T16:30:00.000Z'), // project entry: 3h 30m
    te('t5', null, '2026-10-21T13:00:00.000Z', '2026-10-21T17:00:00.000Z'), // open task: 4h
    te('t7', null, '2026-10-21T13:00:00.000Z', '2026-10-21T17:00:00.000Z'), // trashed task: left out
    { ...te('t5', null, '2026-10-22T13:00:00.000Z', '2026-10-22T17:00:00.000Z'), deleted_at: '2026-10-23T00:00:00.000Z' }, // trashed entry
  ] };
  const tm = buildReportModel(timed, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', '2026-10-19T12:00:00Z', TZ);
  assert.deepEqual(tm.time && [tm.time.logged_minutes, tm.time.done_logged_minutes, tm.time.done_estimated_minutes], [750, 540, 480]);
  assert.equal(tm.time!.line, 'Time logged this period: 12h 30m; done tasks: 9h of 8h estimated');
  const tt = reportText(tm);
  assert.match(tt, /Time logged this period: 12h 30m; done tasks: 9h of 8h estimated/);
  assert.ok(!tt.includes('ZZNOTE') && !tt.includes('Plan v1'));
  assert.equal(m0.time, null, 'no entries passed: no time');
  assert.ok(!reportText(m0).includes('Time logged'));
  const none = buildReportModel({ ...timed, time: [] }, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ);
  assert.equal(none.time!.line, 'Time logged this period: 0m; done tasks: 0m of 8h estimated');
  assert.equal(buildReportModel({ ...fixture, time: [] }, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now', TZ).time!.line, 'Time logged this period: 0m; done tasks: none has an estimate');
  const { BUILTINS } = await import('../web/src/docs/templates.ts');
  const doc = JSON.stringify(BUILTINS.find((b) => b.id === 'status_report')!.make(tm));
  assert.match(doc, /Time this period/); assert.match(doc, /12h 30m/);
  assert.ok(!JSON.stringify(BUILTINS.find((b) => b.id === 'status_report')!.make(m0)).includes('Time this period'));
  console.log('report-model time: ok');
}

// v2.4 (Task 3): the program form keeps the names (it is Vlad's own document); scores only when both are rated.
{
  const { buildProgramReportModel } = await import('../shared/report-model.ts');
  const { programRollup } = await import('../shared/program.ts');
  const T = '2026-10-01T12:00:00.000Z';
  const program = { id: 'g1', kind: 'work' as const, name: 'ZZPROGRAM', rag: 'green' as const, rag_reason: 'ZZREASON', notes: null, sort: 0, enc_v: 0, created_at: T, updated_at: T, deleted_at: null };
  const projects = [{ ...project, id: 'p1', name: 'ZZPROJ1', rag: 'red' as const, program_id: 'g1', deleted_at: null }];
  const milestones = [{ id: 'm1', project_id: 'p1', name: 'ZZMS', due_at: '2026-11-01T04:30:00.000Z', done_at: null, gate: 0, sort: 0, enc_v: 0, created_at: T, updated_at: T, deleted_at: null }];
  const rollup = programRollup({ program, projects, tasks: [], milestones, detail: { baselines: [] }, today: '2026-10-25', tz: TZ });
  const risks = [{ id: 'r1', project_id: 'p1', title: 'ZZRISK', probability: 4, impact: 5 }, { id: 'r2', project_id: 'p1', title: 'Unrated', probability: null, impact: 3 }];
  const pm = buildProgramReportModel({ program, rollup, risks, projects }, '2026-10-25', '2026-10-25T12:00:00Z', TZ);
  assert.equal(pm.kind, 'program'); assert.equal(pm.title, 'ZZPROGRAM'); assert.equal(pm.rag, 'green'); assert.equal(pm.rag_reason, 'ZZREASON'); assert.equal(pm.worst, 'red');
  assert.equal(pm.sentence, 'You say green; one project is red');
  assert.equal(pm.projects[0].name, 'ZZPROJ1');
  assert.deepEqual(pm.upcoming, [{ project_id: 'p1', name: 'ZZMS', due_at: '2026-11-01' }], 'due as the local day in tz (00:30 Toronto on 1 Nov)');
  assert.equal(pm.projects[0].next_milestone?.due_at, '2026-11-01');
  assert.deepEqual(pm.risks, [{ title: 'ZZRISK', project: 'ZZPROJ1', score: 20 }, { title: 'Unrated', project: 'ZZPROJ1', score: null }]);
  assert.equal(pm.as_of, '2026-10-25'); assert.equal(pm.summary, undefined);
  const { programDoc } = await import('../web/src/docs/templates.ts');
  const sl = { compared: 3, late: 2, early: 0, unchanged: 1, added: 0, dropped: 0, avg_late: 3, max_late: 5, milestones_late: 2, project_end_delta: null };
  const lateDoc = JSON.stringify(programDoc({ ...pm, budget: { rows: [], totals: [] }, projects: [{ ...pm.projects[0], slip: sl as never }] }));
  assert.match(lateDoc, /2 later, up to 5 days · 2 milestones late/);
  console.log('report-model program: ok');
}
