import type { ReportInput, ReportModel, Section } from './types.ts';

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
const txt = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const cell = (s: string | number) => String(s).replace(/\s+/g, ' ').replaceAll('|', '/').trim();
const addDays = (ymd: string, n: number) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
const byDate = <T>(key: (r: T) => string) => (a: T, b: T) => (key(a) || '9999').localeCompare(key(b) || '9999');

/** One section: the table is "A | B" lines under a header line, the list is "• …" lines; both '' when there are no rows. */
function sec<R>(rows: R[], headers: string[], cells: (r: R) => (string | number)[], line: (r: R) => string): Section<R> {
  return {
    rows, count: rows.length,
    table: rows.length ? [headers, ...rows.map(cells)].map((r) => r.map(cell).join(' | ')).join('\n') : '',
    list: rows.map((r) => '• ' + line(r)).join('\n'),
  };
}

const RAG: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red' };

export function buildReportModel(input: ReportInput, range: { from: string; to: string }, today: string, now: string): ReportModel {
  const { from, to } = range;
  const inRange = (d: string) => d >= from && d <= to;
  const p = input.project;
  const live = <T extends { deleted_at: string | null }>(xs: T[]) => xs.filter((x) => !x.deleted_at);

  const tasks = live(input.tasks).filter((t) => !t.parent_id);
  const doneAll = tasks.filter((t) => t.status === 'done');
  const open = tasks.filter((t) => t.status !== 'done').sort(byDate((t) => day(t.due_at)));
  const done = doneAll.filter((t) => inRange(day(t.done_at))).sort(byDate((t) => day(t.done_at)));
  const overdue = open.filter((t) => t.due_at && day(t.due_at) < today).map((t) => ({ title: txt(t.title), due_at: day(t.due_at), days_late: daysBetween(day(t.due_at), today) }));
  const next = open.filter((t) => t.due_at && day(t.due_at) >= today && day(t.due_at) <= addDays(today, 14));
  const pct = tasks.length ? Math.round((100 * doneAll.length) / tasks.length) : 0;

  const milestones = live(input.milestones).sort((a, b) => (day(a.due_at) || '9999').localeCompare(day(b.due_at) || '9999') || a.sort - b.sort).map((m) => {
    const due = day(m.due_at);
    const state = m.done_at ? 'Done' : due && due < today ? 'Late' : due && inRange(due) ? 'Due this period' : 'Upcoming';
    return { name: txt(m.name), due_at: due, done_at: day(m.done_at), gate: m.gate ? 'Gate' : '', state } as const;
  });

  const raid = live(input.raid).filter((r) => r.status === 'open');
  const risks = raid.filter((r) => r.type === 'risk').map((r) => ({
    text: txt(r.text), probability: num(r.probability), impact: num(r.impact), score: (r.probability ?? 0) * (r.impact ?? 0),
    owner: txt(r.owner), response: txt(r.response), trigger: txt(r.trigger),
  })).sort((a, b) => b.score - a.score);
  const issues = raid.filter((r) => r.type === 'issue').map((r) => ({ text: txt(r.text), impact: num(r.impact), owner: txt(r.owner), response: txt(r.response) }));
  const assumptions = raid.filter((r) => r.type === 'assumption').map((r) => ({ text: txt(r.text) }));
  const dependencies = raid.filter((r) => r.type === 'dependency').map((r) => ({ text: txt(r.text), owner: txt(r.owner) }));

  const crs = live(input.changes).sort((a, b) => a.created_at.localeCompare(b.created_at)); // oldest first: the newest pending change is the last pending row
  const changes = crs.map((c) => ({ id: c.id, description: (c.description ?? '').trim(), title: txt(c.title), decision: c.decision, impact_scope: txt(c.impact_scope), impact_time: txt(c.impact_time), impact_cost: txt(c.impact_cost), approver: txt(c.approver), decided_at: day(c.decided_at) }));
  const decisions = live(input.decisions).filter((d) => inRange(day(d.decided_at))).sort(byDate((d) => day(d.decided_at))).map((d) => ({ decided_at: day(d.decided_at), text: txt(d.text) }));
  const needed = crs.filter((c) => c.decision === 'pending').map((c) => ({ title: txt(c.title) }));
  const lessons = live(input.lessons).map((l) => ({ text: txt(l.text), category: txt(l.category) }));
  const meetings = input.meetings.filter((m) => inRange(day(m.received_at))).sort(byDate((m) => m.received_at)).map((m) => ({ title: txt(m.title), date: day(m.received_at), summary: txt(m.summary) }));

  const rag_label = RAG[p.rag] ?? 'Not set';
  const nextSteps = next.slice(0, 5).map((t) => txt(t.title)).join('; ');
  const left = p.budget_planned !== null && p.budget_spent !== null ? String(Math.round((p.budget_planned - p.budget_spent) * 100) / 100) : '';

  return {
    generated_at: now, range: { from, to, label: `${from} to ${to}` },
    project: {
      name: txt(p.name), kind: p.kind, status: p.status, phase: txt(p.phase), rag: p.rag, rag_label, rag_reason: txt(p.rag_reason), sponsor: txt(p.sponsor),
      start_at: day(p.start_at), end_at: day(p.end_at), objectives: (p.objectives ?? '').trim(), scope_in: (p.scope_in ?? '').trim(), scope_out: (p.scope_out ?? '').trim(),
      success_criteria: (p.success_criteria ?? '').trim(), budget_planned: num(p.budget_planned), budget_spent: num(p.budget_spent), budget_left: left, pct_done: pct,
    },
    milestones: sec([...milestones], ['Milestone', 'Due', 'Gate', 'State'], (m) => [m.name, m.due_at, m.gate, m.state], (m) => `${m.name} (${m.due_at || 'no date'}, ${m.state})`),
    tasks: {
      done: sec(done.map((t) => ({ title: txt(t.title), done_at: day(t.done_at) })), ['Task', 'Done'], (t) => [t.title, t.done_at], (t) => t.title),
      open: sec(open.map((t) => ({ title: txt(t.title), status: t.status, due_at: day(t.due_at), waiting_on: txt(t.waiting_on) })), ['Task', 'Status', 'Due', 'Waiting on'], (t) => [t.title, t.status, t.due_at, t.waiting_on], (t) => t.title),
      overdue: sec(overdue, ['Task', 'Due', 'Days late'], (t) => [t.title, t.due_at, t.days_late], (t) => `${t.title} (${t.days_late} days late)`),
      next: sec(next.map((t) => ({ title: txt(t.title), due_at: day(t.due_at) })), ['Task', 'Due'], (t) => [t.title, t.due_at], (t) => `${t.title} (${day(t.due_at)})`),
    },
    risks: sec(risks, ['Risk', 'P', 'I', 'Score', 'Owner', 'Response'], (r) => [r.text, r.probability, r.impact, r.score, r.owner, r.response], (r) => `${r.text} (score ${r.score})`),
    issues: sec(issues, ['Issue', 'Impact', 'Owner', 'Response'], (r) => [r.text, r.impact, r.owner, r.response], (r) => r.text),
    assumptions: sec(assumptions, ['Assumption'], (r) => [r.text], (r) => r.text),
    dependencies: sec(dependencies, ['Dependency', 'Owner'], (r) => [r.text, r.owner], (r) => r.text),
    changes: sec(changes, ['Change', 'Decision', 'Scope', 'Time', 'Cost', 'Approver', 'Decided'], (c) => [c.title, c.decision, c.impact_scope, c.impact_time, c.impact_cost, c.approver, c.decided_at], (c) => `${c.title} (${c.decision})`),
    decisions: sec(decisions, ['Date', 'Decision'], (d) => [d.decided_at, d.text], (d) => `${d.decided_at}: ${d.text}`),
    decisions_needed: sec(needed, ['Change request'], (d) => [d.title], (d) => d.title),
    lessons: sec(lessons, ['Lesson', 'Category'], (l) => [l.text, l.category], (l) => l.text),
    meetings: sec(meetings, ['Meeting', 'Date', 'Summary'], (m) => [m.title, m.date, m.summary], (m) => `${m.title} (${m.date})`),
    status: {
      headline: `${rag_label}: ${txt(p.rag_reason) || 'no reason given'}`,
      progress: `${done.length} tasks done this period; ${doneAll.length} of ${tasks.length} overall (${pct}%). ${overdue.length} overdue.`,
      next_steps: nextSteps || 'Nothing due in the next two weeks.',
    },
    ai: { summary: '' },
  };
}
