import assert from 'node:assert/strict';
import { cleanBrief, BRIEF_MAX, isYmd, rangeError, cleanEvents, CAL_MAX_EVENTS } from '../worker/lib/kelly.ts';
import { kellyLine } from '../shared/kelly-log.ts';

// The relay's text is data: trimmed, capped, control characters out, never HTML-interpreted (it stays a string).
const T = '2026-10-20T08:00:00.000Z';
assert.deepEqual(cleanBrief({ text: '  Good morning.  ', generated_at: '2026-10-20T07:00:00Z' }, T), { text: 'Good morning.', generated_at: '2026-10-20T07:00:00.000Z' });
assert.equal(cleanBrief({ text: 'x'.repeat(5000) }, T)!.text.length, BRIEF_MAX);
assert.equal(cleanBrief({ text: 'a\u0000b\u001b[31mc\n\n\n\nd' }, T)!.text, 'ab[31mc\n\nd');
assert.equal(cleanBrief({ text: '<script>alert(1)</script>' }, T)!.text, '<script>alert(1)</script>');
assert.equal(cleanBrief({ text: 'hi', generated_at: 'not a date' }, T)!.generated_at, T);
for (const bad of [null, 'text', {}, { text: 5 }, { text: '   ' }, { text: '\u0000' }]) assert.equal(cleanBrief(bad, T), null);

// The calendar proxy: dates are real YYYY-MM-DD, from <= to, 62 days at most; events come back as capped plain data.
for (const ok of ['2026-10-20', '2024-02-29']) assert.equal(isYmd(ok), true);
for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '20261020', '2026-10-20T00:00', '', undefined, null, 5]) assert.equal(isYmd(bad), false, String(bad));
assert.equal(rangeError('2026-10-01', '2026-10-31'), null);
assert.equal(rangeError('2026-10-20', '2026-10-20'), null);
assert.equal(rangeError('2026-09-01', '2026-11-01'), null); // 62 days inclusive
assert.match(rangeError('2026-09-01', '2026-11-02')!, /62 days/);
assert.match(rangeError('2026-10-21', '2026-10-20')!, /not be after/);
assert.match(rangeError(undefined, '2026-10-20')!, /dates like/);
assert.match(rangeError('2026-02-30', '2026-03-02')!, /dates like/);
const ev = cleanEvents({ events: [
  { title: '  Dentist\n<b>x</b>  ', start: '2026-10-20T14:30:00-04:00', end: '2026-10-20T15:30:00-04:00', all_day: false, location: 'Main St', source: 'google', extra: 1 },
  { title: 'Day', start: '2026-10-21', end: '2026-10-22', all_day: true },
  { title: 'Bad date', start: 'tomorrow', end: 'soon' }, { title: '', start: '2026-10-20', end: '2026-10-20' }, 'junk', null, { title: 't'.repeat(900), start: '2026-10-20', end: '2026-10-20' }] })!;
assert.deepEqual(ev.map((e) => e.title.length > 100 ? 'long' : e.title), ['Dentist <b>x</b>', 'Day', 'long']);
assert.equal(ev[2].title.length, 200);
assert.deepEqual(ev[1], { title: 'Day', start: '2026-10-21', end: '2026-10-22', all_day: true, location: null, source: 'google' });
assert.deepEqual(Object.keys(ev[0]).sort(), ['all_day', 'end', 'location', 'source', 'start', 'title']);
const many = { title: 'e', start: '2026-10-20', end: '2026-10-20' };
assert.equal(cleanEvents({ events: Array.from({ length: 900 }, () => many) })!.length, CAL_MAX_EVENTS);
for (const bad of [null, 'x', {}, { events: 'no' }, []]) assert.equal(cleanEvents(bad), null);
assert.deepEqual(cleanEvents({ events: [] }), []);

// The log in words.
assert.deepEqual(kellyLine('agent.today', { ok: true }), { title: "Listed today's tasks", sub: null });
assert.equal(kellyLine('agent.tasks.create', { ok: true }).title, 'Added a task');
assert.equal(kellyLine('agent.tasks.done', { ok: true }).title, 'Completed a task');
assert.deepEqual(kellyLine('agent.tasks.create', { refused: 'scope_not_granted' }), { title: 'Refused: no permission', sub: 'Added a task' });
assert.equal(kellyLine('agent.today', { refused: 'rate_limited' }).title, 'Refused: too many calls');
assert.equal(kellyLine('agent.today', { refused: 'weird' }).title, 'Refused: not allowed');
assert.deepEqual(kellyLine('agent.tasks.get', { ok: true }), { title: 'Looked up a task', sub: null });
assert.deepEqual(kellyLine('agent.knowledge.search', { ok: true, passages: 2, collections: 1 }), { title: 'Searched your knowledge', sub: null });
assert.deepEqual(kellyLine('kelly.document', { ok: true }), { title: 'Gave Kelly a document', sub: 'She keeps her copy; remove it in Kelly' });
assert.deepEqual(kellyLine('kelly.document', { ok: false }), { title: "Kelly couldn't take a document", sub: null });
assert.equal(kellyLine('agent.new_thing', null).title, 'Made a call');
const off = { enabled: false, scopes: [] }, on = { enabled: true, scopes: ['compass:read.tasks', 'bogus'] };
assert.equal(kellyLine('kelly.scopes', { before: off, after: on }).title, 'You turned Kelly on');
assert.equal(kellyLine('kelly.scopes', { before: on, after: off }).title, 'You turned Kelly off');
assert.deepEqual(kellyLine('kelly.scopes', { before: on, after: { enabled: true, scopes: [] } }), { title: 'You changed what Kelly may do', sub: 'Nothing allowed' });
assert.equal(kellyLine('kelly.scopes', { before: off, after: { enabled: false, scopes: ['compass:write.tasks'] } }).sub, 'Allowed: Add and complete tasks');
assert.equal(kellyLine('kelly.scopes', null).title, 'You changed what Kelly may do');
console.log('kelly.test: ok');
