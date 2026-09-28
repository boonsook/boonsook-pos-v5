# Phase 633 — Production SQL + bounded UI smoke closeout

วันที่ 2026-09-27 · docs only · build 630 / v5.69.97 ไม่ bump.

## 1. สถานะและขอบเขต

**Catalog PASS (POST-CHECK A/B), Codex-operated, owner-authorized · probe result not evidenced · UI smoke QT→DI→RC ยอด 0 บาท PASS แบบมีขอบเขต.**

นี่เป็นบันทึกหลักฐานที่เก็บแล้ว ไม่ใช่คำสั่งรัน migration หรือทดสอบเพิ่ม. Independent reviewers ตรวจหลักฐาน post-run และ UI smoke แล้วรายงานไม่มี Blocking; ไม่ได้ต่อ DB วัดเอง. ผู้เขียน docs closeout ต้องรายงานผล gate ของ commit ใหม่แยกจากผล execution เดิม.

- Baseline/source: PR #229 merge `df12979f6a89127bf1d0140b69f8ac4f979bd572`; ไม่ใช่ SHA ของ docs commit นี้.
- Migration `supabase-phase633-doc-number-helper-lockdown.sql` SHA-256 `c9a6f061dc97721c3fa73732b3fa260fe7c2e5f7467b9c0594f77a6c417039e2`.
- Runbook `PHASE-633-OWNER-SQL-RUNBOOK.md` SHA-256 `8a0534fbe17eaa3f912e2563d5b0e72878f8905ec3275a08cc9c349265c95015`.
- Runbook ที่ pin เป็นเอกสารก่อน apply; สถานะ NOT RUN ในนั้นถูก superseded ด้วยบันทึกนี้ แต่คำเตือน/วิธีปฏิบัติเดิมยังอยู่. ไม่แก้ไฟล์ SQL/runbook/B2 และห้าม rerun B2 หรือ redefine ฟังก์ชันจนทำให้ security/search_path ถอยหลัง.
- ประวัติ Phase 632 ไม่เขียนทับ: residual ตรวจ production numbering function/trigger ปิดด้วย catalog + bounded UI smoke รอบนี้เท่านั้น; two-client concurrency ยัง NOT RUN.

## 2. หลักฐานก่อน production

Native PostgreSQL 17.6 isolated fixture, direct postgres login ที่ไม่ใช่ superuser: 89 PASS + 2 INFO, failed 0 ตาม raw rehearsal ที่ independent reviewer ตรวจ. รัน migration exact SHA ทั้ง first apply/rerun; NOTICE probe ถูกเก็บใน local rehearsal; tests ครอบ role-denial, trigger attachment denial, QT/DI/RC insert, rollback, 9 mutants และ 7 drift cases. เป็น fixture evidence ไม่ใช่ production NOTICE/REST/JWT/concurrency proof. PGlite 17.5 v1.2 จำนวน 71 checks เป็น preliminary ก่อนหน้านั้น ไม่ใช่ 89 native checks.

## 3. Production apply และเวลา

Environment: `boonsook-pos / main PRODUCTION`, ref `rwmmjljelpcpwohwiplu`; PostgreSQL 17.6, current_user/session_user postgres. Operator Codex ผ่าน Supabase Web SQL Editor หลัง owner อนุมัติ exact migration SHA และยืนยันหยุดออกเอกสารชั่วคราว.

- Session ก่อน apply: DB `2026-09-27 13:10:44.58537+00` ไม่ใช่เวลา apply.
- Fresh preflight ก่อน apply และรอบทันทีหลังยืนยันหยุดงานให้ผล 4 functions ตรงกันและตรง preflight ที่ reviewer ตรวจ.
- Client-clock start `2026-09-27T13:16:16.444Z`, completion observed `2026-09-27T13:16:36.958Z` ไม่ใช่ DB COMMIT timestamps.
- ส่งทั้งไฟล์ครั้งเดียว ไม่มี selection/retry; editor text เท่ากับ source หลัง CRLF→LF normalization เท่านั้น ไม่อ้าง raw transport byte identity. Screenshot เห็น 298 บรรทัด + final newline และผลสุดท้าย C สองแถว ไม่มี UI error.
- A/B/C รันแยกภายหลัง แล้วอ่าน DB time `2026-09-27 13:18:20.864958+00`; เป็น after-check bound ไม่ใช่ timestamp ของแถว A/B/C.
- ไม่มี backend trace พิสูจน์ว่า transport รัน transaction เดียว; ยืนยันสถานะ catalog ปลายทางจาก SELECT ภายหลัง ไม่อ้าง proven atomic.

## 4. Raw catalog results และขอบเขต probe

ผล JSON คัดลอกจาก UI โดย Codex; ไม่ใช่ owner-measured / reviewer-measured DB results. A: 4 functions owner postgres, DEFINER, empty search_path, body MD5 เดิม, ACL `{postgres=X/postgres}`, EXECUTE false สำหรับ anon/authenticated/service_role. B: 3 trigger เดิม enabled O / tgtype 7. C: session มีสิทธิ์ SET เท่านั้น ไม่ใช่หลักฐานว่า probe รัน.

**probe result not evidenced**: SQL Editor ไม่แสดง NOTICE จึงไม่มี raw production NOTICE. ห้ามอนุมาน RAN/PASS จาก C, จาก control flow หรือจาก rehearsal และห้ามรัน SQL/helper ซ้ำเพื่อเติมหลักฐาน.

### POST-CHECK A

```json
[
  {
    "function_name": "assign_delivery_invoice_no()",
    "owner": "postgres",
    "security_definer": true,
    "proconfig": [
      "search_path=\"\""
    ],
    "body_md5": "0309cb0dc3406d84e63d35a4046d30df",
    "acl": "{postgres=X/postgres}",
    "anon_exec": false,
    "authenticated_exec": false,
    "service_role_exec": false
  },
  {
    "function_name": "assign_quotation_no()",
    "owner": "postgres",
    "security_definer": true,
    "proconfig": [
      "search_path=\"\""
    ],
    "body_md5": "a067467804e02d8b75dc114dee223b63",
    "acl": "{postgres=X/postgres}",
    "anon_exec": false,
    "authenticated_exec": false,
    "service_role_exec": false
  },
  {
    "function_name": "assign_receipt_no()",
    "owner": "postgres",
    "security_definer": true,
    "proconfig": [
      "search_path=\"\""
    ],
    "body_md5": "19f0ac1c8ebc5c1e76b6a76e65d1121d",
    "acl": "{postgres=X/postgres}",
    "anon_exec": false,
    "authenticated_exec": false,
    "service_role_exec": false
  },
  {
    "function_name": "next_doc_number(text,text)",
    "owner": "postgres",
    "security_definer": true,
    "proconfig": [
      "search_path=\"\""
    ],
    "body_md5": "62e6bfb02a14d69c020581ce974f9d7b",
    "acl": "{postgres=X/postgres}",
    "anon_exec": false,
    "authenticated_exec": false,
    "service_role_exec": false
  }
]
```

### POST-CHECK B

```json
[
  {
    "tgname": "trg_assign_delivery_invoice_no",
    "table_name": "delivery_invoices",
    "function_name": "assign_delivery_invoice_no()",
    "tgenabled": "O",
    "tgtype": 7
  },
  {
    "tgname": "trg_assign_quotation_no",
    "table_name": "quotations",
    "function_name": "assign_quotation_no()",
    "tgenabled": "O",
    "tgtype": 7
  },
  {
    "tgname": "trg_assign_receipt_no",
    "table_name": "receipts",
    "function_name": "assign_receipt_no()",
    "tgenabled": "O",
    "tgtype": 7
  }
]
```

### POST-CHECK C

```json
[
  {
    "rolname": "anon",
    "session_user_now": "postgres",
    "is_member_now": true,
    "probe_prerequisite_set_option_now": true
  },
  {
    "rolname": "authenticated",
    "session_user_now": "postgres",
    "is_member_now": true,
    "probe_prerequisite_set_option_now": true
  }
]
```

## 5. Authenticated UI smoke ที่อนุมัติแยก

Codex ใช้บัญชี owner/admin บนหน้าแอปจริงหลัง owner อนุมัติชุดทดสอบ 0 บาท. Owner ระบุพนักงานไม่มีสิทธิ์หน้านี้ จึงไม่ยกระดับ employee smoke เป็น acceptance gate ของชุดนี้.

| เอกสาร | อ้างอิง | สถานะที่อ่านกลับหลัง reload | ยอด |
|---|---|---|---|
| QT20260927001 | — | ออกใบเสร็จแล้ว | 0.00 |
| INV20260927001 | QT20260927001 | เปิดใบเสร็จแล้ว | 0.00 |
| RC20260927001 | INV20260927001 | รออนุมัติ (pending), ไม่ได้เก็บเงิน | 0.00 |

ลูกค้า “ทดสอบระบบ Phase 633”; project `SMOKE-633-20260927`; QT note “เอกสารทดสอบระบบ Phase 633 ที่เจ้าของอนุมัติ ไม่ใช่การขายจริง ไม่มีการส่งมอบ ห้ามรับเงินหรือส่งให้ลูกค้า”. แถวที่ persist จริงคือ “รายการใหม่” / 1 / ชิ้น / ราคา 0; เป็น custom non-stock ไม่เลือกสินค้าสต็อกจริง. อ่านกลับหลัง reload ได้เลข/การอ้างอิงครบและไม่พบ 42501 ระหว่าง smoke. ไม่อ้างว่าเลขต่อเนื่องเทียบกับกิจกรรมทั้งวัน.

**เอกสารทั้ง 3 ยังอยู่ใน production และถูกนับใน KPI แล้ว — ห้ามเก็บเงินที่ RC20260927001.** ไม่ได้ cancel/delete/cleanup; ต้องให้ owner ตัดสินใจแยก. UI smoke นี้ไม่ได้ SELECT footprint ใน DB จึงไม่ยืนยันว่า JV/stock/counters ทั้งฐานไม่เปลี่ยน. จากโค้ด DI posting เป็น no-op และ receipt ยอด 0 ข้าม posting จึงคาดว่าไม่เกิด JV แต่เป็น code inference ไม่ใช่ DB-measured fact. ไม่ใช่ paid-accounting หรือ concurrency PASS.

## 6. งานส่งต่อที่ยังเปิด ไม่รวมใน docs closeout

- **F1 confirmed:** กดดูตัวอย่างบน QT ใหม่ที่ยังไม่บันทึกทำ draft หาย (reproduced สองรอบ). Source baseline: `modules/quotations.js:783,1151,177`; saved-document preview ใช้งานได้. แยกงานแก้พร้อม regression test ภายหลัง ไม่สรุปว่าเกิดจาก migration 633.
- **F2 unresolved:** ชื่อ/หน่วยที่เห็นหลัง `fill` + Tab ไม่ตรงแถวที่ persist. Handler change/re-render ที่ `modules/quotations.js:898–910` เป็นบริบท ไม่ใช่ข้อพิสูจน์ root cause. ต้อง reproduce ด้วยการพิมพ์แบบผู้ใช้ก่อนสรุปว่าเป็นบั๊กแอป; ไม่แก้ในรอบนี้.
- low-stock 2 vs 448, old login alert และ preview date dots ยังเป็น observation ไม่ใช่ accepted bug verdict.
- Billing banner “Grace period is over” เป็นข้อสังเกตจากรอบก่อน รอตรวจ quota/billing แยก ไม่ใช่การอนุมัติอัปเกรด/จ่ายเงิน และไม่ได้ตรวจซ้ำใน docs task.
- Production probe NOTICE not evidenced; paid-accounting, two-client concurrency, failure/network interruption และ DB footprint audit ยังไม่ได้ทดสอบ. ไม่มีสิทธิ์สร้างเอกสารเพิ่มหรือ cleanup จาก closeout นี้.

## 7. Evidence locator และ hashes

หลักฐานต้นฉบับเก็บนอก repo ใน Codex artifact workspace ไม่ใช่ relative path ที่เปิดได้จาก repo หรือเว็บ production. ข้อความ raw A/B/C สำคัญถูกฝังด้านบนเพื่อให้อ่านต่อได้โดยไม่ต้องมี artifact folder. Evidence paths/hashes ด้านล่างเป็น locator สำหรับ reviewer ไม่ได้แปลว่าแนบไฟล์เหล่านั้นเข้า repo; ไม่ใส่ credentials/keys หรือ screenshot ลง app repo.

External Codex artifact root: `C:\Users\Lenovo E14 Gen4\.codex\visualizations\2026\07\20\019f81e8-22b9-77c3-a825-71f36306c482`

| Relative to external artifact root (NOT repo) | bytes | SHA-256 |
|---|---:|---|
| `pg176-lab/production-apply-20260927/01-SESSION-BEFORE.json` | 253 | `fdb3ecd42e001ed15cb68f97b941cba39662d5852ff37cd12fce74e2ab694853` |
| `pg176-lab/production-apply-20260927/02-PREFLIGHT-BEFORE.json` | 2559 | `401ad57b5a76b43e921a4283e22117ad62566355adc11002e8950c5fd7321bc8` |
| `pg176-lab/production-apply-20260927/02b-PREFLIGHT-IMMEDIATE-BEFORE.json` | 2559 | `401ad57b5a76b43e921a4283e22117ad62566355adc11002e8950c5fd7321bc8` |
| `pg176-lab/production-apply-20260927/03-FULL-RUN.png` | 26978 | `2251a50f17bb89b2a052d07c5e2c063ab5e5ba857f05020ee6e66a42fd812da9` |
| `pg176-lab/production-apply-20260927/05-POST-CHECK-A.json` | 1362 | `cccea9021895dc4fd0b18ed47fe90b74bd686ae162b9e930a2f1d000d15ab483` |
| `pg176-lab/production-apply-20260927/06-POST-CHECK-B.json` | 517 | `bf85abd738b8be71ad1ed034f6249eb83f9550cc43ae5d5d2b8adf9c4fb9ff77` |
| `pg176-lab/production-apply-20260927/07-POST-CHECK-C.json` | 295 | `4c955087269c06c93b688c883c875ed01c94793a717ae4a189454329acf5ce0b` |
| `pg176-lab/production-apply-20260927/08-SESSION-AFTER.json` | 254 | `7576c191314175e7894c103b623af635fa90ff797b57fc7c81ed7e260faabf2a` |
| `pg176-lab/production-apply-20260927/EXECUTION-METADATA.json` | 1445 | `300dc4049adf8e3bd39b17c0ebe39aba4488906fafb64d39928a51626d031b61` |
| `pg176-lab/production-apply-20260927/README.md` | 3264 | `a18b6e2a9dcc2e3ff75b4ac55c13fb419d25a71be93d49218cecac3c4a9c8a1c` |
| `pg176-lab/phase633-native-pg176-rehearsal-rmujr9r7j.zip` | 1321466 | `76472b5b83e7128d23f10dcd1c98bdbc4a386333b789f1d5db02cc9b11e67f25` |
| `phase633-ui-smoke-20260927/SMOKE-RESULT.md` | 5758 | `b8df08731e5099846ee3954e68cc55eb5047023f0472171fd6ef5613755660f3` |
| `phase633-ui-smoke-20260927/FINDINGS.md` | 3246 | `dbadfbdca6cc403374312f092340c735d4af46a5bdd930a26e92d00e8ec51bf2` |
| `phase633-ui-smoke-20260927/04-saved-QT20260927001.png` | 80343 | `1b1b5ab2d9e42f97e83b8452bf7d4e9f4d1ca3a64ade9739faaa7fbd33158ce3` |
| `phase633-ui-smoke-20260927/05-saved-INV20260927001.png` | 85785 | `dfd6f4fc857973211302453f445028c4ad5302abb2cfb77d500044b5681c543f` |
| `phase633-ui-smoke-20260927/08-RC-persisted-after-reload.png` | 73428 | `e6042fff33f5362cad5579de281c8e8940e047fde9731f6dd268f30022add183` |

## 8. Docs-only STOP

รอบ closeout เปลี่ยนเอกสาร 5 ไฟล์เท่านั้น ไม่แก้ runtime/tests/SQL/runbook/build markers; ไม่ต่อ staging/production, ไม่รัน smoke/SQL เพิ่ม, ไม่แก้ F1/F2 หรือเก็บกวาด test documents. ผล local gates/commit ให้ดู implementation report ที่ผูกกับ SHA จริง; CI/deploy ยังไม่รันสำหรับ local docs commit.

**READY-FOR-INDEPENDENT-PHASE-633-DOCS-CLOSEOUT-REVIEW** — หยุดที่ local commit รอ reviewer; ไม่ push/PR/merge/deploy และไม่เริ่ม phase ถัดไป.
