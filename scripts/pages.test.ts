// node --experimental-strip-types scripts/pages.test.ts
import assert from 'node:assert/strict';
import { parsePages, agendaMins, agendaMarkdown, type Page } from '../shared/pages.ts';

const p = (id: string, o: Partial<Page> = {}): Page => ({ id, title: id.toUpperCase(), kind: 'page', body: '# hi', tasks: [], items: [], updated: '2026-11-01T00:00:00.000Z', ...o });

assert.deepEqual(parsePages(null), []);
const ok = [p('a', { tasks: ['t1'] }), p('b', { kind: 'agenda', items: [{ id: 'i1', text: 'Intro', mins: 5 }, { id: 'i2', text: 'Risks', mins: 15 }] })];
assert.deepEqual(parsePages(JSON.stringify(ok)), ok, 'round trip');
assert.equal(parsePages([p('a'), p('a')]), null, 'repeated id');
assert.equal(parsePages([p('a', { title: ' ' })]), null, 'blank title');
assert.equal(parsePages([p('a', { kind: 'x' as 'page' })]), null, 'unknown kind');
assert.equal(parsePages([p('a', { tasks: ['t', 't'] })]), null, 'repeated task link');
assert.equal(parsePages([p('a', { items: [{ id: 'i', text: 'x', mins: 1.5 }] })]), null, 'fractional minutes');
assert.equal(parsePages([p('a', { items: [{ id: 'i', text: 'x', mins: 481 }] })]), null, 'minutes over 480');
assert.equal(parsePages('{'), null, 'not JSON');
assert.equal(agendaMins(ok[1].items), 20);
assert.equal(agendaMarkdown({ title: 'Sync', body: '', items: ok[1].items }), '# Sync\n\n1. Intro (5 min, +0)\n2. Risks (15 min, +5)\n\nTotal: 20 min\n');
console.log('pages ok');
