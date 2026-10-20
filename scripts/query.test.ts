// node --experimental-strip-types scripts/query.test.ts
import assert from 'node:assert/strict';
import { parseQuery, applyQuery, arrange } from '../web/src/query.ts';

const p = [{ id: 'p1', name: 'ERP migration' }];
const mk = (o: Record<string, unknown>) => ({ id: 'x', title: '', status: 'new', kind: 'personal', horizon: 'short', project_id: null, due_at: null, priority: 0, tags: '[]', deleted_at: null, ...o }) as any;
const T = [mk({ id: 'a', title: 'Prepare risk review', kind: 'work', project_id: 'p1', due_at: '2026-10-18', status: 'progress' }),
  mk({ id: 'b', title: 'Book dentist', due_at: '2026-11-02', tags: '["home"]' }), mk({ id: 'c', title: 'Old thing', status: 'done' })];
const ids = (q: string, t = '2026-10-19') => applyQuery(T, parseQuery(q), p as any, t).map((x) => x.id);
assert.deepEqual(ids(''), ['a', 'b'], 'open tasks by default');
assert.deepEqual(ids('status:done'), ['c']);
assert.deepEqual(ids('status:all').length, 3);
assert.deepEqual(ids('kind:work'), ['a']);
assert.deepEqual(ids('project:erp'), ['a'], 'project by name, case-insensitive prefix');
assert.deepEqual(ids('due:overdue'), ['a']);
assert.deepEqual(ids('due:<2026-10-31'), ['a']);
assert.deepEqual(ids('tag:home'), ['b']);
assert.deepEqual(ids('dentist'), ['b'], 'free words match the title');
assert.deepEqual(ids('risk kind:work status:progress'), ['a']);
// arrange: open first and limited, then this visit's finished ones; old done tasks never shown; count is open only
const L = [mk({ id: '1' }), mk({ id: 'd1', status: 'done' }), mk({ id: '2' }), mk({ id: 'd2', status: 'done' }), mk({ id: '3' })];
const ar = (fin: string[], limit?: number) => { const r = arrange(L, new Set(fin), limit); return [r.shown.map((x: any) => x.id).join(','), r.open]; };
assert.deepEqual(ar([]), ['1,2,3', 3]);
assert.deepEqual(ar(['d2']), ['1,2,3,d2', 3]);
assert.deepEqual(ar(['d1', 'd2'], 2), ['1,2,d1,d2', 3], 'finished cards come after the limited open ones and do not use its slots');
assert.deepEqual(ar(['2']), ['1,2,3', 3], 'an undone task is just open again');
console.log('query: ok');
