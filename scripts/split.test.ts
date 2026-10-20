import assert from 'node:assert/strict';
import { parseSplit, splitRefusal } from '../worker/lib/split.ts';

const one = { title: 'Send the budget', due_at: '2026-10-23', horizon: 'short', notes: 'Marie asked for it.' };
assert.deepEqual(parseSplit(JSON.stringify([one])), [one]);
assert.deepEqual(parseSplit('```json\n' + JSON.stringify([one]) + '\n```'), [one]); // fenced
assert.deepEqual(parseSplit('Here you go:\n' + JSON.stringify([one]) + '\nHope that helps.'), [one]); // prose around
assert.deepEqual(parseSplit(JSON.stringify({ tasks: [one] })), [one]); // wrapped in an object
// bad date → null, bad horizon → short, missing notes → null, blank titles dropped, long text cut
const messy = parseSplit(JSON.stringify([{ title: 'A', due_at: '2026-02-30', horizon: 'soon' }, { title: 'B', due_at: 'Friday', notes: '  ' }, { title: '  ' }, 'x', null,
  { title: 'T'.repeat(200), notes: 'n'.repeat(400) }]));
assert.deepEqual(messy.slice(0, 2), [{ title: 'A', due_at: null, horizon: 'short', notes: null }, { title: 'B', due_at: null, horizon: 'short', notes: null }]);
assert.equal(messy.length, 3);
assert.equal(messy[2].title.length, 120); assert.equal(messy[2].notes!.length, 300);
// more than 12 are cut
assert.equal(parseSplit(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ title: 'Task ' + i })))).length, 12);
// nothing usable
for (const t of ['', 'no tasks here', '[]', '{"tasks":[]}', '{"nope":1}', '[{"title":']) assert.deepEqual(parseSplit(t), [], t);

// the boundary decision
const cloudWork = { boundary: 'cloud', kind: 'work' } as const, cloudPersonal = { boundary: 'cloud', kind: 'personal' } as const, off = { boundary: 'offline', kind: 'personal' } as const;
assert.equal(splitRefusal(false, null, { boundary: 'cloud', kind: 'personal' }), null); // personal, unfiled
assert.equal(splitRefusal(false, 'p', cloudPersonal), null);
assert.equal(splitRefusal(false, 'p', cloudWork), null);
assert.equal(splitRefusal(false, 'p', off), 'offline_boundary');
assert.equal(splitRefusal(false, 'p', null), 'unknown_project');
assert.equal(splitRefusal(true, null, null), 'pick_cloud_project'); // work needs a project
assert.equal(splitRefusal(true, 'p', null), 'pick_cloud_project');
assert.equal(splitRefusal(true, 'p', { boundary: 'offline', kind: 'work' }), 'pick_cloud_project');
assert.equal(splitRefusal(true, 'p', cloudPersonal), 'pick_cloud_project'); // its tasks would be plain
assert.equal(splitRefusal(true, 'p', cloudWork), null);
console.log('split.test ok');
