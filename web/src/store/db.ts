// A thin IndexedDB wrapper: one database, five object stores, promises. No library.
const NAME = 'compass', VERSION = 1;
export type Store = 'tasks' | 'projects' | 'milestones' | 'meta' | 'queue';
let dbp: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => { for (const s of ['tasks', 'projects', 'milestones', 'meta'] as const) req.result.createObjectStore(s, { keyPath: 'id' }); req.result.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
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
