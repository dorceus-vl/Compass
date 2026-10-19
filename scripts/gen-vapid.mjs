// node scripts/gen-vapid.mjs -> VAPID_PUBLIC_KEY (uncompressed P-256 point, base64url) and VAPID_PRIVATE_KEY (d, base64url).
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64u = (b) => Buffer.from(b).toString('base64url');
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}\nVAPID_PRIVATE_KEY=${jwk.d}`);
