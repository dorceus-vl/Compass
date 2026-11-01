// Work breakdown structure per project (v2.8). `projects.wbs` is a JSON array of WbsNode in outline order (a node's children follow it, deeper by one);
// `tasks.wbs_id` points a task at a node. Numbers (1, 1.1, 1.2.1) are computed, never stored, so moving a node renumbers the rest.
export type WbsNode = { id: string; title: string; depth: number };
export const MAX_WBS_NODES = 200;
export const MAX_WBS_DEPTH = 6; // 6 levels: depth 0 to 5
export const MAX_WBS_TITLE = 120;

const json = (v: unknown): unknown => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } };

/** The nodes in a `wbs` value (JSON text, an array or empty): [] when none, null when not valid (over 200, a repeated id, a title empty or over 120,
 *  the first node not at depth 0, a node more than one level deeper than the one before it, or deeper than 6 levels). */
export function parseWbs(v: unknown): WbsNode[] | null {
  if (v === null || v === undefined || v === '') return [];
  const a = json(v);
  if (!Array.isArray(a) || a.length > MAX_WBS_NODES) return null;
  const ids = new Set<string>();
  const out: WbsNode[] = [];
  for (const x of a) {
    if (!x || typeof x !== 'object') return null;
    const { id, title, depth } = x as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id.length > 64 || ids.has(id)) return null;
    if (typeof title !== 'string' || title.trim() === '' || title.length > MAX_WBS_TITLE) return null;
    if (!Number.isInteger(depth) || (depth as number) < 0 || (depth as number) >= MAX_WBS_DEPTH) return null;
    if ((depth as number) > (out.length ? out[out.length - 1].depth + 1 : 0)) return null;
    ids.add(id);
    out.push({ id, title, depth: depth as number });
  }
  return out;
}

/** "1", "1.1", "1.2", "2"… one per node, in order. */
export function numbers(nodes: WbsNode[]): string[] {
  const count: number[] = [];
  return nodes.map((n) => { count.length = n.depth + 1; count[n.depth] = (count[n.depth] ?? 0) + 1; return count.slice(0, n.depth + 1).map((c) => c || 1).join('.'); });
}

/** Index one past the last descendant of nodes[i]. */
const end = (nodes: WbsNode[], i: number) => { let j = i + 1; while (j < nodes.length && nodes[j].depth > nodes[i].depth) j++; return j; };
const save = (nodes: WbsNode[]) => (nodes.length ? JSON.stringify(nodes) : null);
export const stored = save;

/** A new node: the last child of `parentId`, or the last top-level node. null when full or too deep. */
export function addNode(nodes: WbsNode[], node: { id: string; title: string }, parentId: string | null): WbsNode[] | null {
  if (nodes.length >= MAX_WBS_NODES) return null;
  if (parentId === null) return [...nodes, { ...node, depth: 0 }];
  const i = nodes.findIndex((n) => n.id === parentId);
  if (i < 0 || nodes[i].depth + 1 >= MAX_WBS_DEPTH) return null;
  const at = end(nodes, i);
  return [...nodes.slice(0, at), { ...node, depth: nodes[i].depth + 1 }, ...nodes.slice(at)];
}

/** Move a node and its subtree one level in (under the sibling above it) or out; null when it cannot. */
export function shift(nodes: WbsNode[], id: string, by: 1 | -1): WbsNode[] | null {
  const i = nodes.findIndex((n) => n.id === id);
  if (i < 0) return null;
  const d = nodes[i].depth + by, e = end(nodes, i);
  if (d < 0) return null;
  if (by === 1 && (i === 0 || nodes[i - 1].depth < nodes[i].depth)) return null; // nothing above to nest under
  if (nodes.slice(i, e).some((n) => n.depth + by >= MAX_WBS_DEPTH)) return null;
  return nodes.map((n, k) => (k >= i && k < e ? { ...n, depth: n.depth + by } : n));
}

/** Swap a node and its subtree with the sibling above (-1) or below (1); null at the edge. */
export function move(nodes: WbsNode[], id: string, dir: 1 | -1): WbsNode[] | null {
  const i = nodes.findIndex((n) => n.id === id);
  if (i < 0) return null;
  const e = end(nodes, i), depth = nodes[i].depth;
  if (dir === -1) {
    let p = i - 1;
    while (p >= 0 && nodes[p].depth > depth) p--;
    if (p < 0 || nodes[p].depth < depth) return null;
    return [...nodes.slice(0, p), ...nodes.slice(i, e), ...nodes.slice(p, i), ...nodes.slice(e)];
  }
  if (e >= nodes.length || nodes[e].depth < depth) return null;
  const f = end(nodes, e);
  return [...nodes.slice(0, i), ...nodes.slice(e, f), ...nodes.slice(i, e), ...nodes.slice(f)];
}

/** Remove a node with its subtree; `gone` lists the removed ids. */
export function removeNode(nodes: WbsNode[], id: string): { nodes: WbsNode[]; gone: string[] } {
  const i = nodes.findIndex((n) => n.id === id);
  if (i < 0) return { nodes, gone: [] };
  const e = end(nodes, i);
  return { nodes: [...nodes.slice(0, i), ...nodes.slice(e)], gone: nodes.slice(i, e).map((n) => n.id) };
}

/** Ids of a node and everything under it. */
export const subtreeIds = (nodes: WbsNode[], id: string): string[] => { const i = nodes.findIndex((n) => n.id === id); return i < 0 ? [] : nodes.slice(i, end(nodes, i)).map((n) => n.id); };
