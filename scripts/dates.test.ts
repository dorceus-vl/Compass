process.env.TZ = 'America/New_York';
const { addDays, startOfWeek, fmtDue } = await import('../web/src/dates.ts');
import assert from 'node:assert/strict';

assert.equal(addDays('2026-11-01', 1), '2026-11-02'); // fall back (Nov 1 2026)
assert.equal(addDays('2026-11-02', -1), '2026-11-01');
assert.equal(addDays('2026-10-31', 2), '2026-11-02');
assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // spring forward (Mar 8 2026)
assert.equal(addDays('2026-03-09', -1), '2026-03-08');
assert.equal(addDays('2026-03-07', 2), '2026-03-09');
assert.equal(startOfWeek('2026-11-03'), '2026-11-02'); // Tue -> Mon
assert.equal(startOfWeek('2026-11-01'), '2026-10-26'); // Sun -> previous Mon
assert.equal(fmtDue('2026-11-02', '2026-10-31').text, 'Mon'); // 2 days ahead across DST
assert.equal(fmtDue('2026-11-02', '2026-11-01').text, 'Tomorrow');
assert.equal(fmtDue('2026-10-30', '2026-11-02').text, '3d late');
assert.equal(fmtDue('2026-11-09', '2026-11-01').text, 'Nov 9');
console.log('dates: ok');
