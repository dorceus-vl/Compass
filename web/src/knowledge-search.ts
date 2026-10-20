// Locked knowledge is searched here, on the device (KN4). Its passages come from GET /api/knowledge/locked/:id/passages once per session per collection,
// live only in this module's memory (no IndexedDB, localStorage or Cache API, and the service worker never sees /api), and are dropped when the tab has been
// hidden for 10 minutes and on sign-out. Server results (Cloud AI and personal collections) come from GET /api/knowledge/search and are not kept.
import { api } from './api.ts';
import { buildIndex, search, snippet, type SearchIndex } from '../../shared/search.ts';

export interface LockedPassage { id: string; item_id: string; document_id: string | null; ord: number; locator: string; text: string; item_title: string }
export interface LockedHit { id: string; item_id: string; document_id: string | null; locator: string; item_title: string; text: string; snippet: string; collection_id: string; score: number }
type Doc = { id: string; title: string; body: string; p: LockedPassage };

export const HIDDEN_LIMIT_MS = 10 * 60 * 1000;

/** The in-memory store. `load` fetches one collection's passages; `setTimer` and `clearTimer` default to the page's. Pure enough to self-check without a browser. */
export function createLockedSearch(load: (collectionId: string) => Promise<LockedPassage[]>, timers = { set: (f: () => void, ms: number): unknown => setTimeout(f, ms), clear: (t: unknown) => clearTimeout(t as number) }) {
  let indexes = new Map<string, SearchIndex<Doc>>();
  let loading = new Map<string, Promise<SearchIndex<Doc>>>();
  let timer: unknown = null, hiddenAt: number | null = null, epoch = 0;
  const drop = () => { indexes = new Map(); loading = new Map(); epoch++; };
  const ensure = (id: string) => {
    const have = indexes.get(id);
    if (have) return Promise.resolve(have);
    let p = loading.get(id);
    if (!p) {
      const mine = epoch;
      p = load(id).then((ps) => {
        const ix = buildIndex<Doc>(ps.map((x) => ({ id: x.id, title: x.item_title, body: x.text, p: x })));
        if (mine === epoch) indexes.set(id, ix); // dropped while loading: the answer is used once and not kept
        return ix;
      }).finally(() => { if (mine === epoch) loading.delete(id); });
      loading.set(id, p);
    }
    return p;
  };
  return {
    /** Searches these Locked collections (loading any not yet in memory). A collection that couldn't load is listed in `failed`. */
    async search(collectionIds: string[], q: string, limit = 10): Promise<{ hits: LockedHit[]; failed: string[] }> {
      const failed: string[] = [], hits: LockedHit[] = [];
      await Promise.all(collectionIds.map(async (id) => {
        try { for (const r of search(await ensure(id), q, limit)) hits.push({ id: r.doc.id, item_id: r.doc.p.item_id, document_id: r.doc.p.document_id, locator: r.doc.p.locator, item_title: r.doc.p.item_title, text: r.doc.p.text, snippet: snippet(r.doc.p.text, q, 260), collection_id: id, score: r.score }); }
        catch { failed.push(id); }
      }));
      return { hits: hits.sort((a, b) => b.score - a.score).slice(0, limit), failed };
    },
    drop,
    loaded: () => [...indexes.keys()],
    /** The tab was hidden at time `at`: it is dropped when it has stayed hidden for 10 minutes (a timer, and a check when it comes back, as timers sleep in the background). */
    hidden(at = Date.now()) { hiddenAt = at; if (timer) timers.clear(timer); timer = timers.set(drop, HIDDEN_LIMIT_MS); },
    visible(at = Date.now()) { if (timer) timers.clear(timer); timer = null; if (hiddenAt !== null && at - hiddenAt >= HIDDEN_LIMIT_MS) drop(); hiddenAt = null; },
  };
}

export type LockedStore = ReturnType<typeof createLockedSearch>;
let shared: LockedStore | null = null;

/** The page's one store; it fetches through api() (session cookie, the passkey and sign-out handling stay in one place). */
export function lockedStore(): LockedStore {
  if (shared) return shared;
  shared = createLockedSearch(async (id) => (await api<{ passages: LockedPassage[] }>(`/knowledge/locked/${encodeURIComponent(id)}/passages`)).passages);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') shared?.hidden(); else shared?.visible(); });
  return shared;
}

/** Sign-out (App calls it whenever the session ends): nothing Locked stays in memory. */
export const dropLocked = () => shared?.drop();
