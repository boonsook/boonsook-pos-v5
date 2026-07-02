// ═══════════════════════════════════════════════════════════
//  CASH DRAWER RECONCILIATION — กระทบยอดเงินสดประจำวัน
//  ก่อนเปิดร้าน: บันทึกเงินเริ่มต้นในลิ้นชัก
//  ปิดร้าน: นับเงินจริง → เทียบกับยอดที่ระบบคำนวณ → ดูผลต่าง
// ═══════════════════════════════════════════════════════════

import { todayBkk, dateBkk, round2 } from "./utils.js";
function money(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

// ค่า denominations เงินไทย (สำหรับ cash counter)
const DENOMINATIONS = [
  { value: 1000, label: "1,000", color: "#7c3aed" },
  { value: 500,  label: "500",   color: "#7c3aed" },
  { value: 100,  label: "100",   color: "#dc2626" },
  { value: 50,   label: "50",    color: "#0891b2" },
  { value: 20,   label: "20",    color: "#059669" },
  { value: 10,   label: "10",    color: "#d97706" },
  { value: 5,    label: "5",     color: "#6b7280" },
  { value: 2,    label: "2",     color: "#6b7280" },
  { value: 1,    label: "1",     color: "#6b7280" }
];

// Phase 89.18: pure helper สำหรับ unit test — แยก business logic ออกจาก DOM render
// dateFn injection allows test ใช้ deterministic date conversion
// Phase 554: recon ต้องดึงข้อมูล "วันที่เลือก" ตรงจาก DB (fetchCashRecon* ด้านล่าง) ไม่พึ่ง
//   state.sales/state.expenses ที่ถูก cap (sales limit 50 @main.js:1148, expenses 200 @main.js:1203)
//   → วันขาย/จ่ายเกิน cap = cashIn/cashOut ขาด = "เกิน/ขาด" ปลอม. รับ sales/expenses ผ่านพารามได้;
//   ถ้าไม่ส่ง (unit test เดิม) → fallback state. + creditCashPayments (เก็บหนี้เงินสด method=cash)
//   บวกเข้าลิ้นชักผ่าน creditCashIn (เดิมไม่นับเลย → วันมีเก็บหนี้สด ลิ้นชัก "เกิน" เสมอ).
export function computeCashRecon({ state, date, refunds = [], sales: salesInput, expenses: expensesInput, creditCashPayments = [], dateFn = dateBkk }) {
  const _salesSrc = (salesInput !== undefined) ? salesInput : (state?.sales || []);
  const sales = (_salesSrc || []).filter(s =>
    !(s.note || "").includes("[ลบแล้ว]") &&
    String(s.status || "").toLowerCase() !== "cancelled" &&
    dateFn(s.created_at) === date
  );
  const cashSales = sales.filter(s =>
    (s.payment_method || "").includes("เงินสด") || s.payment_method === "cash"
  );
  // ★ Phase 520: "เงินรับจริง" = total_amount − credit_used_amount (ส่วนที่จ่ายด้วยเครดิตลูกค้า 2180
  //   ไม่ใช่เงินสด/โอนเข้าลิ้นชัก). credit_used_amount default 0 → บิลปกติไม่กระทบ. (revenue ที่อื่น = total เต็ม ถูก)
  const _cashReceived = (s) => Math.max(Number(s.total_amount || 0) - Number(s.credit_used_amount || 0), 0);
  const cashIn = cashSales.reduce((sum, s) => sum + _cashReceived(s), 0);
  const transferSales = sales.filter(s => !cashSales.includes(s));
  const transferIn = transferSales.reduce((sum, s) => sum + _cashReceived(s), 0);

  const _expSrc = (expensesInput !== undefined) ? expensesInput : (state?.expenses || []);
  const expenses = (_expSrc || []).filter(e => dateFn(e.expense_date) === date);
  const cashExpenses = expenses.filter(e =>
    !e.payment_method || e.payment_method === "cash" || (e.payment_method || "").includes("เงินสด")
  );
  const cashOut = cashExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Phase 554: เงินสดจากรับชำระลูกหนี้ (credit_payments) เข้าลิ้นชักด้วย — เฉพาะ method=cash
  //   และเฉพาะวันที่เลือก (credit_payments.paid_at เป็นคอลัมน์วันที่ ไม่ใช่ created_at). โอน=ไม่เข้าลิ้นชัก.
  const creditCashRows = (creditCashPayments || []).filter(p =>
    dateFn(p.paid_at) === date &&
    ((p.payment_method || "").includes("เงินสด") || p.payment_method === "cash" || !p.payment_method)
  );
  const creditCashIn = creditCashRows.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // Phase 92.12 (audit 4.1 Should-fix): หัก cash refunds ออกจากลิ้นชัก
  //   เดิมไม่นับ refund → คืนเงินสดทำให้ลิ้นชักขาดโดยไม่มีบันทึก = false "ขาด" ทุกรอบ
  //   เฉพาะ refund_method = cash (โอนคืนไม่กระทบเงินสด) และเฉพาะวันที่เลือก
  const cashRefunds = (refunds || []).filter(r =>
    dateFn(r.created_at) === date &&
    ((r.refund_method || "").includes("เงินสด") || r.refund_method === "cash")
  );
  const cashRefundOut = cashRefunds.reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);

  return { sales, cashSales, cashIn, transferSales, transferIn, expenses, cashExpenses, cashOut, cashRefunds, cashRefundOut, creditCashRows, creditCashIn };
}

// State สำหรับวันที่เลือก (default = วันนี้ — Phase 89.9 H11: BKK time, ไม่ใช่ UTC)
let _crDate = todayBkk();
let _crDenoms = {}; // { value: count }
// Phase 92.12: cash refunds สำหรับวันที่เลือก (fetch async, cache ต่อวัน — กัน refetch ทุก keystroke)
let _crRefunds = [];
let _crRefundsDate = null;
// Phase 554: sales/expenses/credit-payments ของวันที่เลือก (fetch ตรงจาก DB — เลิกพึ่ง state cap)
let _crSales = [];
let _crExpenses = [];
let _crCreditCash = [];
let _crDataDate = null;   // date guard ร่วมของ 3 ชุดข้างบน (กัน refetch ทุก keystroke)

// Phase 92.12: ดึง cash refunds ของวัน (BKK) สำหรับ recon — refunds ไม่อยู่ใน state กลาง
async function fetchCashReconRefunds(date) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    if (!cfg?.url) return [];
    const accessToken = window._sbAccessToken || cfg.anonKey;
    const next = dateBkk(new Date(new Date(date + "T00:00:00+07:00").getTime() + 86400000));
    const url = cfg.url + "/rest/v1/refunds?select=created_at,refund_method,refund_amount"
      + "&created_at=gte." + date + "T00:00:00%2B07:00"
      + "&created_at=lt." + next + "T00:00:00%2B07:00";
    const res = await fetch(url, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken },
    });
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn("[cash_recon] fetch refunds failed:", e?.message);
    return [];
  }
}

// Phase 554: fetch helpers — ดึงข้อมูล "วันที่เลือก" ตรงจาก Supabase (เลี่ยง state cap).
//   ทุกตัว fail-safe: return [] เมื่อไม่มี cfg / !res.ok / error — ไม่ throw (recon อ่านอย่างเดียว).
function _crAuth() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url) return null;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  return { cfg, headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + accessToken } };
}
// วันถัดไป (BKK) สำหรับ boundary [date, nextDay) แบบเดียวกับ fetchCashReconRefunds
function _crNextDay(date) {
  return dateBkk(new Date(new Date(date + "T00:00:00+07:00").getTime() + 86400000));
}
async function _crFetchRows(path, label) {
  try {
    const a = _crAuth();
    if (!a) return [];
    const res = await fetch(a.cfg.url + path, { headers: a.headers });
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn(`[cash_recon] fetch ${label} failed:`, e?.message);
    return [];
  }
}
// ขายของวัน (created_at gte/lt +07:00) — select เท่าที่ compute ใช้; กรอง [ลบแล้ว]/cancelled ฝั่ง compute
async function fetchCashReconSales(date) {
  const next = _crNextDay(date);
  return _crFetchRows(
    "/rest/v1/sales?select=created_at,payment_method,total_amount,credit_used_amount,status,note"
    + "&created_at=gte." + date + "T00:00:00%2B07:00"
    + "&created_at=lt." + next + "T00:00:00%2B07:00",
    "sales");
}
// รายจ่ายของวัน — expenses ใช้ expense_date (DATE) ไม่ใช่ created_at → filter eq.date
async function fetchCashReconExpenses(date) {
  return _crFetchRows(
    "/rest/v1/expenses?select=expense_date,payment_method,amount&expense_date=eq." + date,
    "expenses");
}
// รับชำระลูกหนี้ของวัน — ★ credit_payments ใช้คอลัมน์ paid_at (ไม่ใช่ created_at!) — fetch ทุก method
//   แล้วให้ compute กรอง cash (กัน "เงินสด" vs "cash" หลุด แบบเดียวกับ refunds)
async function fetchCashReconCreditPayments(date) {
  const next = _crNextDay(date);
  return _crFetchRows(
    "/rest/v1/credit_payments?select=paid_at,payment_method,amount"
    + "&paid_at=gte." + date + "T00:00:00%2B07:00"
    + "&paid_at=lt." + next + "T00:00:00%2B07:00",
    "credit_payments");
}

export function renderCashReconPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-cash_recon");
  if (!container) return;

  // โหลดข้อมูลที่บันทึกไว้สำหรับวันที่นี้ จาก localStorage
  const storageKey = `bsk_cash_recon_${_crDate}`;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch(e){}
  const openingCash = Number(saved?.opening || 0);
  const expectedCounted = Number(saved?.counted || 0);

  // Phase 92.12: ดึง cash refunds ของวันที่เลือก (cache ต่อวัน) → re-render เมื่อมาถึง
  if (_crRefundsDate !== _crDate) {
    _crRefundsDate = _crDate;
    _crRefunds = [];
    fetchCashReconRefunds(_crDate).then(list => {
      if (_crRefundsDate === _crDate) { _crRefunds = list; renderCashReconPage(ctx); }
    });
  }

  // Phase 554: ดึง sales/expenses/credit-payments ของวันที่เลือกตรงจาก DB (เลิกพึ่ง state cap).
  //   cache ต่อวัน (date guard) → กัน refetch ทุก keystroke; re-render เมื่อชุดข้อมูลมาถึง.
  if (_crDataDate !== _crDate) {
    const _d = _crDate;
    _crDataDate = _d;
    _crSales = []; _crExpenses = []; _crCreditCash = [];
    Promise.all([
      fetchCashReconSales(_d),
      fetchCashReconExpenses(_d),
      fetchCashReconCreditPayments(_d),
    ]).then(([s, e, c]) => {
      if (_crDataDate === _d) { _crSales = s; _crExpenses = e; _crCreditCash = c; renderCashReconPage(ctx); }
    });
  }

  // Phase 89.18: ใช้ computeCashRecon pure helper (unit-tested)
  // Phase 554: ส่ง sales/expenses/creditCashPayments ที่ fetch มา (ไม่พึ่ง state ที่ cap)
  const recon = computeCashRecon({ state, date: _crDate, refunds: _crRefunds, sales: _crSales, expenses: _crExpenses, creditCashPayments: _crCreditCash });
  const { sales: _sales, cashSales, cashIn, transferSales: _transferSales, transferIn, expenses: _expenses, cashExpenses, cashOut, cashRefunds, cashRefundOut, creditCashRows, creditCashIn } = recon;

  // Phase 92.12: หัก cash refunds ออกจากลิ้นชัก (audit 4.1 Should-fix)
  // ★ Phase 490 (S-4): round2 ทุกค่าเงิน — เดิม expected/diff เป็นผลรวม reduce ลอย ๆ (0.1+0.2=0.300…04)
  //   → diff = -1e-13 → ไม่เข้า `diff === 0` แต่เข้า branch "ขาด" → โชว์ "↓ ขาด -฿0.00" หลอกทั้งที่นับตรง
  // Phase 554: + creditCashIn (เก็บหนี้เงินสดเข้าลิ้นชัก) — เดิมไม่นับ → วันมีเก็บหนี้สดโชว์ "เกิน"
  const expected = round2(openingCash + cashIn + creditCashIn - cashOut - cashRefundOut);

  // ★ คำนวณ counted จาก denominations (ถ้ามี)
  const denomTotal = DENOMINATIONS.reduce((sum, d) => sum + d.value * (Number(_crDenoms[d.value]) || 0), 0);
  const countedCash = round2(denomTotal > 0 ? denomTotal : expectedCounted);
  const diff = round2(countedCash - expected);  // 2dp → `diff === 0` เชื่อถือได้ (ไม่มี float drift)

  container.innerHTML = `
    <div style="padding:8px">
      <div class="hero" style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#fef3c7,#dcfce7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">💵</div>
        <h2 style="margin:0 0 4px;color:#854d0e">กระทบยอดเงินสด (Cash Reconciliation)</h2>
        <p style="margin:0;color:#065f46;font-size:13px">ปิดร้าน: นับเงินในลิ้นชัก → เทียบกับยอดที่ระบบคำนวณ → ดูผลต่าง</p>
      </div>

      <!-- Date Selector -->
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:600">📅 วันที่:</span>
        <input id="crDate" type="date" value="${_crDate}" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px" />
        <button id="crToday" class="btn light" style="font-size:12px">วันนี้</button>
        <button id="crYesterday" class="btn light" style="font-size:12px">เมื่อวาน</button>
      </div>

      <!-- Step 1: Opening Cash -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0;font-size:15px">📦 ขั้นที่ 1: เงินเริ่มต้นในลิ้นชัก (เปิดร้าน)</h3>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <input id="crOpening" type="number" min="0" step="0.01" value="${openingCash}" placeholder="0.00" style="flex:1;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-weight:700;font-size:16px" />
          <button id="crSaveOpening" class="btn primary" style="font-size:13px;padding:10px 16px">💾 บันทึก</button>
        </div>
        <div style="font-size:11px;color:#64748b;margin-top:4px">บันทึกตอนเปิดร้าน — ครั้งเดียวต่อวัน</div>
      </div>

      <!-- Step 2: Calculated -->
      <div class="panel" style="padding:14px;margin-bottom:14px;background:#f0f9ff;border:1px solid #bae6fd">
        <h3 style="margin:0 0 10px;font-size:15px;color:#0c4a6e">🧮 ขั้นที่ 2: ระบบคำนวณ "ควรมี" (จากการขาย/รายจ่าย)</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          <div style="background:#fff;padding:10px;border-radius:8px">
            <div style="font-size:11px;color:#64748b">📦 เงินเริ่มต้น</div>
            <div style="font-size:18px;font-weight:700;color:#475569">฿${money(openingCash)}</div>
          </div>
          <div style="background:#fff;padding:10px;border-radius:8px">
            <div style="font-size:11px;color:#64748b">💰 ขายเงินสดวันนี้ (${cashSales.length} บิล)</div>
            <div style="font-size:18px;font-weight:700;color:#059669">+ ฿${money(cashIn)}</div>
          </div>
          ${creditCashIn > 0 ? `
          <div style="background:#fff;padding:10px;border-radius:8px">
            <div style="font-size:11px;color:#64748b">🧾 รับชำระลูกหนี้ (เงินสด) (${creditCashRows.length} รายการ)</div>
            <div style="font-size:18px;font-weight:700;color:#059669">+ ฿${money(creditCashIn)}</div>
          </div>` : ''}
          <div style="background:#fff;padding:10px;border-radius:8px">
            <div style="font-size:11px;color:#64748b">📤 จ่ายเงินสดวันนี้ (${cashExpenses.length} รายการ)</div>
            <div style="font-size:18px;font-weight:700;color:#dc2626">- ฿${money(cashOut)}</div>
          </div>
          ${cashRefundOut > 0 ? `
          <div style="background:#fff;padding:10px;border-radius:8px">
            <div style="font-size:11px;color:#64748b">↩️ คืนเงินสดวันนี้ (${cashRefunds.length} รายการ)</div>
            <div style="font-size:18px;font-weight:700;color:#dc2626">- ฿${money(cashRefundOut)}</div>
          </div>` : ''}
          <div style="background:#dbeafe;padding:10px;border-radius:8px;border:2px solid #0284c7">
            <div style="font-size:11px;color:#1e40af;font-weight:700">✓ ควรมีในลิ้นชัก</div>
            <div style="font-size:22px;font-weight:900;color:#0c4a6e">฿${money(expected)}</div>
          </div>
        </div>
        ${transferIn > 0 ? `<div style="font-size:11px;color:#64748b;margin-top:8px">ℹ️ ยอดโอน/บัตร = ฿${money(transferIn)} (ไม่นับในเงินสด)</div>` : ''}
      </div>

      <!-- Step 3: Count cash -->
      <div class="panel" style="padding:14px;margin-bottom:14px">
        <h3 style="margin:0 0 10px;font-size:15px">💵 ขั้นที่ 3: นับเงินจริงในลิ้นชัก</h3>
        <div style="font-size:12px;color:#64748b;margin-bottom:8px">นับธนบัตร/เหรียญแต่ละชนิด — ระบบรวมให้</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
          ${DENOMINATIONS.map(d => `
            <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;padding:6px 8px;border-radius:8px">
              <span style="background:${d.color};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;min-width:42px;text-align:center">฿${d.label}</span>
              <span style="font-size:11px;color:#64748b">×</span>
              <input type="number" min="0" step="1" class="cr-denom" data-val="${d.value}" value="${_crDenoms[d.value] || ''}" placeholder="0" style="width:60px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;text-align:center;font-weight:700" />
              <span style="font-size:11px;color:#94a3b8;margin-left:auto">฿${money(d.value * (_crDenoms[d.value] || 0))}</span>
            </div>
          `).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#fef3c7;border-radius:8px;margin-top:10px">
          <span style="font-weight:700">💵 รวมที่นับได้:</span>
          <span style="font-size:22px;font-weight:900;color:#854d0e">฿${money(countedCash)}</span>
        </div>
      </div>

      <!-- Step 4: Result -->
      <div class="panel" style="padding:14px;background:${diff === 0 ? '#dcfce7' : (diff > 0 ? '#dbeafe' : '#fee2e2')};border:2px solid ${diff === 0 ? '#10b981' : (diff > 0 ? '#0284c7' : '#dc2626')}">
        <h3 style="margin:0 0 10px;font-size:15px;color:#0f172a">📊 ขั้นที่ 4: สรุปผล</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
          <div style="text-align:center;padding:10px">
            <div style="font-size:11px;color:#64748b">ระบบคำนวณ</div>
            <div style="font-size:22px;font-weight:900">฿${money(expected)}</div>
          </div>
          <div style="text-align:center;padding:10px">
            <div style="font-size:11px;color:#64748b">นับได้จริง</div>
            <div style="font-size:22px;font-weight:900">฿${money(countedCash)}</div>
          </div>
          <div style="text-align:center;padding:10px">
            <div style="font-size:11px;color:${diff === 0 ? '#059669' : (diff > 0 ? '#0284c7' : '#dc2626')};font-weight:700">${diff === 0 ? '✓ ตรงกัน' : (diff > 0 ? '↑ เกิน' : '↓ ขาด')}</div>
            <div style="font-size:26px;font-weight:900;color:${diff === 0 ? '#059669' : (diff > 0 ? '#0284c7' : '#dc2626')}">${diff === 0 ? '฿0.00' : (diff > 0 ? '+฿' : '-฿') + money(Math.abs(diff))}</div>
          </div>
        </div>
        <div style="margin-top:12px;text-align:center">
          <button id="crSaveResult" class="btn primary" style="font-size:14px;padding:10px 20px">💾 บันทึกผลกระทบยอด</button>
        </div>
      </div>
    </div>
  `;

  // Bindings
  container.querySelector("#crDate")?.addEventListener("change", (e) => {
    _crDate = e.target.value;
    _crDenoms = {};
    renderCashReconPage(ctx);
  });
  container.querySelector("#crToday")?.addEventListener("click", () => {
    // Phase 89.9 H11: BKK time → กัน 00:00-06:59 ตี "วันนี้" เป็นเมื่อวาน
    _crDate = todayBkk();
    _crDenoms = {};
    renderCashReconPage(ctx);
  });
  container.querySelector("#crYesterday")?.addEventListener("click", () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    _crDate = dateBkk(d);
    _crDenoms = {};
    renderCashReconPage(ctx);
  });

  container.querySelector("#crSaveOpening")?.addEventListener("click", () => {
    const v = Number(container.querySelector("#crOpening").value || 0);
    const cur = saved || {};
    cur.opening = v;
    cur.savedAt = new Date().toISOString();
    try { localStorage.setItem(storageKey, JSON.stringify(cur)); showToast?.("บันทึกเงินเริ่มต้นแล้ว"); } catch(e){}
    renderCashReconPage(ctx);
  });

  container.querySelectorAll(".cr-denom").forEach(inp => inp.addEventListener("input", (_e) => {
    const val = Number(inp.dataset.val);
    const count = parseInt(inp.value, 10) || 0;
    _crDenoms[val] = count;
    renderCashReconPage(ctx);
  }));

  container.querySelector("#crSaveResult")?.addEventListener("click", () => {
    const cur = saved || {};
    cur.opening = openingCash;
    cur.counted = countedCash;
    cur.expected = expected;
    cur.diff = diff;
    cur.denoms = _crDenoms;
    cur.savedAt = new Date().toISOString();
    try { localStorage.setItem(storageKey, JSON.stringify(cur)); } catch(e){}
    showToast?.(`บันทึกผลแล้ว — ${diff === 0 ? 'ตรงกัน ✓' : (diff > 0 ? 'เกิน ฿' + money(Math.abs(diff)) : 'ขาด ฿' + money(Math.abs(diff)))}`);
  });
}
