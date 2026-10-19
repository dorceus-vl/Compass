// node --experimental-strip-types scripts/email-parse.test.ts
import assert from 'node:assert/strict';
import { emailToPost, senderAllowed } from '../worker/email.ts';

const settings = { work_email_domains: ['bell.ca'] } as never;
const a = emailToPost({ subject: 'Fwd: SOW v3 redlines', text: 'Please review by Friday.\n\n---------- Forwarded message ---------\nFrom: Acme', from: { address: 'jane.doe@bell.ca', name: 'Jane' } }, settings);
assert.equal(a.post.title, 'SOW v3 redlines');
assert.equal(a.post.app, 'email');
assert.equal(a.post.kind, 'email');
assert.equal(a.work, true, 'a Bell sender makes it work');
assert.ok(a.post.body!.length <= 500);
for (const [subject, want] of [['TR: Budget', 'Budget'], ['FW: FW: Re: x', 'Re: x'], ['Fwd:', '(no subject)'], ['', '(no subject)'], ['RE: Cutover', 'RE: Cutover']] as const)
  assert.equal(emailToPost({ subject, text: '', from: { address: 'me@gmail.com' } }, settings).post.title, want, subject);
assert.equal(emailToPost({ subject: 'x'.repeat(300), text: '', from: { address: 'me@gmail.com' } }, settings).post.title.length, 120);
assert.equal(emailToPost({ subject: 's', text: 't', from: { address: 'me@gmail.com' } }, settings).work, false);
assert.equal(senderAllowed('Jane.Doe@Bell.ca', 'jane.doe@bell.ca, me@gmail.com'), true, 'case-insensitive');
assert.equal(senderAllowed('evil@bell.ca', 'jane.doe@bell.ca'), false);
assert.equal(senderAllowed('me@gmail.com', ''), false, 'empty list allows nobody');
console.log('email-parse: ok');
