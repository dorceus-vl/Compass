import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { DocumentRow } from '../../shared/types.ts';
import { seal, open, openAll, sealBytes, openBytes } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { checkDoc, fileResponse, MAX_DOC_BYTES } from '../lib/uploads.ts';
import { docxPlaceholders } from '../lib/extract.ts';
import { projectKind } from './projects.ts';

const documents = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = Omit<DocumentRow, 'placeholders'> & { r2_key: string; placeholders: string };
/** The row as the API shows it: no storage key, placeholders parsed. */
export const asDoc = ({ r2_key: _k, placeholders, ...rest }: Row): DocumentRow => ({ ...rest, placeholders: JSON.parse(placeholders) as string[] });
export const loadDoc = async (env: Env, id: string): Promise<Row | null> => {
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<Row>();
  return row ? open(env, 'documents', row) : null;
};
/** The stored file's bytes, unsealed when it was sealed on the way in; null when R2 has no such object. */
export async function readBytes(env: Env, row: Row): Promise<Uint8Array | null> {
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return null;
  return obj.customMetadata?.sealed === '1' ? openBytes(env, await obj.text(), `documents.file:${row.id}`) : new Uint8Array(await obj.arrayBuffer());
}

const BAD_WORD = 'That Word file could not be read.';
const NOT_TEMPLATE = 'Templates are Word files (.docx).';
const cleanName = (s: string) => s.split(/[\\/]/).pop()!.trim().slice(0, 200);

documents.get('/', async (c) => {
  const p = c.req.query('project');
  const where = p === undefined ? '' : p === 'none' ? 'AND project_id IS NULL' : 'AND project_id = ?1';
  const { results } = await c.env.DB.prepare(`SELECT * FROM documents WHERE deleted_at IS NULL ${where} ORDER BY created_at DESC LIMIT 500`).bind(...(p && p !== 'none' ? [p] : [])).all<Row>();
  return c.json({ documents: (await openAll(c.env, 'documents', results)).map(asDoc) });
});

documents.post('/', async (c) => {
  // The size is checked before the body is buffered; a request that does not say how long it is (chunked) is refused.
  const len = c.req.header('content-length');
  if (!len || !/^\d+$/.test(len)) return c.json({ error: 'Length Required' }, 411);
  if (Number(len) > MAX_DOC_BYTES + 1024 * 1024) return c.json({ error: `Files must be ${MAX_DOC_BYTES / 1024 / 1024} MB or smaller.` }, 413);
  let form: FormData | null = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return c.json({ error: 'Choose a file to upload.' }, 400);
  const pid = form.get('project_id') || null;
  const template = form.get('is_template') === '1';
  let pkind: 'personal' | 'work' | null = null;
  if (pid !== null) {
    pkind = typeof pid === 'string' ? await projectKind(c.env, pid) : null;
    if (!pkind) return c.json({ error: 'project_id is not a project' }, 400);
  }
  const name = cleanName(file.name);
  if (!name) return c.json({ error: 'The file needs a name.' }, 400);
  // A file uploaded from the Knowledge screen for a work collection has no project but is sealed like a work file (knowledge_work=1); a project's kind overrides it.
  const sealed = pkind === 'work' || (pid === null && form.get('knowledge_work') === '1');
  // Size and type are judged on the File before its bytes are copied out, so an oversize work file is refused without a second copy.
  const early = checkDoc({ name, type: file.type, size: file.size }, new Uint8Array(await file.slice(0, 4096).arrayBuffer()), sealed);
  if ('error' in early) return c.json({ error: early.error }, 400);
  const checked = early, size = file.size;
  let bytes: Uint8Array | null = new Uint8Array(await file.arrayBuffer());
  form = null; // the multipart body is no longer needed; let it go before the sealing copies are made
  let placeholders: string[] = [];
  if (template) {
    if (checked.kind !== 'docx') return c.json({ error: NOT_TEMPLATE }, 400);
    try { placeholders = docxPlaceholders(bytes); } catch { return c.json({ error: BAD_WORD }, 400); }
  }
  const id = crypto.randomUUID(), t = now(), r2_key = `docs/${id}`;
  const body: string | Uint8Array = sealed ? await sealBytes(c.env, bytes, `documents.file:${id}`) : bytes;
  bytes = null; // a sealed upload keeps only the ciphertext from here on
  await c.env.FILES.put(r2_key, body,
    sealed ? { customMetadata: { sealed: '1' } } : { httpMetadata: { contentType: checked.type } });
  const row: Row = { id, name, kind: checked.kind, size, content_type: checked.type, r2_key, project_id: pid as string | null, is_template: template ? 1 : 0,
    placeholders: JSON.stringify(placeholders), text_indexed: 0, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 };
  const s = await seal(c.env, 'documents', { ...row }, sealed ? 'work' : 'personal'); // the row's own `kind` is the file kind, so the sealing kind is passed
  try {
    await c.env.DB.prepare('INSERT INTO documents (id, name, kind, size, content_type, r2_key, project_id, is_template, placeholders, text_indexed, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?10,?11)')
      .bind(id, s.name, s.kind, s.size, s.content_type, r2_key, s.project_id, s.is_template, s.placeholders, t, s.enc_v).run();
  } catch (e) { await c.env.FILES.delete(r2_key).catch(() => {}); throw e; }
  await audit(c.env, 'you', 'document.upload', id, { kind: checked.kind, size });
  return c.json({ document: asDoc(row) }, 201);
});

documents.get('/:id', async (c) => {
  const row = await loadDoc(c.env, c.req.param('id'));
  return row ? c.json({ document: asDoc(row) }) : c.json({ error: 'Not found' }, 404);
});

documents.get('/:id/file', async (c) => {
  const row = await loadDoc(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  const body = obj.customMetadata?.sealed === '1' ? await openBytes(c.env, await obj.text(), `documents.file:${row.id}`) : obj.body;
  return fileResponse(body, row.kind, row.name);
});

documents.patch('/:id', async (c) => {
  const row = await loadDoc(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  let name = row.name, is_template = row.is_template, placeholders = row.placeholders;
  if (body.name !== undefined) {
    name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (!name) return c.json({ error: 'name must be 1-200 characters' }, 400);
  }
  if (body.is_template !== undefined) {
    if (![0, 1, true, false, '0', '1'].includes(body.is_template as never)) return c.json({ error: 'is_template must be 0 or 1' }, 400);
    is_template = Number(body.is_template === true || body.is_template === 1 || body.is_template === '1');
    if (is_template && row.kind !== 'docx') return c.json({ error: NOT_TEMPLATE }, 400);
    if (!is_template) placeholders = '[]';
    else if (!row.is_template) {
      const bytes = await readBytes(c.env, row);
      if (!bytes) return c.json({ error: 'Not found' }, 404);
      try { placeholders = JSON.stringify(docxPlaceholders(bytes)); } catch { return c.json({ error: BAD_WORD }, 400); }
    }
  }
  const t = now();
  const s = await seal(c.env, 'documents', { name, enc_v: row.enc_v } as { name: string; enc_v: number; kind?: string }, row.enc_v === 2 ? 'work' : 'personal');
  await c.env.DB.prepare('UPDATE documents SET name = ?2, is_template = ?3, placeholders = ?4, updated_at = ?5 WHERE id = ?1').bind(row.id, s.name, is_template, placeholders, t).run();
  await audit(c.env, 'you', 'document.edit', row.id);
  return c.json({ document: asDoc({ ...row, name, is_template, placeholders, updated_at: t }) });
});

documents.delete('/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE documents SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id'), t).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'document.trash', c.req.param('id'));
  return c.json({ ok: true });
});

export default documents;
