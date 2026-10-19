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
