# 📜 CHANGELOG — Boonsook POS V5 PRO

รายการการแก้ไขแบบสั้น เรียงจากใหม่ → เก่า
รายละเอียดเชิงลึก (architecture / why) ดูใน [HANDOFF.md](HANDOFF.md)

รูปแบบ: `<commit> feat|fix|docs|refactor: <สรุปสั้น>` + bullet 1-2 ข้อถ้าจำเป็น

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
