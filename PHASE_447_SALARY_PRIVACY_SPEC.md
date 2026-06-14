# Phase 447 — Salary privacy from external accounting firm (Step 3 of 4)

> สถานะ: **DRAFT — รอ owner review** (ยังไม่ลงมือ ยังไม่ commit)
> ผู้เขียน: Claude (analyst mode) · 2026-06-14 · baseline build 446 (`6502e1f`)
> Step 3 จาก roadmap "accountant = สำนักงานบัญชีภายนอก" (ดู [[project-accountant-role]])

---

## เป้าหมาย

สำนักงานบัญชีภายนอก (role `accountant`) ต้องเห็น **ยอดรวมเงินเดือน** (เพื่อปิดงบ + ส่งสรรพากร) แต่ **ห้ามเห็นเงินเดือนรายคน** (ยอด/ชื่อพนักงาน). ตอนนี้รายคนรั่วถึง accountant **3 ทาง**

## บริบทที่ verify แล้ว (source of truth)

| # | Surface | รายคนโผล่ที่ | accountant เห็นเพราะ |
|---|---|---|---|
| 1 | ตาราง `staff_payroll` | per-row total_amount + employee_id | RLS SELECT ปัจจุบัน (ต้อง dump ยืนยัน — น่าจะกว้าง) |
| 2 | `expenses` category=salary | `description:"จ่ายเงินเดือน {ชื่อ}"` + amount รายคน — payroll.js:1525 | มีหน้า รายจ่าย + expenses RLS กว้าง |
| 3 | `journal_entries` payroll JV รายคน | Dr 5200 + ชื่อ + ยอด รายคน — auto_post.js:559 (`postJournalForPayroll`) | **`je_select USING(is_accountant())`** — Phase 445 ทำให้ accountant ได้ is_accountant()=true → ตกไป branch admin → เห็นทุก row + line |

**Key insight:** ระบบ *ออกแบบ* กัน non-admin ไว้แล้ว — `je_select_auto` (PERMISSIVE non-admin) ตั้งใจ **exclude `'staff_payroll'`** (supabase-phase92-46c:57) + `jl_select` admin-only. แต่ accountant หลุดผ่าน `je_select` (admin-level). ∴ ถ้าทำ JV เงินเดือนเป็น **aggregate (ไม่มีรายคน)** → accountant เห็นผ่าน je_select ได้โดยไม่รั่ว + RLS ปิด #1/#2

**โบนัส (pre-existing, ต้องกันไปด้วย):** `EXPENSE_CATEGORY_MAP.salary → payroll_salary` (auto_post.js:460) → ถ้า backfill รัน source `expenses` กับแถว salary → post Dr 5200 **ซ้ำ** กับ payroll JV (คนละ source_table, idempotency ไม่กัน) = double-count. Design นี้ต้องทำให้ **เงินเดือนลงบัญชีทางเดียว = aggregate JV เท่านั้น**

## หลักฐาน schema/flow (อ้างอิงตอน implement)

- `_markPaid` (payroll.js:1406) เมื่อกด "จ่าย" ยิง 3 อย่าง: (1) CAS PATCH staff_payroll `paid_at` (Phase 433 + DB trigger กัน double-pay) (2) `_createSalaryExpense` → แถว expenses (3) `postJournalForPayroll` → JV รายคน (payroll.js:1464-1473)
- `postJournalForPayroll` (auto_post.js:528) — Dr `mapping.debit_account_code` (payroll_salary = 5200) / Cr 1110 (cash) หรือ 1130 (transfer/cheque) · **gated ด้วย `_isAfterEffective(docDate)`** (L534 → ก่อน 1 ก.ค. = return null, ยังไม่มี JV จริง) · idempotent (source_table,source_id)=(staff_payroll, payroll.id)
- `journal_entries.source_id` = **BIGINT**, `source_table` = TEXT (foundation L58-59)
- `profit_loss.js:118-148` คำนวณงบจาก journal_entries(approved)+journal_lines → **sum per account_code** (∴ accountant ต้องเห็นยอด 5200 รวม)
- backfill.js:47-50 มี 2 source: `expenses` (vw_expenses_without_journal) + `payroll`/staff_payroll (vw_payroll_without_journal)
- staff_payroll.total_amount = DB GENERATED (ดู [[project-payroll-416-418-audit]]); period ใช้ (period_start, period_end)

---

## ⚠️ แนะนำแบ่ง 2 ไม้ (ปลอดภัย + review ง่าย)

ผสม money-path redesign + RLS ใน phase เดียว = เสี่ยง/smoke ยาก → แนะนำ:

- **447a (money path)** — เปลี่ยน JV เงินเดือน per-person → **aggregate/งวด** + ตัด double-count. ไม่มี RLS
- **447b (security/RLS)** — RLS ปิด `staff_payroll` + `expenses` salary จาก accountant. ไม่แตะ runtime money

ทำ 447a → smoke (preview, JV ลงถูก/บาลานซ์/ยอดรวมตรง) → merge → ค่อย 447b

---

## 447a — Aggregate payroll JV (money path)

### Scope (ไฟล์)
`modules/accounting/auto_post.js` · `modules/payroll.js` · `modules/accounting/backfill.js` · `index.html`+`sw.js` (bump) · `tests/*` (guard) · *(ถ้าทำปุ่ม)* payroll.js render

### สิ่งที่ต้องทำ
1. **เพิ่ม `postPayrollPeriodJournal(periodStart, periodEnd, opts)`** ใน auto_post.js (pure-ish + post):
   - โหลด staff_payroll ที่ `paid_at IS NOT NULL` ในงวด [periodStart, periodEnd]
   - รวมยอด: Dr **5200** = Σ total_amount · Cr **แยกตามวิธีจ่าย** (cash→1110, transfer/cheque→1130) เป็น subtotal (อาจได้ 2 บรรทัด Cr) → debit รวม = credit รวม (balance ต้องเป๊ะ)
   - description = `"เงินเดือนพนักงาน — งวด {label}"` (**ไม่มีชื่อ ไม่มีรายคน**) · docType "PV"
   - `source_table="payroll_period"`, `source_id` = BIGINT จาก period_end (YYYYMMDD เช่น 20260731) → idempotent ต่อ "งวด"
   - gate ด้วย `_isAfterEffective(docDate)` (docDate = period_end หรือวันโพสต์) · ข้ามถ้ายอด < 0.01 · ข้าม/skip ถ้ามี JV payroll_period ของงวดนี้แล้ว (v1: post ครั้งเดียว/งวด — delta = future)
   - **เหตุที่ source ใหม่ปลอดภัย:** payroll = admin-only → ผู้โพสต์ is_accountant()=true → je_insert ผ่าน (ไม่ต้องเพิ่ม whitelist) · non-admin ไม่เห็น (je_select_auto ไม่รวม payroll_period)
2. **ตัด per-person JV** ใน `_markPaid` (payroll.js:1464-1473) — เอา block `postJournalForPayroll` ออก (คง CAS PATCH + `_createSalaryExpense` ไว้เป็น operational/HR detail). `postJournalForPayroll` export คงไว้ได้ แต่ไม่มีใครเรียก (หรือ mark deprecated)
3. **กัน double-count:**
   - backfill `expenses` source → **exclude category in (salary, labor_hire, payroll)** (vw_expenses_without_journal หรือ filter ใน JS) — salary ไม่ลง JV ทาง expense
   - backfill `payroll` source → เปลี่ยนเป็น **post aggregate/งวด** (เรียก postPayrollPeriodJournal ต่อ distinct งวด) แทน per-row; vw_payroll_without_journal ปรับนิยาม (งวดที่ยังไม่มี payroll_period JV)
4. **โพสต์ aggregate ตอนไหน** (⚠️ owner เลือก — ผม **แนะนำ (i)**):
   - **(i)** ปุ่ม admin "ลงบัญชีเงินเดือนงวดนี้" ในหน้าเงินเดือน → เรียก postPayrollPeriodJournal(งวดปัจจุบัน) — ตรง practice บัญชี (โพสต์สรุปตอนปิดงวด) + append-only
   - (ii) auto ตอนจ่ายคนสุดท้าย (เปราะ — รู้ได้ยากว่าคนสุดท้าย)

### ห้ามแตะ
CAS mark-paid + trigger Phase 433 · staff_payroll schema · payroll_salary mapping · effective-date/zero/period-close/balance guards · sale/service/receipt/expense JV อื่น · RLS (ไม้ 447b) · per-person staff_payroll/expense rows (คงไว้เป็น HR detail)

### Tests
guard ใหม่ `payroll_aggregate_jv_guard.test.js`: (behavioral) postPayrollPeriodJournal — 3 คน cash+transfer → Dr 5200 รวม = Σ, Cr 1110+1130 ถูก subtotal, balance, **ไม่มีชื่อใน description**, idempotent งวดซ้ำ = ไม่เพิ่ม; (source-regex) `_markPaid` ไม่มี `postJournalForPayroll` แล้ว; backfill exclude salary category. + guard เดิม (auto_post/payroll/payroll_period/payroll_pay_race) ต้องเขียวครบ (ปรับที่ assert per-person JV)

### Verification
lint:errors 0 · npm test · test:e2e · bump build markers ครบ · CI · **owner smoke preview** (ซ้อม dated 1 ก.ค.: จ่าย 2-3 คน → กดปุ่มลงบัญชี → ดู สมุดรายวัน มี JV เดียว ยอดรวมถูก บาลานซ์ ไม่มีชื่อ; P&L 5200 = ยอดรวม)

---

## 447b — RLS hide individual salary from accountant (security)

### ⚠️ VERIFY-FIRST (owner รันใน SQL Editor ก่อน — ผม design RLS ไม่ได้ถ้าไม่เห็นของจริง)
```sql
-- (A) policy ปัจจุบันของ staff_payroll + expenses
SELECT polrelid::regclass AS tbl, polname, polcmd::text AS cmd, polpermissive,
       pg_get_expr(polqual, polrelid)      AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy
WHERE polrelid IN ('public.staff_payroll'::regclass, 'public.expenses'::regclass)
ORDER BY tbl, cmd, polname;
-- (B) is_accountant() body (ยืนยัน admin+accountant)
SELECT pg_get_functiondef('public.is_accountant'::regproc);
```

### สิ่งที่ต้องทำ (DRAFT — finalize หลังเห็น (A))
1. **`staff_payroll` SELECT** — เฉพาะ admin/owner. accountant + non-admin denied. ใช้ helper `is_admin()`/role check ที่มีอยู่ (ดูจาก dump). ระวัง: ต้องไม่ทับ trigger Phase 433 / ไม่ break payroll page ของ admin
2. **`expenses` SELECT** — accountant อ่านไม่เห็นแถว `category IN ('salary','labor_hire','payroll')` (เพิ่มเงื่อนไข `AND NOT (is_accountant() AND category IN (...))` หรือ policy แยก). ระวัง: ต้องไม่ break expense page ของ admin + ไม่บัง non-salary expense ของ accountant (เขายังต้องเห็นรายจ่ายอื่นเพื่อปิดงบ)
3. **journal_lines/journal_entries** — ไม่ต้องแก้ ถ้า 447a ทำ JV เป็น aggregate แล้ว (accountant เห็นยอดรวมผ่าน je_select ได้ ไม่รั่ว)
4. `NOTIFY pgrst, 'reload schema';` ท้าย migration · เขียนไฟล์ `supabase-phase447b-salary-privacy-rls.sql` เป็น record

### Tests
guard `salary_privacy_rls_guard.test.js` (source-regex บนไฟล์ SQL): staff_payroll SELECT ไม่ open ให้ accountant; expenses policy กัน salary category จาก accountant; มี NOTIFY pgrst. *(RLS จริง verify ด้วย owner smoke: login accountant → staff_payroll = 0 rows / expenses = ไม่มี salary / P&L 5200 ยังมียอด)*

### ห้ามแตะ
JV/auto_post (ไม้ 447a) · operational tables อื่น · is_accountant() (คง admin+accountant) · period-lock/JE RLS เดิม

---

## Decisions (owner ยืนยันแล้ว 2026-06-14) 🔒
1. ✅ **แบ่ง 447a (money) + 447b (RLS) แยกไม้** — ทำ 447a ก่อน smoke+merge แล้วค่อย 447b
2. ✅ **Timing = ปุ่ม admin "ลงบัญชีเงินเดือนงวดนี้"** (i) — append-only, โพสต์ตอนปิดงวด
3. ✅ **expenses salary ซ่อนจาก accountant เท่านั้น** — non-admin คงเห็น expenses เดิม (ไม่ขยาย scope)

## รายงานกลับ (ทุกไม้)
files / what changed / what NOT touched / lint·test·e2e / build+commit / live marker / known risks / **STOP รอ owner review + smoke** — ห้าม push main ถ้าไม่มี "merge ได้"
