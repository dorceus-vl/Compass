import { useEffect, useSyncExternalStore } from 'react';
import type { LibraryPage } from '../../shared/types.ts';
import { buildIndex, search, snippet, type SearchIndex } from '../../shared/search.ts';
import { api, SignedOut } from './api.ts';
import { idb } from './store/db.ts';

// One shared index on the device: the bundled pages (/library.json, cached by the service worker) plus imports and personal lessons
// (/api/library/imports, last copy in IndexedDB meta `library_imports`). Search never needs the network once both have been seen.
type Doc = LibraryPage & { id: string };
interface S { pages: LibraryPage[]; ready: boolean }
let bundled: LibraryPage[] = [], imports: LibraryPage[] = [];
let ix: SearchIndex<Doc> = buildIndex([]);
let st: S = { pages: [], ready: false };
const subs = new Set<() => void>();
const publish = (ready: boolean) => {
  const pages = [...bundled, ...imports];
  ix = buildIndex(pages.map((p) => ({ ...p, id: p.slug })));
  st = { pages, ready: ready || st.ready };
  subs.forEach((f) => f());
};

let loaded: Promise<void> | null = null;
function load(): Promise<void> {
  return (loaded ??= (async () => {
    const cached = await idb.get<{ pages: LibraryPage[] }>('meta', 'library_imports').catch(() => undefined);
    if (cached) imports = cached.pages;
    try { bundled = await (await fetch('/library.json')).json() as LibraryPage[]; } catch { /* offline before the first visit: imports only */ }
    publish(true);
    try {
      imports = (await api<{ pages: LibraryPage[] }>('/library/imports')).pages;
      await idb.put('meta', { id: 'library_imports', pages: imports, at: new Date().toISOString() }).catch(() => {});
      publish(true);
    } catch (e) { if (!(e instanceof SignedOut)) { /* keep the cached imports */ } }
  })().finally(() => { loaded = null; }));
}

const find = (q: string, limit = 10) => search(ix, q, limit).map(({ doc }) => ({ page: doc as LibraryPage, snippet: snippet(doc.body, q) }));
const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };

export function useLibrary(): { pages: LibraryPage[]; ready: boolean; find: typeof find } {
  const s = useSyncExternalStore(subscribe, () => st);
  useEffect(() => { void load(); }, []);
  return { ...s, find };
}
