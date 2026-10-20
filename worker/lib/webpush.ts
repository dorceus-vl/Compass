// Web Push sender, all WebCrypto: RFC 8291 (aes128gcm payload encryption) and RFC 8292 (VAPID).
// Copied from Hollow's web/src/notify.ts (b64u, unb64u, concat, hkdf, encrypt, vapid, and the Web Push send); APNs and FCM left out.

export type VapidEnv = { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };
export type PushMessage = { title: string; body: string; url: string; tag?: string };
export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type Sent = 'sent' | 'gone' | 'failed' | 'local'; // local: we could not sign or encrypt (server misconfiguration), the push service was never asked

const te = new TextEncoder();
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: info as Uint8Array<ArrayBuffer> }, key, bytes * 8)) as Uint8Array<ArrayBuffer>;
}

/** RFC 8291: one aes128gcm record, readable only by the browser that holds the subscription's private key. */
export async function encrypt(plain: Uint8Array, p256dh: string, auth: string) {
  const ua = unb64u(p256dh) as Uint8Array<ArrayBuffer>; // workers-types calls the ECDH field $public; the runtime wants public
  const mine = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const minePub = new Uint8Array((await crypto.subtle.exportKey('raw', mine.publicKey)) as ArrayBuffer);
  const theirs = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs } as unknown as SubtleCryptoDeriveKeyAlgorithm, mine.privateKey, 256));
  const ikm = await hkdf(unb64u(auth) as Uint8Array<ArrayBuffer>, shared, concat(te.encode('WebPush: info\0'), ua, minePub), 32);
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['encrypt']);
  const iv = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, concat(plain, new Uint8Array([2])))); // 2: the last record
  const header = new Uint8Array(21); // salt, record size (4096), key id length, then the key id: our public key
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = minePub.length;
  return concat(header, minePub, sealed);
}

/** RFC 8292: a short-lived ES256 token proving the push comes from the holder of the VAPID key. */
export async function vapid(env: VapidEnv, endpoint: string) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY); // 0x04 | x | y
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)) },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: object) => b64u(te.encode(JSON.stringify(o)));
  const body = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(body))); // already r||s, as JWS wants
  return `vapid t=${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** One device. 201/202 sent; 404/410 the browser unsubscribed or the endpoint expired (gone); a push-service error or network failure is failed; a local signing/encryption error is local (not the device's fault). */
export async function sendPush(env: VapidEnv, sub: PushSub, message: PushMessage): Promise<Sent> {
  let headers: Record<string, string>, body: Uint8Array<ArrayBuffer>;
  try {
    headers = {
      authorization: await vapid(env, sub.endpoint),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400', // a phone that's off gets it within a day, or not at all
      urgency: 'normal',
    };
    body = await encrypt(te.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  } catch {
    console.error('[push] cannot sign or encrypt');
    return 'local';
  }
  try {
    const r = await fetch(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    if (r.status === 201 || r.status === 202) return 'sent';
    if (r.status === 404 || r.status === 410) return 'gone';
    console.error(`[push] ${new URL(sub.endpoint).origin} answered ${r.status}`); // never the endpoint path, it identifies the device
    return 'failed';
  } catch (e) {
    console.error(`[push] send threw: ${(e as Error).name}`);
    return 'failed';
  }
}
