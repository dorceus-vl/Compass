// node --experimental-strip-types scripts/digest.test.ts
// "From my apps" (worker/lib/digest.ts), on real SQL (every migration applied to node:sqlite): the Compass digest is personal only (no work row, no
// Offline-only project, nothing trashed), the cron's once-a-day rule, the 10-minute claim, and refreshApps against a faked Kelly-Cloud relay: five
// items, a second refresh replaces them (old passages and vectors gone), a failing source keeps yesterday's item and shows its error, and the
// system collection is out of every save path.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { appsDue, claimRefresh, cleanRelay, compassDigest, lastRun, refreshApps, retryOnly, scrub, waitMinutes, SECTION_MAX } from '../worker/lib/digest.ts';
import { query, hashVector } from '../worker/lib/vectors.ts';

const db = new DatabaseSync(':memory:');
const dir = new URL('../worker/migrations/', import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
type Stmt = { sql: string; args: unknown[]; bind: (...a: unknown[]) => Stmt; run: () => Promise<{ meta: { changes: number } }>; all: () => Promise<{ results: unknown[] }>; first: () => Promise<unknown> };
const stmt = (sql: string, args: unknown[] = []): Stmt => ({
  sql, args, bind: (...a) => stmt(sql, a),
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
  all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
  first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
});
let failDelete = false; // the next batch that deletes items throws (D1 down)
const DB = { prepare: (sql: string) => stmt(sql), batch: async (xs: Stmt[]) => { if (failDelete && xs.some((x) => x.sql.startsWith('DELETE FROM knowledge_items'))) { failDelete = false; throw new Error('D1 is down'); } const out = []; for (const x of xs) out.push(/^\s*(SELECT|WITH)/i.test(x.sql) ? await x.all() : await x.run()); return out; } };
const env = { DB, AI_STUB: '1', DEV_LOGIN: '1', COMPASS_DATA_KEY: 'k', KELLY_RELAY_URL: 'https://relay.test/api/compass-relay', KELLY_RELAY_SECRET: 's3cret' } as never;
const T = '2026-10-01T00:00:00.000Z', at = new Date('2026-10-20T15:00:00Z'); // Tuesday; the week ends Sunday 2026-10-25
const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

// -- Seeds: personal and work, in every state the digest must tell apart.
const project = (id: string, name: string, kind: string, o: Record<string, unknown> = {}) => db.prepare(`INSERT INTO projects (id, name, kind, status, rag, rag_reason, phase, data_boundary, enc_v, created_at, updated_at, deleted_at, end_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(id, name, kind, (o.status as string) ?? 'active', (o.rag as string) ?? 'amber', (o.reason as string) ?? null, 'Execution', (o.boundary as string) ?? 'cloud', kind === 'work' ? 2 : 0, T, T, (o.deleted as string) ?? null, (o.end as string) ?? null);
const task = (id: string, title: string, kind: string, o: Record<string, unknown> = {}) => db.prepare(`INSERT INTO tasks (id, title, kind, status, due_at, project_id, enc_v, deleted_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(id, title, kind, (o.status as string) ?? 'new', (o.due as string) ?? null, (o.project as string) ?? null, kind === 'work' ? 2 : 0, (o.deleted as string) ?? null, T, T);
project('pp', 'Garden shed', 'personal', { reason: 'Permit pending', end: '2026-12-01' });
project('pnone', 'No status project', 'personal', { rag: 'none' });
project('pclosed', 'Closed trip', 'personal', { status: 'closed' });
project('poff', 'Private offline plan', 'personal', { boundary: 'offline' });
project('ptrash', 'Trashed plan', 'personal', { deleted: T });
project('pw', 'WORKPROJECT Atlas', 'work');
task('t-over', 'Pay parking ticket', 'personal', { due: '2026-10-18' });
task('t-week', 'Book dentist', 'personal', { due: '2026-10-23T09:00:00.000Z', status: 'progress' });
task('t-later', 'Renew passport', 'personal', { due: '2026-11-30' });
task('t-open', 'Sort the garage', 'personal');
task('t-proj', 'Order shed kit', 'personal', { project: 'pp', due: '2026-10-22' });
task('t-done', 'Done already', 'personal', { status: 'done' });
task('t-del', 'Deleted task', 'personal', { deleted: T });
task('t-off', 'OFFLINEONLY buy gift', 'personal', { project: 'poff' });
task('t-trashproj', 'TRASHEDPROJECT task', 'personal', { project: 'ptrash' });
task('t-work', 'WORKSECRET renegotiate contract', 'work', { due: '2026-10-21' });
task('t-workproj', 'WORKSECRET sprint demo', 'work', { project: 'pw' });
task('t-sealed', 'WORKSECRET sealed personal-kind', 'personal'); db.prepare("UPDATE tasks SET enc_v = 2 WHERE id = 't-sealed'").run(); // belt and braces: a sealed row is never read
task('t-mixed', 'WORKSECRET personal task in a work project', 'personal', { project: 'pw' });
const decision = (id: string, project: string, text: string, on: string, enc = 0) => db.prepare('INSERT INTO decisions (id, project_id, text, decided_at, created_at, updated_at, enc_v) VALUES (?,?,?,?,?,?,?)').run(id, project, text, on, T, T, enc);
decision('d1', 'pp', 'Go with the metal shed', '2026-10-10');
decision('d-old', 'pp', 'OLDDECISION', '2026-08-01');
decision('d-work', 'pw', 'WORKSECRET pick vendor', '2026-10-10', 2);
decision('d-off', 'poff', 'OFFLINEONLY decision', '2026-10-10');
const lesson = (id: string, project: string, text: string, on: string, enc = 0) => db.prepare('INSERT INTO lessons (id, project_id, text, created_at, updated_at, enc_v) VALUES (?,?,?,?,?,?)').run(id, project, text, on, on, enc);
lesson('l1', 'pp', 'Measure twice before ordering', '2026-10-15T10:00:00.000Z');
lesson('l-old', 'pp', 'OLDLESSON', '2026-07-01T10:00:00.000Z');
lesson('l-work', 'pw', 'WORKSECRET lesson', '2026-10-15T10:00:00.000Z', 2);
lesson('l-off', 'poff', 'OFFLINEONLY lesson', '2026-10-15T10:00:00.000Z');

const md = await compassDigest(env, at, { tz: 'America/Toronto' });
for (const bad of ['WORKSECRET', 'WORKPROJECT', 'OFFLINEONLY', 'Private offline', 'TRASHED', 'Trashed plan', 'Deleted task', 'Done already', 'OLDDECISION', 'OLDLESSON', 'No status project', 'Closed trip'])
  assert.ok(!md.includes(bad), `${bad} must not be in the Compass digest`);
assert.match(md, /^# Compass: my personal items \(as of 2026-10-20\)/);
assert.match(md, /## Overdue tasks\n- Pay parking ticket; due 2026-10-18/);
assert.match(md, /## Tasks due this week\n- Order shed kit; due 2026-10-22\n- Book dentist \(progress\); due 2026-10-23/);
assert.match(md, /## Other open tasks\n- Renew passport; due 2026-11-30\n- Sort the garage/);
assert.match(md, /## Projects\n- Garden shed: amber \(Permit pending\); active, Execution; ends 2026-12-01/);
assert.match(md, /## Decisions in the last 30 days\n- 2026-10-10 Garden shed: Go with the metal shed/);
assert.match(md, /## Lessons from the last 30 days\n- 2026-10-15 Garden shed: Measure twice before ordering/);
// a very long list: the first 150 (dated ones first), a note that more exist, within the cap
for (let i = 0; i < 160; i++) task(`bulk${i}`, `Bulk task number ${i} with a fairly long title to fill the page up`, 'personal');
const big = await compassDigest(env, at, { tz: 'America/Toronto' });
assert.ok(big.length <= 12_000 && big.includes('Pay parking ticket') && /\(more tasks are not shown\)|\(The rest is not shown\.\)/.test(big), 'long lists are cut, soonest first');
// nothing at all personal -> just the heading; it is still a valid, non-empty item
db.exec('DELETE FROM tasks; DELETE FROM decisions; DELETE FROM lessons; DELETE FROM projects');
assert.equal(await compassDigest(env, at, { tz: 'America/Toronto' }), '# Compass: my personal items (as of 2026-10-20)');

// -- The relay's answer as we keep it.
assert.deepEqual(cleanRelay({ sections: { finance: ' # Finance\nNet worth $1 ', health: null, home: 5, hollow: '' } }), { finance: '# Finance\nNet worth $1', health: null, home: null, hollow: null });
assert.deepEqual(cleanRelay(null), { finance: null, health: null, home: null, hollow: null });
assert.deepEqual(cleanRelay({ sections: 'x' }), { finance: null, health: null, home: null, hollow: null });
assert.ok(cleanRelay({ sections: { finance: ('line\n').repeat(2000) } }).finance!.length <= SECTION_MAX, 'capped');
assert.equal(scrub('Acct 123456789012 and 4111 1111 1111 1111 and $1,234,567 on 2026-10-20 12:30'), 'Acct [number removed] and [number removed] and $1,234,567 on 2026-10-20 12:30');
assert.ok(!cleanRelay({ sections: { health: 'ref 99999999999' } }).health!.includes('99999999999'));

// -- Once a day after digest_hour, Toronto time (October: UTC-4); again, an hour apart, while the day's refresh has failures.
const s = { tz: 'America/Toronto', digest_hour: 7 };
const atZ = (z: string) => new Date(z), ok = (z: string) => ({ at: z, failed: false }), bad = (z: string) => ({ at: z, failed: true });
assert.equal(appsDue(s, null, atZ('2026-10-20T10:45:00Z')), false, '6:45 Toronto: before the hour');
assert.equal(appsDue(s, bad('2026-10-19T11:00:00.000Z'), atZ('2026-10-20T10:45:00Z')), false, 'before the hour, even after a failed day');
assert.equal(appsDue(s, null, atZ('2026-10-20T11:00:00Z')), true, '7:00 Toronto');
assert.equal(appsDue(s, ok('2026-10-20T11:00:00.000Z'), atZ('2026-10-20T15:00:00Z')), false, 'a clean refresh today: done');
assert.equal(appsDue(s, ok('2026-10-20T11:00:00.000Z'), atZ('2026-10-21T10:45:00Z')), false, 'tomorrow 6:45: not yet');
assert.equal(appsDue(s, ok('2026-10-20T11:00:00.000Z'), atZ('2026-10-21T11:00:00Z')), true, 'tomorrow 7:00');
assert.equal(appsDue(s, ok('2026-10-21T03:30:00.000Z'), atZ('2026-10-21T11:00:00Z')), true, '03:30Z is 23:30 on the 20th in Toronto, so the 21st at 7:00 is due');
assert.equal(appsDue(s, ok('2026-10-21T04:30:00.000Z'), atZ('2026-10-21T11:00:00Z')), false, '04:30Z is 00:30 on the 21st: already done that day');
assert.equal(appsDue(s, bad('2026-10-20T11:00:00.000Z'), atZ('2026-10-20T11:15:00Z')), false, 'failed at 7:00: not again at 7:15');
assert.equal(appsDue(s, bad('2026-10-20T11:00:00.000Z'), atZ('2026-10-20T11:59:00Z')), false, 'nor at 7:59');
assert.equal(appsDue(s, bad('2026-10-20T11:00:00.000Z'), atZ('2026-10-20T12:00:00Z')), true, 'retried an hour later');
assert.equal(appsDue(s, bad('2026-10-20T12:00:00.000Z'), atZ('2026-10-20T12:15:00Z')), false, 'and an hour apart from then on');
assert.equal(appsDue(s, bad('2026-10-20T12:00:00.000Z'), atZ('2026-10-20T13:00:00Z')), true);
assert.equal(appsDue({ tz: 'America/Toronto', digest_hour: 0 }, null, atZ('2026-10-20T04:00:00Z')), true, 'digest_hour 0 is midnight');
assert.equal(appsDue({ tz: 'America/Toronto', digest_hour: 7 }, null, atZ('2026-11-01T11:30:00Z')), false, 'after the clocks go back, 11:30Z is 6:30');

// -- Refresh now: one claim per 10 minutes, atomic.
const t0 = Date.parse('2026-10-20T15:00:00Z');
assert.deepEqual(await Promise.all([claimRefresh(env, 'you', t0), claimRefresh(env, 'you', t0)]), [true, false], 'two at once: one wins');
assert.equal(await claimRefresh(env, 'you', t0 + 9 * 60_000), false, '9 minutes later: no');
assert.equal(await claimRefresh(env, 'cron', t0 + 9 * 60_000 + 59_000), false);
assert.equal(await claimRefresh(env, 'you', t0 + 10 * 60_000 + 1), true, 'after 10 minutes');
assert.equal(waitMinutes('2026-10-20T15:00:00.000Z', t0 + 60_000), 9);
assert.equal(waitMinutes('2026-10-20T15:00:00.000Z', t0 + 599_000), 1);
assert.equal(waitMinutes(null, t0), 10);
// lastRun: the newest attempt, clean only when its done row names no failed app (no done row = it never finished)
const aud = (at: string, action: string, detail: string | null) => db.prepare('INSERT INTO audit_log (id, at, actor, action, target, detail) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), at, 'cron', action, null, detail);
db.exec("DELETE FROM audit_log WHERE action LIKE 'knowledge.apps.%'");
assert.equal(await lastRun(env), null);
aud('2026-10-20T11:00:00.000Z', 'knowledge.apps.refresh', null);
assert.deepEqual(await lastRun(env), { at: '2026-10-20T11:00:00.000Z', failed: true, retry: null }, 'no done row: unfinished counts as failed (all five again)');
aud('2026-10-20T11:00:09.000Z', 'knowledge.apps.done', '{"ok":["compass"],"failed":["hollow"]}');
assert.deepEqual(await lastRun(env), { at: '2026-10-20T11:00:00.000Z', failed: true, retry: ['hollow'] }, 'a finished attempt names the apps to retry');
aud('2026-10-20T12:00:00.000Z', 'knowledge.apps.refresh', null); aud('2026-10-20T12:00:09.000Z', 'knowledge.apps.done', '{"ok":["compass","finance","health","home","hollow"],"failed":[]}');
assert.deepEqual(await lastRun(env), { at: '2026-10-20T12:00:00.000Z', failed: false, retry: [] }, "the newest attempt's own result, not an older failure");
db.exec("DELETE FROM audit_log WHERE action LIKE 'knowledge.apps.%'");
// retryOnly: the same day as a finished attempt with failures -> only those; a new day, a clean run or an unfinished one -> all (null)
const sTz = { tz: 'America/Toronto' };
assert.deepEqual(retryOnly(sTz, { at: '2026-10-20T11:00:00.000Z', retry: ['hollow', 'finance'] }, atZ('2026-10-20T12:00:00Z')), ['hollow', 'finance']);
assert.equal(retryOnly(sTz, { at: '2026-10-20T11:00:00.000Z', retry: ['hollow'] }, atZ('2026-10-21T11:00:00Z')), null, 'tomorrow: everything');
assert.equal(retryOnly(sTz, { at: '2026-10-20T11:00:00.000Z', retry: null }, atZ('2026-10-20T12:00:00Z')), null, 'unfinished: everything');
assert.equal(retryOnly(sTz, null, atZ('2026-10-20T12:00:00Z')), null);

// -- refreshApps with a faked relay.
let relay: () => Response | Promise<Response> = () => new Response('{}');
const calls: { url: string; secret: string | null; redirect: string | undefined }[] = [];
globalThis.fetch = (async (u: string, init: RequestInit & { headers: Record<string, string> }) => { calls.push({ url: String(u), secret: init.headers['X-Relay-Secret'], redirect: init.redirect }); return relay(); }) as never;
const sections = (tag: string) => ({ generated_at: at.toISOString(), sections: { finance: `# Finance\n\nNet worth ${tag} dollars.`, health: `# Health\n\n## Medications\n- 2 refills due\n- 1 not yet taken today (${tag})`, home: `# Home\n\n## Maintenance\n- Furnace filter ${tag}`, hollow: `# Hollow (home server)\n\n## Drives\n- D: ok ${tag}` } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
task('t-a', 'First digest task', 'personal', { due: '2026-10-21' });
const items = () => db.prepare("SELECT i.id, i.source, i.title, i.state, i.error, i.chunk_count, i.deleted_at FROM knowledge_items i JOIN knowledge_collections k ON k.id = i.collection_id WHERE k.system = 1 ORDER BY i.source").all() as { id: string; source: string; title: string; state: string; error: string | null; chunk_count: number; deleted_at: string | null }[];
const chunkIds = () => (db.prepare('SELECT id FROM knowledge_chunks').all() as { id: string }[]).map((r) => r.id);
assert.equal(n("SELECT count(*) AS n FROM knowledge_collections WHERE system = 1"), 0, 'no system collection until the first refresh');

relay = () => json(sections('ONE'));
let r = await refreshApps(env);
assert.deepEqual(r, { ok: ['compass', 'finance', 'health', 'home', 'hollow'], errors: {} });
assert.deepEqual(calls[0], { url: 'https://relay.test/api/compass-relay/apps-digest', secret: 's3cret', redirect: 'manual' }, 'the shared helper: the secret header, no redirects');
const coll = db.prepare('SELECT * FROM knowledge_collections WHERE system = 1').get() as { id: string; name: string; scope: string; boundary: string; enc_v: number };
assert.deepEqual([coll.name, coll.scope, coll.boundary, coll.enc_v], ['From my apps', 'personal', 'cloud', 0], 'created on first refresh: personal, Cloud AI, plain');
let now1 = items();
assert.deepEqual(now1.map((i) => i.source), ['app:compass', 'app:finance', 'app:health', 'app:home', 'app:hollow'].sort());
assert.ok(now1.every((i) => i.state === 'ready' && !i.error && i.chunk_count >= 1 && !i.deleted_at), 'five items, embedded and ready');
assert.equal(n('SELECT count(*) AS n FROM knowledge_chunks WHERE embedded = 0'), 0);
assert.match((db.prepare("SELECT group_concat(text) AS t FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.source = 'app:health'").get() as { t: string }).t, /2 refills due/);
assert.match((db.prepare("SELECT group_concat(text) AS t FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.source = 'app:compass'").get() as { t: string }).t, /First digest task/);
const oldChunks = chunkIds(), oldItems = now1.map((i) => i.id);
const vecHits = async () => new Set((await query(env, hashVector('digest'), null, 500)).map((m) => m.id));
assert.ok((await vecHits()).size >= oldChunks.length, 'every passage has a vector');

// a retry (`only`) re-replaces just those sources; the ones that worked that day keep their items, and the relay is not asked when no relay app is named
const idsBy = () => Object.fromEntries(items().map((i) => [i.source, i.id]));
{
  const was = idsBy(), nCalls = calls.length;
  relay = () => json(sections('RETRY'));
  const rr = await refreshApps(env, undefined, 'cron', ['hollow']);
  assert.deepEqual(rr, { ok: ['hollow'], errors: {} });
  const now = idsBy();
  assert.notEqual(now['app:hollow'], was['app:hollow'], 'the retried source was replaced');
  for (const a of ['compass', 'finance', 'health', 'home']) assert.equal(now[`app:${a}`], was[`app:${a}`], `${a} kept the item that worked`);
  const rc = await refreshApps(env, undefined, 'cron', ['compass']);
  assert.deepEqual(rc.ok, ['compass']); assert.equal(calls.length, nCalls + 1, 'Compass alone makes no relay call');
  assert.equal(items().length, 5);
  db.exec("DELETE FROM audit_log WHERE action LIKE 'knowledge.apps.%'");
  aud(new Date(Date.now() - 1000).toISOString(), 'knowledge.apps.refresh', null); // the claim row the route/cron writes first
  await refreshApps(env, undefined, 'cron', ['finance']);
  assert.deepEqual((await lastRun(env))?.retry, [], 'its done row names only what it tried');
}

// a relay answer over the size cap is refused before parsing (by header, and by streaming when no length is given)
{
  const big = JSON.stringify({ sections: { finance: 'x'.repeat(250_000) } });
  const mid = items().find((i) => i.source === 'app:finance')!.id;
  relay = () => new Response(big, { headers: { 'Content-Length': String(big.length) } });
  let rb = await refreshApps(env);
  assert.equal(rb.errors.finance, "Kelly-Cloud's answer was too large.");
  relay = () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 6; i++) c.enqueue(new TextEncoder().encode('y'.repeat(40_000))); c.close(); } }));
  rb = await refreshApps(env);
  assert.equal(rb.errors.hollow, "Kelly-Cloud's answer was too large.");
  assert.equal(items().find((i) => i.source === 'app:finance')!.id, mid, 'the existing items stay');
  relay = () => json(sections('AFTER'));
}

// a second refresh REPLACES: still five items, none of the old passages or vectors left, the new text in
relay = () => json(sections('TWO'));
task('t-b', 'Second digest task', 'personal');
r = await refreshApps(env);
assert.deepEqual(r.errors, {});
const now2 = items();
assert.equal(now2.length, 5, 'five, not ten');
assert.ok(now2.every((i) => !oldItems.includes(i.id)), 'new items');
assert.equal(n('SELECT count(*) AS n FROM knowledge_items'), 5, 'the old rows are gone, not trashed');
assert.ok(chunkIds().every((id) => !oldChunks.includes(id)), 'the old passages are deleted');
const hits = await vecHits();
assert.ok(oldChunks.every((id) => !hits.has(id)), "the old passages' vectors are removed");
assert.ok(chunkIds().every((id) => hits.has(id)), 'the new ones are embedded');
assert.match((db.prepare("SELECT group_concat(text) AS t FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.source = 'app:finance'").get() as { t: string }).t, /TWO dollars/);
assert.match((db.prepare("SELECT group_concat(text) AS t FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.source = 'app:compass'").get() as { t: string }).t, /Second digest task/);
assert.equal(n("SELECT count(*) AS n FROM knowledge_collections WHERE system = 1"), 1, 'still one system collection');

// a source Kelly-Cloud could not read (null section): yesterday's item stays, with the reason on it
relay = () => json({ sections: { ...sections('THREE').sections, finance: null } });
const before = items().find((i) => i.source === 'app:finance')!;
r = await refreshApps(env);
assert.deepEqual(r.errors, { finance: 'Finance could not be read.' });
const kept = items().find((i) => i.source === 'app:finance')!;
assert.equal(kept.id, before.id, "yesterday's item is kept");
assert.deepEqual([kept.state, kept.error], ['ready', 'Finance could not be read.']);
assert.match((db.prepare("SELECT group_concat(text) AS t FROM knowledge_chunks WHERE item_id = ?").get(kept.id) as { t: string }).t, /TWO dollars/, "and still holds yesterday's text");
assert.match((db.prepare("SELECT group_concat(text) AS t FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.source = 'app:home'").get() as { t: string }).t, /THREE/, 'the others refreshed');
// it recovers: the next good answer replaces it and the error is gone
relay = () => json(sections('FOUR'));
r = await refreshApps(env);
assert.deepEqual(r.errors, {});
assert.ok(items().every((i) => !i.error) && items().length === 5);

// the relay down, or not answering properly: every app of Kelly-Cloud keeps its item; Compass's own part still refreshes
const compassBefore = items().find((i) => i.source === 'app:compass')!.id;
for (const [mk, msg] of [[() => json({ error: 'x' }, 502), 'Kelly-Cloud answered with an error.'], [() => { throw new Error('network'); }, 'Kelly-Cloud could not be reached.'], [() => new Response('<html>', { status: 200 }), null], [() => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }), 'Kelly-Cloud answered with an error.']] as const) {
  relay = mk as never;
  r = await refreshApps(env);
  assert.deepEqual(Object.keys(r.errors).sort(), ['finance', 'health', 'hollow', 'home'], String(msg));
  const want = (a: string) => msg ?? `${a[0].toUpperCase()}${a.slice(1)} could not be read.`; // a 200 that isn't JSON: each app says so by name
  assert.equal(r.errors.finance, want('finance'));
  assert.equal(items().length, 5, 'still five items');
  assert.ok(items().filter((i) => i.source !== 'app:compass').every((i) => i.state === 'ready' && i.error === want(i.source.slice(4))), 'their items stay, with the reason');
  assert.notEqual(items().find((i) => i.source === 'app:compass')!.id, compassBefore, "Compass's part was rebuilt");
  assert.equal(items().find((i) => i.source === 'app:compass')!.error, null);
  assert.equal(calls.at(-1)!.redirect, 'manual');
}
// no relay configured at all
const bare = { ...(env as object), KELLY_RELAY_URL: undefined } as never;
r = await refreshApps(bare);
assert.equal(r.errors.hollow, "Kelly-Cloud isn't connected.");

// all or nothing: if removing the old item fails, the new one is taken back out and yesterday's stays, showing the error
relay = () => json(sections('SEVEN'));
const prev = items().find((i) => i.source === 'app:compass')!, prevChunks = (db.prepare('SELECT id FROM knowledge_chunks WHERE item_id = ?').all(prev.id) as { id: string }[]).map((x) => x.id);
failDelete = true;
const err = console.error; console.error = () => {};
try { r = await refreshApps(env); } finally { console.error = err; }
assert.equal(r.errors.compass, 'Compass could not be stored.');
assert.deepEqual(r.ok, ['finance', 'health', 'home', 'hollow'], 'the others refreshed');
const keptC = items().filter((i) => i.source === 'app:compass');
assert.equal(keptC.length, 1, 'not two items for that source');
assert.deepEqual([keptC[0].id, keptC[0].state, keptC[0].error], [prev.id, 'ready', 'Compass could not be stored.'], "yesterday's item stays, with the error");
assert.deepEqual((db.prepare('SELECT id FROM knowledge_chunks WHERE item_id = ?').all(prev.id) as { id: string }[]).map((x) => x.id), prevChunks, 'with its passages');
assert.equal(n("SELECT count(*) AS n FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.source = 'app:compass'"), prevChunks.length, "and none of the new item's");
relay = () => json(sections('EIGHT'));
r = await refreshApps(env);
assert.deepEqual(r.errors, {}); assert.equal(items().filter((i) => i.source === 'app:compass').length, 1);
assert.notEqual(items().find((i) => i.source === 'app:compass')!.id, prev.id);

// a source that has never worked: a failed item that says why, and the first good answer replaces it
db.exec("DELETE FROM knowledge_chunks WHERE item_id IN (SELECT id FROM knowledge_items WHERE source = 'app:hollow'); DELETE FROM knowledge_items WHERE source = 'app:hollow'");
relay = () => json({ sections: { ...sections('FIVE').sections, hollow: null } });
r = await refreshApps(env);
const failed = items().find((i) => i.source === 'app:hollow')!;
assert.deepEqual([failed.state, failed.error, failed.chunk_count], ['failed', 'Hollow could not be read.', 0]);
relay = () => json(sections('SIX'));
await refreshApps(env);
assert.deepEqual(items().filter((i) => i.source === 'app:hollow').map((i) => [i.state, i.error]), [['ready', null]]);
assert.equal(items().length, 5);

console.log('digest: ok');
