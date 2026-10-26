// The widget writer (v2.3, ruling W2). Only in the iOS and Android shells (A3): builds the widget snapshot from the offline mirror (and the RAID and baseline copies
// the device already holds, so it works offline) and hands it to the shell, which writes it (iOS: the app group) and redraws the widgets.
// When: at start, when the app comes to the front, and after every change to the mirror (a sync pull, a local edit), at most once every 2 seconds.
// Settings come from the server when online and are kept in `meta` (`widget-settings`) so the file is still right offline.
import { api, online } from './api.ts';
import { idb } from './store/db.ts';
import { onChange } from './store/sync.ts';
import { completeTask, resolveId, startTimer, stopTimer } from './store/useStore.ts';
import { inWidgetShell, nativeDevice, setWidgetToken, takeWidgetTicks, updateWidgets } from './native.ts';
import { buildWidgetSnapshot } from '../../shared/widget-snapshot.ts';
import { localDay } from '../../shared/dashboard.ts';
import { parseSnapshot, type Snapshot } from '../../shared/baseline.ts';
import { DEFAULT_SETTINGS, type Milestone, type Project, type RaidItem, type Settings, type Task, type TimeEntry } from '../../shared/types.ts';
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
/** Builds and sends the snapshot now. Skipped when nothing but the time of day changed. */
export async function writeWidgets(): Promise<void> {
  if (!inWidgetShell()) return;
  const mine = gen;
  const [tasks, projects, milestones, time, s] = await Promise.all([idb.all<Task>('tasks'), idb.all<Project>('projects'), idb.all<Milestone>('milestones'), idb.all<TimeEntry>('time'), readSettings()]);
  const snap = buildWidgetSnapshot({ tasks, projects, milestones, time, ...(await readCaches(projects)), tz: s.tz, hide_work_on_lock: s.hide_work_on_lock, now: new Date() });
  const same = JSON.stringify({ ...snap, at: localDay(snap.at, s.tz) }); // a new day is a change: the widgets must stop saying "open Compass to update"
  if (same === lastJson || mine !== gen) return;
  if (await updateWidgets(JSON.stringify(snap))) lastJson = same;
}

/** What a widget couldn't deliver (offline, revoked, over the limit, a task the server didn't know yet) goes through the normal offline queue, which knows unsynced ids;
 *  a task already done, or truly gone from the device, is dropped here. In order: a done tick completes the task; a timer `start` starts one (a second timer on the task
 *  or the five-timer limit is the server's 409, which the queue drops quietly); a `stop` stops the task's running timer if it started at or before the tap (else the stop is stale
 *  and dropped), even on a done task; with nothing running it does nothing.
 *  Timer actions keep the tap time (`at`), which the server clamps. */
async function sendTicks(): Promise<void> {
  for (const t of await takeWidgetTicks()) {
    const id = await resolveId('tasks', t.id).catch(() => t.id);
    const cur = await idb.get<Task>('tasks', id).catch(() => undefined);
    if (!cur || cur.deleted_at || (cur.status === 'done' && t.action !== 'stop')) continue; // a stop still lands on a done task's timer
    if (!t.action) await completeTask(t.id).catch(() => {});
    else {
      const run = (await idb.all<TimeEntry>('time').catch(() => [] as TimeEntry[])).find((e) => e.task_id === id && !e.ended_at && !e.deleted_at);
      if (t.action === 'stop') { if (run && run.started_at <= t.at) await stopTimer(run.id, t.at).catch(() => {}); }
      else if (!run) await startTimer({ task_id: id }, 'widget', t.at).catch(() => {});
    }
  }
}

/** Starts the writer; does nothing outside the iOS and Android shells. Returns the stop function. */
export function startWidgetWriter(): () => void {
  if (!inWidgetShell()) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void writeWidgets().catch(() => {}), DEBOUNCE_MS); };
  const front = () => { if (document.visibilityState === 'visible') void sendTicks().then(soon, soon); };
  const off = onChange(soon);
  document.addEventListener('visibilitychange', front);
  front();
  return () => { gen++; clearTimeout(timer); off(); document.removeEventListener('visibilitychange', front); };
}

/** The name this device's tick token carries on the server ("iPhone app", "iPad app", "Android app"). */
export const widgetDeviceName = () => { const d = nativeDevice(); return d?.platform === 'android' ? 'Android app' : `${d?.label ?? 'iPhone'} app`; };

/** Explicit sign-out, while the session is still valid: revoke this device's tick token on the server. Best effort: a failure never blocks sign-out. */
export async function revokeWidgetToken(): Promise<void> {
  if (!inWidgetShell() || !online()) return;
  try {
    const { tokens } = await api<{ tokens: { id: string; device_name: string }[] }>('/widget/tokens');
    for (const t of tokens.filter((x) => x.device_name === widgetDeviceName())) await api(`/widget/token/${t.id}`, { method: 'DELETE' }).catch(() => {});
  } catch { /* offline or already signed out: the token stays listed in Settings -> Widgets and can be revoked there */ }
}

/** Signed out: the widgets go back to "Open Compass once", and the tick token goes with the session. */
export async function clearWidgets(): Promise<void> {
  lastJson = ''; gen++;
  await updateWidgets('');
  await setWidgetToken(null).catch(() => {});
  await takeWidgetTicks().catch(() => []); // the queued tick ids go too
}
