import type { Task, Project } from '../../shared/types.ts';

export interface Query { words: string[]; status?: string; kind?: string; project?: string; horizon?: string; due?: string; tag?: string }

export function parseQuery(q: string): Query {
  const out: Query = { words: [] };
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(status|kind|project|horizon|due|tag):(.+)$/i);
    if (m) (out as unknown as Record<string, unknown>)[m[1].toLowerCase()] = m[2].toLowerCase(); else out.words.push(tok.toLowerCase());
  }
  return out;
}

export function applyQuery(tasks: Task[], q: Query, projects: Pick<Project, 'id' | 'name'>[], today: string): Task[] {
  const pid = q.project ? projects.find((p) => p.name.toLowerCase().startsWith(q.project!))?.id ?? '__none__' : null;
  return tasks.filter((t) => {
    if (t.deleted_at) return false;
    if (q.status === 'all') { /* any */ } else if (q.status) { if (t.status !== q.status) return false; } else if (t.status === 'done') return false;
    if (q.kind && t.kind !== q.kind) return false;
    if (pid && t.project_id !== pid) return false;
    if (q.horizon && t.horizon !== q.horizon) return false;
    if (q.tag && !JSON.parse(t.tags || '[]').map((x: string) => x.toLowerCase()).includes(q.tag)) return false;
    if (q.due) {
      if (q.due === 'overdue') { if (!t.due_at || t.due_at >= today) return false; }
      else if (q.due === 'none') { if (t.due_at) return false; }
      else { const m = q.due.match(/^([<>]=?)?(\d{4}-\d{2}-\d{2})$/); if (!m || !t.due_at) return false; const op = m[1] ?? '='; const d = m[2];
        if (op === '<' ? !(t.due_at < d) : op === '<=' ? !(t.due_at <= d) : op === '>' ? !(t.due_at > d) : op === '>=' ? !(t.due_at >= d) : t.due_at !== d) return false; }
    }
    return q.words.every((w) => t.title.toLowerCase().includes(w));
  });
}

/** What a task list shows: its open tasks (at most `limit`), then the ones finished from it during this visit. */
export function arrange<T extends { id: string; status: string }>(tasks: T[], finished: ReadonlySet<string>, limit = Infinity): { shown: T[]; open: number } {
  const open = tasks.filter((t) => t.status !== 'done');
  return { shown: [...open.slice(0, limit), ...tasks.filter((t) => t.status === 'done' && finished.has(t.id))], open: open.length };
}

type PathMs = { id: string; due_at: string | null; done_at: string | null; sort: number };
/** The milestone line's points: by date (undated last), done / next (the first open one) / ahead; more than `max` shows `max` around today. */
export function pathMilestones<M extends PathMs>(ms: M[], today: string, max = 6): { m: M; state: 'done' | 'next' | 'ahead' }[] {
  const sorted = [...ms].sort((a, b) => (a.due_at ?? '9') < (b.due_at ?? '9') ? -1 : (a.due_at ?? '9') > (b.due_at ?? '9') ? 1 : a.sort - b.sort);
  const next = sorted.findIndex((m) => !m.done_at);
  const all = sorted.map((m, i) => ({ m, state: m.done_at ? 'done' as const : i === next ? 'next' as const : 'ahead' as const }));
  if (all.length <= max) return all;
  let at = sorted.findIndex((m) => !m.due_at || m.due_at >= today);
  if (at < 0) at = sorted.length;
  const from = Math.min(Math.max(0, at - 2), sorted.length - max);
  return all.slice(from, from + max);
}
