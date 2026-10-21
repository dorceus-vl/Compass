// node --experimental-strip-types scripts/stakeholders.test.ts
import assert from 'node:assert/strict';
import { quadrant, QUADRANTS, nextDue, dueCount, dueText, stakeholderPush, draftSeed, STAKEHOLDER_DAYS, parseStakeholderInput } from '../shared/stakeholders.ts';

// C6: the four quadrants
assert.equal(quadrant('high', 'high'), 'manage');
assert.equal(quadrant('high', 'low'), 'satisfy');
assert.equal(quadrant('low', 'high'), 'inform');
assert.equal(quadrant('low', 'low'), 'monitor');
assert.deepEqual(QUADRANTS.map((q) => q.id), ['satisfy', 'manage', 'monitor', 'inform']); // grid order: top-left, top-right, bottom-left, bottom-right
assert.equal(QUADRANTS.find((q) => q.id === 'manage')!.label, 'Manage closely');

// due = last contact + cadence; never contacted with a cadence is due now; no cadence is never due
const today = '2026-10-21';
assert.equal(nextDue('2026-10-14', 7, today), '2026-10-21');
assert.equal(nextDue('2026-10-14T15:30:00.000Z', 14, today), '2026-10-28');
assert.equal(nextDue('2026-10-21T02:00:00.000Z', 7, today, 'America/Toronto'), '2026-10-27', 'read in the user zone: 22:00 on the 20th');
assert.equal(nextDue('2026-10-21T02:00:00.000Z', 7, today), '2026-10-28', 'UTC by default');
assert.equal(nextDue(null, 7, today), today, 'never contacted: due now');
assert.equal(nextDue('2026-10-14', null, today), null, 'no cadence: no due date');
assert.equal(nextDue(null, null, today), null);
const s = (last: string | null, cad: number | null) => ({ last_contact_at: last, cadence_days: cad });
assert.equal(dueCount([], today), 0);
assert.equal(dueCount([s('2026-10-21T02:00:00.000Z', 1)], '2026-10-21', 'America/Toronto'), 1, 'sent on the 20th local, due on the 21st');
assert.equal(dueCount([s(null, 7), s(null, null), s('2026-10-30', 7), s('2026-10-14', 7), s('2026-10-15', 7), s('2026-09-01', 30)], today), 3, 'never contacted, due today and long overdue; a future date and no cadence are not due');
assert.equal(dueCount([s('2026-10-21', 1)], today), 0, 'sent today with a one-day cadence is due tomorrow');

// text on the list
assert.equal(dueText(null, today), 'No cadence');
assert.equal(dueText('2026-10-21', today), 'Due now');
assert.equal(dueText('2026-10-12', today), 'Due now');
assert.equal(dueText('2026-10-22', today), 'In 1 day');
assert.equal(dueText('2026-10-28', today), 'In 7 days');

// C7: the push says how many and nothing else
assert.equal(stakeholderPush(0, null), null);
assert.deepEqual(stakeholderPush(1, '/projects/p1/stakeholders'), { title: '1 stakeholder update due', body: 'Open Compass to see who', url: '/projects/p1/stakeholders' });
assert.equal(stakeholderPush(2, '/projects/p1/stakeholders')!.title, '2 stakeholder updates due');
assert.equal(stakeholderPush(3, null)!.url, '/projects');

// C8: the seed for Athena, with no name for a work stakeholder
const st = { name: 'Ada Lovelace', role: 'Sponsor', power: 'high' as const, interest: 'high' as const, attitude: 'resistant' as const, channel: 'Email', notes: 'secret note' };
const pr = { rag: 'amber', rag_reason: 'Vendor late' };
const work = draftSeed(st, pr, 'work');
assert.ok(!work.includes('Ada') && !work.includes('Lovelace') && !work.includes('secret note'), 'work seed carries no name and no notes');
assert.ok(work.includes('Sponsor') && work.includes('resistant') && work.includes('Email') && work.includes('Amber: Vendor late') && work.includes('Manage closely'));
const own = draftSeed(st, pr, 'personal');
assert.ok(own.includes('Ada Lovelace'));
assert.ok(!own.includes('secret note'), 'notes never go in the seed');
assert.ok(draftSeed({ ...st, role: null, channel: null }, { rag: 'none', rag_reason: null }, 'work').includes('Not set'));

// validation: vocabularies, lengths, cadence
const ok = (b: unknown, create = true) => parseStakeholderInput(b, create);
assert.deepEqual(ok({ name: ' Ada ' }), { values: { name: 'Ada', role: null, power: 'low', interest: 'low', attitude: 'neutral', channel: null, cadence_days: null, notes: null } });
assert.deepEqual(ok({ name: 'Bo', cadence_days: 14, power: 'high', role: ' PM ' }), { values: { name: 'Bo', role: 'PM', power: 'high', interest: 'low', attitude: 'neutral', channel: null, cadence_days: 14, notes: null } });
assert.deepEqual(ok({ role: 'x' }, false), { values: { role: 'x' } });
for (const bad of [{}, { name: '  ' }, { name: 'x'.repeat(121) }, { name: 'a', role: 'x'.repeat(121) }, { name: 'a', channel: 'x'.repeat(61) }, { name: 'a', notes: 'x'.repeat(2001) },
  { name: 'a', power: 'medium' }, { name: 'a', interest: 1 }, { name: 'a', attitude: 'angry' }, { name: 'a', cadence_days: 0 }, { name: 'a', cadence_days: 366 }, { name: 'a', cadence_days: 1.5 }, { name: 'a', cadence_days: '7' }])
  assert.ok('error' in ok(bad), JSON.stringify(bad));
assert.ok('error' in ok({ name: '' }, false), 'a patch cannot blank the name');
assert.deepEqual(ok({ name: 'a', cadence_days: null }), { values: { name: 'a', role: null, power: 'low', interest: 'low', attitude: 'neutral', channel: null, cadence_days: null, notes: null } });
assert.equal(STAKEHOLDER_DAYS.max, 365);
console.log('stakeholders: ok');
