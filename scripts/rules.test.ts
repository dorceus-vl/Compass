// node --experimental-strip-types scripts/rules.test.ts
import assert from 'node:assert/strict';
import { matchRule, taskFromRule, parseRule, safeRegex } from '../worker/lib/rules.ts';
import type { Rule } from '../shared/types.ts';

const r = (o: Record<string, unknown>) => parseRule({ id: String(o.id), name: 'x', app: o.app ?? '*', match: JSON.stringify(o.match ?? {}), then_set: JSON.stringify(o.then_set ?? {}), mode: o.mode ?? 'task', dedupe: 'update', enabled: o.enabled ?? 1, sort: o.sort ?? 0 });
const rules = [
  r({ id: 'doses', app: 'health', match: { suggest: 'log_meds' }, mode: 'ignore', sort: 10 }),
  r({ id: 'health', app: 'health', then_set: { horizon: 'short', due_offset_days: 3 }, sort: 20 }),
  r({ id: 'subs', app: 'finance', match: { title_regex: 'subscription|went up' }, then_set: { due_offset_days: 5 }, sort: 40 }),
  r({ id: 'off', app: 'finance', enabled: 0, sort: 1 }),
  r({ id: 'bad', app: 'home', match: { title_regex: '([' }, sort: 5 }),
  r({ id: 'home', app: 'home', then_set: { due_offset_days: 7 }, sort: 70 }),
  r({ id: 'mail', app: 'kelly', match: { kind: 'email' }, then_set: { status: 'waiting', due_offset_days: 2 }, sort: 80 }),
];
const it = (o: Record<string, unknown>) => ({ app: 'health', kind: 'notification', suggest: null, title: 't', ...o }) as never;
assert.equal(matchRule(rules, it({ suggest: 'log_meds' }))?.id, 'doses', 'more specific rule sorted first wins');
assert.equal(matchRule(rules, it({ suggest: 'open_app' }))?.id, 'health');
assert.equal(matchRule(rules, it({ app: 'finance', title: 'Netflix went up' }))?.id, 'subs', 'disabled rule skipped');
assert.equal(matchRule(rules, it({ app: 'finance', title: 'Hydro is due soon' })), null, 'no match → null');
assert.equal(matchRule(rules, it({ app: 'home', title: 'x' }))?.id, 'home', 'invalid regex never matches');
assert.equal(matchRule(rules, it({ app: 'kelly', kind: 'email' }))?.id, 'mail');
assert.equal(matchRule(rules, it({ app: 'kelly', kind: 'notification' })), null);
assert.deepEqual(parseRule({ id: 'j', name: 'n', app: 'x', match: '{not json', then_set: '{}', mode: 'task', dedupe: 'update', enabled: 1, sort: 0 }).match, { title_regex: '(?!)' }, 'bad JSON matches nothing');

const t = taskFromRule(rules[1], { app: 'health', kind: 'notification', title: 'Refill medication', from: null }, '2026-10-19', false);
assert.equal(t.due_at, '2026-10-22');
assert.equal(t.kind, 'personal');
assert.equal(t.horizon, 'short');
const m = taskFromRule(rules[6], { app: 'kelly', kind: 'email', title: 'Re: SOW', from: 'Marie Roy' }, '2026-10-19', true);
assert.deepEqual([m.status, m.kind, m.waiting_on, m.due_at], ['waiting', 'work', 'Marie Roy', '2026-10-21']);
// Fix round 1: user regexes can't hang ingest, titles are capped, dates and offsets are validated, JSON arrays are rejected, ties sort by id.
const rx = (src: string, sort = 0, id = 'rx') => r({ id, app: 'finance', match: { title_regex: src }, sort });
const t0 = performance.now();
assert.equal(matchRule([rx('^(a+)+$')], it({ app: 'finance', title: 'a'.repeat(32) + '!' })), null, 'nested quantifier never matches');
assert.equal(matchRule([rx('^(a+)+$')], it({ app: 'finance', title: 'a'.repeat(33) })), null, 'nested quantifier never matches (full match)');
assert.equal(safeRegex('^(a+)+$'), null);
assert.ok(performance.now() - t0 < 50, 'nested quantifier rejected without backtracking');
assert.equal(matchRule([rx('a'.repeat(101))], it({ app: 'finance', title: 'a'.repeat(101) })), null, '101-char pattern never matches');
assert.equal(safeRegex('a'.repeat(101)), null);
assert.notEqual(safeRegex('a'.repeat(100)), null, '100-char pattern allowed');
assert.equal(matchRule([rx('(ab)+')], it({ app: 'finance', title: 'xabab' }))?.id, 'rx', '(ab)+ without outer quantifier still works');
assert.equal(matchRule([rx('netflix')], it({ app: 'finance', title: 'NETFLIX went up' }))?.id, 'rx', 'title_regex is case-insensitive');
assert.equal(matchRule([rx('netflix')], it({ app: 'finance', title: 'z'.repeat(125) + 'netflix' })), null, 'title capped at 120 chars');

const base = { id: 'd', name: 'n', app: 'x', match: '{}', mode: 'task', dedupe: 'update', enabled: 1, sort: 0 };
const offRule = (then: string) => parseRule({ ...base, then_set: then });
const at = (rule: Rule, today = '2026-10-19') => taskFromRule(rule, { app: 'health', kind: 'notification', title: 't', from: null }, today, false).due_at;
assert.equal(at(offRule('{"due_offset_days":"abc"}')), null, 'non-numeric offset → no due date');
assert.equal(at(offRule('{"due_offset_days":1e9}')), null, 'huge offset → no due date');
assert.equal(at(offRule('{"due_offset_days":-1}')), null, 'negative offset → no due date');
assert.equal(at(offRule('{"due_offset_days":2.5}')), null, 'fractional offset → no due date');
assert.equal(at(offRule('{"due_offset_days":3}'), 'bad'), null, 'malformed today → no due date, no throw');
assert.equal(at(offRule('{"due_offset_days":3}'), '2026-02-31'), null, 'impossible date → no due date');
assert.equal(at(offRule('{"due_offset_days":365}')), '2027-10-19', 'offset 365 allowed');

const arr = parseRule({ ...base, match: '[1]', then_set: '{}' });
assert.deepEqual(arr.match, { title_regex: '(?!)' }, 'JSON array treated as bad JSON');
assert.equal(matchRule([arr], it({ app: 'x', title: 'anything' })), null, 'array-match rule is skipped');
const bad = parseRule({ ...base, id: 'badjson', app: '*', match: '{not json', sort: 0 });
const fallback = parseRule({ ...base, id: 'fallback', app: '*', match: '{}', sort: 5 });
assert.equal(matchRule([bad, fallback], it({ app: 'x', title: 'anything' }))?.id, 'fallback', 'bad-JSON rule skipped, not matching everything');

const tieA = r({ id: 'a', app: 'finance', match: { title_regex: 'z' }, sort: 3 });
const tieB = r({ id: 'b', app: 'finance', sort: 3 });
const hit = it({ app: 'finance', title: 'zzz' });
assert.equal(matchRule([tieB, tieA], hit)?.id, 'a', 'sort ties break on id (order A)');
assert.equal(matchRule([tieA, tieB], hit)?.id, 'a', 'sort ties break on id (order B)');
console.log('rules: ok');
