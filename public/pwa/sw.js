const CACHE_NAME = 'travelmanager3-cache-v9';
const TILE_CACHE_NAME = 'travelmanager3-tiles-v1';
const APP_SCOPE = new URL('../', self.location.href).href;
const SUPABASE_HOST = 'cslludzuejkhsydqiabx.supabase.co';
const NETWORK_ONLY_HOSTS = new Set([SUPABASE_HOST, 'esm.sh']);
const ASSET_PATHS = [
  '',
  'index.html',
  'manifest.webmanifest',
  'styles/base.css',
  'styles/layout.css',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-shadow.png',
  'src/app2.js',
  'src/supabaseClient.js',
  'src/syncSupabase.js',
  'src/db.js',
  'src/italyAdapter.js',
  'data/italy-2026.json'
];
const ASSETS = ASSET_PATHS.map(path => new URL(path, APP_SCOPE).href);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== TILE_CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (NETWORK_ONLY_HOSTS.has(url.hostname) || url.hostname.endsWith('.supabase.co')) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(request, TILE_CACHE_NAME, true));
    return;
  }

  if (request.mode === 'navigate' && url.href.startsWith(APP_SCOPE)) {
    event.respondWith(networkFirst(request, new URL('index.html', APP_SCOPE).href));
    return;
  }

  if (url.href.startsWith(APP_SCOPE)) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
  }
});

async function cacheFirst(request, cacheName, allowEmptyFallback = false) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_error) {
    if (allowEmptyFallback) return new Response('', { status: 504, statusText: 'Unavailable offline' });
    throw _error;
  }
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_error) {
    return cache.match(request).then(cached => cached || cache.match(fallbackUrl));
  }
}
