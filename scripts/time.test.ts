// node --experimental-strip-types scripts/time.test.ts
import assert from 'node:assert/strict';
import { clampTs, MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS } from '../shared/time.ts';

assert.deepEqual([MAX_RUNNING, MAX_ENTRY_MINUTES, MAX_NOTE, FUTURE_SLACK_MS], [5, 1440, 500, 300_000]);
// T3: within [2020-01-01, now + 5 min]; unparseable means now.
const now = Date.parse('2026-10-28T15:00:00.000Z');
assert.equal(clampTs('2019-05-01T00:00:00.000Z', now), '2020-01-01T00:00:00.000Z');
assert.equal(clampTs('2026-10-28T16:00:00.000Z', now), '2026-10-28T15:05:00.000Z');
assert.equal(clampTs('2026-10-28T14:00:00.000Z', now), '2026-10-28T14:00:00.000Z');
assert.equal(clampTs('not a date', now), new Date(now).toISOString()); // unparseable → now
assert.equal(clampTs('2026-10-28T14:00:00+01:00', now), '2026-10-28T13:00:00.000Z', 'normalised to UTC ISO');
console.log('time: ok');
