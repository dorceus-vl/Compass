import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, ShadingType } from 'docx';
import type { DocBlock, TemplateDoc } from '../../../shared/doc-model.ts';

const cellOf = (text: string, o: { bold?: boolean; fill?: string; width?: number } = {}) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text, bold: o.bold })] })],
  ...(o.fill ? { shading: { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } } : {}),
  ...(o.width ? { width: { size: o.width, type: WidthType.PERCENTAGE } } : {}),
});
const grid = (rows: TableRow[]) => new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });

function blocks(b: DocBlock): (Paragraph | Table)[] {
  switch (b.t) {
    case 'p': return [new Paragraph({ children: [new TextRun(b.text)], spacing: { after: 120 } })];
    case 'list': return b.items.map((i) => new Paragraph({ children: [new TextRun(i)], bullet: { level: 0 } }));
    case 'fields': return [grid(b.pairs.map(([k, v]) => new TableRow({ children: [cellOf(k, { bold: true, fill: 'F2F2F2', width: 30 }), cellOf(v, { width: 70 })] }))), new Paragraph('')];
    case 'table': return [grid([
      new TableRow({ tableHeader: true, children: b.headers.map((h) => cellOf(h, { bold: true, fill: 'E7E6E6' })) }),
      ...b.rows.map((r) => new TableRow({ children: r.map((c) => cellOf(c)) })),
    ]), new Paragraph('')];
  }
}

export async function toDocx(doc: TemplateDoc): Promise<Uint8Array> {
  const file = new Document({
    title: doc.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 } } }, // US Letter, in twips
      children: [
        new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
        ...(doc.subtitle ? [new Paragraph({ children: [new TextRun({ text: doc.subtitle, italics: true })], spacing: { after: 240 } })] : []),
        ...doc.sections.flatMap((s) => [new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }), ...s.blocks.flatMap(blocks)]),
      ],
    }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}
