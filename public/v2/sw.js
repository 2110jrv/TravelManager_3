const CACHE = 'av2-shell-calendar-refresh-151c';
const SHELL = ['./', './index.html', './style.css', './app.js', './config.js', './domain.js', './store.js', './google.js', './google-auth.js', './sync.js','./calendar-refresh.js','./devices.js','./fx.js','./format.js','./visual.js','./assets/italia.jpg','./assets/venezia.jpg','./assets/bernina.jpg','./assets/lucca.jpg','./assets/firenze.jpg','./assets/amalfi.jpg','./assets/roma.jpg','./assets/credits.json', './manifest.webmanifest', '../vendor/supabase-client.mjs','../vendor/qrcode-generator.mjs', '../assets/tm3-icon-192.png', '../assets/tm3-icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('av2-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache private Google/Supabase responses. IndexedDB owns record and document persistence.
  const allowed = SHELL.map(path => new URL(path, self.location.href).href);
  if (!allowed.includes(url.href) && !url.pathname.startsWith(new URL('./', self.location.href).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') {
      try { return await fetch(event.request); } catch { return await cache.match('./index.html'); }
    }
    return await cache.match(event.request) || fetch(event.request);
  })());
});
