// Single user, last write wins by updated_at (spec §8). Pulls are incremental, so a row missing remotely is kept.
export function mergeRows<T extends { id: string; updated_at: string }>(local: T[], remote: T[]): T[] {
  const out = new Map(local.map((r) => [r.id, r]));
  for (const r of remote) { const l = out.get(r.id); if (!l || r.updated_at >= l.updated_at) out.set(r.id, r); }
  return [...out.values()];
}

/** For lists the server returns in full (projects, milestones): a local row absent remotely was trashed elsewhere, unless it is an unsent `tmp-` create. */
export function mergeComplete<T extends { id: string; updated_at: string }>(local: T[], remote: T[]): T[] {
  const ids = new Set(remote.map((r) => r.id));
  return mergeRows(local.filter((r) => r.id.startsWith('tmp-') || ids.has(r.id)), remote);
}

/** Temporary ids of offline creates: `tmp-` + a UUID. */
const TMP = /tmp-[0-9a-f-]{36}/g;
export const tmpIds = (s: string): string[] => s.match(TMP) ?? [];
export const rewriteTmp = (s: string, map: Record<string, string>): string => s.replace(TMP, (m) => map[m] ?? m);
