/// <reference lib="webworker" />
// Only build-produced static files can enter this cache. Never intercept cross-origin
// requests or cache API responses, images fetched from Storage, or user data.
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };
const manifest = self.__WB_MANIFEST;
const paths = [...new Set(manifest.map(e => new URL(e.url, self.location.origin).pathname))];
const version = manifest.map(e => e.revision ?? e.url).join('|');
const CACHE = 'payindex-static-' + hash(version);
function hash(s: string) { let h = 0; for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return h.toString(36); }
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(paths))); });
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('payindex-static-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;
  // Navigation always returns the public app shell; its query string is never cached.
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match('/index.html')) ?? fetch(request)));
  } else if (!url.search && paths.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) ?? fetch(request)));
  }
});
export {};
