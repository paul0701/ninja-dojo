const VERSION = 'nd-' + (new URL(self.location.href).searchParams.get('v') || 'dev');
const CORE = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const FONT_CACHE = 'nd-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== FONT_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'CACHE_URLS' && Array.isArray(d.urls)) {
    e.waitUntil((async () => {
      const c = await caches.open(VERSION), f = await caches.open(FONT_CACHE);
      await Promise.all(d.urls.map(async (u) => {
        try {
          const isFont = u.includes('fonts.g');
          const target = isFont ? f : c;
          if (await target.match(u)) return;
          const res = await fetch(u, isFont ? { mode: 'cors' } : {});
          if (res.ok) await target.put(u, res);
        } catch (err) { /* ignore */ }
      }));
    })());
  }
});

const hashed = (p) => /\.[0-9a-f]{8,}\.(js|css|chunk\.js|chunk\.css)$/.test(p);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith((async () => {
      const c = await caches.open(FONT_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; } catch (err) { return Response.error(); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.includes('hot-update') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/sockjs')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try { const res = await fetch(req); if (res.ok) c.put('/index.html', res.clone()); return res; }
      catch (err) { return (await c.match('/index.html')) || (await c.match('/')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    if (hashed(url.pathname)) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
    catch (err) { return (await c.match(req, { ignoreSearch: true })) || Response.error(); }
  })());
});
