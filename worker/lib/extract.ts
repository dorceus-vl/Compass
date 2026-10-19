// Text out of uploaded documents. Runs in the Worker on bytes it already holds; nothing here is sent anywhere.
import { unzipSync } from 'fflate';
import { extractText } from 'unpdf';
import type { DocKind } from '../../shared/types.ts';

export const MAX_TEXT = 200_000;
const cut = (s: string) => s.slice(0, MAX_TEXT);
const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const decode = (s: string) => s.replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m]); // one pass, so &amp;lt; stays &lt;

const MAX_PART = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024, MAX_HEADERS = 20;
/**
 * The Word parts we read, decompressed. Zip bombs: a part over 10 MB, parts over 20 MB in all, or more than 20 header/footer parts
 * make extraction fail (the callers answer 400). The sizes are the zip's declared ones, and fflate inflates into a buffer of exactly that
 * size, so a part that lies about its size is cut off, not grown. Throws on a file that is not a zip.
 */
function parts(bytes: Uint8Array, names: RegExp): [string, string][] {
  let total = 0, extras = 0;
  const files = unzipSync(bytes, { filter: (f) => {
    if (!names.test(f.name)) return false;
    if (f.name !== 'word/document.xml' && ++extras > MAX_HEADERS) throw new Error('too many parts');
    total += f.originalSize;
    if (f.originalSize > MAX_PART || total > MAX_TOTAL) throw new Error('part too large');
    return true;
  } });
  return Object.keys(files).sort().map((n) => [n, new TextDecoder().decode(files[n])]);
}
/** Paragraph texts of one WordprocessingML part: tags stripped, so a tag split across runs reads whole. One linear scan (no lazy regex across the file). */
function paragraphs(xml: string): string[] {
  const out: string[] = [];
  const chunks = xml.split('</w:p>');
  chunks.pop(); // after the last closer: no paragraph
  for (const chunk of chunks) {
    let start = -1;
    for (const m of chunk.matchAll(/<w:p[ >]/g)) start = m.index!;
    if (start < 0) continue;
    const text = decode(chunk.slice(start).replace(/<[^<>]*>/g, ''));
    if (text.trim()) out.push(text);
  }
  return out;
}

export function docxText(bytes: Uint8Array): string {
  const doc = parts(bytes, /^word\/document\.xml$/)[0];
  return cut(doc ? paragraphs(doc[1]).join('\n\n') : '');
}

/** Unique {{ tag }} names across body, headers and footers, in order of appearance; # and / loop markers kept. */
export function docxPlaceholders(bytes: Uint8Array): string[] {
  const all = parts(bytes, /^word\/(document|header\d*|footer\d*)\.xml$/);
  // the body first, then headers and footers, whatever the zip order
  all.sort((a, b) => Number(a[0] !== 'word/document.xml') - Number(b[0] !== 'word/document.xml') || a[0].localeCompare(b[0]));
  const seen = new Set<string>();
  for (const [, xml] of all) for (const p of paragraphs(xml)) for (const m of p.matchAll(/\{\{([^{}]*)\}\}/g)) if (m[1].trim()) seen.add(m[1].trim());
  return [...seen];
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  return cut((await extractText(new Uint8Array(bytes), { mergePages: true })).text);
}

/** The searchable text of a document; Excel has none. */
export async function docText(kind: DocKind, bytes: Uint8Array): Promise<string> {
  if (kind === 'pdf') return pdfText(bytes);
  if (kind === 'docx') return docxText(bytes);
  if (kind === 'xlsx') return '';
  return cut(new TextDecoder().decode(bytes));
}
