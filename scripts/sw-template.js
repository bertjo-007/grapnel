/*
 * Service Worker für Grapnel – macht die App offline nutzbar.
 * Wird beim Build aus dieser Vorlage erzeugt (vite.config.ts → sw.js).
 *
 * - Installation: alle gebauten Dateien werden gespeichert.
 * - Seitenaufrufe: zuerst Netz (neueste Version), ohne Netz die gespeicherte App.
 * - Dateien: aus dem Speicher (gehashte Namen ändern sich nie).
 * - /api/ (Sync) läuft immer über das Netz und wird nie gespeichert.
 *
 * Ein neuer Worker übernimmt NICHT automatisch: Mitten in einer Lernsitzung soll
 * die App nicht unter den Händen neu laden. Die App zeigt einen Hinweis und
 * schickt erst auf Wunsch SKIP_WAITING.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `grapnel-${VERSION}`;
const NAV_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('grapnel-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      withTimeout(fetch(request), NAV_TIMEOUT_MS)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/', { ignoreVary: true }).then((hit) => hit || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
