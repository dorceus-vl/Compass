import bundle from '../library/bundle.json';
import type { LibraryPage } from '../../shared/types.ts';
import { buildIndex, search, type SearchIndex } from '../../shared/search.ts';
import type { Env } from '../types.ts';

const BUNDLED = bundle as LibraryPage[];

type Doc = LibraryPage & { id: string };
const toDoc = (p: LibraryPage): Doc => ({ ...p, id: p.slug });

/** Imports (live rows) and lessons of personal projects, full text. Work lessons are sealed and never listed here. */
export async function extraPages(env: Env): Promise<LibraryPage[]> {
  const [imp, les] = await env.DB.batch([
    env.DB.prepare('SELECT slug, section, title, body FROM library_pages WHERE deleted_at IS NULL ORDER BY section, title'),
    env.DB.prepare(`SELECT l.id, l.text FROM lessons l JOIN projects p ON p.id = l.project_id WHERE p.kind = 'personal' AND l.deleted_at IS NULL AND l.enc_v = 0 AND p.deleted_at IS NULL ORDER BY l.created_at DESC`),
  ]);
  return [
    ...(imp.results as { slug: string; section: string; title: string; body: string }[]).map((r) => ({ ...r, source: 'import' as const })),
    ...(les.results as { id: string; text: string }[]).map((r) => ({ slug: `lesson-${r.id}`, section: 'Lessons', title: r.text.slice(0, 60), body: r.text, source: 'lesson' as const })),
  ];
}

export async function allPages(env: Env): Promise<LibraryPage[]> {
  return [...BUNDLED, ...(await extraPages(env))];
}

let cache: { key: string; ix: SearchIndex<Doc> } | undefined; // the bundled-only index is built once per isolate
/** Ranked pages for a question, bundled and live. */
export async function retrieve(env: Env, q: string, k = 6): Promise<LibraryPage[]> {
  const extra = await extraPages(env);
  const key = extra.map((p) => `${p.slug}:${p.body.length}`).join();
  // ponytail: imports and lessons are few, so a changed set re-indexes everything; index them apart if that ever shows.
  if (cache?.key !== key) cache = { key, ix: buildIndex([...BUNDLED, ...extra].map(toDoc)) };
  return search(cache.ix, q, k).map((h) => ({ slug: h.doc.slug, section: h.doc.section, title: h.doc.title, body: h.doc.body, source: h.doc.source }));
}
