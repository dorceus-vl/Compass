import type { Project, Task } from '../../shared/types.ts';
import { fmtDue } from './dates.ts';

/** Same rule as worker/lib/agent.ts `shared`: a task with no project only if personal; otherwise only in a live cloud project. */
const shared = (t: Task, p: Project | undefined) => (t.project_id ? !!p && !p.deleted_at && p.data_boundary === 'cloud' : t.kind === 'personal');

/** Open tasks due today or earlier, oldest first, from shared and personal items only (`projectId` narrows to one project). */
export function dueItems(tasks: Task[], projects: Project[], t: string, projectId?: string): Task[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return tasks
    .filter((x) => !x.deleted_at && x.status !== 'done' && !!x.due_at && x.due_at <= t && (!projectId || x.project_id === projectId) && shared(x, x.project_id ? byId.get(x.project_id) : undefined))
    .sort((a, b) => (a.due_at! < b.due_at! ? -1 : a.due_at! > b.due_at! ? 1 : a.title.localeCompare(b.title)));
}

const late = (due: string, t: string) => {
  const s = fmtDue(due, t).text;
  return s === 'Today' ? 'due today' : s === 'Yesterday' ? 'due yesterday' : s.replace(/^(\d+)d late$/, (_, n) => `${n} days late`);
};

/** Her opening line, built on the device (no model call): the part of the day, then up to two things that need Vlad. */
export function athenaGreeting(hour: number, items: Task[], t: string, scope = ''): string {
  const hi = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, Vlad.`;
  if (!items.length) return `${hi} Nothing is due or overdue${scope}. Bring me an email, a status update, a spreadsheet or any document, and I'll make it sharper and tell you what I'd watch out for.`;
  const named = items.slice(0, 2).map((x) => `"${x.title}" (${late(x.due_at!, t)})`).join(' and ');
  const more = items.length > 2 ? `, and ${items.length - 2} more` : '';
  return `${hi} ${items.length === 1 ? 'One item needs you' : `${items.length} items need you`}${scope}: ${named}${more}. Want to start there, or bring me something to polish?`;
}
