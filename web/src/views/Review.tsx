import { useState } from 'react';
import type { Settings, Task } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { today, addDays, startOfWeek, fmtDue, daysSince } from '../dates.ts';
import { useStore, updateTask, completeTask, trashTask } from '../store/useStore.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { toast, confirmAction } from '../ui/dialogs.tsx';
import { InboxView } from './Inbox.tsx';
import { confetti } from '../motion.ts';
import { taskColor, projectColor, accent } from '../ui/colors.ts';
import { appLabel } from '../ui/sources.ts';

const STEPS = ['Inbox to zero', 'Overdue', 'The next 7 days', 'Horizons', 'Waiting on'];

export function ReviewView() {
  const { tasks, projects, ready } = useStore();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  const t = today();
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id && x.status !== 'done');
  const byDue = (a: Task, b: Task) => (a.due_at ?? '').localeCompare(b.due_at ?? '');
  const finish = async (x: number, y: number) => {
    setBusy(true);
    try { await api<Settings>('/settings', { method: 'PATCH', json: { last_review_at: new Date().toISOString() } }); setDone(true); confetti(x, y, 'var(--ok)'); }
    catch (e) { toast((e as Error).message || 'Could not finish the review'); }
    setBusy(false);
  };
  const row = (x: Task, actions: [string, () => void | Promise<void>][], note?: string) => {
    const color = taskColor(x, projects), p = x.project_id ? projects.find((q) => q.id === x.project_id) : undefined, due = fmtDue(x.due_at);
    return (
      <div className="acard rv-row" key={x.id} style={accent(color)}>
        <div style={{ minWidth: 0 }}>
          <button type="button" className="tt" onClick={() => setOpen(x.id)}>{x.title}</button>
          <div className="m">
            {p && <span className="chip" style={{ ['--sc' as string]: projectColor(p) }}><i />{p.name}</span>}
            {x.source_app !== 'manual' && <span className="chip" style={{ ['--sc' as string]: color }}><i />{appLabel(x.source_app)}</span>}
            {x.kind === 'work' && <span className="chip" style={{ ['--sc' as string]: 'var(--accent)' }}><i />Work</span>}
            {note ? <span className="chip" style={{ ['--sc' as string]: 'var(--text-dim)' }}><i />{note}</span>
              : due.text && <span className="chip" style={{ ['--sc' as string]: due.tone === 'over' ? 'var(--danger)' : due.tone === 'due' ? 'var(--accent)' : 'var(--text-dim)' }}><i />{due.text}</span>}
          </div>
        </div>
        <div className="act">{actions.map(([label, fn]) => <button type="button" key={label} onClick={() => void fn()}>{label}</button>)}</div>
      </div>
    );
  };
  const list = (xs: Task[], empty: string, render: (x: Task) => React.ReactNode) => xs.length ? <div className="mlist">{xs.map(render)}</div> : <div className="card"><p style={{ margin: 0 }}>{empty}</p></div>;

  let body: React.ReactNode;
  if (step === 0) body = <InboxView embedded />;
  else if (step === 1) {
    const next = addDays(startOfWeek(t), 7);
    body = list(live.filter((x) => x.due_at && x.due_at < t).sort(byDue), 'Nothing overdue.', (x) => row(x, [
      ['Tomorrow', () => updateTask(x.id, { due_at: addDays(t, 1) })], ['Next week', () => updateTask(x.id, { due_at: next })], ['Done', () => completeTask(x.id)],
      ['Trash', async () => { if (await confirmAction(`Move "${x.title}" to the trash?`, { danger: true })) await trashTask(x.id); }]]));
  } else if (step === 2) {
    const end = addDays(t, 6);
    body = list(live.filter((x) => x.due_at && x.due_at >= t && x.due_at <= end).sort(byDue), 'Nothing due in the next 7 days.', (x) => row(x, []));
  } else if (step === 3) {
    body = list(live.filter((x) => x.horizon !== 'short'), 'No medium or long tasks.', (x) => row(x, [['Move to this week', () => updateTask(x.id, { horizon: 'short' })]], x.horizon));
  } else {
    body = list(live.filter((x) => x.status === 'waiting'), 'Nothing waiting on anyone.', (x) => {
      const d = x.waiting_since ? daysSince(x.waiting_since) : null;
      return row(x, [['Nudge in 3 days', () => updateTask(x.id, { nudge_every_days: 3 })], ['Got it', () => updateTask(x.id, { status: 'progress' })]],
        `${x.waiting_on ? `${x.waiting_on} · ` : ''}${d === null ? 'waiting' : d === 0 ? 'waiting since today' : `waiting ${d} day${d === 1 ? '' : 's'}`}`);
    });
  }
  return (
    <>
      <div className="head"><div><div className="eyebrow">Weekly review</div><h1 style={{ marginTop: 6 }}>Look back, <b>reset</b></h1></div></div>
      <ol className="steps" aria-label="Review steps">{STEPS.map((s, i) => <li key={s} data-done={i < step || done ? '' : undefined} aria-current={i === step && !done ? 'step' : undefined}>{i + 1}. {s}</li>)}</ol>
      {done ? <div className="card" role="status"><p style={{ margin: 0 }}>Review done. See you next week.</p></div> : (
        <>
          <h2 style={{ margin: '4px 0 0' }}>{STEPS[step]}</h2>
          {body}
          <div className="row">
            <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            {step < STEPS.length - 1
              ? <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>Next</button>
              : <button type="button" className="btn primary" disabled={busy} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void finish(r.left + r.width / 2, r.top); }}>Finish review</button>}
          </div>
        </>
      )}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
