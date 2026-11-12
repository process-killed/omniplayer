/* OmniPlay service worker — generated 2026-11-09T04:51:26.961Z */
const VERSION = 'omniplay-mw8sad0t';
const PRECACHE = [
  "./",
  "./index.html",
  "./assets/engine-dash-DjAG7qgI.js",
  "./assets/engine-hls-CfwCUrIF.js",
  "./assets/engine-webcodecs-CtTuyH-T.js",
  "./assets/index-CQFKZtrx.js",
  "./assets/naming-DoQgVYzv.js",
  "./assets/style-CrLYjMvq.css",
  "./assets/webComponent-B39ScaCg.js",
  "./favicon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./manifest.webmanifest",
  "./robots.txt",
  "./screenshot-narrow.png",
  "./screenshot-wide.png",
  "./vendor/webtorrent.min.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // Cache what we can; a single 404 must not break installation.
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      // First install activates immediately; updates wait for the user.
      if (!self.registration.active) await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;

  // Navigations: network first so a new build is picked up, cache as fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) || (await caches.match('./')) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone())).catch(() => undefined);
          })
          .catch(() => undefined);
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok && ['script', 'style', 'image', 'font'].includes(request.destination)) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
