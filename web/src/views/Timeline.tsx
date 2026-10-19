import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore, updateTask } from '../store/useStore.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { layout, dayIndex, shiftDates } from '../timeline-math.ts';
import { today, addDays } from '../dates.ts';

const ZOOM = { day: 48, week: 18, month: 6 } as const;
const ROW = 34, LEFT = 220;
const label = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); };

export function Timeline() {
  const { tasks, milestones, projects, ready } = useStore();
  const [zoom, setZoom] = useState<keyof typeof ZOOM>('week');
  const [project, setProject] = useState('');
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
  const height = (rows.length + 1) * ROW + 40;

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
        <svg width={LEFT + days * px} height={height} style={{ display: 'block', fontFamily: 'var(--font)', fontSize: 12, touchAction: 'pan-y' }} aria-label="Timeline">
          {ticks.map((d) => <g key={d}><line x1={LEFT + dayIndex(d, from) * px} y1={0} x2={LEFT + dayIndex(d, from) * px} y2={height} stroke="rgba(255,255,255,.06)" /><text x={LEFT + dayIndex(d, from) * px + 4} y={14} fill="var(--text-faint)" className="mono" fontSize={10}>{label(d)}</text></g>)}
          <line x1={LEFT + dayIndex(t, from) * px} y1={0} x2={LEFT + dayIndex(t, from) * px} y2={height} stroke="var(--accent)" strokeDasharray="3 3" />
          {rows.map((r) => { const d = drag?.id === r.id ? drag.dx * px : 0; const x = LEFT + r.x + (drag?.edge ? 0 : d), w = r.w + (drag?.edge && drag.id === r.id ? d : 0); return (
            <g key={r.id} transform={`translate(0, ${r.y + 24})`}>
              <text x={8} y={ROW / 2 + 4} fill="var(--text)" style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>{r.title.slice(0, 32)}</text>
              {r.due ? <path d={`M${x + px / 2} 8 l8 9 l-8 9 l-8 -9 z`} fill="var(--accent)" style={{ cursor: 'grab' }} onPointerDown={(e) => onDown(e, r.id, false)} />
                : <><rect x={x} y={8} width={Math.max(w, 4)} height={18} rx={6} fill="rgba(var(--accent-rgb),.25)" stroke="var(--accent)" style={{ cursor: 'grab' }} onPointerDown={(e) => onDown(e, r.id, false)} />
                  <rect x={x + Math.max(w, 4) - 6} y={8} width={6} height={18} fill="var(--accent)" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onDown(e, r.id, true)} /></>}
            </g>); })}
          {ms.map((m) => <g key={m.id} transform={`translate(${LEFT + dayIndex(m.due_at!, from) * px + px / 2}, ${height - 16})`}><title>{m.name}</title><path d="M0 -8 l7 8 l-7 8 l-7 -8 z" fill="var(--nightowl)" /><text x={10} y={4} fill="var(--text-dim)" fontSize={11}>{m.name}{projects.length > 1 ? ` · ${projects.find((p) => p.id === m.project_id)?.name ?? ''}` : ''}</text></g>)}
        </svg>
      </div>
      {open && <TaskSheet taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
