import type { AgentScope, Horizon, Project, Settings, Task } from '../../shared/types.ts';

// Pure rules for the agent API (Kelly). No Worker imports, so scripts/agent.test.ts runs them directly.
export const AGENT_SCOPES = ['compass:read.tasks', 'compass:write.tasks', 'compass:read.projects'] as const satisfies readonly AgentScope[];
export const MAX_CALLS_PER_MINUTE = 60;
export const MAX_WRITES_PER_HOUR = 30;

/** Kelly may act only when switched on and the scope is listed. */
// Defensive: a hand-edited settings row (the only way to change it for now) must mean "off", never a 500.
export const allowed = (k: Settings['kelly'] | undefined, scope: AgentScope): boolean => k?.enabled === true && Array.isArray(k.scopes) && k.scopes.includes(scope);

/**
 * What an outside app may see: a task with no project only if it is personal; otherwise only a live project with a cloud boundary.
 * `project` is the task's project row (null when it has none, or it is missing).
 */
export function shared(item: Pick<Task, 'kind' | 'project_id'>, project: Pick<Project, 'data_boundary' | 'deleted_at'> | null): boolean {
  if (!item.project_id) return item.kind === 'personal';
  return !!project && !project.deleted_at && project.data_boundary === 'cloud';
}

export interface NewTask { title: string; due_at: string | null; horizon: Horizon; project_id: string | null; notes: string | null }
export function parseNewTask(body: unknown): NewTask | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 120) return { error: 'title must be 1 to 120 characters' };
  let due_at: string | null = null;
  if (b.due_at !== undefined && b.due_at !== null) {
    if (typeof b.due_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.due_at) || new Date(b.due_at + 'T00:00:00Z').toISOString().slice(0, 10) !== b.due_at) return { error: 'due_at must be a date (YYYY-MM-DD)' };
    due_at = b.due_at;
  }
  const horizon = b.horizon ?? 'short';
  if (horizon !== 'short' && horizon !== 'medium' && horizon !== 'long') return { error: 'horizon must be short, medium or long' };
  let project_id: string | null = null;
  if (b.project_id !== undefined && b.project_id !== null) {
    if (typeof b.project_id !== 'string' || !b.project_id || b.project_id.length > 40) return { error: 'project_id must be an id' };
    project_id = b.project_id;
  }
  let notes: string | null = null;
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'string' || b.notes.length > 2000) return { error: 'notes must be text of 2000 characters at most' };
    notes = b.notes.trim() || null;
  }
  return { title, due_at, horizon, project_id, notes };
}

/** Counts include the call being made (its own row is written after the check): the 60th call in a minute passes, the 61st does not. */
export function overLimit(callsLastMinute: number, writesLastHour: number, isWrite: boolean): 'rate' | 'writes' | null {
  if (callsLastMinute > MAX_CALLS_PER_MINUTE) return 'rate';
  if (isWrite && writesLastHour > MAX_WRITES_PER_HOUR) return 'writes';
  return null;
}
