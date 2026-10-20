// Knowledge: which documents a collection may take, what a boundary change does, and which passages may hold a vector. Pure.

export type Scope = 'work' | 'personal';
/** What decides a document's side: its project's kind, or (unfiled) whether it was uploaded sealed for a work collection (documents.enc_v = 2). */
export interface DocSide { projectKind: Scope | null; sealed: boolean }

/**
 * The compatibility rule (spec "Work knowledge stays work"):
 * - a work collection takes a document of a work project, or an unfiled one uploaded sealed for work (its bytes and name are ciphertext, like any work file);
 * - a personal collection takes a document of a personal project, or an unfiled plain one; never a work document, sealed or in a work project.
 */
export function compatible(scope: Scope, d: DocSide): boolean {
  const work = d.projectKind === 'work' || (d.projectKind === null && d.sealed);
  if (scope === 'work') return work;
  return !work && (d.projectKind === 'personal' || d.projectKind === null);
}

/** A work collection becoming Cloud AI (created as Cloud AI, or switched from Locked) needs the passkey: its passages become readable by a model. `from` is null on create. */
export function needsStepUp(scope: Scope, from: 'cloud' | 'locked' | null, to: 'cloud' | 'locked'): boolean {
  return scope === 'work' && to === 'cloud' && from !== 'cloud';
}

/** KN6: what a boundary change does (null when the boundary stays). Either way every passage goes back to `embedded = 0`; Cloud AI -> Locked deletes the vectors first. */
export function boundaryChange(from: 'cloud' | 'locked', to: 'cloud' | 'locked'): null | { purge: boolean; state: { from: 'ready' | 'indexing'; to: 'ready' | 'indexing' } } {
  if (from === to) return null;
  return to === 'locked' ? { purge: true, state: { from: 'indexing', to: 'ready' } } : { purge: false, state: { from: 'ready', to: 'indexing' } };
}

/** Where a passage lives, as `HOME` below selects it: its collection, item, document (if any) and that document's project (if any). */
export interface PassageHome {
  boundary: 'cloud' | 'locked'; k_del: string | null; i_del: string | null;
  document_id: string | null; d_id: string | null; d_del: string | null; project_id: string | null; p_id: string | null; p_del: string | null; p_boundary: 'cloud' | 'offline' | null;
}

/**
 * Whether a passage may hold a vector and be searched by meaning: a live Cloud AI collection, a live item, and when it comes from a document,
 * a live document whose project (if any) is live and not Offline-only. Anything else is never embedded, and an existing vector is removed.
 * `LIVE` is the same rule in SQL (used to pick and to search); keep the two together.
 */
export function vectorWanted(h: PassageHome): boolean {
  if (h.boundary !== 'cloud' || h.k_del || h.i_del) return false;
  if (!h.document_id) return true;
  if (!h.d_id || h.d_del) return false;
  return !h.project_id || (!!h.p_id && !h.p_del && h.p_boundary === 'cloud');
}
/** Joins a passage `c` to its item `i`, collection `k`, document `d` and project `p`. */
export const HOME = `knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id JOIN knowledge_collections k ON k.id = c.collection_id
  LEFT JOIN documents d ON d.id = i.document_id LEFT JOIN projects p ON p.id = d.project_id`;
export const HOME_COLS = 'k.boundary, k.deleted_at AS k_del, i.deleted_at AS i_del, i.document_id, d.id AS d_id, d.deleted_at AS d_del, d.project_id, p.id AS p_id, p.deleted_at AS p_del, p.data_boundary AS p_boundary';
export const LIVE = `k.boundary = 'cloud' AND k.deleted_at IS NULL AND i.deleted_at IS NULL AND (i.document_id IS NULL OR (d.id IS NOT NULL AND d.deleted_at IS NULL
  AND (d.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL AND p.data_boundary = 'cloud'))))`;
