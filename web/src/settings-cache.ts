import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types.ts';
import { api } from './api.ts';
import { idb } from './store/db.ts';

type Bits = { tz: string; dayHours: number };
const KEY = 'settings:tz'; // the meta row predates day_hours; it now carries both

/** settings.tz (what "today" and "this week" mean) and workload.day_hours (what "1d" means); the last copy is kept for offline use. */
export function useSettingsBits(): Bits {
  const [s, set] = useState<Bits>({ tz: DEFAULT_SETTINGS.tz, dayHours: DEFAULT_SETTINGS.workload.day_hours });
  useEffect(() => {
    let live = true;
    void idb.get<{ tz: string; dayHours?: number }>('meta', KEY).then((c) => { if (live && c) set((x) => ({ tz: c.tz, dayHours: c.dayHours ?? x.dayHours })); }).catch(() => {});
    api<Settings>('/settings').then((r) => {
      if (!live) return;
      const next = { tz: r.tz, dayHours: r.workload?.day_hours ?? DEFAULT_SETTINGS.workload.day_hours };
      set(next);
      void idb.put('meta', { id: KEY, ...next }).catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return s;
}
