# 🗄️ DB Migrations Applied (Prod) — Boonsook POS V5

> **Source-of-truth ว่า `supabase-*.sql` ไฟล์ไหน "ถูก apply ที่ Supabase prod แล้ว"** (owner รันเอง — DDL, Claude/CI ไม่รันแทน).
>
> **ทำไมต้องมีไฟล์นี้:** repo มีไฟล์ `.sql` ก็จริง แต่ **ไม่บอกว่า "รันที่ DB แล้วหรือยัง"** → audit/agent ที่อ่านแต่ repo จะไม่รู้สถานะ DB จริง. เคยพลาดมาแล้ว: audit #1 เข้าใจผิดว่า `profiles.role` "ไม่มีการป้องกัน" เพราะ trigger ถูก apply out-of-band ไม่เคย track ใน repo (ดู memory `project-profiles-role-lock`).
>
> 🔴 **กติกา go-forward:** ทุกครั้งที่ owner รัน SQL ที่ prod → **บันทึกที่นี่** (ไฟล์ + วันที่ + verify อย่างไร) ในเดียวกับ PR/HANDOFF.
> ⚠️ **verify-first:** ก่อนถือว่า "applied" ให้ยืนยันที่ DB จริง (pg_trigger / pg_indexes / information_schema) — ไม่ใช่เดาจาก repo หรือจากรายงาน.

---

## ✅ Applied — verified live this session (2026-06-19)

| SQL file | ทำอะไร (audit) | applied | verified อย่างไร |
|---|---|---|---|
| `supabase-phase498-je-lines-balance.sql` | CONSTRAINT TRIGGER `trg_je_lines_balance` (DEFERRABLE INITIALLY DEFERRED) บน `journal_lines` — บังคับ `SUM(lines)=header` + `Dr=Cr` (audit **#A**) | 2026-06-19 | ✅ negative test (ลบ line → `SET CONSTRAINTS ALL IMMEDIATE`) → **ERROR 23514** = trigger fires; STEP0a/0b = 0 (ข้อมูลสะอาด) |
| `supabase-phase499-sales-stock-reverted-at.sql` | `ALTER sales ADD stock_reverted_at` + backfill marker `[คืนสต็อกแล้ว]` → atomic claim กัน double-restock POS (audit **#C**, build 499) | 2026-06-19 | ✅ column มีจริง (REST select); backfill **marked=9 / missed=0** |
| `supabase-phase500-service-job-stock-markers.sql` | `ALTER service_jobs ADD stock_deducted_at, stock_reverted_at` + backfill 2 marker → atomic claim service-job (audit **#C-2**, build 500) | 2026-06-19 | ✅ 2 cols มีจริง; backfill **deduct 19/missed 0 · revert 6/missed 0** |
| `supabase-phaseB2-doc-no-sequence.sql` | `doc_number_counters` + `next_doc_number()` atomic (`ON CONFLICT` race-free) + 3 BEFORE-INSERT trigger override `qt_no`/`inv_no`/`receipt_no` (gapless ต่อวัน Asia/Bangkok) + 3 UNIQUE partial backstop + seed (audit **#B2**, build 503, PR #91) | 2026-06-19 | ✅ STEP0 = no dup; VERIFY `pg_trigger`=3 / `pg_indexes uq_%_no`=3 / `next_doc_number('QT','quotation')`=**QT20260619001** (format ถูก + sequential) |

> โค้ดที่ใช้คอลัมน์/trigger เหล่านี้: #A trigger ทำงานทันที (ไม่ต้องรอ deploy); #C live build 499; #C-2 live build 500 (boonsukair.com + pages.dev).

## 🟡 บันทึกไว้ก่อนหน้า — per CHANGELOG/HANDOFF/memory (⚠️ ควร verify ที่ DB ก่อนถือเป็น fact)

| SQL file | ทำอะไร | สถานะตามบันทึก |
|---|---|---|
| `supabase-phase497-loyalty-reverse-unique.sql` | partial unique `uq_loyalty_sale_reverse` ON `loyalty_points(ref_id) WHERE ref_type='sale_reverse'` (audit #4a/#D) | build 497 shipped — owner รัน SQL; **verify index ที่ DB** |
| `supabase-phase495-profiles-role-lock.sql` | guard `profiles.role` กัน self-promote (audit #1) | memory: live guard `guard_profile_role_update` มีอยู่ (apply out-of-band) — **verify trigger ที่ DB** |
| `supabase-phase482-freeze-deducted-equipment.sql` | mark งานช่างเก่าที่ตัดสต็อกแล้ว (กันตัดซ้ำตอน 482) | per CHANGELOG build 482 — verify |
| อื่น ๆ (refund-guard 92.61b / period-lock / je-rls 92-46 / stock-nonneg 437 ฯลฯ) | ดู `git log -- 'supabase-*.sql'` + CHANGELOG/HANDOFF | apply out-of-band หลายตัว — verify ที่ DB |

---

## วิธี verify ที่ DB (Supabase SQL editor — read-only)

```sql
-- trigger (เช่น trg_je_lines_balance)
SELECT tgname, tgenabled, tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = '<name>';
-- index (เช่น uq_loyalty_sale_reverse)
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = '<name>';
-- column (เช่น sales.stock_reverted_at)
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='<table>' AND column_name='<col>';
-- backfill ครบ (ตัวอย่าง service_jobs)
SELECT count(*) FILTER (WHERE note ILIKE '%[ตัดสต็อกแล้ว]%' AND stock_deducted_at IS NULL) AS deduct_missed FROM public.service_jobs;
```

_อัปเดตล่าสุด: 2026-06-19 (audit idempotency #A/#C/#C-2 + #B2 doc-no sequence — DDL applied prod, verified live)._
