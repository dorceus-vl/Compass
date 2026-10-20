// Cuts extracted text into passages for Knowledge (ruling KN3). Pure: no I/O, so scripts/chunk.test.ts runs it as is.
// About 3,200 characters a passage with 200 characters of overlap, cut at paragraph, slide or sheet-row boundaries; every passage carries a locator.
import type { DocKind } from '../../shared/types.ts';

export const TARGET = 3200, OVERLAP = 200, MAX_CHUNKS = 2000;
export interface Passage { locator: string; text: string }
/** `group` never shares a passage or an overlap with a different group (a sheet). */
interface Unit { text: string; label: string; group?: string }

// A unit the overlap, the separator and the unit itself must fit around: tail (<= OVERLAP) + separator (<= 2) + unit <= TARGET.
const LIMIT = TARGET - OVERLAP - 2;

/** A long unit as pieces of at most LIMIT characters, cut at a line break, else a space, else anywhere. */
function pieces(u: Unit): Unit[] {
  const out: Unit[] = [];
  let rest = u.text;
  while (rest.length > LIMIT) {
    const win = rest.slice(0, LIMIT);
    const at = Math.max(win.lastIndexOf('\n'), win.lastIndexOf(' '));
    const cutAt = at > LIMIT / 2 ? at : LIMIT;
    out.push({ ...u, text: rest.slice(0, cutAt).trimEnd() });
    rest = rest.slice(cutAt).trimStart();
  }
  if (rest) out.push({ ...u, text: rest });
  return out;
}

/** The last OVERLAP characters of a passage's own text, started at a word. */
function tailOf(body: string): string {
  if (body.length <= OVERLAP) return body;
  const t = body.slice(-OVERLAP);
  return t.replace(/^\S*\s+/, '') || t;
}

function pack(units: Unit[], sep: string, locate: (us: Unit[], n: number) => string): Passage[] {
  const out: Passage[] = [];
  let cur: Unit[] = [], len = 0, tail = '', group: string | undefined;
  const flush = () => {
    if (!cur.length) return;
    const body = cur.map((u) => u.text).join(sep);
    out.push({ locator: locate(cur, out.length + 1), text: tail ? tail + sep + body : body });
    tail = tailOf(body);
    cur = []; len = 0;
  };
  for (const u of units.flatMap(pieces)) {
    if (cur.length && u.group !== group) { flush(); tail = ''; }
    group = u.group;
    const add = (cur.length ? sep.length : 0) + u.text.length;
    if (cur.length && tail.length + sep.length + len + add > TARGET) flush();
    cur.push(u); len += add;
    if (out.length >= MAX_CHUNKS) break;
  }
  flush();
  return out.slice(0, MAX_CHUNKS);
}

const range = (a: string, b: string, word: string) => (a === b ? `${word} ${a}` : `${word} ${a}-${b}`);
const part = (_: Unit[], n: number) => `part ${n}`;
const paragraphs = (s: string): Unit[] => s.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, label: '' }));

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** xlsxText lines: `Sheet!A1: value`. The locator is the sheet and the box around the passage's cells (`Sheet!A1:F40`). */
function sheets(text: string): Passage[] {
  let sheet = '';
  const units = text.split('\n').filter((l) => l.trim()).map((line): Unit => {
    const m = line.match(/^(.*)!([A-Z]+)(\d+): /);
    if (m) { sheet = m[1]; return { text: line, label: `${m[2]}${m[3]}`, group: sheet }; }
    return { text: line, label: '', group: sheet }; // the closing "[Cut: …]" line
  });
  return pack(units, '\n', (us, n) => {
    const refs = us.flatMap((u) => u.label.match(/^([A-Z]+)(\d+)$/)?.slice(1) ?? []);
    if (!refs.length) return part(us, n);
    const cols: number[] = [], rows: number[] = [];
    for (let i = 0; i < refs.length; i += 2) { cols.push(colNum(refs[i])); rows.push(Number(refs[i + 1])); }
    return `${us[0].group}!${colName(Math.min(...cols))}${Math.min(...rows)}:${colName(Math.max(...cols))}${Math.max(...rows)}`;
  });
}

/** Markdown (and Word, with its heading styles written as `#`): the locator is the heading in effect where the passage starts. */
function sections(text: string): Passage[] {
  let heading = '';
  const units = paragraphs(text).map((u) => {
    const h = u.text.match(/^#{1,6}[ \t]+(.+)/)?.[1];
    if (h) heading = h.replace(/[ \t]+#+[ \t]*$/, '').trim().slice(0, 80);
    return { ...u, label: heading };
  });
  return pack(units, '\n\n', (us, n) => (us[0].label ? `§ ${us[0].label}` : part(us, n)));
}

/** The passages of one document's extracted text. A PDF takes its pages (an array, or one string with a form feed between pages); everything else takes a string. Images have no text. */
export function chunk(text: string | string[], kind: DocKind): Passage[] {
  if (kind === 'png' || kind === 'jpg') return [];
  if (kind === 'pdf') {
    const pages = Array.isArray(text) ? text : text.split('\f');
    const units = pages.flatMap((t, i): Unit[] => (t.trim() ? [{ text: t.trim(), label: String(i + 1) }] : []));
    return pack(units, '\n\n', (us) => range(us[0].label, us[us.length - 1].label, 'p.'));
  }
  const s = Array.isArray(text) ? text.join('\n\n') : text;
  if (!s.trim()) return [];
  if (kind === 'xlsx') return sheets(s);
  if (kind === 'pptx') {
    const units = s.split(/\n\n(?=Slide \d+:)/).map((t) => t.trim()).filter(Boolean).map((t): Unit => ({ text: t, label: t.match(/^Slide (\d+):/)?.[1] ?? '' }));
    return pack(units, '\n\n', (us, n) => (us[0].label ? range(us[0].label, us[us.length - 1].label || us[0].label, 'slide') : part(us, n)));
  }
  if (kind === 'md' || kind === 'docx') return sections(s);
  if (kind === 'csv') return pack(s.split(/\r?\n/).filter((l) => l.trim()).map((text) => ({ text, label: '' })), '\n', part);
  return pack(paragraphs(s), '\n\n', part); // txt
}
