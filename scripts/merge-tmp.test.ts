// node --experimental-strip-types scripts/merge-tmp.test.ts
import assert from 'node:assert/strict';
import { mergeComplete, rewriteTmp, tmpIds } from '../web/src/store/merge.ts';

const P = 'tmp-11111111-2222-3333-4444-555555555555', T = 'tmp-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const s = JSON.stringify({ path: `/projects/${P}/milestones`, json: { project_id: P, before: T, title: 'tmp-not-an-id' } });
assert.deepEqual(tmpIds(s).sort(), [P, P, T].sort(), 'finds ids in path and body');
const out = JSON.parse(rewriteTmp(s, { [P]: 'real-p' }));
assert.equal(out.path, '/projects/real-p/milestones');
assert.equal(out.json.project_id, 'real-p');
assert.equal(out.json.before, T, 'unmapped ids are left alone');
assert.equal(out.json.title, 'tmp-not-an-id', 'non-uuid text is not touched');

const row = (id: string, at: string) => ({ id, updated_at: at });
const local = [row('a', '2026-10-19T10:00:00.000Z'), row('gone', '2026-10-19T10:00:00.000Z'), row(P, '2026-10-19T10:00:00.000Z')];
const remote = [row('a', '2026-10-19T11:00:00.000Z'), row('b', '2026-10-19T11:00:00.000Z')];
assert.deepEqual(mergeComplete(local, remote).map((r) => r.id).sort(), ['a', 'b', P].sort(), 'drops rows missing remotely, keeps tmp rows');
assert.equal(mergeComplete(local, remote).find((r) => r.id === 'a')!.updated_at, '2026-10-19T11:00:00.000Z');
console.log('merge-tmp: ok');
