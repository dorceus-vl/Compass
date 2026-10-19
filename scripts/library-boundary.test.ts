import assert from 'node:assert/strict';
import { allPages, retrieve, searchPages, modelPage } from '../worker/lib/library.ts';

// A stub D1: the lessons query is answered according to whether it filters on the offline boundary.
const lessons = [{ id: 'cloud1', text: 'Aardvark cloud lesson', boundary: 'cloud' }, { id: 'off1', text: 'Aardvark offline lesson', boundary: 'offline' }];
const env = { DB: {
  prepare: (sql: string) => ({ sql }),
  batch: async (stmts: { sql: string }[]) => [{ results: [] }, { results: lessons.filter((l) => !stmts[1].sql.includes(`data_boundary = 'cloud'`) || l.boundary === 'cloud') }],
} } as never;

const slugs = (xs: { slug: string }[]) => xs.map((p) => p.slug).sort();
assert.deepEqual(slugs((await allPages(env)).filter((p) => p.source === 'lesson')), ['lesson-cloud1', 'lesson-off1'], 'device list keeps offline-project lessons');
assert.deepEqual(slugs(await searchPages(env, 'aardvark')), ['lesson-cloud1', 'lesson-off1'], 'device search keeps them');
assert.deepEqual(slugs(await retrieve(env, 'aardvark')), ['lesson-cloud1'], 'model retrieval leaves them out');
assert.equal((await modelPage(env, 'lesson-cloud1'))?.slug, 'lesson-cloud1', 'ask-about-this-page finds a cloud lesson');
assert.equal(await modelPage(env, 'lesson-off1'), null, 'ask-about-this-page never finds an offline-project lesson');
assert.equal((await modelPage(env, 'how-to-use-the-library'))?.source, 'bundled', 'bundled pages are found');
console.log('library-boundary: ok');
