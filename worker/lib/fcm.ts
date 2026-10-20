// Firebase push (Android): an OAuth access token from the service account (RS256 assertion, WebCrypto), then FCM HTTP v1.
// Ported from Hollow's notify.ts. A "notification" message, so Android shows it while the app is closed; data.url is what a tap opens.
import type { Env } from '../types.ts';
import { b64u, type PushMessage, type Sent } from './webpush.ts';

const te = new TextEncoder();
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
type Account = { client_email: string; private_key: string; project_id: string; token_uri?: string };
const account = (json: string): Account | null => {
  try { const a = JSON.parse(json); return a?.client_email && a?.private_key && a?.project_id ? a : null; } catch { return null; }
};

/** The signed assertion Google exchanges for an access token. */
export async function fcmJwt(serviceAccountJson: string, nowSec: number): Promise<string> {
  const a = account(serviceAccountJson);
  if (!a) throw new Error('bad service account');
  const der = Uint8Array.from(atob(a.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const part = (o: object) => b64u(te.encode(JSON.stringify(o)));
  const input = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: a.token_uri ?? TOKEN_URI, iat: nowSec, exp: nowSec + 3600 })}`;
  return `${input}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(input))))}`;
}

export function fcmRequest(projectId: string, accessToken: string, token: string, msg: PushMessage): { url: string; init: RequestInit } {
  const tag = msg.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return {
    url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    init: {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { url: msg.url }, android: { priority: 'high', notification: tag ? { tag } : {} } } }),
    },
  };
}

// Access tokens last an hour; one per isolate, renewed after 50 minutes.
let cached: { at: number; token: string; id: string } | null = null;
async function accessToken(json: string, a: Account, nowSec: number): Promise<string> {
  if (cached && cached.id === a.client_email && nowSec - cached.at < 50 * 60 && nowSec >= cached.at) return cached.token;
  const assertion = await fcmJwt(json, nowSec);
  const r = await fetch(a.token_uri ?? TOKEN_URI, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000),
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  const t = ((await r.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!r.ok || !t) throw new Error(`fcm oauth ${r.status}`);
  cached = { at: nowSec, token: t, id: a.client_email };
  return t;
}

/** One device (endpoint = its registration token). Sent; 404 / UNREGISTERED is gone; a missing or unusable service account is local. */
export async function sendFcm(env: Pick<Env, 'FCM_SERVICE_ACCOUNT'>, sub: { endpoint: string }, msg: PushMessage): Promise<Sent> {
  const a = env.FCM_SERVICE_ACCOUNT ? account(env.FCM_SERVICE_ACCOUNT) : null;
  if (!a) return 'local';
  if (!/^[A-Za-z0-9_:-]{20,4096}$/.test(sub.endpoint)) return 'gone'; // never a token Google would take
  let req: { url: string; init: RequestInit };
  try {
    req = fcmRequest(a.project_id, await accessToken(env.FCM_SERVICE_ACCOUNT!, a, Math.floor(Date.now() / 1000)), sub.endpoint, msg);
  } catch {
    console.error('[push] fcm cannot sign or get a token');
    return 'local';
  }
  try {
    const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return 'sent';
    const status = ((await r.json().catch(() => ({}))) as { error?: { status?: string } }).error?.status;
    if (r.status === 404 || status === 'UNREGISTERED') return 'gone';
    console.error(`[push] fcm answered ${r.status} ${status ?? ''}`);
    return 'failed';
  } catch (e) {
    console.error(`[push] fcm send threw: ${(e as Error).name}`);
    return 'failed';
  }
}
