import { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { TaskList, shownInList } from '../ui/TaskCard.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { today, addDays } from '../dates.ts';

const heading = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' }); };

export function Upcoming() {
  const { tasks, projects, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  if (!ready) return null;
  const t = today();
  const live = tasks.filter((x) => !x.deleted_at && !x.parent_id && shownInList(x));
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i));
  const later = live.filter((x) => x.due_at && x.due_at > days[13]).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const none = live.filter((x) => !x.due_at);
  const overdue = live.filter((x) => x.due_at && x.due_at < t);
  const section = (title: string, xs: typeof live) => xs.length > 0 && <div className="hz" key={title}><div className="hh"><b>{title}</b><small>{xs.filter((x) => x.status !== 'done').length}</small></div><TaskList tasks={xs} projects={projects} onOpen={setOpen} /></div>;
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
