import { useEffect, useMemo, useState } from 'react';
import type { Project, RaidItem } from '../../../../shared/types.ts';
import type { Snapshot } from '../../../../shared/baseline.ts';
import { burndown, donePerWeek, overdueTrend, riskMatrix, milestoneSlip, dashboardMetrics, SEVERITY_LABEL } from '../../../../shared/dashboard.ts';
import { useStore } from '../../store/useStore.ts';
import { useGov } from '../../gov.ts';
import { useBaselines, fetchSnapshot } from '../../baselines.ts';
import { todayIn } from '../../dates.ts';
import { ChartFrame, LineChart, BarChart, RiskGrid } from '../../ui/Chart.tsx';
import { SectionHead } from '../../ui/SectionHead.tsx';
import { useTz } from './Report.tsx';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const days = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (ymd: string) => `${MONTHS[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`;

/** The project's numbers drawn from what is already on the device: tasks and milestones from the mirror, RAID and the latest baseline from their cached copies. */
export function Dashboard({ project }: { project: Project }) {
  const tz = useTz();
  const today = todayIn(tz);
  const { tasks, milestones } = useStore();
  const { items: raid, offline: raidOffline } = useGov<RaidItem>(project.id, 'raid');
  const { items: baselines, loaded } = useBaselines(project.id);
  const latest = useMemo(() => [...baselines].sort((a, b) => b.taken_at.localeCompare(a.taken_at))[0] ?? null, [baselines]);
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!latest) { setSnap(loaded ? null : undefined); return; }
    setSnap(undefined);
    fetchSnapshot(latest.id).then((s) => { if (live) setSnap(s); }).catch(() => { if (live) setSnap(null); });
    return () => { live = false; };
  }, [latest?.id, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => tasks.filter((t) => t.project_id === project.id), [tasks, project.id]);
  const burn = useMemo(() => burndown(mine, project.start_at, project.end_at, today, tz), [mine, project.start_at, project.end_at, today, tz]);
  const weekly = useMemo(() => donePerWeek(mine, today, 8, tz), [mine, today, tz]);
  const trend = useMemo(() => overdueTrend(mine, today, 8, tz), [mine, today, tz]);
  const matrix = useMemo(() => riskMatrix(raid), [raid]);
  const metrics = useMemo(() => dashboardMetrics({ tasks: mine, raid, project, today, tz }), [mine, raid, project, today, tz]);
  const slipRows = useMemo(() => (snap ? milestoneSlip(snap, milestones.filter((m) => m.project_id === project.id)).filter((r) => r.delta !== 0) : []), [snap, milestones, project.id]);

  const idealWord = metrics.behind_ideal === null ? null : metrics.behind_ideal > 0 ? `${metrics.behind_ideal} behind the ideal line` : metrics.behind_ideal < 0 ? `${-metrics.behind_ideal} ahead of the ideal line` : 'on the ideal line';
  const todayIdx = burn.days.findIndex((d) => d.date === today);
  const sampled = burn.days.filter((_, i, a) => i % 7 === 0 || i === a.length - 1 || a[i].date === today);
  const best = weekly.reduce((a, w) => (w.done > a.done ? w : a), weekly[0]);

  const tiles: [string, string, string][] = [
    ['Done this week', String(metrics.done_this_week), ''], ['Open tasks', String(metrics.open), ''],
    ['Overdue now', String(metrics.overdue_now), metrics.overdue_now ? 'over' : ''],
    ['Against ideal', metrics.behind_ideal === null ? 'n/a' : metrics.behind_ideal > 0 ? `+${metrics.behind_ideal}` : String(metrics.behind_ideal), metrics.behind_ideal !== null && metrics.behind_ideal > 0 ? 'over' : ''],
    ['High risks', String(metrics.high_risks), metrics.high_risks ? 'over' : ''],
  ];
  return (
    <div className="dash">
      <SectionHead eyebrow="Numbers" title="Where the project stands" />
      {raidOffline && <p className="hint" role="status">Offline: the risk chart shows the last copy of the RAID log.</p>}
      <dl className="dash-tiles">
        {tiles.map(([k, v, tone]) => <div key={k} className={`dash-tile ${tone}`}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}
      </dl>
      <div className="dash-grid">
        <div className="card dash-wide"><ChartFrame id="dash-burn" title="Burndown"
          summary={`${plural(burn.remaining, 'task')} open today${burn.ideal ? `, against an ideal of ${metrics.ideal_remaining}: ${idealWord}.` : '. This project has no end date, so there is no ideal line.'} From ${short(burn.days[0].date)} to ${short(burn.days.at(-1)!.date)}.`}
          table={{ head: ['Date', 'Open tasks', 'Ideal'], rows: sampled.map((d) => [d.date, d.open ?? '', d.ideal ?? '']) }}>
          {(w, by) => <LineChart w={w} label="Open tasks per day against the ideal line" describedBy={by} labels={burn.days.map((d) => short(d.date))}
            marker={burn.ideal && todayIdx >= 0 && todayIdx < burn.days.length - 1 ? { index: todayIdx, label: 'Today' } : undefined}
            series={[{ name: 'Open tasks', values: burn.days.map((d) => d.open), tone: 'accent' }, ...(burn.ideal ? [{ name: 'Ideal', values: burn.days.map((d) => d.ideal), dashed: true, tone: 'dim' as const }] : [])]} />}
        </ChartFrame></div>

        <div className="card"><ChartFrame id="dash-done" title="Done per week"
          summary={`${plural(weekly.at(-1)!.done, 'task')} done this week, ${weekly.reduce((n, x) => n + x.done, 0)} over the last 8 weeks. Best week: ${plural(best.done, 'task')}, starting ${short(best.start)}. Weeks start on Monday.`}
          table={{ head: ['Week starting', 'Tasks done'], rows: weekly.map((x) => [x.start, x.done]) }}>
          {(w, by) => <BarChart id="dash-done" w={w} label="Tasks done in each of the last eight weeks" describedBy={by} labels={weekly.map((x) => short(x.start))} values={weekly.map((x) => x.done)} partialLast />}
        </ChartFrame></div>

        <div className="card"><ChartFrame id="dash-over" title="Overdue trend"
          summary={`${plural(trend.at(-1)!.overdue, 'task')} overdue now, ${trend.at(-2)!.overdue} at the end of last week. Each point is the count at the end of that week.`}
          table={{ head: ['As of', 'Overdue tasks'], rows: trend.map((x) => [x.as_of, x.overdue]) }}>
          {(w, by) => <LineChart w={w} label="Overdue tasks at the end of each of the last eight weeks" describedBy={by} labels={trend.map((x) => short(x.as_of))} series={[{ name: 'Overdue tasks', values: trend.map((x) => x.overdue), markers: true, tone: 'danger' }]} />}
        </ChartFrame></div>

        <div className="card"><ChartFrame id="dash-risk" title="Risk matrix"
          summary={matrix.total ? `${plural(matrix.total, 'open risk')}: ${matrix.high} high, ${matrix.medium} medium, ${matrix.low} low${matrix.unrated ? `; ${matrix.unrated} not rated yet` : ''}. Severity is probability times impact.` : 'No open risks.'}
          table={{ head: ['Probability', 'Impact', 'Open risks', 'Severity'], rows: [...matrix.cells.filter((c) => c.count).map((c) => [`P${c.p}`, `I${c.i}`, c.count, SEVERITY_LABEL[c.severity]]), ...(matrix.unrated ? [['Not rated', '', matrix.unrated, '']] : [])] }}>
          {(w, by) => <RiskGrid matrix={matrix} label="Open risks by probability and impact" describedBy={by} />}
        </ChartFrame>
          {matrix.unrated > 0 && <p className="hint">{plural(matrix.unrated, 'risk')} not rated: add a probability and an impact on the RAID tab to place {matrix.unrated === 1 ? 'it' : 'them'}.</p>}</div>

        <div className="card"><figure className="chart" aria-labelledby="dash-slip-t">
          <figcaption className="chart-head"><h3 id="dash-slip-t">Milestone slip</h3></figcaption>
          {!latest && <p className="chart-sum">{loaded ? 'No baseline yet. Save one on the Overview tab to see which milestones moved.' : 'Looking for a baseline…'}</p>}
          {latest && snap === undefined && <p className="chart-sum">Opening the baseline…</p>}
          {latest && snap === null && <p className="chart-sum" role="status">This baseline can't be opened offline. Connect once to load it.</p>}
          {latest && snap && <>
            <p className="chart-sum" id="dash-slip-sum">{slipRows.length ? `${plural(slipRows.length, 'milestone')} moved since "${latest.name}" (${latest.taken_at.slice(0, 10)}), biggest move first.` : `No milestone has moved since "${latest.name}" (${latest.taken_at.slice(0, 10)}).`}</p>
            {slipRows.length > 0 && <ol className="slip-list" aria-describedby="dash-slip-sum">
              {slipRows.slice(0, 6).map((r) => (
                <li key={r.id}><span className="sl-name">{r.name || 'Milestone'}</span>
                  <span className="sl-dates mono">{r.baseline_due} → {r.due_at}</span>
                  <span className={`chip ${r.delta > 0 ? 'over' : 'ok'}`}><span aria-hidden="true">{r.delta > 0 ? '▲ ' : '▼ '}</span>{days(r.delta)} {r.delta > 0 ? 'later' : 'earlier'}</span></li>))}
            </ol>}
            {slipRows.length > 6 && <p className="hint">{slipRows.length - 6} more on the Overview tab.</p>}
          </>}
        </figure></div>
      </div>
    </div>
  );
}
