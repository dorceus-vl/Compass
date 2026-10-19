import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { LibraryPage } from '../../shared/types.ts';
import { snippet } from '../../shared/search.ts';
import { allPages, extraPages, searchPages } from '../lib/library.ts';
import { now, audit } from '../lib/db.ts';
import { docText } from '../lib/extract.ts';
import { loadDoc, readBytes } from './documents.ts';
import { projectAccess } from '../lib/project-context.ts';

const library = new Hono<{ Bindings: Env; Variables: Variables }>();
const head = ({ slug, section, title, source }: LibraryPage) => ({ slug, section, title, source });

library.get('/', async (c) => {
  const q = c.req.query('q')?.trim().slice(0, 200);
  if (!q) return c.json({ pages: (await allPages(c.env)).map(head) });
  return c.json({ hits: (await searchPages(c.env, q, 20)).map((p) => ({ ...head(p), snippet: snippet(p.body, q) })) });
});

// Imports and personal lessons in full, for the device's own search index. Registered before /:slug.
library.get('/imports', async (c) => c.json({ pages: await extraPages(c.env) }));

// Document text becomes a library page (personal documents only, ruling R8). Importing the same title again refreshes the page.
library.post('/import', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const doc = typeof body.document_id === 'string' ? await loadDoc(c.env, body.document_id) : null;
  if (!doc) return c.json({ error: 'Not found' }, 404);
  const access = await projectAccess(c.env, doc.project_id);
  if (doc.enc_v === 2 || access?.kind === 'work') return c.json({ error: 'Work documents stay out of the library.' }, 403);
  if (!access) return c.json({ error: 'Not found' }, 404); // its project is in Trash
  if (access.boundary === 'offline') return c.json({ error: 'offline_boundary' }, 409); // an import is model-readable, so an offline project's document never becomes one
  if (doc.kind === 'xlsx') return c.json({ error: 'Excel files have no text to import.' }, 400);
  if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120)) return c.json({ error: 'title must be 1-120 characters' }, 400);
  const title = (typeof body.title === 'string' ? body.title : doc.name.replace(/\.[^.]+$/, '')).trim().slice(0, 120) || 'Document';
  const bytes = await readBytes(c.env, doc);
  if (!bytes) return c.json({ error: 'Not found' }, 404);
  let text: string;
  try { text = (await docText(doc.kind, bytes)).trim(); } catch { return c.json({ error: 'That file could not be read.' }, 400); }
  if (!text) return c.json({ error: 'No text found in that document.' }, 400);
  const slug = `import-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '') || 'document'}-${doc.id.slice(0, 6)}`;
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO library_pages (id, slug, section, title, body, import_doc_id, created_at, updated_at) VALUES (?1,?2,'Imports',?3,?4,?5,?6,?6)
      ON CONFLICT(slug) DO UPDATE SET title = ?3, body = ?4, updated_at = ?6, deleted_at = NULL`).bind(crypto.randomUUID(), slug, title, text, doc.id, t),
    c.env.DB.prepare('UPDATE documents SET text_indexed = 1, updated_at = ?2 WHERE id = ?1').bind(doc.id, t),
  ]);
  await audit(c.env, 'you', 'library.import', doc.id);
  return c.json({ page: { slug, section: 'Imports', title, source: 'import' } }, 201);
});

library.delete('/:slug', async (c) => {
  const slug = c.req.param('slug'), t = now();
  const page = await c.env.DB.prepare('SELECT import_doc_id FROM library_pages WHERE slug = ?1 AND deleted_at IS NULL').bind(slug).first<{ import_doc_id: string | null }>();
  if (!page) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE library_pages SET deleted_at = ?2, updated_at = ?2 WHERE slug = ?1').bind(slug, t),
    c.env.DB.prepare('UPDATE documents SET text_indexed = 0 WHERE id = ?1').bind(page.import_doc_id),
  ]);
  await audit(c.env, 'you', 'library.remove', page.import_doc_id ?? slug.slice(0, 6));
  return c.json({ ok: true });
});

library.get('/:slug', async (c) => {
  const page = (await allPages(c.env)).find((p) => p.slug === c.req.param('slug'));
  return page ? c.json({ page }) : c.json({ error: 'Not found' }, 404);
});

export default library;
