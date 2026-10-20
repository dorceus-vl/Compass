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
console.log('fcm ok');
