import { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { TaskList, useFinished } from '../ui/TaskCard.tsx';
import { arrange } from '../query.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { today, addDays } from '../dates.ts';

const heading = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' }); };

export function Upcoming() {
  const { tasks, projects, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [finished, onFinish] = useFinished();
  if (!ready) return null;
  const t = today();
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id); // done ones too: arrange keeps only those finished during this visit
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i));
  const later = live.filter((x) => x.due_at && x.due_at > days[13]).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const none = live.filter((x) => !x.due_at);
  const overdue = live.filter((x) => x.due_at && x.due_at < t);
  const section = (title: string, xs: typeof live) => {
    const a = arrange(xs, finished);
    return a.shown.length > 0 && <div className="hz" key={title}><div className="hh"><b>{title}</b><small>{a.open}</small></div><TaskList tasks={a.shown} projects={projects} onOpen={setOpen} onFinish={onFinish} /></div>;
  };
  return (
    <>
      <div className="head"><div><div className="eyebrow">Upcoming</div><h1 style={{ marginTop: 6 }}>The next <b>two weeks</b></h1></div></div>
      {section('Overdue', overdue)}
      {days.map((d) => section(d === t ? 'Today' : d === days[1] ? 'Tomorrow' : heading(d), live.filter((x) => x.due_at === d)))}
      {section('Later', later)}
      {section('No date', none)}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
