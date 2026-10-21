// The widget writer (v2.3, ruling W2). Only in the iOS shell: builds the widget snapshot from the offline mirror (and the RAID and baseline copies
// the device already holds, so it works offline) and hands it to the shell, which writes it into the app group and reloads the widgets.
// When: at start, when the app comes to the front, and after every change to the mirror (a sync pull, a local edit), at most once every 2 seconds.
// Settings come from the server when online and are kept in `meta` (`widget-settings`) so the file is still right offline.
import { api, online } from './api.ts';
import { idb } from './store/db.ts';
import { onChange } from './store/sync.ts';
import { completeTask } from './store/useStore.ts';
import { inIosShell, setWidgetToken, takeWidgetTicks, updateWidgets } from './native.ts';
import { buildWidgetSnapshot } from '../../shared/widget-snapshot.ts';
import { parseSnapshot, type Snapshot } from '../../shared/baseline.ts';
import { DEFAULT_SETTINGS, type Milestone, type Project, type RaidItem, type Settings, type Task } from '../../shared/types.ts';
import type { BaselineInfo } from './baselines.ts';

const DEBOUNCE_MS = 2000;
type WidgetSettings = { tz: string; hide_work_on_lock: boolean };

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; } }; // a bad zone would make every write throw

async function readSettings(): Promise<WidgetSettings> {
  if (online()) {
    try {
      const s = await api<Settings>('/settings');
      const w = { tz: validTz(s.tz) ? s.tz : DEFAULT_SETTINGS.tz, hide_work_on_lock: s.widgets?.hide_work_on_lock !== false };
      await idb.put('meta', { id: 'widget-settings', ...w }).catch(() => {});
      return w;
    } catch { /* offline or signed out: the copy below */ }
  }
  const c = await idb.get<WidgetSettings>('meta', 'widget-settings').catch(() => undefined);
  return { tz: c?.tz && validTz(c.tz) ? c.tz : DEFAULT_SETTINGS.tz, hide_work_on_lock: c?.hide_work_on_lock ?? true }; // hiding is the safe default
}

/** What the device already holds: cached RAID per project, and the latest baseline's snapshot per project. Never a network call. */
async function readCaches(projects: Project[]) {
  const raid: Record<string, RaidItem[]> = {}, baselines: Record<string, Snapshot> = {};
  for (const p of projects) {
    const r = await idb.get<{ items: RaidItem[] }>('meta', `gov:${p.id}:raid`).catch(() => undefined);
    if (r?.items) raid[p.id] = r.items;
    const list = await idb.get<{ items: BaselineInfo[] }>('meta', `baselines:${p.id}`).catch(() => undefined);
    const latest = [...(list?.items ?? [])].sort((a, b) => b.taken_at.localeCompare(a.taken_at))[0];
    const snap = latest && (await idb.get<{ snapshot: unknown }>('meta', `baseline:${latest.id}`).catch(() => undefined));
    const parsed = snap ? parseSnapshot(snap.snapshot) : null;
    if (parsed) baselines[p.id] = parsed;
  }
  return { raid, baselines };
}

let lastJson = '';
let gen = 0; // bumped by clearWidgets and by stopping, so a write already in flight doesn't land after them
/** Builds and sends the snapshot now. Skipped when nothing but the time changed. */
export async function writeWidgets(): Promise<void> {
  if (!inIosShell()) return;
  const mine = gen;
  const [tasks, projects, milestones, s] = await Promise.all([idb.all<Task>('tasks'), idb.all<Project>('projects'), idb.all<Milestone>('milestones'), readSettings()]);
  const snap = buildWidgetSnapshot({ tasks, projects, milestones, ...(await readCaches(projects)), tz: s.tz, hide_work_on_lock: s.hide_work_on_lock, now: new Date() });
  const same = JSON.stringify({ ...snap, at: '' });
  if (same === lastJson || mine !== gen) return;
  if (await updateWidgets(JSON.stringify(snap))) lastJson = same;
}

/** Ticks a widget queued while offline go through the normal offline queue (a task already done is left alone). */
async function sendTicks(): Promise<void> {
  for (const t of await takeWidgetTicks()) {
    const cur = await idb.get<Task>('tasks', t.id).catch(() => undefined);
    if (cur && cur.status !== 'done') await completeTask(t.id).catch(() => {});
  }
}

/** Starts the writer; does nothing outside the iOS shell. Returns the stop function. */
export function startWidgetWriter(): () => void {
  if (!inIosShell()) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void writeWidgets().catch(() => {}), DEBOUNCE_MS); };
  const front = () => { if (document.visibilityState === 'visible') void sendTicks().then(soon, soon); };
  const off = onChange(soon);
  document.addEventListener('visibilitychange', front);
  front();
  return () => { gen++; clearTimeout(timer); off(); document.removeEventListener('visibilitychange', front); };
}

/** Signed out: the widgets go back to "Open Compass once", and the tick token goes with the session. */
export async function clearWidgets(): Promise<void> {
  lastJson = ''; gen++;
  await updateWidgets('');
  await setWidgetToken(null).catch(() => {});
}
