# Phase 632 — Production SQL Closeout (one active receipt per delivery invoice)

สถานะ: **docs-only closeout** · build 630 / v5.69.97 (ไม่ bump) · commit นี้ไม่แตะ runtime / tests / SQL / RLS / build / cache / ข้อมูล production และไม่ได้รัน SQL เพิ่ม

ระดับหลักฐาน: **Catalog PASS (POST-CHECK A/B), Codex-operated, owner-authorized** — ไม่ใช่ owner-measured, ไม่ใช่ reviewer-measured และไม่ใช่ authenticated two-client concurrency smoke

## 1. Baseline

| รายการ | ค่า |
|---|---|
| `origin/main` | `fef61f919a00fe69ae1ec2aa59ae6a19dd83a4e4` = merge PR #227 (implementation commit `62cb254`) |
| SQL | `supabase-phase632-receipt-active-unique.sql` · SHA-256 `bd7fd12d41d429fcad52958aaa51192539d1981fc6fb10a70b37df801389d7de` · 121 บรรทัด |
| Runbook | `PHASE-632-OWNER-SQL-RUNBOOK.md` · SHA-256 `1088f1b0e7423912fbc0cb6368071a008f47a095baa364c706c1205ab893b99b` |
| Build ใน repo | `data-app-build="630"` · `data-app-version="5.69.97"` · `CACHE_NAME` cache-v630 (ไม่เปลี่ยน) |

## 2. ที่มาของหลักฐาน (provenance)

- Production project ที่เห็นใน SQL Editor: `boonsook-pos / main PRODUCTION`
- ผู้กด Run: **Codex** ผ่าน Supabase SQL Editor UI หลัง owner อนุมัติ และ owner ยืนยันหยุดงานใบเสร็จชั่วคราวระหว่างรัน
- ผลทุกข้อในเอกสารนี้เป็น **ข้อความที่ Codex คัดลอกจาก UI** — ไม่มี screenshot/CSV แนบ (reviewer รอบสองรับข้อความคัดลอกได้ โดยต้องระบุว่าเป็นข้อความคัดลอก)
- Independent post-run review 2 รอบ (read-only · reviewer **ไม่ได้ต่อ DB เอง**): รอบแรกไม่มี Blocking มี Should-fix ขอ raw POST-CHECK A แถวเต็ม · รอบสองปิด Should-fix, ไม่มี Blocking, อนุญาต docs-only closeout/ledger
- เอกสารนี้เขียนโดย Claude session เดียวกับ post-run reviewer → ต้องมี independent docs closeout review อีกชั้นก่อน push/merge

## 3. Preflight (Codex-operated) — `2026-09-25T12:36:38.203866Z`

| รายการ | ค่า |
|---|---|
| receipts / linked / candidate active | 26 / 26 / 26 |
| paid / pending | 24 / 2 |
| active duplicate groups | 0 |
| orphan | 0 |
| NULL / blank / noncanonical-cancelled status | 0 / 0 / 0 |
| index เดิม | 3 ตัว · unique/valid/ready/live = true ทุกตัว |
| index Phase 632 ก่อนรัน | ไม่มี |

(preflight รอบ implementation เวลา `2026-09-25T10:08:09.802491Z` เป็น owner-measured ตามที่บันทึกใน HANDOFF — คนละรอบกับตารางนี้)

## 4. Apply

- กด Run migration **ทั้งไฟล์ครั้งเดียว** · ไม่มี error ที่ UI
- **ไม่ได้พิสูจน์ byte-for-byte** ว่าข้อความใน SQL Editor ตรงกับไฟล์ที่ pin SHA ไว้ — ตรวจได้เพียงต้นไฟล์เป็น `BEGIN`, ท้ายไฟล์เป็น POST-CHECK B และรวม 121 บรรทัด (ห้ามเขียนว่า byte-identical)
- Transaction เดียว: มีเพียง **หลักฐานทางอ้อม** — `LOCK TABLE public.receipts IN SHARE MODE` ผ่านโดยไม่มี error (คำสั่งนี้จะ error ถ้ารันนอก transaction block) · **ไม่ใช่ "proven atomic"**
- DO block ตรวจ catalog (opclass/indoption/collation/predicate) ไม่ raise — หลักฐานคือ "ไม่มี error ที่ UI" เท่านั้น

## 5. POST-CHECK A (รันแยก · 1 แถว · ข้อความคัดลอกจาก UI)

```json
{
  "index_name": "uq_receipts_one_active_per_delivery_invoice",
  "indisunique": true,
  "indisvalid": true,
  "indisready": true,
  "indislive": true,
  "indimmediate": true,
  "indisexclusion": false,
  "indnkeyatts": 1,
  "indnatts": 1,
  "key_attnums": "3",
  "no_expressions": true,
  "access_method": "btree",
  "index_definition": "CREATE UNIQUE INDEX uq_receipts_one_active_per_delivery_invoice ON public.receipts USING btree (delivery_invoice_id) WHERE ((delivery_invoice_id IS NOT NULL) AND (status IS DISTINCT FROM 'cancelled'::text))",
  "predicate": "((delivery_invoice_id IS NOT NULL) AND (status IS DISTINCT FROM 'cancelled'::text))"
}
```

การอ่านผลของ reviewer:

- `index_definition` มาจาก `pg_get_indexdef()` ซึ่งแปลงเลขคอลัมน์เป็นชื่อเอง → key คือ `delivery_invoice_id` คอลัมน์เดียว ไม่มี `INCLUDE`, ไม่มี `DESC`/`NULLS FIRST`, ไม่มีชื่อ opclass (= default `int8_ops`), ไม่มี `COLLATE`
- predicate ตรงทุกตัวอักษรกับค่า canonical ใน SQL บรรทัด 92
- `key_attnums = "3"` เทียบกับ repo ไม่ได้ (repo ไม่มี `CREATE TABLE receipts`) — ใช้ชื่อคอลัมน์ใน `index_definition` เป็นตัวยืนยัน

## 6. POST-CHECK B (รันแยก)

`0 rows — Success. No rows returned` (ไม่มี `delivery_invoice_id` ใดมีใบเสร็จที่ไม่ cancelled เกิน 1 ใบ)

## 7. เวลา

`2026-09-25 12:39:32.803121+00` เป็นเวลา DB จาก **query แยกหลัง A/B** → เขียนได้เพียงว่า A/B รันก่อนเวลานี้ · ไม่ใช่ timestamp ในแถว A และไม่ใช่เวลา COMMIT

## 8. ขอบเขตของ invariant

- ใบเสร็จตรงที่ `delivery_invoice_id IS NULL` **ไม่ถูก index นี้บังคับ** (ตามแบบ)
- `status` เป็น NULL นับเป็น active (`IS DISTINCT FROM`) · ยกเว้นเฉพาะค่า `'cancelled'` ตรงตัว
- Index ป้องกัน **active receipt header ซ้ำ** เท่านั้น — ไม่ได้ทำให้ `receipt_items`, PATCH สถานะ DI/QT, void JV หรือการคืนสถานะ DI เป็น atomic (ยังเป็นหลาย request)
- Race loser ได้ 23505 (HTTP 409) ที่ header INSERT และ client หยุดก่อน items/PATCH · UI อาจแสดงข้อความ 23505 ภาษาอังกฤษ
- Cancelled → paid/pending ถูกปฏิเสธด้วย 23505 ถ้ามีใบ active แทนอยู่แล้ว (UI ไม่มีตัวเลือกเปลี่ยนสถานะใบ cancelled — ทำได้ทาง REST ตรงเท่านั้น)

## 9. เลขเอกสาร

`receipt_no` **ไม่ควรเว้น**ตามนิยาม `next_doc_number` ใน repo (`supabase-phaseB2-doc-no-sequence.sql`: ตัวนับเป็นแถวในตาราง `doc_number_counters` จึง rollback พร้อม INSERT ที่ล้ม) **แต่ยังไม่ได้ verify function บน production** · `receipts.id` อาจเว้นได้ · ห้ามรับรองว่าเลขใบเสร็จ production ไม่มีวันเว้น

## 10. Residual — NOT RUN

- Authenticated two-client concurrency smoke = **NOT RUN**
- การตรวจ `next_doc_number` / `trg_assign_receipt_no` บน production ว่าตรง repo = **NOT RUN** (ทำได้ภายหลังด้วย SELECT read-only)
- ห้ามเปลี่ยนสองข้อนี้เป็น PASS และห้ามสร้างใบเสร็จทดลองบน production โดยไม่มี owner approval แยก
- `PHASE-632-OWNER-SQL-RUNBOOK.md` บรรทัด 3 ยังเขียน `SQL production execution: NOT RUN` — runbook ถูก pin ด้วย SHA และอยู่นอก scope closeout นี้ ให้อ่านคู่กับเอกสารนี้

**STOP: `READY-FOR-INDEPENDENT-PHASE-632-DOCS-CLOSEOUT-REVIEW`** — ไม่ push / PR / merge / deploy
