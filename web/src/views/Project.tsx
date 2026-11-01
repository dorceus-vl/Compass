import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Project, Rag } from '../../../shared/types.ts';
import { useStore, resolveId, updateProject, trashProject, createMilestone, updateMilestone, createTask } from '../store/useStore.ts';
import { TaskList, useFinished } from '../ui/TaskCard.tsx';
import { arrange } from '../query.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { navigate, Link } from '../router.ts';
import { api, online } from '../api.ts';
import { pull } from '../store/sync.ts';
import { Raid } from './project/Raid.tsx';
import { Stakeholders } from './project/Stakeholders.tsx';
import { Changes } from './project/Changes.tsx';
import { Decisions } from './project/Decisions.tsx';
import { Lessons } from './project/Lessons.tsx';
import { ProjectCopilot } from './project/ProjectCopilot.tsx';
import { ProjectMeetings } from './project/ProjectMeetings.tsx';
import { Documents } from './project/Documents.tsx';
import { Report } from './project/Report.tsx';
import { Baselines } from './project/Baselines.tsx';
import { Dashboard } from './project/Dashboard.tsx';
import { fmtDue, today } from '../dates.ts';
import { MilestonePath } from '../ui/MilestonePath.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import { RagPill, Ring } from '../ui/ProjectCard.tsx';
import { SupportsGoal } from '../ui/GoalBits.tsx';
import { useSlider } from '../ui/Shell.tsx';
import { projectColor, PROJECT_SWATCHES } from '../ui/colors.ts';
import { SaveAsTemplate } from '../ui/Templates.tsx';
import { usePrograms } from './Programs.tsx';
import { OFFLINE_LINE } from '../programs.ts';
import { LogTimeDialog } from '../ui/TimeSection.tsx';
import { FieldsEditor } from '../ui/CustomFields.tsx';
import { WbsEditor } from '../ui/Wbs.tsx';
import { SprintsTab } from '../ui/Sprints.tsx';
import { PagesTab } from '../ui/Pages.tsx';

const TABS = ['overview', 'dashboard', 'wbs', 'sprints', 'pages', 'raid', 'stakeholders', 'changes', 'decisions', 'lessons', 'meetings', 'documents', 'report', 'copilot'] as const;
const SWATCH_NAME = ['Sand', 'Teal', 'Violet', 'Blue', 'Amber', 'Green'];
const TAB_LABEL: Record<string, string> = { overview: 'Overview', dashboard: 'Dashboard', wbs: 'WBS', sprints: 'Sprints', pages: 'Pages', raid: 'RAID', stakeholders: 'Stakeholders', changes: 'Changes', decisions: 'Decisions', lessons: 'Lessons', meetings: 'Meetings', documents: 'Documents', report: 'Report', copilot: 'Athena' };

export function ProjectPage({ id, tab = 'overview' }: { id: string; tab?: string }) {
  const { projects, tasks, milestones, ready } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [boundaryBusy, setBoundaryBusy] = useState(false);
  const [programBusy, setProgramBusy] = useState(false);
  const { programs, offline: programsOffline } = usePrograms();
  const [saveTpl, setSaveTpl] = useState(false);
  const [logTime, setLogTime] = useState(false);
  const [newMs, setNewMs] = useState({ name: '', due_at: '', gate: false });
  const [finished, onFinish] = useFinished();
  const p = projects.find((x) => x.id === id);
  const current = (TABS as readonly string[]).includes(tab) ? tab : 'overview';
  const nav = useRef<HTMLElement>(null), pill = useRef<HTMLSpanElement>(null);
  useSlider(nav, pill, `${current}:${ready && p ? p.id : ''}`, 'a[aria-selected="true"]');
  useLayoutEffect(() => { // a phone scrolls the bar sideways: keep the active tab in view
    const n = nav.current, a = n?.querySelector<HTMLElement>('a[aria-selected="true"]');
    if (n && a && n.scrollWidth > n.clientWidth) n.scrollLeft = a.offsetLeft - (n.clientWidth - a.offsetWidth) / 2;
  }, [current, ready, p?.id]);
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
    <label className="qf">{label}
      {type === 'area' ? <textarea className="field" rows={3} defaultValue={(p[key] as string) ?? ''} onBlur={(e) => commit(key, e.target.value, type)} />
        : <input className="field" type={type} defaultValue={(p[key] as string | number) ?? ''} onBlur={(e) => commit(key, e.target.value, type)} />}
    </label>
  );
  const ms = milestones.filter((m) => m.project_id === p.id && !m.deleted_at).sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));
  const color = projectColor(p), next = ms.find((m) => !m.done_at);
  const mine = tasks.filter((t) => t.project_id === p.id && !t.deleted_at);
  const pct = mine.length ? Math.round((100 * mine.filter((t) => t.status === 'done').length) / mine.length) : 0;
  const openTasks = arrange(tasks.filter((t) => t.project_id === p.id && !t.deleted_at && !t.parent_id).sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9')), finished);
  // Direct call, not the offline queue: a queued PATCH cannot answer the passkey prompt. api() retries with the step-up answer.
  const setBoundary = async (data_boundary: Project['data_boundary']) => {
    if (data_boundary === p.data_boundary || boundaryBusy) return;
    if (!online()) { toast('Changing the data boundary needs a connection'); return; }
    setBoundaryBusy(true);
    try { await api(`/projects/${p.id}`, { method: 'PATCH', json: { data_boundary } }); await pull(); }
    catch (e) { toast((e as Error).message); }
    finally { setBoundaryBusy(false); }
  };
  // v2.4: same-kind live programs; a trashed or unknown program shows as "No program". Direct call (online only), like the boundary switch.
  const choices = (programs ?? []).filter((g) => g.kind === p.kind);
  const programValue = p.program_id && choices.some((g) => g.id === p.program_id) ? p.program_id : '';
  const setProgram = async (program_id: string | null) => {
    if ((program_id ?? '') === programValue || programBusy) return;
    if (!online()) { toast(OFFLINE_LINE); return; }
    setProgramBusy(true);
    try { await api(`/projects/${p.id}`, { method: 'PATCH', json: { program_id } }); await pull(); }
    catch (e) { toast((e as Error).message); }
    finally { setProgramBusy(false); }
  };
  return (
    <>
      <header className="phead no-print" style={{ ['--pc' as string]: color } as CSSProperties}>
        <div className="pheadmain">
          <div className="ptx">
            <div className="eyebrow">{p.kind} project · {p.status.replace('_', ' ')}</div>
            <input key={p.id} className="pname" defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && save({ name: e.target.value.trim() })} aria-label="Project name" />
            <div className="pmeta">
              <RagPill rag={p.rag} />{p.rag_reason && <span>{p.rag_reason}</span>}
              <span>{next ? `Next: ${next.name}${next.due_at ? ` · ${fmtDue(next.due_at).text}` : ''}` : 'No upcoming milestone'}</span>
            </div>
          </div>
          <Ring pct={pct} color={color} />
        </div>
        <div className="pctl">
          <select className="field" aria-label="RAG" value={p.rag} onChange={(e) => save({ rag: e.target.value as Rag })}><option value="none">RAG: none</option><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option></select>
          <select className="field" aria-label="Status" value={p.status} onChange={(e) => save({ status: e.target.value as Project['status'] })}><option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select>
          <div className="swatches" role="group" aria-label="Project colour">
            {PROJECT_SWATCHES.map((s, i) => <button type="button" key={s} className="sw" style={{ ['--sw' as string]: s } as CSSProperties} aria-label={`Colour ${SWATCH_NAME[i]}`}
              aria-pressed={color.toLowerCase() === s.toLowerCase()} onClick={() => p.colour !== s && save({ colour: s })}><i /></button>)}
          </div>
          <button className="btn" onClick={() => setLogTime(true)}>Log time</button>
          <button className="btn" disabled={!online()} title={online() ? undefined : 'Needs a connection'} onClick={() => { if (p.id.startsWith('tmp-')) { toast('Wait for the project to sync, then save it'); return; } setSaveTpl(true); }}>Save as template</button>
          <button className="btn ptrash" onClick={async () => { if (await confirmAction(`Move "${p.name}" to Trash? Its tasks stay on the board.`, { danger: true })) { await trashProject(p.id); toast('Moved to Trash'); navigate('/projects'); } }}>Trash</button>
        </div>
      </header>
      {logTime && <LogTimeDialog project={p} onClose={() => setLogTime(false)} />}
      <SupportsGoal project={p} />
      <nav className="tabs no-print" role="tablist" aria-label="Project sections" ref={nav}>
        <span className="slide" ref={pill} aria-hidden="true" />
        {TABS.map((t) => <Link key={t} to={`/projects/${p.id}${t === 'overview' ? '' : `/${t}`}`} role="tab" aria-selected={current === t}>{TAB_LABEL[t]}</Link>)}
        <Link to={`/timeline?project=${p.id}`} role="tab" aria-selected={false}>Timeline</Link>
      </nav>
      <div className="pbody" style={{ ['--pc' as string]: color } as CSSProperties}>
      {current === 'dashboard' && <Dashboard key={p.id} project={p} />}
      {current === 'wbs' && <WbsEditor key={p.id} project={p} tasks={mine.filter((t) => !t.parent_id)} onOpen={setOpen} />}
      {current === 'sprints' && <SprintsTab key={p.id} project={p} tasks={mine.filter((t) => !t.parent_id)} onOpen={setOpen} />}
      {current === 'pages' && <PagesTab key={p.id} project={p} tasks={mine.filter((t) => !t.parent_id)} onOpen={setOpen} />}
      {current === 'raid' && <Raid key={p.id} project={p} />}
      {current === 'stakeholders' && <Stakeholders key={p.id} project={p} />}
      {current === 'changes' && <Changes key={p.id} project={p} />}
      {current === 'decisions' && <Decisions key={p.id} project={p} />}
      {current === 'lessons' && <Lessons key={p.id} project={p} />}
      {current === 'meetings' && <ProjectMeetings key={p.id} project={p} />}
      {current === 'documents' && <Documents key={p.id} project={p} />}
      {current === 'report' && <Report key={p.id} project={p} />}
      {current === 'copilot' && <ProjectCopilot key={p.id} project={p} />}
      {current === 'overview' && <div className="pover" key={p.id}>
        {ms.length > 0 && <section><SectionHead eyebrow="Milestones" title="The line ahead" /><MilestonePath milestones={ms} today={today()} /></section>}
        <div className="two">
          <div className="hz"><div className="hh"><b>Open tasks</b><small>{openTasks.open}</small></div>
            <TaskList tasks={openTasks.shown} projects={projects} onOpen={setOpen} onFinish={onFinish} />
            <form onSubmit={async (e) => { e.preventDefault(); if (!newTask.trim()) return; await createTask({ title: newTask.trim(), project_id: p.id, kind: p.kind }); setNewTask(''); }}>
              <input className="field" placeholder="Add a task to this project…" value={newTask} onChange={(e) => setNewTask(e.target.value)} /></form></div>
          <div className="hz"><div className="hh"><b>Milestones</b><small>{ms.length}</small></div>
            {ms.map((m) => <div key={m.id} className="task mrow" style={{ ['--mc' as string]: m.done_at ? 'var(--ok)' : m === next ? 'var(--h-short)' : 'var(--h-long)' } as CSSProperties}><button type="button" className={`cb ${m.done_at ? 'done' : ''}`} aria-pressed={!!m.done_at} aria-label={`${m.name}: done`} onClick={() => updateMilestone(m.id, { done_at: m.done_at ? null : today() })} />
              <div style={{ flex: 1, minWidth: 0 }}><div className={`tt ${m.done_at ? 'done' : ''}`}>{m.gate ? '◆ ' : ''}{m.name}</div>
                <div className="meta"><input type="date" aria-label={`${m.name} due date`} className="chip" style={{ background: 'transparent', color: 'inherit' }} value={m.due_at ?? ''} onChange={(e) => updateMilestone(m.id, { due_at: e.target.value || null })} />
                  <button type="button" className="gate-btn" aria-pressed={!!m.gate} aria-label={`${m.name}: gate`} onClick={() => updateMilestone(m.id, { gate: m.gate ? 0 : 1 })}>Gate</button>{m.due_at && !m.done_at && <span className={`chip ${fmtDue(m.due_at).tone}`}>{fmtDue(m.due_at).text}</span>}</div></div></div>)}
            <form onSubmit={async (e) => { e.preventDefault(); if (!newMs.name.trim()) return; await createMilestone(p.id, { name: newMs.name.trim(), due_at: newMs.due_at || null, gate: newMs.gate ? 1 : 0 }); setNewMs({ name: '', due_at: '', gate: false }); }} className="ms-form" style={{ display: 'grid', gap: 6 }}>
              <input className="field" placeholder="New milestone" value={newMs.name} onChange={(e) => setNewMs({ ...newMs, name: e.target.value })} />
              <div className="row"><input className="field" type="date" value={newMs.due_at} onChange={(e) => setNewMs({ ...newMs, due_at: e.target.value })} aria-label="Due date" style={{ flex: '1 1 140px', width: 'auto' }} />
                <label className="tap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={newMs.gate} onChange={(e) => setNewMs({ ...newMs, gate: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />Gate</label>
                <button className="btn primary">Add</button></div></form></div>
        </div>
        <Baselines project={p} />
        <section><SectionHead eyebrow="Record" title="Project details" />
          <div className="qgrid">
            <div className="qcard"><h3>Status</h3>{inp('rag_reason', 'RAG reason')}{inp('sponsor', 'Sponsor')}{inp('phase', 'Phase')}</div>
            <div className="qcard"><h3>Schedule and budget</h3>
              <div className="qpair">{inp('start_at', 'Start', 'date')}{inp('end_at', 'End', 'date')}</div>
              <div className="qpair">{inp('budget_planned', 'Budget planned', 'number')}{inp('budget_spent', 'Budget spent', 'number')}</div>
              <div className="qpair">{inp('budget_forecast', 'Forecast at completion', 'number')}
                <label className="qf">Currency
                  <select className="field" value={p.currency} onChange={(e) => save({ currency: e.target.value })}>
                    {[...new Set(['CAD', 'USD', 'EUR', 'GBP', p.currency])].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></label></div></div>
            <div className="qcard"><h3>Data boundary</h3>
              <div className="seg" role="group" aria-label="Data boundary" style={{ display: 'flex', width: 'max-content', maxWidth: '100%', flexWrap: 'wrap' }}>
                {([['cloud', 'Cloud AI allowed'], ['offline', 'Offline only']] as const).map(([v, l]) => <button type="button" key={v} className={p.data_boundary === v ? 'on' : ''} aria-pressed={p.data_boundary === v} disabled={boundaryBusy} onClick={() => void setBoundary(v)}>{l}</button>)}</div>
              <div className="qnote">Offline only: Athena never sends this project to Claude or Gemini.</div></div>
            <div className="qcard"><h3>Program</h3>
              <select className="field" aria-label="Program" value={programValue} disabled={programBusy || programsOffline || !online() || p.id.startsWith('tmp-')} onChange={(e) => void setProgram(e.target.value || null)}>
                <option value="">No program</option>{choices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              <div className="qnote">{programsOffline || !online() ? OFFLINE_LINE + '.' : `Only ${p.kind} programs are listed.`}{programValue && <> <Link to={`/programs/${programValue}`}>Open the program</Link></>}</div></div>
            <div className="qcard"><h3>Custom fields</h3><FieldsEditor project={p} /></div>
            <div className="qcard"><h3>Objectives</h3>{inp('objectives', 'Objectives', 'area')}{inp('success_criteria', 'Success criteria', 'area')}</div>
            <div className="qcard"><h3>Scope</h3>{inp('scope_in', 'In scope', 'area')}{inp('scope_out', 'Out of scope', 'area')}</div>
          </div></section>
      </div>}
      </div>
      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
      {saveTpl && <SaveAsTemplate from={{ project_id: p.id }} defaultName={p.name} onClose={() => setSaveTpl(false)} />}
    </>
  );
}
