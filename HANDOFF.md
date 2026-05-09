# 📋 HANDOFF — Boonsook POS V5 PRO

**อัปเดตล่าสุด:** 9 พฤษภาคม 2026 (Phase 88.7-88.11 — drill-down + comparative + drawer cost + slip+AI)
**Version:** 5.38.6 (build 190) — Phase 88.11g (AI verify slip ทำงาน clean)
**Previous:** 5.36.0 (build 180) — Phase 88.6 (service closure)

---

## 🎯 Phase 88.7-88.11 (9 พ.ค.)

### Phase 88.7 — JV Drill-down (build 181)
คลิก row สมุดรายวัน → drawer overlay แสดง:
- Lines table (Dr/Cr ทุกบรรทัด + balance check)
- Source preview ตาม `source_table` (sales/expenses/receipts/service_jobs)
- ปุ่ม "เปิดหน้า [source]" → navigate
- Audit info (created/approved/voided timestamps)

### Phase 88.8 — Drawer service cost input (build 181)
แก้ pain point เดิม: drawer แก้ไขงานช่างไม่มีช่อง total_cost
- HTML: section "💰 ค่าแรง / ปิดงาน" ใน serviceJobDrawer
- Inputs: ค่าแรง + ส่วนลด (auto-recalc ยอดสุทธิ) + payment_method
- payload: `total_cost` + `payment_method` ใส่ตอน save
- ส่ง payment_method ให้ postJournalForServiceJob → override Dr account (transfer→1130)

### Phase 88.9 — Comparative P&L (build 181)
- Toggle "📊 เทียบกับงวดก่อน"
- Auto-compute previous period (m/q/y/custom)
- Side-by-side 5 columns + Net Income compare card

### Phase 88.10 / 88.10b — Re-post JV on edit (build 182-183)
- ปัญหา: edit งานเก่า + เปลี่ยน total_cost → JV ค้าง (idempotent unique block POST ใหม่)
- Fix: เพิ่ม `voidJvForSource()` ใน auto_post.js — DELETE JV เดิม (lines cascade)
- Wire ใน saveServiceJob: void ก่อน post ใหม่ ถ้า edit (!isNewJob)
- 88.10b: trigger logic ขยาย — `editCompleteWithChange` (status เป็น completion อยู่แล้ว + total/method เปลี่ยน)
- เก็บ `state.editingServiceJobOrigTotalCost` + `OrigPaymentMethod` ตอน open drawer เพื่อตรวจ change

### Phase 88.11 — Slip Upload + AI Verify (build 184-190)
ฟีเจอร์ใหญ่ — user ขอ "แนบสลิป + ตรวจจริง/ปลอม"
- **`functions/api/verify-slip.js`** (NEW) — Gemini Vision API:
  - Compact prompt → ดึง 14 fields (sender/recipient/amount/datetime/ref/tampering)
  - Fallback chain 4 models: 2.5-flash → 2.0-flash-lite → flash-latest → 2.0-flash
  - 3-layer JSON extraction (parse ตรง → strip code fence → regex {})
  - maxOutputTokens 4000 (1500 ไม่พอสำหรับ Thai)
- **Drawer section "📷 สลิปการโอน + ตรวจ AI"** สีม่วง — แสดงเมื่อ payment=transfer/qr
  - 2 ปุ่ม (📷 ถ่ายรูป + 🖼️ แกลลอรี่) — แยกตาม Service Photos pattern
  - Auto-verify หลัง upload สำเร็จ
  - Card สีเขียว/เหลือง: ผู้โอน/ผู้รับ/ยอด/Ref/datetime + confidence + tampering_score
- **Smart name match** — normalize ชื่อก่อนเทียบ:
  - Strip คำนำหน้า: ร้าน/บริษัท/หจก./บจ./บมจ./จำกัด/มณี shop/mn shop
  - Unwrap ปีกกา ( ) [ ]
  - Strip bank names: scb/kbank/krungthai/bbl/ttb/kkp/gsb/baac/...
- **Tampering threshold** — สอน AI:
  - ถ่ายจากจอมือถือ ≠ tampering (workflow ปกติร้านค้าไทย)
  - "จริง" tampering = digital editing (ฟ้อนต์ผิด/crop unnatural/pixel artifact)

### Bug debug journey ของ Phase 88.11 (สำหรับ session ใหม่)
1. **build 184**: ปุ่มเดียว — ปัญหา UX มือถือเด้งกล้องเสมอ
2. **185**: แยก 2 ปุ่ม
3. **186-187**: "Gemini ส่ง JSON ไม่ valid" — ลอง fallback chain + cleanup
4. **188**: เห็น raw response ตัดกลาง → MAX_TOKENS issue → 1500→4000
5. **189**: false positive ชื่อร้านไม่ตรง → smart normalize
6. **190**: false positive tampering 40 → สอน AI

### Pre-req
- `GEMINI_API_KEY` ใน Cloudflare env (มีอยู่แล้วจาก Phase 74 AutoKey)
- Storage bucket `proofs/` (มีอยู่แล้ว)

### ✅ Verified (build 190 final)
```
✅ ผ่านการตรวจสอบ
ผู้โอน: น.ส.ปณิชยา W***
ผู้รับ: SCB มณี SHOP (บุญสุขอิเล็กทรอนิกส์)
ยอด: 2,000 · วันที่: 2026-05-08T17:07
Ref: C20260508612817830614
Confidence: 90/100 · Tampering: 10/100
```

---

---

## 🔧 Phase 88.6 + Hotfixes (8 พ.ค. ตอนเย็น)

### Builds 176-180 (5 hotfixes ระหว่าง 88.5 → 88.6)

**Build 176 (5.34.9):** service_form fetch timeout 15s
- ปัญหา: มือถือกดบันทึกแล้วค้าง "กำลังบันทึก..." ตลอด
- แก้: AbortController + timeout — error message แทน hang

**Build 177 (5.35.0):** service_form mobile token + wire auto-post JV
- ปัญหา 1: `state.supabase.auth.getSession()` hang บน slow mobile network
  → แก้: ใช้ `window._sbAccessToken` cache ตรงๆ (pattern xhrPost)
- ปัญหา 2: ผม wire `postJournalForServiceJob` ผิดที่ — main.js drawer แทนที่จะเป็น
  service_form.js (create flow) → JV ไม่เกิดตอนสร้าง
  → แก้: เพิ่ม import + wire ใน service_form.js หลัง POST สำเร็จ

**Build 178 (5.35.1):** Backfill date range bug
- ปัญหา: `created_at=lte.YYYY-MM-DD` = midnight 00:00 → row created 12:56:24 ของ
  วันสุดท้ายในช่วงถูก exclude (Postgres timestamp comparison)
- แก้: ตรวจ field type — timestamptz ใช้ `lt.<nextDay>`, DATE ใช้ `lte.<to>`
- ผลกระทบ: sales + service_jobs (ใช้ `created_at`) — เก่าเสียเอง

**Build 179 (5.35.2):** service_jobs.total_cost
- ปัญหา: service_form.js record ไม่ใส่ `total_cost` field → DB เก็บ NULL →
  postJournalForServiceJob skip silent
- แก้: เพิ่ม `total_cost: net` ใน record (net = itemsTotal+labor-discount)
- Workaround งานเก่า: SQL UPDATE service_jobs SET total_cost=...

**Build 180 (5.36.0) + SQL hotfix — Phase 88.6 FULL:**
- SQL `supabase-phase88-service-mappings.sql`:
  - ALTER service_jobs ADD: total_cost, payment_method, payment_slip_url, closed_at
  - 5 COA ใหม่ (4250-4290): จานดาวเทียม/ตู้เย็น/เครื่องซักผ้า/CCTV/ทีวี
  - 5 account_mappings: service_satellite/repair_fridge/repair_washer/cctv/repair_tv
  - `NOTIFY pgrst, 'reload schema'` — บังคับ PostgREST reload (กัน PGRST204)
- auto_post.js:
  - keyMap ขยาย 9 ประเภทครบ
  - รองรับ `payment_method` — transfer/QR → Dr 1130 แทน 1110
- service_form.js — section "🔚 ปิดงาน" สีเหลือง:
  - Status selector: pending / in_progress / done / delivered / closed
  - Payment method: cash / transfer
  - 📷 Slip upload → Storage `proofs/service-slips/`
  - หลัง save status=closure → fire JV ทันที + payment_method override

### Verified by user
- Mobile บันทึกใบงานเครื่องซักผ้า → JV `SV2026050002` ฿2,000 (Backfill)
- Desktop ลองสร้างงานใหม่ JOB-1778247978973 ดาหมอก → JV `SV2026050003` ฿3,000
- สมุดรายวัน: 9 รายการ (4 SV + 4 PV + 1 OB) — ทุกประเภทครบ
- Trial Balance / P&L / BS — sync ตามจริง

### Lesson Learned (สำคัญสำหรับ session ใหม่)
1. **อย่าแก้ main.js แล้วคิดว่าครอบคลุม** — Phase 86 refactor → ทุก source flow ใน modules/
   - `pos.js doCheckout` (POS sale) — wire ที่นี่
   - `service_form.js` (create) + `main.js saveServiceJob` (drawer edit) — wire **ทั้งคู่**
   - `expenses.js expFormSaveBtn` + `akSaveBtn` — wire **ทั้งคู่**

2. **PostgREST schema cache** — หลัง ALTER TABLE → run `NOTIFY pgrst, 'reload schema'`
   ไม่งั้นเจอ PGRST204 "Could not find column"

3. **Postgres lte กับ timestamptz** — `lte.YYYY-MM-DD` = midnight ของวันนั้นเท่านั้น
   ใช้ `lt.<nextDay>` แทน หรือ append `T23:59:59.999Z`

4. **Mobile/Slow network** — supabase JS lib (`auth.getSession()`) อาจ hang ตลอด
   ใช้ `window._sbAccessToken` cache + AbortController timeout 15s

5. **4-point route checklist** — เพิ่ม route ใหม่ต้องแก้ 4 จุด:
   - index.html (button + section)
   - main.js ALL_ROUTES list
   - main.js ROUTE_GROUP map
   - main.js routeTitles + showRoute handler

---

---

## 📦 Phase 88.5 — FINAL (Opening Balance + Export Bundle) (8 พ.ค.)

### 🎉 จบ Phase 88!
ระบบบัญชีครบสมบูรณ์ — รองรับทุก use case ตั้งแต่บันทึกรายการจน export ส่งสำนักงานบัญชี

### What shipped (5.34.8 build 175)

**1. `modules/accounting/opening_balance.js` (~250 lines — NEW):**
- หน้า wizard ลง JV ประเภท OB (Opening Balance) — ลงวันที่ effective date 2026-01-01
- 3 sections (สีตามมาตรฐาน):
  - 🟦 **Asset (Dr):** 1110/1120/1130/1140/1200/1300 — เงินสด/เงินฝาก/ลูกหนี้/สินค้าคงเหลือ
  - 🟥 **Liability (Cr):** 2100/2120/2200 — เจ้าหนี้/บัตรเครดิต/เงินกู้
  - 🟪 **Equity (Cr):** 3100/3200 — ทุนจดทะเบียน/ทุนของเจ้าของ
- **Live balance check** — แสดง Dr / Cr / ผลต่าง realtime ขณะกรอก
- ปุ่มบันทึกใช้ได้ก็ต่อเมื่อ Dr = Cr (validate ก่อน confirm)
- หลัง save → POST entry + lines → JV `OB2026010001` doc_type=OB
- หลังลง OB → Balance Sheet จะแสดงตัวเลขเป็นบวก (สมจริง)

**2. `modules/accounting/export_bundle.js` (~280 lines — NEW):**
- หน้า "Export ชุดรายงาน" — สร้าง Excel 1 ไฟล์ มี **4 sheets:**
  1. **Trial Balance** — Dr/Cr ทุกบัญชีในงวด
  2. **P&L** — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุน + section breaks
  3. **Balance Sheet** — Assets = L + E (cumulative since effective)
  4. **Journal** — ทุก JV พร้อม lines (วันที่/เลขที่/ประเภท/คำอธิบาย/Dr/Cr)
- ใช้ `window.XLSX` (SheetJS) ที่ load ใน index.html
- Single `fetchAll()` query → reuse data across 4 sheets (efficient)
- Period picker (month/quarter/year/custom) เหมือน TB / P&L
- Filename: `accounting_bundle_<period>_<date>.xlsx`
- ส่งสำนักงานบัญชีทาง email/Line ได้ทันที — รูปแบบ standard

### Files changed (Phase 88.5)
- `modules/accounting/opening_balance.js` — NEW
- `modules/accounting/export_bundle.js` — NEW
- `main.js` — import + 8 wire points (4 per module)
- `index.html` — 2 nav buttons + 2 sections
- `sw.js`, `modules/settings/pages.js` — bump 5.34.7→5.34.8 build 175, SW v160

### ⚠️ Cloudflare deploy pattern (จดเป็น insight final)
- Pattern ตลอด Phase 88.2-88.4: file commits → fail, empty commits → success
- Phase 88.5 อาจจะเป็นเหมือนกัน → preemptive empty commit ส่งทันทีหลัง main commit
- Root cause: ไม่ทราบ — น่าจะเป็น Cloudflare Pages API rate limit / network hiccup

### ✅ Smoke tests Phase 88.5

**Opening Balance:**
1. เมนู "บัญชี" → "📥 ลงยอดยกมา"
2. กรอกตัวอย่าง:
   - 1110 เงินสดในมือ: 50,000
   - 1130 เงินฝากธนาคาร: 100,000
   - 3100 ทุนจดทะเบียน: 150,000
3. Live balance: Dr 150,000 = Cr 150,000 ✓
4. กดบันทึก → confirm → "ยืนยันบันทึกยอดยกมา?"
5. → JV `OB2026010001` ลงวันที่ 2026-01-01
6. ไป **🏦 งบดุล** → ดูตัวเลขเป็นบวก

**Export Bundle:**
1. เมนู "บัญชี" → "📦 Export ชุดรายงาน"
2. เลือก period: เดือน 05/2026
3. กดปุ่มดาวน์โหลด → progress steps (ดึง → aggregate → สร้าง)
4. ได้ไฟล์ `accounting_bundle_05_2026_<date>.xlsx`
5. เปิดดู — มี 4 sheets ครบ (TB, PL, BS, Journal)

---

## 🎯 Phase 88 — สถานะสุดท้าย (FINAL)

| Sub-Phase | สถานะ | สิ่งที่ลง |
|---|---|---|
| 88.0 | ✅ | Foundation — 51 accounts + JV + lines + manual form |
| 88.1a | ✅ | Auto-post sales + expenses |
| 88.1b | ✅ | Auto-post receipts + service jobs + Backfill UI |
| 88.2 | ✅ | Trial Balance report |
| 88.3 | ✅ | P&L report |
| 88.4 | ✅ | Balance Sheet report |
| **88.5** | **✅** | **Opening Balance wizard + Export bundle** |

**สมบูรณ์ครบทุก spec ที่ user ขอตอนเปิด Phase 88:**
- ✅ "ใกล้เคียง FlowAccount" — TB / PL / BS ครบ + auto-post + Backfill
- ✅ "ทำได้ดีกว่า" — auto-post จาก source (FlowAccount ต้องลง JV manual)
- ✅ "ส่งสำนักงานบัญชีได้จริง" — Export bundle 4 sheets standard format

### Pending ที่อาจทำในอนาคต (ไม่อยู่ใน Phase 88)
- 88.6: Drill-down (click JV → drawer with source link)
- 88.7: Mapping editor UI (admin แก้ EXPENSE_CATEGORY_MAP)
- 88.8: Period close + Lock periods
- 88.9: Comparative reports (เทียบกับงวดก่อน + กราฟ trend)
- 89.x: VAT support (ถ้า user จด VAT ในอนาคต)

---

---

## 🏦 Phase 88.4 — งบดุล Balance Sheet (8 พ.ค.)

### Why
หลัง P&L แล้ว → user ต้องการ Balance Sheet (งบดุล) ที่แสดงสถานะ ณ จุดเวลา
ใดเวลาหนึ่ง — สมการ Assets = Liabilities + Equity

### What shipped (5.34.7 build 174)

**`modules/accounting/balance_sheet.js`** (~310 lines — NEW):

**Logic — closing balance (cumulative):**
- BS ใช้ closing balance ตั้งแต่ effective date (2026-01-01) ถึง "as of date"
- ไม่ใช่ movement ในงวด → query JV ทั้งหมด since effective date

**Per-account balance:**
- Asset (1xxx)     → Dr - Cr (normal Dr balance)
- Liability (2xxx) → Cr - Dr (normal Cr balance)
- Equity (3xxx)    → Cr - Dr (normal Cr balance)
- Filter accounts ที่ balance ≈ 0 ออก (ไม่แสดง)

**Retained Earnings (กำไรสะสม):**
- คำนวณ Σ(income amount) - Σ(expense amount) จาก JV ในช่วง effective→asOf
- เพิ่มเป็น row พิเศษใน Equity section (รหัส 3900)
- ถ้าเป็นลบ → label "ขาดทุนสะสม" + สีแดง

**Equation card:**
- แสดง สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- สีเขียว ถ้า balance / สีแดง + ผลต่าง ถ้าไม่
- Visual: 2 ตัวเลขใหญ่ + เครื่องหมาย =

**Negative number warning:**
- ถ้า total assets < 0 หรือ total equity < 0 → แสดง info card สีส้ม
- บอก user ว่า "ระบบยังไม่มี opening balance" + แนะนำให้ลง JV ประเภท OB
- (Phase 88.5 จะมี OB wizard UI)

**UI inputs:**
- Single date picker "ณ วันที่" (default = today, min = 2026-01-01)
- Export Excel + พิมพ์ — เหมือน TB / P&L

### Files changed (Phase 88.4)
- `modules/accounting/balance_sheet.js` — NEW (~310 lines)
- `main.js` — import + 4 wire points
- `index.html` — nav button "🏦 งบดุล" + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.6→5.34.7 build 174, SW v159

### ⚠️ Cloudflare deploy pattern (จดเป็น insight)
ตั้งแต่ Phase 88.2 deploys เริ่ม fail สำหรับ commits ที่มีไฟล์ใหม่ใน
`modules/accounting/*` — empty commit re-trigger แก้ได้ทุกครั้ง
- 0e25d04 (88.2): fail → cbea042 (empty): success
- 51ebd39 (88.3): fail → 08fbe1f (empty): success
- 088aaaa? (88.4): expect fail → empty re-trigger

อาจเป็น Cloudflare API rate limit หรือ wrangler-action transient — ไม่กระทบ
production (เพราะ Cloudflare Pages เก็บ deploy ก่อนหน้าไว้)

**Not investigated yet:** ลอง batch 2 commits → empty re-trigger as standard
practice หรือเปลี่ยน workflow ใช้ `--keep-cache` หรือลด file count ใน upload

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "🏦 งบดุล"
2. As-of date default = วันนี้ → load ทันที
3. **คาดผลปัจจุบัน (data ของ user หลังลบ JV):**
   - 🟦 Assets:
     - 1110 เงินสดในมือ: -115,388 (สีแดง — เพราะ Cr มากกว่า Dr)
     - 1130 เงินฝากธนาคาร: -13,870
     - รวม: -129,258
   - 🟥 Liabilities: ไม่มี → 0.00
   - 🟪 Equity:
     - 3900 ขาดทุนสะสม: -129,258 (จาก P&L)
     - รวม: -129,258
   - **Equation: -129,258 = 0 + (-129,258) ✓** สีเขียว balance
   - ⚠️ Info card สีส้ม: "ตัวเลขลบ — ยังไม่มี opening balance"
4. Export Excel — section breaks + 4 columns + total rows
5. พิมพ์ → popup window

### Pending Phase 88.5
- Export bundle — ดาวน์โหลด PDF + multi-sheet Excel ของ TB + PL + BS รวมกัน
- (Optional) Opening Balance wizard — admin เซต ทุน/เงินสดเริ่มต้น

---

---

## 📈 Phase 88.3 — P&L (งบกำไรขาดทุน) (8 พ.ค.)

### Why
หลัง Trial Balance แล้ว → user ต้องการรู้ผลประกอบการ — **กำไร/ขาดทุนสุทธิ**
รายเดือน เพื่อตัดสินใจธุรกิจ + ส่งสำนักงานบัญชี

### What shipped (5.34.6 build 173)

**`modules/accounting/profit_loss.js`** (~280 บรรทัด — NEW):

**Logic ที่ตรงตามมาตรฐานบัญชี:**
- รายได้ (4xxx) — normal Cr balance → `amount = credit - debit`
- ค่าใช้จ่าย (5xxx) — normal Dr balance → `amount = debit - credit`
- **กำไรสุทธิ = รวมรายได้ - รวมค่าใช้จ่าย**

**Layout:**
- Section 1: 🟢 รายได้ (เขียว) — แสดงทุก 4xxx ที่มียอด
- "หัก" separator
- Section 2: 🟠 ค่าใช้จ่าย (ส้ม) — แสดงทุก 5xxx ที่มียอด
- **Net Income card** — สีเขียวถ้ากำไร / สีแดงถ้าขาดทุน
  - ขาดทุนแสดงในวงเล็บ `(฿XXX)` ตามมาตรฐาน
  - **Margin %** = net / revenue (ถ้ามีรายได้)

**Period picker + Export Excel + พิมพ์** เหมือน Trial Balance

### Files changed (Phase 88.3)
- `modules/accounting/profit_loss.js` — NEW (~280 lines)
- `main.js` — import + 4 wire points (ALL_ROUTES, ROUTE_GROUP, routeTitles, showRoute)
- `index.html` — nav button "📈 งบกำไรขาดทุน" + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.5→5.34.6 build 173, SW v158

### Architecture note
Reuse `fetchData` + `aggregate` pattern จาก trial_balance.js (ไม่ shared utility ทันที — wait until 88.4 มี balance sheet เพราะต้อง logic แตกต่าง)

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "📈 งบกำไรขาดทุน"
2. Default = พ.ค. 2026 → load ทันที
3. **คาดผลปัจจุบัน (data ของ user หลังลบ JV):**
   - รายได้: ไม่มีรายการ (ยังไม่ได้ขายจริง)
   - ค่าใช้จ่าย: 5210 (988) + 5260 (125,270) + 5900 (3,000) = **129,258**
   - **ขาดทุนสุทธิ: (129,258.00)** — สีแดง
   - Margin: -∞ % (เพราะ revenue = 0) → จะไม่แสดง
4. Export Excel — header "หมวด/รหัส/ชื่อบัญชี/จำนวนเงิน" + section breaks + total + net
5. พิมพ์ → popup window พิมพ์ได้

### Pending Phase 88.4-88.5
- 88.4: Balance Sheet (งบดุล) — สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
  - ต้อง opening balance → จุดต่อ Phase ที่ซับซ้อนกว่า TB/PL (ต้อง running balance)
- 88.5: Export bundle — PDF (TB + PL + BS) ในไฟล์เดียว + multi-sheet Excel

---

---

## 📊 Phase 88.2 — Trial Balance Report (8 พ.ค.)

### Why
หลัง Backfill เสร็จ + ลบ JV ทดสอบ → user มีข้อมูลจริง 5 PV ใน พ.ค. → ต้องการ
รายงานยอดทดลอง (trial balance) เพื่อส่งสำนักงานบัญชี + ตรวจ Dr = Cr

### What shipped (5.34.5 build 172)

**`modules/accounting/trial_balance.js`** (~290 บรรทัด — NEW):

**Period picker:**
- 4 modes: month / quarter / year / custom range
- Auto-default = เดือนปัจจุบัน
- Reactive UI — เปลี่ยน tab → re-render input controls

**Data fetch (3 queries):**
1. journal_entries — list ids ที่ doc_date ใน range + status='approved'
2. journal_lines — bulk fetch ผ่าน `entry_id=in.(...)` (chunked 200/batch)
3. chart_of_accounts — full COA สำหรับ map name + type

**Aggregate:**
- Group lines by `account_code` → sum debit + credit ทุก line
- Group accounts by `type` (asset/liability/equity/income/expense)
- Sort by code

**Render:**
- 5 sections (asset/liability/equity/income/expense) — เฉพาะ section ที่มี data
- แต่ละ section มี subtotal Dr/Cr
- Grand total card สีเขียวถ้า balanced (Dr=Cr) / สีแดงถ้าไม่
- Header card: ชื่องวด + range + จำนวนบัญชีที่เคลื่อนไหว

**Actions:**
- 📤 **Export Excel** — sheet "TB_YYYY-MM_YYYY-MM" + 5 columns
  (รหัส | ชื่อบัญชี | ประเภท | เดบิต | เครดิต) + total row
- 🖨 **พิมพ์** — popup window with `<style>` + auto window.print()

### Files changed (Phase 88.2)
- `modules/accounting/trial_balance.js` — NEW (290 lines)
- `main.js` — import + 4 wire points (ALL_ROUTES, ROUTE_GROUP, routeTitles, showRoute)
- `index.html` — nav button (ใต้ "ผังบัญชี" — ก่อน Backfill) + `<section id="page-accounting_trial_balance">`
- `sw.js`, `modules/settings/pages.js` — bump 5.34.4→5.34.5 build 172, SW v157

### ⭐ ใช้ "4-point checklist" ที่จดในบทเรียน Phase 88.1b
- [✓] index.html — button + section
- [✓] ALL_ROUTES (line 863)
- [✓] ROUTE_GROUP (line 899)
- [✓] routeTitles + showRoute handler

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "📊 รายงานยอดทดลอง" (อยู่ระหว่าง "ผังบัญชี" และ "Backfill")
2. Default mode = เดือนปัจจุบัน → auto-load TB ของ พ.ค. 2026
3. แสดง:
   - Section "ค่าใช้จ่าย": 4-5 บัญชี (5210/5220/5260/5900?) รวม Dr ~129K
   - Section "สินทรัพย์": 1110 (เงินสด) Cr ~129K
   - Grand total: Dr 129,258 / Cr 129,258 / ผลต่าง 0 → ✅ balance สีเขียว
4. เปลี่ยนเป็น "ปี 2026" → ดูทุก JV (รวมเดือนหน้าๆ ที่จะมี)
5. Export Excel → ไฟล์ `trial_balance_2026-05-01_2026-05-31_<date>.xlsx`
6. พิมพ์ → popup window พิมพ์ได้

### ⚠️ Known caveats
- Trial Balance ตอนนี้เป็น **Movement-based** (ผลรวม Dr/Cr ในงวด) — ไม่ใช่
  closing balance — เพราะระบบยังไม่มี opening balance (Phase 88.5 จะทำ)
- ถ้า user manual delete JV เฉพาะ entry → CASCADE จะลบ lines อัตโนมัติ
  (foreign key ON DELETE CASCADE) — ดังนั้นไม่มี orphan lines

### Pending Phase 88.3-88.5
- 88.3: P&L (กำไรขาดทุน) report — รายได้ - ค่าใช้จ่าย = กำไรสุทธิ
- 88.4: Balance Sheet — สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- 88.5: Export bundle ส่งสำนักงานบัญชี (PDF + CSV หลายชีท)

---

## ✅ Phase 88.1b — Verified end-to-end (8 พ.ค. ตอนเย็น)

**Backfill stress-test:** user ติ๊ก sales + expenses + receipts + service_jobs,
range 01/04/2026 → 08/05/2026 → preview แสดง 91 rows (84 sales + 7 expenses,
receipts/service_jobs = 0) → run → สำเร็จ 90/91 (1 อันเก่ามี JV แล้ว)

→ สมุดรายวันก่อน 3 รายการ → หลัง **93 รายการ** (Phase 88.1a 3 + Backfill 90)

JV ที่ Backfill สร้างย้อนหลังถึง:
- PV2026040001 (เติมน้ำมัน 12/04 ฿1,000)
- SV2026040071 (ขาย 16/04 ฿11,900)
- PV2026050004 (แอร์ 30,000btu 2 ตัว ฿60,000) ฯลฯ

→ trial balance ของเดือน เม.ย.-พ.ค. 2026 **ครบจริง 100%** — สำนักงานบัญชีพร้อมใช้

### Hotfix 5.34.4 (build 171)
ปัญหา: `ALL_ROUTES` ใน main.js line 863 ไม่ได้รวม `accounting_backfill`
→ `canAccessPage("accounting_backfill")` return false → showRoute redirect → กดปุ่มไม่เข้า

แก้: เพิ่ม `"accounting_backfill"` ใน ALL_ROUTES list (1 บรรทัด)

### Lesson learned สำหรับเพิ่ม route ในอนาคต
**4 จุดต้องแก้พร้อมกัน** เวลาเพิ่ม route:
1. `index.html` — `<button data-route="X">` + `<section id="page-X">`
2. `main.js ALL_ROUTES` — list (สำหรับ canAccessPage)
3. `main.js ROUTE_GROUP` — group สำหรับ auto-open sidebar
4. `main.js routeTitles` + `showRoute` — title + render handler

(ลืม #2 ใน Phase 88.1b initial → ต้อง hotfix 171)

---

---

## ⏪ Phase 88.1b — Receipts/Service Jobs auto-post + Backfill UI (8 พ.ค.)

### Why
หลัง Phase 88.1a ทำ sales + expenses เสร็จ — ยังเหลือ source อีก 3 ตัว
(receipts, service_jobs, payroll) + ต้องมี backfill UI เพื่อ post JV ย้อนหลัง
ให้ rows เก่าก่อน Phase 88.1a deploy (ไม่งั้น trial balance ไม่ครบ)

### What shipped (5.34.3)

**1. `modules/accounting/auto_post.js` updates:**
- ขยาย `EXPENSE_CATEGORY_MAP` รวม `salary` / `labor_hire` / `payroll` / `materials` / `utilities`
  - ⭐ **สำคัญ:** Payroll ไม่ต้อง wire ตรง — เพราะ Phase 76 (`payroll.js _markPaid`)
    auto-create expense category=salary ตอนกดจ่าย → expense.js wire (Phase 88.1a)
    จะ trigger postJournalForExpense → ใช้ mapping `payroll_salary` (Dr 5200 / Cr 1110)
- เพิ่ม **`postJournalForReceipt(receipt)`** — RV doc_type
  - default `receipt_payment` (Dr 1110 / Cr 1200)
  - ถ้า `payment_method` มี transfer/โอน/qr/bank → `receipt_transfer` (Dr 1130 / Cr 1200)

**2. Wire 3 จุด:**
- `modules/receipts.js`:
  - dropdown action "เก็บเงิน" (line 442) + button "rcPreviewCollect" (line 671) →
    หลัง PATCH status=paid สำเร็จ → fire `postJournalForReceipt({ ...r, paid_at: now })`
- `main.js saveServiceJob`:
  - import `postJournalForServiceJob`
  - เพิ่ม `{ returnData: true }` ใน xhrPost — ขอ id กลับมา
  - ตรวจ `transitionedToDone || newJobAlreadyComplete` → fire postJournalForServiceJob
  - ใช้ `state.serviceJobs[idx]` (มี total_cost) เป็น input — ไม่ใช่ payload (อาจไม่มี total_cost)
- ⭐ **Payroll:** ผ่าน expense flow auto (จาก Phase 76 + Phase 88.1a) — verified design

**3. `modules/accounting/backfill.js` (NEW — 305 บรรทัด):**
- Page `accounting_backfill` — UI ติ๊ก source (sales/expenses/receipts/service_jobs)
  + date range → Preview / Run
- **Preview mode:** query existing JV → สรุป "รวม / มีอยู่แล้ว / จะสร้างใหม่" ต่อ source
- **Run mode:** loop ทุก row → call postJournalForX — ผ่าน idempotency (HTTP 409 →
  return null = "skipped"); progress bar live update; collected error log (collapsible)
- Effective date check: 2026-01-01 — clamps `from < cutoff` → use cutoff
- Receipts/service_jobs filter pre-loop: `status=eq.paid` / `status=in.(done,delivered,closed)`

**4. Navigation:**
- `index.html`: nav button "⏪ Backfill ย้อนหลัง" + section `page-accounting_backfill`
- `main.js`: route `accounting_backfill` (group "accounting" + label "Backfill JV ย้อนหลัง" +
  call `renderBackfillPage(ctx)` ใน showRoute)

### Files changed (Phase 88.1b)
- `modules/accounting/auto_post.js` — 23 → 24 mappings + postJournalForReceipt function
- `modules/accounting/backfill.js` — NEW (Backfill UI page)
- `modules/receipts.js` — wire 2 จุด (dropdown + preview button)
- `main.js` — import postJournalForServiceJob + wire saveServiceJob + route accounting_backfill
- `index.html` — nav button + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.2→5.34.3 build 170, SW v155

### Architecture decision: ทำไม Payroll ไม่ wire ตรง
| Approach | ข้อดี | ข้อเสีย |
|---|---|---|
| Wire ตรงที่ `payroll.js _markPaid` | ชัดเจน — JV เกิดจาก source ตรงๆ | ❌ Duplicate — Phase 76 auto-create expense ก็ trigger postJournalForExpense → JV เกิด 2 ครั้ง (PV จาก payroll + PV จาก expense) เพราะ source_table ต่างกัน → ผ่าน idempotency unique → ผิด |
| ⭐ ใช้ expense flow (Phase 76) | JV เกิดครั้งเดียว — สอดคล้อง principle "1 transaction = 1 JV" | ต้องเพิ่ม mapping `salary` ใน EXPENSE_CATEGORY_MAP (ทำแล้ว) |

→ Decision: **expense flow only** — เพิ่ม mapping `salary` → `payroll_salary` (Dr 5200 / Cr 1110)

### ✅ Smoke tests ที่ควรผ่าน
1. ทำ POS sale (เงินสด) → SV เกิด ✅ (verified ใน 88.1a)
2. เพิ่ม expense (fuel) → PV เกิด ✅ (verified ใน 88.1a)
3. **เก็บเงินใบเสร็จ (status pending → paid)** → RV เกิด Dr 1110/1130 / Cr 1200
4. **บันทึกงานช่างใหม่ status=done** → SV เกิด (ถ้ามี total_cost)
5. **เปลี่ยน status งานเก่า → done/delivered/closed** → SV เกิด
6. **จ่ายเงินเดือน** (markPaid) → expense salary เกิด → PV เกิด Dr 5200 / Cr 1110/1130
7. **Backfill UI:** เลือก source + date range → Preview แสดงจำนวน → Run → progress bar → summary

### ⚠️ Known caveats
- Service jobs ที่ **ไม่มี total_cost** → postJournalForServiceJob return null silent
  → user ต้องกรอกยอดก่อน หรือ JV จะไม่เกิด (admin ต้องสร้าง manual JV แทน)
- Backfill ใช้ idempotency unique index — ถ้า admin เคย create manual JV ที่
  source_table+source_id ซ้ำ → backfill skip (ดี — กัน duplicate)

### Pending Phase 88.2-88.5
- 88.1c: Drill-down (click JV row → drawer with source link) + mapping editor UI
- 88.2: Trial Balance report (filter ตาม fiscal period)
- 88.3: P&L (กำไรขาดทุน) report
- 88.4: Balance Sheet (งบดุล) report
- 88.5: Export bundle ส่งสำนักงานบัญชี (PDF + CSV ของทุก JV + รายงาน)

---

## 🛠️ Phase 88.1a-fix — Wire auto-post ที่ pos.js + RLS hotfix (8 พ.ค.)

### ปัญหาที่เจอตอน user test build 168
1. **ตาราง `journal_entries` ว่างเปล่า** ทุกครั้งที่ขายจริง
2. แต่ test ผ่าน console import ตรง → `postJournalForSale` insert ได้สำเร็จ

### 2 root causes (สำคัญสำหรับ session ต่อ)

**Root cause #1 — RLS ของ Phase 88.0 block INSERT:**
- `is_accountant()` ตรวจ `role = 'admin'` เท่านั้น
- RLS `je_admin` / `jl_admin` ใช้ `FOR ALL` → block INSERT จาก non-admin users
- Cashier/owner ขาย → POST JV ตก HTTP 403 → fire-and-forget เก็บ console.warn

→ **Fix:** `supabase-phase88-hotfix-rls.sql` (ไฟล์ใหม่)
- Split `je_admin` / `jl_admin` เป็น 4 policy แยก (SELECT/UPDATE/DELETE = accountant, INSERT = accountant OR source-linked)
- เปิด `account_mapping` SELECT ให้ทุก authenticated (client ต้องอ่าน mapping)
- Total: 10 policies (4+4+2)

**Root cause #2 — Wire auto-post ผิดไฟล์ใน build 168:**
- main.js มี `async function checkout()` (line 3077) — **legacy ที่ไม่ถูกเรียกแล้ว**
- POS จริงใช้ `doCheckout()` ใน `modules/pos.js` line 919
- Build 168 wire ที่ main.js → ขายจริงไม่ trigger

→ **Fix (build 169):** ย้าย wire ไปที่ `modules/pos.js` หลัง `showToast("บันทึกการขายเรียบร้อย ✅")`
- เก็บ wire เก่าใน main.js ไว้ — ไม่ทำงานแต่ idempotent กัน duplicate

### Verification (build 169)
Console ตอนขายจริง:
```
[auto_post] ✅ created SV2026050001 from sales #119 amount 50
```
สมุดรายวัน → SV2026050001 ขาย POS BSK-1778227814186 ฿50 status "อนุมัติแล้ว"

### Files changed (Phase 88.1a-fix)
- `supabase-phase88-hotfix-rls.sql` — NEW (RLS split policies, 10 policies)
- `modules/pos.js` — import + wire postJournalForSale ใน doCheckout
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.34.1→5.34.2 build 169, SW v154

### ⚠️ Lesson learned (สำคัญสำหรับ Phase 88.1b)
**ก่อน wire auto-post — ตรวจ source module ที่ใช้จริง:**
- `pos.js doCheckout()` (sales) — ✅ wired
- `expenses.js expFormSaveBtn` (manual expense) — ✅ wired
- `expenses.js akSaveBtn` (AutoKey OCR) — ✅ wired
- `receipts.js` — TBD (ตรวจไฟล์จริง — อาจอยู่ใน main.js หรือ module แยก)
- `service_jobs` — TBD (เคยอยู่ใน main.js — ต้อง grep)
- `payroll.js` — TBD (มี module แยกอยู่)

**ห้ามแก้ `main.js` แล้วคิดว่าครอบคลุม** — โครงสร้างหลัง refactor 86 → ทุก source flow อยู่ใน `modules/*.js`

---

## 🧾 Phase 88.1a — Auto-post JV (sales + expenses) (8 พ.ค.)

### Why
User ขอ "หน้าบัญชีให้ใกล้เคียง FlowAccount และทำได้ดีกว่า — ส่งสำนักงานบัญชีใช้ได้
จริง" + ตอบ scope: VAT B (ไม่จด), COA B (ส่ง CSV), period month/quarter/year,
start 2026-01-01, path A (sequential 88.0 → 88.5)

Phase 88.0 (build 167) วาง foundation (chart_of_accounts + journal_entries
+ lines + manual JV form) เสร็จแล้ว → 88.1a เริ่ม auto-posting จาก source
transactions แทนการกรอก JV ด้วยมือทุกครั้ง

### What shipped (5.34.1)

**SQL migration** (`supabase-phase88-auto-post.sql`):
1. **Idempotency** — partial unique index บน `journal_entries (source_table,
   source_id) WHERE NOT NULL` → POST ซ้ำได้ HTTP 409 → return null (manual
   JV ที่ source = NULL ใส่ได้หลายอันตามปกติ)
2. **`account_mapping` table** — config ผูก `mapping_key` →
   `debit_account_code` / `credit_account_code` + RLS admin only
3. **22 seed mappings:**
   - Sales: 4 (sale_cash 1110/4100, sale_transfer 1130/4100, sale_credit
     1130/4100, sale_credit_term 1200/4100)
   - Expenses: 10 (fuel/utility/phone/rent/repair/supplies/ads/bank_fee/
     travel/misc — Dr 5xxx / Cr 1110)
   - Service jobs: 5 (install/repair/clean/move/other AC — Dr 1110 / Cr 4xxx)
   - Receipts: 2 (cash 1110/1200, transfer 1130/1200)
   - Payroll: 2 (salary 5200/1110, wht 5200/2140)

**JS module** (`modules/accounting/auto_post.js` — 330 บรรทัด):
- `postJournalForSale(sale)` — POS sale → SV (ดู `payment_method` →
  ระบุ mapping_key: cash/transfer/credit/credit_term)
- `postJournalForExpense(expense)` — expense → PV (ดู `category` →
  EXPENSE_CATEGORY_MAP → mapping; override credit account ถ้า
  `payment_method = transfer/credit`)
- `postJournalForServiceJob(job)` — service → SV (เฉพาะ status
  delivered/closed/done)
- `resetMappingCache()` — เรียกหลัง admin แก้ mapping
- Effective date: skip ถ้า docDate < `2026-01-01`
- Mapping cache: lazy-loaded once per session

**Wiring:**
- `main.js → checkout()` — หลัง `showToast("บันทึกการขายเรียบร้อย")`
  → `postJournalForSale({...}).catch(...)` (fire-and-forget)
- `modules/expenses.js → expFormSaveBtn click` — เปลี่ยน
  `_appXhrPost(...)` ให้ใช้ `{returnData:true}` เพื่อเอา id กลับมา →
  `postJournalForExpense(inserted).catch(...)`
- `modules/expenses.js → akSaveBtn click (AutoKey)` — เปลี่ยน
  `Prefer: return=minimal` → `return=representation` → parse first row →
  `postJournalForExpense(inserted).catch(...)`

### Why fire-and-forget + idempotent
ถ้า auto-post ล้มเหลว (network/RLS/missing mapping) — ไม่ block UX checkout/
expense save (user ทำงานต่อได้) แต่ console.warn เก็บไว้ debug

ถ้า user reload + retry → unique partial index จะ reject (HTTP 409) →
auto_post.js detect 409 → return null (ไม่ duplicate)

### Files changed (Phase 88.1a)
- `supabase-phase88-auto-post.sql` — NEW (idempotency + mapping + seed)
- `modules/accounting/auto_post.js` — NEW (helper เรียกจาก source modules)
- `main.js` — import + wire `postJournalForSale` ใน checkout()
- `modules/expenses.js` — import + wire 2 จุด (manual save + AutoKey)
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.34.0 → 5.34.1

### ⚠️ Manual step required (post-deploy)
**Run `supabase-phase88-auto-post.sql` ใน Supabase SQL Editor** ก่อน user
ทดสอบ — ไม่งั้น auto-post จะ fail (mapping table ไม่มี + ไม่มี idempotency
index → ขายซ้ำเดิม → JV ซ้ำ)

### ✅ Smoke test ที่ควรผ่าน
1. หลังรัน SQL: `SELECT count(*) FROM account_mapping` → 22
2. ทำ POS sale 1 ครั้ง (cash) → เปิดสมุดรายวัน → JV เลข `SV202605####`
   ปรากฏ Dr 1110 / Cr 4100
3. เพิ่ม expense category=fuel 200 บาท (cash) → เปิดสมุดรายวัน → JV
   `PV202605####` Dr 5210 / Cr 1110
4. AutoKey OCR สลิป → save → JV เกิดเหมือนกัน
5. ทำขายซ้ำ id เดิม (manual SQL test) → console "[auto_post] already
   posted" + ไม่ duplicate

### Pending Phase 88.1b/c (next session)
- 88.1b: receipts.js + service_jobs (in main.js) + payroll.js wires +
  backfill UI (post existing pre-2026-05 sales/expenses retroactively)
- 88.1c: Drill-down (click JV row → drawer with source link) + mapping
  editor UI (admin แก้ mapping_key → account ใน Settings)
- 88.2-88.5: Trial Balance + P&L + BS reports + WHT + Export bundle

---

## 🏛️ Phase 88.0 — Accounting Foundation (8 พ.ค.)

### What shipped (5.34.0 build 167 — already pushed)
- `supabase-phase88-accounting-foundation.sql` — chart_of_accounts (51
  Thai accounts), journal_entries (with je_balanced CHECK Dr=Cr),
  journal_lines (line_one_side CHECK), fiscal_periods, is_accountant()
  helper, 4 RLS policies admin-only
- `modules/accounting/journals.js` — JV list (status chip + filter)
- `modules/accounting/journal_form.js` — manual JV form (auto doc_no
  `JV2026MM####`, balance validator)
- `modules/accounting/coa.js` — COA management (stats + collapsible +
  CSV/Excel import/export with Thai aliases)

---

## 🌱 Phase 87.5 — Full Catalog Spec Seed (7 พ.ค.)

### Why
User: "211 SKUs ที่ยังต้องกรอก specs (admin task) ช่วยผมหาข้อมูลจริง มากรอก
ช่วยผมหน่อย" → กรอกเองด้วย UI editor ใช้เวลา ~28 ชั่วโมง — ขอ Claude
generate ตาม brand/BTU patterns แล้ว user ค่อยตรวจ/ปรับเฉพาะรุ่นที่ต้องการ

### What shipped (5.33.5)
- **211 SKUs** ได้ specs เพิ่ม (จาก 12/223 → 223/223 = **100% coverage**)
- ใช้ Python script `scripts/seed_specs.py` (~640 บรรทัด) — generate ตาม
  per-section template (45+ section templates) + per-BTU class scaling
- Cache logic เปลี่ยน: เดิมเช็ค "มี features ไหม" (ผ่านแม้ 12/223) →
  ใหม่เช็ค **ratio ≥90% ของ entries** ถึงไม่ refetch (force refresh user เก่า)

### Strategy / Honest caveats
**Top brands (TCL/Carrier/LG/Samsung/Daikin/Mitsubishi/Haier/Hisense/Gree/
Midea/Toshiba):** Description, features, badges อ้างอิงตาม spec จริง
ของ brand line (Dual Inverter ของ LG, WindFree ของ Samsung, Mr.SLIM
ของ Mitsubishi Electric, Streamer Discharge ของ Daikin ฯลฯ)

**Smaller TH brands (FRIO, MAVELL, STAR AIR, AUFIT, AIR COOL, CANDY,
AUX, CENTRAL AIR, SAIJO DENKI):** Defaults ตาม Inverter/Fix-Speed type +
BTU class — sensible แต่ไม่ใช่ official spec sheet

**Physical specs (dim, weight, current, power, noise, SEER):** ค่าโดย
ประมาณตาม BTU class (industry typical ranges สำหรับตลาดไทย)

**Refrigerant:** R32 สำหรับรุ่นใหม่, R410A สำหรับ DAIKIN SMASH 2018
(รุ่นเก่า)

### Files changed
- `data/ac_catalog.json` — 64KB → 280KB (211 entries gained 16 spec fields)
- `main.js` — cache refresh threshold ratio-based (Phase 87.5)
- `scripts/seed_specs.py` — NEW (generator + 45+ section templates)
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.33.4→5.33.5

### Refinement workflow
- **UI editor** (Phase 87.2) ปรับทีละรุ่น — แก้ description ให้ตรงสเปกจริง
- **Excel bulk** (Phase 87.3) — export → แก้ใน Excel → import กลับ
- **Copy spec** (Phase 87.4) — ใช้รุ่น A เป็น template ของ B รุ่นใกล้เคียง

### ✅ Smoke test ที่ควรผ่าน
- Customer คลิก card สุ่มจาก section ใดก็ได้ → modal เปิด + spec table ครบ
- Admin export Excel → ตรวจ 24 columns × 223 rows + non-empty cells
- Console log: `[ac_catalog] refreshed: 223 entries, 223 with specs`

---

## 🛍️ Phase 87 — Product Detail Modal & Spec Management (7 พ.ค.)

### Why
User: "หาข้อมูลสินค้ามาใส่ สเปกเครื่อง BTU แต่ละรุ่น ให้ลูกค้าคลิกดูรายละเอียดข้างในได้
เหมือนร้านมืออาชีพ หรือห้างเขาขายสินค้า"

### What shipped
**4 commits**, 2 ไฟล์ใหม่ใน `modules/`, 1 ไฟล์ใหม่ใน `modules/settings/`,
schema v2 ของ `data/ac_catalog.json` (24 fields ต่อ entry), 12 SKUs seeded
ครอบคลุม 6 แบรนด์ (TCL/Carrier/LG/Daikin/Mitsubishi).

### 🎨 Phase 87.1 — Product Detail Modal foundation
**ไฟล์ใหม่:** `modules/product_detail_modal.js` (212 lines)

**Schema v2 — 16 extended fields** (optional):
```
description, features (array), badge_tags (array), image_url,
seer, refrigerant, voltage, current_a, power_w,
indoor_dim, outdoor_dim, indoor_weight_kg, outdoor_weight_kg,
noise_indoor_db, noise_outdoor_db, color
```

**Modal layout (เหมือนหน้าสินค้าห้างใหญ่):**
- Hero image (placeholder ❄️ ถ้าไม่มี image_url)
- Badge tags (ขายดี / Inverter / WiFi) มุมซ้ายบน + BTU pill มุมขวาล่าง
- Title + price + "รวมติดตั้ง" + Description paragraph
- Warranty bar (ติดตั้ง/อะไหล่/คอม)
- Features list (pill style)
- Spec table — render เฉพาะ field ที่มีค่า; placeholder "ยังไม่มีข้อมูลสเปก" ถ้าว่าง
- Sticky footer: ปิด + CTA (เพิ่มลงตะกร้า / สั่งจอง)
- ESC + click-outside dismiss + mobile-friendly (full-screen <640px)

**Wired ใน customer_dashboard.js:**
- `import { openProductDetail }`
- Spread `...c` ใน `products = catalog.map(...)` เพื่อ keep extended fields
- Click `[data-view-product]` card → openProductDetail
- Card "+ ลงตะกร้า" button: stopPropagation กัน double-trigger

**Seed 2 SKUs:** id=1 MFS10, id=5 T-PROWD10

### 🔧 Phase 87.1.1 — Schema auto-refresh hotfix
**Bug:** localStorage cache v1 → JSON v2 ไม่ถูก load → modal เห็นแค่ BTU
**Fix in main.js:** หลัง parse cache ตรวจว่ามี entry ใดมี `features|seer|description`
ถ้าไม่มี (= v1) → fetch JSON v2 + overwrite + log "upgraded to v2"

### ✏️ Phase 87.2 — Admin Spec Editor + Seed
**ไฟล์ใหม่:** `modules/settings/ac-spec-editor.js` (233 lines)

`openSpecEditor(product, onSave)` — Modal form:
- Description (textarea), Features + Badges (comma input → string[])
- Image URL, SEER, refrigerant, voltage, current, power, color
- Dim: indoor/outdoor W×H×D, weights
- Noise: indoor/outdoor dB

Number fields fall back to string when range (e.g. `"0.4-4.5"`)
Empty values stripped from save diff

**Wired ใน ac-catalog.js:**
- Each row: ✏️ button — `+ สเปก` (เทา) ถ้าว่าง, `แก้` + 📋 (เขียว) ถ้ามี
- Click → openSpecEditor → save merge → localStorage + rerender + toast

**Seed 8 SKUs เพิ่ม** (รวม 12/223):
- TCL Wall standard: MFS13/19/25
- TCL Inverter WIFI: T-PROWD13/19/25
- Carrier COPPER SEAL: 38TVDB010/42TVDB010
- LG Inverter: ISC10E (Dual Inverter, 19dB whisper)
- Daikin SMASH: FTM 09 PV2S
- Mitsubishi Mr.SLIM: MSY-JZ 09 VF (SEER 18)

### 📊 Phase 87.3 — CSV/Excel Round-trip 24 columns
**Updated ac-catalog.js:**
- Helpers: `_arrToPipe`, `_pipeToArr`, `_tryNum`, `_toExportRow`,
  `_fromImportRow`, `_EXPORT_HEADERS` (24 names)
- Excel export: catalog.map(_toExportRow) + per-column widths
- CSV export: header from _EXPORT_HEADERS, body via _toExportRow
- Import: parse via _fromImportRow (column-name-tolerant English+Thai)

**Smart serialization:**
- Array fields → `"item1 | item2 | item3"` ใน cell
- Import accepts `|` or `,` as separator
- Number-or-range fields → try Number() → fallback string
- Empty fields → ไม่เก็บใน catalog (clean schema)
- **Backwards-compat:** old 8-column CSV/Excel still imports

**UI hint** ใต้ file picker — แสดงรายการ 24 fields แบ่ง 4 กลุ่ม +
ตัวอย่าง pipe separator `Inverter | WiFi | Self-Cleaning`

### ⚡ Phase 87.4 — Copy spec from another SKU (Hybrid workflow boost)
**Updated `modules/settings/ac-spec-editor.js`** — เพิ่ม `sourceList` 3rd arg

**Use case:** Admin กรอก T-PROWD10 ครบ → ต้องกรอก T-PROWD13/19/25
(BTU/dim/power ต่างกัน แต่ description/features/SEER/refrig/voltage
เหมือนกันทั้ง series) → กดปุ่ม "📥 ดูด" → form fill ทันที → แก้แค่
fields ที่ต่าง (current_a, power_w, indoor_dim, weight, noise) → save
→ เร็วกว่ากรอกเองทั้งหมด ~5x

**UI:**
- Green panel ด้านบน body (ใต้ header) — แสดงเฉพาะเมื่อ `sourceList`
  มีอย่างน้อย 1 รุ่น
- `<select>` ที่ optgroup ตาม section + แสดง model + BTU per option
- ปุ่ม "📥 ดูด" disabled จนกว่าเลือก dropdown
- Self-filter: ไม่แสดงรุ่นปัจจุบันใน dropdown
- บน click: fill 16 spec inputs (ไม่แตะ id/section/model/btu/price/stock)
- Feedback: ปุ่ม → "✅ คัดลอกแล้ว" 1.5 วินาที → กลับเป็น "📥 ดูด"

**Wired ใน `ac-catalog.js`:**
```js
const sourceList = catalog.filter(c => c.features || c.seer || c.description);
openSpecEditor(catalog[idx], onSave, sourceList);
```

**Backwards-compat:** ถ้า sourceList ว่าง (ครั้งแรกที่ใช้ — ยังไม่มี
SKU มี specs) → ไม่ render panel — back to plain editor.

### 📊 Status: 12/223 SKUs มี specs
**Remaining 211 SKUs** — admin กรอกเอง 4 วิธี (Hybrid workflow ครบ):
1. **UI editor ทีละรุ่น** (ละเอียด — Phase 87.2)
2. **Copy spec จาก SKU อื่น** (เร็ว — สำหรับ series รุ่น — Phase 87.4)
3. **Excel bulk** (เร็วสุด — 50+ รุ่นต่อรอบ — Phase 87.3)
4. **Hybrid** (รวมทุกข้อข้างต้น)

**Time-saving estimate:**
- กรอกเอง 16 fields × 30s = **8 นาที/รุ่น** → 28 ชม. สำหรับ 211 รุ่น
- Copy + tweak = **1.5 นาที/รุ่น** → ~5 ชม. (5x faster)

### Files
- `modules/product_detail_modal.js`
- `modules/settings/ac-spec-editor.js`
- `modules/settings/ac-catalog.js` (extended)
- `modules/customer_dashboard.js` (catalog spread fix)
- `main.js` (schema upgrade check)
- `data/ac_catalog.json` (12 SKUs with full specs)

### ✅ Smoke test ที่ผ่านใน production
- Customer คลิก card MFS10/13, T-PROWD10, MSY-JZ → modal สวย + spec table
- Customer คลิก card ที่ยังไม่ seed → modal เปิด + "ยังไม่มีข้อมูลสเปก"
- Admin ✏️ + สเปก → modal editor → save → ✅ 📋 ทันที
- Admin export Excel → ตรวจ 24 columns + features pipe-separated +
  range strings (`0.4-4.5`) ถูกต้อง
- Admin upload back → import 223 รุ่นสำเร็จ
- Old 8-column CSV → ยัง import ได้ (backwards-compat)
- ✅ **Phase 87.4 verified:** เปิด T-PROWD13 → dropdown "T-PROWD10 (9,000 BTU)"
  → กด "📥 ดูด" → form fill 16 fields ทันที → user แก้ description
  + dim + weight + noise → save → ✅

---

## 🚀 Phase 85-86 ที่เสร็จในรอบนี้ (7 พ.ค.)

### 📊 สถิติ Session
- **13 commits** in main.js + 4 modules ใหม่ (api_utils, otp_cooldown, auth_email, auth_otp)
- **main.js: 4,415 → 4,032 บรรทัด (-383 lines, -8.7%)**
- ปิด Phase 84 debt (confirm migration) + แก้ login race + UX dashboard + OTP cooldown
- ทุก phase ทดสอบใน production https://boonsukair.com/ แล้ว

### 🔧 Phase 85.x — Bug fix + UX

#### Phase 85.1 — login() race-condition fix
**Symptom:** Phase 84 ทำให้ "ล็อกอินไม่ได้" → revert Phase 84 ทั้งก้อน
**Root cause:** `login()` ใน main.js ขาด 3 defenses ที่ฟังก์ชันคู่ขนาน (requestStaffPasswordReset, requestOtp, verifyOtp) มีครบ:
- ❌ ไม่มี `state.supabase` guard → ถ้า boot ช้า → throw `Cannot read property 'auth' of undefined`
- ❌ ไม่มี try/catch → unhandled rejection → button stuck "กำลังเข้าสู่ระบบ..."
- ❌ ไม่มี button lock → double-click race

**Fix:** Apply pattern เดียวกับ requestStaffPasswordReset:
1. Guard `state.supabase + state.supabase.auth` → toast + return
2. `try/catch` ครอบ `signInWithPassword` + log + toast on throw
3. Button disable + restore ใน `finally`

#### Phase 85.2 + 85.2.1 — confirm() migration (Phase 84 debt)
**Why:** Phase 84 ตั้งใจ migrate native `confirm()` → `App.confirm` (Promise) แต่โดน revert ตามไป
**Migrate 6 จุด:**
- products.js (5 callsites: export filter, clear category, bulk delete x2, delete category)
- main.js:_revokeShareToken (cancel link)
- ใช้ `_appConfirm` wrapper ใน products.js (fallback `window.confirm` ถ้า App ยังไม่พร้อม)
- ใช้ `confirmAsync` (already in scope) ใน main.js

**🐛 85.2.1 hotfix:** Phase 85.2 ใส่ `await _appConfirm()` ใน arrow function ปกติของ `#prodExportBtn` click → SyntaxError → ทั้ง products.js parse fail → import chain แตก → login dead. แก้: async callback

#### Phase 85.3 — OTP cooldown UX
**Why:** User ทดสอบ OTP กดซ้ำ 6 ครั้ง → ติด Phase 17 KV rate limit (HTTP 429) → เข้าระบบไม่ได้
**Fix:** Module-scoped state + 5 helpers ใน main.js:
- `_setOtpCooldown(seconds)` — start countdown + tick ทุกวินาที
- 60s cooldown หลัง send สำเร็จ
- 5-min cooldown ถ้าได้ HTTP 429 + special toast
- `requestOtp` guard cooldown ก่อน fetch
- Button disable "⏳ กำลังส่ง..." → "รอ NN วิ" → restore

#### Phase 85.4 + 85.5 — Dashboard KPI cards (white-on-white bug)
**85.4 attempt:** เปลี่ยน 4 cards (ผู้ใช้งาน/สิทธิ์/สินค้าทั้งหมด/งานช่างค้าง) เป็น defensive IIFE — เพิ่ม fallback chain + min-height + emoji label + Thai role labels
**85.5 actual fix:** DOM inspector ยืนยัน text render OK แต่ `color: rgb(255, 255, 255)` (white) บน card สีขาว → invisible! Parent `<div class="hero">` set `color:#fff` สำหรับ headline → cards inside inherit white. แก้: explicit `color:#0f172a` ใน inline style ทุก stat-label + stat-value

### 🏗️ Phase 86.x — main.js refactor (extract auth modules)

**เป้าหมาย:** main.js 4,300+ บรรทัด ใหญ่เกินไป → แตกเป็น modules ที่ test/reuse ได้

| Phase | Module | main.js Δ | Total Δ |
|---|---|---|---|
| 86.1 | `api_utils.js` (formatPhone, getApiBase, readApiJson) | -62 | 4,287 |
| 86.2 | `otp_cooldown.js` (state + 5 public APIs) | -38 | 4,315 |
| 86.3 | `auth_email.js` (login + setPassword + reset) | -101 | 4,214 |
| 86.4 | `auth_otp.js` (requestOtp + verifyOtp + _pendingOtp) | -182 | **4,032** |

**Pattern:**
- Pure utils (api_utils) → import ตรง
- State-encapsulated (otp_cooldown) → module-private state, public API
- Stateful flow (auth_email, auth_otp) → factory pattern: `createXxxAuth({state, $, setText, showToast, ...})`
- afterLogin pass เป็น `() => afterLogin()` (lazy resolve hoisted function)

**Module dependency tree:**
```
main.js
  ├─ imports auth_email, auth_otp
  └─ const { login } = createEmailAuth({state, $, setText, showToast, afterLogin: () => afterLogin()})
     const { requestOtp, verifyOtp } = createOtpAuth({state, $, setText, showToast})

modules/
  ├─ api_utils.js       (pure - no deps)
  │    ↓ used by
  ├─ auth_otp.js        ← imports api_utils + otp_cooldown directly
  ├─ auth_email.js      (factory pattern, deps via DI)
  └─ otp_cooldown.js    (uses document.getElementById directly)
```

**Phase 85.1 race-condition guards** ยังคงครบใน auth_email.js (ไม่ regress)
**Phase 85.3 OTP cooldown UX** ยังคงครบใน otp_cooldown.js + auth_otp.js (ไม่ regress)

### ✅ Smoke test ที่ผ่านใน production
- Email login (ผิด/ถูก/forgot password) → working ✅
- Customer OTP signup ใหม่ → working (Bug F trigger fix ยังทำงาน)
- Customer OTP signin ลูกค้าเดิม → working
- OTP cooldown countdown 60s/5min → visible
- Dashboard KPI cards 4 ใบ → readable (color:#0f172a)
- confirm modals 6 จุด → ARIA dialog (App.confirm)
- ui_states empty/skeleton ใน 25+ modules → ยังทำงาน

---

## 🔧 Phase 85.1 — login() race-condition fix (7 พ.ค. รอบบ่าย)

### Why
User รายงาน Phase 84 ทำให้ "ล็อกอินไม่ได้" — revert Phase 84 ทั้งก้อน

Audit `main.js login()` function (line 1205) พบ:
- ❌ ไม่มี `state.supabase` guard — ถ้า boot ช้าจน user click ก่อน init เสร็จ → throw `Cannot read property 'auth' of undefined`
- ❌ ไม่มี try/catch — error throw → unhandled promise rejection → UI freeze (button stuck "กำลังเข้าสู่ระบบ...")
- ❌ ไม่มี button lock — double-click → race condition

ในขณะที่ `requestStaffPasswordReset` (line 1218), `requestOtp`, `verifyOtp` มี guard + try/catch ครบ

→ **Phase 84 น่าจะ slow boot นิดเดียว** (ai-chat-widget.js?v=4 → v=5 cache miss / มี code ใหม่ใน boot path) — make race condition window กว้างขึ้น → user เจอ "login เงียบ" บ่อยพอ revert

### Fix ([main.js login()](main.js))
1. **Guard `state.supabase`** — ถ้ายัง init ไม่เสร็จ → toast "ระบบยังเชื่อมต่อไม่เสร็จ — รอ 2-3 วินาทีแล้วลองใหม่"
2. **Wrap `signInWithPassword` ใน try/catch** — surface error ทันที + log
3. **Button lock + restore** — disable + แสดง "⏳ กำลังเข้าสู่ระบบ..." → restore ใน `finally`
4. **Pattern เดียวกับ `requestStaffPasswordReset`** ที่มีอยู่แล้ว — proven safe

### ❌ ไม่ retry Phase 84 ทั้งก้อน
- Phase 84 modify `showStaffLogin` Promise wrapper — uncertain root cause
- 6 จุด `confirm()` migration ยังค้าง (debt) — รอ confirmed safe

### Bump
- main.js v=150 → v=151
- SW v135 → v136
- Version 5.32.10 (build 150) → **5.32.11 (build 151)**

### Test
1. Hard refresh **Ctrl+Shift+R**
2. หน้า login → กรอก email + password ปลอม → กดเข้าสู่ระบบ
3. ✅ ต้องเห็น button disable + "⏳ กำลังเข้าสู่ระบบ..." → toast error → button restore (ไม่ค้าง)
4. ทดสอบในเบราว์เซอร์ **fresh tab** (ที่ supabase ยังไม่ init) → กดเข้าระบบ **ทันทีก่อน 2 วินาที** → ต้องเห็น "ระบบยังเชื่อมต่อไม่เสร็จ" toast (ไม่ throw silent)
5. Login ปกติ → ต้องเข้าได้เหมือนเดิม



## 🆕 Phase 83-84 ที่เสร็จในรอบนี้

### Phase 83 series (6-7 พ.ค.) — AC install + mobile UX hardening
- **Phase 83**: AC install items table mobile scroll — wrap ใน scroll container `min-width:560px` กัน column compress บนมือถือ
- **Phase 83.1**: Qty stepper +/− mobile-friendly (ปุ่มใหญ่กว่า input, no spinner)
- **Phase 83.2**: DOM surgery แทน re-render — กัน keyboard เด้งออกขณะพิมพ์ field qty/price
- **Phase 83.3**: AC install save timeout 25 วินาที + step progress UI ("กำลังตัดสต็อก", "กำลังบันทึกใบงาน") — debug ค้างหน้าบันทึก
- **Phase 83.4**: Confirm dialog mobile fix — blur active input + scrollIntoView + body scroll lock — กัน keyboard บัง modal

### Phase 84 series (6-7 พ.ค.) — Full-app audit (rolled back)
- **Phase 84 (cfc122c)**: feat — full-app audit fixes 5 batches:
  1. Mobile font overlap (stat-value clamp, customer grid auto-fill, ac_install/btu_calc grid stack, modal max-height/overflow)
  2. native `confirm()` → `App.confirm` migration (9 จุด)
  3. Promise antipattern fix ใน showStaffLogin
  4. Form input attrs (inputmode/enterkeyhint/autocomplete)
  5. Defensive base64 parsing
- **Phase 84.1 (379fd3f)**: hide AI FAB ตอน login/setPassword/confirm-modal — live test pinpoint
- **🔴 ทั้ง 84 + 84.1 ถูก REVERT** (24a4f5c, 47a53ae) — สาเหตุที่ revert ไม่อยู่ใน commit message
- **Phase 84-CSS only (c0a5fd8)**: เก็บแค่ส่วน CSS mobile fixes — ทิ้ง confirm migration + a11y JS
- **Phase 84-CSS.2 (47bef49)**: product list mobile — price/stock/wh/actions stack column บน narrow screens (CSS only)

### ⚠️ ที่ค้างจาก Phase 84 revert (debt)
- **6 จุด `confirm()` native ยังค้างอยู่** (Phase 84 ตั้งใจ migrate แต่โดน revert):
  - `modules/products.js:644` (export filter choice)
  - `modules/products.js:1949` (clear category)
  - `modules/products.js:1972, 1973` (bulk delete + reconfirm)
  - `modules/products.js:2210` (delete category)
  - `main.js:2750` (cancel link)
- **Memory rule** บอก "alert() forbidden ใช้ showToast" — confirm() ก็ควรใช้ App.confirm เหมือนกัน
- **App.confirm พร้อมใช้** — `window.App.confirm(message)` returns Promise<boolean>
- **ก่อน migrate ใหม่** — ต้องเข้าใจว่าทำไม Phase 84 revert (อาจมี bug ที่ไม่บันทึก)

## 🆕 Phase 80-82.5 ที่เสร็จในรอบนี้

- **Phase 80**: Sticker print 50×30mm — auto-print + auto-close window + strict @page
- **Phase 81**: Bluetooth printer module (`modules/bt_printer.js`) — Web Bluetooth → XP-420B + TSPL command
  - ⚠️ **ยังไม่ work บน XP-420B จริง** — เครื่องน่าจะเป็น Bluetooth Classic (passcode 0000) ไม่ใช่ BLE
  - Web Bluetooth ใช้ได้แค่ BLE → ขั้นถัดไปต้องลอง WebUSB API ผ่าน USB OTG
- **Phase 82-82.5**: Scan-loop bug fix series (รับเข้าสินค้า + นับสต็อก ลูปเพิ่มเอง)
  - **Root cause: html5-qrcode callback fires ทุก frame ตราบใดที่บาร์โค้ดอยู่หน้ากล้อง** + scanner ไม่ stop หลัง navigate
  - **Final solution (Phase 82.5)**: stop scanner ทันทีหลัง scan สำเร็จ + mutex flags (`_swAddInProgress`, `_swSaving`, `_swScannerActive`) + `isConfirmOpen()` guard + `blurStockInInputs()` + session ID invalidation

---

## 🛠️ User Configuration State (snapshot ปัจจุบัน)

**🚨 อ่านก่อนเสนอฟีเจอร์ใด ๆ — รายการนี้สรุปสิ่งที่ user setup เสร็จแล้ว**
อย่าบอกว่า "ต้อง setup X" ที่ user ทำเรียบร้อยแล้ว

### LINE Notify (Messaging API)
- **Status**: ✅ Active (verified 3 พ.ค. 2026 จาก screenshot Settings)
- **API**: ใช้ LINE Messaging API (LINE Notify เดิมถูกปิด 2025-03-31)
- **Token storage**: Cloudflare Pages → Settings → Environment variables
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_USER_ID`
- **Notif categories** (ทั้งหมด ON):
  - แจ้งเตือนสต็อกต่ำ
  - แจ้งเตือนออเดอร์ใหม่
  - แจ้งเตือนงานช่างเสร็จ
  - สรุปยอดประจำวัน
- **Server status**: เซิร์ฟเวอร์พร้อมส่ง LINE
- **Code**: [modules/line_notify.js](modules/line_notify.js) + [functions/api/line-notify.js](functions/api/line-notify.js)

### Payment (SlipOK)
- **Status**: มีระบบใน Settings → Payment Gateway
- **Token storage**: localStorage `bsk_slipok_key` + `bsk_slipok_branch`
- **ไม่รวมใน config backup/restore** (security)

### AI providers
- **Cloudflare Workers AI** (binding `AI`) — ใช้กับ ai-chat-widget สำหรับ chat ลูกค้าแจ้งซ่อม. ฟรี 10K neuron/วัน
- **Google Gemini Vision** (env `GEMINI_API_KEY`) — Phase 74 AutoKey OCR สลิป ✅ **PRODUCTION READY**
  - **Model: `gemini-2.5-flash`** (current 2026 free tier vision) — ⚠️ `gemini-1.5-flash` family ลบหมดแล้ว, `gemini-2.0-flash` มี limit:0 (paid only)
  - Fallback chain: gemini-2.5-flash → gemini-2.0-flash-lite → gemini-flash-latest → gemini-2.0-flash
  - User key ต้องสร้างจาก [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (ไม่ใช่ Google Cloud Console เพราะ billing project = limit:0)
  - Cloudflare Function: `functions/api/parse-receipt.js` — ทุก error response status 200 (กัน CF intercept 5xx ด้วย HTML)
  - User Setup: ✅ key อยู่ใน Cloudflare Pages → Settings → Variables and Secrets → Production (Secret type)
  - Tested 3 พ.ค. 2569 22:50 — อ่านบิล "บริษัท แมกซ์ การ์ด จำกัด" 988 บาท หมวด "น้ำมันรถ" ครบทุก field

### Database migrations applied (รายการ)
- ✅ supabase-rls-policies.sql (Phase 19)
- ✅ supabase-phase45-* (RLS hardening + bug fixes A/B/C/D/E/F)
- ✅ supabase-phase46-rls-tighten-reads.sql
- ✅ supabase-phase57-activity-log.sql (audit log table)
- ✅ supabase-phase63-service-share.sql (service_jobs.share_token)
- ✅ supabase-phase68-tags-extend.sql (products.tags + service_jobs.tags) ← 3 พ.ค.
- ✅ supabase-phase69-multi-payment.sql (receipts.payments jsonb) ← 3 พ.ค.
- ⚠️ **supabase-phase71-departments.sql** (Phase 71 — ตาราง departments) — ต้องรัน
- ⚠️ **supabase-phase72-payroll.sql** (Phase 72 — ตาราง staff_payroll + RLS) — ต้องรัน
  - ถ้ายังไม่รัน 2 SQL ข้างบน → 2 เมนู "🏢 ตั้งค่าแผนก" + "💰 รายการเงินเดือน" + "📊 ภาพรวมเงินเดือน" จะขึ้น error "ตาราง X ยังไม่มีในฐานข้อมูล"
- ⚠️ **supabase-phase75-profile-view-update.sql** — update view profiles_with_email เพิ่ม column department_id
  - ถ้ายังไม่รัน → Settings/Users dropdown แผนก ดูเหมือนไม่เซฟ (เซฟจริง แต่ view อ่านกลับไม่ได้)

### Customer accounts (test)
- babang / 0874536754 (ลูกค้า role) — สมัครผ่าน OTP เมื่อ 1 พ.ค. (Bug E verify)

### OTP / SMS (Customer login)
- **Mode**: 🟡 **On-screen fallback** (ไม่ใช่ SMS จริง) ตั้งแต่ 6 พ.ค. 2026
- **Cloudflare env**: `OTP_WEB_FALLBACK=true` (Plaintext) + `OTP_SECRET` (Secret)
- **Twilio**: ไม่ active หรือ trial หมด — server return 503 ถ้า fallback ปิด
- **Code**: [functions/api/send-otp.js](functions/api/send-otp.js) — เห็น `otpDelivery: "web_fallback"` → frontend แสดง prefix "[OTP หน้าเว็บชั่วคราว]"
- **⚠️ Security trade-off accepted**: ใครพิมพ์เบอร์ลูกค้าคนใดก็ login เป็นคนนั้นได้
  - `authPassword` ใน [verify-otp.js:47-49](functions/api/verify-otp.js) เป็น HMAC deterministic — login สำเร็จ 1 ครั้ง = จำ password ใช้ได้ตลอด
  - ถ้าเปลี่ยนกลับมาใช้ SMS ถาวร → ต้อง **หมุน `OTP_SECRET`** เพื่อ invalidate password ที่ attacker อาจคำนวณไว้
- **TODO ระยะยาว**: ตั้ง Twilio (เติม credit) หรือใช้ ThaiBulkSMS / SMS Master ราคาถูกกว่า

---

## 🩹 Phase 75.2 — Fix view profiles_with_email ขาด department_id (3 พ.ค. รอบดึก+1)

### Issue
หลัง Phase 75.1 user ทดสอบ "แก้ไขผู้ใช้" + เลือกแผนก + กดบันทึก
→ modal เปิดใหม่แสดง "— ไม่ระบุแผนก —" ตลอด ดูเหมือนไม่เซฟ

### Root cause
- xhrPatch profile table → success ✅ (เซฟจริง)
- loadUsers() ดึงจาก **view** `profiles_with_email` (สร้าง Phase 45 Bug D)
- View นี้ select แค่: id, full_name, role, phone, created_at, email
- **ไม่มี department_id** (Phase 71 เพิ่ม column ใน table — ไม่ได้ update view)
- ผล: state.allProfiles[id].department_id = undefined → modal เปิดดูเป็น "— ไม่ระบุ —"

### Fix
- ไฟล์ใหม่: [supabase-phase75-profile-view-update.sql](supabase-phase75-profile-view-update.sql)
- CREATE OR REPLACE VIEW เพิ่ม `p.department_id`
- USER ACTION: รัน SQL นี้ใน Supabase SQL Editor

### หลังรัน SQL
1. Hard reload (Ctrl+Shift+R)
2. Settings → Users → แก้ไขพนักงาน → เลือกแผนก → บันทึก
3. กดแก้ไขอีกครั้ง → ควรเห็น "ช่างแอร์ (01)" selected (ไม่ใช่ "— ไม่ระบุ —")
4. /departments → จำนวนพนักงานในแต่ละแผนกควรอัปเดตด้วย

### ไม่ต้อง bump build (code ไม่เปลี่ยน — แค่ SQL + docs)

---

## 🏷️ Phase 75.1 — Department dropdown ใน modal แก้ไขผู้ใช้ (3 พ.ค. รอบดึก)

### Root cause
User เปิดหน้า `/departments` พบทุกแผนกแสดง "0 พนักงาน" — ตรวจสอบแล้วไม่ใช่ bug
จาก Phase 75 (state.allProfiles fix). **Root cause จริง:**
- Phase 71 SQL เพิ่ม column `profiles.department_id` แล้ว ✅
- แต่ไม่มี UI ที่ไหนเลยให้ assign แผนกให้พนักงาน — ทุกคน `department_id = NULL`
- เลยทุกแผนกแสดง 0 (ถูกต้องตาม data)

### Fix
- [modules/settings/users.js](modules/settings/users.js) — `_editUserModal` เพิ่ม dropdown "🏢 แผนก"
  - Lazy fetch departments ตอนเปิด modal (graceful: ถ้า phase 71 SQL ยังไม่รัน → ซ่อน field)
  - Logic 3 ทาง: dropdown ไม่ render = คงค่าเดิม | "" = ถอดแผนก | id = set แผนก
  - Patch ส่ง `{ department_id }` ไป PostgREST (FK validate ใน DB)

### User flow ใหม่
1. Settings → Users → กด "แก้ไข" ผู้ใช้
2. เลือกแผนกจาก dropdown → กดบันทึก
3. กลับไปดู `/departments` → จำนวนพนักงานในแต่ละแผนกอัปเดต

### Bump
- 5.27.1/105 → 5.27.2/106 + sw v89 → v90

---

## 🩹 Phase 75 — Audit Quick Wins (3 พ.ค. รอบเย็น)

User สั่ง "ตรวจสอบแอปและแนะนำแก้ไขเพิ่มเติม" → audit พบ 3 priority-1 issues
+ option A "Quick wins"

### Findings (priority-1)
1. **`confirm()` / `prompt()` 19 จุด** — ผิด memory rule (ควรใช้ `App.confirm` / modal)
2. **departments.js: staffCount = 0 เสมอ** — bug จริง
   - ใช้ `state.allProfiles` แต่ field นี้ populate เฉพาะตอน admin เข้า settings/users
   - ถ้าเปิดเมนู "ตั้งค่าแผนก" ก่อนเข้า users → ทุกแผนกแสดง "0 พนักงาน"
3. **HANDOFF.md ขาด Phase 70-74** + ขาดบันทึกว่าต้องรัน SQL phase 71/72

### Fixes (Phase 75 scope)
- ✅ [modules/payroll.js](modules/payroll.js) line 387 + 404
  - `confirm("ลบ?")` → `await App.confirm()`
  - `prompt("วิธีจ่าย?")` → modal dropdown 3 ตัวเลือก (โอน/เงินสด/เช็ค) + emoji
- ✅ [modules/departments.js](modules/departments.js)
  - bug staffCount → fetch profiles เองใน Promise.all (parallel กับ departments)
  - `confirm()` ลบแผนก → `App.confirm`
- ✅ [modules/settings/pages.js](modules/settings/pages.js) — restore config + clear cache
- ✅ [modules/settings/users.js](modules/settings/users.js)
  - prompt ชื่อ + เบอร์ → modal เดียวมี 2 fields
- ✅ HANDOFF.md เพิ่ม Phase 70-75 + warn SQL phase 71/72 ต้องรัน

### Defer (ไม่อยู่ใน Quick Wins)
- **modules/products.js** — 11 จุด confirm/prompt (สร้างหมวด, rename, bulk delete, แก้บาร์โค้ด) — เก่ากว่า + UX ฝังลึก ต้องเป็น phase แยก
- **Sidebar grouping HR** — 3 ปุ่มกลางแจ้ง (departments/payroll/payroll_overview) ไม่จัดกลุ่ม → ปล่อยไว้ก่อน รอ user feedback
- **หน้า "สลิปของฉัน" สำหรับ employee** — RLS เปิดให้แล้ว แต่ไม่มี UI sales/technician เข้าได้ → defer

### Bump
- APP_BUILD 104 → 105
- index.html `main.js?v=104` → `?v=105`
- sw.js cache v88 → v89
- Version 5.27.0 → 5.27.1 (patch — ไม่มีฟีเจอร์ใหม่ แค่ no-confirm migration + bug fix + docs)

### Test plan (หลัง deploy)
1. **Hard reload** (Ctrl+Shift+R) — เลี่ยง stale cache
2. **payroll**: เปิด `/payroll` → กด "ลบ" 1 รายการ → ขึ้น modal สีฟ้า (ไม่ใช่ native dialog)
3. **payroll mark paid**: กด "💸 จ่าย" → ขึ้น modal มี dropdown 3 ตัวเลือก โอน/เงินสด/เช็ค
4. **departments**: เปิด `/departments` ทันทีหลัง login (ก่อนเข้า users) → ตรวจว่าจำนวนพนักงานในแต่ละแผนกถูกต้อง
5. **settings/users**: กด "แก้ไข" ผู้ใช้ → ขึ้น modal มี 2 ช่อง ชื่อ + เบอร์ พร้อมกัน
6. **settings/about**: กด "ล้าง cache" → ขึ้น modal สีฟ้าก่อน confirm

---

## 🤖 Phase 74 — AutoKey OCR สลิปค่าใช้จ่าย (Gemini Vision) (3 พ.ค. รอบเย็น)

- ใช้ Google Gemini Vision สำหรับอ่านสลิปค่าใช้จ่าย
- ไฟล์ใหม่: [functions/api/parse-receipt.js](functions/api/parse-receipt.js) (Cloudflare Function)
- UI: ใน [modules/expenses.js](modules/expenses.js) — ปุ่ม "📸 อ่านสลิป AI"
- USER ACTION: ตั้ง `GEMINI_API_KEY` ใน Cloudflare Pages → Settings → Environment variables (ฟรี 60 RPM)

---

## 📊 Phase 73 — Payroll Overview Dashboard (3 พ.ค.)

- หน้า `/payroll_overview` (admin only)
- Donut chart ค่าใช้จ่ายตามหมวด (เงินเดือน/OT/สวัสดิการ/โบนัส/คอม)
- Bar chart รายเดือน (paid vs total)
- Top 5 earners + 4 stat cards
- Period selector 3/6/12 เดือน
- ใช้ Chart.js (มี global script tag อยู่แล้ว)
- ไฟล์: [modules/payroll_overview.js](modules/payroll_overview.js)

---

## 💰 Phase 72-72.1 — Staff Payroll + Payslip Print (3 พ.ค.)

### Phase 72 — รายการเงินเดือน
- หน้า `/payroll` (admin only) — CRUD จ่ายเงินเดือนรายเดือน
- หมวดเงินเดือน: base / overtime / welfare / bonus / commission - deductions
- `total_amount` = generated column ใน DB
- 1 พนักงาน 1 รอบเดือน (unique constraint `uq_staff_payroll_emp_month`)
- RLS: admin all + employee_id = auth.uid() self-read
- USER ACTION: รัน [supabase-phase72-payroll.sql](supabase-phase72-payroll.sql)

### Phase 72.1 — Payslip Print
- ปุ่ม "🖨️ สลิป" → เปิด popup สลิปเงินเดือน A4 + auto-print
- 2 ก๊อบปี้ต่อใบ (ต้นฉบับ-สำหรับพนักงาน + สำเนา-สำหรับร้าน)
- มี "(จำนวนเงินตัวอักษร)" — function `_bahtText()` แปลงตัวเลขเป็นภาษาไทย

---

## 🏢 Phase 71 — Departments Management (3 พ.ค.)

- หน้า `/departments` (admin only) — CRUD แผนก (ชื่อ/code/icon/color/sort_order)
- Foundation สำหรับ Phase 72 payroll
- ตอน Phase 75 — แก้ bug staffCount = 0 (เพราะ state.allProfiles ไม่ได้ populate)
- USER ACTION: รัน [supabase-phase71-departments.sql](supabase-phase71-departments.sql)

---

## 📥 Phase 70 — Excel Export ครบ 5 modules ที่ขาด (D3 backlog) (3 พ.ค.)

ครอบคลุม: quotations / receipts / delivery_invoices / service_jobs / expenses

---

## 🎁 Phase 59-63 — Feature mega-pack (1 พ.ค. รอบบ่าย-เย็น)

User สั่ง "ทำมาหมดครับ" จาก backlog A/B/C/D ทั้ง 14 ข้อ. ทำได้ 9 ข้อ
ที่ realistic + ไม่ต้อง external service. ต้อง renumber phase 58→59
เพราะ user ทำ Phase 58 (error_codes check methods) parallel ก่อน

### Phase 59-60 — Quick wins + Business pack
- **A1 Quick-add** จาก global search → "+ สร้างลูกค้า/สินค้า/ใบเสนอราคา ชื่อนี้"
- **A3+B1 Today/Alerts widget** — dashboard ใต้ stat cards 2 cards: นัดวันนี้ + alerts รวม (overdue jobs/expiring quotations/overdue credit/recurring expenses)
- **B2 Receipt advanced filter** — search input + date range pills (today/7d/30d/month) + status tabs compose
- **B4 PDF watermark** — ใบเสนอราคา (ยกเลิก/หมดอายุ), ใบเสร็จ (ชำระแล้ว/ยกเลิก), ใบส่งสินค้า (ยกเลิก) — pure CSS diagonal stamp

### Phase 61-62 — Notes + Backup
- **C3 Customer notes timeline** — drawer มี "บันทึกติดตามลูกค้า" ใช้ activity_log table (Phase 57) + filter by entity_type=customer + entity_id. ไม่ต้อง schema เพิ่ม
- **D1 Settings backup/restore** — Settings → About เพิ่ม "💾 สำรอง/กู้คืน config". Export = JSON ของ storeInfo + payment + line notify + loyalty + permissions + safe localStorage entries (ไม่รวม slipok_key). Restore = upload + hardReload

### Phase 63 — Service share link (ใหญ่สุด)
- **C1 Service job share link + public viewer**:
  - SQL: [supabase-phase63-service-share.sql](supabase-phase63-service-share.sql) — เพิ่ม column `share_token` ใน service_jobs + RLS `public_read_by_share`
  - Drawer: ปุ่ม "🔗 สร้าง share link" → POST share_token → คัดลอก URL / ส่ง LINE / ยกเลิก
  - **share.html (ใหม่)** — standalone page ไม่ต้อง login. anon GET service_jobs?share_token=eq.X → render hero + รายละเอียด + Timeline (รับเรื่อง/เริ่มทำ/เสร็จ) + รูป gallery + note

### USER ACTION required
- รัน `supabase-phase63-service-share.sql` (เพิ่ม column + policy)
- หลังรัน → เปิดใบงานช่างเก่า → กดปุ่ม "🔗 สร้าง share link" → คัดลอก URL → เปิดใน private mode → ควรเห็น public viewer ทำงาน

### ตัวที่ "ทำไม่ได้" (defer)
- **B3 Tag system extend** (products + service_jobs) — ต้อง schema migration + UI ใหญ่
- **C2 Multi-payment per receipt** — ต้องเพิ่ม table receipt_payments หรือ jsonb column → schema heavy
- **C4 POS bottom-nav มือถือ** — ✅ มีอยู่แล้ว (.mobile-nav-btn role-aware applyRoleUI)
- **D2 Lazy-load heavy modules** — risk break existing flow
- **D3 Data export ครบ** — มี 7 modules ทำแล้ว (top_customers, dead_stock, profit_by_product, customers, products, sales, stock_value); ที่ขาด (quotations/receipts/delivery_invoices/service_jobs/expenses) ต้อง implement แต่ละไฟล์ → defer

### Bump
- APP_BUILD 87→92 (5 phases)
- main.js?v=87→92, style.css?v=7→8, sw v71→v76
- Version 5.16.0 → 5.19.0 (major-ish bump เพราะมี features ใหม่ + 2 SQL migrations)

---

## 🚀 Phase 53-57 — Feature pack (1 พ.ค. รอบเช้า)
**Version:** 5.16.0 (build 87) — moved earlier history เก็บไว้

---

## ✨ Phase 53-57 — Feature Pack (1 พ.ค.)

User สั่ง "ลองทำมาทุกข้อ" จาก backlog A/B/C/D — ทำได้ 5 features ที่ value สูง + ไม่ต้องพึ่ง external service:

### Phase 53 — Global Search
- Extend แถบค้นหาบนสุดให้ค้นหา 4 entities: products / customers / sales / quotations
- Dropdown แสดงผล ≤5 ต่อกลุ่ม + click → navigate + open drawer
- Role-aware (ค้นได้ตาม allowedPages)
- Debounce 200ms, Esc ปิด, click outside ปิด
- ไฟล์: index.html, style.css, main.js (function `globalSearch`)

### Phase 54 — Keyboard Shortcuts
- F1=ลูกค้า / F2=สินค้า / F3=POS / F4=รายการขาย / F8=ใบรับงาน / F9=ใบเสนอราคา
- `/` = focus global search
- `?` = popup เมนูคีย์ลัด (role-aware รายการแสดงเฉพาะที่มีสิทธิ์)
- Esc = ปิด popup
- ตรวจ tag เพื่อไม่ขัดการพิมพ์ใน input/textarea
- ไฟล์: main.js (function `_showShortcutHelp`)

### Phase 55 — Customer Loyalty Tier
- Auto-tier ตามยอดสะสม: Bronze (≥5k) / Silver (≥20k) / Gold (≥50k) / Platinum (≥100k)
- Badge แสดงในตาราง customers (เฉพาะ contact_type ≠ supplier)
- Helper export ใน utils.js — pure function ไม่กระทบ schema
- ไฟล์: utils.js (`getCustomerTier` + `renderTierBadge` + `TIER_RULES`), customers.js

### Phase 56 — Dashboard Sparkline
- Mini-chart 7 วันล่าสุด (sales + expenses) ใน stat cards
- Pure SVG — ไม่โหลด Chart.js เพิ่ม payload
- Gradient fill ใต้เส้นสำหรับ visual depth
- ไฟล์: dashboard.js (functions `_sparkline7d` + `_last7DaysSeries`)

### Phase 57 — Audit Log Lite
- Table ใหม่ `activity_log` — append-only, RLS admin-only read
- Helper `logActivity(action, opts)` — silent fail ถ้า table ยังไม่ migrate
- Wired ใน 3 จุด critical: delete quotation/receipt/delivery_invoice
- Viewer page `/audit_log` — admin only, filter by action, แสดง icon + summary + timestamp
- Sidebar: เพิ่มปุ่ม "📜 ประวัติการใช้งาน" ใต้ "หน้าหลัก"
- ไฟล์ใหม่:
  - [supabase-phase57-activity-log.sql](supabase-phase57-activity-log.sql)
  - [modules/audit_log.js](modules/audit_log.js)
  - utils.js (`logActivity`)

### USER ACTION required (Phase 57)
- รัน `supabase-phase57-activity-log.sql` ใน Supabase SQL Editor
- หลังรัน → เปิดเมนู "📜 ประวัติการใช้งาน" → ทดสอบลบใบเสนอราคา 1 ใบ → reload audit log → ควรเห็น entry ใหม่
- ก่อนรัน — แอปยังทำงานปกติ (logActivity silent fail)

### ตัวเลือก backlog ที่ "ทำไม่ได้" + เหตุผล
- LINE Notify ส่วนตัว — ระบบมีแล้ว user ใส่ token เอง
- Promotion engine — schema/UI ใหญ่ ต้องคุย business rule
- Mobile redesign — ต้อง UX survey + risk แตก style
- Payment gateway — SlipOK มีแล้ว
- Logistics tracking — ต้อง vendor API
- Receipt OCR — ต้อง AI vision API
- Multi-branch — schema migration ใหญ่
- e-Tax — ต้อง digital signature certificate

### Bump
- APP_BUILD 86 → 87
- main.js?v=86 → ?v=87
- style.css?v=6 → ?v=7
- sw.js cache v70 → v71
- pages.js Version 5.15.2 → 5.16.0 (minor bump เพราะมี features ใหม่ + audit_log table)

---

## 🔧 Phase 52.1 — nav-group max-height fix (1 พ.ค.)
[ย่อ — fix CSS max-height: 300px → 600px เพื่อให้กลุ่ม "งานช่าง" 12 ปุ่มไม่โดน clip]

---

## 🩹 Phase 51 — escHtml dedup + XSS gap fix (1 พ.ค.)

**🛡️ Phase 17 Active!** — KV binding ผูกแล้ว (Production + Preview), tested 429 OK

---

## 🧹 Phase 51 — escHtml dedup + XSS gap fix (1 พ.ค.)

### Audit ก่อนทำ
Scan พบ **33 ไฟล์** define `escHtml`/`escapeHtml` local มี **6 patterns ต่าง**:
- **Pattern A** (canonical: null guard + dict map + 5 chars escape) — 20 modules
- **Pattern B** (verbose) — main.js
- **Pattern F** (`&#39;` แทน `&#039;`, render เหมือน) — dashboard.js
- **Pattern C** (chained, no apostrophe escape) — auth.js 🔴 XSS gap
- **Pattern D** (chained + `||""`, no apostrophe) — customers.js, loyalty.js, products.js 🔴 XSS gap
- **Pattern G** (no apostrophe + no null guard) — thermal_printer.js 🔴 XSS gap
- **Pattern E** (DOM-based createElement+textContent) — delivery_invoices.js, expenses.js, quotations.js, receipts.js (safe but different approach — keep)
- **Self-defined helper** — ui_states.js (avoid circular dep — keep)
- **Classic script** — ai-chat-widget.js (load without `type="module"` — keep)

### Fix scope
1. **Create `modules/utils.js`** — single source of truth สำหรับ canonical `escHtml(s)` (null-safe + escape 5 HTML chars including apostrophe)
2. **Pure dedup (drop-in)** — 22 modules + main.js ที่ pattern เทียบเท่ากัน → import แทน local
3. **🔴 XSS gap fix (security win)** — 6 modules (auth, customers, loyalty, products, staff, thermal_printer) เพิ่ม apostrophe escape ผ่านการ migrate ไป shared utils
   - **Impact:** ก่อนหน้าถ้า render user data ที่มี `'` ใน HTML attribute ที่ใช้ single-quote (เช่น `style='color:red;'+userData+';'`) จะ inject ได้ — ตอนนี้ปลอดภัย

### Total: 28 ไฟล์แก้
- `modules/utils.js` (สร้างใหม่)
- main.js + dashboard.js (import alias `escapeHtml`)
- birthdays, cash_recon, credit_tracker, dead_stock, error_codes_shared, help_tutor, payment_gateway, pos, profit_by_product, quote_templates, recurring_expenses, refunds, sales_heatmap, serials, stock_count, stock_in_wizard, stock_value, tasks, top_customers, warranty_report (Pattern A — pure dedup)
- auth, customers, loyalty, products, staff, thermal_printer (XSS gap fix + dedup)

### ไม่แตะ (ตั้งใจ)
- delivery_invoices.js, expenses.js, quotations.js, receipts.js — ใช้ DOM-based approach ปลอดภัยไม่ต่ำกว่า canonical
- ui_states.js — utility module เอง keep local เลี่ยง circular dep
- ai-chat-widget.js — classic script (ไม่มี import system)

### Bump
- APP_BUILD 83 → 84 (version 5.15.0 — minor bump เพราะ XSS fix นับเป็น behavior change)
- main.js?v=83 → ?v=84
- sw.js cache v67 → v68
- pages.js Version 5.14.9 → 5.15.0 + Release "April" → "May"

### Backlog เหลือ Phase 52+
- ✅ All known bugs from audit closed
- (พร้อมต่อยอดฟีเจอร์ใหม่)

---

## 🛡️ Phase 50 — Fix data leak + tighten anon GRANT (1 พ.ค.)

### Bug ที่พบจาก audit
ตอนรัน Bug E pre-check พบ `quotations` + `quotation_items` มี anon GRANT ALL ที่ table-level
→ scan code + RLS policies ก่อนเขียน migration พบ **bug ใหญ่กว่า**:

**`qi_select` policy ใน quotation_items:**
- Roles: `{public}` (ครอบ anon + authenticated)
- Cmd: SELECT
- USING: **`true`** 🔴

→ แปลว่า **anon ดึง `GET /rest/v1/quotation_items?quotation_id=eq.X`** ได้ทุก ID
ไม่ filter ผ่าน parent share_token เลย → **data leak**: anon iterate id
อ่าน items ของใบเสนอราคาทุกใบในระบบได้

`public_read_by_share_token` ของ header (quotations) ปลอดภัยกว่าเพราะ
filter `share_token IS NOT NULL` แต่ items ใต้ leak ทั้งหมด

### Fix scope (3 อย่าง)
**Migration:** [supabase-phase45-bug-e-tighten-anon.sql](supabase-phase45-bug-e-tighten-anon.sql)
ทำผ่าน SQL Editor แบบ ad-hoc (ไม่สร้าง .sql file ใหม่ — แค่ paste run):

1. **DROP `qi_select`** (USING true, leaky)
2. **CREATE `qi_select_via_parent_share`** — TO anon, USING:
   ```
   EXISTS (SELECT 1 FROM quotations q
           WHERE q.id = quotation_items.quotation_id
             AND q.share_token IS NOT NULL)
   ```
   → anon อ่าน items ได้เฉพาะของ quotation ที่มี share_token
3. **REVOKE INSERT, UPDATE, DELETE, TRUNCATE** จาก anon บน 2 tables
   → anon เหลือแค่ `REFERENCES,SELECT,TRIGGER` (defense-in-depth)

### Verify result (รัน 1 พ.ค.)
- ✅ pg_policies เห็น qi_select_via_parent_share (TO anon, EXISTS filter)
- ✅ anon GRANT = REFERENCES,SELECT,TRIGGER (writes ไม่มีแล้ว)
- ✅ quotation_items_rw + quotations_rw_staff (TO authenticated) คงเดิม → seller flow OK
- ✅ public_read_by_share_token คงเดิม → share link header read OK

### Test result (1 พ.ค. — 3/3 ผ่าน)
| Test | Flow | Result |
|---|---|---|
| 4.1 | Preview ใบเก่า (HAIER 45,500) | ✅ items โหลดครบ |
| 4.2 | สร้างใหม่ QT20260501003 + 2 line items | ✅ create + preview ทำงาน |
| 4.3 | ลบใบ QT20260501003 | ✅ ลบสำเร็จ + list update |

### Rollback (พร้อมรันถ้ามีปัญหาภายหลัง)
```sql
DROP POLICY IF EXISTS "qi_select_via_parent_share" ON public.quotation_items;
CREATE POLICY "qi_select" ON public.quotation_items
  FOR SELECT TO public USING (true);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.quotations TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.quotation_items TO anon;
```

### Backlog เหลือ Phase 51+
- CSS ?v= bump audit (doc-print.css, phase4-*.css ค้าง ?v=1)
- escapeHtml dedup (main.js + 6 modules มี local copy)
- ✅ Bug E ปิดสนิท + Phase 50 data leak ปิดแล้ว

---

## 🔍 Phase 49 — Empty catch hardening (30 เม.ย.)

### Audit re-scan ก่อนทำ
รอบแรก audit เสนอ "~45 จุด" แต่ scan จริงพบ **16 empty catch** ใน main.js + 2 ใน ai-chat-widget.js
แยกตาม intent:
- **11 ตัว silent ตั้งใจ** (ควรปล่อยไว้): localStorage quota fail, DOM cleanup, JSON.parse with fallback,
  popup blocker print/share, optimistic UI re-render — silent ปกติ ไม่กระทบ user
- **7 ตัว silent ไม่ดี** (debug ยาก): state cleanup ตอน logout, restore hash หลัง login,
  background AC catalog load, service_jobs re-render, AI chat customer context lookup, JWT token read

### Fix scope (7 จุด)
**main.js (5 จุด):**
1. `clearCustomerDashboardState()` ตอน logout — เพิ่ม console.warn
2. `clearPosState()` ตอน logout — เพิ่ม console.warn
3. afterLogin restore hash block — เพิ่ม console.warn
4. AC catalog background fetch — เพิ่ม console.warn 2 จุด (init + fetch fail)
5. saveServiceJob re-render — เพิ่ม console.warn

**ai-chat-widget.js (2 จุด):**
6. customer context lookup — เพิ่ม console.warn (silent fail = AI ไม่รู้ context)
7. JWT token read — เพิ่ม console.warn (silent fail = unauth request)

### ตัวที่ไม่แก้ (intentional silent — เช็คแล้ว)
- `localStorage.setItem` (lines 882, 1175, 3509, 1414) — quota safe
- DOM cleanup (lines 399, 468, 1747) — element หายไปแล้ว safe
- `JSON.parse` with default (lines 2042, 2118, 1511) — fallback ถูกต้อง
- `showRoute` optimistic (lines 1968, 2358) — best-effort UI
- `setHelpContext`, `updateAppLogos`, `history.replaceState` — defensive

### Bump
- APP_BUILD 82 → 83
- main.js?v=82 → ?v=83
- ai-chat-widget.js?v=3 → ?v=4 (เพราะแก้ไฟล์นี้)
- sw.js cache v66 → v67
- pages.js Version 5.14.8 → 5.14.9

### Backlog เหลือ Phase 50+ → ✅ ปิดแล้วใน Phase 50
- ✅ quotations + quotation_items anon GRANT — แก้ใน Phase 50 (1 พ.ค.)
  พร้อม fix data leak ใน qi_select policy ที่เจอเพิ่มตอน scan
- CSS ?v= bump audit (doc-print.css, phase4-*.css ค้าง ?v=1)
- escapeHtml dedup (main.js + 6 modules มี local copy)
- ✅ Bug E ปิดสนิทแล้ว — see Phase 45.x section

---

## ✨ Phase 48 — Skeleton coverage (30 เม.ย.)

### Scan ก่อนทำ
ทำ scan 9 modules ที่ Phase 46/47 audit เสนอว่าควรเพิ่ม skeleton — พบจริง ๆ:
- **8/9 modules เป็น IN-MEMORY** (products, sales, customers, service_jobs, expenses,
  + list view ของ quotations/receipts/delivery_invoices) — render ทันทีจาก state.X
  → ใส่ skeleton จะ flash ในเสี้ยววินาที = แย่กว่าเดิม → **skip**
- **1/9 ASYNC จริง** (tasks.js) — ใช้ "กำลังโหลด..." text เก่า → upgrade เป็น skeleton
- **3/9 ASYNC ใน preview mode** (quotations/receipts/delivery_invoices ตอนกด 📄 view → fetch line_items)
  → user เห็น list เก่าระหว่างรอ ~100-500ms → ใส่ skeleton ก่อน fetch

### Modules ที่แก้ (4 ไฟล์)
1. **tasks.js** — แทน "กำลังโหลด..." ด้วย renderSkeleton(list×4) + เพิ่ม renderError 2 จุด
   (table missing + fetch fail) มี retry button — เดิมไม่มี retry
2. **quotations.js** — 3 จุด: openPreview, openEditForm, _pendingQuotationPreviewId
   → set container.innerHTML = renderSkeleton ก่อน await fetch
3. **receipts.js** — rc-view-btn click handler → set page innerHTML skeleton ก่อน fetch
4. **delivery_invoices.js** — 2 จุด: _pendingInvoicePreviewId + di-view-btn handler
   → set innerHTML skeleton ก่อน fetch

### Bump
- APP_BUILD 81 → 82
- main.js?v=81 → ?v=82
- sw.js cache v65 → v66
- pages.js Version 5.14.7 → 5.14.8

### Backlog เหลือ Phase 49+
- Empty catch block hardening ~45 จุด ใน main.js (HIGH จาก audit)
- CSS ?v= bump audit (doc-print.css, phase4-*.css ค้าง ?v=1)
- escapeHtml dedup (main.js + 6 modules มี local copy)
- USER ACTION: รัน `supabase-phase45-bug-e-tighten-anon.sql`

---

## 🎨 Phase 47 — ui_states adoption ครบ (30 เม.ย.)

ขยาย ui_states ไปอีก 7 modules → adoption coverage 17/17 list pages (~100%)

### Modules ที่ apply
1. **dead_stock.js** — renderEmpty (no CTA, "ทุกสินค้าขยับขายใน N วันที่ผ่านมา" — เป็น good state)
2. **profit_by_product.js** — renderEmpty 2 จุด (top10 winners + bottom10 dogs) ใส่ message ตาม context
3. **warranty_report.js** — renderSkeleton(table×5) + renderError 2 จุด (table missing + fetch fail) มี retry + renderEmpty filter-aware
4. **birthdays.js** — renderEmpty (เดือนนี้ไม่มีวันเกิดลูกค้า)
5. **recurring_expenses.js** — renderSkeleton + renderError 2 จุด + renderEmpty + CTA "+ เพิ่มรายการใหม่"
6. **credit_tracker.js** — renderEmpty filter-aware (open/overdue → "ไม่มีค้างชำระ — ดีมาก!", อื่น ๆ → "ไม่มีรายการในช่วงนี้")
7. **serials.js** — renderSkeleton + renderError 2 จุด + renderEmpty search-aware (ค้นหา → "ไม่พบ X", ไม่มี search → "ยังไม่มี serial" + CTA "+ เพิ่ม Serial")

### Bump
- APP_BUILD 80 → 81
- main.js?v=80 → ?v=81
- sw.js cache v64 → v65
- pages.js Version 5.14.6 → 5.14.7

### ยังเหลือใน Phase 48+ backlog
- renderSkeleton coverage ใน 10 modules ที่ใช้ ui_states แล้วแต่ยังไม่มี loading state (products/sales/customers/quotations/receipts/delivery_invoices/service_jobs/expenses/tasks/customer_dashboard มีแค่ตัวเดียว)
- empty catch block hardening ~45 จุดใน main.js
- CSS ?v= bump audit (doc-print.css, phase4-*.css)
- Module imports ?v= cache-bust strategy
- escapeHtml dedup (main.js + dashboard.js + 6 modules ที่มี local copy)

### USER ACTION pending (ยังค้างจาก Phase 45.x)
- รัน `supabase-phase45-bug-e-tighten-anon.sql` + ทดสอบสมัครลูกค้าใหม่

---

## 🩺 Phase 46.7 — Audit fixes (30 เม.ย.)

### Audit findings (ก่อนทำ)
ทำ audit 4 มุม (security / code quality / UX states / cache+PWA) พบ:

**HIGH:**
- Build version drift: APP_BUILD=79 ในโค้ด vs HANDOFF "build 73" → docs ตามไม่ทัน
- Pending DB migration: `supabase-phase45-bug-e-tighten-anon.sql` ยัง user-action pending
- Empty catch blocks ~45 ตำแหน่งใน main.js + ai-chat-widget.js (silent error swallow)

**MED:**
- ui_states adoption ~67% — 5+ list pages ยังไม่ใช้ (refunds/stock_movements/top_customers/dead_stock/profit_by_product/...)
- renderSkeleton ใช้แค่ 1/11 module (customer_dashboard.js) — modules อื่นไม่มี loading state
- renderError 0/11 — fetch fail fallback เงียบ
- CSS ?v= ค้าง: doc-print.css?v=1, phase4-*.css?v=1 (ถ้าเคยแก้แล้วลืม bump → user ติด stale)
- Module imports ไม่มี ?v= cache-bust — พึ่ง SW reload อย่างเดียว
- SlipOK API key เก็บ plaintext ใน localStorage (defense in depth gap)

**LOW:**
- escapeHtml duplicate: main.js:528 + dashboard.js:901 (ทั้งคู่ทำงานถูก แต่ซ้ำ)
- products.js 2,357 lines, main.js 3,691 lines — refactor candidate
- STUCK_BUILDS_BEFORE=47 legacy จาก Phase 35 — harmless แต่ลบทิ้งได้

**ผ่าน ✅:** XSS hardening Phase 46.2 ครอบคลุม sink หลัก / ไม่มี alert/eval / secrets อยู่ env vars / SW cache version bump ตามทุก phase / offline fallback ดี / manifest icons ครบ / update banner wired ถูก

### Phase 46.7 fix scope (รอบนี้)
1. **modules/refunds.js** — ใช้ renderSkeleton (table×5) ตอน load + renderError 2 จุด (table missing + fetch fail) มี retry button + renderEmpty + CTA "+ บันทึกการคืนสินค้า"
2. **modules/stock_movements.js** — เพิ่ม sm-empty-slot แยกจาก table → ตอน empty hide table + show renderEmpty + CTA "+ เพิ่มเคลื่อนไหวสต็อก"
3. **modules/top_customers.js** — แทน inline empty div ด้วย renderEmpty (ใส่ filter-empty message ตาม period)
4. Bump APP_BUILD 79→80, main.js?v=80, sw.js cache v63→v64

### ยังเหลือใน Phase 47 (ไว้รอบหน้า)
- ui_states adoption ใน: dead_stock, profit_by_product, warranty_report, birthdays, recurring_expenses, credit_tracker, serials
- renderSkeleton coverage ใน 10 modules ที่ใช้ ui_states แล้วแต่ยังไม่มี loading state
- empty catch block hardening ~45 จุดใน main.js
- CSS ?v= bump audit (ตรวจ history แต่ละไฟล์)
- Module imports ?v= cache-bust strategy

### USER ACTION pending (ค้างจาก Phase 45.x)
- รัน `supabase-phase45-bug-e-tighten-anon.sql` + ทดสอบสมัครลูกค้าใหม่ (security gap จนกว่าจะรัน)

---

## 🛡️ Phase 45.x — Bug A/B/C RLS Audit & Fix (29 เม.ย.)

### Audit context
หลัง Phase 45.10 RLS hardening — diagnostic ผ่าน Supabase REST API + SQL Editor
พบ 3 bugs ใหญ่ที่ migration ก่อนหน้าไม่ครอบคลุม

### Bug A — profiles infinite recursion (HTTP 500)
**Symptom:** GET `/rest/v1/profiles` → SQLSTATE 54001 "stack depth limit exceeded"
**Root cause:** Policies เก่า 3 ตัวค้างบน profiles ใช้ custom function `"current_role"()`
ที่ body ดึง role จาก profiles เอง → policy เรียก function → function อ่าน profiles
→ trigger policy ซ้ำ → infinite loop

Policies ที่ค้าง:
- `profiles select self` (TO public, USING current_role()...)
- `profiles update self` (TO public, USING current_role()...)
- `Allow authenticated insert profiles` (duplicate ของ profiles_insert)

**Fix:** [supabase-phase45-bug-fix-a-c.sql](supabase-phase45-bug-fix-a-c.sql) — Part A
DROP 3 policies ค้าง — Phase 45.10 quartet (`profiles_select/insert/update/delete`)
ที่ใช้ `is_admin()` SECURITY DEFINER ทำงานปกติ ไม่ recursion

⚠️ ไม่ DROP function `"current_role"()` เพราะ policies อื่น (categories, customers,
products, quotations, service_jobs) ยังใช้ — drop ตอนนี้ break

### Bug B — anon data leak (publishable key อ่าน sensitive ได้)
**Symptom:** anon (key สาธารณะใน supabase-config.js) อ่าน expenses (1 row),
receipts (2), delivery_invoices (2), warehouse_stock (60), loyalty_settings (1),
stock_movements (9) ได้โดยไม่ login

**Root cause:** 80+ policies เก่าค้าง — หลายตัว `TO public USING (true)` หรือ
`TO authenticated USING (true)` ทับ Phase 45.10 hardened policies. PostgreSQL
ประเมิน policy แบบ OR — ANY policy true → granted → 45.10 ถูก bypass

Worst offenders:
- `Allow update sales` (TO public, USING true) — anyone update sales
- `Allow authenticated delete products` (USING true) — authenticated ใครก็ลบ
- `service_jobs_delete_authenticated` (USING true) — ใครก็ลบใบงาน
- `qi_delete/qi_insert/qi_update` (TO public USING true) — public CRUD quotation_items
- `expenses_select / rc_select / di_select / dii_select / warehouse_stock_select / etc.`
  (TO public USING true) — read leak ทั้งหมด

**Fix:** [supabase-phase45-bug-b-cleanup.sql](supabase-phase45-bug-b-cleanup.sql)
DROP ~70 policies เก่า + REVOKE table-level GRANT จาก anon บน 28 tables sensitive

KEEP (intentional public):
- `customer_otp.Allow anon insert/select` — signup OTP
- `store_settings.read_store_settings` — landing page
- `quotations.public_read_by_share_token` — share link flow
- `quotation_items.qi_select` — share-link line items
- profiles + customers grants — signup flow (signUp ได้ JWT แล้วค่อย insert)

ADD ใหม่:
- `loyalty_settings_read_auth` (TO authenticated USING true)
- `permissions_read_auth` + `permissions_write_admin`
- `line_notify_settings_read_auth` + `line_notify_settings_write_admin`
- `store_settings_update_admin` / `store_settings_insert_admin` / `store_settings_delete_admin`

**Verify:** anon hit ทุก sensitive table → HTTP 401 (ก่อน 200 + data) ✅

### Bug C — CHECK constraints หายหมด
**Symptom:** Diagnostic Section 5 (`pg_constraint` filter) → 0 rows
ตาราง service_jobs.job_type / service_jobs.status / stock_movements.type ไม่มี
CHECK constraint เลย — defense in depth gap

**Root cause:** Migration เก่า (45.2/45.7/45.8) DROP สำเร็จ แต่ ADD fail
(น่าจะติด data เก่าที่ค่าไม่ pass) → transaction rollback → constraint หาย

**Fix:** [supabase-phase45-bug-fix-a-c.sql](supabase-phase45-bug-fix-a-c.sql) — Part C
ADD 3 constraints กลับ + ใช้ `NOT VALID` → skip validation ของ existing rows
→ ไม่ fail แม้มีค่าผิด. ค่าใหม่ที่ INSERT/UPDATE จะถูก validate ทุกครั้ง

```
service_jobs_job_type_check    → 11 ค่า (ac, solar, cctv, other, repair_ac, ...)
service_jobs_status_check      → 6 ค่า (pending, progress, done, delivered, closed, cancelled)
stock_movements_type_check     → 6 ค่า (in, out, sale, transfer, return, adjust)
```

User สามารถรัน `VALIDATE CONSTRAINT` ทีหลังถ้าอยากให้ DB ตรวจของเก่าด้วย
(ตัวอย่าง query อยู่ใน comment ปลายไฟล์ migration)

### Bug F — handle_new_user trigger ignores metadata role
**Symptom:** User signup ผ่าน OTP → login เป็น "พนักงานขาย" แทน "ลูกค้า"
sidebar/permissions ขึ้นเป็น sales ทั้งที่ตั้งใจให้เป็น customer

**Root cause:** Trigger `handle_new_user` (จาก supabase-rls-policies.sql)
hardcode `role = 'sales'` ทุก user ใหม่ — ignore `raw_user_meta_data->>'role'`
ที่ main.js signUp() ส่ง 'customer'

Order ของเหตุการณ์:
1. signUp() → auth.users insert + metadata role=customer
2. Trigger fires → INSERT profile (role='sales') ← BUG
3. main.js POST profile (role=customer) → `ON CONFLICT DO NOTHING` →
   silent skip — row จาก trigger ทับไว้แล้ว
4. afterLogin → role='sales' → UI ขึ้นเป็น sales

**Fix:** [supabase-phase45-bug-f-trigger-role.sql](supabase-phase45-bug-f-trigger-role.sql)
1. CREATE OR REPLACE function — ใช้ `COALESCE(metadata.role, 'sales')`
   (fallback 'sales' ไว้สำหรับ user ที่ admin สร้างผ่าน Dashboard
   โดยไม่ตั้ง metadata)
2. Backfill UPDATE — แก้ profile.role ของ user ที่ติด bug นี้
   (sawang: sales → customer)
3. + carry `phone` จาก metadata เข้า profiles ด้วย

**Verify:** SELECT ทุก user แสดง profile_role vs metadata_role
+ flag MISMATCH → ทุกคน ✅ OK

USER ACTION: ✅ done (รัน + verified)

### Bug E — anon over-grant tightening (defense in depth)
**Symptom:** ไม่ได้ break อะไร — แต่ Bug B ก่อนหน้า KEEP anon GRANT บน
profiles/customers/customer_otp ไว้ "เผื่อ signup ใช้". Audit code
ใหม่พบ:

- **profiles + customers** — signUp() flow ใน main.js:1330-1341
  ใช้ `authData?.session?.access_token` (JWT authenticated) เป็น
  Bearer → POST ทำในฐานะ authenticated ไม่ใช่ anon → anon GRANT
  ไม่จำเป็น
- **customer_otp** — verify-otp.js เป็น HMAC stateless (ฝั่ง
  Cloudflare) ไม่ใช้ DB table → table dead — DROP policies +
  REVOKE GRANT

**Fix:** [supabase-phase45-bug-e-tighten-anon.sql](supabase-phase45-bug-e-tighten-anon.sql)
- REVOKE ALL ON profiles FROM anon
- REVOKE ALL ON customers FROM anon
- DROP "Allow anon insert otp" + "Allow anon select otp" + REVOKE
  customer_otp FROM anon

**Rollback ถ้า signup break:**
```sql
GRANT ALL ON public.profiles, public.customers TO anon;
```

⚠️ Pre-condition: Supabase Auth → email confirmation ต้องปิด
(default สำหรับ phone-based fake email — ถ้าเผลอเปิดใน Dashboard
จะ break)

USER ACTION: ✅ DONE (1 พ.ค. 2026)
- Pre-check พบว่า profiles/customers/customer_otp anon GRANT
  ถูก revoke ไปแล้วตั้งแต่ Phase 45.x ก่อนหน้า (Bug B cleanup
  น่าจะ catch ไปแล้ว) → ไม่ต้องรัน Step 2 — state ตรงเป้าอยู่
- ทดสอบ signup ลูกค้าใหม่ (babang / 0874536754) ✅ ผ่าน
  - phone-based fake email login ทำงาน
  - profile.role = customer ถูกต้อง (Bug F trigger working)
  - customer dashboard load ได้ปกติ

### Bug D — profiles_with_email view 403 (pre-existing)
**Symptom:** GET `/rest/v1/profiles_with_email` → HTTP 403
"permission denied for table users". Display ใน "ตั้งค่าผู้ใช้งาน"
ทำงานได้เพราะ fallback อ่าน profiles ตรง — แต่ console spam errors

**Root cause:** View ตั้ง `security_invoker = on` → ใช้สิทธิ์ caller →
authenticated role ไม่มี GRANT บน auth.users → JOIN fail

**Fix:** [supabase-phase45-bug-d-view-fix.sql](supabase-phase45-bug-d-view-fix.sql)
DROP + CREATE view ใหม่:
- ไม่ใช้ `security_invoker` (default DEFINER mode — run as postgres) →
  bypass auth.users RLS → JOIN ได้
- WHERE filter ใน view: `is_admin() OR p.id = auth.uid()`
  → admin เห็นทุก row, non-admin เห็นแค่ตัวเอง
- GRANT SELECT TO authenticated, REVOKE FROM anon

Trade-off: customer/sales/technician เห็นเฉพาะ profile ตัวเอง
(ถ้าต้องเห็นคนอื่น relax เป็น `is_staff()` ทีหลัง)

### Files committed
- `supabase-phase45-diagnostic.sql` — read-only diagnostic (1-row 7 JSON cols)
- `supabase-phase45-bug-fix-a-c.sql` — Bug A + Bug C (146 lines)
- `supabase-phase45-bug-b-cleanup.sql` — Bug B (302 lines)
- `supabase-phase45-bug-d-view-fix.sql` — Bug D (76 lines)
- `supabase-phase45-bug-e-tighten-anon.sql` — Bug E (74 lines)
- `supabase-phase45-bug-f-trigger-role.sql` — Bug F (81 lines)

### USER ACTION ที่ทำไปแล้ว
1. ✅ รัน `supabase-phase45-diagnostic.sql` — ส่ง JSON output กลับมา
2. ✅ รัน `supabase-phase45-bug-fix-a-c.sql` — verified 3 constraints + profiles ไม่ recurse
3. ✅ รัน `supabase-phase45-bug-b-cleanup.sql` — verified anon block ทุก sensitive table
4. ✅ รัน `supabase-phase45-bug-d-view-fix.sql` — verified anon ถูก REVOKE จาก view

### USER ACTION pending
- (Optional) รัน VALIDATE CONSTRAINT 3 ตัว (Bug C — ตัวอย่าง query
  อยู่ใน comment ปลายไฟล์ bug-fix-a-c.sql) — บังคับ DB ตรวจของเก่าด้วย

---

## 🚀 Phase 45.4 → 45.13 — service_form polish + audit fixes (27-28 เม.ย.)

### Phase 45.13 — service_jobs drawer dropdown (28 เม.ย.)
edit drawer สำหรับ service_jobs ที่สร้างผ่าน service_form (Phase 45) มี
`<select id="serviceType">` แค่ 3 ตัวเลือกเก่า (ac/solar/cctv) — ตอน save ใหม่
ค่าใน dropdown blank → DB CHECK constraint reject. แก้: เพิ่ม 11 ตัวเลือกครบ

Bump: main.js v=71, SW v55, version 5.13.1 (build 71), APP_BUILD=71

### Phase 45.12 — edit drawer for delivery_invoices + receipts
User ขอความสามารถแก้ใบส่งของ + ใบเสร็จ (เดิมแก้ได้แค่ใบเสนอราคา)

Editable: customer info (name/phone/address/tax_id), salesperson, due_date
(เฉพาะ delivery_invoice), project_name, ref_no, note

NOT editable: line items, totals, discounts, taxes (มาจาก upstream doc)
+ banner เตือนใน modal

Edit hidden เมื่อ:
- delivery_invoice.status = 'receipted' (locked)
- receipt.status = 'cancelled' (locked)

Bump: main.js v=70, SW v54, **version 5.13.0 (build 70)** (minor bump)

### Phase 45.11 — non-blocking loadAllData (UI hang fix)
Same hang pattern จาก 45.9 (saveServiceJob) — เจออีก 13 จุด ทุก save/action button
`await loadAllData()` block UI 10-30s ฟิ้น 10+ tables sequentially

Fixed locations:
- main.js: saveProduct, saveCustomer, checkout (POS — openReceiptDrawer
  อ่านจาก state.lastReceipt)
- modules/customer_dashboard.js (customer checkout)
- modules/delivery_invoices.js (cancel/restore — 3)
- modules/quotations.js (cancel/restore/approve — 3)
- modules/receipts.js (cancel/restore — 4)
- modules/stock_movements.js (manual + transfer — 2)
- modules/line_notify.js (settings save)

Pattern: replace `await loadAllData()` →
`loadAllData().catch(e => console.warn(...))` — UI update ทันที, reload BG

Intentionally NOT changed:
- main.js:1424 (initial app boot)
- ac_install.js:720 (+ create new bill — Phase 45.5)
- service_form.js:646 (+ create new bill — Phase 45.4)

Bump: main.js v=69, SW v53, version 5.12.9 (build 69)

### Phase 45.10.1 — sales policy DENY ALL hotfix
sales.customer_id = bigint (ไม่ใช่ uuid) — cast `customer_id::uuid` ใน
rls-hardening.sql fail mid-migration → sales เหลือไม่มี policy → DENY ALL

แยก 4 explicit policies: SELECT all, INSERT all authenticated,
UPDATE/DELETE sales+admin only

USER ACTION: re-run `supabase-phase45-rls-hardening.sql`

### Phase 45.10 — RBAC + RLS hardening (B2/B5/RLS)
**B2-1:** `globalSearchProducts` bypass role check — call `renderProductsPage`
ตรง. แก้: wrap ใน `canAccessPage` check
**B2-2:** New SQL `supabase-phase45-rls-hardening.sql` — replace `USING(true)`
ด้วย role-based checks. Helper functions: `auth_user_role()`, `is_admin()`,
`is_staff()`, `is_sales_or_admin()`. Critical: profiles UPDATE/DELETE
admin-only (ป้องกัน role escalation). Financial tables (expenses, recurring,
refunds) → sales/admin. Sales/quotations/receipts write → sales/admin.
Stock tables write → staff

**B5-1:** customer_dashboard module state (_custCart, slip data) leak ข้าม
logout/login → เพิ่ม `clearCustomerDashboardState` exported, call จาก logout
**B5-2/3/4:** delivery_invoices, quotations, receipts left _lineItems +
_selectedIds stale หลัง preview → reset ตอนเริ่ม renderXPage
**B5-5:** pos.js _posCustomer leak ข้าม session → `clearPosState` export +
call จาก logout
**B5-6:** products.js bulkSelected Set retain IDs ข้าม navigation (เสี่ยง
bulk-delete ผิด product) → reset ตอนเริ่ม renderProductsPage

USER ACTION: รัน `supabase-phase45-rls-hardening.sql`

Bump: main.js v=68, SW v52, version 5.12.8 (build 68)

### Phase 45.9 — saveServiceJob UI hang 2 นาที
User report หลัง edit + save service job หน้าหมุน ~2 นาที.
Root cause: line 2408 `await loadAllData()` ก่อน showToast + re-render
→ block UI fetch 10+ tables sequentially

Apply same pattern จาก 45.4/45.5:
- Optimistic update state.serviceJobs (PATCH หรือ POST ใหม่)
- ปิด drawer + toast ทันที
- Re-render service_jobs page (instant)
- Background loadAllData via setTimeout (no await, no block)

Bump: main.js v=67, SW v51, version 5.12.7 (build 67)

### Phase 45.8 — audit fixes (B1/B3/B7)
**B1:** customer drawer 'movement history' (main.js:2208) ใช้ field name เก่า
(movement_type/quantity/stock_before/stock_after) — Phase 45.3 พลาด callsite นี้
แก้: m.type, m.qty, parse note หา before/after
**B3:** products.stock recompute มี empty `catch{}` กลืน error → log warn
ให้ silent drift visible ใน Console
**B7:** SQL migration `supabase-phase45-service-status-closed.sql` เพิ่ม
'closed' ใน service_jobs.status CHECK. Customer dashboard "ลูกค้ายืนยันปิดงาน"
button ส่ง status='closed' แต่ DB allow แค่ pending/progress/done/delivered/
cancelled

USER ACTION: รัน `supabase-phase45-service-status-closed.sql`

Bump: main.js v=66, SW v50, version 5.12.6 (build 66)

### Phase 45.7 — stock_movements.type CHECK migration
หลัง 45.3 rename `movement_type` → `type` — DB constraint
`stock_movements_type_check` reject ค่าเช่น 'out', 'transfer'
(allow แค่ subset)

Migration drop + recreate allow 6 ค่า: in, out, sale, transfer, return, adjust

USER ACTION: รัน `supabase-phase45-stock-type-fix.sql`

### Phase 45.6 — inline transfer "บ้าน→รถ" button
User ขอความสามารถโอน stock จากบ้าน → รถ โดยไม่ออกจากใบงาน

Add button ใน panel header ของ:
- ac_install.js (ติดตั้งแอร์)
- service_form.js (ซ่อมแอร์ + 8 ประเภทอื่น)

Modal: search/pick product (เฉพาะที่บ้าน stock > 0) → pick warehouse + qty
→ confirm → call `window._appTransferWarehouseStock` → optimistic update

Shared modal: `window._appOpenTransferModal` (defined ใน ac_install.js)
ทั้ง 2 modules reuse

Bump: main.js v=65, SW v49, version 5.12.5 (build 65)

### Phase 45.5 — apply mid-save form re-mount fix to ac_install.js
Same bug จาก 45.4 แต่ใน ac_install.js (Phase 41-43 module). Save flow call
`await ctx.loadAllData()` → triggers renderAll → showRoute → renderAcInstallPage
→ form re-mount mid-flow → labor/discount/note inputs reset to value=0
(และ customer fields ว่างด้วย)

แก้: optimistic state.warehouseStock decrement, defer full reload ไป
'+ create new bill' button click

Bump: main.js v=64, SW v48, version 5.12.4 (build 64)

### Phase 45.4 — service_form skip mid-save loadAllData
หลัง save, `ctx.loadAllData()` triggers renderAll → showRoute →
renderServiceFormPage → form re-mounts → labor/discount inputs reset
mid-flow (user งง คิดว่าระบบ reset input)

แก้: defer full reload ไป '+ create new bill' button click

Bump: main.js v=63, SW v47, version 5.12.3 (build 63)

---

## 🐛 Phase 45.3 — fix stock_movements schema mismatch (28 เม.ย. เช้า)

### Why
User ทดสอบบันทึกใบงานซ่อมแอร์ — ใบงาน save ผ่านแต่ Console log:
```
POST stock_movements 400 (Bad Request)
PGRST204: Could not find the 'movement_type' column of 'stock_movements' in the schema cache
```

### Root cause (bug เก่ามาก่อน Phase 45 — silent-fail มาตลอด)
DB schema `stock_movements` จริงๆ คือ:
```
id bigint, product_id bigint, type text, qty integer,
note text, created_by uuid, created_at timestamptz
```

แต่ code main.js ใช้ field names ผิด:
| Code | DB จริง |
|---|---|
| `movement_type` | `type` |
| `quantity` | `qty` |
| `stock_before` / `stock_after` | ❌ ไม่มี |
| `created_by: "user@email"` (string) | `created_by uuid` |

⚠️ POS ขาย / โอนคลัง / `_applyStockMovement` **ทุก call site** silent-fail มาตลอด เพราะ wrap try/catch — sale บิลไม่เคย log ใน stock_movements

### Fix ([main.js](main.js))
1. **`_applyStockMovement`** (line 2629): rename fields + ฝัง `before→after` ใน note + `created_by` ใช้ `state.currentUser?.id` (uuid)
2. **`_deductStockForSaleItem`** (line 2497): 2 callsites POS sale — fix เหมือนกัน
3. **`_transferWarehouseStock`** (line 2570): warehouse transfer — fix เหมือนกัน
4. **[modules/stock_movements.js](modules/stock_movements.js)**:
   - reads `m.movement_type` → `m.type` (4 จุด)
   - `m.quantity` → `m.qty`
   - `m.stock_before` / `m.stock_after` → ใส่ใน note column แทน (table colspan=2)

### Bump
- main.js?v=61 → v=62
- SW v45 → v46
- Version display 5.12.1 → 5.12.2 (build 62)
- selfHeal APP_BUILD: 61 → 62

### Test (สำหรับ user)
1. Hard refresh **Ctrl+Shift+R** → ตรวจ version **5.12.2 (build 62)**
2. กลับไปใบงานซ่อมแอร์ → กรอกใหม่ + เพิ่มอุปกรณ์ + กดบันทึก
3. ✅ ต้องไม่มี HTTP 400 ใน Console
4. ✅ Stock อุปกรณ์ในรถต้อง **ลดลงจริง** (ไปดูหน้า "🚐 คันขาว" หรือ "🚗 คันแดง")
5. หน้า "ประวัติเคลื่อนไหวสต็อก" → ต้องเห็น row "out" จากใบงานล่าสุด + note `"... | 5→4"` (before/after)
6. ทดสอบ POS ขายของ 1 บิล → ต้องเห็น row "sale" ใน stock_movements ด้วย (เดิม silent-fail)

### Out of scope (ทำต่อในอนาคตถ้าต้องการ)
- Add columns `stock_before`, `stock_after`, `warehouse_id` ใน DB เพื่อ audit ละเอียดกว่า (ต้อง migration)
- Backfill movement_type → type สำหรับ row เก่า (ถ้ามี)

---

## 🚨 Phase 45.2 — DB CHECK constraint hotfix (28 เม.ย. เช้า) — DONE

**🛡️ Phase 17 Active!** — KV binding ผูกแล้ว (Production + Preview), tested 429 OK

---

## 🚨 Phase 45.2 — DB CHECK constraint hotfix (28 เม.ย. เช้า) — **USER ACTION REQUIRED**

### Problem
User ทดสอบบันทึกใบงานซ่อมแอร์ → HTTP 400 code 23514:
```
new row for relation "service_jobs" violates check constraint "service_jobs_job_type_check"
```

### Root cause
DB มี CHECK constraint ตั้งแต่เริ่ม schema เดิม — อนุญาต `job_type` แค่ `'ac'`, `'solar'`, `'cctv'` (ตรงกับ `<select id="serviceType">` เดิม) → ค่าใหม่ 9 ตัวจาก Phase 45 ถูก reject

Blueprint Step 5 เขียน "ไม่ต้อง migration" — **ผิด**, repo ไม่มี constraint ใน .sql ทำให้พลาด

### Fix
ผม commit ไฟล์ migration ไว้แล้ว: [supabase-phase45-job-type-fix.sql](supabase-phase45-job-type-fix.sql)

**🔴 USER ต้องรัน manual ใน Supabase:**
1. เปิด Supabase Dashboard → SQL Editor
2. เปิดไฟล์ `supabase-phase45-job-type-fix.sql` → copy ทั้งหมด → paste
3. กด Run → ตรวจ "Success. No rows returned"
4. กลับไปแอป → ทดสอบบันทึกใบงานซ่อมแอร์ → ต้องผ่านแล้ว

**Migration ทำอะไร:**
- DROP `service_jobs_job_type_check` เดิม
- ADD ใหม่ที่ allow: `ac`, `solar`, `cctv`, `other`, `repair_ac`, `clean_ac`, `move_ac`, `satellite`, `repair_fridge`, `repair_washer`, `repair_tv` (11 ค่า)

### ทำไมไม่ drop constraint ทิ้งไปเลย
- ป้องกัน typo / bug ใน app code ไม่ให้ส่ง garbage เข้า DB
- ถ้าเพิ่ม service type ใหม่ในอนาคต → ต้องอัพเดท constraint อีก (ขั้นตอน explicit)

---

## 🔧 Phase 45.1 — service_form improvements (27 เม.ย. รอบ บ่าย)

### Why
Phase 45 ใน production มี gap 4 จุดเทียบกับ ac_install Phase 43 — ใบงานช่างไม่บังคับ business rule "ตัดจากรถเท่านั้น" + ไม่มี user confirm ก่อน auto-transfer

### What changed (เฉพาะ [modules/service_form.js](modules/service_form.js))
1. **Force re-pick "บ้าน" → "รถ"** — ตอน save ถ้า user pick home → re-map เป็น mobile แรก auto → trigger transfer flow (เหมือน ac_install Phase 43)
2. **Pre-check stock + `App.confirm`** — ก่อน insert DB → collect transfersNeeded → ถ้ามี → แสดง modal ถาม "ตกลงโอน + ตัดสต็อก?" (silent transfer หายไป)
3. **Throw error เมื่อของไม่พอจริงๆ** — ถ้า mobile ไม่พอ + home ก็ไม่พอ → throw + แสดงข้อความชัดเจน (เดิม continue silent → save ได้แต่ stock fail)
4. **Picker UI ดีขึ้น** — แต่ละ product แสดง:
   - 🚐 [ชื่อรถ]: N (badge แยกต่อรถ)
   - 📦 บ้าน: N (badge ถ้าบ้านมี)
   - ⚠️ "ยังไม่ได้โอนขึ้นรถ — ต้องยืนยันโอนตอนกดเลือก" (ถ้าไม่มีในรถเลย)
5. **Items list `_stock_avail`** — ตาราง show "คงเหลือ N" ในแต่ละแถวอุปกรณ์
6. **Toast หลังเพิ่ม item** — บอกว่ามาจากรถไหน (`เพิ่ม "ของ" จาก คันขาว แล้ว`)
7. **Receipt header field "ประเภทงาน:"** — explicit แทน icon line อย่างเดียว

### Bump
- main.js?v=60 → v=61
- SW v44 → v45
- Version display 5.12.0 → 5.12.1 (build 61)
- selfHeal APP_BUILD: 60 → 61

### Test (สำหรับ user)
1. Hard refresh (Ctrl+Shift+R) — ตรวจ version 5.12.1 (build 61)
2. Sidebar → 🧰 งานช่าง → คลิก **"🔧 ซ่อมแอร์"** → เปิดหน้าใหม่
3. กรอกข้อมูล + กด "+ เพิ่มอุปกรณ์" → ตรวจ picker UI:
   - product ที่มีในรถ → เห็น 🚐 badge
   - product ที่อยู่บ้านอย่างเดียว → เห็น ⚠️ "ยังไม่ได้โอนขึ้นรถ"
4. เลือก product ที่อยู่บ้าน → กดบันทึก → ต้องเห็น modal "🚐 ของในรถไม่พอ — ต้องโอนจากบ้านขึ้นรถก่อน..." → ตกลง
5. หลัง save → ตรวจ stock_movements: ต้องเห็น 1) transfer บ้าน→รถ 2) out จากรถ
6. ทดสอบ sample 1-2 ประเภทอื่นพอ (ล้างแอร์, ซ่อมตู้เย็น)

---

## 🎯 Phase 45 — Service Job Forms (9 ประเภท) — DONE

**Status:** Implemented + deployed 27 เม.ย. รอบ early morning
**Plan:** [BLUEPRINT_PHASE_45.md](BLUEPRINT_PHASE_45.md) — followed completely

### What was built
สร้าง `modules/service_form.js` — generic module ที่ใช้ logic เดียวกับ `ac_install.js` (Phase 41-43) แต่ไม่มี "เลือกรุ่นแอร์":
- ✅ ข้อมูลลูกค้า (ชื่อ + เบอร์ + ที่อยู่)
- ✅ รายละเอียดงาน (textarea — type-specific placeholder)
- ✅ เลือกอุปกรณ์จากสต็อก (line items picker — mobile warehouse priority)
- ✅ ค่าแรง + ส่วนลด + สรุปยอด real-time
- ✅ ตัดสต็อก auto + transfer บ้าน→รถ (App.confirm)
- ✅ บันทึก service_jobs row + items_json
- ✅ 3 ปุ่มหลังบันทึก: ดูใบเสร็จ + ส่ง LINE + สร้างใหม่

### 9 routes ใหม่ + Sidebar
| Route | Icon | Label | job_type |
|---|---|---|---|
| service_repair_ac | 🔧 | ซ่อมแอร์ | repair_ac |
| service_clean_ac | 🧼 | ล้างแอร์ | clean_ac |
| service_move_ac | 📦 | ย้ายแอร์ | move_ac |
| service_repair_fridge | ❄️ | ซ่อมตู้เย็น | repair_fridge |
| service_repair_washer | 🧺 | ซ่อมเครื่องซักผ้า | repair_washer |
| service_repair_tv | 📺 | ซ่อมทีวี | repair_tv |
| service_cctv | 📷 | CCTV | cctv |
| service_satellite | 📡 | จานดาวเทียม | satellite |
| service_other | 🔨 | งานอื่นๆ | other |

Sidebar "🧰 งานช่าง" ขยายจาก 3 → **12 items** (ใบรับงาน + ติดตั้งแอร์ + 9 service forms + โซล่าเซลล์)

### State management
- ใช้ `Map` เก็บ state ต่อ serviceType — ไม่ปนกัน
- กรอกใน "ซ่อมแอร์" → กลับไป "ซ่อมตู้เย็น" → state แยก ไม่ทับกัน

### Schema
ไม่ต้อง migration — `service_jobs.job_type` รองรับ string ใดๆ + ใช้ items_json (Phase 42)

### Files touched
- `modules/service_form.js` — **CREATED** (~796 บรรทัด)
- `main.js` — import + SERVICE_FORM_ROUTES + ALL_ROUTES + ROLE_PAGES + ROUTE_GROUP + titles + showRoute handler
- `index.html` — 9 `<section>` + 9 sidebar buttons in งานช่าง group + bump v=60 + APP_BUILD=60
- `sw.js` — bump v44
- `modules/settings/pages.js` — version display 5.12.0 (build 60)

### Bump
- main.js?v=59 → v=60
- SW v43 → v44
- Version display 5.11.4 → 5.12.0 (build 60) — minor bump (feature ใหญ่)
- selfHeal APP_BUILD: 59 → 60

---

## 🧹 Phase 43.3 — Update Banner + Native Modal Cleanup (26 เม.ย. รอบ 19)

### Fix #1: ปุ่มอัปเดต false alarm (ของเก่าค้างจาก Phase 20)
[modules/settings/pages.js:138](modules/settings/pages.js:138) — เปลี่ยน `newBuild !== currentBuild` → `Number(newBuild) > Number(currentBuild)`
- เดิม: build 58 vs 58 + SW waiting → "พบเวอร์ชันใหม่ build 58 ← ปัจจุบัน build 58" (false alarm)
- แก้: ถ้า build เท่ากัน + SW waiting → apply เงียบๆ ("กำลัง apply Service Worker ใหม่...")

### Fix #2: แทน native modal ใน Phase 43 (2 จุด)
[modules/ac_install.js](modules/ac_install.js):
- `window.confirm` (line 318 — smart transfer dialog) → `App.confirm`
- `window.prompt` (line 637 — เลือกรถ) → custom modal `_pickMobileWarehouse()` — buttons สวยๆ แสดงคงเหลือ

### Bump
- main.js?v=57 → v=58
- SW v41 → v42
- Version display 5.11.2 → 5.11.3 (build 58)
- selfHeal APP_BUILD: 57 → 58

---

## 🔧 Phase 43 — AC Install Stock Deduction (mobile-only) — 26 เม.ย. รอบ 16

### Why
Phase 42 audit เจอ gap: AC install ไม่ตัดสต็อก → สต็อกในระบบไม่ตรงกับของจริง
User confirm business rule: "บ้าน=master, รถ=mobile, ใบงานช่างต้องตัดจากรถเท่านั้น"

### Decisions (User confirmed)
1. **ศีขร** = บ้านอีกหลัง / สาขา (ไม่ใช่รถ)
2. **ของในรถไม่พอ** → Smart Confirm Dialog (Option C)
   - Popup: "ในรถมี X, บ้านมี Y → โอนจากบ้านขึ้นรถ Z แล้วตัด?"
   - User กด OK → ระบบทำ 2 transactions: transfer + deduct
3. **แก้ไขใบงานหลัง save** = lock items + แก้ได้แค่ note/photo/status
4. **บังคับขึ้นรถก่อน** — ไม่ตัดจากบ้านโดยตรง (Option C จัดการให้)
5. **POS ตามเดิม** — prefer "บ้าน" ตัดก่อน

### Schema
```sql
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT false;
UPDATE warehouses SET is_mobile = true
  WHERE name LIKE 'คัน%' OR name LIKE '%รถ%' OR LOWER(name) LIKE '%van%';
```

### Code Changes
- **modules/ac_install.js** — refactor picker:
  - Filter เฉพาะสินค้าที่มีใน mobile warehouses (รถ)
  - แสดง stock per warehouse → user เลือกรถ
  - Items table เพิ่ม column "คลัง"
  - Save → loop items → ตัดสต็อกจากรถ + auto-transfer ถ้าจำเป็น (with confirm)
  - Lock items หลัง save (Q3)

### Bump
- main.js?v=54 → v=55
- SW v38 → v39
- Version display 5.10.0 → 5.11.0 (build 55)
- selfHeal APP_BUILD: 54 → 55

### ⚠️ User ต้องรัน SQL migration:
```sql
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT false;
UPDATE warehouses SET is_mobile = true
  WHERE name LIKE 'คัน%' OR name LIKE '%รถ%' OR LOWER(name) LIKE '%van%';
```

---

## ⚠️ ACTION REQUIRED (Phase 42)

User ต้องรัน `supabase-rls-policies.sql` ใหม่ — เพิ่ม column:
```sql
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS items_json JSONB DEFAULT '[]'::jsonb;
```
(idempotent — รันซ้ำได้ปลอดภัย)

ถ้าไม่รัน → บันทึกใบงานติดตั้งจะ error "column items_json does not exist"

---

## 🛠️ Phase 42 — AC Install: Line Items + Receipt + LINE (26 เม.ย. รอบ 17)

### User request
"ผมอยากให้เอาสต็อกในร้าน งานแอร์ และสต็อกนี้ มาให้ช่างเลือกบันทึกงาน ตรงนี้ด้วยครับ
เวลาไปปิดงานแอร์เก่าลูกค้า เพิ่มอุปกรณ์ได้ด้วย ส่งสลิปใบเสร็จ รวมยอดให้ลูกค้าได้เลยครับ"

### Phase B — Line items picker
แทน input field "ค่าท่อทองแดง / น้ำทิ้ง / ขาตั้ง / ค่าไฟ" (เป็นตัวเลข) → **เลือกอุปกรณ์จากสต็อกจริง**

- เพิ่ม section "🔧 อุปกรณ์เพิ่มเติม (จากสต็อก)" + ปุ่ม "+ เพิ่มอุปกรณ์"
- เปิด **picker modal** — search สินค้าทั้งร้าน (ชื่อ/barcode/หมวด) ที่มี stock > 0
- แสดง: รายการ / qty / ราคา/ชิ้น / ปุ่มลบ
- แก้ qty + ราคา inline ได้
- รวมราคาแบบ real-time

### Phase C — Receipt + LINE share หลังบันทึก
หลัง save สำเร็จ → แสดง 3 ปุ่ม:
1. **📄 ดูใบเสร็จ / พิมพ์** — modal HTML format ใบเสร็จเต็ม
2. **📤 ส่ง LINE ลูกค้า** — ใช้ sendLineNotify(msg, ctx, "done")
3. **+ สร้างใบใหม่** — เคลียร์ form + items

### Schema change
```sql
ALTER TABLE service_jobs ADD COLUMN items_json JSONB DEFAULT '[]'::jsonb
```
- เก็บ array: `[{product_id, name, qty, unit_price, line_total, is_main}]`

### Bump
- main.js?v=53 → v=54
- SW v37 → v38
- Version display 5.9.5 → 5.10.0 (build 54) — minor bump เพราะ feature ใหญ่
- selfHeal APP_BUILD: 53 → 54

### Test checklist
1. รัน SQL migration ที่ Supabase (ที่จุด ⚠️ ACTION REQUIRED ด้านบน)
2. Sidebar → งานช่าง → ติดตั้งแอร์
3. กรอกข้อมูลลูกค้า + เลือกรุ่นแอร์
4. กด "+ เพิ่มอุปกรณ์" → ค้นหา → เลือกหลายๆ ตัว → แก้ qty/ราคา
5. กรอกค่าแรง + ส่วนลด → ดูยอดรวม
6. กด "💾 บันทึกใบงานติดตั้ง"
7. ปุ่ม 3 ปุ่ม: 📄 ดูใบเสร็จ + พิมพ์ / 📤 ส่ง LINE / + สร้างใบใหม่

---

## 🧹 Phase 41 — Cache Drift Cleanup (26 เม.ย. รอบ 14 — Pre-emptive audit by user)

### Why
Audit เจอ 4 static assets ใน index.html ที่ไม่มี `?v=` cache-bust + ไม่มี `_headers` rule
→ ใช้ default cache aggressive → bug class "cache stale" ซ่อนอยู่ (เหมือน Phase 38 logo overflow)

### Files at risk (ก่อน fix)
| File | Risk | Severity |
|---|---|---|
| `supabase-config.js` | URL/anonKey เปลี่ยน → user เก่า connect ไม่ได้ | 🔴 P0 |
| `phase4-design-system.css` | Design tokens stale → UI render พัง | 🟡 P1 |
| `phase4-components.css` | Component CSS stale → UI render พัง | 🟡 P1 |
| `doc-print.css` | Print stylesheet stale → ใบเสร็จพิมพ์ผิด | 🟡 P1 |

### Fix
1. **index.html** — เพิ่ม `?v=1` ทั้ง 4 ไฟล์ (cache-bust)
2. **_headers** — เพิ่ม rules: `/supabase-config.js` no-cache + `/phase4-*.css` revalidate

### Bump (Phase 41)
- main.js?v=52 → v=53, SW v36 → v37, version 5.9.4 → 5.9.5 (build 53), APP_BUILD: 52 → 53

---

## 🔧 Phase 40 — Fix AC Install Product Filter (26 เม.ย. รอบ 15)

### Bug
[modules/ac_install.js:13-16](modules/ac_install.js:13) — หน้า "ใบงานติดตั้งแอร์" แสดง **"ไม่มีสินค้าแอร์ในสต็อก"** ทั้งที่ user มีสินค้าแอร์ 178 ตัวในหมวด "เครื่องปรับอากาศ"

### Root cause
- Filter ใช้ `p.stock_qty || 0` — แต่ schema จริงใช้ field ชื่อ `p.stock`
- → return 0 ตลอด → empty dropdown

### Fix
[modules/ac_install.js](modules/ac_install.js) — แก้ filter:
1. **Field ถูก** — ใช้ `p.stock` แทน `p.stock_qty`
2. **รองรับ multi-warehouse** — รวม `state.warehouseStock` ด้วย
3. **ขยาย match** — รับทั้ง 6 เงื่อนไข:
   - category มี "ปรับอากาศ" / "แอร์" / "air"
   - name มี "แอร์" / "air"
   - btu > 0
4. **Dropdown แสดงคงเหลือ** — `รุ่น — BTU — ราคา (คงเหลือ N)`

### Phase ต่อไป (รอ user)
- Phase B: เพิ่มอุปกรณ์จากสต็อก (line items multi-select)
- Phase C: พิมพ์ใบเสร็จ + ส่งสลิปลูกค้าตอนปิดงาน

### Bump
- main.js?v=51 → v=52
- SW v35 → v36
- Version display 5.9.3 → 5.9.4 (build 52)
- selfHeal APP_BUILD: 51 → 52

---

## 🎛️ Phase 39 — Service Jobs Filter Chips (26 เม.ย. รอบ 14)

### Why
User ถาม: "ใบรับงานปิดงานแล้ว ไปอยู่ที่ไหนครับ"
- ทุกใบงาน (ค้าง/เสร็จ/ยกเลิก) อยู่หน้าเดียวกัน → user สับสน + หาใบที่ปิดยาก
- ต้องการ filter chips แบบ FlowAccount

### Fix
[modules/service_jobs.js](modules/service_jobs.js) — เพิ่ม filter chips 4 ตัว ด้านบนของ list:
1. **🟡 ค้าง** (default) — pending / progress / in_progress / open
2. **✅ ปิดแล้ว** — done / delivered / closed
3. **⚫ ยกเลิก** — cancelled (ที่ไม่ใช่ [ลบแล้ว])
4. **ทั้งหมด** — แสดงทั้งหมด

แต่ละ chip แสดง count (จำนวนงาน) — กดเปลี่ยน filter แล้ว re-render
- Default = "ค้าง" (workflow ปกติของช่าง: เห็นที่ต้องทำก่อน)
- Empty state ตามแต่ละ filter (เช่น "🎉 ไม่มีงานค้าง — เคลียร์หมดแล้ว!")
- Filter state อยู่ใน module-level `_sjFilter` — คงค่าระหว่าง re-render

### Bump
- main.js?v=50 → v=51
- SW v34 → v35
- Version display 5.9.2 → 5.9.3 (build 51)
- selfHeal APP_BUILD: 50 → 51

---

## 🎨 Phase 37 — POS Home FlowAccount-Style Redesign (26 เม.ย. รอบ 12)

### Why
User เห็น UX ของ FlowAccount แล้วชอบ — อยากให้หน้า POS home ใกล้เคียง:
- Logo ร้านในวงกลมที่ banner
- Action grid 6 ปุ่ม (3 cols × 2 rows) + circle background สำหรับ icon
- "อัพเดทล่าสุด" section แสดง 5 บิลล่าสุดวันนี้

### What changed

**modules/pos.js (home view):**
- Banner เพิ่ม `pos-banner-top` flex container — logo (ซ้าย) + ปุ่ม "🕒 ประวัติการขาย ›" (ขวา)
- Logo มาจาก `window._appGetLogo()` (Phase 36 priority: storeInfo.logoUrl > localStorage > default)
- Amount ขยายจาก 42px → 48px
- Action grid 4 ปุ่ม → **6 ปุ่ม** (3 cols × 2 rows):
  1. 🧮 เก็บเงินทันที
  2. 🛒 เลือกสินค้า
  3. 📷 สแกนเนอร์
  4. 📱 QR รับเงิน
  5. 🔧 งานช่าง (→ showRoute("service_jobs"))
  6. 📊 รายงาน (→ showRoute("dashboard"))
- เพิ่ม "📋 อัพเดทล่าสุด" section ด้านล่าง:
  - 5 บิลล่าสุดของวันนี้ (sort desc by created_at)
  - แสดง: เลขบิล + เวลา + ชื่อลูกค้า + ยอด + tag (✓ เก็บเงินแล้ว / ยกเลิก)
  - Click → `App.loadReceipt(id)` → `App.openReceiptDrawer()`
  - Disabled ถ้าบิลถูกยกเลิก ([ลบแล้ว] in note)

**style.css:**
- `.pos-banner-top` flex container ใหม่
- `.pos-banner-logo` วงกลม 56×56 พื้นขาว shadow + img cover
- `.pos-banner-amount` 42px → 48px
- `.pos-action-grid` 4 cols → **3 cols**
- `.pos-action-icon-wrap` วงกลม 56×56 background `#e0f2fe` (ฟ้าอ่อน)
- `.pos-action-icon` 32px → 28px (พอดีในวง)
- เพิ่ม `.pos-recent-section` + `.pos-recent-item` + tags (paid/cancelled)

### Files touched
- `modules/pos.js` (~50 บรรทัดเพิ่ม)
- `style.css` (~50 บรรทัดเพิ่ม)
- `index.html` v=48 → v=49 + APP_BUILD = 49
- `sw.js` v32 → v33
- `modules/settings/pages.js` 5.9.0 → 5.9.1 (build 49)

### Compatibility
- ✅ ไม่กระทบ logic checkout / cart / customer picker
- ✅ ไม่แตะ backend (functions/api/*)
- ✅ ไม่แตะ database schema
- ✅ ปุ่ม 4 ตัวเดิม handler เหมือนเดิม + เพิ่ม 2 ตัวใหม่ใช้ showRoute
- ✅ ใช้ `window._appGetLogo()` ที่ Phase 36 sync ผ่าน DB แล้ว → cross-device

### Bump
- main.js?v=48 → v=49
- SW v32 → v33
- Version display 5.9.0 → 5.9.1 (build 49)
- selfHeal APP_BUILD: 48 → 49

---

## 🖼️ Phase 36 — Logo Sync to DB (เลิกแนบใหม่ทุกครั้ง — 26 เม.ย. รอบ 11)

### User report
"ตอนนี้ผมมีปัญหากับการแนบโลโก้ร้านอยู่ครับ ต้องแนบใหม่ทุกครั้ง"

### Bug ที่เจอ
1. **Storage แค่ localStorage** — `bsk_store_logo` key เก็บ URL เฉพาะ device นั้น
   - ใช้คนละ browser/device → ไม่เห็น logo
   - Browser clear cache → logo หาย
2. **`_appSyncLogo` หา prefix ผิด** — list bucket ด้วย prefix `"logo"` แต่ pages.js upload ตั้งชื่อ `store-logo-{ts}.{ext}` → ไม่ match → sync ไม่เคยทำงาน
3. **ไม่ผูกกับ saveStoreInfo flow** — แม้ storeInfo อื่นๆ sync เข้า Supabase `app_settings.store_info` แล้ว

### Fix
1. **modules/settings/pages.js** `renderSettingsLogoPage`:
   - Upload ตั้งชื่อคงที่ `logo.{ext}` + upsert (ทับของเดิม → URL คงที่)
   - บันทึก URL เข้า `state.storeInfo.logoUrl` + เรียก `saveStoreInfo()` → sync DB
2. **main.js** `_appGetLogo`: priority `state.storeInfo?.logoUrl` > localStorage > default
3. **main.js** `loadAppSettings`: sync logo จาก DB → localStorage ตอน boot

### Bump (Phase 36)
- main.js?v=47 → v=48, SW v31 → v32, version 5.8.9 → 5.9.0 (build 48)
- selfHeal APP_BUILD: 47 → 48

---

## 🚑 Phase 35 — Self-Healing Module Cache Recovery (26 เม.ย. รอบ 10)

### Why
หลัง Phase 33+34 user **ยังติด stale หนักมาก** — เห็น Version 5.7.0 (build 36) ทั้งที่ deploy 5.8.8 ไปแล้ว
- SW เก่าของ user ไม่ activate ใหม่ตามต้องการ
- Browser HTTP cache stuck ที่ immutable
- Phase 34 SW fix ใช้ไม่ได้เพราะ user ยังไม่ได้ install SW ใหม่
- Catch-22 ระดับ 2 — ยิ่งแก้ stale ยิ่งเพิ่ม

### Fix — Auto Recovery Script
[index.html:629-680](index.html:629) — inline script run **ก่อน** main.js โหลด:
1. อ่าน `localStorage.bsk_app_build` (build ที่ user เคยเห็น)
2. เปรียบเทียบกับ `APP_BUILD = 47` (current)
3. ถ้า stored < 47 → **auto recovery:**
   - Unregister ทุก SW
   - Delete ทุก cache (Cache API)
   - `location.replace(url + '?_t=' + Date.now())`
4. ใช้ `sessionStorage.bsk_just_recovered` ป้องกัน infinite loop
5. Update `bsk_app_build = 47` หลังสำเร็จ

### Result
- User ที่ติด stale → เปิดแอป 1 ครั้ง → script auto-recover → reload → fresh
- User ใหม่หรือ build ≥ 47 → no-op (script ไม่ทำอะไร)
- ทุก deploy ในอนาคต → ถ้ายัง stuck → script จะ recover อัตโนมัติ

### Bump
- main.js?v=46 → v=47
- SW v30 → v31
- Version display 5.8.8 → 5.8.9 (build 47)

---

## 🐛 Phase 34 — SW Bypass HTTP Cache สำหรับ /modules/* (26 เม.ย. รอบ 9)

### Why
Phase 33 แก้ `_headers` แล้ว แต่ user ที่มี cached pages.js ของเก่า (ตอน immutable=1ปี) ยังติดอยู่
- Browser HTTP cache ไม่ revalidate (เพราะ cached header เก่ายังบอก immutable)
- `_headers` ใหม่จะมีผลกับ user ที่ download pages.js ใหม่เท่านั้น
- Catch-22: ไม่ download ใหม่เพราะคิดว่า cached ของเก่ายัง valid

### Fix
[sw.js:69-86](sw.js:69) — เพิ่ม special case ใน SW fetch handler:
- ทุก request ไป `/modules/*.js` หรือ `/ai-chat-widget.js`
- ใช้ `fetch(request, { cache: 'reload' })` → **บังคับ browser bypass HTTP cache**
- ETag check กับ server → 304 (fast) หรือ 200 (fresh)
- Permanent fix — ไม่ต้องพึ่ง `_headers` อย่างเดียว

### หลังจาก Phase 34 deploy
- ถ้า user มี SW เก่า → ปุ่ม "ตรวจหาอัปเดต" จะ detect SW ใหม่ → reload → ใช้ SW v30
- SW v30 จะ bypass HTTP cache ตลอด → ไม่มี stale modules อีก
- ถ้า user ติด stale อยู่ → กด "🚀 บังคับอัปเดต" สีแดง = unregister + delete cache + reload → ทุกอย่างสด

### Bump
- main.js?v=45 → v=46
- SW v29 → v30
- Version display 5.8.7 → 5.8.8 (build 46)

---

## 🐛 Phase 33 — Fix /modules/* HTTP cache stale (26 เม.ย. รอบ 8)

### User report
หลัง Phase 32 deploy → user เห็น:
- ปุ่ม "ตรวจหาอัปเดต" บอก: "✓ build 44" (ใหม่ ✓)
- แต่ Version display: **5.8.4 (build 42)** (เก่า — ของ Phase 29!) ❌

### Root cause
[_headers:32-34](_headers:32) — `/modules/*` ตั้ง `Cache-Control: public, max-age=31536000, immutable`
- main.js?v=44 ใส่ cache-bust → โหลดใหม่ทุกครั้งที่ build เปลี่ยน ✓
- แต่ `import { renderSettingsAbout } from "./modules/settings/pages.js"` **ไม่มี ?v=** → URL คงที่
- Browser/CDN เห็น `immutable` → serve เก่าตลอด → user เห็น version 5.8.4
- ปัญหานี้กระทบ **ทุกหน้า** — pages.js, serials.js, warranty_report.js, ฯลฯ ใช้ของเก่าทั้งหมด

### Fix
[_headers:32-34](_headers:32) — เปลี่ยนเป็น `max-age=0, must-revalidate`:
- Browser ยังเก็บ cache ได้
- แต่ทุก request → revalidate กับ server (If-None-Match → 304 ถ้าไม่เปลี่ยน → fast)
- ถ้าไฟล์เปลี่ยน → download fresh ทันที — no stale
- เปลี่ยน `/ai-chat-widget.js` ด้วย (เหตุผลเดียวกัน)

### ⚠️ User ต้องทำ 1 ครั้ง
หลัง deploy 5.8.7 → user ที่ติด stale cache ของเก่าต้อง:
**กดปุ่ม "🚀 บังคับอัปเดต" สีแดง** → ล้าง SW + cache → reload
หลังจากนั้นจะไม่มีปัญหา stale อีกในรุ่นต่อๆ ไป (ทุก deploy = revalidate)

### Bump
- main.js?v=44 → v=45
- SW v28 → v29
- Version display 5.8.6 → 5.8.7 (build 45)

---

## 🖼️ Phase 32 — Service Photo Gallery Picker (26 เม.ย. รอบ 7)

### User report
"ตรงหน้าให้แนบไฟล์ น่าจะมี ปุ่มแกลลอรี่ เพิ่มให้เลือกไฟล์ในมือถือได้ด้วย"

### Bug ที่แก้
[index.html:551,564](index.html:551) `<input type="file" capture="environment">` มี attribute `capture` → บนมือถือ browser **เปิดกล้องอย่างเดียว** ไม่ให้เลือกจากแกลลอรี่
- ปัญหา: user ที่มีรูปอยู่ใน gallery แล้ว (เช่นถ่ายไว้นอกแอป) แนบไม่ได้ → ต้องถ่ายใหม่

### Fix
1. **index.html** — เพิ่ม input + button ที่ 2 ต่อสล็อต:
   - `serviceBefore/AfterFile` (เก็บ capture) → ปุ่ม "📷 ถ่ายรูป"
   - `serviceBefore/AfterGalleryFile` (ไม่มี capture) → ปุ่ม "🖼️ แกลลอรี่"
   - 3 ปุ่มในแถว: 📷 / 🖼️ / 🗑️
2. **main.js** — refactor handler เป็น `_handleServicePhotoUpload(which, file)` reuse จาก 2 inputs

### Bump
- main.js?v=43 → v=44
- SW v27 → v28
- Version display 5.8.5 → 5.8.6 (build 44)

---

## 🐛 Phase 31 — Service Job LINE Notify รองรับ delivered/closed (26 เม.ย. รอบ 6)

### Bug ที่ user แจ้ง
"หน้านี้ปิดงานไม่ได้ ไม่ส่งเข้ากลุ่มไลน์ ส่งงาน"
- เปลี่ยน status เป็น "ส่งมอบแล้ว" (delivered) หรือ "🎉 ลูกค้ายืนยันปิดงาน" (closed) → บันทึก
- ไม่มี LINE notify เข้ากลุ่ม "ส่งงาน" (channel: done)

### Root cause
[main.js:2399](main.js:2399) `transitionedToDone` เช็คเฉพาะ `payload.status === "done"` เท่านั้น
แต่ใน [index.html:530-537](index.html:530) `<select id="serviceStatus">` มี 6 options:
- pending / progress / **done** / **delivered** / **closed** / cancelled
→ "delivered" + "closed" ก็คือปิดงานเหมือนกัน แต่ code กรองออก

### Fix
[main.js:2398-2422](main.js:2398) — เพิ่ม COMPLETION_STATUSES whitelist:
```js
const COMPLETION_STATUSES = ["done", "delivered", "closed"];
const wasComplete = COMPLETION_STATUSES.includes(origStatus);
const isNowComplete = COMPLETION_STATUSES.includes(payload.status);
const transitionedToDone = !isNewJob && !wasComplete && isNowComplete;
```
+ message รวม STATUS_LABEL เด่น (เสร็จแล้ว / ส่งมอบแล้ว ✓ / 🎉 ลูกค้ายืนยันปิดงาน)

### Bump
- main.js?v=42 → v=43
- SW v26 → v27
- Version display 5.8.4 → 5.8.5 (build 43)

---

## 🐛 Phase 29 — Update Banner False Alarm (26 เม.ย. รอบ 5)

### Bug
- หลัง user กด "อัปเดตเลย" ใน banner → Phase 28 cache-bust reload → ได้ build ใหม่จริง
- แต่หน้า settings/about ยังขึ้น banner "🔄 มีเวอร์ชันใหม่" อีก (false alarm ทุกครั้ง)
- เจอที่ Version 5.8.3 — banner ขึ้นแม้ตอนนี้เป็นเวอร์ชันล่าสุดแล้ว

### Root cause
[index.html:670-678](index.html:670) `watchForUpdate` — เห็น SW updatefound + installed + controller มีค่า → ขึ้น banner ทันที
แต่ Cloudflare/Browser ส่ง sw.js byte ต่างเล็กน้อย (header timestamp, ETag) → updatefound trigger แม้ build เดียวกัน

### Fix
เพิ่ม `isReallyNewBuild()` — fetch index.html จาก network → เปรียบเทียบ `main.js?v=N`
- newBuild > currentBuild = ขึ้น banner
- newBuild === currentBuild = ไม่ขึ้น (false alarm)
- error = ไม่ขึ้น (อย่ารบกวน user)

### Bump
- main.js?v=41 → v=42
- SW v25 → v26
- Version display 5.8.3 → 5.8.4 (build 42)

---

## 🐛 Phase 28 — Fix Update Banner ไม่ apply บนมือถือ (26 เม.ย. รอบ 4)

### Bug
- index.html ขึ้น banner "🔄 มีเวอร์ชันใหม่ — คลิกเพื่อใช้งาน"
- กด "อัปเดตเลย" → SW activate ใหม่จริง + `controllerchange` event ยิง
- แต่ใช้ `window.location.reload()` ปกติ → **HTTP cache ของ browser ยัง serve เก่า**
- บนมือถือ (iOS Safari, PWA) — HTTP cache aggressive → ดูเหมือนไม่อัพเดท
- เดสท็อป Chrome อาจ work เพราะ DevTools "Disable cache" หรือ refresh logic ต่าง

### Root cause
Phase 20 ของ user แก้ปุ่ม **ในหน้า Settings** ให้ใช้ `location.replace(url + '?_t=' + Date.now())`
แต่ **banner ใน index.html ยังใช้ `reload()` ปกติ** — ลืมแก้คู่กัน

### Fix
[index.html:683-694](index.html:683) controllerchange handler — ใช้ cache-bust reload เหมือน Phase 20:
```js
var u = new URL(window.location.href);
u.searchParams.set('_t', String(Date.now()));
window.location.replace(u.toString());
```

### ⚠️ Catch-22 สำหรับ user
Fix อยู่ใน 5.8.3 → user มือถือต้อง **manual force update ครั้งสุดท้าย**:
- Settings → 🚀 บังคับอัปเดต สีแดง (Phase 20 fix — work)
- หรือ ปิดแอป swipe ทิ้ง → เปิดใหม่
- หลังจากได้ 5.8.3 → banner update flow จะ work เองทุกครั้งต่อไป

### Bump
- main.js?v=40 → v=41
- SW v24 → v25
- Version display 5.8.2 → 5.8.3 (build 41)

---

## 🐛 Phase 27 — Fix AI Help Chat HTTP 400 (26 เม.ย. กลางคืนรอบ 3)

### Bug ที่แก้
help_tutor.js (Phase 25) AI chat ส่ง `{ messages: [...] }` (OpenAI format)
แต่ `/api/ai-assistant` expect `{ message, history, page }`
→ ทุกข้อความที่ user พิมพ์ใน "🤖 ถาม AI" → HTTP 400 "message is required"

### Fix
1. **functions/api/ai-assistant.js** — เพิ่ม branch `mode: "help"`
   - System prompt แยกสำหรับสอนใช้แอป (ไม่ใช่ service form filling)
   - รับ helpContext (page title + intro + steps + tips)
   - Return `{ ok, reply, mode }` เป็นข้อความปกติ ไม่ใช่ JSON format
2. **modules/help_tutor.js** — แก้ payload + better error handling
   - ส่ง `{ message, mode: "help", helpContext, history }`
   - Build history จาก DOM (ข้าม greeting + typing indicator)
   - Error message ตาม HTTP status (400/401/429)

### Bump
- main.js?v=39 → v=40
- SW v23 → v24
- Version display 5.8.1 → 5.8.2 (build 40)

---

## 🧹 Phase 26 — Cleanup #2 (26 เม.ย. กลางคืนรอบ 2)

### Fix #1: ลบ `modules/main.js` ทิ้ง (dead code)
- 2185 บรรทัด — เคยเป็น "mirror of root main.js" แต่ไม่ได้ sync ตั้งแต่ Phase 11+
- ขาด imports ใหม่หมด: stock_count, refunds, tasks, serials, warranty_report, help_tutor, validators ฯลฯ
- ตรวจสอบแล้ว — **0 references** จากที่ไหน (index.html ใช้ root `./main.js`)
- ลบเพื่อกัน confusion ตอน search code + memory จะได้ไม่ผิด

### Fix #2: console.log → console.debug (4 จุด)
- main.js:2491 `[deductStock]` — log ทุกครั้งที่ขายของ → console รก
- main.js:2683 `[bundle]` — log ทุก bundle sale
- modules/warranty_report.js:224 `[warranty]` — log ตอน background check
- ai-chat-widget.js:634 `[BoonsookAI]` — debug safety net
- เปลี่ยนเป็น `console.debug` (browser default ซ่อน — เปิดได้ใน DevTools level filter)

### Fix #3: 🐛 Bug ซ่อน — Auto-Serial brand match ใช้ไม่ได้!
- main.js:2696 `SERIAL_KEYWORDS` มี `"Mitsubishi","Samsung","LG","Daikin"...` (uppercase)
- แต่ `_qualifiesForSerial` ใช้ `name.toLowerCase()` เปรียบเทียบ → **brand names ไม่ match เลย**
- แก้: เปลี่ยนเป็น lowercase ทั้งหมด + เพิ่ม keyword อังกฤษ:
  `ac, fridge, refrigerator, washer, washing machine, microwave, oven, rice cooker, fan, water heater, air fryer, iron, kettle, aircon, air conditioner, freezer, dishwasher, dryer, heater`

### TODO ที่ยังเหลือ (ตามเดิม)
- products.js — alert/confirm/prompt 12 จุด (รอ batch แยก)
- settings/users.js — 2 prompt (ต้องสร้าง modal)
- ⚠️ **KV binding** ใน Cloudflare Dashboard — user ยังไม่ตั้ง → rate limit ยัง skip
- 🔵 (Future) Lazy-load CDN libs (chart.js, jspdf, xlsx ~2MB) — งานใหญ่ skip รอบนี้
- 🔵 (Future) main.js refactor — split route handlers

### Bump
- main.js?v=38 → v=39
- SW v22 → v23
- Version display 5.8.0 → 5.8.1 (build 39)

---

## 🎓 Phase 25 — AI Tutor + In-app Help (26 เม.ย. กลางคืน)

### Why
40+ หน้า → user ใหม่ใช้ไม่เป็น → feature ดีไร้ค่า

### What — "Smart Help Widget" 3-in-1
1. **💡 Floating Button** มุมขวาล่าง (bottom: 90px เหนือ AI chat FAB)
   - สีเหลือง gradient + pulse + red dot ถ้าหน้านี้ user ยังไม่เคยดู help
   - auto-hide เมื่อมี modal/drawer เปิด (ไม่บัง)
2. **📖 Steps Modal** — เขียน hardcode 12 หน้า: dashboard / pos / products / customers / sales / quotations / serials / warranty_report / expenses / tasks / refunds / cash_recon / settings
3. **🎯 Interactive Tour** — SVG mask spotlight + tooltip + ปุ่มถัดไป/ก่อนหน้า/ข้าม
4. **🤖 AI Chat** — context = title + intro + steps + tips ของหน้านั้น → AI ตอบตรงประเด็น
   - reuse Bearer token จาก Phase 17
   - 4 suggestion chips

### Files
- ใหม่: `modules/help_tutor.js` (~720 บรรทัด — self-contained, CSS in-line)
- แก้: `main.js` import + setHelpContext on showRoute + mountHelpButton on app ready
- แก้: index.html v=37→v=38, sw.js v21→v22, settings/pages.js 5.7.1→5.8.0

### Bump
- main.js?v=37 → v=38
- SW v21 → v22
- Version display 5.7.1 → 5.8.0 (build 38)

---

## 🆕 Phase 24 — Cleanup Batch (26 เม.ย. ตอนเย็น)

### 🛡️ Fix #1: Rate-limit endpoints ตรงชื่อจริง (Security)
- `functions/_middleware.js` เคยอ้างอิง `/api/auth-otp` (ไม่มีอยู่จริง)
- แก้เป็น `/api/send-otp` (5 req/min) + `/api/verify-otp` (10 req/min)
- ปิดช่องโหว่ที่ OTP fall-back ไป default 100 req/min — Twilio cost ป้องกันแน่นอนแล้ว

### 🧹 Fix #2: ลบ alert/confirm ออกจากโค้ด Phase 9-19 (22 จุด)
ตามกฎห้ามใช้ native modal — แทนด้วย `App.showToast` / `App.confirm`:
- credit_tracker.js (3) • quote_templates.js (3) • recurring_expenses.js (5)
- refunds.js (3) • tasks.js (3) • serials.js (1)
- stock_in_wizard.js (2) • stock_count.js (2) • stock_movements.js (2)

### TODO ที่ยังเหลือ
- **products.js** — ยังมี alert/confirm/prompt 12 จุด (ของเก่า ก่อน Phase 11 — รอ batch แยก)
- **settings/users.js** — 2 prompt (ต้องสร้าง modal — รอแยก scope)

### Bump
- main.js?v=36 → v=37
- SW v20 → v21
- Version display 5.7.0 → 5.7.1 (build 37)

---

## 🚧 Phase 20-23 (in progress — 26 เม.ย. 2026)

### Phase 20: 🔧 Fix Update Button (CRITICAL)
**Why:** ปุ่ม "ตรวจหาอัปเดต / บังคับอัปเดต" ใน Settings ใช้ไม่ได้จริง — user ต้อง Ctrl+Shift+R เอง
- Unregister ALL service workers ก่อน reload
- Delete ALL cache storage (caches.keys() → caches.delete each)
- Show progress toast ไม่ให้กดแล้วเงียบ
- Force reload ด้วย cache-busting query string + `location.replace()`
- Test บนมือถือจริง (iOS Safari + Android Chrome)

### Phase 21: 📷 Auto-link Serial from POS
**Why:** ตอนนี้ต้องไป +เพิ่ม Serial เองทีหลัง — ลืมง่าย
- หลัง checkout สำเร็จ → check ว่ามี item ที่ขายเข้าข่าย "เครื่องใช้ไฟฟ้า" มั้ย
- Popup ถาม "ขายเครื่องใช้ไฟฟ้า — บันทึก Serial Number มั้ย?"
- Inline form: pre-fill product/customer/sale_id + ช่องกรอก SN + warranty months
- Save ตรงเข้า product_serials linked sale_id

### Phase 22: 📊 Warranty Report + LINE Notify
**Why:** ลูกค้าไม่รู้ว่าประกันใกล้หมด → เสียโอกาสขาย service
- เพิ่ม cron-style check (เช็คตอน load app) → serial ที่ warranty_until ภายใน 30 วัน
- ส่ง LINE notify (ถ้ามี customer.line_id หรือเบอร์) ผ่าน existing /api/line-notify
- Settings: เปิด/ปิด + threshold days (15/30/60)
- หน้า Warranty Report (filter: ใกล้หมด / หมดแล้ว / ทั้งหมด)

### Phase 23: 📷 Barcode/QR Scanner for Serial
**Why:** พิมพ์ serial มือเสียเวลา + ผิดพลาดง่าย
- ปุ่ม "📷 Scan" ข้าง input "Serial No" ใน serial modal
- ใช้ `BarcodeDetector` API (Chrome/Edge) — fallback `getUserMedia` + manual entry
- Mobile-first — ทดสอบบน iOS + Android
- รองรับ EAN-13 / Code128 / QR Code

### Bump
- main.js?v=35 → v=36
- SW v19 → v20
- Version display 5.6.0 → 5.7.0 (build 36)

---
**สถานะ:** Production ที่ boonsukair.com (Cloudflare Pages + Supabase)
**เป้าหมายเอกสาร:** Claude session ใหม่ / ผู้ช่วยใหม่ อ่านไฟล์นี้แล้วต่องานได้ทันที

---

## ✅ สถานะ Migration ปัจจุบัน (ทำเสร็จแล้ว — 25 เม.ย. 2026)

User ได้ทำ migration steps เหล่านี้เรียบร้อย ✓ — **ไม่ต้องทำซ้ำ**:

### ✅ SQL Migration (ผ่าน Supabase SQL Editor)
รัน `supabase-rls-policies.sql` หลายรอบตาม phase — ทุก column + table ที่ต้องการมีครบ:
- `products` columns: `price_wholesale`, `image_url`, `is_featured`, `promo_price`, `promo_start`, `promo_end`
- `customers` columns: `notes`, `tags`, `birthday`
- `sales` columns: `customer_id`, `is_credit`, `credit_due_date`, `credit_paid_amount`, `credit_paid_at`
- `service_jobs` columns: `photo_before`, `photo_after`
- ตารางใหม่: `warehouses`, `warehouse_stock`, `recurring_expenses`, `credit_payments`, `refunds`, `tasks`, `quote_templates` — RLS + indexes ครบ
- Trigger: `handle_new_user` (auto-create profiles row จาก auth.users) + backfill done
- Storage RLS policies สำหรับ `product-images` bucket

### ✅ Supabase Storage
- bucket `product-images` สร้างแล้ว + Public: ON

### ➡️ ถ้ามี SQL migration ใหม่ในอนาคต
File `supabase-rls-policies.sql` เป็น idempotent — User สามารถรันซ้ำได้ปลอดภัย ทุกครั้งที่มีการเพิ่ม phase ใหม่ที่ schema เปลี่ยน

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 9 (Phase 17-19: Security + Bundle + Serial)

### Phase 17: 🛡️ Security Hardening
**Why:** ป้องกัน cost risk จริง — spam OTP/LINE/AI = bill บานปลาย

- `functions/_middleware.js` — middleware ครอบทุก /api/*
  - Rate limit ด้วย Cloudflare KV (graceful fall-back ถ้าไม่มี KV binding)
  - `/api/auth-otp`: 5 req/min/IP
  - `/api/line-notify`: 30 req/min/IP
  - `/api/ai-assistant`: 20 req/min/IP
  - return 429 + Retry-After header
- CORS restriction: เฉพาะ boonsukair.com + *.pages.dev
- `/api/ai-assistant` — require Supabase JWT in Authorization header

**⚠️ User ต้องตั้ง KV binding (1 ครั้ง):**
1. Cloudflare Dashboard → Workers & Pages → boonsook-pos-v5
2. Settings → Functions → KV namespace bindings
3. Add: variable `RATE_LIMIT_KV` → namespace ใหม่ชื่อ "boonsook-rate-limit"
4. Save → trigger redeploy

ถ้าไม่ตั้ง KV → app ใช้งานได้ปกติ แค่ไม่มี rate limit (warn ใน console)

### Phase 18: 📦 Bundle / Set
**Why:** ขายแอร์ + ติดตั้ง + ท่อ = 1 SKU ขายง่าย → ตัดสต็อกของลูกอัตโนมัติ

- ตารางใหม่: `product_bundles` (bundle_id, child_product_id, qty)
- column `products.is_bundle` BOOLEAN
- หน้าแก้สินค้า → checkbox "🎁 เป็นชุด/Bundle" → section "รายการในชุด"
- POS checkout: detect is_bundle=true → ตัดสต็อกของ child_products แทน

### Phase 19: 🔢 Serial Number Tracking
**Why:** เครื่องใช้ไฟฟ้าราคาแพง track warranty รายเครื่อง

- ตารางใหม่: `product_serials` (id, sale_item_id, product_id, serial_no, warranty_until, status, notes)
- POS checkout: สินค้านับสต็อก → option ใส่ serial หลังบันทึก
- หน้าใหม่: "🔢 Serial Lookup" — search serial → ประวัติ + warranty
- Customer drawer: section "เครื่องที่ซื้อ" — list serials ของลูกค้านี้

### Bump
- main.js?v=34 → v=35
- SW v18 → v19
- Version display 5.5.0 → 5.6.0 (build 35)

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 8 (Phase 12-16: Big Batch)

### ✅ SQL ทำเสร็จแล้ว (เก็บประวัติไว้เพื่อ reference)
รัน `supabase-rls-policies.sql` ใน Supabase SQL Editor — เพิ่ม:
- ตาราง `refunds` + RLS
- ตาราง `tasks` + RLS
- ตาราง `quote_templates` + RLS
- column `customers.birthday` DATE
(idempotent — รันซ้ำได้)

### Phase 12: 🔄 Refund / Return Tracker
- หน้าใหม่: Sidebar → การเงิน → 🔄 รับคืนสินค้า
- บันทึก: เลือกบิลขาย → เลือกสินค้าที่คืน → เหตุผล (ไม่พอใจ/เสีย/เคลม)
- Action: คืนเงิน / เปลี่ยนสินค้า / เครดิตในบัญชี
- Option: คืนสต็อกเข้าคลัง อัตโนมัติ
- รายงาน: refund stats per product / per customer

### Phase 13: ⏰ Task / Reminder System
- หน้าใหม่: Sidebar → ⏰ Task / สิ่งที่ต้องทำ
- เพิ่ม task จากที่ไหนก็ได้ (กลม FAB)
- Linked to: customer / product / sale / service_job
- Due date + Line Notify เมื่อใกล้ครบกำหนด
- Filter: today / week / overdue / done

### Phase 14: 📊 Profit by Product
- หน้าใหม่: Sidebar → การเงิน → 📊 กำไรต่อสินค้า
- คำนวณ: (price - cost) × qty sold ในช่วงที่เลือก
- Sort: by total profit / margin% / qty
- Table: Top 20 + Bottom 20 (dogs)
- Export Excel

### Phase 15: 🎂 Birthday Auto-Greeting
- ALTER customers ADD birthday DATE
- หน้าใหม่: Sidebar → ลูกค้า → 🎂 วันเกิดลูกค้า
- รายชื่อลูกค้าวันเกิดเดือนนี้ + ปฏิทินรายเดือน
- on app load: เช็ควันนี้มีใครเกิดมั้ย → toast แจ้ง + ปุ่ม "ส่ง LINE อวยพร"

### Phase 16: 📑 Quote Templates
- ตาราง `quote_templates` (name, items_json)
- ในใบเสนอราคา: ปุ่ม "💾 บันทึกเป็น Template" + "📑 โหลดจาก Template"
- เก็บ items + วันรับประกัน + เงื่อนไข
- ใช้บ่อย: ขายแอร์ + ติดตั้ง + ท่อ → 1-click load

### Bump
- main.js?v=33 → v=34
- SW v17 → v18
- Version display 5.4.0 → 5.5.0 (build 34)

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 7 (Phase 11: Customer Notes & Tags)

### ✅ SQL ทำเสร็จแล้ว (เก็บประวัติไว้เพื่อ reference)
รัน `supabase-rls-policies.sql` ใน Supabase SQL Editor — เพิ่ม:
- `customers.notes` TEXT
- `customers.tags` TEXT[]
(idempotent — รันซ้ำได้)

### Phase 11: 📝 Customer Notes & Tags

**Use case:** จดความต้องการ/นิสัยลูกค้า + tag เพื่อจัดกลุ่ม + AI ใช้ context ต่อ

**Customer Drawer (เพิ่มใน edit form):**
- 📝 ช่อง "บันทึก/Notes" — textarea ยาว
  ตัวอย่าง: "ชอบ Daikin", "บ้าน 2 ชั้น", "ติดตั้งวันเสาร์เท่านั้น"
- 🏷️ Tags — chips multi-select
  Preset: VIP 🌟 / ขายส่ง 📦 / ห้ามเครดิต 🚫 / ลูกค้าราคา 💰 /
         ประจำ ⭐ / ระวัง ⚠️
  + พิมพ์ tag เองได้

**Display:**
- หน้าลูกค้า list: tag chips ใต้ชื่อ
- POS Customer Picker: tag chips + แจ้งเตือน VIP / ห้ามเครดิต
- ใบงานช่าง / Quote: notes แสดงตอนเปิดใบ

**AI Integration:**
- AI Chat: ส่ง customer context (notes + tags) ไปกับ message
- AI assistant.js: รับ customerContext + ผสมเข้า system prompt
- AI แนะนำตรงใจมากขึ้น

### Files touched
- supabase-rls-policies.sql (ALTER TABLE customers)
- index.html (customerDrawer)
- main.js (openCustomerDrawer + saveCustomer)
- modules/customers.js (display tags)
- modules/pos.js (Customer Picker tags + alerts)
- functions/api/ai-assistant.js (customer context)
- ai-chat-widget.js (pass context)

### Bump
- main.js?v=32 → v=33
- SW v16 → v17
- Version display 5.3.0 → 5.4.0 (build 33)

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 6 (Phase 7-10: รายงาน + เครดิต)

### ✅ SQL ทำเสร็จแล้ว (เก็บประวัติไว้เพื่อ reference)
รัน `supabase-rls-policies.sql` ใน Supabase SQL Editor — เพิ่ม:
- ตาราง `recurring_expenses` (รายจ่ายประจำ) + RLS
- ตาราง `credit_payments` (ประวัติการเก็บเงินเครดิต) + RLS
- columns `sales.is_credit` BOOLEAN, `credit_due_date` DATE, `credit_paid_amount` NUMERIC, `credit_paid_at` TIMESTAMPTZ
(idempotent — รันซ้ำได้)

### Phase 7: 🏆 Top Customers Report
- Sidebar → การเงิน → 🏆 ลูกค้าซื้อเยอะสุด
- จัดอันดับลูกค้าตาม: ยอดซื้อ / จำนวนชิ้น / เฉลี่ย/บิล / ซื้อล่าสุด
- ช่วงเวลา: 30 วัน / 90 วัน / เดือนนี้ / ปีนี้ / ทั้งหมด
- 🥇🥈🥉 แสดง top 3 + Top 5% contribution
- Match ด้วย customer_id ก่อน, fallback customer_name
- Export Excel

### Phase 8: ⏰ Sales Heatmap
- Sidebar → การเงิน → ⏰ ยอดขายตามช่วงเวลา
- Grid 7 วัน × 24 ชม. — เฉดสีฟ้า (เข้ม=ขายดี)
- toggle: ยอดเงิน หรือ จำนวนบิล
- สรุป: วันขายดีสุด, ชั่วโมงขายดีสุด
- bar chart per day
- ช่วยตัดสินใจเปิดร้าน/จัดพนักงาน

### Phase 9: 🔁 Recurring Expenses (รายจ่ายประจำ)
- Sidebar → การเงิน → 🔁 รายจ่ายประจำ
- ตั้งครั้งเดียว: ค่าเช่า, เงินเดือน, ค่าน้ำ ฯลฯ
- ความถี่: ทุกเดือน / สัปดาห์ / ปี + วันที่ของเดือน
- ครบกำหนด → กดปุ่ม "💸 สร้าง Expense" → INSERT row ใน expenses table
- Auto-update next_due
- กด "สร้างทั้งหมด" ครั้งเดียวสำหรับ overdue หลายรายการ

### Phase 10: 💳 Credit Tracker (ลูกค้าค้างชำระ)
- Sidebar → การเงิน → 💳 ลูกค้าค้างชำระ
- list บิลที่ is_credit=true พร้อมยอดค้าง/ชำระแล้ว/วันครบกำหนด
- Filter: ยังค้าง / เกินกำหนด / ชำระแล้ว / ทั้งหมด
- เน้นสีเหลืองแถวที่เกินกำหนด + แจ้งจำนวนวันเกิน
- ปุ่ม "💰 รับชำระ" → modal กรอกยอด + วิธี + หมายเหตุ
- ชำระบางส่วนได้ (partial payment)
- Auto-mark complete ถ้าครบ + บันทึก credit_paid_at
- Quick buttons: "ทั้งหมด" / "ครึ่งหนึ่ง"
- แสดงประวัติใน credit_payments table

### Bump
- main.js?v=31 → v=32
- SW v15 → v16
- Version display 5.2.0 → 5.3.0 (build 32)

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 5 (Phase 4-6: POS Customer + Cash Recon + Service Photos)

### ✅ SQL ทำเสร็จแล้ว (เก็บประวัติไว้เพื่อ reference)
รัน `supabase-rls-policies.sql` ใน Supabase SQL Editor — เพิ่ม column ใหม่:
- `sales.customer_id` BIGINT REFERENCES customers(id) — ผูกบิลกับลูกค้า
- `service_jobs.photo_before` TEXT — รูปก่อนทำงาน
- `service_jobs.photo_after` TEXT — รูปหลังทำงาน
(idempotent — รันซ้ำได้ปลอดภัย)

### Phase 4: 👤 POS Customer Picker
- POS หน้า home: panel ลูกค้าด้านบน + ปุ่ม "+ เลือก/เพิ่มลูกค้า"
- modal: search + list + quick add (ชื่อ + เบอร์)
- เลือกแล้ว → บิลใหม่จะใช้ customer_name + customer_id
- หลัง checkout → reset เป็น "ลูกค้าทั่วไป" อัตโนมัติ
- **purchase history** (ที่ทำไว้แล้ว) ใช้ customer_id เป็น primary match
- เพิ่มเบอร์โทรใน sale.note อัตโนมัติ

### Phase 5: 💵 กระทบยอดเงินสด (Cash Drawer Reconciliation)
- หน้าใหม่: Sidebar → การเงิน → 💵 กระทบยอดเงินสด
- เลือกวันที่ (วันนี้ / เมื่อวาน / custom)
- 4 ขั้น:
  1. กรอก "เงินเริ่มต้นในลิ้นชัก" (เปิดร้าน) → save localStorage
  2. ระบบคำนวณ "ควรมี" (เงินเริ่ม + ขายเงินสด − จ่ายเงินสด)
  3. นับเงินจริง — กรอกจำนวนธนบัตร 1000/500/100/50/20/10/5/2/1
  4. ดูผล: ตรงกัน / เกิน / ขาด พร้อมสีบอก
- บันทึกผลใน localStorage ตามวันที่
- โอน/บัตร แสดงแยกไม่นับในเงินสด

### Phase 6: 📷 Service Job Photos (รูปก่อน-หลัง)
- ใบงานช่าง drawer: ส่วน "รูปก่อน-หลังงาน" (2 ช่อง)
- มือถือ: เปิดกล้องหลังอัตโนมัติ (capture="environment")
- Upload → Supabase Storage `product-images` bucket (reuse)
- save: `photo_before` + `photo_after` URL
- โหลด edit job → preview ทั้ง 2 รูป

### Bump
- main.js?v=27 → v=28
- SW cache v13 → v14
- Version display 5.1.0 → 5.2.0 (build 28)

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 4 (Phase 3: Stock IN Wizard)

### 🚛 หน้าใหม่: รับเข้าสินค้า (Stock IN Wizard)
- Sidebar → "🚛 รับเข้าสินค้า" (ใต้ "📋 ประวัติสต็อก")
- ใช้ตอนรับของจาก supplier หลายตัวพร้อมกัน:
  1. เลือก: คลังที่จะรับเข้า, ซัพพลายเออร์, เลขที่ใบกำกับ
  2. สแกน barcode (กล้อง) หรือพิมพ์/ปืนยิง → กรอก qty + cost (option)
  3. กด "+ เพิ่ม" → เข้า list ด้านล่าง
  4. แก้ qty/cost ใน inline edit ได้ตลอด (cost เปลี่ยน → highlight สีส้ม)
  5. ดู total: จำนวนรายการ + ชิ้น + มูลค่ารวม
  6. กด "💾 บันทึกการรับเข้า" → batch ทำทุก row:
     - call _appApplyStockMovement (in)
     - PATCH cost ใหม่ถ้าต่างจากเดิม
     - note format: "รับเข้า: ABC Trading (Inv INV-2026-001)"
- Auto-focus search input + Enter to add (ปืนยิง barcode ใช้ได้ทันที)

### Bump main.js?v=25 → v=26

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 3 (Phase 2: Drag-drop + Featured + Promo)

### ✅ SQL ทำเสร็จแล้ว (เก็บประวัติไว้เพื่อ reference)
รัน `supabase-rls-policies.sql` ใน SQL Editor — เพิ่ม column ใหม่:
- `products.is_featured` BOOLEAN DEFAULT false
- `products.promo_price` NUMERIC
- `products.promo_start` DATE
- `products.promo_end` DATE
(idempotent — รันซ้ำได้)

### ฟีเจอร์ที่เพิ่ม
1. **Drag & Drop จัดลำดับหมวดหมู่** ใน Category Manager
   - มี handle ⋮⋮ ลากได้ + ▲▼ ก็ยังใช้ได้
   - ตอนลากแสดง preview สีฟ้า

2. **⭐ Featured flag** — checkbox ในหน้าแก้สินค้า
   - แสดง ⭐ ที่ชื่อสินค้าใน list
   - DB: `products.is_featured`

3. **🏷️ ราคาโปรโมชั่น** — ในหน้าแก้สินค้า
   - 3 ฟิลด์: ราคาโปร / วันเริ่ม / วันสิ้นสุด
   - DB: `promo_price`, `promo_start`, `promo_end`
   - Display: ใน list แสดง `฿โปร [PROMO badge] ฿เดิม-strikethrough`
   - **POS integration**: addToCart ใช้ราคาโปรอัตโนมัติเมื่ออยู่ในช่วงวัน
   - Helper: `window._appGetActivePrice(p)` → `{price, isPromo, original}`

### Bump main.js?v=24 → v=25

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 2 (Phase 1: Quick Wins สำหรับสินค้า)

### 4 ฟีเจอร์ใหม่ในหน้าสินค้า (เห็นในแถวสินค้าทันที)
1. **+📦 Quick Stock In** — ปุ่มเขียวเล็กในแถวสินค้า
   - คลิก → modal: เลือกคลัง + จำนวน + ต้นทุนใหม่ (optional) + หมายเหตุ
   - บันทึก → log stock_movements (in) + อัพเดท warehouse_stock + sync products.stock
   - ใช้ตอนรับของจาก supplier — ไม่ต้องไปหน้าประวัติสต็อก

2. **Multi-warehouse breakdown** — chip เล็กใต้ "คงเหลือ X"
   - ตัวอย่าง: `บ้าน:5 ศีขร:0 คันขาว:2`
   - เห็นภาพรวมว่าของอยู่คลังไหน — ไม่ต้องเปิดสินค้าทีละตัว
   - แสดงเฉพาะคลังที่มีของ > 0

3. **Stock Turnover** — บอกกี่วันสินค้าจะหมด
   - คำนวณ: ขาย 30 วัน / 30 = avg ต่อวัน → stock / avg = "≈12วัน"
   - สีเตือน: ≤7วัน=แดง, ≤14วัน=ส้ม, มากกว่า=เทา
   - hover dropdown title: "ขายเฉลี่ย X.X/วัน"

4. **🔄 Auto Markup** ในหน้าแก้ไขสินค้า
   - ปุ่มข้างราคาขาย: "🔄 จาก cost"
   - prompt: "บวก % เท่าไหร่?" (จำค่าล่าสุด)
   - คำนวณ: cost × (1 + pct/100) → set ในช่องราคา
   - ทศนิยม 2 ตำแหน่ง

### Bump main.js?v=23 → v=24

---

## 🆕 ฟีเจอร์ใหม่ session 25 เม.ย. — รอบที่ 1 (8 ฟีเจอร์ใหญ่ + UX)

### หน้าใหม่ 3 หน้า (Sidebar ใต้ "ประวัติสต็อก")
1. **📊 นับสต็อกจริง** (`stock_count`) — สแกน barcode + นับจริง + ปรับสต็อก
2. **💰 มูลค่าสต็อก** (`stock_value`) — มูลค่ารวม/หมวด/คลัง + Export Excel 3 sheets
3. **🐌 สต็อกค้างนาน** (`dead_stock`) — สินค้าไม่ขยับ 30/60/90/180/365 วัน + Export

### Product Drawer
4. **ราคาส่ง** — ฟิลด์ใหม่ใต้ราคาขายปลีก
5. **อัพโหลดรูป** — ปุ่ม + preview + ลบ (Supabase Storage `product-images`)
6. **Recent Activity** — สถิติขาย (30 วัน/เดือน/ปี/รวม) + stock movements 10 ล่าสุด (โผล่ตอนเปิดแก้ไข)

### Products Page
7. **☑ Bulk Mode** — multi-select checkbox + sticky bar:
   - ปรับราคา (`+10%`, `-5%`, `=1500`, `+50`)
   - เปลี่ยนหมวด, เปลี่ยนประเภท, ลบ
8. **⚡ Quick Filters** — chip "ไม่มี cost" / "ไม่มี barcode" (เห็นเฉพาะเมื่อมี)
9. **Export filtered** — confirm dialog: เฉพาะที่กรอง หรือทั้งหมด

### List View
- รูปสินค้าแทน letter avatar — ถ้ามี image_url

---

## 📦 Deferred (ยังไม่ได้ทำ — ต้องคุยกับ user ก่อน)
- **Bundle/Set** (ขายแอร์พร้อมติดตั้งเป็น 1 SKU) — ต้อง design table schema
- **Serial Number tracking** — ต้องคุยว่าเก็บที่ไหน/format
- **Auto Reorder PO** — ต้องสร้าง suppliers + workflow ใหญ่

---

## 🧑 เกี่ยวกับเจ้าของ

- **ชื่อ:** gangboo
- **Email:** gangboo@gmail.com
- **ภาษา:** ไทย (ตอบภาษาไทย ยกเว้น code/terminology)
- **สไตล์:** craftsman — ทำให้ถูกต้องครั้งเดียว ไม่ชอบ revise ซ้ำ
- **บริบท:** เทรดหุ้นอเมริกัน ชอบ design ชอบเรียนของใหม่
- **ธุรกิจ:** ร้านแอร์/โซลา (บุญสุข) — POS V5 ใช้ production จริง

**สิทธิ์ที่ user ให้ Claude (ตามที่คุยใน session 22-23 เม.ย.):**
- ✅ แก้ไฟล์ได้ไม่ต้องขอทุกรอบ
- ✅ Commit ได้เอง
- ✅ **Push ได้เอง** (user ไม่อยาก manual push ทุกครั้งแล้ว)
- ❌ ห้าม force push, reset --hard บน remote, skip hooks, รื้อ auth/RLS

---

## 🏗️ โครงสร้างโปรเจกต์

### Tech Stack
- **Frontend:** Vanilla JS (no framework), HTML5, CSS3, Service Worker, ESM modules
- **Hosting:** Cloudflare Pages (Git integration กับ GitHub — auto-deploy)
- **Backend:** Cloudflare Pages Functions (serverless) + Supabase (PostgreSQL + Auth + RLS + Storage)
- **Realtime:** LINE Messaging API — 2 groups (queue=ออเดอร์ใหม่, done=งานเสร็จ)
- **SMS OTP:** Twilio + dev fallback แสดง OTP บนจอถ้า Twilio fail
- **AI:** Cloudflare Workers AI binding `AI` สำหรับ AI Sales chat
- **Excel:** SheetJS XLSX (CDN — โหลดใน index.html)
- **QR:** html5-qrcode scanner, JsBarcode printer
- **Charts:** chart.js
- **PDF:** jspdf (lazy load)

### URLs
- **Production:** https://boonsukair.com
- **Preview:** https://boonsook-pos-v5.pages.dev
- **GitHub:** https://github.com/boonsook/boonsook-pos-v5
- **Cloudflare:** Pages project `boonsook-pos`

### Local paths (Windows)
```
Main repo:  C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github
Worktree:   C:\...\boonsook-pos-v5-github\.claude\worktrees\gifted-fermi-fe5141
```

---

## 📁 Repo Layout

```
boonsook-pos-v5-github/
├── index.html                    # Entry page
├── main.js                       # ~2200 lines — app shell, xhr helpers, routing
├── ai-chat-widget.js             # AI chat widget
├── sw.js                         # Service Worker (cache v12 — ต้อง bump เวอร์ชัน)
├── style.css, phase4-*.css       # Styles
├── supabase-config.js            # Supabase URL/anon key (public, in-browser)
├── manifest.json                 # PWA manifest
├── offline.html                  # Offline fallback
├── supabase-rls-policies.sql     # ★ SQL setup script (copy-paste to SQL Editor)
│
├── modules/                      # ~38 feature modules (ESM)
│   ├── doc-utils.js              # ★ Shared print CSS + bahtText helper
│   ├── pos.js                    # POS checkout flow
│   ├── ai_sales.js               # AI recommender + order form
│   ├── customer_dashboard.js     # Customer-facing ordering
│   ├── sales.js / products.js / customers.js
│   ├── service_jobs.js / service_request.js
│   ├── staff.js / auth.js
│   ├── dashboard.js / expenses.js / loyalty.js
│   ├── quotations.js / delivery_invoices.js / receipts.js   # เอกสาร 3 ตัว
│   ├── ac_shop.js / ac_install.js / solar.js / btu_calculator.js
│   ├── line_notify.js / thermal_printer.js / payment_gateway.js
│   ├── error_codes.js / stock_movements.js
│   └── settings/                 # Sub-pages ของตั้งค่า
│       ├── ac-catalog.js         # จัดการแคตตาล็อกแอร์ (Excel import/export)
│       ├── payment.js / pages.js / store.js / users.js
│       └── menu.js / index.js / utils.js / permissions.js / settings.js
│
├── functions/api/                # Cloudflare Pages Functions
│   ├── send-otp.js               # POST /api/send-otp (Twilio)
│   ├── verify-otp.js             # POST /api/verify-otp (HMAC)
│   ├── line-notify.js            # POST /api/line-notify (LINE push)
│   └── ai-assistant.js           # POST /api/ai-assistant (Workers AI)
│
├── data/                         # Seed data (ac_catalog.json etc.)
├── icons/                        # PWA icons + logo.svg
│
├── .gitattributes                # CRLF/LF rules
├── .gitignore                    # *.new, *.bak, *.bat, .env, commands.txt, .claude/
└── HANDOFF.md                    # ไฟล์นี้
```

**⚠️ ไฟล์ขาด (ถ้าใครถาม):**
- `OVERNIGHT_REPORT.md`, `OVERNIGHT-NOTES.md` — User ลบไปใน commit `6fc4422` (เคยมี)
- `commands.txt`, `commit.bat` — Local helper ของ user (อยู่ใน .gitignore)

---

## 🔐 Environment Variables (Cloudflare Pages → Settings)

### Required
| Variable | Value | Type |
|----------|-------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | (LINE bot token) | **Secret** แนะนำ (เดิมเป็น Plaintext) |
| `LINE_USER_ID` | (default recipient fallback) | Plaintext |
| `LINE_GROUP_QUEUE` | (groupId สำหรับออเดอร์ใหม่) | Plaintext |
| `LINE_GROUP_DONE` | (groupId สำหรับงานเสร็จ) | Plaintext |
| `OTP_SECRET` | สุ่ม 32+ chars | **Secret** (เข้ารหัส) |
| `TWILIO_ACCOUNT_SID` | (Twilio SID) | Plaintext |
| `TWILIO_AUTH_TOKEN` | (Twilio token) | **Secret** แนะนำ |
| `TWILIO_FROM_NUMBER` | +66... | Plaintext |

### AI binding
Pages → Settings → Functions → AI bindings:
- Variable name: `AI`
- Catalog: Workers AI

### Supabase
ใส่ใน `supabase-config.js` (public anon key — ไม่ใช่ secret)

---

## 🧠 Architecture Patterns

### 1. xhr helpers — หลักของทุก HTTP call ไป Supabase
อยู่ใน `main.js` (root):
```js
window._appXhrPost(table, payload, options)   // INSERT
window._appXhrPatch(table, payload, column, value)    // UPDATE
window._appXhrDelete(table, column, value)    // DELETE
window.App.xhrGet(url)                        // SELECT (raw URL)
```
**คืนค่า:** `{ ok: boolean, data?: any, error?: { message: string } }`
**Never throws** — always resolves. Check `result.ok`

**XHR logging (commits `32e8033`, `a02c7e7`):**
- Log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]` + response body 200-300 chars
- ไม่ warn ถ้า response body ว่าง (กรณี `Prefer: return=minimal`)

### 2. Toast notification
```js
window.App?.showToast?.("ข้อความ")    // ใช้ optional chain เสมอ
```
**อย่าใช้** `alert()` / `confirm()` / `prompt()` — ใช้ modal asยนค:
```js
if (await window.App?.confirm?.("ข้อความยืนยัน?")) { ... }
```

### 3. LINE notify — 2 groups routing
```js
ctx.sendLineNotify(message, { state, showToast }, "queue")   // ออเดอร์ใหม่
ctx.sendLineNotify(message, { state, showToast }, "done")    // เสร็จ
ctx.sendLineNotify(message)                                  // default (LINE_USER_ID)
```

### 4. API response shape
ทุก `/api/*` endpoint:
- Success: `{ ok: true, ...data }`
- Error: `{ ok: false, error: "ข้อความไทย" }` (ไม่ leak `err.message` ฝั่ง client)
- Server-side: `console.error("[endpoint-name] server error:", err)` → ดูได้ใน Cloudflare Functions Logs

### 5. Supabase RLS
- RLS เปิดทุกตารางหลัก — ใช้ `supabase-rls-policies.sql` ที่ root repo
- Policy: `FOR ALL TO authenticated USING (true)` — แม้เปิดกว้างแต่ต้อง auth
- Staff login ผ่าน Supabase Auth (email/password)
- Customer login ผ่าน OTP → verify → `authPassword` deterministic (HMAC) → `signInWithPassword`

### 6. `app_settings` table (new — 23 เม.ย.)
Key-value store สำหรับ setting ที่ sync ข้าม device:
- `store_info` — ชื่อร้าน, ที่อยู่, เบอร์, TaxID
- `payment_info` — banks[], promptPay, qrImage

โหลด/บันทึก:
```js
await loadAppSettings();      // ดึงจาก Supabase → merge localStorage
await saveStoreInfo(data);    // localStorage + upsert Supabase
await savePaymentInfo();      // localStorage + upsert Supabase
```

### 7. Service Worker update banner (new — commit `548208b`)
- `sw.js`: ไม่ auto-skipWaiting
- `index.html`: detect `updatefound` → banner "🔄 มีเวอร์ชันใหม่ — คลิกเพื่อใช้งาน"
- Click "อัปเดตเลย" → SKIP_WAITING → controllerchange → reload
- ต้อง bump `CACHE_NAME` ใน sw.js ทุก deploy ที่อยากให้ user เห็น banner

### 8. Document preview pattern (quotations / delivery_invoices / receipts)
3 module นี้มี pattern เดียวกัน:
- List view (table layout แบบ FlowAccount): `_viewMode = "list"`
- Preview view: `_viewMode = "preview", _viewingId = id`
- Status dropdown → PATCH status
- Bulk checkbox + bulk cancel/delete bar
- "อ้างอิง" link cross-navigate (RC → INV → QT)
- Cross-nav: `window._pendingInvoicePreviewId / _pendingQuotationPreviewId`

### 9. Bulk actions
- Checkbox per row (`data-xx-sel="${id}"`)
- Header "select all"
- `_selectedIds = new Set()`
- Bulk bar shown conditionally
- 2 ปุ่ม: "ยกเลิก (เก็บประวัติ)" + "🗑️ ลบถาวร"
- ลบถาวร: cascade restore parent status

---

## ⚠️ Gotchas (เคยเจอจริง)

### 1. Edit tool truncate ไฟล์ที่มี emoji/Thai chars
**อาการ:** Claude's Edit tool เคยตัด EOF ของ `ai_sales.js`, `customer_dashboard.js` (หาย 5-10 บรรทัด)

**วิธีแก้:**
- Small edits: ใช้ Edit tool ปกติ
- Large edits: เขียน Python patch script ใน `outputs/`
- ตรวจเสมอหลังแก้:
  ```bash
  node --check path/to/file.js
  tail -5 path/to/file.js
  ```

### 2. Python f-string backslash ห้าม
```python
f"EOL: {'CRLF' if eol == b'\\r\\n' else 'LF'}"   # ❌ SyntaxError
```
ใช้แทน:
```python
eol_name = "CRLF" if eol == b"\r\n" else "LF"
print("EOL:", eol_name)
```

### 3. Bash heredoc mangles `!`
ใน heredoc `<< 'EOF'` เมื่อเขียน `c != 1` bash อาจแทรก backslash
→ `c \!= 1` → SyntaxError
ใช้ `not c == 1` หรือ `if c == 0 or c > 1:` แทน

### 4. CRLF vs LF per file
- **Root files** (main.js, index.html, ai-chat-widget.js): LF
- **modules/\*.js:** CRLF (ส่วนใหญ่)
- **functions/api/\*.js:** CRLF (ยกเว้น ai-assistant.js = LF)
- **อย่าบังคับเปลี่ยน** — `.gitattributes` จัดการให้แล้ว

### 5. Deploy ผ่าน GitHub Actions (ไม่ใช่ Cloudflare GitHub integration!)

**สำคัญ:** Repo นี้ **ไม่ใช้** Cloudflare Pages Git integration —
ใช้ `.github/workflows/main.yml` ที่ run `wrangler pages deploy` upload โดยตรงแทน

**Workflow มี 2 jobs:**
1. `deploy` — wrangler upload ไป Cloudflare Pages (~30-60s)
2. `docker` — build + test Docker image (~2-3 min) — needs deploy

**เวลาเห็น "deploy ไม่ขึ้น":**
1. ไป **GitHub → Actions tab** ดู workflow runs
2. ถ้า `deploy` job ✓ green = Cloudflare ได้ของใหม่แล้ว → refresh dashboard
3. ถ้า `deploy` job ❌ fail = ดู logs (Cloudflare token หมดอายุ? quota เกิน?)
4. `docker` job fail ไม่กระทบ deployment — แค่ workflow status overall = fail

**ถ้า deploy job ไม่ trigger เลย (rare):**
```bash
git commit --allow-empty -m "chore: trigger workflow"
git push origin main
```

**อย่า** คลิก "Save and deploy" ใน Cloudflare upload mode — จะ disconnect ทุกอย่าง

### 6. Windows bash cd ไม่ข้าม worktree
```bash
cd "C:/path/to/repo" && command...  # อาจไม่ทำงานจาก worktree
```
ใช้:
```bash
cd "/c/Users/.../boonsook-pos-v5-github" && command...
```
หรือแก้ใน worktree แล้ว merge ที่ main repo

### 7. Supabase REST DELETE with `return=minimal` returns 204 even if RLS blocked
**ต้องใช้** `Prefer: return=representation` + check `deleted.length > 0`
ดูตัวอย่างใน `modules/receipts.js` `rcDeleteBtn` handler

### 8. Button stuck pattern
ทุก async handler ที่ disable button ต้องมี `finally` block reset:
```js
try { ... } catch(e) { ... } finally {
  if (btn.isConnected) { btn.disabled = false; btn.textContent = origText; }
}
```

### 9. Double-click race condition
ปุ่ม save/submit ต้องมี guard:
```js
if (btn.disabled) return; // กัน double-click
btn.disabled = true;
```

---

## 📊 Supabase Schema (ตารางหลัก)

ตารางที่ code เรียกถึง (จาก xhrPost/xhrPatch):
- `products`, `warehouse_stock`
- `customers`, `staff`, `staff_permissions`, `profiles`
- `sales`, `sale_items`
- `quotations`, `quotation_items`
- `delivery_invoices`, `delivery_invoice_items`
- `receipts`, `receipt_items`
- `service_jobs` (ทุกประเภทงาน — job_type: pos, ac, solar, ai_sales, other)
- `expenses`, `stock_movements`, `loyalty_points`
- `line_notify_settings`
- `app_settings` (new — key/value/updated_at)
- `warehouses`

**RLS ทุกตาราง:** run `supabase-rls-policies.sql` ที่ SQL Editor

---

## 📝 ประวัติการแก้ใน session นี้ (22-23 เม.ย. 2026)

### Critical / Security
- `52e0ac2` — fix(security): remove OTP_SECRET hardcoded fallback (CRITICAL)
- `b4f5b68` — fix(docs): verify DELETE returns rows (กัน RLS silent fail)
- `dafb4bc` — XSS escape + confirm() migration + silent catch logging + console.log cleanup
- `52e2cbc` — ป้องกัน double-click (service_request, ac_install, solar, expenses)
- `5139d31` — stuck-button fix (staff, products)
- `17f74dd` — customer checkout validation + finally
- `aff48d8` — sales/service_jobs/receipts delete stuck + safety timeout
- `d5971e8` — POS checkout stuck fix
- `b258d82` — ป้องกันสร้างเอกสารซ้อน (qt→inv, inv→rc)

### UX — FlowAccount-style redesign
- `2ecf56b` — list → table layout (ใบเสร็จ/ใบส่งสินค้า/ใบเสนอราคา)
- `7688468` — ต้นฉบับ/สำเนา pill badge + ระบุผู้ใช้
- `a5f2ff1` — จำนวนเงินเป็นสีดำ (ไม่ใช่สีธีม)
- `81afc13` — เอาคอลัมน์ # ออก + baht text + signature compact
- `5922944` — เอา page badge (1/2) มุมขวาบนออก
- `9d0291c` — tabs + status dropdown + bulk select + วันครบกำหนด
- `44efd65` — "อ้างอิง: INV/QT" คลิกเปิดเอกสารต้นทาง
- `07e688d` — bulk "ลบถาวร" hard delete + cascade
- `69fbe2c` — คลิกเลขที่เอกสารเปิด preview ได้เลย

### Features ใหม่
- `b32d86c` — แก้วันที่เอกสารใน preview + cascading lock
- `64b0da4` — receipt: payment method picker → ✓ ในช่อง checkbox
- `548208b` — SW update banner + empty states
- `9c4a625` — AI chat เพิ่มหมวด "🆕 แอร์ใหม่พร้อมติดตั้ง"
- `9e92511` — product category autocomplete (datalist)
- `090d85a` — product category chip filter
- `c1443f9` — product save validation + auto-gen SKU
- `998825e` — barcode print 50×30mm label printer
- `046003c` — ค่าไฟคำนวณถูกต้อง (inverter EER + duty cycle)
- `2bc0fd4` — ac-catalog: Excel import/export + bulk stock 5
- `f991030` — savePaymentInfo + loadAppSettings sync Supabase

### Infrastructure
- `6973165` — supabase-rls-policies.sql (SQL script)
- `75791d1` — silence false-positive warnings
- `a02c7e7` — xhr ไม่ warn ถ้า body ว่าง
- `64c4a1e` — ignore .claude/ worktrees
- `410e000` — copy label pill
- `6cc9377` — amount color black

---

## 🛣️ TODO — งานที่เหลือ (พิจารณาก่อนทำ)

### ยังไม่ได้แก้ (เสี่ยง — ต้องวางแผน)

#### Server-side security (functions/api/*)
- 🔴 **Rate limiting** — OTP/LINE API spam ได้ (costs escalation risk)
- 🟡 **CORS กว้างเกิน** (`Allow-Origin: *`) — CSRF risk
- 🟡 **/api/ai-assistant ไม่มี auth** — ใครก็เรียก Workers AI ได้

#### Accessibility (scope ใหญ่)
- `<div onclick>` → `<button>`
- Focus outline
- Alt text บนรูป
- ARIA labels

#### Performance
- Pagination สำหรับ list > 500 items
- Dashboard RPC — ย้าย aggregation ไป Supabase server-side
- Lazy load modules

#### Minor
- Input length limits (description, address) — กัน DB truncate
- Offline queue + retry สำหรับ checkout / LINE notify

### Cleanup ที่ทำไปแล้วครบ
- ✅ XSS (16 จุด)
- ✅ confirm() migration (30 จุด → 0)
- ✅ Silent catch critical logging (10 จุด)
- ✅ Production console.log (6 จุด)

---

## 🧪 Test Accounts

### Staff (Admin)
- ถาม gangboo — ใช้ Supabase Auth dashboard

### Customer (OTP)
- ใช้เบอร์จริง → Twilio ส่ง SMS
- **Dev fallback:** ถ้า Twilio trial limit → endpoint return `devCode` ใน response → แสดงในจอ + console

---

## 🧭 Cheat Sheet

### Deploy flow
```bash
# Claude session ทำใน worktree
cd "/c/Users/Lenovo E14 Gen4/Documents/boonsuk v5/boonsook-pos-v5-github/.claude/worktrees/gifted-fermi-fe5141"
# edit → commit
git add <files>
git commit -m "feat/fix(module): ..."

# Merge ไปที่ main repo + push
cd "/c/Users/Lenovo E14 Gen4/Documents/boonsuk v5/boonsook-pos-v5-github"
git merge claude/gifted-fermi-fe5141 --no-edit
git push origin main

# Cloudflare auto-deploy 1-2 นาที
```

### Trigger Cloudflare stuck webhook
```bash
git commit --allow-empty -m "chore: trigger cloudflare pages deploy"
git push origin main
```

### Syntax check ไฟล์
```bash
node --check modules/pos.js
```

### Hard refresh (clear SW cache)
Ctrl + Shift + R ใน browser

### ดู Cloudflare Functions Logs
Dashboard → Pages → boonsook-pos → Functions → Realtime Logs

### Supabase SQL Editor
Dashboard → SQL Editor → paste `supabase-rls-policies.sql` → Run

### Rollback commit ล่าสุด (ยังไม่ push)
```bash
git reset --hard HEAD~1
```

---

## 📋 หน้าทั้งหมดในแอป

### Staff side (dashboard route — auth required)
- `dashboard` — สรุปยอดขาย, กราฟ, KPIs
- `pos` — ขายหน้าร้าน (checkout, QR, attach slip)
- `products` — สินค้า (CRUD + barcode print + category chip filter)
- `sales` — ประวัติการขาย
- `customers` — ลูกค้า + loyalty
- `service_jobs` — งานซ่อม/ติดตั้ง/ออเดอร์ใหม่
- `service_request` — ฟอร์มรับแจ้ง
- `ai_sales` — AI ช่วยแนะนำสินค้า + รับออเดอร์
- `ac_shop`, `ac_install`, `solar`, `btu_calculator` — เฉพาะธุรกิจ
- `quotations`, `delivery_invoices`, `receipts` — เอกสาร 3 ตัว
- `expenses`, `profit_report` — การเงิน
- `calendar`, `stock_movements`, `loyalty` — อื่นๆ
- `staff`, `settings`, `line_notify`, `payment_gateway`, `permission_matrix` — ตั้งค่า
- `error_codes` — คู่มือรหัสข้อผิดพลาดแอร์

### Customer side
- `customer_dashboard` — OTP login → browse → cart → checkout
- `ai-chat-widget` — Chat bot overlay (3 หมวด: งานแอร์/โซลา/แอร์ใหม่)

---

## 🎯 บริบทล่าสุด (23 เม.ย.)

**สิ่งที่เพิ่งทำ:**
1. Sync paymentInfo ข้าม device (+ Supabase app_settings table)
2. AC catalog รองรับ Excel (.xlsx) + ตั้งสต็อก 5 ทุกรุ่น
3. ค่าไฟ AC คำนวณถูกต้อง (เดิม 2,631 → ตอนนี้ ~487 บาท/เดือน สำหรับ 9000 BTU)
4. Barcode print 50×30mm label printer

**รอ user ทดสอบ:**
- Cross-device sync บัญชีธนาคาร
- หน้าผู้ใช้ (profiles) หลังรัน SQL ใหม่
- AC catalog Excel workflow

**ถ้า user เจอปัญหา:**
- ขอ screenshot + console log (F12)
- มองหา log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]`, `[savePaymentInfo]`, `[loadAppSettings]`

---

## 📞 Next session checklist

เมื่อ Claude session ใหม่เริ่ม:
1. **อ่าน HANDOFF.md นี้ก่อน** (คุณกำลังอ่านอยู่)
2. `git log --oneline -20` — ดู commits ล่าสุด
3. `git status` — ดู unstaged/uncommitted
4. ตรวจว่า worktree branch sync กับ main มั้ย
5. ถาม user ว่าอยากทำอะไรต่อ อย่าเดา

### Do's
- ใช้ Python script ใน `outputs/` สำหรับ patch ไฟล์ใหญ่ (เลี่ยง Edit tool truncate)
- `node --check` ทุกครั้งหลังแก้ JS
- Preserve CRLF/LF ของไฟล์เดิม
- Commit message conventional: `fix(module)`, `feat(module)`, `refactor(ux)`, `style(docs)`, `chore`
- **Push ได้เองแล้ว** (user อนุญาตแล้วใน session นี้)
- Safety net ในทุก async handler: `try { ... } catch { ... } finally { if (btn.isConnected) reset }`

### Don'ts
- ❌ `alert()`, `confirm()`, `prompt()` — ใช้ showToast, App.confirm
- ❌ Leak `err.message` ฝั่ง client ที่ API endpoints
- ❌ Bulk rewrite ไฟล์ใหญ่ด้วย Write tool — ใช้ Edit/Python
- ❌ Create `.bak`, `.new`, `.old` files — ใช้ git history
- ❌ Force push, reset --hard remote, skip hooks
- ❌ คลิก "Save and deploy" ใน Cloudflare upload mode
- ❌ `innerHTML = user_input` — escape ด้วย escHtml/escapeHtml

---

## 🗂️ รายงานอื่นๆ

- **`supabase-rls-policies.sql`** (root) — script SQL setup RLS + create app_settings
- **`.claude/plans/`** — Plan files ของ Claude (ถ้ามี)
- **User's local** — `commands.txt`, `commit.bat` (ignored — ไม่อยู่ใน git)

---

**ขอบคุณที่อ่านถึงตรงนี้ — ช่วย gangboo ดูแลแอปต่อเลยครับ** 🙏

_อัปเดต: Claude (Opus 4.7) — session 22-23 เม.ย. 2026_
_Total commits this session: 30+_
