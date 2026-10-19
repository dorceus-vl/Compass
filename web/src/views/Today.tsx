import { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { TaskRow } from '../ui/TaskRow.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { today, startOfWeek, fmtDue } from '../dates.ts';
import { Link } from '../router.ts';
import { AddedStrip } from '../ui/AddedStrip.tsx';

export function Today() {
  const { tasks, milestones, projects, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'personal' | 'work'>('all');
  if (!ready) return null;
  const t = today();
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id && (kind === 'all' || x.kind === kind));
  const openTasks = live.filter((x) => x.status !== 'done').sort((a, b) => (a.due_at ?? '9') < (b.due_at ?? '9') ? -1 : 1);
  const overdue = openTasks.filter((x) => x.due_at && x.due_at < t);
  const doneWeek = live.filter((x) => x.status === 'done' && x.done_at && x.done_at >= startOfWeek(t)).length;
  const col = (h: 'short' | 'medium' | 'long', title: string) => {
    const xs = openTasks.filter((x) => x.horizon === h);
    return (
      <div className="hz">
        <div className="hh"><b>{title}</b><small>{xs.length}</small></div>
        {xs.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Nothing here. ⌘K or + to add.</p>}
        {xs.slice(0, 12).map((x) => <TaskRow key={x.id} task={x} onOpen={setOpen} />)}
        {xs.length > 12 && <Link to="/list" className="chip">+{xs.length - 12} more in List</Link>}
      </div>
    );
  };
  const next = milestones.filter((m) => !m.done_at && m.due_at).sort((a, b) => a.due_at! < b.due_at! ? -1 : 1).slice(0, 4);
  return (
    <>
      <div className="head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 style={{ marginTop: 6 }}>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, <b>Vlad</b></h1>
          <div className="sub">{openTasks.filter((x) => x.due_at && x.due_at <= t).length} due today · <span style={{ color: overdue.length ? 'var(--danger)' : undefined }}>{overdue.length} overdue</span> · {doneWeek} done this week</div>
        </div>
        <div className="seg">{(['all', 'personal', 'work'] as const).map((k) => <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
      </div>
      <AddedStrip onOpen={setOpen} />
      {overdue.length > 0 && <div className="inbox" style={{ borderColor: 'rgba(255,77,94,.35)' }}><div className="top"><h2>Overdue <small>{overdue.length}</small></h2></div>{overdue.map((x) => <TaskRow key={x.id} task={x} onOpen={setOpen} />)}</div>}
      <div className="horizons">{col('short', 'Short · this week')}{col('medium', 'Medium · this quarter')}{col('long', 'Long · this year and beyond')}</div>
      {next.length > 0 && <div className="inbox"><div className="top"><h2>Next milestones</h2></div>
        {next.map((m) => <div key={m.id} className="task"><div className="tt">{m.name}</div><span className="chip" style={{ marginLeft: 'auto' }}>{projects.find((p) => p.id === m.project_id)?.name} · {fmtDue(m.due_at).text}</span></div>)}</div>}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
