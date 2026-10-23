// node --experimental-strip-types scripts/native.test.ts
// The web side of the native shells: PKCE, the sign-in URL, shared text, links, and the sign-in / push flows against a stubbed shell.
import assert from 'node:assert/strict';
import { updateWidgets, setWidgetToken, takeWidgetTicks, inWidgetShell, pkce, signInUrl, callbackCode, sharedToQuickAdd, linkAction, tapAction, shell, nativeDevice, nativeSignIn, registerNativePush, pollOutbox, stepUpInBrowser } from '../web/src/native.ts';

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

// tapAction: notification taps and universal links keep ?search#hash
const B = 'https://compass.knocturnlabs.com/today';
assert.deepEqual(tapAction('https://compass.knocturnlabs.com/list?q=due:overdue#top', B, H), { to: 'path', path: '/list?q=due:overdue#top' });
assert.deepEqual(tapAction('/list?q=due:overdue', B, H), { to: 'path', path: '/list?q=due:overdue' }, 'a path from the push payload');
assert.deepEqual(tapAction('https://compass.knocturnlabs.com/meetings/1?x=1', 'http://localhost:5173/', 'localhost:5173'), { to: 'path', path: '/meetings/1?x=1' }, 'a Compass URL on a local build');
assert.equal(tapAction('/api/export', B, H), null);
assert.equal(tapAction('javascript:alert(1)', B, H), null);

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

// Mac outbox (ruling N3): the first read and a switched-off read only move `since`; then each item is a banner; 401 stops
const banners: any[] = [];
set('__TAURI_INTERNALS__', { invoke: async (cmd: string, a: any) => { if (cmd === 'notify') banners.push(a); } });
const gets: string[] = [];
let outbox: { status: number; items?: any[] } = { status: 200, items: [] };
set('fetch', async (url: string) => { gets.push(url); return { ok: outbox.status < 300, status: outbox.status, json: async () => ({ items: outbox.items }) }; });
store.delete('compass.outbox.since');
assert.equal(await pollOutbox(true, () => '2026-10-20T10:00:00.000Z'), true);
assert.equal(gets.length, 0, 'no backlog on the first read');
assert.equal(store.get('compass.outbox.since'), '2026-10-20T10:00:00.000Z');
outbox = { status: 200, items: [{ at: '2026-10-20T10:00:30.000Z', title: 'Due soon', body: 'Call Bob', url: '/projects/1' }, { at: '2026-10-20T10:00:40.000Z', title: 'Compass', body: 'x', url: null }] };
assert.equal(await pollOutbox(true), true);
assert.equal(gets[0], '/api/push/outbox?since=2026-10-20T10%3A00%3A00.000Z');
assert.deepEqual(banners, [{ title: 'Due soon', body: 'Call Bob', url: '/projects/1' }, { title: 'Compass', body: 'x', url: '/' }]);
assert.equal(store.get('compass.outbox.since'), '2026-10-20T10:00:40.000Z');
assert.equal(await pollOutbox(false, () => '2026-10-20T11:00:00.000Z'), true);
assert.equal(gets.length, 1, 'switched off: no read');
assert.equal(store.get('compass.outbox.since'), '2026-10-20T11:00:00.000Z', 'turning it back on shows nothing older');
outbox = { status: 500 };
assert.equal(await pollOutbox(true), true, 'a server error keeps polling');
outbox = { status: 401 };
assert.equal(await pollOutbox(true), false, 'signed out stops');
// Passkey step-up in the Mac app: refused or unavailable → the browser; other shells and other errors keep their own path
assert.equal(stepUpInBrowser(Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'mac', true), true);
assert.equal(stepUpInBrowser(new TypeError('no WebAuthn'), 'mac', false), true);
assert.equal(stepUpInBrowser(Object.assign(new Error('x'), { name: 'AbortError' }), 'mac', true), false);
assert.equal(stepUpInBrowser(Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'ios', true), false);
assert.equal(stepUpInBrowser(Object.assign(new Error('x'), { name: 'NotAllowedError' }), null, false), false);
// Athena's mic in the shells (ruling A8): the plist keys and the Android permission, with the same sentence everywhere.
{
  const { readFileSync } = await import('node:fs');
  const why = '<key>NSMicrophoneUsageDescription</key>\n\t<string>Athena listens when you hold the mic.</string>';
  for (const f of ['mobile/ios/App/App/Info.plist', 'mac/src-tauri/Info.plist']) assert.ok(readFileSync(f, 'utf8').includes(why), `${f}: microphone purpose`);
  const manifest = readFileSync('mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.ok(manifest.includes('android.permission.RECORD_AUDIO') && manifest.includes('android.permission.MODIFY_AUDIO_SETTINGS'), 'Android mic permissions');
  assert.ok(!manifest.includes('android.permission.CAMERA'), 'no camera');
  assert.ok(readFileSync('mobile/android/app/src/main/java/com/knocturnlabs/compass/MainActivity.java', 'utf8').includes('CompassLink.mayCapture('), 'Android capture goes through CompassLink');
  assert.ok(readFileSync('mobile/ios/App/App/CompassViewController.swift', 'utf8').includes('CompassLink.mayCapture('), 'iOS capture goes through CompassLink');
}
// Widgets (v2.3): iOS and Android (Task 2b). In a browser or on the Mac they do nothing; in a phone or tablet shell they call the three plugin
// methods the Swift and Java sides declare.
{
  const { readFileSync } = await import('node:fs');
  delete g.__TAURI_INTERNALS__;
  assert.equal(inWidgetShell(), false);
  assert.equal(await updateWidgets('{"v":1}'), false, 'a browser: no-op');
  assert.deepEqual(await takeWidgetTicks(), []);
  await assert.rejects(setWidgetToken('x'.repeat(40)), /iPhone, iPad and Android/);
  set('__TAURI_INTERNALS__', { invoke: async () => { throw new Error('the Mac must not be called'); } });
  assert.equal(inWidgetShell(), false, 'the Mac has no widgets');
  assert.equal(await updateWidgets('{"v":1}'), false, 'Mac: no-op');
  delete g.__TAURI_INTERNALS__;
  const sent: { method: string; args: any }[] = [];
  let widgetReply: (m: string) => any = () => ({});
  set('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)', maxTouchPoints: 5 });
  set('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android', nativePromise: async (_p: string, method: string, args: any) => { sent.push({ method, args }); return widgetReply(method); } });
  assert.equal(inWidgetShell(), true, 'Android has widgets');
  assert.equal(await updateWidgets('{"v":1}'), true);
  assert.deepEqual(sent.pop(), { method: 'updateWidgets', args: { json: '{"v":1}' } }, 'Android: the snapshot goes to the Java side');
  await setWidgetToken(null);
  assert.deepEqual(sent.pop(), { method: 'setWidgetToken', args: { token: null } });
  widgetReply = () => ({ ticks: [{ id: 'a1', at: '2026-10-21T10:00:00Z' }] });
  assert.deepEqual(await takeWidgetTicks(), [{ id: 'a1', at: '2026-10-21T10:00:00Z' }]);
  widgetReply = () => ({});
  sent.length = 0;
  set('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios', nativePromise: async (_p: string, method: string, args: any) => { sent.push({ method, args }); return widgetReply(method); } });
  assert.equal(inWidgetShell(), true);
  assert.equal(await updateWidgets('{"v":1}'), true);
  assert.deepEqual(sent.pop(), { method: 'updateWidgets', args: { json: '{"v":1}' } });
  assert.equal(await updateWidgets(''), true, 'empty removes the file (signed out)');
  sent.length = 0;
  assert.equal(await updateWidgets('x'.repeat(64 * 1024 + 1)), false, 'over 64 KB is never sent');
  assert.equal(sent.length, 0);
  widgetReply = () => { throw Object.assign(new Error('too big'), { code: 'too_big' }); };
  assert.equal(await updateWidgets('{"v":1}'), false, 'a refusal does not throw');
  widgetReply = () => ({});
  await setWidgetToken('abcdefghijklmnopqrstuvwxyz0123456789-_AB');
  assert.deepEqual(sent.pop(), { method: 'setWidgetToken', args: { token: 'abcdefghijklmnopqrstuvwxyz0123456789-_AB' } });
  await setWidgetToken(null);
  assert.deepEqual(sent.pop(), { method: 'setWidgetToken', args: { token: null } });
  widgetReply = () => ({ ticks: [{ id: 't1', at: '2026-10-21T10:00:00Z' }, { id: 5 }, null, { id: 't2', at: '2026-10-21T10:01:00Z' }] });
  assert.deepEqual(await takeWidgetTicks(), [{ id: 't1', at: '2026-10-21T10:00:00Z' }, { id: 't2', at: '2026-10-21T10:01:00Z' }], 'only well-formed ticks');
  widgetReply = () => ({});
  assert.deepEqual(await takeWidgetTicks(), []);
  // The Swift side declares the same three methods, and the header documents them; the app's entitlements carry the shared Keychain group.
  const swift = readFileSync('mobile/ios/App/App/CompassNative.swift', 'utf8');
  for (const m of ['updateWidgets', 'setWidgetToken', 'takeWidgetTicks']) {
    assert.ok(swift.includes(`CAPPluginMethod(name: "${m}"`), `${m} is declared in CompassNative.swift`);
    assert.ok(swift.includes(`@objc func ${m}(`), `${m} is implemented`);
    assert.ok(readFileSync('web/src/native.ts', 'utf8').includes(`//     ${m}`), `${m} is in the native.ts header`);
  }
  // The Java side declares the same three, and the Android widgets keep the rules (A1-A6): no new dependency, nothing exported that needn't be,
  // immutable PendingIntents, ticks only to a Compass server through WidgetUrls, the token sealed under a Keystore key.
  const java = readFileSync('mobile/android/app/src/main/java/com/knocturnlabs/compass/CompassNativePlugin.java', 'utf8');
  for (const m of ['updateWidgets', 'setWidgetToken', 'takeWidgetTicks']) {
    assert.ok(new RegExp(`@PluginMethod\\s+public void ${m}\\(PluginCall call\\)`).test(java), `${m} is declared in CompassNativePlugin.java`);
    assert.ok(java.includes(` *   ${m}(`), `${m} is in the Java header`);
  }
  const wdir = 'mobile/android/app/src/main/java/com/knocturnlabs/compass/widgets/';
  const providers = readFileSync(wdir + 'WidgetProviders.java', 'utf8'), tick = readFileSync(wdir + 'TickReceiver.java', 'utf8');
  for (const src of [providers, tick]) {
    assert.ok(!src.includes('FLAG_MUTABLE'), 'no mutable PendingIntent');
    for (const m of src.matchAll(/PendingIntent\.get(?:Activity|Broadcast)\([^;]*;/g)) assert.ok(m[0].includes('FLAG_IMMUTABLE'), `immutable: ${m[0]}`);
  }
  assert.ok(tick.includes('WidgetUrls.doneUrl(') && !/new URL\("http/.test(tick), 'ticks go only to the URL WidgetUrls builds');
  // The tick goes over WidgetUrls.post (a plain socket: no HttpURLConnection, so Capacitor's process-wide CookieHandler can't add the session).
  const urls = readFileSync(wdir + 'WidgetUrls.java', 'utf8');
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/HttpsURLConnection\.getDefaultHostnameVerifier/g, '');
  for (const src of [tick, urls, providers]) assert.ok(!/HttpURLConnection|openConnection\(|CookieHandler|CookieManager/.test(code(src)), 'no HttpURLConnection or cookie store on the tick path');
  assert.ok(tick.includes('WidgetUrls.post(') && tick.includes('HttpsURLConnection.getDefaultHostnameVerifier()'), 'the tick verifies the host name');
  assert.ok(/f\.get\(8, TimeUnit\.SECONDS\)/.test(tick) && tick.includes('IN_FLIGHT'), 'one deadline per tick; the same task is never ticked twice at once');
  assert.ok(providers.includes('am.setWindow(AlarmManager.RTC,') && !/setExact|setAlarmClock|RTC_WAKEUP/.test(providers), 'midnight: one inexact alarm, no wake-up');
  const token = readFileSync(wdir + 'WidgetToken.java', 'utf8');
  assert.ok(token.includes('"AndroidKeyStore"') && token.includes('BLOCK_MODE_GCM') && token.includes('"compass_widget_token"'), 'token sealed under a Keystore AES-GCM key');
  assert.ok(token.includes('.setKeySize(256)') && !token.includes('setUserAuthenticationRequired') && !token.includes('setRandomizedEncryptionRequired'), 'AES-256, no user auth, a fresh IV every time');
  assert.ok(token.indexOf('.remove(KEY).commit()') < token.indexOf('keystore()', token.indexOf('public static synchronized void set')), 'the sealed token is removed before the Keystore is touched');
  const manifest = readFileSync('mobile/android/app/src/main/AndroidManifest.xml', 'utf8');
  for (const k of ['TodaySmall', 'TodayMedium', 'TodayLarge', 'QuickAdd', 'AskAthena', 'ProjectPulse', 'Week']) {
    assert.ok(new RegExp(`<receiver android:name="\\.widgets\\.WidgetProviders\\$${k}"[^>]*android:exported="false"`).test(manifest), `${k} provider declared, not exported`);
  }
  assert.ok(/<receiver android:name="\.widgets\.TickReceiver" android:exported="false"/.test(manifest), 'tick receiver not exported');
  assert.ok(/<receiver android:name="\.widgets\.WidgetProviders\$Midnight" android:exported="false"/.test(manifest), 'midnight receiver not exported');
  assert.ok(!/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/.test(manifest), 'no exact-alarm permission');
  const { readdirSync } = await import('node:fs');
  const infos = readdirSync('mobile/android/app/src/main/res/xml').filter((f) => /^widget_.*_info\.xml$/.test(f));
  assert.equal(infos.length, 7, 'seven widgets');
  for (const f of infos) assert.ok(readFileSync(`mobile/android/app/src/main/res/xml/${f}`, 'utf8').includes('android:widgetCategory="home_screen"'), `${f}: Home Screen only (no lock screen)`);
  assert.equal([...providers.matchAll(/PendingIntent\.get(?:Activity|Broadcast)\(/g)].length + [...tick.matchAll(/PendingIntent\.getBroadcast\(/g)].length, 3, 'the three PendingIntent builders (open, tick, midnight) were checked');
  assert.ok(!/glance|androidx\.security/i.test(readFileSync('mobile/android/app/build.gradle', 'utf8')), 'no new Gradle dependency');
  assert.ok(readFileSync('mobile/ios/App/App/App.entitlements', 'utf8').includes('$(AppIdentifierPrefix)com.knocturnlabs.compass.shared'), 'keychain group in the app entitlements');
  assert.ok(readFileSync('mobile/ios/App/App/Info.plist', 'utf8').includes('<key>WidgetKeychainGroup</key>'), 'the app reads its Keychain group from Info.plist');
  assert.ok(!/NSFileProtectionNone|\.noFileProtection/.test(readFileSync('mobile/ios/App/App/WidgetStore.swift', 'utf8')) && readFileSync('mobile/ios/App/App/WidgetStore.swift', 'utf8').includes('.completeFileProtectionUntilFirstUserAuthentication'), 'snapshot file protection');
  // the hide-work switch must reach the widgets when it is saved (both platforms use this page code), not only at the next foreground
  const settings = readFileSync('web/src/views/Settings.tsx', 'utf8');
  assert.ok(/if \(patch\.widgets\) void writeWidgets\(\)/.test(settings) && settings.indexOf("method: 'PATCH', json: patch") < settings.indexOf('writeWidgets().catch'), 'Settings rewrites the widget snapshot right after a widgets setting saves');
  assert.ok(/export async function writeWidgets/.test(readFileSync('web/src/widgets.ts', 'utf8')), 'the writer is exported');
}
console.log('native: ok');
