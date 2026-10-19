import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Task, Horizon, Status } from '../../../shared/types.ts';
import { useStore, updateTask, trashTask } from '../store/useStore.ts';
import { confirmAction, toast } from './dialogs.tsx';

const RECUR = [['', 'Never'], ['{"freq":"daily","interval":1}', 'Every day'], ['{"freq":"weekly","interval":1}', 'Every week'],
  ['{"freq":"weekly","interval":1,"weekdays":[1,2,3,4,5]}', 'Weekdays'], ['{"freq":"monthly","interval":1}', 'Every month'], ['{"freq":"weekly","interval":2,"after_completion":true}', 'Two weeks after done']];

export function TaskSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tasks, projects } = useStore();
  const task = tasks.find((t) => t.id === taskId);
  const [draft, setDraft] = useState<Partial<Task>>({});
  useEffect(() => { ref.current?.showModal(); }, []);
  if (!task) return null;
  const v = { ...task, ...draft } as Task;
  const save = (patch: Partial<Task>) => { setDraft((d) => ({ ...d, ...patch })); void updateTask(task.id, patch); };
  const field = (label: string, el: ReactElement) => <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)' }}>{label}{el}</label>;
  return (
    <dialog ref={ref} onClose={onClose} style={{ maxWidth: 640 }}>
      <input className="field" style={{ fontSize: 18, fontWeight: 600 }} value={v.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={(e) => e.target.value.trim() && save({ title: e.target.value.trim() })} aria-label="Title" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        {field('Project', <select className="field" value={v.project_id ?? ''} onChange={(e) => save({ project_id: e.target.value || null })}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
        {field('Kind', <select className="field" value={v.kind} disabled={!!v.project_id} onChange={(e) => save({ kind: e.target.value as Task['kind'] })}><option value="personal">Personal</option><option value="work">Work</option></select>)}
        {field('Horizon', <select className="field" value={v.horizon} onChange={(e) => save({ horizon: e.target.value as Horizon })}><option value="short">Short · this week</option><option value="medium">Medium · this quarter</option><option value="long">Long · this year</option></select>)}
        {field('Status', <select className="field" value={v.status} onChange={(e) => save({ status: e.target.value as Status })}>{(['new', 'progress', 'hold', 'waiting', 'done'] as const).map((s) => <option key={s} value={s}>{s}</option>)}</select>)}
        {field('Start', <input className="field" type="date" value={v.start_at ?? ''} onChange={(e) => save({ start_at: e.target.value || null })} />)}
        {field('Due', <input className="field" type="date" value={v.due_at ?? ''} onChange={(e) => save({ due_at: e.target.value || null })} />)}
        {field('Priority', <select className="field" value={v.priority} onChange={(e) => save({ priority: Number(e.target.value) })}><option value={0}>None</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select>)}
        {field('Repeat', <select className="field" value={v.recur ?? ''} onChange={(e) => save({ recur: e.target.value || null })}>{RECUR.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select>)}
        {v.status === 'waiting' && field('Waiting on', <input className="field" value={v.waiting_on ?? ''} onChange={(e) => setDraft({ ...draft, waiting_on: e.target.value })} onBlur={(e) => save({ waiting_on: e.target.value || null })} />)}
        {field('Tags (comma separated)', <input className="field" defaultValue={JSON.parse(v.tags || '[]').join(', ')} onBlur={(e) => save({ tags: JSON.stringify(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) })} />)}
      </div>
      {field('Notes', <textarea className="field" rows={5} defaultValue={v.notes ?? ''} onBlur={(e) => save({ notes: e.target.value || null })} />)}
      {v.source_url && <p style={{ fontSize: 13 }}>From <b>{v.source_app}</b>: <a href={v.source_url} target="_blank" rel="noopener">open in {v.source_app} ↗</a></p>}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
        <button className="btn" style={{ color: 'var(--danger)' }} onClick={async () => { if (await confirmAction('Move this task to Trash? It stays there 30 days.')) { await trashTask(task.id); toast('Moved to Trash'); ref.current?.close(); } }}>Trash</button>
        <button className="btn primary" onClick={() => ref.current?.close()}>Done</button>
      </div>
    </dialog>
  );
}
