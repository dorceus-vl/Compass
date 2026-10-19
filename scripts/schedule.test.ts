// node --experimental-strip-types scripts/schedule.test.ts
import assert from 'node:assert/strict';
import { inQuietHours } from '../worker/lib/schedule.ts';

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
console.log('schedule ok');
