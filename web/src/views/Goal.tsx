import { useEffect, useState } from 'react';
import type { Goal, GoalStatus, KeyResult } from '../../../shared/types.ts';
import { goalProgress, krProgress, expected, confidence, trend, MAX_KRS, MAX_TITLE } from '../../../shared/goals.ts';
import { localDay } from '../../../shared/dashboard.ts';
import { useStore, editGoal, deleteGoal, editKr, deleteKr, deleteCheckin, resolveId } from '../store/useStore.ts';
import { useSettingsBits } from '../settings-cache.ts';
import { todayIn } from '../dates.ts';
import { Link, navigate } from '../router.ts';
import { SectionHead } from '../ui/SectionHead.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { GoalBar, ConfDot, TrendLine, CheckInDialog, NewKrDialog, CONF_LABEL } from '../ui/GoalBits.tsx';

// `/goals/:id` (v2.6 Task 3): the goal edited in place, its key results with bars, check-ins and trend lines, Close and Trash.
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const STATUS: Record<GoalStatus, string> = { active: 'Active', achieved: 'Achieved', missed: 'Missed', dropped: 'Dropped' };
const fmt = (kr: KeyResult, v: number | null) =>
  v === null ? '–' : kr.type === 'done' ? (v ? 'Done' : 'Not done') : kr.type === 'percent' ? `${v}%` : `${v}${kr.unit ? ` ${kr.unit}` : ''}`;

export function GoalPage({ id }: { id: string }) {
  const { goals, krs, goalLinks, tasks, checkins, ready } = useStore();
  const { tz } = useSettingsBits();
  const today = todayIn(tz);
  const g = goals.find((x) => x.id === id);
  const [dlg, setDlg] = useState<{ kind: 'kr' } | { kind: 'ci'; kr: KeyResult } | null>(null);
  // A goal made offline opens on its temp id; once the server answers, follow it to the real one.
  useEffect(() => { if (ready && !g && id.startsWith('tmp-')) void resolveId('goals', id).then((r) => { if (r !== id) navigate(`/goals/${r}`, true); }); }, [ready, g, id]);
  if (!ready) return null;
  if (!g) return <p className="hint"><Link to="/goals">Goals</Link> · Goal not found (it may be in Trash).</p>;

  const ctx = { links: goalLinks, tasks };
  const own = krs.filter((k) => k.goal_id === g.id).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const exp = g.status === 'active' ? expected(g, today) : null;
  const text = (key: 'title' | 'description', v: string) => { const t = v.trim() || null; if (t !== g[key] && (t || key !== 'title')) void editGoal(g.id, { [key]: t }); };
  const date = (key: 'starts_on' | 'ends_on', el: HTMLInputElement) => {
    const v = el.value; if (v === g[key]) return;
    const next = { ...g, [key]: v } as Goal;
    if (!YMD.test(v) || next.starts_on > next.ends_on) { toast('Pick a start date on or before the end date'); el.value = g[key]; return; }
    void editGoal(g.id, { [key]: v });
  };
  const trash = async () => {
    if (!(await confirmAction(`Move "${g.title}" to Trash? Its key results and check-ins go with it.`, { danger: true }))) return;
    await deleteGoal(g.id); toast('Moved to Trash'); navigate('/goals');
  };
  const dropKr = async (k: KeyResult) => { if (await confirmAction(`Move the key result "${k.title}" to Trash?`, { danger: true })) await deleteKr(k.id); };
  const dropCi = async (cid: string) => { if (await confirmAction('Delete this check-in?', { danger: true })) await deleteCheckin(cid); };

  return (
    <div className="gl">
      <header className="phead">
        <div className="ptx">
          <div className="eyebrow"><Link to="/goals">Goals</Link> · {g.kind} goal · {STATUS[g.status]}</div>
          <input key={`t:${g.updated_at}`} className="pname" defaultValue={g.title} maxLength={MAX_TITLE} onBlur={(e) => text('title', e.target.value)} aria-label="Goal title" />
        </div>
      </header>

      <section className="card gl-meta">
        <GoalBar progress={goalProgress(g, krs, ctx)} exp={exp} label="Goal progress" />
        <div className="row gl-dates">
          <label className="qf">Starts<input key={`s:${g.updated_at}`} className="field" type="date" defaultValue={g.starts_on} onBlur={(e) => date('starts_on', e.target)} /></label>
          <label className="qf">Ends<input key={`e:${g.updated_at}`} className="field" type="date" defaultValue={g.ends_on} onBlur={(e) => date('ends_on', e.target)} /></label>
        </div>
        <textarea key={`d:${g.updated_at}`} className="field" rows={3} aria-label="Description" placeholder="Why this goal matters (optional)" defaultValue={g.description ?? ''} maxLength={2000} onBlur={(e) => text('description', e.target.value)} />
      </section>

      <section>
        <SectionHead eyebrow={`${own.length} of ${MAX_KRS}`} title="Key results">
          <button type="button" className="btn primary" disabled={own.length >= MAX_KRS} onClick={() => setDlg({ kind: 'kr' })}>+ Add key result</button>
        </SectionHead>
        {!own.length && <p className="hint">No key results yet. Two to five measures that say the goal is met work best.</p>}
        <ul className="gl-krs">{own.map((k) => {
          const hist = checkins.filter((c) => c.kr_id === k.id).sort((a, b) => b.at.localeCompare(a.at)), conf = confidence(k.id, checkins);
          return (
            <li key={k.id} className="card gl-kr">
              <div className="gl-top">
                <ConfDot c={conf} title={k.title} />
                <input key={`k:${k.updated_at}`} className="field gl-krtitle" defaultValue={k.title} maxLength={MAX_TITLE} aria-label="Key result title"
                  onBlur={(e) => { const t = e.target.value.trim(); if (t && t !== k.title) void editKr(k.id, { title: t }); }} />
              </div>
              <GoalBar progress={krProgress(k, ctx)} exp={exp} label={`${k.title} progress`} />
              {k.type !== 'tasks' && <p className="sub">Now {fmt(k, k.current_value)}{k.type === 'number' ? ` · from ${fmt(k, k.start_value)} to ${fmt(k, k.target_value)}` : ''}</p>}
              {/* Task 4: linked tasks and projects for this key result go here. */}
              {k.type === 'tasks' && <p className="hint">No linked tasks yet.</p>}
              <TrendLine points={trend(k.id, checkins)} label={`${k.title} trend`} />
              <div className="row">
                <button type="button" className="btn primary" onClick={() => setDlg({ kind: 'ci', kr: k })}>Check in</button>
                <button type="button" className="btn" onClick={() => void dropKr(k)}>Delete key result</button>
              </div>
              {hist.length > 0 && <details className="gl-hist"><summary>History ({hist.length})</summary>
                <ul>{hist.map((c) => (
                  <li key={c.id}>
                    <span className="mono">{localDay(c.at, tz)}</span>
                    {k.type !== 'tasks' && <span className="mono">{fmt(k, c.value)}</span>}
                    <span><span className={`gl-dot ${c.confidence}`} aria-hidden="true" /> {CONF_LABEL[c.confidence]}</span>
                    {c.note && <span className="gl-note">{c.note}</span>}
                    <button type="button" className="btn" aria-label={`Delete check-in of ${localDay(c.at, tz)}`} onClick={() => void dropCi(c.id)}>Delete</button>
                  </li>))}</ul></details>}
            </li>
          );
        })}</ul>
      </section>

      <section className="card gl-close">
        <SectionHead eyebrow="Status" title={g.status === 'active' ? 'Close this goal' : STATUS[g.status]} />
        <div className="row">
          {g.status === 'active'
            ? (['achieved', 'missed', 'dropped'] as const).map((s) => <button key={s} type="button" className="btn" onClick={() => void editGoal(g.id, { status: s })}>Close as {s}</button>)
            : <button type="button" className="btn" onClick={() => void editGoal(g.id, { status: 'active' })}>Reopen</button>}
          <button type="button" className="btn danger" onClick={() => void trash()}>Move to Trash</button>
        </div>
      </section>

      {dlg?.kind === 'kr' && <NewKrDialog goalId={g.id} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'ci' && <CheckInDialog kr={dlg.kr} last={confidence(dlg.kr.id, checkins)} onClose={() => setDlg(null)} />}
    </div>
  );
}
