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

// ---- authenticated(): fail closed ----
import { authenticated, authResults, arProblem } from '../worker/email.ts';
const ar = (s: string) => `mx.cloudflare.net; ${s}`;
assert.equal(authenticated(ar('dmarc=pass header.from=gmail.com'), 'me@gmail.com', 'me@gmail.com'), true, 'dmarc pass');
assert.equal(authenticated(ar('dkim=pass header.d=gmail.com header.i=@gmail.com'), 'me@gmail.com', 'ME@gmail.com'), true, 'dkim aligned, case-insensitive');
assert.equal(authenticated(ar('dkim=pass header.d=gmail.com'), 'me@mail.gmail.com', 'me@mail.gmail.com'), true, 'dkim d= a parent of the sender domain');
assert.equal(authenticated(ar('spf=pass smtp.mailfrom=me@gmail.com'), 'me@gmail.com', 'me@gmail.com'), true, 'spf aligned');
assert.equal(authenticated(ar('spf=pass (ok) smtp.mailfrom="bounce.gmail.com"'), 'me@gmail.com', 'me@gmail.com'), false, 'spf for a different domain');
assert.equal(authenticated(ar('dkim=pass header.d=evil.com'), 'me@gmail.com', 'me@gmail.com'), false, 'dkim signed by another domain');
assert.equal(authenticated(ar('dkim=pass header.d=gmail.com.evil.com'), 'me@gmail.com', 'me@gmail.com'), false, 'look-alike domain');
assert.equal(authenticated(ar('dkim=pass header.d=mail.gmail.com'), 'me@gmail.com', 'me@gmail.com'), false, 'a child domain is not the sender');
assert.equal(authenticated(ar('dmarc=fail header.from=gmail.com; spf=fail smtp.mailfrom=me@gmail.com; dkim=none'), 'me@gmail.com', 'me@gmail.com'), false, 'no pass');
assert.equal(authenticated(null, 'me@gmail.com', 'me@gmail.com'), false, 'missing header');
assert.equal(authenticated('', 'me@gmail.com', 'me@gmail.com'), false, 'empty header');
assert.equal(authenticated(ar('dmarc=pass header.from=gmail.com'), 'me@gmail.com', 'other@gmail.com'), false, 'header From differs from envelope');
assert.equal(authenticated(ar('dmarc=pass header.from=gmail.com'), 'me@gmail.com', undefined), false, 'no header From');
assert.equal(authenticated(`mx.cloudflare.net; dmarc=fail, forged.example; dmarc=pass`, 'me@gmail.com', 'me@gmail.com'), false, 'a fail on our header is not rescued by another');
assert.equal(authenticated(`mx.cloudflare.net; dmarc=pass header.from=gmail.com, mx.cloudflare.net; dmarc=pass header.from=gmail.com`, 'me@gmail.com', 'me@gmail.com'), false, 'a second header with our id (forged copy) -> drop');
assert.equal(authenticated(`forged.example; dmarc=pass header.from=gmail.com`, 'me@gmail.com', 'me@gmail.com'), false, 'only a foreign authserv-id');
assert.equal(authenticated(`forged.example; dmarc=pass header.from=gmail.com, mx.cloudflare.net; dmarc=pass header.from=gmail.com`, 'me@gmail.com', 'me@gmail.com'), true, 'a forged foreign header beside ours is ignored');
assert.equal(authenticated(`other.example; dmarc=pass header.from=gmail.com`, 'me@gmail.com', 'me@gmail.com', 'other.example'), true, 'the pinned id is configurable');
assert.equal(authenticated(ar('dmarc=pass header.from=evil.com'), 'me@gmail.com', 'me@gmail.com'), false, 'dmarc pass for another header.from');
assert.equal(authenticated(ar('dmarc=pass'), 'me@gmail.com', 'me@gmail.com'), false, 'dmarc pass without header.from');
assert.equal(authResults(`a.example; x=pass, b.example; y=pass`).length, 2);
assert.equal(authResults(null).length, 0);
// forgeries that hide a header boundary or inject segments
const ok = 'header.from=gmail.com';
assert.equal(authenticated(`real.example; dmarc=fail, (x) mx.cloudflare.net; dmarc=pass ${ok}`, 'me@gmail.com', 'me@gmail.com'), false, 'comment before a forged id');
assert.equal(authenticated(`real.example; dmarc=fail, "mx.cloudflare.net"; dmarc=pass ${ok}`, 'me@gmail.com', 'me@gmail.com'), false, 'quoted forged id');
assert.equal(authenticated(`real, (x) mx.cloudflare.net; dmarc=pass ${ok}`, 'me@gmail.com', 'me@gmail.com'), false, 'the reported forgery 1');
assert.equal(authenticated(`real, "mx.cloudflare.net"; dmarc=pass ${ok}`, 'me@gmail.com', 'me@gmail.com'), false, 'the reported forgery 2');
assert.equal(authenticated(`real; dkim=pass header.i=x mx.cloudflare.net`, 'me@gmail.com', 'me@gmail.com'), false, 'pinned id inside a value');
assert.equal(authenticated(`mx.cloudflare.net; dmarc=fail reason="a;dmarc=pass ${ok}"`, 'me@gmail.com', 'me@gmail.com'), false, 'quoted ; injects a segment');
assert.equal(authenticated(`mx.cloudflare.net; dmarc=pass ${ok}`, 'me@gmail.com', 'me@gmail.com'), true, 'the plain good case still passes');
assert.equal(authenticated(`MX.Cloudflare.NET ; dmarc=pass ${ok}`, 'me@gmail.com', 'me@gmail.com'), true, 'id case-insensitive');
assert.equal(arProblem('a; b=c (x)', 'mx.cloudflare.net'), 'ar-unparseable');
assert.equal(arProblem('real.example; dmarc=pass', 'mx.cloudflare.net'), 'ar-ambiguous', 'no pinned id');
assert.equal(arProblem('mx.cloudflare.net; a=b, mx.cloudflare.net; a=b', 'mx.cloudflare.net'), 'ar-ambiguous', 'twice');
assert.equal(arProblem('mx.cloudflare.net; a=b', 'mx.cloudflare.net'), null);
assert.equal(arProblem('mx.cloudflare.net.evil; a=b, mx.cloudflare.net; a=b', 'mx.cloudflare.net'), null, 'a longer id is another token');

// ---- post details ----
const b = emailToPost({ subject: 'a\r\nb\t\u0007c', html: '<style>p{}</style><p>Hello&nbsp;<b>there</b></p><script>x()</script>', messageId: '<abc@x>', from: { address: 'ME@Bell.CA' } }, { work_email_domains: ['BELL.ca'] });
assert.equal(b.post.title, 'a b c', 'whitespace and control characters collapse');
assert.equal(b.post.body, 'Hello there', 'html-only mail becomes text');
assert.equal(b.post.ref, 'email:<abc@x>');
assert.equal(b.work, true, 'both sides lowercased');
assert.equal(emailToPost({ subject: 's', messageId: 'x'.repeat(500) }, settings).post.ref!.length, 200);
assert.equal(emailToPost({ subject: 's' }, settings).post.ref, null);
console.log('email-auth: ok');
