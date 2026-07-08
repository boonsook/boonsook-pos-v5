// Phase 573 — safe JSON.parse จาก localStorage (กันแอปขาวถาวร + self-heal)
//
// ปัญหา: state init ของ main.js และ top-level ของ modules บาง module ทำ
//   JSON.parse(localStorage.getItem(key) || default) ตอน "module evaluation" โดยไม่มี try/catch
//   → localStorage key เดียวเก็บ JSON เสีย (เช่น backup/แก้มือเขียนพังลงมา) = throw ตอน import
//   = ทั้งไฟล์/ทั้ง lazy-module ไม่โหลด = แอปขาวถาวร. selfheal.js ล้างแค่ SW/Cache ไม่แตะ
//   localStorage → refresh กี่รอบก็ไม่หาย (boot-loop).
//
// safeParse:
//   - parse ผ่าน → คืนค่า
//   - key ไม่มี / ว่าง → คืน fallback
//   - parse พัง → ★ removeItem (self-heal: boot ถัดไปสะอาด ปิด boot-loop) + คืน fallback
//   - storage โดน block (SecurityError private mode ฯลฯ) → คืน fallback เฉย ๆ ไม่ throw
//
// pure + inject storage param (default globalThis.localStorage) เพื่อ unit-test ด้วย mock ได้.
export function safeParse(key, fallback, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[safeParse] corrupt/blocked:", key, e?.message);
    try { storage.removeItem(key); } catch { /* storage blocked — ปล่อย */ }
    return fallback;
  }
}
