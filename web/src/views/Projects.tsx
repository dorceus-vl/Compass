import { useRef, useState, type FormEvent } from 'react';
import { NewFromTemplate } from '../ui/Templates.tsx';
import { Portfolio } from './Portfolio.tsx';
import { useStore, createProject } from '../store/useStore.ts';
import { navigate } from '../router.ts';

export function Projects() {
  const { projects, ready } = useStore();
  const dlg = useRef<HTMLDialogElement>(null);
  const [tpl, setTpl] = useState(false);
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
        <div className="row"><button className="btn" onClick={() => setTpl(true)}>New from template</button><button className="btn primary" onClick={() => dlg.current?.showModal()}>+ New project</button></div></div>
      <Portfolio />
      {tpl && <NewFromTemplate onClose={() => setTpl(false)} />}
      <dialog ref={dlg}><form onSubmit={submit} style={{ display: 'grid', gap: 10 }}><b>New project</b>
        <input className="field" name="name" placeholder="Name" required autoFocus />
        <select className="field" name="kind"><option value="personal">Personal</option><option value="work">Work (encrypted, AI offline by default)</option></select>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn primary">Create</button></div></form></dialog>
    </>
  );
}
