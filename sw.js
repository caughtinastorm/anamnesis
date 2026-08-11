/**
 * Service Worker for anamnesis PWA
 * Implements Network-First caching with offline fallback.
 */

const CACHE_NAME = "anamnesis-v22";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./sm2.js",
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
        if (name !== CACHE_NAME) {
          console.log("SW: Deleting old cache:", name);
          return caches.delete(name);
        }
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const fallback = await caches.match("./index.html") || await caches.match("./");
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
      })
  );
});




