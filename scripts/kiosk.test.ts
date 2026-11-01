import assert from 'node:assert/strict';
import { kioskCard, kioskLabel, tooSoon, KIOSK_MAX_ITEMS } from '../worker/lib/kiosk.ts';

const many = Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, due_at: i === 0 ? '2026-10-30T09:00:00.000Z' : '2026-11-01T09:00:00.000Z' }));
const c = kioskCard('2026-11-01', many, 3);
assert.equal(c.items.length, KIOSK_MAX_ITEMS);
assert.equal(c.more, 12 - KIOSK_MAX_ITEMS);
assert.equal(c.work, 3);
assert.deepEqual([c.items[0].overdue, c.items[1].overdue], [true, false]);
assert.equal(kioskCard('2026-11-01', [{ title: '  a\n b ', due_at: null }], 0).items[0].title, 'a b');
assert.equal(JSON.stringify(kioskCard('2026-11-01', [], 2)).includes('title'), false); // work has no title anywhere
assert.equal(kioskLabel(''), 'Wall tablet'); assert.equal(kioskLabel(' Hall '), 'Hall'); assert.equal(kioskLabel('x'.repeat(61)), 'Wall tablet');
assert.equal(tooSoon(null, 1e12), false);
assert.equal(tooSoon(new Date(1e12 - 5_000).toISOString(), 1e12), true);
assert.equal(tooSoon(new Date(1e12 - 20_000).toISOString(), 1e12), false);
console.log('kiosk ok');
