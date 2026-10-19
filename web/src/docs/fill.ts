import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import type { ReportModel } from '../../../shared/types.ts';

/** Fills a user's own .docx: {{project.name}}, {{#risks.rows}}…{{/risks.rows}}. A broken template throws "Template problem: …". */
export function fillTemplate(bytes: Uint8Array, data: ReportModel): Uint8Array {
  try {
    const doc = new Docxtemplater(new PizZip(bytes), {
      delimiters: { start: '{{', end: '}}' }, paragraphLoop: true, linebreaks: true, nullGetter: () => '',
      parser: (tag: string) => ({ get: (scope: unknown) => (tag === '.' ? scope : tag.split('.').reduce<unknown>((o, k) => (o != null && Object.hasOwn(Object(o), k) ? (o as Record<string, unknown>)[k] : undefined), scope)) }),
    });
    doc.render(data);
    return doc.getZip().generate({ type: 'uint8array' });
  } catch (e) {
    const first = (e as { properties?: { errors?: { message?: string }[] } }).properties?.errors?.[0]?.message;
    throw new Error('Template problem: ' + (first ?? (e instanceof Error ? e.message : String(e))));
  }
}
