import { useState } from 'react';
import type { Goal } from '../../../shared/types.ts';
import { currentQuarter, quarterRange, goalProgress, expected, confidence } from '../../../shared/goals.ts';
import { useStore } from '../store/useStore.ts';
import { useSettingsBits } from '../settings-cache.ts';
import { todayIn } from '../dates.ts';
import { Link } from '../router.ts';
import { SectionHead } from '../ui/SectionHead.tsx';
import { GoalBar, ConfDot, NewGoalDialog, shiftQuarter } from '../ui/GoalBits.tsx';

// `/goals` (v2.6 Task 3): goals of a period from the device mirror, by kind, each with its bar and its key results' confidence.
type Period = 'this' | 'next' | 'past' | 'all';
const PERIODS: [Period, string][] = [['this', 'This quarter'], ['next', 'Next quarter'], ['past', 'Past'], ['all', 'All']];
const STATUS: Record<Goal['status'], string> = { active: 'Active', achieved: 'Achieved', missed: 'Missed', dropped: 'Dropped' };

export function Goals() {
  const { goals, krs, goalLinks, tasks, checkins, ready } = useStore();
  const { tz } = useSettingsBits();
  const today = todayIn(tz);
  const [period, setPeriod] = useState<Period>('this');
  const [adding, setAdding] = useState(false);
  if (!ready) return null;
  const cq = currentQuarter(today), thisQ = quarterRange(cq.year, cq.q), nq = shiftQuarter(cq, 1), nextQ = quarterRange(nq.year, nq.q);
  const overlaps = (g: Goal, r: { starts_on: string; ends_on: string }) => g.starts_on <= r.ends_on && g.ends_on >= r.starts_on;
  const shown = goals.filter((g) => period === 'all' || (period === 'past' ? g.ends_on < thisQ.starts_on : overlaps(g, period === 'this' ? thisQ : nextQ)))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const ctx = { links: goalLinks, tasks };
  const group = (kind: Goal['kind'], label: string) => {
    const rows = shown.filter((g) => g.kind === kind);
    if (!rows.length) return null;
    return (
      <section className="card gl-group" aria-labelledby={`gl-${kind}`}>
        <SectionHead eyebrow={`${rows.length} goal${rows.length === 1 ? '' : 's'}`} title={label} id={`gl-${kind}`} />
        <ul className="gl-list">{rows.map((g) => {
          const own = krs.filter((k) => k.goal_id === g.id);
          return (
            <li key={g.id} className="gl-row">
              <div className="gl-top"><Link to={`/goals/${g.id}`} className="gl-title">{g.title}</Link>
                {g.status !== 'active' && <span className="chip">{STATUS[g.status]}</span>}
                <span className="mono gl-when">{g.starts_on} → {g.ends_on}</span></div>
              <GoalBar progress={goalProgress(g, krs, ctx)} exp={g.status === 'active' ? expected(g, today) : null} label={`${g.title} progress`} />
              {own.length > 0 && <div className="gl-dots">{own.map((k) => <ConfDot key={k.id} c={confidence(k.id, checkins)} title={k.title} />)}</div>}
            </li>
          );
        })}</ul>
      </section>
    );
  };
  return (
    <div className="gl">
      <div className="head"><div><div className="eyebrow">Goals</div><h1 style={{ marginTop: 6 }}>{PERIODS.find(([p]) => p === period)?.[1]}</h1>
        <div className="sub">Q{cq.q} {cq.year}: {thisQ.starts_on} → {thisQ.ends_on}</div></div>
        <div className="row">
          <div className="seg" role="group" aria-label="Period">{PERIODS.map(([p, l]) => <button type="button" key={p} className={period === p ? 'on' : ''} aria-pressed={period === p} onClick={() => setPeriod(p)}>{l}</button>)}</div>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ New goal</button>
        </div></div>
      {shown.length ? <>{group('personal', 'Personal')}{group('work', 'Work')}</>
        : <p className="hint">{goals.length ? 'No goals in this period.' : 'No goals yet. A goal is what you want by the end of a quarter; key results say how you will know.'}</p>}
      {adding && <NewGoalDialog today={today} onClose={() => setAdding(false)} />}
    </div>
  );
}
