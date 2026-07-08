const CACHE_NAME = 'travelmanager3-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/base.css',
  './styles/layout.css',
  './src/app.js',
  './src/db.js',
  './src/ui.js',
  './src/italyAdapter.js',
  './data/italy-2026.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
