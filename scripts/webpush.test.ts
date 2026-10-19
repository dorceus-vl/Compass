// node --experimental-strip-types scripts/webpush.test.ts
// Encrypts with the Worker's code and decrypts the way a browser does (RFC 8291 §3.4), under Node's WebCrypto.
import assert from 'node:assert/strict';
import { encrypt, vapid, b64u, unb64u } from '../worker/lib/webpush.ts';

const te = new TextEncoder();
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); p.reduce((a, x) => (o.set(x, a), a + x.length), 0); return o; };
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));

// The subscriber: a P-256 key pair and a 16-byte auth secret.
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));

async function decrypt(record: Uint8Array): Promise<string> {
  const salt = record.slice(0, 16), rs = new DataView(record.buffer, record.byteOffset).getUint32(16), idlen = record[20];
  assert.equal(rs, 4096);
  const asPub = record.slice(21, 21 + idlen), body = record.slice(21 + idlen);
  const theirs = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cek, body));
  assert.equal(padded[padded.length - 1], 2, 'last record delimiter');
  return new TextDecoder().decode(padded.slice(0, -1));
}

const msg = JSON.stringify({ title: 'Meeting notes ready', body: 'Café sync – décisions', url: '/meetings/x' });
assert.equal(await decrypt(await encrypt(te.encode(msg), b64u(uaPub), b64u(auth))), msg);
assert.notEqual(b64u(await encrypt(te.encode(msg), b64u(uaPub), b64u(auth))), b64u(await encrypt(te.encode(msg), b64u(uaPub), b64u(auth))), 'fresh salt and key each time');

// VAPID: header shape, aud = the endpoint's origin, and the signature verifies against the public key.
const v = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', v.publicKey)));
const d = (await crypto.subtle.exportKey('jwk', v.privateKey)).d!;
const h = await vapid({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: d, VAPID_SUBJECT: 'mailto:me@example.com' }, 'https://push.example.net/wpush/v2/abc?x=1');
const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
assert.ok(m, 'vapid t=<jwt>, k=<key>');
assert.equal(m[4], pub);
const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
assert.equal(claims.aud, 'https://push.example.net');
assert.equal(claims.sub, 'mailto:me@example.com');
assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 12 * 3600 + 5);
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.publicKey, unb64u(m[3]), te.encode(`${m[1]}.${m[2]}`)), 'signature verifies');
console.log('webpush ok');
