// AES-256-GCM encrypt/decrypt via the standard Web Crypto API (no Node crypto module; runs identically in the
// Workers runtime and in Node 19+). Encrypts work rows and session tokens at rest in D1, keyed by the
// COMPASS_DATA_KEY secret (set once via `wrangler secret put`; see scripts/gen-secret.mjs).
//
// Format: "v2:" + base64(iv + ciphertext), key = HKDF-SHA256(secret, fixed salt, "aes-gcm-256/v2").
// "v2:a:" marks a value bound to its place with additional authenticated data (AAD): pass the same `context`
// (e.g. "tasks.title") to encrypt and decrypt. A value copied into another column then fails to decrypt
// instead of reading as that column's data.

const V2 = 'v2:';
const V2_AAD = 'v2:a:';
const enc = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Derived keys are cached per secret: deriving on every call was most of the cost of decrypting a list.
const v2Keys = new Map();

function deriveKeyV2(keyString) {
  if (!v2Keys.has(keyString)) {
    v2Keys.set(
      keyString,
      crypto.subtle
        .importKey('raw', enc.encode(keyString), 'HKDF', false, ['deriveKey'])
        .then((base) =>
          crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('knocturn-compass/field-encryption'), info: enc.encode('aes-gcm-256/v2') },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
          ),
        ),
    );
  }
  return v2Keys.get(keyString);
}

/**
 * @param {string} plaintext
 * @param {string} keyString
 * @param {string} [context] binds the value to its place, e.g. "tasks.title"
 * @returns {Promise<string>} safe to store in a TEXT column
 */
export async function encryptString(plaintext, keyString, context) {
  const key = await deriveKeyV2(keyString);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = context ? { name: 'AES-GCM', iv, additionalData: enc.encode(context) } : { name: 'AES-GCM', iv };
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(params, key, enc.encode(plaintext)));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return (context ? V2_AAD : V2) + toBase64(combined);
}

/**
 * @param {string} encoded value produced by encryptString()
 * @param {string} keyString
 * @param {string} [context] the same context it was encrypted with, if any
 * @returns {Promise<string>}
 */
export async function decryptString(encoded, keyString, context) {
  if (encoded.startsWith(V2_AAD)) {
    if (!context) throw new Error('decryptString: this value is bound to a context; pass it');
    return open(encoded.slice(V2_AAD.length), await deriveKeyV2(keyString), enc.encode(context));
  }
  if (encoded.startsWith(V2)) {
    // A context-bound column only ever gets context-bound values written to it; an unbound v2 value there was
    // copied in from elsewhere.
    if (context) throw new Error('decryptString: value is not bound to ' + context);
    return open(encoded.slice(V2.length), await deriveKeyV2(keyString));
  }
  throw new Error('decryptString: unknown format');
}

async function open(b64, key, additionalData) {
  const combined = fromBase64(b64);
  const params = additionalData ? { name: 'AES-GCM', iv: combined.slice(0, 12), additionalData } : { name: 'AES-GCM', iv: combined.slice(0, 12) };
  return new TextDecoder().decode(await crypto.subtle.decrypt(params, key, combined.slice(12)));
}

const indexKeys = new Map();
/**
 * A keyed, deterministic fingerprint of a value ("h:" + 32 hex chars), for the few encrypted fields the app must
 * still look up by equality (a name). Equal names give equal fingerprints; nothing else is revealed,
 * and without the secret a fingerprint can't be tested against a guessed value.
 * @param {string} value
 * @param {string} keyString
 * @param {string} purpose e.g. "name"
 */
export async function blindIndex(value, keyString, purpose) {
  const id = keyString + '\u0000' + purpose;
  if (!indexKeys.has(id)) {
    indexKeys.set(
      id,
      crypto.subtle
        .importKey('raw', enc.encode(keyString), 'HKDF', false, ['deriveKey'])
        .then((base) =>
          crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('knocturn-compass/blind-index'), info: enc.encode(purpose) },
            base,
            { name: 'HMAC', hash: 'SHA-256', length: 256 },
            false,
            ['sign'],
          ),
        ),
    );
  }
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await indexKeys.get(id), enc.encode(normalized)));
  return 'h:' + [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const isBlindIndex = (v) => typeof v === 'string' && /^h:[0-9a-f]{32}$/.test(v);
