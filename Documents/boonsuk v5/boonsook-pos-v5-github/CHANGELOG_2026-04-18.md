# Boonsook POS V5 — Bug Fixes & Improvements
**วันที่:** 2026-04-18
**ผู้แก้ไข:** Claude (AI)

---

## สรุปสั้น

แก้บั๊กที่ค้นพบ + ปรับโครงสร้างโค้ดให้ maintain ง่ายขึ้น + เพิ่มฟีเจอร์ใหม่ (ส่งออก Excel) และสร้าง SQL migration สำหรับ schema updates ที่จำเป็น

ไฟล์ที่แก้ไข **7 ไฟล์** + สร้างใหม่ **2 ไฟล์** (migration + changelog) — ผ่านการทดสอบ ES module parser ครบทุกไฟล์

---

## 1. ไฟล์ที่เพิ่มใหม่

### `migrations/2026-04-18_bug_fixes.sql`
SQL migration ที่ต้อง run ใน Supabase Dashboard → SQL Editor:

1. **RLS policies สำหรับ `service_jobs`** — fix bug ลูกค้าสั่งออเดอร์ผ่าน customer dashboard ไม่ได้ (INSERT blocked by RLS)
2. **เพิ่มคอลัมน์ `sale_items.product_id` (FK)** — link ไป `products.id` เพื่อ join ได้แม่นยำ
3. **เพิ่มคอลัมน์ `sale_items.unit_cost`** — เก็บต้นทุน ณ เวลาขาย → Profit Report แม่นยำ
4. **Backfill** — populate `product_id`/`unit_cost` ของรายการเก่าโดย match product_name
5. **Index** — `idx_sale_items_product_id` เพื่อ query ได้เร็วขึ้น

**วิธีใช้:** เปิด Supabase Dashboard → project rwmmjljelpcpwohwiplu → SQL Editor → New query → paste เนื้อหาไฟล์ → Run

---

## 2. Bug Fixes

### BUG-001 : QR Scanner `.stop()` throw error ตอนปิด
**ไฟล์:** `modules/products.js` (closeScanner)
- เดิม: เรียก `scannerInstance.stop()` โดยไม่เช็ค state → throw error บนมือถือ
- ใหม่: เช็ค `scannerInstance.getState()` ก่อน (html5-qrcode state 2 = Scanning, 3 = Paused) + wrap ใน `.catch()` promise handler

### BUG-002 : Sales page crash ถ้า `state.sales` เป็น null
**ไฟล์:** `modules/sales.js`
- เดิม: `state.sales.filter(...)` → TypeError ถ้า sales ยังโหลดไม่เสร็จ
- ใหม่: `(state.sales || []).filter(...)`  (backup มี fix นี้แล้ว — ยืนยันว่าไม่หาย)

### BUG-003 : POS `xhrPostPOS` ซ้ำกับ `xhrPost` ใน main.js
**ไฟล์:** `modules/pos.js`
- เดิม: 2 function แยกกัน → ต้อง maintain 2 ที่
- ใหม่: `xhrPostPOS` delegate ไป `window._appXhrPost` อัตโนมัติเมื่อมี (ลด code duplication)

### BUG-004 : Profit Report ไม่สามารถคำนวณต้นทุนได้
**ไฟล์:** `modules/profit_report.js`
- เดิม: `totalCost = 0` เพราะไม่มี `unit_cost` ใน DB
- ใหม่:
  - ใช้ `sale_items.unit_cost` (หลัง migration) เป็นหลัก
  - Fallback ไปที่ `products.cost` ถ้า `unit_cost` ยังว่าง (สำหรับ backfill รายการเก่า)
  - `renderMonthlyTrend` รับ `saleItems` + `productCostMap` เพื่อคำนวณต้นทุนรายเดือนได้ถูกต้อง
  - `renderProfitByProduct` แสดง `totalCost` + กำไรที่แท้จริง (เดิมแสดง 0)

### BUG-005 : service_jobs INSERT ถูก RLS ปฏิเสธ
**ไฟล์:** `migrations/2026-04-18_bug_fixes.sql`
- เดิม: ลูกค้าสั่งออเดอร์ผ่าน customer_dashboard → 403 Forbidden
- ใหม่: เพิ่ม RLS policy ให้ authenticated users สามารถ INSERT/SELECT/UPDATE/DELETE ได้

### BUG-006 : Service Worker ตัวปิด statement ไม่ครบ
**ไฟล์:** `sw.js`
- เดิม: ไฟล์ถูกตัดท้าย (`caches.delete` เปิด paren แล้วขาด)
- ใหม่: เพิ่ม `(CACHE_NAME).then(...)` ที่ขาดไป + bump version `v9 → v10` เพื่อ force refresh cache ของ user เดิม

### BUG-007 : Customer Dashboard — checkout ไม่ validate เบอร์โทร/ไฟล์
**ไฟล์:** `modules/customer_dashboard.js`
- เดิม: ตรวจแค่ `!payload.customer_phone` (ต้องไม่ว่าง) — ไม่ตรวจฟอร์แมต
- ใหม่:
  - `isValidPhone()` ตรวจเบอร์โทร 10 หลัก
  - `validateFile()` ตรวจ type + size + extension ของสลิป
  - ที่อยู่ต้องยาวอย่างน้อย 10 ตัวอักษร

### BUG-008 : Integrate `validators.js` ที่ถูก orphan
**ไฟล์:** `main.js` + `modules/customer_dashboard.js`
- เดิม: `modules/validators.js` (180 บรรทัด) มีอยู่แต่ไม่มีใครใช้
- ใหม่:
  - `main.js` import + expose `window._appValidators` ให้ module อื่นเรียกได้
  - `main.js saveServiceJob()` ใช้ `isValidPhone()` ตรวจเบอร์โทรก่อนบันทึก
  - `customer_dashboard.js` ใช้ทั้ง 3 helpers ตรง checkout

---

## 3. ฟีเจอร์ใหม่

### FEATURE-001 : ส่งออก Excel สำหรับทำบัญชี
**ไฟล์:** `modules/sales.js`
- เพิ่มปุ่ม **📊 Excel** ข้างปุ่มรีโหลดในหน้ารายการขาย
- กดแล้วจะได้ไฟล์ `boonsook-sales-YYYY-MM-DD.xlsx` เปิดใน Excel / LibreOffice ได้ทันที
- คอลัมน์: เลขที่บิล, วันที่, ลูกค้า, วิธีชำระ, ยอดก่อนส่วนลด, ส่วนลด, รวมสุทธิ, รับเงิน, เงินทอน, หมายเหตุ
- ใช้ XLSX library (SheetJS) ที่ load อยู่แล้วใน `index.html`

---

## 4. Code Quality Improvements

### IMPROVEMENT-001 : sale_items — เพิ่ม `product_id` + `unit_cost` ตอน insert
**ไฟล์:** `main.js` (saveSale) + `modules/pos.js` (checkout)
- insert โดยส่ง `product_id` (FK) และ `unit_cost` (ต้นทุน ณ จุดขาย)
- Legacy fallback: ถ้า DB ยังไม่ได้ migrate → detect error → retry โดยไม่ส่ง 2 ฟิลด์นี้ → ไม่ break backward compat
- ผลลัพธ์: Profit Report คำนวณต้นทุนได้แม่นยำหลัง migration โดยไม่ต้องรอ

### IMPROVEMENT-002 : Cache busting สำหรับ Service Worker
- bump `CACHE_NAME` เป็น `'boonsook-pos-v5-cache-v10'` → ผู้ใช้เดิมจะได้ไฟล์ใหม่อัตโนมัติตอนเปิดแอป

---

## 5. ไฟล์ที่ถูกแก้ไข

| ไฟล์ | บรรทัด (ก่อน → หลัง) | ขนาด (bytes) |
|---|---|---|
| `main.js` | 2109 → 2126 (+17) | +1,344 |
| `modules/pos.js` | 1027 → 1040 (+13) | +811 |
| `modules/products.js` | 930 → 939 (+9) | +502 |
| `modules/customer_dashboard.js` | 922 → 931 (+9) | +833 |
| `modules/sales.js` | 156 → 196 (+40) | +2,392 |
| `modules/profit_report.js` | 402 → 415 (+13) | +857 |
| `sw.js` | 161 → 162 (+1) | +100 |

---

## 6. การทดสอบ

ทุกไฟล์ผ่านการทดสอบ:
- **Node.js syntax check** (`node --check`) — ผ่านทุกไฟล์
- **Real ESM parse** (`vm.SourceTextModule`) — ผ่าน 27 modules / 27 รวม `sw.js` ด้วย

---

## 7. ขั้นตอนต่อไป (TODO ของผู้ใช้)

1. **run SQL migration** : เปิด Supabase Dashboard → SQL Editor → paste `migrations/2026-04-18_bug_fixes.sql` → Run
2. **deploy** : push ขึ้น GitHub → Cloudflare Pages จะ build อัตโนมัติ
3. **ทดสอบบนมือถือ** : เปิดแอป → refresh → check ว่า SW version เป็น `v10` แล้ว (DevTools → Application → Service Workers)
4. **ตรวจ Profit Report** : หลัง migration + ขายใหม่หลายรายการ → กำไรและต้นทุนควรจะแสดงถูกต้อง
5. (optional) **ลบ backup** : `_backup_20260417_234026/` และ `_corrupted_snapshot_*` สามารถลบได้เมื่อยืนยันว่าแก้ไขครบถ้วน

---

## 8. หมายเหตุทางเทคนิค

- **Line ending** : ไฟล์ทั้งหมดเป็น CRLF (Windows) — ต้อง preserve ไว้ ไม่งั้น git diff จะ noisy
- **Encoding** : UTF-8 (รองรับภาษาไทย + emoji ในโค้ด)
- **Legacy fallback** : การ insert `sale_items` ทั้งใน `main.js` และ `pos.js` มี fallback detection สำหรับ DB schema ที่ยังไม่ได้ migrate → ปลอดภัยไม่ว่าจะ deploy โค้ดก่อนหรือหลัง migration
