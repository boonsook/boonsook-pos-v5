// Phase 578 (follow-up Phase 577) — profit_report + expense_overview ดึงรายจ่ายเต็มจาก DB
//
// Why: profit_report ดึง sales เต็มผ่าน fetchSalesSince (Phase 492) แล้ว แต่ expensesInRange
// ยังกรองจาก state.expenses cap 200 → "กำไรสุทธิ" สูงเกินจริง (revenue เต็ม − expense ขาด);
// expense_overview raw fetch ไม่ paginate → >1000 รายจ่ายในช่วง = ยอดรวม/เฉลี่ย/Top ขาดเงียบ.
// แก้: เสียบ fetchExpensesSince (paginated + {ok,rows}/{ok:false,error} ไม่เงียบ, buffer -2 วัน).
// (behavioral ของ fetchExpensesSince cover แล้วใน income_dashboard_fetch_guard — ที่นี่ source-regex)
// Run: node --test tests/profit_expense_fetch_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.resolve(p), "utf8");

// ═══ (1) profit_report: expenses จาก fetched rows + fallback state (ไม่ 0 เงียบ) + error UX ═══
const pr = read("modules/profit_report.js");

test("profit_report imports fetchExpensesSince from range_fetch.js", () => {
  // build 597: import เพิ่ม fetchServiceJobsSince ใน braces เดียวกัน → allow import อื่นร่วม
  assert.match(pr, /import\s+\{[^}]*\bfetchExpensesSince\b[^}]*\}\s+from\s+["']\.\/range_fetch\.js["']/);
});

test("profit_report fetches expenses in parallel with sales (Promise.all)", () => {
  // build 597: เพิ่ม _svcRes/fetchServiceJobsSince ใน Promise.all เดียวกัน → sales+expenses ยังขนานเหมือนเดิม
  assert.match(pr, /const \[_salesRes, _expRes[^\]]*\] = await Promise\.all\(\[fetchSalesSince\(fromDate\), fetchExpensesSince\(fromDate\)[\s\S]*?\]\)/,
    "sales + expenses ต้องยิงขนานกัน (Promise.all)");
  // sales ยังคง hard-stop เดิม (fetchSalesSince fail → return) — guard sales_fetch เดิมไม่ถูก weaken
  assert.match(pr, /if \(!_salesRes\.ok\) \{[\s\S]{0,120}return; \}/, "sales fail ยัง hard-stop");
});

test("profit_report: expenses fail → fallback state.expenses + warn (ไม่ทำ report พังทั้งหน้า, ไม่ 0 เงียบ)", () => {
  assert.match(pr, /const _fetchedExpenses = _expRes\.ok \? _expRes\.rows : \(state\.expenses \|\| \[\]\)/,
    "fail → fallback state.expenses (ไม่ปล่อยว่างเงียบ)");
  assert.match(pr, /if \(!_expRes\.ok\) showToast\(/, "expenses fail ต้องมี toast เตือน (ไม่เงียบ)");
  assert.match(pr, /กำไรสุทธิอาจสูงกว่าจริง/, "ข้อความเตือนสื่อทิศทาง error (รายจ่ายขาด = กำไรเกินจริง)");
});

test("profit_report: expensesInRange อ่านจาก _fetchedExpenses ไม่ใช่ state.expenses (cap 200)", () => {
  assert.match(pr, /const expensesInRange = _fetchedExpenses\.filter\(exp => \{/, "กรองจาก fetched rows");
  // client-side date filter (fromTs/toTs) ต้องคงไว้ (buffer -2 วันของ helper = candidate superset เท่านั้น)
  assert.match(pr, /expTime >= fromTs && expTime <= toTs/, "exact date boundary client-side ต้องคงไว้");
  assert.ok(!/const expensesInRange = \(state\.expenses/.test(pr), "ต้องไม่กรองจาก state.expenses cap 200 อีก");
});

// ═══ (2) expense_overview: ไม่เหลือ raw fetch + ใช้ fetchExpensesSince + คง retry state ═══
const eo = read("modules/expense_overview.js");

test("expense_overview imports fetchExpensesSince", () => {
  assert.match(eo, /import\s+\{\s*fetchExpensesSince\s*\}\s+from\s+["']\.\/range_fetch\.js["']/);
});

test("expense_overview: ไม่เหลือ raw fetch(\"...expenses...\") (ต้อง paginate ผ่าน helper)", () => {
  assert.ok(!/\bfetch\s*\(\s*cfg\.url/.test(eo), "ห้าม raw fetch(cfg.url ...) เหลือ");
  assert.ok(!/rest\/v1\/expenses\?select=\*&expense_date=gte/.test(eo), "ห้ามเหลือ raw expenses REST URL ประกอบเอง");
  assert.match(eo, /const _res = await fetchExpensesSince\(startStr\)/, "ต้องดึงผ่าน fetchExpensesSince(startStr)");
});

test("expense_overview: helper fail → renderError + retry state (eoRetryBtn) เดิมคงไว้", () => {
  assert.match(eo, /if \(!_res\.ok\) \{/, "เช็คผล helper");
  assert.match(eo, /retryId: "eoRetryBtn"/, "คงปุ่ม retry เดิม");
  assert.match(eo, /getElementById\("eoRetryBtn"\)\?\.addEventListener\("click", \(\) => renderExpenseOverviewPage\(ctx\)\)/,
    "retry ต้อง re-render หน้าเดิม");
});

test("expense_overview: re-filter exact lower bound (helper buffer -2 วัน = superset — กัน over-count)", () => {
  assert.match(eo, /_data = _res\.rows\.filter\(e => String\(e\.expense_date \|\| ""\)\.slice\(0, 10\) >= startStr\)/,
    "sum จาก rows ที่กรอง >= startStr (ไม่รวม 2 วัน buffer)");
  // monthsAgoStartBkk (TZ-correct) ต้องยังเป็นตัวคำนวณ startStr (month_bounds_bkk_guard เดิมพึ่ง)
  assert.match(eo, /monthsAgoStartBkk\(_periodMonths - 1\)/, "startStr ยังมาจาก monthsAgoStartBkk");
});

test("expense_overview: ลบ cfg/token/headers ที่ไม่ใช้แล้ว (helper อ่าน SUPABASE_CONFIG เอง)", () => {
  assert.ok(!/const headers = \{ "apikey"/.test(eo), "headers เดิมสำหรับ raw fetch ต้องถูกลบ (กัน unused)");
});
