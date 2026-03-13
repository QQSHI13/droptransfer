const CACHE_NAME = 'droptransfer-v1';
const urlsToCache = [
  './',
  './index.html'
];

// Track if this is a hard reload (cache bypass)
let isHardReload = false;

// Check for cache-busting headers or conditions that indicate a hard reload
self.addEventListener('install', (event) => {
  // Detect hard reload by checking if the install was triggered with cache bypass
  const cacheBust = Date.now();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Cache URLs directly - versioning is handled by CACHE_NAME
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Always skip waiting for immediate activation
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    }).then(() => {
      // Notify all clients that the service worker has updated
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: CACHE_NAME,
            timestamp: Date.now()
          });
        });
      });
    })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Skip waiting to activate immediately
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'HARD_RELOAD') {
    // Mark as hard reload - clear caches to ensure fresh content
    isHardReload = true;
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => caches.delete(name))
        );
      }).then(() => {
        // Notify client that caches are cleared
        if (event.source) {
          event.source.postMessage({
            type: 'CACHE_CLEARED',
            timestamp: Date.now()
          });
        }
      })
    );
  }
  
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    // Force a check for updates
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached response if found
        if (response) {
          // For navigation requests, also fetch fresh version in background
          if (event.request.mode === 'navigate') {
            const updateCache = fetch(event.request).then(fetchResponse => {
              if (fetchResponse.ok) {
                return caches.open(CACHE_NAME).then(cache => {
                  return cache.put(event.request, fetchResponse.clone());
                });
              }
            }).catch(() => {
              // Ignore network errors for background fetch
            });
            event.waitUntil(updateCache);
          }
          return response;
        }
        
        // Fetch from network
        return fetch(event.request).then((fetchResponse) => {
          // Don't cache non-successful responses
          if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
            return fetchResponse;
          }
          
          // Clone the response for caching
          const responseToCache = fetchResponse.clone();
          const cachePromise = caches.open(CACHE_NAME).then((cache) => {
            return cache.put(event.request, responseToCache);
          });
          event.waitUntil(cachePromise);
          
          return fetchResponse;
        });
      })
      .catch(() => {
        // Fallback for offline
        if (event.request.mode === 'navigate') {
          return caches.match('./');
        }
      })
  );
});

// Listen for push messages (for future expansion)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    self.registration.showNotification(data.title || 'DropTransfer', {
      body: data.body || 'New update available',
      icon: './icon.png',
      badge: './badge.png',
      data: data
    });
  }
});
