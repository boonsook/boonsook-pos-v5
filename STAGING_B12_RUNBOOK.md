# STAGING_B12_RUNBOOK — Phase 606-B12 staging behavioral verify

> **เป้าหมาย:** รัน `staging-verify-b12-flow-immutable.sql` บน **STAGING เท่านั้น** เพื่อพิสูจน์ 5 กรณี
> (B12a–e) ว่า guard ที่ apply บน production แล้ว (606-a / 606-b1 / 606-b1.1) ทำงานตามสัญญา —
> **hard gate ก่อน 606-b3 activation**
>
> 🔴 **ห้ามรัน script นี้บน production ทุกกรณี** — script มี PRODUCTION INTERLOCK สองชั้น
> (ไม่มีตาราง sentinel + confirm_text วันนี้เป๊ะ = ทุก block ปฏิเสธ) แต่ interlock เป็นตาข่ายชั้นสุดท้าย
> ไม่ใช่ข้ออนุญาตให้ลอง. Owner + reviewer คุมการรันทีละสเตปแบบ 606-b1.1.

---

## STEP 0) Introspection บน PRODUCTION (read-only — รันก่อนทุกอย่าง)

`service_jobs` ไม่มี CREATE TABLE ในรีโป — ก่อน finalize seed INSERT owner ต้องรัน query
read-only นี้บน **production** แล้วส่งผลให้ reviewer:

```sql
SELECT table_name, column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('service_jobs', 'journal_entries', 'journal_lines')
 ORDER BY table_name, ordinal_position;
```

ใช้ผลเพื่อตรวจ 2 อย่างก่อนรัน script บน staging:

1. **คอลัมน์ `is_nullable = NO` ที่ไม่มี default และไม่อยู่ใน seed INSERT** ของ script →
   เพิ่มค่า explicit ใน INSERT (สำเนา staging เท่านั้น + จดในรายงานผล)
2. ★ **คอลัมน์ NOT NULL ที่ `column_default` อิง `auth.uid()`** — ใน SQL Editor
   `auth.uid()` = NULL → default ใช้ไม่ได้ → ต้อง supply ค่า explicit ใน seed เช่นกัน

query นี้ SELECT จาก catalog ล้วน — ไม่แตะข้อมูล ปลอดภัยบน production

## 0) เตรียม STAGING — เลือกทางเดียว

### ทาง A — Supabase preview branch (ถ้า plan รองรับ branching)

1. สร้าง branch จากโปรเจ็กต์ production (Dashboard → Branches → New branch)
   — branch ได้ schema + data ตาม flow ของ Supabase branching
2. เปิด SQL Editor **ของ branch** (เช็ค URL/ชื่อ project ทุกครั้งก่อนรันทุก statement)
3. รัน query ยืนยัน schema ครบ (ดูข้อ 2)

### ทาง B — scratch project + pg_dump

1. สร้าง Supabase project เปล่าใหม่ (คนละ org/ชื่อชัด ๆ เช่น `bsk-staging-b12`)
2. Dump จาก production:
   - **schema-only ทั้งหมด**: `pg_dump --schema-only --no-owner --no-privileges` →
     restore ลง scratch (ได้ tables + functions + triggers + indexes ครบ)
   - **ตารางที่ต้อง dump แบบมี data**: `chart_of_accounts` (ต้องมี 1200 active + 42xx),
     `account_mapping`
   - **ไม่ต้อง**: `accounting_periods` (ไม่มี row = ทุก period เปิด — `is_period_locked`
     คืน false, phase88-19-period-close.sql:71-72) · `profiles` (script รันเป็น system:
     `auth.uid() IS NULL` — ไม่แตะ `is_admin()` path)
3. หมายเหตุ: `service_jobs` **ไม่มี CREATE TABLE ในรีโป** — ต้องได้จาก dump เท่านั้น
   ห้ามเขียน DDL เดาเอง

## 1) สร้าง sentinel (มือ · บน staging เท่านั้น — คำสั่งอยู่ที่นี่ ไม่อยู่ใน script)

รันใน SQL Editor **ของ staging** (แทน `<YYYY-MM-DD>` ด้วย **วันนี้** เช่น `2026-07-17`):

```sql
CREATE TABLE IF NOT EXISTS public._staging_b12_sentinel (
  confirm_text text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
INSERT INTO public._staging_b12_sentinel (confirm_text) VALUES ('B12-STAGING-<YYYY-MM-DD>');
```

- script เทียบ `confirm_text = 'B12-STAGING-' || วันที่ปัจจุบัน` **เป๊ะ** — sentinel ค้างจากวันก่อน
  = ทุก block ปฏิเสธ (ตั้งใจ: บังคับ re-confirm ทุกวันที่รัน)
- ⚠️ **timezone**: `current_date` ใน script = วันที่ **UTC** (Supabase) — ถ้ารันช่วง **00:00–06:59 น. ไทย**
  ให้ใส่ confirm_text เป็นวันที่ UTC (= เมื่อวานตามเวลาไทย) หรือรอรันหลัง 07:00 น. ไทย
  (ใส่วันที่ไทยในช่วงนั้น = interlock ปฏิเสธ — fail-closed ไม่เสียหาย แค่ต้องแก้ sentinel)
- production ไม่มีตารางนี้ → ทุก block RAISE ทันที (default = ปฏิเสธ)

## 2) ยืนยัน schema ครบก่อนรัน (STEP 0 ใน script — SELECT อย่างเดียว)

รัน STEP 0 แล้วทุกแถวต้อง `found = true`:

| ต้องมี | ที่มา |
|---|---|
| `trg_service_jobs_metadata_insert` (enabled=O) | 606-a:196 — บังคับ flow=1 ทุก INSERT |
| `trg_service_jobs_metadata_update_guard` (O) | 606-a:238 — block 1→2 ทุก role |
| `trg_service_job_v2_freeze` (O) | b1:314 · function ฉบับ b1.1:108 (downgrade clause) |
| `trg_service_jobs_insert_close_guard` (O) | phase551:49 |
| `trg_service_jobs_close_guard` (O) | phase545:59 |
| `trg_je_lines_balance` บน journal_lines | phase498:110-112 (CONSTRAINT DEFERRED) |
| COA `1200` + `4220` active | phase88:186, 218 |
| `idx_je_source_unique` | phase88-auto-post.sql:23-25 |
| ตาราง `_staging_b12_sentinel` | สร้างเองข้อ 1 |

ขาดตัวใด = clone ไม่ครบ → กลับไปข้อ 0 ห้ามรันต่อ

## 3) รัน script ทีละส่วน (Supabase SQL Editor — per-statement)

> Editor ไม่คง transaction/temp object ข้าม statement (บทเรียน 606-b1.1) —
> script ออกแบบให้ **ทุกส่วนเป็น DO block เดี่ยวจบในตัว** อยู่แล้ว; รันเรียงบนลงล่าง
> อ่านผล NOTICE/ERROR ของแต่ละ statement ก่อนไปตัวถัดไป

ลำดับ: `STEP 0` → `S1.1` → `S1.2` → `S1.3` → `B12a` → `B12b` → `B12c` → `B12d` → `B12e`
→ `TEARDOWN` → `REPORT`

จุดที่ต้องรู้:

- **S1.2 คือขั้นเดียวที่ DISABLE trigger** (`trg_service_jobs_metadata_update_guard` — เพื่อ seed
  flow=2) — DISABLE→UPDATE→ENABLE→VERIFY อยู่ใน **transaction เดียว**: ล้มตรงไหน rollback
  ทั้งบล็อก trigger กลับมา enabled เอง; จบบล็อกมี assert `tgenabled='O'`
  **ห้ามแตะ trigger ฝั่ง journal ทุกกรณี** (นั่นคือของที่กำลังพิสูจน์)
- **หมายเหตุ status seed:** ใช้ `'progress'` ไม่ใช่ `'in_progress'` — DB constraint รับ
  pending/progress/done/delivered/closed/cancelled เท่านั้น (Phase 383/551)
- expected-exception ทุกเคสจับเฉพาะ `insufficient_privilege` (42501) + เทียบ SQLERRM
  substring — ถ้า error รหัสอื่นโผล่ (เช่น 23502) บล็อกนั้นล้มดัง = FAIL ให้หยุดรายงาน reviewer
- **B12d ห้ามรันซ้ำ** หลังผ่านแล้ว (d5 เปลี่ยน J2 เป็น closed — รันซ้ำจะเจอ precondition
  `status='delivered'` ไม่ผ่านโดยตั้งใจ); จะรันรอบใหม่ = TEARDOWN แล้ว seed ใหม่ทั้งชุด
- ถ้า INSERT seed ล้มด้วย NOT NULL ของ column ที่ไม่อยู่ใน script (schema production
  มี column ที่รีโปไม่รู้) — เพิ่มค่า column นั้นใน INSERT ของ **สำเนา staging** แล้วจดใน
  รายงานผล (ห้ามแก้ logic ของ test)

## 4) เกณฑ์ผ่าน (ทั้งหมดต้องครบ)

- `REPORT` แถวแรก: `_staging_b12_results` = **6 แถว ok=true** (B12a·b·c·d·e + TEARDOWN)
- `REPORT` แถวสอง: trigger บน `service_jobs` ทุกตัว `tgenabled='O'`
- ไม่มี ERROR ที่ไม่คาดระหว่างทาง (NOTICE `... PASS` ครบทุก case)
- เก็บ screenshot/ข้อความผลทุก statement ส่ง reviewer — บันทึกผลลง HANDOFF +
  DB_MIGRATIONS_APPLIED.md (หมายเหตุ: เป็น staging run — ไม่ใช่ migration production)

## 5) เก็บกวาดหลัง review จบ

```sql
DROP TABLE IF EXISTS public._staging_b12_results;
DROP TABLE IF EXISTS public._staging_b12_sentinel;
```

ทาง B: ลบ scratch project ทิ้งได้ทั้งโปรเจ็กต์ · ทาง A: ลบ preview branch

---

## ขอบเขต/ข้อจำกัดที่จงใจ

- script นี้ **ไม่ทดสอบ** RPC `record_service_payment_v2` / reversal / paid_total behavioral
  (ต้องมี auth context จริง — คนละชั้นกับ trigger guard; ถ้าต้องการ = เฟสแยก)
- ไม่ทดสอบ role ฝั่ง authenticated (script รันเป็น system) — เป้าหมายคือพิสูจน์ clause
  ที่ **ไม่ขึ้นกับ role**: v2 immutable (ทุก role) + activation gate 1→2 (ทุก role) +
  freeze matrix (ทุก role) ซึ่งครอบ B12a–e ครบ
- zero-writes ใช้ re-read เฉพาะคอลัมน์ที่ยืนยันว่ามี: `finance_flow_version`, `status`,
  `total_cost`, `note` (+ je/jl count — สองตารางนี้มี DDL ในรีโป
  `supabase-phase88-accounting-foundation.sql` ✓ verify แล้ว) — **ห้ามอ้าง `updated_at`**:
  `service_jobs` ไม่มี DDL ในรีโป และไม่มีโค้ด/SQL ใดอ้าง `service_jobs.updated_at`
  (grep = 0 hit เฉพาะ service_jobs; ตารางอื่นมีใช้ปกติ) → ไม่มีหลักฐานว่าคอลัมน์นี้
  มีอยู่บนตารางนี้
