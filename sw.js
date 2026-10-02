/* Türkiye 2026 · service worker. VERSION and ASSETS are stamped by build/build_v2.py. */
const VERSION = '20261002-204623';
const ASSETS = [
 "./",
 "./index.html",
 "./styles.css",
 "./app.js",
 "./assistant.js",
 "./ai.js",
 "./intake.js",
 "./cloud.js",
 "./voice.js",
 "./pdfgen.js",
 "./icons-v2.js",
 "./manifest.webmanifest",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon-maskable-512.png",
 "./icons/apple-touch-icon.png",
 "./icons/favicon-32.png",
 "./vendor/pdf.min.mjs",
 "./vendor/pdf.worker.min.mjs",
 "./vendor/jspdf.umd.min.js",
 "./vendor/jspdf.plugin.autotable.min.js",
 "./vendor/pdf-fonts.js",
 "./vault/vault.json",
 "./version.json",
 "./vault/755b7fd9b0d30b0d.enc",
 "./vault/2fec9ffecdd2eb75.enc",
 "./vault/145b8e68aa0740dc.enc",
 "./vault/8ea4fdb19c5a945d.enc",
 "./vault/e9fa6cedef0f2ef1.enc",
 "./vault/9879a6f2f22a6c27.enc",
 "./vault/0dfc8971ec63a534.enc",
 "./vault/8441039298c5edf4.enc",
 "./vault/60be068a934a4601.enc",
 "./vault/5e6b89e0a90ed9a3.enc",
 "./vault/fc92ac8bf9922a5b.enc",
 "./vault/a96e80dd069345cf.enc",
 "./vault/cd37dcbc7046cbdd.enc",
 "./vault/16b84a4cf74898e0.enc",
 "./vault/46e9fe3cd2f5f0ea.enc",
 "./vault/047c7f5dc1d8244c.enc",
 "./vault/7f1f1eb51c2eac74.enc",
 "./vault/5503c5a3c5902422.enc",
 "./vault/e73f84a9398438e1.enc",
 "./vault/ab34fbe453409ab7.enc",
 "./vault/70ae34a43bb61273.enc",
 "./vault/de71d75d0f3cfcee.enc",
 "./vault/b94b16575f0c5483.enc",
 "./vault/83fd1ec4c2c94826.enc",
 "./vault/c7a4ed6a59771315.enc",
 "./vault/74499be884a07ad2.enc",
 "./vault/c1d7092d3dd62f1d.enc",
 "./vault/2bffbe3e7d0ac2c8.enc"
];
const CACHE = `tr26-${VERSION}`;
const IMMUTABLE = /\/vault\/[0-9a-f]{16}\.enc$/;                 // content-addressed: safe to keep forever
const FRESH = /\/(index\.html|app\.js|assistant\.js|ai\.js|intake\.js|cloud\.js|voice\.js|pdfgen\.js|icons-v2\.js|styles\.css|manifest\.webmanifest|version\.json|vault\/vault\.json)$|\/$/;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (u) => {
      try {
        const abs = new URL(u, self.location).href;
        if (IMMUTABLE.test(abs)) { const old = await caches.match(abs); if (old) { await c.put(abs, old); return; } }
        const r = await fetch(new Request(abs, { cache: 'reload' }));
        if (r.ok) await c.put(abs, r);
      } catch (_) { /* one missing file never blocks the install */ }
    }));
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Android "Share → Türkiye": keep the files until the app is unlocked (GitHub Pages itself cannot take a POST)
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) { e.respondWith(takeShare(req)); return; }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || FRESH.test(url.pathname)) { e.respondWith(networkFirst(req, url)); return; }
  e.respondWith(cacheFirst(req));
});

async function networkFirst(req, url) {
  const c = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const fresh = await fetch(key + url.search, { cache: 'no-store', signal: ctrl.signal, credentials: 'same-origin' });
    clearTimeout(t);
    if (fresh.ok) await c.put(key, fresh.clone());
    return fresh;
  } catch (_) {
    const hit = (await c.match(key)) || (req.mode === 'navigate' ? (await c.match(new URL('./index.html', self.location).href)) || (await c.match(new URL('./', self.location).href)) : null);
    return hit || Response.error();
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) await c.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    return Response.error();
  }
}

async function takeShare(req) {
  try {
    const fd = await req.formData();
    const files = fd.getAll('files').filter(f => f && typeof f.arrayBuffer === 'function' && f.size > 0).slice(0, 5);
    const items = await Promise.all(files.map(async f => ({ name: f.name || 'shared', type: f.type || '', bytes: new Uint8Array(await f.arrayBuffer()) })));
    const db = await new Promise((res, rej) => { const r = indexedDB.open('tr26', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(items, 'inbox'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (_) { /* nothing to keep: the app simply opens */ }
  return Response.redirect(new URL('./#docs', self.registration.scope).href, 303);
}

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
