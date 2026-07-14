// ═══════════════════════════════════════════════════════════
//  Phase 606-b1 — ตัวตรวจ "JV ของงานบริการถูกต้องจริงไหม" (pure · ไม่มี DOM/network)
// ═══════════════════════════════════════════════════════════
//  ทำไมต้องมี: "มีแถวใน journal_entries" ≠ "ลงบัญชีถูก". header ที่เป็น draft / ไม่มี lines /
//  บัญชีผิด / ยอดผิด ต้องไม่ถูกนับว่า OK — ไม่งั้นเราจะรับเงินทับลูกหนี้ที่ไม่มีจริง หรือกลับรายการ
//  ทับ JV ที่พังอยู่แล้ว. ตัวนี้เป็น **แหล่งความจริงเดียว** ที่ writer / reconcile ใช้ร่วมกัน
//  (ฝั่ง DB มีคู่แฝดใน supabase-phase606b1-service-payment-guards.sql — มี drift guard)

export const JV_OK = "ok";
export const JV_NO_HEADER          = "no-header";            // ไม่มี JE เลย → auto-repair ได้
export const JV_NOT_APPROVED       = "not-approved";         // draft/void → ต้องให้คนตรวจ
export const JV_NO_LINES           = "no-lines";             // header ลอย (ไม่มี lines)
export const JV_UNBALANCED         = "unbalanced";
export const JV_HEADER_MISMATCH    = "header-mismatch";      // lines ≠ header
export const JV_AMOUNT_MISMATCH    = "amount-mismatch";      // ≠ ยอดจริงของ source
export const JV_ACCOUNT_MISMATCH   = "account-mismatch";     // บัญชีผิดจากที่ต้องเป็น
export const JV_EXTRA_LINES        = "extra-lines";          // มีบรรทัดเกิน 2 (บัญชีแปลกปลอม)

// ★ review#3 (should-fix 2): fail-closed กับตัวเลข — null/undefined/""/NaN/Infinity = **ไม่ใช่ 0**
//   (Number(x) || 0 ทำให้ค่าที่หายกลายเป็น 0 แล้ว "บาลานซ์" ได้เอง = ความจริงปลอม)
export const JV_BAD_NUMBER = "bad-number";
function num(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const r2 = (n) => { const v = num(n); return Number.isNaN(v) ? NaN : v; };
const zeroish = (v) => { const n = num(v); return Number.isNaN(n) ? NaN : n; };

/**
 * ตรวจ JV 2 ขา (Dr X / Cr Y ยอดเท่ากันทั้งคู่) แบบ **exact** — ไม่มี find() บรรทัดแรก
 * ทุกตัวเลขต้อง finite จริง (หาย/NaN = ไม่ผ่าน) · บรรทัดที่ไม่เป็นศูนย์ต้องมี 2 บรรทัดพอดี
 * @returns {{ok:boolean, reason:string}}
 */
export function validateTwoLegJv({ entry, lines, amount, debitCode, creditCode }) {
  if (!entry) return { ok: false, reason: JV_NO_HEADER };
  if (String(entry.status || "").toLowerCase() !== "approved") return { ok: false, reason: JV_NOT_APPROVED };
  if (!debitCode || !creditCode) return { ok: false, reason: JV_ACCOUNT_MISMATCH };

  const amt = num(amount);
  if (Number.isNaN(amt) || amt <= 0) return { ok: false, reason: JV_BAD_NUMBER };

  const all = Array.isArray(lines) ? lines : [];
  // ★ review#4 (blocking 2): ทุกบรรทัดบัญชีต้องมี **ทั้ง** debit และ credit และเป็นตัวเลข finite ทั้งคู่
  //   field ที่หายไป (undefined) ก็คือ "อ่านข้อมูลมาไม่ครบ" ไม่ใช่ 0 → fail-closed
  //   (เดิม undefined → 0 ทำให้ read-back ที่ malformed กลายเป็น duplicate-valid ได้)
  for (const l of all) {
    if (!l || !("debit" in l) || !("credit" in l)) return { ok: false, reason: JV_BAD_NUMBER };
    if (Number.isNaN(zeroish(l.debit)) || Number.isNaN(zeroish(l.credit))) return { ok: false, reason: JV_BAD_NUMBER };
  }
  const ls = all.filter(l => num(l.debit) !== 0 || num(l.credit) !== 0);
  if (!ls.length) return { ok: false, reason: JV_NO_LINES };
  if (ls.length !== 2) return { ok: false, reason: JV_EXTRA_LINES };   // split line / บัญชีแปลกปลอม = ไม่ผ่าน

  const sumD = r2(ls.reduce((s, l) => s + num(l.debit), 0));
  const sumC = r2(ls.reduce((s, l) => s + num(l.credit), 0));
  if (Number.isNaN(sumD) || Number.isNaN(sumC)) return { ok: false, reason: JV_BAD_NUMBER };
  if (sumD !== sumC) return { ok: false, reason: JV_UNBALANCED };

  // header ต้องมี **ทั้ง** total_debit และ total_credit และตรงกับ lines (หาย = fail-closed ห้ามเดา)
  const hD = num(entry.total_debit);
  const hC = num(entry.total_credit);
  if (Number.isNaN(hD) || Number.isNaN(hC)) return { ok: false, reason: JV_BAD_NUMBER };
  if (hD !== sumD || hC !== sumC) return { ok: false, reason: JV_HEADER_MISMATCH };
  if (sumD !== amt) return { ok: false, reason: JV_AMOUNT_MISMATCH };

  const dr = ls.filter(l => num(l.debit) > 0);
  const cr = ls.filter(l => num(l.credit) > 0);
  if (dr.length !== 1 || cr.length !== 1) return { ok: false, reason: JV_EXTRA_LINES };
  if (num(dr[0].debit) !== amt || num(cr[0].credit) !== amt) return { ok: false, reason: JV_AMOUNT_MISMATCH };
  if (String(dr[0].account_code) !== String(debitCode)) return { ok: false, reason: JV_ACCOUNT_MISMATCH };
  if (String(cr[0].account_code) !== String(creditCode)) return { ok: false, reason: JV_ACCOUNT_MISMATCH };

  return { ok: true, reason: JV_OK, debitCode: String(dr[0].account_code), creditCode: String(cr[0].account_code), amount: amt };
}

/** JV รับรู้รายได้ของงาน (flow v2): Dr 1200 ลูกหนี้ / Cr รายได้ 42xx = total_cost */
export function validateRecognitionJv({ job, mapping, entry, lines }) {
  if (!job || !mapping?.recognition_debit_code || !mapping?.credit_account_code) {
    return { ok: false, reason: JV_ACCOUNT_MISMATCH };
  }
  return validateTwoLegJv({
    entry, lines,
    amount: job.total_cost,
    debitCode: mapping.recognition_debit_code,
    creditCode: mapping.credit_account_code
  });
}

/** JV รับเงิน: Dr เงินสด/ธนาคาร "ตามที่ ledger บันทึก" / Cr 1200 = payment.amount */
export function paymentDebitCode(payment, mapping) {
  const method = String(payment?.payment_method || "").toLowerCase();
  if (method === "transfer") return payment?.bank_coa_code ? String(payment.bank_coa_code) : null;
  if (method === "cash") return mapping?.debit_account_code ? String(mapping.debit_account_code) : null;
  return null;
}

export function validatePaymentJv({ payment, mapping, entry, lines }) {
  const debitCode = paymentDebitCode(payment, mapping);
  if (!debitCode || !mapping?.recognition_debit_code) return { ok: false, reason: JV_ACCOUNT_MISMATCH };
  return validateTwoLegJv({
    entry, lines,
    amount: payment?.amount,
    debitCode,
    creditCode: mapping.recognition_debit_code
  });
}

/** JV กลับรายการ: Dr 1200 / Cr บัญชีเงินเดิม = reversal.amount */
export function validateReversalJv({ reversal, paymentDebit, recognitionCode, entry, lines }) {
  if (!paymentDebit || !recognitionCode) return { ok: false, reason: JV_ACCOUNT_MISMATCH };
  return validateTwoLegJv({
    entry, lines,
    amount: reversal?.amount,
    debitCode: recognitionCode,
    creditCode: paymentDebit
  });
}

/**
 * ★ review#5 (blocking 5): JV ของงาน flow v1 (legacy) — Dr เงินสด/ธนาคาร ตาม payment_method เดิม
 *   บัญชีไม่ผูกตายตัว (mapping/ช่องทางเปลี่ยนได้ในอดีต) จึงไม่บังคับ account code แบบ v2
 *   แต่ **ความเข้มเรื่องตัวเลขต้องเท่ากัน**: approved · lines ครบและ finite · บาลานซ์ ·
 *   header ครบและตรง lines · ยอด = total_cost. missing/null/""/NaN/Infinity = bad-number (ไม่ใช่ 0)
 */
export function validateLegacyServiceJv({ job, entry, lines }) {
  if (!entry) return { ok: false, reason: JV_NO_HEADER };
  if (String(entry.status || "").toLowerCase() !== "approved") return { ok: false, reason: JV_NOT_APPROVED };

  const amt = num(job?.total_cost);
  if (Number.isNaN(amt) || amt <= 0) return { ok: false, reason: JV_BAD_NUMBER };

  const all = Array.isArray(lines) ? lines : [];
  for (const l of all) {
    if (!l || !("debit" in l) || !("credit" in l)) return { ok: false, reason: JV_BAD_NUMBER };
    if (Number.isNaN(zeroish(l.debit)) || Number.isNaN(zeroish(l.credit))) return { ok: false, reason: JV_BAD_NUMBER };
  }
  const ls = all.filter(l => num(l.debit) !== 0 || num(l.credit) !== 0);
  if (!ls.length) return { ok: false, reason: JV_NO_LINES };

  const sumD = r2(ls.reduce((s, l) => s + num(l.debit), 0));
  const sumC = r2(ls.reduce((s, l) => s + num(l.credit), 0));
  if (Number.isNaN(sumD) || Number.isNaN(sumC)) return { ok: false, reason: JV_BAD_NUMBER };
  if (sumD !== sumC) return { ok: false, reason: JV_UNBALANCED };

  const hD = num(entry.total_debit);
  const hC = num(entry.total_credit);
  if (Number.isNaN(hD) || Number.isNaN(hC)) return { ok: false, reason: JV_BAD_NUMBER };
  if (hD !== sumD || hC !== sumC) return { ok: false, reason: JV_HEADER_MISMATCH };
  if (sumD !== amt) return { ok: false, reason: JV_AMOUNT_MISMATCH };

  return { ok: true, reason: JV_OK, amount: amt };
}

/**
 * ★ review#5 (should-fix 6): ผลของ writer → ข้อความเดียวกันทุกปุ่ม (re-post งาน / ซ่อม ledger)
 *   duplicate-invalid = **ไม่สำเร็จ** ห้ามสื่อว่าซ่อมแล้ว
 */
export function jvResultToToast(res) {
  const reason = String(res?.reason || "");
  if (res?.status === "posted") {
    return { kind: "success", message: `✅ ลงบัญชีแล้ว (JE #${res.entryId || res.docNo || ""})`.trim() };
  }
  if (reason === "duplicate-valid") {
    return { kind: "success", message: "✅ มีรายการบัญชีที่ถูกต้องอยู่แล้ว (ไม่สร้างซ้ำ)" };
  }
  if (reason.startsWith("duplicate-invalid:")) {
    return { kind: "error", message: `⛔ มีรายการบัญชีค้างอยู่แต่ไม่ถูกต้อง (${reason.split(":")[1]}) — ต้องตรวจบัญชีด้วยคน` };
  }
  if (reason === "duplicate") {                       // legacy flow v1 (ไม่มี read-back)
    return { kind: "info", message: "มีรายการบัญชีอยู่แล้ว (ไม่สร้างซ้ำ)" };
  }
  if (reason === "recognition-date-required") {
    return { kind: "error", message: "⛔ งานนี้ไม่มีวันรับรู้รายได้ (closed_at) — ต้องให้เจ้าของกำหนดวันผ่าน recovery ก่อน" };
  }
  if (reason === "finance-flow-unknown") {
    return { kind: "error", message: "⛔ ข้อมูล finance flow ของงานนี้ไม่ครบ — ลงบัญชีไม่ได้ (แจ้งผู้ดูแล)" };
  }
  if (reason === "not-income-status") {
    return { kind: "error", message: "⛔ งานนี้ยังไม่ส่งมอบ — ยังรับรู้รายได้ไม่ได้" };
  }
  return { kind: "error", message: `ยังไม่สำเร็จ (${reason || "unknown"}) — ดู Console` };
}

/** taxonomy ที่ reconcile ใช้ — header หายเท่านั้นที่ auto-repair ได้ (unique source index กันยิงทับ) */
export function ledgerStateOf(validation) {
  if (validation?.ok) return "OK";
  switch (validation?.reason) {
    case JV_NO_HEADER:    return "NO_JV";           // ← ปุ่มซ่อมอัตโนมัติได้
    case JV_NOT_APPROVED: return "NON_APPROVED";    // ← manual (มี header อยู่ ยิงทับไม่ได้)
    default:              return "MISMATCH";        // no-lines / unbalanced / account / amount / extra
  }
}
export const AUTO_REPAIRABLE_STATES = ["NO_JV"];
