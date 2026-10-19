import { useEffect, useRef, useState } from 'react';
import type { Task, Project, Milestone } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { toast } from '../ui/dialogs.tsx';
import { pull } from '../store/sync.ts';

type TrashAnswer = { tasks: Task[]; projects: Project[]; milestones: Milestone[]; purge_after_days: number };

export function TrashView() {
  const [t, setT] = useState<TrashAnswer | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const [word, setWord] = useState('');
  const load = () => api<TrashAnswer>('/trash').then(setT).catch(() => toast('Trash needs a connection'));
  useEffect(() => { void load(); }, []);
  if (!t) return null;
  const restore = async (table: 'tasks' | 'projects' | 'milestones', id: string) => {
    try { await api(`/trash/${table}/${id}/restore`, { method: 'POST' }); toast('Restored'); await load(); await pull(); }
    catch (e) { toast((e as Error).message || 'Restore needs a connection'); }
  };
  const section = (title: string, table: 'tasks' | 'projects' | 'milestones', rows: { id: string; deleted_at: string | null; title?: string; name?: string }[]) => rows.length > 0 && (
    <div className="hz"><div className="hh"><b>{title}</b><small>{rows.length}</small></div>
      {rows.map((r) => <div key={r.id} className="task"><div className="tt" style={{ flex: 1 }}>{r.title ?? r.name}</div><span className="chip">{r.deleted_at?.slice(0, 10)}</span><button type="button" className="btn" onClick={() => restore(table, r.id)}>Restore</button></div>)}</div>);
  const total = t.tasks.length + t.projects.length + t.milestones.length;
  return (
    <>
      <div className="head"><div><div className="eyebrow">Trash</div><h1 style={{ marginTop: 6 }}>Gone, <b>not forgotten</b></h1><div className="sub">Items stay {t.purge_after_days} days, then go for good.</div></div>
        <button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={total === 0} onClick={() => dlg.current?.showModal()}>Empty Trash</button></div>
      {total === 0 && <p style={{ color: 'var(--text-faint)' }}>Trash is empty.</p>}
      {section('Tasks', 'tasks', t.tasks)}{section('Projects', 'projects', t.projects)}{section('Milestones', 'milestones', t.milestones)}
      <dialog ref={dlg} onClose={() => setWord('')}><p>This deletes everything in Trash for good. Type <b>EMPTY</b> to continue; your passkey is asked next.</p>
        <input className="field" value={word} onChange={(e) => setWord(e.target.value)} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="button" className="btn primary" style={{ background: 'var(--danger)', color: '#fff' }} disabled={word !== 'EMPTY'} onClick={async () => { try { await api('/trash/empty', { method: 'POST' }); toast('Trash emptied'); dlg.current?.close(); await load(); } catch (e) { toast((e as Error).message); } }}>Empty Trash</button></div></dialog>
    </>
  );
}
