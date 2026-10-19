import { useEffect, useSyncExternalStore } from 'react';
import type { InboxItem, MeetingReview, Task } from '../../shared/types.ts';
import { api, SignedOut } from './api.ts';
import { idb } from './store/db.ts';
import { pull } from './store/sync.ts';
import { toast } from './ui/dialogs.tsx';

// One shared list for the rail badge, Today's strip and the Inbox view. Online-only for actions (ruling P7); the last list is cached in IndexedDB meta.
interface S { items: InboxItem[]; loading: boolean; offline: boolean; known: boolean } // known: a list (cached or fresh) has been seen
let st: S = { items: [], loading: true, offline: false, known: false };
const subs = new Set<() => void>();
const set = (p: Partial<S>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const live = (xs: InboxItem[]) => xs.filter((i) => i.state === 'new' || i.state === 'added');

let inflight: Promise<void> | null = null;
let cached = false;
export function refreshInbox(): Promise<void> {
  return (inflight ??= (async () => {
    if (!cached) { // show the last list at once, before the network answers
      cached = true;
      const c = await idb.get<{ items: InboxItem[] }>('meta', 'cache:inbox').catch(() => undefined);
      if (c && st.loading) set({ items: live(c.items), known: true });
    }
    try {
      const items = live((await api<{ items: InboxItem[] }>('/inbox')).items);
      set({ items, loading: false, offline: false, known: true });
      await idb.put('meta', { id: 'cache:inbox', items, at: new Date().toISOString() }).catch(() => {});
    } catch (e) {
      if (!(e instanceof SignedOut)) set({ loading: false, offline: true });
    }
  })().finally(() => { inflight = null; }));
}

let timer: ReturnType<typeof setInterval> | undefined;
const wake = () => { if (!document.hidden) void refreshInbox(); };
function subscribe(l: () => void) {
  subs.add(l);
  if (subs.size === 1) { void refreshInbox(); timer = setInterval(wake, 60_000); document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake); }
  return () => {
    subs.delete(l);
    if (!subs.size) { clearInterval(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); }
  };
}

const tomorrow8 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.toISOString(); };
const drop = (id: string) => set({ items: st.items.filter((i) => i.id !== id) });
async function act<T>(id: string, path: string, json?: unknown): Promise<T | null> {
  if (!navigator.onLine || st.offline) { toast('The inbox needs a connection'); return null; }
  try { return await api<T>(`/inbox/${id}/${path}`, { method: 'POST', json }); }
  catch (e) { if (!(e instanceof SignedOut)) { toast((e as Error).message); void refreshInbox(); } return null; }
}

export async function keepItem(id: string): Promise<void> {
  if (!await act<{ item: InboxItem; task: Task }>(id, 'keep')) return;
  drop(id);
  await pull().catch(() => {}); // the new task shows at once
  void refreshInbox();
}
export async function dismissItem(id: string): Promise<boolean> {
  if (!await act(id, 'dismiss')) return false;
  drop(id);
  return true;
}
export async function snoozeItem(id: string, until: string = tomorrow8()): Promise<void> {
  if (await act(id, 'snooze', { until })) { drop(id); toast('Snoozed until tomorrow'); }
}

/** A meeting item's review id: the new review whose recording matches the item's ref; the /meetings list is the fallback. */
export async function reviewPath(item: InboxItem): Promise<string> {
  const rid = (item.ref ?? '').replace(/^sonarflow:recording:/, '');
  const { meetings } = await api<{ meetings: MeetingReview[] }>('/meetings?state=new').catch(() => ({ meetings: [] as MeetingReview[] }));
  const m = meetings.find((x) => x.recording_id === rid);
  return m ? `/meetings/${m.id}` : '/meetings';
}

/** Every meeting review, newest first. Online it also refreshes the IndexedDB copy (`cache:meetings`); offline (or on a network error) the last copy is returned with `offline: true`. */
export async function loadMeetings(): Promise<{ meetings: MeetingReview[]; offline: boolean; known: boolean }> {
  try {
    const { meetings } = await api<{ meetings: MeetingReview[] }>('/meetings?state=all');
    await idb.put('meta', { id: 'cache:meetings', meetings, at: new Date().toISOString() }).catch(() => {});
    return { meetings, offline: false, known: true };
  } catch (e) {
    if (e instanceof SignedOut) throw e;
    const c = await idb.get<{ meetings: MeetingReview[] }>('meta', 'cache:meetings').catch(() => undefined);
    return { meetings: c?.meetings ?? [], offline: true, known: !!c };
  }
}

export function useInbox() {
  const s = useSyncExternalStore(subscribe, () => st);
  useEffect(() => { void refreshInbox(); }, []); // a view that mounts later still gets a fresh list
  return { ...s, keep: keepItem, dismiss: dismissItem, snooze: snoozeItem };
}

/** Opens a task's sheet; a task made on the server may not be on this device yet, so pull first. */
export async function openTask(taskId: string, show: (id: string) => void): Promise<void> {
  if (!await idb.get('tasks', taskId).catch(() => undefined)) await pull().catch(() => {});
  show(taskId);
}

/** Only https links are ever rendered as links. */
export const safeUrl = (u: string | null): string | null => { try { return u && new URL(u).protocol === 'https:' ? u : null; } catch { return null; } };
