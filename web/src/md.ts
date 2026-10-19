// A small, safe Markdown subset. It only produces data (never HTML); ui/Markdown.tsx turns it into React elements.
export type Inline = { t: 'text'; v: string } | { t: 'b' | 'i'; c: Inline[] } | { t: 'code'; v: string } | { t: 'link'; href: string; c: Inline[] } | { t: 'page'; slug: string; label: string };
export type Block = { t: 'h'; level: 1 | 2 | 3; c: Inline[] } | { t: 'p'; c: Inline[] } | { t: 'ul' | 'ol'; items: Inline[][] } | { t: 'code'; v: string }
  | { t: 'quote'; c: Inline[] } | { t: 'table'; head: Inline[][]; rows: Inline[][][] } | { t: 'hr' };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i), ch = s[i];
    let m: RegExpMatchArray | null;
    if (ch === '`' && (m = rest.match(/^`([^`]+)`/))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if (ch === '[' && (m = rest.match(/^\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/))) { flush(); out.push({ t: 'page', slug: m[1], label: m[2] ?? m[1] }); i += m[0].length; continue; }
    if (ch === '[' && (m = rest.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/))) { flush(); out.push({ t: 'link', href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue; }
    if (rest.startsWith('**') && (m = rest.match(/^\*\*(\S(?:.*?\S)?)\*\*/))) { flush(); out.push({ t: 'b', c: parseInline(m[1]) }); i += m[0].length; continue; }
    // _ only opens at a word start, so snake_case stays text
    if ((ch === '*' && !rest.startsWith('**')) || (ch === '_' && !/[\p{L}\p{N}]/u.test(s[i - 1] ?? ' '))) {
      const e = ch === '*' ? '\\*' : '_';
      if ((m = rest.match(new RegExp(`^${e}(\\S(?:[^${e}]*?\\S)?)${e}(?![\\p{L}\\p{N}])`, 'u')))) { flush(); out.push({ t: 'i', c: parseInline(m[1]) }); i += m[0].length; continue; }
    }
    text += ch; i++;
  }
  flush();
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim()));
const isDelim = (l: string) => l.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
const ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;
const startsBlock = (l: string) => /^\s*(```|#{1,6}\s|>|---\s*$)/.test(l) || ITEM.test(l);

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n'), out: Block[] = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*```/.test(l)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++; out.push({ t: 'code', v: code.join('\n') }); continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out.push({ t: 'h', level: Math.min(m[1].length, 3) as 1 | 2 | 3, c: parseInline(m[2].trim()) }); i++; continue; }
    if (/^\s*---\s*$/.test(l)) { out.push({ t: 'hr' }); i++; continue; }
    if (l.includes('|') && i + 1 < lines.length && isDelim(lines[i + 1])) {
      const head = cells(l), rows: Inline[][][] = []; i += 2;
      while (i < lines.length && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push({ t: 'table', head, rows }); continue;
    }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '').trim());
      out.push({ t: 'quote', c: parseInline(q.join(' ')) }); continue;
    }
    if ((m = l.match(ITEM))) {
      const t = m[1] ? 'ul' : 'ol', items: Inline[][] = [];
      while (i < lines.length && (m = lines[i].match(ITEM)) && (m[1] ? 'ul' : 'ol') === t) { items.push(parseInline(m[3].trim())); i++; }
      out.push({ t, items }); continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && (!p.length || !startsBlock(lines[i]))) p.push(lines[i++].trim());
    out.push({ t: 'p', c: parseInline(p.join(' ')) });
  }
  return out;
}
