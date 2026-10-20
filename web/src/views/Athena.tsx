import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { AiMessage, AiThread, DocumentRow, Project, Provider, Settings } from '../../../shared/types.ts';
import { PRESETS, type PresetId } from '../../../shared/presets.ts';
import { api, ApiError, online, SignedOut } from '../api.ts';
import { ask, loadThread, loadThreads, loadSaved, loadUsage, saveMessage, providerReady, spend, usd, words, type Usage, type SavedMessage } from '../copilot.ts';
import { govCreate } from '../gov.ts';
import { idb } from '../store/db.ts';
import { useStore, createTask } from '../store/useStore.ts';
import { useLibrary } from '../library.ts';
import { BUILTINS } from '../docs/templates.ts';
import { useDocs } from './project/Documents.tsx';
import { Markdown } from '../ui/Markdown.tsx';
import { splitAttachments } from '../../../shared/attachments.ts';
import { Icon } from '../ui/Shell.tsx';
import { Highlight } from './Library.tsx';
import { Link, navigate } from '../router.ts';
import { toast } from '../ui/dialogs.tsx';
import { fmtDue, today } from '../dates.ts';
import { athenaGreeting, dueItems } from '../athena-greeting.ts';
import { AthenaAvatar, type AthenaState } from '../ui/AthenaAvatar.tsx';
import { micSupported, primeAudio, speakAnswer, stopSpeech, useAthenaVoice, useMic, useSpeech, type MicPhase } from '../athena-voice.ts';

const NAME: Record<Provider, string> = { claude: 'Claude', gemini: 'Gemini' };
const OTHER: Record<Provider, Provider> = { claude: 'gemini', gemini: 'claude' };
const when = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

export function useUsage() {
  const [usage, set] = useState<Usage | null>(null);
  const refresh = useCallback(() => { loadUsage().then(set).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { usage, refresh };
}

// ---------------------------------------------------------------- thread list
function Threads({ projectId, openId, onOpen, rev }: { projectId?: string; openId: string | null; onOpen: (id: string) => void; rev: number }) {
  const { projects } = useStore();
  const [threads, set] = useState<AiThread[] | null>(null);
  const [filter, setFilter] = useState('all');
  useEffect(() => { loadThreads(projectId).then(set).catch(() => set([])); }, [projectId, rev]);
  const name = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? 'Project' : 'Personal');
  const shown = (threads ?? []).filter((t) => filter === 'all' || (filter === 'none' ? !t.project_id : t.project_id === filter));
  return (
    <div className="cp-threads">
      {!projectId && <select className="field" aria-label="Filter by project" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">All projects</option><option value="none">Personal (no project)</option>
        {projects.filter((p) => !p.deleted_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      {threads && !shown.length && <p className="sub" style={{ margin: 0 }}>No conversations yet.</p>}
      {shown.map((t) => (
        <button type="button" key={t.id} className="cp-item" aria-current={openId === t.id ? 'true' : undefined} onClick={() => onOpen(t.id)}>
          <b>{t.title}</b><small>{projectId ? '' : `${name(t.project_id)} · `}{when(t.updated_at)}</small>
        </button>))}
    </div>
  );
}

// ---------------------------------------------------------------- proposals
type Row = { key: string; group: 'task' | 'raid' | 'decision'; text: string; chips: string[]; noun: string };
function ProposalsPanel({ m, project }: { m: AiMessage; project: Project | null }) {
  const pr = m.proposals!;
  const rows: Row[] = [
    ...pr.tasks.map((t, i): Row => ({ key: `t${i}`, group: 'task', text: t.title, chips: [t.horizon, ...(t.due_at ? [fmtDue(t.due_at).text || t.due_at] : [])], noun: 'task' })),
    ...pr.raid.map((r, i): Row => ({ key: `r${i}`, group: 'raid', text: r.text, chips: [r.type, ...(r.probability && r.impact ? [`P${r.probability} × I${r.impact}`] : [])], noun: r.type })),
    ...pr.decisions.map((d, i): Row => ({ key: `d${i}`, group: 'decision', text: d.text, chips: ['decision'], noun: 'decision' })),
  ];
  const [ticked, setTicked] = useState(() => new Set(rows.map((r) => r.key)));
  const [added, setAdded] = useState<string[] | null>(null); // null until the saved copy is read, so a reload never offers an add twice
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]); // titles of the items the last add could not create
  const mark = `copilot:added:${m.id}`;
  useEffect(() => { void idb.get<{ keys: string[] }>('meta', mark).then((r) => setAdded(r?.keys ?? [])).catch(() => setAdded([])); }, [mark]);
  const gate = !project ? 'Pick a project to log these' : !online() ? 'Log these when you are back online' : '';
  const usable = (r: Row) => r.group === 'task' || !gate;
  if (!added) return null;
  const todo = rows.filter((r) => !added.includes(r.key));
  const picked = todo.filter((r) => ticked.has(r.key) && usable(r));
  const add = async () => {
    setBusy(true);
    const done = [...added], miss: string[] = [];
    try {
      for (const r of picked) {
        const i = Number(r.key.slice(1));
        let ok = false;
        try {
          if (r.group === 'task') {
            const t = pr.tasks[i];
            await createTask({ title: t.title, horizon: t.horizon, due_at: t.due_at, project_id: project?.id ?? null, kind: project?.kind ?? 'personal' });
            ok = true;
          } else if (r.group === 'raid') {
            const x = pr.raid[i];
            ok = !!(await govCreate(project!.id, 'raid', { type: x.type, text: x.text, ...(x.probability ? { probability: x.probability } : {}), ...(x.impact ? { impact: x.impact } : {}) }));
          } else ok = !!(await govCreate(project!.id, 'decisions', { text: pr.decisions[i].text, decided_at: today() }));
        } catch { /* counted as failed below */ }
        if (!ok) { miss.push(r.text); continue; }
        // Marked as soon as it exists, so a retry after a later failure never adds it twice.
        done.push(r.key);
        setAdded([...done]);
        await idb.put('meta', { id: mark, keys: [...done] }).catch(() => {});
      }
    } finally {
      setFailed(miss);
      setBusy(false);
    }
  };
  const counts = new Map<string, number>();
  for (const r of rows) if (added.includes(r.key)) counts.set(r.noun, (counts.get(r.noun) ?? 0) + 1);
  const summary = [...counts].map(([n, c]) => `${c} ${n}${c === 1 ? '' : 's'}`).join(', ');
  return (
    <div className="cp-prop">
      {todo.length > 0 && <>
        <div className="eyebrow">Proposed for the board</div>
        {todo.map((r) => (
          <label key={r.key} className={`tap cp-prop-row${ticked.has(r.key) && usable(r) ? ' on' : ''}`}>
            <input type="checkbox" checked={ticked.has(r.key) && usable(r)} disabled={!usable(r) || busy}
              onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} />
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{r.text}</span>
            <span className="row" style={{ gap: 4 }}>{r.chips.map((c) => <span key={c} className="chip">{c}</span>)}</span>
          </label>))}
        {gate && todo.some((r) => !usable(r)) && <small className="sub" role="note">{gate}</small>}
        {failed.length > 0 && <small className="sub" role="alert">Not added, try again: {failed.join('; ')}</small>}
        <div><button type="button" className="btn primary" disabled={!picked.length || busy} onClick={() => void add()}>Add to the board</button></div>
      </>}
      {summary && <div className="chip ok" role="status" style={{ justifySelf: 'start' }}>Added: {summary}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- offline mode
function OfflinePanel({ text, reason, project }: { text: string; reason: string; project: Project | null }) {
  const { find, ready } = useLibrary();
  const { docs } = useDocs(null);
  const [saved, setSaved] = useState<SavedMessage[]>([]);
  useEffect(() => { loadSaved().then(setSaved).catch(() => {}); }, []);
  const ws = words(text);
  const hits = text.trim() ? find(text, 5) : [];
  const match = (n: string) => ws.some((w) => n.toLowerCase().includes(w));
  const templates = [...BUILTINS.filter((b) => match(b.name)).map((b) => ({ key: b.id, name: b.name })),
    ...docs.filter((d) => d.is_template && match(d.name)).map((d) => ({ key: d.id, name: d.name }))];
  const to = project ? `/projects/${project.id}/report` : '/projects';
  const answers = saved.filter((s) => ws.some((w) => s.content.toLowerCase().includes(w))).slice(0, 5);
  return (
    <div className="card cp-off">
      <b>{reason}</b>
      <div className="eyebrow">Library</div>
      {hits.length ? <div className="lib-list">{hits.map(({ page, snippet }) => (
        <Link key={page.slug} to={`/library/${page.slug}`} className="card lib-hit" style={{ padding: 12 }}><b>{page.title}</b><p><Highlight text={snippet} q={text} /></p></Link>))}</div>
        : <p className="sub" style={{ margin: 0 }}>{ready ? 'Nothing in the library matches.' : 'Loading the library…'}</p>}
      <div className="eyebrow">Templates</div>
      {templates.length ? <div className="row">{templates.map((t) => <Link key={t.key} to={to} className="chip" title={project ? 'Open the Report tab' : 'Pick a project, then open its Report tab'}>{t.name}</Link>)}</div> : <p className="sub" style={{ margin: 0 }}>No template names match.</p>}
      <div className="eyebrow">Saved answers</div>
      {answers.length ? <div className="lib-list">{answers.map((s) => (
        <Link key={s.id} to={`/athena/${s.thread_id}`} className="card lib-hit" style={{ padding: 12 }}><b>{s.thread_title}</b><p>{s.content.slice(0, 200)}</p></Link>))}</div>
        : <p className="sub" style={{ margin: 0 }}>No saved answers match.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- one answer
const SHORTER = 'Make that shorter, same facts.';
/** The answer as plain text for the clipboard; the stored text has no compass-meta block, and a stray one is dropped. */
const copyText = (content: string) => content.replace(/\n?```compass-meta[\s\S]*$/, '').trim();
async function copy(m: AiMessage) {
  try { await navigator.clipboard.writeText(copyText(m.content)); toast('Copied'); }
  catch { toast('Copy is blocked here: select the text instead'); }
}
/** Why her voice didn't play, as a toast (the server's own sentence for voice_off, Offline only, the cap or the hourly limit). */
const voiceErr = (e: unknown) => {
  if (e instanceof SignedOut) return;
  toast(e instanceof ApiError ? e.message : (e as Error).name === 'NotAllowedError' ? 'Tap "Read it aloud" to hear her.' : "Couldn't play her voice. Try again.");
};
/** "Read it aloud" (or stop): the tap primes the audio element so iOS lets it play once the audio arrives. */
const readAloud = (id: string, playing: boolean) => {
  if (playing) { stopSpeech(); return; }
  stopSpeech(); primeAudio();
  speakAnswer(id).catch(voiceErr);
};

function Answer({ m, project, onSave, onOther, onShorter }: { m: AiMessage; project: Project | null; onSave: () => void; onOther: false | (() => void); onShorter: false | (() => void) }) {
  const { pages } = useLibrary();
  const speech = useSpeech(), mine = speech?.id === m.id;
  const p = m.provider ?? 'claude';
  return (
    <article className="card cp-msg ath-msg" aria-label={`Answer from ${NAME[p]}`}>
      <div className="ath-who"><span className="ath-av" aria-hidden="true">A</span>Athena</div>
      <Markdown text={m.content} />
      {m.citations.length > 0 && <div className="row">{m.citations.map((s) => <Link key={s} to={`/library/${s}`} className="chip cite"><Icon name="library" />{pages.find((x) => x.slug === s)?.title ?? s}</Link>)}</div>}
      {m.proposals && <ProposalsPanel m={m} project={project} />}
      <div className="row ath-tools" role="group" aria-label="Answer tools">
        <button type="button" className="ath-tool" onClick={() => void copy(m)}>Copy</button>
        <button type="button" className="ath-tool" aria-pressed={mine} disabled={project?.data_boundary === 'offline'} onClick={() => readAloud(m.id, mine)}>
          {mine ? (speech.phase === 'loading' ? 'Loading…' : 'Stop reading') : 'Read it aloud'}</button>
        {onShorter && <button type="button" className="ath-tool" onClick={onShorter}>Make it shorter</button>}
        <button type="button" className="ath-tool" aria-pressed={!!m.saved} aria-label={m.saved ? 'Unsave this answer' : 'Save this answer'} onClick={onSave}>{m.saved ? '★ Saved' : '☆ Save'}</button>
        {onOther && <button type="button" className="ath-tool" onClick={onOther}>Ask {NAME[OTHER[p]]} too</button>}
      </div>
      <small className="sub">{NAME[p]} · {usd(m.cost_micro, 4)}</small>
    </article>
  );
}

// ---------------------------------------------------------------- her greeting (built on the device, no model call)
function Greeting({ projectId, projectName }: { projectId?: string; projectName?: string }) {
  const { tasks, projects } = useStore();
  const t = today();
  const text = athenaGreeting(new Date().getHours(), dueItems(tasks, projects, t, projectId), t, projectName ? ` in ${projectName}` : '');
  return <div className="ath-her"><span className="ath-av" aria-hidden="true">A</span><div><div className="ath-who">Athena</div><p>{text}</p></div></div>;
}

// ---------------------------------------------------------------- conversation + composer
/** Text for the composer, handed over by the command palette (a module variable, so it never sits in a URL). */
let prefill = '';
const ASK = 'compass:ask';
export function askCopilot(text: string) {
  prefill = text;
  const here = location.pathname.startsWith('/athena');
  navigate('/athena/new');
  if (here) window.dispatchEvent(new Event(ASK)); // a composer that is already open takes it; a new one reads it on mount
}

// The four one-tap helps (presets from shared/presets.ts); an empty box shows the card's own prompt.
const CARDS: { id: PresetId; icon: string; hint: string; empty: string }[] = [
  { id: 'rephrase_email', icon: 'mail', hint: 'Clear, firm, still friendly', empty: 'Paste the email…' },
  { id: 'executive_version', icon: 'bars', hint: 'Decision first, sized for a VP', empty: 'Paste your status notes or attach them…' },
  { id: 'optimize_spreadsheet', icon: 'sheet', hint: 'Formulas, errors, speed', empty: 'Attach the spreadsheet…' },
  { id: 'review_document', icon: 'doc', hint: 'Any file: gaps, risks, next steps', empty: 'Attach the document…' },
];
const MORE = PRESETS.filter((p) => !CARDS.some((c) => c.id === p.id));
const TYPES = ['DOCX', 'PDF', 'XLSX', 'CSV', 'PPTX', 'MD', 'TXT', 'PNG/JPG'];
const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.csv,.md,.txt,.png,.jpg,.jpeg';
const MAX_FILES = 3;
type Att = { id: string; name: string };
type Err = { message: string; again: 'send' | Provider };
type Run = { message: string; preset?: PresetId; docs: Att[]; shorter?: boolean };

function Conversation({ id, projectId, page, usage, speakOn, onOpen, onSent, onBusy, onMic }: {
  id: string | null; projectId?: string; page?: string; usage: Usage | null; speakOn: boolean; onOpen: (id: string | null, replace?: boolean) => void;
  onSent: (answerId?: string) => void; onBusy: (b: boolean) => void; onMic: (p: MicPhase) => void;
}) {
  const { projects } = useStore();
  const [thread, setThread] = useState<AiThread | null>(null);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState(() => prefill || (page ? `About [[${page}]]: ` : ''));
  useEffect(() => {
    prefill = ''; // taken by the initial state above
    const take = () => { if (prefill) { setText(prefill); prefill = ''; } };
    window.addEventListener(ASK, take);
    return () => window.removeEventListener(ASK, take);
  }, []);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [sel, setSel] = useState('');
  const [provider, setProvider] = useState<Provider>('claude');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ text: string; docs: Att[] } | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [off, setOff] = useState<string | null>(null);
  const [att, setAtt] = useState<Att[]>([]);
  const [attErr, setAttErr] = useState('');
  const [up, setUp] = useState(false);
  const [over, setOver] = useState(false);
  const cur = useRef<string | null>(null), picked = useRef(false), box = useRef<HTMLDivElement>(null), follow = useRef(false), ta = useRef<HTMLTextAreaElement>(null), last = useRef<Run | null>(null);
  const [live, setLive] = useState(''); // the one polite live region: what is happening, announced to screen readers
  const refocus = () => ta.current?.focus();
  useEffect(() => onBusy(busy), [busy, onBusy]);
  // The mic: its text goes into the box (never sent on its own); the stage shows her listening while it records.
  const mic = useMic((t) => { setText((x) => (x.trim() ? `${x.trimEnd()} ${t}` : t)); setLive('Transcript added to the box'); refocus(); }, (msg) => { setAttErr(msg); setLive(msg); });
  useEffect(() => onMic(mic.phase), [mic.phase, onMic]);
  const touch = useRef(false);
  const startMic = () => {
    setAttErr('');
    if (!online()) { setAttErr('The mic needs a connection.'); return; }
    mic.start();
  };

  // Load the thread when the route points at another one; the thread this component just created is already in state.
  useEffect(() => {
    if (id === cur.current) return;
    cur.current = id; setPending(null); setErr(null); setOff(null); setAtt([]); setAttErr('');
    if (!id) { setThread(null); setMsgs([]); setMissing(false); return; }
    let live = true;
    loadThread(id).then((r) => { if (live) { setThread(r.thread); setMsgs(r.messages); setMissing(false); } }).catch(() => live && setMissing(true));
    return () => { live = false; };
  }, [id]);
  useEffect(() => { api<Settings>('/settings').then((s) => { if (!picked.current) setProvider(s.default_provider); }).catch(() => {}); }, []);
  // After a send, bring the newest thing (the question, the typing dots, the answer) to the top of the view; loading a thread does not scroll.
  useEffect(() => { if (follow.current) box.current?.lastElementChild?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [msgs.length, pending, err, off]);

  const projSel = projectId ?? (thread ? thread.project_id ?? '' : sel);
  const project = projects.find((p) => p.id === projSel) ?? null;
  const prov = providerReady(usage, provider) ? provider : OTHER[provider];
  const card = CARDS.find((c) => c.id === preset);
  const more = MORE.find((p) => p.id === preset);
  const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
  const lastAnswer = msgs.length - 1;

  const fail = (e: unknown, again: Err['again']) => {
    if (e instanceof ApiError && e.code === 'offline_boundary') showOff('Offline only: nothing leaves Compass for this project.');
    else { const message = e instanceof ApiError ? e.message : "Couldn't reach Compass. Check your connection and try again."; setErr({ message, again }); setLive(message); }
  };
  const showOff = (reason: string) => { setOff(reason); setLive(`${reason} Results are below.`); };

  /** One turn: a question (with its preset and files) or the "make it shorter" follow-up. */
  const run = async (r: Run) => {
    if (busy || up) return;
    last.current = r;
    setErr(null); follow.current = true;
    if (project?.data_boundary === 'offline') { showOff('Offline only: nothing leaves Compass for this project.'); refocus(); return; }
    if (!online()) { showOff('No connection: nothing was sent. This is what Compass has on this device.'); refocus(); return; }
    if (speakOn) { stopSpeech(); primeAudio(); } // still inside the tap: iOS lets her answer play when it arrives
    setOff(null); setBusy(true); setPending({ text: r.message, docs: r.docs }); setLive('Athena is answering…');
    try {
      const a = await ask(r.shorter
        ? { thread_id: thread!.id, provider: prov, message: r.message }
        : { thread_id: thread?.id, project_id: thread ? undefined : projSel || undefined, provider: prov, message: r.message, preset: r.preset, page: thread ? undefined : page, ...(r.docs.length ? { document_ids: r.docs.map((d) => d.id) } : {}) });
      cur.current = a.thread.id;
      setThread(a.thread); setMsgs((x) => [...x, ...a.messages]); setMissing(false);
      if (!r.shorter) { setText(''); setPreset(null); setAtt([]); }
      if (!id) onOpen(a.thread.id, true);
      onSent(a.messages.at(-1)?.id); setLive('Answer ready');
    } catch (e) { fail(e, 'send'); }
    finally { setBusy(false); setPending(null); refocus(); }
  };
  const message = () => text.trim() || (att.length ? `Please help with the attached ${att.length > 1 ? 'files' : 'file'}.` : '');
  const send = (p: PresetId | null = preset) => { const m = message(); if (m) void run({ message: m, preset: p ?? undefined, docs: att }); };
  const pickCard = (cid: PresetId) => { if (message()) send(cid); else { setPreset(preset === cid ? null : cid); refocus(); } };
  const askToo = async (p: Provider) => {
    if (!thread || busy) return;
    setErr(null); setBusy(true); follow.current = true; setLive('Athena is answering…');
    if (speakOn) { stopSpeech(); primeAudio(); }
    try { const r = await ask({ thread_id: thread.id, provider: p, rerun: true }); setMsgs((x) => [...x, ...r.messages]); onSent(r.messages.at(-1)?.id); setLive('Answer ready'); }
    catch (e) { fail(e, p); }
    finally { setBusy(false); refocus(); }
  };
  const save = async (m: AiMessage) => {
    try { const n = await saveMessage(m.id, !m.saved); setMsgs((x) => x.map((y) => (y.id === n.id ? n : y))); }
    catch (e) { toast((e as Error).message); }
  };

  // Files go through the documents upload (filed to this project, or unfiled while the thread is personal) and come back as chips.
  const attach = async (list: FileList | File[] | null | undefined) => {
    const files = list ? [...list] : [];
    if (!files.length || up) return;
    setAttErr('');
    if (!online()) { setAttErr('Attaching needs a connection.'); return; }
    if (project?.data_boundary === 'offline') { setAttErr('Offline only: files for this project stay out of Athena.'); return; }
    if (projSel.startsWith('tmp-')) { setAttErr("This project isn't on the server yet. Try again in a moment."); return; }
    const room = MAX_FILES - att.length;
    if (room <= 0 || files.length > room) setAttErr(`Athena reads up to ${MAX_FILES} files in a message.`);
    const limit = project?.kind === 'work' ? 10 : 20;
    setUp(true); setLive('Attaching…');
    try {
      for (const f of files.slice(0, Math.max(room, 0))) {
        if (f.size > limit * 1024 * 1024) { setAttErr(`${f.name} is over ${limit} MB.`); continue; }
        const fd = new FormData();
        fd.append('file', f);
        if (projSel) fd.append('project_id', projSel);
        const { document: d } = await api<{ document: DocumentRow }>('/documents', { method: 'POST', body: fd });
        setAtt((x) => [...x, { id: d.id, name: d.name }]);
        setLive(`${d.name} attached`);
      }
    } catch (e) { if (!(e instanceof SignedOut)) setAttErr((e as Error).message); }
    finally { setUp(false); }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void attach(e.dataTransfer.files); };

  if (missing) return <div className="card"><p style={{ margin: 0 }}>This conversation isn't available. <Link to="/athena">Back to Athena</Link></p></div>;
  const canSend = !!message() && !busy && !up;
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</div>
      <section className={`ath-compose${over ? ' over' : ''}`} aria-label="Ask Athena"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }} onDrop={drop}>
        <label className="eyebrow" htmlFor="ath-ask">Ask Athena, or drop a file here</label>
        <textarea id="ath-ask" ref={ta} className="field" rows={3} value={text} maxLength={8000}
          placeholder={card ? card.empty : more ? more.prompt : 'Paste an email, a status paragraph, or ask a question…'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } }} />
        {(att.length > 0 || up) && <div className="row" aria-label="Attached files">
          {att.map((a) => <span key={a.id} className="chip file">{a.name}
            <button type="button" className="x" aria-label={`Remove ${a.name}`} onClick={() => setAtt((x) => x.filter((y) => y.id !== a.id))}>✕</button></span>)}
          {up && <span className="chip file" role="status">Attaching…</span>}</div>}
        {attErr && <small className="sub ath-err" role="alert">{attErr}</small>}
        <div className="row ath-meta">
          {projectId || thread
            ? <div className="chip cp-lock" aria-label="Project">
                <Icon name="lock" /><b>{projects.find((p) => p.id === projSel)?.name ?? 'None (personal)'}</b>
                <small>{thread ? 'stays with this conversation' : 'this project'}</small></div>
            : <select className="field" style={{ flex: '1 1 180px', width: 'auto' }} aria-label="Project" value={projSel} disabled={up}
                onChange={(e) => { setSel(e.target.value); if (att.length) { setAtt([]); setAttErr('Files belong to one project, so attach them again.'); } }}>
                <option value="">None (personal)</option>{projects.filter((p) => !p.deleted_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <div className="seg" role="group" aria-label="Provider">
            {(['claude', 'gemini'] as const).map((p) => <button type="button" key={p} className={prov === p ? 'on' : ''} aria-pressed={prov === p} disabled={!providerReady(usage, p)}
              onClick={() => { picked.current = true; setProvider(p); }}>{NAME[p]}</button>)}</div>
        </div>
        {(['claude', 'gemini'] as const).some((p) => !providerReady(usage, p)) && <small className="sub">Not set up: see Settings → AI ({(['claude', 'gemini'] as const).filter((p) => !providerReady(usage, p)).map((p) => NAME[p]).join(', ')})</small>}
        {project?.data_boundary === 'offline' && <small className="sub">Offline only: Send searches Compass instead of asking a model.</small>}
        <div className="ath-crow">
          <div className="ath-types" aria-label="Files Athena reads">{TYPES.map((t) => <span key={t}>{t}</span>)}</div>
          <div className="ath-btns">
            <label className="ath-icon" title="Attach a file">
              <Icon name="clip" /><span className="sr-only">Attach a file</span>
              <input type="file" multiple className="sr-only" accept={ACCEPT} disabled={up || busy} onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} /></label>
            {micSupported() && <button type="button" className="ath-icon mic" aria-pressed={mic.phase === 'rec' || mic.phase === 'starting'}
              aria-label={mic.phase === 'off' ? 'Talk to Athena' : mic.phase === 'busy' ? 'Writing down what you said' : 'Stop listening'} title="Hold to talk, or click to start and stop"
              disabled={busy || mic.phase === 'busy' || project?.data_boundary === 'offline'}
              onPointerDown={(e) => { touch.current = e.pointerType !== 'mouse'; if (touch.current) { e.preventDefault(); startMic(); } }}
              onPointerUp={() => { if (touch.current) mic.stop(); }} onPointerCancel={() => { if (touch.current) mic.stop(); }}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => { if (touch.current) { touch.current = false; return; } if (mic.phase === 'off') startMic(); else mic.stop(); }}>
              <Icon name="mic" /></button>}
            <button type="button" className="ath-icon send" aria-label="Send" disabled={!canSend} onClick={() => send()}><Icon name="send" /></button>
          </div>
        </div>
        <small className="sub">{mic.phase === 'rec' || mic.phase === 'starting' ? (touch.current ? 'Listening… let go to finish.' : 'Listening… click the mic to finish.') : mic.phase === 'busy' ? 'Writing down what you said…' : '⌘↵ to send'}</small>
      </section>

      <section aria-labelledby="ath-or" className="ath-help">
        <div className="eyebrow" id="ath-or">Or start with</div>
        <div className="ath-cards" role="group" aria-label="Quick help">
          {CARDS.map((c) => { const p = PRESETS.find((x) => x.id === c.id)!; return (
            <button type="button" key={c.id} className="ath-card" aria-pressed={preset === c.id} onClick={() => pickCard(c.id)}>
              <i><Icon name={c.icon} /></i><b>{p.label}</b><small>{c.hint}</small></button>); })}
        </div>
        <div className="eyebrow">More</div>
        <div className="row" role="group" aria-label="More presets">
          {MORE.map((p) => <button type="button" key={p.id} className={`chip ath-more ${preset === p.id ? 'on' : ''}`} aria-pressed={preset === p.id} onClick={() => setPreset(preset === p.id ? null : p.id)}>{p.label}</button>)}</div>
      </section>

      <section aria-label="Athena's answer" className="ath-answer">
        <div className="row cp-top">
          <div className="eyebrow">Athena's answer</div>
          {thread && <><span className="ath-title">{thread.title}</span><span className="chip">{thread.project_id ? projects.find((p) => p.id === thread.project_id)?.name ?? 'Project' : 'Personal'}</span></>}
        </div>
        <div className="cp-msgs" ref={box}>
          {!id && !thread && !pending && !off && <Greeting projectId={projectId} projectName={projectId ? project?.name : undefined} />}
          {msgs.map((m, i) => { const s = m.role === 'user' ? splitAttachments(m.content) : null; return s
            ? <div key={m.id} className="cp-user">{s.text}{s.attachments.length > 0 && <div className="row">{s.attachments.map((a) => <span key={a.id} className="chip file">{a.name}</span>)}</div>}</div>
            : <Answer key={m.id} m={m} project={project} onSave={() => void save(m)}
                onShorter={i === lastAnswer && !busy && lastUser >= 0 && (() => void run({ message: SHORTER, docs: [], shorter: true }))}
                onOther={i === lastAnswer && !busy && lastUser >= 0 && providerReady(usage, OTHER[m.provider ?? 'claude'])
                  && !msgs.slice(lastUser).some((y) => y.role === 'assistant' && y.provider === OTHER[m.provider ?? 'claude']) && (() => void askToo(OTHER[m.provider ?? 'claude']))} />; })}
          {pending && <div className="cp-user">{pending.text}{pending.docs.length > 0 && <div className="row">{pending.docs.map((a) => <span key={a.id} className="chip file">{a.name}</span>)}</div>}</div>}
          {busy && <div className="cp-typing" aria-hidden="true"><i /><i /><i /></div>}
          {err && <div className="card cp-err"><span>{err.message}</span>
            <button type="button" className="btn" onClick={() => void (err.again === 'send' ? (last.current && run(last.current)) : askToo(err.again))}>Retry</button></div>}
          {off && <OfflinePanel text={text} reason={off} project={project} />}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- the stage (left) and the room: used by the screen and the project tab
function Stage({ state, onStop }: { state: AthenaState; onStop?: () => void }) {
  return (
    <section className="ath-stage" aria-label="Athena">
      <div className="ath-face">
        <AthenaAvatar state={state} size="stage" />
        {onStop && <button type="button" className="ath-hush" aria-label="Stop Athena speaking" onClick={onStop} />}
      </div>
      <div className="ath-plate">
        <div><b>Athena</b><span>Project counsel</span></div>
        <ul className="ath-traits"><li>Colleague</li><li>Rigorous PM</li><li>Mentor</li></ul>
      </div>
    </section>
  );
}

export function Workspace({ projectId, openId, onOpen, page, usage, refreshUsage }: {
  projectId?: string; openId: string | null; onOpen: (id: string | null, replace?: boolean) => void; page?: string; usage: Usage | null; refreshUsage: () => void;
}) {
  const [rev, setRev] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [mic, setMic] = useState<MicPhase>('off');
  const [speaking, setSpeaking] = useState(false); // ruling A7: 4 s after an answer arrives when her voice is off; with it on, the audio's own length
  const talk = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { clearTimeout(talk.current); stopSpeech(); }, []);
  const [voice] = useAthenaVoice();
  const speakOn = !!voice?.speak_answers && !!voice.voice_id;
  const speech = useSpeech();
  const answered = (answerId?: string) => {
    clearTimeout(talk.current); setSpeaking(false);
    if (speakOn && answerId) { speakAnswer(answerId).catch(voiceErr); return; }
    setSpeaking(true); talk.current = setTimeout(() => setSpeaking(false), 4000);
  };
  const hush = () => { stopSpeech(); clearTimeout(talk.current); setSpeaking(false); };
  const state: AthenaState = mic === 'rec' || mic === 'starting' ? 'listening'
    : thinking || mic === 'busy' || speech?.phase === 'loading' ? 'thinking'
    : speech?.phase === 'playing' || speaking ? 'speaking' : 'idle';
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { loadThreads(projectId).then((t) => setN(t.length)).catch(() => {}); }, [projectId, rev]);
  return (
    <div className={`ath${projectId ? ' ath-project' : ''}`}>
      {!projectId && <Stage state={state} onStop={speech || speaking ? hush : undefined} />}
      <div className="ath-main">
        <Conversation id={openId && openId !== 'new' ? openId : null} projectId={projectId} page={page} usage={usage} speakOn={speakOn} onOpen={onOpen} onBusy={setThinking} onMic={setMic}
          onSent={(answerId) => { setRev((x) => x + 1); refreshUsage(); answered(answerId); }} />
        <details className="ath-threads" open={!!projectId || undefined}>
          <summary>Conversations{n ? ` (${n})` : ''}</summary>
          <button type="button" className="btn primary" onClick={() => onOpen('new')}>New conversation</button>
          <Threads projectId={projectId} openId={openId} onOpen={onOpen} rev={rev} />
        </details>
      </div>
    </div>
  );
}

export const SpendChip = ({ usage }: { usage: Usage | null }) => usage
  ? <span className={`chip ${usage.month_cost_micro >= usage.cap_micro ? 'danger' : ''}`} title="AI spend this month, against the monthly cap">This month: {spend(usage)}</span> : null;

/** "Speak answers" on the screen's header (the same setting as Settings → Athena); off until her voice is picked. */
function SpeakSwitch() {
  const [v, setSpeak] = useAthenaVoice();
  if (!v) return null;
  const ready = !!v.voice_id;
  return (
    <label className="ath-voice" title={ready ? undefined : 'Pick her voice in Settings → Athena first'}>Speak answers
      <span className="tog"><input type="checkbox" role="switch" aria-label="Speak Athena's answers" checked={ready && v.speak_answers} disabled={!ready}
        onChange={(e) => { const on = e.target.checked; if (!on) stopSpeech(); setSpeak(on).catch((x) => toast((x as Error).message)); }} /><i /></span>
    </label>
  );
}

export function AthenaView({ id }: { id?: string }) {
  const { usage, refresh } = useUsage();
  const page = new URLSearchParams(location.search).get('page') ?? undefined;
  return (
    <>
      <div className="head"><div><div className="eyebrow">Counsel</div><h1 style={{ marginTop: 6 }}><b>Athena</b></h1>
        <div className="sub">Your PM colleague. Bring her an email, a status update, a spreadsheet or any document; answers cite the library, and nothing reaches the board until you add it.</div></div>
        <div className="row ath-headr"><SpeakSwitch /><SpendChip usage={usage} /></div></div>
      <Workspace openId={id ?? null} page={page} usage={usage} refreshUsage={refresh} onOpen={(to, replace) => navigate(to === null ? '/athena' : `/athena/${to}`, replace)} />
    </>
  );
}
