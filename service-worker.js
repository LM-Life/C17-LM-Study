// Bump this when you want to force all clients to update
const CACHE_VERSION = 'v3';
const CACHE_NAME = `c17-study-cache-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './questions.json',
  './manifest.json'
];

// Install: cache core assets and take control ASAP
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // new SW activates immediately
});

// Activate: clear out old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim(); // start controlling existing pages right away
});

// Fetch: cache-first for static assets, but network-first for questions.json
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Always bypass cache for the service worker file itself
  if (url.pathname.endsWith('service-worker.js')) {
    event.respondWith(fetch(req));
    return;
  }

  // For questions.json, try network first so question bank updates propagate
  if (url.pathname.endsWith('questions.json')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return networkRes;
        })
        .catch(() => caches.match(req)) // fallback to cache if offline
    );
    return;
  }

  // Default: cache-first for other assets
  event.respondWith(
    caches.match(req).then((cacheRes) => {
      return (
        cacheRes ||
        fetch(req).then((networkRes) => {
          // Optionally cache new GET responses for same-origin only
          if (networkRes.ok && url.origin === location.origin) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
      );
    })
  );
});
