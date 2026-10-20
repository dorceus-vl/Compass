import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiMessage, AiThread, Project, Provider, Settings } from '../../../shared/types.ts';
import { PRESETS, type PresetId } from '../../../shared/presets.ts';
import { api, ApiError, online } from '../api.ts';
import { ask, loadThread, loadThreads, loadSaved, loadUsage, saveMessage, providerReady, spend, usd, words, type Usage, type SavedMessage } from '../copilot.ts';
import { govCreate } from '../gov.ts';
import { idb } from '../store/db.ts';
import { useStore, createTask } from '../store/useStore.ts';
import { useLibrary } from '../library.ts';
import { BUILTINS } from '../docs/templates.ts';
import { useDocs } from './project/Documents.tsx';
import { Markdown } from '../ui/Markdown.tsx';
import { Icon } from '../ui/Shell.tsx';
import { Highlight } from './Library.tsx';
import { Link, navigate } from '../router.ts';
import { toast } from '../ui/dialogs.tsx';
import { fmtDue, today } from '../dates.ts';

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
function Answer({ m, project, onSave, onOther }: { m: AiMessage; project: Project | null; onSave: () => void; onOther: false | (() => void) }) {
  const { pages } = useLibrary();
  const p = m.provider ?? 'claude';
  return (
    <article className="card cp-msg" aria-label={`Answer from ${NAME[p]}`}>
      <Markdown text={m.content} />
      {m.citations.length > 0 && <div className="row">{m.citations.map((s) => <Link key={s} to={`/library/${s}`} className="chip cite"><Icon name="library" />{pages.find((x) => x.slug === s)?.title ?? s}</Link>)}</div>}
      {m.proposals && <ProposalsPanel m={m} project={project} />}
      <div className="row cp-foot">
        <small className="sub">{NAME[p]} · {usd(m.cost_micro, 4)}</small>
        <button type="button" className="btn" aria-pressed={!!m.saved} aria-label={m.saved ? 'Unsave this answer' : 'Save this answer'} onClick={onSave}>{m.saved ? '★ Saved' : '☆ Save'}</button>
        {onOther && <button type="button" className="btn" onClick={onOther}>Ask {NAME[OTHER[p]]} too</button>}
      </div>
    </article>
  );
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
type Err = { message: string; again: 'send' | Provider };
function Conversation({ id, projectId, page, usage, onOpen, onSent }: {
  id: string | null; projectId?: string; page?: string; usage: Usage | null; onOpen: (id: string | null, replace?: boolean) => void; onSent: () => void;
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
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [off, setOff] = useState<string | null>(null);
  const cur = useRef<string | null>(null), picked = useRef(false), box = useRef<HTMLDivElement>(null), follow = useRef(false), ta = useRef<HTMLTextAreaElement>(null);
  const [live, setLive] = useState(''); // the one polite live region: what is happening, announced to screen readers
  const refocus = () => ta.current?.focus();

  // Load the thread when the route points at another one; the thread this component just created is already in state.
  useEffect(() => {
    if (id === cur.current) return;
    cur.current = id; setPending(null); setErr(null); setOff(null);
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
  const preview = PRESETS.find((p) => p.id === preset);
  const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
  const lastAnswer = msgs.length - 1;

  const fail = (e: unknown, again: Err['again']) => {
    if (e instanceof ApiError && e.code === 'offline_boundary') showOff('Offline only: nothing leaves Compass for this project.');
    else { const message = e instanceof ApiError ? e.message : "Couldn't reach Compass. Check your connection and try again."; setErr({ message, again }); setLive(message); }
  };
  const showOff = (reason: string) => { setOff(reason); setLive(`${reason} Results are below.`); };
  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setErr(null); follow.current = true;
    if (project?.data_boundary === 'offline') { showOff('Offline only: nothing leaves Compass for this project.'); refocus(); return; }
    if (!online()) { showOff('No connection: nothing was sent. This is what Compass has on this device.'); refocus(); return; }
    setOff(null); setBusy(true); setPending(message); follow.current = true; setLive('Athena is answering…');
    try {
      const r = await ask({ thread_id: thread?.id, project_id: thread ? undefined : projSel || undefined, provider: prov, message, preset: preset ?? undefined, page: thread ? undefined : page });
      cur.current = r.thread.id;
      setThread(r.thread); setMsgs((x) => [...x, ...r.messages]); setText(''); setPreset(null); setMissing(false);
      if (!id) onOpen(r.thread.id, true);
      onSent(); setLive('Answer ready');
    } catch (e) { fail(e, 'send'); }
    finally { setBusy(false); setPending(null); refocus(); }
  };
  const askToo = async (p: Provider) => {
    if (!thread || busy) return;
    setErr(null); setBusy(true); follow.current = true; setLive('Athena is answering…');
    try { const r = await ask({ thread_id: thread.id, provider: p, rerun: true }); setMsgs((x) => [...x, ...r.messages]); onSent(); setLive('Answer ready'); }
    catch (e) { fail(e, p); }
    finally { setBusy(false); refocus(); }
  };
  const save = async (m: AiMessage) => {
    try { const n = await saveMessage(m.id, !m.saved); setMsgs((x) => x.map((y) => (y.id === n.id ? n : y))); }
    catch (e) { toast((e as Error).message); }
  };

  if (missing) return <div className="card"><p style={{ margin: 0 }}>This conversation isn't available. <Link to="/athena">Back to Athena</Link></p></div>;
  return (
    <>
      <div className="row cp-top">
        <button type="button" className="btn phone-only" onClick={() => onOpen(null)}>‹ Conversations</button>
        <b style={{ overflowWrap: 'anywhere' }}>{thread ? thread.title : 'New conversation'}</b>
        {thread && <span className="chip">{thread.project_id ? projects.find((p) => p.id === thread.project_id)?.name ?? 'Project' : 'Personal'}</span>}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</div>
      <div className="cp-msgs" ref={box}>
        {!thread && !pending && !off && <div className="card"><p style={{ margin: 0 }}>Ask about a situation, a plan or a page of the library. Pick a project to give Athena its context.</p></div>}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={m.id} className="cp-user">{m.content}</div>
          : <Answer key={m.id} m={m} project={project} onSave={() => void save(m)}
            onOther={i === lastAnswer && !busy && lastUser >= 0 && providerReady(usage, OTHER[m.provider ?? 'claude'])
              && !msgs.slice(lastUser).some((y) => y.role === 'assistant' && y.provider === OTHER[m.provider ?? 'claude']) && (() => void askToo(OTHER[m.provider ?? 'claude']))} />)}
        {pending && <div className="cp-user">{pending}</div>}
        {busy && <div className="cp-typing" aria-hidden="true"><i /><i /><i /></div>}
        {err && <div className="card cp-err"><span>{err.message}</span>
          <button type="button" className="btn" onClick={() => void (err.again === 'send' ? send() : askToo(err.again))}>Retry</button></div>}
        {off && <OfflinePanel text={text} reason={off} project={project} />}
      </div>
      <div className="card cp-compose">
        <div className="row">
          {projectId || thread
            ? <div className="chip cp-lock" aria-label="Project">
                <Icon name="lock" /><b>{projects.find((p) => p.id === projSel)?.name ?? 'None (personal)'}</b>
                <small>{thread ? 'this conversation stays with its project; start a new conversation to pick another' : 'this project'}</small></div>
            : <select className="field" style={{ flex: '1 1 180px', width: 'auto' }} aria-label="Project" value={projSel} onChange={(e) => setSel(e.target.value)}>
                <option value="">None (personal)</option>{projects.filter((p) => !p.deleted_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <div className="seg" role="group" aria-label="Provider">
            {(['claude', 'gemini'] as const).map((p) => <button type="button" key={p} className={prov === p ? 'on' : ''} aria-pressed={prov === p} disabled={!providerReady(usage, p)}
              onClick={() => { picked.current = true; setProvider(p); }}>{NAME[p]}</button>)}</div>
        </div>
        {(['claude', 'gemini'] as const).some((p) => !providerReady(usage, p)) && <small className="sub">Not set up: see Settings → AI ({(['claude', 'gemini'] as const).filter((p) => !providerReady(usage, p)).map((p) => NAME[p]).join(', ')})</small>}
        <div className="row" role="group" aria-label="Presets">
          {PRESETS.map((p) => <button type="button" key={p.id} className={`chip ${preset === p.id ? 'on' : ''}`} aria-pressed={preset === p.id} onClick={() => setPreset(preset === p.id ? null : p.id)}>{p.label}</button>)}</div>
        <textarea ref={ta} className="field" rows={4} aria-label="Message" value={text} maxLength={8000} placeholder={preview ? preview.prompt : 'Ask anything…'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
        {project?.data_boundary === 'offline' && <small className="sub">Offline only: Send searches Compass instead of asking a model.</small>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <small className="sub">⌘↵ to send</small>
          <button type="button" className="btn primary" disabled={!text.trim() || busy} onClick={() => void send()}>Send</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the pair (list + conversation), used by the screen and the project tab
export function Workspace({ projectId, openId, onOpen, page, usage, refreshUsage }: {
  projectId?: string; openId: string | null; onOpen: (id: string | null, replace?: boolean) => void; page?: string; usage: Usage | null; refreshUsage: () => void;
}) {
  const [rev, setRev] = useState(0);
  return (
    <div className={`cp ${openId !== null || page ? 'show-conv' : ''}`}>
      <aside className="cp-list" aria-label="Conversations">
        <button type="button" className="btn primary" onClick={() => onOpen('new')}>New conversation</button>
        <Threads projectId={projectId} openId={openId} onOpen={onOpen} rev={rev} />
      </aside>
      <section className="cp-conv" aria-label="Conversation">
        <Conversation id={openId && openId !== 'new' ? openId : null} projectId={projectId} page={page} usage={usage} onOpen={onOpen} onSent={() => { setRev((n) => n + 1); refreshUsage(); }} />
      </section>
    </div>
  );
}

export const SpendChip = ({ usage }: { usage: Usage | null }) => usage
  ? <span className={`chip ${usage.month_cost_micro >= usage.cap_micro ? 'danger' : ''}`} title="AI spend this month, against the monthly cap">This month: {spend(usage)}</span> : null;

export function CopilotView({ id }: { id?: string }) {
  const { usage, refresh } = useUsage();
  const page = new URLSearchParams(location.search).get('page') ?? undefined;
  return (
    <>
      <div className="head"><div><div className="eyebrow">Athena</div><h1 style={{ marginTop: 6 }}>Think it <b>through</b></h1>
        <div className="sub">Answers cite the library; nothing reaches the board until you add it.</div></div>
        <SpendChip usage={usage} /></div>
      <Workspace openId={id ?? null} page={page} usage={usage} refreshUsage={refresh} onOpen={(to, replace) => navigate(to === null ? '/athena' : `/athena/${to}`, replace)} />
    </>
  );
}
