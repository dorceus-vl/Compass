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
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
};
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** A work-project file is sealed in memory (several copies at once), so it is held to a lower cap. */
export const MAX_SEALED_BYTES = 10 * 1024 * 1024;
/** An image goes to the model as base64 (4/3 the size) under a 5 MB request cap, so it is held to 3.75 MB raw. */
export const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024;

const baseType = (t: string) => t.split(';')[0].trim().toLowerCase();
const starts = (head: Uint8Array, s: string) => [...s].every((ch, i) => head[i] === ch.charCodeAt(0));

/** The file's kind and normalised type, or the message to show the user. `head` is the file's first bytes. */
export function checkDoc(file: { name: string; type: string; size: number }, head: Uint8Array, sealed = false): { kind: DocKind; type: string } | { error: string } {
  const ext = file.name.toLowerCase().match(/\.(pdf|docx|xlsx|pptx|md|txt|csv|png|jpe?g)$/)?.[1];
  const kind = (ext === 'jpeg' ? 'jpg' : ext) as DocKind | undefined;
  if (!kind) return { error: 'Upload a PDF, Word, Excel, PowerPoint, CSV, Markdown, text or image (PNG, JPG) file.' };
  const declared = baseType(file.type);
  // Office files arrive with an empty type from some browsers; .md and .csv as text/plain, empty, or (csv, on Windows) the Excel type.
  const ok = declared === DOC_TYPES[kind] || (kind === 'md' && (declared === 'text/plain' || declared === '')) || (kind === 'csv' && ['text/plain', 'application/vnd.ms-excel', ''].includes(declared))
    || ((kind === 'docx' || kind === 'xlsx' || kind === 'pptx') && declared === '');
  if (!ok) return { error: `That file does not look like a .${kind} file.` };
  if (file.size === 0) return { error: 'That file is empty.' };
  const max = sealed ? MAX_SEALED_BYTES : MAX_DOC_BYTES;
  if (file.size > max) return { error: `${sealed ? 'Work files' : 'Files'} must be ${max / 1024 / 1024} MB or smaller.` };
  if ((kind === 'png' || kind === 'jpg') && file.size > MAX_IMAGE_BYTES) return { error: 'Images must be 3.75 MB or smaller.' };
  if (kind === 'pdf' && !starts(head, '%PDF')) return { error: 'That file does not look like a PDF.' };
  const bad = (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') && !starts(head, 'PK') || (kind === 'png' && !starts(head, '\x89PNG'))
    || (kind === 'jpg' && !starts(head, '\xFF\xD8\xFF')) || (kind === 'csv' && head.subarray(0, 4096).includes(0)); // csv is text: no NUL in its first 4 KB
  if (bad) return { error: `That file does not look like a .${kind} file.` };
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
