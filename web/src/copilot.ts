import type { AiMessage, AiThread, Provider } from '../../shared/types.ts';
import type { PresetId } from '../../shared/presets.ts';
import { api } from './api.ts';
import { idb } from './store/db.ts';

export interface Usage { month_cost_micro: number; cap_micro: number; keys: Record<Provider, boolean>; models: Record<Provider, string> }
export interface AskBody { thread_id?: string; document_ids?: string[]; project_id?: string; kind?: 'work'; provider?: Provider; message?: string; preset?: PresetId; page?: string; rerun?: boolean; knowledge?: { collections: 'all' | string[] } }
export type SavedMessage = AiMessage & { project_id: string | null; thread_title: string };

// Last copy of what was read, in IndexedDB `meta`, so threads and the open conversation can be read offline.
const cacheGet = async <T>(id: string) => (await idb.get<{ data: T }>('meta', id).catch(() => undefined))?.data;
const cachePut = (id: string, data: unknown) => idb.put('meta', { id, data, at: new Date().toISOString() }).catch(() => {});
/** Network first; the cached copy answers when the network fails. With no copy the original error stands. */
async function cached<T>(key: string, get: () => Promise<T>): Promise<T> {
  try { const data = await get(); await cachePut(key, data); return data; }
  catch (e) { const c = await cacheGet<T>(key); if (c !== undefined) return c; throw e; }
}

export async function ask(body: AskBody): Promise<{ thread: AiThread; messages: AiMessage[] }> {
  const r = await api<{ thread: AiThread; messages: AiMessage[] }>('/ai/chat', { method: 'POST', json: body });
  // Keep the offline copy of this conversation current (best effort).
  const prev = await cacheGet<{ thread: AiThread; messages: AiMessage[] }>(`copilot:thread:${r.thread.id}`);
  await cachePut(`copilot:thread:${r.thread.id}`, { thread: r.thread, messages: [...(prev?.messages ?? []), ...r.messages] });
  return r;
}
/** `project`: a project id, 'none' for personal threads, or omitted for all. The unfiltered list is cached. */
export const loadThreads = (project?: string | 'none') =>
  cached(project ? `copilot:threads:${project}` : 'copilot:threads', async () => (await api<{ threads: AiThread[] }>(`/ai/threads${project ? `?project=${encodeURIComponent(project)}` : ''}`)).threads);
export const loadThread = (id: string) => cached(`copilot:thread:${id}`, () => api<{ thread: AiThread; messages: AiMessage[] }>(`/ai/threads/${id}`));
export async function saveMessage(id: string, saved: boolean): Promise<AiMessage> {
  return (await api<{ message: AiMessage }>(`/ai/messages/${id}`, { method: 'PATCH', json: { saved: saved ? 1 : 0 } })).message;
}
export const loadSaved = () => cached('copilot:saved', async () => (await api<{ messages: SavedMessage[] }>('/ai/saved')).messages);
export const loadUsage = () => api<Usage>('/ai/usage');

/** A provider is usable when its key is set, or when the server is a local dev stub (which answers without keys). */
const dev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const providerReady = (u: Usage | null, p: Provider) => !u || u.keys[p] || dev;

export const usd = (micro: number, digits = 2) => `$${(micro / 1e6).toFixed(digits)}`;
export const spend = (u: Usage) => `${usd(u.month_cost_micro)} of $${+(u.cap_micro / 1e6).toFixed(2)}`;

/** Words of at least 3 letters, lower-cased. */
export const words = (q: string) => (q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
