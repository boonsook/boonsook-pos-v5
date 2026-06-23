// ═══════════════════════════════════════════════════════════
//  auto_post.js — Auto-create Journal Entry from source transaction (Phase 88.1)
//
//  Public API:
//    postJournalForSale(sale)           — POS sale → SV
//    postJournalForExpense(expense)      — expense → PV
//    postJournalForServiceJob(job)       — service income → SV (Phase 88.1b)
//    postJournalForReceipt(receipt)      — receipt payment → RV (Phase 88.1b)
//    postJournalForPayroll(p)            — payroll → PV (Phase 88.1b)
//    resetMappingCache()                 — call หลัง admin แก้ account_mapping
//
//  Idempotency:
//    journal_entries มี unique partial index บน (source_table, source_id)
//    → การเรียกซ้ำจะ HTTP 409 → return null ไม่ duplicate
//
//  Effective date:
//    SKIP ถ้า source < 2026-01-01 (ตามที่ user ตัดสินใจในแบบสอบถาม)
//
//  Pre-req: รัน supabase-phase88-auto-post.sql ก่อนใช้
// ═══════════════════════════════════════════════════════════

import { dateBkk, todayBkk, round2 } from "../utils.js";

// ═══════════════════════════════════════════════════════════
//  Phase 92.64: VAT split balancer (pure, testable)
//  ปัญหาเดิม: VAT split ใช้ sale.subtotal_before_vat + sale.vat_amount ที่ปัดเศษแยกกัน
//  → subtotal + vat อาจ ≠ total → JV Dr≠Cr (drift ≤0.01 = TB เพี้ยน, >0.01 = JV ถูก reject เงียบ)
//  วิธีแก้: anchor ที่ total (ยอดที่ลูกค้าจ่าย) → vat = round2, subtotal = round2(total - vat)
//  → subtotal + vat === total เป๊ะเสมอ (residual เศษเข้า revenue line — ถูกหลักบัญชี)
// ═══════════════════════════════════════════════════════════
export function splitSaleVatLines(total, vatAmount) {
  const t = round2(total);
  const v = round2(vatAmount);
  return { total: t, vat: v, subtotal: round2(t - v) };
}

// ★ Phase 517b-3: แยก "ฝั่ง debit" ของ JV ขาย เมื่อใช้เครดิตลูกค้า 2180 (credit_used_amount > 0).
//   Dr 2180 = creditUsed (ล้าง liability เครดิตลูกค้า) + Dr <cash/bank> = total − creditUsed (เงินจริง).
//   credit เต็มจำนวน (cash = 0) → ข้ามบรรทัด cash; creditUsed = 0 → คืน 1 บรรทัดเดิม (Dr debitAccount = total).
//   Σ debit = total เสมอ → JV บาลานซ์ (Cr ฝั่งรายได้/VAT ไม่เปลี่ยน). ไม่แตะ VAT/total/revenue.
export function buildSaleDebitLines(debitAccount, totalDebit, creditUsed, desc) {
  const total = round2(totalDebit);
  const cu = round2(Math.min(Math.max(Number(creditUsed) || 0, 0), total));  // clamp 0..total
  const lines = [];
  if (cu > 0.005) lines.push({ account_code: "2180", debit: cu, credit: 0, description: desc + " (ใช้เครดิตลูกค้า 2180)" });
  const cash = round2(total - cu);
  if (cash > 0.005) lines.push({ account_code: debitAccount, debit: cash, credit: 0, description: desc });
  // safety: ถ้าทั้งคู่ปัดเป็น 0 (total เล็กมาก) → คงบรรทัด debitAccount เต็ม เพื่อให้ Dr=Cr (ไม่ควรเกิดจริง)
  if (lines.length === 0) lines.push({ account_code: debitAccount, debit: total, credit: 0, description: desc });
  return lines;
}

// Phase 89.4: auth-fetch helper สำหรับ critical write ops
// ใช้ window._appAuthFetch (auto 401 retry) — fallback ราฟ fetch + manual headers ถ้า main.js ยังไม่ init
function _authFetch(url, opts = {}) {
  if (window._appAuthFetch) return window._appAuthFetch(url, opts);
  // Fallback: manual auth headers (no retry on 401)
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), apikey: cfg.anonKey, Authorization: "Bearer " + token }
  });
}

// ★ Phase 413: effective date ย้ายไป single source of truth (effective_date.js)
//   เริ่มบัญชีจริง 1 ก.ค. 2569 — JV ก่อนวันนี้ถูก skip อัตโนมัติ (ของเก่า = test data ไม่ถูกลบ)
import { ACCOUNTING_EFFECTIVE_DATE } from "./effective_date.js";

let _mappingCache = null;
let _coaCache = null;  // Phase 89.2: cache COA codes สำหรับ validate BANK_COA override

function _journalResult(detailed, result) {
  if (detailed) return result;
  return result?.status === "posted" ? result.entryId : null;
}

/**
 * Reset mapping cache — เรียกหลัง admin แก้ account_mapping ใน DB
 * Phase 89.2: รวม COA cache ด้วย — เรียกหลัง admin เพิ่ม/ลบ chart_of_accounts
 */
export function resetMappingCache() {
  _mappingCache = null;
  _coaCache = null;
}

/**
 * Phase 89.2: Load active COA codes for validation.
 * Cache เพื่อไม่ต้อง fetch ทุก JV — reset ผ่าน resetMappingCache()
 */
async function _getValidCoaCodes() {
  if (_coaCache) return _coaCache;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/chart_of_accounts?select=code&is_active=eq.true`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const arr = await r.json();
    // eslint-disable-next-line require-atomic-updates -- F: idempotent COA cache (concurrent fetch = same data set)
    _coaCache = new Set(arr.map(a => String(a.code)));
    return _coaCache;
  } catch(e) {
    console.warn("[auto_post] cannot load COA list:", e.message);
    return new Set(); // fail-safe — caller จะใช้ default mapping
  }
}

/**
 * ★ Phase 88.10: Void/delete JV for given source (เพื่อ re-post หลัง user แก้ amount/method)
 * ใช้ pattern DELETE + repost — ง่ายกว่า in-place update
 * เรียกก่อน postJournalForX(...) ตอน edit existing source row
 *
 * Phase 89.16 (M1): pre-check + silent-fail detection
 *   เดิม: RLS DELETE policy block → return 0 silent → user เห็น "ยกเลิกเรียบร้อย"
 *         แต่ JV ยังอยู่ → P&L นับรายได้ซ้ำ = double-revenue
 *   ใหม่: query count ก่อน DELETE → ถ้า expected>0 แต่ deleted=0 → toast ERROR + console.error
 *
 * @param {string} sourceTable - "sales" | "receipts" | "delivery_invoices" | "service_jobs"
 * @param {string|number} sourceId
 * @returns {Promise<number>} จำนวน entries ที่ถูกลบจริง
 */
export async function voidJvForSource(sourceTable, sourceId) {
  if (!sourceTable || !sourceId) return 0;
  const cfg = window.SUPABASE_CONFIG;
  const headers = { "Prefer": "return=representation" };
  const baseUrl = `${cfg.url}/rest/v1/journal_entries?source_table=eq.${encodeURIComponent(sourceTable)}&source_id=eq.${sourceId}`;

  try {
    // Phase 89.16: pre-check ว่ามี JV เหลือกี่ entry — เพื่อจับ silent fail หลัง DELETE
    let expectedCount = 0;
    try {
      const checkR = await _authFetch(`${baseUrl}&select=id`, { headers: { "Prefer": "count=exact" } });
      if (checkR.ok) {
        const rows = await checkR.json().catch(() => []);
        expectedCount = Array.isArray(rows) ? rows.length : 0;
      }
    } catch(e) { /* pre-check failure not fatal — fall through to DELETE */ }

    // DELETE — lines จะถูกลบอัตโนมัติเพราะ FK ON DELETE CASCADE
    const r = await _authFetch(baseUrl, { method: "DELETE", headers });
    if (!r.ok) {
      console.error(`[auto_post] voidJV HTTP ${r.status} for ${sourceTable}#${sourceId} (expected ${expectedCount})`);
      if (expectedCount > 0) {
        window.App?.showToast?.(`⚠️ ลบ JV ของ ${sourceTable}#${sourceId} ไม่ได้ (HTTP ${r.status}) — กรุณาตรวจ P&L manually`);
      }
      return 0;
    }

    const deleted = await r.json().catch(() => []);
    const count = Array.isArray(deleted) ? deleted.length : 0;

    if (expectedCount > 0 && count === 0) {
      // Silent fail — RLS DELETE policy block (ส่ง 2xx แต่ rows ที่ลบ = 0)
      console.error(`[auto_post] voidJV silent fail: ${sourceTable}#${sourceId} — expected ${expectedCount} rows, RLS deleted 0`);
      window.App?.showToast?.(`⚠️ JV ของ ${sourceTable}#${sourceId} (${expectedCount} entry) ลบไม่ได้ (RLS อาจบล็อค) — ตรวจ P&L manually`);
      return 0;
    }

    if (count > 0) {
      console.info(`[auto_post] voided ${count} JV(s) for ${sourceTable}#${sourceId}`);
    }
    return count;
  } catch(e) {
    console.error(`[auto_post] voidJV exception ${sourceTable}#${sourceId}:`, e?.message);
    return 0;
  }
}

async function _getMappings() {
  if (_mappingCache) return _mappingCache;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/account_mapping?select=*&is_active=eq.true`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const arr = await r.json();
    // eslint-disable-next-line require-atomic-updates -- F: idempotent account mapping cache (concurrent fetch = same data)
    _mappingCache = {};
    arr.forEach(m => { _mappingCache[m.mapping_key] = m; });
    return _mappingCache;
  } catch(e) {
    console.warn("[auto_post] cannot load mappings:", e.message);
    return {};
  }
}

// Phase 89.18: export สำหรับ unit test
export function _isAfterEffective(dateStr) {
  if (!dateStr) return false;
  return String(dateStr).slice(0, 10) >= ACCOUNTING_EFFECTIVE_DATE;
}

export function refundMappingKeyForMethod(method) {
  const pm = String(method || "").trim().toLowerCase();
  if (!pm) return null;
  if (/credit|เครดิต/.test(pm)) return "refund_credit";
  if (/exchange|เปลี่ยน/.test(pm)) return "refund_exchange";
  if (/transfer|โอน|qr|bank/.test(pm)) return "refund_transfer";
  if (/cash|เงินสด/.test(pm)) return "refund_cash";
  return null;
}


// ═══════════════════════════════════════════════════════════
// Core: post a journal entry + lines
// ═══════════════════════════════════════════════════════════
async function _postJournal(opts) {
  const { sourceTable, sourceId, docType, docDate, description, lines } = opts;
  const detailed = opts.detailed === true;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  // Validate balanced
  const totalDebit  = lines.reduce((s, l) => s + Number(l.debit  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    console.error("[auto_post] unbalanced:", { totalDebit, totalCredit, sourceTable, sourceId });
    return _journalResult(detailed, { status: "failed", reason: "unbalanced", sourceTable, sourceId });
  }
  if (totalDebit < 0.01) {
    console.warn("[auto_post] zero amount, skipping:", sourceTable, sourceId);
    return _journalResult(detailed, { status: "skipped", reason: "zero-amount", sourceTable, sourceId });
  }

  // ★ Phase 88.19: ตรวจ period locked ก่อน insert (front-end check + DB trigger เป็น defense in depth)
  try {
    const yyyy = parseInt(docDate.slice(0, 4), 10);
    const mm   = parseInt(docDate.slice(5, 7), 10);
    const r = await fetch(
      `${cfg.url}/rest/v1/accounting_periods?select=status&year=eq.${yyyy}&month=eq.${mm}`,
      { headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token } }
    );
    if (r.ok) {
      const arr = await r.json();
      if (arr[0]?.status === "locked") {
        console.warn("[auto_post] period locked, skipping:", `${yyyy}-${mm}`, sourceTable, sourceId);
        if (window.showToast) window.showToast(`⛔ งวด ${yyyy}-${String(mm).padStart(2,"0")} ถูกปิดแล้ว — ลง JV ไม่ได้`);
        return _journalResult(detailed, { status: "skipped", reason: "period-locked", sourceTable, sourceId });
      }
    }
  } catch(e) { /* fail open — DB trigger จะกันอีกชั้น */ }

  // Generate doc_no: <type><YYYY><MM><####>
  const yyyy = docDate.slice(0, 4);
  const mm   = docDate.slice(5, 7);
  const docNoPrefix = `${docType}${yyyy}${mm}`;
  let nextSeq = 1;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/journal_entries?select=doc_no&doc_no=like.${docNoPrefix}*&order=doc_no.desc&limit=1`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    const arr = await r.json();
    if (arr[0]?.doc_no) {
      const tail = arr[0].doc_no.slice(docNoPrefix.length);
      nextSeq = (Number(tail) || 0) + 1;
    }
  } catch(e) { /* fallback to 1 */ }
  const docNo = `${docNoPrefix}${String(nextSeq).padStart(4, "0")}`;

  // POST entry — idempotent via partial unique index
  // Phase 89.4: _authFetch → auto 401 retry
  let entryId = null;
  try {
    const r = await _authFetch(`${cfg.url}/rest/v1/journal_entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: docType,
        doc_date: docDate,
        description,
        status: "approved",
        total_debit: totalDebit,
        total_credit: totalCredit,
        source_table: sourceTable,
        source_id: sourceId,
        approved_at: new Date().toISOString()
      })
    });
    if (r.status === 409 || r.status === 23505) {
      // Idempotency hit — JV already exists for this source
      console.info("[auto_post] JV already exists for", sourceTable, "#" + sourceId);
      return _journalResult(detailed, { status: "skipped", reason: "duplicate", sourceTable, sourceId });
    }
    if (!r.ok) {
      const txt = await r.text();
      // Postgres unique violation surfaces as 409 in PostgREST, but check error code too
      if (txt.includes("idx_je_source_unique") || txt.includes("23505")) {
        console.info("[auto_post] JV already exists (via error):", sourceTable, sourceId);
        return _journalResult(detailed, { status: "skipped", reason: "duplicate", sourceTable, sourceId });
      }
      throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }
    const arr = await r.json();
    entryId = arr[0]?.id;
    if (!entryId) throw new Error("no id returned");
  } catch(e) {
    const msg = e?.message || String(e);
    // Phase 92.13: distinguish RLS denial (403 / Postgres 42501) from real errors.
    //   Source transaction (POS sale ฯลฯ) succeeded already — JV นี้ fire-and-forget.
    //   403 = role นี้ถูก RLS block ที่ journal_entries → JV ถูก "เลื่อน" (ไม่ใช่ crash)
    //   Real fix อยู่ฝั่ง DB: ต้องมี policy je_insert_auto/jl_insert_auto
    //   (supabase-phase89-25-fix-je-rls-pos.sql) — ไม่ fake success ฝั่ง client
    if (/\b403\b|42501|row-level security/i.test(msg)) {
      console.warn(`[auto_post] JV deferred (RLS denied role) for ${sourceTable}#${sourceId} — source saved OK; verify je_insert_auto policy (supabase-phase89-25-fix-je-rls-pos.sql)`);
    } else {
      console.error("[auto_post] entry insert failed:", msg);
    }
    return _journalResult(detailed, { status: "failed", reason: "entry-insert-failed", sourceTable, sourceId, error: msg });
  }

  // POST lines (bulk)
  try {
    const lineData = lines.map((l, i) => ({
      entry_id: entryId,
      line_no: i + 1,
      account_code: l.account_code,
      debit:  Number(l.debit  || 0),
      credit: Number(l.credit || 0),
      description: l.description || ""
    }));
    // Phase 89.4: _authFetch → auto 401 retry
    const r = await _authFetch(`${cfg.url}/rest/v1/journal_lines`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(lineData)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } catch(e) {
    console.error("[auto_post] lines insert failed (entry " + entryId + "), rolling back entry:", e.message);
    // Phase 89.2: rollback entry — กัน orphan JV ที่ trial balance พังเงียบ
    // Phase 89.4: _authFetch → auto 401 retry
    try {
      const delResp = await _authFetch(`${cfg.url}/rest/v1/journal_entries?id=eq.${entryId}`, {
        method: "DELETE"
      });
      if (delResp.ok) {
        console.info("[auto_post] rollback OK — entry " + entryId + " deleted");
      } else {
        console.error("[auto_post] rollback FAILED — entry " + entryId + " still orphan:", delResp.status);
        if (window.showToast) window.showToast(`⚠️ JV ${entryId} ค้าง — ไม่มี lines (ลบจาก UI ได้)`);
      }
    } catch(delErr) {
      console.error("[auto_post] rollback exception:", delErr.message);
      if (window.showToast) window.showToast(`⚠️ JV ${entryId} ค้าง — ไม่มี lines (network error)`);
    }
    return _journalResult(detailed, { status: "failed", reason: "lines-insert-failed", sourceTable, sourceId, entryId, error: e?.message || String(e) });
  }

  console.info("[auto_post] ✅ created", docNo, "from", sourceTable, "#" + sourceId, "amount", totalDebit);
  return _journalResult(detailed, { status: "posted", entryId, docNo, sourceTable, sourceId });
}


// ═══════════════════════════════════════════════════════════
// Public: POS sale → JV
// ═══════════════════════════════════════════════════════════
/**
 * @param {object} sale - row จาก state.sales (ต้องมี id, created_at, grand_total, payment_method)
 */
export async function postJournalForSale(sale, opts = {}) {
  // ★ Boonsook sales ใช้ total_amount; quotations ใช้ grand_total — รองรับทั้งคู่
  const amountRaw = sale?.total_amount ?? sale?.grand_total;
  if (!sale?.id || !amountRaw) return _journalResult(opts.detailed, { status: "skipped", reason: "missing-required", sourceTable: "sales", sourceId: sale?.id });
  // ★ Phase 411 (§4.3): บิล soft-delete (note มี "[ลบแล้ว]") ห้าม post JV ทุก path
  //   (auto/backfill) — JV เดิมถูก void ตอนลบแล้ว post ใหม่ = รายได้ผีจากบิลที่ไม่มีจริง
  if (String(sale.note || "").includes("[ลบแล้ว]")) {
    console.info("[auto_post] skip deleted sale:", sale.id);
    return _journalResult(opts.detailed, { status: "skipped", reason: "deleted", sourceTable: "sales", sourceId: sale.id });
  }
  // Phase 89.1: ใช้ Bangkok time — กัน 00:00-06:59 ลง doc_date เป็นเมื่อวาน
  const docDate = sale.created_at ? dateBkk(sale.created_at) : todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] sale before effective date, skip:", docDate);
    return _journalResult(opts.detailed, { status: "skipped", reason: "pre-effective", sourceTable: "sales", sourceId: sale.id, docDate });
  }

  const mappings = await _getMappings();
  const pm = String(sale.payment_method || "").toLowerCase();
  let mappingKey = "sale_cash";
  if (/credit_term|เครดิต/.test(pm))     mappingKey = "sale_credit_term";
  else if (/credit|บัตร/.test(pm))        mappingKey = "sale_credit";
  else if (/transfer|โอน|qr|bank/.test(pm)) mappingKey = "sale_transfer";
  // else: sale_cash

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for sale:", mappingKey);
    return _journalResult(opts.detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "sales", sourceId: sale.id, mappingKey });
  }

  const desc = `ขาย POS ${sale.order_no || '#' + sale.id} — ${sale.customer_name || 'ลูกค้าทั่วไป'}`;
  const amount = Number(amountRaw);

  // ★ Phase 88.20: ถ้าเป็น sale_transfer + มี BANK_COA:XXXX ใน note → ใช้ COA นั้นแทน mapping default
  // Phase 89.2: tighten regex (anchor + word boundary) + validate กับ chart_of_accounts
  let debitAccount = mapping.debit_account_code;
  if (mappingKey === "sale_transfer" || mappingKey === "sale_credit") {
    const noteMatch = String(sale.note || "").match(/(?:^|[\s•])BANK_COA:(\d{4,5})(?=$|[\s•])/);
    if (noteMatch?.[1]) {
      const candidate = noteMatch[1];
      const validCodes = await _getValidCoaCodes();
      if (validCodes.size === 0 || validCodes.has(candidate)) {
        // validCodes ว่าง = COA fetch fail → fail-open (เผื่อ DB จะ reject FK ทีหลัง — ดีกว่าไม่ post เลย)
        debitAccount = candidate;
        console.info("[auto_post] sale transfer override Dr account:", debitAccount, "(from note BANK_COA)");
      } else {
        console.warn("[auto_post] BANK_COA invalid:", candidate, "— falling back to default", mapping.debit_account_code);
        if (window.showToast) window.showToast(`⚠️ COA ${candidate} ไม่พบ — ใช้ default ${mapping.debit_account_code} แทน`);
      }
    }
  }

  // ★ Phase 88.21: VAT split — ถ้ามี vat_amount > 0 → แยก JV เป็น 3 บรรทัด
  const vatAmount = Number(sale.vat_amount || 0);
  const subtotalBeforeVat = Number(sale.subtotal_before_vat || 0) || (amount - vatAmount);
  // ★ Phase 517b-3: ใช้เครดิตลูกค้า 2180 → แยกฝั่ง debit (Dr 2180 + Dr cash/bank ที่เหลือ). 0 = โครงเดิม.
  const creditUsed = Number(sale.credit_used_amount || 0);

  if (vatAmount > 0.01 && subtotalBeforeVat > 0.01) {
    // Phase 92.64: derive ให้ Dr === Cr เป๊ะ (subtotal := total - vat, ทั้งคู่ round2)
    const v = splitSaleVatLines(amount, vatAmount);
    return _postJournal({
      sourceTable: "sales",
      sourceId: sale.id,
      docType: "SV",
      docDate,
      description: desc,
      detailed: opts.detailed,
      lines: [
        ...buildSaleDebitLines(debitAccount, v.total, creditUsed, desc),
        { account_code: mapping.credit_account_code,  debit: 0,       credit: v.subtotal, description: desc + " (รายได้ก่อน VAT)" },
        { account_code: "2170",                       debit: 0,       credit: v.vat,      description: desc + ` (VAT ${sale.vat_rate || 7}%)` }
      ]
    });
  }

  // ไม่มี VAT — JV ปกติ (Cr รายได้ 1 บรรทัด; ฝั่ง debit อาจ split 2180)
  return _postJournal({
    sourceTable: "sales",
    sourceId: sale.id,
    docType: "SV",
    docDate,
    description: desc,
    detailed: opts.detailed,
    lines: [
      ...buildSaleDebitLines(debitAccount, amount, creditUsed, desc),
      { account_code: mapping.credit_account_code,  debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Expense → JV
// ═══════════════════════════════════════════════════════════
const EXPENSE_CATEGORY_MAP = {
  fuel:        "expense_fuel",
  gasoline:    "expense_fuel",
  น้ำมัน:      "expense_fuel",
  utility:     "expense_utility",
  utilities:   "expense_utility",
  electricity: "expense_utility",
  water:       "expense_utility",
  phone:       "expense_phone",
  internet:    "expense_phone",
  rent:        "expense_rent",
  repair:      "expense_repair",
  maintenance: "expense_repair",
  supplies:    "expense_supplies",
  materials:   "expense_supplies",
  ads:         "expense_ads",
  marketing:   "expense_ads",
  bank_fee:    "expense_bank_fee",
  bank:        "expense_bank_fee",
  travel:      "expense_travel",
  // Phase 88.1b: payroll → expense flow (Phase 76 auto-creates expense w/ category=salary on mark paid)
  salary:      "payroll_salary",
  labor_hire:  "payroll_salary",  // ค่าจ้างช่าง — ใช้ mapping เดียวกับเงินเดือนพนักงาน (Dr 5200 / Cr 1110)
  payroll:     "payroll_salary"
};

/**
 * @param {object} expense - row จาก state.expenses (ต้องมี id, expense_date, amount, category)
 */
export async function postJournalForExpense(expense, opts = {}) {
  if (!expense?.id || !expense?.amount) return _journalResult(opts.detailed, { status: "skipped", reason: "missing-required", sourceTable: "expenses", sourceId: expense?.id });
  const docDate = (expense.expense_date || expense.created_at) ? dateBkk(expense.expense_date || expense.created_at) : todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] expense before effective date, skip:", docDate);
    return _journalResult(opts.detailed, { status: "skipped", reason: "pre-effective", sourceTable: "expenses", sourceId: expense.id, docDate });
  }

  const mappings = await _getMappings();
  const cat = String(expense.category || "").toLowerCase().trim();
  const mappingKey = EXPENSE_CATEGORY_MAP[cat] || "expense_misc";

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for expense category:", cat);
    return _journalResult(opts.detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "expenses", sourceId: expense.id, mappingKey });
  }

  // ★ Override credit account ถ้าจ่ายผ่านธนาคาร (ไม่ใช่เงินสด)
  let creditAccount = mapping.credit_account_code;
  const pm = String(expense.payment_method || "").toLowerCase();
  if (/transfer|โอน|bank/.test(pm)) creditAccount = "1130"; // เงินฝากธนาคาร
  else if (/credit|บัตร/.test(pm))   creditAccount = "2120"; // เจ้าหนี้อื่น (บัตร)

  const desc = `จ่าย: ${expense.description || expense.category || ''} ${expense.ref_no || ''}`.trim();
  const amount = Number(expense.amount);

  return _postJournal({
    sourceTable: "expenses",
    sourceId: expense.id,
    docType: "PV",
    docDate,
    description: desc,
    detailed: opts.detailed,
    lines: [
      { account_code: mapping.debit_account_code, debit: amount, credit: 0,      description: desc },
      { account_code: creditAccount,              debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Payroll payment → JV (Phase 92.44)
//   - direct path (ไม่ผ่าน expense) → source_table="staff_payroll", source_id=payroll.id
//   - docType="PV" (จ่าย)
//   - ใช้ payroll_salary mapping ที่มีอยู่แล้ว (Dr 5200 / Cr 1110 default)
//   - idempotent: unique partial index บน (source_table, source_id) → กด pay ซ้ำไม่สร้างซ้ำ
//   - description: "จ่ายเงินเดือน — {employeeName} — {periodLabel}"
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} payroll - row staff_payroll (ต้องมี id, total_amount)
 * @param {string|Date} paidAt - timestamp ของการจ่าย (ใช้ dateBkk → docDate)
 * @param {string} [paymentMethod] - cash|transfer|cheque (override credit account ถ้าโอน)
 * @param {object} [opts]
 * @param {string} [opts.employeeName] - ใช้ใน description
 * @param {string} [opts.periodLabel] - "พฤษภาคม 2569" หรือคล้าย ๆ
 * @returns {Promise<number|null>} entry_id ถ้า post ใหม่, null ถ้า idempotency hit/ปิด period/error
 */
export async function postJournalForPayroll(payroll, paidAt, paymentMethod, opts = {}) {
  if (!payroll?.id || !payroll?.total_amount) return null;
  const amount = Number(payroll.total_amount);
  if (!Number.isFinite(amount) || amount < 0.01) return null;

  const docDate = dateBkk(paidAt || new Date()) || todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] payroll before effective date, skip:", docDate);
    return null;
  }

  const mappings = await _getMappings();
  const mapping = mappings["payroll_salary"];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for payroll_salary — รัน supabase mapping ก่อน");
    return null;
  }

  // ★ Override credit account ถ้าจ่ายผ่านธนาคาร (ไม่ใช่เงินสด)
  let creditAccount = mapping.credit_account_code;
  const pm = String(paymentMethod || "").toLowerCase();
  if (/transfer|โอน|bank/.test(pm)) creditAccount = "1130"; // เงินฝากธนาคาร
  else if (/cheque|เช็ค/.test(pm))   creditAccount = "1130"; // เช็ค → ตัดจากธนาคาร

  const empName = (opts.employeeName || "พนักงาน").toString().trim();
  const periodLabel = (opts.periodLabel || "").toString().trim();
  // Format ตาม spec user: "จ่ายเงินเดือน — {employee_name} — {period_label}"
  const desc = periodLabel
    ? `จ่ายเงินเดือน — ${empName} — ${periodLabel}`
    : `จ่ายเงินเดือน — ${empName}`;

  return _postJournal({
    sourceTable: "staff_payroll",
    sourceId: payroll.id,
    docType: "PV",
    docDate,
    description: desc,
    lines: [
      { account_code: mapping.debit_account_code, debit: amount, credit: 0,      description: desc },
      { account_code: creditAccount,              debit: 0,      credit: amount, description: desc }
    ]
  });
}


// Phase 447a (pure, testable): สร้าง lines ของ JV เงินเดือน "รวมทั้งงวด" จากแถวที่จ่ายแล้ว
//   - แยก Cr ตามวิธีจ่าย: transfer/cheque → 1130 (ธนาคาร), อื่น ๆ → mapping.credit_account_code (เงินสด)
//   - Dr mapping.debit_account_code = ยอดรวม · balanced เป๊ะ (grand = cashR + bankR, ปัด 2 ตำแหน่งก่อนรวม)
//   - description เดียวกันทุก line (ยอดรวม ไม่มีชื่อ/รายคน) · return null ถ้ายอดรวม < 0.01
export function _buildPayrollPeriodLines(rows, mapping, desc) {
  let cashSum = 0, bankSum = 0;
  for (const p of (rows || [])) {
    const amt = Number(p?.total_amount || 0);
    if (!Number.isFinite(amt) || amt < 0.01) continue;
    const pm = String(p?.payment_method || "").toLowerCase();
    if (/transfer|โอน|bank|cheque|เช็ค/.test(pm)) bankSum += amt;
    else cashSum += amt;
  }
  const cashR = round2(cashSum), bankR = round2(bankSum);
  const grand = round2(cashR + bankR);
  if (grand < 0.01) return null;
  const lines = [{ account_code: mapping.debit_account_code, debit: grand, credit: 0, description: desc }];
  if (bankR >= 0.01) lines.push({ account_code: "1130", debit: 0, credit: bankR, description: desc });
  if (cashR >= 0.01) lines.push({ account_code: mapping.credit_account_code, debit: 0, credit: cashR, description: desc });
  return { lines, grand };
}

// ═══════════════════════════════════════════════════════════
// Public: Payroll PERIOD aggregate → JV (Phase 447a)
//   - รวมเงินเดือนที่ "จ่ายแล้ว" ทั้งงวด เป็น JV ก้อนเดียว (ยอดรวม — ไม่มีชื่อ/รายคน)
//     → สำนักงานบัญชี (accountant) เห็นแค่ยอดรวม ไม่เห็นเงินเดือนรายคน
//   - แทน postJournalForPayroll (per-person) ที่ถอดออกจาก _markPaid แล้ว (กันรั่ว)
//   - Dr payroll_salary (5200) รวม / Cr แยกตามวิธีจ่าย: cash→credit_account_code (1110),
//     transfer·cheque→1130 (เงินฝากธนาคาร)
//   - source_table="payroll_period", source_id=YYYYMMDD ของ period_end → idempotent ต่อ "งวด"
//     (กดซ้ำ = 409 skip ไม่ลงซ้ำ); admin-only → is_accountant()=true → je_insert ผ่าน
//   - gated _isAfterEffective(period_end) + balance/zero/period-lock ผ่าน _postJournal
// ═══════════════════════════════════════════════════════════
/**
 * @param {string} periodStart - YYYY-MM-DD วันเริ่มรอบ (ใช้ filter staff_payroll)
 * @param {string} periodEnd   - YYYY-MM-DD วันสิ้นรอบ (docDate + idempotency key)
 * @param {object} [opts]
 * @param {string}  [opts.periodLabel] - label งวดสำหรับ description (ไม่มีชื่อพนักงาน)
 * @param {boolean} [opts.detailed]
 * @returns {Promise<number|null|object>} entry_id ถ้า post ใหม่ / null|result ถ้า skip
 */
export async function postPayrollPeriodJournal(periodStart, periodEnd, opts = {}) {
  const detailed = opts.detailed === true;
  if (!periodStart || !periodEnd) {
    return _journalResult(detailed, { status: "skipped", reason: "missing-period", sourceTable: "payroll_period" });
  }
  const docDate = dateBkk(periodEnd) || String(periodEnd).slice(0, 10);
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] payroll period before effective date, skip:", docDate);
    return _journalResult(detailed, { status: "skipped", reason: "pre-effective", sourceTable: "payroll_period", docDate });
  }

  const mappings = await _getMappings();
  const mapping = mappings["payroll_salary"];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for payroll_salary — รัน supabase mapping ก่อน");
    return _journalResult(detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "payroll_period" });
  }

  // โหลดเฉพาะแถวที่ "จ่ายแล้ว" ในงวดนี้ (ไม่ดึงชื่อ — แค่ยอด + วิธีจ่าย)
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  let rows = [];
  try {
    const r = await fetch(
      `${cfg.url}/rest/v1/staff_payroll?select=total_amount,payment_method&paid_at=not.is.null&period_start=eq.${encodeURIComponent(periodStart)}&period_end=eq.${encodeURIComponent(periodEnd)}`,
      { headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token } }
    );
    if (!r.ok) throw new Error("HTTP " + r.status);
    rows = await r.json();
  } catch (e) {
    console.error("[auto_post] payroll period fetch failed:", e?.message || e);
    return _journalResult(detailed, { status: "failed", reason: "fetch-failed", sourceTable: "payroll_period", error: String(e?.message || e) });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return _journalResult(detailed, { status: "skipped", reason: "no-paid-rows", sourceTable: "payroll_period" });
  }

  const label = (opts.periodLabel || `${periodStart} → ${periodEnd}`).toString().trim();
  const desc = `เงินเดือนพนักงาน — งวด ${label}`; // ★ ยอดรวม ไม่มีชื่อ/เงินเดือนรายคน
  const built = _buildPayrollPeriodLines(rows, mapping, desc);
  if (!built) {
    return _journalResult(detailed, { status: "skipped", reason: "zero-amount", sourceTable: "payroll_period" });
  }
  const { lines } = built;

  // source_id = YYYYMMDD ของ period_end (BIGINT) → idempotent ต่องวด
  const sourceId = parseInt(String(periodEnd).slice(0, 10).replace(/-/g, ""), 10);
  if (!Number.isFinite(sourceId)) {
    return _journalResult(detailed, { status: "failed", reason: "bad-period-key", sourceTable: "payroll_period" });
  }

  return _postJournal({
    sourceTable: "payroll_period",
    sourceId,
    docType: "PV",
    docDate,
    description: desc,
    lines,
    detailed
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Service job → JV (Phase 88.1b — stub for now, full impl. next session)
// ═══════════════════════════════════════════════════════════
/**
 * @param {object} job - service_jobs row (ต้องมี id, created_at, total_cost, job_type, status)
 */
export async function postJournalForServiceJob(job, opts = {}) {
  if (!job?.id || !job?.total_cost) return _journalResult(opts.detailed, { status: "skipped", reason: "missing-required", sourceTable: "service_jobs", sourceId: job?.id });
  // ★ Phase 411 (§4.3): งานที่ลบแล้ว (note มี "[ลบแล้ว]") ห้าม post JV — แม้ status
  //   ยัง done/delivered/closed ผ่าน filter ของ backfill มา (กัน JV รายได้ผี)
  if (String(job.note || "").includes("[ลบแล้ว]")) {
    console.info("[auto_post] skip deleted service job:", job.id);
    return _journalResult(opts.detailed, { status: "skipped", reason: "deleted", sourceTable: "service_jobs", sourceId: job.id });
  }
  // เฉพาะงานที่ปิดแล้ว (delivered / closed) เท่านั้น
  if (!["delivered", "closed", "done"].includes(String(job.status || "").toLowerCase())) {
    return _journalResult(opts.detailed, { status: "skipped", reason: "not-income-status", sourceTable: "service_jobs", sourceId: job.id });
  }

  const docDate = job.created_at ? dateBkk(job.created_at) : todayBkk();
  if (!_isAfterEffective(docDate)) {
    return _journalResult(opts.detailed, { status: "skipped", reason: "pre-effective", sourceTable: "service_jobs", sourceId: job.id, docDate });
  }

  const mappings = await _getMappings();
  const jt = String(job.job_type || "").toLowerCase();
  const keyMap = {
    ac:            "service_install_ac",
    install_ac:    "service_install_ac",
    repair_ac:     "service_repair_ac",
    clean_ac:      "service_clean_ac",
    move_ac:       "service_move_ac",
    // Phase 88.6: รองรับ 9 ประเภทงานช่างครบ
    satellite:     "service_satellite",
    repair_fridge: "service_repair_fridge",
    repair_washer: "service_repair_washer",
    cctv:          "service_cctv",
    repair_tv:     "service_repair_tv",
    // Phase 88.16: solar revenue → 4300 (เดิม fallback service_other → 4240)
    solar:         "service_solar",
    other:         "service_other"
  };
  const mappingKey = keyMap[jt] || "service_other";

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    return _journalResult(opts.detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "service_jobs", sourceId: job.id, mappingKey });
  }

  // ★ Phase 88.6: ถ้าระบุ payment_method = transfer/โอน → Dr 1130 (เงินฝากธนาคาร) แทน 1110 (เงินสด)
  let debitAccount = mapping.debit_account_code;
  const pm = String(job.payment_method || "").toLowerCase();
  if (/transfer|โอน|qr|bank/.test(pm)) debitAccount = "1130";

  const desc = `งานบริการ ${job.job_no || '#' + job.id} — ${job.customer_name || ''}`.trim();
  const amount = Number(job.total_cost);

  return _postJournal({
    sourceTable: "service_jobs",
    sourceId: job.id,
    docType: "SV",
    docDate,
    description: desc,
    detailed: opts.detailed,
    lines: [
      { account_code: debitAccount,                debit: amount, credit: 0,      description: desc },
      { account_code: mapping.credit_account_code, debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Receipt payment → JV (Phase 88.1b — รับชำระจากลูกหนี้)
// ═══════════════════════════════════════════════════════════
/**
 * เรียกหลัง PATCH receipts.status = "paid" สำเร็จ
 * @param {object} receipt - row จาก state.receipts (ต้องมี id, grand_total, payment_method หรือไม่ก็ได้)
 */
// Phase 443 (C): pure decision — which Dr account a transfer receipt's bank override should
// use. candidate valid (or COA cache empty = fail-open, DB FK is the backstop) → candidate;
// invalid / missing → mappingDefault. Pure (validCodes passed in) so the routing is unit-tested
// without fetch/cache. Caller uses the COA cache + logs/toasts the fallback.
export function _resolveReceiptDebitAccount(candidate, mappingDefault, validCodes) {
  if (!candidate) return mappingDefault;
  const c = String(candidate);
  if (!validCodes || validCodes.size === 0 || validCodes.has(c)) return c;
  return mappingDefault;
}

export async function postJournalForReceipt(receipt, opts = {}) {
  if (!receipt?.id) return _journalResult(opts.detailed, { status: "skipped", reason: "missing-required", sourceTable: "receipts", sourceId: receipt?.id });
  // ★ Phase 88.17: เฉพาะ status='paid' เท่านั้น — ป้องกัน JV เกิดจาก receipt ที่ยัง pending
  if (String(receipt.status || "").toLowerCase() !== "paid") {
    console.info("[auto_post] receipt not yet paid, skip:", receipt.id, receipt.status);
    return _journalResult(opts.detailed, { status: "skipped", reason: "not-paid", sourceTable: "receipts", sourceId: receipt.id });
  }
  const amountRaw = receipt.grand_total ?? receipt.total_amount ?? receipt.amount;
  if (!amountRaw) return _journalResult(opts.detailed, { status: "skipped", reason: "zero-amount", sourceTable: "receipts", sourceId: receipt.id });
  const docDate = (receipt.paid_at || receipt.receipt_date || receipt.created_at) ? dateBkk(receipt.paid_at || receipt.receipt_date || receipt.created_at) : todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] receipt before effective date, skip:", docDate);
    return _journalResult(opts.detailed, { status: "skipped", reason: "pre-effective", sourceTable: "receipts", sourceId: receipt.id, docDate });
  }

  const mappings = await _getMappings();
  const pm = String(receipt.payment_method || "").toLowerCase();
  // ★ Phase 408 cash-basis: รับรู้รายได้ที่ใบเสร็จ paid → Cr รายได้ 4150 (ไม่ใช่ตัด A/R 1200)
  //   ⚠️ ห้ามใช้ key receipt_payment/receipt_transfer (เดิม Cr 1200) — postJournalForCreditPayment ใช้ร่วม
  let mappingKey = "receipt_revenue_cash";  // default = เงินสด (Dr 1110 / Cr 4150)
  if (/transfer|โอน|qr|bank/.test(pm)) mappingKey = "receipt_revenue_transfer";  // (Dr 1130 / Cr 4150)

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for receipt:", mappingKey, "— ต้องรัน supabase-phase408-cashbasis.sql ก่อน");
    return _journalResult(opts.detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "receipts", sourceId: receipt.id, mappingKey });
  }

  // ★ Phase 443 (C): route the transfer JV to the receipt's specific bank sub-account
  //   (Dr e.g. 1132 instead of flat 1130). Mirrors the sale_transfer BANK_COA pattern
  //   (Phase 88.20/89.2): validate against active COA; invalid → warn + fall back to the
  //   mapping default (never post a JV to a bogus account, never silent). Uses bank_coa_code
  //   only — bank_label is display/snapshot, never parsed for accounting.
  let debitAccount = mapping.debit_account_code;
  if (mappingKey === "receipt_revenue_transfer" && receipt.bank_coa_code) {
    const candidate = String(receipt.bank_coa_code);
    const validCodes = await _getValidCoaCodes();
    debitAccount = _resolveReceiptDebitAccount(candidate, mapping.debit_account_code, validCodes);
    if (debitAccount === candidate) {
      console.info("[auto_post] receipt transfer override Dr account:", debitAccount, "(from receipt.bank_coa_code)");
    } else {
      console.warn("[auto_post] receipt bank_coa_code invalid:", candidate, "— falling back to default", mapping.debit_account_code);
      if (window.showToast) window.showToast(`⚠️ COA ${candidate} ไม่พบ — ใช้ default ${mapping.debit_account_code} แทน`);
    }
  }
  // transfer with no bank_coa_code → debitAccount stays the mapping default (1130); the
  // collect-time UI already warned (Phase 442 _confirmTransferBankSet).

  const desc = `รับชำระ ${receipt.receipt_no || '#' + receipt.id} — ${receipt.customer_name || 'ลูกค้า'}`;
  const amount = Number(amountRaw);

  // ★ Phase 408: VAT split — ถ้า receipt มี vat_amount > 0 → แยก JV 3 บรรทัด (เลียนแบบ postJournalForSale)
  //   ตอนนี้ระบบยังไม่จด VAT ที่ใบเสร็จ (vat_amount = 0) → ลง 2 บรรทัดปกติ (Dr cash / Cr 4150 เต็มยอด)
  const vatAmount = Number(receipt.vat_amount || 0);
  if (vatAmount > 0.01) {
    const v = splitSaleVatLines(amount, vatAmount);  // total = subtotal + vat เป๊ะ
    return _postJournal({
      sourceTable: "receipts",
      sourceId: receipt.id,
      docType: "RV",
      docDate,
      description: desc,
      detailed: opts.detailed,
      lines: [
        { account_code: debitAccount,                debit: v.total, credit: 0,          description: desc },
        { account_code: mapping.credit_account_code, debit: 0,       credit: v.subtotal, description: desc + " (รายได้ก่อน VAT)" },
        { account_code: "2170",                       debit: 0,       credit: v.vat,      description: desc + ` (VAT ${receipt.vat_rate || 7}%)` }
      ]
    });
  }

  // ไม่มี VAT — 2 บรรทัด (Dr เงินสด/ธนาคาร / Cr รายได้ 4150 เต็มยอด)
  return _postJournal({
    sourceTable: "receipts",
    sourceId: receipt.id,
    docType: "RV",
    docDate,
    description: desc,
    detailed: opts.detailed,
    lines: [
      { account_code: debitAccount,                debit: amount, credit: 0,      description: desc },
      { account_code: mapping.credit_account_code, debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Delivery Invoice → JV (Phase 88.18 — B2B revenue)
// ═══════════════════════════════════════════════════════════
/**
 * เรียกหลังออกใบส่งสินค้า/ใบแจ้งหนี้ — ลง revenue ที่นี่ (ไม่ใช่ตอนรับเงิน)
 * Dr ลูกหนี้การค้า (1200) / Cr รายได้ B2B (4150)
 *
 * Receipts ที่อ้างอิง invoice นี้ → Cr 1200 (ตัดลูกหนี้) ตามปกติ
 *
 * @param {object} invoice - row จาก state.deliveryInvoices
 *   ต้องมี: id, inv_no, customer_name, grand_total, created_at, status
 */
export async function postJournalForDeliveryInvoice(invoice) {
  // Phase 408 cash-basis: รายได้ย้ายไปที่ใบเสร็จ paid — invoice ไม่ลง revenue แล้ว
  //   คงฟังก์ชัน + import ไว้ (backfill.js ยังอ้าง) แต่ no-op เพื่อกัน double-count
  return null;
  // eslint-disable-next-line no-unreachable -- Phase 408: legacy accrual path kept for reference
  if (!invoice?.id) return null;
  // skip ถ้าใบนี้ยกเลิก
  if (String(invoice.status || "").toLowerCase() === "cancelled") return null;

  const amount = Number(invoice.grand_total || invoice.total_amount || invoice.after_discount || 0);
  if (amount < 0.01) return null;

  const docDate = invoice.created_at ? dateBkk(invoice.created_at) : todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] invoice before effective date, skip:", docDate);
    return null;
  }

  const mappings = await _getMappings();
  const mapping = mappings["invoice_credit"];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for invoice_credit");
    return null;
  }

  const desc = `ใบส่งสินค้า ${invoice.inv_no || '#' + invoice.id} — ${invoice.customer_name || ''}`.trim();

  return _postJournal({
    sourceTable: "delivery_invoices",
    sourceId: invoice.id,
    docType: "SV",
    docDate,
    description: desc,
    lines: [
      { account_code: mapping.debit_account_code,  debit: amount, credit: 0,      description: desc },
      { account_code: mapping.credit_account_code, debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Credit payment → JV (Phase 89.29 — audit C2 fix)
// ═══════════════════════════════════════════════════════════
/**
 * เรียกหลัง INSERT credit_payments (รับชำระลูกหนี้บางส่วน/ทั้งหมด).
 * Dr 1110 (เงินสด) หรือ 1130 (เงินฝาก) / Cr 1200 (ลูกหนี้การค้า)
 *
 * Audit C2: เดิม credit_tracker PATCH sales.credit_paid_amount เฉยๆ
 *           → A/R ใน Balance Sheet ค้างถาวร. ตอนนี้ post JV ตัด A/R ด้วย.
 *
 * @param {object} payment - row จาก credit_payments หลัง insert
 *   ต้องมี: id, sale_id, customer_id, amount, payment_method, note?, paid_at?
 */
export async function postJournalForCreditPayment(payment, opts = {}) {
  if (!payment?.id || !payment?.amount) return _journalResult(opts.detailed, { status: "skipped", reason: "missing-required", sourceTable: "credit_payments", sourceId: payment?.id });
  const amount = Number(payment.amount);
  if (amount < 0.01) return _journalResult(opts.detailed, { status: "skipped", reason: "zero-amount", sourceTable: "credit_payments", sourceId: payment.id });

  const docDate = payment.paid_at ? dateBkk(payment.paid_at)
                                  : payment.created_at ? dateBkk(payment.created_at)
                                                       : todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] credit payment before effective date, skip:", docDate);
    return _journalResult(opts.detailed, { status: "skipped", reason: "pre-effective", sourceTable: "credit_payments", sourceId: payment.id, docDate });
  }

  const mappings = await _getMappings();
  const pm = String(payment.payment_method || "").toLowerCase();
  // Reuse receipt mappings — same Dr/Cr structure (Dr Cash/Bank / Cr A/R 1200)
  let mappingKey = "receipt_payment";
  if (/transfer|โอน|qr|bank/.test(pm)) mappingKey = "receipt_transfer";

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for credit_payment:", mappingKey);
    return _journalResult(opts.detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "credit_payments", sourceId: payment.id, mappingKey });
  }

  const saleRef = payment.sale_order_no || (payment.sale_id ? `#${payment.sale_id}` : "");
  const desc = `ชำระลูกหนี้ ${saleRef} — ${payment.customer_name || ''}`.trim();

  return _postJournal({
    sourceTable: "credit_payments",
    sourceId: payment.id,
    docType: "RV",
    docDate,
    description: desc,
    detailed: opts.detailed,
    lines: [
      { account_code: mapping.debit_account_code,  debit: amount, credit: 0,      description: desc },
      { account_code: mapping.credit_account_code, debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Refund → JV (Phase 89.29 — audit C3 fix)
// ═══════════════════════════════════════════════════════════
/**
 * เรียกหลัง INSERT refunds.
 * Dr 4110 (รับคืน/ส่วนลดจ่าย — contra-revenue) / Cr Cash/Bank/2180 ตามวิธีคืน
 *
 * Audit C3: เดิม refund ไม่ post JV → P&L รายได้เกินจริง
 *
 * @param {object} refund - row จาก refunds หลัง insert
 *   ต้องมี: id, refund_no, sale_id, customer_id, customer_name, refund_amount,
 *           refund_method, created_at?
 */
export async function postJournalForRefund(refund, opts = {}) {
  if (!refund?.id || !refund?.refund_amount) return _journalResult(opts.detailed, { status: "skipped", reason: "missing-required", sourceTable: "refunds", sourceId: refund?.id });
  const amount = Number(refund.refund_amount);
  if (amount < 0.01) return _journalResult(opts.detailed, { status: "skipped", reason: "zero-amount", sourceTable: "refunds", sourceId: refund.id });

  const docDate = refund.created_at ? dateBkk(refund.created_at) : todayBkk();
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] refund before effective date, skip:", docDate);
    return _journalResult(opts.detailed, { status: "skipped", reason: "pre-effective", sourceTable: "refunds", sourceId: refund.id, docDate });
  }

  const mappings = await _getMappings();
  const mappingKey = refundMappingKeyForMethod(refund.refund_method);
  if (!mappingKey) {
    console.warn("[auto_post] unknown refund method:", refund.refund_method, "for refund", refund.id);
    return _journalResult(opts.detailed, { status: "failed", reason: "unknown-refund-method", sourceTable: "refunds", sourceId: refund.id, refundMethod: refund.refund_method || null });
  }

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for refund:", mappingKey, "— run supabase-phase89-29-jv-gaps.sql");
    return _journalResult(opts.detailed, { status: "skipped", reason: "missing-mapping", sourceTable: "refunds", sourceId: refund.id, mappingKey });
  }

  const desc = `คืน ${refund.refund_no || '#' + refund.id} — ${refund.customer_name || ''}`.trim();

  return _postJournal({
    sourceTable: "refunds",
    sourceId: refund.id,
    docType: "JV",
    docDate,
    description: desc,
    detailed: opts.detailed,
    lines: [
      { account_code: mapping.debit_account_code,  debit: amount, credit: 0,      description: desc },
      { account_code: mapping.credit_account_code, debit: 0,      credit: amount, description: desc }
    ]
  });
}
