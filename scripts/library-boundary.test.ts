import assert from 'node:assert/strict';
import { allPages, retrieve, searchPages, modelPage } from '../worker/lib/library.ts';

// A stub D1: the lessons and imports queries is answered according to whether it filters on the offline boundary.
const lessons = [{ id: 'cloud1', text: 'Aardvark cloud lesson', boundary: 'cloud' }, { id: 'off1', text: 'Aardvark offline lesson', boundary: 'offline' }];
const imports = [{ slug: 'import-open-abc123', boundary: 'cloud' }, { slug: 'import-unfiled-def456', boundary: null }, { slug: 'import-off-ghi789', boundary: 'offline' }];
const env = { DB: {
  prepare: (sql: string) => ({ sql }),
  batch: async (stmts: { sql: string }[]) => [{ results: imports.filter((i) => !stmts[0].sql.includes(`data_boundary = 'cloud'`) || i.boundary !== 'offline').map((i) => ({ slug: i.slug, section: 'Imports', title: 'Platypus ' + i.slug, body: 'Platypus import' })) }, { results: lessons.filter((l) => !stmts[1].sql.includes(`data_boundary = 'cloud'`) || l.boundary === 'cloud') }],
} } as never;

const slugs = (xs: { slug: string }[]) => xs.map((p) => p.slug).sort();
assert.deepEqual(slugs((await allPages(env)).filter((p) => p.source === 'lesson')), ['lesson-cloud1', 'lesson-off1'], 'device list keeps offline-project lessons');
assert.deepEqual(slugs(await searchPages(env, 'aardvark')), ['lesson-cloud1', 'lesson-off1'], 'device search keeps them');
assert.deepEqual(slugs(await retrieve(env, 'aardvark')), ['lesson-cloud1'], 'model retrieval leaves them out');
assert.equal((await modelPage(env, 'lesson-cloud1'))?.slug, 'lesson-cloud1', 'ask-about-this-page finds a cloud lesson');
assert.equal(await modelPage(env, 'lesson-off1'), null, 'ask-about-this-page never finds an offline-project lesson');
assert.equal((await modelPage(env, 'how-to-use-the-library'))?.source, 'bundled', 'bundled pages are found');
const imp = (xs: { slug: string; source: string }[]) => slugs(xs.filter((p) => p.source === 'import'));
assert.deepEqual(imp(await allPages(env)), ['import-off-ghi789', 'import-open-abc123', 'import-unfiled-def456'], 'device list keeps imports of offline-project documents');
assert.deepEqual(imp(await searchPages(env, 'platypus')), ['import-off-ghi789', 'import-open-abc123', 'import-unfiled-def456'], 'device search keeps them');
assert.deepEqual(imp(await retrieve(env, 'platypus')), ['import-open-abc123', 'import-unfiled-def456'], 'model retrieval leaves out imports from offline projects, keeps unfiled');
assert.equal(await modelPage(env, 'import-off-ghi789'), null, 'ask-about-this-page never finds an offline-project import');
assert.equal((await modelPage(env, 'import-unfiled-def456'))?.slug, 'import-unfiled-def456');
console.log('library-boundary: ok');
