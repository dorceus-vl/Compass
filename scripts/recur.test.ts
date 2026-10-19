// node --experimental-strip-types scripts/recur.test.ts
import assert from 'node:assert/strict';
import { nextOccurrence, parseRecur } from '../worker/lib/recur.ts';

assert.equal(nextOccurrence('2026-10-19', { freq: 'daily', interval: 1 }, '2026-10-19T15:00:00Z'), '2026-10-20');
assert.equal(nextOccurrence('2026-10-19', { freq: 'daily', interval: 3 }, '2026-10-19T15:00:00Z'), '2026-10-22');
// Weekly on Mon/Wed/Fri (1 = Monday ... 7 = Sunday), from a Monday -> Wednesday
assert.equal(nextOccurrence('2026-10-19', { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-19T15:00:00Z'), '2026-10-21');
// ... from Friday -> next Monday
assert.equal(nextOccurrence('2026-10-23', { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-23T15:00:00Z'), '2026-10-26');
// Monthly on the 31st clamps to the month's end
assert.equal(nextOccurrence('2026-01-31', { freq: 'monthly', interval: 1 }, '2026-01-31T15:00:00Z'), '2026-02-28');
// After completion: counts from the day it was done, not from the due date
assert.equal(nextOccurrence('2026-10-10', { freq: 'weekly', interval: 2, after_completion: true }, '2026-10-19T15:00:00Z'), '2026-11-02');
// Overdue daily task done late: next is tomorrow (never in the past)
assert.equal(nextOccurrence('2026-10-01', { freq: 'daily', interval: 1 }, '2026-10-19T15:00:00Z'), '2026-10-20');
assert.equal(parseRecur('{"freq":"weekly","interval":1,"weekdays":[1]}')?.freq, 'weekly');
assert.equal(parseRecur('not json'), null);
assert.equal(parseRecur('{"freq":"yearly"}'), null);
console.log('recur: ok');
