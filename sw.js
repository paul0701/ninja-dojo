/* Ninja Dojo service worker: cache the shell for offline play; never cache the API. */
const VERSION = 'nd-v2-' + (new URL(self.location.href).searchParams.get('v') || '1');
const CORE = ['/', '/index.html', '/game.js', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const FONT_CACHE = 'nd-fonts';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== FONT_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // leaderboard POSTs go straight to the network
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/.netlify')) return;

  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith((async () => {
      const c = await caches.open(FONT_CACHE), hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch { return Response.error(); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try { const res = await fetch(req); if (res.ok) c.put('/index.html', res.clone()); return res; }
      catch { return (await c.match('/index.html')) || (await c.match('/')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(VERSION), hit = await c.match(req);
    if (hit) return hit;
    try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
    catch { return Response.error(); }
  })());
});
