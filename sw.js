// Boonsook POS V5 Service Worker
// v262 (2026-05-20): Phase 92.6 hardening (3 review findings) — (1) loadHtml2Canvas dedupes concurrent callers via in-flight promise cache (no duplicate <script> on double-click Share); (2) syncAppLogo early-exits when stored logo URL already matches (no redundant boot repaint/setItem); (3) syncAppLogo strips CR/LF from accessToken before Authorization header (defense-in-depth). modules/lazy_libs.js + modules/branding.js only.
// v261 (2026-05-20): Phase 92.5 HOTFIX — html2canvas CDN (cdnjs.cloudflare.com) was blocked by production CSP → Share/PDF stuck on "กำลังสร้าง PDF..." forever. Switched HTML2CANVAS_CDN_URL to cdn.jsdelivr.net (CSP-allowed). Also: _appShareDoc now captures loadHtml2Canvas() result + on failure shows a toast and closes cleanly instead of hanging.
// v260 (2026-05-20): Phase 92.4 — Extracted html2canvas lazy loader _loadHtml2Canvas() from main.js to new modules/lazy_libs.js (loadHtml2Canvas). Resolve true/false contract preserved exactly; only addition is a logger.warn on CDN load failure (was silent). main.js keeps thin _loadHtml2Canvas() wrapper.
// v259 (2026-05-20): Phase 92.3 — Extracted Supabase Storage logo pull _appSyncLogo() from main.js to modules/branding.js (syncAppLogo). HARDENED: list fetch now has an AbortController timeout (default 8s; original had none = could hang) + failures logged via injected logger instead of swallowed. localStorage cache still serves logo on failure. window._appSyncLogo kept as thin wrapper binding config+token.
// v258 (2026-05-20): Phase 92.2 — Extracted logo source resolver getAppLogo() from main.js to modules/branding.js (zero-behavior refactor). Priority chain state.storeInfo.logoUrl > localStorage > default; state injected. window._appGetLogo kept as thin wrapper binding live state. _appSyncLogo still in main.js (couples to SUPABASE_CONFIG/token).
// v257 (2026-05-19): Phase 92.1 — Extracted updateAppLogos() from main.js to modules/branding.js (zero-behavior refactor). _appGetLogo / _appSyncLogo stay in main.js for now (couple to state/SUPABASE_CONFIG). Window.App + window.updateAppLogos contracts preserved via thin wrapper.
// v256 (2026-05-19): Phase 91.4 HOTFIX — refund/cancel reverse-loyalty wiring was gated on sale-row customer_id (opt-in column). Helper auto-resolves from earn record — removed the pre-check. Added diagnostic log so future smoke explains itself.
// v255 (2026-05-19): Phase 91.3 — Refund/cancel reverse loyalty auto-earn. Idempotent helper inserts type='redeem' + ref_type='sale_reverse'. Caps at remaining (no negative balance). Wired into modules/refunds.js (after JV post) and modules/sales.js soft-delete (alongside void JV + revert stock).
// v254 (2026-05-19): Phase 91.2 HOTFIX — earn formula was multiplying instead of dividing (500 baht at rate 100 = 50000 pts not 5). Centralized to calcEarnPoints(amount, settings) = floor(amount / bahtPerPoint).
// v266 (2026-05-21): Phase 92.10 CAPSTONE — extract boot orchestration to modules/boot.js via runBoot({...deps}) dependency injection. main.js is now side-effect-free (no self-invoking IIFE on load); boot.js does not import main.js (no circular). Decomposition series 92.1-92.10 COMPLETE.
// v265 (2026-05-20): Phase 92.9 — extract XHR/API data layer (refreshAccessToken/appAuthFetch/xhrPost/xhrPatch/xhrDelete) to modules/api.js via createApi factory (closure preserves single-flight + 401-retry recursion; 13 callers via window._app* wrappers; byte-identical)
// v264 (2026-05-20): Phase 92.8 — extract Thai-locale formatters (money/formatNumber/formatCurrency/formatDate/formatDateTime) to modules/utils.js (byte-identical; caller compat via import binding)
// v263 (2026-05-20): Phase 92.7 — extract _appShareDoc Share/PDF overlay to modules/share_doc.js (thin window wrapper; behavior byte-identical)
// v253 (2026-05-19): Phase 91.1 — POS checkout auto-earn loyalty points (fire-and-forget after sale insert; gated on customer + is_active + points_per_baht; amount = actualTotal)
// v252 (2026-05-19): Phase 90.13 — Loyalty history modal click-outside listener leak: bind once in renderLoyaltyPage instead of re-attach on every showPointHistory call
const CACHE_NAME = 'boonsook-pos-v5-cache-v269';
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
