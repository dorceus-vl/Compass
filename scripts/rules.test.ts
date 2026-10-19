// node --experimental-strip-types scripts/rules.test.ts
import assert from 'node:assert/strict';
import { matchRule, taskFromRule, parseRule } from '../worker/lib/rules.ts';

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
console.log('rules: ok');
