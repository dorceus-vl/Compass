import { useEffect, useMemo, useRef, useState } from 'react';
import type { Program, ProgramDetail, Rag } from '../../../shared/types.ts';
import { programRollup, type BudgetRow } from '../../../shared/program.ts';
import { localDay } from '../../../shared/dashboard.ts';
import { online, SignedOut } from '../api.ts';
import { useStore } from '../store/useStore.ts';
import { Link, navigate } from '../router.ts';
import { todayIn } from '../dates.ts';
import { RagPill } from '../ui/ProjectCard.tsx';
import { ChartFrame } from '../ui/Chart.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import { useSlider } from '../ui/Shell.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { useTz } from './project/Report.tsx';
import { loadProgramDetail, updateProgram, trashProgram, OFFLINE_LINE } from '../programs.ts';

const TABS = ['overview', 'budget', 'report'] as const;
const TAB_LABEL: Record<string, string> = { overview: 'Overview', budget: 'Budget', report: 'Report' };
const RAG_WORD: Record<Rag, string> = { green: 'Green', amber: 'Amber', red: 'Red', none: 'None' };
const money = (n: number | null, currency: string) => (n == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n));
const plain = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** `/programs/:id[/:tab]`: Overview (RAG pair, members, milestones, risks), Budget, Report (Task 3). */
export function ProgramPage({ id, tab = 'overview' }: { id: string; tab?: string }) {
  const { projects, tasks, milestones, ready } = useStore();
  const tz = useTz();
  const [s, set] = useState<{ detail: ProgramDetail | null; offline: boolean; loaded: boolean }>({ detail: null, offline: false, loaded: false });
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);
  useEffect(() => {
    let live = true;
    loadProgramDetail(id).then(({ data, offline }) => { if (live) set({ detail: data, offline, loaded: true }); })
      .catch(() => {}); // only SignedOut reaches here (cached() turns every other failure into an answer); the app signs out
    return () => { live = false; };
  }, [id, n]);
  const current = (TABS as readonly string[]).includes(tab) ? tab : 'overview';
  const nav = useRef<HTMLElement>(null), pill = useRef<HTMLSpanElement>(null);
  useSlider(nav, pill, `${current}:${s.detail ? id : ''}`, 'a[aria-selected="true"]');
  const today = todayIn(tz);
  const roll = useMemo(() => (s.detail ? programRollup({ program: s.detail.program, projects, tasks, milestones, detail: s.detail, today, tz }) : null), [s.detail, projects, tasks, milestones, today, tz]);
  if (!ready || !s.loaded) return null;
  if (!s.detail || !roll) return <p>{s.offline ? 'This program isn’t on this device yet. Open it once while online.' : 'Program not found.'}</p>;
  const g = s.detail.program, canWrite = !s.offline && online();
  const save = async (patch: Partial<Program>) => {
    if (!canWrite) { toast(OFFLINE_LINE); return; }
    try { await updateProgram(g.id, patch); } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
    reload();
  };
  const text = (key: 'name' | 'rag_reason' | 'notes', v: string) => { const t = v.trim() || null; if (t !== g[key] && (t || key !== 'name')) void save({ [key]: t }); };
  const trash = async () => {
    if (!canWrite) { toast(OFFLINE_LINE); return; }
    if (!(await confirmAction(`Move "${g.name}" to Trash? Its projects stay and show under No program.`, { danger: true }))) return;
    try { await trashProgram(g.id); toast('Moved to Trash'); navigate('/programs'); } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
  };
  const name = (pid: string) => projects.find((p) => p.id === pid)?.name ?? 'Project';
  return (
    <>
      <header className="phead">
        <div className="ptx">
          <div className="eyebrow"><Link to="/programs">Programs</Link> · {g.kind} program</div>
          <input key={`${g.id}:${g.updated_at}`} className="pname" defaultValue={g.name} disabled={!canWrite} maxLength={120} onBlur={(e) => text('name', e.target.value)} aria-label="Program name" />
        </div>
        {!canWrite && <p className="sub" role="status">{s.offline ? 'Offline: showing the last copy. ' : ''}{OFFLINE_LINE}.</p>}
      </header>
      <nav className="tabs" role="tablist" aria-label="Program sections" ref={nav}>
        <span className="slide" ref={pill} aria-hidden="true" />
        {TABS.map((t) => <Link key={t} to={`/programs/${g.id}${t === 'overview' ? '' : `/${t}`}`} role="tab" aria-selected={current === t}>{TAB_LABEL[t]}</Link>)}
      </nav>
      <div className="pbody">
        {current === 'overview' && <div className="pover">
          <section className="qgrid">
            <div className="qcard"><h3>Status</h3>
              <div className="prog-pair">
                <div><span className="eyebrow">You</span>
                  <select className="field" aria-label="Program RAG" value={g.rag} disabled={!canWrite} onChange={(e) => void save({ rag: e.target.value as Rag })}>
                    <option value="none">RAG: none</option><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option></select></div>
                <div><span className="eyebrow">Projects</span><RagPill rag={roll.worst} /></div>
              </div>
              {roll.sentence && <p className="hint" role="note">{roll.sentence}</p>}
              <label className="qf">RAG reason<input key={`r:${g.updated_at}`} className="field" defaultValue={g.rag_reason ?? ''} maxLength={500} disabled={!canWrite} onBlur={(e) => text('rag_reason', e.target.value)} /></label>
            </div>
            <div className="qcard"><h3>Notes</h3>
              <textarea key={`n:${g.updated_at}`} className="field" rows={5} aria-label="Notes" defaultValue={g.notes ?? ''} maxLength={4000} disabled={!canWrite} onBlur={(e) => text('notes', e.target.value)} /></div>
          </section>
          <section><SectionHead eyebrow="Projects" title="In this program" />
            {roll.projects.length ? <div className="scroll-x"><table className="sh-table">
              <thead><tr><th scope="col">Project</th><th scope="col">RAG</th><th scope="col">Done</th><th scope="col">Schedule</th><th scope="col">Next milestone</th></tr></thead>
              <tbody>{roll.projects.map((p) => <tr key={p.id}>
                <th scope="row"><Link to={`/projects/${p.id}`}>{p.name}</Link></th>
                <td><RagPill rag={p.rag} /></td>
                <td className="mono">{p.pct_done}%</td>
                <td>{!p.slip ? 'no baseline' : p.slip.late ? `+${p.slip.max_late} day${p.slip.max_late === 1 ? '' : 's'} late` : 'on plan'}</td>
                <td>{p.next_milestone ? <>{p.next_milestone.name} <span className="mono">{localDay(p.next_milestone.due_at, tz)}</span></> : '—'}</td>
              </tr>)}</tbody></table></div>
              : <p className="hint">No projects yet. Pick this program on a project's Overview, under Program.</p>}
          </section>
          <section><SectionHead eyebrow="Next 30 days" title="Upcoming milestones" />
            {roll.upcoming.length ? <ul className="prog-list">{roll.upcoming.map((m, i) => <li key={i}><span className="mono">{localDay(m.due_at, tz)}</span> {m.name} <span className="sub">{name(m.project_id)}</span></li>)}</ul>
              : <p className="hint">No milestone due in the next 30 days.</p>}
          </section>
          <section><SectionHead eyebrow="RAID" title="Top risks" />
            {s.detail.risks.length ? <ul className="prog-list">{s.detail.risks.map((r) => <li key={r.id}><span className="mono">{r.probability != null && r.impact != null ? `${r.probability * r.impact}` : 'unrated'}</span> {r.title} <span className="sub">{name(r.project_id)}</span></li>)}</ul>
              : <p className="hint">No open risks.</p>}
          </section>
          <div><button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={!canWrite} onClick={() => void trash()}>Move to Trash</button></div>
        </div>}
        {current === 'budget' && <Budget rows={roll.budget.rows} totals={roll.budget.totals} name={name} />}
        {current === 'report' && <p className="hint">Report comes in the next step</p>}
      </div>
    </>
  );
}

function barLabel(r: BudgetRow) {
  return `Spent ${r.currency} ${plain(r.spent ?? 0)} of ${plain(r.planned!)}${r.forecast != null ? `; forecast ${plain(r.forecast)}` : ''}${(r.spent ?? 0) > r.planned! ? ' (over plan)' : ''}`;
}

/** Budget tab: one bar per project with a plan (spent solid, forecast outline, plan a tick), each to its own scale; the table and totals per currency. */
function Budget({ rows, totals, name }: { rows: BudgetRow[]; totals: ReturnType<typeof programRollup>['budget']['totals']; name: (id: string) => string }) {
  const planned = rows.filter((r) => r.planned != null && r.planned > 0);
  const summary = planned.length
    ? `${planned.length} project${planned.length === 1 ? '' : 's'} with a planned budget. ${totals.map((t) => `${t.currency}: ${t.pct_spent ?? 0}% spent, forecast ${t.variance > 0 ? `${plain(t.variance)} over` : t.variance < 0 ? `${plain(-t.variance)} under` : 'on'} plan`).join('. ')}. Each bar is drawn to its own scale.`
    : 'No project in this program has a planned budget yet.';
  return (
    <div className="pover">
      <div className="card"><ChartFrame id="prog-budget" title="Spent against plan" summary={summary}
        table={{ head: ['Project', 'Currency', 'Planned', 'Spent', 'Forecast', 'Variance', '% spent'], rows: rows.map((r) => [name(r.project_id), r.currency, r.planned ?? '', r.spent ?? '', r.forecast ?? '', r.variance ?? '', r.pct_spent ?? '']) }}>
        {(_w, by) => planned.length ? <div className="pb" role="group" aria-label="Spent, forecast and planned budget per project" aria-describedby={by}>
          {planned.map((r) => {
            const max = Math.max(r.planned!, r.spent ?? 0, r.forecast ?? 0), pc = (v: number) => `${(100 * v) / max}%`;
            return <div key={r.project_id} className="pb-row">
              <div className="pb-label"><b>{name(r.project_id)}</b> {barLabel(r)}</div>
              <div className="pb-bar" aria-hidden="true">
                {r.forecast != null && <i className="pb-forecast" style={{ width: pc(r.forecast) }} />}
                <i className="pb-spent" style={{ width: pc(r.spent ?? 0) }} />
                <i className="pb-plan" style={{ left: pc(r.planned!) }} />
              </div>
            </div>;
          })}
        </div> : <p className="hint" aria-describedby={by}>{summary}</p>}
      </ChartFrame>
        <p className="hint">Solid bar: spent. Outline: forecast at completion. Tick: planned.</p></div>
      <section><SectionHead eyebrow="Totals" title="Per currency" />
        {totals.length ? <div className="scroll-x"><table className="sh-table">
          <thead><tr><th scope="col">Currency</th><th scope="col">Projects</th><th scope="col">Planned</th><th scope="col">Spent</th><th scope="col">Forecast</th><th scope="col">Variance</th><th scope="col">% spent</th></tr></thead>
          <tbody>{totals.map((t) => <tr key={t.currency}><th scope="row">{t.currency}</th><td className="mono">{t.projects}</td><td className="mono">{money(t.planned, t.currency)}</td><td className="mono">{money(t.spent, t.currency)}</td>
            <td className="mono">{money(t.forecast, t.currency)}</td><td className="mono">{t.variance > 0 ? '+' : ''}{money(t.variance, t.currency)}</td><td className="mono">{t.pct_spent == null ? '—' : `${t.pct_spent}%`}</td></tr>)}</tbody></table></div>
          : <p className="hint">No totals: set a planned budget on a project's Overview.</p>}
        <p className="hint">A project with no planned budget joins no total; a missing forecast counts as the plan.</p>
      </section>
    </div>
  );
}
