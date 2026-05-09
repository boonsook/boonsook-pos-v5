# 📜 CHANGELOG — Boonsook POS V5 PRO

รายการการแก้ไขแบบสั้น เรียงจากใหม่ → เก่า
รายละเอียดเชิงลึก (architecture / why) ดูใน [HANDOFF.md](HANDOFF.md)

รูปแบบ: `<commit> feat|fix|docs|refactor: <สรุปสั้น>` + bullet 1-2 ข้อถ้าจำเป็น

---

## 5.39.5 (build 196) — 2026-05-09 ⭐ Phase 88.16

### Phase 88.16 — Solar revenue mapping → 4300
- **feat:** เพิ่ม COA 4300 "รายได้บริการ — โซล่าเซลล์"
  - SQL migration: `supabase-phase88-16-solar-mapping.sql`
- **feat:** เพิ่ม `account_mapping.service_solar` (Dr 1110 / Cr 4300)
- **fix:** `auto_post.js` keyMap: `solar → service_solar` (เดิม fallback service_other → 4240)
- **impact:** P&L แยกรายได้โซล่าออกจาก "บริการอื่นๆ" — ดู revenue mix ของแต่ละสายงานได้ชัด
- **action:** ⚠️ User ต้อง run SQL ใน Supabase SQL Editor ก่อน mapping ใหม่จะใช้ได้

---

## 5.39.4 (build 195) — 2026-05-09 ⭐ Phase 88.15

### Phase 88.15 — แยกสิทธิ์ ช่าง vs admin (delivered/closed = admin only)
- **fix:** ลบ option "📦 ส่งมอบแล้ว (ลง JV ทันที)" + "🎉 ปิดงาน + รับเงิน (ลง JV ทันที)" ออกจากฟอร์มช่าง
  - 11 หน้า: solar.js / ac_install.js / service_form.js (9 routes)
  - ช่างเลือกได้: pending / in_progress / done / pending_review เท่านั้น
- **fix:** `COMPLETION_STATUSES = []` ในฟอร์มช่าง — JV ไม่ trigger เองอีก
  - JV เกิดผ่าน admin drawer (approve banner) เท่านั้น
- **impact:** ป้องกันช่างกดผิดแล้ว JV เกิด — workflow ชัดเจน: ช่างส่ง → admin อนุมัติ

---

## 5.39.3 (build 194) — 2026-05-09 ⭐ Phase 88.14

### Phase 88.14 — Fix new service jobs ไม่โผล่ในใบรับงาน
- **fix:** `solar.js` / `ac_install.js` / `service_form.js` (9 routes) บันทึกแล้ว job ใหม่ไม่ push เข้า `state.serviceJobs`
  - ทำให้หน้า "ใบรับงาน" ไม่เห็น job ใหม่จนกว่าจะ refresh page
  - เพิ่ม optimistic update: `state.serviceJobs = [inserted[0], ...state.serviceJobs]` หลัง insert สำเร็จ
  - Pattern เดียวกับ `saveServiceJob` ใน main.js
- **impact:** ทุกหน้างานช่าง (11 หน้า) — บันทึก → เปลี่ยนหน้าใบรับงาน → เห็นทันที

---

## 5.39.2 (build 193) — 2026-05-09 ⭐ Phase 88.13

### Phase 88.13 — Solar equipment ↔ Stock link
- **feat:** หน้าโซล่าเซลล์ — อุปกรณ์/วัสดุ ลิ้งกับสต็อก (warehouse) แทน free-text
  - ปุ่ม "+ เพิ่มอุปกรณ์" เปิด modal picker จาก state.products + แสดงสต็อกในรถ/บ้าน
  - แสดงตาราง อุปกรณ์/คลัง/qty stepper/ราคา/รวม + ลบรายการ
  - ตอน save → ตัดสต็อกอัตโนมัติ (window._appApplyStockMovement) + auto-transfer บ้าน→รถ ถ้าไม่พอ
  - เก็บ items_json ลง service_jobs
  - ไม่กระทบ section ปิดงาน/สลิป/AI verify/JV trigger ของ Phase 88.12

---

## 5.39.1 (build 192) — 2026-05-09 ⭐ Phase 88.12 final

### Phase 88.12 — Approval Workflow ครบ 13 หน้างานช่าง
- **feat:** ทุกหน้างานช่างมี section "ปิดงาน + แนบสลิป + AI verify"
  - 9 service types (service_form.js) + ติดตั้งแอร์ (ac_install.js) + โซล่าเซลล์ (solar.js)
  - ปุ่มแยก 📷 ถ่ายรูป / 🖼️ แกลลอรี่
  - Auto AI verify ถ้า payment=transfer/qr
- **feat:** Status ใหม่ `pending_review` (📨 รออนุมัติ)
  - ช่างเลือก → JV ไม่เกิด (รอ admin)
  - filter chip "รออนุมัติ" สีม่วง ในใบรับงาน
- **feat:** Admin approve banner ใน drawer (ม่วง) + ปุ่ม "อนุมัติ + ลงรายได้"
  - กด → status=delivered → save → JV เกิด

---

## 5.38.6 (build 190) — 2026-05-09 ⭐ Phase 88.11 final

### Phase 88.11 — Slip Upload + AI Verify (Gemini Vision)
- **feat:** ช่างแนบสลิปการโอน + AI ตรวจ tampering ใน drawer
  - `functions/api/verify-slip.js`: Gemini Vision API + 4-model fallback chain
  - Compact prompt + maxTokens 4000 (รองรับ Thai)
  - Extract: sender/recipient/amount/datetime/ref + tampering_score
  - Smart name match (strip prefix + bank name) — กัน false positive
  - Tampering threshold สอน AI: phone-of-phone ≠ tampering
- **feat:** drawer section สีม่วง — 📷 ถ่าย / 🖼️ แกลลอรี่ + auto-verify
- 7 builds (184-190) — debug journey: token truncate, name match, tampering threshold

---

## 5.37.2 (build 183) — 2026-05-09

### Phase 88.10b — Re-post JV ตอน user แก้ total/method
- **fix:** เพิ่ม `editCompleteWithChange` trigger — งาน complete + แก้ total/method
- เก็บ origTotalCost + origPaymentMethod ใน state ตอน open drawer

## 5.37.1 (build 182) — 2026-05-09

### Phase 88.10 — Re-post JV (initial)
- **fix:** เพิ่ม `voidJvForSource()` — DELETE JV เดิมก่อน post ใหม่
- กัน idempotent unique block POST ตอน user แก้ amount

---

## 5.37.0 (build 181) — 2026-05-09 ⭐ Phase 88.7-88.9

### Phase 88.7 — JV Drill-down (สมุดรายวัน → drawer)
- **feat:** คลิก row JV → drawer แสดง:
  - Meta (วันที่/ประเภท/สถานะ) + คำอธิบาย
  - Lines table (Dr/Cr ทุกบรรทัด) + balance check
  - Source preview (ถ้ามี source_table/source_id) — sales/expenses/receipts/service_jobs
  - ปุ่ม "เปิดหน้า [source]" → navigate ไป list page
  - Audit info (created_at / approved_at / voided_at)

### Phase 88.8 — Drawer service edit: ค่าแรง/discount + payment_method
- **feat:** เพิ่ม section "💰 ค่าแรง / ปิดงาน" ใน serviceJobDrawer
  - input ค่าแรง / ส่วนลด / ยอดสุทธิ (auto-recalc)
  - dropdown payment_method (cash → Dr 1110 / transfer → Dr 1130)
- **feat:** saveServiceJob ใส่ `total_cost` + `payment_method` ใน payload
  - ส่ง payment_method ไปยัง postJournalForServiceJob — override Dr account
  - แก้ pain point: drawer ก่อนหน้านี้ไม่มีช่อง total_cost (ต้องไป SQL UPDATE manual)

### Phase 88.9 — Comparative P&L
- **feat:** toggle "📊 เทียบกับงวดก่อน" ในหน้างบกำไรขาดทุน
  - Auto-compute previous period (เดือน/ไตรมาส/ปี/custom = ขนาดเท่ากัน)
  - Fetch 2 งวดพร้อมกัน → render side-by-side (5 columns: รหัส | ชื่อ | งวดนี้ | งวดก่อน | Δ)
  - Net Income compare card (3 ตัวเลข + % change)

---

## 5.36.0 (build 180) + SQL hotfix — 2026-05-08 ⭐ Phase 88.6

### Phase 88.6 — Service Job Closure Workflow
- **feat:** ช่างปิดงานในหน้าเดียว — JV ลงรายได้อัตโนมัติตามประเภทงาน
  - SQL: ALTER service_jobs (total_cost/payment_method/payment_slip_url/closed_at)
    + 5 COA ใหม่ (4250-4290) + 5 mappings (satellite/fridge/washer/cctv/tv)
  - auto_post.js: keyMap 9 ประเภทครบ + payment_method override (transfer→1130)
  - service_form.js: section "🔚 ปิดงาน" (status + payment + slip upload + auto JV)
- **SQL hotfix** (c89a75c): ลืม payment_method ในรอบแรก — เพิ่ม + NOTIFY pgrst
- ✅ User verified: SV2026050003 ฿3,000 จากงานซ่อมแอร์ลูกค้าดาหมอก

---

## 5.35.2 (build 179) — 2026-05-08

### Hotfix — service_jobs.total_cost
- **fix:** service_form.js เพิ่ม `total_cost: net` ใน record ตอน insert
  - Bug: postJournalForServiceJob skip silent ถ้า total_cost=NULL

---

## 5.35.1 (build 178) — 2026-05-08

### Hotfix — Backfill date range
- **fix:** `created_at=lte.YYYY-MM-DD` exclude row ที่ created 12:56 UTC
  - แก้: timestamptz field ใช้ `lt.<nextDay>`, DATE field ใช้ `lte.<to>`

---

## 5.35.0 (build 177) — 2026-05-08

### Hotfix — Mobile service form save
- **fix:** ใช้ `window._sbAccessToken` cache แทน `supabase.auth.getSession()`
  (มือถือ slow network → getSession hang ตลอด)
- **fix:** wire `postJournalForServiceJob` ใน service_form.js (เดิม wire ผิดที่ใน main.js)

---

## 5.34.9 (build 176) — 2026-05-08

### Hotfix — service_form fetch timeout
- **fix:** AbortController + 15s timeout — กัน "กำลังบันทึก..." ค้างไม่จบ

---

## 5.34.8 (build 175) — 2026-05-08 ⭐ Phase 88 FINAL

### Phase 88.5 — Opening Balance wizard + Export bundle (FINAL)
- **feat:** wizard ลงยอดยกมา (Opening Balance) — `modules/accounting/opening_balance.js`
  - 3 sections (Asset/Liability/Equity) + live balance check Dr=Cr
  - หลัง save → JV `OB2026010001` doc_type=OB ลงวันที่ effective date
  - แก้ปัญหา BS แสดงตัวเลขลบ (ไม่มี opening balance)
- **feat:** export bundle ส่งสำนักงานบัญชี — `modules/accounting/export_bundle.js`
  - Excel 1 ไฟล์ มี 4 sheets: TB / P&L / BS / Journal
  - ใช้ window.XLSX (SheetJS) — single fetchAll() reuse data
  - Period picker month/quarter/year/custom
- 🎉 **Phase 88 ครบสมบูรณ์** — รองรับทุก use case จาก spec ของ user

---

## 5.34.7 (build 174) — 2026-05-08

### Phase 88.4 — งบดุล Balance Sheet
- **feat:** หน้างบดุล — สมการบัญชี Assets = Liabilities + Equity
  - `modules/accounting/balance_sheet.js` (~310 lines): closing balance
    cumulative ตั้งแต่ effective date 2026-01-01 → as-of date
  - 3 sections: Assets (Dr-Cr) / Liabilities (Cr-Dr) / Equity (Cr-Dr)
    + Retained Earnings (Σincome-Σexpense) → row พิเศษใน Equity
  - Equation card: balance check ✓ สีเขียว / ⚠️ สีแดง + ผลต่าง
  - Negative number warning → แนะนำลง JV ประเภท OB (Phase 88.5)
- "As of date" picker (default=today, min=2026-01-01) + Excel + พิมพ์

---

## 5.34.6 (build 173) — 2026-05-08

### Phase 88.3 — งบกำไรขาดทุน (P&L)
- **feat:** หน้างบกำไรขาดทุน — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุนสุทธิ
  - `modules/accounting/profit_loss.js`: 2 sections (รายได้ 4xxx / ค่าใช้จ่าย 5xxx)
    + Net Income card (สีเขียวถ้ากำไร / แดงถ้าขาดทุน) + Margin %
  - ใช้ logic ตรงมาตรฐานบัญชี: income normal Cr balance, expense normal Dr balance
  - Period picker + Export Excel + พิมพ์ (เหมือน Trial Balance)

---

## 5.34.5 (build 172) — 2026-05-08

### Phase 88.2 — Trial Balance Report
- **feat:** หน้ารายงานยอดทดลอง (รายงานหัวใจของบัญชี — ส่งสำนักงานบัญชีได้)
  - `modules/accounting/trial_balance.js`: period picker (เดือน/ไตรมาส/ปี/custom)
    + auto-aggregate Dr/Cr per account + balance check Dr=Cr
  - 5 sections (สินทรัพย์/หนี้สิน/ส่วนของเจ้าของ/รายได้/ค่าใช้จ่าย) + subtotals
  - Export Excel (5 columns + total row) + พิมพ์ (popup window)
- ใช้ "4-point checklist" — เพิ่ม route ครบทั้ง 4 จุด (index.html + ALL_ROUTES +
  ROUTE_GROUP + routeTitles/showRoute) — ไม่พลาดเหมือน Phase 88.1b initial

---

## 5.34.4 (build 171) — 2026-05-08

### Phase 88.1b hotfix + verified end-to-end
- `cb4c13b` **fix:** เพิ่ม `accounting_backfill` ใน `ALL_ROUTES` list
  - Phase 88.1b (build 170) ลืมจุดนี้ → admin canAccessPage = false →
    กดปุ่ม Backfill แล้ว redirect ไป fallback (เข้าหน้าไม่ได้)
- ✅ **Verified end-to-end:** Backfill 91 rows → สร้าง JV ใหม่ 90 (1 มี JV แล้ว)
  - สมุดรายวัน 3 → 93 รายการ
  - PV/SV ครบทั้งเดือน เม.ย.-พ.ค. 2026 → trial balance ครบจริง

---

## 5.34.3 (build 170) — 2026-05-08

### Phase 88.1b — Receipts/Service Jobs auto-post + Backfill UI
- **feat:** auto-post JV จาก 4 sources ใหม่ + Backfill UI
  - `auto_post.js`: เพิ่ม `postJournalForReceipt` (RV) + ขยาย `EXPENSE_CATEGORY_MAP`
    (salary/labor_hire/payroll/materials/utilities)
  - `receipts.js`: wire 2 จุด (dropdown + preview button) — fire ตอน status=paid
  - `main.js saveServiceJob`: wire ตอน status transition → done/delivered/closed
    (xhrPost ใส่ `returnData: true` ขอ id; ใช้ `state.serviceJobs` ที่ optimistic update
    เพื่อได้ total_cost)
  - `modules/accounting/backfill.js`: หน้าใหม่ — เลือก source + date range → preview/run
    batch post (idempotent)
- **Architecture:** Payroll ไม่ wire ตรง — ใช้ expense flow (Phase 76 auto-create
  expense category=salary ตอน markPaid → triggers postJournalForExpense)
  เพื่อกัน duplicate JV (1 transaction = 1 JV)

---

## 5.34.2 (build 169) — 2026-05-08

### Phase 88.1a-fix — RLS hotfix + wire auto-post ที่ pos.js (จุดที่ POS ใช้จริง)
- `60b8fee` **fix:** wire `postJournalForSale` ใน `modules/pos.js doCheckout()`
  (build 168 wire ผิดที่ — main.js:checkout() เป็น legacy ไม่ถูกเรียก)
- `6b2ff34` **fix:** RLS hotfix — split `je_admin`/`jl_admin` policies
  (Phase 88.0 ใช้ FOR ALL → block INSERT จาก non-admin → JV ไม่เกิด)
  - Run `supabase-phase88-hotfix-rls.sql` post-deploy
- ✅ **Verified end-to-end:** ขาย POS → JV `SV2026050001` เกิดอัตโนมัติ Dr 1110 / Cr 4100

---

## 5.34.1 (build 168) — 2026-05-08

### Phase 88.1a — Auto-post JV (sales + expenses)
- **feat:** auto-post Journal Entry จาก POS sale + expense (fire-and-forget)
  - `supabase-phase88-auto-post.sql`: partial unique index บน
    `(source_table, source_id)` → idempotent + 22 seed mappings
    (4 sales + 10 expenses + 5 services + 2 receipts + 2 payroll)
  - `modules/accounting/auto_post.js`: postJournalForSale/Expense/
    ServiceJob — effective date 2026-01-01, mapping cache lazy-loaded
  - `main.js`: wire `postJournalForSale` ใน checkout()
  - `modules/expenses.js`: wire 2 จุด (manual save + AutoKey OCR flow)
- **⚠️ Post-deploy:** ต้องรัน `supabase-phase88-auto-post.sql` ใน Supabase

---

## 5.34.0 (build 167) — 2026-05-08

### Phase 88.0 — Accounting Foundation
- `98f5574` **feat:** accounting foundation
  - SQL: chart_of_accounts (51 Thai accounts) + journal_entries
    (je_balanced CHECK) + journal_lines (line_one_side CHECK) +
    fiscal_periods + is_accountant() helper + 4 RLS policies admin-only
  - JS: journals.js (สมุดรายวัน list) + journal_form.js (manual JV) +
    coa.js (ผังบัญชี + CSV/Excel import/export)

---

## 5.33.5 (build 166) — 2026-05-08

### Phase 87.5 — Full catalog spec seed
- `aabd340` **feat:** seed extended specs ครบ 211 รุ่นที่เหลือ → 223/223 (100%)
  - Python script `scripts/seed_specs.py` — 45+ section templates + per-BTU class scaling
  - main.js cache logic เปลี่ยน: ratio-based (≥90% specced) แทน "any feature" check
  - Caveat: แบรนด์เล็ก (FRIO, MAVELL, STAR AIR ฯลฯ) ใช้ default ตาม BTU class — ไม่ใช่ official spec sheet

---

## 5.33.4 (build 165) — 2026-05-07

### Phase 87.4 — Copy spec from another SKU (Hybrid workflow boost)
- `8712bb1` **docs:** HANDOFF sync to 5.33.4
- `8266167` **feat:** ปุ่ม "📥 ดูด" — fill spec form จากรุ่น A → B (ลด 8 นาที → 1.5 นาที/รุ่น = 5x faster)
  - Green panel ใต้ header + dropdown optgroup ตาม section
  - Self-filter: ไม่แสดงรุ่นปัจจุบันใน dropdown
  - Backwards-compat: ถ้า sourceList ว่าง → ไม่ render panel

---

## 5.33.3 (build 164) — 2026-05-07

### Phase 87.3 — CSV/Excel round-trip 24 columns
- `17c2d0a` **docs:** HANDOFF sync to 5.33.3
- `b7106f3` **feat:** Excel/CSV export/import รองรับ 24 columns (พื้นฐาน 8 + extended 16)
  - Helpers: `_arrToPipe`, `_pipeToArr`, `_tryNum`, `_toExportRow`, `_fromImportRow`
  - Smart serialization: arrays → `"item1 | item2"`, ranges → `"0.4-4.5"` string
  - Backwards-compat: old 8-column CSV ยัง import ได้

---

## 5.33.2 (build 163) — 2026-05-07

### Phase 87.2 — Admin spec editor + 12 SKUs seeded
- `847d718` **feat:** Modal form ใหม่สำหรับ admin กรอก spec (16 fields) + seed 8 SKUs เพิ่ม (รวม 12)
  - ✏️ button per row: `+ สเปก` (เทา) / `📋 แก้` (เขียว)
  - Number fields fall back to string (เช่น `"0.4-4.5"`)
  - 12 SKUs: TCL MFS/T-PROWD series, Carrier 38TVDB010, LG ISC10E, Daikin FTM 09 PV2S, Mitsubishi MSY-JZ 09 VF

---

## 5.33.1.1 (build 162) — 2026-05-07

### Phase 87.1.1 — Schema auto-refresh hotfix
- `111e052` **fix:** localStorage v1 cache ไม่ load JSON v2 — เพิ่ม detect `features|seer|description` แล้ว overwrite cache

---

## 5.33.1 (build 161) — 2026-05-07

### Phase 87.1 — Product detail modal + extended catalog schema
- `c315fd5` **feat:** modal สวยเหมือนห้างใหญ่ (hero image, badge, warranty, features, spec table) + schema v2 (16 extended fields)
  - ไฟล์ใหม่: `modules/product_detail_modal.js` (212 lines)
  - Wire ใน `customer_dashboard.js`: spread `...c` + click `[data-view-product]`
  - Seed 2 sample SKUs: MFS10, T-PROWD10
  - ESC + click-outside dismiss + mobile full-screen <640px

---

## 📋 Format guidelines

- **Headline** = 1 บรรทัด — `<commit> <type>: <สรุป>`
- **Types**: `feat` (ของใหม่), `fix` (แก้ bug), `docs` (เอกสาร), `refactor` (จัดโครงสร้าง), `chore` (อื่นๆ)
- **Bullets** = 1-2 ข้อ ต่อ commit ใหญ่ — เน้น user-impact
- **Skip**: tiny chores, version-bump-only commits — ดู git log ก็พอ
- **เนื้อหาลึก** (why / trade-off / architecture) — ใส่ใน HANDOFF.md ไม่ใช่ตรงนี้
