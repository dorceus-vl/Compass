// Which documents may join a chat thread. Pure: the route reads the rows and the project boundaries, this decides.
export const MAX_ATTACHMENTS = 3;
type DocRef = { project_id: string | null; deleted_at: string | null };

/**
 * `docs` holds each requested id's row (null when there is none). A document joins a thread only when it is live and either belongs to the thread's own project
 * or is unfiled while the thread has no project (so a work document never joins a personal thread, nor another project's file this one).
 * `boundaries` maps project id to its boundary; a project missing from it is in Trash, and an Offline-only one never reaches a model.
 */
export function checkAttachments(
  ids: string[], docs: Record<string, DocRef | null>, threadProjectId: string | null, boundaries: Record<string, 'cloud' | 'offline' | undefined>,
): 'ok' | 'too_many' | 'document_boundary' {
  if (new Set(ids).size > MAX_ATTACHMENTS) return 'too_many';
  for (const id of ids) {
    const d = docs[id];
    if (!d || d.deleted_at || d.project_id !== threadProjectId) return 'document_boundary';
    if (d.project_id !== null && boundaries[d.project_id] !== 'cloud') return 'document_boundary';
  }
  return 'ok';
}
