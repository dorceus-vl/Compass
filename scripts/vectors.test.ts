// node --experimental-strip-types scripts/vectors.test.ts
// Knowledge search (worker/lib/vectors.ts): the BM25 rerank, the stub embedder, the local vector store, the knowledge meter bucket,
// the KN6 boundary transition and which passages may hold a vector (the pure rule and its SQL twin agree).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { rerank, embed, embedMetered, embedPending, PART_FAILED, hashVector, upsert, query, remove, embedCostMicro, parseKnowledgePrices, sealTurnedWork, unembedStale } from '../worker/lib/vectors.ts';
import { boundaryChange, vectorWanted, HOME, HOME_COLS, LIVE, type PassageHome } from '../worker/lib/knowledge.ts';
import { open } from '../worker/lib/enc.ts';
import { meter, AiRefused } from '../worker/lib/ai.ts';

// rerank: vector score and keywords together; a keyword match lifts a passage over a slightly closer vector, no keyword keeps the vector order
const P = [
  { id: 'a', text: 'Quarterly travel policy for the team.', item_title: 'policy.pdf' },
  { id: 'b', text: 'The zebrafish budget risk: the vendor slips.', item_title: 'risks.docx' },
  { id: 'c', text: 'Lunch menu.', item_title: 'menu.txt' },
];
assert.deepEqual(rerank('zebrafish budget', P, { a: 0.9, b: 0.7, c: 0.2 }).map((p) => p.id), ['b', 'a', 'c'], 'keywords lift b');
assert.deepEqual(rerank('nothing matches here', P, { a: 0.3, b: 0.5, c: 0.4 }).map((p) => p.id), ['b', 'c', 'a'], 'no keyword: vector order');
assert.deepEqual(rerank('menu', P, {}).map((p) => p.id)[0], 'c', 'a passage with no vector score still ranks by keywords');
assert.ok(rerank('zebrafish', P, { b: 0.7 })[0].score > 0, 'scores are returned');
assert.equal(rerank('', [], {}).length, 0);

// the stub embedder: deterministic, 1024 dims, normalized, lexical (shared words land closer), no network
const env = { AI_STUB: '1', DEV_LOGIN: '1' } as never;
const [v1, v2, v3] = await embed(env, ['The zebrafish budget', 'zebrafish budget risks', 'Lunch menu on Friday']);
assert.deepEqual((await embed(env, ['The zebrafish budget']))[0], v1, 'same text, same vector');
assert.equal(v1.length, 1024);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
assert.ok(Math.abs(dot(v1, v1) - 1) < 1e-9, 'normalized');
assert.ok(dot(v1, v2) > dot(v1, v3), 'shared words are closer');
assert.equal(hashVector('').length, 1024, 'empty text still has a vector');
assert.ok(Math.abs(dot(hashVector(''), hashVector('')) - 1) < 1e-9);
// no AI binding at all: the hash vectors too (KN1: the binding is optional)
assert.deepEqual((await embed({} as never, ['The zebrafish budget']))[0], v1);
// a real binding is never called under the stub
let called = 0;
await embed({ AI_STUB: '1', DEV_LOGIN: '1', AI: { run: async () => { called++; return {}; } } } as never, ['x']);
assert.equal(called, 0, 'stub: AI.run not called');
// the real path reads `data` (or `response`) and refuses a short answer
assert.deepEqual(await embed({ AI: { run: async (_m: string, i: { text: string[] }) => ({ shape: [i.text.length, 2], data: i.text.map(() => [1, 0]) }) } } as never, ['x', 'y']), [[1, 0], [1, 0]]);
await assert.rejects(embed({ AI: { run: async () => ({ data: [[1]] }) } } as never, ['x', 'y']), (e: unknown) => e instanceof AiRefused && e.code === 'provider_error');
assert.deepEqual(await embed({ AI: { run: async () => ({ shape: [1, 2], response: [[0, 1]], pooling: 'cls' }) } } as never, ['x']), [[0, 1]], 'the documented response shape');
// no AI binding but a real index: refused, never hash vectors into Vectorize
await assert.rejects(embed({ VECTORIZE: {} } as never, ['x']), (e: unknown) => e instanceof AiRefused && e.code === 'provider_error');
await assert.rejects(embed({ AI: { run: async () => { throw new Error('down'); } } } as never, ['x']), (e: unknown) => e instanceof AiRefused && e.code === 'provider_error');

// the local store (no VECTORIZE): filtered by collection, best first, removable
await upsert({} as never, [{ id: 'p1', values: v1, collection_id: 'A' }, { id: 'p2', values: v2, collection_id: 'A' }, { id: 'p3', values: v2, collection_id: 'B' }, { id: 'p4', values: v3, collection_id: 'A' }]);
assert.deepEqual((await query({} as never, v1, ['A'], 2)).map((m) => m.id), ['p1', 'p2'], 'top 2 of A');
assert.deepEqual((await query({} as never, v2, ['B'], 10)).map((m) => m.id), ['p3'], 'only B');
assert.deepEqual(await query({} as never, v1, [], 10), [], 'no collection, nothing');
await remove({} as never, ['p1']);
assert.ok(!(await query({} as never, v1, ['A'], 10)).some((m) => m.id === 'p1'), 'removed');
// under the local stub a VECTORIZE binding (wrangler dev --local makes one that throws) is never touched
const throwing = { AI_STUB: '1', DEV_LOGIN: '1', VECTORIZE: new Proxy({}, { get: () => () => { throw new Error('remote only'); } }) } as never;
await upsert(throwing, [{ id: 'p5', values: v3, collection_id: 'C' }]);
assert.deepEqual((await query(throwing, v3, ['C'], 5)).map((m) => m.id), ['p5'], 'stub: the in-memory store');
await remove(throwing, ['p5']);
// Vectorize: the filter and no metadata; ids in groups of 1,000 on delete
const calls: unknown[] = [];
const vz = { query: async (v: number[], o: unknown) => { calls.push(o); return { matches: [{ id: 'x', score: 0.5 }], count: 1 }; }, deleteByIds: async (ids: string[]) => { calls.push(ids.length); }, upsert: async (rows: unknown[]) => { calls.push(rows); } };
assert.deepEqual(await query({ VECTORIZE: vz } as never, v1, ['A', 'B'], 40), [{ id: 'x', score: 0.5 }]);
assert.deepEqual(calls[0], { topK: 40, filter: { collection_id: { $in: ['A', 'B'] } }, returnMetadata: 'none' });
await query({ VECTORIZE: vz } as never, v1, null, 40);
assert.deepEqual(calls.pop(), { topK: 40, returnMetadata: 'none' }, 'null: no filter (every live collection; D1 re-checks)');
await remove({ VECTORIZE: vz } as never, Array.from({ length: 2500 }, (_, i) => 'id' + i));
assert.deepEqual(calls.slice(1), [1000, 1000, 500]);
await upsert({ VECTORIZE: vz } as never, [{ id: 'q', values: [1], collection_id: 'A' }]);
assert.deepEqual(calls[4], [{ id: 'q', values: [1], metadata: { collection_id: 'A' } }], 'metadata is the collection id only');

// prices: USD per 1,000 tokens (KNOWLEDGE_PRICES); about 4 characters a token; never 0 for real text
assert.equal(parseKnowledgePrices('{"embed_per_1k_tokens":0.5}').embed_per_1k_tokens, 0.5);
assert.equal(parseKnowledgePrices('nope').embed_per_1k_tokens, parseKnowledgePrices(undefined).embed_per_1k_tokens, 'a bad var falls back');
assert.equal(embedCostMicro(4000, { embed_per_1k_tokens: 1 }), 1_000_000, '1,000 tokens at $1 per 1k');
assert.equal(embedCostMicro(1, { embed_per_1k_tokens: 0.000012 }), 1, 'rounded up');

// KN6 transitions
assert.equal(boundaryChange('cloud', 'cloud'), null);
assert.deepEqual(boundaryChange('cloud', 'locked'), { purge: true, state: { from: 'indexing', to: 'ready' } }, 'Cloud AI -> Locked: vectors go, items are ready');
assert.deepEqual(boundaryChange('locked', 'cloud'), { purge: false, state: { from: 'ready', to: 'indexing' } }, 'Locked -> Cloud AI: items wait for the embedder');

// which passages may hold a vector
const h = (o: Partial<PassageHome> = {}): PassageHome => ({ boundary: 'cloud', scope: 'personal', k_del: null, i_del: null, document_id: 'd', d_id: 'd', d_del: null,
  source: 'upload', source_id: null, s_id: null, s_work: null, project_id: 'p', p_id: 'p', p_del: null, p_boundary: 'cloud', p_kind: 'personal', ...o });
const T = 'x';
const text = { document_id: null, d_id: null };
const meeting = (o: Partial<PassageHome> = {}): Partial<PassageHome> => ({ ...text, scope: 'work', source: 'meeting', source_id: 'm', s_id: 'm', ...o });
const email = (o: Partial<PassageHome> = {}): Partial<PassageHome> => ({ ...text, source: 'email', source_id: 'e', s_id: 'e', s_work: 0, ...o });
const none = { project_id: null, p_id: null, p_boundary: null };
const cases: [Partial<PassageHome>, boolean, string][] = [
  [{}, true, 'live cloud project file'],
  [{ project_id: null, p_id: null, p_boundary: null }, true, 'unfiled file'],
  [{ ...text, source: 'app:compass', ...none }, true, 'no document and no source (app digest)'],
  [{ boundary: 'locked' }, false, 'Locked'],
  [{ k_del: T }, false, 'collection in Trash'],
  [{ i_del: T }, false, 'item in Trash'],
  [{ d_del: T }, false, 'document in Trash'],
  [{ d_id: null, project_id: null, p_id: null, p_boundary: null }, false, 'document gone'],
  [{ p_boundary: 'offline' }, false, 'project Offline only'],
  [{ p_del: T }, false, 'project in Trash'],
  [{ p_id: null, p_boundary: null }, false, 'project gone'],
  // KN16: a meeting or an email follows its project (the meeting's; the project of the task the email became) and its own row
  [meeting(none), true, 'unfiled meeting'],
  [meeting(), true, 'meeting filed in a cloud project'],
  [meeting({ p_boundary: 'offline' }), false, 'meeting filed in an Offline-only project'],
  [meeting({ p_del: T }), false, "meeting's project in Trash"],
  [meeting({ s_id: null, ...none }), false, 'meeting review gone'],
  [email(none), true, 'personal email with no task project'],
  [email(), true, "personal email whose task is in a cloud project"],
  [email({ p_boundary: 'offline' }), false, "email whose task is in an Offline-only project"],
  [email({ p_del: T }), false, "email whose task's project is in Trash"],
  [email({ s_work: 1, ...none }), false, 'email turned work, in a personal collection'],
  [email({ scope: 'work', s_work: 1, ...none }), true, 'work email in a work collection'],
  [email({ s_id: null, ...none }), false, 'email gone'],
  [email({ p_kind: 'work' }), false, "email whose task sits in a work project, in a personal collection"],
  [email({ scope: 'work', p_kind: 'work' }), true, "email whose task sits in a work project, in a work collection"],
];
for (const [o, want, why] of cases) assert.equal(vectorWanted(h(o)), want, why);
// the SQL twin (LIVE) says the same for every case
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE knowledge_collections (id TEXT, boundary TEXT, scope TEXT, deleted_at TEXT); CREATE TABLE knowledge_items (id TEXT, document_id TEXT, deleted_at TEXT, source TEXT, source_id TEXT);
  CREATE TABLE knowledge_chunks (id TEXT, item_id TEXT, collection_id TEXT); CREATE TABLE documents (id TEXT, project_id TEXT, deleted_at TEXT); CREATE TABLE projects (id TEXT, data_boundary TEXT, deleted_at TEXT, kind TEXT);
  CREATE TABLE meeting_reviews (id TEXT, project_id TEXT); CREATE TABLE inbox_items (id TEXT, task_id TEXT, work INTEGER); CREATE TABLE tasks (id TEXT, project_id TEXT)`);
cases.forEach(([o], n) => {
  const r = h(o), id = String(n), pid = r.project_id && r.project_id + id;
  db.prepare('INSERT INTO knowledge_collections VALUES (?, ?, ?, ?)').run('k' + id, r.boundary, r.scope, r.k_del);
  db.prepare('INSERT INTO knowledge_items VALUES (?, ?, ?, ?, ?)').run('i' + id, r.document_id && r.document_id + id, r.i_del, r.source, r.source_id && r.source_id + id);
  db.prepare('INSERT INTO knowledge_chunks VALUES (?, ?, ?)').run(id, 'i' + id, 'k' + id);
  if (r.d_id) db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(r.d_id + id, pid, r.d_del);
  if (r.s_id && r.source === 'meeting') db.prepare('INSERT INTO meeting_reviews VALUES (?, ?)').run(r.s_id + id, pid);
  if (r.s_id && r.source === 'email') { db.prepare('INSERT INTO inbox_items VALUES (?, ?, ?)').run(r.s_id + id, 't' + id, r.s_work); db.prepare('INSERT INTO tasks VALUES (?, ?)').run('t' + id, pid); }
  if (r.p_id) db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(r.p_id + id, r.p_boundary, r.p_del, r.p_kind);
});
const live = new Set((db.prepare(`SELECT c.id FROM ${HOME} WHERE ${LIVE}`).all() as { id: string }[]).map((r) => r.id));
cases.forEach(([, want, why], n) => assert.equal(live.has(String(n)), want, 'SQL: ' + why));
const homes = db.prepare(`SELECT c.id, ${HOME_COLS} FROM ${HOME}`).all() as unknown as (PassageHome & { id: string })[];
for (const r of homes) assert.equal(vectorWanted(r), live.has(r.id), 'HOME_COLS feeds vectorWanted: ' + cases[Number(r.id)][2]);

// Rule 5: an email that turned work while saved in a personal collection is sealed in place by the sweep (title and passages); nothing else is touched.
{
  const w = new DatabaseSync(':memory:');
  w.exec(`CREATE TABLE knowledge_collections (id TEXT, scope TEXT); CREATE TABLE inbox_items (id TEXT, work INTEGER, task_id TEXT); CREATE TABLE tasks (id TEXT, project_id TEXT); CREATE TABLE projects (id TEXT, kind TEXT);
    CREATE TABLE knowledge_items (id TEXT, collection_id TEXT, source TEXT, source_id TEXT, title TEXT, enc_v INTEGER); CREATE TABLE knowledge_chunks (id TEXT, item_id TEXT, text TEXT, locator TEXT, enc_v INTEGER)`);
  w.exec(`INSERT INTO knowledge_collections VALUES ('kp','personal'),('kw','work'); INSERT INTO inbox_items VALUES ('e1',1,NULL),('e0',0,NULL),('ep',0,'t1'); INSERT INTO tasks VALUES ('t1','pw'); INSERT INTO projects VALUES ('pw','work');
    INSERT INTO knowledge_items VALUES ('turned','kp','email','e1','Wombat budget',0),('still','kp','email','e0','Picnic',0),('meet','kp','meeting','e1','Notes',0),('viaproj','kp','email','ep','Vendor call',0);
    INSERT INTO knowledge_chunks VALUES ('c1','turned','The wombat budget is 9k.','part 1',0),('c2','turned','Second part.','part 2',0),('c3','still','Picnic on Sunday.','part 1',0),('c4','meet','Meeting text.','§ Summary',0),('c5','viaproj','Vendor call notes.','part 1',0)`);
  const wd1 = { prepare(q: string) {
    const st = (a: unknown[]) => ({ first: async () => w.prepare(q).get(...(a as never[])) ?? null, run: async () => ({ meta: { changes: Number(w.prepare(q).run(...(a as never[])).changes) } }),
      all: async () => ({ results: w.prepare(q).all(...(a as never[])) }) });
    return { ...st([]), bind: (...a: unknown[]) => st(a) };
  } };
  const wenv = { DB: wd1, COMPASS_DATA_KEY: 'k' } as never;
  assert.equal(await sealTurnedWork(wenv), 2, 'two items turned work: by its row, and by its task sitting in a work project');
  assert.equal((w.prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE item_id = 'viaproj' AND enc_v = 2 AND text NOT LIKE '%Vendor%'").get() as { n: number }).n, 1, 'work by its task project: sealed');
  const item = w.prepare("SELECT title, enc_v FROM knowledge_items WHERE id = 'turned'").get() as { title: string; enc_v: number };
  const rows = w.prepare("SELECT text, locator, enc_v FROM knowledge_chunks WHERE item_id = 'turned' ORDER BY id").all() as { text: string; locator: string; enc_v: number }[];
  assert.ok(item.enc_v === 2 && !item.title.includes('Wombat'), 'title sealed');
  assert.ok(rows.every((r) => r.enc_v === 2 && !r.text.includes('wombat') && !r.text.includes('Second') && !r.locator.includes('part')), 'passages sealed, locators too');
  assert.equal((await open(wenv, 'knowledge_items', item)).title, 'Wombat budget', 'opens with the work key');
  assert.deepEqual(await Promise.all(rows.map(async (r) => (await open(wenv, 'knowledge_chunks', r)).text)), ['The wombat budget is 9k.', 'Second part.']);
  assert.equal((w.prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE enc_v = 0 AND item_id IN ('still','meet')").get() as { n: number }).n, 2, 'a personal email and a meeting stay as they are');
  assert.equal(await sealTurnedWork(wenv), 0, 'idempotent');
}
// The sweep removes vectors first; a sealing failure (here: D1 refuses the sealing query) is logged and never keeps a vector.
{
  const x = new DatabaseSync(':memory:');
  x.exec(`CREATE TABLE knowledge_collections (id TEXT, boundary TEXT, scope TEXT, deleted_at TEXT); CREATE TABLE documents (id TEXT, project_id TEXT, deleted_at TEXT);
    CREATE TABLE knowledge_items (id TEXT, collection_id TEXT, document_id TEXT, deleted_at TEXT, source TEXT, source_id TEXT, title TEXT, enc_v INTEGER);
    CREATE TABLE knowledge_chunks (id TEXT, item_id TEXT, collection_id TEXT, text TEXT, locator TEXT, embedded INTEGER, enc_v INTEGER);
    CREATE TABLE meeting_reviews (id TEXT, project_id TEXT); CREATE TABLE inbox_items (id TEXT, task_id TEXT, work INTEGER); CREATE TABLE tasks (id TEXT, project_id TEXT);
    CREATE TABLE projects (id TEXT, data_boundary TEXT, deleted_at TEXT, kind TEXT);
    INSERT INTO knowledge_collections VALUES ('kp','cloud','personal',NULL); INSERT INTO inbox_items VALUES ('e1',NULL,1);
    INSERT INTO knowledge_items VALUES ('it','kp',NULL,NULL,'email','e1','Wombat',0); INSERT INTO knowledge_chunks VALUES ('cx','it','kp','Wombat text.','part 1',1,0)`);
  const xd1 = { prepare(q: string) {
    if (q.includes("k.scope = 'personal'")) throw new Error('D1 is down'); // only sealTurnedWork's query
    const st = (a: unknown[]) => ({ first: async () => x.prepare(q).get(...(a as never[])) ?? null, run: async () => ({ meta: { changes: Number(x.prepare(q).run(...(a as never[])).changes) } }),
      all: async () => ({ results: x.prepare(q).all(...(a as never[])) }) });
    return { ...st([]), bind: (...a: unknown[]) => st(a) };
  } };
  const xenv = { DB: xd1, AI_STUB: '1', DEV_LOGIN: '1', COMPASS_DATA_KEY: 'k' } as never;
  await assert.rejects(sealTurnedWork(xenv), /D1 is down/, 'sealing throws here');
  const vec = hashVector('Wombat text.');
  await upsert(xenv, [{ id: 'cx', values: vec, collection_id: 'kp' }]);
  assert.ok((await query(xenv, vec, ['kp'], 5)).some((m) => m.id === 'cx'), 'the vector is there');
  const err = console.error; console.error = () => {};
  try { assert.equal(await unembedStale(xenv), 1, 'the stale passage is removed'); } finally { console.error = err; }
  assert.ok(!(await query(xenv, vec, ['kp'], 5)).some((m) => m.id === 'cx'), 'its vector is gone although sealing failed');
  assert.equal((x.prepare("SELECT embedded FROM knowledge_chunks WHERE id = 'cx'").get() as { embedded: number }).embedded, 0);
}

// KN22: a batch Workers AI refuses is split down to single passages; the one it always refuses marks its item failed (fixed text), the rest are embedded,
// and only the calls that answered are billed. When nothing answers (Workers AI down) the run pauses and nothing is marked failed.
{
  const e = new DatabaseSync(':memory:');
  e.exec(`CREATE TABLE settings (id INTEGER, json TEXT); CREATE TABLE audit_log (id TEXT, at TEXT, actor TEXT, action TEXT, target TEXT, detail TEXT);
    CREATE TABLE ai_usage (id TEXT PRIMARY KEY, at TEXT, feature TEXT, provider TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_micro INTEGER);
    CREATE TABLE knowledge_collections (id TEXT, boundary TEXT, scope TEXT, deleted_at TEXT); CREATE TABLE documents (id TEXT, project_id TEXT, deleted_at TEXT);
    CREATE TABLE knowledge_items (id TEXT, collection_id TEXT, document_id TEXT, deleted_at TEXT, source TEXT, source_id TEXT, state TEXT, error TEXT, updated_at TEXT);
    CREATE TABLE knowledge_chunks (id TEXT, item_id TEXT, collection_id TEXT, ord INTEGER, text TEXT, enc_v INTEGER, embedded INTEGER, created_at TEXT);
    CREATE TABLE meeting_reviews (id TEXT, project_id TEXT); CREATE TABLE inbox_items (id TEXT, task_id TEXT, work INTEGER); CREATE TABLE tasks (id TEXT, project_id TEXT);
    CREATE TABLE projects (id TEXT, data_boundary TEXT, deleted_at TEXT, kind TEXT);
    INSERT INTO settings VALUES (1, '{"ai_monthly_cap_micro":1000000000}'); INSERT INTO knowledge_collections VALUES ('kp','cloud','personal',NULL);
    INSERT INTO knowledge_items VALUES ('A','kp',NULL,NULL,'note',NULL,'indexing',NULL,NULL),('B','kp',NULL,NULL,'note',NULL,'indexing',NULL,NULL);
    INSERT INTO knowledge_chunks VALUES ('a1','A','kp',0,'alpha one',0,0,'t1'),('a2','A','kp',1,'POISON two',0,0,'t1'),('a3','A','kp',2,'alpha three',0,0,'t1'),
      ('b1','B','kp',0,'beta one',0,0,'t2'),('b2','B','kp',1,'beta two',0,0,'t2')`);
  const ed1 = { prepare(q: string) {
    const st = (a: unknown[]) => ({ first: async () => e.prepare(q).get(...(a as never[])) ?? null, run: async () => ({ meta: { changes: Number(e.prepare(q).run(...(a as never[])).changes) } }),
      all: async () => ({ results: e.prepare(q).all(...(a as never[])) }) });
    return { ...st([]), bind: (...a: unknown[]) => st(a) };
  } };
  let calls = 0, answered = 0, down = false;
  const AI = { run: async (_m: string, i: { text: string[] }) => { calls++; if (down || i.text.some((t) => t.includes('POISON'))) throw new Error('refused'); answered++; return { data: i.text.map(hashVector) }; } };
  const eenv = { DB: ed1, AI, KNOWLEDGE_PRICES: '{"embed_per_1k_tokens":0.000012}', COMPASS_DATA_KEY: 'k' } as never;
  const n = (q: string) => (e.prepare(q).get() as { n: number }).n;
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await embedPending(eenv, 200), 4, 'four passages embedded around the refused one');
    assert.ok(calls > 1, 'the refused batch was split and retried');
    assert.equal(n("SELECT count(*) AS n FROM knowledge_chunks WHERE embedded = 1"), 4);
    assert.equal(n("SELECT embedded AS n FROM knowledge_chunks WHERE id = 'a2'"), 0, 'the refused passage holds no vector');
    assert.deepEqual(e.prepare("SELECT id, state, error FROM knowledge_items ORDER BY id").all().map((r) => ({ ...r })), [{ id: 'A', state: 'failed', error: PART_FAILED }, { id: 'B', state: 'ready', error: null }]);
    assert.equal(n("SELECT count(*) AS n FROM ai_usage"), answered, 'only the calls that answered are billed');
    assert.ok((await query(eenv, hashVector('beta one'), ['kp'], 5)).some((m) => m.id === 'b1'), "the other item's passages are searchable");
    calls = 0;
    assert.equal(await embedPending(eenv, 200), 0, "a failed item's waiting passage is not picked again");
    assert.equal(calls, 0, 'so the queue never stalls on it');
    // N1: a batch whose every passage is refused while Workers AI is up: the probe answers (billed once), so the item fails instead of being retried forever
    e.exec(`INSERT INTO knowledge_items VALUES ('D','kp',NULL,NULL,'note',NULL,'indexing',NULL,NULL); INSERT INTO knowledge_chunks VALUES ('d1','D','kp',0,'POISON one',0,0,'t25'),('d2','D','kp',1,'POISON two',0,0,'t25')`);
    const billedD = n("SELECT count(*) AS n FROM ai_usage");
    assert.equal(await embedPending(eenv, 200), 0);
    assert.equal(n(`SELECT count(*) AS n FROM knowledge_items WHERE id = 'D' AND state = 'failed' AND error = '${PART_FAILED.replace("'", "''")}'`), 1, 'all refused, probe answers -> the item fails');
    assert.equal(n("SELECT count(*) AS n FROM ai_usage"), billedD + 1, 'only the probe is billed');
    calls = 0; assert.equal(await embedPending(eenv, 200), 0); assert.equal(calls, 0, 'and it is not picked again');
    // Workers AI down: every passage refused -> the probe fails too -> pause, nothing marked failed, nothing billed
    e.exec(`INSERT INTO knowledge_items VALUES ('C','kp',NULL,NULL,'note',NULL,'indexing',NULL,NULL); INSERT INTO knowledge_chunks VALUES ('c1','C','kp',0,'gamma one',0,0,'t3'),('c2','C','kp',1,'gamma two',0,0,'t3')`);
    down = true; const billed = n("SELECT count(*) AS n FROM ai_usage");
    assert.equal(await embedPending(eenv, 200), 0);
    assert.equal(n("SELECT count(*) AS n FROM knowledge_items WHERE id = 'C' AND state = 'indexing' AND error IS NULL"), 1, 'an outage never marks items failed');
    assert.equal(n("SELECT count(*) AS n FROM ai_usage"), billed, 'refused calls are not billed');
  } finally { console.warn = warn; }
}

// meter, on real SQL (node:sqlite): query embeds have their own bucket of 120 an hour, outside the 30 model calls; background ingest batches
// skip it (KN14) and are marked by output_tokens = passage count, so a big ingest never fills it; the monthly cap applies to both.
const sq = new DatabaseSync(':memory:');
sq.exec(`CREATE TABLE settings (id INTEGER, json TEXT); CREATE TABLE audit_log (id TEXT, at TEXT, actor TEXT, action TEXT, target TEXT, detail TEXT);
  CREATE TABLE ai_usage (id TEXT PRIMARY KEY, at TEXT, feature TEXT, provider TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_micro INTEGER)`);
const cap = (micro: number) => { sq.exec('DELETE FROM settings'); sq.prepare('INSERT INTO settings VALUES (1, ?)').run(JSON.stringify({ ai_monthly_cap_micro: micro })); };
cap(1_000_000_000);
const sqlSeen: string[] = [];
const d1 = { prepare(q: string) {
  sqlSeen.push(q);
  const st = (a: unknown[]) => ({ first: async () => sq.prepare(q).get(...(a as never[])) ?? null, run: async () => ({ meta: { changes: Number(sq.prepare(q).run(...(a as never[])).changes) } }),
    all: async () => ({ results: sq.prepare(q).all(...(a as never[])) }) });
  return { ...st([]), bind: (...a: unknown[]) => st(a) };
} };
const kenv = { DB: d1, AI_STUB: '1', DEV_LOGIN: '1', KNOWLEDGE_PRICES: '{"embed_per_1k_tokens":0.000012}' } as never;
const add = (n: number, feature: string, out: number) => { for (let i = 0; i < n; i++) sq.prepare('INSERT INTO ai_usage VALUES (?, ?, ?, ?, 1, ?, 1)').run(crypto.randomUUID(), new Date().toISOString(), feature, feature === 'copilot' ? 'claude' : 'workers_ai', out); };
const used = () => sq.prepare("SELECT output_tokens AS o FROM ai_usage WHERE feature = 'knowledge_embed' ORDER BY rowid DESC LIMIT 1").get() as { o: number };
const limited = (e: unknown) => e instanceof AiRefused && e.code === 'rate_limited';
add(200, 'knowledge_embed', 50); // a big ingest: 200 batches this hour
await embedMetered(kenv, ['a question'], false); // ...doesn't fill the search bucket
assert.equal(used().o, 0, 'a query row carries 0');
await embedMetered(kenv, ['p1', 'p2', 'p3'], true);
assert.equal(used().o, 3, 'an ingest row carries its passage count');
add(119, 'knowledge_embed', 0); // 1 + 119 = 120 queries this hour
await assert.rejects(embedMetered(kenv, ['one more question'], false), limited, '120 query embeds an hour');
await embedMetered(kenv, Array.from({ length: 50 }, (_, i) => 'passage ' + i), true); // ingest goes on with the search bucket full
assert.ok(sqlSeen.some((q) => /feature IN \(\?2\) AND output_tokens = 0/.test(q)), 'the knowledge count reads query rows only');
add(30, 'copilot', 1);
await assert.rejects(meter(kenv, 'copilot'), limited, '30 model calls');
const modelCount = sqlSeen.filter((q) => q.includes('NOT IN')).pop()!;
assert.ok(/NOT IN \(\?2,\?3,\?4\)/.test(modelCount), 'the model count leaves out voice and knowledge (3 features)');
sq.exec("DELETE FROM ai_usage WHERE feature = 'copilot'");
await meter(kenv, 'copilot'); // the knowledge rows (query or ingest) never count as model calls
add(60, 'athena_voice', 0);
await assert.rejects(meter(kenv, 'athena_voice', 1), limited, '60 voice calls');
sq.exec("DELETE FROM ai_usage WHERE feature = 'knowledge_embed' AND output_tokens = 0");
await embedMetered(kenv, ['q'], false); // a full voice bucket doesn't stop knowledge
// the monthly cap stops both, and a failed call writes no row
const spent = (sq.prepare('SELECT SUM(cost_micro) AS c FROM ai_usage').get() as { c: number }).c;
cap(spent);
await assert.rejects(embedMetered(kenv, ['p'], true), (e: unknown) => e instanceof AiRefused && e.code === 'cap_reached', 'the cap stops ingest');
await assert.rejects(embedMetered(kenv, ['q'], false), (e: unknown) => e instanceof AiRefused && e.code === 'cap_reached', 'the cap stops queries');
cap(1_000_000_000);
const rows = () => (sq.prepare('SELECT count(*) AS n FROM ai_usage').get() as { n: number }).n, before = rows();
const failing = { ...(kenv as object), AI_STUB: '0', AI: { run: async () => { throw new Error('down'); } } } as never;
await assert.rejects(embedMetered(failing, ['p'], true), (e: unknown) => e instanceof AiRefused && e.code === 'provider_error');
assert.equal(rows(), before, 'a failed call is not billed');

console.log('vectors: ok');
