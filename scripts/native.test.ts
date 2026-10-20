// node --experimental-strip-types scripts/native.test.ts
// The web side of the native shells: PKCE, the sign-in URL, shared text, links, and the sign-in / push flows against a stubbed shell.
import assert from 'node:assert/strict';
import { pkce, signInUrl, callbackCode, sharedToQuickAdd, linkAction, shell, nativeDevice, nativeSignIn, registerNativePush } from '../web/src/native.ts';

const g = globalThis as any;
const set = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });

// pkce
const b64u = (b: ArrayBuffer) => Buffer.from(b).toString('base64url');
const p = await pkce();
assert.match(p.verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
assert.equal(p.challenge, b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.verifier))));
assert.match(p.state, /^[A-Za-z0-9_-]{16,}$/);
assert.notEqual((await pkce()).verifier, p.verifier);

// signInUrl
assert.equal(
  signInUrl({ challenge: 'CH', state: 'ST', deviceId: 'dev-1', deviceName: 'Compass · iPhone app', platform: 'ios' }),
  'https://id.knocturnlabs.com/?app=compass&redirect_uri=compass%3A%2F%2Fauth&code_challenge=CH&code_challenge_method=S256&state=ST&device_id=dev-1&device_name=Compass+%C2%B7+iPhone+app&platform=ios');

// callbackCode: scheme, state and code all checked
assert.equal(callbackCode('compass://auth?code=abc&state=S', 'S'), 'abc');
assert.throws(() => callbackCode('compass://auth?code=abc&state=X', 'S'));
assert.throws(() => callbackCode('compass://auth?state=S', 'S'));
assert.throws(() => callbackCode('https://evil.test/?code=abc&state=S', 'S'));
assert.throws(() => callbackCode(undefined, 'S'));
assert.equal(callbackCode('compass://auth/?code=abc&state=S', 'S'), 'abc');
assert.throws(() => callbackCode('compass://anything?code=abc&state=S', 'S'), /didn’t finish/, 'wrong host');
assert.throws(() => callbackCode('compass://auth/extra?code=abc&state=S', 'S'), /didn’t finish/, 'wrong path');
assert.throws(() => callbackCode('compass://auth.evil?code=abc&state=S', 'S'), /didn’t finish/);
assert.throws(() => callbackCode('compass://auth?error=access_denied&state=S', 'S'), /cancel/i, 'an error answer is a closed sheet');
assert.throws(() => callbackCode('compass://auth?error=access_denied&code=abc&state=S', 'S'), /cancel/i);
assert.throws(() => callbackCode('compass://auth?error=access_denied&state=X', 'S'), /didn’t finish/, 'state is still checked first');

// sharedToQuickAdd
assert.deepEqual(sharedToQuickAdd('Call the dentist'), { title: 'Call the dentist', notes: null });
assert.deepEqual(sharedToQuickAdd('  \n Read this \nmore text'), { title: 'Read this', notes: null });
assert.deepEqual(sharedToQuickAdd('Great article\nhttps://example.com/a?b=1.'), { title: 'Great article', notes: 'https://example.com/a?b=1' });
assert.deepEqual(sharedToQuickAdd('https://example.com/x'), { title: 'https://example.com/x', notes: 'https://example.com/x' });
assert.equal(sharedToQuickAdd('x'.repeat(300)).title.length, 120);
assert.deepEqual(sharedToQuickAdd(''), { title: '', notes: null });

// linkAction
const H = 'compass.knocturnlabs.com';
assert.deepEqual(linkAction('https://example.com/a', '_blank', H), { to: 'external', url: 'https://example.com/a' });
assert.deepEqual(linkAction('https://id.knocturnlabs.com/', '', H), { to: 'external', url: 'https://id.knocturnlabs.com/' });
assert.deepEqual(linkAction('mailto:a@b.co', '', H), { to: 'external', url: 'mailto:a@b.co' });
assert.equal(linkAction('https://compass.knocturnlabs.com/board', '', H), null, 'same host, no target: the page handles it');
assert.deepEqual(linkAction('https://compass.knocturnlabs.com/projects/1?x=2#t', '_blank', H), { to: 'path', path: '/projects/1?x=2#t' });
assert.deepEqual(linkAction('https://compass.knocturnlabs.com/library/x', '', 'localhost:8790'), { to: 'path', path: '/library/x' }, 'a deep link while COMPASS_URL points at a dev server');
assert.equal(linkAction('https://compass.knocturnlabs.com/api/documents/1/file', '_blank', H), null);
assert.equal(linkAction('javascript:alert(1)', '', H), null);
assert.equal(linkAction('compass://auth?code=1', '', H), null);

// Browser: nothing happens
assert.equal(shell(), null);
assert.equal(nativeDevice(), null);
assert.equal(await registerNativePush(), 'unsupported');

// A stubbed iPhone shell
const store = new Map<string, string>();
set('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
set('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 });
const calls: { plugin: string; method: string; args: any }[] = [];
let reply: (method: string, args: any) => any = () => ({});
set('Capacitor', {
  isNativePlatform: () => true, getPlatform: () => 'ios',
  nativePromise: async (plugin: string, method: string, args: any) => { calls.push({ plugin, method, args }); return reply(method, args); },
});
const posts: { url: string; body: any }[] = [];
let status = 200;
set('fetch', async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: status < 300, status, json: async () => (status < 300 ? { ok: true, id: 'srv-1' } : { error: 'invalid_grant', message: 'That sign-in expired. Try again.' }) }; });
let replaced = '';
set('location', { replace: (u: string) => { replaced = u; }, host: H });

assert.equal(shell(), 'ios');
assert.deepEqual(nativeDevice(), { platform: 'ios', label: 'iPhone' });
assert.deepEqual(nativeDevice('ios', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5), { platform: 'ipados', label: 'iPad' });

// nativeSignIn: opens Knocturn ID's url, checks state, trades the code with the verifier, reloads
reply = (method, args) => {
  assert.equal(method, 'signIn');
  assert.equal(args.callbackScheme, 'compass');
  const q = new URL(args.url).searchParams;
  assert.equal(new URL(args.url).origin, 'https://id.knocturnlabs.com');
  assert.equal(q.get('redirect_uri'), 'compass://auth');
  assert.equal(q.get('platform'), 'ios');
  return { url: `compass://auth?code=ONE&state=${q.get('state')}` };
};
await nativeSignIn();
assert.equal(posts[0].url, '/api/auth/native');
assert.equal(posts[0].body.code, 'ONE');
assert.match(posts[0].body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
assert.equal(replaced, '/');
assert.equal(new URL(calls[0].args.url).searchParams.get('code_challenge'), b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(posts[0].body.code_verifier))));

// a wrong state is refused before anything is sent; a server refusal shows its message
replaced = '';
posts.length = 0;
reply = () => ({ url: 'compass://auth?code=ONE&state=WRONG' });
await assert.rejects(nativeSignIn(), /didn’t finish/);
assert.equal(posts.length, 0);
reply = (_m, a) => ({ url: `compass://auth?code=ONE&state=${new URL(a.url).searchParams.get('state')}` });
status = 401;
await assert.rejects(nativeSignIn(), /expired/);
assert.equal(replaced, '');
status = 200;
// a callback carrying error= is silent too, and nothing is posted
posts.length = 0;
reply = (_m, a) => ({ url: `compass://auth?error=access_denied&state=${new URL(a.url).searchParams.get('state')}` });
await assert.rejects(nativeSignIn(), /cancel/i);
assert.equal(posts.length, 0);
// a closed sheet is the native side's rejection, passed up for the page to ignore
reply = () => { throw Object.assign(new Error('The user cancelled.'), { code: 'cancelled' }); };
await assert.rejects(nativeSignIn(), /cancel/i);

// registerNativePush
posts.length = 0;
let remembered = '';
reply = () => ({ kind: 'apns', token: 'a'.repeat(64), env: 'development' });
assert.equal(await registerNativePush((id) => { remembered = id; }), 'granted');
assert.deepEqual(posts[0], { url: '/api/push/device', body: { kind: 'apns', token: 'a'.repeat(64), platform: 'ios', device_name: 'iPhone app', env: 'development' } });
assert.equal(remembered, 'srv-1');
reply = () => ({ denied: true });
assert.equal(await registerNativePush(), 'denied');
reply = () => ({ unsupported: true });
assert.equal(await registerNativePush(), 'unsupported');

// Android: fcm carries no env
set('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)', maxTouchPoints: 5 });
set('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android', nativePromise: async () => ({ kind: 'fcm', token: 'f'.repeat(100), env: 'x' }) });
posts.length = 0;
assert.equal(await registerNativePush(), 'granted');
assert.deepEqual(posts[0].body, { kind: 'fcm', token: 'f'.repeat(100), platform: 'android', device_name: 'Android device app' });

// The Mac: Tauri; permission only, nothing to register
delete g.Capacitor;
set('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 });
let perm = 'granted';
set('__TAURI_INTERNALS__', { invoke: async (cmd: string) => (cmd === 'notify_permission' ? perm : undefined) });
assert.equal(shell(), 'mac');
posts.length = 0;
assert.equal(await registerNativePush((id) => { remembered = id; }), 'granted');
assert.equal(remembered, 'local');
assert.equal(posts.length, 0);
perm = 'denied';
assert.equal(await registerNativePush(), 'denied');
// Mac sign-in: opens the browser, waits for compass-auth
const sent: string[] = [];
let fire!: (e: { payload: { url: string } }) => void;
set('__TAURI_INTERNALS__', { invoke: async (cmd: string, a: any) => { sent.push(cmd); if (cmd === 'open_external') queueMicrotask(() => fire({ payload: { url: `compass://auth?code=MAC&state=${new URL(a.url).searchParams.get('state')}` } })); } });
set('__TAURI__', { event: { listen: async (name: string, cb: any) => { assert.equal(name, 'compass-auth'); fire = cb; return () => {}; } } });
posts.length = 0;
await nativeSignIn();
assert.deepEqual(sent, ['open_external']);
assert.equal(posts[0].body.code, 'MAC');
console.log('native: ok');
