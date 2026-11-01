import assert from 'node:assert/strict';
const { escalations, daysOverdue } = await import('../worker/lib/escalate.ts');
const t = (id: string, due: string | null, priority = 0, status = 'new') => ({ id, due_at: due, priority, status, deleted_at: null, parent_id: null, kind: 'personal' }) as never;
assert.equal(daysOverdue('2026-11-04', '2026-11-01'), 3);
const r = escalations([t('a', '2026-11-01'), t('b', '2026-10-28'), t('c', '2026-11-02'), t('d', '2026-10-20', 3), t('e', null), t('f', '2026-10-20', 0, 'done')], '2026-11-04');
assert.deepEqual(r.raise.map((x: { id: string }) => x.id), ['a', 'b']); // 3+ days, not already high, not done
assert.deepEqual(r.push.map((x: { id: string }) => x.id), ['b', 'd']); // 7+ days, high or not
