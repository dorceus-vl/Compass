// The web side of Compass's native shells (Phase 4): iPhone/iPad/Android (Capacitor, mobile/) and the Mac (Tauri, mac/).
// The page is the same one a browser gets, so nothing from @capacitor/* or @tauri-apps/* is bundled: the shells inject
// `window.Capacitor` (plugin CompassNative) or `window.__TAURI_INTERNALS__` / `window.__TAURI__` (withGlobalTauri), and this file
// calls them. In a browser none of that exists and every function here does nothing. The contract the native side implements:
//
//   Capacitor plugin CompassNative (iOS and Android)        args                          result
//     signIn          system sheet / Custom Tab               { url, callbackScheme }       { url }  (the callback URL; reject with code "cancelled" if the user closes it)
//     registerPush    ask permission, return the token        {}                            { kind: 'apns'|'fcm', token, env? } | { unsupported: true } | { denied: true }
//     takeSharedText  the text a share left; clears it        {}                            { text: string | null }
//     openExternal    open in the system browser              { url }                       {}
//     updateWidgets   v2.3 (W2, A3): write the widget          { json }                      {}  (json is the snapshot text, at most 64 KB, written atomically; iOS: into the app group with
//                     snapshot, redraw the widgets                                                file protection completeUntilFirstUserAuthentication; Android: the app's private files dir;
//                                                                                                 '' removes it; rejects with code "too_big")
//     setWidgetToken  v2.3 (W6, A5): the widget's tick token   { token: string | null }      {}  (iOS: a Keychain item shared with the widget extension; Android: sealed under an Android
//                                                                                                 Keystore key; null deletes it; the page never stores it)
//     takeWidgetTicks v2.3: ticks a widget queued offline      {}                            { ticks: { id, at }[] }  (pending-ticks.json, cleared as it is read)
//     event sharedText { text }       event notificationTap { url }
//   Tauri (Mac): command open_external { url }; command notify_permission → 'granted' | 'denied'; event compass-auth { url } (payload);
//     command notify { title, body, url } (a banner; the page reads GET /api/push/outbox, ruling N3); command close_quick_add
//
// The native side refuses any sign-in url not on id.knocturnlabs.com and any callbackScheme other than `compass`.
import { api, deviceId, SignedOut } from './api.ts';

export type Shell = 'ios' | 'android' | 'mac';
type Json = Record<string, unknown>;
interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise?: (plugin: string, method: string, options: object) => Promise<unknown>;
  nativeCallback?: (plugin: string, method: string, options: object, cb: (data: any) => void) => unknown;
  Plugins?: { CompassNative?: Record<string, ((...a: any[]) => any) | undefined> };
}
interface TauriGlobals {
  __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: object) => Promise<unknown> };
  __TAURI__?: { event?: { listen: (name: string, cb: (e: { payload: any }) => void) => Promise<() => void> } };
}
const g = () => globalThis as unknown as { Capacitor?: CapacitorBridge } & TauriGlobals;

export function shell(): Shell | null {
  const c = g().Capacitor;
  if (c?.isNativePlatform?.()) { const p = c.getPlatform?.(); return p === 'ios' || p === 'android' ? p : null; }
  return g().__TAURI_INTERNALS__ ? 'mac' : null;
}

/** What this device is called to the person: "This iPhone", "This Mac". The platform is what /api/push/device records. */
export function nativeDevice(sh = shell(), ua = navigator.userAgent, touch = navigator.maxTouchPoints): { platform: 'ios' | 'ipados' | 'android' | 'mac'; label: string } | null {
  if (sh === 'android') return { platform: 'android', label: 'Android device' };
  if (sh === 'mac') return { platform: 'mac', label: 'Mac' };
  if (sh !== 'ios') return null;
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1) ? { platform: 'ipados', label: 'iPad' } : { platform: 'ios', label: 'iPhone' };
}

// ---- Sign-in: Knocturn ID's own page in the system sheet, PKCE, code back at compass://auth ----
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32))); // 43 characters
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge, state: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

export function signInUrl(o: { challenge: string; state: string; deviceId: string; deviceName: string; platform: string }): string {
  const q = new URLSearchParams({ app: 'compass', redirect_uri: 'compass://auth', code_challenge: o.challenge, code_challenge_method: 'S256', state: o.state, device_id: o.deviceId, device_name: o.deviceName, platform: o.platform });
  return `https://id.knocturnlabs.com/?${q}`;
}

/** The one-time code in the callback url, or an error to show. Only compass://auth (no other host or path) with our state counts; an `error=` answer (Knocturn ID refused or the user said no) is treated like a closed sheet. */
export function callbackCode(back: unknown, state: string): string {
  let u: URL | null = null;
  try { u = new URL(String(back)); } catch { /* not a url */ }
  if (!u || u.protocol !== 'compass:' || u.host !== 'auth' || (u.pathname !== '' && u.pathname !== '/') || u.searchParams.get('state') !== state) throw new Error('Sign-in didn’t finish. Try again.');
  if (u.searchParams.has('error')) throw Object.assign(new Error('Sign-in was cancelled.'), { code: 'cancelled' }); // the page ignores a message matching /cancel/i
  const code = u.searchParams.get('code');
  if (!code) throw new Error('Sign-in didn’t finish. Try again.');
  return code;
}

const cap = () => { const c = g().Capacitor; return c?.isNativePlatform?.() ? c : undefined; };
const callCap = (method: string, args: object = {}): Promise<any> => {
  const c = cap()!;
  const fn = c.Plugins?.CompassNative?.[method];
  if (fn) return Promise.resolve(fn.call(c.Plugins!.CompassNative, args));
  return c.nativePromise ? (c.nativePromise('CompassNative', method, args) as Promise<any>) : Promise.reject(new Error('This app build can’t do that yet.'));
};
const invoke = (cmd: string, args: object = {}) => g().__TAURI_INTERNALS__!.invoke(cmd, args);

async function tauriSignIn(url: string): Promise<string> {
  const listen = g().__TAURI__?.event?.listen;
  if (!listen) throw new Error('This app build can’t sign in yet.');
  let done!: (u: string) => void;
  const got = new Promise<string>((r) => { done = r; });
  const off = await listen('compass-auth', (e) => done(String(e.payload?.url ?? ''))); // listening before the browser opens, so the callback can't be missed
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await invoke('open_external', { url });
    return await Promise.race([got, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('Sign-in didn’t finish. Try again.')), 10 * 60_000); })]);
  } finally { off(); clearTimeout(timer); }
}

/** Signs in through Knocturn ID, trades the code for the session cookie, and reloads signed in. Throws a message to show; a closed sheet throws one matching /cancel/i. */
export async function nativeSignIn(): Promise<void> {
  const sh = shell();
  const dev = nativeDevice(sh);
  if (!sh || !dev) throw new Error('Not in the app.');
  const p = await pkce();
  const url = signInUrl({ challenge: p.challenge, state: p.state, deviceId: deviceId(), deviceName: `Compass · ${dev.label} app`, platform: sh });
  const back = sh === 'mac' ? await tauriSignIn(url) : (await callCap('signIn', { url, callbackScheme: 'compass' }))?.url;
  await api('/auth/native', { method: 'POST', json: { code: callbackCode(back, p.state), code_verifier: p.verifier } });
  location.replace('/');
}

// ---- Push ----
/** Asks permission (from a tap) and registers this device. `remember` gets the server's id for the device ('local' on the Mac, which reads the outbox instead). */
export async function registerNativePush(remember: (id: string) => void = () => {}): Promise<'granted' | 'denied' | 'unsupported'> {
  const sh = shell();
  const dev = nativeDevice(sh);
  if (!sh || !dev) return 'unsupported';
  if (sh === 'mac') {
    if ((await invoke('notify_permission')) !== 'granted') return 'denied';
    remember('local');
    return 'granted';
  }
  const r = (await callCap('registerPush')) as Json | null;
  if (r?.denied) return 'denied';
  if (!r || r.unsupported || (r.kind !== 'apns' && r.kind !== 'fcm') || typeof r.token !== 'string') return 'unsupported';
  const body: Json = { kind: r.kind, token: r.token, platform: dev.platform, device_name: `${dev.label} app` };
  if (r.kind === 'apns') body.env = r.env;
  remember((await api<{ id: string }>('/push/device', { method: 'POST', json: body })).id);
  return 'granted';
}

// ---- Shared text -> quick add ----
/** A shared text or URL as a task: the first line (120 characters at most) is the title; a URL in it also goes in the notes. */
export function sharedToQuickAdd(text: string): { title: string; notes: string | null } {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const url = text.match(/https?:\/\/[^\s<>]+/)?.[0].replace(/[).,;!?]+$/, '') ?? null;
  return { title: first.slice(0, 120).trim(), notes: url };
}

// ---- Widgets (v2.3: iPhone, iPad and Android) ----
export const inWidgetShell = () => { const s = shell(); return s === 'ios' || s === 'android'; };
/** Hands the widget snapshot (JSON text, at most 64 KB; '' removes it) to the shell. Resolves false when there is no phone or tablet shell or the shell refused it; never throws. */
export async function updateWidgets(json: string): Promise<boolean> {
  if (!inWidgetShell() || json.length > 64 * 1024) return false; // ponytail: characters, not bytes; the snapshot is capped far below and native re-checks the bytes
  try { await callCap('updateWidgets', { json }); return true; } catch { return false; }
}
/** Keeps (or with null removes) the widget's tick token in the shell's Keychain. Rejects when the shell can't store it, so the caller can say so. */
export async function setWidgetToken(token: string | null): Promise<void> {
  if (!inWidgetShell()) throw new Error('Widgets are only in the iPhone, iPad and Android apps.');
  await callCap('setWidgetToken', { token });
}
/** The ticks a widget couldn't send (no network), oldest first; empty outside the phone and tablet shells. */
export async function takeWidgetTicks(): Promise<{ id: string; at: string }[]> {
  if (!inWidgetShell()) return [];
  try {
    const r = (await callCap('takeWidgetTicks')) as { ticks?: unknown } | null;
    return Array.isArray(r?.ticks) ? r.ticks.filter((t): t is { id: string; at: string } => !!t && typeof (t as any).id === 'string' && typeof (t as any).at === 'string') : [];
  } catch { return []; }
}

// ---- Links ----
const HOME = 'compass.knocturnlabs.com';
/** What a click on a link does in a shell: open in the system browser, move inside Compass (a deep link or a new-tab link to Compass), or nothing special. */
export function linkAction(href: string, target: string | null | undefined, here: string): { to: 'external'; url: string } | { to: 'path'; path: string } | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') return { to: 'external', url: href };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.host !== here && u.host !== HOME) return { to: 'external', url: u.href };
  if (u.pathname.startsWith('/api/') || (u.host === here && target !== '_blank')) return null;
  return { to: 'path', path: u.pathname + u.search + u.hash };
}

/** Where a notification tap or a universal link goes: a Compass URL (or a path) opens in place with its ?search#hash; /api and other schemes go nowhere. */
export function tapAction(url: string, base: string, here: string): ReturnType<typeof linkAction> {
  try { return linkAction(new URL(url, base).href, '_blank', here); } catch { return null; }
}

export function openExternal(url: string): void {
  if (!/^(https?:|mailto:|tel:)/.test(url)) return;
  const sh = shell();
  if (sh === 'mac') void invoke('open_external', { url }).catch(() => {});
  else if (sh) callCap('openExternal', { url }).catch(() => window.open(url, '_blank', 'noopener'));
  else window.open(url, '_blank', 'noopener');
}

// ---- Mac: banners from the outbox (ruling N3) and the quick-add window ----
const SINCE = 'compass.outbox.since';
const getSince = () => { try { return localStorage.getItem(SINCE); } catch { return null; } };
const setSince = (v: string) => { try { localStorage.setItem(SINCE, v); } catch { /* private mode */ } };
/** One outbox read: each new item becomes a banner. Notifications off, or the first read, only moves `since` to now (no backlog).
 *  Returns false when the session is gone (401): the caller stops polling. */
export async function pollOutbox(on: boolean, now = () => new Date().toISOString()): Promise<boolean> {
  const since = getSince();
  if (!on || !since) { setSince(now()); return true; }
  try {
    const { items } = await api<{ items: { at: string; title: string; body: string; url: string | null }[] }>(`/push/outbox?since=${encodeURIComponent(since)}`);
    for (const it of items) { await invoke('notify', { title: it.title, body: it.body, url: it.url ?? '/' }).catch(() => {}); setSince(it.at); }
  } catch (e) { if (e instanceof SignedOut) return false; } // offline or a server error: try again next minute
  return true;
}

/** A passkey step-up that can't run in the Mac app (no WebAuthn there, or it refused: NotAllowedError) continues in the browser.
 *  iPhone, iPad, Android and browsers keep their own passkey. */
export function stepUpInBrowser(err: unknown, sh = shell(), webauthn = typeof PublicKeyCredential !== 'undefined'): boolean {
  return sh === 'mac' && (!webauthn || (err as { name?: string } | null)?.name === 'NotAllowedError');
}

/** The Mac's quick-add window (`/?quickadd=1`) closes itself after a save or Escape. */
export function closeQuickAdd(): void {
  if (shell() === 'mac') void invoke('close_quick_add').catch(() => {});
}

function listenCap(name: string, cb: (data: any) => void) {
  const c = cap()!;
  const add = c.Plugins?.CompassNative?.addListener;
  if (add) void Promise.resolve(add.call(c.Plugins!.CompassNative, name, cb)).catch(() => {});
  else c.nativeCallback?.('CompassNative', 'addListener', { eventName: name }, cb);
}

/** Text shared to the app (a share sheet) and notification taps, plus link handling; on the Mac, banners from the outbox every minute
 *  while `notifyOn()` (the Settings switch). Does nothing outside a shell. Returns the stop function. */
export function startShell(h: { onSharedText: (text: string) => void; onPath: (path: string) => void; notifyOn?: () => boolean }): () => void {
  const sh = shell();
  if (!sh) return () => {};
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented || a.hasAttribute('download')) return;
    const act = linkAction(a.href, a.target, location.host);
    if (!act) return;
    e.preventDefault();
    if (act.to === 'external') openExternal(act.url); else h.onPath(act.path);
  };
  document.addEventListener('click', onClick);
  const tap = (url: string) => { const act = tapAction(url, location.href, location.host); if (act?.to === 'path') h.onPath(act.path); else if (act?.to === 'external') openExternal(act.url); };
  let stop = () => {};
  if (sh !== 'mac') {
    const take = () => callCap('takeSharedText').then((r) => { if (r?.text) h.onSharedText(r.text); }).catch(() => {});
    const onShow = () => { if (document.visibilityState === 'visible') void take(); }; // iOS keeps a share in the app group until the app is next in front
    listenCap('sharedText', (d) => { if (d?.text) h.onSharedText(String(d.text)); });
    listenCap('notificationTap', (d) => { if (d?.url) tap(String(d.url)); });
    document.addEventListener('visibilitychange', onShow);
    void take();
    stop = () => document.removeEventListener('visibilitychange', onShow);
  } else {
    const poll = () => void pollOutbox(h.notifyOn?.() ?? false).then((go) => { if (!go) clearInterval(timer); });
    const timer = setInterval(poll, 60_000);
    poll();
    stop = () => clearInterval(timer);
  }
  return () => { document.removeEventListener('click', onClick); stop(); };
}
