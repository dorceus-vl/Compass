import { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { TaskList, useFinished } from '../ui/TaskCard.tsx';
import { arrange } from '../query.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import { today, addDays } from '../dates.ts';

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', o); };

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
  const section = (eyebrow: string, title: string, xs: typeof live) => {
    const a = arrange(xs, finished);
    return a.shown.length > 0 && (
      <section key={`${eyebrow}-${title}`} aria-label={`${eyebrow} ${title}`}>
        <SectionHead eyebrow={eyebrow} title={title}><span className="note">{a.open} open</span></SectionHead>
        <TaskList tasks={a.shown} projects={projects} onOpen={setOpen} onFinish={onFinish} />
      </section>
    );
  };
  const day = (d: string) => section(d === t ? `Today · ${fmt(d, { weekday: 'long' })}` : d === days[1] ? `Tomorrow · ${fmt(d, { weekday: 'long' })}` : fmt(d, { weekday: 'long' }), fmt(d, { month: 'short', day: 'numeric' }), live.filter((x) => x.due_at === d));
  return (
    <div className="upcoming">
      <div className="head"><div><div className="eyebrow">Upcoming</div><h1 style={{ marginTop: 6 }}>The next <b>two weeks</b></h1></div></div>
      {section('Needs attention', 'Overdue', overdue)}
      {days.map(day)}
      {section('Beyond two weeks', 'Later', later)}
      {section('Unscheduled', 'No date', none)}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
