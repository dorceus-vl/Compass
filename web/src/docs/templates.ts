import type { MeetingReview, ReportModel } from '../../../shared/types.ts';

export type DocBlock = { t: 'p'; text: string } | { t: 'list'; items: string[] } | { t: 'table'; headers: string[]; rows: string[][] } | { t: 'fields'; pairs: [string, string][] };
export type TemplateDoc = { title: string; subtitle: string; sections: { heading: string; blocks: DocBlock[] }[] };
export type BuiltinId = 'charter' | 'raid_log' | 'raci' | 'wbs' | 'status_report' | 'change_request' | 'exception_report' | 'lessons_learned';

const p = (text = ''): DocBlock => ({ t: 'p', text });
const fields = (...pairs: [string, string][]): DocBlock => ({ t: 'fields', pairs });
const list = (items: string[], none = 'None.'): DocBlock => (items.length ? { t: 'list', items } : p(none));
const table = (headers: string[], rows: (string | number)[][], none = 'None.'): DocBlock => (rows.length ? { t: 'table', headers, rows: rows.map((r) => r.map(String)) } : p(none));
const sec = (heading: string, ...blocks: DocBlock[]) => ({ heading, blocks });
const sub = (m: ReportModel) => `${m.project.name} · ${m.range.label}`;
const budget = (m: ReportModel) => m.project.budget_planned;

const riskTable = (m: ReportModel, top = m.risks.rows.length) => table(['Risk', 'P', 'I', 'Score', 'Owner', 'Response'], m.risks.rows.slice(0, top).map((r) => [r.text, r.probability, r.impact, r.score, r.owner, r.response]), 'No open risks.');
const issueTable = (m: ReportModel) => table(['Issue', 'Impact', 'Owner', 'Response'], m.issues.rows.map((r) => [r.text, r.impact, r.owner, r.response]), 'No open issues.');
const riskAndIssues = (m: ReportModel) => sec('Risks and issues', p('Risks'), riskTable(m), p('Issues'), issueTable(m));
const msTable = (m: ReportModel) => table(['Milestone', 'Due', 'State'], m.milestones.rows.map((x) => [x.name, x.due_at, x.state]), 'No milestones.');

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
      sec('Progress', list(m.tasks.done.rows.map((t) => t.title), 'No tasks were completed this period.')),
      sec('Next steps', list(m.tasks.next.rows.map((t) => `${t.title} (${t.due_at})`), m.status.next_steps)),
      sec('Milestones', msTable(m)),
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

export function minutesDoc(meeting: MeetingReview, projectName: string | null): TemplateDoc {
  const date = meeting.received_at.slice(0, 10);
  return {
    title: 'Meeting minutes', subtitle: [meeting.title, projectName].filter(Boolean).join(' · '),
    sections: [
      sec('Meeting', fields(['Title', meeting.title], ['Date', date], ['Project', projectName ?? ''])),
      sec('Summary', p(meeting.summary ?? '')),
      sec('Decisions', list(meeting.decisions.map((d) => d.text))),
      sec('Action items', table(['Action', 'Owner', 'Due'], meeting.action_items.map((a) => [a.text, a.owner ?? '', a.due ?? '']), 'No action items.')),
      sec('Open questions', list(meeting.open_questions.map((q) => q.text))),
      sec('Important notes', list(meeting.important_notes.map((n) => n.text))),
    ],
  };
}
