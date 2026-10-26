import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { DEFAULT_SETTINGS, type Kind, type Project, type Settings } from '../../../shared/types.ts';
import { workload, parseEstimate, formatEstimate, type WEntry, type WWeek } from '../../../shared/workload.ts';
import { weekStart } from '../../../shared/dashboard.ts';
import { api, online, SignedOut } from '../api.ts';
import { idb } from '../store/db.ts';
import { useStore, updateTask } from '../store/useStore.ts';
import { todayIn } from '../dates.ts';
import { ChartFrame } from '../ui/Chart.tsx';
import { projectColor } from '../ui/colors.ts';
import { toast } from '../ui/dialogs.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { usePrograms, membersOf } from './Programs.tsx';
import { useTimers } from '../ui/TimerButton.tsx';
import { actualWeeks } from '../../../shared/time.ts';

// Workload (v2.4, P5): estimated hours per week against capacity, drawn from the device mirror, so it works offline.
// Capacity lives in settings (cached in IndexedDB `meta` for offline reading); changing it is online-only.

type WL = Settings['workload'];
const CACHE = 'settings:workload';
const OFFLINE_LINE = "Capacity can be changed when you're online";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (ymd: string) => `${MONTHS[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`;
/** Minutes as hours: "6h", "6.5h". */
const hrs = (min: number) => `${Math.round(min / 6) / 10}h`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Workload settings and the zone: the cached copy first, then the server's. */
function useWorkloadSettings() {
  const [st, set] = useState<{ w: WL; tz: string; known: boolean }>({ w: DEFAULT_SETTINGS.workload, tz: DEFAULT_SETTINGS.tz, known: false });
  useEffect(() => {
    let live = true;
    void idb.get<{ w: WL; tz: string }>('meta', CACHE).then((c) => { if (live && c) set((s) => (s.known ? s : { ...c, known: true })); }).catch(() => {});
    api<Settings>('/settings').then((s) => { if (live) { set({ w: s.workload, tz: s.tz, known: true }); void idb.put('meta', { id: CACHE, w: s.workload, tz: s.tz }).catch(() => {}); } }).catch(() => {});
    return () => { live = false; };
  }, []);
  const save = async (patch: Partial<WL> | { overrides: Record<string, { work: number; personal: number } | null> }) => {
    try {
      const s = await api<Settings>('/settings', { method: 'PATCH', json: { workload: patch } });
      set({ w: s.workload, tz: s.tz, known: true });
      void idb.put('meta', { id: CACHE, w: s.workload, tz: s.tz }).catch(() => {});
      toast('Saved');
    } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message || OFFLINE_LINE); }
  };
  return { ...st, save };
}

const PATTERNS = ['solid', 'hatch', 'dots', 'lines'] as const;
/** One fill per project: its colour with one of four patterns (never colour alone); "No project" is grey cross-hatch. */
function Fill({ id, color, kind }: { id: string; color: string; kind: (typeof PATTERNS)[number] | 'cross' | 'actual' }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={kind === 'hatch' || kind === 'cross' ? 'rotate(45)' : kind === 'actual' ? 'rotate(-45)' : undefined}>
      <rect width="6" height="6" fill={color} opacity={kind === 'solid' ? 1 : kind === 'actual' ? 0.35 : 0.55} />
      {kind === 'actual' && <rect width="6" height="2.5" fill={color} />}
      {kind === 'hatch' && <rect width="2" height="6" fill="var(--card)" />}
      {kind === 'dots' && <circle cx="3" cy="3" r="1.2" fill="var(--card)" />}
      {kind === 'lines' && <rect y="2" width="6" height="1.5" fill="var(--card)" />}
      {kind === 'cross' && <><rect width="1.5" height="6" fill="var(--card)" /><rect height="1.5" width="6" fill="var(--card)" /></>}
    </pattern>
  );
}

const M = { l: 32, r: 12, t: 30, b: 26 };
type Seg = { key: string; name: string; color: string };

/** The first `past` weeks are logged time (Actual): their own stripe pattern and a label over the group, then the planned weeks. */
function StackedBars({ id, w, weeks, past, kind, segs, selected, onPick, describedBy }: { id: string; w: number; weeks: WWeek[]; past: number; kind: Kind; segs: Seg[]; selected: string | null; onPick: (start: string) => void; describedBy: string }) {
  const h = 220, iw = w - M.l - M.r, ih = h - M.t - M.b, n = weeks.length, slot = iw / n, bw = Math.min(30, slot * 0.62);
  const maxH = Math.max(1, ...weeks.map((x) => Math.max(x.minutes[kind], x.capacity[kind]) / 60));
  const top = Math.ceil(maxH / 4) * 4, y = (hours: number) => M.t + ih - (hours / top) * ih;
  const step = slot < 40 ? 2 : 1;
  return (
    <div className="wl-plot">
      <svg className="chart-svg" role="img" aria-label={`${kind === 'work' ? 'Work' : 'Personal'} hours logged in each of the last ${past} weeks, then planned in each of the next ${n - past}, against capacity`} aria-describedby={describedBy} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>{segs.map((s, i) => <Fill key={s.key} id={`${id}-p${i}`} color={s.color} kind={s.key === '' ? 'cross' : PATTERNS[i % PATTERNS.length]} />)}
          {segs.map((s, i) => <Fill key={`a${s.key}`} id={`${id}-a${i}`} color={s.color} kind="actual" />)}</defs>
        {past > 0 && <g className="wl-actual">
          <text x={M.l + (slot * past) / 2} y={10} textAnchor="middle" className="ch-t">Actual</text>
          <text x={M.l + slot * past + (slot * (n - past)) / 2} y={10} textAnchor="middle" className="ch-t">Planned</text>
          <line x1={M.l + slot * past} x2={M.l + slot * past} y1={4} y2={M.t + ih} className="ch-grid" /></g>}
        {[0, top / 2, top].map((v) => <g key={v}><line x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} className="ch-grid" /><text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="ch-t">{v}h</text></g>)}
        {weeks.map((wk, i) => {
          const cx = M.l + slot * i + slot / 2;
          let acc = 0;
          const by = new Map<string, number>();
          for (const e of wk[kind]) by.set(e.project_id ?? '', (by.get(e.project_id ?? '') ?? 0) + e.minutes);
          const over = wk.over[kind], cap = wk.capacity[kind] / 60;
          return <g key={wk.start}>
            {selected === wk.start && <rect x={M.l + slot * i + 1} y={M.t - 24} width={slot - 2} height={ih + 24} rx={6} className="wl-sel" />}
            {segs.map((s, k) => {
              const m = by.get(s.key); if (!m) return null;
              const y0 = y(acc / 60), y1 = y((acc + m) / 60); acc += m;
              return <rect key={s.key} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)} fill={`url(#${id}-${i < past ? 'a' : 'p'}${k})`} stroke="var(--card)" strokeWidth={0.75} />;
            })}
            <line x1={M.l + slot * i + 2} x2={M.l + slot * (i + 1) - 2} y1={y(cap)} y2={y(cap)} className="wl-cap" />
            {over > 0 && <text x={cx} y={y(Math.max(acc, wk.capacity[kind]) / 60) - 16} textAnchor="middle" className="ch-v wl-over"><tspan x={cx}>+{hrs(over)}</tspan><tspan x={cx} dy="11">over</tspan></text>}
            {(n - 1 - i) % step === 0 && <text x={cx} y={h - 8} textAnchor="middle" className="ch-t">{short(wk.start)}</text>}
          </g>;
        })}
      </svg>
      {weeks.map((wk, i) => (
        <button key={wk.start} type="button" className="wl-hit" aria-pressed={selected === wk.start} style={{ left: M.l + slot * i, width: slot, height: h }} onClick={() => onPick(wk.start)}
          aria-label={`${i < past ? 'Actual, w' : 'W'}eek of ${short(wk.start)}: ${hrs(wk.minutes[kind])} of ${hrs(wk.capacity[kind])}${wk.over[kind] ? `, ${hrs(wk.over[kind])} over` : ''}`} />
      ))}
      <ul className="chart-legend" aria-hidden="true">
        {segs.map((s, i) => <li key={s.key}><svg width="14" height="12"><rect width="14" height="12" rx="2" fill={`url(#${id}-p${i})`} /></svg>{s.name}</li>)}
        {past > 0 && <li><svg width="14" height="12"><rect width="14" height="12" rx="2" fill={`url(#${id}-a0)`} /></svg>Actual (logged)</li>}
        <li><svg width="24" height="10"><line x1="1" x2="23" y1="5" y2="5" className="wl-cap" /></svg>Capacity</li>
      </ul>
    </div>
  );
}

function summary(weeks: WWeek[], kind: Kind) {
  const over = weeks.filter((w) => w.over[kind] > 0);
  if (over.length) {
    const most = over.reduce((a, w) => (w.over[kind] > a.over[kind] ? w : a));
    return `${over.length} of ${weeks.length} weeks ${over.length === 1 ? 'is' : 'are'} over capacity; the most is +${hrs(most.over[kind])} in the week of ${short(most.start)}.`;
  }
  const busiest = weeks.reduce((a, w) => (w.minutes[kind] > a.minutes[kind] ? w : a));
  return busiest.minutes[kind] ? `No week is over capacity; the busiest is ${hrs(busiest.minutes[kind])} of ${hrs(busiest.capacity[kind])} in the week of ${short(busiest.start)}.` : `Nothing is planned in the next ${weeks.length} weeks.`;
}
function actualSummary(weeks: WWeek[], kind: Kind) {
  const total = weeks.reduce((n, w) => n + w.minutes[kind], 0);
  if (!total) return `Actual: no time logged in the last ${weeks.length} weeks.`;
  const most = weeks.reduce((a, w) => (w.minutes[kind] > a.minutes[kind] ? w : a));
  return `Actual: ${hrs(total)} logged in the last ${weeks.length} weeks, the most ${hrs(most.minutes[kind])} of ${hrs(most.capacity[kind])} in the week of ${short(most.start)}.`;
}

/** `/workload`: work and personal hours per week against capacity, what is unscheduled or not estimated, and per-week capacity overrides. */
export function Workload() {
  const { tasks, projects, ready } = useStore();
  const { programs } = usePrograms();
  const { w: s, tz, save, known } = useWorkloadSettings();
  const { entries } = useTimers();
  const [filter, setFilter] = useState('all');
  const [pick, setPick] = useState<{ kind: Kind; start: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const today = todayIn(tz);
  const live = useMemo(() => projects.filter((p) => !p.deleted_at), [projects]);
  const ids = filter === 'all' ? undefined : filter.startsWith('g:') ? { project_ids: membersOf(filter.slice(2), live).map((p) => p.id) } : { project_ids: [filter.slice(2)] };
  const wl = useMemo(() => workload(tasks, s, today, tz, 12, ids), [tasks, s, today, tz, filter, live]); // eslint-disable-line react-hooks/exhaustive-deps
  // T9: the 4 weeks before this one, from logged time; a trashed project's own entries count nowhere.
  const past = useMemo(() => actualWeeks(entries.filter((e) => !e.project_id || live.some((p) => p.id === e.project_id)), tasks, s, today, tz, 4, ids), [entries, tasks, s, today, tz, filter, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const proj = useMemo(() => new Map(live.map((p) => [p.id, p])), [live]);
  if (!ready) return null;

  const segsOf = (kind: Kind): Seg[] => {
    const seen = new Set([...past, ...wl.weeks].flatMap((x) => x[kind].map((e) => e.project_id ?? '')));
    const list = [...seen].filter((k) => k && proj.has(k)).map((k) => { const p = proj.get(k) as Project; return { key: k, name: p.name, color: projectColor(p) }; });
    return [...list.sort((a, b) => a.name.localeCompare(b.name)), ...(seen.has('') || [...seen].some((k) => k && !proj.has(k)) ? [{ key: '', name: 'No project', color: 'var(--text-faint)' }] : [])];
  };
  const norm = (e: WEntry) => (e.project_id && proj.has(e.project_id) ? e : { ...e, project_id: null }); // a trashed project's task counts as "No project"
  const weeksFor = (kind: Kind) => [...past, ...wl.weeks].map((x) => ({ ...x, [kind]: x[kind].map(norm) }));
  const isPast = (start: string) => start < weekStart(today);
  const label = (start: string) => `${isPast(start) ? 'Actual · ' : ''}${short(start)}`;
  const title = (id: string) => byId.get(id)?.title ?? 'Task';
  const pname = (pid: string | null) => (pid && proj.get(pid)?.name) || 'No project';
  const taskLink = (id: string) => <a href={`/?task=${id}`} onClick={(e: MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); setOpen(id); }}>{title(id)}</a>;
  const unschedMin = wl.unscheduled.reduce((n, e) => n + e.minutes, 0);
  const chosen = pick && [...past, ...wl.weeks].find((x) => x.start === pick.start);
  const canWrite = known && online();

  return (
    <div className="wl">
      <div className="head"><div><div className="eyebrow">Workload</div><h1 style={{ marginTop: 6 }}>The next <b>12 weeks</b></h1></div>
        <label className="wl-filter"><span className="sub">Show</span>
          <select className="field" value={filter} onChange={(e) => { setFilter(e.target.value); setPick(null); }}>
            <option value="all">All tasks</option>
            {(programs ?? []).length > 0 && <optgroup label="Programs">{programs!.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}</optgroup>}
            {live.length > 0 && <optgroup label="Projects">{live.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>}
          </select></label></div>
      <p className="hint">Hours are split over each task's weekdays from its start (or today) to its due date. This week counts only the weekdays left. Tasks with no estimate count as {formatEstimate(s.default_estimate_minutes)}. The 4 weeks before this one show the time you logged (Actual).</p>
      <div className="dash-grid">
        {(['work', 'personal'] as const).map((kind) => {
          const weeks = weeksFor(kind);
          return <div key={kind} className="card dash-wide"><ChartFrame id={`wl-${kind}`} title={kind === 'work' ? 'Work' : 'Personal'} summary={`${summary(weeks.slice(past.length), kind)} ${actualSummary(weeks.slice(0, past.length), kind)}`}
            table={{ head: ['Week of', 'Hours', 'Capacity', 'Over'], rows: weeks.map((x) => [isPast(x.start) ? `Actual ${x.start}` : x.start, hrs(x.minutes[kind]), hrs(x.capacity[kind]), x.over[kind] ? `+${hrs(x.over[kind])}` : '']) }}>
            {(cw, by) => <StackedBars id={`wl-${kind}`} w={cw} weeks={weeks} past={past.length} kind={kind} segs={segsOf(kind)} describedBy={by} selected={pick?.kind === kind ? pick.start : null}
              onPick={(start) => setPick(pick?.kind === kind && pick.start === start ? null : { kind, start })} />}
          </ChartFrame>
            <label className="wl-pick">Week<select className="field" aria-label={`${kind === 'work' ? 'Work' : 'Personal'} week`} value={pick?.kind === kind ? pick.start : ''} onChange={(e) => setPick(e.target.value ? { kind, start: e.target.value } : null)}>
              <option value="">Choose a week to list its tasks</option>
              {weeks.map((x) => <option key={x.start} value={x.start}>{label(x.start)}: {hrs(x.minutes[kind])} of {hrs(x.capacity[kind])}{x.over[kind] ? `, +${hrs(x.over[kind])} over` : ''}</option>)}
            </select></label>
            {pick?.kind === kind && chosen && <section className="wl-week" aria-live="polite">
              <h3>{isPast(chosen.start) ? 'Actual: w' : 'W'}eek of {short(chosen.start)} · {hrs(chosen.minutes[kind])} of {hrs(chosen.capacity[kind])}</h3>
              {chosen[kind].length === 0 ? <p className="hint">{isPast(chosen.start) ? 'No time logged this week.' : 'Nothing planned this week.'}</p> : <ul className="wl-list">
                {[...chosen[kind]].sort((a, b) => b.minutes - a.minutes).map((e) => <li key={`${e.task_id}:${e.project_id}`}>{e.task_id ? taskLink(e.task_id) : <span>Time on the project</span>}<span className="sub">{pname(e.project_id)}</span><span className="mono">{hrs(e.minutes)}</span>
                  {!e.estimated && <span className="chip">not estimated</span>}{e.overdue && <span className="chip over">overdue</span>}</li>)}
              </ul>}
            </section>}
          </div>;
        })}
      </div>

      <div className="card wl-more">
        <details><summary>Unscheduled: {hrs(unschedMin)} in {plural(wl.unscheduled.length, 'task')}</summary>
          <p className="hint">No due date, so they sit in no week. Give them one to place them.</p>
          <ul className="wl-list">{wl.unscheduled.map((e) => <li key={e.task_id}>{taskLink(e.task_id)}<span className="sub">{pname(e.project_id)} · {e.kind}</span><span className="mono">{hrs(e.minutes)}</span>{!e.estimated && <span className="chip">not estimated</span>}</li>)}</ul>
        </details>
        <details><summary>Not estimated: {wl.not_estimated.length}</summary>
          <p className="hint">Each counts as {formatEstimate(s.default_estimate_minutes)} until you give it an estimate, like 30m, 2h or 1d.</p>
          <ul className="wl-list">{wl.not_estimated.map((id) => <li key={id}>{taskLink(id)}<span className="sub">{pname(byId.get(id)?.project_id ?? null)}</span>
            <input className="field wl-est" placeholder="2h" aria-label={`Estimate for ${title(id)}`} onBlur={(e) => {
              const raw = e.target.value.trim(); if (!raw) return;
              const n = parseEstimate(raw, s.day_hours);
              if (n == null) { toast('Use minutes, hours or days, like 2h'); return; }
              void updateTask(id, { estimate_minutes: n });
            }} /></li>)}</ul>
        </details>
        <Overrides s={s} today={today} canWrite={canWrite} save={save} />
      </div>
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Overrides({ s, today, canWrite, save }: { s: WL; today: string; canWrite: boolean; save: ReturnType<typeof useWorkloadSettings>['save'] }) {
  const first = weekStart(today);
  const [mon, setMon] = useState(first);
  const cur = s.overrides[mon];
  const [work, setWork] = useState(String(cur?.work ?? s.work_hours));
  const [pers, setPers] = useState(String(cur?.personal ?? s.personal_hours));
  useEffect(() => { setWork(String(cur?.work ?? s.work_hours)); setPers(String(cur?.personal ?? s.personal_hours)); }, [mon, cur?.work, cur?.personal, s.work_hours, s.personal_hours]);
  const ok = (v: string) => v !== '' && Number(v) >= 0 && Number(v) <= 168;
  const list = Object.entries(s.overrides).sort(([a], [b]) => a.localeCompare(b));
  return (
    <details><summary>Week overrides: {list.length}</summary>
      <p className="hint">A week with leave or a lighter load: its capacity replaces the usual {s.work_hours}h work and {s.personal_hours}h personal.</p>
      {list.length > 0 && <ul className="wl-list">{list.map(([k, v]) => <li key={k}><span>Week of {short(k)}</span><span className="mono">{v.work}h work · {v.personal}h personal</span>
        <button type="button" className="btn" disabled={!canWrite} onClick={() => void save({ overrides: { [k]: null } })}>Remove</button></li>)}</ul>}
      <div className="wl-form">
        <label>Week of (Monday)<input className="field" type="date" step={7} min={first} value={mon} onChange={(e) => e.target.value && setMon(weekStart(e.target.value))} /></label>
        <label>Work hours<input className="field" type="number" min={0} max={168} value={work} onChange={(e) => setWork(e.target.value)} /></label>
        <label>Personal hours<input className="field" type="number" min={0} max={168} value={pers} onChange={(e) => setPers(e.target.value)} /></label>
        <button type="button" className="btn primary" disabled={!canWrite || !ok(work) || !ok(pers)} onClick={() => void save({ overrides: { [mon]: { work: Number(work), personal: Number(pers) } } })}>Save</button>
        {cur && <button type="button" className="btn" disabled={!canWrite} onClick={() => void save({ overrides: { [mon]: null } })}>Remove</button>}
      </div>
      {!canWrite && <p className="hint">{OFFLINE_LINE}</p>}
    </details>
  );
}
