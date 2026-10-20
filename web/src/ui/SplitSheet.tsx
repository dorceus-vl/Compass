import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Horizon, InboxItem, SplitProposal } from '../../../shared/types.ts';
import { api, ApiError, SignedOut } from '../api.ts';
import { refreshInbox } from '../inbox.ts';
import { pull } from '../store/sync.ts';
import { useStore } from '../store/useStore.ts';
import { toast } from './dialogs.tsx';
import { accent, sourceColor } from './colors.ts';

interface Row { on: boolean; title: string; due: string; horizon: Horizon; notes: string | null }
type Phase = 'pick' | 'loading' | 'review' | 'error';
const HORIZONS: [Horizon, string][] = [['short', 'Short · this week'], ['medium', 'Medium · this quarter'], ['long', 'Long · this year']];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Athena splits a forwarded email into proposed tasks; Vlad ticks and edits them before anything is created (the server re-checks the boundary on both calls). */
export function SplitSheet({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const work = !!item.work;
  const { projects } = useStore();
  // Cloud projects only: a work email may go to a work one; a personal email to any (or none).
  const choices = useMemo(() => projects.filter((p) => !p.deleted_at && p.status !== 'closed' && p.data_boundary === 'cloud' && (!work || p.kind === 'work')).sort((a, b) => a.sort - b.sort), [projects, work]);
  const [project, setProject] = useState('');
  const [phase, setPhase] = useState<Phase>(work ? 'pick' : 'loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    const f = () => setOffline(!navigator.onLine);
    window.addEventListener('online', f); window.addEventListener('offline', f);
    return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); };
  }, []);
  const tip = offline ? 'Needs a connection' : undefined;

  const ask = async () => {
    if (offline) return;
    setPhase('loading');
    try {
      const { proposals } = await api<{ proposals: SplitProposal[] }>(`/inbox/${item.id}/split`, { method: 'POST', json: { project_id: project || null } });
      if (!live.current) return;
      setRows(proposals.map((p) => ({ on: true, title: p.title, due: p.due_at && YMD.test(p.due_at) ? p.due_at : '', horizon: p.horizon, notes: p.notes })));
      setPhase('review');
    } catch (e) {
      if (e instanceof SignedOut || !live.current) return;
      setProblem((e as Error).message); setPhase('error');
    }
  };
  useEffect(() => { if (!work) void ask(); }, []); // a personal email goes straight to Athena

  const ticked = rows.filter((r) => r.on && r.title.trim());
  const patch = (i: number, p: Partial<Row>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const accept = async () => {
    if (busy || offline || !ticked.length) return;
    setBusy(true);
    try {
      await api(`/inbox/${item.id}/split/accept`, { method: 'POST', json: { project_id: project || null,
        tasks: ticked.map((r) => ({ title: r.title.trim().slice(0, 120), due_at: r.due || null, horizon: r.horizon, notes: r.notes })) } });
      toast(`Added ${ticked.length} task${ticked.length === 1 ? '' : 's'}`);
      await pull().catch(() => {});
      void refreshInbox();
      ref.current?.close();
    } catch (e) {
      if (e instanceof SignedOut) return;
      toast((e as Error).message); setBusy(false);
      if (e instanceof ApiError && e.status === 409) { void refreshInbox(); ref.current?.close(); }
    }
  };

  const style = { ...accent(sourceColor(item.app)) } as CSSProperties;
  return (
    <dialog ref={ref} className="split-sheet" data-phase={phase} aria-label="Split into tasks" onClose={onClose}>
      <div className="eyebrow">Athena · split into tasks</div>
      <h2 className="split-title">{item.title}</h2>

      {phase === 'pick' && <>
        <p className="sub">Athena can read work email only inside a project that allows cloud AI.</p>
        {choices.length ? (
          <label className="split-field">Project
            <select className="field" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Choose a project…</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        ) : <p className="sub">No work project allows cloud AI yet. Turn it on in a project's settings first.</p>}
        <div className="row split-actions">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button type="button" className="btn primary" disabled={!project || offline} title={tip} onClick={() => void ask()}>Ask Athena</button>
        </div>
      </>}

      {phase === 'loading' && <p className="sub" role="status">Athena is reading the email…</p>}

      {phase === 'error' && <>
        <p role="alert">{problem}</p>
        <div className="row split-actions">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Close</button>
          {work && <button type="button" className="btn" onClick={() => setPhase('pick')}>Back</button>}
          <button type="button" className="btn primary" disabled={offline} title={tip} onClick={() => void ask()}>Try again</button>
        </div>
      </>}

      {phase === 'review' && <>
        {!rows.length && <p className="sub">Athena found no separate actions in this email.</p>}
        <div className="mlist" style={style}>
          {rows.map((r, i) => (
            <div key={i} className="acard mcard" style={style}>
              <span className="tog"><input type="checkbox" aria-label={`Add task ${i + 1}`} checked={r.on} disabled={busy} onChange={(e) => patch(i, { on: e.target.checked })} /><i /></span>
              <div className="fields">
                <input className="field" aria-label={`Task ${i + 1} title`} value={r.title} maxLength={120} disabled={busy} onChange={(e) => patch(i, { title: e.target.value })} />
                <div className="row" style={{ gap: 6 }}>
                  <input className="field" style={{ flex: '0 1 170px', width: 'auto' }} type="date" aria-label={`Task ${i + 1} due date`} value={r.due} disabled={busy} onChange={(e) => patch(i, { due: e.target.value })} />
                  <select className="field" style={{ flex: '1 1 150px', width: 'auto' }} aria-label={`Task ${i + 1} horizon`} value={r.horizon} disabled={busy} onChange={(e) => patch(i, { horizon: e.target.value as Horizon })}>
                    {HORIZONS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
                  </select>
                </div>
                {r.notes && <div className="sub">{r.notes}</div>}
              </div>
            </div>))}
        </div>
        {!work && choices.length > 0 && (
          <label className="split-field">Project
            <select className="field" value={project} disabled={busy} onChange={(e) => setProject(e.target.value)}>
              <option value="">No project</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>)}
        <div className="row split-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => ref.current?.close()}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || offline || !ticked.length} title={tip} onClick={() => void accept()}>Add {ticked.length} task{ticked.length === 1 ? '' : 's'}</button>
        </div>
        {offline && <div className="sub" role="status">Needs a connection</div>}
      </>}
    </dialog>
  );
}
