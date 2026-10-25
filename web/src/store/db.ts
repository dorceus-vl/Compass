// A thin IndexedDB wrapper: one database, six object stores, promises. No library.
const NAME = 'compass', VERSION = 2; // 2 (v2.5): `time`
export type Store = 'tasks' | 'projects' | 'milestones' | 'time' | 'meta' | 'queue';
let dbp: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    // Any upgrade (a fresh install, or v1 gaining `time`) creates whichever stores are missing.
    req.onupgradeneeded = () => {
      const db = req.result, has = (s: string) => db.objectStoreNames.contains(s);
      for (const s of ['tasks', 'projects', 'milestones', 'time', 'meta'] as const) if (!has(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!has('queue')) db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
    };
    req.onblocked = () => void import('../ui/dialogs.tsx').then((d) => d.toast('Close other Compass tabs to finish updating')); // a v1 tab has no onversionchange, so it holds the upgrade until closed
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); dbp = null; }; resolve(db); }; // a newer tab's upgrade is never blocked by this one
    req.onerror = () => reject(req.error);
  }));
}
function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }));
}
export const idb = {
  get: <T>(store: Store, id: IDBValidKey) => tx<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>),
  all: <T>(store: Store) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  put: <T>(store: Store, row: T) => tx(store, 'readwrite', (s) => s.put(row)),
  del: (store: Store, id: IDBValidKey) => tx(store, 'readwrite', (s) => s.delete(id)),
  clear: (store: Store) => tx(store, 'readwrite', (s) => s.clear()),
  putAll: async <T>(store: Store, rows: T[]) => { const db = await openDb(); await new Promise<void>((res, rej) => { const t = db.transaction(store, 'readwrite'); for (const r of rows) t.objectStore(store).put(r); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};
