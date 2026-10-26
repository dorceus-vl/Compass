import { useMemo, useState } from 'react';
import { weekStart, addDaysYmd, localDay } from '../../../shared/dashboard.ts';
import { weekGrid, splitByDay, entryProject, toCsv, formatElapsed } from '../../../shared/time.ts';
import { useStore } from '../store/useStore.ts';
import { useSettingsBits } from '../settings-cache.ts';
import { todayIn } from '../dates.ts';
import { useTimers } from '../ui/TimerButton.tsx';
import { EntryRow } from '../ui/TimeSection.tsx';
import { saveText } from '../docs/download.ts';
import { toast } from '../ui/dialogs.tsx';

// `/time` (v2.5 Task 3): the week as a grid of projects by day from the device mirror (works offline), the entries of a cell, and CSV export.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (ymd: string) => `${MONTHS[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function Time() {
  const { tasks, projects, ready } = useStore();
  const { entries, now } = useTimers();
  const { tz } = useSettingsBits();
  const today = todayIn(tz), thisWeek = weekStart(today);
  const [mon, setMon] = useState<string | null>(null);
  const week = mon ?? thisWeek;
  const [cell, setCell] = useState<{ p: string | null; d: number } | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const from = range?.from ?? thisWeek, to = range?.to ?? addDaysYmd(thisWeek, 6);

  const live = useMemo(() => new Map(projects.filter((p) => !p.deleted_at).map((p) => [p.id, p])), [projects]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // A trashed project's own entries count nowhere (its tasks' entries still follow the task).
  const mine = useMemo(() => entries.filter((e) => !e.project_id || live.has(e.project_id)), [entries, live]);
  const grid = useMemo(() => weekGrid(mine, tasks, week, tz, now), [mine, tasks, week, tz, now]);
  const pname = (id: string | null) => (id && live.get(id)?.name) || (id ? 'Project in Trash' : 'No project');
  const tname = (id: string) => byId.get(id)?.title ?? 'Task';

  const day = (i: number) => addDaysYmd(week, i);
  const picked = cell ? mine.filter((e) => entryProject(e, byId) === cell.p && (splitByDay(e, tz, now)[day(cell.d)] ?? 0) > 0).sort((a, b) => a.started_at.localeCompare(b.started_at)) : [];
  const go = (n: number) => { setMon(addDaysYmd(week, 7 * n)); setCell(null); };

  const okRange = YMD.test(from) && YMD.test(to) && from <= to;
  const exportCsv = () => {
    const rows = mine.filter((e) => { const d = localDay(e.started_at, tz); return d >= from && d <= to; });
    if (!rows.length) { toast('No time logged in those dates'); return; }
    saveText('﻿' + toCsv(rows, { task: tname, project: pname }, tasks, tz, now), `compass-time-${from}-${to}.csv`, 'text/csv;charset=utf-8'); // the BOM lets Excel read UTF-8
  };

  if (!ready) return null;
  return (
    <div className="tm">
      <div className="head"><div><div className="eyebrow">Time</div><h1 style={{ marginTop: 6 }}>Week of <b>{short(week)}</b></h1>
        <div className="sub">{formatElapsed(grid.total)} logged{week === thisWeek ? ' this week' : ''}</div></div>
        <div className="row tm-nav">
          <button type="button" className="btn" onClick={() => go(-1)} aria-label="Previous week">← Previous</button>
          {week !== thisWeek && <button type="button" className="btn" onClick={() => { setMon(null); setCell(null); }}>This week</button>}
          <button type="button" className="btn" onClick={() => go(1)} aria-label="Next week">Next →</button>
        </div></div>

      <div className="card">
        {grid.rows.length ? <div className="scroll-x"><table className="tm-grid">
          <caption className="sr-only">Hours and minutes logged per project and day, week of {short(week)}. Choose a cell to list its entries.</caption>
          <thead><tr><th scope="col">Project</th>{DAYS.map((d, i) => <th key={d} scope="col"><span>{d}</span> <small className="mono">{+day(i).slice(8)}</small></th>)}<th scope="col">Total</th></tr></thead>
          <tbody>{grid.rows.map((r) => <tr key={r.project_id ?? ''}>
            <th scope="row">{pname(r.project_id)}</th>
            {r.days.map((m, i) => <td key={i}>{m ? <button type="button" className="tm-cell mono" aria-pressed={cell?.p === r.project_id && cell?.d === i}
              aria-label={`${pname(r.project_id)}, ${DAYS[i]} ${short(day(i))}: ${formatElapsed(m)}`} onClick={() => setCell(cell?.p === r.project_id && cell?.d === i ? null : { p: r.project_id, d: i })}>{formatElapsed(m)}</button>
              : <><span className="tm-none" aria-hidden="true">·</span><span className="sr-only">none</span></>}</td>)}
            <td className="mono tm-total">{formatElapsed(r.total)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Total</th>{grid.dayTotals.map((m, i) => <td key={i} className="mono">{m ? formatElapsed(m) : '·'}</td>)}<td className="mono tm-total">{formatElapsed(grid.total)}</td></tr></tfoot>
        </table></div> : <p className="hint">No time logged this week. Start a timer on a task, or add time from its sheet.</p>}

        {cell && <section className="wl-week" aria-live="polite">
          <h3>{pname(cell.p)} · {DAYS[cell.d]} {short(day(cell.d))}</h3>
          {picked.length ? <ul className="tents">{picked.map((e) => <EntryRow key={e.id} e={e} tz={tz} title={e.task_id ? tname(e.task_id) : 'Time on the project'} />)}</ul>
            : <p className="hint">Nothing left in this cell.</p>}
        </section>}
      </div>

      <div className="card tm-export">
        <h2 className="rh2" style={{ margin: 0 }}>Export CSV</h2>
        <div className="row">
          <label className="qf">From<input className="field" type="date" value={from} onChange={(e) => setRange({ from: e.target.value, to })} /></label>
          <label className="qf">To<input className="field" type="date" value={to} onChange={(e) => setRange({ from, to: e.target.value })} /></label>
          <button type="button" className="btn primary" disabled={!okRange} onClick={exportCsv}>Export CSV</button>
        </div>
        {!okRange && <p className="sub" role="note" style={{ color: 'var(--danger)' }}>Pick a start date on or before the end date.</p>}
        <p className="hint">Entries that start in these dates, with local start and end times in your time zone, minutes, project, task and note.</p>
      </div>
    </div>
  );
}
