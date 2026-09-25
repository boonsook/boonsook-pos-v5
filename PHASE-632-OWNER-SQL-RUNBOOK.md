# Phase 632 v1.1 — owner SQL runbook

SQL production execution: NOT RUN. เอกสารนี้ใช้หลัง independent review และ owner อนุมัติ apply เท่านั้น.

## ก่อนรัน

ยืนยันโปรเจกต์ production ที่ถูกต้อง ตรวจ migration SHA-256 เทียบ PACKAGE-MANIFEST.json ของ v1.1 ที่ผ่านรีวิว และตรวจ commit ที่ทีมส่งมา ช่วงรันให้หยุดการสร้าง/แก้/เก็บเงิน/ยกเลิกใบเสร็จชั่วคราว จำนวน 26 ใบเป็น snapshot เดิม ไม่ใช่จำนวนที่ต้องตรงตลอดไป.

รัน preflight read-only และ index-health ใหม่เมื่อถึงเวลาลงจริง เก็บ raw output พร้อม timestamp ถ้ามี active duplicate หรือ metadata/index ผิดจากที่รีวิว ให้ STOP ก่อน apply และไม่ cleanup เอง.

## Apply

เปิด supabase-phase632-receipt-active-unique.sql ที่ตรวจ SHA แล้ว กด Run **ทั้งไฟล์ครั้งเดียว** ห้ามเลือกเฉพาะ CREATE/DO/COMMIT หรือรันทีละ statement. ลำดับภายในคือ BEGIN → timeout → SHARE lock → type/duplicate check → CREATE → exact catalog verify → COMMIT.

lock_timeout 5 วินาทีควบคุมการรอ lock แต่ statement_timeout 60 วินาทีเป็นเวลาต่อ statement ไม่ใช่เวลารวมทั้งไฟล์ การมีเพียง 26 แถวไม่ได้รับประกันว่าจะได้ lock ทันที.

IF NOT EXISTS ไม่ใช่หลักฐานว่า index เดิมถูกต้อง ขั้น verify ต้องผ่านด้วย. นิยามต้องมี btree key เดียวคือ delivery_invoice_id ไม่มี INCLUDE/expression และ predicate ตรงทุกตัวอักษรกับรูป canonical ที่คาดไว้. หาก Postgres รุ่นจริง deparse ต่างกัน จะ STOP แบบ fail-closed ให้ส่งข้อความกลับ reviewer ห้ามผ่อน verifier เอง.

## ตรวจผล

SQL Editor อาจแสดงเพียงผล SELECT สุดท้าย ให้คัดลอกส่วนระหว่าง `-- POST-CHECK A BEGIN` กับ `-- POST-CHECK A END` จากไฟล์ migration เดิมมารันแยก แล้วทำเช่นเดียวกันกับ B.

A ต้องได้ 1 แถว ชื่อ uq_receipts_one_active_per_delivery_invoice, unique/valid/ready/live/immediate=true, exclusion=false, indnkeyatts=indnatts=1, no_expressions=true, access_method=btree และ index_definition/predicate ตรงกับที่ review. B ต้อง 0 แถว. ส่ง raw A/B และผล Run ทั้งไฟล์พร้อม timestamp กลับ reviewer.

Catalog PASS ยืนยันว่าติดตั้ง invariant ตามแบบ แต่ไม่ใช่ authenticated two-client concurrency smoke. ไม่สร้างใบเสร็จทดลองบน production โดยอัตโนมัติ.

## เมื่อ error, timeout หรือ connection ขาด

หยุด ไม่ retry ไม่ DROP index และไม่แก้ข้อมูล. Transaction ที่ยังเปิดและถูก abort ต้อง ROLLBACK ใน connection เดิมเพื่อปล่อย lock; SQL Editor อาจใช้ connection ใหม่ จึงอย่าถือว่า ROLLBACK จากแท็บใหม่ยืนยันว่า session เก่าปิดแล้ว. หากยังมี lock/session ค้าง ให้ owner/DB operator ตรวจ session ก่อน.

เปิดการตรวจ read-only ใหม่: รัน POST-CHECK A/B และ index-health query เดิม พร้อมอ่าน pg_class ของชื่อที่ชน (query ด้านล่าง). ส่ง error เต็มและผลกลับ reviewer. ห้ามสรุปว่า migration ไม่ commit เพียงเพราะหน้าจอ error: อาจ commit แล้วแต่ post-check/การรับผลล้ม.

```sql
SELECT n.nspname, c.relname, c.relkind,
       i.indisunique, i.indisvalid, i.indisready, i.indislive,
       i.indrelid::regclass AS indexed_table,
       CASE WHEN i.indexrelid IS NOT NULL THEN pg_get_indexdef(i.indexrelid) END AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname = 'uq_receipts_one_active_per_delivery_invoice';
```

ถ้า index ที่ตรงแบบมีอยู่และ healthy ให้ review state ก่อน ไม่จำเป็นต้อง retry. ถ้าหาย/ผิดแบบ/invalid หรือมี non-index object ชื่อเดียวกัน ให้ reviewer ออกคำแนะนำเฉพาะกรณี. Rollback หลัง COMMIT โดยการ DROP index จะเปิด race อีกครั้ง จึงต้อง owner อนุมัติแยก.

## ขอบเขตผลและงานตามหลัง

Race loser จะหยุดที่ header INSERT ก่อน items/PATCH ต้นทาง แต่ receipt numbering trigger ทำงานก่อน unique check ได้ และ sequence อาจมีเลขเว้น ห้ามสรุปว่าไม่มี side effect ใดใน DB.

Cancelled → paid/pending จะถูกปฏิเสธด้วย 23505 หากมี active replacement อยู่แล้ว. การ cancel, void JV, เขียนรายการ และคืนสถานะ DI ยังเป็นหลาย request และไม่ atomic. UI อาจแสดงข้อความ DB ภาษาอังกฤษ.

หลัง post-run review ผ่าน จึงออก docs closeout/ledger ที่ระบุ owner-measured และหลักฐานจริง ทีม implement รอบนี้ห้ามเขียน ledger ว่า applied.
