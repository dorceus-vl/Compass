import assert from 'node:assert/strict';
import { allPages, retrieve, searchPages, modelPage } from '../worker/lib/library.ts';

// A stub D1: the lessons and imports queries is answered according to whether it filters on the offline boundary.
const lessons = [{ id: 'cloud1', text: 'Aardvark cloud lesson', boundary: 'cloud' }, { id: 'off1', text: 'Aardvark offline lesson', boundary: 'offline' }];
const imports = [{ slug: 'import-open-abc123', boundary: 'cloud' }, { slug: 'import-unfiled-def456', boundary: null }, { slug: 'import-off-ghi789', boundary: 'offline' },
  { slug: 'import-trasheddoc-jkl012', boundary: 'cloud', trashed: 'd' }, { slug: 'import-trashedproj-mno345', boundary: 'cloud', trashed: 'dp' }];
const modelSees = (sql: string, i: (typeof imports)[number]) => !sql.includes(`data_boundary = 'cloud'`)
  || (i.boundary !== 'offline' && !(i.trashed && sql.includes(`${i.trashed}.deleted_at IS NULL`)));
const env = { DB: {
  prepare: (sql: string) => ({ sql }),
  batch: async (stmts: { sql: string }[]) => [{ results: imports.filter((i) => modelSees(stmts[0].sql, i)).map((i) => ({ slug: i.slug, section: 'Imports', title: 'Platypus ' + i.slug, body: 'Platypus import' })) }, { results: lessons.filter((l) => !stmts[1].sql.includes(`data_boundary = 'cloud'`) || l.boundary === 'cloud') }],
} } as never;

const slugs = (xs: { slug: string }[]) => xs.map((p) => p.slug).sort();
assert.deepEqual(slugs((await allPages(env)).filter((p) => p.source === 'lesson')), ['lesson-cloud1', 'lesson-off1'], 'device list keeps offline-project lessons');
assert.deepEqual(slugs(await searchPages(env, 'aardvark')), ['lesson-cloud1', 'lesson-off1'], 'device search keeps them');
assert.deepEqual(slugs(await retrieve(env, 'aardvark')), ['lesson-cloud1'], 'model retrieval leaves them out');
assert.equal((await modelPage(env, 'lesson-cloud1'))?.slug, 'lesson-cloud1', 'ask-about-this-page finds a cloud lesson');
assert.equal(await modelPage(env, 'lesson-off1'), null, 'ask-about-this-page never finds an offline-project lesson');
assert.equal((await modelPage(env, 'how-to-use-the-library'))?.source, 'bundled', 'bundled pages are found');
const imp = (xs: { slug: string; source: string }[]) => slugs(xs.filter((p) => p.source === 'import'));
const everyImport = imports.map((i) => i.slug).sort();
assert.deepEqual(imp(await allPages(env)), everyImport, 'device list keeps imports of offline-project and trashed documents');
assert.deepEqual(imp(await searchPages(env, 'platypus')), everyImport, 'device search keeps them');
assert.deepEqual(imp(await retrieve(env, 'platypus')), ['import-open-abc123', 'import-unfiled-def456'], 'model retrieval leaves out imports from offline projects, trashed documents and trashed projects; keeps unfiled');
assert.equal(await modelPage(env, 'import-trasheddoc-jkl012'), null, 'a trashed document\'s import is not model-facing');
assert.equal(await modelPage(env, 'import-trashedproj-mno345'), null, 'a trashed project\'s document import is not model-facing');
assert.equal(await modelPage(env, 'import-off-ghi789'), null, 'ask-about-this-page never finds an offline-project import');
assert.equal((await modelPage(env, 'import-unfiled-def456'))?.slug, 'import-unfiled-def456');
console.log('library-boundary: ok');
