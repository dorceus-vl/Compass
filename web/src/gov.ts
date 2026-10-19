import { useCallback, useEffect, useRef, useState } from 'react';
import { api, online, SignedOut } from './api.ts';
import { idb } from './store/db.ts';
import { toast } from './ui/dialogs.tsx';

export type GovPath = 'raid' | 'changes' | 'decisions' | 'lessons';

/** Network first; the answer is cached in IndexedDB `meta` (`gov:<project>:<path>`) and shown, marked offline, when the network fails (ruling R3). */
export function useGov<T>(projectId: string, path: GovPath): { items: T[]; offline: boolean; reload: () => Promise<void> } {
  const [s, set] = useState<{ items: T[]; offline: boolean }>({ items: [], offline: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current, id = `gov:${projectId}:${path}`;
    if (projectId.startsWith('tmp-')) return; // not on the server yet
    try {
      const { items } = await api<{ items: T[] }>(`/projects/${projectId}/${path}`);
      await idb.put('meta', { id, items, at: new Date().toISOString() }).catch(() => {});
      if (mine === seq.current) set({ items, offline: false });
    } catch (e) {
      if (e instanceof SignedOut) return;
      const c = await idb.get<{ items: T[] }>('meta', id).catch(() => undefined);
      if (mine === seq.current) set({ items: c?.items ?? [], offline: true });
    }
  }, [projectId, path]);
  useEffect(() => { void reload(); return () => { seq.current++; }; }, [reload]);
  return { items: s.items, offline: s.offline, reload };
}

/** Writes act online only: offline they say so and return null; a server refusal is toasted and returns null. */
async function write<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!online()) { toast('This needs a connection'); return null; }
  try { return await fn(); } catch (e) { if (!(e instanceof SignedOut)) toast((e as Error).message); return null; }
}
export const govCreate = <T>(projectId: string, path: GovPath, body: Record<string, unknown>) =>
  write(async () => (await api<{ item: T }>(`/projects/${projectId}/${path}`, { method: 'POST', json: body })).item);
export const govPatch = <T>(path: GovPath, id: string, body: Record<string, unknown>) =>
  write(async () => (await api<{ item: T }>(`/${path}/${id}`, { method: 'PATCH', json: body })).item);
export const govTrash = (path: GovPath, id: string) => write(async () => { await api(`/${path}/${id}`, { method: 'DELETE' }); return true; });

/** onBlur/onChange saver for one row: sends only a changed value (blank text becomes null, or is refused for a required field). */
export function rowSaver(path: GovPath, row: { id: string } & Record<string, unknown>, reload: () => Promise<void>, required: string[] = []) {
  return async (key: string, raw: string | number | null) => {
    const v = typeof raw === 'string' ? raw.trim() || null : raw;
    if (v === (row[key] ?? null)) return;
    if (v === null && required.includes(key)) { await reload(); return; } // put the old text back
    if (await govPatch(path, row.id, { [key]: v })) await reload();
  };
}
