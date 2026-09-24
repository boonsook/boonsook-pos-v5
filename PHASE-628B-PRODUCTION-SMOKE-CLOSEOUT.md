# Phase 628B — Production Smoke Closeout (authenticated UI smoke)

สถานะ: **docs-only closeout** · build 628 / v5.69.95 (ไม่ bump) · ไม่แตะ runtime / SQL / ข้อมูล production · STOP `READY-FOR-INDEPENDENT-PHASE-628B-CLOSEOUT-REVIEW`

## 1. Baseline

| รายการ | ค่า |
|---|---|
| `origin/main` | `ec95993befb6afbf7b8a032095414a8d6034f141` = merge ของ PR #222 (`codex/phase-628b-document-item-type-runtime`) |
| Phase 628B implementation commit | `cb455beb30001909794b67399015841d1d95e450` (tree ของ merge = tree ของ commit นี้ — ไม่มีไฟล์อื่นเข้ามา) |
| Build ใน repo | `data-app-build="628"` · `data-app-version="5.69.95"` · `CACHE_NAME` cache-v628 · `SW_BUILD` 628 |
| Live marker (Claude ตรวจเอง · HTTP GET อ่านอย่างเดียว · 2026-09-24T03:49Z) | `https://boonsook-pos-v5.pages.dev/` → `data-app-build="628"` · `data-app-version="5.69.95"` · `sw.js` cache-v628 / `SW_BUILD` 628 · `modules/doc_items.js` HTTP 200 |

## 2. ที่มาของหลักฐาน (provenance)

- วันที่ทดสอบ: **2026-09-24** (ตาม session Asia/Bangkok)
- ชนิด: **authenticated production UI smoke** — ทำผ่านหน้าจอแอปจริงบน production
- ผู้ทำ: **Codex** ทำผ่าน browser session ที่ owner login ไว้
- Authorization: owner อนุมัติ **ก่อนสร้าง** เอกสารทดลอง และอนุมัติ **อีกครั้งก่อนลบ**
- production build ขณะทดสอบ: **628 / v5.69.95**
- ไม่ได้ใช้ service-role key · ไม่ได้ใช้ Supabase SQL Editor · ไม่ได้รัน migration · ไม่มี raw SQL / DB snapshot
- **ไม่ใช่ independent DB measurement** — ทุกผลด้านล่างเป็นสิ่งที่สังเกตผ่าน UI ของแอป
- เอกสารนี้บันทึกโดย Claude จากผลที่ owner ส่งต่อมา — ผู้บันทึกไม่ได้เห็นข้อมูล production ด้วยตัวเอง (ส่วนที่ Claude ตรวจเองมีแค่ live marker ในข้อ 1)

## 3. เอกสารทดลองที่สร้าง

| ชนิด | เลขที่ |
|---|---|
| ใบเสนอราคา (Quotation) | `QT20260924001` |
| ใบส่งสินค้า (Delivery invoice) | `INV20260924001` |
| ใบเสร็จ (Receipt) | `RC20260924001` |

รายการในเอกสาร (ตามลำดับ):

1. หัวข้อ (heading): `SMOKE HEADING 628B`
2. สินค้า (item): `SMOKE ITEM 628B` · จำนวน 1 · หน่วย `ชิ้น` · ราคาต่อหน่วย ฿1.00 · ยอดรวม ฿1.00

## 4. ผลที่สังเกตผ่าน UI

- ใบเสนอราคาแสดง `SMOKE HEADING 628B` เป็นหัวข้อ และ `SMOKE ITEM 628B` เป็นสินค้า
- แปลง QT → DI แล้วทั้งสองแถวยังเป็นชนิดเดิมและลำดับเดิม
- แปลง DI → Receipt แล้วทั้งสองแถวยังเป็นชนิดเดิมและลำดับเดิม
- แถวหัวข้อไม่มีจำนวน ราคาต่อหน่วย หรือยอดรวม
- แถวสินค้าแสดงจำนวน 1 · หน่วย `ชิ้น` · ราคา ฿1.00
- ใบเสร็จอยู่สถานะ **pending** · ไม่มีการรับชำระ · ไม่มีการ post JV · ไม่มีการตัดหรือแก้ stock

ข้อสรุป: smoke นี้พิสูจน์ **INSERT และ readback ของ `item_type` ผ่าน production application path ครบทั้งสามตาราง** (`quotation_items` → `delivery_invoice_items` → `receipt_items`) ด้วยชนิดและลำดับที่ถูกต้อง

smoke นี้ **ไม่ใช่** การรับรอง payment, accounting (JV), stock หรือ document workflow อื่นทั้งหมด

## 5. Cleanup

owner อนุมัติให้ลบตามลำดับ **Receipt → Delivery invoice → Quotation**:

1. ลบ `RC20260924001`
2. ลบ `INV20260924001`
3. ลบ `QT20260924001`

ผลหลัง hard reload (**UI-observed**):

| หน้า | ก่อน | หลัง |
|---|---|---|
| ใบเสร็จ (Receipts) | 29 | 28 |
| ใบเสร็จ pending | 5 | 4 |
| ยอดรวมใบเสร็จ | ฿525,973.00 | ฿525,972.00 |
| ใบส่งสินค้า (Delivery invoices) | 33 | 32 |
| ใบเสนอราคา (Quotations) | 43 | 42 |

ไม่พบ `SMOKE-628B` หรือเลขเอกสารทดลองทั้งสามในหน้ารายการหลัง cleanup → **UI cleanup/readback verified** (ไม่ใช่การพิสูจน์ว่า DB สะอาด)

## 6. ข้อจำกัด (ต้องอ่านคู่กับผล)

- ตัวเลข cleanup เป็น **UI-observed counts** ไม่ใช่ `COUNT(*)` จาก DB
- ไม่มี raw SQL / DB snapshot ก่อนหรือหลังการทดสอบ
- ไม่ได้ทดสอบ concurrent writers (หลายเครื่องพร้อมกัน)
- **ไม่ปิด** residual เรื่อง client-side gate ที่ไม่ใช่ DB transaction/atomic
- ไม่พิสูจน์ pagination ของ Share PDF บนเอกสารยาว (`share_doc.js` ไม่รู้จัก `break-after` ของหัวข้อ)
- ไม่พิสูจน์ Chrome รุ่นเก่ากว่า 111 (`:nth-child(even of …)`)
- **ไม่ใช่ full production acceptance**
- 🔴 rollout blocker เดิมยังอยู่: ทุกเครื่องในร้านต้องเป็น build 628 ก่อน staff ใช้หัวข้อ

## 7. สถานะเดิมที่ถูก supersede

ข้อความเดิมยังอยู่เป็น historical record ทุกบรรทัด — ติดป้าย `SUPERSEDED 2026-09-24` ต่อท้ายบรรทัดเฉพาะสถานะที่เปลี่ยน:

- `HANDOFF.md` บล็อก Phase 628B: หัวบล็อก "local commit · รอ independent review · ไม่ push/merge/deploy" · Residual (1) "INSERT `item_type` บน production ยังไม่พิสูจน์" · STOP "ห้าม push/merge/deploy"
- `HANDOFF.md` บล็อก Phase 629 / 628A-CLOSEOUT / 628A: สถานะ "Phase 628B ยังไม่เริ่ม / หยุดไว้ / ต้อง re-baseline" · "ยังไม่มีโค้ดไหนสร้าง/แสดง heading" · "PostgREST schema cache ยังไม่ได้ยืนยันผ่าน REST" (ปิดด้วย owner-measured REST gate 2026-09-23T16:39:39.846Z)
- `CHANGELOG.md` รายการ Phase 628B: "local commit · รอ independent review" · รายการ 628A-CLOSEOUT / 628A: "Phase 628B ยังไม่เริ่ม"
- `SESSION_START_SHARED.md` บล็อก Phase 628B: "ยังไม่ push/merge/deploy" + "INSERT บน production ยังไม่พิสูจน์" · บล็อก 629 / 628A-CLOSEOUT / 628A: สถานะ 628B ยังไม่เริ่ม/หยุดไว้

## 8. ถัดไป

- Next recommended phase: **Phase 630 — QT → DI fail-closed** (ยังไม่เริ่ม · ต้องมี prompt แยก)
- **STOP: `READY-FOR-INDEPENDENT-PHASE-628B-CLOSEOUT-REVIEW`** — docs-only · local commit · ห้าม push/merge/deploy จนกว่า independent review ผ่าน
