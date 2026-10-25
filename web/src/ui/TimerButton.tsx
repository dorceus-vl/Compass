import { useSyncExternalStore } from 'react';
import type { Task, TimeEntry } from '../../../shared/types.ts';
import { MAX_RUNNING, entryMinutes, formatElapsed } from '../../../shared/time.ts';
import { idb } from '../store/db.ts';
import { onChange } from '../store/sync.ts';
import { startTimer, stopTimer } from '../store/useStore.ts';

// One shared view of the live time entries and "now" for every card, the bar and the sheet:
// one IndexedDB read per store change and one 60 s interval while anything is on screen.
type Snap = { entries: TimeEntry[]; now: number };
let snap: Snap = { entries: [], now: Date.now() };
const subs = new Set<() => void>();
let stop: (() => void) | null = null;
const emit = (entries = snap.entries) => { snap = { entries, now: Date.now() }; subs.forEach((f) => f()); };
const load = async () => emit((await idb.all<TimeEntry>('time')).filter((e) => !e.deleted_at));
function subscribe(f: () => void) {
  subs.add(f);
  if (!stop) {
    const off = onChange(() => void load()), tick = setInterval(() => emit(), 60_000);
    stop = () => { off(); clearInterval(tick); };
    void load();
  }
  return () => { subs.delete(f); if (!subs.size) { stop?.(); stop = null; } };
}
export const useTimers = (): Snap => useSyncExternalStore(subscribe, () => snap);

const Play = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z" /></svg>;
const Stop = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></svg>;

/** Start or stop this task's timer. `label` spells it out (the task sheet); a card shows the icon and the elapsed time. */
export function TimerButton({ task, label = false }: { task: Task; label?: boolean }) {
  const { entries, now } = useTimers();
  const run = entries.find((e) => e.task_id === task.id && !e.ended_at);
  if (run) {
    const t = formatElapsed(entryMinutes(run, now));
    return <button type="button" className="btn timer on" aria-label={`Stop timer: ${task.title}, ${t}`} onClick={() => void stopTimer(run.id)}><Stop />{label ? `Stop timer · ${t}` : t}</button>;
  }
  const why = task.status === 'done' ? 'This task is done' : entries.filter((e) => !e.ended_at).length >= MAX_RUNNING ? 'Five timers are running' : undefined;
  return <button type="button" className="btn timer" disabled={!!why} title={why} aria-label={`Start timer: ${task.title}${why ? ` (${why})` : ''}`}
    onClick={() => void startTimer({ task_id: task.id })}><Play />{label && 'Start timer'}</button>;
}
