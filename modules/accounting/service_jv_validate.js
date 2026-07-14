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

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nonZero = (lines) => (Array.isArray(lines) ? lines : []).filter(l => r2(l?.debit) !== 0 || r2(l?.credit) !== 0);

/**
 * ตรวจ JV 2 ขา (Dr X / Cr Y ยอดเท่ากันทั้งคู่) แบบ **exact** — ไม่มี find() บรรทัดแรก
 * @returns {{ok:boolean, reason:string}}
 */
export function validateTwoLegJv({ entry, lines, amount, debitCode, creditCode }) {
  if (!entry) return { ok: false, reason: JV_NO_HEADER };
  if (String(entry.status || "").toLowerCase() !== "approved") return { ok: false, reason: JV_NOT_APPROVED };

  const amt = r2(amount);
  const ls = nonZero(lines);
  if (!ls.length) return { ok: false, reason: JV_NO_LINES };
  if (ls.length !== 2) return { ok: false, reason: JV_EXTRA_LINES };   // 2 ขาเป๊ะ — บัญชีแปลกปลอม = ไม่ผ่าน

  const sumD = r2(ls.reduce((s, l) => s + r2(l.debit), 0));
  const sumC = r2(ls.reduce((s, l) => s + r2(l.credit), 0));
  if (sumD !== sumC) return { ok: false, reason: JV_UNBALANCED };
  if (r2(entry.total_debit) !== sumD || r2(entry.total_credit ?? sumC) !== sumC) return { ok: false, reason: JV_HEADER_MISMATCH };
  if (sumD !== amt || amt <= 0) return { ok: false, reason: JV_AMOUNT_MISMATCH };

  const dr = ls.filter(l => r2(l.debit) > 0);
  const cr = ls.filter(l => r2(l.credit) > 0);
  if (dr.length !== 1 || cr.length !== 1) return { ok: false, reason: JV_EXTRA_LINES };
  if (r2(dr[0].debit) !== amt || r2(cr[0].credit) !== amt) return { ok: false, reason: JV_AMOUNT_MISMATCH };
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
