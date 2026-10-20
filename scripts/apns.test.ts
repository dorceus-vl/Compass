// node --experimental-strip-types scripts/apns.test.ts
// Signs with a generated P-256 key (never a real one) and checks the JWT the way Apple would, and the request exactly.
import assert from 'node:assert/strict';
import { apnsJwt, apnsRequest, sendApns } from '../worker/lib/apns.ts';
import { unb64u } from '../worker/lib/webpush.ts';

const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const p8 = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;

const now = 1_800_000_000;
const jwt = await apnsJwt(p8, 'KEY123', 'TEAM456', now);
const [h, c, sig] = jwt.split('.');
const dec = (s: string) => JSON.parse(new TextDecoder().decode(unb64u(s)));
assert.deepEqual(dec(h), { alg: 'ES256', kid: 'KEY123' });
assert.deepEqual(dec(c), { iss: 'TEAM456', iat: now });
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, unb64u(sig), new TextEncoder().encode(`${h}.${c}`)), 'signature verifies with the public key');
assert.equal(await apnsJwt(p8, 'KEY123', 'TEAM456', now + 39 * 60), jwt, 'cached for 40 minutes');
assert.notEqual(await apnsJwt(p8, 'KEY123', 'TEAM456', now + 41 * 60), jwt, 'renewed after 40');

const token = 'ab'.repeat(32);
const msg = { title: 'Meeting notes ready', body: 'Open Compass to read', url: '/meetings/x', tag: 'meeting:x' };
const prod = apnsRequest(token, 'production', 'com.knocturnlabs.compass', msg, 'JWT');
assert.equal(prod.url, `https://api.push.apple.com/3/device/${token}`);
assert.equal(apnsRequest(token, 'development', 'com.knocturnlabs.compass', msg, 'JWT').url, `https://api.sandbox.push.apple.com/3/device/${token}`);
const hd = prod.init.headers as Record<string, string>;
assert.equal(prod.init.method, 'POST');
assert.equal(hd.authorization, 'bearer JWT');
assert.equal(hd['apns-topic'], 'com.knocturnlabs.compass');
assert.equal(hd['apns-push-type'], 'alert');
assert.equal(hd['apns-priority'], '10');
assert.equal(hd['apns-collapse-id'], 'meeting:x');
assert.ok(Number(hd['apns-expiration']) > Date.now() / 1000);
assert.deepEqual(JSON.parse(prod.init.body as string), { aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, url: '/meetings/x' });
assert.equal((apnsRequest(token, 'production', 't', { ...msg, tag: undefined }, 'J').init.headers as Record<string, string>)['apns-collapse-id'], undefined);

// Without the secrets a send is 'local' and never reaches the network.
assert.equal(await sendApns({ APPLE_TEAM_ID: 'T', APNS_TOPIC: 'x' }, { endpoint: token, env: 'production' }, msg), 'local');
console.log('apns ok');
