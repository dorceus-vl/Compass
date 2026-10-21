import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MeetingReview } from '../../../shared/types.ts';
import { buildAgenda, type SeriesAction, type SeriesDecision, type SeriesQuestion } from '../../../shared/series.ts';
import { toMarkdown } from '../../../shared/to-md.ts';
import { api, SignedOut } from '../api.ts';
import { openTask } from '../inbox.ts';
import { Link, navigate } from '../router.ts';
import { idb } from '../store/db.ts';
import { useStore } from '../store/useStore.ts';
import { TaskSheet } from '../ui/TaskSheet.tsx';
import { toast } from '../ui/dialogs.tsx';
import { accent } from '../ui/colors.ts';
import { DOCX_TYPE, fileName, saveBytes, saveText } from '../docs/download.ts';
import { ASK_KEY, WORK_SEED } from './Athena.tsx';

interface Detail {
  series: { id: string; name: string; project_id: string | null; kind: 'personal' | 'work' };
  meetings: MeetingReview[]; decisions: SeriesDecision[]; actions: SeriesAction[]; questions: SeriesQuestion[];
}
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const h2 = { fontSize: 16, margin: '22px 0 10px' } as const;
const none = (t: string) => <p style={{ color: 'var(--text-faint)', margin: 0 }}>{t}</p>;

export function MeetingSeriesView({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null | undefined>(undefined); // undefined: loading; null: not found
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // a task's sheet
  const [agenda, setAgenda] = useState(false);
  const [busy, setBusy] = useState('');
  const { projects } = useStore();
  useEffect(() => {
    let live = true;
    const key = `cache:series:${id}`;
    (async () => {
      try {
        const r = await api<Detail>(`/meetings/series/${id}`);
        await idb.put('meta', { id: key, ...r, at: new Date().toISOString() }).catch(() => {});
        if (live) { setD(r); setOffline(false); }
      } catch (e) {
        if (e instanceof SignedOut) return;
        const c = await idb.get<Detail>('meta', key).catch(() => undefined); // not found vs. unreachable: a 404 has no cached copy
        if (live) { setD(c ?? null); setOffline(!!c); }
      }
    })();
    return () => { live = false; };
  }, [id]);
  useEffect(() => { // the flag follows the browser
    const f = () => setOffline(!navigator.onLine);
    window.addEventListener('online', f); window.addEventListener('offline', f);
    return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); };
  }, []);

  if (d === undefined) return null;
  if (!d) return <div className="card"><p style={{ margin: 0 }}>Series not found. <Link to="/meetings">Back to meetings</Link></p></div>;
  const off = offline || !navigator.onLine;
  const project = projects.find((p) => p.id === d.series.project_id) ?? null;
  const openQ = d.questions.filter((q) => !q.answered), doneQ = d.questions.filter((q) => q.answered);
  const openA = d.actions.filter((a) => a.status !== 'done'), doneA = d.actions.filter((a) => a.status === 'done');

  const answer = async (q: SeriesQuestion, answered: boolean) => {
    if (off || busy) return;
    setBusy(q.hash);
    try {
      await api(`/meetings/series/${id}`, { method: 'PATCH', json: { answer: { hash: q.hash, answered } } });
      setD((x) => x && { ...x, questions: x.questions.map((y) => (y.hash === q.hash ? { ...y, answered } : y)) });
    } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
    finally { setBusy(''); }
  };
  const question = (q: SeriesQuestion) => (
    <div key={q.hash} className="acard sr-row" style={accent('var(--warn)')}>
      <div className="txt">{q.text}{q.at && <> <span className="chip">{q.at}</span></>}</div>
      <label className="sr-ans">Answered
        <span className="tog"><input type="checkbox" role="switch" aria-label={`Answered: ${q.text}`} checked={q.answered} disabled={off || busy === q.hash} onChange={(e) => void answer(q, e.target.checked)} /><i /></span>
      </label>
    </div>);
  const action = (a: SeriesAction) => (
    <button type="button" key={a.id} className="acard sr-row sr-act" style={accent('var(--src-meeting)')} onClick={() => void openTask(a.id, setOpen)}>
      <span className={`sr-tick${a.status === 'done' ? ' on' : ''}`} aria-hidden="true">{a.status === 'done' ? '✓' : ''}</span>
      <span className="txt"><span className={a.status === 'done' ? 'sr-done' : undefined}>{a.title}</span>
        <small className="sub">{[a.owner && `Owner: ${a.owner}`, a.due_at && `Due ${a.due_at}`, a.status === 'done' && 'Done'].filter(Boolean).join(' · ') || 'No owner or due date'}</small></span>
    </button>);

  return (
    <>
      <div className="head"><div><div className="eyebrow"><Link to="/meetings">Meetings</Link></div><h1 style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{d.series.name}</h1>
        <div className="sub">{d.meetings.length} meeting{d.meetings.length === 1 ? '' : 's'}{project && <> · <Link to={`/projects/${project.id}`}>{project.name}</Link></>}{!project && ' · Not filed'}{off && ' · Offline: showing the last copy'}</div></div>
        <button type="button" className="btn primary" onClick={() => setAgenda(true)}>Prepare next session</button></div>

      <h2 style={h2}>Decisions</h2>
      {!d.decisions.length && none('None yet.')}
      <div className="mlist">{d.decisions.map((x) => (
        <div key={x.id} className="acard sr-row" style={accent('var(--accent)')}>
          <div className="txt">{x.text}</div><span className="chip">{x.decided_at}</span>
        </div>))}</div>

      <h2 style={h2}>Open actions</h2>
      {!openA.length && none(doneA.length ? 'Everything is done.' : 'None. Actions you accept from these meetings appear here.')}
      <div className="mlist">{openA.map(action)}</div>
      {doneA.length > 0 && <details className="sr-more"><summary>Done ({doneA.length})</summary><div className="mlist">{doneA.map(action)}</div></details>}

      <h2 style={h2}>Open questions</h2>
      {!openQ.length && none(doneQ.length ? 'All answered.' : 'None.')}
      <div className="mlist">{openQ.map(question)}</div>
      {doneQ.length > 0 && <details className="sr-more"><summary>Answered ({doneQ.length})</summary><div className="mlist">{doneQ.map(question)}</div></details>}

      <h2 style={h2}>Meetings</h2>
      <div className="mlist">{d.meetings.map((m) => (
        <Link key={m.id} to={`/meetings/${m.id}`} className="acard sr-row" style={{ ...accent('var(--src-meeting)'), color: 'inherit' }}>
          <div className="txt">{m.title}</div><span className="sub">{day(m.received_at)}</span><span className="chip">{m.state === 'new' ? 'New' : 'Reviewed'}</span>
        </Link>))}</div>

      {open && <TaskSheet key={open} taskId={open} onClose={() => setOpen(null)} />}
      {agenda && createPortal(<AgendaDialog d={d} onClose={() => setAgenda(false)} />, document.body)}
    </>
  );
}

/** V9: the agenda, built here from what the page already has. Copy, Markdown and Word are the minutes' own builders; Athena gets it through sessionStorage, never the URL. */
function AgendaDialog({ d, onClose }: { d: Detail; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const doc = buildAgenda(d.series, d.meetings, d.actions, d.decisions, d.questions);
  const md = toMarkdown(doc);
  const name = fileName('Agenda', d.series.name, new Date().toISOString().slice(0, 10));
  const copy = async () => {
    try { await navigator.clipboard.writeText(md); toast('Agenda copied'); } catch { toast("Couldn't copy. Select the text and copy it."); }
  };
  const word = async () => {
    try { const { toDocx } = await import('../docs/to-docx.ts'); saveBytes(await toDocx(doc), `${name}.docx`, DOCX_TYPE); }
    catch (e) { toast((e as Error).message); }
  };
  const ask = () => {
    try { sessionStorage.setItem(ASK_KEY, `Write the agenda for the next session of "${d.series.name}" from these notes. Keep it short, and put what needs a decision first.\n\n${md}`); } catch { /* storage off: Athena opens with an empty box */ }
    dlg.current?.close();
    navigate(`/athena?agenda=${encodeURIComponent(d.series.project_id ?? WORK_SEED)}`);
  };
  return (
    <dialog ref={dlg} className="kn-dlg sr-dlg" onClose={onClose} aria-labelledby="sr-agenda-h">
      <h2 id="sr-agenda-h" style={{ margin: '0 0 6px', fontSize: 19 }}>Prepare next session</h2>
      <p className="sub" style={{ margin: 0 }}>Built on this device from the series: open actions, open questions, the last 3 decisions and the last meeting's notes.</p>
      <pre className="sr-pre" tabIndex={0} aria-label="Agenda text">{md}</pre>
      <div className="row sr-btns">
        <button type="button" className="btn" onClick={() => void copy()}>Copy</button>
        <button type="button" className="btn" onClick={() => saveText(md, `${name}.md`)}>Markdown</button>
        <button type="button" className="btn" onClick={() => void word()}>Word</button>
        <button type="button" className="btn primary" onClick={ask}>Ask Athena to write it</button>
        <button type="button" className="btn" onClick={() => dlg.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}

/** "Move" on a meeting page: another series of the same project (or the unfiled ones), or a new one. The server checks the scope again. */
export function MoveToSeries({ meeting, current, onMoved, onClose }: { meeting: MeetingReview; current: string | null; onMoved: (s: { id: string; name: string }) => void; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState<string>(current ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { dlg.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    api<{ series: { id: string; name: string; project_id: string | null }[] }>('/meetings/series')
      .then((r) => live && setList(r.series.filter((s) => s.project_id === meeting.project_id)))
      .catch(() => live && setList([]));
    return () => { live = false; };
  }, [meeting.project_id]);
  const fresh = pick === '';
  const go = async () => {
    if (busy || (fresh ? !name.trim() : pick === current)) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ series: { id: string; name: string } }>(`/meetings/${meeting.id}/series`, { method: 'POST', json: fresh ? { new_name: name.trim() } : { series_id: pick } });
      onMoved(r.series); toast(`Moved to ${r.series.name}`); dlg.current?.close();
    } catch (e) { if (!(e instanceof SignedOut)) setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <dialog ref={dlg} className="kn-dlg sr-dlg" onClose={onClose} aria-labelledby="sr-move-h">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h2 id="sr-move-h" style={{ margin: '0 0 6px', fontSize: 19 }}>Move to a series</h2>
        <p className="sub" style={{ margin: 0 }}>A meeting stays in the series you pick, even when it is accepted into a project later.</p>
        <fieldset className="kn-set sr-set"><legend>Series</legend>
          {list === null && <p className="sub" role="status">Loading…</p>}
          {(list ?? []).map((s) => (
            <label key={s.id} className={`kn-opt${pick === s.id ? ' on' : ''}`}><input type="radio" name="sr-move" checked={pick === s.id} onChange={() => setPick(s.id)} /><span><b>{s.name}</b>{s.id === current && <small>Current</small>}</span></label>))}
          <label className={`kn-opt${fresh ? ' on' : ''}`}><input type="radio" name="sr-move" checked={fresh} onChange={() => setPick('')} /><span><b>A new series</b>
            <input className="field" aria-label="New series name" placeholder="Series name" maxLength={120} value={name} onFocus={() => setPick('')} onChange={(e) => setName(e.target.value)} /></span></label>
        </fieldset>
        {err && <div className="kn-note" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || (fresh ? !name.trim() : pick === current)}>{busy ? 'Moving…' : 'Move'}</button>
        </div>
      </form>
    </dialog>
  );
}
