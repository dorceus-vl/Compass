import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { useStore, updateTask } from '../store/useStore.ts';
import { idb } from '../store/db.ts';
import { api, online } from '../api.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { toast } from '../ui/dialogs.tsx';
import { taskColor, accent } from '../ui/colors.ts';
import { today } from '../dates.ts';
import { add, monthGrid, weekDays, placeTasks, placeEvents, eventTime, eventLabel, type CalEvent } from '../calendar-math.ts';

type Mode = 'month' | 'week';
const PHONE = '(max-width:760px)';
const KEEP_DAYS = 14;
const parts = (ymd: string) => ymd.split('-').map(Number) as [number, number, number];
const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => { const [y, m, d] = parts(ymd); return new Date(y, m - 1, d).toLocaleDateString('en-CA', o); };
const long = (ymd: string) => fmt(ymd, { weekday: 'long', month: 'long', day: 'numeric' });
const monthStart = (ymd: string, n = 0) => { const [y, m] = parts(ymd); const d = new Date(y, m - 1 + n, 1); return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function usePhone() {
  const [phone, set] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => { const q = matchMedia(PHONE), on = () => set(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, []);
  return phone;
}

/** Kelly's events for from..to through the Worker. The last answer is kept in `meta` per range (like Today's brief), so offline shows what was last seen; online, "unavailable" clears it. */
function useEvents(from: string, to: string): { events: CalEvent[]; saved: boolean } {
  const [state, set] = useState<{ events: CalEvent[]; saved: boolean }>({ events: [], saved: false });
  useEffect(() => {
    let live = true;
    const id = `kelly-cal:${from}:${to}`;
    set({ events: [], saved: false });
    void idb.get<{ events: CalEvent[] }>('meta', id).then((c) => { if (live && c) set((cur) => (cur.events.length || cur.saved ? cur : { events: c.events, saved: true })); }).catch(() => {});
    if (online()) {
      api<{ events?: CalEvent[]; unavailable?: true }>(`/kelly/calendar?from=${from}&to=${to}`).then(async (r) => {
        if (!live) return;
        set({ events: r.events ?? [], saved: false });
        if (r.events) {
          await idb.put('meta', { id, events: r.events, at: new Date().toISOString() });
          // ponytail: one row per range visited; rows older than two weeks go on each save. Upgrade to a size cap if it ever matters.
          const old = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
          for (const m of await idb.all<{ id: string; at?: string }>('meta')) if (m.id.startsWith('kelly-cal:') && m.id !== id && (m.at ?? '') < old) await idb.del('meta', m.id);
        } else await idb.del('meta', id);
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [from, to]);
  return state;
}

interface Drag { id: string; title: string; color: string; x: number; y: number; over: string | null }

export function Calendar() {
  const { tasks, projects, ready } = useStore();
  const phone = usePhone();
  const t = today();
  const [mode, setMode] = useState<Mode>(() => (matchMedia(PHONE).matches ? 'week' : 'month'));
  const [anchor, setAnchor] = useState(t); // any day in the page shown
  const [sel, setSel] = useState(t); // the day with focus (roving tabindex)
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  const stop = useRef<(() => void) | null>(null);
  const justDragged = useRef(false);
  const focusCell = useRef(false);
  const focusTask = useRef<string | null>(null);
  const panel = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => stop.current?.(), []); // unmount mid-drag: drop the listeners

  const days = useMemo(() => (mode === 'month' ? monthGrid(...(parts(anchor).slice(0, 2) as [number, number])).flat() : weekDays(anchor)), [mode, anchor]);
  const { events, saved } = useEvents(days[0], days[days.length - 1]);
  const byTask = useMemo(() => placeTasks(tasks, days, t), [tasks, days, t]);
  const byEvent = useMemo(() => placeEvents(events, days), [events, days]);
  const month = parts(anchor)[1];

  useLayoutEffect(() => {
    if (focusCell.current) { focusCell.current = false; document.querySelector<HTMLElement>(`[data-day="${sel}"]`)?.focus(); }
    if (focusTask.current) { const el = document.querySelector<HTMLElement>(`.cal-cell [data-task="${focusTask.current}"]`); if (el && el.closest<HTMLElement>('[data-day]')?.dataset.day === sel) { focusTask.current = null; el.focus(); } } // wait until the saved date has put the chip in its new day
  });
  useEffect(() => { if (dayOpen) panel.current?.focus(); }, [dayOpen]);

  if (!ready) return null;

  /** Moves the focused day (and the page, when it leaves the one shown). */
  const go = (day: string) => { setSel(day); if (!days.includes(day)) setAnchor(day); };
  const step = (n: number) => {
    const next = mode === 'month' ? monthStart(anchor, n) : add(anchor, 7 * n);
    setAnchor(next); setSel(mode === 'month' ? (t.startsWith(next.slice(0, 7)) ? t : next) : add(sel, 7 * n)); setDayOpen(null);
  };
  const toToday = () => { setAnchor(t); setSel(t); };
  const switchMode = (m: Mode) => { setMode(m); setAnchor(sel); setDayOpen(null); };

  const openDay = (d: string) => { setSel(d); setDayOpen(d); };
  const onCellKey = (e: ReactKeyboardEvent<HTMLElement>, d: string) => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return;
    const vert = phone && mode === 'week' ? 1 : 7; // a phone's week is a column of days
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -vert, ArrowDown: vert } as Record<string, number>)[e.key];
    if (delta) { e.preventDefault(); focusCell.current = true; go(add(d, delta)); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); focusCell.current = true; go(weekDays(d)[e.key === 'Home' ? 0 : 6]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(d); }
    else if (e.key === 'Escape' && dayOpen) setDayOpen(null);
  };

  const move = (task: Task, to: string) => {
    if (task.due_at === to) return;
    void updateTask(task.id, { due_at: to });
    setSaid(`${task.title} moved to ${long(to)}`); toast(`Moved to ${fmt(to, { weekday: 'short', month: 'short', day: 'numeric' })}`);
  };

  // Keyboard: Alt + arrows move the focused task by a day (or a week); Escape goes back to the day. The task sheet's Due field does the same by date.
  const onChipKey = (e: ReactKeyboardEvent<HTMLElement>, task: Task, d: string) => {
    if (e.key === 'Escape') { e.stopPropagation(); document.querySelector<HTMLElement>(`[data-day="${d}"]`)?.focus(); return; }
    const delta = e.altKey ? ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key] : undefined;
    if (!delta) return;
    e.preventDefault();
    const to = add(d, delta);
    focusTask.current = task.id; go(to); move(task, to);
  };

  // Pointer: a mouse drags after 5 px; a finger after a short press (so a swipe still scrolls). The day under the pointer is read from data-day.
  const onChipDown = (e: ReactPointerEvent<HTMLElement>, task: Task, color: string) => {
    if (e.button !== 0 || stop.current) return;
    const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId, touch = e.pointerType === 'touch';
    let active = false, timer = 0;
    const overOf = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]')?.dataset.day ?? null;
    let px = x0, py = y0, raf = 0;
    // Near the top or bottom edge the page scrolls under the held task, so a day off screen can be reached.
    const scroll = () => {
      const h = innerHeight, dy = py < 80 ? -12 : py > h - 110 ? 12 : 0;
      if (dy) { scrollBy(0, dy); setDrag((d) => d && { ...d, over: overOf(px, py) }); }
      raf = requestAnimationFrame(scroll);
    };
    const begin = (x: number, y: number) => { active = true; px = x; py = y; setDrag({ id: task.id, title: task.title, color, x, y, over: overOf(x, y) }); raf = requestAnimationFrame(scroll); };
    const end = () => {
      clearTimeout(timer); cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onEsc, true); window.removeEventListener('touchmove', onTouch);
      stop.current = null; setDrag(null);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= (touch ? 8 : 5)) return;
        if (touch) { end(); return; } // moved before the press was long enough: it is a scroll
        begin(ev.clientX, ev.clientY); return;
      }
      px = ev.clientX; py = ev.clientY;
      setDrag((d) => d && { ...d, x: px, y: py, over: overOf(px, py) });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const was = active, over = was ? overOf(ev.clientX, ev.clientY) : null;
      end();
      if (was) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }); if (over) move(task, over); }
    };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pid) end(); };
    const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); if (active) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }); } end(); } };
    const onTouch = (ev: TouchEvent) => { if (active) ev.preventDefault(); }; // once the drag has begun the page must not scroll under the finger
    stop.current = end;
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onEsc, true);
    if (touch) { window.addEventListener('touchmove', onTouch, { passive: false }); timer = window.setTimeout(() => begin(x0, y0), 350); }
  };

  const chip = (task: Task, d: string, projs: Project[]) => {
    const color = taskColor(task, projs), done = task.status === 'done', late = !done && !!task.due_at && task.due_at < t;
    return (
      <button type="button" key={task.id} data-task={task.id} className={`cal-chip${done ? ' done' : ''}${late ? ' late' : ''}${drag?.id === task.id ? ' lifted' : ''}`} style={accent(color)}
        tabIndex={sel === d ? 0 : -1} title={task.title}
        onPointerDown={(e) => onChipDown(e, task, color)} onContextMenu={(e) => { if (drag) e.preventDefault(); }}
        onClick={(e) => { e.stopPropagation(); if (!justDragged.current) setOpen(task.id); }} onKeyDown={(e) => onChipKey(e, task, d)}>
        <span className="t">{task.title}</span>{late && <span className="mono">late</span>}
      </button>
    );
  };
  const eventRow = (e: CalEvent, i: number, wide: boolean) => (
    <div key={`${e.start}${i}`} className="cal-ev" title={`${eventTime(e) || 'All day'} ${e.title} · ${eventLabel(e)}`}>
      <span className="mono">{eventTime(e) || 'All day'}</span><span className="t">{e.title}</span>{wide && <small>{eventLabel(e)}</small>}
    </div>
  );

  const limit = mode === 'month' ? 3 : 8; // the rest is behind "+N more" (the day panel)
  const cell = (d: string) => {
    const ts = byTask[d] ?? [], es = byEvent[d] ?? [], dots = phone && mode === 'month';
    const items = [...ts.map((x) => ({ task: x })), ...es.map((x, i) => ({ ev: x, i }))];
    const shown = dots ? [] : items.slice(0, limit), more = dots ? 0 : items.length - shown.length;
    const label = `${long(d)}${d === t ? ', today' : ''}. ${plural(ts.length, 'task')}, ${plural(es.length, 'event')}`;
    return (
      <div key={d} role="gridcell" data-day={d} className={`cal-cell${d === t ? ' today' : ''}${mode === 'month' && Number(d.slice(5, 7)) !== month ? ' out' : ''}${sel === d ? ' sel' : ''}${drag?.over === d ? ' drop' : ''}${dayOpen === d ? ' open' : ''}`}
        tabIndex={sel === d ? 0 : -1} aria-label={label} aria-current={d === t ? 'date' : undefined} onKeyDown={(e) => onCellKey(e, d)} onClick={() => { if (!justDragged.current) openDay(d); }} onFocus={(e) => { if (e.target === e.currentTarget) setSel(d); }}>
        <span className="cal-num" aria-hidden="true">{phone && mode === 'week' ? <><span className="mono">{fmt(d, { weekday: 'short' })}</span> {Number(d.slice(8))}</> : Number(d.slice(8))}</span>
        {dots && <span className="cal-dots" aria-hidden="true">{ts.slice(0, 4).map((x) => <i key={x.id} style={accent(taskColor(x, projects))} />)}{es.length > 0 && <i className="ev" />}{ts.length > 4 && <b>+</b>}</span>}
        {shown.length > 0 && <div className="cal-items">{shown.map((x) => 'task' in x ? chip(x.task, d, projects) : eventRow(x.ev, x.i, mode === 'week'))}</div>}
        {more > 0 && <button type="button" className="cal-more" tabIndex={sel === d ? 0 : -1} onClick={(e) => { e.stopPropagation(); openDay(d); }}>+{more} more</button>}
      </div>
    );
  };

  const rows = mode === 'month' ? [0, 1, 2, 3, 4, 5].map((r) => days.slice(r * 7, r * 7 + 7)) : [days];
  const title = mode === 'month' ? <><b>{fmt(anchor, { month: 'long' })}</b> {anchor.slice(0, 4)}</> : <><b>{fmt(days[0], { month: 'short', day: 'numeric' })}</b> – {fmt(days[6], days[0].slice(0, 7) === days[6].slice(0, 7) ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, {days[6].slice(0, 4)}</>;
  const dTasks = dayOpen ? byTask[dayOpen] ?? [] : [], dEvents = dayOpen ? byEvent[dayOpen] ?? [] : [];
  const ghost = drag && <div className="cal-ghost" style={{ ...accent(drag.color), transform: `translate(${drag.x + 12}px,${drag.y + 12}px)` }} aria-hidden="true">{drag.title}</div>;
  return (
    <div className="calendar">
      <div className="head">
        <div><div className="eyebrow">Calendar</div><h1 style={{ marginTop: 6 }}>{title}</h1>
          <div className="sub">{phone ? (mode === 'week' ? 'Press and hold a task, then drag it to another day.' : 'Tap a day to see it. The week view lets you drag tasks.') : 'Drag a task to another day. Alt + arrow keys move the focused task.'}{saved ? ' Kelly’s events are the last ones saved.' : ''}</div></div>
        <div className="row cal-ctl">
          <div className="seg" role="group" aria-label="View">{(['month', 'week'] as const).map((m) => <button type="button" key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => switchMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}</div>
          <div className="row cal-nav"><button type="button" className="btn" aria-label={mode === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>‹</button>
            <button type="button" className="btn" onClick={toToday}>Today</button>
            <button type="button" className="btn" aria-label={mode === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>›</button></div>
        </div>
      </div>
      <div className={`cal-grid ${mode}`} role="grid" aria-label={mode === 'month' ? 'Month' : 'Week'}>
        <div className="cal-dow" role="row" aria-hidden="true">{days.slice(0, 7).map((d) => <span key={d} className="mono">{fmt(d, { weekday: 'short' })}</span>)}</div>
        {rows.map((r) => <div key={r[0]} role="row" className="cal-row">{r.map(cell)}</div>)}
      </div>
      {events.length > 0 && <p className="cal-key"><span className="cal-ev-sample" aria-hidden="true" /> Dim lines are Kelly’s calendar events, read only.</p>}
      {dayOpen && (
        <section className="card cal-day" aria-labelledby="cal-day-h">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="cal-day-h" ref={panel} tabIndex={-1}>{long(dayOpen)}</h2>
            <button type="button" className="btn" onClick={() => { focusCell.current = true; setSel(dayOpen); setDayOpen(null); }}>Close</button>
          </div>
          {dTasks.length === 0 && dEvents.length === 0 && <p>Nothing on this day.</p>}
          {dTasks.length > 0 && <div className="cal-day-list">{dTasks.map((x) => chip(x, dayOpen, projects))}</div>}
          {dEvents.length > 0 && <div className="cal-day-list">{dEvents.map((e, i) => <div key={i} className="cal-ev wide"><span className="mono">{eventTime(e) || 'All day'}</span><span className="t">{e.title}{e.location ? ` · ${e.location}` : ''}</span><small>{eventLabel(e)}</small></div>)}</div>}
        </section>
      )}
      <div className="sr-only" role="status" aria-live="polite">{said}</div>
      {ghost}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
