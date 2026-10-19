import assert from 'node:assert/strict';
import { GOV, govInput, riskScore } from '../worker/lib/gov.ts';

const today = '2026-10-19';
const raid = GOV.raid_items, cr = GOV.change_requests, dec = GOV.decisions;
assert.deepEqual(govInput(raid, { type: 'risk', text: 'Vendor slips', probability: 4, impact: 5 }, true, today), { values: { status: 'open', type: 'risk', text: 'Vendor slips', probability: 4, impact: 5 } });
assert.ok('error' in govInput(raid, { type: 'risk' }, true, today), 'text required on create');
assert.ok('error' in govInput(raid, { type: 'threat', text: 'x' }, true, today), 'type enum');
assert.ok('error' in govInput(raid, { probability: 6 }, false, today), 'probability 1-5');
assert.ok('error' in govInput(raid, { text: '' }, false, today), 'required field cannot be emptied');
assert.deepEqual(govInput(raid, { project_id: 'p2', from_meeting_id: 'm', status: 'closed' }, false, today), { values: { status: 'closed' } }, 'unchecked fields ignored');
assert.deepEqual(govInput(cr, { decision: 'approved' }, false, today, { decision: 'pending' }), { values: { decision: 'approved', decided_at: today } });
assert.deepEqual(govInput(cr, { decision: 'approved', decided_at: '2026-10-01' }, false, today), { values: { decision: 'approved', decided_at: '2026-10-01' } });
assert.deepEqual(govInput(cr, { decision: 'pending' }, false, today, { decision: 'approved' }), { values: { decision: 'pending', decided_at: null } });
assert.equal((govInput(dec, { text: 'Go with vendor B' }, true, today) as { values: Record<string, unknown> }).values.decided_at, today);
assert.equal(riskScore(4, 5), 20); assert.equal(riskScore(null, 5), 0);
console.log('gov: ok');
