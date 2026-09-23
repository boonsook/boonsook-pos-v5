# Phase 628A — Owner SQL Runbook (document `item_type` schema)

> **ใช้หลัง independent review เท่านั้น.** ทีม implement **ไม่ได้รัน SQL นี้** — ไม่มีการต่อ Supabase หรือรัน migration / post-check จาก implement session ใด ๆ. PostgreSQL parser/live execution = **NOT RUN** จนกว่า owner จะรันตามเอกสารนี้.

- Migration: [`supabase-phase628a-document-item-type-schema.sql`](supabase-phase628a-document-item-type-schema.sql) (อ้างอิง commit `d31878b271e7521f4baa6adbcd98cf1d6ad9e18c` · SHA-256 `7172b79dba822d23713371837327a5b58d674ae0850712eabb4b28c532cd5cc7` · 148 บรรทัด)
- ก่อนเริ่ม ให้ตรวจว่าไฟล์ที่จะรันมี SHA-256 ตรงค่าข้างบน ถ้าไม่ตรง = **STOP** (ไฟล์ไม่ใช่ตัวที่ผ่าน review)
- Scope ของ migration: เพิ่ม `item_type text NOT NULL DEFAULT 'item'` + CHECK (`item|heading`) ให้ `quotation_items`, `delivery_invoice_items`, `receipt_items`; backfill แถวเดิมเป็น `item` ทั้งหมด; ไม่สร้าง heading row
- เอกสารนี้**ไม่ได้**เปิดใช้ฟีเจอร์ heading — runtime/UI/totals/การแปลงเอกสาร/การพิมพ์ อยู่ Phase 628B ซึ่ง**ยังไม่เริ่ม**
- แนะนำรันช่วงที่ไม่มีใครสร้าง/แก้ใบเสนอราคา ใบส่งสินค้า หรือใบเสร็จ (ช่วงเงียบ) เพราะ STEP 3 เทียบจำนวนแถวกับ STEP 0 — มีคนเพิ่มรายการระหว่างนั้นจะทำให้ตัวเลขไม่ตรง

## STEP 0 — Fresh pre-run snapshot (read-only)

รัน query นี้**แยกเดี่ยว ๆ ก่อน** migration และบันทึกผลจริงทั้ง 3 แถวไว้ (screenshot หรือคัดลอกตัวเลข):

```sql
SELECT 'quotation_items' AS table_name, count(*) AS total_rows
FROM public.quotation_items
UNION ALL
SELECT 'delivery_invoice_items', count(*)
FROM public.delivery_invoice_items
UNION ALL
SELECT 'receipt_items', count(*)
FROM public.receipt_items
ORDER BY table_name;
```

- ผลนี้คือ **fresh pre-run count ต่อ table** ที่ใช้เป็นเกณฑ์ใน STEP 3
- ⚠️ เลข 136 / 111 / 95 (รวม 342) ในเอกสารเดิมเป็น **metadata snapshot ณ วันที่ owner ตรวจ** เท่านั้น — **ห้ามใช้เป็น acceptance value แบบตายตัว** เพราะร้านใช้งานจริงและจำนวนแถวเปลี่ยนได้

## STEP 1 — Run migration (ครั้งเดียว)

รันไฟล์ `supabase-phase628a-document-item-type-schema.sql` **ทั้งไฟล์ เพียงครั้งเดียว** ใน Supabase SQL Editor.

- ไฟล์นี้มี `BEGIN; … COMMIT;` ครอบส่วนที่เปลี่ยน schema และมี POST-CHECK A/B (read-only) ต่อท้ายหลัง `COMMIT`. การรันทั้งไฟล์จึงรัน post-check ไปด้วย แต่**ผลที่เห็นตอนนี้ไม่นับเป็นหลักฐาน** (ดู STEP 2)

ถ้าเกิด error **ก่อนหรือระหว่าง** `COMMIT`:

1. เก็บ **exact error** ทั้งข้อความ (รวม SQLSTATE ถ้ามี)
2. **STOP** — ห้ามทำ STEP ถัดไปเพื่อ "ซ่อม"
3. **ห้ามแก้ schema แบบ ad hoc** (ห้าม ALTER / ADD / DROP เอง)
4. **ห้าม retry** จนกว่าจะตรวจ state ใหม่แล้ว
5. **ห้ามเริ่ม Phase 628B**
6. โดยหลักการ transaction ควร rollback ทั้งก้อน แต่**ต้องตรวจ state ใหม่ก่อนสรุป** — เช่นรัน POST-CHECK A (read-only, บรรทัด 102–125) แยก เพื่อดูว่า `item_type` มีอยู่หรือไม่ แล้วส่งผลนั้นพร้อม error ให้ independent reviewer/owner ตัดสิน

## STEP 2 — Run POST-CHECK A separately

Supabase SQL Editor อาจแสดง**เฉพาะ result set สุดท้าย**ของการรันหลาย statement — ตอน STEP 1 สิ่งที่เห็นจึงอาจเป็นผลของ POST-CHECK B อย่างเดียว. **ห้ามใช้ผลจากการรัน migration ทั้งไฟล์เป็นหลักฐานว่า POST-CHECK A ผ่าน.**

คัดลอกและรัน**เฉพาะ** query ใต้หัวข้อ `-- POST-CHECK A:` ในไฟล์ migration **บรรทัด 102–125** แยกต่างหาก
(เริ่มที่บรรทัด `-- POST-CHECK A: exactly 3 rows; …` · จบที่ `ORDER BY c.relname;`)

Acceptance — ต้องผ่านครบทุกข้อ:

- ได้ **3 rows พอดี**
- `table_name` ครบ `delivery_invoice_items`, `quotation_items`, `receipt_items` — ไม่ซ้ำ ไม่ขาด
- `data_type = text` ทุกแถว
- `not_null = true` ทุกแถว
- `default_expr` มีความหมายเป็น `'item'::text`
- `check_definition` จำกัดค่าเชิงความหมายไว้เพียง `item` และ `heading` (Postgres มักแสดงเป็นรูป `CHECK ((item_type = ANY (ARRAY['item'::text, 'heading'::text])))` ซึ่งหมายความเดียวกับ `IN ('item', 'heading')`; ถ้าว่าง `NULL` หรือมีค่าอื่นนอกจากสองค่านี้ = ไม่ผ่าน)

## STEP 3 — Run POST-CHECK B separately

คัดลอกและรัน**เฉพาะ** query ใต้หัวข้อ `-- POST-CHECK B:` ในไฟล์ migration **บรรทัด 127–148** แยกต่างหาก
(เริ่มที่บรรทัด `-- POST-CHECK B: exactly 3 rows; …` · จบที่ `ORDER BY table_name;`)

Acceptance — ต่อ**แต่ละตาราง**:

- `total_rows` = fresh pre-run count ของตารางเดียวกันจาก STEP 0
- `item_rows = total_rows`
- `heading_rows = 0`
- `invalid_rows = 0`

**ห้ามเทียบกับเลข 342 แบบตายตัว** — เทียบกับผล STEP 0 ของรอบนี้เท่านั้น. ถ้า `total_rows` ไม่เท่ากับ STEP 0 (เช่นมีคนเพิ่มรายการระหว่างรัน) ให้ถือว่า**ไม่ผ่าน**และไป STEP 4 — อย่าตีความเอง

## STEP 4 — Stop decision

ถ้า STEP 2 **หรือ** STEP 3 ไม่ผ่านข้อใดข้อหนึ่ง:

- **STOP**
- ห้ามสร้าง heading
- ห้าม backfill เพิ่ม
- ห้ามลบ constraint หรือ column
- ห้ามรัน repair SQL เอง
- ห้ามเริ่ม Phase 628B
- ส่ง exact outputs ของ STEP 0 / 2 / 3 และ error (ถ้ามี) ให้ independent reviewer/owner ตัดสิน

ถ้าผ่านทั้งหมด รายงานได้**เพียง**:

```text
PHASE-628A-SCHEMA-APPLIED-AWAITING-INDEPENDENT-POST-RUN-REVIEW
```

ห้ามประกาศว่าฟีเจอร์ `item_type` ใช้งานได้แล้ว — runtime/UI อยู่ Phase 628B ซึ่งยังไม่เริ่ม. หลังผ่านแล้วให้บันทึกการ apply ใน `DB_MIGRATIONS_APPLIED.md` ตามปกติของโปรเจกต์ (แนบผล STEP 0 / 2 / 3).
