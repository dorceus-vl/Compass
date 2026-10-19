import { useEffect, useState } from 'react';
import type { Project, Rag } from '../../../shared/types.ts';
import { useStore, resolveId, updateProject, trashProject, createMilestone, updateMilestone, createTask } from '../store/useStore.ts';
import { TaskRow } from '../ui/TaskRow.tsx';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { navigate, Link } from '../router.ts';
import { api, online } from '../api.ts';
import { pull } from '../store/sync.ts';
import { Raid } from './project/Raid.tsx';
import { Changes } from './project/Changes.tsx';
import { Decisions } from './project/Decisions.tsx';
import { Lessons } from './project/Lessons.tsx';
import { ProjectCopilot } from './project/ProjectCopilot.tsx';
import { ProjectMeetings } from './project/ProjectMeetings.tsx';
import { fmtDue, today } from '../dates.ts';

const TABS = ['overview', 'raid', 'changes', 'decisions', 'lessons', 'meetings', 'copilot'] as const;
const TAB_LABEL: Record<string, string> = { overview: 'Overview', raid: 'RAID', changes: 'Changes', decisions: 'Decisions', lessons: 'Lessons', meetings: 'Meetings', copilot: 'Copilot' };

export function ProjectPage({ id, tab = 'overview' }: { id: string; tab?: string }) {
  const { projects, tasks, milestones, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [boundaryBusy, setBoundaryBusy] = useState(false);
  const [newMs, setNewMs] = useState({ name: '', due_at: '' });
  const p = projects.find((x) => x.id === id);
  // A tmp- id is swapped for the server's once sync replays the create; follow it instead of showing "not found".
  useEffect(() => {
    if (ready && !p && id.startsWith('tmp-')) void resolveId('projects', id).then((real) => { if (real !== id) navigate(`/projects/${real}`, true); });
  }, [ready, p, id, projects]);
  if (!ready) return null;
  if (!p) return <p>Project not found.</p>;
  const save = (patch: Partial<Project>) => void updateProject(p.id, patch);
  // Save only a changed value; an untouched field tabbed through must not queue a PATCH.
  const commit = (key: keyof Project, raw: string, type: string) => {
    const v = type === 'number' ? (raw === '' ? null : Number(raw)) : raw || null;
    if (v !== p[key]) save({ [key]: v });
  };
  const inp = (key: keyof Project, label: string, type = 'text') => (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)' }}>{label}
      {type === 'area' ? <textarea className="field" rows={3} defaultValue={(p[key] as string) ?? ''} onBlur={(e) => commit(key, e.target.value, type)} />
        : <input className="field" type={type} defaultValue={(p[key] as string | number) ?? ''} onBlur={(e) => commit(key, e.target.value, type)} />}
    </label>
  );
  const ms = milestones.filter((m) => m.project_id === p.id && !m.deleted_at).sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));
  const openTasks = tasks.filter((t) => t.project_id === p.id && !t.deleted_at && !t.parent_id && t.status !== 'done').sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));
  // Direct call, not the offline queue: a queued PATCH cannot answer the passkey prompt. api() retries with the step-up answer.
  const setBoundary = async (data_boundary: Project['data_boundary']) => {
    if (data_boundary === p.data_boundary || boundaryBusy) return;
    if (!online()) { toast('Changing the data boundary needs a connection'); return; }
    setBoundaryBusy(true);
    try { await api(`/projects/${p.id}`, { method: 'PATCH', json: { data_boundary } }); await pull(); }
    catch (e) { toast((e as Error).message); }
    finally { setBoundaryBusy(false); }
  };
  const current = (TABS as readonly string[]).includes(tab) ? tab : 'overview';
  return (
    <>
      <div className="head">
        <div><div className="eyebrow">{p.kind} project · {p.status.replace('_', ' ')}</div>
          <input key={p.id} className="field" style={{ fontSize: 26, fontWeight: 800, background: 'transparent', border: 0, padding: 0, letterSpacing: -0.6 }} defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && save({ name: e.target.value.trim() })} aria-label="Project name" /></div>
        <div className="row">
          <select className="field" style={{ width: 'auto' }} value={p.rag} onChange={(e) => save({ rag: e.target.value as Rag })}><option value="none">RAG: none</option><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option></select>
          <select className="field" style={{ width: 'auto' }} value={p.status} onChange={(e) => save({ status: e.target.value as Project['status'] })}><option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select>
          <button className="btn" style={{ color: 'var(--danger)' }} onClick={async () => { if (await confirmAction(`Move "${p.name}" to Trash? Its tasks stay on the board.`, { danger: true })) { await trashProject(p.id); toast('Moved to Trash'); navigate('/projects'); } }}>Trash</button>
        </div>
      </div>
      <nav className="tabs" role="tablist" aria-label="Project sections">
        {TABS.map((t) => <Link key={t} to={`/projects/${p.id}${t === 'overview' ? '' : `/${t}`}`} role="tab" aria-selected={current === t}>{TAB_LABEL[t]}</Link>)}
        <Link to={`/timeline?project=${p.id}`} role="tab" aria-selected={false}>Timeline</Link>
      </nav>
      {current === 'raid' && <Raid key={p.id} project={p} />}
      {current === 'changes' && <Changes key={p.id} project={p} />}
      {current === 'decisions' && <Decisions key={p.id} project={p} />}
      {current === 'lessons' && <Lessons key={p.id} project={p} />}
      {current === 'meetings' && <ProjectMeetings key={p.id} project={p} />}
      {current === 'copilot' && <ProjectCopilot key={p.id} project={p} />}
      {current === 'overview' && <div className="two" key={p.id}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card" style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            {inp('rag_reason', 'RAG reason')}{inp('sponsor', 'Sponsor')}{inp('phase', 'Phase')}{inp('start_at', 'Start', 'date')}{inp('end_at', 'End', 'date')}
            {inp('budget_planned', 'Budget planned', 'number')}{inp('budget_spent', 'Budget spent', 'number')}
            <div style={{ fontSize: 12, color: 'var(--text-faint)', gridColumn: '1 / -1' }}>Data boundary
              <div className="seg" role="group" aria-label="Data boundary" style={{ display: 'flex', marginTop: 6, width: 'max-content' }}>
                {([['cloud', 'Cloud AI allowed'], ['offline', 'Offline only']] as const).map(([v, l]) => <button type="button" key={v} className={p.data_boundary === v ? 'on' : ''} aria-pressed={p.data_boundary === v} disabled={boundaryBusy} onClick={() => void setBoundary(v)}>{l}</button>)}</div>
              <div style={{ marginTop: 4 }}>Offline only: the copilot never sends this project to Claude or Gemini.</div></div>
            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10 }}>{inp('objectives', 'Objectives', 'area')}{inp('scope_in', 'In scope', 'area')}{inp('scope_out', 'Out of scope', 'area')}{inp('success_criteria', 'Success criteria', 'area')}</div>
          </div>
          <div className="hz"><div className="hh"><b>Open tasks</b><small>{openTasks.length}</small></div>
            {openTasks.map((t) => <TaskRow key={t.id} task={t} onOpen={setOpen} />)}
            <form onSubmit={async (e) => { e.preventDefault(); if (!newTask.trim()) return; await createTask({ title: newTask.trim(), project_id: p.id, kind: p.kind }); setNewTask(''); }}>
              <input className="field" placeholder="Add a task to this project…" value={newTask} onChange={(e) => setNewTask(e.target.value)} /></form></div>
        </div>
        <div className="hz"><div className="hh"><b>Milestones</b><small>{ms.length}</small></div>
          {ms.map((m) => <div key={m.id} className="task"><button type="button" className={`cb ${m.done_at ? 'done' : ''}`} aria-pressed={!!m.done_at} aria-label={`${m.name}: done`} onClick={() => updateMilestone(m.id, { done_at: m.done_at ? null : today() })} />
            <div style={{ flex: 1 }}><div className={`tt ${m.done_at ? 'done' : ''}`}>{m.gate ? '◆ ' : ''}{m.name}</div>
              <div className="meta"><input type="date" aria-label={`${m.name} due date`} className="chip" style={{ background: 'transparent', color: 'inherit' }} value={m.due_at ?? ''} onChange={(e) => updateMilestone(m.id, { due_at: e.target.value || null })} />{m.due_at && <span className={`chip ${fmtDue(m.due_at).tone}`}>{fmtDue(m.due_at).text}</span>}</div></div></div>)}
          <form onSubmit={async (e) => { e.preventDefault(); if (!newMs.name.trim()) return; await createMilestone(p.id, { name: newMs.name.trim(), due_at: newMs.due_at || null }); setNewMs({ name: '', due_at: '' }); }} style={{ display: 'grid', gap: 6 }}>
            <input className="field" placeholder="New milestone" value={newMs.name} onChange={(e) => setNewMs({ ...newMs, name: e.target.value })} />
            <div className="row"><input className="field" type="date" value={newMs.due_at} onChange={(e) => setNewMs({ ...newMs, due_at: e.target.value })} /><button className="btn primary">Add</button></div></form></div>
      </div>}
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
