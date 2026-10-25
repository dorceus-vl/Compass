import { useSyncExternalStore } from 'react';
import type { Task, TimeEntry } from '../../../shared/types.ts';
import { MAX_RUNNING, entryMinutes, formatElapsed } from '../../../shared/time.ts';
import { idb } from '../store/db.ts';
import { onChange } from '../store/sync.ts';
import { startTimer, stopTimer } from '../store/useStore.ts';

// One shared view of the live time entries and "now" for every card, the bar and the sheet: one IndexedDB read per store
// change, a new snapshot only when an entry changed, and one 60 s tick only while something is subscribed and a timer runs.
type Snap = { entries: TimeEntry[]; now: number };
let snap: Snap = { entries: [], now: Date.now() };
let sig = '', seq = 0, tick: ReturnType<typeof setInterval> | undefined, off: (() => void) | null = null;
const subs = new Set<() => void>();
const publish = (next: Snap) => { snap = next; subs.forEach((f) => f()); };
const setTick = () => {
  const want = subs.size > 0 && snap.entries.some((e) => !e.ended_at);
  if (want && !tick) tick = setInterval(() => publish({ ...snap, now: Date.now() }), 60_000);
  if (!want && tick) { clearInterval(tick); tick = undefined; }
};
async function load() {
  const n = ++seq;
  const entries = (await idb.all<TimeEntry>('time')).filter((e) => !e.deleted_at);
  if (n !== seq) return; // a later read already answered
  const s = entries.map((e) => `${e.id}:${e.updated_at}:${e.ended_at ?? ''}`).join('|');
  if (s !== sig) { sig = s; publish({ entries, now: Date.now() }); }
  setTick();
}
const reload = () => { load().catch((e) => console.error('time entries', e)); };
function subscribe(f: () => void) {
  subs.add(f);
  if (!off) { off = onChange(reload); reload(); }
  return () => { subs.delete(f); if (!subs.size) { off?.(); off = null; sig = ''; setTick(); } };
}
export const useTimers = (): Snap => useSyncExternalStore(subscribe, () => snap);
/** Just what one button needs, as a string, so a card re-renders only when its own text changes. */
const useTaskTimer = (taskId: string) => useSyncExternalStore(subscribe, () => {
  const run = snap.entries.find((e) => e.task_id === taskId && !e.ended_at);
  return run ? `${run.id} ${entryMinutes(run, snap.now)}` : snap.entries.filter((e) => !e.ended_at).length >= MAX_RUNNING ? 'full' : '';
});

const Play = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z" /></svg>;
const Stop = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></svg>;

/** Start or stop this task's timer. `label` spells it out (the task sheet); a card shows the icon and the elapsed time. */
export function TimerButton({ task, label = false }: { task: Task; label?: boolean }) {
  const state = useTaskTimer(task.id);
  if (state && state !== 'full') {
    const [id, min] = state.split(' '), t = formatElapsed(Number(min));
    return <button type="button" className="btn timer on" aria-label={`Stop timer: ${task.title}, ${t}`} onClick={() => void stopTimer(id)}><Stop />{label ? `Stop timer · ${t}` : t}</button>;
  }
  const why = task.status === 'done' ? 'This task is done' : state === 'full' ? 'Five timers are running' : undefined;
  const btn = <button type="button" className="btn timer" disabled={!!why} title={why} aria-label={`Start timer: ${task.title}${why ? ` (${why})` : ''}`}
    onClick={() => void startTimer({ task_id: task.id })}><Play />{label && 'Start timer'}</button>;
  // A disabled button's title is unreliable (and invisible on touch): the sheet says it in a line.
  return label && state === 'full' && task.status !== 'done'
    ? <span className="timerwrap">{btn}<p className="hint" style={{ margin: 0 }}>Five timers are running: stop one to start another</p></span> : btn;
}
