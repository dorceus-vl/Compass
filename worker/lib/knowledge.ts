// Knowledge: which documents a collection may take, and the hooks Trash and boundary changes call. Pure apart from the hook.
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

/** Task 1 replaces this body: delete these passages' vectors from the index (Trash purge, Cloud AI → Locked). Until then there is no index, so nothing to delete. */
export async function purgeVectors(_env: Env, _chunkIds: string[]): Promise<void> {}
