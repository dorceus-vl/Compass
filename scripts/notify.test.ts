// node --experimental-strip-types scripts/notify.test.ts
import assert from 'node:assert/strict';
import { ingestMessage, unblockedMessage } from '../worker/lib/notify.ts';

const item = (work: number) => ({ work }) as never;
const personal = ingestMessage({ item: item(0), task: { id: 't1', title: 'Renew passport', kind: 'personal' } as never, created: true }, 'health')!;
assert.deepEqual([personal.type, personal.key, personal.message.title, personal.message.body], ['app_task', 'task:t1', 'Renew passport', 'Added by Health']);
const work = ingestMessage({ item: item(1), task: { id: 't2', title: 'Acme contract numbers', kind: 'work' } as never, created: true }, 'kelly')!;
assert.deepEqual([work.message.title, work.message.body], ['New work task', 'Added by Kelly']);
assert.equal(ingestMessage({ item: item(0), task: { id: 't3', title: 'Secret', kind: 'work' } as never, created: true }, 'email')!.message.title, 'New work task'); // task.kind alone is enough
const meeting = ingestMessage({ item: item(1), review: { id: 'r1', title: 'Acme budget review' } as never, created: true }, 'sonarflow')!;
assert.deepEqual([meeting.type, meeting.key, meeting.message.title, meeting.message.body, meeting.message.url], ['meeting', 'meeting:r1', 'Meeting notes ready', 'Open Compass to read', '/meetings/r1']);
assert.equal(ingestMessage({ item: item(0), task: { id: 't1', title: 'x', kind: 'personal' } as never, created: false }, 'health'), null); // updates never push
// v2.1 V3: a work task's unblock push carries nothing of the task; a personal one names it; both open the task.
const ubWork = unblockedMessage({ id: 'w1', title: 'Acme cutover plan', kind: 'work' });
assert.deepEqual([ubWork.title, ubWork.url], ['A task is unblocked', '/?task=w1']);
assert.ok(!JSON.stringify(ubWork).includes('Acme'));
const ubOwn = unblockedMessage({ id: 'p1', title: 'Book dentist', kind: 'personal' });
assert.deepEqual([ubOwn.title, ubOwn.url], ['Book dentist is unblocked', '/?task=p1']);
console.log('notify ok');
