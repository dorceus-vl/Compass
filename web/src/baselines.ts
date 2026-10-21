import { useCallback, useEffect, useRef, useState } from 'react';
import { api, SignedOut } from './api.ts';
import { idb } from './store/db.ts';
import { parseSnapshot, type Snapshot } from '../../shared/baseline.ts';

export interface BaselineInfo { id: string; project_id: string; name: string; taken_at: string; task_count: number; milestone_count: number }

/** Network first; the list is cached in IndexedDB `meta` (`baselines:<project>`) and shown, marked offline, when the network fails. Same idea as `useGov`. */
export function useBaselines(projectId: string): { items: BaselineInfo[]; offline: boolean; loaded: boolean; reload: () => Promise<void> } {
  const [s, set] = useState<{ items: BaselineInfo[]; offline: boolean; loaded: boolean }>({ items: [], offline: false, loaded: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current, id = `baselines:${projectId}`;
    if (!projectId || projectId.startsWith('tmp-')) { set({ items: [], offline: false, loaded: true }); return; } // none, or not on the server yet
    try {
      const { baselines } = await api<{ baselines: BaselineInfo[] }>(`/projects/${projectId}/baselines`);
      await idb.put('meta', { id, items: baselines, at: new Date().toISOString() }).catch(() => {});
      if (mine === seq.current) set({ items: baselines, offline: false, loaded: true });
    } catch (e) {
      if (e instanceof SignedOut) return;
      const c = await idb.get<{ items: BaselineInfo[] }>('meta', id).catch(() => undefined);
      if (mine === seq.current) set({ items: c?.items ?? [], offline: true, loaded: true });
    }
  }, [projectId]);
  useEffect(() => { set({ items: [], offline: false, loaded: false }); void reload(); return () => { seq.current++; }; }, [reload]);
  return { ...s, reload };
}

/** A baseline's snapshot never changes, so a copy on the device is used first; otherwise it is fetched (and kept). null when it can't be had. */
export async function fetchSnapshot(id: string): Promise<Snapshot | null> {
  const key = `baseline:${id}`;
  const cached = await idb.get<{ snapshot: unknown }>('meta', key).catch(() => undefined);
  const hit = cached ? parseSnapshot(cached.snapshot) : null;
  if (hit) return hit;
  try {
    const { baseline } = await api<{ baseline: { snapshot: Snapshot } }>(`/baselines/${id}`);
    await idb.put('meta', { id: key, snapshot: baseline.snapshot }).catch(() => {});
    return parseSnapshot(baseline.snapshot);
  } catch (e) { if (e instanceof SignedOut) throw e; return null; }
}
