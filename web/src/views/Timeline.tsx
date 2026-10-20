import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore, updateTask } from '../store/useStore.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { layout, dayIndex, shiftDates } from '../timeline-math.ts';
import { today, addDays } from '../dates.ts';
import { taskColor, projectColor } from '../ui/colors.ts';

const ZOOM = { day: 48, week: 18, month: 6 } as const;
const ROW = 34, LEFT = 220;
const label = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); };

export function Timeline() {
  const { tasks, milestones, projects, ready } = useStore();
  const [zoom, setZoom] = useState<keyof typeof ZOOM>('week');
  const [project, setProject] = useState(() => new URLSearchParams(location.search).get('project') ?? ''); // the project page's Timeline tab links here
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; edge: boolean } | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []); // unmount mid-drag: drop the listeners
  if (!ready) return null;
  const px = ZOOM[zoom];
  const t = today();
  const from = addDays(t, -14), days = zoom === 'month' ? 180 : zoom === 'week' ? 90 : 45;
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id && x.status !== 'done' && x.due_at && (!project || x.project_id === project)).sort((a, b) => (a.start_at ?? a.due_at!).localeCompare(b.start_at ?? b.due_at!));
  const rows = layout(live, from, px, ROW);
  const ms = milestones.filter((m) => m.due_at && !m.done_at && !m.deleted_at && (!project || m.project_id === project));
  const height = (rows.length + 1) * ROW + 40 + (ms.length > 1 ? 18 : 0); // two milestone lines when there are several, so labels overlap less
  const pcolor = (id: string | null) => { const p = projects.find((x) => x.id === id); return p ? projectColor(p) : 'var(--text-dim)'; };

  // Bar drag: body moves both dates, right edge moves the due date. A press with no movement on the body opens the sheet.
  const onDown = (e: ReactPointerEvent, id: string, edge: boolean) => {
    if (e.button !== 0 || stopDrag.current) return; // one drag at a time
    e.preventDefault();
    const task = live.find((x) => x.id === id)!, x0 = e.clientX, pid = e.pointerId;
    const dxOf = (ev: PointerEvent) => Math.round((ev.clientX - x0) / px);
    const stop = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      stopDrag.current = null; setDrag(null);
    };
    stopDrag.current = stop;
    const move = (ev: PointerEvent) => { if (ev.pointerId === pid) setDrag({ id, dx: dxOf(ev), edge }); };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === pid) stop(); };
    const up = async (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const dx = dxOf(ev); stop();
      if (dx === 0) { if (!edge) setOpen(id); return; }
      if (edge) { const due = addDays(task.due_at!, dx); if (!task.start_at || due >= task.start_at) await updateTask(id, { due_at: due }); }
      else await updateTask(id, shiftDates({ start_at: task.start_at, due_at: task.due_at! }, dx));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };

  const ticks = Array.from({ length: Math.ceil(days / (zoom === 'day' ? 1 : 7)) }, (_, i) => addDays(from, i * (zoom === 'day' ? 1 : 7)));
  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Timeline</div><h1 style={{ marginTop: 6 }}>What's <b>ahead</b></h1><div className="sub">{rows.length} scheduled · drag a bar to move it, its edge to change the due date</div></div>
        <div className="row">
          <div className="seg">{(['day', 'week', 'month'] as const).map((z) => <button type="button" key={z} className={zoom === z ? 'on' : ''} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z[0].toUpperCase() + z.slice(1)}</button>)}</div>
          <select className="field" style={{ width: 'auto' }} value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <svg width={LEFT + days * px} height={height} style={{ display: 'block', fontFamily: 'var(--font)', fontSize: 12 }} aria-label="Timeline">
          {ticks.map((d) => <g key={d}><line x1={LEFT + dayIndex(d, from) * px} y1={0} x2={LEFT + dayIndex(d, from) * px} y2={height} stroke="rgba(255,255,255,.06)" /><text x={LEFT + dayIndex(d, from) * px + 4} y={14} fill="var(--text-faint)" className="mono" fontSize={10}>{label(d)}</text></g>)}
          <line className="tl-today" x1={LEFT + dayIndex(t, from) * px} y1={0} x2={LEFT + dayIndex(t, from) * px} y2={height} />
          {rows.map((r) => { const task = live.find((x) => x.id === r.id)!, tc = taskColor(task, projects); const d = drag?.id === r.id ? drag.dx * px : 0; const x = LEFT + r.x + (drag?.edge ? 0 : d), w = Math.max(r.w + (drag?.edge && drag.id === r.id ? d : 0), px); return (
            <g key={r.id} className={`tl-row${drag?.id === r.id ? ' lifted' : ''}`} style={{ ['--tc' as string]: tc }} transform={`translate(0, ${r.y + 24})`}>
              <circle cx={12} cy={ROW / 2} r={4} fill={pcolor(task.project_id)} />
              <text x={24} y={ROW / 2 + 4} fill="var(--text)" style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>{r.title.length > 28 ? `${r.title.slice(0, 27)}…` : r.title}</text>
              {r.due ? <path className="tl-fill" d={`M${x + px / 2} 8 l8 9 l-8 9 l-8 -9 z`} style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={(e) => onDown(e, r.id, false)} />
                : <><rect className="tl-fill" x={x} y={8} width={w} height={18} rx={6} style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={(e) => onDown(e, r.id, false)} />
                  <path className="tl-cap" d={`M${x + 6} 8 a6 6 0 0 0 -6 6 v6 a6 6 0 0 0 6 6 z`} pointerEvents="none" />
                  <rect className="tl-edge" x={x + w - 6} y={8} width={6} height={18} rx={3} style={{ cursor: 'ew-resize', touchAction: 'none' }} onPointerDown={(e) => onDown(e, r.id, true)} /></>}
            </g>); })}
          {ms.map((m, i) => <g key={m.id} className="tl-ms" style={{ ['--tc' as string]: pcolor(m.project_id) }} transform={`translate(${LEFT + dayIndex(m.due_at!, from) * px + px / 2}, ${height - 16 - (ms.length > 1 && i % 2 === 0 ? 18 : 0)})`}><title>{m.name}</title><path d="M0 -9 l8 9 l-8 9 l-8 -9 z" /><text x={10} y={4} fill="var(--text-dim)" fontSize={11}>{m.name}{projects.length > 1 ? ` · ${projects.find((p) => p.id === m.project_id)?.name ?? ''}` : ''}</text></g>)}
        </svg>
      </div>
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
