// Phase 6 Knowledge: collections, items, ingest, search and Locked passages. Work collections are sealed at rest like other work rows (rule 5).
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, Variables } from '../types.ts';
import type { DocKind, KnowledgeCollection, KnowledgeItem, KnowledgeSource } from '../../shared/types.ts';
import { seal, open, openAll } from '../lib/enc.ts';
import { now, audit } from '../lib/db.ts';
import { requireStepUp } from '../lib/step-up.ts';
import { checkAll, text, oneOf, type Check } from '../lib/validate.ts';
import { chunk, type Passage } from '../lib/chunk.ts';
import { boundaryChange, compatible, needsStepUp, HOME } from '../lib/knowledge.ts';
import { embedPending, hybridSearch, remove } from '../lib/vectors.ts';
import { AiRefused } from '../lib/ai.ts';
import { docxText, pdfPages, pptxText, xlsxText } from '../lib/extract.ts';
import { loadDoc, readBytes } from './documents.ts';

const knowledge = new Hono<{ Bindings: Env; Variables: Variables }>();

const loadCollection = async (env: Env, id: string): Promise<KnowledgeCollection | null> => {
  const row = await env.DB.prepare('SELECT * FROM knowledge_collections WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<KnowledgeCollection>();
  return row ? open(env, 'knowledge_collections', row) : null;
};

/**
 * Stores one item and its passages (sealed when the collection is work). A Locked collection's item is `ready` at once; any other is `indexing` with
 * `embedded = 0` until the embedder runs (callers kick `embedPending(env, …, { item })` in waitUntil; the cron finishes anything left). `error` stores a failed item (no passages); it is stored plain, so it must be a fixed message, never document content. Task 3 and 4 call this for text that is not a document.
 */
export async function addItem(env: Env, coll: KnowledgeCollection, a: { source: KnowledgeSource; title: string; document_id: string | null; passages: Passage[]; error?: string }): Promise<KnowledgeItem> {
  const id = crypto.randomUUID(), t = now(), failed = !!a.error || a.passages.length === 0;
  const state = failed ? 'failed' : coll.boundary === 'locked' ? 'ready' : 'indexing';
  const item: KnowledgeItem = { id, collection_id: coll.id, document_id: a.document_id, source: a.source, title: a.title, state, error: a.error ?? (failed ? 'No text found in that document.' : null),
    chunk_count: failed ? 0 : a.passages.length, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 };
  const si = await seal(env, 'knowledge_items', { ...item }, coll.scope);
  const insItem = env.DB.prepare('INSERT INTO knowledge_items (id, collection_id, document_id, source, title, state, error, chunk_count, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10)')
    .bind(id, coll.id, a.document_id, a.source, si.title, state, item.error, item.chunk_count, t, si.enc_v);
  const rows = failed ? [] : a.passages;
  try {
    for (let i = 0; i === 0 || i < rows.length; i += 99) { // 99 passages and, the first time, the item in one batch
      const sealed = await Promise.all(rows.slice(i, i + 99).map((p, j) => seal(env, 'knowledge_chunks', { id: crypto.randomUUID(), ord: i + j, locator: p.locator, text: p.text, enc_v: 0 }, coll.scope)));
      await env.DB.batch([...(i === 0 ? [insItem] : []), ...sealed.map((s) => env.DB.prepare(
        'INSERT INTO knowledge_chunks (id, item_id, collection_id, ord, locator, text, embedded, created_at, enc_v) VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8)').bind(s.id, id, coll.id, s.ord, s.locator, s.text, t, s.enc_v))]);
    }
    if (state === 'ready') await env.DB.prepare("UPDATE knowledge_items SET state = 'ready' WHERE id = ?1").bind(id).run(); // a Locked item is readable only once it is whole
  } catch (e) {
    await env.DB.batch([env.DB.prepare('DELETE FROM knowledge_chunks WHERE item_id = ?1').bind(id), env.DB.prepare('DELETE FROM knowledge_items WHERE id = ?1').bind(id)]).catch(() => {});
    throw e;
  }
  await audit(env, 'you', 'knowledge.item.add', id, { source: a.source, state, chunks: item.chunk_count });
  return item;
}

/** The passages of a stored document: its text extracted with the existing readers (a PDF per page, a Word file with its headings), then chunked. */
async function passagesOf(kind: DocKind, bytes: Uint8Array): Promise<Passage[]> {
  const t = kind === 'pdf' ? await pdfPages(bytes) : kind === 'docx' ? docxText(bytes, true) : kind === 'pptx' ? pptxText(bytes) : kind === 'xlsx' ? xlsxText(bytes).text
    : kind === 'png' || kind === 'jpg' ? '' : new TextDecoder().decode(bytes);
  return chunk(t, kind);
}

knowledge.get('/collections', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT k.*, (SELECT count(*) FROM knowledge_items i WHERE i.collection_id = k.id AND i.deleted_at IS NULL) AS item_count
    FROM knowledge_collections k WHERE k.deleted_at IS NULL ORDER BY k.system DESC, k.created_at`).all<KnowledgeCollection>();
  return c.json({ collections: await openAll(c.env, 'knowledge_collections', results) });
});

const CHECKS: Record<string, Check> = { name: text(200), boundary: oneOf('cloud', 'locked') };
const body = (c: { req: { json: <T>() => Promise<T> } }) => c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

knowledge.post('/collections', async (c) => {
  const b = await body(c);
  const r = checkAll({ name: b.name, boundary: b.boundary ?? undefined }, CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if (!r.values.name) return c.json({ error: 'name is required' }, 400);
  if (b.scope !== 'work' && b.scope !== 'personal') return c.json({ error: 'scope must be one of: work, personal' }, 400);
  // A work collection is Locked unless it is made Cloud AI on purpose; a personal one is always Cloud AI.
  const boundary = b.scope === 'personal' ? 'cloud' : (r.values.boundary as string | undefined) ?? 'locked';
  if (b.scope === 'personal' && r.values.boundary === 'locked') return c.json({ error: 'Personal collections are always Cloud AI.' }, 400);
  if (needsStepUp(b.scope, null, boundary as 'cloud' | 'locked')) { const refused = await requireStepUp(c); if (refused) return refused; } // a work collection made Cloud AI, like Locked -> Cloud AI
  const t = now();
  const row = { id: crypto.randomUUID(), name: r.values.name as string, scope: b.scope, boundary, system: 0, created_at: t, updated_at: t, deleted_at: null, enc_v: 0 } as KnowledgeCollection;
  const s = await seal(c.env, 'knowledge_collections', { ...row }, row.scope);
  await c.env.DB.prepare('INSERT INTO knowledge_collections (id, name, scope, boundary, system, created_at, updated_at, enc_v) VALUES (?1,?2,?3,?4,0,?5,?5,?6)').bind(row.id, s.name, row.scope, boundary, t, s.enc_v).run();
  await audit(c.env, 'you', 'knowledge.collection.create', row.id, { scope: row.scope, boundary });
  return c.json({ collection: { ...row, item_count: 0 } }, 201);
});

knowledge.patch('/collections/:id', async (c) => {
  const coll = await loadCollection(c.env, c.req.param('id'));
  if (!coll) return c.json({ error: 'Not found' }, 404);
  const r = checkAll(await body(c), CHECKS);
  if ('error' in r) return c.json({ error: r.error }, 400);
  if ('name' in r.values && !r.values.name) return c.json({ error: 'name is required' }, 400);
  const name = (r.values.name as string | undefined) ?? coll.name, boundary = (r.values.boundary as KnowledgeCollection['boundary'] | undefined) ?? coll.boundary;
  if (coll.scope === 'personal' && boundary === 'locked') return c.json({ error: 'Personal collections are always Cloud AI.' }, 400);
  const change = boundaryChange(coll.boundary, boundary), toCloud = !!change && !change.purge;
  if (toCloud) {
    const refused = needsStepUp(coll.scope, coll.boundary, boundary) ? await requireStepUp(c) : null; // passkey: Locked passages become readable by a model
    if (refused) return refused;
    // An Offline-only project's file may sit in a Locked collection; it never becomes Cloud AI.
    const off = await c.env.DB.prepare(`SELECT 1 FROM knowledge_items i JOIN documents d ON d.id = i.document_id JOIN projects p ON p.id = d.project_id
      WHERE i.collection_id = ?1 AND i.deleted_at IS NULL AND p.data_boundary = 'offline' LIMIT 1`).bind(coll.id).first();
    if (off) return c.json({ error: 'offline_boundary', message: 'This collection holds a file from an Offline-only project, so it stays Locked.' }, 409);
  }
  // KN6: Cloud AI -> Locked deletes every passage's vector first (an id with none is fine), then un-embeds them.
  const ids = change?.purge ? (await c.env.DB.prepare('SELECT id FROM knowledge_chunks WHERE collection_id = ?1').bind(coll.id).all<{ id: string }>()).results.map((x) => x.id) : [];
  await remove(c.env, ids);
  const t = now(), s = await seal(c.env, 'knowledge_collections', { name, enc_v: coll.enc_v }, coll.scope);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE knowledge_collections SET name = ?2, boundary = ?3, updated_at = ?4, enc_v = ?5 WHERE id = ?1').bind(coll.id, s.name, boundary, t, s.enc_v),
    ...(change ? [
      c.env.DB.prepare('UPDATE knowledge_chunks SET embedded = 0 WHERE collection_id = ?1').bind(coll.id),
      // Cloud AI items wait for the embedder; Locked ones are searched as they are.
      c.env.DB.prepare(`UPDATE knowledge_items SET state = ?2, updated_at = ?3 WHERE collection_id = ?1 AND state = ?4`).bind(coll.id, change.state.to, t, change.state.from),
    ] : []),
  ]);
  await remove(c.env, ids); // again: a batch the embedder upserted between the first delete and the update (it re-checks after the update itself)
  if (toCloud) c.executionCtx.waitUntil(embedPending(c.env, 200, { collection: coll.id }).catch((e) => console.error(`[knowledge] embed failed: ${(e as Error).name}`)));
  await audit(c.env, 'you', change ? 'knowledge.boundary' : 'knowledge.collection.edit', coll.id, change ? { boundary } : undefined);
  return c.json({ collection: { ...coll, name, boundary, updated_at: t } });
});

knowledge.delete('/collections/:id', async (c) => {
  const coll = await loadCollection(c.env, c.req.param('id'));
  if (!coll) return c.json({ error: 'Not found' }, 404);
  const refused = await requireStepUp(c); // passkey, like Empty Trash
  if (refused) return refused;
  const t = now();
  await c.env.DB.prepare('UPDATE knowledge_collections SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(coll.id, t).run();
  await audit(c.env, 'you', 'knowledge.collection.trash', coll.id);
  return c.json({ ok: true });
});

knowledge.get('/collections/:id/items', async (c) => {
  const coll = await loadCollection(c.env, c.req.param('id'));
  if (!coll) return c.json({ error: 'Not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM knowledge_items WHERE collection_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500').bind(coll.id).all<KnowledgeItem>();
  return c.json({ items: await openAll(c.env, 'knowledge_items', results) });
});

const BOUNDARY = 'A work collection takes only work files, and a personal collection never does.';

knowledge.post('/items', async (c) => {
  const b = await body(c);
  if (typeof b.collection_id !== 'string' || typeof b.document_id !== 'string') return c.json({ error: 'collection_id and document_id are required' }, 400);
  const coll = await loadCollection(c.env, b.collection_id), doc = await loadDoc(c.env, b.document_id);
  if (!coll || !doc) return c.json({ error: 'Not found' }, 404);
  let projectKind: 'work' | 'personal' | null = null, offline = false;
  if (doc.project_id) {
    const p = await c.env.DB.prepare('SELECT kind, data_boundary, deleted_at FROM projects WHERE id = ?1').bind(doc.project_id).first<{ kind: 'work' | 'personal'; data_boundary: string; deleted_at: string | null }>();
    if (!p || p.deleted_at) return c.json({ error: 'Not found' }, 404); // its project is in Trash
    projectKind = p.kind; offline = p.data_boundary === 'offline';
  }
  if (!compatible(coll.scope, { projectKind, sealed: doc.enc_v === 2 })) return c.json({ error: 'knowledge_boundary', message: BOUNDARY }, 409);
  if (offline && coll.boundary === 'cloud') return c.json({ error: 'offline_boundary', message: 'That file is from an Offline-only project, so only a Locked collection can take it.' }, 409);
  if (await c.env.DB.prepare('SELECT 1 FROM knowledge_items WHERE collection_id = ?1 AND document_id = ?2 AND deleted_at IS NULL').bind(coll.id, doc.id).first()) return c.json({ error: 'already_in_collection' }, 409);
  const bytes = await readBytes(c.env, doc);
  if (!bytes) return c.json({ error: 'Not found' }, 404);
  let passages: Passage[] = [], error: string | undefined;
  if (doc.kind === 'png' || doc.kind === 'jpg') error = 'Images are not read yet.';
  else try { passages = await passagesOf(doc.kind, bytes); } catch { error = 'That file could not be read.'; }
  const item = await addItem(c.env, coll, { source: 'upload', title: doc.name, document_id: doc.id, passages, error });
  if (item.state === 'indexing') c.executionCtx.waitUntil(embedPending(c.env, 200, { item: item.id }).catch((e) => console.error(`[knowledge] embed failed: ${(e as Error).name}`)));
  return c.json({ item }, 201);
});

knowledge.delete('/items/:id', async (c) => {
  const t = now();
  const r = await c.env.DB.prepare('UPDATE knowledge_items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(c.req.param('id'), t).run();
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(c.env, 'you', 'knowledge.item.trash', c.req.param('id'));
  return c.json({ ok: true });
});

/** KN4: meaning and keywords over Cloud AI and personal collections (`collections` = comma-separated ids; none = all of them). Locked ones are never here. */
knowledge.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 500);
  if (!q) return c.json({ error: 'q is required' }, 400);
  const ids = c.req.query('collections')?.split(',').map((x) => x.trim()).filter(Boolean);
  try {
    return c.json({ passages: await hybridSearch(c.env, q, ids?.length ? ids : null, 10) }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (e) {
    if (e instanceof AiRefused) return c.json({ error: e.code, message: e.message }, e.status as ContentfulStatusCode);
    throw e;
  }
});

/**
 * KN4: a Locked collection's passages, opened, for the device's in-memory search (Vlad's session only: the agent API never routes here). Live items only;
 * a trashed document or project leaves it, an Offline-only project's file stays (Locked is where it may sit). Never cached.
 */
knowledge.get('/locked/:id/passages', async (c) => {
  const coll = await loadCollection(c.env, c.req.param('id'));
  if (!coll || coll.scope !== 'work' || coll.boundary !== 'locked') return c.json({ error: 'Not found' }, 404);
  // ponytail: the whole collection in one answer; page it if a Locked collection outgrows a response.
  const { results } = await c.env.DB.prepare(`SELECT c.id, c.item_id, c.ord, c.locator, c.text, c.enc_v, i.title AS item_title, i.enc_v AS item_enc_v FROM ${HOME}
    WHERE c.collection_id = ?1 AND i.deleted_at IS NULL AND (i.document_id IS NULL OR (d.id IS NOT NULL AND d.deleted_at IS NULL AND (d.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))))
    ORDER BY i.created_at, c.ord`).bind(coll.id).all<{ id: string; item_id: string; ord: number; locator: string; text: string; enc_v: number; item_title: string; item_enc_v: number }>();
  const passages = await Promise.all(results.map(async (r) => {
    const p = await open(c.env, 'knowledge_chunks', { locator: r.locator, text: r.text, enc_v: r.enc_v });
    return { id: r.id, item_id: r.item_id, ord: r.ord, locator: p.locator, text: p.text, item_title: (await open(c.env, 'knowledge_items', { title: r.item_title, enc_v: r.item_enc_v })).title };
  }));
  return c.json({ passages }, 200, { 'Cache-Control': 'private, no-store' });
});

export default knowledge;
