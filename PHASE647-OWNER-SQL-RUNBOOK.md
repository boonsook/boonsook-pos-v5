# PHASE647 — Owner SQL Runbook (JE balance trigger · SECURITY DEFINER)

> ไฟล์ที่จะ apply: `supabase-phase647-je-balance-trigger-rls.sql` · SHA-256 `9b7fb286b9d08f8d1479b2876e42996a966048d65c3566ca75727b6677effd0f` · 3164 bytes · LF
> ไฟล์ preflight/post-check: `phase647-je-balance-preflight-readonly.sql` · SHA-256 `f34f5670e67530a8c43cb5229f36e814bbcff36d4a775e863ef04530d643c075` · 1870 bytes · LF
> เปลี่ยนเฉพาะ execution context ของ function เดิม (`SECURITY DEFINER` + `search_path` pin) ไม่แตะ policy/grant/data/trigger definition/สูตรเงิน
> ทุกขั้นเป็นของเจ้าของ (หรือ operator ที่เจ้าของ authorize และระบุ provenance ใน ledger) — ทีม implement/reviewer ไม่รัน SQL ใด ๆ บน production
> ลำดับ: **ก่อน apply** = independent review ของ PR (C1) → preflight §2 + หลักฐานเสริม §2C (C2) → อนุมัติ §3 (C3) · **apply** = §4 · **หลัง apply** = post-check §5 → ledger §6 → behavioral proof §7 (C4, อนุมัติแยก) · การปิด incident = phase แยก (§9)
> สถานะ ณ วันที่เขียน: ยังไม่มีผล C2, ยังไม่มีหลักฐานเสริม C2-S และ**ยังไม่มีคำอนุมัติ C3** — ทุกข้อใน §2–§3 เป็นเงื่อนไขของคำอนุมัติในอนาคต ไม่ใช่คำอนุมัติที่ได้รับแล้ว
> merge PR เข้า `main` ไม่ใช่การ apply SQL แต่เริ่ม workflow Deploy (trigger = push เข้า `main` ไม่มี path filter) แม้ build ไม่เปลี่ยน — การอนุมัติ merge/deploy เป็นของเจ้าของ แยกจาก runbook นี้

## 0. ข้อห้าม (ตลอด runbook)

- ห้ามวาง SQL ใน Supabase SQL Editor: ใช้ `psql -f` กับไฟล์ LF จาก git checkout เท่านั้น เพื่อให้ไฟล์ที่ apply เป็นไฟล์เดียวกับที่ตรวจ SHA-256 ในคำสั่งเดียวกัน (migration ไม่ได้สร้าง function ใหม่ วิธีวางไฟล์จึงไม่เปลี่ยน body ที่ md5 pin ตรวจ)
- ห้ามเรียก `psql -f` แยกจากการตรวจ SHA-256 ของ**ไฟล์บนดิสก์**: hash ของ git blob พิสูจน์ commit ไม่ได้พิสูจน์ไฟล์ใน working tree ที่ `psql` อ่านจริง — ใช้บล็อกคำสั่งของ §2/§4 ทั้งบล็อกเท่านั้น (ตรวจ hash แล้ว `&&` จึงเรียก psql)
- ห้ามเรียก `psql` ถ้ายืนยันไม่ได้ว่า `$BSK_DB_SESSION_URL` ชี้ปลายทางเดียวกับหลักฐาน C2 และกับที่คำอนุมัติ C3 ระบุ — บล็อกคำสั่งของ §4/§5 ตรวจข้อนี้เองก่อน (`p647_same_target`); เห็น `TARGET: MISMATCH`, `TARGET: REFUSED` หรือ `EVIDENCE: MISMATCH` = หยุด ห้ามแก้ตัวแปรหรือไฟล์ให้ผ่านเอง
- ห้ามใส่ query string ใน `BSK_DB_SESSION_URL` และห้ามมีตัวแปร `PGHOST` / `PGHOSTADDR` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGSERVICE` / `PGSERVICEFILE` ใน shell ที่รัน — libpq ใช้ค่าเหล่านี้เปลี่ยนปลายทางได้โดยที่ข้อความ user/host/db ของ URL ไม่เปลี่ยน
- หลังขั้น C2 ห้ามแก้ ย้าย หรือลบ `phase647-target-C2.txt`, `phase647-c2-record.txt`, `phase647-c2-result.txt` และห้ามสร้างไฟล์เหล่านี้เอง — เป็นบันทึกของ C2 รอบนั้น ที่ฟังก์ชัน `p647_c2_run` สร้างเมื่อ C2 สำเร็จเท่านั้น; เช่นเดียวกับ `phase647-c2s-result.txt` และ `phase647-c2s-record.txt` ของขั้น C2-S (`p647_c2s_run`)
- ห้าม apply ด้วยหลักฐานคนละชุดกับที่คำอนุมัติ C3 ระบุ: ผู้รันต้องคัด SHA-256 ของผล C2 และผล C2-S **จากข้อความอนุมัติ** ลงตัวแปรตาม §3 — ห้ามคำนวณจากไฟล์ในเครื่องแล้วเติมเอง; ไฟล์จริงไม่ตรงค่าที่อนุมัติ = `EVIDENCE: MISMATCH` และ psql ไม่ถูกเรียก
- ห้าม apply ก่อน §2 ผ่านตามเกณฑ์ และก่อนมีข้อความอนุมัติของเจ้าของที่อ้าง SHA-256 เต็มของ migration
- ผลลัพธ์ของ §4 ที่ไม่ชัด = `OUTCOME_UNKNOWN` → ทำตาม §8; ห้ามตัดสินเองว่าสำเร็จหรือไม่สำเร็จ และห้ามรันซ้ำ
- ห้ามกด Backfill ในแอป, ห้ามลบ header JV 663, ห้าม `npm run verify:je` กับ production (มันเขียน JE ทดสอบจริงแล้วลบด้วย admin DELETE)
- ห้ามส่ง connection string / รหัสผ่านผ่านแชทหรือใส่ในไฟล์ใด ๆ ใน repo

## 1. เตรียม (บนเครื่องเจ้าของ, Git Bash — git/sha256sum/psql อยู่ใน PATH)

1. `cd` เข้า root ของ checkout ของ PR branch (หรือ main หลัง merge) — ทุกคำสั่งใน runbook รันจาก directory นี้ เพราะ path หลัง `-f` เป็น relative
2. ยืนยันว่า commit ที่ checkout มี migration ที่ review แล้ว (ข้อนี้พิสูจน์ commit ไม่ได้พิสูจน์ไฟล์บนดิสก์):
   ```bash
   git cat-file blob HEAD:supabase-phase647-je-balance-trigger-rls.sql | sha256sum
   ```
   ต้องได้ `9b7fb286b9d08f8d1479b2876e42996a966048d65c3566ca75727b6677effd0f` — ไม่ตรง = หยุด แจ้ง reviewer
3. ยืนยันว่าสองไฟล์ไม่มีการแก้ค้างใน working tree:
   ```bash
   git status --short -- supabase-phase647-je-balance-trigger-rls.sql phase647-je-balance-preflight-readonly.sql
   ```
   ต้องไม่มี output — มี = หยุด ห้ามแก้ไฟล์เอง แจ้ง reviewer (การตรวจ hash ของไฟล์บนดิสก์จริงอยู่ในบล็อกคำสั่งของ §2/§4)
4. ใช้ **session-mode connection** (direct 5432 หรือ session pooler ของโปรเจกต์ production `rwmmjljelpcpwohwiplu`) ด้วย role `postgres` — migration ตรวจ `current_user = 'postgres'` เอง; เก็บ connection string ไว้ใน environment variable ของ shell เท่านั้น (ตัวอย่างชื่อ `$BSK_DB_SESSION_URL`). ต้องเป็น URL เต็มรูป `postgresql://USER[:PASSWORD]@HOST:PORT/DBNAME` (รองรับ URL มาตรฐานของ Supabase ทั้ง Direct `postgres@db.<ref>.supabase.co:5432/postgres` และ Session pooler `postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432/postgres` · USER = ตัวอักษร ตัวเลข `.` `_` `-` · HOST = ชื่อ host หรือ IPv4 ไม่รับ IPv6 literal · PORT = ตัวเลข · DBNAME = ตัวอักษร ตัวเลข `_` `-` · **รหัสผ่าน: อักขระทุกตัวที่ไม่ใช่ตัวอักษร ตัวเลข `.` `_` `~` `-` ต้อง percent-encode** เช่น `/` เป็น `%2F`, `?` เป็น `%3F`, `@` เป็น `%40`, `:` เป็น `%3A`; **ห้ามมี `%00`**) ในตัวแปรชื่อ `BSK_DB_SESSION_URL` เท่านั้น — ทุกบล็อกคำสั่งอ่านตัวแปรนี้. **ห้ามมี query string (`?…`) และห้ามมีหลาย host**; ถ้าต้องกำหนด TLS ให้ใช้ตัวแปร `PGSSLMODE` (ไม่กระทบปลายทาง) ไม่ใช่ `?sslmode=`
5. วางฟังก์ชันใน §1A ลงใน shell ที่จะใช้รัน (ครั้งเดียวต่อ shell)
6. ทำนอกเวลาขาย และไม่มีใครรัน DDL/งานบัญชีอื่นพร้อมกัน (lock_timeout 5s จะ STOP ถ้าชน)

### 1A. ฟังก์ชันผูกปลายทางและหลักฐาน — target check v4 (วางทั้งบล็อกใน Git Bash)

ไฟล์ต้นทาง: `p647-target-check-v4.sh` · SHA-256 `242dcd225614a5874ebd0588f32f5b5a5f8a7d1d6dd2f334d3ea9c279ec879ce` — ข้อความในบล็อกนี้เท่ากับไฟล์นั้นทุกตัวอักษร และคู่มือหลักฐานเสริม C2-S ใช้ไฟล์เดียวกัน

> ⚠️ **2026-11-20:** v4 ใน `p647_pins_ok` ยัง pin SHA-256 ของ migration เดิม `d8065a30cd51ed5f683d90a3961f936168023176ee3822054a85e64fa35d23c1` ส่วน migration ปัจจุบันคือ `9b7fb286b9d08f8d1479b2876e42996a966048d65c3566ca75727b6677effd0f` (pin md5 ใหม่ตามผล C2/C2-S) ดังนั้น `p647_c2_run` และ `p647_postcheck_run` บน checkout นี้จะ STOP ที่ hash check (psql ไม่ถูกเรียก) จนกว่าจะออก target check v5 และแทนบล็อกนี้ในรอบแยก ห้ามแก้บล็อกนี้เอง

```bash
# p647 target check v4 (Phase 647 runbooks). Paste the whole block into Git Bash once per shell.
p647_target() {
  local v
  for v in PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE; do
    if [ -n "${!v:-}" ]; then echo "TARGET: REFUSED ($v is set in this shell)" >&2; return 1; fi
  done
  local re='^postgres(ql)?://([A-Za-z0-9._-]+)(:([A-Za-z0-9._~-]|%[0-9A-Fa-f][0-9A-Fa-f])*)?@([A-Za-z0-9.-]+(:[0-9]{1,5})?)/([A-Za-z0-9_-]+)$'
  if [[ "${BSK_DB_SESSION_URL:-}" =~ $re ]]; then
    case "${BASH_REMATCH[3]:-}" in *%00*) echo "TARGET: REFUSED (the password must not contain an encoded NUL byte)" >&2; return 1;; esac
    echo "user=${BASH_REMATCH[2]} hostport=${BASH_REMATCH[5]} db=${BASH_REMATCH[7]}"
  else
    echo "TARGET: REFUSED (BSK_DB_SESSION_URL must be exactly postgresql://USER[:PASSWORD]@HOST[:PORT]/DBNAME - no query string, one host, every password character other than letters digits . _ ~ - percent-encoded)" >&2; return 1
  fi
}
p647_sha() { sha256sum "$1" 2>/dev/null | cut -c1-64; }
p647_pins_ok() {
  printf '%s  %s\n' d8065a30cd51ed5f683d90a3961f936168023176ee3822054a85e64fa35d23c1 supabase-phase647-je-balance-trigger-rls.sql f34f5670e67530a8c43cb5229f36e814bbcff36d4a775e863ef04530d643c075 phase647-je-balance-preflight-readonly.sql | sha256sum -c -
}
p647_c2_record_ok() {
  local t r s
  t="$(cat phase647-target-C2.txt 2>/dev/null)"
  r="$(cat phase647-c2-record.txt 2>/dev/null)"
  s="$(p647_sha phase647-c2-result.txt)"
  if [ -n "$t" ] && [ -n "$s" ] && [ "$r" = "target=$t result_sha256=$s psql_exit=0" ]; then echo "$t"; else return 1; fi
}
p647_c2_run() {
  local t rc s
  rm -f phase647-target-C2.txt phase647-c2-record.txt phase647-c2-result.txt phase647-c2s-result.txt phase647-c2s-record.txt
  if [ -e phase647-target-C2.txt ] || [ -e phase647-c2-record.txt ] || [ -e phase647-c2-result.txt ] || [ -e phase647-c2s-result.txt ] || [ -e phase647-c2s-record.txt ]; then
    echo "C2: STOP (cannot clear the previous C2 / C2-S files in this directory; psql not called)"; return 1
  fi
  t="$(p647_target)" || { echo "C2: STOP (target refused; psql not called)"; return 1; }
  if ! printf '%s\n' "$t" > phase647-c2-pending.txt || [ "$(cat phase647-c2-pending.txt 2>/dev/null)" != "$t" ]; then
    echo "C2: STOP (cannot write the target record in this directory; psql not called)"; return 1
  fi
  if ! p647_pins_ok; then rm -f phase647-c2-pending.txt; echo "C2: STOP (file hash check failed; psql not called)"; return 1; fi
  if ! printf '%s\n' "# p647 C2 run $(date -u +%Y%m%dT%H%M%SZ) $RANDOM$RANDOM" > phase647-c2-result.txt; then
    rm -f phase647-c2-pending.txt; echo "C2: STOP (cannot write the C2 result file; psql not called)"; return 1
  fi
  psql "$BSK_DB_SESSION_URL" -X -v ON_ERROR_STOP=1 -f phase647-je-balance-preflight-readonly.sql >> phase647-c2-result.txt 2>&1; rc=$?
  cat phase647-c2-result.txt 2>/dev/null
  s="$(p647_sha phase647-c2-result.txt)"
  if [ "$rc" != "0" ] || [ -z "$s" ] || [ "$(tr -d '\r' < phase647-c2-result.txt | grep -v '^$' | tail -1)" != "ROLLBACK" ]; then
    rm -f phase647-c2-pending.txt; echo "C2: FAILED or evidence incomplete (psql_exit=$rc) - no C2 record for this run"; return 1
  fi
  printf '%s\n' "target=$t result_sha256=$s psql_exit=0" > phase647-c2-record.txt
  mv phase647-c2-pending.txt phase647-target-C2.txt
  if [ "$(p647_c2_record_ok)" != "$t" ]; then
    rm -f phase647-target-C2.txt phase647-c2-record.txt phase647-c2-pending.txt; echo "C2: STOP (could not store the C2 record)"; return 1
  fi
  echo "C2: RECORDED ($t) result_sha256=$s"
}
p647_c2s_run() {
  local q="${1:-}" now rec c2 s rc st line
  rm -f phase647-c2s-result.txt phase647-c2s-record.txt
  if [ -e phase647-c2s-result.txt ] || [ -e phase647-c2s-record.txt ]; then
    echo "C2-S: STOP (cannot clear the previous C2-S files in this directory; psql not called)"; return 1
  fi
  now="$(p647_target)" || now=""; rec="$(p647_c2_record_ok)" || rec=""
  if [ -z "$now" ] || [ "$now" != "$rec" ]; then echo "C2-S: STOP (target does not match a valid C2 record; psql not called)"; return 1; fi
  c2="$(p647_sha phase647-c2-result.txt)"
  if [ "$(p647_sha "$q")" != "e763a2fe329a91f7009237849cbeca8a7ba8d517bb9145f9da08664769402b8d" ]; then
    echo "C2-S: STOP (C2-S query file missing or hash mismatch; psql not called)"; return 1
  fi
  if ! printf '%s\n' "# p647 C2-S run $(date -u +%Y%m%dT%H%M%SZ) $RANDOM$RANDOM c2_result_sha256=$c2" > phase647-c2s-result.txt; then
    echo "C2-S: STOP (cannot write the C2-S result file; psql not called)"; return 1
  fi
  PGCLIENTENCODING=UTF8 psql "$BSK_DB_SESSION_URL" -X -v ON_ERROR_STOP=1 -P pager=off -x -f "$q" >> phase647-c2s-result.txt 2>&1; rc=$?
  cat phase647-c2s-result.txt 2>/dev/null
  s="$(p647_sha phase647-c2s-result.txt)"; st=""
  if [ "$rc" = "0" ] && [ "$(tr -d '\r' < phase647-c2s-result.txt | grep -v '^$' | tail -1)" = "ROLLBACK" ]; then st=complete
  elif [ "$rc" = "3" ] && grep -q 'S2b_function_definitions' phase647-c2s-result.txt && grep -q 'permission denied for function pg_control_system' phase647-c2s-result.txt && [ "$(grep -c 'ERROR' phase647-c2s-result.txt)" = "1" ]; then st=s4_unavailable
  fi
  if [ -z "$s" ] || [ -z "$st" ] || [ "$(p647_sha phase647-c2-result.txt)" != "$c2" ]; then
    echo "C2-S: FAILED or evidence incomplete (psql_exit=$rc) - no C2-S record for this run"; return 1
  fi
  line="target=$now c2_result_sha256=$c2 c2s_result_sha256=$s status=$st"
  printf '%s\n' "$line" > phase647-c2s-record.txt
  if [ "$(cat phase647-c2s-record.txt 2>/dev/null)" != "$line" ]; then
    rm -f phase647-c2s-record.txt; echo "C2-S: STOP (could not store the C2-S record)"; return 1
  fi
  echo "C2-S: RECORDED (status=$st) c2_result_sha256=$c2 c2s_result_sha256=$s"
}
p647_same_target() {
  local now rec c2 c2s r
  now="$(p647_target)" || now=""; rec="$(p647_c2_record_ok)" || rec=""
  if [ -z "$now" ] || [ "$now" != "${P647_APPROVED_TARGET:-}" ] || [ "$now" != "$rec" ]; then
    echo "TARGET: MISMATCH - STOP (psql not called)"; return 1
  fi
  c2="$(p647_sha phase647-c2-result.txt)"; c2s="$(p647_sha phase647-c2s-result.txt)"; r="$(cat phase647-c2s-record.txt 2>/dev/null)"
  if [ -z "$c2" ] || [ "$c2" != "${P647_APPROVED_C2_SHA:-}" ]; then
    echo "EVIDENCE: MISMATCH - STOP (psql not called): the C2 result is missing or is not the one named in the C3 approval"; return 1
  fi
  if [ -z "$c2s" ] || [ "$c2s" != "${P647_APPROVED_C2S_SHA:-}" ]; then
    echo "EVIDENCE: MISMATCH - STOP (psql not called): the C2-S result is missing or is not the one named in the C3 approval"; return 1
  fi
  if [ "$r" != "target=$now c2_result_sha256=$c2 c2s_result_sha256=$c2s status=complete" ] && [ "$r" != "target=$now c2_result_sha256=$c2 c2s_result_sha256=$c2s status=s4_unavailable" ]; then
    echo "EVIDENCE: MISMATCH - STOP (psql not called): the C2-S record is missing or does not belong to this C2 result"; return 1
  fi
  if ! head -1 phase647-c2s-result.txt | grep -q "c2_result_sha256=$c2"; then
    echo "EVIDENCE: MISMATCH - STOP (psql not called): the C2-S result was not produced from this C2 result"; return 1
  fi
  echo "TARGET: OK ($now)"
  echo "EVIDENCE: OK (c2_result_sha256=$c2 c2s_result_sha256=$c2s)"
}
p647_postcheck_run() {
  local rc
  rm -f phase647-postcheck-result.txt
  if [ -e phase647-postcheck-result.txt ]; then echo "POST-CHECK: STOP (cannot clear the previous post-check result; psql not called)"; return 1; fi
  p647_same_target || return 1
  if ! p647_pins_ok; then echo "POST-CHECK: STOP (file hash check failed; psql not called)"; return 1; fi
  if ! printf '%s\n' "# p647 post-check run $(date -u +%Y%m%dT%H%M%SZ) $RANDOM$RANDOM" > phase647-postcheck-result.txt; then
    echo "POST-CHECK: STOP (cannot write the post-check result file; psql not called)"; return 1
  fi
  psql "$BSK_DB_SESSION_URL" -X -v ON_ERROR_STOP=1 -f phase647-je-balance-preflight-readonly.sql >> phase647-postcheck-result.txt 2>&1; rc=$?
  cat phase647-postcheck-result.txt 2>/dev/null
  echo "POST-CHECK: psql_exit=$rc result_sha256=$(p647_sha phase647-postcheck-result.txt) (phase647-postcheck-result.txt)"
  [ "$rc" = "0" ]
}
```
- `p647_target` พิมพ์เฉพาะ user / host[:port] / dbname ของ URL และ**ปฏิเสธ** (พิมพ์ `TARGET: REFUSED …` ทาง stderr โดยไม่พิมพ์ URL ปลายทาง หรือรหัสผ่าน) เมื่อ URL ไม่ตรงรูป `postgresql://USER[:PASSWORD]@HOST[:PORT]/DBNAME` ตามข้อจำกัดของ §1 ข้อ 4: มี query string, หลาย host, IPv6 literal, อักขระนอกรูปใน user/host/port/dbname, รหัสผ่านที่มีอักขระสงวนแบบดิบ (เช่น `/` `?` `#` `:` `@` ช่องว่าง หรือ `%` ที่ไม่ตามด้วยเลขฐานสิบหกสองหลัก), **รหัสผ่านที่มี `%00`** — หรือเมื่อมีตัวแปร `PGHOST` / `PGHOSTADDR` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGSERVICE` / `PGSERVICEFILE` ใน shell
- `p647_c2_run` คือขั้น C2 ทั้งขั้น (§2): ลบบันทึก C2 **และผล/บันทึก C2-S** ของรอบก่อน → ตรวจปลายทาง → เขียนบันทึกปลายทางชั่วคราวแล้วอ่านกลับ → ตรวจ SHA-256 ของไฟล์บนดิสก์ → เขียนบรรทัดแรกของ `phase647-c2-result.txt` (`# p647 C2 run <เวลา UTC> <เลขสุ่ม>`) แล้วเรียก psql กับไฟล์ preflight เก็บผลต่อท้าย → เมื่อ psql exit 0 และผลจบด้วย `ROLLBACK` เท่านั้น จึงเขียน `phase647-target-C2.txt` และ `phase647-c2-record.txt`. ขั้นใดไม่ผ่าน = `C2: STOP …` หรือ `C2: FAILED …` และไม่มีบันทึก C2 ของรอบนั้น
- `p647_c2_record_ok` ถือว่าบันทึก C2 ใช้ได้เมื่อสามไฟล์อยู่ครบและ SHA-256 ของ `phase647-c2-result.txt` ตรงกับที่ `phase647-c2-record.txt` บันทึกไว้
- `p647_c2s_run <ไฟล์ query>` คือขั้นหลักฐานเสริม C2-S (คู่มือ C2-S): ลบผล/บันทึก C2-S ของรอบก่อน → ปลายทางปัจจุบันต้อง = บันทึก C2 ที่ใช้ได้ → ตรวจ SHA-256 ของไฟล์ query → เขียนบรรทัดแรกของ `phase647-c2s-result.txt` ซึ่งระบุ `c2_result_sha256=` ของผล C2 ที่ใช้ในรอบนั้น → เรียก psql เก็บผลต่อท้าย → เมื่อเก็บผลได้ครบจึงเขียน `phase647-c2s-record.txt` (`target=… c2_result_sha256=… c2s_result_sha256=… status=complete|s4_unavailable`). ไม่ผ่าน = `C2-S: STOP …` หรือ `C2-S: FAILED …` และไม่มีบันทึก C2-S ของรอบนั้น
- `p647_same_target` คือด่านก่อน apply และก่อน post-check — ผ่านเมื่อครบทุกข้อ: (1) ปลายทางปัจจุบัน = `P647_APPROVED_TARGET` = บันทึก C2 ที่ใช้ได้ (2) SHA-256 ของ `phase647-c2-result.txt` ในเครื่อง = `P647_APPROVED_C2_SHA` (3) SHA-256 ของ `phase647-c2s-result.txt` ในเครื่อง = `P647_APPROVED_C2S_SHA` (4) `phase647-c2s-record.txt` และบรรทัดแรกของผล C2-S อ้าง SHA-256 ของผล C2 ชุดเดียวกัน. ค่าหาย ไม่ตรง หรืออ่านไฟล์ไม่ได้ = `TARGET: MISMATCH` หรือ `EVIDENCE: MISMATCH` และคืนค่า error ทำให้ psql ไม่ถูกเรียก (รวมกรณีตัวแปรยังไม่ถูกตั้งใน shell ที่เปิด `set -u`)
- `p647_postcheck_run` คือขั้น post-check (§5): ผ่านด่านเดียวกับ apply แล้วเก็บผลแยกใน `phase647-postcheck-result.txt`
- ข้อจำกัด: เป็นการผูกฝั่ง client จากข้อความของ URL ตัวแปร `PG*` ที่ระบุ และ SHA-256 ของไฟล์ในเครื่องผู้รัน — รูป URL ที่รับแคบกว่าที่ libpq รับโดยเจตนา เพื่อไม่ให้ตัวตรวจกับ libpq ตีความ URL ต่างกัน; ไม่ตรวจ DNS / hosts file / proxy และ**ไม่ใช่**หลักฐานฝั่ง server ว่า host นั้นคือโปรเจกต์ใด (ตัวตนโปรเจกต์ยังเป็นคำยืนยันของเจ้าของ ประกอบกับ §2C ข้อ S4); ด่านนี้เชื่อค่าที่ผู้รันคัดมาจากคำอนุมัติ จึงไม่กันผู้รันที่จงใจใส่ค่าอื่น

## 2. Preflight read-only (C2) — รันก่อนอนุมัติ

รันจาก root ของ checkout ใน shell ที่วางฟังก์ชัน §1A แล้ว:
```bash
p647_c2_run
```
- ฟังก์ชันทำตามลำดับ: ลบบันทึก C2 และผล/บันทึก C2-S ของรอบก่อน (ลบไม่ได้ = หยุด) → ตรวจรูป URL และตัวแปร `PG*` → เขียนบันทึกปลายทางชั่วคราวแล้วอ่านกลับ — **เขียนไม่ได้ = `C2: STOP (cannot write the target record …)` พร้อมข้อความ error ของระบบไฟล์ และ psql ไม่ถูกเรียก** → ตรวจ SHA-256 ของสองไฟล์บนดิสก์ (ต้องเห็น `…: OK` สองบรรทัด; `FAILED` = psql ไม่ถูกเรียก) → เรียก psql กับไฟล์ preflight ซึ่งเป็น `BEGIN READ ONLY … ROLLBACK` ไม่เขียนอะไรลงฐาน
- ผลของ psql ทั้งหมด (stdout และ stderr) ถูกเก็บใน `phase647-c2-result.txt` และแสดงบนจอ; บรรทัดแรกของไฟล์คือ `# p647 C2 run <เวลา UTC> <เลขสุ่ม>` ทำให้ผลของแต่ละรอบมี SHA-256 ไม่ซ้ำกันแม้ catalog ไม่เปลี่ยน — คำอนุมัติ C3 จึงผูกกับผลของรอบที่ reviewer ตรวจเท่านั้น
- **สำเร็จ** = บรรทัดสุดท้ายคือ `C2: RECORDED (user=… hostport=… db=…) result_sha256=…` — เมื่อนั้นจึงมี `phase647-target-C2.txt` (บรรทัดปลายทาง ไม่มี credential) และ `phase647-c2-record.txt` (ผูกปลายทางกับ SHA-256 ของ `phase647-c2-result.txt` ของ**รอบเดียวกัน**). เปิด `phase647-target-C2.txt` ตรวจว่า user / host:port / dbname คือ production ที่ตั้งใจ
- `C2: STOP …` หรือ `C2: FAILED or evidence incomplete …` = **ไม่มีบันทึก C2 ของรอบนี้** — บันทึกของรอบก่อนถูกลบตั้งแต่ต้นรอบ จึงใช้ไฟล์เก่าหรือไฟล์ค้างแทนผลรอบนี้ไม่ได้ → หยุด ห้ามสร้างหรือแก้ไฟล์บันทึกเอง แจ้ง reviewer; ถ้ามี `phase647-c2-result.txt` ให้ส่งไปด้วยในฐานะผลของรอบที่ล้ม
- สามไฟล์นี้คือหลักฐานของ C2 รอบนี้และอยู่นอก git — ห้าม commit ห้ามแก้ ห้ามย้าย จนจบ §5; ขั้น §4/§5 จะได้ `TARGET: MISMATCH` และขั้น C2-S จะได้ `C2-S: STOP …` ถ้าไฟล์ใดหายหรือ `phase647-c2-result.txt` ไม่ตรงกับ SHA ที่บันทึก
- ส่งสามไฟล์ให้ reviewer **เป็นไฟล์** (ไม่คัดลอกข้อความ เพราะ SHA-256 คิดจาก byte จริงของไฟล์) แล้วเทียบ `phase647-c2-result.txt` กับตารางด้านล่าง

### 2A. ค่าที่เจ้าของเทียบเองแบบตรงตัว (ทุกแถว)

| ผลลัพธ์ | ค่าที่คาด (ตาม source @7cab179) | ถ้าต่าง |
|---|---|---|
| `database_name`, `pg_version` | บันทึกค่า (ไม่ใช่หลักฐานตัวตนโปรเจกต์) | — |
| `database_role` | `postgres` | STOP — เปลี่ยน role/connection |
| `read_only` | `on` | STOP |
| แถว function | มี 1 แถว: `function_name` = `public.enforce_je_lines_balance()` | 0 แถว = STOP → reviewer |
| `function_owner` | `postgres` | STOP → reviewer |
| `security_definer` (ก่อน apply) | `f` | ถ้า `t` อยู่แล้ว = มีคน apply ไปแล้วหรือ function ถูกแก้ → STOP → reviewer (ห้าม apply) |
| `function_config` (ก่อน apply) | ว่าง (NULL) — source `supabase-phase498-je-lines-balance.sql:62-65` ไม่มี `SET` | มีค่า = STOP → reviewer |
| `function_body_md5` | `cd812932adf24bc9887a432c084db477` (body ดิบบน production ที่อ่านใน C2/C2-S 2026-11-20 = source `supabase-phase498-je-lines-balance.sql` ตัดคอมเมนต์ + CRLF; ค่า LF ของ source `77709a3f7271068a44cce7307f68dd14` ไม่ผ่าน) | STOP → reviewer (migration จะ STOP เองด้วย) |
| `reads_header` / `reads_lines` / `compares_header` | `t` / `t` / `t` | STOP → reviewer |
| ตาราง `journal_entries`, `journal_lines` | 2 แถว: `table_owner=postgres`, `rls_enabled=t`, `force_rls=f` ทั้งสอง | STOP → reviewer |
| trigger | 1 แถว: `trg_je_lines_balance`, `tgenabled=O`, `tgdeferrable=t`, `tginitdeferred=t`, `trigger_function` = `public.enforce_je_lines_balance()` | STOP → reviewer |

### 2B. Policies 6 แถว — เจ้าของเทียบ `cmd`/`roles`; reviewer เทียบ `qual`/`with_check`

| `tablename` · `policyname` | `cmd` | `roles` | `qual` (USING) ตาม source | `with_check` ตาม source | source @7cab179 |
|---|---|---|---|---|---|
| `journal_entries` · `je_select` | `SELECT` | `{authenticated}` | `public.is_accountant()` | ว่าง | `supabase-phase92-46b-force-reset.sql:66-68` |
| `journal_entries` · `je_select_auto` | `SELECT` | `{authenticated}` | `source_table IS NOT NULL AND source_id IS NOT NULL AND source_table IN` 7 ค่า: `sales, expenses, service_jobs, receipts, delivery_invoices, credit_payments, refunds` (**ไม่มี** `staff_payroll`) | ว่าง | `supabase-phase92-46c-je-rls-final.sql:43-58` |
| `journal_entries` · `je_delete` | `DELETE` | `{authenticated}` | `public.is_accountant()` | ว่าง | `supabase-phase92-46b-force-reset.sql:75-77` |
| `journal_entries` · `je_insert_auto` | `INSERT` | `{authenticated}` | ว่าง | `public.is_accountant() OR (source_table IS NOT NULL AND source_id IS NOT NULL AND source_table IN` 8 ค่า: `sales, expenses, staff_payroll, service_jobs, receipts, delivery_invoices, credit_payments, refunds)` | `supabase-phase92-46b-force-reset.sql:80-98` |
| `journal_lines` · `jl_select` | `SELECT` | `{authenticated}` | `public.is_accountant()` | ว่าง | `supabase-phase92-46b-force-reset.sql:104-106` |
| `journal_lines` · `jl_insert_auto` | `INSERT` | `{authenticated}` | ว่าง | `public.is_accountant() OR EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = entry_id AND je.source_table IS NOT NULL AND je.source_id IS NOT NULL AND je.source_table IN` 8 ค่าเดียวกับ `je_insert_auto` `)` | `supabase-phase92-46b-force-reset.sql:117-137` |

- เจ้าของ: ต้องมีครบ 6 แถว ไม่มีแถวซ้ำ และ `cmd` + `roles` ตรงตารางทุกแถว — ขาด/เกิน/ต่าง = STOP → reviewer
- `qual`/`with_check`: PostgreSQL พิมพ์ expression ในรูปที่ deparse แล้ว (วงเล็บ, cast `::text`, `= ANY (ARRAY[…])`, ชื่อ function แบบมี schema) ซึ่ง**ไม่ตรงตัวอักษร**กับ source; ผู้เขียน runbook ไม่ได้รัน PostgreSQL จึงไม่ให้ expected string แบบ byte-exact — เจ้าของส่งไฟล์ผลเต็มให้ reviewer และ **reviewer ต้องตอบเป็นลายลักษณ์อักษร**ว่า `qual`/`with_check` ทั้ง 6 แถวตรง source เชิงความหมายหรือไม่ (ระบุแถวที่ต่าง) ก่อนถึง §3

### 2C. หลักฐานเสริมที่ต้องมีก่อน C2 ผ่าน (C2-S) — ยังไม่มีในวันที่เขียน

ไฟล์ preflight ของ candidate (ตรึง byte-exact ใน PR นี้) ไม่ตรวจรายการต่อไปนี้ จึง**ให้ C2 ผ่านจากผล 2A/2B อย่างเดียวไม่ได้**:
- policy อื่นบน `journal_entries` / `journal_lines` นอก 6 ชื่อที่ query กรอง (เช่น `je_update`, `jl_update`, `jl_delete` ใน source เดียวกัน, policy กลุ่ม deny-customer, หรือ policy ที่ถูกเพิ่มนอก repo) และชนิด PERMISSIVE/RESTRICTIVE ของทุก policy
- `public.is_accountant()` และ helper อื่นที่ effective policies เรียก (body / owner / security / config)
- ตัวตนของโปรเจกต์ฝั่ง server และแถวข้อมูลธุรกิจใด ๆ รวม JV 663
ตัวอย่างผลกระทบ: policy INSERT แบบ permissive ที่เพิ่มมาอาจขยายกลุ่ม entry ที่ caller เขียน lines ได้ และเมื่อ function เป็น DEFINER ข้อความ error ของ trigger จะเผยผลรวม lines ของ entry ในขอบเขตนั้น ซึ่งตาราง 2B มองไม่เห็น

C2 ผ่านได้ต่อเมื่อมี**หลักฐานเสริมแบบ read-only (C2-S)** ครบ:
- S1 รายการ policy **ทั้งหมด**บนสองตาราง ทุกคำสั่ง: ชื่อ, cmd, roles, PERMISSIVE/RESTRICTIVE, `qual`, `with_check`
- S2 นิยามของ `public.is_accountant()` และ helper ทุกตัวที่ policy ใน S1 เรียก: body, owner, SECURITY DEFINER/INVOKER, config
- S3 ข้อประเมินลายลักษณ์อักษรของ reviewer จาก S1+S2: (ก) root cause ที่วิเคราะห์ยังสอดคล้องหรือไม่ (ข) ตาม effective policies caller ที่ไม่ใช่ accountant เขียน lines ได้กับ entry กลุ่มใด และข้อสังเกต disclosure ข้อ 6 ครอบขอบเขตนั้นหรือไม่
- S4 ถ้าอ่านได้ในชุดเดียวกัน: ตัวระบุฝั่ง server ของฐานข้อมูล เพื่อประกอบคำยืนยันปลายทาง
query ของ C2-S **ไม่อยู่ใน PR นี้** — ต้องถูกเขียน ผ่าน independent review และเจ้าของ authorize ให้รันเป็นขั้น read-only ของตัวเอง ที่ปลายทางเดียวกับ `phase647-target-C2.txt`. ขั้น C2-S รันด้วย `p647_c2s_run` (§1A) ซึ่งเขียน `phase647-c2s-result.txt` และ `phase647-c2s-record.txt` ที่ระบุ SHA-256 ของผล C2 รอบเดียวกัน. ไม่มี C2-S = สถานะ C2 คือ `NOT_PASSED` และออกคำอนุมัติ C3 ไม่ได้

กลไกของ migration เอง (function เป็น DEFINER ของ table owner อ่านข้าม RLS ได้เมื่อไม่ FORCE — migration ตรวจ owner/RLS/FORCE ที่ `supabase-phase647-je-balance-trigger-rls.sql:48-54`) ไม่ขึ้นกับ S1–S2 แต่การตัดสินว่า**ควร** apply หรือไม่ขึ้นกับ S3

**เกณฑ์ผ่าน C2 (ครบทั้ง 4):** (1) 2A ตรงทุกแถว (2) 2B `cmd`/`roles` ตรงทุกแถว (3) คำยืนยันลายลักษณ์อักษรของ reviewer เรื่อง `qual`/`with_check` ของ 2B (4) C2-S ครบ S1–S3 และ reviewer ไม่พบข้อขัดข้อง. ไม่ครบข้อใด = `NOT_PASSED` ส่งให้ reviewer

## 3. อนุมัติ (C3) — เงื่อนไขของคำอนุมัติในอนาคต

ณ วันที่เขียน runbook นี้**ยังไม่มีคำอนุมัติ C3** รายการด้านล่างคือสิ่งที่คำอนุมัติของเจ้าของต้องมีเมื่อถึงเวลา ไม่ใช่คำอนุมัติที่ได้รับแล้ว:
(ก) SHA-256 เต็มของ migration (ข) **ปลายทาง**: project ref ของ production และบรรทัดจาก `phase647-target-C2.txt` คัดลอกทั้งบรรทัด (`user=… hostport=… db=…`; ไม่มี credential) (ค) **SHA-256 ของไฟล์ผล C2** (`phase647-c2-result.txt`) และ **SHA-256 ของไฟล์ผล C2-S** (`phase647-c2s-result.txt`) — ต้องเป็นค่าที่ **reviewer คำนวณจากไฟล์ที่ตนได้รับและตรวจแล้ว** (ตามที่บันทึกในแบบประเมิน S3) ไม่ใช่ค่าที่ผู้รันอ่านจากเครื่องตัวเอง (ง) วัน/เวลา change window (จ) ยืนยันว่า C2 ผ่านครบ 4 ข้อ (ฉ) คำยืนยันของ reviewer เรื่องตาราง 2B และข้อประเมิน S3 (ช) รับหรือไม่รับข้อสังเกต disclosure ข้อ 6 (ซ) ผู้รัน (เจ้าของเอง หรือชื่อ operator)

ก่อน §4 ผู้รันตั้งค่าสามตัวนี้ใน shell ที่จะ apply โดย**คัดลอกจากข้อความอนุมัติ C3 เท่านั้น** — ไม่ใช่จาก URL ปัจจุบัน และห้ามคำนวณจากไฟล์ในเครื่องแล้วเติมเอง:
```bash
export P647_APPROVED_TARGET='<บรรทัดปลายทางจากข้อความอนุมัติ C3>'
export P647_APPROVED_C2_SHA='<SHA-256 ของผล C2 จากข้อความอนุมัติ C3>'
export P647_APPROVED_C2S_SHA='<SHA-256 ของผล C2-S จากข้อความอนุมัติ C3>'
```
ถ้ามีการรัน C2 หรือ C2-S รอบใหม่หลังคำอนุมัติ ไฟล์ผลจะมี SHA-256 ใหม่ (บรรทัดแรกต่างกันทุกรอบ) → **คำอนุมัติเดิมใช้ไม่ได้** ต้องให้ reviewer ตรวจผลรอบใหม่และเจ้าของออกคำอนุมัติใหม่
เก็บข้อความอนุมัติไว้ใส่ ledger

## 4. Apply ครั้งเดียว

รันทั้งบล็อกนี้ (4 บรรทัด) จาก root ของ checkout ใน shell ที่ตั้งค่าสามตัวของ §3 แล้ว:
```bash
p647_same_target && sha256sum -c - <<'P647_PINS' && psql "$BSK_DB_SESSION_URL" -X -v ON_ERROR_STOP=1 -f supabase-phase647-je-balance-trigger-rls.sql
9b7fb286b9d08f8d1479b2876e42996a966048d65c3566ca75727b6677effd0f  supabase-phase647-je-balance-trigger-rls.sql
f34f5670e67530a8c43cb5229f36e814bbcff36d4a775e863ef04530d643c075  phase647-je-balance-preflight-readonly.sql
P647_PINS
```
- `TARGET: MISMATCH` (อาจมีบรรทัด `TARGET: REFUSED …` บอกเหตุนำหน้า) = ปลายทางปัจจุบันไม่ตรงกับ C2 หรือกับคำอนุมัติ C3 หรือยืนยันไม่ได้ หรือบันทึก C2 ไม่ครบ/ไม่ตรงกับไฟล์ผล C2 → psql ไม่ถูกเรียก ไม่มีอะไรเกิดกับ DB → หยุด แจ้ง reviewer
- `EVIDENCE: MISMATCH …` = ไฟล์ผล C2 หรือ C2-S ในเครื่องหาย อ่านไม่ได้ ถูกแก้ หรือไม่ตรงกับ SHA-256 ที่คัดมาจากคำอนุมัติ C3 หรือบันทึก C2-S ไม่ได้อ้างผล C2 ชุดเดียวกัน → psql ไม่ถูกเรียก ไม่มีอะไรเกิดกับ DB → หยุด แจ้ง reviewer
- `FAILED` ที่บรรทัด hash = psql ไม่ถูกเรียก ไม่มีอะไรเกิดกับ DB → หยุด แจ้ง reviewer
- ไฟล์เป็น `BEGIN … COMMIT` ก้อนเดียว; มี preflight DO ของตัวเอง — ถ้าข้อใด STOP จะเห็น `ERROR: Phase647 STOP: …` และ transaction ย้อนกลับทั้งหมด (ไม่มี partial apply)
- เก็บ stdout/stderr ทั้งหมด + exit code เป็นไฟล์ทุกกรณี แล้วจำแนกผล**จากไฟล์นั้น**:
  - **สำเร็จ** (ต้องครบทุกข้อ): เห็น `TARGET: OK`, `EVIDENCE: OK` และ `OK` ของ hash สองบรรทัดของการเรียกครั้งนี้ · output ครบตั้งแต่ต้นจนจบไม่ถูกตัด · บรรทัดสุดท้ายจาก server คือ `COMMIT` · exit code 0 → ไป §5
  - **ล้มชัดเจน** (ต้องครบทุกข้อ): เห็น `TARGET: OK`, `EVIDENCE: OK` และ hash `OK` ของการเรียกครั้งนี้ · output ครบตั้งแต่ต้นไม่ถูกตัด · มี `ERROR` ที่ระบุได้ว่าเป็น error จาก server ของการเรียกครั้งนี้และเกิด**ก่อน** `COMMIT` · ไม่มี `COMMIT` ใน output · process psql จบแล้วและ exit code ไม่ใช่ 0 → ไม่ต้องทำอะไรกับ DB; ส่งไฟล์ผลให้ reviewer; ห้ามรันซ้ำจนมีคำตัดสิน
  - **กรณีอื่นทั้งหมด** = `OUTCOME_UNKNOWN` → §8 เช่น connection หลุด · output ถูกตัดหรือเก็บไม่ครบ · มี `ERROR` แต่ระบุไม่ได้ว่าเป็นของ server / ของการเรียกครั้งนี้ / เกิดก่อนหรือหลัง `COMMIT` · ไม่เห็นทั้ง `COMMIT` และ `ERROR` · exit code ไม่ทราบหรือขัดกับ output · หน้าจอค้าง

## 5. Post-check (read-only)

รันจาก root ของ checkout ใน shell เดียวกับ §4 (ค่าสามตัวของ §3 ยังตั้งอยู่):
```bash
p647_postcheck_run
```
- ใช้**หลักฐานชุดเดียวกับ apply**: ฟังก์ชันผ่านด่านเดียวกับ §4 (ปลายทาง + SHA-256 ของผล C2 และ C2-S เทียบค่าจากคำอนุมัติ C3) แล้วตรวจ SHA-256 ของไฟล์บนดิสก์ก่อนเรียก psql; ไม่ผ่าน = `TARGET: MISMATCH` / `EVIDENCE: MISMATCH` / `POST-CHECK: STOP …` และ psql ไม่ถูกเรียก
- ผลถูกเก็บ**แยก**ใน `phase647-postcheck-result.txt` (ลบของรอบก่อนก่อนเขียน) — ไม่แตะ `phase647-c2-result.txt`, `phase647-c2s-result.txt` และไฟล์บันทึกที่คำอนุมัติ C3 อ้าง; บรรทัดท้ายคือ `POST-CHECK: psql_exit=… result_sha256=…`
เทียบ**ครบทุกแถว**ของ 2A และ 2B ใน `phase647-postcheck-result.txt` กับ `phase647-c2-result.txt` (ไม่นับบรรทัดแรกที่ขึ้นต้น `# p647`):
- เปลี่ยนได้เฉพาะ 2 ช่อง: `security_definer` จาก `f` เป็น `t` และ `function_config` จากว่างเป็นค่าที่มี element `search_path=pg_catalog, pg_temp` (migration มี postcheck ของ element นี้ก่อน `COMMIT`; บน fixture ในเครื่อง psql 17 แสดงเป็น `{"search_path=pg_catalog, pg_temp"}`)
- ทุกช่องอื่น (owner, md5, flags ของตาราง, trigger, policies 6 แถวทั้ง `cmd`/`roles`/`qual`/`with_check`) ต้องเท่าผลก่อน apply ทุกตัวอักษร — ช่องอื่นเปลี่ยน = แจ้ง reviewer ทันที
Post-check ผ่าน = catalog อยู่ใน state ที่ตั้งใจ **ไม่ใช่**หลักฐานว่า auto-post ของพนักงานถูกต้อง (ดู §7)

## 6. บันทึก ledger

ย้ายแถว `supabase-phase647-je-balance-trigger-rls.sql` จาก PENDING ไป "✅ Applied — <วันที่>" ใน `DB_MIGRATIONS_APPLIED.md` พร้อม: SHA-256, ปลายทาง (บรรทัดจาก `phase647-target-C2.txt`), วัน/เวลา, ผู้รัน, ชื่อไฟล์ผล §2/§4/§5 ที่เก็บไว้, SHA-256 ของผล C2 และ C2-S ที่คำอนุมัติระบุ, ข้อความอนุมัติ §3, และข้อจำกัดของหลักฐาน (target = owner attestation; Gap ใน 2C) — แล้วอัปเดต HANDOFF/SESSION_START/CHANGELOG ผ่าน PR ปกติ (docs only)

## 7. Behavioral proof (C4) — หลัง apply เท่านั้น, อนุมัติแยก

C4 ไม่ใช่เงื่อนไขก่อน apply ทำหลัง §5 ผ่าน และต้องมีคำอนุมัติแยกของเจ้าของที่ระบุ**ก่อนขาย**ครบ 4 อย่าง (ข้อ 2–3 ยังไม่มีในวันที่เขียน — ต้องปิดก่อน C4 ไม่ใช่ก่อน apply):
1. สเปกบิลสังเคราะห์: สินค้าทดสอบ, จำนวน, ยอดรวม, วิธีชำระ, คลังที่ตัดสต็อก, บัญชีผู้ขาย (ต้องไม่ใช่ admin/accountant — บันทึก `profiles.role` ของบัญชีนั้นที่อ่านในวันทดสอบ)
2. JV ที่คาด: reviewer เขียนรายการ lines ที่คาด (`account_code`, `debit`, `credit` ต่อบรรทัด) จาก `modules/accounting/auto_post.js` และ account mapping ที่ใช้จริงกับวิธีชำระนั้น — runbook นี้ไม่กำหนดรหัสบัญชีเอง
3. query read-only สำหรับอ่านผลของบิลนั้น ต้องผ่าน review แยกพร้อมคำอนุมัติ C4 — PR นี้**ไม่มี** SQL ดังกล่าว (Gap เปิดเผย)
4. สิ่งที่จะทำกับบิลหลังทดสอบ (เก็บไว้ / ยกเลิกตาม flow ปกติ)

เกณฑ์ผ่าน (ครบทุกข้อ):
- บิล: ยอดรวมเท่าที่อนุมัติ และสต็อกเปลี่ยนตามจำนวนที่อนุมัติ
- `journal_entries` ที่ `source_table='sales'` และ `source_id` = id ของบิลนั้น มี **1 แถวพอดี** (ไม่มี posting ซ้ำ ไม่มี header ค้าง) สถานะ `approved` และ `total_debit` = `total_credit` = ยอดบิล
- `journal_lines` ของ entry นั้น: จำนวนบรรทัด และ (`account_code`, `debit`, `credit`) ทุกบรรทัด**ตรงรายการที่ reviewer เขียนไว้ก่อนขาย**; ผลรวม debit = ผลรวม credit = ยอด header
- ไม่มี error 23514 ระหว่างขาย (เก็บ console/network ของ client เป็นหลักฐาน)

ไม่นับเป็นหลักฐาน: ป้าย "ลงบัญชีแล้ว" บนใบเสร็จ (ดูแค่ header), การที่ผลรวม lines เท่า header อย่างเดียว (ผ่านได้แม้ลงผิดบัญชีหรือยอดไม่ตรงบิล), และผลจากบัญชี admin/accountant
ไม่ผ่านข้อใด = หยุด เก็บหลักฐาน แจ้ง reviewer; ห้ามแก้ JV เอง ห้าม Backfill; ห้ามใช้บิลลูกค้าจริงเป็นตัวทดสอบ และห้ามใช้ `npm run verify:je` กับ production

## 8. OUTCOME_UNKNOWN (ผลของ §4 ไม่ชัด)

สถานะคือ `OUTCOME_UNKNOWN` จนกว่าเงื่อนไข (ก) และ (ข) ครบ **และ** reviewer + เจ้าของออกคำตัดสินเป็นลายลักษณ์อักษร ระหว่างนั้น: ห้ามรัน §4 ซ้ำ, ห้ามรัน SQL ที่เขียนข้อมูลหรือ DDL ใด ๆ, ห้ามทำ §6/§7

เก็บหลักฐาน (read-only ทั้งหมด):
1. บันทึกเวลา, stdout/stderr เท่าที่มี, exit code; ตรวจว่า process `psql` เดิมบนเครื่องเจ้าของสิ้นสุดแล้ว — ข้อนี้พิสูจน์ฝั่ง client เท่านั้น ไม่พิสูจน์ว่า session บน server จบ
2. รัน `p647_postcheck_run` ของ §5 (read-only; ใช้หลักฐานชุดเดียวกับ apply; ผลอยู่ใน `phase647-postcheck-result.txt`) แล้วเก็บผลเต็ม — ใช้เป็น**หลักฐาน** ไม่ใช่ตัวตัดสิน
3. ส่งทั้งหมดให้ reviewer

เงื่อนไขก่อนออกจาก `OUTCOME_UNKNOWN`:
- (ก) ผลของข้อ 2 ถูกเทียบ**ครบทุกแถว**ของ 2A และ 2B (ไม่ใช่เฉพาะ `security_definer`/`function_config`) และตรงกับ state ใด state หนึ่งทั้งชุด: *post-state ที่ตั้งใจ* (ตามเกณฑ์ §5) หรือ *pre-state เดิม* (เท่าไฟล์ผล §2 ก่อน apply ทุกแถว). ผลผสม หรือมีแถวอื่นเปลี่ยน = คง `OUTCOME_UNKNOWN` และยกเป็น incident
- (ข) มีหลักฐานว่าไม่มีคำสั่งเดิมค้างบน server (session ของ migration เดิมจบแล้ว). runbook นี้**ไม่มี** query ตรวจ session ที่ผ่าน review — เป็น Gap เปิดเผย: ถ้าเกิดเหตุนี้จริง reviewer ต้องจัด read-only activity check ที่ผ่าน review แยกก่อน; ไม่มีหลักฐานฝั่ง server = คง `OUTCOME_UNKNOWN`

หลัง (ก) และ (ข) ครบ:
- ทั้งชุดตรง post-state → reviewer ยืนยันเป็นลายลักษณ์อักษร → ทำ §5 เต็มรูป → §6
- ทั้งชุดตรง pre-state → การรัน §4 ใหม่ต้องมี**คำอนุมัติใหม่**ของเจ้าของที่อ้าง SHA เดิมและเหตุการณ์นี้; ค่า `security_definer=f` เพียงลำพังไม่ใช่เหตุให้รันใหม่

ข้อเท็จจริงเชิง source (ไม่ใช่ใบอนุญาตให้รันซ้ำ): migration มี guard `AND NOT p.prosecdef` (`supabase-phase647-je-balance-trigger-rls.sql:29`) จึง STOP เองถ้ารันทับ state ที่ apply แล้ว

## 9. สิ่งที่ runbook นี้ไม่ครอบ (phase แยก ต้องมี review ของตัวเอง)

- ซ่อม JV 663 และใบอื่นที่ header ไม่มี lines (ใช้ `phase647-orphan-663-readonly.sql` ดูใบ 663 ได้ แต่การซ่อมต้องเป็น phase แยก idempotent ต่อใบ)
- discovery ขนาดผลกระทบย้อนหลัง (read-only) และ repair path
- ป้าย "ลงบัญชีแล้ว" ที่ดูแค่ header และ writer 2-request ใน `auto_post.js`
- rollback header โดย non-accountant ยังลบ 0 แถว (candidate ไม่แก้)
