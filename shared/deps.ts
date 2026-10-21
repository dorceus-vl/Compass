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

// Checklists (v2.1, ruling V1, V4). `tasks.checklist` is a JSON array of { id, text, done }.
export const MAX_CHECKLIST = 50;
export const MAX_CHECKLIST_TEXT = 200;
export type ChecklistItem = { id: string; text: string; done: boolean };

/** The items in a `checklist` value (JSON text, an array or empty): [] when none, null when it is not valid (more than 50 items, text empty or over 200 characters, a repeated id, `done` not a boolean). */
export function parseChecklist(v: unknown): ChecklistItem[] | null {
  if (v === null || v === undefined || v === '') return [];
  let a: unknown = v;
  if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(a) || a.length > MAX_CHECKLIST) return null;
  const ids = new Set<string>();
  for (const x of a) {
    if (!x || typeof x !== 'object') return null;
    const { id, text, done } = x as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id.length > 64 || ids.has(id)) return null;
    if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_CHECKLIST_TEXT || typeof done !== 'boolean') return null;
    ids.add(id);
  }
  return a.map((x) => { const { id, text, done } = x as ChecklistItem; return { id, text, done }; });
}

/** "3/5" for a card: null when the task has no (valid) checklist. */
export function checklistProgress(v: unknown): { done: number; total: number } | null {
  const items = parseChecklist(v);
  return items && items.length ? { done: items.filter((i) => i.done).length, total: items.length } : null;
}

/** The same checklist with every item unticked (a recurring task's next occurrence, V4); null stays null. */
export function untickChecklist(v: string | null): string | null {
  const items = parseChecklist(v);
  return items && items.length ? JSON.stringify(items.map((i) => ({ ...i, done: false }))) : null;
}

/**
 * Should the open checklist take the `checklist` value now on the task row? Only a value we have not seen: `seen` holds the value the sheet
 * opened with and every value we sent or adopted, so a reply to an older PATCH (offline replay, a PATCH for another field still in flight)
 * never puts an earlier list over the one on the screen. Never while an edit of ours is waiting to be sent.
 */
export function shouldAdoptChecklist(prop: string | null, seen: ReadonlySet<string | null>, pending: boolean): boolean {
  return !pending && !seen.has(prop || null);
}
