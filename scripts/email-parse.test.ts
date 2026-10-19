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

// ---- recipientOk(): the secret address gate ----
import { recipientOk } from '../worker/email.ts';
const inbox = 'compass-abcdefghijklmnop@knocturnlabs.com';
assert.equal(await recipientOk(inbox, inbox), true, 'exact match');
assert.equal(await recipientOk('Compass-ABCDEFGHIJKLMNOP@KnocturnLabs.com', inbox), true, 'different case');
assert.equal(await recipientOk('compass@knocturnlabs.com', inbox), false, 'another address');
assert.equal(await recipientOk(inbox, undefined), false, 'unset configured');
assert.equal(await recipientOk(inbox, ''), false, 'empty configured');
assert.equal(await recipientOk('', inbox), false, 'empty to');
assert.equal(await recipientOk('', ''), false, 'both empty is not a match');

// ---- post details ----
const b = emailToPost({ subject: 'a\r\nb\t\u0007c', html: '<style>p{}</style><p>Hello&nbsp;<b>there</b></p><script>x()</script>', messageId: '<abc@x>', from: { address: 'ME@Bell.CA' } }, { work_email_domains: ['BELL.ca'] });
assert.equal(b.post.title, 'a b c', 'whitespace and control characters collapse');
assert.equal(b.post.body, 'Hello there', 'html-only mail becomes text');
assert.equal(b.post.ref, 'email:<abc@x>');
assert.equal(b.work, true, 'both sides lowercased');
assert.equal(emailToPost({ subject: 's', messageId: 'x'.repeat(500) }, settings).post.ref!.length, 200);
assert.equal(emailToPost({ subject: 's' }, settings).post.ref, null);
console.log('email-recipient: ok');
