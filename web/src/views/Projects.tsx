import { useRef, type FormEvent } from 'react';
import { useStore, createProject } from '../store/useStore.ts';
import { Link, navigate } from '../router.ts';
import { fmtDue } from '../dates.ts';

const RAG = { green: 'var(--ok)', amber: 'var(--warn)', red: 'var(--danger)', none: 'var(--text-faint)' };

export function Projects() {
  const { projects, tasks, milestones, ready } = useStore();
  const dlg = useRef<HTMLDialogElement>(null);
  if (!ready) return null;
  const live = projects.filter((p) => !p.deleted_at).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const p = await createProject({ name: String(f.get('name')).trim(), kind: f.get('kind') === 'work' ? 'work' : 'personal' });
    dlg.current?.close(); navigate(`/projects/${p.id}`);
  };
  return (
    <>
      <div className="head"><div><div className="eyebrow">Projects</div><h1 style={{ marginTop: 6 }}>Your <b>portfolio</b></h1><div className="sub">{live.filter((p) => p.status === 'active').length} active</div></div>
        <button className="btn primary" onClick={() => dlg.current?.showModal()}>+ New project</button></div>
      <div className="grid3">
        {live.map((p) => { const open = tasks.filter((t) => t.project_id === p.id && t.status !== 'done' && !t.deleted_at).length; const next = milestones.filter((m) => m.project_id === p.id && !m.done_at && m.due_at).sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0];
          return <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ fontSize: 18 }}>{p.name}</h3><i style={{ width: 10, height: 10, borderRadius: 99, background: RAG[p.rag] }} title={`RAG: ${p.rag}`} /></div>
            <div className="row" style={{ gap: 6 }}><span className={`chip ${p.kind === 'work' ? 'work' : ''}`}>{p.kind}</span><span className="chip">{p.status.replace('_', ' ')}</span>{p.phase && <span className="chip">{p.phase}</span>}</div>
            <p>{open} open task{open === 1 ? '' : 's'}{next ? ` · next: ${next.name} (${fmtDue(next.due_at).text})` : ''}</p>
          </Link>; })}
        {live.length === 0 && <p style={{ color: 'var(--text-faint)' }}>No projects yet.</p>}
      </div>
      <dialog ref={dlg}><form onSubmit={submit} style={{ display: 'grid', gap: 10 }}><b>New project</b>
        <input className="field" name="name" placeholder="Name" required autoFocus />
        <select className="field" name="kind"><option value="personal">Personal</option><option value="work">Work (encrypted, AI offline by default)</option></select>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn primary">Create</button></div></form></dialog>
    </>
  );
}
