# STAGING_B13A_RUNBOOK — Phase 606-B13a authenticated cash-payment behavioral verify

> **เป้าหมาย:** รัน `staging-verify-b13a-auth-payment.sql` + browser steps บน **scratch staging
> เดิมของ Phase 606-B12 เท่านั้น** เพื่อพิสูจน์เส้นทางจริง: authenticated temporary admin →
> `recordServicePayment()` → `record_service_payment_v2` → `service_payments` ledger →
> `postJournalForServicePayment()` → payment JV → retry exact intent → **duplicate-valid
> โดยไม่มี write ซ้ำ** — แยกความจริงสองชั้น `ledgerRecorded=true` (ledger ถูกเขียน) กับ
> `accountingPosted=true` (payment JV ถูกเขียนและตรวจสอบผ่าน)
>
> 🔴 **ห้ามรัน script นี้บน production ทุกกรณี** — ทุก mutating block/writer มี PRODUCTION
> INTERLOCK (`_staging_b13a_sentinel` หนึ่งแถว + confirm_text ตรง `current_date` ของ target DB
> session เป๊ะ) แต่ interlock เป็นตาข่ายชั้นสุดท้าย ไม่ใช่ข้ออนุญาตให้ลอง

---

## B1) Package vs execution — เส้นแบ่งที่ห้ามข้าม

- **Package phase (PR นี้) ห้ามรัน SQL ทุก statement** — ไฟล์ทั้งสามเป็น deliverable เท่านั้น
- **Execution เป็น owner-controlled เท่านั้น หลัง PR merge** — owner + reviewer คุมทีละสเตป
- **CI/guard test ไม่ใช่ behavioral proof** — guard พิสูจน์แค่ว่า script/runbook ตรง spec
- สถานะ **B13a = NOT RUN** (หมายถึง authenticated payment **behavioral** path) จนกว่าจะ execute
  จริงและมี certificate ใน `_staging_b13a_results`
- ⚠️ **ข้อเท็จจริงปัจจุบัน (2026-07-26):** owner รัน `R0` (17/17) + `S0.1`–`S0.4` บน scratch ไปแล้ว
  (สร้าง 3 ตาราง + `b13a_owner_bootstrap`) แล้ว **STOP** เพราะ fresh-create ACL ขัด exact-reuse
  contract — แก้ด้วย Phase 606-B13a.1 · ตาราง B13a ทั้งสามมี **0 rows** · **ไม่มี** `S0.5`–`S0.7` /
  PREFLIGHT / SEED / bootstrap invocation / payment / JV / certificate ใด ๆ · "NOT RUN" จึงหมายถึง
  behavioral payment path ไม่ใช่ว่าไม่มี statement ใดถูกรันเลย
- ห้าม claim `PAYMENT_BEHAVIOR_PASS` / `EXECUTION_COMPLETE` จาก CI เขียวหรือ code review

## B2) Scratch target — ใช้ scratch เดิมของ B12 เท่านั้น

- Target = scratch project เดิมของ Phase 606-B12 (มี `_staging_b12_sentinel` +
  `_staging_b12_results` **6 แถว ok=true** retained + B12TEST residual 0/0/0)
- **ห้ามใช้ scratch ใหม่** — ของเดิมไม่พร้อม (ถูกลบ/results หาย/residual ไม่ 0) = **STOP**
  แจ้ง reviewer ก่อน ห้าม re-provision เอง
- **ห้ามแตะ production ทุกกรณี** — ไม่มีขั้นตอนใดใน B13a ที่อ่านหรือเขียน production
- **ห้าม identity leak**: project ref/host/URL/actor UUID ของ scratch ห้ามปรากฏใน
  repo/report/chat/screenshot/console log ที่ส่งให้ทีม

## B3) Temporary admin (actor)

- **Owner สร้างเองใน Supabase Dashboard ของ scratch** (Authentication → Add user) —
  **ไม่มีการส่ง/ขอ credential ผ่านแชท/รายงานทุกกรณี**
- ต้องเป็น user แบบ **confirmed email** (ไม่มี pending invite flow)
- ก่อนสร้าง profile: **introspect `public.profiles` schema/FK จริง** (ตารางนี้ไม่มี DDL ในรีโป):

  ```sql
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' ORDER BY ordinal_position;
  SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.profiles'::regclass;
  ```

- ถ้า actor **ไม่มีแถว profiles** → INSERT แถวเดียว `role='admin'` (ระบุ NOT NULL columns
  ที่ introspect เจอครบ) — ถ้ามีแถวอยู่แล้วแต่ **role อื่น** → ลบแถวเดิมแบบ exact id
  (FK-zero ก่อนถ้ามี) แล้ว INSERT ใหม่ role='admin' ใน **transaction เดียว**
- **ห้าม UPDATE role** ของแถวเดิม (production มี role-lock guard — อย่าฝึกนิสัย bypass)
  และ**ห้าม disable trigger ใด ๆ** เพื่อให้ profile เข้า

## B4) Sentinel / seed / bootstrap

### B4.1 Precheck วันที่จาก target DB session (authority เดียว)

```sql
SHOW timezone;
SELECT current_date AS db_current_date, now() AS db_now;
```

- **`db_current_date` คือ authority เพียงค่าเดียว** สำหรับ suffix ของ sentinel
- ห้าม derive จาก clock ของเครื่อง owner / Bangkok / UTC · **ห้ามเปลี่ยน timezone
  configuration ของ session** · rerun precheck ทุกครั้งที่เปลี่ยน project/reconnect/ข้ามวัน

### B4.2 สร้าง sentinel (มือ · human interlock — script ห้ามสร้างอัตโนมัติ)

```sql
CREATE TABLE IF NOT EXISTS public._staging_b13a_sentinel (
  confirm_text text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
INSERT INTO public._staging_b13a_sentinel (confirm_text) VALUES ('B13A-STAGING-<YYYY-MM-DD>');
```

แทน `<YYYY-MM-DD>` ด้วยค่า `db_current_date` จาก precheck เป๊ะ — sentinel ต้องมี
**หนึ่งแถวเท่านั้น** (script ปฏิเสธเมื่อ 0 หรือ >1 แถว)

ใช้ B4.2 **เฉพาะการสร้างครั้งแรก** — ถ้ามีแถวอยู่แล้ว (reconnect / ข้ามวัน) **ห้าม INSERT ซ้ำ**
(จะกลายเป็น 2 แถว = interlock ปฏิเสธทุก block) ให้ใช้ **B4.3 atomic sentinel refresh** แทน

### B4.3 Atomic sentinel refresh (reconnect / เปลี่ยน project / ข้ามวัน)

sentinel เป็น **control token รายวัน** ไม่ใช่ behavioral evidence — เมื่อ `db_current_date` เลื่อนไป
confirm_text เดิมจะไม่ตรงและ **ทุก block จะ RAISE** ต้อง refresh ด้วย transaction ที่ self-gate ตัวเอง

**ต้องรัน B4.1 precheck ใหม่ก่อนเสมอ** แล้วแทน `<db_current_date>` ด้วยค่าที่อ่านจาก target DB
session แล้ว **รัน DO block ทั้งก้อนเป็น statement เดียวครั้งเดียว**:

```sql
DO $b13a_sentinel_refresh$
DECLARE
  v_n  bigint;
  v_ok boolean;
BEGIN
  -- (1) B12 retained truth — results 6 แถว ok=true ครบ
  SELECT count(*) = 6 AND bool_and(ok) INTO v_ok FROM public._staging_b12_results;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'SENTINEL REFRESH: _staging_b12_results ไม่ใช่ 6/6 ok=true — ไม่ใช่ scratch เดิมของ B12 STOP';
  END IF;
  -- (2) B12 residual jobs/JE/JL = 0/0/0 (predicates เดียวกับ B12 TEARDOWN)
  SELECT (SELECT count(*) FROM public.service_jobs WHERE job_no LIKE 'B12TEST-%')
       + (SELECT count(*) FROM public.journal_entries WHERE doc_no LIKE 'B12TEST-%')
       + (SELECT count(*) FROM public.journal_lines
           WHERE entry_id IN (SELECT id FROM public.journal_entries WHERE doc_no LIKE 'B12TEST-%'))
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SENTINEL REFRESH: B12 residual = % (ต้อง 0/0/0) — STOP', v_n;
  END IF;
  -- (3) reference counts ของ scratch เดิม
  SELECT count(*) INTO v_n FROM public.chart_of_accounts;
  IF v_n <> 68 THEN RAISE EXCEPTION 'SENTINEL REFRESH: chart_of_accounts = % (ต้อง 68) — STOP', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.account_mapping;
  IF v_n <> 36 THEN RAISE EXCEPTION 'SENTINEL REFRESH: account_mapping = % (ต้อง 36) — STOP', v_n; END IF;
  -- (4) ตาราง sentinel ต้องมีอยู่แล้ว (สร้างครั้งแรก = B4.2 เท่านั้น)
  IF to_regclass('public._staging_b13a_sentinel') IS NULL THEN
    RAISE EXCEPTION 'SENTINEL REFRESH: ไม่พบตาราง _staging_b13a_sentinel — ใช้ B4.2 สร้างครั้งแรกก่อน STOP';
  END IF;
  -- (5) แถวเดิมต้องเป็น 0 หรือ 1 เท่านั้น
  SELECT count(*) INTO v_n FROM public._staging_b13a_sentinel;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'SENTINEL REFRESH: sentinel มี % แถว (ต้อง 0 หรือ 1) — STOP ห้ามเดา', v_n;
  END IF;
  -- (6) ถ้ามีแถวเดิม confirm_text ต้องขึ้นต้น B13A-STAGING-
  IF v_n = 1 AND NOT EXISTS (SELECT 1 FROM public._staging_b13a_sentinel
                              WHERE starts_with(confirm_text, 'B13A-STAGING-')) THEN
    RAISE EXCEPTION 'SENTINEL REFRESH: confirm_text เดิมไม่ขึ้นต้น B13A-STAGING- — STOP ห้ามแทนที่';
  END IF;

  DELETE FROM public._staging_b13a_sentinel;
  INSERT INTO public._staging_b13a_sentinel (confirm_text)
  VALUES ('B13A-STAGING-<db_current_date>');

  -- (7) internal post-check — ไม่ผ่าน = rollback ทั้ง block (DELETE/INSERT ย้อนกลับด้วยกัน)
  SELECT count(*) = 1 AND bool_and(confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD'))
    INTO v_ok FROM public._staging_b13a_sentinel;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'SENTINEL REFRESH: post-check ไม่ผ่าน — ค่าที่พิมพ์ไม่ตรง db_current_date · rollback ทั้ง block';
  END IF;
  RAISE NOTICE 'SENTINEL REFRESH OK: sentinel = หนึ่งแถว ตรง current_date ของ DB session';
END
$b13a_sentinel_refresh$;
```

ข้อบังคับ:

- **self-gate + DELETE + INSERT + internal post-check อยู่ใน DO statement เดียว** — exception ใด ๆ
  rollback ทั้งบล็อกรวม DELETE/INSERT
- **ห้ามใช้ `BEGIN;`/`COMMIT;` ครอบหลาย statement** และ **ห้ามพึ่ง execution context ข้าม statement**
  (เคยเกิดจริงบนโปรเจกต์นี้: การเลือก Run ไม่คง transaction ข้ามชุด statement — ดูบันทึก
  Phase 606-b1.1 ใน `DB_MIGRATIONS_APPLIED.md`)
- `<db_current_date>` ต้องเป็น **owner-typed literal** จาก B4.1 precheck — ห้าม generate อัตโนมัติ
  ห้าม derive จาก local/Bangkok/UTC clock · ห้าม `SET TIME ZONE`
- sentinel 0 แถวก่อนเริ่ม อนุญาตเฉพาะเมื่อ self-gate ผ่านครบ · **sentinel >1 แถว = STOP**
- **owner ห้าม INSERT มือเปล่า** — block fail ให้แก้สาเหตุแล้วรัน **บล็อกเดิมทั้งก้อน** ใหม่
  (idempotent: DELETE 0 แถวไม่ error) ห้ามรันเฉพาะ INSERT
- คำสั่ง refresh อยู่ใน runbook นี้เท่านั้น — **package SQL ห้ามสร้าง/refresh/hardcode วันที่ sentinel**

หลัง DO สำเร็จ ให้รัน read-only post-check (human-readable):

```sql
SELECT
  current_date AS db_current_date,
  'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD') AS expected_text,
  count(*) AS total_rows,
  count(*) FILTER (
    WHERE confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
  ) AS exact_rows,
  bool_and(
    confirm_text = 'B13A-STAGING-' || to_char(current_date, 'YYYY-MM-DD')
  ) AS all_exact
FROM public._staging_b13a_sentinel;
```

ต้องได้ `total_rows = 1` · `exact_rows = 1` · `all_exact = true` — ไม่ครบสามข้อ = **STOP**

### B4.4 ลำดับรัน script (Supabase SQL Editor · per-statement · อ่านผลก่อนไปตัวถัดไป)

`R0` → `S0-ACL-RECOVERY` → `S0.1`–`S0.7` → `S0-RELOAD` → `PREFLIGHT` → `SEED` → **bootstrap**:

```sql
SELECT public.b13a_owner_bootstrap('<actor-uuid>'::uuid);
```

- **actor UUID พิมพ์เฉพาะใน SQL Editor ของ scratch** — เก็บใน scratch DB ได้ แต่ห้ามเผยแพร่
  ใน repo/report/chat/screenshot/console/export
- bootstrap คืน `run_id` — จดไว้ใช้กับ browser CAS/finalize (run_id ไม่ใช่ secret)
- **active run เดิมต้อง = 0** — พบ run ค้าง (แม้ terminal) = **stale run = STOP** ห้าม
  ลบ/takeover เอง (การลบ retained run = owner recovery phase แยกหลัง reviewer approval)

`S0-ACL-RECOVERY` (Phase 606-B13a.1) เป็น tri-state — อ่าน NOTICE แล้วตัดสินตามนี้:

| NOTICE / ผล | แปลว่า | ทำต่อ |
|---|---|---|
| `B13A S0 ACL RECOVERY NO-OP` | scratch สะอาด ไม่มี B13a object | ไปต่อ `S0.1` ได้ |
| `B13A S0 ACL RECOVERY PASS` | ถอน ACL surplus บน 4 objects แล้ว | **rerun `S0.1`–`S0.4`** พิสูจน์ reuse ก่อน แล้วค่อย `S0.5` |
| `EXCEPTION` ใด ๆ | state อยู่นอกขอบเขต recovery | **STOP** — owner-authorized recovery phase แยกหลัง reviewer approval |

- recovery **ไม่แตะข้อมูล** — mutation เดียวคือ `REVOKE ALL ... FROM service_role` บน 4 objects เป๊ะ
  (ลดสิทธิ์อย่างเดียว) · full schema/PK/CHECK/policy contract พิสูจน์ด้วย `S0.1`–`S0.4` reuse หลัง recovery
- **RECOVERY PASS ≠ payment behavioral PASS** — ยังไม่มี certificate ใด ๆ ออกจากขั้นนี้
- ห้าม manual `REVOKE`/`GRANT`/`ALTER` ACL นอก block นี้ · ห้าม drop/recreate object เพื่อเลี่ยงปัญหา

### B4.5 Resume sequence หลัง hotfix 606-B13a.1 merge

รันตามลำดับนี้เท่านั้น แล้ว **STOP รายงานผล**:

1. target/B12 read-only checks (B2) — ยืนยัน scratch เดิมของ B12 และไม่ใช่ production
2. DB date authority (B4.1)
3. atomic sentinel refresh (B4.3) + human-readable post-check
4. `R0` — ทุกแถวต้อง `found=true`
5. `S0-ACL-RECOVERY` — อ่าน NOTICE ตามตารางข้างบน
6. rerun `S0.1`–`S0.4` เพื่อพิสูจน์ reuse path (S0.1–S0.3 ตรวจ full table contract · S0.4 ตรวจ
   exact bootstrap contract รวม body byte-exact)
7. **STOP** และรายงานผล

**ห้ามรันในรอบ recovery verification เดียวกัน** จนกว่าจะมี execution-resume prompt + owner approval แยก:
`S0.5`–`S0.7` · `S0-RELOAD` · `PREFLIGHT` · `SEED` · bootstrap invocation · Auth user ·
payment/JV · certificates

### B4.6 บันทึก owner-run ที่ล้ม (DB date 2026-07-27) — package SHA `fefe477`

**เกิดอะไรขึ้น**

| ขั้น | ผล |
|---|---|
| STEP 1 target/state/ACL preflight | ผ่าน |
| STEP 2 atomic sentinel refresh | ผ่าน |
| STEP 3 `R0` | ผ่าน **17/17** |
| STEP 4 `S0-ACL-RECOVERY` | **ล้ม — SQLSTATE `42725`** |

**Root cause:** unknown-object inventory ต่อสตริง `c.relname || ':' || c.relkind` โดยไม่ cast
`pg_class.relkind` เป็น internal type `"char"` → `text || "char"` มี operator candidate สองตัว
(`anynonarray || text` และ `text || anynonarray`) → **ambiguous operator** · แก้แล้วใน Phase
606-B13a.1.1 ด้วย `c.relkind::text`

**ผลกระทบต่อ scratch (สำคัญ)**

- error เกิด **ก่อน** ถึง `REVOKE` ที่อนุญาตทั้ง 4 คำสั่ง
- `DO` เป็น statement เดียว → **rollback ทั้ง statement** · ไม่มี `REVOKE` ใดถูก commit
- **ไม่มี** business / payment / JV / accounting mutation
- ACL surplus ยังอยู่ใน **interrupted state เดิม** ไม่เปลี่ยนแปลง
- `S0.1`–`S0.4` **ยังไม่ได้ rerun** หลัง recovery · `S0.5`–`S0.7` **NOT RUN** · certificates **NOT ISSUED**
- 🚫 **ห้าม claim ว่า ACL recovery ผ่าน** และ **ห้าม claim ว่า authenticated payment behavioral verification ผ่าน**

**ข้อห้ามหลังเหตุการณ์นี้**

- 🚫 ห้ามแก้ SQL ด้วยมือใน SQL Editor เพื่อให้ผ่าน — ต้องแก้ที่ source แล้ว merge เท่านั้น
- 🚫 ห้าม rerun package SHA `fefe477` อีก (มี defect นี้อยู่)
- ต้องรอ hotfix merge แล้ว **เริ่ม execution prompt ใหม่** จาก SHA ใหม่

**เงื่อนไขของรอบใหม่ (ห้ามข้าม)**

- sentinel ต้อง derive จาก `current_date` ของ **target DB session รอบใหม่** เท่านั้น
- ต้องทำ target/state/ACL precheck และ `R0` **ใหม่ทั้งหมด**
- 🚫 **ห้ามถือผล STEP 1–3 ของวันที่/session เดิมเป็น authority ข้ามวันหรือข้าม session**

## B5) Isolated app (browser)

- Copy แอปเป็น **temp directory นอก repo** — ห้ามรันจาก working tree ของ repo
- `supabase-config.js` ของ **temp copy เท่านั้น** ชี้ scratch staging (repo ไม่ถูกแก้)
- เสิร์ฟด้วย port ใหม่ + **fresh browser profile** (ไม่ใช่ profile ประจำเครื่อง)
  — Windows ใช้ `npm.cmd`/`npx.cmd` ได้ตามปกติ เช่น
  `node scripts/static-server.js 4199` (หรือ `npm.cmd run …` เทียบเท่า) จาก temp copy
- เปิด **Network tab ค้างไว้ตลอด**: ทุก request ต้องไป scratch host เท่านั้น —
  **พบ request ไป production host แม้แต่ครั้งเดียว = STOP ปิด browser ทันที**
- **ห้ามมี service_role key ในทุกไฟล์/ทุกขั้น** — ใช้ anon key + login จริงเท่านั้น

## B6) Canonical binding + checkpoints

Canonical client เดียวของแอป:

```js
const sb = window.App?.state?.supabase;
```

- ห้ามสร้าง client ที่สอง (`createClient` ใหม่ใน console = ผิด) — auth refresh ของแอป
  อัปเดต `window._sbAccessToken` ให้เอง (main.js/api.js single-flight)
- ตรวจแบบ **boolean เท่านั้น** (ห้าม print token/JWT/URL เต็ม): config ชี้ scratch?,
  `(await sb.auth.getSession()).data.session !== null`?, actor id ตรง run?
  (เทียบกับ `run.actor_id` ไม่ได้โดยตรง — RLS ให้อ่าน run ได้เฉพาะ actor ที่ตรง จึงใช้
  "อ่าน run เจอ = binding ถูก" เป็น boolean proof), JWT มี `role=authenticated`?,
  network ไป scratch เท่านั้น?

**Binding checkpoints (ทุกจุดต้องบันทึกผล boolean):**

1. pre-login (session ต้อง NULL) · 2. post-login (session ไม่ NULL · actor ตรง)
3. actor/target/recognition proof: อ่าน run ผ่าน RLS เจอ · `validateRecognitionJv().ok===true`
   (import จาก `modules/accounting/service_jv_validate.js` ของ temp copy · อ่าน JE+lines
   ผ่าน sb ปกติ) · 4. ก่อน gates CAS · 5. ก่อน r1 / หลัง r1 · 6. ก่อน ID bind ·
7. หลัง r1 read-back (อ่าน run: IDs bound แล้ว) · 8. ก่อน r2 / หลัง r2 ·
9. หลัง r2 read-back · 10. ก่อน sign-out

**RPC exposure preflight (บังคับก่อน r1):**

```js
const { data, error } = await sb.rpc('b13a_rpc_exposed');
// data === true → S0 batch ถูก expose ใน PostgREST schema cache แล้ว
// error (เช่น PGRST202) → schema cache ยังไม่ reload → STOP ห้าม r1 (กลับไป S0-RELOAD)
```

## B7) Intent + r1 (ครั้งแรก — เขียนจริง)

### B7.1 Gates CAS (prepared → gates_passed)

หลัง checkpoints 1–4 ผ่านครบ (ok=true ทุกข้อ) — ขั้นนี้**ห้ามส่ง intent/IDs**:

```js
await sb.rpc('b13a_browser_transition', {
  p_run_id: RUN_ID, p_from_stage: 'prepared', p_to_stage: 'gates_passed', p_ok: true
});
```

### B7.2 Intent snapshot (gates_passed → r1_inflight) — สร้าง intent **ครั้งเดียว**

สร้างค่า**ครั้งเดียวแล้วเก็บตัวแปรไว้ใช้ทุกขั้น** (ห้าม regenerate ทุกกรณี):

```js
const INTENT = {
  p_service_job_id: JOB_ID,                      // จาก run (RLS read)
  p_amount: 100.00,                              // 100.00 เป๊ะ
  p_payment_method: 'cash',
  p_bank_coa_code: null,                         // เงินสด = ห้ามมี bank
  p_paid_at: new Date().toISOString(),           // สร้างครั้งเดียว · ต้องไม่ต่ำกว่า effective floor 2026-07-01 (เวลาไทย)
  p_idempotency_key: crypto.randomUUID(),        // สร้างครั้งเดียว
  p_slip_url: null,
  p_note: `B13ATEST cash run ${RUN_ID}`          // ผูก exact run
};
await sb.rpc('b13a_browser_transition', {
  p_run_id: RUN_ID, p_from_stage: 'gates_passed', p_to_stage: 'r1_inflight', ...INTENT
});
```

กติกา snapshot (บังคับโดย CAS ฝั่ง DB — อ่านให้เข้าใจก่อนรัน):

- transition นี้เป็น**ตัวเดียว**ที่ stored intent ยังเป็น NULL — CAS จะ assert ว่า intent
  columns **ทั้งหมดยัง NULL** ก่อน validate/เขียน · เขียน `NULL → exact value` ครั้งเดียว
  ใน UPDATE เดียวกับ stage transition (atomic) · แล้ว **read-back exact ทุก field**
- transition นี้**ห้าม pre-compare** caller intent กับ stored NULL values (ยังไม่มีของให้เทียบ)
- intent field ใดมีค่าแล้ว = CAS ปฏิเสธ (**ห้าม overwrite** — snapshot เป็น immutable)

### B7.3 r1 — ยิง RPC จริงผ่าน client function ของแอป

```js
const { recordServicePayment } = await import('./modules/accounting/auto_post.js');
const r1 = await recordServicePayment({
  serviceJobId: INTENT.p_service_job_id, amount: INTENT.p_amount,
  paymentMethod: INTENT.p_payment_method, paidAt: INTENT.p_paid_at,
  idempotencyKey: INTENT.p_idempotency_key, bankCoaCode: null, slipUrl: null,
  note: INTENT.p_note
});
```

เกณฑ์ r1 (ตรวจครบทุกข้อก่อน CAS):

- `r1.ok === true` · `r1.ledgerRecorded === true` · `r1.accountingPosted === true` ·
  `r1.inserted === true`
- `r1.paymentId` เป็น safe positive integer · `r1.jv.status === 'posted'` ·
  `r1.jv.entryId` เป็น safe positive integer
- `r1.paidTotal === 100` และ `r1.outstanding === 900`

ผ่านครบ → CAS bind IDs + evidence + transition (NULL-safe compare intent เดิมครบ 8 fields):

```js
await sb.rpc('b13a_browser_transition', {
  p_run_id: RUN_ID, p_from_stage: 'r1_inflight', p_to_stage: 'r1_recorded', ...INTENT,
  p_payment_id: r1.paymentId, p_payment_jv_entry_id: r1.jv.entryId,
  p_ok: true, p_inserted: true, p_ledger_recorded: true, p_accounting_posted: true,
  p_paid_total: r1.paidTotal, p_outstanding: r1.outstanding,
  p_jv_status: 'posted', p_jv_reason: r1.jv.reason ?? null
});
```

## B8) r2 — retry exact intent (duplicate-valid · ไม่มี write ซ้ำ)

1. CAS `r1_recorded → r2_inflight` ด้วย `...INTENT` เดิม + IDs เดิม (เทียบครบ 8 fields)
2. เรียก `recordServicePayment({...})` ด้วย **intent เดิมทุก field เป๊ะ** (ตัวแปร INTENT เดิม —
   paidAt/idempotencyKey เดิม ห้าม regenerate)
3. เกณฑ์ r2: `ok === true` · `ledgerRecorded === true` · `accountingPosted === true` ·
   `inserted === false` · `paymentId` **เท่า r1 เป๊ะ** · `jv.reason === 'duplicate-valid'` ·
   `jv.entryId` **เท่า r1 เป๊ะ** · `paidTotal === 100` · `outstanding === 900`
4. CAS `r2_inflight → r2_verified` ด้วย `...INTENT` + IDs เดิม + evidence r2
   (`p_inserted: false, p_jv_reason: 'duplicate-valid'`) — CAS ฝั่ง DB ตรวจซ้ำว่า
   payment ยัง 1 แถว · payment JV ยัง 1 ใบ · totals 100/900 (พิสูจน์ "ไม่มี write ซ้ำ" จาก DB จริง)

## B9) Failure / abort — fail-closed ทุกทาง

- **ledger เขียนแล้วแต่ JV ไม่สำเร็จ** (`ok=true, ledgerRecorded=true, accountingPosted=false`)
  → browser CAS failure transition → `failed_incomplete` พร้อม bind exact payment ID
  (+ JV entry ID เมื่อพบ orphan/invalid header — ไม่มี header = NULL ได้) — retain business
  rows/evidence ทั้งหมด · **STOP รอ recovery review** · ห้ามบังคับ valid JV ใน failure path
- **Unknown outcome** (RPC timeout/network — ไม่รู้ว่าเขียนหรือไม่) → **no guess/no retry** ·
  browser **ห้ามเรียก failure CAS** · คง `r1_inflight` → owner ค้นด้วย job + stored
  idempotency ใน SQL Editor: พบ payment → `classify_failed_incomplete` (bind exact IDs) ·
  ไม่พบ payment/JV และ paid total เดิม → `classify_failed_no_write` (zero-write proof)
- **Fail ก่อน r1** (gates ไม่ผ่าน/actor ใช้ไม่ได้) → owner `abort_no_payment` จาก
  prepared/gates_passed เท่านั้น — ตรวจ zero-write ครบ (payment/JV/reversal = 0 · paid
  total = 0) แล้วลบ seed ด้วย exact IDs ใน transaction เดียว + `ABORTED_NO_PAYMENT`
  — **ห้ามใช้หลังพบ payment write**
- **Fail หลัง r2/DB** (verify_db/teardown precondition ไม่ผ่านทั้งที่เงินเขียนแล้ว) →
  `classify_failed_incomplete` — retain exact payment/JV IDs · **ห้ามลบ ledger/JV** ·
  teardown transaction ล้ม = rollback ทั้ง transaction → stage คง `db_verified` ก่อน classify
- **Cleanup stages (`teardown_complete`/`auth_cleanup_complete`) = resumable**: เงื่อนไข
  ยังไม่ผ่าน → function RAISE โดยไม่แตะ state → แก้เฉพาะ external condition แล้วเรียก
  **owner action เดิมกับ run เดิม** — ห้ามสร้าง run ใหม่ · ห้าม clear context ·
  ห้ามเปลี่ยนเป็น failed_no_write
- ทำต่อไม่ได้ทุกกรณี = **STOP** และออก **owner-authorized recovery phase แยก**
  (terminal run ยังบล็อก run ใหม่โดยตั้งใจ)

## B10) Privacy / evidence

- **Actor UUID เก็บเฉพาะใน scratch DB** (คอลัมน์ `actor_id` + พิมพ์ใน SQL Editor) —
  ห้ามอยู่ใน repo/report/chat/screenshot/console log/export ใด ๆ (REPORT ของ script
  จงใจไม่ select `actor_id`)
- **Owner attestations = boolean/timestamp เท่านั้น** (3 แถว write-once) และประกาศชัดว่าเป็น
  **human attestation** ไม่ใช่ DB-observed browser proof
- ห้ามเผย credential/JWT/token/host/ref/key/local path ทุกช่องทาง — รายงานผลใช้ boolean +
  ตัวเลข count/ID (payment/JV/run) เท่านั้น
- Evidence เป็น typed columns — ห้ามยัด arbitrary JSON/ข้อความอิสระที่อาจพา identity หลุด

## B11) Cleanup (ทำตาม A15 ของ script — ลำดับบังคับ)

1. Browser: `await sb.auth.signOut()` → ยืนยัน canonical session เป็น NULL
   (`(await sb.auth.getSession()).data.session === null`)
2. Owner ลบ **exact temporary Auth user** ใน Dashboard ของ scratch → ตรวจใน SQL Editor:
   `SELECT count(*) FROM auth.users WHERE id = '<actor-uuid>';` = **0** และ
   `SELECT count(*) FROM public.profiles WHERE id = '<actor-uuid>';` = **0**
   — **นับเฉพาะแถวของ actor (exact id) ห้าม table-wide count**
3. Profile ค้างเพราะ FK → FK-zero แถวที่อ้างแบบ exact ก่อน แล้วลบ exact row —
   **Auth delete ไม่ได้ = STOP** (ห้ามหาทาง disable path/trigger เอง)
4. ทดสอบ **clean login ด้วย credential เดิมต้อง fail** (จาก fresh context)
5. ปิด browser/ปิด static server → ลบ **exact** browser profile directory + temp app copy
6. PowerShell: `Test-Path <temp-app-path>` และ `Test-Path <browser-profile-path>` ต้อง
   **false ทั้งคู่** (Windows — ใช้ `npm.cmd`/`npx.cmd` ในทุกคำสั่ง npm ของขั้นตรวจ)
7. Owner attest ใน SQL Editor (หลังทุกข้อบนผ่านจริงเท่านั้น):

   ```sql
   SELECT public.b13a_owner_finalize('<run-uuid>', 'attest_cleanup',
     NULL, true, true, true);   -- session_null · clean_login_rejected · local_cleanup
   SELECT public.b13a_owner_finalize('<run-uuid>', 'complete');
   ```

- **Retained evidence ห้ามลบ**: `_staging_b13a_runs`/`_staging_b13a_results`/
  `_staging_b13a_evidence` + ของ B12 ทั้งหมด คงไว้บน scratch หลัง `execution_complete`
  — การลบเป็น owner-authorized recovery/cleanup phase แยกหลัง reviewer approval เท่านั้น
- **`_staging_b13a_sentinel` ไม่ใช่ retained behavioral evidence** แต่เป็น **control token
  รายวัน** — เก็บ **current active row หนึ่งแถว** เท่านั้น · แถวที่หมดอายุ (confirm_text ไม่ตรง
  `db_current_date` ปัจจุบัน) **แทนที่ได้ผ่าน atomic sentinel refresh (B4.3) เท่านั้น** ·
  ห้าม archive ด้วย schema/table ใหม่ · ห้าม INSERT/DELETE มือเปล่านอกบล็อกนั้น

---

## เกณฑ์ผ่านรวม (ต้องครบทุกข้อ)

- `_staging_b13a_results`: `PAYMENT_BEHAVIOR_PASS` + `EXECUTION_COMPLETE` ของ run เดียวกัน
- `_staging_b13a_runs`: singleton row · stage `execution_complete` · IDs retained
- evidence: `gates`/`r1`/`r2` (browser_cas, ok=true) + attestations 3 แถว
  (owner_sql_attestation) · **ไม่มี** step `failure`
- business residual = 0 · exact actor auth/profiles = 0 · triggers `O` ครบ ·
  COA/mapping = baseline B12 (68/36)
- รายงานผลเป็น boolean/count/ID เท่านั้น → บันทึกลง HANDOFF + DB_MIGRATIONS_APPLIED.md
  (หมายเหตุ: staging run — ไม่ใช่ production migration) — **เฟสถัดไป (606-b2c/606-b3/607)
  ยังไม่ได้รับอนุญาตจากผลนี้ ต้องมี prompt/audit/owner approval แยก**
