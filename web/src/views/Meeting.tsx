import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MeetingReview } from '../../../shared/types.ts';
import { api, ApiError, SignedOut } from '../api.ts';
import { loadMeetings, refreshInbox, safeUrl } from '../inbox.ts';
import { navigate, Link } from '../router.ts';
import { pull } from '../store/sync.ts';
import { useStore } from '../store/useStore.ts';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { minutesDoc } from '../../../shared/doc-model.ts';
import { toMarkdown } from '../../../shared/to-md.ts';
import { accent } from '../ui/colors.ts';
import { useReducedMotion } from '../motion.ts';
import { DOCX_TYPE, fileName, saveBytes, saveText } from '../docs/download.ts';
import { SaveToKnowledge } from '../ui/KnowledgePick.tsx';
import { MoveToSeries } from './MeetingSeries.tsx';
import { createPortal } from 'react-dom';

interface Act { on: boolean; text: string; owner: string; due: string; at: string }
interface Pick { on: boolean; text: string; at: string }
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// The server's text is not trusted to be well-formed: coerce every field, drop rows with no text.
type Raw = { text?: unknown; at?: unknown; owner?: unknown; due?: unknown } | null | undefined;
const norm = (xs: unknown) => (Array.isArray(xs) ? (xs as Raw[]) : []).map((x) => ({
  text: String(x?.text ?? ''), at: typeof x?.at === 'string' ? x.at : '',
  owner: typeof x?.owner === 'string' ? x.owner : null, due: typeof x?.due === 'string' && YMD.test(x.due) ? x.due : '',
})).filter((x) => x.text.trim());
const atOf = (s: string) => (s.trim() ? s.trim().slice(0, 12) : null);

export function MeetingView({ id }: { id: string }) {
  const [m, setM] = useState<MeetingReview | null | undefined>(undefined); // undefined: loading; null: not found
  const [offline, setOffline] = useState(false);
  const [acts, setActs] = useState<Act[]>([]);
  const [decs, setDecs] = useState<Pick[]>([]);
  const [qs, setQs] = useState<Pick[]>([]);
  const [notes, setNotes] = useState<{ text: string; at: string }[]>([]);
  const [project, setProject] = useState('');
  const [flags, setFlags] = useState<Record<string, 'risk' | 'issue'>>({}); // q<i> / n<i> → what to log in RAID
  const [busy, setBusy] = useState(false);
  const [ser, setSer] = useState<{ id: string; name: string } | null>(null); // v2.1: the meeting's series
  const [moving, setMoving] = useState(false);
  const [out, setOut] = useState(false); // accepted: the checked cards slide away before we leave
  const alive = useRef(true);
  const reduce = useReducedMotion();
  const { projects } = useStore();
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { // the flag follows the browser, so the buttons come back after reconnecting
    const f = () => setOffline(!navigator.onLine);
    window.addEventListener('online', f); window.addEventListener('offline', f);
    return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); };
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      let found: MeetingReview | null = null, off = false;
      try { const r = await api<{ meeting: MeetingReview; series: { id: string; name: string } | null }>(`/meetings/${id}`); found = r.meeting; if (live) setSer(r.series); }
      catch (e) {
        if (e instanceof SignedOut) return;
        const l = await loadMeetings().catch(() => null); // network trouble: the cached list carries every review in full
        off = !!l?.offline; found = l?.meetings.find((x) => x.id === id) ?? null;
      }
      if (!live) return;
      setOffline(off); setM(found);
      if (!found) return;
      setActs(norm(found.action_items).map((a) => ({ on: true, text: a.text, owner: a.owner ?? '', due: a.due, at: a.at })));
      setDecs(norm(found.decisions).map((d) => ({ on: true, text: d.text, at: d.at })));
      setQs(norm(found.open_questions).map((q) => ({ on: false, text: q.text, at: q.at })));
      setNotes(norm(found.important_notes));
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
  const raid = !project ? [] : [...qs.map((q, i) => ({ k: `q${i}`, text: q.text, at: q.at })), ...notes.map((n, i) => ({ k: `n${i}`, text: n.text, at: n.at }))]
    .filter((x) => flags[x.k] && x.text.trim()).map((x) => ({ type: flags[x.k], text: x.text.trim().slice(0, 2000), at: atOf(x.at) }));
  const tooMany = sendActs.length + sendQs.length > 50 || sendDecs.length > 50;
  const link = safeUrl(m.url);
  const live = projects.filter((p) => !p.deleted_at && p.status !== 'closed');
  const byKind = (k: string) => live.filter((p) => p.kind === k).sort((a, b) => a.sort - b.sort);

  const patch = <T,>(set: (f: (xs: T[]) => T[]) => void, i: number, p: Partial<T>) => set((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const fail = (e: unknown) => {
    if (e instanceof SignedOut) return;
    if (e instanceof ApiError && e.status === 409) { toast('Already reviewed'); void refreshInbox(); navigate('/meetings'); return; }
    toast((e as Error).message); setBusy(false);
  };
  const accept = async () => {
    if (busy || off || tooMany || !nTasks && !sendDecs.length && !raid.length) return;
    setBusy(true);
    try {
      await api(`/meetings/${m.id}/accept`, { method: 'POST', json: {
        project_id: project || null,
        tasks: [
          ...sendActs.map((a) => ({ text: a.text.trim().slice(0, 300), due: a.due || null, owner: a.owner.trim().slice(0, 200) || null, at: atOf(a.at) })),
          ...sendQs.map((q) => ({ text: `Follow up: ${q.text.trim()}`.slice(0, 300), due: null, owner: null, at: atOf(q.at) })),
        ],
        decisions: sendDecs.map((d) => ({ text: d.text.trim().slice(0, 300), at: atOf(d.at) })),
        raid,
      } });
      const parts = [nTasks && `${nTasks} task${nTasks === 1 ? '' : 's'}`, sendDecs.length && `${sendDecs.length} decision${sendDecs.length === 1 ? '' : 's'}`, raid.length && `${raid.length} RAID item${raid.length === 1 ? '' : 's'}`].filter(Boolean);
      toast(`Added ${parts.join(' and ')}`);
      await pull().catch(() => {});
      void refreshInbox();
      if (!reduce) { setOut(true); await new Promise((r) => setTimeout(r, 450 + 70 * Math.min(nTasks + sendDecs.length, 6))); }
      if (alive.current) navigate(project ? `/projects/${project}` : '/');
    } catch (e) { fail(e); }
  };
  const dismiss = async () => {
    if (busy || off || !await confirmAction('Dismiss this meeting without adding anything?')) return;
    setBusy(true);
    try { await api(`/meetings/${m.id}/dismiss`, { method: 'POST' }); void refreshInbox(); navigate('/meetings'); }
    catch (e) { fail(e); }
  };
  const check = (label: string, on: boolean, change: (b: boolean) => void) => !open ? null :
    <span className="tog"><input type="checkbox" aria-label={label} checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} /><i /></span>;
  const flag = (k: string) => !open ? null : (
    <span className="seg" role="group" aria-label="Log in RAID" style={{ marginLeft: 'auto' }}>
      {(['risk', 'issue'] as const).map((t) => <button type="button" key={t} className={flags[k] === t ? 'on' : ''} aria-pressed={flags[k] === t} disabled={busy || !project} title={project ? undefined : 'Pick a project to log risks and issues'}
        onClick={(e) => { e.preventDefault(); setFlags((f) => { const { [k]: cur, ...rest } = f; return cur === t ? rest : { ...rest, [k]: t }; }); }}>{t === 'risk' ? 'Risk' : 'Issue'}</button>)}
    </span>);
  // a record card in the section's colour; once accepted, the ones that were switched on slide away one after another
  const card = (color: string, on: boolean, i: number, more = '') => ({ className: `acard mcard${more}${out && on ? ' out' : ''}`, style: { ...accent(color), ['--i' as string]: i } as CSSProperties });
  const h2 = { fontSize: 16, margin: '22px 0 10px' } as const;
  const minutes = () => minutesDoc(m, projects.find((x) => x.id === (m.project_id ?? project))?.name ?? null);
  const filed = m.project_id ? projects.find((x) => x.id === m.project_id) ?? null : null;
  const minutesName = fileName('Minutes', m.title, m.received_at.slice(0, 10));
  const minutesWord = async () => {
    try { const { toDocx } = await import('../docs/to-docx.ts'); saveBytes(await toDocx(minutes()), `${minutesName}.docx`, DOCX_TYPE); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <div className="head"><div><div className="eyebrow"><Link to="/meetings">Meetings</Link></div><h1 style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{m.title}</h1>
        <div className="sub">{new Date(m.received_at).toLocaleDateString(undefined, { dateStyle: 'long' })}{!open && ' · Reviewed'}{offline && ' · Offline: reviewing needs a connection'}</div></div>
        {link && <a className="btn" href={link} target="_blank" rel="noopener noreferrer">Open transcript ↗</a>}</div>
      {ser && <div className="row sr-line"><span>Series: <Link to={`/meetings/series/${ser.id}`}>{ser.name}</Link></span>
        <button type="button" className="btn" disabled={off || busy} title={tip} onClick={() => setMoving(true)}>Move</button>
        {open && project && <small className="sub">Accepting it into this project puts it in the project's series.</small>}</div>}
      {moving && createPortal(<MoveToSeries meeting={m} current={ser?.id ?? null} onMoved={(s) => setSer(s)} onClose={() => setMoving(false)} />, document.body)}
      {m.summary && <div className="acard" style={{ ...accent('var(--src-meeting)'), marginTop: 14 }}><p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.summary}</p></div>}

      <h2 style={h2}>Action items</h2>
      {!acts.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>None.</p>}
      <div className="mlist">{acts.map((a, i) => (
        <div key={i} {...card('var(--src-meeting)', a.on, i)}>
          {check(`Add action item ${i + 1}`, a.on, (on) => patch(setActs, i, { on }))}
          {!open ? <div className="txt">{a.text}
            <div className="sub">{[a.owner && `Owner: ${a.owner}`, a.due && `Due ${a.due}`].filter(Boolean).join(' · ')}{a.at && <span className="chip">{a.at}</span>}</div></div> :
          <div className="fields">
            <input className="field" aria-label={`Action item ${i + 1} text`} value={a.text} maxLength={300} disabled={busy} onChange={(e) => patch(setActs, i, { text: e.target.value })} />
            <div className="row" style={{ gap: 6 }}>
              <input className="field" style={{ flex: '1 1 140px', width: 'auto' }} aria-label={`Action item ${i + 1} owner`} placeholder="Owner" value={a.owner} maxLength={200} disabled={busy} onChange={(e) => patch(setActs, i, { owner: e.target.value })} />
              <input className="field" style={{ flex: '0 1 170px', width: 'auto' }} type="date" aria-label={`Action item ${i + 1} due date`} value={a.due} disabled={busy} onChange={(e) => patch(setActs, i, { due: e.target.value })} />
              {a.at && <span className="chip" title="Transcript time">{a.at}</span>}
            </div>
          </div>}
        </div>))}</div>

      <h2 style={h2}>Decisions</h2>
      {!decs.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>None.</p>}
      <div className="mlist">{decs.map((d, i) => (
        <label key={i} {...card('var(--accent)', d.on, i, open ? ' pick' : '')}>
          {check(`Add decision ${i + 1}`, d.on, (on) => patch(setDecs, i, { on }))}
          <span className="txt">{d.text}</span>{d.at && <span className="chip">{d.at}</span>}
        </label>))}</div>

      <h2 style={h2}>Open questions</h2>
      {!qs.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>None.</p>}
      <div className="mlist">{qs.map((q, i) => (
        <label key={i} {...card('var(--warn)', q.on, i, ` wrap${open ? ' pick' : ''}`)}>
          {check(`Add follow-up task for question ${i + 1}`, q.on, (on) => patch(setQs, i, { on }))}
          <span className="txt" style={{ flexBasis: 160 }}>{q.text}</span>{q.at && <span className="chip">{q.at}</span>}
          {flag(`q${i}`)}
        </label>))}</div>
      {qs.length > 0 && open && <div className="sub">Checked questions become "Follow up" tasks.</div>}
      {open && (qs.length > 0 || notes.length > 0) && !project && <div className="sub">Pick a project to log risks and issues</div>}

      {notes.length > 0 && <>
        <h2 style={h2}>Important notes</h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>{notes.map((x, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}><span className="row" style={{ gap: 6 }}><span style={{ flex: '1 1 200px', minWidth: 0 }}>{x.text}{x.at && <> <span className="chip">{x.at}</span></>}</span>{flag(`n${i}`)}</span></li>)}</ul>
      </>}

      <h2 style={h2}>Minutes</h2>
      <div className="row doc-actions">
        <button type="button" className="btn" onClick={() => void minutesWord()}>Word</button>
        <button type="button" className="btn" onClick={() => saveText(toMarkdown(minutes()), `${minutesName}.md`)}>Markdown</button>
        {/* A meeting is work unless it is filed under a personal project; an Offline-only project's minutes go only into a Locked collection (the server checks again). */}
        <SaveToKnowledge label="Add the notes to knowledge" disabled={off} title={tip} side={{ scope: filed?.kind ?? 'work', lockedOnly: filed?.data_boundary === 'offline' }}
          save={(collection_id) => api(`/knowledge/items/from-meeting/${m.id}`, { method: 'POST', json: { collection_id } })} />
        <small className="sub">The meeting as it was received: summary, decisions, actions, questions and notes.</small>
      </div>

      {open && (
        <div className="row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
          <label className="row" style={{ gap: 8, fontSize: 13 }}>Project
            <select className="field" style={{ width: 'auto' }} value={project} disabled={busy} onChange={(e) => setProject(e.target.value)}>
              <option value="">No project</option>
              {(['work', 'personal'] as const).map((k) => byKind(k).length > 0 && <optgroup key={k} label={k === 'work' ? 'Work' : 'Personal'}>{byKind(k).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
            </select></label>
          <div className="row">
            <button type="button" className="btn" disabled={off || busy} title={tip} onClick={() => void dismiss()}>Dismiss</button>
            <button type="button" className="btn primary" disabled={off || busy || tooMany || (!nTasks && !sendDecs.length && !raid.length)} title={tip} onClick={() => void accept()}>
              Accept {nTasks} task{nTasks === 1 ? '' : 's'} and {sendDecs.length} decision{sendDecs.length === 1 ? '' : 's'}{raid.length > 0 && ` and ${raid.length} RAID item${raid.length === 1 ? '' : 's'}`}</button>
          </div>
          {tooMany && <div className="sub" role="status" style={{ width: '100%', justifyContent: 'flex-end' }}>At most 50 at a time</div>}
        </div>
      )}
    </>
  );
}
