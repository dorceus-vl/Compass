import { useEffect, useState } from 'react';
import type { MeetingReview } from '../../../shared/types.ts';
import { api, SignedOut } from '../api.ts';
import { loadMeetings, refreshInbox, safeUrl } from '../inbox.ts';
import { navigate, Link } from '../router.ts';
import { pull } from '../store/sync.ts';
import { useStore } from '../store/useStore.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';

interface Act { on: boolean; text: string; owner: string; due: string; at: string }
interface Pick { on: boolean; text: string; at: string }
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function MeetingView({ id }: { id: string }) {
  const [m, setM] = useState<MeetingReview | null | undefined>(undefined); // undefined: loading; null: not found
  const [offline, setOffline] = useState(false);
  const [acts, setActs] = useState<Act[]>([]);
  const [decs, setDecs] = useState<Pick[]>([]);
  const [qs, setQs] = useState<Pick[]>([]);
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const { projects } = useStore();
  const [, tick] = useState(0);
  useEffect(() => { // online/offline changes re-render so the buttons follow
    const f = () => tick((x) => x + 1);
    window.addEventListener('online', f); window.addEventListener('offline', f);
    return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); };
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      let found: MeetingReview | null = null, off = false;
      try { found = (await api<{ meeting: MeetingReview }>(`/meetings/${id}`)).meeting; }
      catch (e) {
        if (e instanceof SignedOut) return;
        const l = await loadMeetings().catch(() => null); // network trouble: the cached list carries every review in full
        off = !!l?.offline; found = l?.meetings.find((x) => x.id === id) ?? null;
      }
      if (!live) return;
      setOffline(off); setM(found);
      if (!found) return;
      setActs(found.action_items.map((a) => ({ on: true, text: a.text, owner: a.owner ?? '', due: a.due && YMD.test(a.due) ? a.due : '', at: a.at })));
      setDecs(found.decisions.map((d) => ({ on: true, text: d.text, at: d.at })));
      setQs(found.open_questions.map((q) => ({ on: false, text: q.text, at: q.at })));
    })();
    return () => { live = false; };
  }, [id]);

  if (m === undefined) return null;
  if (!m) return <div className="card"><p style={{ margin: 0 }}>Meeting not found. <Link to="/meetings">Back to meetings</Link></p></div>;

  const off = offline || !navigator.onLine;
  const tip = off ? 'Needs a connection' : undefined;
  const open = m.state === 'new';
  const sendActs = acts.filter((a) => a.on && a.text.trim());
  const sendQs = qs.filter((q) => q.on && q.text.trim());
  const sendDecs = decs.filter((d) => d.on && d.text.trim());
  const nTasks = sendActs.length + sendQs.length;
  const link = safeUrl(m.url);
  const live = projects.filter((p) => !p.deleted_at && p.status !== 'closed');
  const byKind = (k: string) => live.filter((p) => p.kind === k).sort((a, b) => a.sort - b.sort);

  const patch = <T,>(set: (f: (xs: T[]) => T[]) => void, i: number, p: Partial<T>) => set((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const accept = async () => {
    if (busy || off || !nTasks && !sendDecs.length) return;
    setBusy(true);
    try {
      const at = (s: string) => s.slice(0, 12);
      await api(`/meetings/${m.id}/accept`, { method: 'POST', json: {
        project_id: project || null,
        tasks: [
          ...sendActs.map((a) => ({ text: a.text.trim().slice(0, 300), due: a.due || null, owner: a.owner.trim() || null, at: at(a.at) })),
          ...sendQs.map((q) => ({ text: `Follow up: ${q.text.trim()}`.slice(0, 300), due: null, owner: null, at: at(q.at) })),
        ],
        decisions: sendDecs.map((d) => ({ text: d.text.trim().slice(0, 300), at: at(d.at) })),
      } });
      toast(`Added ${nTasks} task${nTasks === 1 ? '' : 's'}`);
      await pull().catch(() => {});
      void refreshInbox();
      navigate(project ? `/projects/${project}` : '/');
    } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); setBusy(false); }
  };
  const dismiss = async () => {
    if (busy || off || !await confirmAction('Dismiss this meeting without adding anything?')) return;
    setBusy(true);
    try { await api(`/meetings/${m.id}/dismiss`, { method: 'POST' }); void refreshInbox(); navigate('/meetings'); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); setBusy(false); }
  };
  const check = (label: string, on: boolean, change: (b: boolean) => void) =>
    <input type="checkbox" aria-label={label} checked={on} disabled={!open || busy} onChange={(e) => change(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)', flex: 'none' }} />;
  const h2 = { fontSize: 16, margin: '22px 0 10px' } as const;

  return (
    <>
      <div className="head"><div><div className="eyebrow"><Link to="/meetings">Meetings</Link></div><h1 style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{m.title}</h1>
        <div className="sub">{new Date(m.received_at).toLocaleDateString(undefined, { dateStyle: 'long' })}{!open && ' · Reviewed'}{offline && ' · Offline: reviewing needs a connection'}</div></div>
        {link && <a className="btn" href={link} target="_blank" rel="noopener noreferrer">Open transcript ↗</a>}</div>
      {m.summary && <div className="card" style={{ marginTop: 14 }}><p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.summary}</p></div>}

      <h2 style={h2}>Action items</h2>
      {!acts.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>None.</p>}
      <div style={{ display: 'grid', gap: 8 }}>{acts.map((a, i) => (
        <div key={i} className="card row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', padding: 12 }}>
          {check(`Add action item ${i + 1}`, a.on, (on) => patch(setActs, i, { on }))}
          <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
            <input className="field" aria-label={`Action item ${i + 1} text`} value={a.text} maxLength={300} disabled={!open || busy} onChange={(e) => patch(setActs, i, { text: e.target.value })} />
            <div className="row" style={{ gap: 6 }}>
              <input className="field" style={{ flex: '1 1 140px', width: 'auto' }} aria-label={`Action item ${i + 1} owner`} placeholder="Owner" value={a.owner} maxLength={200} disabled={!open || busy} onChange={(e) => patch(setActs, i, { owner: e.target.value })} />
              <input className="field" style={{ flex: '0 1 170px', width: 'auto' }} type="date" aria-label={`Action item ${i + 1} due date`} value={a.due} disabled={!open || busy} onChange={(e) => patch(setActs, i, { due: e.target.value })} />
              {a.at && <span className="chip" title="Transcript time">{a.at}</span>}
            </div>
          </div>
        </div>))}</div>

      <h2 style={h2}>Decisions</h2>
      {!decs.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>None.</p>}
      <div style={{ display: 'grid', gap: 8 }}>{decs.map((d, i) => (
        <label key={i} className="card row" style={{ flexWrap: 'nowrap', padding: 12, cursor: open ? 'pointer' : 'default' }}>
          {check(`Add decision ${i + 1}`, d.on, (on) => patch(setDecs, i, { on }))}
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{d.text}</span>{d.at && <span className="chip">{d.at}</span>}
        </label>))}</div>

      <h2 style={h2}>Open questions</h2>
      {!qs.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>None.</p>}
      <div style={{ display: 'grid', gap: 8 }}>{qs.map((q, i) => (
        <label key={i} className="card row" style={{ flexWrap: 'nowrap', padding: 12, cursor: open ? 'pointer' : 'default' }}>
          {check(`Add follow-up task for question ${i + 1}`, q.on, (on) => patch(setQs, i, { on }))}
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{q.text}</span>{q.at && <span className="chip">{q.at}</span>}
        </label>))}</div>
      {qs.length > 0 && open && <div className="sub">Checked questions become "Follow up" tasks.</div>}

      {m.important_notes.length > 0 && <>
        <h2 style={h2}>Important notes</h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>{m.important_notes.map((x, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{x.text}{x.at && <> <span className="chip">{x.at}</span></>}</li>)}</ul>
      </>}

      {open && (
        <div className="row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
          <label className="row" style={{ gap: 8, fontSize: 13 }}>Project
            <select className="field" style={{ width: 'auto' }} value={project} disabled={busy} onChange={(e) => setProject(e.target.value)}>
              <option value="">No project</option>
              {(['work', 'personal'] as const).map((k) => byKind(k).length > 0 && <optgroup key={k} label={k === 'work' ? 'Work' : 'Personal'}>{byKind(k).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
            </select></label>
          <div className="row">
            <button type="button" className="btn" disabled={off || busy} title={tip} onClick={() => void dismiss()}>Dismiss</button>
            <button type="button" className="btn primary" disabled={off || busy || (!nTasks && !sendDecs.length)} title={tip} onClick={() => void accept()}>
              Accept {nTasks} task{nTasks === 1 ? '' : 's'} and {sendDecs.length} decision{sendDecs.length === 1 ? '' : 's'}</button>
          </div>
        </div>
      )}
    </>
  );
}
