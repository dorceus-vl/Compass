// node --experimental-strip-types scripts/notify.test.ts
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { ingestMessage, unblockedMessage, notifyTimers, TIMER_NUDGE_TEXT } from '../worker/lib/notify.ts';

const item = (work: number) => ({ work }) as never;
const personal = ingestMessage({ item: item(0), task: { id: 't1', title: 'Renew passport', kind: 'personal' } as never, created: true }, 'health')!;
assert.deepEqual([personal.type, personal.key, personal.message.title, personal.message.body], ['app_task', 'task:t1', 'Renew passport', 'Added by Health']);
const work = ingestMessage({ item: item(1), task: { id: 't2', title: 'Acme contract numbers', kind: 'work' } as never, created: true }, 'kelly')!;
assert.deepEqual([work.message.title, work.message.body], ['New work task', 'Added by Kelly']);
assert.equal(ingestMessage({ item: item(0), task: { id: 't3', title: 'Secret', kind: 'work' } as never, created: true }, 'email')!.message.title, 'New work task'); // task.kind alone is enough
const meeting = ingestMessage({ item: item(1), review: { id: 'r1', title: 'Acme budget review' } as never, created: true }, 'sonarflow')!;
assert.deepEqual([meeting.type, meeting.key, meeting.message.title, meeting.message.body, meeting.message.url], ['meeting', 'meeting:r1', 'Meeting notes ready', 'Open Compass to read', '/meetings/r1']);
assert.equal(ingestMessage({ item: item(0), task: { id: 't1', title: 'x', kind: 'personal' } as never, created: false }, 'health'), null); // updates never push
// v2.1 V3: a work task's unblock push carries nothing of the task; a personal one names it; both open the task.
const ubWork = unblockedMessage({ id: 'w1', title: 'Acme cutover plan', kind: 'work' });
assert.deepEqual([ubWork.title, ubWork.url], ['A task is unblocked', '/?task=w1']);
assert.ok(!JSON.stringify(ubWork).includes('Acme'));
const ubOwn = unblockedMessage({ id: 'p1', title: 'Book dentist', kind: 'personal' });
assert.deepEqual([ubOwn.title, ubOwn.url], ['Book dentist is unblocked', '/?task=p1']);

// v2.5 T7: forgotten timers, on real SQL. 4 h: one push with no task name, guarded by the outbox row; 12 h: stopped at start + 12 h.
const db = new DatabaseSync(':memory:');
const dir = new URL('../worker/migrations/', import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
type Stmt = { bind: (...a: unknown[]) => Stmt; run: () => Promise<{ meta: { changes: number } }>; all: () => Promise<{ results: unknown[] }>; first: () => Promise<unknown> };
const stmt = (sql: string, args: unknown[] = []): Stmt => ({
  bind: (...a) => stmt(sql, a),
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
  all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
  first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
});
const env = { DB: { prepare: (sql: string) => stmt(sql) } } as never; // no VAPID keys and no devices: deliver only writes the outbox
const T = '2026-10-01T00:00:00.000Z', at = new Date('2026-10-28T15:00:00.000Z'); // 15:00 UTC, outside the default quiet hours
const ago = (h: number) => new Date(+at - h * 3600e3).toISOString();
const rows = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
db.prepare("INSERT INTO tasks (id, title, kind, status, enc_v, created_at, updated_at) VALUES ('tw','Acme secret cutover','work','new',2,?1,?1)").run(T);
const entry = (id: string, startedAt: string) => db.prepare("INSERT INTO time_entries (id, task_id, kind, started_at, source, enc_v, created_at, updated_at) VALUES (?1,'tw','work',?2,'timer',2,?2,?2)").run(id, startedAt);
const settings = (o: object) => db.prepare("INSERT INTO settings (id, json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET json = ?1").run(JSON.stringify({ tz: 'UTC', ...o }), T);
settings({});
entry('e5', ago(5)); entry('e2', ago(2));
await notifyTimers(env, at);
let out = rows("SELECT id, title, body, url FROM push_outbox");
assert.deepEqual(out.map((r) => r.id), ['timer:e5:4h']); // 2 h: nothing
assert.equal(out[0].body, TIMER_NUDGE_TEXT); assert.equal(TIMER_NUDGE_TEXT, 'A timer has been running 4h');
assert.ok(!JSON.stringify(out).includes('Acme')); // no task name, work or not
await notifyTimers(env, at);
assert.equal(count("SELECT count(*) AS n FROM push_outbox"), 1); // the outbox row is the once-only guard
assert.equal(count("SELECT count(*) AS n FROM time_entries WHERE auto_stopped = 1"), 0);
// switch off or quiet hours: nothing written, so a later tick can still send
db.exec('DELETE FROM push_outbox'); settings({ push: { timer: false } });
await notifyTimers(env, at); assert.equal(count("SELECT count(*) AS n FROM push_outbox"), 0);
settings({}); const late = new Date('2026-10-28T23:00:00.000Z'); // 23:00 UTC is quiet
db.exec('DELETE FROM time_entries'); entry('eq', new Date(+late - 5 * 3600e3).toISOString());
await notifyTimers(env, late); assert.equal(count("SELECT count(*) AS n FROM push_outbox"), 0);
db.exec('DELETE FROM time_entries'); entry('e5', ago(5));
// 13 h: stopped at start + 12 h, flagged, updated_at bumped; no nudge for it
entry('e13', ago(13)); db.exec('DELETE FROM push_outbox');
await notifyTimers(env, at);
const e13 = rows("SELECT ended_at, auto_stopped, updated_at FROM time_entries WHERE id = 'e13'")[0];
assert.deepEqual([e13.ended_at, e13.auto_stopped, e13.updated_at], [new Date(+at - 1 * 3600e3).toISOString(), 1, at.toISOString()]);
assert.deepEqual(rows("SELECT id FROM push_outbox").map((r) => r.id), ['timer:e5:4h']); // e5 again (outbox was cleared), not e13
console.log('notify ok');
