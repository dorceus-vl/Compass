import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../../../shared/types.ts';
import { slip, slipOf, type Snapshot, type SlipRow } from '../../../../shared/baseline.ts';
import { useStore } from '../../store/useStore.ts';
import { api, online } from '../../api.ts';
import { useBaselines, fetchSnapshot, type BaselineInfo } from '../../baselines.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';
import { accent } from '../../ui/colors.ts';
import { SectionHead } from '../../ui/SectionHead.tsx';
import { today } from '../../dates.ts';
import { localDay } from '../../../../shared/dashboard.ts';
import { useTz } from './Report.tsx';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
const days = (n: number) => `${signed(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
const FLAG: Record<NonNullable<SlipRow['flag']>, string> = { new: 'Added since', dropped: 'Removed or trashed', dated: 'Date added', undated: 'Date removed' };

/** Names the baseline and saves it; the snapshot is built on the server. Needs a connection. */
function SaveBaseline({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(`Baseline ${today()}`);
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(online());
  useEffect(() => { ref.current?.showModal(); const f = () => setOn(online()); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (!online()) { toast('Saving a baseline needs a connection'); return; }
    setBusy(true);
    try {
      await api(`/projects/${project.id}/baselines`, { method: 'POST', json: { name: name.trim() } });
      toast('Baseline saved');
      onSaved();
      ref.current?.close();
    } catch (err) { toast((err as Error).message || 'Could not save the baseline'); setBusy(false); }
  };
  return (
    <dialog ref={ref} className="tpl-dlg" aria-label="Save baseline" onClose={onClose}>
      <form onSubmit={submit} className="tpl-form">
        <b>Save baseline</b>
        <p className="hint" style={{ margin: 0 }}>Freezes the start and due dates of every task and milestone in this project, so you can see later what moved. Changes not yet synced from this device are left out.</p>
        {!on && <p className="hint" style={{ margin: 0 }}>Saving a baseline needs a connection.</p>}
        <input className="field" autoFocus required maxLength={200} aria-label="Baseline name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn primary" disabled={!on || busy || !name.trim()}>Save</button>
        </div>
      </form>
    </dialog>
  );
}

/** What moved since a baseline: the summary line on top, then a table, biggest move first. Computed here, from the mirror. */
function SlipView({ baseline, project }: { baseline: BaselineInfo; project: Project }) {
  const { tasks, milestones } = useStore();
  const [snap, setSnap] = useState<Snapshot | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  useEffect(() => { let live = true; setSnap(undefined); fetchSnapshot(baseline.id).then((s) => { if (live) setSnap(s); }).catch(() => { if (live) setSnap(null); }); return () => { live = false; }; }, [baseline.id]);
  const result = useMemo(() => snap ? slip(snap, tasks.filter((t) => t.project_id === project.id && !t.deleted_at), milestones.filter((m) => m.project_id === project.id && !m.deleted_at), project) : null, [snap, tasks, milestones, project]);
  if (snap === undefined) return <p className="hint">Opening…</p>;
  if (!snap || !result) return <p className="hint" role="status">This baseline can't be opened offline. Connect once to load it.</p>;
  const titleOf = (r: SlipRow) => (r.kind === 'task' ? tasks.find((t) => t.id === r.id)?.title : milestones.find((m) => m.id === r.id)?.name) ?? (r.kind === 'task' ? 'Removed task' : 'Removed milestone');
  const { summary: s } = result;
  const unchanged = result.rows.filter((r) => slipOf(r) === 0);
  const rows = all ? result.rows : result.rows.filter((r) => slipOf(r) !== 0);
  const line = [
    `${plural(s.compared, 'item')} compared`,
    s.late ? `${s.late} later (average ${days(s.avg_late)}, up to ${days(s.max_late)})` : 'none later',
    `${s.early} earlier`, `${s.unchanged} unchanged`,
    ...(s.milestones_late ? [plural(s.milestones_late, 'milestone') + ' late'] : []),
    ...(s.added ? [`${s.added} added since`] : []), ...(s.dropped ? [`${s.dropped} removed`] : []),
  ].join(' · ');
  const end = s.project_end_delta === null ? null : s.project_end_delta === 0 ? 'Project end date unchanged.' : `Project end date moved ${days(s.project_end_delta)}.`;
  return (
    <div className="slip-view">
      <p className="slip-sum" id={`slip-${baseline.id}`}>{line}.{end ? ` ${end}` : ''}</p>
      {rows.length > 0 ? <div className="scroll-x"><table className="slip" aria-describedby={`slip-${baseline.id}`}>
        <thead><tr><th scope="col">Item</th><th scope="col">Baseline</th><th scope="col">Now</th><th scope="col">Change</th><th scope="col">Note</th></tr></thead>
        <tbody>{rows.map((r) => { const d = slipOf(r); return (
          <tr key={`${r.kind}${r.id}`}>
            <th scope="row"><span className="slip-t">{titleOf(r)}</span><small>{r.kind === 'milestone' ? 'Milestone' : 'Task'}</small></th>
            <td className="num">{r.baseline_start ? `${r.baseline_start} → ` : ''}{r.baseline_due ?? (r.baseline_start ? '' : '–')}</td>
            <td className="num">{r.current_start ? `${r.current_start} → ` : ''}{r.current_due ?? (r.current_start ? '' : '–')}</td>
            <td className={`num slip-d ${d === null ? '' : d > 0 ? 'late' : d < 0 ? 'early' : ''}`}>{d === null ? '–' : d === 0 ? 'No change' : `${days(d)} ${d > 0 ? 'later' : 'earlier'}`}
              {r.due_delta !== null && r.start_delta !== null && r.start_delta !== 0 && r.start_delta !== r.due_delta && <small>start {days(r.start_delta)}</small>}</td>
            <td>{r.flag ? <span className="chip">{FLAG[r.flag]}</span> : null}</td>
          </tr>); })}</tbody>
      </table></div> : <p className="hint">{result.rows.length ? 'Nothing has moved.' : 'No dated items to compare.'}</p>}
      {unchanged.length > 0 && <label className="sub tap"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> Show {plural(unchanged.length, 'unchanged item')}</label>}
    </div>
  );
}

/** Overview → Baselines: save, list, rename, delete, and the slip view of one. Saving and editing need a connection; opening works from the copy on the device. */
export function Baselines({ project }: { project: Project }) {
  const { items, offline, loaded, reload } = useBaselines(project.id);
  const tz = useTz();
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [on, setOn] = useState(online());
  useEffect(() => { const f = () => setOn(online()); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; }, []);
  const needNet = !on || offline;
  const rename = async (b: BaselineInfo, name: string) => {
    const n = name.trim();
    if (!n || n === b.name) return;
    if (!online()) { toast('Renaming needs a connection'); return; }
    try { await api(`/baselines/${b.id}`, { method: 'PATCH', json: { name: n } }); await reload(); } catch (e) { toast((e as Error).message); }
  };
  const remove = async (b: BaselineInfo) => {
    if (!online()) { toast('Deleting needs a connection'); return; }
    if (!(await confirmAction(`Move the baseline "${b.name}" to Trash?`, { danger: true }))) return;
    try { await api(`/baselines/${b.id}`, { method: 'DELETE' }); if (open === b.id) setOpen(null); toast('Moved to Trash'); await reload(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <section aria-labelledby="bl-h">
      <SectionHead eyebrow="Schedule" title={<span id="bl-h">Baselines</span>}>
        <button type="button" className="btn" disabled={needNet || project.id.startsWith('tmp-')} onClick={() => setSaving(true)}>Save baseline</button>
      </SectionHead>
      {needNet && <p className="hint" role="status">Saving, renaming and deleting a baseline need a connection. Baselines already opened still show.</p>}
      <div className="bl-list">
        {items.map((b) => (
          <div key={b.id} className="acard bl-row" style={accent('var(--swatch-1)')}>
            <div className="bl-head">
              <input className="field bl-name" key={b.name} defaultValue={b.name} maxLength={200} aria-label={`Baseline name, saved ${localDay(b.taken_at, tz)}`} disabled={needNet} onBlur={(e) => void rename(b, e.target.value)} />
              <span className="chip">{localDay(b.taken_at, tz)}</span>
              <span className="chip">{plural(b.task_count, 'task')} · {plural(b.milestone_count, 'milestone')}</span>
            </div>
            <div className="row">
              <button type="button" className="btn" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Hide what moved' : 'Show what moved'}</button>
              <button type="button" className="btn" style={{ color: 'var(--danger)' }} disabled={needNet} onClick={() => void remove(b)}>Delete</button>
            </div>
            {open === b.id && <SlipView baseline={b} project={project} />}
          </div>
        ))}
        {loaded && !items.length && <p className="hint">{offline ? 'Nothing saved on this device yet.' : 'No baselines yet. Save one to freeze this plan and see later what slipped.'}</p>}
      </div>
      {saving && <SaveBaseline project={project} onClose={() => setSaving(false)} onSaved={() => void reload()} />}
    </section>
  );
}
