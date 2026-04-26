# 📋 Blueprint — Phase 43: Stock Flow Refactor + AC Install Deduction

> **สถานะ:** Draft — รอ User confirm ก่อนลงมือ
> **เขียน:** 26 เม.ย. 2026
> **Trigger:** User feedback หลัง Phase 42 audit — ตัดสต็อกผิดที่

---

## 🎯 1. ความเข้าใจ — สิ่งที่ User ต้องการ

### Stock Flow ที่ถูกต้อง (ตาม business reality)

```
   📦 บ้าน (สต็อกหลัก / Master)
   = "บ้าน" warehouse
   ───────────────────────
   • ของที่ "ซื้อเข้า" ทุกชิ้น ลงที่นี่ก่อน
   • POS ขายหน้าร้าน → ตัดจากที่นี่ (เหมือนเดิม)
                │
                │ โอน (transfer)
                │ ตอน "เตรียมของขึ้นรถ"
                ▼
   🚐 คลังในรถ (Mobile / Van warehouses)
   ─────────────────────────────────────
   • รถคันขาว (wh_kunkhao)
   • รถคันแดง (wh_kundaeng)
   • ของในรถ = ของที่ช่างเอาออกไปทำงาน
                │
                │ ตัดสต็อก (deduct)
                │ ตอน "ติดตั้งให้ลูกค้า"
                ▼
   ✅ ลูกค้า (ของออกจากระบบ)
```

### Business Rules ที่ User ระบุชัด

1. **บ้าน = สต็อกหลัก** — ของใหม่ลงที่นี่ก่อน
2. **POS หน้าร้าน** — ตัดจาก "บ้าน" (ตามเดิม)
3. **ใบงานช่าง / AC Install** — ตัด **เฉพาะคลังในรถ** เท่านั้น (คันขาว / คันแดง)
   - ❌ **ห้ามตัดจาก "บ้าน"** — เพราะของอยู่ในรถแล้ว ไม่ได้อยู่บ้าน
   - ✅ ช่างเลือกได้ว่าใช้ของจากรถไหน

4. **ศีขร** — ❓ ไม่ได้ระบุ (เดิมเป็นคลังร้านสาขา? — ขอ user confirm)

---

## 🔍 2. State ปัจจุบัน — สิ่งที่มีอยู่แล้ว

### ✅ มีแล้ว
| สิ่ง | ที่อยู่ | Status |
|---|---|---|
| ตาราง `warehouses` | DB | ✓ มี RLS |
| ตาราง `warehouse_stock` | DB | ✓ มี RLS |
| ตาราง `stock_movements` | DB | ✓ มี — track audit log |
| 4 คลัง: บ้าน, คันขาว, คันแดง, ศีขร | DB rows | ✓ ใช้งานอยู่ |
| `_transferWarehouseStock(productId, fromWh, toWh, qty)` | main.js | ✓ ใช้ได้ — โอนระหว่างคลัง |
| `_deductStockForSaleItem({ product, qty })` | main.js | ✓ ใช้ใน POS |
| **POS prefer "บ้าน" ตัดก่อน** | main.js:_deductStock | ✓ ตรงกับ spec |
| Stock movement page | modules/stock_movements.js | ✓ UI โอนสต็อก |
| Multi-warehouse view | modules/products.js | ✓ ดู stock แต่ละคลัง |

### ❌ ยังขาด (gap ของ Phase 42)
| สิ่ง | Impact |
|---|---|
| AC Install ไม่ตัดสต็อก | สต็อกในระบบไม่ตรงของจริง |
| ไม่มีแยก "บ้าน" vs "รถ" ใน schema | ตัดสต็อกเลือกคลังถูก ทำได้แต่ implicit |
| Picker ใน AC Install ไม่บอกว่าจาก warehouse ไหน | ช่างไม่รู้ว่าใช้ของจากที่ไหน |

---

## 💡 3. Solution Proposal

### Layer 1: Schema — แยก "บ้าน" vs "รถ" ชัดเจน

**Option A: เพิ่ม column `is_mobile`** (แนะนำ)
```sql
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT false;
UPDATE warehouses SET is_mobile = true
  WHERE name LIKE 'คัน%' OR name LIKE '%van%' OR name LIKE '%รถ%';
```

**Pros:**
- Explicit — ไม่ต้องเดาจาก name
- Future-proof — เพิ่มรถคันใหม่ก็ติ๊กง่าย
- UI filter ง่าย: `WHERE is_mobile = true`

**Cons:**
- ต้องรัน SQL migration

**Option B: ใช้ naming convention** (เลี่ยงได้)
- ตรวจ `name.startsWith("คัน")` ใน JS
- ⚠️ Fragile — ถ้าตั้งชื่อไม่มี prefix "คัน" จะหลุด

**👉 ผมแนะนำ Option A** — clean, explicit

---

### Layer 2: AC Install — Picker เลือกคลัง

**ตอนนี้ (Phase 42):**
- กด "+ เพิ่มอุปกรณ์" → modal ค้นหาสินค้า → เลือก → ใส่ qty/price

**เปลี่ยนเป็น:**
- กด "+ เพิ่มอุปกรณ์" → modal ค้นหาสินค้า
- แสดงเฉพาะสินค้าที่ **มีในคลัง mobile (รถ)** เท่านั้น
- ถ้ามีในหลายรถ → แสดง dropdown เลือกรถ:
  ```
  ท่อทองแดง 1/4" (3m)
    [⚪ คันขาว: 5 ชิ้น] [⚪ คันแดง: 3 ชิ้น]
    qty: [_2_]   price: [120]
  ```
- ถ้ามีรถเดียวที่มี → auto-select (ไม่ต้องเลือก)
- ถ้าไม่มีในรถเลย → หาเจอแต่บ้าน → **disabled** + ข้อความ "❌ ยังไม่ได้โอนขึ้นรถ — ไปโอนก่อน"

**Items table เพิ่ม column:**
| อุปกรณ์ | คลัง | จำนวน | ราคา/ชิ้น | รวม | × |
|---|---|---|---|---|---|
| ท่อทองแดง | 🚐 คันขาว | 2 | 120 | 240 | × |

---

### Layer 3: Save Logic — ตัดสต็อก + Audit Log

**ตอน user กด "บันทึกใบงาน":**
```js
1. INSERT service_jobs (เหมือนเดิม) + items_json (Phase 42)
2. สำหรับแต่ละ item ใน _items:
   2.1. UPDATE warehouse_stock SET stock = stock - qty
        WHERE warehouse_id = item.warehouse_id  // ← จากที่ช่างเลือก
          AND product_id = item.product_id
   2.2. INSERT stock_movements (audit log):
        type: "service_install"
        from_warehouse_id: item.warehouse_id
        to_warehouse_id: NULL  // ออกจากระบบ
        qty: item.qty
        note: "ติดตั้งให้ {customer_name} ใบงาน {job_no}"
        created_by: technician_id
```

**Edge cases:**
- ถ้าสต็อกไม่พอ (race condition) → return error + rollback
- ถ้าใบงาน fail save → ไม่ตัดสต็อก
- ถ้า user "แก้ไขใบงาน" ภายหลัง — ❓ **ต้องถาม user:**
  - Add item → ตัดเพิ่ม
  - Remove item → คืนสต็อก?
  - Change qty → ปรับส่วนต่าง?
  - **ผมแนะนำ:** Lock items_json หลัง save — แก้ไขไม่ได้ (ต้องสร้างใบใหม่)

---

### Layer 4: UI Indicator — บอกว่าใบนี้ตัดสต็อกแล้ว

หลังบันทึก:
- Badge "✓ ตัดสต็อกแล้ว" ใน items table
- Button "📦 ดูประวัติเคลื่อนไหวสต็อก" → ไปหน้า stock_movements filtered by job_no

---

## 📐 4. แผน Migration

### SQL Migration (idempotent)
```sql
-- Phase 43: แยก mobile/home warehouses
ALTER TABLE IF EXISTS public.warehouses
  ADD COLUMN IF NOT EXISTS is_mobile BOOLEAN DEFAULT false;

-- Backfill: คลังที่ชื่อขึ้นต้น "คัน" = รถ
UPDATE public.warehouses
SET is_mobile = true
WHERE (name LIKE 'คัน%' OR LOWER(name) LIKE '%van%' OR name LIKE '%รถ%')
  AND is_mobile = false;

-- ★ เพิ่ม type ใน stock_movements (ถ้ายังไม่มี)
-- ตอนนี้ type มี: 'in', 'out', 'transfer', 'adjust'
-- เพิ่ม: 'service_install' (ตัดเพราะติดตั้งใบงาน)
-- (ไม่ต้อง alter column เพราะเป็น TEXT)
```

### Code Migration
1. **main.js** — เพิ่ม `_appDeductFromMobile({ product, qty, warehouseId, jobNo, customerName })`
2. **modules/ac_install.js** — picker เปลี่ยน + items table column "คลัง" + save logic
3. **modules/stock_movements.js** — รองรับ type "service_install" (filter + display)

### Rollback Plan (ถ้าเกิดปัญหา)
- SQL: column `is_mobile` ปล่อยไว้ — ไม่ break อะไร
- Code: revert commit → AC install กลับไปไม่ตัดสต็อก (เหมือน Phase 42)

---

## ❓ 5. Open Questions — ขอ User confirm

1. **ศีขร** เป็นคลังประเภทไหน?
   - [ ] บ้านอีกหลัง (master เพิ่มเติม)
   - [ ] คลังร้านสาขา (อาจ POS ขายปลีกได้)
   - [ ] รถอีกคัน (เพิ่ม `is_mobile = true`)
   - [ ] ใช้ทดสอบ — ลบทิ้งได้

2. **ถ้าสินค้าในรถไม่พอ** — ทำไง?
   - [ ] Block save — บอก "โอนของขึ้นรถก่อน"
   - [ ] Allow + แสดง warning + auto-stock เป็น 0
   - [ ] Auto-transfer จากบ้าน → รถ → แล้วตัด (ทำเอง)

3. **แก้ไขใบงานหลัง save** — ทำได้มั้ย?
   - [ ] Lock — สร้างใบใหม่แทน
   - [ ] แก้ได้ — ปรับสต็อกตาม diff
   - [ ] แก้ได้แค่ note/photo (ไม่แตะ items)

4. **ถ้าเอาของจากบ้านเลย (ไม่ได้ขึ้นรถ)** — รองรับมั้ย?
   - [ ] ไม่ต้อง — บังคับโอนขึ้นรถก่อน (clean)
   - [ ] รองรับ — เพิ่มตัวเลือกในคลังให้ pick "บ้าน" ได้ด้วย

5. **POS หน้าร้าน** ยัง prefer "บ้าน" ตัดก่อน เหมือนเดิม?
   - [ ] ใช่ ตามเดิม
   - [ ] เปลี่ยน — ตัดจากคลังที่ user login (ถ้าช่างไปขายในรถเอง)

---

## 📊 6. Effort Estimate

| Layer | Time | Complexity |
|---|---|---|
| SQL migration | 5 นาที | Low |
| AC install picker UI | 30 นาที | Medium |
| Save deduct logic | 20 นาที | Medium |
| Stock movements integration | 15 นาที | Low |
| Testing | 20 นาที | Medium |
| **Total** | **~1.5 ชั่วโมง** | Medium |

---

## ✅ 7. Test Plan (หลังทำเสร็จ)

1. **Pre-condition:** มีของในบ้าน + โอนของขึ้นคันขาว 5 ชิ้น
2. **Test #1 — AC Install ตัดจากรถ:**
   - เปิดใบงานติดตั้งแอร์
   - "+ เพิ่มอุปกรณ์" → เลือกท่อ → ระบบบอกมีในคันขาว 5 ชิ้น
   - ใส่ qty 2 → save
   - ตรวจ: คันขาว เหลือ 3 ชิ้น, บ้านไม่เปลี่ยน ✓
3. **Test #2 — Insufficient stock:**
   - ใบงานต่อ — ใส่ท่อ 10 ชิ้น (มีแค่ 3)
   - คาดว่า: error "ของไม่พอ — โอนเพิ่ม"
4. **Test #3 — POS ยังตัดจากบ้าน:**
   - หน้า POS → ขายท่อ 1 ชิ้น
   - คาดว่า: บ้านลด, รถไม่เปลี่ยน
5. **Test #4 — Stock movements log:**
   - ไปหน้าประวัติสต็อก → filter job_no
   - คาดว่า: เห็น row "service_install" 2 ชิ้นจาก คันขาว → (ออก)

---

## 🚦 Next Step

**ขอ user ตอบคำถามใน Section 5 ก่อน** → ผมจะ refine blueprint → แล้วถึงลุย code

หรือถ้าตอบไม่ได้ทุกข้อ — ใช้ default ที่ผมแนะนำ:
1. ศีขร = คลังร้านสาขา (ไม่ใช่รถ)
2. Insufficient stock → block + error
3. แก้ไขหลัง save → lock (สร้างใบใหม่)
4. ไม่รองรับตัดจากบ้าน — บังคับโอนขึ้นรถ
5. POS ตามเดิม (prefer บ้าน)

---

**📝 ผู้เขียน:** Claude session (thirsty-leavitt)
**สถานะ:** รอ User feedback
