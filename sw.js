// Boonsook POS V5 Service Worker
// v250 (2026-05-19): Phase 90.11 — boot.js periodic + visibilitychange SW update (long sessions no longer sit on old build until manual reload). No auto-reload added — banner UX unchanged.
// v249 (2026-05-19): Phase 90.10 — Loyalty customer_id type mismatch: cast both sides to String() (bigint DB vs select.value string)
// v248 (2026-05-19): Phase 90.9 — Loyalty manual redeem clear-form regression: redeemPoints/earnPoints now return {ok,error}; manual tab clears form only on r?.ok
// v247 (2026-05-19): Phase 90.8 — Loyalty XHR helper signatures: earn/redeem/manual-earn now use 'loyalty_points' table + Promise pattern (was 404 + ignored callback)
// v246 (2026-05-19): Phase 90.7 — Hotfix dynamic-import ESM cache (build 245 deployed but in-memory ESM registry kept old parsed modules — append ?v=APP_BUILD to import() URLs)
const CACHE_NAME = 'boonsook-pos-v5-cache-v250';
const OFFLINE_PAGE = './index.html';

// Files to pre-cache on install (only essential files)
// Phase 89.18: เพิ่ม CSS ที่ index.html อ้างถึง — เดิม offline สไตล์พังเพราะ precache ตก
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './phase4-design-system.css',
  './phase4-components.css',
  './doc-print.css',
  './main.js',
  './boot.js',
  './selfheal.js',
  './manifest.json',
  './icons/logo.svg'
];

// Install event: pre-cache core files (with graceful error handling)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ✅ Cache files individually (don't fail on missing file)
      return Promise.allSettled(
        PRECACHE_URLS.map(url => {
          return cache.add(url).catch(err => {
            console.warn(`Cache failed for ${url}:`, err.message);
            return null;
          });
        })
      );
    }).catch((error) => {
      console.error('Cache init error:', error);
    })
  );
  // Note: no auto-skipWaiting — client sends SKIP_WAITING after user clicks update banner
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: implement Network First with Cache Fallback strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // ★ Skip non-http(s) requests (เช่น chrome-extension://) ที่ cache ไม่ได้
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // API requests: Network only (don't cache)
  if (url.pathname.includes('/rest/v1/') || url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // If offline and no network, return error response
          return new Response(
            JSON.stringify({ error: 'Offline - API not available' }),
            { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // ★ Phase 34: JS modules + ai-chat-widget — bypass HTTP cache (cache: 'reload')
  // เหตุผล: import URLs ไม่มี ?v= → browser cache by URL → stale ตลอดถ้า _headers เป็น immutable
  // ใช้ cache: 'reload' บังคับ browser ดึงจาก network ทุกครั้ง (revalidate ETag)
  if (url.origin === self.location.origin && (url.pathname.startsWith('/modules/') || url.pathname === '/ai-chat-widget.js')) {
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match(request).then(r => r || new Response('Module unavailable offline', { status: 503 })))
    );
    return;
  }

  // CDN resources: Cache first
  if (isCdnResource(url.hostname)) {
    event.respondWith(
      caches.match(request)
        .then((response) => {
          if (response) {
            return response;
          }
          return fetch(request).then((response) => {
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
            return response;
          });
        })
        .catch(() => {
          return new Response('CDN resource not available', { status: 503 });
        })
    );
    return;
  }

  // Local assets: Network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request)
          .then((response) => {
            if (response) {
              return response;
            }
            // Offline fallback for HTML pages
            if (request.mode === 'navigate') {
              return caches.match(OFFLINE_PAGE);
            }
            return new Response('Resource not available offline', { status: 503 });
          });
      })
  );
});

// Helper function to detect CDN resources
function isCdnResource(hostname) {
  const cdnDomains = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'cdn.skypack.dev',
    'esm.sh',
    'cdn.plot.ly',
    'code.jquery.com',
    'maxcdn.bootstrapcdn.com'
  ];
  return cdnDomains.some((domain) => hostname.includes(domain));
}

// Message handling for cache control
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});
