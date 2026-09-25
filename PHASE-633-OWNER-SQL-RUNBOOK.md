# Phase 633 v1 — owner SQL runbook (doc-number helper lockdown)

SQL production execution: **NOT RUN**. ใช้เอกสารนี้หลัง independent review **และ** หลังผ่านขั้นพิสูจน์บน PostgreSQL 17.6 แยกจาก production แล้วเท่านั้น และต้องได้ owner อนุมัติ apply แยกอีกครั้ง

## ทำอะไร

`public.next_doc_number(text,text)` เป็น SECURITY DEFINER ที่เพิ่มตัวนับเลข QT/INV/RC ปัจจุบัน `anon`/`authenticated` เรียกตรงได้ (ผ่าน `/rest/v1/rpc/next_doc_number`) ซึ่งทำให้เลขเอกสารกระโดดได้ ช่องว่างของเลขเอกสารที่มีอยู่แล้ว **ไม่ใช่หลักฐานว่าเคยมีการโจมตี**

Migration `supabase-phase633-doc-number-helper-lockdown.sql` ทำใน transaction เดียว:

1. preflight pin catalog: PostgreSQL 17, `current_user = postgres`, owner ของทั้ง 4 ฟังก์ชัน = `postgres`, body md5 ตรงกับ Phase B2 (ยอม CRLF จาก SQL Editor), trigger 3 ตัวยัง BEFORE INSERT ROW + enabled, ไม่มี function/view/policy/column default อื่นอ้าง `next_doc_number`
2. helper: คง SECURITY DEFINER แต่ตั้ง `search_path = ''` (body ระบุ schema ครบแล้ว)
3. trigger functions 3 ตัว: เป็น SECURITY DEFINER + `search_path = ''` เพื่อให้ยังเรียก helper ได้หลังถอนสิทธิ์ (ฟังก์ชันที่คืนค่า `trigger` ถูกเรียกตรงไม่ได้)
4. `REVOKE EXECUTE` บน helper จาก `PUBLIC, anon, authenticated, service_role`
5. verify: สถานะ catalog ตรงทุกข้อ + probe `SET LOCAL ROLE anon/authenticated` แล้วเรียก helper ต้องได้ 42501 (ถ้าเรียกผ่าน จะ RAISE ทำให้ rollback ทั้ง transaction รวมตัวนับที่เพิ่ม)
6. `NOTIFY pgrst` แล้ว COMMIT

ไม่แก้ body ฟังก์ชัน, ตัวนับ, ข้อมูลเอกสาร, RLS, default privileges หรือ runtime/UI

## ก่อนรัน

- ยืนยันโปรเจกต์ production ที่ถูกต้อง และ SHA-256 ของไฟล์ migration ตรงกับที่ผ่าน review
- ยืนยันว่าผลพิสูจน์บน PostgreSQL 17.6 แยกผ่านแล้ว (ผล PGlite 17.5 จาก `scripts/phase633_pglite_verify.js` เป็นเพียงการทดสอบเบื้องต้น ห้ามใช้อนุมัติเพียงอย่างเดียว — ขั้นพิสูจน์ 17.6 ยังค้าง)
- ช่วงรัน หยุดการสร้างใบเสนอราคา / ใบส่งสินค้า / ใบเสร็จชั่วคราว
- รัน preflight read-only ด้านล่าง เก็บ raw output พร้อม timestamp แล้วส่ง reviewer ถ้าค่าใดไม่ตรงกับ "ค่าที่คาด" ให้ STOP

**ห้ามทดสอบบน production ด้วยการเรียก `next_doc_number` เอง** เพราะจะเพิ่มตัวนับจริง

### Preflight read-only (ไม่เรียก helper)

```sql
SELECT current_setting('server_version') AS server_version, current_user,
       p.oid::regprocedure AS function_name,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig,
       md5(replace(p.prosrc, E'\r\n', E'\n')) AS body_md5,
       strpos(replace(p.prosrc, E'\r\n', E'\n'), E'\r') > 0 AS has_lone_cr,
       p.proacl::text AS acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec,
       pg_catalog.pg_has_role('postgres', 'authenticated', 'MEMBER') AS postgres_in_authenticated,
       has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_can_create_in_public,
       (SELECT count(*) FROM pg_catalog.pg_proc q
         JOIN pg_catalog.pg_namespace n ON n.oid = q.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND q.prosrc ILIKE '%next_doc_number%') AS functions_mentioning_helper
FROM pg_catalog.pg_proc p
WHERE p.oid IN (to_regprocedure('public.next_doc_number(text,text)'),
                to_regprocedure('public.assign_quotation_no()'),
                to_regprocedure('public.assign_delivery_invoice_no()'),
                to_regprocedure('public.assign_receipt_no()'))
ORDER BY p.oid::regprocedure::text;
```

ค่าที่คาด (4 แถว): server 17.x · `current_user = postgres` · owner `postgres` ทุกแถว · `has_lone_cr = false` · `functions_mentioning_helper = 3` (trigger 3 ตัว — body ของ helper ไม่มีชื่อตัวเอง; ตัวเลขนี้นับเฉพาะฟังก์ชัน view/policy/default ตรวจใน migration preflight)

| function | prosecdef | proconfig | body_md5 |
|---|---|---|---|
| `next_doc_number(text,text)` | true | `{search_path=public}` | `62e6bfb02a14d69c020581ce974f9d7b` |
| `assign_quotation_no()` | false | NULL | `a067467804e02d8b75dc114dee223b63` |
| `assign_delivery_invoice_no()` | false | NULL | `0309cb0dc3406d84e63d35a4046d30df` |
| `assign_receipt_no()` | false | NULL | `19f0ac1c8ebc5c1e76b6a76e65d1121d` |

`anon_exec`/`authenticated_exec` ของ helper คาดว่า true (คือปัญหาที่จะแก้) · `authenticated_can_create_in_public` และ `postgres_in_authenticated` เป็นข้อมูลประกอบ ไม่ใช่เงื่อนไข STOP (probe จะข้ามเองถ้า postgres ไม่ได้เป็นสมาชิก role)

## Apply

เปิดไฟล์ที่ตรวจ SHA แล้ว กด Run **ทั้งไฟล์ครั้งเดียว** ห้ามเลือกเฉพาะบาง statement ถ้าข้อความ `Phase 633 STOP` ขึ้น แปลว่า transaction ถูก rollback แล้ว ให้ส่ง error เต็มกลับ reviewer ห้ามผ่อน preflight เอง

`lock_timeout` 5 วินาทีคุมการรอ lock ส่วน `statement_timeout` 60 วินาทีเป็นเวลาต่อ statement ไม่ใช่รวมทั้งไฟล์

## ตรวจผล

SQL Editor อาจแสดงเฉพาะผล SELECT สุดท้าย ให้คัดลอกส่วน `-- POST-CHECK A BEGIN … END` และ `-- POST-CHECK B BEGIN … END` จากไฟล์ไปรันแยก

- **A** ต้องได้ 4 แถว: owner `postgres` · `security_definer = true` ทุกแถว · `proconfig = {"search_path=\"\""}` ทุกแถว · body_md5 ตรงตารางด้านบน · helper: `anon_exec`/`authenticated_exec`/`service_role_exec` = false และ `acl` ไม่มีรายการ `=X/` (PUBLIC)
- **B** ต้องได้ 3 แถว: trigger ทั้งสามชี้ฟังก์ชันเดิม · `tgenabled = O` · `tgtype = 7`

ส่ง raw A/B + ผล Run ทั้งไฟล์ พร้อม timestamp กลับ reviewer ผลนี้เป็น catalog PASS เท่านั้น ไม่ใช่ smoke การออกเอกสารจริง

## หลัง apply — smoke (แยกขั้น ต้อง owner อนุมัติ)

การยืนยันว่า INSERT จริงยังได้เลข ต้องสร้างเอกสารจริงหนึ่งใบต่อประเภท (ซึ่งใช้เลขจริง) จึงเป็นขั้นแยกที่ owner ต้องอนุมัติเอง ห้ามทำอัตโนมัติ

## เมื่อ error, timeout หรือ connection ขาด

หยุด ไม่ retry ทันที ไม่แก้ข้อมูล Transaction ที่ค้างต้อง ROLLBACK ใน connection เดิม รัน preflight read-only ใหม่เพื่อดูว่าอยู่สถานะไหน (ก่อน/หลัง) — migration นี้ rerun ได้เมื่ออยู่ในสถานะก่อนหรือหลัง cutover ครบเท่านั้น สถานะผสมจะ STOP

## Rollback (ต้อง owner อนุมัติแยก)

ย้อนกลับ = `GRANT EXECUTE ... TO PUBLIC, anon, authenticated, service_role` + `ALTER FUNCTION ... SECURITY INVOKER RESET search_path` ของ trigger 3 ตัว + `ALTER FUNCTION public.next_doc_number(text,text) SET search_path = public` ซึ่งจะเปิดช่องเรียกตรงอีกครั้ง ต้องมี prompt/review แยก

## ขอบเขตและข้อจำกัด

- INSERT ที่ล้มหรือถูก rollback ไม่เพิ่มตัวนับ เพราะตัวนับเป็นแถวในตาราง (พฤติกรรมเดิม ไม่ได้เปลี่ยน)
- `service_role` ถูกถอนสิทธิ์เรียกตรงด้วย (ใน repo ไม่มี caller) — ถ้ามีเครื่องมือภายนอกเรียก helper ตรงจะได้ 42501
- การป้องกันนี้ไม่ได้แก้ช่องว่างเลขที่เกิดขึ้นแล้ว และไม่ได้เปลี่ยนสิทธิ์ `CREATE` บน schema `public`
