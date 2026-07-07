/*
  service-worker.js
  ------------------------------------------------------------
  GITHUB PAGES ONLY. Not usable on Blogger (Blogger doesn't let you serve a
  file at your domain root with the scope a service worker needs).

  Strategy:
  - Cache-first for the static app shell (HTML/CSS/JS/icons) so repeat
    visits and offline loads work.
  - Network-only for anything going to espn.com or another API host — we
    never want to show cached (stale/misleading) live scores.
  - No backend involved: this only manages the browser's own Cache Storage.

  Update the CACHE_NAME (bump the version suffix) whenever you change the
  list of cached files, so old caches get cleaned up automatically.
------------------------------------------------------------ */

const CACHE_NAME = "bs4k-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/assets/css/github-enhancements.css",
  "/assets/js/github-enhancements.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // If a shell file 404s during install, don't hard-fail the whole worker.
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — live scores must always come from the network.
  const isApiHost = /(^|\.)espn\.com$/.test(url.hostname) || /(^|\.)scorebat\.com$/.test(url.hostname);
  if (isApiHost || event.request.method !== "GET") {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // App shell: cache-first, falling back to network, then updating the cache.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
