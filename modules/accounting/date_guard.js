// ═══════════════════════════════════════════════════════════
//  accounting/date_guard.js — journal date range guard (Phase 385 Part A)
//
//  WHY: A journal entry was saved with doc_date year 2069 (CE) instead of 2026
//       (PV2069050001 — "จ่าย: บริษัท แมกซ์ การ์ด จำกัด", 988.00). One bad year
//       cascaded into three symptoms:
//         1) doc_no generated from doc_date year → PV2069… instead of PV2026…
//         2) display date shows BE 2-digit "12" (2069+543 = 2612 พ.ศ.)
//         3) sorts to top of สมุดรายวัน (year 2069 > every other row)
//       Net money impact: the 988 expense lands in fiscal year 2069 and is
//       EXCLUDED from every 2026 financial statement → 2026 expenses understated
//       by 988, cash overstated by 988.
//
//  THIS MODULE IS PURE: zero DOM, zero network, zero module state.
//    - validateJournalDate(dateInput, {today, min}) → {ok, code}
//    - findOutOfRangeEntries(entries, {today, min}) → array (read-only detector)
//
//  Part A does PREVENTION (block bad save) + READ-ONLY DETECTION only.
//  It does NOT mutate any existing record. Fixing PV2069050001 itself is a
//  separate owner-gated money-path phase (Phase 385 Part B).
// ═══════════════════════════════════════════════════════════

// Lower bound for a sane journal date. The accounting system started in 2026;
// 2020 leaves slack for legitimate opening-balance backdating while still
// catching obviously-wrong years (e.g. 1969, 0202, 2-digit typos).
export const MIN_JOURNAL_DATE = "2020-01-01";

// Strict YYYY-MM-DD parse. Returns {y, mo, d} or null. Rejects anything that is
// not exactly a 10-char ISO calendar date with in-range month/day.
function parseYmd(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, mo, d };
}

/**
 * Validate a journal entry's doc_date string (CE, "YYYY-MM-DD").
 *
 * @param {string} dateInput - the doc_date as stored/entered (CE calendar)
 * @param {{today?: string, min?: string}} [opts]
 *        today: today's date in Asia/Bangkok as "YYYY-MM-DD" (CE). When omitted,
 *               future-date checks are skipped (format + lower-bound still run).
 *        min:   inclusive lower bound (default MIN_JOURNAL_DATE).
 * @returns {{ok: boolean, code: string}}
 *          code ∈ "ok" | "invalid_format" | "future_year" | "future_date" | "too_old"
 */
export function validateJournalDate(dateInput, opts = {}) {
  const today = (typeof opts.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.today)) ? opts.today : null;
  const min = (typeof opts.min === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.min)) ? opts.min : MIN_JOURNAL_DATE;

  const p = parseYmd(dateInput);
  if (!p) return { ok: false, code: "invalid_format" };

  if (today) {
    const todayYear = Number(today.slice(0, 4));
    // Distinct "future_year" code so the UI can hint at พ.ศ./ค.ศ. confusion —
    // the exact failure mode behind PV2069050001.
    if (p.y > todayYear) return { ok: false, code: "future_year" };
    // Same-format ISO strings compare correctly lexicographically.
    if (dateInput > today) return { ok: false, code: "future_date" };
  }

  if (dateInput < min) return { ok: false, code: "too_old" };

  return { ok: true, code: "ok" };
}

// Thai, user-facing messages keyed by validate code. Honest + actionable.
export const JOURNAL_DATE_ERRORS = {
  invalid_format: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น ปปปป-ดด-วว)",
  future_year: "ปีของวันที่เกินปีปัจจุบัน — ตรวจสอบว่ากรอกเป็น ค.ศ. ไม่ใช่ พ.ศ.",
  future_date: "วันที่ล่วงหน้าเกินวันนี้ — บันทึกบัญชีล่วงหน้าไม่ได้",
  too_old: "วันที่เก่าเกินกำหนด (ก่อนปี 2020) — ตรวจสอบปีอีกครั้ง",
};

/**
 * Scan already-stored journal entries for out-of-range doc_date (read-only).
 * Used to surface ALL corrupt-date rows (e.g. PV2069050001), not just block new
 * ones. Does NOT mutate input or any record.
 *
 * @param {Array<object>} entries - journal_entries rows (need doc_date; doc_no,
 *        total_debit/total_credit, description optional for display).
 * @param {{today?: string, min?: string}} [opts]
 * @returns {Array<{doc_no:?string, doc_date:?string, amount:number, description:string, code:string}>}
 *          subset, in original order.
 */
export function findOutOfRangeEntries(entries, opts = {}) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const v = validateJournalDate(e.doc_date, opts);
    if (!v.ok) {
      out.push({
        doc_no: e.doc_no ?? null,
        doc_date: e.doc_date ?? null,
        amount: Number(e.total_debit ?? e.total_credit ?? 0),
        description: typeof e.description === "string" ? e.description : "",
        code: v.code,
      });
    }
  }
  return out;
}
