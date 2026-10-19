import assert from 'node:assert/strict';
import { buildReportModel } from '../shared/report-model.ts';
import { fixture } from './fixtures/report-input.ts';
import type { Project } from '../shared/types.ts';

const project: Project = fixture.project;

const m = buildReportModel(fixture, { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', '2026-10-19T12:00:00Z');
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
  { from: '2026-10-12', to: '2026-10-25' }, '2026-10-19', 'now');
const sections = [blank.milestones, blank.tasks.done, blank.tasks.open, blank.tasks.overdue, blank.tasks.next, blank.risks, blank.issues, blank.assumptions, blank.dependencies, blank.changes, blank.decisions, blank.decisions_needed, blank.lessons, blank.meetings];
for (const s of sections) assert.deepEqual([s.count, s.table, s.list], [0, '', '']);
assert.equal(blank.project.rag_label, 'Not set');
assert.equal(blank.project.budget_left, '');
assert.equal(blank.status.headline, 'Not set: no reason given');
assert.equal(blank.status.progress, '0 tasks done this period; 0 of 0 overall (0%). 0 overdue.');
assert.equal(blank.status.next_steps, 'Nothing due in the next two weeks.');
console.log('report-model: ok');
