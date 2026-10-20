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
 * make extraction fail (the callers answer 400). The sizes are the zip's declared ones (the larger of compressed and uncompressed): fflate inflates a deflated part into a buffer of exactly the declared size, and copies a stored part by its compressed size. Throws on a file that is not a zip.
 */
function parts(bytes: Uint8Array, names: RegExp, maxExtras = MAX_HEADERS): [string, string][] {
  let total = 0, extras = 0;
  const files = unzipSync(bytes, { filter: (f) => {
    if (!names.test(f.name)) return false;
    if (f.name !== 'word/document.xml' && ++extras > maxExtras) throw new Error('too many parts');
    // A stored (method 0) entry is copied by its compressed size and ignores the declared uncompressed one, so count the larger of the two, duplicates and overlapping entries included.
    const sz = Math.max(f.originalSize, f.size);
    total += sz;
    if (sz > MAX_PART || total > MAX_TOTAL) throw new Error('part too large');
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

/** What Athena reads of one attachment, at most this many characters of text. */
export const CHAT_MAX = 60_000;
const XLSX_MAX_CELLS = 20_000, XLSX_MAX_CHARS = 200_000;
const attr = (tag: string, name: string) => tag.match(new RegExp(`[ \\t\\n]${name}="([^"]*)"`))?.[1];
/** Id → target of a .rels part, the target resolved against its folder (or the package root when it starts with /). */
function rels(xml: string | undefined, dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [tag] of (xml ?? '').matchAll(/<Relationship\b[^<>]*>/g)) {
    const id = attr(tag, 'Id'), t = attr(tag, 'Target');
    if (id && t) m.set(id, t.startsWith('/') ? t.slice(1) : new URL(t, `http://x/${dir}/`).pathname.slice(1));
  }
  return m;
}
const txt = (xml: string) => decode([...xml.matchAll(/<t(?:[ >][^<>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join('')); // the <t> runs of a shared or inline string
const noPhonetic = (si: string) => si.split('</rPh>').map((p) => (p.lastIndexOf('<rPh') < 0 ? p : p.slice(0, p.lastIndexOf('<rPh')))).join(''); // phonetic guides are not the value; one linear pass
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * An .xlsx as `Sheet!A1: value` and `Sheet!B2: =FORMULA → cached` lines, sheets in workbook order, each sheet's cells in file order.
 * Capped at 20,000 cells or 200,000 characters (ruling A3); the text ends with a line saying so when it was cut. Same zip limits as .docx.
 */
export function xlsxText(bytes: Uint8Array): { text: string; truncated: boolean } {
  const files = new Map(parts(bytes, /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/, 200));
  const shared = (files.get('xl/sharedStrings.xml') ?? '').split('</si>').map((si) => txt(noPhonetic(si)));
  const target = rels(files.get('xl/_rels/workbook.xml.rels'), 'xl');
  const lines: string[] = [];
  let cells = 0, chars = 0, truncated = false;
  sheets: for (const [tag] of (files.get('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^<>]*>/g)) {
    const name = decode(attr(tag, 'name') ?? ''), xml = files.get(target.get(attr(tag, 'r:id') ?? '') ?? '');
    if (!xml) continue;
    const label = /^\w+$/.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
    const chunks = xml.split('</c>');
    chunks.pop(); // after the last closer: no cell
    for (const chunk of chunks) {
      const at = chunk.lastIndexOf('<c ');
      if (at < 0) continue;
      const open = chunk.slice(at, chunk.indexOf('>', at) + 1), body = chunk.slice(at + open.length);
      const ref = attr(open, 'r'), type = attr(open, 't');
      const f = body.match(/<f(?:[ >][^<>]*)?>([^<]*)<\/f>/)?.[1];
      const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
      let val = v === undefined ? (type === 'inlineStr' ? txt(body) : '') : type === 's' ? shared[Number(v)] ?? '' : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : decode(v);
      val = oneLine(val);
      const formula = f ? '=' + oneLine(decode(f)) : '';
      if (!ref || (!val && !formula)) continue;
      const line = `${label}!${ref}: ${formula ? (val ? `${formula} → ${val}` : formula) : val}`;
      if (cells + 1 > XLSX_MAX_CELLS || chars + line.length + 1 > XLSX_MAX_CHARS) { truncated = true; break sheets; }
      cells++; chars += line.length + 1; lines.push(line);
    }
  }
  if (truncated) lines.push(`[Cut: only the first ${cells.toLocaleString('en-US')} cells are shown; the workbook has more.]`);
  return { text: lines.join('\n'), truncated };
}

const paras = (xml: string) => xml.replace(/<a:br\b[^<>]*>/g, '\n').split('</a:p>').slice(0, -1).filter((c) => c.includes('<a:p')).map((c) => decode(c.slice(c.lastIndexOf('<a:p')).replace(/<[^<>]*>/g, '')).trim()).filter(Boolean);
/** A .pptx as `Slide N: …` blocks in presentation order, each with its speaker notes (`Notes: …`) when it has any. */
export function pptxText(bytes: Uint8Array): string {
  const files = new Map(parts(bytes, /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/, 1000));
  const target = rels(files.get('ppt/_rels/presentation.xml.rels'), 'ppt');
  let order = [...(files.get('ppt/presentation.xml') ?? '').matchAll(/<p:sldId\b[^<>]*>/g)].map(([t]) => target.get(attr(t, 'r:id') ?? '') ?? '').filter((n) => files.has(n));
  if (!order.length) order = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0])); // no usable slide list: file-name order
  return order.map((n, i) => {
    const notesPath = [...rels(files.get(`ppt/slides/_rels/${n.split('/').pop()}.rels`), 'ppt/slides').values()].find((t) => files.has(t) && t.includes('notesSlides/'));
    const notes = notesPath ? files.get(notesPath)!.split('</p:sp>').filter((sp) => /<p:ph[^<>]*type="body"/.test(sp)).flatMap(paras) : [];
    return `Slide ${i + 1}: ${paras(files.get(n)!).join('\n')}${notes.length ? `\nNotes: ${notes.join('\n')}` : ''}`;
  }).join('\n\n');
}

/** A CSV as UTF-8 text, at most 60,000 characters. */
export const csvText = (bytes: Uint8Array) => new TextDecoder().decode(bytes).slice(0, CHAT_MAX);

/** One attachment as the text Athena reads: at most 60,000 characters, with a closing line that says so when it was cut. Images have none (they go in as image input). */
export async function attachmentText(kind: DocKind, bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const whole = kind === 'xlsx' ? xlsxText(bytes) : { text: kind === 'pptx' ? pptxText(bytes) : kind === 'pdf' ? await pdfText(bytes) : kind === 'docx' ? docxText(bytes) : kind === 'png' || kind === 'jpg' ? '' : new TextDecoder().decode(bytes), truncated: false };
  if (whole.text.length <= CHAT_MAX) return whole;
  return { text: whole.text.slice(0, CHAT_MAX) + `\n[Cut: only the first ${CHAT_MAX.toLocaleString('en-US')} characters are shown; the document has more.]`, truncated: true };
}

/** The searchable text of a document; Excel and images have none. */
export async function docText(kind: DocKind, bytes: Uint8Array): Promise<string> {
  if (kind === 'pdf') return pdfText(bytes);
  if (kind === 'docx') return docxText(bytes);
  if (kind === 'pptx') return cut(pptxText(bytes));
  if (kind === 'xlsx' || kind === 'png' || kind === 'jpg') return '';
  return cut(new TextDecoder().decode(bytes));
}
