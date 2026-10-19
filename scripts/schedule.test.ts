// node --experimental-strip-types scripts/schedule.test.ts
import assert from 'node:assert/strict';
import { inQuietHours, duePushes, localNow } from '../worker/lib/schedule.ts';

assert.equal(inQuietHours('23:30', '22:00', '07:00'), true);
assert.equal(inQuietHours('06:59', '22:00', '07:00'), true);
assert.equal(inQuietHours('00:00', '22:00', '07:00'), true);
assert.equal(inQuietHours('07:00', '22:00', '07:00'), false);
assert.equal(inQuietHours('21:59', '22:00', '07:00'), false);
assert.equal(inQuietHours('22:00', '22:00', '07:00'), true);
assert.equal(inQuietHours('13:30', '13:00', '14:00'), true);
assert.equal(inQuietHours('14:00', '13:00', '14:00'), false);
assert.equal(inQuietHours('12:59', '13:00', '14:00'), false);
assert.equal(inQuietHours('03:00', '08:00', '08:00'), false); // from === to: never quiet

// --- duePushes ---
import { DEFAULT_SETTINGS } from '../shared/types.ts';
const T = (o: Record<string, unknown>) => ({ id: 't', title: 'T', status: 'new', due_at: null, waiting_on: null, waiting_since: null, nudge_every_days: null, deleted_at: null, parent_id: null, kind: 'personal', ...o }) as any;
const at = (date: string, hhmm: string, weekday = 3) => ({ date, hhmm, weekday });
const run = (n: ReturnType<typeof at>, tasks: any[] = [], milestones: any[] = [], settings = DEFAULT_SETTINGS) => duePushes({ now: n, settings, tasks, milestones });
const due = [T({ id: 'a', title: 'Book dentist', due_at: '2026-10-19' }), T({ id: 'b', title: 'Pay rent', due_at: '2026-10-17' })];

// digest: slot [07:00, 07:15), only when something is due
assert.deepEqual(run(at('2026-10-19', '07:00'), due).map((p) => p.key), ['digest:2026-10-19']);
assert.equal(run(at('2026-10-19', '07:14'), due).length, 1);
assert.equal(run(at('2026-10-19', '06:59'), due).length, 0);
assert.equal(run(at('2026-10-19', '07:15'), due).length, 0);
assert.equal(run(at('2026-10-19', '07:00'), [T({ due_at: '2026-10-20' })]).length, 0);
const d = run(at('2026-10-19', '07:00'), due)[0];
assert.equal(d.type, 'digest'); assert.equal(d.message.title, 'Today: 1 due · 1 overdue'); assert.equal(d.message.url, '/');
assert.equal(d.message.body, 'Pay rent · Book dentist'); // overdue first (oldest due first)
// work content never in a push (Q8)
const mixed = [...due, T({ id: 'w1', title: 'SECRET Bell merger', kind: 'work', due_at: '2026-10-19' }), T({ id: 'w2', title: 'SECRET other', kind: 'work', due_at: '2026-10-18' })];
const dm = run(at('2026-10-19', '07:00'), mixed)[0].message;
assert.equal(dm.title, 'Today: 2 due · 2 overdue'); assert.equal(dm.body, 'Pay rent · Book dentist · +2 work tasks');
assert.ok(!JSON.stringify(run(at('2026-10-19', '13:00'), mixed)).includes('SECRET'));
assert.equal(run(at('2026-10-19', '07:00'), [T({ title: 'SECRET', kind: 'work', due_at: '2026-10-19' })])[0].message.body, '+1 work task');
// only first three personal titles
const many = ['1', '2', '3', '4'].map((n) => T({ id: n, title: 'P' + n, due_at: '2026-10-19' }));
assert.equal(run(at('2026-10-19', '07:00'), many)[0].message.body, 'P1 · P2 · P3');
// trashed, done and subtasks ignored
assert.equal(run(at('2026-10-19', '07:00'), [T({ due_at: '2026-10-19', deleted_at: 'x' }), T({ due_at: '2026-10-19', status: 'done' }), T({ due_at: '2026-10-19', parent_id: 'p' })]).length, 0);
// custom digest hour
assert.equal(run(at('2026-10-19', '08:05'), due, [], { ...DEFAULT_SETTINGS, digest_hour: 8 }).length, 1);

// overdue: 13:00 slot, oldest three, key and url
const o = run(at('2026-10-19', '13:05'), [...due, ...['x', 'y', 'z'].map((n, i) => T({ id: n, title: 'O' + n, due_at: '2026-10-1' + i }))]);
assert.deepEqual(o.map((p) => p.key), ['overdue:2026-10-19']);
assert.equal(o[0].message.title, '4 overdue'); assert.equal(o[0].message.url, '/list?q=due:overdue');
assert.equal(o[0].message.body, 'Ox · Oy · Oz'); // 2026-10-10, -11, -12 are the oldest
assert.equal(run(at('2026-10-19', '13:15'), due).length, 0);
assert.equal(run(at('2026-10-19', '13:00'), [T({ due_at: '2026-10-19' })]).length, 0); // due today is not overdue

// nudge: waiting, every 3 days since 2026-10-10
const w = (o2 = {}) => [T({ id: 'w', title: 'Reply?', status: 'waiting', waiting_on: 'Sam', waiting_since: '2026-10-10T15:00:00.000Z', nudge_every_days: 3, ...o2 })];
const nudgeAt = (date: string, tasks = w()) => run(at(date, '07:00'), tasks).filter((p) => p.type === 'nudge');
assert.deepEqual(nudgeAt('2026-10-13').map((p) => p.key), ['nudge:w:2026-10-13']);
assert.equal(nudgeAt('2026-10-16').length, 1);
for (const day of ['2026-10-10', '2026-10-12', '2026-10-14', '2026-10-09']) assert.equal(nudgeAt(day).length, 0, day);
assert.deepEqual(nudgeAt('2026-10-13')[0].message, { title: 'Nudge Sam', body: 'Reply?', url: '/' });
assert.equal(nudgeAt('2026-10-13', w({ nudge_every_days: null })).length, 0);
assert.equal(nudgeAt('2026-10-13', w({ status: 'progress' })).length, 0);
assert.equal(run(at('2026-10-13', '07:15'), w()).length, 0);
const wn = nudgeAt('2026-10-13', w({ kind: 'work', title: 'SECRET', waiting_on: 'SECRETNAME' }))[0];
assert.deepEqual(wn.message, { title: 'Nudge for a work task', body: 'Waiting on someone', url: '/' });

// timestamps are read in the user's zone: set waiting Oct 10 20:30 Toronto (= Oct 11 00:30Z), n=3 -> Oct 13, not Oct 14
assert.equal(nudgeAt('2026-10-13', w({ waiting_since: '2026-10-11T00:30:00Z' })).length, 1);
assert.equal(nudgeAt('2026-10-14', w({ waiting_since: '2026-10-11T00:30:00Z' })).length, 0);

// milestone: exactly 7 days out, undone
const ms = (o2 = {}) => [{ id: 'm1', name: 'Launch', due_at: '2026-10-26', done_at: null, ...o2 }];
const mAt = (date: string, m = ms()) => run(at(date, '07:00'), [], m).filter((p) => p.type === 'milestone');
assert.deepEqual(mAt('2026-10-19').map((p) => p.key), ['milestone:m1:2026-10-26']);
assert.deepEqual(mAt('2026-10-19')[0].message, { title: 'Milestone in a week', body: 'Launch', url: '/projects' });
assert.equal(mAt('2026-10-18').length, 0); assert.equal(mAt('2026-10-20').length, 0);
assert.equal(mAt('2026-10-19', ms({ done_at: 'x' })).length, 0);
assert.equal(mAt('2026-10-19', ms({ due_at: null })).length, 0);
assert.deepEqual(mAt('2026-10-19', ms({ work: true, name: 'SECRET' }))[0].message, { title: 'A work milestone is a week away', body: 'Open Compass to see it', url: '/projects' });

// weekly review: weekday 0 at 17:00, not if reviewed within 6 days
const rv = (date: string, hhmm: string, weekday: number, last: string | null) => run(at(date, hhmm, weekday), [], [], { ...DEFAULT_SETTINGS, last_review_at: last });
assert.deepEqual(rv('2026-10-18', '17:00', 0, null).map((p) => p.key), ['review:2026-10-18']);
assert.deepEqual(rv('2026-10-18', '17:00', 0, '2026-10-12T10:00:00.000Z')[0].message, { title: 'Time for your weekly review', body: 'Open Compass to start', url: '/review' });
assert.equal(rv('2026-10-18', '17:14', 0, null).length, 1);
assert.equal(rv('2026-10-18', '17:15', 0, null).length, 0);
assert.equal(rv('2026-10-18', '17:00', 1, null).length, 0);
assert.equal(rv('2026-10-18', '17:00', 0, '2026-10-16T10:00:00.000Z').length, 0); // reviewed 2 days ago
assert.equal(rv('2026-10-18', '17:00', 0, '2026-10-13T10:00:00.000Z').length, 0); // 5 days ago
assert.equal(rv('2026-10-18', '17:00', 0, '2026-10-12T10:00:00.000Z').length, 1); // 6 days ago

// localNow: 2026-10-19 11:05Z is Monday 07:05 in Toronto (EDT); midnight reads 00:xx not 24:xx
assert.deepEqual(localNow('America/Toronto', new Date('2026-10-19T11:05:00Z')), { date: '2026-10-19', hhmm: '07:05', weekday: 1 });
assert.deepEqual(localNow('America/Toronto', new Date('2026-10-19T04:00:00Z')), { date: '2026-10-19', hhmm: '00:00', weekday: 1 });
assert.deepEqual(localNow('America/Toronto', new Date('2026-10-19T03:59:00Z')), { date: '2026-10-18', hhmm: '23:59', weekday: 0 });
// reviewed Mon Oct 12 20:00 Toronto (= Oct 13 00:00Z): Sunday Oct 18 is 6 local days later, so the prompt fires
assert.equal(rv('2026-10-18', '17:00', 0, '2026-10-13T00:00:00Z').length, 1);
console.log('schedule ok');
