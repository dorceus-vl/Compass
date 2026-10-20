import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { KnowledgeCollection, KnowledgeItem } from '../../../shared/types.ts';
import { snippet } from '../../../shared/search.ts';
import { api, ApiError, online, SignedOut } from '../api.ts';
import { Link, navigate } from '../router.ts';
import { Icon } from '../ui/Shell.tsx';
import { confirmAction, toast } from '../ui/dialogs.tsx';
import { lockedStore } from '../knowledge-search.ts';
import { Highlight } from './Library.tsx';
import { ASK_KEY } from './Athena.tsx';

type Coll = KnowledgeCollection & { item_count?: number };
/** One search result, from the server (Cloud AI and personal collections) or from the device (Locked). Text only. */
interface Hit { key: string; document_id: string | null; locator: string; title: string; text: string; coll: Coll; locked: boolean }
interface Found { id: string; document_id: string | null; text: string; locator: string; item_title: string; collection: { id: string }; score: number }

const SOURCE_ICON: Record<string, string> = { upload: 'doc', meeting: 'meetings', email: 'mail', athena: 'athena', 'app:compass': 'today', 'app:finance': 'bars', 'app:health': 'review', 'app:home': 'upcoming', 'app:hollow': 'sheet' };
const APP_ORDER = ['app:compass', 'app:finance', 'app:health', 'app:home', 'app:hollow']; // From my apps always lists its five in this order
const kindLabel = (c: Coll) => (c.system ? 'From my apps' : c.scope === 'personal' ? 'Personal' : c.boundary === 'locked' ? 'Locked' : 'Cloud AI');
/** The collection's chip: Cloud AI, Locked (with the lock), Personal or From my apps. The word always shows, so colour never carries it alone. */
const Kind = ({ c }: { c: Coll }) => <span className={`chip kn-chip${c.boundary === 'locked' && c.scope === 'work' ? ' locked' : ''}`}>{c.boundary === 'locked' && c.scope === 'work' && <Icon name="lock" />}{kindLabel(c)}</span>;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SEARCH_PAUSED = 'Searching is paused for a few minutes.';
const BUDGET_USED = "This month's AI budget is used up. Raise it in Settings → AI.";
const LOCKED_CLEARED = 'Locked results were cleared from this screen. Search again to load them.';
const BOUNDARY_LINE = { locked: 'No AI ever reads it. You search it by words, on this device.', cloud: 'Athena can read passages in work threads and search works by meaning. Your passkey confirms this.' };

/** Searches the open collection, or all of them, for the term asked (Enter, or a pause; see KnowledgeView): the server for Cloud AI and personal, this device for Locked. A stale answer is dropped. */
function useKnowledgeSearch(q: string, scope: string | undefined, colls: Coll[] | null) {
  const [state, set] = useState<{ q: string; hits: Hit[]; notes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(colls);
  ref.current = colls;
  const seq = useRef(0), ready = !!colls;
  // The in-memory Locked index was dropped (10 minutes hidden, sign-out): the Locked results on screen go with it.
  useEffect(() => lockedStore().onDrop(() => set((s) => (s && s.hits.some((h) => h.locked) ? { ...s, hits: s.hits.filter((h) => !h.locked), notes: [...s.notes, LOCKED_CLEARED] } : s))), []);
  useEffect(() => {
    const term = q.trim(), mine = ++seq.current;
    if (!term || !ready) { set(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const all = ref.current ?? [], scoped = scope ? all.filter((c) => c.id === scope) : all, byId = new Map(all.map((c) => [c.id, c]));
      const lockedIds = scoped.filter((c) => c.scope === 'work' && c.boundary === 'locked').map((c) => c.id);
      const notes: string[] = [], cloud: Hit[] = [];
      const server = scoped.some((c) => c.boundary === 'cloud')
        ? api<{ passages: Found[] }>(`/knowledge/search?q=${encodeURIComponent(term)}${scope ? `&collections=${encodeURIComponent(scope)}` : ''}`).then((r) => {
          for (const p of r.passages) { const c = byId.get(p.collection.id); if (c) cloud.push({ key: p.id, document_id: p.document_id, locator: p.locator, title: p.item_title, text: snippet(p.text, term, 260), coll: c, locked: false }); }
        }).catch((e) => { if (e instanceof SignedOut) return; notes.push(e instanceof ApiError ? (e.code === 'cap_reached' ? BUDGET_USED : e.status === 429 ? SEARCH_PAUSED : e.message) : 'Searching by meaning needs a connection.'); })
        : Promise.resolve();
      const device = lockedIds.length ? lockedStore().search(lockedIds, term, 10) : Promise.resolve({ hits: [], failed: [] as string[] });
      const [, d] = await Promise.all([server, device]);
      if (mine !== seq.current) return;
      if (d.failed.length) notes.push(`${d.failed.map((id) => byId.get(id)?.name ?? 'A collection').join(', ')} couldn't be loaded; Locked collections are searched on this device and load once per session.`);
      const locked = d.hits.map((h): Hit => ({ key: h.id, document_id: h.document_id, locator: h.locator, title: h.item_title, text: h.snippet, coll: byId.get(h.collection_id)!, locked: true })).filter((h) => h.coll);
      set({ q: term, hits: [...cloud, ...locked], notes }); setBusy(false);
    });
    return () => clearTimeout(t);
  }, [q, scope, ready]);
  return { state, busy };
}

function Results({ s, busy, scopeName }: { s: { q: string; hits: Hit[]; notes: string[] } | null; busy: boolean; scopeName: string | null }) {
  if (!s) return busy ? <p className="sub" role="status">Searching…</p> : null;
  const ask = (h: Hit) => { // KN22: the question goes through sessionStorage (Athena reads it once and clears it), never the URL
    try { sessionStorage.setItem(ASK_KEY, s.q); } catch { /* storage off: Athena opens with an empty box */ }
    navigate(`/athena?knowledge=${encodeURIComponent(h.coll.id)}`);
  };
  return (
    <section className="kn-results" aria-label="Search results">
      <div className="sub" role="status" aria-live="polite">{busy ? 'Searching…' : `${plural(s.hits.length, 'result')} for “${s.q}” ${scopeName ? `in ${scopeName}` : 'in all collections'}`}</div>
      {s.notes.map((n) => <div key={n} className="kn-note" role="note">{n}</div>)}
      {s.hits.some((h) => h.locked) && <div className="sub">Locked collections are matched by words, on this device.</div>}
      {s.hits.map((h) => (
        <article key={`${h.coll.id}:${h.key}`} className="card kn-hit">
          <div className="kn-hit-top"><b>{h.title}</b><span className="chip">{h.locator}</span><Kind c={h.coll} /><span className="chip kn-chip">{h.coll.name}</span></div>
          <p><Highlight text={h.text} q={s.q} /></p>
          <div className="row">
            {h.document_id && <a className="btn" href={`/api/documents/${h.document_id}/file`} target="_blank" rel="noopener">Open file</a>}
            {h.locked ? <><button type="button" className="btn" disabled>Ask Athena about this</button><small className="sub">Locked: never sent to a model.</small></>
              : <button type="button" className="btn" onClick={() => ask(h)}>Ask Athena about this</button>}
          </div>
        </article>))}
      {!busy && !s.hits.length && !s.notes.length && <div className="card"><p style={{ margin: 0 }}>Nothing found for “{s.q}”.</p></div>}
    </section>
  );
}

function NewCollection({ onClose, onMade }: { onClose: () => void; onMade: (c: Coll) => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(''), [scope, setScope] = useState<'work' | 'personal'>('work'), [boundary, setBoundary] = useState<'locked' | 'cloud'>('locked');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const make = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const { collection } = await api<{ collection: Coll }>('/knowledge/collections', { method: 'POST', json: { name: name.trim(), scope, ...(scope === 'work' ? { boundary } : {}) } });
      dlg.current?.close(); onMade(collection);
    } catch (e) { if (!(e instanceof SignedOut)) setErr((e as Error).message || 'Could not create it.'); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dlg} className="kn-dlg" onClose={onClose} aria-labelledby="kn-new-h">
      <form onSubmit={(e) => { e.preventDefault(); void make(); }}>
        <h2 id="kn-new-h" style={{ margin: '0 0 12px', fontSize: 19 }}>New collection</h2>
        <label className="kn-lbl">Name<input className="field" value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} /></label>
        <fieldset className="kn-set"><legend>What is it for</legend>
          {([['work', 'Work', 'Work files. Sealed at rest, and Kelly never sees them.'], ['personal', 'Personal', 'Your own files. Always Cloud AI, so Athena can search them by meaning.']] as const).map(([v, t, line]) => (
            <label key={v} className={`kn-opt${scope === v ? ' on' : ''}`}><input type="radio" name="kn-scope" checked={scope === v} onChange={() => setScope(v)} /><span><b>{t}</b><small>{line}</small></span></label>))}
        </fieldset>
        {scope === 'work' && <fieldset className="kn-set"><legend>Who may read it</legend>
          {([['locked', 'Locked'], ['cloud', 'Cloud AI']] as const).map(([v, t]) => (
            <label key={v} className={`kn-opt${boundary === v ? ' on' : ''}`}><input type="radio" name="kn-bound" checked={boundary === v} onChange={() => setBoundary(v)} /><span><b>{t}</b><small>{BOUNDARY_LINE[v]}</small></span></label>))}
        </fieldset>}
        {err && <div className="kn-note" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </dialog>
  );
}

function CollectionList({ colls }: { colls: Coll[] }) {
  const groups: [string, Coll[]][] = [['Work', colls.filter((c) => c.scope === 'work')], ['Personal', colls.filter((c) => c.scope === 'personal')]];
  return <>{groups.map(([title, xs]) => xs.length > 0 && (
    <section key={title} aria-label={title} className="kn-group">
      <div className="ghead"><b>{title}</b><span className="chip count">{xs.length}</span></div>
      <div className="kn-grid">{xs.map((c) => (
        <Link key={c.id} to={`/knowledge/${c.id}`} className="card kn-coll">
          <span className="secico"><Icon name={c.boundary === 'locked' && c.scope === 'work' ? 'lock' : 'knowledge'} /></span>
          <span className="kn-coll-body"><b>{c.name}</b><span className="kn-meta"><Kind c={c} /><span className="sub">{plural(c.item_count ?? 0, 'item')}</span></span></span>
          <span className="chev" aria-hidden="true"><Icon name="chevron" /></span>
        </Link>))}</div>
    </section>))}</>;
}

/** "Refresh now" for From my apps: the Worker pulls Kelly-Cloud and rebuilds Compass's part (at most once every 10 minutes: it says so otherwise). Each app's item then shows its own result. */
function RefreshNow({ onDone }: { onDone: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ errors: Record<string, string> }>('/knowledge/apps/refresh', { method: 'POST' });
      const bad = Object.keys(r.errors).length;
      toast(bad ? `Refreshed. ${plural(bad, 'app')} couldn’t be read.` : 'Refreshed');
      await onDone();
    } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message || 'Could not refresh.'); } finally { setBusy(false); }
  };
  return <button type="button" className="btn primary" disabled={busy || !online()} onClick={() => void run()}>{busy ? 'Refreshing…' : 'Refresh now'}</button>;
}

function ItemRow({ it, coll, onRemove }: { it: KnowledgeItem; coll: Coll; onRemove: (i: KnowledgeItem) => void }) {
  const note = it.state === 'ready' && it.search === 'excluded' ? 'Not searched by meaning: its project is Offline-only or its file is in Trash.' : null;
  const app = it.source.startsWith('app:'); // an app item's error means yesterday's copy stays; on any other item it is a fixed note (e.g. indexed in part)
  return (
    <div className="card kn-item">
      <span className="secico"><Icon name={SOURCE_ICON[it.source] ?? 'doc'} /></span>
      <div className="kn-item-body">
        <b className="kn-title">{it.title}</b>
        <div className="kn-meta">
          {it.state === 'indexing' || it.search === 'reindexing' ? <span className="kn-state"><i className="kn-spin" aria-hidden="true" />{it.state === 'indexing' ? 'Indexing' : 'Re-indexing'}</span>
            : it.state === 'failed' ? <span className="kn-state bad"><Icon name="warn" />Failed</span>
            : it.error && app ? <span className="kn-state bad"><Icon name="warn" />Out of date</span>
            : <span className="kn-state ok"><Icon name="review" />Ready</span>}
          <span className="sub">{it.created_at.slice(0, 10)}</span>
          {it.state !== 'failed' && <span className="sub">{plural(it.chunk_count, 'passage')}</span>}
        </div>
        {it.state === 'failed' && it.error && <div className="kn-note">{it.error}</div>}
        {it.state === 'ready' && it.error && app && <div className="kn-note" role="status">{it.error} Showing the copy from {it.created_at.slice(0, 10)}.</div>}
        {it.state !== 'failed' && it.error && !app && <div className="sub" role="status">{it.error}.</div>}
        {note && <div className="sub">{note}</div>}
      </div>
      <div className="kn-item-acts">
        {it.document_id && <a className="btn" href={`/api/documents/${it.document_id}/file`} target="_blank" rel="noopener" aria-label={`Open ${it.title}`}>Open file</a>}
        {!coll.system && <button type="button" className="btn" style={{ color: 'var(--danger)' }} onClick={() => onRemove(it)} aria-label={`Move ${it.title} to Trash`}>Remove</button>}
      </div>
    </div>
  );
}

type Up = { id: number; name: string; status: 'uploading' | 'error'; msg?: string };
const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.csv,.md,.txt,.png,.jpg,.jpeg';

function CollectionPage({ coll, reloadColls, searching }: { coll: Coll; reloadColls: () => Promise<void>; searching: boolean }) {
  const [items, setItems] = useState<KnowledgeItem[] | null>(null), [loadErr, setLoadErr] = useState(false);
  const [ups, setUps] = useState<Up[]>([]), [over, setOver] = useState(false), [rev, setRev] = useState(0);
  const upId = useRef(0), alive = useRef(true);
  const work = coll.scope === 'work', limit = work ? 10 : 20, off = !online();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    try { const r = await api<{ items: KnowledgeItem[] }>(`/knowledge/collections/${coll.id}/items`); if (alive.current) { setItems(r.items); setLoadErr(false); } }
    catch (e) { if (!(e instanceof SignedOut) && alive.current) setLoadErr(true); }
  }, [coll.id]);
  useEffect(() => { void load(); }, [load]);
  const waiting = items?.some((i) => i.state === 'indexing' || i.search === 'reindexing');
  useEffect(() => { // the embedder works in the background: look again every few seconds while something waits and the tab is showing
    if (!waiting) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const upload = async (files: FileList | File[] | null | undefined) => {
    const list = files ? [...files] : [];
    if (!list.length) return;
    for (const f of list) {
      const id = ++upId.current, fail = (msg: string) => setUps((u) => u.map((x) => (x.id === id ? { ...x, status: 'error', msg } : x)));
      setUps((u) => [...u, { id, name: f.name, status: 'uploading' }]);
      if (!online()) { fail('Uploading needs a connection.'); continue; }
      if (f.size > limit * 1024 * 1024) { fail(`${work ? 'Work files' : 'Files'} must be ${limit} MB or smaller.`); continue; }
      let docId = '';
      try {
        const fd = new FormData();
        fd.append('file', f);
        if (work) fd.append('knowledge_work', '1'); // no project: sealed like a work file, or the collection would refuse it
        docId = (await api<{ document: { id: string } }>('/documents', { method: 'POST', body: fd })).document.id;
        await api('/knowledge/items', { method: 'POST', json: { collection_id: coll.id, document_id: docId } });
        if (alive.current) setUps((u) => u.filter((x) => x.id !== id));
        await load(); await reloadColls();
      } catch (e) {
        if (docId) await api(`/documents/${docId}`, { method: 'DELETE' }).catch(() => {}); // no item took it: don't leave a stray file behind
        if (!(e instanceof SignedOut)) fail((e as Error).message || 'Could not add it.');
      }
    }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); };
  const remove = async (it: KnowledgeItem) => {
    try { await api(`/knowledge/items/${it.id}`, { method: 'DELETE' }); toast('Moved to Trash'); await load(); await reloadColls(); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
  };
  const rename = async (raw: string) => {
    const name = raw.trim();
    if (name === coll.name) return;
    try { if (!name) throw new Error('A name is needed.'); await api(`/knowledge/collections/${coll.id}`, { method: 'PATCH', json: { name } }); await reloadColls(); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); setRev((n) => n + 1); }
  };
  const setBoundary = async (to: 'locked' | 'cloud') => {
    if (to === coll.boundary) return;
    const ok = await confirmAction(to === 'cloud'
      ? `Make “${coll.name}” Cloud AI? Its passages will be indexed for search by meaning and Athena can read them in work threads. Your passkey is asked next.`
      : `Make “${coll.name}” Locked? Its search index is deleted and no AI will read it. You can still search it by words on this device.`);
    if (!ok) return;
    try { await api(`/knowledge/collections/${coll.id}`, { method: 'PATCH', json: { boundary: to } }); toast(to === 'cloud' ? 'Now Cloud AI. Indexing…' : 'Now Locked'); await reloadColls(); await load(); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
  };
  const trash = async () => {
    if (!(await confirmAction(`Move “${coll.name}” to Trash? You can restore it for 30 days. Your passkey is asked next.`, { danger: true }))) return;
    try { await api(`/knowledge/collections/${coll.id}`, { method: 'DELETE' }); toast('Moved to Trash'); await reloadColls(); navigate('/knowledge'); }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); }
  };
  const editable = !coll.system;
  const refreshedAt = items?.filter((i) => i.state !== 'failed').map((i) => i.created_at).sort().pop(); // each refresh adds new items, so the newest says when
  return (
    <div className="kn-page" hidden={searching}>
      <div className="kn-top">
        {editable ? <input key={`${coll.name}:${rev}`} className="field kn-name" aria-label="Collection name" defaultValue={coll.name} maxLength={200} disabled={off} onBlur={(e) => void rename(e.target.value)} />
          : <h2 className="kn-name-ro">{coll.name}</h2>}
        <Kind c={coll} /><span className="sub">{plural(items?.length ?? coll.item_count ?? 0, 'item')}</span>
        {editable && <button type="button" className="btn" style={{ color: 'var(--danger)', marginLeft: 'auto' }} disabled={off} onClick={() => void trash()}>Move to Trash</button>}
        {coll.system && <span style={{ marginLeft: 'auto' }}><RefreshNow onDone={async () => { await load(); await reloadColls(); }} /></span>}
      </div>
      {work && editable && (
        <div className="kn-bound">
          <div className="seg" role="group" aria-label="Who may read this collection">
            {(['locked', 'cloud'] as const).map((b) => <button key={b} type="button" className={coll.boundary === b ? 'on' : ''} aria-pressed={coll.boundary === b} disabled={off} onClick={() => void setBoundary(b)}>{b === 'locked' ? 'Locked' : 'Cloud AI'}</button>)}
          </div>
          <span className="sub kn-line">{BOUNDARY_LINE[coll.boundary]}</span>
        </div>)}
      {coll.system
        ? <div className="sub">Filled from your apps once a day, and replaced each time it refreshes. {refreshedAt ? `Last refreshed ${new Date(refreshedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : items ? 'Not refreshed yet.' : ''}</div>
        : <>
          <div className={`drop kn-drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!off) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={off ? (e) => e.preventDefault() : drop}>
            <label className="btn primary" aria-disabled={off}>Add files
              <input type="file" multiple className="sr-only" accept={ACCEPT} disabled={off} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
            <span className="sub">or drop them here. PDF, Word, Excel, PowerPoint, Markdown, text or CSV, up to {limit} MB each.</span>
          </div>
          <div className="sr-only" role="status" aria-live="polite">{ups.filter((u) => u.status === 'uploading').map((u) => `Adding ${u.name}`).join(', ')}</div>
          {ups.map((u) => (
            <div key={u.id} className="kn-up"><span className="kn-title">{u.name}</span>
              {u.status === 'uploading' ? <span className="kn-state"><i className="kn-spin" aria-hidden="true" />Adding</span>
                : <><span className="kn-state bad"><Icon name="warn" />Not added</span><span className="kn-note">{u.msg}</span><button type="button" className="btn" onClick={() => setUps((x) => x.filter((y) => y.id !== u.id))}>Dismiss</button></>}
            </div>))}
        </>}
      {off && <div className="sub" role="note">Offline: uploads and changes need a connection.</div>}
      {loadErr && <div className="kn-note" role="alert">The items couldn't be loaded. <button type="button" className="btn" onClick={() => void load()}>Try again</button></div>}
      <div className="kn-items">{(coll.system && items ? [...items].sort((a, b) => APP_ORDER.indexOf(a.source) - APP_ORDER.indexOf(b.source)) : items)?.map((it) => <ItemRow key={it.id} it={it} coll={coll} onRemove={remove} />)}</div>
      {items && !items.length && !loadErr && <p className="sub" style={{ margin: 0 }}>Nothing in this collection yet.</p>}
    </div>
  );
}

export function KnowledgeView({ id }: { id?: string }) {
  const [colls, setColls] = useState<Coll[] | null>(null), [err, setErr] = useState(false), [creating, setCreating] = useState(false), [q, setQ] = useState('');
  const reload = useCallback(async () => {
    try { setColls((await api<{ collections: Coll[] }>('/knowledge/collections')).collections); setErr(false); }
    catch (e) { if (!(e instanceof SignedOut)) setErr(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Each search spends one of the 120 query embeds an hour (shared with Athena and Kelly): it runs on Enter, or after an 800 ms pause once 3 characters are typed.
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const t = q.trim();
    if (!t) { setAsked(''); return; }
    if (t.length < 3) return;
    const h = setTimeout(() => setAsked(t), 800);
    return () => clearTimeout(h);
  }, [q]);
  const { state, busy } = useKnowledgeSearch(asked, id, colls);
  const coll = id ? colls?.find((c) => c.id === id) : undefined;
  const searching = q.trim() !== '';
  const missing = !!id && !!colls && !coll;
  return (
    <>
      <div className="head"><div>
        <div className="eyebrow">{id ? <Link to="/knowledge" className="kn-back">Knowledge</Link> : 'Knowledge'}</div>
        <h1 style={{ marginTop: 6 }}>{coll ? <>{coll.name}</> : <>What you’ve <b>kept</b></>}</h1>
        <div className="sub">{colls ? (id ? 'Search this collection, or add files to it' : `${plural(colls.length, 'collection')}. Search them all by meaning and words.`) : 'Loading…'}</div></div>
        {!id && <button type="button" className="btn primary" onClick={() => setCreating(true)} disabled={!online()}>New collection</button>}
      </div>
      <form role="search" onSubmit={(e) => { e.preventDefault(); setAsked(q.trim()); }}>
        <input className="field kn-search" type="search" enterKeyHint="search" aria-label={coll ? `Search ${coll.name}` : 'Search all collections'} placeholder={coll ? `Search in ${coll.name}` : 'Search all collections'} value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {searching && <Results s={state} busy={busy} scopeName={coll?.name ?? null} />}
      {err && !colls && <div className="card"><p style={{ margin: 0 }}>Knowledge needs a connection. <button type="button" className="btn" onClick={() => void reload()}>Try again</button></p></div>}
      {missing && <div className="card"><p style={{ margin: 0 }}>That collection isn’t here. <Link to="/knowledge">Back to Knowledge</Link></p></div>}
      {coll && <CollectionPage key={coll.id} coll={coll} reloadColls={reload} searching={searching} />}
      {!id && colls && (
        <div hidden={searching}>
          {!colls.some((c) => c.system) && (
            <section aria-label="From my apps" className="kn-group"><div className="kn-grid"><div className="card kn-coll static">
              <span className="secico"><Icon name="knowledge" /></span>
              <span className="kn-coll-body"><b>From my apps</b><span className="sub">Your tasks and projects, Finance, Health, Home and Hollow, kept up to date once a day. Not refreshed yet.</span></span>
              <RefreshNow onDone={reload} />
            </div></div></section>)}
          {colls.length ? <CollectionList colls={colls} /> : colls.some((c) => c.system) ? null : <div className="card"><p style={{ margin: 0 }}>No collections yet. A collection holds files you want to search together: a client’s contracts, a manual, your notes.</p></div>}
        </div>)}
      {creating && <NewCollection onClose={() => setCreating(false)} onMade={(c) => { void reload(); navigate(`/knowledge/${c.id}`); }} />}
    </>
  );
}
