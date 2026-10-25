import type { TimeEntry } from '../../../shared/types.ts';
import { entryMinutes, formatElapsed } from '../../../shared/time.ts';
import { useStore, stopTimer } from '../store/useStore.ts';
import { useTimers } from './TimerButton.tsx';

/** Every running timer, on every screen; nothing when none runs. */
export function TimersBar() {
  const { entries, now } = useTimers();
  const running = entries.filter((e) => !e.ended_at).sort((a, b) => a.started_at.localeCompare(b.started_at));
  return running.length ? <Rows running={running} now={now} /> : null;
}

// Split out so the full store is read only while a timer runs.
function Rows({ running, now }: { running: TimeEntry[]; now: number }) {
  const { tasks, projects } = useStore();
  // A trashed task has left the device; its timer still shows so it can be stopped.
  const name = (e: TimeEntry) => e.task_id ? tasks.find((t) => t.id === e.task_id)?.title ?? 'A task (in Trash)' : projects.find((p) => p.id === e.project_id)?.name ?? 'A project (in Trash)';
  return (
    <section className="timers no-print" role="region" aria-label="Running timers">
      {running.map((e) => { const n = name(e), t = formatElapsed(entryMinutes(e, now)); return (
        <div className="trow" key={e.id}>
          <span className="tname">{n}</span>
          <b className="tel">{t}</b>
          <button type="button" className="btn" aria-label={`Stop timer: ${n}, ${t}`} onClick={() => void stopTimer(e.id)}>Stop</button>
        </div>); })}
    </section>
  );
}
