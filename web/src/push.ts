import { api } from './api.ts';

export type PushState = 'unsupported' | 'home-screen' | 'blocked' | 'on' | 'off';
const ID_KEY = 'compass.push.id';
const store = {
  get: () => { try { return localStorage.getItem(ID_KEY); } catch { return null; } },
  set: (v: string | null) => { try { if (v) localStorage.setItem(ID_KEY, v); else localStorage.removeItem(ID_KEY); } catch { /* private mode */ } },
};

const ua = () => navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** iPhone/iPad Safari delivers Web Push only to a web app on the Home Screen (navigator.standalone is true there). */
export const needsHomeScreen = () => isIOS() && (navigator as Navigator & { standalone?: boolean }).standalone !== true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** "Safari on iPhone", "Chrome on Mac"... */
export function deviceName(): string {
  const u = ua();
  const dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) || isIOS() ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'this device';
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox|FxiOS/.test(u) ? 'Firefox' : /Chrome|CriOS/.test(u) ? 'Chrome' : isIOS() || /Safari/.test(u) ? 'Safari' : 'Browser';
  return `${br} on ${dev}`;
}

export async function pushState(): Promise<PushState> {
  if (needsHomeScreen()) return 'home-screen';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

const keyBytes = (b64u: string) => {
  const raw = atob(b64u.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64u.length / 4) * 4, '='));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Call from a tap: the permission prompt only appears for a user gesture. Throws with a message to show when the server refuses. */
export async function enablePush(): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (needsHomeScreen() || !supported()) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const { publicKey } = await api<{ publicKey: string | null }>('/push/key');
  if (!publicKey) throw new Error('Notifications are not set up on the server yet');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const j = sub.toJSON();
  try {
    const { id } = await api<{ id: string }>('/push/subscribe', { method: 'POST', json: { endpoint: j.endpoint, keys: j.keys, device_name: deviceName() } });
    store.set(id);
  } catch (e) { await sub.unsubscribe().catch(() => {}); throw e; } // no half-on state: the browser and the server agree
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
  const id = store.get();
  store.set(null);
  if (id) await api(`/push/${id}`, { method: 'DELETE' }).catch(() => {}); // offline: the Devices list can remove it later
}

export const thisDeviceId = store.get;
export const forgetDevice = () => store.set(null);
