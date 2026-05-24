// ═══════════════════════════════════════════════════════════
//  modules/_offline_queue.js — Phase 92.27
//
//  IndexedDB-backed queue สำหรับ Time Clock actions เวลา offline
//  - enqueue ตอนเน็ตหลุด / fetch fail
//  - sync เมื่อ navigator.online กลับมา หรือเรียกตรง
//  - ใช้ client_uuid เป็น idempotency key (DB partial UNIQUE จะ reject duplicate)
//
//  Generic enough สำหรับ feature อื่นในอนาคต — แต่รอบนี้ใช้กับ time clock อย่างเดียว
//
//  Pure-ish API:
//    - openQueue() → Promise<IDBDatabase>
//    - enqueue(item) → Promise<id>
//    - listAll() → Promise<Array<item>>
//    - remove(id) → Promise<void>
//    - count() → Promise<number>
//    - clear() → Promise<void>
//
//  Item shape:
//    { id (auto), kind, payload, createdAt, attemptCount }
// ═══════════════════════════════════════════════════════════

const DB_NAME = "boonsook-offline-queue";
const DB_VERSION = 1;
const STORE = "queue";

let _dbPromise = null;

/**
 * เปิด IndexedDB connection — singleton ต่อ tab
 * @param {object} [opts]
 * @param {object} [opts.indexedDB] - inject สำหรับ test (default: window.indexedDB)
 * @returns {Promise<IDBDatabase>|null}
 */
export function openQueue(opts = {}) {
  if (_dbPromise) return _dbPromise;
  const idb = opts.indexedDB || (typeof indexedDB !== "undefined" ? indexedDB : null);
  if (!idb) return null;
  _dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("openQueue failed"));
  });
  return _dbPromise;
}

/** สำหรับ test: reset singleton */
export function _resetQueueSingleton() { _dbPromise = null; }

/**
 * เพิ่ม item เข้า queue
 * @param {{kind:string, payload:object}} item
 * @returns {Promise<number>} id ที่สร้างขึ้น
 */
export async function enqueue(item) {
  const db = await openQueue();
  if (!db) throw new Error("IndexedDB not available");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const record = {
      kind: item?.kind || "unknown",
      payload: item?.payload || {},
      createdAt: new Date().toISOString(),
      attemptCount: 0,
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * อ่าน items ทั้งหมด (สำหรับ sync flow)
 * @returns {Promise<Array<{id:number, kind:string, payload:object, createdAt:string, attemptCount:number}>>}
 */
export async function listAll() {
  const db = await openQueue();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * ลบ item ตาม id (เรียกหลัง sync สำเร็จ)
 */
export async function remove(id) {
  const db = await openQueue();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Increment attemptCount (สำหรับ retry budgeting) */
export async function bumpAttempt(id) {
  const db = await openQueue();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) return resolve();
      row.attemptCount = (Number(row.attemptCount) || 0) + 1;
      const putReq = store.put(row);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** จำนวน items ใน queue (สำหรับ UI badge) */
export async function count() {
  const db = await openQueue();
  if (!db) return 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

/** ลบ queue ทั้งหมด (สำหรับ test / reset emergency) */
export async function clear() {
  const db = await openQueue();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Pure helper: ตัดสินใจว่า error/response = เป็น offline หรือเปล่า
 * (ใช้ตอน catch ใน fetch ของ time_clock.js)
 * @param {Error|Response|null} errOrResp
 * @returns {boolean}
 */
export function isOfflineLike(errOrResp) {
  // Network error (TypeError "Failed to fetch") = offline
  if (errOrResp instanceof Error) {
    const msg = String(errOrResp.message || "").toLowerCase();
    if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("offline")) return true;
  }
  // navigator.onLine = false ก็ถือว่า offline
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return true;
  return false;
}

/**
 * Generate UUID v4 ฝั่ง client (สำหรับ idempotency key)
 * ใช้ crypto.randomUUID ถ้ามี (modern browsers), fallback Math.random
 * @returns {string}
 */
export function generateClientUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback v4-ish (less random but works for idempotency)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
