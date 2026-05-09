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

const ACCOUNTING_EFFECTIVE_DATE = "2026-01-01";

let _mappingCache = null;

/**
 * Reset mapping cache — เรียกหลัง admin แก้ account_mapping ใน DB
 */
export function resetMappingCache() {
  _mappingCache = null;
}

/**
 * ★ Phase 88.10: Void/delete JV for given source (เพื่อ re-post หลัง user แก้ amount/method)
 * ใช้ pattern DELETE + repost — ง่ายกว่า in-place update
 * เรียกก่อน postJournalForX(...) ตอน edit existing source row
 *
 * @returns {Promise<number>} จำนวน entries ที่ถูกลบ
 */
export async function voidJvForSource(sourceTable, sourceId) {
  if (!sourceTable || !sourceId) return 0;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = {
    "apikey": cfg.anonKey,
    "Authorization": "Bearer " + token,
    "Prefer": "return=representation"
  };
  try {
    // DELETE — lines จะถูกลบอัตโนมัติเพราะ FK ON DELETE CASCADE
    const r = await fetch(`${cfg.url}/rest/v1/journal_entries?source_table=eq.${encodeURIComponent(sourceTable)}&source_id=eq.${sourceId}`, {
      method: "DELETE",
      headers
    });
    if (!r.ok) {
      console.warn(`[auto_post] failed to void JV for ${sourceTable}#${sourceId}:`, r.status);
      return 0;
    }
    const deleted = await r.json().catch(() => []);
    const count = Array.isArray(deleted) ? deleted.length : 0;
    if (count > 0) {
      console.info(`[auto_post] voided ${count} JV(s) for ${sourceTable}#${sourceId} (will re-post)`);
    }
    return count;
  } catch(e) {
    console.warn(`[auto_post] void JV error:`, e?.message);
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
    _mappingCache = {};
    arr.forEach(m => { _mappingCache[m.mapping_key] = m; });
    return _mappingCache;
  } catch(e) {
    console.warn("[auto_post] cannot load mappings:", e.message);
    return {};
  }
}

function _isAfterEffective(dateStr) {
  if (!dateStr) return false;
  return String(dateStr).slice(0, 10) >= ACCOUNTING_EFFECTIVE_DATE;
}


// ═══════════════════════════════════════════════════════════
// Core: post a journal entry + lines
// ═══════════════════════════════════════════════════════════
async function _postJournal(opts) {
  const { sourceTable, sourceId, docType, docDate, description, lines } = opts;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  // Validate balanced
  const totalDebit  = lines.reduce((s, l) => s + Number(l.debit  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    console.error("[auto_post] unbalanced:", { totalDebit, totalCredit, sourceTable, sourceId });
    return null;
  }
  if (totalDebit < 0.01) {
    console.warn("[auto_post] zero amount, skipping:", sourceTable, sourceId);
    return null;
  }

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
  let entryId = null;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/journal_entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token,
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
      return null;
    }
    if (!r.ok) {
      const txt = await r.text();
      // Postgres unique violation surfaces as 409 in PostgREST, but check error code too
      if (txt.includes("idx_je_source_unique") || txt.includes("23505")) {
        console.info("[auto_post] JV already exists (via error):", sourceTable, sourceId);
        return null;
      }
      throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }
    const arr = await r.json();
    entryId = arr[0]?.id;
    if (!entryId) throw new Error("no id returned");
  } catch(e) {
    console.error("[auto_post] entry insert failed:", e.message);
    return null;
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
    const r = await fetch(`${cfg.url}/rest/v1/journal_lines`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(lineData)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } catch(e) {
    console.error("[auto_post] lines insert failed (entry " + entryId + " ค้าง — ไม่มี lines):", e.message);
    // ไม่ rollback entry — admin จะเห็น "JV ไม่มี lines" ใน UI และแก้เอง
    return null;
  }

  console.info("[auto_post] ✅ created", docNo, "from", sourceTable, "#" + sourceId, "amount", totalDebit);
  return entryId;
}


// ═══════════════════════════════════════════════════════════
// Public: POS sale → JV
// ═══════════════════════════════════════════════════════════
/**
 * @param {object} sale - row จาก state.sales (ต้องมี id, created_at, grand_total, payment_method)
 */
export async function postJournalForSale(sale) {
  // ★ Boonsook sales ใช้ total_amount; quotations ใช้ grand_total — รองรับทั้งคู่
  const amountRaw = sale?.total_amount ?? sale?.grand_total;
  if (!sale?.id || !amountRaw) return null;
  const docDate = (sale.created_at || new Date().toISOString()).slice(0, 10);
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] sale before effective date, skip:", docDate);
    return null;
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
    return null;
  }

  const desc = `ขาย POS ${sale.order_no || '#' + sale.id} — ${sale.customer_name || 'ลูกค้าทั่วไป'}`;
  const amount = Number(amountRaw);

  return _postJournal({
    sourceTable: "sales",
    sourceId: sale.id,
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
export async function postJournalForExpense(expense) {
  if (!expense?.id || !expense?.amount) return null;
  const docDate = (expense.expense_date || expense.created_at || new Date().toISOString()).slice(0, 10);
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] expense before effective date, skip:", docDate);
    return null;
  }

  const mappings = await _getMappings();
  const cat = String(expense.category || "").toLowerCase().trim();
  const mappingKey = EXPENSE_CATEGORY_MAP[cat] || "expense_misc";

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for expense category:", cat);
    return null;
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
    lines: [
      { account_code: mapping.debit_account_code, debit: amount, credit: 0,      description: desc },
      { account_code: creditAccount,              debit: 0,      credit: amount, description: desc }
    ]
  });
}


// ═══════════════════════════════════════════════════════════
// Public: Service job → JV (Phase 88.1b — stub for now, full impl. next session)
// ═══════════════════════════════════════════════════════════
/**
 * @param {object} job - service_jobs row (ต้องมี id, created_at, total_cost, job_type, status)
 */
export async function postJournalForServiceJob(job) {
  if (!job?.id || !job?.total_cost) return null;
  // เฉพาะงานที่ปิดแล้ว (delivered / closed) เท่านั้น
  if (!["delivered", "closed", "done"].includes(String(job.status || "").toLowerCase())) return null;

  const docDate = (job.created_at || new Date().toISOString()).slice(0, 10);
  if (!_isAfterEffective(docDate)) return null;

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
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) return null;

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
export async function postJournalForReceipt(receipt) {
  if (!receipt?.id) return null;
  const amountRaw = receipt.grand_total ?? receipt.total_amount ?? receipt.amount;
  if (!amountRaw) return null;
  const docDate = (receipt.paid_at || receipt.receipt_date || receipt.created_at || new Date().toISOString()).slice(0, 10);
  if (!_isAfterEffective(docDate)) {
    console.info("[auto_post] receipt before effective date, skip:", docDate);
    return null;
  }

  const mappings = await _getMappings();
  const pm = String(receipt.payment_method || "").toLowerCase();
  let mappingKey = "receipt_payment";  // default = เงินสด (Dr 1110 / Cr 1200)
  if (/transfer|โอน|qr|bank/.test(pm)) mappingKey = "receipt_transfer";

  const mapping = mappings[mappingKey];
  if (!mapping?.debit_account_code || !mapping?.credit_account_code) {
    console.warn("[auto_post] no mapping for receipt:", mappingKey);
    return null;
  }

  const desc = `รับชำระ ${receipt.receipt_no || '#' + receipt.id} — ${receipt.customer_name || 'ลูกค้า'}`;
  const amount = Number(amountRaw);

  return _postJournal({
    sourceTable: "receipts",
    sourceId: receipt.id,
    docType: "RV",
    docDate,
    description: desc,
    lines: [
      { account_code: mapping.debit_account_code,  debit: amount, credit: 0,      description: desc },
      { account_code: mapping.credit_account_code, debit: 0,      credit: amount, description: desc }
    ]
  });
}
