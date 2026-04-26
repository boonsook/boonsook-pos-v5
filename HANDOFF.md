# 📋 HANDOFF — Boonsook POS V5 PRO

**อัปเดตล่าสุด:** 26 เมษายน 2026 (Phase 28 — Fix update banner mobile)
**Version:** 5.8.3 (build 41)
**Previous:** 5.8.2 (build 40) — Phase 27 (Fix AI help HTTP 400)

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

### 5. Cloudflare webhook stuck
บางครั้ง GitHub push แล้ว Cloudflare ไม่ deploy ใน 5-40 นาที

**วิธีแก้:**
```bash
git commit --allow-empty -m "chore: trigger cloudflare pages deploy"
git push origin main
```

**อย่า** คลิก "Save and deploy" ใน Cloudflare upload mode — จะ disconnect Git integration

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
