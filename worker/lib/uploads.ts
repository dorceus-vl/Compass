// Every document Vlad uploads is checked here on the way in and served back through here on the way out (adapted from Health's uploads.ts).
// In: only these kinds, judged by the file name's extension, the declared type (the browser's) agreeing with it, a size cap,
// and the first bytes being what a PDF or an Office zip starts with. The bytes beyond that are never trusted to be what they claim, which is why the way out matters more:
// Out: the stored kind decides the type, it is always a download (never inline), and nosniff stops the browser guessing.
// So even a file that slipped in as HTML can't run script on this origin.
import type { DocKind } from '../../shared/types.ts';

export const DOC_TYPES: Record<DocKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown',
  txt: 'text/plain',
};
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

const baseType = (t: string) => t.split(';')[0].trim().toLowerCase();
const starts = (head: Uint8Array, s: string) => [...s].every((ch, i) => head[i] === ch.charCodeAt(0));

/** The file's kind and normalised type, or the message to show the user. `head` is the file's first bytes. */
export function checkDoc(file: { name: string; type: string; size: number }, head: Uint8Array): { kind: DocKind; type: string } | { error: string } {
  const kind = file.name.toLowerCase().match(/\.(pdf|docx|xlsx|md|txt)$/)?.[1] as DocKind | undefined;
  if (!kind) return { error: 'Upload a PDF, Word, Excel, Markdown or text file.' };
  const declared = baseType(file.type);
  // .docx/.xlsx arrive with an empty type from some browsers; .md as text/plain or empty.
  const ok = declared === DOC_TYPES[kind] || (kind === 'md' && (declared === 'text/plain' || declared === '')) || ((kind === 'docx' || kind === 'xlsx') && declared === '');
  if (!ok) return { error: `That file does not look like a .${kind} file.` };
  if (file.size === 0) return { error: 'That file is empty.' };
  if (file.size > MAX_DOC_BYTES) return { error: `Files must be ${MAX_DOC_BYTES / 1024 / 1024} MB or smaller.` };
  if (kind === 'pdf' && !starts(head, '%PDF')) return { error: 'That file does not look like a PDF.' };
  if ((kind === 'docx' || kind === 'xlsx') && !starts(head, 'PK')) return { error: `That file does not look like a .${kind} file.` };
  return { kind, type: DOC_TYPES[kind] };
}

/** A stored file as a response: always a download, the type from the stored kind, never sniffed, never cached. */
export function fileResponse(body: ReadableStream | ArrayBuffer | Uint8Array | null, kind: DocKind, name = 'file'): Response {
  return new Response(body, {
    headers: {
      'content-type': DOC_TYPES[kind] ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
