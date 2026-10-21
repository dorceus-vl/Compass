// Task dependencies (v2.1, rulings V1 to V3). `tasks.blocked_by` is a JSON array of task ids; "blocks" is computed, never stored.
export const MAX_BLOCKERS = 20;

/** The ids in a `blocked_by` value (JSON text, an array or empty): [] when none, null when it is not a valid list (more than 20, a duplicate, a non-text id). */
export function parseBlockedBy(v: unknown): string[] | null {
  if (v === null || v === undefined || v === '') return [];
  let a: unknown = v;
  if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(a) || a.length > MAX_BLOCKERS) return null;
  if (!a.every((x) => typeof x === 'string' && x !== '' && x.length <= 64)) return null;
  return new Set(a).size === a.length ? (a as string[]) : null;
}

/** Would "`from` is blocked by `to`" make a loop? `graph` maps a task id to the ids it waits on. Walks from `to` through its blockers looking for `from`. */
export function wouldCycle(graph: ReadonlyMap<string, readonly string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>(), stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue; // also stops on a loop that already exists elsewhere
    seen.add(id);
    stack.push(...(graph.get(id) ?? []));
  }
  return false;
}

type Row = { status: string; deleted_at?: string | null };
/** Blocked = any blocker is a live, open task. A done, trashed or missing blocker no longer blocks (V2, V3); a finished task is never blocked. */
export function isBlocked(task: { blocked_by: string | null; status?: string }, byId: ReadonlyMap<string, Row>): boolean {
  if (task.status === 'done') return false;
  return (parseBlockedBy(task.blocked_by) ?? []).some((id) => { const b = byId.get(id); return !!b && !b.deleted_at && b.status !== 'done'; });
}

/** The live, open tasks a task still waits on. */
export function openBlockers<T extends Row & { id: string }>(task: { blocked_by: string | null }, byId: ReadonlyMap<string, T>): T[] {
  return (parseBlockedBy(task.blocked_by) ?? []).flatMap((id) => { const b = byId.get(id); return b && !b.deleted_at && b.status !== 'done' ? [b] : []; });
}

/** The live tasks that wait on `id` (the "Blocks" list). */
export function blocksOf<T extends { id: string; blocked_by: string | null; deleted_at?: string | null }>(id: string, tasks: readonly T[]): T[] {
  return tasks.filter((t) => !t.deleted_at && (parseBlockedBy(t.blocked_by) ?? []).includes(id));
}

/** Ids of the open tasks that are blocked, from the whole list (what a view needs to draw its chips and groups). */
export function blockedIds(tasks: readonly ({ id: string; blocked_by: string | null; status: string; deleted_at?: string | null })[]): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return new Set(tasks.filter((t) => !t.deleted_at && t.blocked_by && isBlocked(t, byId)).map((t) => t.id));
}
