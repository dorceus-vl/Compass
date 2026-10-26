import type { ReportModel } from '../../../shared/types.ts';
import type { ProgramReportModel } from '../../../shared/report-model.ts';
import { p, fields, list, table, sec, type TemplateDoc } from '../../../shared/doc-model.ts';
import { formatEstimate } from '../../../shared/workload.ts';

export type BuiltinId = 'charter' | 'raid_log' | 'raci' | 'wbs' | 'status_report' | 'change_request' | 'exception_report' | 'lessons_learned';

const sub = (m: ReportModel) => `${m.project.name} · ${m.range.label}`;
const budget = (m: ReportModel) => m.project.budget_planned;

const riskTable = (m: ReportModel, top = m.risks.rows.length) => table(['Risk', 'P', 'I', 'Score', 'Owner', 'Response'], m.risks.rows.slice(0, top).map((r) => [r.text, r.probability, r.impact, r.score, r.owner, r.response]), 'No open risks.');
const issueTable = (m: ReportModel) => table(['Issue', 'Impact', 'Owner', 'Response'], m.issues.rows.map((r) => [r.text, r.impact, r.owner, r.response]), 'No open issues.');
const riskAndIssues = (m: ReportModel) => sec('Risks and issues', p('Risks'), riskTable(m), p('Issues'), issueTable(m));
const msTable = (m: ReportModel) => table(['Milestone', 'Due', 'State'], m.milestones.rows.map((x) => [x.name, x.due_at, x.state]), 'No milestones.');

const num = (n: number | null) => (n === null ? 'n/a' : String(n));
/** v2.2 (C5): the dashboard's numbers as label/value lines. */
const keyNumbers = (m: ReportModel) => sec(`Key numbers as of ${m.metrics.as_of}`, fields(
  ['Done this week', String(m.metrics.done_this_week)], ['Open tasks', String(m.metrics.open)], ['Overdue now', String(m.metrics.overdue_now)],
  ['Burndown', m.metrics.ideal_remaining === null ? `${m.metrics.remaining} open; no ideal line (it needs a baseline and an end date)` : `${m.metrics.remaining} open against ${m.metrics.ideal_remaining} ideal`],
  ['High risks', String(m.metrics.high_risks)], ['Unrated risks', num(m.metrics.unrated_risks)]));
const scheduleVsBaseline = (m: ReportModel) => sec('Schedule vs baseline',
  p(m.schedule.has_baseline ? `Against "${m.schedule.baseline_name}", saved ${m.schedule.taken_at}. ${m.schedule.line}` : 'No baseline saved.'),
  ...(m.schedule.late_milestones.count ? [table(['Milestone', 'Baseline', 'Now', 'Days late'], m.schedule.late_milestones.rows.map((x) => [x.name, x.baseline_due, x.due_at, x.days_late]))] : []));

/** Open tasks go under the first dated milestone whose date is on or after the task's due date; the rest are "Other work". */
function wbs(m: ReportModel): TemplateDoc {
  const ms = m.milestones.rows, tasks = [...m.tasks.open.rows];
  const placed = ms.map(() => [] as string[]);
  const other: string[] = [];
  for (const t of tasks) {
    const i = t.due_at ? ms.findIndex((x) => x.due_at && t.due_at <= x.due_at) : -1;
    (i < 0 ? other : placed[i]).push(t.title);
  }
  return {
    title: 'Work breakdown structure', subtitle: sub(m),
    sections: [
      ...ms.map((x, i) => sec(`${i + 1}. ${x.name}`, ...(placed[i].length ? placed[i].map((t, j) => p(`${i + 1}.${j + 1} ${t}`)) : [p('No open tasks.')]))),
      ...(other.length ? [sec('Other work', list(other))] : []),
    ],
  };
}

function changeDoc(m: ReportModel, changeId?: string): TemplateDoc {
  const c = (changeId ? m.changes.rows.find((x) => x.id === changeId) : undefined) ?? [...m.changes.rows].reverse().find((x) => x.decision === 'pending');
  return {
    title: 'Change request', subtitle: sub(m),
    sections: [
      sec('Request', fields(['Project', m.project.name], ['Title', c?.title ?? ''], ['Approver', c?.approver ?? ''], ['Decision', c?.decision ?? ''], ['Date', c?.decided_at ?? ''])),
      sec('Description', p(c?.description ?? '')),
      sec('Impact', fields(['Scope', c?.impact_scope ?? ''], ['Time', c?.impact_time ?? ''], ['Cost', c?.impact_cost ?? ''])),
      sec('Recommendation', p()),
    ],
  };
}

export const BUILTINS: { id: BuiltinId; name: string; guide: string; make: (m: ReportModel, opts?: { changeId?: string }) => TemplateDoc }[] = [
  { id: 'charter', name: 'Project charter', guide: 'template-charter', make: (m) => ({
    title: 'Project charter', subtitle: sub(m),
    sections: [
      sec('Summary', fields(['Project', m.project.name], ['Sponsor', m.project.sponsor], ['Phase', m.project.phase], ['Start', m.project.start_at], ['End', m.project.end_at], ['Budget', budget(m)])),
      sec('Objectives', p(m.project.objectives)),
      sec('Scope', fields(['In scope', m.project.scope_in], ['Out of scope', m.project.scope_out])),
      sec('Success criteria', p(m.project.success_criteria)),
      sec('Milestones', table(['Milestone', 'Due', 'Gate'], m.milestones.rows.map((x) => [x.name, x.due_at, x.gate]), 'No milestones.')),
      sec('Key risks', riskTable(m, 5)),
      sec('Approvals', fields(['Sponsor', ''], ['Project manager', ''], ['Date', ''])),
    ],
  }) },
  { id: 'raid_log', name: 'RAID log', guide: 'template-raid-log', make: (m) => ({
    title: 'RAID log', subtitle: sub(m),
    sections: [
      sec('Risks', riskTable(m)),
      sec('Assumptions', table(['Assumption'], m.assumptions.rows.map((r) => [r.text]), 'No open assumptions.')),
      sec('Issues', issueTable(m)),
      sec('Dependencies', table(['Dependency', 'Owner'], m.dependencies.rows.map((r) => [r.text, r.owner]), 'No open dependencies.')),
    ],
  }) },
  { id: 'raci', name: 'RACI matrix', guide: 'template-raci', make: (m) => ({
    title: 'RACI matrix', subtitle: sub(m),
    sections: [sec('Deliverables',
      { t: 'table', headers: ['Deliverable', 'Sponsor', 'Project manager', 'Team', 'Vendor', 'Operations'],
        rows: (m.milestones.count ? m.milestones.rows.map((x) => x.name) : [1, 2, 3, 4, 5].map((n) => `Deliverable ${n}`)).map((d) => [d, '', '', '', '', '']) },
      p('R = responsible, A = accountable, C = consulted, I = informed. One A per row.'))],
  }) },
  { id: 'wbs', name: 'Work breakdown', guide: 'template-wbs', make: wbs },
  { id: 'status_report', name: 'Status report', guide: 'template-status-report', make: (m) => ({
    title: 'Status report', subtitle: sub(m),
    sections: [
      sec('Overall status', fields(['RAG', m.project.rag_label], ['Reason', m.project.rag_reason], ['Period', m.range.label])),
      sec('Executive summary', p(m.ai.summary || m.status.progress)),
      keyNumbers(m),
      ...(m.time ? [sec('Time this period', fields(['Logged', formatEstimate(m.time.logged_minutes)],
        ['Done tasks', m.time.done_estimated_minutes ? `${formatEstimate(m.time.done_logged_minutes)} of ${formatEstimate(m.time.done_estimated_minutes)} estimated` : 'None has an estimate']))] : []),
      sec('Progress', list(m.tasks.done.rows.map((t) => t.title), 'No tasks were completed this period.')),
      sec('Next steps', list(m.tasks.next.rows.map((t) => `${t.title} (${t.due_at})`), m.status.next_steps)),
      sec('Milestones', msTable(m)),
      scheduleVsBaseline(m),
      riskAndIssues(m),
      sec('Decisions needed', list(m.decisions_needed.rows.map((d) => d.title))),
      sec('Decisions made', table(['Date', 'Decision'], m.decisions.rows.map((d) => [d.decided_at, d.text]), 'No decisions this period.')),
    ],
  }) },
  { id: 'change_request', name: 'Change request', guide: 'template-change-request', make: (m, opts) => changeDoc(m, opts?.changeId) },
  { id: 'exception_report', name: 'Exception report', guide: 'template-exception-report', make: (m) => ({
    title: 'Exception report', subtitle: sub(m),
    sections: [
      sec('Situation', fields(['Project', m.project.name], ['RAG', m.project.rag_label], ['Reason', m.project.rag_reason])),
      sec('Cause', p()),
      sec('Consequences', p('Overdue tasks'), list(m.tasks.overdue.rows.map((t) => `${t.title} (${t.days_late} days late)`)),
        p('Late milestones'), list(m.milestones.rows.filter((x) => x.state === 'Late').map((x) => `${x.name} (due ${x.due_at})`))),
      sec('Options', { t: 'table', headers: ['Option', 'Description', 'Trade-offs'], rows: [['Option A', '', ''], ['Option B', '', ''], ['Option C', '', '']] }),
      sec('Recommendation', p(m.ai.summary)),
      riskAndIssues(m),
    ],
  }) },
  { id: 'lessons_learned', name: 'Lessons learned', guide: 'template-lessons-learned', make: (m) => ({
    title: 'Lessons learned', subtitle: sub(m),
    sections: [
      sec('Project summary', fields(['Project', m.project.name], ['Sponsor', m.project.sponsor], ['Phase', m.project.phase], ['Start', m.project.start_at], ['End', m.project.end_at], ['Budget planned', m.project.budget_planned], ['Budget spent', m.project.budget_spent])),
      sec('What went well', p()),
      sec('What to improve', p()),
      sec('Lessons', table(['Lesson', 'Category'], m.lessons.rows.map((l) => [l.text, l.category]), 'No lessons logged.')),
      sec('Actions for next time', p()),
    ],
  }) },
];

// v2.4 (Task 3): the program status report (Word, Markdown and print share it, as the project report does).
const RAG_WORD: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red', none: 'Not set' };
const money = (n: number | null, currency: string) => (n == null ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n));
const schedule = (s: ProgramReportModel['projects'][number]['slip']) => (!s ? 'No baseline' : s.late ? `${s.late} later, up to ${s.max_late} days${s.milestones_late ? ` · ${s.milestones_late} milestone${s.milestones_late === 1 ? '' : 's'} late` : ''}` : 'On plan');
export function programDoc(m: ProgramReportModel): TemplateDoc {
  const pname = (id: string) => m.projects.find((p) => p.id === id)?.name ?? '';
  const timed = m.projects.some((x) => x.minutes != null);
  return {
    title: 'Program status report', subtitle: `${m.title} · as of ${m.as_of}`,
    sections: [
      sec('Overall status', fields(['Your RAG', RAG_WORD[m.rag]], ['Reason', m.rag_reason], ['Worst project RAG', RAG_WORD[m.worst]]), ...(m.sentence ? [p(m.sentence + '.')] : [])),
      sec('Executive summary', p(m.summary || `${m.projects.length} project${m.projects.length === 1 ? '' : 's'}; ${m.upcoming.length} milestone${m.upcoming.length === 1 ? '' : 's'} due in the next 30 days.`)),
      sec('Projects', table(['Project', 'RAG', 'Done', 'Schedule', 'Next milestone', ...(timed ? ['Time logged'] : [])],
        m.projects.map((x) => [x.name, RAG_WORD[x.rag], `${x.pct_done}%`, schedule(x.slip), x.next_milestone ? `${x.next_milestone.name} (${x.next_milestone.due_at})` : '', ...(timed ? [formatEstimate(x.minutes ?? 0)] : [])]), 'No projects in this program.')),
      sec('Milestones in the next 30 days', table(['Due', 'Milestone', 'Project'], m.upcoming.map((u) => [u.due_at, u.name, pname(u.project_id)]), 'No milestone due in the next 30 days.')),
      sec('Top risks', table(['Risk', 'Project', 'Score'], m.risks.map((r) => [r.title, r.project, r.score ?? 'unrated']), 'No open risks.')),
      sec('Budget', table(['Project', 'Planned', 'Spent', 'Forecast', 'Variance', '% spent'],
        m.budget.rows.filter((r) => r.planned != null).map((r) => [pname(r.project_id), money(r.planned, r.currency), money(r.spent, r.currency), money(r.forecast, r.currency), money(r.variance, r.currency), r.pct_spent == null ? '' : `${r.pct_spent}%`]), 'No project has a planned budget.'),
        p('Totals per currency'), table(['Currency', 'Projects', 'Planned', 'Spent', 'Forecast', 'Variance', '% spent'],
          m.budget.totals.map((t) => [t.currency, t.projects, money(t.planned, t.currency), money(t.spent, t.currency), money(t.forecast, t.currency), money(t.variance, t.currency), t.pct_spent == null ? '' : `${t.pct_spent}%`]), 'No totals.')),
    ],
  };
}
