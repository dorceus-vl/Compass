import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { DocumentRow, Project } from '../../../../shared/types.ts';
import { api, online, SignedOut } from '../../api.ts';
import { idb } from '../../store/db.ts';
import { confirmAction, toast } from '../../ui/dialogs.tsx';
import { accent, projectColor } from '../../ui/colors.ts';

/** Network first; the list is cached in IndexedDB `meta` (`docs:<project|none|all>`) and shown, marked offline, when the network fails. project: an id, 'none' (unfiled) or null (all). */
export function useDocs(project: string | null) {
  const [s, set] = useState<{ docs: DocumentRow[]; offline: boolean }>({ docs: [], offline: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current, id = `docs:${project ?? 'all'}`;
    if (project?.startsWith('tmp-')) return; // not on the server yet
    try {
      const { documents } = await api<{ documents: DocumentRow[] }>(`/documents${project ? `?project=${encodeURIComponent(project)}` : ''}`);
      await idb.put('meta', { id, documents, at: new Date().toISOString() }).catch(() => {});
      if (mine === seq.current) set({ docs: documents, offline: false });
    } catch (e) {
      if (e instanceof SignedOut) return;
      const c = await idb.get<{ documents: DocumentRow[] }>('meta', id).catch(() => undefined);
      if (mine === seq.current) set({ docs: c?.documents ?? [], offline: true });
    }
  }, [project]);
  useEffect(() => { void reload(); return () => { seq.current++; }; }, [reload]);
  return { ...s, reload };
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const KIND: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', md: 'Markdown', txt: 'Text' };

function Row({ d, project, off, reload }: { d: DocumentRow; project: Project | null; off: boolean; reload: () => Promise<void> }) {
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); if (done) toast(done); await reload(); return true; }
    catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const rename = async (raw: string) => {
    const name = raw.trim();
    if (name === d.name) return;
    if (!name || !(await act(() => api(`/documents/${d.id}`, { method: 'PATCH', json: { name } })))) setRev((n) => n + 1); // blank or refused: show the stored name again
  };
  const lib = d.kind !== 'xlsx';
  return (
    <div className="acard doc-row" style={accent(project ? projectColor(project) : 'var(--text-dim)')}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input key={`${d.name}:${rev}`} className="field" aria-label="Document name" defaultValue={d.name} maxLength={200} disabled={off} onBlur={(e) => void rename(e.target.value)} />
        <span className="chip">{KIND[d.kind] ?? d.kind}</span>
      </div>
      <div className="sub">{size(d.size)} · {d.created_at.slice(0, 10)}</div>
      <div className="row">
        {off ? <button type="button" className="btn" disabled>Download</button> : <a className="btn" href={`/api/documents/${d.id}/file`} download={d.name}>Download</a>}
        {d.kind === 'docx' && <button type="button" className="btn" aria-pressed={!!d.is_template} disabled={off || busy}
          onClick={() => void act(() => api(`/documents/${d.id}`, { method: 'PATCH', json: { is_template: d.is_template ? 0 : 1 } }))}>Use as template</button>}
        {lib && (project?.kind === 'work'
          ? <small className="sub">Work documents stay out of the library</small>
          : project?.data_boundary === 'offline'
          ? <small className="sub">This project is Offline only, so its files stay out of the library.</small>
          : <button type="button" className="btn" disabled={off || busy} onClick={() => void act(() => api('/library/import', { method: 'POST', json: { document_id: d.id } }), 'Added to the library')}>Add to library</button>)}
        <button type="button" className="btn" style={{ color: 'var(--danger)', marginLeft: 'auto' }} disabled={off || busy}
          onClick={async () => { if (await confirmAction(`Move "${d.name}" to Trash?`, { danger: true })) await act(() => api(`/documents/${d.id}`, { method: 'DELETE' }), 'Moved to Trash'); }}>Trash</button>
      </div>
      {d.is_template ? <div className="row" aria-label="Placeholders">
        {d.placeholders.length ? d.placeholders.map((p) => <span key={p} className="chip ph">{`{{${p}}}`}</span>) : <small className="sub">{'No {{placeholders}} found'}</small>}
      </div> : null}
    </div>
  );
}

/** A project's documents, or the unfiled ones (project = null). */
export function Documents({ project }: { project: Project | null }) {
  const { docs, offline, reload } = useDocs(project ? project.id : 'none');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const off = offline || !online();
  const limit = project?.kind === 'work' ? 10 : 20;
  const upload = async (files: FileList | File[] | null | undefined) => {
    const list = files ? [...files] : [];
    if (!list.length || busy) return;
    setError('');
    if (list.length > 1) { setError('Add one file at a time.'); return; }
    const f = list[0];
    if (!online()) { setError('Uploading needs a connection.'); return; }
    if (f.size > limit * 1024 * 1024) { setError(project?.kind === 'work' ? 'Work files must be 10 MB or smaller.' : 'Files must be 20 MB or smaller.'); return; }
    setBusy(true); setStatus(`Uploading ${f.name}…`);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (project) fd.append('project_id', project.id);
      await api('/documents', { method: 'POST', body: fd });
      setStatus(`${f.name} uploaded.`);
      await reload();
    } catch (e) { if (!(e instanceof SignedOut)) { setStatus(''); setError((e as Error).message); } }
    finally { setBusy(false); }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="sub">PDF, Word, Excel, Markdown or text, up to {limit} MB. Text from PDF, Word, Markdown and text files can be searched and added to the library{project?.kind === 'work' ? ' (not for work projects)' : ''}.</div>
      {off && <div className="sub" role="note">Offline: showing the last copy. Uploads and changes need a connection.</div>}
      <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!off) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={off ? (e) => e.preventDefault() : drop}>
        <label className="btn primary" aria-disabled={off || busy}>Choose a file
          <input type="file" className="sr-only" accept=".pdf,.docx,.xlsx,.md,.txt" disabled={off || busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
        <span className="sub">or drop one here</span>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{error || status}</div>
      {status && !error && <div className="sub" aria-hidden="true">{status}</div>}
      {error && <div className="sub" aria-hidden="true" style={{ color: 'var(--danger)' }}>{error}</div>}
      {docs.map((d) => <Row key={d.id} d={d} project={project} off={off} reload={reload} />)}
      {!docs.length && <p style={{ color: 'var(--text-faint)', margin: 0 }}>No documents yet.</p>}
    </div>
  );
}
