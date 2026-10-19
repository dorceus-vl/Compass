// Text out of uploaded documents. Runs in the Worker on bytes it already holds; nothing here is sent anywhere.
import { unzipSync } from 'fflate';
import { extractText } from 'unpdf';
import type { DocKind } from '../../shared/types.ts';

export const MAX_TEXT = 200_000;
const cut = (s: string) => s.slice(0, MAX_TEXT);
const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const decode = (s: string) => s.replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m]); // one pass, so &amp;lt; stays &lt;

/** The Word parts we read, decompressed (a part that claims over 50 MB is skipped: zip bombs). Throws on a file that is not a zip. */
function parts(bytes: Uint8Array, names: RegExp): [string, string][] {
  const files = unzipSync(bytes, { filter: (f) => names.test(f.name) && f.originalSize <= 50 * 1024 * 1024 });
  return Object.keys(files).sort().map((n) => [n, new TextDecoder().decode(files[n])]);
}
/** Paragraph texts of one WordprocessingML part: tags stripped, so a tag split across runs reads whole. */
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => decode(m[0].replace(/<[^>]*>/g, ''))).filter((p) => p.trim());

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
  for (const [, xml] of all) for (const p of paragraphs(xml)) for (const m of p.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) if (m[1]) seen.add(m[1]);
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
