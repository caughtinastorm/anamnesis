/**
 * Service Worker for anamnesis PWA
 * Implements Network-First caching with offline fallback.
 */

const CACHE_NAME = "anamnesis-v32";
const FONT_CACHE_NAME = "anamnesis-fonts-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./fsrs.js",
  "./sync.js",
  "./anki.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/state.js",
  "./js/utils.js",
  "./js/ui.js",
  "./js/dashboard.js",
  "./js/study.js",
  "./js/import.js",
  "./js/settings.js",
  "./js/browser.js",
  "./js/explorer.js",
  "./js/explorer-state.js",
  "./js/explorer-actions.js",
  "./js/cards.js",
  "./js/picker.js"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("SW: Pre-caching static assets");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(name => {
        if (name !== CACHE_NAME && name !== FONT_CACHE_NAME) {
          console.log("SW: Deleting old cache:", name);
          return caches.delete(name);
        }
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Runtime cache for Google Fonts (both stylesheet and webfont files)
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res && res.status === 200) {
            cache.put(event.request, res.clone());
          }
          return res;
        } catch (e) {
          return cached || new Response("", { status: 408 });
        }
      })
    );
    return;
  }

  // Only handle local same-origin assets from here
  if (url.origin !== self.location.origin) return;

  // Stale-While-Revalidate for instant startup + background update
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(async () => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            const fallback = await caches.match("./index.html") || await caches.match("./");
            if (fallback) return fallback;
          }
          return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
        });

      return cached || fetchPromise;
    })
  );
});




