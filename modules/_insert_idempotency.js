// ═══════════════════════════════════════════════════════════
// Phase 567: idempotency กัน service_jobs ซ้ำจาก timeout/retry (3 ฟอร์มช่าง)
// ═══════════════════════════════════════════════════════════
//   ปัญหา: ฟอร์มช่าง (service_form/ac_install/solar) POST /service_jobs ด้วย raw fetch
//   → server commit แล้วแต่ตอบช้า/เน็ตหลุด → ปุ่ม save re-enable (finally) → user กดใหม่
//   = ใบงานซ้ำ 2 row → แอดมินปิดทั้งคู่ = auto-post JV ซ้ำ "ทางอ้อม" (source_id ต่างกัน
//   → idempotency ที่ auto_post ช่วยไม่ได้). แก้ต้นเหตุ = กันไม่ให้เกิด row ซ้ำตั้งแต่แรก.
//
//   client_uuid = intent key (gen ครั้งเดียวต่อ "1 ใบงาน" ที่ form; retry ใช้ค่าเดิม)
//   + DB partial UNIQUE index (supabase-phase567) → POST ซ้ำด้วย key เดิม = 409 → replay-lookup
//   คืน row เดิม (ไม่สร้างซ้ำ). timeout/network หลัง commit ก็ replay-lookup ก่อน throw.
//
//   degrade-safe: ถ้า column ยังไม่มี (owner ยังไม่รัน SQL) → retry POST โดยไม่มี client_uuid
//   (บันทึกได้ตามปกติ แค่ยังไม่ dedup จนกว่าจะรัน SQL) — deploy ไม่พังถ้า SQL มาทีหลัง.
//
//   pure + testable: fetchFn param (default globalThis.fetch) ให้ unit-test ยิง mock ได้.
//   ไม่แตะ JV/auto_post/stock/RLS — แค่ชั้น insert idempotency.

// gen key ครั้งเดียวต่อ intent (mirror _ensureCheckoutKey ของ pos.js Phase 520).
// form เก็บค่าที่คืนไว้ใน module var ของตัวเอง → ใช้ค่าเดิมตอน retry, reset (null) หลังสำเร็จ,
// gen ใหม่ตอน render ฟอร์มใบใหม่.
export function createInsertIntent() {
  return (globalThis.crypto?.randomUUID?.() || ("ins-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10)));
}

/**
 * POST /service_jobs แบบ idempotent + replay-safe.
 * @returns {Promise<{row: object|null, replayed: boolean}>}
 *   replayed=true → row นี้มาจาก insert รอบก่อน (409/timeout replay) — อย่าโพสต์ JV/side-effect ซ้ำ
 * @throws Error เมื่อ insert ล้มเหลวจริง (ไม่ใช่ replay)
 */
export async function insertServiceJobWithReplay({ cfg, token, record, key, timeoutMs = 15000, fetchFn = globalThis.fetch } = {}) {
  const base = `${cfg.url}/rest/v1/service_jobs`;
  const anon = cfg.anonKey;
  const writeHeaders = {
    "Content-Type": "application/json",
    "apikey": anon,
    "Authorization": `Bearer ${token}`,
    "Prefer": "return=representation"
  };

  // replay-lookup: หา row ที่ commit ไปแล้วด้วย client_uuid (คืน null ถ้าไม่มี key/ไม่เจอ/error)
  const lookupByKey = async () => {
    if (!key) return null;
    try {
      const r = await fetchFn(`${base}?client_uuid=eq.${encodeURIComponent(key)}&select=*&limit=1`, {
        headers: { "apikey": anon, "Authorization": `Bearer ${token}` }
      });
      if (!r.ok) return null;
      const rows = await r.json();
      return (Array.isArray(rows) && rows[0]) || null;
    } catch { return null; }
  };

  // POST + AbortController timeout (ฟอร์มเดิมบางตัวไม่มี timeout → helper ให้ consistent 15s)
  const post = async (body) => {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchFn(base, { method: "POST", headers: writeHeaders, body: JSON.stringify(body), signal: ctrl.signal });
    } finally { clearTimeout(tmr); }
  };

  const body = key ? { ...record, client_uuid: key } : record;

  let resp;
  try {
    resp = await post(body);
  } catch (err) {
    // timeout(AbortError)/network → อาจ commit แล้วแต่ตอบไม่ถึง client → replay-lookup ก่อน throw
    const row = await lookupByKey();
    if (row) return { row, replayed: true };
    if (err?.name === "AbortError") throw new Error(`⏰ บันทึกล้มเหลว — server ตอบช้าเกิน ${Math.round(timeoutMs / 1000)} วิ (ลอง refresh แล้วลองใหม่)`);
    throw new Error("เครือข่ายขัดข้อง: " + (err?.message || String(err)));
  }

  if (resp.ok) {
    const inserted = await resp.json();
    return { row: (Array.isArray(inserted) && inserted[0]) || null, replayed: false };
  }

  let errBody = "";
  try { errBody = await resp.text(); } catch { /* ignore */ }

  // column ยังไม่มี (owner ยังไม่รัน supabase-phase567) → degrade: retry POST โดยไม่มี client_uuid
  if (key && resp.status === 400 && /client_uuid/i.test(errBody) && /(PGRST204|42703|column|schema cache|could not find)/i.test(errBody)) {
    console.warn("[insertServiceJobWithReplay] client_uuid column ยังไม่มี — degrade บันทึกโดยไม่ dedup. โปรดรัน supabase-phase567-service-client-uuid.sql");
    const resp2 = await post(record);
    if (resp2.ok) {
      const ins2 = await resp2.json();
      return { row: (Array.isArray(ins2) && ins2[0]) || null, replayed: false };
    }
    let e2 = ""; try { e2 = await resp2.text(); } catch { /* ignore */ }
    throw new Error(`HTTP ${resp2.status}: ${e2.slice(0, 300) || "no body"}`);
  }

  // 409 unique-violation (client_uuid ซ้ำ = commit รอบก่อนสำเร็จแล้ว) → replay row เดิม
  if (key && resp.status === 409) {
    const row = await lookupByKey();
    if (row) return { row, replayed: true };
  }

  throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 300) || "no body"}`);
}
