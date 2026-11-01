import { useState, type FormEvent } from 'react';
import type { Project, Task } from '../../../shared/types.ts';
import { parseWbs, numbers, addNode, shift, move, removeNode, subtreeIds, stored, MAX_WBS_NODES, MAX_WBS_TITLE, type WbsNode } from '../../../shared/wbs.ts';
import { updateProject, updateTask } from '../store/useStore.ts';
import { useLatest } from './CustomFields.tsx';
import { confirmAction, toast } from './dialogs.tsx';

/** Project WBS tab (v2.8): an outline numbered 1, 1.1, 1.2.1. Tasks hang off any node; a node's count includes everything under it. */
export function WbsEditor({ project, tasks, onOpen }: { project: Project; tasks: Task[]; onOpen: (id: string) => void }) {
  const latest = useLatest(project.wbs);
  const nodes = parseWbs(project.wbs) ?? [];
  const [title, setTitle] = useState('');
  const put = (next: WbsNode[] | null, why: string) => {
    if (!next) { toast(why); return false; }
    const v = stored(next);
    latest.set(v);
    void updateProject(project.id, { wbs: v });
    return true;
  };
  // Always build on the latest queued outline, not the prop: two quick taps must not undo each other.
  const cur = () => parseWbs(latest.get()) ?? [];
  const nums = numbers(nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const byNode = new Map<string, Task[]>();
  for (const t of tasks) if (t.wbs_id && ids.has(t.wbs_id)) byNode.set(t.wbs_id, [...(byNode.get(t.wbs_id) ?? []), t]);
  const loose = tasks.filter((t) => !t.wbs_id || !ids.has(t.wbs_id)).length;
  const newId = () => crypto.randomUUID().slice(0, 8);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (t && put(addNode(cur(), { id: newId(), title: t }, null), `${MAX_WBS_NODES} nodes at most`)) setTitle('');
  };
  return (
    <div className="wbs" style={{ display: 'grid', gap: 10 }}>
      <div className="sub">Break the scope into work packages. Open a task and pick its package; its tasks then list under it.</div>
      {nodes.map((n, i) => {
        const own = byNode.get(n.id) ?? [];
        const all = subtreeIds(nodes, n.id).flatMap((id) => byNode.get(id) ?? []);
        const done = all.filter((t) => t.status === 'done').length;
        return (
          <div key={n.id} className="acard wbs-row" style={{ marginLeft: n.depth * 18 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="chip" aria-label="Number">{nums[i]}</span>
              <input key={n.title} className="field" aria-label={`${nums[i]} title`} defaultValue={n.title} maxLength={MAX_WBS_TITLE} onBlur={(e) => {
                const t = e.target.value.trim();
                if (!t) { e.target.value = n.title; return; }
                if (t !== n.title) put(cur().map((x) => (x.id === n.id ? { ...x, title: t } : x)), '');
              }} />
              {all.length > 0 && <span className="chip" title="Done of all tasks in this package and below">{done}/{all.length}</span>}
            </div>
            <div className="row wbs-act">
              <button type="button" className="btn" aria-label={`Move ${nums[i]} up`} onClick={() => put(move(cur(), n.id, -1), 'Already first here')}>↑</button>
              <button type="button" className="btn" aria-label={`Move ${nums[i]} down`} onClick={() => put(move(cur(), n.id, 1), 'Already last here')}>↓</button>
              <button type="button" className="btn" aria-label={`Move ${nums[i]} out one level`} onClick={() => put(shift(cur(), n.id, -1), 'Already top level')}>←</button>
              <button type="button" className="btn" aria-label={`Move ${nums[i]} in one level`} onClick={() => put(shift(cur(), n.id, 1), 'Needs a package above it to nest under')}>→</button>
              <SubAdd label={`Add under ${nums[i]}`} onAdd={(t) => put(addNode(cur(), { id: newId(), title: t }, n.id), `${MAX_WBS_NODES} nodes and 6 levels at most`)} />
              <button type="button" className="btn" style={{ color: 'var(--danger)' }} aria-label={`Remove ${nums[i]}`} onClick={async () => {
                const sub = subtreeIds(nodes, n.id).length;
                if (await confirmAction(`Remove "${n.title}"${sub > 1 ? ` and the ${sub - 1} below it` : ''}? Its tasks stay in the project, off the breakdown.`, { danger: true })) put(removeNode(cur(), n.id).nodes, '');
              }}>Remove</button>
            </div>
            {own.map((t) => <button type="button" key={t.id} className="wbs-task" onClick={() => onOpen(t.id)}>{t.status === 'done' ? '✓ ' : ''}{t.title}</button>)}
          </div>
        );
      })}
      {!nodes.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No work packages yet.</p>}
      <form className="row" onSubmit={add}>
        <input className="field" style={{ flex: '1 1 240px', width: 'auto' }} aria-label="New top-level work package" placeholder="New top-level work package…" maxLength={MAX_WBS_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn primary" disabled={!title.trim()}>Add</button>
      </form>
      {nodes.length > 0 && <div className="qnote">{loose ? `${loose} task${loose === 1 ? '' : 's'} not on the breakdown.` : 'Every task is on the breakdown.'}</div>}
    </div>
  );
}

/** "Add under" as an in-place field: no prompt() (rule 6). */
function SubAdd({ label, onAdd }: { label: string; onAdd: (title: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState('');
  if (!open) return <button type="button" className="btn" aria-label={label} onClick={() => setOpen(true)}>+ Sub</button>;
  return (
    <form className="row" style={{ flex: '1 1 200px', flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (t.trim() && onAdd(t.trim())) { setT(''); setOpen(false); } }}>
      <input className="field" autoFocus aria-label={label} placeholder="Sub-package…" maxLength={MAX_WBS_TITLE} value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setT(''); } }} />
      <button className="btn primary" disabled={!t.trim()}>Add</button>
    </form>
  );
}

/** Task sheet: which work package the task hangs off. Hidden when the project has no breakdown. A node removed since leaves the task showing None. */
export function TaskWbs({ task, project }: { task: Task; project: Project | undefined }) {
  const nodes = parseWbs(project?.wbs) ?? [];
  if (!nodes.length) return null;
  const nums = numbers(nodes);
  const cur = nodes.some((n) => n.id === task.wbs_id) ? task.wbs_id! : '';
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>Work package
      <select className="field" style={{ minHeight: 44 }} value={cur} onChange={(e) => void updateTask(task.id, { wbs_id: e.target.value || null })}>
        <option value="">None</option>
        {nodes.map((n, i) => <option key={n.id} value={n.id}>{'  '.repeat(n.depth)}{nums[i]} {n.title}</option>)}
      </select>
    </label>
  );
}
