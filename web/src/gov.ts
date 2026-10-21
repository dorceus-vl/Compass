import { useCallback, useEffect, useRef, useState } from 'react';
import { api, online, SignedOut } from './api.ts';
import { idb } from './store/db.ts';
import { toast } from './ui/dialogs.tsx';

export type GovPath = 'raid' | 'changes' | 'decisions' | 'lessons';

/** Network first; the answer is cached in IndexedDB `meta` (`gov:<project>:<path>`) and shown, marked offline, when the network fails (ruling R3). */
/** `loaded`: the first answer (network or cached copy) has come; `copy`: offline with a copy on the device (false when there is none to show). */
export function useGov<T>(projectId: string, path: GovPath): { items: T[]; offline: boolean; loaded: boolean; copy: boolean; reload: () => Promise<void> } {
  const [s, set] = useState<{ items: T[]; offline: boolean; loaded: boolean; copy: boolean }>({ items: [], offline: false, loaded: false, copy: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current, id = `gov:${projectId}:${path}`;
    if (projectId.startsWith('tmp-')) return; // not on the server yet
    try {
      const { items } = await api<{ items: T[] }>(`/projects/${projectId}/${path}`);
      await idb.put('meta', { id, items, at: new Date().toISOString() }).catch(() => {});
      if (mine === seq.current) set({ items, offline: false, loaded: true, copy: true });
    } catch (e) {
      if (e instanceof SignedOut) return;
      const c = await idb.get<{ items: T[] }>('meta', id).catch(() => undefined);
      if (mine === seq.current) set({ items: c?.items ?? [], offline: true, loaded: true, copy: !!c });
    }
  }, [projectId, path]);
  useEffect(() => { void reload(); return () => { seq.current++; }; }, [reload]);
  return { items: s.items, offline: s.offline, loaded: s.loaded, copy: s.copy, reload };
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

/**
 * Saver for one row: sends only a changed value (blank text becomes null). Inputs are uncontrolled and keyed on `k(field)`, which is
 * stable while the user types and changes only when a save was refused or a required field was blanked, so that one input is reset to the stored text.
 */
export function useRowSaver(path: GovPath, row: { id: string } & Record<string, unknown>, reload: () => Promise<void>, required: string[] = []) {
  const [rev, setRev] = useState<Record<string, number>>({});
  const revert = (key: string) => setRev((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
  const save = async (key: string, raw: string | number | null) => {
    const v = typeof raw === 'string' ? raw.trim() || null : raw;
    if (v === (row[key] ?? null)) return;
    if (v === null && required.includes(key)) { toast("This can't be empty"); revert(key); return; }
    if (await govPatch(path, row.id, { [key]: v })) await reload(); else revert(key);
  };
  return { save, k: (key: string) => `${row.id}:${key}:${rev[key] ?? 0}` };
}
