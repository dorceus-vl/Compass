// node --experimental-strip-types scripts/time.test.ts
import assert from 'node:assert/strict';
import { clampTs, MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS, entryMinutes, formatElapsed, taskLogged, zonedToIso, isoToZoned } from '../shared/time.ts';
import type { TimeEntry } from '../shared/types.ts';

assert.deepEqual([MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS], [5, 1440, 500, 300_000]);
// T3: within [2020-01-01, now + 5 min]; unparseable means now.
const now = Date.parse('2026-10-28T15:00:00.000Z');
assert.equal(clampTs('2019-05-01T00:00:00.000Z', now), '2020-01-01T00:00:00.000Z');
assert.equal(clampTs('2026-10-28T16:00:00.000Z', now), '2026-10-28T15:05:00.000Z');
assert.equal(clampTs('2026-10-28T14:00:00.000Z', now), '2026-10-28T14:00:00.000Z');
assert.equal(clampTs('not a date', now), new Date(now).toISOString()); // unparseable → now
assert.equal(clampTs('2026-10-28T14:00:00+01:00', now), '2026-10-28T13:00:00.000Z', 'normalised to UTC ISO');

// Task 1: elapsed minutes (floor), the h:mm text, a task's total with its live subtasks.
assert.equal(entryMinutes({ started_at: '2026-10-28T14:00:00.000Z', ended_at: null }, now), 60, 'running: up to now');
assert.equal(entryMinutes({ started_at: '2026-10-28T14:00:00.000Z', ended_at: '2026-10-28T14:42:30.000Z' }, now), 42, 'finished: floor');
assert.equal(entryMinutes({ started_at: '2026-10-28T14:59:01.000Z', ended_at: null }, now), 0, '59 s is 0');
assert.equal(entryMinutes({ started_at: '2026-10-28T16:00:00.000Z', ended_at: null }, now), 0, 'a start ahead of the clock is never negative');
assert.deepEqual([formatElapsed(7), formatElapsed(102), formatElapsed(1500), formatElapsed(0)], ['0:07', '1:42', '25:00', '0:00']);
const ent = (id: string, task_id: string, s: string, e: string | null, deleted_at: string | null = null) =>
  ({ id, task_id, project_id: null, kind: 'personal', started_at: s, ended_at: e, note: null, source: 'timer', auto_stopped: 0, enc_v: 0, created_at: s, updated_at: s, deleted_at }) as TimeEntry;
const tks = [{ id: 'a', parent_id: null, deleted_at: null }, { id: 'a1', parent_id: 'a', deleted_at: null }, { id: 'a2', parent_id: 'a', deleted_at: '2026-10-27T00:00:00.000Z' }, { id: 'b', parent_id: null, deleted_at: null }];
const es = [
  ent('1', 'a', '2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z'), // 60
  ent('2', 'a1', '2026-10-28T12:00:00.000Z', '2026-10-28T12:30:00.000Z'), // subtask: 30
  ent('3', 'a', '2026-10-28T13:00:00.000Z', '2026-10-28T14:00:00.000Z', '2026-10-28T14:10:00.000Z'), // trashed entry
  ent('4', 'a2', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'), // trashed subtask
  ent('5', 'b', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'), // another task
  ent('6', 'a', '2026-10-28T14:45:00.000Z', null), // running: 15
];
assert.equal(taskLogged(es, 'a', tks, now), 105);
assert.equal(taskLogged(es, 'b', tks, now), 60);
// datetime-local values in settings.tz, both ways (DST included).
assert.equal(zonedToIso('2026-10-28T09:00', 'America/New_York'), '2026-10-28T13:00:00.000Z');
assert.equal(zonedToIso('2026-07-01T09:00', 'America/New_York'), '2026-07-01T13:00:00.000Z', 'EDT');
assert.equal(zonedToIso('2026-12-01T09:00', 'America/New_York'), '2026-12-01T14:00:00.000Z', 'EST');
assert.equal(zonedToIso('2026-10-28T09:00', 'UTC'), '2026-10-28T09:00:00.000Z');
assert.equal(zonedToIso('2026-10-28T09:00', 'Asia/Kolkata'), '2026-10-28T03:30:00.000Z');
assert.equal(zonedToIso('bad', 'UTC'), null);
assert.equal(isoToZoned('2026-12-01T14:00:00.000Z', 'America/New_York'), '2026-12-01T09:00');
assert.equal(isoToZoned('2026-10-28T03:30:00.000Z', 'Asia/Kolkata'), '2026-10-28T09:00');
assert.equal(isoToZoned('2026-10-28T23:30:00.000Z', 'UTC'), '2026-10-28T23:30');
console.log('time: ok');
