// node --experimental-strip-types scripts/series.test.ts
import assert from 'node:assert/strict';
import { seriesKey, seriesName, questionHash, normQuestion, buildAgenda, HASH } from '../shared/series.ts';
import { toMarkdown } from '../shared/to-md.ts';

// V6: the same recurring meeting, whatever date or number the title carries
const k = seriesKey('Weekly sync – Acme – Oct 14');
assert.equal(k, 'weekly sync acme');
assert.equal(seriesKey('Weekly Sync - ACME (2026-10-21)'), k);
assert.equal(seriesKey('Weekly sync — Acme #12'), k);
assert.equal(seriesKey('weekly sync acme, Tuesday 21/10'), k);
assert.equal(seriesKey('Weekly sync Acme - Session 4'), k);
assert.equal(seriesKey('Weekly sync Acme Week 12 [14:30]'), k);
assert.equal(seriesKey('Weekly sync Acme 14 October 2026'), k);
assert.equal(seriesKey('Weekly sync Acme 2026-10-21'), k);
assert.notEqual(seriesKey('Acme steering'), k);
assert.notEqual(seriesKey('Acme steering Oct 14'), k);
assert.equal(seriesKey('Q3 review'), 'q3 review', 'a digit stuck to a letter is part of the word');
assert.equal(seriesKey('Oct 14'), 'meeting', 'a title that is only a date still has a key');
assert.equal(seriesName('Weekly sync – Acme – Oct 14'), 'Weekly sync – Acme');
assert.equal(seriesName('Weekly Sync - ACME (2026-10-21)'), 'Weekly Sync - ACME');
assert.equal(seriesName('2026-10-21'), '2026-10-21');

// V8: the question hash ignores case, spacing and the closing mark
assert.equal(normQuestion('  Who owns   the Budget? '), 'who owns the budget');
const h = await questionHash('Who owns the budget?');
assert.match(h, HASH);
assert.equal(await questionHash('  who owns the BUDGET '), h);
assert.notEqual(await questionHash('Who owns the roadmap?'), h);

// V9: the agenda
const rev = (d: string, notes: string[]) => ({ received_at: d, important_notes: notes.map((text) => ({ text, at: null })) });
const act = (title: string, owner: string | null, status = 'new', due: string | null = null) => ({ title, owner, due_at: due, status });
const dec = (text: string, decided_at: string) => ({ text, decided_at });
const empty = buildAgenda({ name: 'Weekly sync' }, [], [], [], []);
assert.equal(empty.title, 'Agenda');
assert.equal(empty.subtitle, 'Weekly sync · next session');
assert.deepEqual(empty.sections.map((s) => s.heading), ['Open actions', 'Open questions', 'Recent decisions', 'Carried over from the last meeting']);
assert.deepEqual(empty.sections.map((s) => s.blocks[0]), [{ t: 'p', text: 'No open actions.' }, { t: 'p', text: 'No open questions.' }, { t: 'p', text: 'No decisions yet.' }, { t: 'p', text: 'Nothing carried over.' }]);

const full = buildAgenda({ name: 'Weekly sync' },
  [rev('2026-10-07T10:00:00.000Z', ['old note']), rev('2026-10-14T10:00:00.000Z', ['Budget is tight', 'Vendor call pending'])],
  [act('Send plan', 'Sam', 'new', '2026-10-20'), act('Book room', null), act('Done thing', 'Sam', 'done'), act('Draft SOW', 'Alex'), act('Chase invoice', 'Sam', 'waiting', '2026-10-18')],
  [dec('d1', '2026-10-01'), dec('d4', '2026-10-14'), dec('d2', '2026-10-07'), dec('d3', '2026-10-10')],
  [{ text: 'Who owns the budget?', answered: false }, { text: 'Is legal done?', answered: true }]);
const [actions, questions, decisions, carried] = full.sections.map((s) => s.blocks[0]);
assert.deepEqual(actions, { t: 'table', headers: ['Owner', 'Action', 'Due'], rows: [['Alex', 'Draft SOW', ''], ['Sam', 'Chase invoice', '2026-10-18'], ['Sam', 'Send plan', '2026-10-20'], ['No owner', 'Book room', '']] });
assert.deepEqual(questions, { t: 'list', items: ['Who owns the budget?'] }, 'an answered question is left out');
assert.deepEqual(decisions, { t: 'list', items: ['d4 (2026-10-14)', 'd3 (2026-10-10)', 'd2 (2026-10-07)'] }, 'the last three, newest first');
assert.deepEqual(carried, { t: 'list', items: ['Budget is tight', 'Vendor call pending'] }, "only the last meeting's notes");
assert.ok(toMarkdown(full).includes('## Open questions'), 'it renders through the minutes builders');

// D1 allows 100 bound parameters a statement: no series query may spread a per-item list into .bind(...) or build an IN list of placeholders.
import { readFileSync } from 'node:fs';
for (const f of ['../worker/lib/series.ts', '../worker/routes/meetings.ts']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.equal(/\.bind\(\s*\.\.\.[a-z]/i.test(src), false, `${f}: a spread in .bind(...) grows with the data`);
  assert.equal(/map\(\(_, i\) => `\?\$\{i/.test(src), false, `${f}: a generated placeholder list`);
}
console.log('series.test.ts ok');
