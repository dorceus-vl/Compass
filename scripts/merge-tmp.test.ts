// node --experimental-strip-types scripts/merge-tmp.test.ts
import assert from 'node:assert/strict';
import { planPull, remoteWins, rewriteTmp, tmpIds } from '../web/src/store/merge.ts';

const P = 'tmp-11111111-2222-3333-4444-555555555555', T = 'tmp-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const s = JSON.stringify({ path: `/projects/${P}/milestones`, json: { project_id: P, before: T, title: 'tmp-not-an-id' } });
assert.deepEqual(tmpIds(s).sort(), [P, P, T].sort(), 'finds ids in path and body');
const out = JSON.parse(rewriteTmp(s, { [P]: 'real-p' }));
assert.equal(out.path, '/projects/real-p/milestones');
assert.equal(out.json.project_id, 'real-p');
assert.equal(out.json.before, T, 'unmapped ids are left alone');
assert.equal(out.json.title, 'tmp-not-an-id', 'non-uuid text is not touched');

const row = (id: string, at: string, deleted_at: string | null = null) => ({ id, updated_at: at, deleted_at });
const T0 = '2026-10-19T10:00:00.000Z', T1 = '2026-10-19T11:00:00.000Z';
assert.deepEqual(remoteWins([row('a', T1)], [row('a', T0), row('b', T0)]).map((r) => r.id), ['b'], 'older remote does not win; new remote does');

// complete list: missing remotely is deleted, claimed tmp kept, unclaimed tmp (phantom) deleted
const local = [row('a', T0), row('same', T1), row('gone', T0), row(P, T0), row(T, T0)];
const remote = [row('a', T1), row('same', T1), row('b', T1)];
const full = planPull(local, remote, new Set([P]), true);
assert.deepEqual(full.put.map((r) => r.id).sort(), ['a', 'b', 'same'], 'same-age rows tie to remote (>=)');
assert.deepEqual(full.del.sort(), ['gone', T].sort(), 'gone and the unclaimed phantom are deleted; claimed tmp survives');

// incremental: missing remotely is kept, but phantom tmp rows go and trashed remote rows are deleted, not stored
const inc = planPull([row('a', T0), row('keep', T0), row(T, T0)], [row('a', T1, T1), row('n', T1)], new Set(), false);
assert.deepEqual(inc.put.map((r) => r.id), ['n']);
assert.deepEqual(inc.del.sort(), ['a', T].sort());
console.log('merge-tmp: ok');
