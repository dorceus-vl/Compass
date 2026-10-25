import type { Program, ProgramDetail } from '../../shared/types.ts';
import { api, SignedOut } from './api.ts';
import { idb } from './store/db.ts';

// Programs (v2.4): network first, the answer cached in IndexedDB `meta` and shown, marked offline, when the network fails (like the Portfolio).
// Writes go straight to the API (online only) and refresh the cached list.

export const OFFLINE_LINE = "Programs can be changed when you're online";

/** Rethrows SignedOut (the app signs out); any other failure reads the cached copy. `data` is null when there is no copy either. */
async function cached<T>(id: string, fetcher: () => Promise<T>): Promise<{ data: T | null; offline: boolean }> {
  try {
    const data = await fetcher();
    await idb.put('meta', { id, data, at: new Date().toISOString() }).catch(() => {});
    return { data, offline: false };
  } catch (e) {
    if (e instanceof SignedOut) throw e;
    const c = await idb.get<{ data: T }>('meta', id).catch(() => undefined);
    return { data: c?.data ?? null, offline: true };
  }
}

export const loadPrograms = () => cached('programs', async () => (await api<{ programs: Program[] }>('/programs')).programs);
export const loadProgramDetail = (id: string) => cached(`program:${id}`, () => api<ProgramDetail>(`/programs/${id}/detail`));

const refresh = () => loadPrograms().catch(() => undefined);
export async function createProgram(body: { name: string; kind: Program['kind'] }): Promise<Program> {
  const { program } = await api<{ program: Program }>('/programs', { method: 'POST', json: body });
  await refresh();
  return program;
}
export async function updateProgram(id: string, patch: Partial<Pick<Program, 'name' | 'rag' | 'rag_reason' | 'notes' | 'sort'>>): Promise<Program> {
  const { program } = await api<{ program: Program }>(`/programs/${id}`, { method: 'PATCH', json: patch });
  await refresh();
  return program;
}
export async function trashProgram(id: string): Promise<void> {
  await api(`/programs/${id}`, { method: 'DELETE' });
  await idb.del('meta', `program:${id}`).catch(() => {});
  await refresh();
}
