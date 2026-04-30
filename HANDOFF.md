# 📋 HANDOFF — Boonsook POS V5 PRO

**อัปเดตล่าสุด:** 29 เมษายน 2026 (Bug A/B/C/D/E — RLS audit + Phase 45.14/15 fixes)
**Version:** 5.13.3 (build 73)
**Previous:** 5.12.2 (build 62) — Phase 45.3 (stock_movements schema mismatch)

**🛡️ Phase 17 Active!** — KV binding ผูกแล้ว (Production + Preview), tested 429 OK

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

USER ACTION pending: รัน `supabase-phase45-bug-e-tighten-anon.sql`
+ ทดสอบ signup ลูกค้าใหม่

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

### USER ACTION ที่ทำไปแล้ว
1. ✅ รัน `supabase-phase45-diagnostic.sql` — ส่ง JSON output กลับมา
2. ✅ รัน `supabase-phase45-bug-fix-a-c.sql` — verified 3 constraints + profiles ไม่ recurse
3. ✅ รัน `supabase-phase45-bug-b-cleanup.sql` — verified anon block ทุก sensitive table
4. ✅ รัน `supabase-phase45-bug-d-view-fix.sql` — verified anon ถูก REVOKE จาก view

### USER ACTION pending
- รัน `supabase-phase45-bug-e-tighten-anon.sql` — REVOKE anon GRANT
  จาก profiles + customers + customer_otp
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
