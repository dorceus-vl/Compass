import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Status } from '../../../shared/types.ts';
import { useStore, moveTask } from '../store/useStore.ts';
import { api } from '../api.ts';
import { Card } from '../ui/Card.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { startOfWeek, today } from '../dates.ts';
import { toast } from '../ui/dialogs.tsx';
import { positionBetween } from '../../../shared/position.ts';
import { blockedIds } from '../../../shared/deps.ts';

const COLS: [Status, string, string][] = [['new', 'New', 'var(--text-faint)'], ['progress', 'In progress', 'var(--accent)'], ['hold', 'On hold', 'var(--warn)'], ['waiting', 'Waiting on', 'var(--h-long)'], ['done', 'Done', 'var(--ok)']];

export function Board() {
  const { tasks, projects, ready } = useStore();
  const blocked = blockedIds(tasks);
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'personal' | 'work'>(() => (localStorage.getItem('compass.board.kind') as 'all') || 'all');
  const [project, setProject] = useState('');
  const [lanes, setLanes] = useState(false);
  const [wip, setWip] = useState<Record<string, number | null>>({});
  const drag = useRef<{ id: string; moved: boolean; el: HTMLElement | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const [landed, setLanded] = useState<string | null>(null); // the card just dropped, for its settle animation
  const lastDrag = useRef(0); // a drag released over its own card still fires click; ignore it
  useEffect(() => { api<{ wip_limits: Record<string, number | null> }>('/settings').then((s) => setWip(s.wip_limits)).catch(() => {}); }, []);
  useEffect(() => localStorage.setItem('compass.board.kind', kind), [kind]);
  const landTimers = useRef<number[]>([]);
  useEffect(() => () => { stopDrag.current?.(); landTimers.current.forEach(clearTimeout); }, []); // unmount mid-drag: drop the clone and listeners, and the settle timers
  if (!ready) return null;

  const wk = startOfWeek(today());
  const live = tasks.filter((t) => !t.deleted_at && !t.parent_id && (kind === 'all' || t.kind === kind) && (!project || t.project_id === project) && (t.status !== 'done' || (t.done_at ?? '') >= wk));
  const byCol = (s: Status, pid?: string | null) => live.filter((t) => t.status === s && (pid === undefined || t.project_id === pid)).sort((a, b) => a.sort_in_column - b.sort_in_column);
  const subs = (id: string) => tasks.filter((t) => t.parent_id === id && !t.deleted_at);

  // Pointer drag: a card follows the pointer; the column and the card under it on release decide the drop.
  function onPointerDown(e: ReactPointerEvent, id: string) {
    if (e.button !== 0 || drag.current) return; // one drag at a time: a second finger is ignored
    const card = e.currentTarget as HTMLElement, r0 = card.getBoundingClientRect(), pid = e.pointerId;
    const grab = { x: e.clientX - r0.left, y: e.clientY - r0.top }; // keep the grab point so the clone does not jump
    const start = { x: e.clientX, y: e.clientY };
    drag.current = { id, moved: false, el: null };
    // Touch: a drag starts only after a 300 ms press that stayed within 6 px; moving sooner is a scroll, so the drag is dropped.
    const touch = e.pointerType === 'touch';
    let armed = !touch, timer = 0;
    const block = (ev: TouchEvent) => ev.preventDefault(); // once dragging, the page must not scroll under the finger
    if (touch) timer = window.setTimeout(() => { armed = true; window.addEventListener('touchmove', block, { passive: false }); }, 300);
    let lastX = start.x, tilt = 0, calm = 0;
    const calmer = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stop = () => {
      clearTimeout(timer); clearTimeout(calm); window.removeEventListener('touchmove', block);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel);
      drag.current?.el?.remove(); drag.current = null; stopDrag.current = null; setDragId(null);
      document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
    };
    stopDrag.current = stop;
    const onMove = (ev: PointerEvent) => {
      const d = drag.current; if (!d || ev.pointerId !== pid) return;
      if (!d.moved) {
        const far = Math.hypot(ev.clientX - start.x, ev.clientY - start.y) >= 6;
        if (!armed) { if (far) stop(); return; }
        if (!far) return;
      }
      if (!d.moved) {
        d.moved = true; setDragId(id);
        d.el = card.cloneNode(true) as HTMLElement;
        d.el.style.cssText = `position:fixed;pointer-events:none;width:${r0.width}px;z-index:60`;
        d.el.classList.add('lift');
        document.body.appendChild(d.el);
        lastX = ev.clientX;
      }
      d.el!.style.left = `${ev.clientX - grab.x}px`; d.el!.style.top = `${ev.clientY - grab.y}px`;
      // Lift is CSS (.kc.lift); the tilt follows the pointer's horizontal speed, up to 2 degrees, and settles when it stops.
      if (!calmer) {
        tilt = Math.max(-2, Math.min(2, tilt * 0.6 + (ev.clientX - lastX) * 0.25));
        d.el!.style.setProperty('--tilt', `${tilt}deg`);
        clearTimeout(calm); calm = window.setTimeout(() => d.el?.style.setProperty('--tilt', '0deg'), 90);
      }
      lastX = ev.clientX;
      document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
      document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-col]')?.classList.add('over'); // the target column glows
    };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pid) stop(); };
    const onUp = async (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const moved = drag.current?.moved; stop();
      if (!moved) return;
      lastDrag.current = Date.now();
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const col = under?.closest<HTMLElement>('[data-col]'); if (!col) return;
      const status = col.dataset.col as Status;
      const cardEl = under?.closest<HTMLElement>('[data-task]');
      if (cardEl?.dataset.task === id) return; // dropped on itself
      const column = byCol(status).filter((t) => t.id !== id);
      let beforeId: string | null = null;
      if (cardEl) {
        const r = cardEl.getBoundingClientRect();
        const i = column.findIndex((t) => t.id === cardEl.dataset.task);
        beforeId = ev.clientY < r.top + r.height / 2 ? column[i]?.id ?? null : column[i + 1]?.id ?? null;
      }
      const bi = beforeId ? column.findIndex((t) => t.id === beforeId) : column.length;
      if (tasks.find((t) => t.id === id)?.status === status && byCol(status).findIndex((t) => t.id === id) === bi) return; // same place
      const limit = wip[status];
      if (limit && status !== 'done' && column.length >= limit) toast(`${COLS.find((c) => c[0] === status)![1]} is at its limit of ${limit}`);
      setLanded(id); landTimers.current.push(window.setTimeout(() => setLanded((l) => (l === id ? null : l)), 600)); // only clears its own card
      await moveTask(id, status, beforeId, positionBetween(column[bi - 1]?.sort_in_column ?? null, column[bi]?.sort_in_column ?? null));
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
  }

  const column = (s: Status, label: string, colour: string, pid?: string | null) => {
    const xs = byCol(s, pid);
    const limit = wip[s];
    const state = !limit || s === 'done' ? undefined : xs.length > limit ? 'over' : xs.length === limit ? 'at' : 'ok';
    return (
      <div className="col" data-col={s} data-wip={state} key={`${s}-${pid ?? ''}`} style={{ ['--c' as string]: colour }}>
        <div className="ch"><i /><b>{label}</b><small>{xs.length}{limit ? ` / ${limit}` : ''}</small></div>
        {limit && s !== 'done' ? <div className="wip" aria-hidden="true" style={{ ['--w' as string]: Math.min(1, xs.length / limit) }}><i /></div> : null}
        {xs.map((t) => <Card key={t.id} task={t} project={projects.find((p) => p.id === t.project_id)} projects={projects} landed={landed === t.id} subtasks={subs(t.id)} blocked={blocked.has(t.id)} onOpen={(i) => Date.now() - lastDrag.current > 300 && setOpen(i)} dragging={dragId === t.id} onPointerDown={onPointerDown} />)}
      </div>
    );
  };

  return (
    <>
      <div className="head">
        <div><div className="eyebrow">Board</div><h1 style={{ marginTop: 6 }}>Work <b>in motion</b></h1><div className="sub">{live.filter((t) => t.status !== 'done').length} open · {live.filter((t) => t.status === 'hold').length} on hold</div></div>
        <div className="row">
          <div className="seg">{(['all', 'personal', 'work'] as const).map((k) => <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
          <div className="seg"><button type="button" className={!lanes ? 'on' : ''} aria-pressed={!lanes} onClick={() => setLanes(false)}>Columns</button><button type="button" className={lanes ? 'on' : ''} aria-pressed={lanes} onClick={() => setLanes(true)}>Swimlanes</button></div>
          <select className="field" style={{ width: 'auto' }} value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
      </div>
      {!lanes && <div className="board">{COLS.map(([s, l, c]) => column(s, l, c))}</div>}
      {lanes && [...projects.map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: 'No project' }].map((lane) => (
        <section key={lane.id ?? 'none'}><div className="eyebrow" style={{ margin: '14px 0 8px' }}>{lane.name}</div><div className="board">{COLS.map(([s, l, c]) => column(s, l, c, lane.id))}</div></section>
      ))}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
