// node --experimental-strip-types scripts/inbox-parse.test.ts
import assert from 'node:assert/strict';
import { parseInboxBody, appsForSecret, safeEqual, isWorkAccount } from '../worker/lib/inbox-parse.ts';

const env = { INBOX_SECRET_KELLY: 'k-secret', INBOX_SECRET_ID: 'i-secret', INBOX_SECRET_HOLLOW: 'h-secret' } as never;
assert.deepEqual(await appsForSecret(env, 'k-secret'), ['finance', 'health', 'home', 'nightowl', 'kelly']);
assert.deepEqual(await appsForSecret(env, 'i-secret'), ['sonarflow']);
assert.deepEqual(await appsForSecret(env, 'h-secret'), ['hollow']);
assert.equal(await appsForSecret(env, 'nope'), null);
assert.equal(await appsForSecret({} as never, ''), null, 'unset secrets never match an empty token');
assert.equal(await safeEqual('abc', 'abc'), true);
assert.equal(await safeEqual('abc', 'abd'), false);

const ok = parseInboxBody({ app: 'finance', kind: 'notification', title: '  Netflix went up ', body: 'b', url: 'https://finance.knocturnlabs.com/subscriptions.html#watch-netflix', ref: 'kelly:finance:x', suggest: 'review_budget' });
assert.equal(typeof ok === 'object' && ok.title, 'Netflix went up');
for (const [bad, why] of [
  [{ app: 'finance', kind: 'notification', title: '' }, 'empty title'],
  [{ app: 'finance', kind: 'notification', title: 'x'.repeat(121) }, 'long title'],
  [{ app: 'finance', kind: 'notification', title: 't', body: 'x'.repeat(501) }, 'long body'],
  [{ app: 'finance', kind: 'notification', title: 't', url: 'http://x.y' }, 'http url'],
  [{ app: 'finance', kind: 'notification', title: 't', url: 'javascript:alert(1)' }, 'js url'],
  [{ app: 'finance', kind: 'sms', title: 't' }, 'bad kind'],
  [{ app: 'evil', kind: 'notification', title: 't' }, 'bad app'],
  [{ app: 'sonarflow', kind: 'meeting', title: 't', payload: { summary: 'no title fields' } }, 'meeting payload missing arrays'],
  [{ app: 'finance', kind: 'notification', title: 't', payload: { big: 'x'.repeat(70_000) } }, 'payload too big'],
  [null, 'null body'],
] as const) assert.equal(typeof parseInboxBody(bad), 'string', why);
const meeting = parseInboxBody({ app: 'sonarflow', kind: 'meeting', title: 'Steering', ref: 'sonarflow:recording:r1', url: 'https://sonarflow.knocturnlabs.com/meetings/r1',
  payload: { title: 'Steering', summary: 's', decisions: [], action_items: [{ text: 'Send SOW', owner: 'Vlad', due: null, at: '12:30' }], important_notes: [], open_questions: [] } });
assert.equal(typeof meeting, 'object');

const notes = { title: 'T', summary: 's', decisions: [], action_items: [], important_notes: [], open_questions: [] };
const mt = (o: Record<string, unknown>) => parseInboxBody({ app: 'sonarflow', kind: 'meeting', title: 'T', ref: 'sonarflow:recording:r1', payload: notes, ...o });
assert.equal(typeof mt({}), 'object');
assert.equal(typeof mt({ app: 'hollow' }), 'string', 'meeting only from sonarflow');
assert.equal(typeof mt({ app: 'kelly' }), 'string', 'meeting only from sonarflow (kelly)');
for (const ref of ['kelly:finance:x', 'sonarflow:recording:', 'sonarflow:recording:a:b', 'sonarflow:recording:a b', 'sonarflow:recording:' + 'x'.repeat(101), undefined]) assert.equal(typeof mt({ ref }), 'string', `meeting ref ${ref}`);
assert.equal(typeof parseInboxBody({ app: 'kelly', kind: 'email', title: 't', ref: 'email:gmail:1' }), 'object');
assert.equal(typeof parseInboxBody({ app: 'hollow', kind: 'email', title: 't' }), 'string', 'email only from kelly');
assert.equal(typeof parseInboxBody({ app: 'finance', kind: 'email', title: 't' }), 'string', 'email only from kelly (finance)');

assert.equal(isWorkAccount('vlad@bell.ca', ['bell.ca']), true);
assert.equal(isWorkAccount('Vlad@Mail.Bell.CA', ['bell.ca']), true, 'subdomain, any case');
assert.equal(isWorkAccount('vlad@notbell.ca', ['bell.ca']), false, 'suffix is not a subdomain');
assert.equal(isWorkAccount('vlad@gmail.com', ['bell.ca']), false);
assert.equal(isWorkAccount(undefined, ['bell.ca']), false);
console.log('inbox-parse: ok');
