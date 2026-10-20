import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { AthenaClip } from '../../shared/types.ts';

export interface AthenaMedia { clips: AthenaClip[]; portrait_id: string | null }
export const mediaUrl = (id: string) => `/api/athena/media/${id}`;

// One shared copy for the avatar, the rail icon and the Settings card; offline or signed out it stays null and the still stand-in shows.
let cur: AthenaMedia | null = null, started = false;
const subs = new Set<() => void>();
export function reloadAthenaMedia(): Promise<void> {
  started = true;
  return api<AthenaMedia>('/athena/clips').then((m) => { cur = m; subs.forEach((f) => f()); }).catch(() => { started = false; }); // offline or signed out: the next mount tries again
}
export function useAthenaMedia(): AthenaMedia | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (!started) void reloadAthenaMedia();
    return () => { subs.delete(f); };
  }, []);
  return cur;
}

export function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, set] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => set(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return r;
}
