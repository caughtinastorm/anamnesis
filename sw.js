/** Release-consistent app shell; updates activate after existing tabs close. */
importScripts('./precache-manifest.js');
const CACHE_NAME = `anamnesis-${self.APP_RELEASE}`;
const ASSETS = new Set(self.APP_ASSETS.map(asset => new URL(asset, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(self.APP_ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('anamnesis-') && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode !== 'navigate' && !ASSETS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      const shell = await cache.match(new URL('./index.html', self.registration.scope));
      if (shell) return shell;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try { return await fetch(request); }
    catch { return new Response('Offline. Reconnect once to install this release.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
