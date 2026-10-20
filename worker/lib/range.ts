/**
 * One HTTP byte range against a body of `size` bytes: `bytes=a-b`, `bytes=a-` or `bytes=-n`.
 * null = no Range header (send everything); 'bad' = malformed, several ranges or unsatisfiable (answer 416).
 */
export type ByteRange = { start: number; end: number }; // both inclusive
export function parseRange(header: string | null | undefined, size: number): ByteRange | null | 'bad' {
  if (header == null || header === '') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '') || size <= 0) return 'bad';
  if (m[1] === '') { // the last n bytes
    const n = Number(m[2]);
    return n === 0 ? 'bad' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]), end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start >= size || end < start ? 'bad' : { start, end };
}
