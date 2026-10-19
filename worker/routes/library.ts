import { Hono } from 'hono';
import type { Env, Variables } from '../types.ts';
import type { LibraryPage } from '../../shared/types.ts';
import { snippet } from '../../shared/search.ts';
import { allPages, extraPages, searchPages } from '../lib/library.ts';

const library = new Hono<{ Bindings: Env; Variables: Variables }>();
const head = ({ slug, section, title, source }: LibraryPage) => ({ slug, section, title, source });

library.get('/', async (c) => {
  const q = c.req.query('q')?.trim().slice(0, 200);
  if (!q) return c.json({ pages: (await allPages(c.env)).map(head) });
  return c.json({ hits: (await searchPages(c.env, q, 20)).map((p) => ({ ...head(p), snippet: snippet(p.body, q) })) });
});

// Imports and personal lessons in full, for the device's own search index. Registered before /:slug.
library.get('/imports', async (c) => c.json({ pages: await extraPages(c.env) }));

library.get('/:slug', async (c) => {
  const page = (await allPages(c.env)).find((p) => p.slug === c.req.param('slug'));
  return page ? c.json({ page }) : c.json({ error: 'Not found' }, 404);
});

export default library;
