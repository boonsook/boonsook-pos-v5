// ═══════════════════════════════════════════════════════════
// boot.js — Loading overlay + Service Worker registration/update banner
// ═══════════════════════════════════════════════════════════
// แยกออกมาเป็น external file เพื่อ drop CSP 'unsafe-inline' script (Phase 89.15)
// ของเดิมอยู่ใน index.html line 867-973 (inline script)
// ═══════════════════════════════════════════════════════════

// ═══ Loading Overlay ═══
function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 500);
  }
}
// Auto-hide after auth check (max 4s fallback)
setTimeout(hideLoadingOverlay, 4000);
// Listen for app ready event from main.js
window.addEventListener('bsk-app-ready', hideLoadingOverlay);

// ═══ Service Worker + Update Banner ═══
(function () {
  if (!('serviceWorker' in navigator)) return;

  function showUpdateBanner(reg) {
    // Avoid duplicate banners
    if (document.getElementById('swUpdateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'swUpdateBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9000;background:#0f172a;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;gap:12px;font-size:14px;max-width:92vw';
    banner.innerHTML = '<span>🔄 มีเวอร์ชันใหม่ — คลิกเพื่อใช้งาน</span>'
      + '<button type="button" id="swUpdateApply" style="background:#0284c7;color:#fff;border:none;padding:6px 14px;border-radius:8px;font-weight:600;cursor:pointer">อัปเดตเลย</button>'
      + '<button type="button" id="swUpdateLater" aria-label="ภายหลัง" style="background:transparent;color:#cbd5e1;border:none;padding:6px 8px;cursor:pointer;font-size:18px">✕</button>';
    document.body.appendChild(banner);
    document.getElementById('swUpdateApply').addEventListener('click', function () {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
    document.getElementById('swUpdateLater').addEventListener('click', function () {
      banner.remove();
    });
  }

  // ★ Phase 29: เช็ค build number จริงก่อนขึ้น banner — กัน false alarm
  // (SW updatefound บางครั้งยิงเพราะ Cloudflare ส่ง sw.js byte ต่างเล็กน้อย แต่ build เดียวกัน)
  async function isReallyNewBuild() {
    try {
      var script = document.querySelector('script[src*="main.js"]');
      var currentBuild = script && script.src.match(/v=(\d+)/);
      currentBuild = currentBuild ? Number(currentBuild[1]) : null;
      if (!currentBuild) return true; // can't compare = assume yes (safer)
      var r = await fetch('./index.html?_=' + Date.now(), { cache: 'no-store' });
      var html = await r.text();
      var m = html.match(/main\.js\?v=(\d+)/);
      var newBuild = m ? Number(m[1]) : null;
      if (!newBuild) return true;
      return newBuild > currentBuild; // strict greater — เท่ากับไม่ใช่ update
    } catch (e) {
      console.warn('[update check] build compare failed:', e);
      return false; // ผิดพลาด = อย่าเด้ง banner เปล่าๆ
    }
  }

  async function maybeShowBanner(reg) {
    if (await isReallyNewBuild()) showUpdateBanner(reg);
  }

  function watchForUpdate(reg) {
    // Case 1: a waiting worker is already there at register-time
    if (reg.waiting && navigator.serviceWorker.controller) {
      maybeShowBanner(reg);
    }
    // Case 2: update appears later
    reg.addEventListener('updatefound', function () {
      const newSw = reg.installing;
      if (!newSw) return;
      newSw.addEventListener('statechange', function () {
        if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
          maybeShowBanner(reg);
        }
      });
    });
  }

  // Reload once the new SW takes control (single reload guard)
  // ★ Phase 28: ใช้ location.replace + cache-bust query เพื่อ bypass HTTP cache
  // (location.reload() ปกติไม่ bust HTTP cache บน iOS Safari + PWA)
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloaded) return;
    reloaded = true;
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('_t', String(Date.now()));
      window.location.replace(u.toString());
    } catch (e) {
      window.location.href = window.location.pathname + '?_t=' + Date.now();
    }
  });

  // Phase 90.11: kick reg.update() periodically and on tab visibility change so
  // long-lived sessions don't sit on an old build until the user reloads. We
  // never reload here — we just trigger the SW update check; the existing
  // watchForUpdate() → updatefound → showUpdateBanner() flow still owns the UX.
  function startPeriodicUpdate(reg) {
    var SW_UPDATE_INTERVAL_MS = 10 * 60 * 1000; // 10 min
    setInterval(function () {
      try { reg.update().catch(function () {}); } catch (e) { /* ignore */ }
    }, SW_UPDATE_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      try { reg.update().catch(function () {}); } catch (e) { /* ignore */ }
    });
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      console.log('SW registered:', reg.scope);
      watchForUpdate(reg);
      startPeriodicUpdate(reg);
    }).catch(function (err) {
      console.log('SW registration failed:', err);
    });
  });
})();
