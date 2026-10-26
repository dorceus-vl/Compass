import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Task, Horizon, Status } from '../../../shared/types.ts';
import { useStore, updateTask, trashTask, resolveId } from '../store/useStore.ts';
import { idb } from '../store/db.ts';
import { confirmAction, toast } from './dialogs.tsx';
import { api } from '../api.ts';
import { SplitSheet } from './SplitSheet.tsx';
import type { InboxItem } from '../../../shared/types.ts';
import { parseBlockedBy, wouldCycle, blocksOf, blockedIds } from '../../../shared/deps.ts';
import { BlockedChip } from './BlockedChip.tsx';
import { Checklist } from './Checklist.tsx';
import { SaveAsTemplate } from './Templates.tsx';
import { TimerButton } from './TimerButton.tsx';
import { TimeSection } from './TimeSection.tsx';
import { SupportsGoal } from './GoalBits.tsx';
import { parseEstimate, formatEstimate } from '../../../shared/workload.ts';

const RECUR = [['', 'Never'], ['{"freq":"daily","interval":1}', 'Every day'], ['{"freq":"weekly","interval":1}', 'Every week'],
  ['{"freq":"weekly","interval":1,"weekdays":[1,2,3,4,5]}', 'Weekdays'], ['{"freq":"monthly","interval":1}', 'Every month'], ['{"freq":"weekly","interval":2,"after_completion":true}', 'Two weeks after done']];

/** The sheet follows links to other tasks (a blocker, a task it blocks) in place: the inner sheet is keyed by the id, so its fields start afresh. */
export function TaskSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [cur, setCur] = useState(taskId);
  return <TaskSheetFor key={cur} taskId={cur} onClose={onClose} onOpenTask={setCur} />;
}

function TaskSheetFor({ taskId, onClose, onOpenTask }: { taskId: string; onClose: () => void; onOpenTask: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tasks, projects, ready } = useStore();
  const [realId, setRealId] = useState<string | null>(null); // a tmp- id swapped for the server's after sync
  const task = tasks.find((t) => t.id === taskId) ?? tasks.find((t) => t.id === realId);
  const [draft, setDraft] = useState<Partial<Task>>({});
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);
  const trashed = useRef(false);
  const has = !!task;
  const [mail, setMail] = useState<InboxItem | null>(null); // the forwarded email this task came from, if any
  const [splitting, setSplitting] = useState(false);
  const [saveTpl, setSaveTpl] = useState(false);
  const [depQ, setDepQ] = useState('');
  const [dayHours, setDayHours] = useState(8); // settings.workload.day_hours, for "1d"
  const [estText, setEstText] = useState<string | null>(null); // what is typed while it is not (yet) valid
  const [estBad, setEstBad] = useState(false);
  useEffect(() => {
    if (!navigator.onLine) return;
    void api<{ workload?: { day_hours?: number } }>('/settings').then((s) => setDayHours(s.workload?.day_hours ?? 8)).catch(() => {}); // an older server may not send it
  }, []);
  const fromMail = task?.source_kind === 'email';
  useEffect(() => {
    if (!fromMail || !navigator.onLine) return;
    let live = true;
    void api<{ item: InboxItem }>(`/inbox/by-task/${taskId}`).then((r) => live && setMail(r.item)).catch(() => {});
    return () => { live = false; };
  }, [fromMail, taskId]);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, [has]);
  // The task is gone (trashed elsewhere, purged): follow a tmp- id to its real one, otherwise tell the parent to close.
  useEffect(() => {
    if (!ready || task) return;
    let live = true;
    void resolveId('tasks', taskId).then(async (real) => {
      if (!live) return;
      if (real !== taskId && await idb.get('tasks', real)) setRealId(real); else onClose();
    });
    return () => { live = false; };
  }, [ready, has, taskId]);
  if (!task) return null;
  const v = { ...task, ...draft } as Task;
  // Dependencies (V1 to V3). Candidates are open, live tasks of the same kind that would not close a loop.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const linked = parseBlockedBy(v.blocked_by) ?? [];
  const blockers = linked.map((id) => byId.get(id) ?? null);
  const blocks = blocksOf(task.id, tasks);
  const stillBlocked = blockedIds(tasks).has(task.id);
  // The device store holds no trashed tasks, so a loop through one is only caught by the server (409); the queue toasts the refusal.
  const graph = new Map(tasks.filter((t) => !t.deleted_at && t.blocked_by).map((t) => [t.id, parseBlockedBy(t.blocked_by) ?? []]));
  graph.delete(task.id);
  const hits = depQ.trim() ? tasks.filter((t) => t.id !== task.id && !t.deleted_at && t.status !== 'done' && t.kind === v.kind && !linked.includes(t.id)
    && t.title.toLowerCase().includes(depQ.trim().toLowerCase()) && !wouldCycle(graph, task.id, t.id)).slice(0, 6) : [];
  const setLinks = (ids: string[]) => save({ blocked_by: ids.length ? JSON.stringify(ids) : null });
  const goto = (id: string) => { flush(); onOpenTask(id); };
  const save = (patch: Partial<Task>) => { setDraft((d) => ({ ...d, ...patch })); void updateTask(task.id, patch); };
  // Save any edit still sitting in a focused field; Escape and Done close the dialog without a blur.
  const flush = () => {
    if (trashed.current) return;
    const patch: Partial<Task> = {};
    const title = v.title.trim();
    if (title && title !== task.title) patch.title = title;
    if (notesRef.current && (notesRef.current.value || null) !== (v.notes ?? null)) patch.notes = notesRef.current.value || null;
    if (tagsRef.current) {
      const tags = JSON.stringify(tagsRef.current.value.split(',').map((x) => x.trim()).filter(Boolean));
      if (tags !== (v.tags || '[]')) patch.tags = tags;
    }
    if (v.status === 'waiting' && (v.waiting_on || null) !== (task.waiting_on ?? null)) patch.waiting_on = v.waiting_on || null;
    if (Object.keys(patch).length) void updateTask(task.id, patch);
  };
  const field = (label: string, el: ReactElement) => <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)' }}>{label}{el}</label>;
  return (
    <dialog ref={ref} onClose={() => { flush(); onClose(); }} style={{ maxWidth: 640 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input className="field" style={{ fontSize: 18, fontWeight: 600 }} value={v.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} onBlur={(e) => e.target.value.trim() && save({ title: e.target.value.trim() })} aria-label="Title" />
      <TimerButton task={task} label />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        {field('Project', <select className="field" value={v.project_id ?? ''} onChange={(e) => {
          const to = projects.find((p) => p.id === e.target.value)?.kind ?? v.kind; // a task with links keeps its kind (work and personal never link)
          if (to !== v.kind && (blockers.length || blocks.length)) { toast('Remove its dependencies first: work and personal tasks cannot depend on each other'); return; }
          save({ project_id: e.target.value || null });
        }}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
        {field('Kind', <select className="field" value={v.kind} disabled={!!v.project_id || blockers.length > 0 || blocks.length > 0} title={blockers.length || blocks.length ? 'Remove its dependencies to change the kind' : undefined} onChange={(e) => save({ kind: e.target.value as Task['kind'] })}><option value="personal">Personal</option><option value="work">Work</option></select>)}
        {field('Horizon', <select className="field" value={v.horizon} onChange={(e) => save({ horizon: e.target.value as Horizon })}><option value="short">Short · this week</option><option value="medium">Medium · this quarter</option><option value="long">Long · this year</option></select>)}
        {field('Status', <select className="field" value={v.status} onChange={(e) => save({ status: e.target.value as Status })}>{(['new', 'progress', 'hold', 'waiting', 'done'] as const).map((s) => <option key={s} value={s}>{s}</option>)}</select>)}
        {field('Start', <input className="field" type="date" value={v.start_at ?? ''} onChange={(e) => save({ start_at: e.target.value || null })} />)}
        {field('Due', <input className="field" type="date" value={v.due_at ?? ''} onChange={(e) => save({ due_at: e.target.value || null })} />)}
        {field('Estimate', <>
          <input className="field" placeholder="30m, 2h, 1d" aria-label="Estimate" aria-describedby="est-msg" value={estText ?? (v.estimate_minutes == null ? '' : formatEstimate(v.estimate_minutes))}
            onChange={(e) => { setEstText(e.target.value); setEstBad(false); }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) { setEstText(null); if (task.estimate_minutes != null) save({ estimate_minutes: null }); return; }
              const n = parseEstimate(raw, dayHours);
              if (n == null) { setEstBad(true); return; }
              setEstText(null); if (n !== task.estimate_minutes) save({ estimate_minutes: n });
            }} />
          <span id="est-msg" role="status" style={{ fontSize: 12 }}>
            {estBad ? 'Use minutes, hours or days, like 2h'
              : tasks.some((t) => t.parent_id === task.id && !t.deleted_at && t.status !== 'done') ? "Workload counts the subtasks' estimates instead." : ''}</span></>)}
        {field('Priority', <select className="field" value={v.priority} onChange={(e) => save({ priority: Number(e.target.value) })}><option value={0}>None</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select>)}
        {field('Repeat', <select className="field" value={v.recur ?? ''} onChange={(e) => save({ recur: e.target.value || null })}>{RECUR.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select>)}
        {v.status === 'waiting' && field('Waiting on', <input className="field" value={v.waiting_on ?? ''} onChange={(e) => setDraft({ ...draft, waiting_on: e.target.value })} onBlur={(e) => save({ waiting_on: e.target.value || null })} />)}
        {v.status === 'waiting' && field('Nudge me every N days', <input key={String(task.nudge_every_days)} className="field" type="number" min={1} max={365} placeholder="never" defaultValue={v.nudge_every_days ?? ''} onBlur={(e) => {
          const n = e.target.value === '' ? null : Number(e.target.value);
          if (n === (task.nudge_every_days ?? null)) return;
          if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 365)) { toast('Use a whole number of days from 1 to 365'); e.target.value = String(task.nudge_every_days ?? ''); return; }
          const input = e.target, was = task.nudge_every_days ?? null;
          setDraft((d) => ({ ...d, nudge_every_days: n }));
          updateTask(task.id, { nudge_every_days: n }).catch(() => { setDraft((d) => ({ ...d, nudge_every_days: was })); input.value = String(was ?? ''); toast('Could not save the nudge'); });
        }} />)}
        {field('Tags (comma separated)', <input ref={tagsRef} className="field" defaultValue={JSON.parse(v.tags || '[]').join(', ')} onBlur={(e) => save({ tags: JSON.stringify(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) })} />)}
      </div>
      <section className="deps" aria-label="Dependencies">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Blocked by</span>
          {stillBlocked && <BlockedChip />}
        </div>
        {linked.length > 0 && <div className="dl">{linked.map((id, i) => { const b = blockers[i]; const resolved = !b || b.deleted_at || b.status === 'done'; return (
          <span key={id} className={`dep${resolved ? ' done' : ''}`}>
            <button type="button" disabled={!b} onClick={() => goto(id)}>{b ? b.title : 'A task that is gone'}{!b || b.deleted_at ? ' (trashed)' : b.status === 'done' ? ' (done)' : ''}</button>
            <button type="button" className="x" aria-label={`Remove blocker: ${b?.title ?? 'a task that is gone'}`} onClick={() => setLinks(linked.filter((x) => x !== id))}>×</button>
          </span>); })}</div>}
        <div className="dep-find">
          <input className="field" role="combobox" aria-expanded={hits.length > 0} aria-controls="dep-hits" aria-autocomplete="list" value={depQ} placeholder={linked.length >= 20 ? 'Twenty blockers at most' : `Find a ${v.kind} task this waits on`} disabled={linked.length >= 20} aria-label="Find a blocking task"
            onChange={(e) => setDepQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) { e.preventDefault(); setLinks([...linked, hits[0].id]); setDepQ(''); }
              if (e.key === 'ArrowDown' && hits[0]) { e.preventDefault(); e.currentTarget.parentElement?.querySelector<HTMLElement>('[role=option]')?.focus(); }
            }} />
          {hits.length > 0 && <div className="dep-hits" id="dep-hits" role="listbox" aria-label="Open tasks this could wait on">{hits.map((h) => (
            <button type="button" role="option" aria-selected={false} key={h.id} onClick={() => { setLinks([...linked, h.id]); setDepQ(''); }}
              onKeyDown={(e) => {
                const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.key === 'ArrowUp' ? e.currentTarget.previousElementSibling : null;
                if (e.key === 'ArrowUp' && !sib) { e.preventDefault(); e.currentTarget.parentElement?.parentElement?.querySelector('input')?.focus(); }
                else if (sib) { e.preventDefault(); (sib as HTMLElement).focus(); }
              }}>{h.title}<small>{h.status}</small></button>))}</div>}
          {depQ.trim() && hits.length === 0 && <p className="hint" style={{ margin: '6px 0 0' }}>No open {v.kind} task matches.</p>}
        </div>
        {blocks.length > 0 && <>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Blocks</span>
          <div className="dl">{blocks.map((b) => <span key={b.id} className={`dep${b.status === 'done' ? ' done' : ''}`}><button type="button" onClick={() => goto(b.id)}>{b.title}</button></span>)}</div>
        </>}
      </section>
      <Checklist task={task} />
      <TimeSection task={task} tasks={tasks} />
      <SupportsGoal task={task} onGo={() => ref.current?.close()} />
      {field('Notes', <textarea ref={notesRef} className="field" rows={5} defaultValue={v.notes ?? ''} onBlur={(e) => save({ notes: e.target.value || null })} />)}
      {v.source_url && <p style={{ fontSize: 13 }}>From <b>{v.source_app}</b>: <a href={v.source_url} target="_blank" rel="noopener">open in {v.source_app} ↗</a></p>}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
        <span className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={!navigator.onLine} title={navigator.onLine ? undefined : 'Needs a connection'} onClick={() => { if (task.id.startsWith('tmp-')) { toast('Wait for the task to sync, then save it'); return; } flush(); setSaveTpl(true); }}>Save as template</button>
        {mail && <button className="btn" disabled={!navigator.onLine} title={navigator.onLine ? undefined : 'Needs a connection'} onClick={() => setSplitting(true)}>Split into tasks</button>}
        <button className="btn" style={{ color: 'var(--danger)' }} onClick={async () => { if (await confirmAction('Move this task to Trash? It stays there 30 days.')) { trashed.current = true; await trashTask(task.id); toast('Moved to Trash'); ref.current?.close(); } }}>Trash</button>
        </span>
        <button className="btn primary" onClick={() => ref.current?.close()}>Done</button>
      </div>
      {saveTpl && <SaveAsTemplate from={{ task_id: task.id }} defaultName={task.title} onClose={() => setSaveTpl(false)} />}
      {splitting && mail && <SplitSheet item={mail} onClose={() => setSplitting(false)} />}
    </dialog>
  );
}
