import type { ReportInput, Project, Milestone, Task, RaidItem, ChangeRequest, Decision, Lesson } from '../../shared/types.ts';

const stamp = { created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', deleted_at: null, enc_v: 0 };
const project = { id: 'p1', name: 'Cutover', kind: 'work', status: 'active', rag: 'amber', rag_reason: 'Vendor late', sponsor: 'Ann', objectives: 'Ship it', scope_in: null, scope_out: null,
  success_criteria: null, phase: 'Execution', start_at: '2026-09-01', end_at: '2026-12-01', budget_planned: 100, budget_spent: 40, data_boundary: 'cloud', colour: null, sort: 0, ...stamp } as Project;
const ms = (id: string, name: string, due: string, done: string | null = null, sort = 0): Milestone => ({ id, project_id: 'p1', name, due_at: due, done_at: done, gate: 0, sort, ...stamp });
const task = (id: string, title: string, o: Partial<Task>): Task => ({ id, project_id: 'p1', parent_id: null, title, notes: null, kind: 'work', horizon: 'short', status: 'new', priority: 3, start_at: null, due_at: null,
  done_at: null, estimate_minutes: null, waiting_on: null, waiting_since: null, nudge_every_days: null, recur: null, source_app: 'manual', source_kind: null, source_ref: null, source_url: null, sort_in_column: 0, tags: '', ...stamp, ...o });
const raid = (id: string, type: RaidItem['type'], text: string, o: Partial<RaidItem> = {}): RaidItem => ({ id, project_id: 'p1', type, text, probability: null, impact: null, response: null, owner: null, trigger: null, status: 'open', due_at: null, from_meeting_id: null, ...stamp, ...o });
const change = (id: string, title: string, o: Partial<ChangeRequest>): ChangeRequest => ({ id, project_id: 'p1', title, description: null, impact_scope: null, impact_time: null, impact_cost: null, decision: 'pending', approver: null, decided_at: null, ...stamp, ...o });
const decision = (id: string, text: string, at: string): Decision => ({ id, project_id: 'p1', text, decided_at: at, from_meeting_id: null, at_ref: null, ...stamp });
const lesson: Lesson = { id: 'l1', project_id: 'p1', text: 'Book windows early', category: 'planning', ...stamp };

export const fixture: ReportInput = {
  project,
  // Deliberately out of order: the model sorts by due date.
  milestones: [ms('m4', 'Wave 3', '2026-11-30'), ms('m2', 'Pilot', '2026-10-10'), ms('m1', 'Design', '2026-09-20', '2026-09-19T10:00:00Z'), ms('m3', 'Wave 2', '2026-10-22')],
  tasks: [
    task('t1', 'Order kit', { status: 'done', done_at: '2026-10-14T15:00:00Z' }), task('t2', 'Survey site', { status: 'done', done_at: '2026-10-16T15:00:00Z' }),
    task('t3', 'Old thing', { status: 'done', done_at: '2026-10-01T15:00:00Z' }), task('t4', 'Chase customs', { status: 'progress', due_at: '2026-10-16' }),
    task('t5', 'Book window', { status: 'progress', due_at: '2026-10-24' }), task('t6', 'Await invoice', { status: 'waiting', due_at: '2026-10-30', waiting_on: 'Marie' }),
    task('t7', 'Trashed task', { status: 'progress', due_at: '2026-10-20', deleted_at: '2026-10-05T00:00:00Z' }),
  ],
  raid: [raid('r1', 'risk', 'Router shortage | single source', { probability: 4, impact: 5, owner: 'Bob', response: 'Second quote' }), raid('r2', 'risk', 'Landlord access', { probability: 2, impact: 3 }),
    raid('r3', 'risk', 'Closed risk', { probability: 5, impact: 5, status: 'closed' }), raid('i1', 'issue', 'Kit at customs', { impact: 4, owner: 'Ann' }),
    raid('a1', 'assumption', 'Power at every site'), raid('d1', 'dependency', 'Billing release', { owner: 'PM' })],
  changes: [change('c1', 'Add six sites', {}), change('c2', 'Move date', { decision: 'approved', decided_at: '2026-10-13T00:00:00Z', approver: 'Ann' })],
  decisions: [decision('d1', 'Go with vendor A', '2026-10-15'), decision('d2', 'Old call', '2026-09-15')],
  lessons: [lesson],
  meetings: [{ id: 'mt1', title: 'Steering', received_at: '2026-10-15T14:00:00Z', summary: 'All good' }, { id: 'mt2', title: 'Kickoff', received_at: '2026-09-02T14:00:00Z', summary: null }],
};
