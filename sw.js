/* Türkiye 2026 · service worker. VERSION and ASSETS are stamped by build/build.py. */
const VERSION = '20260914-124521';
const ASSETS = [
 "./",
 "./index.html",
 "./styles.css",
 "./app.js",
 "./manifest.webmanifest",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-512.png",
 "./icons/apple-touch-icon.png",
 "./icons/favicon-32.png",
 "./vendor/pdf.min.mjs",
 "./vendor/pdf.worker.min.mjs",
 "./vault/manifest.json",
 "./vault/probe.enc",
 "./vault/content.enc",
 "./vault/hotel-antalya-concorde.enc",
 "./vault/hotel-istanbul-arise.enc",
 "./vault/hotel-istanbul-swissotel.enc",
 "./vault/flight-auh-ayt.enc",
 "./vault/flight-ayt-ist.enc",
 "./vault/flight-ist-dxb.enc",
 "./vault/itinerary-docx.enc"
];
const CACHE = `tr26-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // add one by one so a single 404 never blocks install
    await Promise.all(ASSETS.map(async (u) => { try { await c.add(new Request(u, { cache: 'reload' })); } catch (_) {} }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('tr26-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Shell files (html/js/css/manifest): network first so updates land; everything else cache first.
const NETWORK_FIRST = /\/(index\.html|app\.js|styles\.css|sw\.js|manifest\.webmanifest)$|\/$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (NETWORK_FIRST.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) c.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        const hit = await c.match(req, { ignoreSearch: true });
        return hit || (await c.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) c.put(req, fresh.clone());
      return fresh;
    } catch (_) {
      return Response.error();
    }
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
