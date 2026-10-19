import type { DocBlock, TemplateDoc } from './templates.ts';

const cell = (s: string) => s.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();
const row = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`;

function block(b: DocBlock): string {
  switch (b.t) {
    case 'p': return b.text;
    case 'list': return b.items.map((i) => '- ' + i.replace(/\s+/g, ' ')).join('\n');
    case 'fields': return b.pairs.map(([k, v]) => `**${k}:** ${v}`).join('  \n');
    case 'table': return [row(b.headers), row(b.headers.map(() => '---')), ...b.rows.map(row)].join('\n');
  }
}

export const toMarkdown = (doc: TemplateDoc): string =>
  [`# ${doc.title}`, doc.subtitle ? `_${doc.subtitle}_` : '', ...doc.sections.flatMap((s) => [`## ${s.heading}`, ...s.blocks.map(block)])].filter((x) => x !== '').join('\n\n') + '\n';
