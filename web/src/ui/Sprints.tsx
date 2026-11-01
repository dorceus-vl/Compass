import { useRef, useState, type FormEvent } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { parseSprints, storedSprints, startSprint, closeSprint, velocity, burndown, MAX_SPRINTS, MAX_SPRINT_NAME, MAX_SPRINT_GOAL, MAX_SPRINT_DAYS, span, type Sprint } from '../../../shared/sprints.ts';
import { updateProject, updateTask } from '../store/useStore.ts';
import { useLatest } from './CustomFields.tsx';
import { confirmAction, toast } from './dialogs.tsx';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return ymd(d); };

/** Project Sprints tab (v2.9): plan sprints from the backlog, start one, watch the burndown, close it into velocity. Effort is counted in tasks. */
export function SprintsTab({ project, tasks, onOpen }: { project: Project; tasks: Task[]; onOpen: (id: string) => void }) {
  const latest = useLatest(project.sprints);
  const list = parseSprints(project.sprints) ?? [];
  const cur = () => parseSprints(latest.get()) ?? [];
  const put = (next: Sprint[] | null, why: string) => {
    if (!next) { toast(why); return false; }
    const v = storedSprints(next);
    latest.set(v);
    void updateProject(project.id, { sprints: v });
    return true;
  };
  const [name, setName] = useState('');
  const [start, setStart] = useState(() => plus(0));
  const [end, setEnd] = useState(() => plus(13));
  const live = useRef(tasks);
  live.current = tasks;
  const ids = new Set(list.filter((s) => s.state !== 'closed').map((s) => s.id)); // a task left in a closed sprint falls back to the backlog
  const inSprint = (id: string) => live.current.filter((t) => t.sprint_id === id);
  const backlog = tasks.filter((t) => t.status !== 'done' && (!t.sprint_id || !ids.has(t.sprint_id)));
  const today = ymd(new Date());
  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || end < start) { if (end < start) toast('End is before start'); return; }
    if (span(start, end) > MAX_SPRINT_DAYS) { toast(`${MAX_SPRINT_DAYS} days at most`); return; }
    if (put([...cur(), { id: crypto.randomUUID().slice(0, 8), name: n, goal: '', start, end, state: 'planned' as const }].slice(0, MAX_SPRINTS), '')) setName('');
  };
  const edit = (id: string, patch: Partial<Sprint>) => {
    const next = cur().map((s) => (s.id === id ? { ...s, ...patch } : s));
    const s = next.find((x) => x.id === id)!;
    if (s.end < s.start) { toast('End is before start'); return false; }
    if (span(s.start, s.end) > MAX_SPRINT_DAYS) { toast(`${MAX_SPRINT_DAYS} days at most`); return false; }
    return put(next, '');
  };
  const close = async (s: Sprint) => {
    const count = () => { const mine = inSprint(s.id); return { mine, open: mine.filter((t) => t.status !== 'done'), nextPlanned: cur().find((x) => x.state === 'planned') }; };
    const first = count();
    if (!(await confirmAction(`Close "${s.name}"? ${first.open.length ? `${first.open.length} unfinished task${first.open.length === 1 ? '' : 's'} move to ${first.nextPlanned ? `"${first.nextPlanned.name}"` : 'the backlog'}.` : 'Every task is done.'}`))) return;
    const { mine, open, nextPlanned } = count(); // recount: tasks may have changed while the dialog was open
    if (!put(closeSprint(cur(), s.id, mine.length, mine.length - open.length), 'That sprint is not active')) return;
    for (const t of open) void updateTask(t.id, { sprint_id: nextPlanned?.id ?? null });
  };
  const v = velocity(list);
  const order = (s: Sprint) => (s.state === 'active' ? 0 : s.state === 'planned' ? 1 : 2);
  const shown = [...list].sort((a, b) => order(a) - order(b) || (a.state === 'closed' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
  return (
    <div className="sprints" style={{ display: 'grid', gap: 10 }}>
      <div className="sub">Plan work into time-boxed sprints. Pick a sprint on a task, or from the backlog below. Start one, then close it to log velocity.</div>
      {shown.map((s) => {
        const mine = inSprint(s.id), done = mine.filter((t) => t.status === 'done').length;
        return (
          <div key={s.id} className="acard sprint">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input key={s.name} className="field" aria-label={`${s.name} name`} defaultValue={s.name} maxLength={MAX_SPRINT_NAME} disabled={s.state === 'closed'} onBlur={(e) => {
                const t = e.target.value.trim();
                if (!t) { e.target.value = s.name; return; }
                if (t !== s.name) edit(s.id, { name: t });
              }} />
              <span className="chip">{s.state}</span>
              {s.state === 'closed' ? <span className="chip">{s.done ?? 0}/{s.total ?? 0}</span> : mine.length > 0 && <span className="chip">{done}/{mine.length}</span>}
            </div>
            {s.state !== 'closed' && (
              <div className="row">
                <label className="sprint-d">Start <input type="date" className="field" value={s.start} onChange={(e) => e.target.value && edit(s.id, { start: e.target.value })} /></label>
                <label className="sprint-d">End <input type="date" className="field" value={s.end} onChange={(e) => e.target.value && edit(s.id, { end: e.target.value })} /></label>
              </div>
            )}
            {s.state === 'closed' && <div className="qnote">{s.start} to {s.end}</div>}
            <input key={s.goal} className="field" aria-label={`${s.name} goal`} placeholder="Sprint goal…" defaultValue={s.goal} maxLength={MAX_SPRINT_GOAL} disabled={s.state === 'closed'} onBlur={(e) => { if (e.target.value.trim() !== s.goal) edit(s.id, { goal: e.target.value.trim() }); }} />
            {s.state === 'active' && <Burn sprint={s} tasks={mine} today={today} />}
            {s.state !== 'closed' && mine.map((t) => <TaskLine key={t.id} task={t} sprints={list} onOpen={onOpen} />)}
            <div className="row sprint-act">
              {s.state === 'planned' && <button type="button" className="btn primary" onClick={() => put(startSprint(cur(), s.id), 'Close the active sprint first')}>Start</button>}
              {s.state === 'active' && <button type="button" className="btn primary" onClick={() => void close(s)}>Close sprint</button>}
              {s.state !== 'active' && (
                <button type="button" className="btn" style={{ color: 'var(--danger)' }} aria-label={`Remove ${s.name}`} onClick={async () => {
                  if (!(await confirmAction(`Remove "${s.name}"? Its tasks go back to the backlog.`, { danger: true }))) return;
                  if (put(cur().filter((x) => x.id !== s.id), '')) for (const t of inSprint(s.id)) void updateTask(t.id, { sprint_id: null });
                }}>Remove</button>
              )}
            </div>
          </div>
        );
      })}
      {!list.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No sprints yet.</p>}
      <form className="row sprint-new" onSubmit={add}>
        <input className="field" style={{ flex: '1 1 200px', width: 'auto' }} aria-label="New sprint name" placeholder="New sprint…" maxLength={MAX_SPRINT_NAME} value={name} onChange={(e) => setName(e.target.value)} />
        <input type="date" className="field" aria-label="Sprint start" value={start} onChange={(e) => setStart(e.target.value)} />
        <input type="date" className="field" aria-label="Sprint end" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button className="btn primary" disabled={!name.trim() || !start || !end}>Add</button>
      </form>
      {v.points.length > 0 && (
        <div className="acard">
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>Velocity</strong><span className="chip">avg {v.mean} tasks</span></div>
          {v.points.map((p) => <div key={p.id} className="vel" title={`${p.name}: ${p.done}`}><span>{p.name}</span><i style={{ width: `${Math.max(2, (p.done / Math.max(1, ...v.points.map((q) => q.done))) * 100)}%` }} /><b>{p.done}</b></div>)}
        </div>
      )}
      <div className="acard">
        <strong>Backlog</strong>
        {backlog.map((t) => <TaskLine key={t.id} task={t} sprints={list} onOpen={onOpen} />)}
        {!backlog.length && <p style={{ color: 'var(--text-faint)', margin: '6px 0 0' }}>Nothing waiting outside a sprint.</p>}
      </div>
    </div>
  );
}

/** One task row with a sprint picker. Closed sprints are not offered. */
function TaskLine({ task, sprints, onOpen }: { task: Task; sprints: Sprint[]; onOpen: (id: string) => void }) {
  return (
    <div className="row sprint-task" style={{ flexWrap: 'nowrap' }}>
      <button type="button" className="wbs-task" style={{ borderTop: 0 }} onClick={() => onOpen(task.id)}>{task.status === 'done' ? '✓ ' : ''}{task.title}</button>
      <SprintSelect task={task} sprints={sprints} />
    </div>
  );
}

function SprintSelect({ task, sprints }: { task: Task; sprints: Sprint[] }) {
  const open = sprints.filter((s) => s.state !== 'closed');
  const cur = open.some((s) => s.id === task.sprint_id) ? task.sprint_id! : '';
  return (
    <select className="field" style={{ width: 'auto', maxWidth: 150, minHeight: 44 }} aria-label={`Sprint for ${task.title}`} value={cur} onChange={(e) => void updateTask(task.id, { sprint_id: e.target.value || null })}>
      <option value="">Backlog</option>
      {open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

/** Task sheet: which sprint the task is in. Hidden when the project has no open sprint and the task is in none. */
export function TaskSprint({ task, project }: { task: Task; project: Project | undefined }) {
  const sprints = parseSprints(project?.sprints) ?? [];
  if (!sprints.some((s) => s.state !== 'closed')) return null;
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>Sprint
      <SprintSelect task={task} sprints={sprints} />
    </label>
  );
}

/** Burndown: remaining tasks per day (solid) against the ideal line (dashed), plus days left. */
function Burn({ sprint, tasks, today }: { sprint: Sprint; tasks: Task[]; today: string }) {
  const rows = burndown(sprint, tasks.map((t) => (t.status === 'done' ? t.done_at ?? sprint.start : null)), today);
  const total = tasks.length, W = 300, H = 90;
  const x = (i: number) => (rows.length > 1 ? (i / (rows.length - 1)) * W : 0), y = (n: number) => H - (total ? (n / total) * (H - 6) : 0) - 3;
  const real = rows.flatMap((r, i) => (r.remaining === null ? [] : [`${x(i)},${y(r.remaining)}`])).join(' ');
  const ideal = rows.map((r, i) => `${x(i)},${y(r.ideal)}`).join(' ');
  const left = Math.max(0, Math.round((Date.parse(sprint.end) - Date.parse(today)) / 86400000));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown: ${rows.find((r) => r.day === today)?.remaining ?? total} of ${total} tasks left, ${left} days to go`} style={{ width: '100%', maxHeight: 120 }}>
        <polyline points={ideal} fill="none" stroke="var(--text-faint)" strokeDasharray="4 3" strokeWidth="1.5" />
        {real && <polyline points={real} fill="none" stroke="var(--accent)" strokeWidth="2" />}
      </svg>
      <div className="qnote">{today > sprint.end ? `Ended ${sprint.end}; close it to log velocity.` : `${left} day${left === 1 ? '' : 's'} left`}</div>
    </div>
  );
}
