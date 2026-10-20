import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../../shared/types.ts';
import { useStore } from '../store/useStore.ts';
import { TaskCard } from '../ui/TaskCard.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { parseQuery, applyQuery } from '../query.ts';
import { today } from '../dates.ts';
import { api } from '../api.ts';
import { toast } from '../ui/dialogs.tsx';

type Sort = 'due' | 'priority' | 'title' | 'updated';
type Group = 'none' | 'project' | 'horizon' | 'status';
type View = { name: string; query: string };

export function List() {
  const { tasks, projects, ready } = useStore();
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [sort, setSort] = useState<Sort>('due');
  const [group, setGroup] = useState<Group>('none');
  const [open, setOpen] = useState<string | null>(null);
  const [views, setViews] = useState<View[]>([]);
  const [name, setName] = useState('');
  const [viewsLoaded, setViewsLoaded] = useState(false); // saving before the GET succeeds would overwrite the server's list
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { api<{ saved_views: View[] }>('/settings').then((s) => { setViews(s.saved_views); setViewsLoaded(true); }).catch(() => {}); }, []);
  if (!ready) return null;
  const rows = applyQuery(tasks.filter((t) => !t.parent_id), parseQuery(q), projects, today()).sort((a, b) =>
    sort === 'due' ? (a.due_at ?? '9').localeCompare(b.due_at ?? '9') : sort === 'priority' ? b.priority - a.priority : sort === 'title' ? a.title.localeCompare(b.title) : b.updated_at.localeCompare(a.updated_at));
  const key = (t: Task) => group === 'project' ? projects.find((p) => p.id === t.project_id)?.name ?? 'No project' : group === 'horizon' ? t.horizon : group === 'status' ? t.status : '';
  const groups = [...new Set(rows.map(key))];
  // No prompt(): the name comes from the <dialog>; submit saves, Esc/Cancel discards.
  const saveView = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim(); if (!n) return;
    dlg.current?.close();
    const prev = views;
    const next = [...views.filter((v) => v.name !== n), { name: n, query: q }];
    setViews(next);
    try { await api('/settings', { method: 'PATCH', json: { saved_views: next } }); toast('View saved'); } catch { setViews(prev); toast('Could not save view'); }
  };
  return (
    <>
      <div className="head">
        <div><div className="eyebrow">List</div><h1 style={{ marginTop: 6 }}>Every <b>task</b></h1><div className="sub">{rows.length} shown</div></div>
        <div className="row">
          <input className="field" style={{ maxWidth: 380 }} placeholder="risk kind:work status:progress due:<2026-10-31 tag:x" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />
          <select className="field" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort"><option value="due">Sort: due</option><option value="priority">Sort: priority</option><option value="title">Sort: title</option><option value="updated">Sort: updated</option></select>
          <select className="field" style={{ width: 'auto' }} value={group} onChange={(e) => setGroup(e.target.value as Group)} aria-label="Group"><option value="none">Group: none</option><option value="project">Group: project</option><option value="horizon">Group: horizon</option><option value="status">Group: status</option></select>
          <button type="button" className="btn" disabled={!viewsLoaded} title={viewsLoaded ? undefined : 'Saved views have not loaded yet (needs a connection)'} onClick={() => { setName(''); dlg.current?.showModal(); }}>Save view</button>
        </div>
      </div>
      {views.length > 0 && <div className="row">{views.map((v) => <button type="button" key={v.name} className="chip" onClick={() => setQ(v.query)}>{v.name}</button>)}</div>}
      {groups.map((g) => { const xs = rows.filter((t) => key(t) === g); return <div className="hz lgroup" key={g || 'all'}><div className="hh"><b>{g || 'All tasks'}</b><small>{xs.length}</small></div>{xs.map((t) => <TaskCard key={t.id} task={t} projects={projects} onOpen={setOpen} />)}</div>; })}
      <dialog ref={dlg}>
        <form onSubmit={saveView}>
          <p style={{ marginTop: 0 }}>Name this view</p>
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="View name" maxLength={60} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
            <button type="submit" className="btn primary">Save</button>
          </div>
        </form>
      </dialog>
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
