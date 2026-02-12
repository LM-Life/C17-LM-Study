// Bump this when you want to force all clients to update
const CACHE_VERSION = 'v12.32';  // <-- change this to a new value on each major update
const CACHE_NAME = `c17-study-cache-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './questions.json',
  './questions_mc.json',
  './manifest.json',
  './service-worker.js'
];

self.addEventListener("message", (event) => {
  if (event.data === "GET_CACHE_VERSION") {
    event.source.postMessage({
      type: "CACHE_VERSION",
      cache: CACHE_NAME,
    });
  }
  
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

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

// Fetch: cache-first for most assets, but network-first for questions.json
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Always bypass cache for the SW file itself
  if (url.pathname.endsWith('service-worker.js')) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-first for questions.json so your MQF updates propagate
  if (url.pathname.endsWith('questions.json')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return networkRes;
        })
        .catch(() => caches.match(req)) // if offline, fall back to cached
    );
    return;
  }

  // Network-first for questions_mc.json so MC updates propagate
  if (url.pathname.endsWith('questions_mc.json')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return networkRes;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Default: cache-first
  event.respondWith(
    caches.match(req).then((cacheRes) => {
      return (
        cacheRes ||
        fetch(req).then((networkRes) => {
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
