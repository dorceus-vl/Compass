import assert from 'node:assert/strict';
import { cleanBrief, BRIEF_MAX } from '../worker/lib/kelly.ts';
import { kellyLine } from '../shared/kelly-log.ts';

// The relay's text is data: trimmed, capped, control characters out, never HTML-interpreted (it stays a string).
const T = '2026-10-20T08:00:00.000Z';
assert.deepEqual(cleanBrief({ text: '  Good morning.  ', generated_at: '2026-10-20T07:00:00Z' }, T), { text: 'Good morning.', generated_at: '2026-10-20T07:00:00.000Z' });
assert.equal(cleanBrief({ text: 'x'.repeat(5000) }, T)!.text.length, BRIEF_MAX);
assert.equal(cleanBrief({ text: 'a\u0000b\u001b[31mc\n\n\n\nd' }, T)!.text, 'ab[31mc\n\nd');
assert.equal(cleanBrief({ text: '<script>alert(1)</script>' }, T)!.text, '<script>alert(1)</script>');
assert.equal(cleanBrief({ text: 'hi', generated_at: 'not a date' }, T)!.generated_at, T);
for (const bad of [null, 'text', {}, { text: 5 }, { text: '   ' }, { text: '\u0000' }]) assert.equal(cleanBrief(bad, T), null);

// The log in words.
assert.deepEqual(kellyLine('agent.today', { ok: true }), { title: "Listed today's tasks", sub: null });
assert.equal(kellyLine('agent.tasks.create', { ok: true }).title, 'Added a task');
assert.equal(kellyLine('agent.tasks.done', { ok: true }).title, 'Completed a task');
assert.deepEqual(kellyLine('agent.tasks.create', { refused: 'scope_not_granted' }), { title: 'Refused: no permission', sub: 'Added a task' });
assert.equal(kellyLine('agent.today', { refused: 'rate_limited' }).title, 'Refused: too many calls');
assert.equal(kellyLine('agent.today', { refused: 'weird' }).title, 'Refused: not allowed');
assert.equal(kellyLine('agent.new_thing', null).title, 'Made a call');
const off = { enabled: false, scopes: [] }, on = { enabled: true, scopes: ['compass:read.tasks', 'bogus'] };
assert.equal(kellyLine('kelly.scopes', { before: off, after: on }).title, 'You turned Kelly on');
assert.equal(kellyLine('kelly.scopes', { before: on, after: off }).title, 'You turned Kelly off');
assert.deepEqual(kellyLine('kelly.scopes', { before: on, after: { enabled: true, scopes: [] } }), { title: 'You changed what Kelly may do', sub: 'Nothing allowed' });
assert.equal(kellyLine('kelly.scopes', { before: off, after: { enabled: false, scopes: ['compass:write.tasks'] } }).sub, 'Allowed: Add and complete tasks');
assert.equal(kellyLine('kelly.scopes', null).title, 'You changed what Kelly may do');
console.log('kelly.test: ok');
