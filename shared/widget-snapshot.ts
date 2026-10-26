// The widget snapshot (v2.3, ruling W1). Pure: the web app builds it on the device from the offline mirror and hands it to the iOS shell,
// which writes it into the App Group for the WidgetKit extension. Widgets never touch the network to read it.
// Privacy rules: no notes, checklists or people; a task or project of an Offline-only project has `title`/`name` null everywhere (it is counted, never named);
// the cap on each list keeps the file far under the 64 KB the bridge accepts. `lock.hide_work` tells the Lock Screen widgets to show "Work task".
import { blockedIds } from './deps.ts';
import { addDaysYmd, daysBetweenYmd, weekStart, localDay, dashboardMetrics, riskMatrix, type DRaid } from './dashboard.ts';
import { slip, type Snapshot } from './baseline.ts';
import type { Horizon, Milestone, Project, Rag, Task, TimeEntry } from './types.ts';

export const MAX_ITEMS = 20, MAX_PROJECTS = 10, WEEK_DAYS = 7, MAX_TIMERS = 5;
export const PER_HORIZON = 5; // ponytail: what a large widget can draw; the full list is `items`
export const MAX_SNAPSHOT_BYTES = 64 * 1024;
const TITLE_CHARS = 120;

export interface WidgetItem { id: string; title: string | null; due_label: string; late: boolean; horizon: Horizon; work: boolean; offline: boolean; project: string | null; timer_running: boolean }
/** A running timer (v2.5 Task 4): a task's (`task_id`) or a project's (null). `title` follows the items' fail-closed rule; never a note. */
export interface WidgetTimer { id: string; task_id: string | null; title: string | null; started_at: string; work: boolean }
export interface WidgetProject {
  id: string; name: string | null; rag: Rag; pct: number;
  next_milestone: { name: string | null; late_days: number } | null;
  slip_days: number | null; high_risks: number | null; overdue: number; work: boolean; offline: boolean;
}
export interface WidgetSnapshot {
  v: 1; at: string; tz: string;
  today: { due: number; late: number; done: number; total: number; next: WidgetItem | null };
  items: WidgetItem[];
  timers: WidgetTimer[];
  horizons: Record<Horizon, WidgetItem[]>;
  blocked: number;
  projects: WidgetProject[];
  week: { day: string; short: number; medium: number; long: number }[];
  lock: { hide_work: boolean };
}

export interface WidgetInput {
  tasks: Task[]; projects: Project[]; milestones: Milestone[];
  /** Cached RAID items per project id (what the device already holds); a project with none cached reports `high_risks: null`. */
  raid?: Record<string, DRaid[]>;
  /** The latest baseline's snapshot per project id; a project with none reports `slip_days: null`. */
  baselines?: Record<string, Snapshot>;
  /** The device's time entries; only running ones (no end, not trashed) reach the snapshot. */
  time?: TimeEntry[];
  tz: string; hide_work_on_lock: boolean; now: Date;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The short label a widget shows beside a task (the same words as the app's lists: Today, Tomorrow, a weekday within a week, else "Oct 30"; late ones "Yesterday", "3d late"). */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return '';
  const d = due.slice(0, 10), diff = daysBetweenYmd(today, d);
  if (diff < 0) return diff === -1 ? 'Yesterday' : `${-diff}d late`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const [, m, day] = d.split('-').map(Number);
  return diff < 7 ? WEEKDAY[new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay()]! : `${MONTH[m! - 1]} ${day}`;
}

export function buildWidgetSnapshot(i: WidgetInput): WidgetSnapshot {
  const { tz } = i;
  const today = localDay(i.now.toISOString(), tz);
  const liveProjects = i.projects.filter((p) => !p.deleted_at);
  const byProject = new Map(liveProjects.map((p) => [p.id, p]));
  const top = i.tasks.filter((t) => !t.deleted_at && !t.parent_id);
  const blocked = blockedIds(i.tasks);
  // Fail closed: a task is named only when it has no project, or its project is on the device, live and Cloud. An Offline-only project, a trashed one
  // (trashing a project leaves its tasks in the mirror) and one not pulled yet all give "counted, never named". Today still lists such tasks, so they stay in the counts.
  const offlineTask = (t: Task) => !!t.project_id && byProject.get(t.project_id)?.data_boundary !== 'cloud';
  const running = (i.time ?? []).filter((e) => !e.ended_at && !e.deleted_at);
  const timing = new Set(running.map((e) => e.task_id));
  const item = (t: Task): WidgetItem => {
    const off = offlineTask(t), due = t.due_at?.slice(0, 10) ?? null;
    return { id: t.id, title: off ? null : t.title.slice(0, TITLE_CHARS), due_label: dueLabel(due, today), late: !!due && due < today, horizon: t.horizon, work: t.kind === 'work', offline: off, project: t.project_id, timer_running: timing.has(t.id) };
  };
  // Timers: the same rule. A task entry is named like its task (a task not on the device: never named); a project entry by its project's name while that project
  // is live and Cloud. An entry on a trashed task, or on a task or project in Trash, is left out.
  const tasksById = new Map(i.tasks.map((t) => [t.id, t]));
  const trashedProject = (id: string | null) => !!id && i.projects.some((p) => p.id === id && p.deleted_at);
  const timers = running.flatMap((e): WidgetTimer[] => {
    let title: string | null = null;
    if (e.task_id) {
      const t = tasksById.get(e.task_id);
      if (t && (t.deleted_at || trashedProject(t.project_id))) return [];
      if (t && !offlineTask(t)) title = t.title.slice(0, TITLE_CHARS);
    } else {
      if (trashedProject(e.project_id)) return [];
      const p = e.project_id ? byProject.get(e.project_id) : undefined;
      if (p && p.data_boundary === 'cloud') title = p.name.slice(0, TITLE_CHARS);
    }
    return [{ id: e.id, task_id: e.task_id, title, started_at: e.started_at, work: e.kind === 'work' }];
  }).sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0)).slice(0, MAX_TIMERS);
  const byDue = (a: Task, b: Task) => (a.due_at ?? '9') < (b.due_at ?? '9') ? -1 : (a.due_at ?? '9') > (b.due_at ?? '9') ? 1 : a.sort_in_column - b.sort_in_column || (a.id < b.id ? -1 : 1);
  const open = top.filter((t) => t.status !== 'done');
  const ready = open.filter((t) => !blocked.has(t.id)).sort(byDue); // blocked ones are counted apart, like Today's own list

  const dueNow = ready.filter((t) => t.due_at && t.due_at.slice(0, 10) <= today);
  const late = dueNow.filter((t) => t.due_at!.slice(0, 10) < today);
  const doneToday = top.filter((t) => t.status === 'done' && t.done_at && localDay(t.done_at, tz) === today).length;
  const next = dueNow.find((t) => t.due_at!.slice(0, 10) === today) ?? dueNow[0];

  const hz = (h: Horizon) => ready.filter((t) => t.horizon === h).slice(0, PER_HORIZON).map(item);
  const mon = weekStart(today);
  const week = Array.from({ length: WEEK_DAYS }, (_, n) => {
    const day = addDaysYmd(mon, n), on = ready.filter((t) => t.due_at?.slice(0, 10) === day);
    return { day, short: on.filter((t) => t.horizon === 'short').length, medium: on.filter((t) => t.horizon === 'medium').length, long: on.filter((t) => t.horizon === 'long').length };
  });

  const projects = liveProjects.filter((p) => p.status !== 'closed').sort((a, b) => a.sort - b.sort || (a.created_at < b.created_at ? -1 : 1)).slice(0, MAX_PROJECTS).map((p): WidgetProject => {
    const off = p.data_boundary !== 'cloud';
    const mine = top.filter((t) => t.project_id === p.id);
    const doneN = mine.filter((t) => t.status === 'done').length;
    const m = i.milestones.filter((x) => x.project_id === p.id && !x.deleted_at && !x.done_at && x.due_at).sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))[0];
    const raid = i.raid?.[p.id], base = i.baselines?.[p.id];
    const metrics = dashboardMetrics({ tasks: mine, raid: raid ?? [], project: p, today, tz });
    return {
      id: p.id, name: off ? null : p.name.slice(0, TITLE_CHARS), rag: p.rag, pct: mine.length ? Math.round((100 * doneN) / mine.length) : 0,
      next_milestone: m ? { name: off ? null : m.name.slice(0, TITLE_CHARS), late_days: Math.max(0, daysBetweenYmd(m.due_at!.slice(0, 10), today)) } : null,
      slip_days: base ? slip(base, i.tasks.filter((t) => t.project_id === p.id), i.milestones.filter((x) => x.project_id === p.id), p).summary.max_late : null,
      high_risks: raid ? riskMatrix(raid).high : null, overdue: metrics.overdue_now, work: p.kind === 'work', offline: off,
    };
  });

  return {
    v: 1, at: i.now.toISOString(), tz,
    today: { due: dueNow.length, late: late.length, done: doneToday, total: dueNow.length + doneToday, next: next ? item(next) : null },
    items: ready.slice(0, MAX_ITEMS).map(item),
    timers,
    horizons: { short: hz('short'), medium: hz('medium'), long: hz('long') },
    blocked: open.filter((t) => blocked.has(t.id)).length,
    projects, week, lock: { hide_work: i.hide_work_on_lock },
  };
}
