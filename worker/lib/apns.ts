// Apple push (iPhone, iPad): token-based. An ES256 JWT signed with the .p8 key (team id as issuer), HTTP/2 POST per device token.
// Ported from Kelly-Cloud's apns.ts; the topic comes from APNS_TOPIC. WebCrypto's ECDSA signature is already r||s, as JWS wants.
import type { Env } from '../types.ts';
import { b64u, type PushMessage, type Sent } from './webpush.ts';

const te = new TextEncoder();
// Apple: a token is good for an hour and must not be made more than every 20 minutes. One per isolate, renewed after 40.
let cached: { jwt: string; at: number; keyId: string } | null = null;

export async function apnsJwt(keyP8: string, keyId: string, teamId: string, nowSec: number): Promise<string> {
  if (cached && cached.keyId === keyId && nowSec - cached.at < 40 * 60 && nowSec >= cached.at) return cached.jwt;
  const der = Uint8Array.from(atob(keyP8.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: object) => b64u(te.encode(JSON.stringify(o)));
  const input = `${part({ alg: 'ES256', kid: keyId })}.${part({ iss: teamId, iat: nowSec })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(input)));
  cached = { jwt: `${input}.${b64u(sig)}`, at: nowSec, keyId };
  return cached.jwt;
}

export function apnsRequest(token: string, env: 'development' | 'production', topic: string, msg: PushMessage, jwt: string): { url: string; init: RequestInit } {
  const host = env === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    'apns-topic': topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400), // a phone that's off gets it within a day, or not at all
    'content-type': 'application/json',
  };
  if (msg.tag) headers['apns-collapse-id'] = msg.tag.replace(/[^\x20-\x7e]/g, '').slice(0, 64);
  return { url: `https://${host}/3/device/${token}`, init: { method: 'POST', headers, body: JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, url: msg.url }) } };
}

type ApnsEnv = Pick<Env, 'APNS_KEY_P8' | 'APNS_KEY_ID' | 'APPLE_TEAM_ID' | 'APNS_TOPIC'>;

/** One device (endpoint = its hex token). 200 sent; 410, or 400 BadDeviceToken / DeviceTokenNotForTopic / Unregistered, is gone; a missing or unusable key is local (the secret's fault, not the device's). */
export async function sendApns(env: ApnsEnv, sub: { endpoint: string; env: string | null }, msg: PushMessage): Promise<Sent> {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APPLE_TEAM_ID || !env.APNS_TOPIC) return 'local';
  let req: { url: string; init: RequestInit };
  try {
    const jwt = await apnsJwt(env.APNS_KEY_P8, env.APNS_KEY_ID, env.APPLE_TEAM_ID, Math.floor(Date.now() / 1000));
    req = apnsRequest(sub.endpoint, sub.env === 'production' ? 'production' : 'development', env.APNS_TOPIC, msg, jwt);
  } catch {
    console.error('[push] apns cannot sign');
    return 'local';
  }
  try {
    const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(10_000) });
    if (r.status === 200) return 'sent';
    const reason = ((await r.json().catch(() => ({}))) as { reason?: string }).reason;
    if (r.status === 410 || (r.status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered'))) return 'gone';
    console.error(`[push] apns answered ${r.status} ${reason ?? ''}`);
    return 'failed';
  } catch (e) {
    console.error(`[push] apns send threw: ${(e as Error).name}`);
    return 'failed';
  }
}
