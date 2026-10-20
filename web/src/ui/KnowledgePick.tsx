// "Save to knowledge" (Athena attachments, meeting reviews, email inbox items) and the collection list Athena's "Use knowledge" picker reads.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KnowledgeCollection } from '../../../shared/types.ts';
import { api, ApiError, SignedOut } from '../api.ts';
import { Link } from '../router.ts';
import { toast } from './dialogs.tsx';

/** The live collections, read once per mount: null while loading, [] when they couldn't be read. */
export function useCollections(): KnowledgeCollection[] | null {
  const [colls, set] = useState<KnowledgeCollection[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ collections: KnowledgeCollection[] }>('/knowledge/collections').then((r) => live && set(r.collections)).catch(() => live && set([]));
    return () => { live = false; };
  }, []);
  return colls;
}

export const collLabel = (c: KnowledgeCollection) => (c.system ? 'From my apps' : c.scope === 'personal' ? 'Personal' : c.boundary === 'locked' ? 'Work · Locked' : 'Work · Cloud AI');

type Side = { scope: 'work' | 'personal'; lockedOnly?: boolean };

/** The button and its dialog. Only collections that can take this are offered (its side; Locked only when its project is Offline only), the first one picked; the server checks again. */
export function SaveToKnowledge({ side, save, className = 'btn', disabled, title, label = 'Save to knowledge' }: {
  side: Side; save: (collectionId: string) => Promise<unknown>; className?: string; disabled?: boolean; title?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} disabled={disabled} title={title} onClick={() => setOpen(true)}>{label}</button>
    {open && createPortal(<SaveDialog side={side} save={save} onClose={() => setOpen(false)} />, document.body)/* outside the card, so its buttons keep the dialog's look */}
  </>;
}

function SaveDialog({ side, save, onClose }: { side: Side; save: (collectionId: string) => Promise<unknown>; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const colls = useCollections();
  const fits = (colls ?? []).filter((c) => !c.system && c.scope === side.scope && (!side.lockedOnly || c.boundary === 'locked'));
  const [pick, setPick] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { dlg.current?.showModal(); }, []);
  const chosen = fits.some((c) => c.id === pick) ? pick : fits[0]?.id ?? '';
  const go = async () => {
    if (!chosen || busy) return;
    setBusy(true); setErr('');
    try { await save(chosen); toast(`Saved to ${fits.find((c) => c.id === chosen)?.name ?? 'knowledge'}`); dlg.current?.close(); }
    catch (e) { if (!(e instanceof SignedOut)) setErr(e instanceof ApiError ? e.message : "Couldn't save it. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  const why = side.scope === 'personal' ? 'This is personal, so only personal collections are offered.'
    : side.lockedOnly ? 'Its project is Offline only, so only a Locked work collection can take it.' : 'This is work, so only work collections are offered.';
  return (
    <dialog ref={dlg} className="kn-dlg" onClose={onClose} aria-labelledby="kn-save-h">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h2 id="kn-save-h" style={{ margin: '0 0 6px', fontSize: 19 }}>Save to knowledge</h2>
        <p className="sub" style={{ margin: 0 }}>{why}</p>
        {colls === null ? <p className="sub" role="status">Loading collections…</p>
          : fits.length ? <fieldset className="kn-set"><legend>Collection</legend>
            {fits.map((c) => <label key={c.id} className={`kn-opt${chosen === c.id ? ' on' : ''}`}>
              <input type="radio" name="kn-save" checked={chosen === c.id} onChange={() => setPick(c.id)} /><span><b>{c.name}</b><small>{collLabel(c)}</small></span></label>)}
          </fieldset>
          : <p>No {side.lockedOnly ? 'Locked work' : side.scope} collection yet. <Link to="/knowledge">Make one in Knowledge</Link>.</p>}
        {err && <div className="kn-note" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!chosen || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </dialog>
  );
}
