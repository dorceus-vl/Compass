// node --experimental-strip-types scripts/fcm.test.ts
// Signs with a generated RSA key in a fake service-account JSON (never a real one).
import assert from 'node:assert/strict';
import { fcmJwt, fcmRequest, sendFcm } from '../worker/lib/fcm.ts';
import { unb64u } from '../worker/lib/webpush.ts';

const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const sa = JSON.stringify({ client_email: 'push@compass-test.iam.gserviceaccount.com', project_id: 'compass-test', private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n` });

const now = 1_800_000_000;
const [h, c, sig] = (await fcmJwt(sa, now)).split('.');
const dec = (s: string) => JSON.parse(new TextDecoder().decode(unb64u(s)));
assert.deepEqual(dec(h), { alg: 'RS256', typ: 'JWT' });
assert.deepEqual(dec(c), { iss: 'push@compass-test.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, unb64u(sig), new TextEncoder().encode(`${h}.${c}`)), 'assertion verifies with the public key');

const token = 'f'.repeat(30) + ':APA91b_x-y';
const msg = { title: 'New work task', body: 'Added by Kelly', url: '/', tag: 'task:t2' };
const r = fcmRequest('compass-test', 'ACCESS', token, msg);
assert.equal(r.url, 'https://fcm.googleapis.com/v1/projects/compass-test/messages:send');
assert.equal(r.init.method, 'POST');
assert.equal((r.init.headers as Record<string, string>).authorization, 'Bearer ACCESS');
assert.deepEqual(JSON.parse(r.init.body as string), { message: { token, notification: { title: 'New work task', body: 'Added by Kelly' }, data: { url: '/' }, android: { priority: 'high', notification: { tag: 'task:t2'.replace(':', '') } } } });
// A work message is generic already (the caller made it so); the sender passes it through unchanged.
assert.equal(JSON.parse(r.init.body as string).message.notification.title, 'New work task');

// Without the service account a send is 'local' and never reaches the network.
assert.equal(await sendFcm({}, { endpoint: token }, msg), 'local');

// Status mapping, with an injected fetch that also plays Google's OAuth endpoint.
const mk = (send: () => Response | Promise<Response>, oauth = () => new Response(JSON.stringify({ access_token: 'AT' }), { status: 200 })) => {
  const calls = { oauth: 0, send: 0 };
  const f = (async (u: string) => (String(u).includes('oauth2') ? (calls.oauth++, oauth()) : (calls.send++, send()))) as unknown as typeof fetch;
  return { f, calls };
};
const err = (status: number, s?: string) => () => new Response(s ? JSON.stringify({ error: { status: s } }) : '', { status });
const env = { FCM_SERVICE_ACCOUNT: sa };
const sub = { endpoint: token };
const cases: [() => Response, string][] = [
  [() => new Response('{}', { status: 200 }), 'sent'],
  [err(404, 'NOT_FOUND'), 'gone'], [err(400, 'UNREGISTERED'), 'gone'],
  [err(401, 'UNAUTHENTICATED'), 'local'], [err(403, 'PERMISSION_DENIED'), 'local'],
  [err(500, 'INTERNAL'), 'failed'], [err(503, 'UNAVAILABLE'), 'failed'], [err(429, 'QUOTA_EXCEEDED'), 'failed'], [err(400, 'INVALID_ARGUMENT'), 'failed'],
];
for (const [send, want] of cases) assert.equal(await sendFcm(env, sub, msg, mk(send).f), want, want);
{
  const m = mk(() => new Response('{}', { status: 200 }));
  await sendFcm(env, sub, msg, m.f);
  const net = (async (u: string) => { if (String(u).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'AT' })); throw new DOMException('timed out', 'TimeoutError'); }) as unknown as typeof fetch;
  assert.equal(await sendFcm(env, sub, msg, net), 'failed', 'timeout on send');
  // A refused credential drops the cached access token: the next send exchanges again.
  const m2 = mk(err(401, 'UNAUTHENTICATED'));
  await sendFcm(env, sub, msg, m2.f);
  const m3 = mk(() => new Response('{}', { status: 200 }));
  assert.equal(await sendFcm(env, sub, msg, m3.f), 'sent');
  assert.equal(m3.calls.oauth, 1, 'fresh exchange after a 401');
  // Concurrent sends on a cold cache share one exchange.
  const m4 = mk(() => new Response('{}', { status: 200 }));
  assert.deepEqual(await Promise.all([1, 2, 3].map(() => sendFcm(env, sub, msg, m4.f))), ['sent', 'sent', 'sent']);
  assert.equal(m4.calls.oauth, 0, 'cache still warm from m3');
}
// A bad OAuth answer is local and not remembered.
{
  const bad = mk(() => new Response('{}'), () => new Response('{"error":"invalid_grant"}', { status: 400 }));
  // cache is warm from above, so force a cold one with a different account id
  const sa2 = JSON.stringify({ ...JSON.parse(sa), client_email: 'other@compass-test.iam.gserviceaccount.com' });
  assert.equal(await sendFcm({ FCM_SERVICE_ACCOUNT: sa2 }, sub, msg, bad.f), 'local', 'oauth refused');
  const sa4 = JSON.stringify({ ...JSON.parse(sa), client_email: 'fourth@compass-test.iam.gserviceaccount.com' });
  assert.equal(await sendFcm({ FCM_SERVICE_ACCOUNT: sa4 }, sub, msg, (async () => { throw new TypeError('network'); }) as typeof fetch), 'local', 'token exchange unreachable');
  const good = mk(() => new Response('{}'));
  assert.equal(await sendFcm({ FCM_SERVICE_ACCOUNT: sa2 }, sub, msg, good.f), 'sent');
  assert.equal(good.calls.oauth, 1, 'failed exchange not cached');
  const conc = mk(() => new Response('{}'));
  const sa3 = JSON.stringify({ ...JSON.parse(sa), client_email: 'third@compass-test.iam.gserviceaccount.com' });
  assert.deepEqual(await Promise.all([1, 2, 3].map(() => sendFcm({ FCM_SERVICE_ACCOUNT: sa3 }, sub, msg, conc.f))), ['sent', 'sent', 'sent']);
  assert.equal(conc.calls.oauth, 1, 'one exchange for concurrent sends');
}
console.log('fcm ok');
