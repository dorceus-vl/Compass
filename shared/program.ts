// Programs (v2.4): limits shared by the Worker and the device.
import type { Milestone, Program, ProgramDetail, Project, Rag, Task } from './types.ts';
import { slip, type SlipSummary } from './baseline.ts';
import { addDaysYmd, localDay } from './dashboard.ts';
import { projectMinutes, type REntry } from './time.ts';
import { formatEstimate } from './workload.ts';
/** Live programs at most (create and restore from Trash both check it; the list reads at most this many). */
export const MAX_PROGRAMS = 50;
export const PROGRAM_LIMITS = { name: 120, rag_reason: 500, notes: 4000 } as const;

// Roll-up (Task 2): pure, over the device mirror plus the program's detail answer, so the screens work offline and the report (Task 3) reuses it.

const RANK: Record<Rag, number> = { none: 0, green: 1, amber: 2, red: 3 };
/** The worst RAG: red > amber > green; 'none' is ignored, so all none (or nothing) is 'none'. */
export const worstRag = (rags: Rag[]): Rag => rags.reduce<Rag>((w, r) => (RANK[r] > RANK[w] ? r : w), 'none');

/** One line when Vlad's RAG for the program is not the worst of its projects; null when they agree or no project has one. */
export function ragPairSentence(set: Rag, worst: Rag, redCount: number, amberCount: number): string | null {
  if (worst === 'none' || set === worst) return null;
  const n = worst === 'red' ? redCount : worst === 'amber' ? amberCount : 0;
  const tail = worst === 'green' ? 'projects are green' : n === 1 ? `one project is ${worst}` : `${n} projects are ${worst}`;
  return `${set === 'none' ? 'You haven’t set one' : `You say ${set}`}; ${tail}`;
}

export interface BudgetRow { project_id: string; currency: string; planned: number | null; spent: number | null; forecast: number | null; variance: number | null; pct_spent: number | null }
/** P6: variance = forecast − planned (null if either is missing); % spent = spent / planned (null if planned is missing or 0), rounded. */
export function budgetRows(projects: Pick<Project, 'id' | 'currency' | 'budget_planned' | 'budget_spent' | 'budget_forecast'>[]): BudgetRow[] {
  return projects.map((p) => ({
    project_id: p.id, currency: p.currency, planned: p.budget_planned, spent: p.budget_spent, forecast: p.budget_forecast,
    variance: p.budget_forecast != null && p.budget_planned != null ? p.budget_forecast - p.budget_planned : null,
    pct_spent: p.budget_planned ? Math.round((100 * (p.budget_spent ?? 0)) / p.budget_planned) : null,
  }));
}

export interface BudgetTotal { currency: string; planned: number; spent: number; forecast: number; variance: number; pct_spent: number | null; projects: number }
/** Per currency, sorted by currency. A row with no planned budget joins no total; a missing spend counts as 0 and a missing forecast as the plan. */
export function budgetTotals(rows: BudgetRow[]): BudgetTotal[] {
  const by = new Map<string, BudgetTotal>();
  for (const r of rows) {
    if (r.planned == null) continue;
    const t = by.get(r.currency) ?? { currency: r.currency, planned: 0, spent: 0, forecast: 0, variance: 0, pct_spent: null, projects: 0 };
    t.planned += r.planned; t.spent += r.spent ?? 0; t.forecast += r.forecast ?? r.planned; t.projects++;
    by.set(r.currency, t);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency))
    .map((t) => ({ ...t, variance: t.forecast - t.planned, pct_spent: t.planned ? Math.round((100 * t.spent) / t.planned) : null }));
}

export interface ProgramProjectRow { id: string; name: string; rag: Rag; pct_done: number; next_milestone: { name: string; due_at: string } | null; slip: SlipSummary | null; minutes: number | null }
export interface ProgramRollup { worst: Rag; sentence: string | null; projects: ProgramProjectRow[]; upcoming: { project_id: string; name: string; due_at: string }[]; budget: { rows: BudgetRow[]; totals: BudgetTotal[] } }

/** Live members only; % done over live top-level tasks; slip against each member's latest baseline; milestones due in the next 30 local days; minutes logged (all time; null without `time`). */
export function programRollup(i: { program: Program; projects: Project[]; tasks: Task[]; milestones: Milestone[]; detail: Pick<ProgramDetail, 'baselines'>; today: string; tz: string; time?: { entries: REntry[]; nowMs: number } }): ProgramRollup {
  const members = i.projects.filter((p) => p.program_id === i.program.id && !p.deleted_at);
  const end = addDaysYmd(i.today, 30);
  const upcoming: ProgramRollup['upcoming'] = [];
  const rows = members.map((p): ProgramProjectRow => {
    const tasks = i.tasks.filter((t) => t.project_id === p.id && !t.deleted_at);
    const top = tasks.filter((t) => !t.parent_id);
    const open = i.milestones.filter((m) => m.project_id === p.id && !m.deleted_at && !m.done_at && m.due_at).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
    for (const m of open) { const d = localDay(m.due_at!, i.tz); if (d >= i.today && d <= end) upcoming.push({ project_id: p.id, name: m.name, due_at: m.due_at! }); }
    const base = i.detail.baselines.find((b) => b.project_id === p.id);
    return {
      id: p.id, name: p.name, rag: p.rag,
      pct_done: top.length ? Math.round((100 * top.filter((t) => t.status === 'done').length) / top.length) : 0,
      next_milestone: open[0] ? { name: open[0].name, due_at: open[0].due_at! } : null,
      slip: base ? slip(base.snapshot, tasks, i.milestones.filter((m) => m.project_id === p.id && !m.deleted_at), p).summary : null,
      minutes: i.time ? projectMinutes(i.time.entries, i.tasks, p.id, i.time.nowMs) : null,
    };
  });
  const worst = worstRag(members.map((p) => p.rag));
  const count = (r: Rag) => members.filter((p) => p.rag === r).length;
  const budget = budgetRows(members);
  return {
    worst, sentence: ragPairSentence(i.program.rag, worst, count('red'), count('amber')), projects: rows,
    upcoming: upcoming.sort((a, b) => a.due_at.localeCompare(b.due_at)), budget: { rows: budget, totals: budgetTotals(budget) },
  };
}

// Program report (Task 3, P7): the text the program summary sends to a model. Numbers and RAG words only: projects are "Project 1", "Project 2"…,
// never a program, project, milestone or risk name (nor the program's reason or notes, which are Vlad's words).
const WORD: Record<Rag, string> = { green: 'Green', amber: 'Amber', red: 'Red', none: 'not set' };
const n2 = (n: number) => String(Math.round(n * 100) / 100);
const signed = (n: number) => (n > 0 ? '+' : '') + n2(n);
const many = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function programReportText(r: ProgramRollup, program: Pick<Program, 'rag'>): string {
  const lines = [
    `Program RAG you set: ${WORD[program.rag]}. Worst project RAG: ${WORD[r.worst]}.${r.sentence ? ` ${r.sentence}.` : ''}`,
    `Projects: ${r.projects.length}. Milestones due in the next 30 days: ${r.upcoming.length}.`,
    ...r.projects.map((p, i) => {
      const s = p.slip;
      const sched = !s ? 'no baseline saved' : `${s.late} later (up to ${s.max_late} days, average ${s.avg_late}), ${s.early} earlier, ${s.unchanged} unchanged, ${s.added} added, ${s.dropped} removed, ${many(s.milestones_late, 'milestone')} late, project end moved ${s.project_end_delta ?? 'n/a'} days`;
      const b = r.budget.rows.find((x) => x.project_id === p.id);
      const money = b?.planned != null ? `; budget ${b.currency}: ${b.pct_spent ?? 0}% spent${b.variance != null ? `, forecast variance ${signed(b.variance)}` : ''}` : '';
      return `Project ${i + 1}: RAG ${WORD[p.rag]}, ${p.pct_done}% done, schedule: ${sched}${money}${p.minutes != null ? `; time logged ${formatEstimate(p.minutes)}` : ''}.`;
    }),
    r.budget.totals.length ? 'Budget totals per currency:' : 'Budget totals: no project has a planned budget.',
    ...r.budget.totals.map((t) => `${t.currency}: ${many(t.projects, 'project')}, planned ${n2(t.planned)}, spent ${n2(t.spent)}, forecast ${n2(t.forecast)}, variance ${signed(t.variance)}, ${t.pct_spent ?? 0}% spent.`),
  ];
  return lines.join('\n');
}
