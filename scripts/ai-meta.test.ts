import assert from 'node:assert/strict';
import { splitAnswer, isEmpty } from '../shared/ai-meta.ts';

const known = new Set(['risk-management', 'raid-log']);
const meta = (o: unknown) => 'Answer body.\n\n```compass-meta\n' + JSON.stringify(o) + '\n```\n';
let r = splitAnswer(meta({ citations: ['risk-management', 'made-up', 'risk-management'], proposals: {
  tasks: [{ title: 'Call the vendor', horizon: 'short', due_at: '2026-10-24' }, { title: '', horizon: 'short' }, { title: 'Bad date', horizon: 'soon', due_at: '24/10' }],
  raid: [{ type: 'risk', text: 'Cutover slips', probability: 4, impact: 9 }, { type: 'threat', text: 'x' }],
  decisions: [{ text: 'Go with plan B' }, { text: 7 }] } }), known);
assert.equal(r.content, 'Answer body.');
assert.deepEqual(r.citations, ['risk-management'], 'unknown slugs dropped, duplicates removed');
assert.deepEqual(r.proposals.tasks, [{ title: 'Call the vendor', horizon: 'short', due_at: '2026-10-24' }, { title: 'Bad date', horizon: 'short', due_at: null }]);
assert.deepEqual(r.proposals.raid, [{ type: 'risk', text: 'Cutover slips', probability: 4, impact: null }]);
assert.deepEqual(r.proposals.decisions, [{ text: 'Go with plan B' }]);
r = splitAnswer('No block here.', known);
assert.deepEqual([r.content, r.citations, isEmpty(r.proposals)], ['No block here.', [], true]);
r = splitAnswer('Text\n```compass-meta\n{not json\n```', known);
assert.deepEqual([r.content, isEmpty(r.proposals)], ['Text', true], 'a broken block is dropped, the answer kept');
r = splitAnswer(meta({ proposals: { tasks: Array.from({ length: 30 }, (_, i) => ({ title: 't' + i, horizon: 'long' })) } }), known);
assert.equal(r.proposals.tasks.length, 20, 'at most 20 of each');
console.log('ai-meta: ok');
