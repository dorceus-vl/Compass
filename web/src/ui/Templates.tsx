import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, online } from '../api.ts';
import { useStore } from '../store/useStore.ts';
import { pull } from '../store/sync.ts';
import { navigate } from '../router.ts';
import { today } from '../dates.ts';
import { toast } from './dialogs.tsx';
import type { Kind, Project, Task } from '../../../shared/types.ts';

export interface TemplateInfo { id: string; name: string; kind: Kind | null; scope: 'task' | 'project'; builtin: boolean; tasks: number; milestones: number; description?: string }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const templateMeta = (t: TemplateInfo) => [t.scope === 'project' ? 'Project' : 'Task', t.builtin ? 'Built in' : t.kind === 'work' ? 'Work' : 'Personal', plural(t.tasks, 'task'), ...(t.scope === 'project' ? [plural(t.milestones, 'milestone')] : [])].join(' · ');

/** Pick a template, a start date and (for a project) a name; makes the project or task in one request, then opens it. Needs a connection. */
export function NewFromTemplate({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { projects } = useStore();
  const [list, setList] = useState<TemplateInfo[] | null | 'offline'>(null);
  const [sel, setSel] = useState('');
  const [start, setStart] = useState(today());
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('personal');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    if (!online()) { setList('offline'); return; }
    api<{ templates: TemplateInfo[] }>('/templates').then((r) => setList(r.templates)).catch(() => setList('offline'));
  }, []);
  const t = Array.isArray(list) ? list.find((x) => x.id === sel) : undefined;
  const pick = (x: TemplateInfo) => { setSel(x.id); setName(x.name); setProjectId(''); if (x.kind) setKind(x.kind); };
  const k: Kind = t?.kind ?? kind; // a saved template has its own kind; a built-in takes the choice
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!t || busy) return;
    setBusy(true);
    try {
      const json = { start_date: start, ...(t.builtin ? { builtin: t.id, kind } : { template_id: t.id }), ...(t.scope === 'project' ? { name: name.trim() } : projectId ? { project_id: projectId } : {}) };
      const r = await api<{ project: Project | null; tasks: Task[] }>('/templates/apply', { method: 'POST', json });
      await pull(); // the new rows reach the device before it opens them
      toast(t.scope === 'project' ? 'Project created' : 'Task created');
      onCreated?.();
      ref.current?.close();
      navigate(r.project ? `/projects/${r.project.id}` : `/?task=${r.tasks[0].id}`);
    } catch (err) { toast((err as Error).message || 'Could not create from the template'); setBusy(false); }
  };
  return (
    <dialog ref={ref} className="tpl-dlg" aria-label="New from template" onClose={onClose}>
      <form onSubmit={submit} className="tpl-form">
        <b>New from template</b>
        {list === null && <p className="hint">Loading…</p>}
        {list === 'offline' && <p className="hint">Templates need a connection.</p>}
        {Array.isArray(list) && <div className="tpl-list" role="radiogroup" aria-label="Template">
          {list.map((x) => <label key={x.id} className="tpl-opt"><input type="radio" name="tpl" value={x.id} checked={sel === x.id} onChange={() => pick(x)} /><span><b>{x.name}</b><small>{templateMeta(x)}</small>{x.description && <small>{x.description}</small>}</span></label>)}
        </div>}
        {t && <div className="tpl-fields">
          <label className="qf">Start date<input className="field" type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {t.scope === 'project' && <label className="qf">Project name<input className="field" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>}
          {t.builtin && t.scope === 'project' && <label className="qf">Kind<select className="field" value={kind} onChange={(e) => setKind(e.target.value as Kind)}><option value="personal">Personal</option><option value="work">Work (encrypted, AI offline by default)</option></select></label>}
          {!t.builtin && <p className="hint" style={{ margin: 0 }}>{k === 'work' ? 'A work template: it makes work items.' : 'A personal template: it makes personal items.'}</p>}
          {t.scope === 'task' && <label className="qf">Project<select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">None (standalone)</option>
            {projects.filter((p) => !p.deleted_at && p.status !== 'closed' && p.kind === k).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        </div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn primary" disabled={!t || busy || (t.scope === 'project' && !name.trim())}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Asks for a name and saves a snapshot of a task (with its subtasks) or a project as a template. Needs a connection. */
export function SaveAsTemplate({ from, defaultName, onClose }: { from: { task_id: string } | { project_id: string }; defaultName: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(online());
  useEffect(() => { ref.current?.showModal(); const f = () => setOn(online()); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (!online()) { toast('Saving a template needs a connection'); return; }
    setBusy(true);
    try {
      await api('/templates', { method: 'POST', json: { name: name.trim(), ...('task_id' in from ? { from_task_id: from.task_id } : { from_project_id: from.project_id }) } });
      toast('Saved as a template');
      ref.current?.close();
    } catch (err) { toast((err as Error).message || 'Could not save the template'); setBusy(false); }
  };
  return (
    <dialog ref={ref} className="tpl-dlg" aria-label="Save as template" onClose={onClose} onClick={(e) => e.stopPropagation()}>
      <form onSubmit={submit} className="tpl-form">
        <b>Save as template</b>
        <p className="hint" style={{ margin: 0 }}>Keeps the structure and checklists, and dates as days from the earliest one. Not who it waits on, and nothing marked done. Notes are cut to 2,000 characters. Edits not yet synced are left out.</p>
        {!on && <p className="hint" style={{ margin: 0 }}>Needs a connection.</p>}
        <input className="field" autoFocus required maxLength={200} aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn primary" disabled={!on || busy || !name.trim()}>Save</button>
        </div>
      </form>
    </dialog>
  );
}
