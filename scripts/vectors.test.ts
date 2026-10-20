// node --experimental-strip-types scripts/vectors.test.ts
// Knowledge search (worker/lib/vectors.ts): the BM25 rerank, the stub embedder, the local vector store, the knowledge meter bucket,
// the KN6 boundary transition and which passages may hold a vector (the pure rule and its SQL twin agree).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { rerank, embed, hashVector, upsert, query, remove, embedCostMicro, parseKnowledgePrices } from '../worker/lib/vectors.ts';
import { boundaryChange, vectorWanted, HOME, HOME_COLS, LIVE, type PassageHome } from '../worker/lib/knowledge.ts';
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
const h = (o: Partial<PassageHome> = {}): PassageHome => ({ boundary: 'cloud', k_del: null, i_del: null, document_id: 'd', d_id: 'd', d_del: null, project_id: 'p', p_id: 'p', p_del: null, p_boundary: 'cloud', ...o });
const T = 'x';
const cases: [Partial<PassageHome>, boolean, string][] = [
  [{}, true, 'live cloud project file'],
  [{ project_id: null, p_id: null, p_boundary: null }, true, 'unfiled file'],
  [{ document_id: null, d_id: null, project_id: null, p_id: null, p_boundary: null }, true, 'no document (meeting, email, app digest)'],
  [{ boundary: 'locked' }, false, 'Locked'],
  [{ k_del: T }, false, 'collection in Trash'],
  [{ i_del: T }, false, 'item in Trash'],
  [{ d_del: T }, false, 'document in Trash'],
  [{ d_id: null, project_id: null, p_id: null, p_boundary: null }, false, 'document gone'],
  [{ p_boundary: 'offline' }, false, 'project Offline only'],
  [{ p_del: T }, false, 'project in Trash'],
  [{ p_id: null, p_boundary: null }, false, 'project gone'],
];
for (const [o, want, why] of cases) assert.equal(vectorWanted(h(o)), want, why);
// the SQL twin (LIVE) says the same for every case
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE knowledge_collections (id TEXT, boundary TEXT, deleted_at TEXT); CREATE TABLE knowledge_items (id TEXT, document_id TEXT, deleted_at TEXT);
  CREATE TABLE knowledge_chunks (id TEXT, item_id TEXT, collection_id TEXT); CREATE TABLE documents (id TEXT, project_id TEXT, deleted_at TEXT); CREATE TABLE projects (id TEXT, data_boundary TEXT, deleted_at TEXT)`);
cases.forEach(([o], n) => {
  const r = h(o), id = String(n);
  db.prepare('INSERT INTO knowledge_collections VALUES (?, ?, ?)').run('k' + id, r.boundary, r.k_del);
  db.prepare('INSERT INTO knowledge_items VALUES (?, ?, ?)').run('i' + id, r.document_id && r.document_id + id, r.i_del);
  db.prepare('INSERT INTO knowledge_chunks VALUES (?, ?, ?)').run(id, 'i' + id, 'k' + id);
  if (r.d_id) db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(r.d_id + id, r.project_id && r.project_id + id, r.d_del);
  if (r.p_id) db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(r.p_id + id, r.p_boundary, r.p_del);
});
const live = new Set((db.prepare(`SELECT c.id FROM ${HOME} WHERE ${LIVE}`).all() as { id: string }[]).map((r) => r.id));
cases.forEach(([, want, why], n) => assert.equal(live.has(String(n)), want, 'SQL: ' + why));
const homes = db.prepare(`SELECT c.id, ${HOME_COLS} FROM ${HOME}`).all() as unknown as (PassageHome & { id: string })[];
for (const r of homes) assert.equal(vectorWanted(r), live.has(r.id), 'HOME_COLS feeds vectorWanted: ' + cases[Number(r.id)][2]);

// meter: knowledge_embed has its own bucket of 120 an hour and stays out of the 30 model calls
const counts: Record<string, number> = { model: 30, voice: 0, knowledge: 0 };
const sql: { q: string; args: unknown[] }[] = [];
const mdb = {
  prepare(q: string) {
    const stmt = (args: unknown[]) => ({
      async first() {
        sql.push({ q, args });
        if (q.includes('FROM settings')) return { json: JSON.stringify({ ai_monthly_cap_micro: 1_000_000 }) };
        if (q.includes('SUM(cost_micro)')) return { c: 0 };
        if (q.includes('COUNT(*)')) return { n: q.includes('NOT IN') ? counts.model : args.includes('knowledge_embed') ? counts.knowledge : counts.voice };
        return null;
      },
      async run() { return { meta: { changes: 1 } }; },
    });
    return { ...stmt([]), bind: (...args: unknown[]) => stmt(args) };
  },
};
const menv = { DB: mdb } as never;
await assert.rejects(meter(menv, 'copilot'), (e: unknown) => e instanceof AiRefused && e.code === 'rate_limited', 'model bucket full');
await meter(menv, 'knowledge_embed', 1); // the model bucket is full, the knowledge one is not
const modelCount = sql.find((s) => s.q.includes('NOT IN'))!;
assert.ok(modelCount.args.includes('knowledge_embed') && modelCount.args.includes('athena_voice'), 'the model count leaves out knowledge and voice');
counts.knowledge = 120;
await assert.rejects(meter(menv, 'knowledge_embed', 1), (e: unknown) => e instanceof AiRefused && e.code === 'rate_limited', '120 knowledge calls an hour');
counts.knowledge = 0; counts.voice = 60;
await meter(menv, 'knowledge_embed', 1); // a full voice bucket doesn't stop knowledge

console.log('vectors: ok');
