// Knowledge: which documents a collection may take, what a boundary change does, and which passages may hold a vector. Pure, but for lockedOnly.
import type { Env } from '../types.ts';

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

/**
 * Where a passage lives, as `HOME` below selects it: its collection, item, document (if any), the meeting review or email it was saved from (if any)
 * and the project all that belongs to (a document's project; a meeting's; the project of the task an email became), if any.
 */
export interface PassageHome {
  boundary: 'cloud' | 'locked'; scope: Scope; k_del: string | null; i_del: string | null;
  document_id: string | null; d_id: string | null; d_del: string | null;
  source: string; source_id: string | null; s_id: string | null; s_work: number | null;
  project_id: string | null; p_id: string | null; p_del: string | null; p_boundary: 'cloud' | 'offline' | null; p_kind: Scope | null;
}

/**
 * Whether a passage may hold a vector and be searched by meaning: a live Cloud AI collection and a live item; its document (if any) live; the meeting
 * or email it was saved from (if any) still there, and an email still on the collection's side (work when its inbox row says so or its task's project
 * is a work project: `emailIsWork`); and the project
 * all that belongs to (if any) live and not Offline-only. Anything else is never embedded, and an existing vector is removed.
 * `LIVE` is the same rule in SQL (used to pick and to search); keep the two together.
 */
export function vectorWanted(h: PassageHome): boolean {
  if (h.boundary !== 'cloud' || h.k_del || h.i_del) return false;
  if (h.document_id && (!h.d_id || h.d_del)) return false;
  if (h.source_id && !h.s_id) return false;
  if (h.source === 'email' && h.source_id && (emailIsWork(h.s_work, h.p_kind) ? 'work' : 'personal') !== h.scope) return false;
  return !h.project_id || (!!h.p_id && !h.p_del && h.p_boundary === 'cloud');
}
/** An email is work when its inbox row is (`work = 1`) or the task it became sits in a work project. `EMAIL_WORK` is the same in SQL (over `ib` and `p`). */
export const emailIsWork = (work: number | null, projectKind: Scope | null) => !!work || projectKind === 'work';
export const EMAIL_WORK = `(COALESCE(ib.work, 0) = 1 OR COALESCE(p.kind, '') = 'work')`; // never NULL, so it compares
/** Joins a passage `c` to its item `i`, collection `k`, document `d`, meeting review `mr` or email `ib` (and its task `tk`), and the project `p` they belong to. */
export const HOME = `knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id JOIN knowledge_collections k ON k.id = c.collection_id
  LEFT JOIN documents d ON d.id = i.document_id
  LEFT JOIN meeting_reviews mr ON i.source = 'meeting' AND mr.id = i.source_id
  LEFT JOIN inbox_items ib ON i.source = 'email' AND ib.id = i.source_id LEFT JOIN tasks tk ON tk.id = ib.task_id
  LEFT JOIN projects p ON p.id = COALESCE(d.project_id, mr.project_id, tk.project_id)`;
export const HOME_PROJECT = 'COALESCE(d.project_id, mr.project_id, tk.project_id)';
export const HOME_COLS = `k.boundary, k.scope, k.deleted_at AS k_del, i.deleted_at AS i_del, i.document_id, d.id AS d_id, d.deleted_at AS d_del,
  i.source, i.source_id, COALESCE(mr.id, ib.id) AS s_id, ib.work AS s_work, ${HOME_PROJECT} AS project_id, p.id AS p_id, p.deleted_at AS p_del, p.data_boundary AS p_boundary, p.kind AS p_kind`;
/** Locked search (on the device) keeps Offline-only content but not what is gone or in Trash: the item, its document, its source, the project. */
export const KEPT = `i.deleted_at IS NULL AND (i.document_id IS NULL OR (d.id IS NOT NULL AND d.deleted_at IS NULL))
  AND (i.source_id IS NULL OR COALESCE(mr.id, ib.id) IS NOT NULL) AND (${HOME_PROJECT} IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))`;
export const LIVE = `k.boundary = 'cloud' AND k.deleted_at IS NULL AND i.deleted_at IS NULL
  AND (i.document_id IS NULL OR (d.id IS NOT NULL AND d.deleted_at IS NULL))
  AND (i.source_id IS NULL OR COALESCE(mr.id, ib.id) IS NOT NULL)
  AND (i.source != 'email' OR i.source_id IS NULL OR ${EMAIL_WORK} = (k.scope = 'work'))
  AND (${HOME_PROJECT} IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL AND p.data_boundary = 'cloud'))`;

/**
 * KN22: an unfiled document whose only live knowledge items sit in Locked collections was kept for Locked, so no model reads it: Athena can't take it
 * as an attachment, and a Cloud AI collection takes it only after the passkey. (A filed document follows its project's boundary instead.)
 */
export async function lockedOnly(env: Env, documentId: string): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT max(k.boundary = 'locked') AS l, max(k.boundary = 'cloud') AS c FROM knowledge_items i JOIN knowledge_collections k ON k.id = i.collection_id
    JOIN documents d ON d.id = i.document_id WHERE i.document_id = ?1 AND d.project_id IS NULL AND i.deleted_at IS NULL AND k.deleted_at IS NULL`).bind(documentId).first<{ l: number | null; c: number | null }>();
  return !!r?.l && !r.c;
}

/** KN2: a thread's effective kind is its project's kind when it has a project, else its own `kind`, else personal. It is what the thread is sealed with. */
export const effectiveKind = (projectKind: Scope | null, threadKind: Scope | null): Scope => projectKind ?? threadKind ?? 'personal';

/**
 * Which collections Athena may read in a thread: nothing when its boundary is Offline only; otherwise live Cloud AI collections, personal ones in any thread
 * and work ones only when the thread's effective kind is work. Locked and trashed collections never.
 */
export function allowedCollections(colls: { id: string; scope: Scope; boundary: 'cloud' | 'locked'; deleted_at: string | null }[], kind: Scope, boundary: 'cloud' | 'offline'): string[] {
  if (boundary !== 'cloud') return [];
  return colls.filter((c) => !c.deleted_at && c.boundary === 'cloud' && (c.scope === 'personal' || kind === 'work')).map((c) => c.id);
}

/** The collections a request names: "all" is the allowed set; a list must sit wholly inside it, else null (the request is refused, 409 knowledge_boundary). */
export const pickCollections = (asked: string[] | 'all', allowed: string[]): string[] | null =>
  asked === 'all' ? allowed : asked.every((id) => allowed.includes(id)) ? asked : null;

/** Where text that is not a document may go (a meeting review, an email): a collection of its own side, and a Locked one only when its project is Offline only (Task 1 minor 10). */
export const mayTake = (coll: { scope: Scope; boundary: 'cloud' | 'locked' }, side: { scope: Scope; offline: boolean }): 'ok' | 'knowledge_boundary' | 'offline_boundary' =>
  coll.scope !== side.scope ? 'knowledge_boundary' : side.offline && coll.boundary === 'cloud' ? 'offline_boundary' : 'ok';
