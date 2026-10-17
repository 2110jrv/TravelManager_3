const CACHE = 'av2-shell-guia-voz-001c';
const SHELL = ['./', './index.html', './style.css', './app.js', './config.js', './domain.js','./budget-chart.js','./content.js','./event-detail.js', './store.js', './google.js', './google-auth.js', './google-provider.js', './sync.js','./calendar-refresh.js','./devices.js','./pin-auth.js','./fx.js','./fx-reference.js','./format.js','./visual.js','./itinerary.js','./day-cities.js','./event-cities.js','./day-pin-schedule.js','./manual-refresh.js','./item-times.js','./place-guide.js','./guide-voice.js','./pin-identity.js','./places.js','./location.js','./location-cache.js','./map.js','./poi.js','./map-ux.js','./offline-documents.js','./vendor/leaflet.js','./vendor/leaflet.css','./assets/italia.jpg','./assets/venezia.jpg','./assets/bernina.jpg','./assets/lucca.jpg','./assets/firenze.jpg','./assets/amalfi.jpg','./assets/roma.jpg','./assets/credits.json', './manifest.webmanifest', '../vendor/supabase-client.mjs','../vendor/qrcode-generator.mjs', '../assets/tm3-icon-192.png', '../assets/tm3-icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await Promise.all(SHELL.map(async path => { const canonical=new URL(path,self.location.href),fresh=new URL(canonical);fresh.searchParams.set('av2-shell',CACHE);const response=await fetch(new Request(fresh,{cache:'reload'}));if(!response.ok)throw Error('SHELL_DOWNLOAD_FAILED');await cache.put(canonical,response); }));
 // Activate only after the complete shell is cached; existing tabs reload on controllerchange.
 await self.skipWaiting();
})()));
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
