const CACHE = 'compass-v1'; // placeholder: vite.config.ts stamps a fresh name into dist/sw.js at every build
// Clone before the page reads the body: cloning later (inside the cache.open callback) throws and nothing gets cached.
const keep = (req, r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; };
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest']).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api') || e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate' || url.pathname === '/') {
    e.respondWith(fetch(e.request).then((r) => keep('/', r)).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname === '/library.json') { // network first so a new build shows at once; the last copy keeps search working offline
    e.respondWith(fetch(e.request).then((r) => keep(e.request, r)).catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => keep(e.request, r))));
  }
});
// Web Push: the Worker sends {title, body, url, tag}. A message is data: it only ever becomes notification text.
self.addEventListener('push', (e) => {
  let m = { title: 'Compass', body: '', url: '/' };
  try { m = { ...m, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(String(m.title || 'Compass'), { body: String(m.body || ''), tag: m.tag ? String(m.tag) : undefined, data: { url: m.url }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' }));
});
// Only same-origin paths are ever opened; anything else (another site, a bad value) becomes '/'.
const safeUrl = (raw) => {
  try { const u = new URL(String(raw || '/'), self.location.origin); return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/'; } catch { return '/'; }
};
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const path = safeUrl(e.notification.data && e.notification.data.url);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.location.origin));
    if (!open) return self.clients.openWindow(path);
    return open.focus().then((c) => (c || open).navigate(path)).catch(() => self.clients.openWindow(path));
  }));
});
