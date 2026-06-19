// ═══════════════════════════════════════════════════════════
//  Supabase data-access layer (extracted from main.js in Phase 92.9)
//
//  Token refresh (single-flight) + auth-fetch wrapper + XHR REST helpers.
//  Behavior byte-identical กับ main.js L177-390. window/config/token ถูก inject
//  ผ่าน createApi({ windowRef }) → closure เก็บ _refreshInflight + internal recursion;
//  main.js destructure ออกมาผูก window._app* wrappers เดิม → 13 callers ไม่แตะ
// ═══════════════════════════════════════════════════════════

export function createApi({ windowRef = typeof window !== "undefined" ? window : undefined } = {}) {
  // ═══════════════════════════════════════════════════════════
  //  Phase 89.2d: Access-token refresh — single-flight
  //  เมื่อ XHR/fetch ได้ 401 → trigger supabase.auth.refreshSession()
  //  → อัพเดท window._sbAccessToken → caller retry ครั้งเดียว
  //  Single-flight: ถ้ามี refresh อยู่ ทุก parallel call แชร์ promise เดียว
  // ═══════════════════════════════════════════════════════════
  let _refreshInflight = null;
  async function refreshAccessToken() {
    if (_refreshInflight) return _refreshInflight;
    _refreshInflight = (async () => {
      try {
        const sb = windowRef.App?.state?.supabase;
        if (!sb || !sb.auth) {
          console.warn("[token-refresh] no supabase client");
          return false;
        }
        const { data, error } = await sb.auth.refreshSession();
        if (error) {
          console.warn("[token-refresh] failed:", error.message);
          return false;
        }
        if (data?.session?.access_token) {
          // eslint-disable-next-line require-atomic-updates -- G: single-flight guard via _refreshInflight (Phase 89.13)
          windowRef._sbAccessToken = data.session.access_token;
          console.info("[token-refresh] OK — token rotated");
          return true;
        }
        console.warn("[token-refresh] no new token in response");
        return false;
      } catch (e) {
        console.warn("[token-refresh] exception:", e?.message);
        return false;
      } finally {
        // Phase 89.13: keep inflight non-null for 3s after resolve to absorb thundering herd.
        // เดิม: clear ใน finally แบบ sync → concurrent 401 ที่เข้ามาหลัง finally tick
        // จะเห็น null และ trigger refresh รอบใหม่ทั้งหมด → Supabase rate-limit/conflict
        setTimeout(() => { _refreshInflight = null; }, 3000);
      }
    })();
    return _refreshInflight;
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 89.2d: Auth-fetch wrapper สำหรับ raw fetch
  //  ใช้แทน fetch() ใน module ที่ต้องการ 401-retry
  //  Auto-inject apikey + Authorization headers
  //  Auto-retry ครั้งเดียวหลัง refresh token
  // ═══════════════════════════════════════════════════════════
  async function appAuthFetch(url, options = {}, _isRetry = false) {
    const cfg = windowRef.SUPABASE_CONFIG;
    const accessToken = windowRef._sbAccessToken || cfg.anonKey;
    const headers = {
      ...(options.headers || {}),
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + accessToken
    };
    const resp = await windowRef.fetch(url, { ...options, headers });
    if (resp.status === 401 && !_isRetry) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return appAuthFetch(url, options, true);
      windowRef.App?.showToast?.("⚠️ Session หมดอายุ — กรุณา login ใหม่", "error");
    }
    return resp;
  }

  // ═══════════════════════════════════════════════════════════
  //  XHR HELPER — supabase .insert() ค้างในบางสภาพแวดล้อม
  //  ใช้ XHR ตรงๆ แทนทุก INSERT/POST operation
  //  Phase 89.2d: เพิ่ม 401-retry-with-refresh (recursive _isRetry flag)
  // ═══════════════════════════════════════════════════════════
  function xhrPost(table, payload, opts = {}, _isRetry = false) {
    const cfg = windowRef.SUPABASE_CONFIG;
    const accessToken = windowRef._sbAccessToken || cfg.anonKey;
    const prefer = opts.returnData ? "return=representation" : "return=minimal";
    return new Promise((resolve) => {
      const xhr = new windowRef.XMLHttpRequest();
      xhr.open("POST", cfg.url + "/rest/v1/" + table);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", prefer);
      xhr.timeout = 15000;
      xhr.onload = async function () {
        // Phase 89.2d: 401 → refresh token + retry ครั้งเดียว
        if (xhr.status === 401 && !_isRetry) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            const retryRes = await xhrPost(table, payload, opts, true);
            resolve(retryRes);
            return;
          }
          windowRef.App?.showToast?.("⚠️ Session หมดอายุ — กรุณา login ใหม่", "error");
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          let data = null;
          const txt = xhr.responseText;
          // ว่างเปล่า = return=minimal success (ไม่ต้อง parse/warn)
          if (txt && txt.trim()) {
            try { data = JSON.parse(txt); } catch (e) {
              console.warn("[xhrPost] " + table + " JSON.parse failed:", e, txt.slice(0, 200));
            }
          }
          resolve({ ok: true, data: Array.isArray(data) ? data[0] : data, error: null });
        } else {
          const errBody = xhr.responseText;
          let msg = "HTTP " + xhr.status;
          let code = null;  // ★ Phase 497: surface Postgres error code (e.g. 23505 unique) + status for idempotent callers
          try {
            const parsed = JSON.parse(errBody);
            msg = parsed.message || parsed.details || parsed.hint || msg;
            code = parsed.code || null;
            console.error("[xhrPost] " + table + " ERROR:", parsed);
          } catch (e) {
            console.error("[xhrPost] " + table + " ERROR raw:", errBody);
          }
          resolve({ ok: false, data: null, error: { message: msg, code, status: xhr.status } });
        }
      };
      xhr.onerror = function () { resolve({ ok: false, data: null, error: { message: "Network error" } }); };
      xhr.ontimeout = function () { resolve({ ok: false, data: null, error: { message: "Timeout" } }); };
      // ★ ส่งเป็น object เดียว (ไม่ wrap array)
      xhr.send(JSON.stringify(payload));
    });
  }

  function xhrPatch(table, payload, eqCol, eqVal, _isRetry = false) {
    const cfg = windowRef.SUPABASE_CONFIG;
    const accessToken = windowRef._sbAccessToken || cfg.anonKey;
    return new Promise((resolve) => {
      const xhr = new windowRef.XMLHttpRequest();
      xhr.open("PATCH", cfg.url + "/rest/v1/" + table + "?" + eqCol + "=eq." + eqVal);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      // ★ ใช้ return=representation เพื่อตรวจสอบว่า RLS อนุญาตจริงหรือไม่
      xhr.setRequestHeader("Prefer", "return=representation");
      xhr.timeout = 15000;
      xhr.onload = async function () {
        // Phase 89.2d: 401 → refresh + retry ครั้งเดียว
        if (xhr.status === 401 && !_isRetry) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            const retryRes = await xhrPatch(table, payload, eqCol, eqVal, true);
            resolve(retryRes);
            return;
          }
          windowRef.App?.showToast?.("⚠️ Session หมดอายุ — กรุณา login ใหม่", "error");
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          let data = null;
          const txt = xhr.responseText;
          if (txt && txt.trim()) {
            try { data = JSON.parse(txt); } catch (e) {
              console.warn("[xhrPatch] " + table + " JSON.parse failed:", e, txt.slice(0, 200));
            }
          }
          // ★ ถ้า Supabase คืน array ว่าง = RLS บล็อค (0 rows affected)
          if (Array.isArray(data) && data.length === 0) {
            resolve({ ok: false, error: { message: "ไม่สามารถอัปเดตได้ (RLS blocked — 0 rows affected)" } });
          } else {
            resolve({ ok: true, data: Array.isArray(data) ? data[0] : data, error: null });
          }
        } else {
          let msg = "HTTP " + xhr.status;
          const errTxt = xhr.responseText;
          if (errTxt && errTxt.trim()) {
            try { msg = JSON.parse(errTxt)?.message || msg; } catch (e) {
              console.warn("[xhrPatch] " + table + " error body parse failed:", e, errTxt.slice(0, 200));
            }
          }
          resolve({ ok: false, error: { message: msg } });
        }
      };
      xhr.onerror = function () { resolve({ ok: false, error: { message: "Network error" } }); };
      xhr.ontimeout = function () { resolve({ ok: false, error: { message: "Timeout" } }); };
      xhr.send(JSON.stringify(payload));
    });
  }

  // ═══ XHR DELETE — ลบข้อมูลผ่าน REST API ═══
  // Phase 89.2d: เพิ่ม 401-retry-with-refresh
  function xhrDelete(table, eqCol, eqVal, _isRetry = false) {
    const cfg = windowRef.SUPABASE_CONFIG;
    const accessToken = windowRef._sbAccessToken || cfg.anonKey;
    return new Promise((resolve) => {
      const xhr = new windowRef.XMLHttpRequest();
      xhr.open("DELETE", cfg.url + "/rest/v1/" + table + "?" + eqCol + "=eq." + eqVal);
      xhr.setRequestHeader("apikey", cfg.anonKey);
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
      xhr.setRequestHeader("Prefer", "return=minimal");
      xhr.timeout = 15000;
      xhr.onload = async function () {
        // Phase 89.2d: 401 → refresh + retry ครั้งเดียว
        if (xhr.status === 401 && !_isRetry) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            const retryRes = await xhrDelete(table, eqCol, eqVal, true);
            resolve(retryRes);
            return;
          }
          windowRef.App?.showToast?.("⚠️ Session หมดอายุ — กรุณา login ใหม่", "error");
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, error: null });
        else {
          let msg = "HTTP " + xhr.status;
          const errTxt = xhr.responseText;
          if (errTxt && errTxt.trim()) {
            try { msg = JSON.parse(errTxt)?.message || msg; } catch (e) {
              console.warn("[xhrDelete] " + table + " error body parse failed:", e, errTxt.slice(0, 200));
            }
          }
          resolve({ ok: false, error: { message: msg } });
        }
      };
      xhr.onerror = function () { resolve({ ok: false, error: { message: "Network error" } }); };
      xhr.ontimeout = function () { resolve({ ok: false, error: { message: "Timeout" } }); };
      xhr.send();
    });
  }

  return { refreshAccessToken, appAuthFetch, xhrPost, xhrPatch, xhrDelete };
}
