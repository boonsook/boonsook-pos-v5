// ═══════════════════════════════════════════════════════════
// selfheal.js — Phase 35 cache recovery + APP_BUILD global setter
// ═══════════════════════════════════════════════════════════
// แยกออกมาเป็น external file เพื่อ drop CSP 'unsafe-inline' (Phase 89.15)
//
// อ่าน APP_BUILD จาก data-app-build="N" ของ script tag ปัจจุบัน
// แล้ว expose window.APP_BUILD เพื่อให้ main.js + modules อ่านได้ทั้งแอป
// (ก่อนหน้านี้ inline เป็น var APP_BUILD ใน IIFE → ไม่ leak global →
//  window.APP_BUILD always undefined → error_reporter build = null)
// ═══════════════════════════════════════════════════════════

// Phase 89.15a: read APP_BUILD synchronously BEFORE the async IIFE.
// document.currentScript can be null inside async functions on some browsers
// (engine continues parsing other scripts before the async first-tick runs).
// querySelector fallback guarantees we find the tag.
var __SCRIPT_TAG = document.currentScript || document.querySelector('script[data-app-build]');
var __APP_BUILD  = parseInt(__SCRIPT_TAG && __SCRIPT_TAG.dataset && __SCRIPT_TAG.dataset.appBuild || '0', 10);
window.APP_BUILD = __APP_BUILD;

(async function selfHeal() {
  try {
    var APP_BUILD = __APP_BUILD;
    var STUCK_BUILDS_BEFORE = 47; // builds before this มี immutable-cache bug
    var stored = parseInt(localStorage.getItem('bsk_app_build') || '0', 10);
    var justRecovered = sessionStorage.getItem('bsk_just_recovered') === '1';

    // เพิ่งทำ recovery ใน session นี้ → save build แล้วผ่าน
    if (justRecovered) {
      localStorage.setItem('bsk_app_build', String(APP_BUILD));
      return;
    }

    // ถ้า build เก่าก่อน fix หรือไม่เคยมี → recover เพื่อล้าง stale cache
    if (stored < STUCK_BUILDS_BEFORE) {
      console.warn('[selfHeal] stuck on old build ' + stored + ' → clearing all caches + reloading');
      sessionStorage.setItem('bsk_just_recovered', '1');

      // 1. Unregister ทุก SW
      if ('serviceWorker' in navigator) {
        try {
          var regs = await navigator.serviceWorker.getRegistrations();
          for (var i = 0; i < regs.length; i++) {
            try { await regs[i].unregister(); } catch(e){}
          }
        } catch(e) { console.warn('[selfHeal] SW fail', e); }
      }

      // 2. Delete ทุก cache (Cache API)
      if ('caches' in window) {
        try {
          var keys = await caches.keys();
          for (var j = 0; j < keys.length; j++) {
            try { await caches.delete(keys[j]); } catch(e){}
          }
        } catch(e) { console.warn('[selfHeal] caches fail', e); }
      }

      // 3. Hard reload bypass HTTP cache (cache-bust query)
      var u = new URL(window.location.href);
      u.searchParams.set('_t', String(Date.now()));
      window.location.replace(u.toString());
      return;
    }

    localStorage.setItem('bsk_app_build', String(APP_BUILD));
  } catch(e) {
    console.warn('[selfHeal] error', e);
  }
})();
