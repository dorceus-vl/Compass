// Single user, last write wins by updated_at (spec §8). Pulls are incremental, so a row missing remotely is kept.
export function mergeRows<T extends { id: string; updated_at: string }>(local: T[], remote: T[]): T[] {
  const out = new Map(local.map((r) => [r.id, r]));
  for (const r of remote) { const l = out.get(r.id); if (!l || r.updated_at >= l.updated_at) out.set(r.id, r); }
  return [...out.values()];
}

type Row = { id: string; updated_at: string; deleted_at?: string | null };

/** Remote rows that replace the local copy: new rows, and rows at least as new (the same rule as mergeRows). */
export function remoteWins<T extends Row>(local: T[], remote: T[]): T[] {
  const l = new Map(local.map((r) => [r.id, r]));
  return remote.filter((r) => { const x = l.get(r.id); return !x || r.updated_at >= x.updated_at; });
}

/**
 * What a pull writes, so it never rewrites rows it did not change.
 * - Local `tmp-` rows survive only while a queued create (`claimed`) still owns them; any other is a phantom.
 * - `complete`: the remote list is the whole truth (projects, milestones), so non-tmp rows missing remotely were trashed elsewhere.
 * - Remote rows with `deleted_at` (trashed elsewhere) are deleted locally, never stored.
 */
export function planPull<T extends Row>(local: T[], remote: T[], claimed: Set<string>, complete: boolean): { put: T[]; del: string[] } {
  const del = new Set<string>(), seen = new Set(remote.map((r) => r.id)), kept: T[] = [];
  for (const r of local) {
    if (r.id.startsWith('tmp-') ? !claimed.has(r.id) : complete && !seen.has(r.id)) del.add(r.id); else kept.push(r);
  }
  for (const r of remote) if (r.deleted_at) del.add(r.id);
  return { put: remoteWins(kept, remote.filter((r) => !r.deleted_at)), del: [...del] };
}

/** Temporary ids of offline creates: `tmp-` + a UUID. */
const TMP = /tmp-[0-9a-f-]{36}/g;
export const tmpIds = (s: string): string[] => s.match(TMP) ?? [];
export const rewriteTmp = (s: string, map: Record<string, string>): string => s.replace(TMP, (m) => map[m] ?? m);
