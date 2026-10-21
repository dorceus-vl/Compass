import type { ReportInput, ReportModel, Section } from './types.ts';
import { slip } from './baseline.ts';
import { dashboardMetrics, localDay as toLocalDay, addDaysYmd, daysBetweenYmd } from './dashboard.ts';

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
const txt = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const cell = (s: string | number) => String(s).replace(/\s+/g, ' ').replaceAll('|', '/').trim();
const addDays = addDaysYmd;
const daysBetween = daysBetweenYmd;
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

/** A stored timestamp as a date in the user's zone; a plain date passes through. A task done at 21:00 Toronto is stored as the next UTC day. */
const localDay = (tz: string) => (s: string | null | undefined) => (!s ? '' : toLocalDay(s, tz));

/** tz is settings.tz; today and the range are already local dates. */
export function buildReportModel(input: ReportInput, range: { from: string; to: string }, today: string, now: string, tz: string): ReportModel {
  const { from, to } = range;
  const local = localDay(tz);
  const inRange = (d: string) => d >= from && d <= to;
  const p = input.project;
  const live = <T extends { deleted_at: string | null }>(xs: T[]) => xs.filter((x) => !x.deleted_at);

  const tasks = live(input.tasks).filter((t) => !t.parent_id);
  const doneAll = tasks.filter((t) => t.status === 'done');
  const open = tasks.filter((t) => t.status !== 'done').sort(byDate((t) => day(t.due_at)));
  const done = doneAll.filter((t) => inRange(local(t.done_at))).sort(byDate((t) => local(t.done_at)));
  const overdue = open.filter((t) => t.due_at && day(t.due_at) < today).map((t) => ({ title: txt(t.title), due_at: day(t.due_at), days_late: daysBetween(day(t.due_at), today) }));
  const next = open.filter((t) => t.due_at && day(t.due_at) >= today && day(t.due_at) <= addDays(today, 14));
  const pct = tasks.length ? Math.round((100 * doneAll.length) / tasks.length) : 0;

  const milestones = live(input.milestones).sort((a, b) => (day(a.due_at) || '9999').localeCompare(day(b.due_at) || '9999') || a.sort - b.sort).map((m) => {
    const due = day(m.due_at);
    const state = m.done_at ? 'Done' : due && due < today ? 'Late' : due && inRange(due) ? 'Due this period' : 'Upcoming';
    return { name: txt(m.name), due_at: due, done_at: local(m.done_at), gate: m.gate ? 'Gate' : '', state } as const;
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
  const changes = crs.map((c) => ({ id: c.id, description: (c.description ?? '').trim(), title: txt(c.title), decision: c.decision, impact_scope: txt(c.impact_scope), impact_time: txt(c.impact_time), impact_cost: txt(c.impact_cost), approver: txt(c.approver), decided_at: local(c.decided_at) }));
  const decisions = live(input.decisions).filter((d) => inRange(local(d.decided_at))).sort(byDate((d) => local(d.decided_at))).map((d) => ({ decided_at: local(d.decided_at), text: txt(d.text) }));
  const needed = crs.filter((c) => c.decision === 'pending').map((c) => ({ title: txt(c.title) }));
  const lessons = live(input.lessons).map((l) => ({ text: txt(l.text), category: txt(l.category) }));
  const meetings = input.meetings.filter((m) => inRange(local(m.received_at))).sort(byDate((m) => m.received_at)).map((m) => ({ title: txt(m.title), date: local(m.received_at), summary: txt(m.summary) }));

  // v2.2 (C5): the dashboard's key numbers, and the latest baseline against the plan now (subtasks included, as the baseline holds them).
  const bl = input.baseline ?? null;
  const dm = dashboardMetrics({ tasks: input.tasks, raid: input.raid, project: p, today, tz, baselineDay: bl ? toLocalDay(bl.taken_at, tz) : null });
  const sl = bl ? slip(bl.snapshot, input.tasks, input.milestones, p) : null;
  const msName = new Map(input.milestones.map((m) => [m.id, txt(m.name)]));
  const lateMs = (sl?.rows ?? []).filter((r) => r.kind === 'milestone' && (r.due_delta ?? 0) > 0).map((r) => ({ name: msName.get(r.id) ?? '', baseline_due: r.baseline_due ?? '', due_at: r.current_due ?? '', days_late: r.due_delta! }));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const sum = sl?.summary ?? null;
  const scheduleLine = !sum ? 'No baseline saved.' : [
    `${plural(sum.compared, 'item')} compared`, sum.late ? `${sum.late} later (average ${sum.avg_late} days, up to ${sum.max_late})` : 'none later', `${sum.early} earlier`,
    ...(sum.milestones_late ? [plural(sum.milestones_late, 'milestone') + ' late'] : []),
    ...(sum.project_end_delta ? [`project end ${sum.project_end_delta > 0 ? '+' : ''}${sum.project_end_delta} days`] : []),
  ].join('; ') + '.';
  const metricsLine = `${dm.done_this_week} done this week; ${dm.open} open; ${dm.overdue_now} overdue; ` +
    (dm.behind_ideal === null ? 'no ideal line (it needs a baseline and an end date); ' : `${dm.remaining} open against ${dm.ideal_remaining} ideal (${dm.behind_ideal > 0 ? `${dm.behind_ideal} behind` : dm.behind_ideal < 0 ? `${-dm.behind_ideal} ahead` : 'on the line'}); `) +
    `${dm.high_risks} high risk${dm.high_risks === 1 ? '' : 's'}.`;

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
      done: sec(done.map((t) => ({ title: txt(t.title), done_at: local(t.done_at) })), ['Task', 'Done'], (t) => [t.title, t.done_at], (t) => t.title),
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
    schedule: {
      has_baseline: !!bl, baseline_name: bl ? txt(bl.name) : '', taken_at: bl ? local(bl.taken_at) : '', summary: sum, line: scheduleLine,
      late_milestones: sec(lateMs, ['Milestone', 'Baseline', 'Now', 'Days late'], (m) => [m.name, m.baseline_due, m.due_at, m.days_late], (m) => `${m.name} (${m.days_late} days late)`),
    },
    metrics: { ...dm, as_of: today, line: metricsLine },
    ai: { summary: '' },
  };
}

/** The model's view of the report for the summary request: only sections with rows, as plain lines (the caller fences it). The key numbers and the schedule are numbers only, never a name. */
export function reportText(m: ReportModel): string {
  const part = (title: string, body: string) => (body ? `${title}:\n${body}` : '');
  const x = m.metrics, s = m.schedule.summary;
  return [
    `Project: ${m.project.name} (${m.project.phase || 'phase not set'})`, `Period: ${m.range.label}`, `Status: ${m.status.headline}`, `Progress: ${m.status.progress}`,
    `Key numbers as of ${m.metrics.as_of}: done this week ${x.done_this_week}, open ${x.open}, overdue now ${x.overdue_now}, open tasks ${x.remaining}, ideal ${x.ideal_remaining ?? 'n/a'}, behind the ideal ${x.behind_ideal ?? 'n/a'}, high risks ${x.high_risks}, unrated risks ${x.unrated_risks}`,
    s ? `Schedule against the baseline: compared ${s.compared}, later ${s.late}, earlier ${s.early}, unchanged ${s.unchanged}, added ${s.added}, removed ${s.dropped}, average days late ${s.avg_late}, most days late ${s.max_late}, milestones late ${s.milestones_late}, project end moved ${s.project_end_delta ?? 'n/a'} days` : 'Schedule against the baseline: no baseline saved',
    part('Done this period', m.tasks.done.list), part('Overdue', m.tasks.overdue.list), part('Due in the next two weeks', m.tasks.next.list), part('Milestones', m.milestones.list),
    part('Open risks', m.risks.list), part('Open issues', m.issues.list), part('Decisions needed', m.decisions_needed.list), part('Decisions made', m.decisions.list),
  ].filter(Boolean).join('\n\n');
}
