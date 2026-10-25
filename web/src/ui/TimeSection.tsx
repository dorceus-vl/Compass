import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS, type Project, type Settings, type Task, type TimeEntry } from '../../../shared/types.ts';
import { MAX_ENTRY_MINUTES, MAX_NOTE, taskLogged, zonedToIso, isoToZoned } from '../../../shared/time.ts';
import { parseEstimate, formatEstimate } from '../../../shared/workload.ts';
import { addTime, editTime, deleteTime } from '../store/useStore.ts';
import { idb } from '../store/db.ts';
import { api } from '../api.ts';
import { todayIn } from '../dates.ts';
import { toast } from './dialogs.tsx';
import { useTimers } from './TimerButton.tsx';

/** settings.tz (cached for offline, like the report's) and day_hours (for "1d"). */
export function useTimeSettings() {
  const [s, set] = useState({ tz: DEFAULT_SETTINGS.tz, dayHours: DEFAULT_SETTINGS.workload.day_hours });
  useEffect(() => {
    let live = true;
    void idb.get<{ tz: string }>('meta', 'settings:tz').then((c) => { if (live && c) set((x) => ({ ...x, tz: c.tz })); }).catch(() => {});
    api<Settings>('/settings').then((r) => {
      if (!live) return;
      set({ tz: r.tz, dayHours: r.workload?.day_hours ?? DEFAULT_SETTINGS.workload.day_hours });
      void idb.put('meta', { id: 'settings:tz', tz: r.tz }).catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return s;
}

const SHOWN = 50;

/** The task sheet's Time section: total against the estimate, the entries (edit in place), Add time. */
export function TimeSection({ task, tasks }: { task: Task; tasks: Task[] }) {
  const { entries, now } = useTimers();
  const { tz, dayHours } = useTimeSettings();
  const [all, setAll] = useState(false);
  const logged = taskLogged(entries, task.id, tasks, now), est = task.estimate_minutes;
  const summary = est == null ? `${formatEstimate(logged)} logged`
    : `${formatEstimate(logged)} of ${formatEstimate(est)}${logged > est ? ` · +${formatEstimate(logged - est)}` : ''}`;
  const mine = entries.filter((e) => e.task_id === task.id).sort((a, b) => b.started_at.localeCompare(a.started_at));
  return (
    <section className="tsec" aria-label="Time">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Time</span>
        <b className="tsum">{summary}</b>
      </div>
      {mine.length > 0 && <ul className="tents">{(all ? mine : mine.slice(0, SHOWN)).map((e) => <EntryRow key={e.id} e={e} tz={tz} />)}</ul>}
      {!all && mine.length > SHOWN && <button type="button" className="btn" onClick={() => setAll(true)}>Show all {mine.length}</button>}
      {task.status === 'done'
        ? <p className="hint">This task is done, so time can't be added to it.</p>
        : <LogTimeForm tz={tz} dayHours={dayHours} onAdd={(s, e, note) => addTime({ task_id: task.id }, s, e, note)} />}
    </section>
  );
}

function EntryRow({ e, tz }: { e: TimeEntry; tz: string }) {
  // A bad value goes back to what was saved; the server has the last word (400 bad_time is toasted by the queue).
  const setTime = (key: 'started_at' | 'ended_at', input: HTMLInputElement) => {
    const was = e[key]!, iso = zonedToIso(input.value, tz);
    if (input.value === isoToZoned(was, tz)) return;
    const s = key === 'started_at' ? iso : e.started_at, end = key === 'ended_at' ? iso : e.ended_at;
    const span = s && end ? (Date.parse(end) - Date.parse(s)) / 60_000 : 0;
    if (!iso || span < 0 || span > MAX_ENTRY_MINUTES) {
      toast(!iso ? 'Use a full date and time' : span < 0 ? 'The end must come after the start' : 'One entry is 24 hours at most');
      input.value = isoToZoned(was, tz); return;
    }
    void editTime(e.id, { [key]: iso });
  };
  return (
    <li className="tent">
      <label className="qf">Start<input className="field" type="datetime-local" key={e.started_at + tz} defaultValue={isoToZoned(e.started_at, tz)} onBlur={(x) => setTime('started_at', x.currentTarget)} /></label>
      {e.ended_at
        ? <label className="qf">End<input className="field" type="datetime-local" key={e.ended_at + tz} defaultValue={isoToZoned(e.ended_at, tz)} onBlur={(x) => setTime('ended_at', x.currentTarget)} /></label>
        : <span className="qf">End<span className="trun">Running</span></span>}
      <label className="qf tnote">Note<input className="field" maxLength={MAX_NOTE} key={e.note ?? ''} defaultValue={e.note ?? ''}
        onBlur={(x) => { const v = x.currentTarget.value.trim() || null; if (v !== (e.note ?? null)) void editTime(e.id, { note: v }); }} /></label>
      <button type="button" className="btn tdel" onClick={() => { void deleteTime(e.id); toast('Moved to Trash'); }}>Delete</button>
      {e.auto_stopped === 1 && <p className="tauto"><span aria-hidden="true">⚠ </span>Stopped automatically, check the time</p>}
    </li>
  );
}

/** Date (09:00 local in settings.tz), duration ("1h 30m") and a note. Shared by the task sheet and the project's "Log time". */
export function LogTimeForm({ tz, dayHours, onAdd, noteRequired = false, submitLabel = 'Add time' }:
  { tz: string; dayHours: number; onAdd: (started_at: string, ended_at: string, note: string | null) => Promise<void> | void; noteRequired?: boolean; submitLabel?: string }) {
  const [date, setDate] = useState(() => todayIn(tz));
  const [dur, setDur] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => setDate(todayIn(tz)), [tz]);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const min = parseEstimate(dur, dayHours), start = zonedToIso(`${date}T09:00`, tz);
    if (!start) { setMsg('Pick a date'); return; }
    if (min == null || min < 1 || min > MAX_ENTRY_MINUTES) { setMsg('Use a duration up to 24 hours, like 1h 30m'); return; }
    if (noteRequired && !note.trim()) { setMsg('Add a note: what was the time for?'); return; }
    setMsg('');
    await onAdd(start, new Date(Date.parse(start) + min * 60_000).toISOString(), note.trim() || null);
    setDur(''); setNote('');
  };
  return (
    <form className="tadd" onSubmit={(ev) => void submit(ev)}>
      <label className="qf">Date<input className="field" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="qf">Duration<input className="field" placeholder="45m, 1h 30m" value={dur} onChange={(e) => { setDur(e.target.value); setMsg(''); }} /></label>
      <label className="qf tnote">{noteRequired ? 'Note' : 'Note (optional)'}<input className="field" maxLength={MAX_NOTE} required={noteRequired} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="submit" className="btn">{submitLabel}</button>
      <p className="hint" role="status" style={{ gridColumn: '1 / -1', margin: 0 }}>{msg}</p>
    </form>
  );
}

/** The project page's "Log time": time on the project itself, with a note saying what it was for. */
export function LogTimeDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tz, dayHours } = useTimeSettings();
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="logtime-h" style={{ maxWidth: 560 }}>
      <h2 id="logtime-h" style={{ marginTop: 0, fontSize: 18 }}>Log time on {project.name}</h2>
      <LogTimeForm tz={tz} dayHours={dayHours} noteRequired submitLabel="Log time"
        onAdd={async (s, e, note) => { await addTime({ project_id: project.id, note: note! }, s, e, note); toast('Time logged'); ref.current?.close(); }} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button></div>
    </dialog>
  );
}
