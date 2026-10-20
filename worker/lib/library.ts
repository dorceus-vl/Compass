import bundle from '../library/bundle.json' with { type: 'json' };
import type { LibraryPage } from '../../shared/types.ts';
import { buildIndex, search, type SearchIndex } from '../../shared/search.ts';
import type { Env } from '../types.ts';

const BUNDLED = bundle as LibraryPage[];

type Doc = LibraryPage & { id: string };
const toDoc = (p: LibraryPage): Doc => ({ ...p, id: p.slug });

/**
 * Imports (live rows) and lessons of personal projects, full text. Work lessons are sealed and never listed here.
 * Two audiences: the device (forModel false) sees every personal lesson; text that may reach a model (forModel true, ruling P3-6)
 * leaves out lessons, and imports of documents, of projects whose data_boundary is 'offline'.
 */
export async function extraPages(env: Env, forModel = false): Promise<LibraryPage[]> {
  const [imp, les] = await env.DB.batch([
    // The model-facing set leaves out imports whose source document sits in a project that is (now) offline, and imports of a
    // trashed document or of a trashed project's document (Trash means the copilot stops reading it); unfiled documents stay in.
    env.DB.prepare(`SELECT lp.slug, lp.section, lp.title, lp.body FROM library_pages lp LEFT JOIN documents d ON d.id = lp.import_doc_id LEFT JOIN projects dp ON dp.id = d.project_id WHERE lp.deleted_at IS NULL${forModel ? ` AND (dp.id IS NULL OR dp.data_boundary = 'cloud') AND (d.id IS NULL OR d.deleted_at IS NULL) AND (dp.id IS NULL OR dp.deleted_at IS NULL)` : ''} ORDER BY lp.section, lp.title`),
    env.DB.prepare(`SELECT l.id, l.text FROM lessons l JOIN projects p ON p.id = l.project_id WHERE p.kind = 'personal' AND l.deleted_at IS NULL AND l.enc_v = 0 AND p.deleted_at IS NULL${forModel ? ` AND p.data_boundary = 'cloud'` : ''} ORDER BY l.created_at DESC`),
  ]);
  return [
    ...(imp.results as { slug: string; section: string; title: string; body: string }[]).map((r) => ({ ...r, source: 'import' as const })),
    ...(les.results as { id: string; text: string }[]).map((r) => ({ slug: `lesson-${r.id}`, section: 'Lessons', title: r.text.slice(0, 60), body: r.text, source: 'lesson' as const })),
  ];
}

/** Device-facing: everything, for the tree, search and page routes. Never send this to a model; use retrieve. */
export async function allPages(env: Env): Promise<LibraryPage[]> {
  return [...BUNDLED, ...(await extraPages(env))];
}

let cache: { key: string; ix: SearchIndex<Doc> } | undefined; // the bundled-only index is built once per isolate
async function rank(env: Env, q: string, k: number, forModel: boolean): Promise<LibraryPage[]> {
  const extra = await extraPages(env, forModel);
  const key = extra.map((p) => `${p.slug}:${p.body.length}`).join();
  // ponytail: imports and lessons are few, so a changed set re-indexes everything; index them apart if that ever shows.
  if (cache?.key !== key) cache = { key, ix: buildIndex([...BUNDLED, ...extra].map(toDoc)) };
  return search(cache.ix, q, k).map((h) => ({ slug: h.doc.slug, section: h.doc.section, title: h.doc.title, body: h.doc.body, source: h.doc.source }));
}

/** Device search (GET /api/library?q=): every page, including lessons of offline-boundary projects. */
export const searchPages = (env: Env, q: string, k = 20) => rank(env, q, k, false);
/** Model-facing retrieval (Task 7's copilot): lessons of offline-boundary projects are left out. */
export const retrieve = (env: Env, q: string, k = 6) => rank(env, q, k, true);
/** Model-facing lookup by slug (the copilot's "ask about this page"): a lesson of an offline-boundary project is not found. */
export const modelPage = async (env: Env, slug: string) => [...BUNDLED, ...(await extraPages(env, true))].find((p) => p.slug === slug) ?? null;
