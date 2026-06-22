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
| `supabase-phase505-rls-customer-deny.sql` | helper `is_customer_role()` (dual-source profiles.role+auth metadata, SECURITY DEFINER) + **43 RESTRICTIVE policies** ปิดช่อง customer OTP (role=authenticated จริง) อ่านตารางหลังร้าน + staff PII (audit **B3** รวม #4). **GROUP A 40** = deny เต็ม FOR ALL · **GROUP B 2** (`service_jobs`/`customers`) = deny-read/allow-insert (WITH CHECK true — signup+สั่งงาน) · **GROUP C 1** (`profiles`) = self-scope `id=auth.uid()` (login ไม่ fallback role='sales'). +4 ตารางจาก STEP0-A cross-check: `line_notify_settings`/`loyalty_settings`/`permissions`/`staff_sessions` (`staff_sessions` เปิด FOR ALL true อันตรายสุด); `store_settings` **เว้น** (public-by-design). SQL-only → build คงเดิม 504 | **2026-06-20** (owner รันใน SQL Editor) | ✅ **43 policies** verified; customer JWT → `staff`=0 / `profiles`=1; INSERT `service_jobs` (สั่งงาน) สำเร็จ; admin ขายจริง end-to-end ไม่ regress |
| `supabase-phase512-refund-credit-2180.sql` | seed COA `2180 เครดิตคงเหลือลูกค้า/เจ้าหนี้ลูกค้าจากใบลดหนี้` (liability, parent `2100`) + mappings `refund_credit`/`refund_exchange` = **Dr4110/Cr2180** — กัน credit/exchange refund fallback ไป `refund_cash` (Cr1110 เงินสดผี) (audit **S1**, build 512, code `5bbfbee` MERGED+LIVE). `ON CONFLICT DO UPDATE` idempotent + `NOTIFY pgrst`; ไม่แตะ `refund_cash`/`refund_transfer` | **2026-06-21** (owner รันใน SQL Editor) | ✅ STEP3 owner-confirmed: mappings 4 แถวถูก (cash Cr1110 · transfer Cr1130 · credit Cr2180 · exchange Cr2180); **COA 2180 ยืนยันผ่าน FK** `account_mapping.credit_account_code → chart_of_accounts(code)` — mapping insert สำเร็จ = แถว 2180 (liability/2100/true) มีจริง (ถ้าไม่มี FK reject 23503) |
| `supabase-phase514-credit-overpay-guard.sql` | function `_guard_credit_payment_overpay()` (SECURITY DEFINER) + trigger `trg_guard_credit_payment_overpay` **BEFORE INSERT OR UPDATE OF amount, sale_id** บน `credit_payments` — LOCK sales row FOR UPDATE (serialize) + reject `amount<=0`/non-credit/missing/`SUM(prior excl NEW.id)+NEW > total+0.01` (audit **S3**, build 514, code `f430543` MERGED+LIVE). DB last-line guard ทับ client check `credit_tracker.js:412` (race/direct REST/multi-device). ไม่แตะ RLS/COA/JV | **2026-06-21** (owner รันใน SQL Editor) | ✅ STEP0-a/b = 0 (ไม่มี payment บน non-credit sale / ไม่มี over-paid เก่า); STEP2 `tgenabled='O'` + `prosecdef=true`; **STEP3 negative**: overpay 101/total 100 → **ERROR SQLSTATE 23514** 'credit payment exceeds outstanding balance' (ไม่มี row เพิ่ม); **STEP4 normal**: 50/total 100 insert ผ่านใน txn; cleanup สะอาด |
| `supabase-phase517a-customer-credit-ledger.sql` | ตาราง `customer_credit_ledger` (customer_id bigint FK, source_type/source_id/source_key, `amount NUMERIC(14,2)` +เพิ่ม/−ใช้) + idempotency `uq_ccl_source`/`uq_ccl_source_key` + idx customer_id + RLS (PERMISSIVE staff อ่าน/insert เฉพาะ +amount refund หรือ `is_admin()` · RESTRICTIVE deny `is_customer_role()`) + RPC `redeem_customer_credit` (SECURITY DEFINER + advisory lock/customer + reject over-use/`amount<=0` 23514 + idempotent source_key) + backfill refund credit/exchange ที่มี customer_id. foundation เครดิตคงเหลือ 2180 (Phase 517a, build 517) — **ยังไม่มี caller RPC** (517b เรียก) | **2026-06-22** (owner รันใน SQL Editor) | ✅ RLS enabled=true; indexes ครบ; PostgREST reload แล้ว; STEP0 สะอาด |
| `supabase-phase520-credit-use-checkout-key.sql` | `ALTER sales ADD checkout_key text` + `uq_sales_checkout_key` (partial unique, legacy null ไม่ชน) + `ADD credit_used_amount numeric(14,2) default 0` + RPC `release_customer_credit(p_source_key)` (SECURITY DEFINER + advisory lock + idempotent กัน double-release). กัน double-sale/double-redeem (Phase 517b-2, build 520) — UI ใช้เครดิตปิด (#4ก, 517b-3 เปิด) | **2026-06-22** (owner รันใน SQL Editor) | ✅ STEP4 smoke live DB: 4a structure (2 RPC redeem/release + columns + index โผล่) · 4b double-sale (insert 2 sale checkout_key เดียว → ใบ 2 **ERROR 23505 uq_sales_checkout_key**) · 4c idempotent (redeem 2× → redeem_rows=1 · release 2× → release_rows=1 · **net=0.00**); ROLLBACK ลบ test ไม่กระทบ ledger จริง |

> โค้ดที่ใช้คอลัมน์/trigger เหล่านี้: #A trigger ทำงานทันที (ไม่ต้องรอ deploy); #C live build 499; #C-2 live build 500 (boonsukair.com + pages.dev). **B3** = RLS-only (PostgREST `NOTIFY pgrst` reload — ไม่ต้องรอ deploy; repo file sync ตรง live แล้ว @ branch phase-505 commit 3).

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

_อัปเดตล่าสุด: 2026-06-22 (Phase 517a customer_credit_ledger + redeem RPC — applied prod 2026-06-22: RLS enabled / indexes ครบ / PostgREST reload / STEP0 สะอาด)._
