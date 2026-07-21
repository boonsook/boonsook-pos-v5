# 📜 CHANGELOG — Boonsook POS V5 PRO

รายการการแก้ไขแบบสั้น เรียงจากใหม่ → เก่า
รายละเอียดเชิงลึก (architecture / why) ดูใน [HANDOFF.md](HANDOFF.md)

รูปแบบ: `<commit> feat|fix|docs|refactor: <สรุปสั้น>` + bullet 1-2 ข้อถ้าจำเป็น

- docs: **EXTERNAL_TEAM_PROTOCOL.md — กติกาหลายทีม (multi-team collaboration rulebook)** — หลักการประตูเดียว (ทุกทีมคิด/เขียน/ตรวจได้ แต่ทางเข้า repo = branch→PR→CI→owner merge เท่านั้น) + กติกา 6 ข้อ (base hash ทุกรายงาน · diff/patch ห้ามไฟล์ทับ · แยก mode audit/implement · ห้าม credential ผ่านแชท · รายงาน=คำกล่าวอ้างต้อง verify · ทีละ phase→STOP) + checklist owner ตอนรับงานทีมภายนอก. อ้างจากบทเรียนจริงใน session (snapshot เก่า 3 เดือน · ทำเกินคำสั่ง 42 จุด · ขอ PAT ผ่านแชท). + pointer ใน CLAUDE.md header. docs-only ไม่ bump build (คง 604).
- docs(staging,606-B12.2): **harden sentinel date authority — `current_date` ของ target DB session เป็น authority เดียว (docs/runbook/script-wording/guard · build 604 / v5.69.72 ไม่ bump · ยังไม่ merge)** — `STAGING_B12_RUNBOOK.md` sentinel section: เพิ่ม precheck `SHOW timezone` + `SELECT current_date AS db_current_date, now() AS db_now` ที่ owner รันใน target STAGING session ก่อนสร้าง sentinel ทุกครั้ง · `db_current_date` = authority เพียงค่าเดียวของ suffix (ห้าม derive จาก local/Bangkok/UTC clock · ห้ามเปลี่ยน session timezone configuration · rerun precheck เมื่อเปลี่ยน project/session/ข้ามวัน) · ลบ UTC assumption + decision rule ช่วงเวลาเดิมออก · `staging-verify-b12-flow-immutable.sql` เปลี่ยนเฉพาะ comment/RAISE wording (executable interlock `to_char(current_date,'YYYY-MM-DD')` คงเดิมครบ 9 DO blocks · ไม่มี DML/trigger/seed/teardown logic เปลี่ยน) · +guard G15 (รวม G1–G15 · claim-scoped negative: กัน false claim `current_date`=UTC กลับมา) · **ไม่รัน SQL · ไม่แตะ staging/production · B12a–e NOT RUN · hard gate ก่อน 606-b3 ยังไม่ผ่าน**
- fix(xss,docs, build 604): **Phase 606-B12.1 — docs reconcile + XSS micro-fix** — `modules/line_notify.js` escape `e.message` ใน status innerHTML ด้วย `escHtml(String(...))` (จุด dynamic เดียวของไฟล์ + import escHtml จาก utils) · แก้ guard count B12 ใน HANDOFF/CHANGELOG 10→14 (G1–G14) · runbook +คำเตือน timezone เบื้องต้น (ต่อมา B12.2 harden ให้ยึด database-session `current_date` จาก precheck โดยตรง) · +2 xss_regression guards (13 รวม). Bump 603→604 ครบทุก marker.
- feat(staging,606-B12): **B12a-e staging behavioral verify — script + runbook + guard (deliverable ในรีโปเท่านั้น · ยังไม่รันบน staging · build ไม่ bump 603)** — `staging-verify-b12-flow-immutable.sql` (ชื่อจงใจไม่ขึ้นต้น supabase- · header STAGING ONLY · production interlock 2 ชั้นทุก DO block: sentinel `_staging_b12_sentinel` + confirm_text ตรงวันนี้เป๊ะ default=ปฏิเสธ · ทุกส่วน DO block เดี่ยวจบในตัว per-statement safe · expected-exception จับเฉพาะ insufficient_privilege 42501 + assert SQLERRM substring แยก guard ตัวถูก · zero-writes assert je/jl count + field snapshot · DISABLE trigger จุดเดียว = metadata_update_guard ใน transaction เดียว ENABLE+VERIFY ทันที · ห้ามแตะ journal triggers) + `STAGING_B12_RUNBOOK.md` (ทาง A preview branch / ทาง B scratch+pg_dump · sentinel setup อยู่ใน runbook เท่านั้น) + guard `staging_b12_script_guard` 15 ข้อ (G1–G15 หลัง B12.2). ★ fix จาก prompt: seed ใช้ status `'progress'` (DB constraint ไม่รับ `'in_progress'` — Phase 383). **ไม่แตะ runtime/markers/SQL เดิม · การรันจริงบน staging = ขั้นถัดไป owner+reviewer คุมทีละสเตป · hard gate ก่อน 606-b3**
- feat(service,build 603): **Phase 606-b2 — v2 status semantics + drawer payment UI (dormant สำหรับงาน v1 · รอ review)** — `serviceSavePlan` (pure, main.js) แยก **recognition** (closed_at + JV — v2 = "เพิ่งเข้า delivered" เท่านั้น; closed = recovery ผ่าน Service Reconcile ตาม `incomeStatuses` auto_post.js:915) ออกจาก **operational** (stock/LINE = done/delivered/closed เดิมทุก flow — v2 เข้า done ยังตัดสต็อก); flow อ่านไม่ได้ (null) = block ก่อน PATCH ห้าม fallback v1; v2 ห้ามกระโดดเข้า closed โดยไม่ผ่าน delivered; v1 = พฤติกรรมเดิม 100% (behavioral tests ยืนยัน). Drawer +section รับชำระ (admin + flow v2 + delivered/closed + ไม่ [ลบแล้ว] — งาน v1 ไม่ render DOM): เขียนผ่าน `recordServicePayment` RPC เท่านั้น (I4) · intent snapshot ทั้งก้อน (key+paid_at+bank คงเดิมตอน retry — RPC เทียบ payload ครบ กัน 23505) · **ปุ่ม state-driven** (เปิดเฉพาะ summaryOk && outstanding>0 && ไม่มี summary/submit inflight — ไม่มี finally เปิดปุ่ม unconditional; review#196 B1) · สรุปจาก `service_job_paid_total` fail-closed (null/fail = DATA_INCOMPLETE ปิดปุ่มจริงรวมหลังจ่าย ห้ามเดา 0; จ่ายครบ = เคลียร์ช่อง+ปิดปุ่ม) · **render-generation แยกจาก summary-seq + state/intent เป็น per-render closure** (payment งาน A จบหลังเปิดงาน B = เงียบทั้ง toast/DOM/sequence — gen check ก่อน UI-effect ทุกจุด; review#196 B2) · ผลอ่าน `accountingPosted` 3 ชั้น (I3/guard D8) · toast ผ่าน `jvResultToToast` กลาง · ไม่แตะ job.status · helper text แยก flow v2 (delivered=รับรู้รายได้ · รับเงิน=ปุ่มรับชำระ · closed=ยืนยันปิด ไม่ลงซ้ำ) + เตือนช่องวิธีรับเงินเดิม=v1 เท่านั้น. **dormant จริง: production flow v2 = 0 งาน + งานใหม่ถูก DB trigger บังคับ v1 จนกว่า activation 606-b3.** +guard 2 ไฟล์ 31 ข้อ (13+18 — รวม behavioral H1-H5 รัน render/handler จริงบน fake DOM: refresh-fail หลังจ่าย=ปุ่มปิด · A-resolve-หลังเปิด-B ไม่กระทบ B · จ่ายครบ=ปุ่มปิด+ช่องว่าง; mutation proof 8/8 แดง). **ไม่แตะ:** modules/accounting/** · SQL · customer_dashboard · stock logic · LINE · approve btn · reversal UI · 6 งาน DATE_MISSING/NO_JV. markers bump 603 (version 5.69.71). ไม่มี SQL. ไม่เพิ่ม npm dependency. ⚠️ v2 UI ยังไม่ verify กับข้อมูลจริง (ทำได้ตอน staging B12/606-b3) · B12a–e ยัง NOT RUN
- fix(accounting,phase 606-b1.1): **pre-activation hotfix — payment writer select `total_cost` + flow v2 immutable** (build ไม่ bump 602 · MERGED PR #194 `a564af8` · **SQL applied+verified production 2026-07-15** — ดู DB_MIGRATIONS_APPLIED.md) — B1: `postJournalForServicePayment` select ขาด `total_cost` → payment JV v2 ถูก block 100% (แก้ select + mock ทุก guard เคารพ select-projection ผ่าน `tests/_select_projection.js` + mutation proof behavioral) · B2: `supabase-phase606b1-1-service-finance-hotfix.sql` replace `guard_service_job_v2_freeze` เพิ่ม clause finance_flow_version 2→1/2→NULL = 42501 (staging behavioral = NOT RUN — ต้องรันก่อน 606-b3) · read-only finding: `LEGACY_POSTED_DATE_MISSING` 6 งาน/5,300 (ห้ามแก้เงินผ่าน drawer จนกว่า Phase 607 — ดู HANDOFF)
- feat(accounting,phase 606-b1): **Service Finance V2 writer + payment ledger — backend พร้อม แต่ยัง activate ไม่ได้** (build ไม่ bump 602 · PR #193 `53947ec` · **SQL รันบน production แล้ว 2026-07-15**) — canonical writer `postJournalForServiceJob` แตกสาขา `finance_flow_version` จาก DB row (missing → readback DB เป็น authority ทั้งแถว · หาย/เพี้ยน = fail-closed ไม่โพสต์) · v2 = delivered → **Dr 1200 ลูกหนี้ / Cr 42xx**, v1 พฤติกรรมเดิมเป๊ะ · เลิก fallback `created_at` (closed_at ว่าง = block) · `postJournalForServicePayment`/`recordServicePayment`/reversal อ่านจาก ledger row จริง (Cr 1200 / Dr เงินสด-ธนาคาร) ผ่าน validator กลาง `service_jv_validate.js` (approved · 2 non-zero lines · Dr/Cr ขาละหนึ่ง · บัญชี+ยอดตรง · fail-closed กับ null/NaN/field หาย) · ถอด service_jobs ออกจาก generic backfill · Service Reconcile: taxonomy 6+SERVICE_JV_UNLINKED/DATE_MISSING_WITH_JV, ledger fail = LEDGER_UNAVAILABLE/DATA_INCOMPLETE (ไม่ false-green), unlinked/manual JV (source_id NULL) ทุกสถานะชนะ linked-clean, marker boundary-safe (XJOB-70/JOB-70x ไม่ชน JOB-70), Bangkok period bounds. **SQL:** recognition/payment-JV validators exact · gate รับชำระต้องมี recognition JV + paid_at ≥ 1 ก.ค. (เวลาไทย) · freeze งาน v2 ที่มีผลบัญชี · reversal ledger append-only · mapping-freeze กัน historical drift. STEP 3 POST-CHECK: fn 4/4 secure · trigger O · flow2/payments/reversals 0/0/0 · write grants 0 · RLS forced · JE/JL 136/305. read-only audit: ก.ค. residual 0/0 · metadata invalid 0 · **legacy NO_JV 6/6,950 ไม่ drift**. **runtime ยัง v1 · ledger ไม่มี caller · ไม่แตะ main.js/UI · 6 งาน/6,950 ยังไม่แก้ (Phase 607).** guard ~130 · unit 2952 · lint0 · e2e 14/14. **606-b2 (UI+cutover) ยังไม่เริ่ม**
- feat(accounting,phase 606-a): **Service Finance V2 foundation — ฐานพร้อมแต่ยังใช้ไม่ได้** (build ไม่ bump · MERGED PR #192 squash `e3fde2d` · **SQL applied production 2026-07-14 + foundation verified** (ดู DB_MIGRATIONS_APPLIED.md) · ยังเป็น foundation-only — flow v2 ถูก block จนกว่า activation Phase 606-b3) — metadata `source_kind`/`finance_flow_version`/`payment_due_date` + canonical deriver (anchored marker · identity ไม่ผูก lifecycle) + triggers + backfill idempotent + `recognition_debit_code=1200` (ไม่แตะ mapping เดิม) + **`service_payments` ledger** (append-only · cash ห้ามมี bank/transfer ต้องมี · UNIQUE(job, idempotency_key)) + RLS (อ่านเฉพาะ admin/accountant · เขียนตรงไม่ได้) + RPC `record_service_payment_v2` (overpay 23514 · idempotent · ไม่ default เป็นเงินสด · **ห้ามโพสต์ JV**) + preflight/POST-CHECK/VERIFY/rollback runbook. audit scripts อ่าน metadata ใหม่แบบ fallback-safe (invalid = DATA_INCOMPLETE). **runtime ยัง v1 · ledger ไม่มี caller · recovery --apply ยังพัก · 6 งาน/6,950 ยังไม่แก้.** **review fix:** INSERT/UPDATE trigger ปิดทางเปิด flow v2 ทุก role · RPC fail-closed (is_admin NULL = ปฏิเสธ · overpay exact ไม่มี tolerance · idempotency เทียบ payload ครบก่อน business-state · transfer จำกัดบัญชีธนาคาร 1130-1169) · audit probe fail-closed (404/400 อื่น = fatal) · flow version เพี้ยน = DATA_INCOMPLETE ไม่กลืนเป็น v1. +guard 16 · unit 2834 · lint0 · e2e 14/14
- feat(audit,phase 606-0): **พัก S4.1c recovery `--apply` (payment truth) + แยก taxonomy งานเก่า** (build ไม่ bump) — โมเดลใหม่ของ Phase 606: ส่งมอบ = Dr 1200 ลูกหนี้ / รับเงิน = Dr เงินสด-ธนาคาร / Cr 1200 → แผน recovery เดิม (Dr ตาม payment_method) **ผิดฝั่ง** จึง hard-block `--apply` (exit 1 ก่อน login/fetch/write ทุกกรณี · zero writes · preview ยังใช้ได้) และเพิ่ม 5 สถานะใน `verify:service-no-jv`: PRE_EFFECTIVE_EXPECTED_UNPOSTED / LEGACY_FLOW_V1_POSTED (ห้ามแตะ) / LEGACY_FLOW_V1_NO_JV (ปัญหา) / FLOW_V2_POSTED / FLOW_V2_NO_JV. **ผลจริง:** 41 pre-effective · 36 legacy posted · **6 งาน/6,950 ที่ยังเป็นปัญหา**. +ขยาย `isWebOrderJob` ให้จับ web writer ครบ 3 ทาง (AI-*/"AI Sales:" · SH-*/"AC Shop:" · sub_service/SH-payment เดิม) — กันออเดอร์เว็บปนใน taxonomy งานบริการ (production: AI/SH 16 รายการ ยกเลิกหมดแล้ว → ตัวเลขไม่เปลี่ยน = preventive). +guard 9 · unit 2818 · lint0 · e2e 14/14
- feat(audit,S4.1c phase 605): **recovery runner สำหรับงาน service NO_JV — มี gate หลายชั้น ยังไม่ได้รัน apply บน production** (build **ไม่ bump**) — `npm run recover:service-no-jv -- 2026-07 2026-06 [--plan=<abs>] [--strict]`. **default = preview read-only**; จะเขียนข้อมูลได้ต้องครบ `--apply --confirm=SERVICE-NO-JV-S4.1C` **และ** preflight ผ่านทุกงาน (ไม่งั้นไม่เขียนแม้แต่งานเดียว). เขียนได้แค่ 2 อย่าง: **CAS PATCH `service_jobs.closed_at` (field เดียว)** + **JV ผ่าน canonical writer `postJournalForServiceJob()`** (ห้าม raw insert JE/lines, ห้ามคิดสูตร Dr/Cr เอง) · **ห้ามแตะสต็อกทุกกรณี**. `recognitionAt` (วันที่ owner อนุมัติ) ต้องมี timezone — ไม่มี fallback `created_at`; plan อยู่นอก repo; `stockDecision` ที่ยังไม่ resolve = block apply; งวดบัญชีที่ปิดแล้ว = block; หลัง write มี **read-back verify** (doc_date/ยอด/balance/mapping) ก่อนนับว่าสำเร็จ; writer ล้มหลังเขียน closed_at → STOP + resume ได้ (ไม่ rollback วันที่ owner อนุมัติ). **Gate การเขียน (ครบ 3 อย่างเท่านั้น): `--plan=<abs>` + `--apply` + `--confirm=SERVICE-NO-JV-S4.1C` + preflight ผ่านทุกงาน** — ขาดข้อใดข้อหนึ่ง = exit 1 zero writes. plan v2 ต้องมี **`sourceSnapshotSha256`** (hash ของ row ตอน owner อนุมัติ — id/job_no/status/total_cost/job_type/payment_method/note; **เก็บแค่ hash ไม่เก็บ note ดิบ**) → row ถูกแก้หลังอนุมัติ = `PLAN_SOURCE_SNAPSHOT_DRIFT` block ทุกเส้นทาง (pending/resume/verified) และ VERIFIED_COMPLETE ต้องมี `closed_at` = วันที่ owner อนุมัติเป๊ะ. key guard: decode JWT payload + ปฏิเสธ `sb_secret_` (service_role ข้าม RLS). **preview จริง: 6 งาน/6,950 — 4 งานพร้อม, 2 งานติดหลักฐานสต็อก.** +guard recover 35 + classify 45. unit 2810 · lint0 · e2e 14/14. **รอ owner อนุมัติ plan ก่อน apply**
- feat(audit,S4.1b phase 604): **จำแนกหลักฐานงาน service NO_JV แบบ read-only ก่อนออกแบบ recovery** (build **ไม่ bump** — scripts/tests/docs เท่านั้น) — `npm run verify:service-no-jv -- 2026-07 2026-06 [--strict]` รายงาน **ต่อ job** แยก 3 มิติอิสระ: หลักฐานบัญชี (JE ผูก source) · วันรับรู้รายได้ · หลักฐานสต็อก. READ-ONLY (POST เฉพาะ login · REST GET ล้วน · ไม่โพสต์ JV/ไม่แตะสต็อก/ไม่มี SQL). กติกาที่ล็อกไว้: `closed_at=null` → **OWNER_RECOGNITION_DATE_REQUIRED** (ห้าม fallback `created_at` เป็นวันรับรู้) · movement จับด้วย exact marker + รวม qty (ไม่ใช่นับ rows) · `stock_movements` ไม่มี `warehouse_id` → ดีสุดได้แค่ `WAREHOUSE_UNVERIFIABLE` · "ไม่พบหลักฐาน movement" ≠ "ไม่ได้ตัดสต็อก" · null ≠ 0. **ผลจริง (2026-07-13):** candidate **6 งาน / 6,950 บาท ตรง S4.0** · NO_APPROVED_JV 6 · mapping ACTIVE ครบ · **blocker: closed_at ว่างทั้ง 6 → eligible 0 งาน (รอ owner เลือกวันรับรู้รายได้)** · stock: not-required 4, ไม่มีหลักฐาน movement 2. +guard 39. unit 2769 · lint0 · e2e 14/14. **S4.1c (recovery) ยังไม่เริ่ม**
- fix(service,build 602): **หน้าโซลาร์เซลล์ใช้ข้อความสถานะ "รออนุมัติ" ตรงกับฟอร์มรับงาน/ติดตั้งแอร์** (UI copy-only, follow-up Phase 602/S4.1a) — เดิม solar แสดง "📨 รออนุมัติ" ส่วนอีกสองฟอร์มแสดง "📨 รออนุมัติ (ช่างส่ง — รอแอดมิน)" → ดูเหมือนคนละ workflow (value เป็น `pending_review` เหมือนกันอยู่แล้ว). แก้ `modules/solar.js` บรรทัดเดียวให้ label ตรงกันทุกตัวอักษร. **ไม่มี behavior/status/accounting/stock/SQL change** · ไม่แตะ main.js/service_form/ac_install/service_status/accounting/POS/stock · ไม่ refactor. +guard 2: label ตรงกันทั้งสามฟอร์ม (extract select block) + **admin drawer `#serviceStatus` ต้องคง done/delivered/closed** (canonical close path — ลง closed_at + JV + ตัดสต็อก). unit 2730 · lint0 · e2e 14/14. **markers bump 602 (version 5.69.70). ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ NO_JV 6 งาน (6,950฿) ยังไม่ซ่อม — S4.1b/c ยังไม่เริ่ม
- fix(service,build 601): **ฟอร์มรับงานสร้างงาน "เสร็จแล้ว" ไม่ได้อีก — กันงานเกิดมาปิดแล้วโดยไม่มี JV/ตัดสต็อก (S4.1a, prevention-only)** — `service_form`/`ac_install`/`solar` ยังมี option "✅ เสร็จแล้ว" ทั้งที่การปิดงาน (วันปิด + ลงบัญชี + ตัดสต็อก) ถูกย้ายไป drawer "ใบรับงาน" ตั้งแต่ 88.15/545 → แอดมินเลือก done = ได้งาน `status=done` ที่ `closed_at=null` ไม่มี JV ไม่ตัดสต็อก (รายได้หายเงียบ); ช่าง (non-admin) เลือก done = DB trigger 551 reject 42501 → บันทึกใบงานล้ม. แก้: `service_status.js` +`normalizeServiceIntakeCreateStatus()` (pure, ใช้กับทุก role รวมแอดมิน — ไม่ใช่ role-gate): done/delivered/closed → **รออนุมัติ** · progress → in_progress · unknown/ว่าง → pending; ทั้ง 3 ฟอร์มลบ option "เสร็จแล้ว" + normalize ค่าจาก select ครั้งเดียว (ใช้ต่อทั้ง status + note marker) + normalize draft เก่าก่อน restore + ลบ dead closure code (`COMPLETION_STATUSES`/`isClosure`/`closed_at`/inline JV block). **ปิดงานผ่าน drawer ใบรับงานเท่านั้น.** **ไม่แตะ:** main.js drawer/JV/stock/POS/refund/SQL/RLS. +guard `service_borndone_prevention` (24) + intake tests ใน `service_status_guard`; ปรับ `service_pos_jv_background_guard` (POS awaited-JV คงเดิม) + `service_mobile_draft_guard`. unit 2725 · lint0 · e2e 14/14. **markers bump 601 (version 5.69.69). ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ งาน NO_JV 6 งาน (6,950฿) ยังไม่ซ่อม — recovery = S4.1b/c
- chore(build 600): **เก็บเล็ก 7 จุด — นาทีสาย/logout confirm/authStatus ค้าง/escHtml/backfill finally/ESC listener/label ข้อมูลไม่ครบ** (nits, ไม่มี structural change) — (1) `time_clock.js` `summarizePunctuality`: บวก `totalLateMinutes`/`totalEarlyLeaveMinutes` เฉพาะ record ที่ status ตรง (เดิมบวกดิบทุก record → "มาสาย 0 (รวม 750 นาที)"); (2) `main.js` logoutBtn sidebar +`App.confirm`+`setTimeout` (pattern 596 กัน tap-leak); (3) `main.js` `logout()` +ล้าง `authStatus` (เดิม "กำลังเข้าสู่ระบบ..." ค้างหลัง logout); (4) `customer_dashboard.js:615` `${statusLabel}`→`${escHtml(statusLabel)}`; (5) `accounting/backfill.js` `_onRun`: ครอบ body `try/finally` → `_running=false`+restore ปุ่มเสมอ (เดิม throw → lock ค้าง ปุ่มตายจน reload; ไม่แตะตรรกะ backfill/JV); (6) `product_detail_modal.js`: ย้าย `removeEventListener("keydown")` เข้า `close()` → ทุกทางปิดล้าง listener; (7) label "แสดงจากรายการล่าสุด ~N" 5 หน้า (sales/quotations/delivery ~50 · warranty_report ~500 · serials ~200 — label เท่านั้น ไม่แตะ fetch/cap). **ไม่แตะ:** checkout/money/JV logic · fetch caps · logout flow 595-596 · RLS. +guard `small_batch_600` (7); ปรับ `time_clock.test` (late 95→65 ตามพฤติกรรมใหม่) + `sw_timeclock_precache_guard` (anchor SW_BUILD regex). unit 2666 · lint0 · e2e 14/14. **markers bump 600 (version 5.69.68). ไม่มี SQL. ไม่เพิ่ม npm dependency.**
- fix(pwa,build 599): **precache โมดูลหน้าลงเวลา (+chain) ให้เปิด offline ได้เสมอ — ปิดช่อง 503 หลังอัปเดต build** (follow-up 598) — owner ทดสอบจริง: airplane mode + เปิดหน้าลงเวลา → HTTP 503. ต้นตอ (`sw.js` modules fetch): `modules/*` = network-first + runtime-cache เฉพาะที่เคยโหลด + install ใหม่ล้าง cache → หน้า critical เปิด offline ไม่ได้ในช่วง build ใหม่. **แก้ (`sw.js`):** (1) +`const SW_BUILD = '599'` คู่ `CACHE_NAME` (bump พร้อมกัน; guard คุมให้ = `data-app-build`); (2) precache import chain ปิดของหน้าลงเวลาเข้า `PRECACHE_URLS` พร้อม `?v=' + SW_BUILD` (ตรง URL ที่ `_lazyImport` ยิง): `time_clock.js` + `ui_states.js` + `utils.js` + `_offline_queue.js` (verify: time_clock import แค่ 3 ตัวนี้ + ทั้ง 3 เป็น leaf); (3) เส้น modules fallback +`caches.match(request, { ignoreSearch: true })` ก่อนคืน 503 (dependency import ภายในไม่มี `?v=` → ignoreSearch จับ precache ได้). **ไม่แตะ:** fetch strategy อื่น (network-first คงเดิม — precache แค่เสริม) · PRECACHE core เดิม · offline queue logic (598) · RLS. +guard `sw_timeclock_precache` (3: 3 จุดเลข build ตรงกัน · 4 โมดูล+`?v=SW_BUILD` · ignoreSearch ก่อน 503). unit 2659 · lint0 · e2e (markers 599; smoke APP_BUILD flake เดิม). **markers bump 599 (version 5.69.67). ไม่มี SQL. ไม่เพิ่ม npm dependency.**
- fix(timeclock,pwa,build 598): **drain offline queue เมื่อ online/boot + แจ้ง fail ไม่เงียบ + self badge; ปุ่มอัปเดต PWA มี fallback reload** — (A) ลงเวลาตอน offline ค้างใน IndexedDB **เงียบได้** (ทั้งแอปไม่มี `online` listener, drain เฉพาะตอนเปิดหน้า time clock, sync fail ไม่แจ้ง, self view ไม่มี badge → ลงเวลาหายจาก payroll). **แก้:** `main.js` +`_drainTimeClockQueue(trigger)` (flag `window._tcSyncing`; `_lazyImport` time_clock cache-bust ไม่ eager; toast ✅ ok / ⚠️ warn fail) + `window.addEventListener("online", …)` + เรียกตอน boot ท้าย `afterLogin`; `time_clock.js` sync-on-render `{ok}`→`{ok,fail}` +warn; self view +badge "⏳ ลงเวลาค้าง sync N" + ปุ่ม `tcSyncSelfBtn` (extract `_bindOfflineSyncBtn` ใช้ร่วม admin+self). (B) `boot.js`: ปุ่ม "อัปเดตเลย" เดิม no-op เงียบเมื่อไม่มี `reg.waiting` → extract `forceReload()`; click → มี waiting: SKIP_WAITING + `setTimeout(forceReload,4000)` fallback / ไม่มี waiting: `forceReload()` ทันที; visibilitychange +re-check `reg.waiting`→`maybeShowBanner`. **ไม่แตะ:** `syncOfflineQueue`/`OfflineQueue` internals (idempotency 409) · clock-in/out · payroll · sw cache strategy · RLS. +guard `offline_queue_drain` (4); `boot_periodic_sw_update`/`lazy_import_cache_bust` เขียวครบ. unit 2656 · lint0 · e2e (markers 598; smoke APP_BUILD flake เดิม). **markers bump 598 (version 5.69.66). ไม่มี SQL. ไม่เพิ่ม npm dependency.**
- fix(report,build 597): **รายงานกำไรรวมรายได้งานบริการ — นิยามเดียวกับ dashboard/income_overview (single source)** — หน้ารายงานกำไร (`profit_report.js`) นับรายได้จาก `sales` (POS) เท่านั้น แต่รายจ่ายรวมงานช่าง (เช่นค่าแอร์ 49,200) → **กำไรสุทธิติดลบเกินจริง** + นิยามไม่ตรง income_overview/dashboard. **แก้ (`profit_report.js`):** (1) import `fetchServiceJobsSince` (range_fetch) + **`sumServiceJobIncome`/`serviceIncomeDate` (dashboard.js — single source, ห้ามคิดสูตรเอง กัน drift)**; (2) ดึง service jobs ขนานใน `Promise.all` กับ sales/expenses; svc fail → fallback `state.serviceJobs||[]` + toast warn (pattern เดียวกับ expenses); (3) `serviceIncome = sumServiceJobIncome(jobs, j → ฐานวัน serviceIncomeDate ∈ fromTs..toTs)` (ชุดวันเดียวกับ expensesInRange); (4) export **`computeNetProfit(gross, service, expenses) = gross + service − expenses`**; `netProfit` ใช้ helper นี้; (5) การ์ด: "รายได้" = ขาย POS + งานบริการ + บรรทัดย่อยที่มา · "ต้นทุนสินค้า (POS)"/"กำไรขั้นต้น (POS)" · **+การ์ด "รายได้งานบริการ"**; (6) กราฟ 6 เดือน + ตารางกำไรรายสินค้า = POS เดิม (h2 +"(POS)"). **ไม่แตะ:** `dashboard.js` (import อย่างเดียว) · `income_overview.js` · `range_fetch.js` logic · expenses/JV/auto_post/RLS. +guard `profit_report_service_income` (3); ปรับ `profit_expense_fetch_guard` (import/Promise.all regex รับ fetchServiceJobsSince). unit 2652 · lint0 · e2e (markers 597; smoke APP_BUILD flake เดิม). **markers bump 597 (version 5.69.65). ไม่มี SQL. ไม่เพิ่ม npm dependency.**
- fix(auth,build 596): **logout confirm มือถือ — กด "ออกจากระบบ" แล้ว logout ทันทีไม่ขึ้น dialog (hotfix ต่อ 595)** — build 595 เพิ่ม `App.confirm` ก่อน logout แต่ owner รายงานว่าบนมือถือกดแล้ว**ออกเลยไม่มีปุ่ม "ยืนยัน" ให้กด**. ต้นเหตุ: handler `profileMenu` เรียก `closeProfileMenu()` (ซ่อนปุ่มที่ถูกแตะ) แล้วเปิด `App.confirm` modal (overlay z-10000 + `okBtn.focus()`) ใน gesture เดียวกัน → tap เดิม (viewport `user-scalable=no` + accessibility service active) leak/replay ไปโดนปุ่ม "ยืนยัน" ของ modal ที่เพิ่งสร้าง = confirm ผ่านทันที. **แก้ (`main.js`):** listener กลับเป็น sync `(e)=>` + ห่อ confirm ด้วย **`setTimeout(async()=>{ if(await window.App.confirm("ออกจากระบบ?")) logout(); }, 0)`** → เลื่อนเปิด modal ไป macrotask ถัดไป (หลัง tap จบ) → modal ไม่โดน tap เดิม. **ไม่แตะ:** `logout()` body (ล้าง PII ของ 595 คงเดิม) · `logoutBtn` · `showConfirmModal`/`App.confirm` (shared) · `auth.js` · checkout/money/RLS. ปรับ guard `logout_hygiene` test(a) +assert `setTimeout` defer; `topbar_notif_profile` test(3) robust regex. unit 2649 · lint0 · e2e 14/14. **markers bump 596 (version 5.69.64). ไม่มี SQL. ไม่เพิ่ม npm dependency.**
- fix(auth,build 595): **ปุ่ม logout บน topbar ใช้งานได้จริง (เลิกพึ่ง `__authLogout` dead module) + ล้าง PII บิลล่าสุดตอน logout** — (1) ปุ่ม "ออกจากระบบ" ใน profile menu (topbar, `main.js:5065`) เดิมเรียก `window.__authLogout?.()` ที่ assign ใน `initAuth()` ของ `auth.js` (**dead module — grep ยืนยัน `initAuth` ไม่เคยถูกเรียกทั้ง codebase**) → `undefined` เสมอ = **ปุ่มตาย กดแล้วเงียบ**. แก้: เรียก `logout()` หลักโดยตรง + `await window.App.confirm("ออกจากระบบ?")` (pattern เดิม `main.js:1873/2922`) กันกดพลาดบนมือถือ; เปลี่ยน listener `profileMenu` เป็น `async` เฉพาะตัวนี้. (2) `logout()` (`main.js:1111`) เดิมไม่ล้าง `state.lastReceipt` / `localStorage "bsk_last_receipt"` → **PII ลูกค้า (ชื่อ/เบอร์) บนบิลล่าสุดค้างข้าม account**. แก้: `state.lastReceipt = null` + `try{ localStorage.removeItem("bsk_last_receipt") }catch{}` ก่อน `showToast`. **ไม่แตะ:** logout flow เดิม (signOut/clear state/UI reset) · `logoutBtn` (:5042 ใช้ได้อยู่) · `auth.js` (dormant staff-PIN — future cleanup) · checkout/money/RLS. **★ main.js ไม่ import auth.js** (กันดึง dead module). +guard `logout_hygiene` (3: handler เลิกพึ่ง `__authLogout`+`App.confirm`+`logout()` · `logout()` ล้าง lastReceipt+removeItem ก่อน showToast · main.js ไม่ import auth.js); ปรับ `topbar_notif_profile` test เดิม (เคย lock พฤติกรรมปุ่มตาย → อัปเป็นเรียก `logout()`). unit 2649 · lint0 · e2e 14/14. **markers bump 595 (version 5.69.63). ไม่มี SQL. ไม่เพิ่ม npm dependency.**
- feat(printer,build 594): **PeriPage A9 Max — ปิดเคส (พิมพ์ผ่านเว็บไม่ได้) + UX guard แจ้ง user ให้ชัด** — พิสูจน์ครบ 3 ทาง (build 592 framing ตัวจริงผ่าน ff02 / build 593 notify handshake ff01/ff03+ff02 / btsnoop log ของแอปทางการ) owner ทดสอบทั้งคู่ = **กระดาษไม่เลื่อน**. ข้อสรุป: **A9 Max พิมพ์ได้เฉพาะ Bluetooth Classic (RFCOMM/SPP)** ซึ่ง Web Bluetooth เข้าไม่ถึงเลย (กำแพง browser ระดับ platform); ช่อง BLE (ff02/8841) ไม่ได้ต่อเข้า print engine. **แก้ (`receipt_bt.js`):** ★ ถอดโค้ด experimental ออกหมด — ลบ `A9MAX_PREAMBLE/FEED/FINALIZE` (592) · ลบ notify handshake `_notifyChars/_notifyStarted`+`startNotifications` (593) · ลบ ff02 MAX override ใน connect (590) → `preferUuid = PERIPAGE_WRITE_CHAR` เสมอ · ลบ A9MAX branch ใน `buildPrintBytes` → กลับ 586. เพิ่ม export **`A9MAX_UNSUPPORTED_MSG`** + `printReceipt`/`testPrint` หลัง connect → `if (isPeriPageMax()) throw` (บล็อกก่อนวาด canvas = แจ้งชัดแทนกดแล้วเงียบ). **`settings/pages.js`:** connect ถ้า MAX → สถานะ "🟠 …⚠️ พิมพ์ผ่านเว็บไม่ได้" + toast; test catch ถ้า MAX → toast "⚠️ &lt;msg&gt;" (ไม่ใช่ "พิมพ์ไม่สำเร็จ"). **★ A9 (non-MAX): connect fallback 8841 + PeriPage framing = byte-identical 586** (ไม่โดนบล็อก). ลบ guard `receipt_bt_a9max_mode`/`receipt_bt_notify_handshake`/`receipt_bt_max`; +`receipt_bt_a9max_unsupported` (2: A9 Max → throw; ★ A9 → 8841+586 regression). unit 2646 · lint0 · e2e (markers 594 เขียว). **markers bump 594. ไม่มี SQL. ไม่เพิ่ม npm dependency.** A9 Max → แนะนำใช้แอป PeriPage / เครื่อง A9.
- feat(printer,build 593): **PeriPage A9 Max — notify handshake (long-shot #2 ผ่าน BLE)** — build 592 ยิง framing ตัวจริงผ่าน ff02 แล้ว A9 Max ยังนิ่ง (owner ทดสอบ: กระดาษไม่เลื่อน; GATT ยืนยัน ISSC `8841` + `ff00`/`ff01`/`ff02`/`ff03`). สมมติฐานรอบนี้: เครื่องช่อง ff00/ff02 บางรุ่นต้อง **enable CCCD ของ notify char (`ff01`/`ff03`) ก่อน** firmware ถึงจะประมวลผล write ที่ ff02 (pattern เดียวกับ ISSC UART ที่ build 587 เคยลองบน 8841 — แต่**ยังไม่เคยลองบนช่อง ff02**). **แก้ (`receipt_bt.js`):** +state `_notifyChars`/`_notifyStarted`; `connectSlipPrinter` หลังเลือก `_char` (ff02) → ถ้า `isMax && pickedSvc && !_notifyStarted` → `pickedSvc.getCharacteristics()` หา `properties.notify` → `startNotifications()` ทุกตัว (ff01/ff03) + `addEventListener("characteristicvaluechanged", no-op)` (กัน CCCD หลุดบาง stack) + settle 120ms; reset ที่ `disconnectSlip` + `gattserverdisconnected`. **★ ล็อกเฉพาะชื่อ MAX — A9 (และเครื่องอื่น) ไม่เข้า block นี้ → connect byte-identical 592/586** (ไม่ subscribe อะไรเลย). ไม่แตะ char selection · `buildPrintBytes` (A9MAX framing 592) · `sendChunked` · raster · money flow · RLS/SQL. +guard `receipt_bt_notify_handshake` (2: A9 Max → startNotifications ff01/ff03 ไม่แตะ ISSC 1e4d; ★ A9 non-MAX → ไม่ startNotifications เลย regression). unit 2650 · lint0 · e2e (markers 593 เขียว; smoke APP_BUILD flake เดิม). **markers bump 593. ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ long-shot #2 — ถ้ายังนิ่ง = ยืนยันปิดเคส A9 Max ผ่านเว็บ (ใช้แอปทางการ). A9 ต้องยังพิมพ์ได้.
- feat(printer,build 592): **PeriPage A9 Max — framing ตัวจริงจากแอปทางการ (long-shot ผ่าน BLE ff02)** — แกะ Android HCI snoop log (`btsnoop_hci.log`) ของแอป PeriPage ทางการขณะพิมพ์ A9 Max พบว่า **แอปพิมพ์ผ่าน Bluetooth Classic (RFCOMM/SPP, L2CAP CID 0x42) ไม่ใช่ BLE** — ซึ่ง Web Bluetooth เปิด socket Classic/SPP ไม่ได้ (ข้อจำกัด browser ระดับ platform = **ต้นเหตุที่ build 587–591 ล้มเหลวทั้งหมด**). โปรโตคอลจริง (ถอดไบต์): preamble `10FF20F0`/`10FF70`/`10FF12 0014`+12×00 · density `10FF10 0004` · reset `10FFFE01 1FB210` · image ผ่าน `10FF80` (**บีบอัด proprietary คล้าย CCITT G4** — entropy~7.7, ไม่ใช่ zlib/gzip; ยัง reproduce ใน vanilla JS ไม่ได้) · feed `1B4A50` · finalize `10FFFE45`+12×00. **NO `GS v 0`** (0 hits) — A9 Max ไม่ใช้ raster แบบ A9. **long-shot (`receipt_bt.js`):** เพิ่ม `A9MAX_PREAMBLE`/`A9MAX_FEED`/`A9MAX_FINALIZE` (ไบต์จริง) + export `isPeriPageMax()`; `buildPrintBytes` เช็ค `isPeriPageMax()` ก่อน `isPeriPage()` → A9 Max = preamble + `GS v 0` (best-effort image) + feed + finalize, ยิงผ่าน char ff02 (override 590). **ตัวชี้วัด = feed `1B4A50`**: A9 Max เลื่อนกระดาษ = ช่อง BLE ถึง print engine → คุ้มถอด G4 ต่อ; ไม่ขยับ = ช่อง BLE ไม่ใช่ช่องพิมพ์. **★ ล็อกเฉพาะชื่อมี "MAX" — A9 (และเครื่องอื่น) `buildPrintBytes` byte-identical 586.** +guard `receipt_bt_a9max_mode` (2: A9 Max framing จริง+feed+finalize+ไม่มี cut; ★ A9 regression = PeriPage framing 586 เป๊ะ). unit 2648 · lint0 · e2e (markers 592 เขียว; smoke APP_BUILD flake เดิม container). **markers bump 592. ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ A9 regression + A9 Max ทดสอบ: กด "ทดสอบพิมพ์" → กระดาษเลื่อน = ช่องใช้ได้.
- feat(printer,build 591): **เลือกขนาดกระดาษสลิป 58/80/107mm + auto-default ตามรุ่น (A9 Max = 4 นิ้ว); A9 คงเดิม** — เดิม canvas กว้างคงที่ 384 (58mm) เท่านั้น → A9 Max (4"/832 dot) + เครื่อง 80mm พิมพ์ไม่เต็มความกว้าง. **แก้ (`receipt_bt.js`):** `PAPER_WIDTHS = {58:384, 80:576, 107:832}` (dot@203dpi); module state `_paperKey` (persist `localStorage bsk_slip_paper`, init ตอนโหลด, guarded); export **`setPaperWidth(key)`/`getPaperWidthKey()`/`getPaperPx()`**. `getPaperPx()`: `auto` → `/max/i.test(_device.name) ? 832 : 384` (**★ A9 auto=384 regression-safe; A9 Max auto=832**); เลือกเอง → `PAPER_WIDTHS[key]`. `renderReceiptCanvas`/`renderTestCanvas` ใช้ `W = getPaperPx()` แทน `CANVAS_WIDTH` (layout `center=W/2`/`right=W-PAD` ปรับตาม; `canvasToRasterBody` คิด `bytesPerRow` จาก `canvas.width` = รองรับทันที). **`settings/pages.js`:** การ์ดเครื่องพิมพ์ +dropdown "📏 ขนาดกระดาษ" (auto/58/80/107), ค่าเริ่ม=`getPaperWidthKey`, onChange→`setPaperWidth`+toast. **★ ไม่แตะ:** char selection (fec7/ff02/MAX override 590) · framing · `sendChunked` · money flow · `window.print()` · `bt_printer.js` · RLS/SQL. **A9 (auto→384) = byte-identical เดิม.** +guard `receipt_bt_paper_width` (3: auto MAX→832 & A9→384, setPaperWidth 58/80/107 + key ผิด reject, `canvasToRasterBody` bytesPerRow ตามความกว้าง 832→xL=104). unit 2646 · lint0 · e2e (build-sync markers 591 เขียว). **markers bump 591.** **ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ A9 regression (auto=58mm ต้องพิมพ์ได้) + A9 Max ลองที่ 107mm.
- fix(printer,build 590): **กู้ A9 (base 586) + A9 Max ลองช่อง ff02 + PeriPage framing (ล็อกเฉพาะชื่อ "MAX")** — ต่อจาก revert 589 (A9 กลับมาใช้ได้). เพิ่ม override **แคบ ๆ จุดเดียว** ใน `connectSlipPrinter`: `const isMax = /max/i.test(_device.name); const preferUuid = isMax ? "ff02" : PERIPAGE_WRITE_CHAR;` แล้วใช้ `includes(preferUuid)` แทน `"fec7"`. **ผล:** A9 Max (ชื่อมี "MAX") → เล็ง **ff02** (thermal มาตรฐาน) แทน 8841; **A9 (ชื่อไม่มี MAX) → เล็ง fec7 → ไม่เจอ → fallback writable ตัวแรก = 8841 = byte-identical 586** (regression-safe). **ไม่แตะ:** `buildPrintBytes` (`isPeriPage` ชื่อ-based → A9 Max ชื่อ peripage = **PeriPage framing `10 FF FE 01`** → คอมโบ ff02+PeriPage ที่ต้องการ) · `sendChunked` (direct write 200/writeWithoutResponse; ff02 มี WoR) · raster/framing · `settings/pages.js`. **`git diff 561eceb -- receipt_bt.js` = เฉพาะ override MAX (4 บรรทัด).** +guard `receipt_bt_max` (2: A9 regression char=8841+PeriPage, A9 Max char=ff02+PeriPage); ปรับ `receipt_bt_peripage` test(e) ชื่อ → non-MAX. unit 2643 · lint0 · e2e 14/14. **markers bump 590** (main อยู่ 589 จาก revert → 590 เพื่อ bust SW cache ให้ `receipt_bt.js` ใหม่ถึงเครื่อง). **ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ A9 ต้องยังพิมพ์ได้ (regression) + A9 Max ลุ้นออก (ff02+PeriPage).
- revert(printer,build 589): **คืนค่า `receipt_bt.js` กลับ build 586 — A9 พังจาก 588 (regression)** — build 588 ทำให้ **A9 (เครื่องที่เคยพิมพ์ได้)** พัง. **สาเหตุ:** 587/588 สร้างบนสมมติฐานผิดว่า "A9 ใช้ char `fec7`". ความจริง (GATT เครื่องจริง): **A9 ไม่มี fec7** — ใช้ ISSC service `49535343` (char `8841`) + service `ff00` (`ff02`) เหมือน A9 Max. A9 ที่พิมพ์ได้จริง (build 586, มีรูปยืนยัน) ใช้ char `8841` (fallback "writable ตัวแรก") + PeriPage framing (`isPeriPage` ตัดสินจากชื่อ = true) + direct write. 588 สั่งเลือก `ff02` + generic ESC/POS → A9 โดนสับช่อง/โปรโตคอลผิด → พัง. **แก้:** `git checkout 561eceb -- modules/receipt_bt.js` (**byte-identical build 586**: connect fec7-priority→fallback firstWritable/8841, `buildPrintBytes` ใช้ `isPeriPage` ชื่อ-based, `sendChunked(char,bytes)` เดียว 200/20/writeWithoutResponse ไม่มี uart branch, generic path มี `GS V` cut เดิม); คืน `receipt_bt_raster`/`receipt_bt_peripage` guard กลับ 586; ลบ `receipt_bt_a9max_guard` (test พฤติกรรม 587/588 ที่ revert ออก). **ไม่แตะ `settings/pages.js`** (ปุ่ม diagnostic 🔍 ของ 586 คงไว้ — ไม่พึ่ง export ของ 587/588). ยังไม่แก้ A9 Max (จะทำแยกด้วย byte capture จริงจากแอปทางการ). unit 2641 · lint0 · e2e 14/14. **ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ เป้าหลัก: A9 กลับมาพิมพ์ได้เหมือน 586.
- fix(printer,build 588): **A9 Max พิมพ์ผ่านช่อง ff02 (ESC/POS มาตรฐาน) — เลือก char ตามช่อง (fec7→ff02) + framing ตามช่อง; A9 คงเดิม** *(⚠️ REVERTED ใน build 589 — ทำให้ A9 พัง)* — build 587 ยังพิมพ์ A9 Max ไม่ได้. GATT diagnostic เครื่องจริงเผย A9 Max มี **2 service**: `49535343-…` (ISSC UART, char `8841` — 585-587 เลือกตัวนี้ = **ผิดช่อง**) + `0000ff00-…` (thermal มาตรฐาน, char **`0000ff02`** [writeWithoutResponse,write]). ช่อง ff00/ff02 = โปรไฟล์ Xprinter/generic ESC/POS. **แก้ (`receipt_bt.js`):** (1) `PRINT_WRITE_CHARS = [fec7, ff02]` — `connectSlipPrinter` รวบรวม writable char ทุก service แล้วเลือกตามลำดับ **fec7 (A9) → ff02 (A9 Max) → fallback writable ตัวแรก** (ผล: A9→fec7 เหมือนเดิม, A9 Max→**ff02** แทน `49535343-8841`); (2) framing ตาม **"ช่อง" ไม่ใช่ชื่อแบรนด์** — `usePeriPageProtocol()` = `/fee7/ _serviceUuid || /fec7/ _charUuid`; `buildPrintBytes`: PeriPage-channel (A9)→`reset+concentration+GS v 0+ESC J` (คงเดิม), else (ff02/generic)→`ESC @ + GS v 0 + ESC d feed`; (3) ★ **ตัด `GS V` cut ออกทุก path** (`canvasToEscposRaster`+generic) — เครื่องพกพาไม่มีคัตเตอร์ cut เสี่ยง jam. A9 Max ตอนนี้เลือก ff02 (service ff00) → `isUartTransport=false` → direct write + generic ESC/POS. **★ A9 (fee7/fec7) byte-identical 587:** fec7→`usePeriPageProtocol` true→PeriPage framing + direct write (chunk 200/writeWithoutResponse/delay 20). 587 UART code คงไว้ (เผื่อ ISSC-only) แต่ไม่ทำงานกับ A9/A9 Max. **ไม่แตะ:** `renderReceiptCanvas`/`canvasToRasterBody` · money flow · `window.print()` · `bt_printer.js` · RLS/SQL. +guard `receipt_bt_a9max` เพิ่ม (f) A9 regression fec7→PeriPage framing · (g) **A9 Max เลือก ff02 (ไม่ใช่ 8841)→generic ไม่มี cut/reset** · (h) fallback; ปรับ `receipt_bt_raster`/`receipt_bt_peripage` (generic ไม่มี cut). unit 2649 · lint0. **ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ A9 ต้องยังพิมพ์ได้ (regression) + A9 Max = attempt #3 รอ owner ทดสอบ (ยังไม่ออก → capture byte จริงจากแอปทางการ).
- fix(printer,build 587): **PeriPage A9 Max ผ่าน ISSC transparent UART (notify subscribe + write-with-response + chunk 128); A9 path คงเดิม** — build 586 พิมพ์ **A9** ได้ (fee7/fec7) แต่ **A9 Max** ยังไม่ออก. จาก GATT diagnostic เครื่องจริง: A9 Max ใช้ BLE stack คนละแบบ = **ISSC/Microchip transparent UART** (service `49535343-fe7d-…`, write `49535343-8841-…`, notify `49535343-1e4d-…`; A9 Max=80mm V1.22 · A9=58mm fee7/fec7 V1.27). transparent UART มักต้อง **"เปิด pipe"** ก่อน. **แก้ (`receipt_bt.js` — เฉพาะ path UART, ★ ไม่แตะ A9 fee7/fec7 ที่พิมพ์ได้แล้ว):** (1) `isUartTransport()` = `_serviceUuid` มี `49535343`; (2) `connectSlipPrinter` หลังเลือก `_char` ถ้า UART → หา notify char ใน service เดียวกัน เก็บ `_notifyChar` แล้ว `startNotifications()` ครั้งเดียว (`_notifyStarted`) เปิด UART bridge; (3) `sendChunked(char, bytes, opts)` — `uart:true` → chunk **128** + delay **40ms** + **write-with-response** (`writeValue`) เสมอ; **ไม่ใช่ UART (A9) → คงเดิมเป๊ะ** chunk 200 + delay 20 + `writeWithoutResponse`; `printReceipt`/`testPrint` ส่ง `{uart: isUartTransport()}`. **protocol bytes** (PeriPage reset/concentration/GS v 0/ESC J) + `buildPrintBytes` framing **คงเดิม** (แบรนด์เดียวกัน — เปลี่ยนแค่ "วิธีส่ง"). **ไม่แตะ:** `renderReceiptCanvas`/`canvasToRasterBody`/framing · A9 path (chunk 200/writeWithoutResponse/delay 20) · money flow · `window.print()` · `bt_printer.js` · RLS/SQL. +guard `receipt_bt_a9max`(5: `isUartTransport` / uart write-with-response ≤128 / **A9 non-uart คงเดิม ≤200 กัน regression** / connect ISSC subscribe notify / A9 ไม่ subscribe). guard 586 เขียวครบ. unit 2646 · lint0. **ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ A9 ต้องยังพิมพ์ได้ (regression) + A9 Max รอ owner ทดสอบ (best-effort #1; ยังไม่ออก → ลอง generic ESC/POS รอบหน้า).
- fix(printer,build 586): **พิมพ์เข้า PeriPage ได้ (reset+concentration+GS v 0 chunk+ESC J, char fec7) + GATT diagnostic (hotfix ต่อ 585)** — เครื่องจริง owner = **PeriPage A9MAX** เชื่อมได้ (585) แต่กดพิมพ์ไม่ออก. **ต้นตอ (ref bitrate16/peripage-python):** PeriPage ใช้ raster `GS v 0` เหมือน ESC/POS แต่ต้องมี **"คำสั่งหุ้ม" เฉพาะ** ที่ 585 ไม่มี — ไม่รู้จัก `ESC @` ต้อง reset `10 FF FE 01`(16B); ต้องตั้ง concentration `10 FF 10 00 02` ไม่งั้นจาง/ว่าง; ท้ายห้ามส่ง `GS V 1` cut (ไม่มีคัตเตอร์ → ค้าง/ไม่พิมพ์) ต้อง `ESC J` feed แทน; ต้องเขียนที่ char `fec7` ใต้ service `fee7` (585 อาจโดน writable char ผิดตัว). **แก้ (`receipt_bt.js`):** (1) เพิ่ม `0000fee7` ต้น `SLIP_PRINTER_SERVICES`; (2) `connectSlipPrinter` วน `getPrimaryServices()` ทุก service → หา char uuid `fec7` **ก่อน** → fallback ตัว writable ตัวแรก + จำ `_serviceUuid`/`_charUuid` (`getSlipTarget`); (3) แยก **`canvasToRasterBody`** (GS v 0 เท่านั้น, **chunk ≤255 แถว** header ต่อ chunk yL 1 byte) ออกจาก wrapper; `canvasToEscposRaster` = generic (`ESC @`+body+feed+`GS V` cut); **`buildPrintBytes(canvas)`** route ตาม `isPeriPage()` (ชื่อ `/peripage/` หรือ service `fee7`): PeriPage → `RESET`+`CONCENTRATION`+body+`ESC J`; else generic; (4) **`diagnoseSlipPrinter()`** dump service/char/props บนจอ (owner screenshot กันเดา UUID). `printReceipt`/`testPrint` ใช้ `buildPrintBytes`. **UI:** settings About การ์ดเครื่องพิมพ์ +ปุ่ม "🔍 ตรวจเครื่องพิมพ์ (debug)" → GATT บนจอ + สถานะ connect โชว์ char ที่เลือก. คง `renderReceiptCanvas`/`sendChunked`/feature-detect เดิม. **ไม่แตะ:** money flow · `window.print()` · `bt_printer.js` (label) · RLS/SQL. +guard `receipt_bt_peripage`(7) + ปรับ `receipt_bt_raster` (chunked body). unit 2641 · lint0. **ไม่มี SQL. ไม่เพิ่ม npm dependency.** ⚠️ owner ต้องทดสอบพิมพ์ออกจริงบน PeriPage A9MAX + ส่ง screenshot diagnostic ถ้ายังไม่ออก.
- feat(printer,build 585): **พิมพ์ใบเสร็จเข้าเครื่องสลิป Bluetooth 58/80mm (Android, ESC/POS raster)** — เดิมพิมพ์ได้แค่ `window.print()` = ส่งเข้าเครื่องสลิป BLE ไม่ได้; `thermal_printer.js` (ESC/POS text) dead ไม่มีใคร import; ไม่มี UI เชื่อม Bluetooth → พิมพ์สลิปไม่ได้. **สถาปัตยกรรม (canvas→raster→BLE):** วาดใบเสร็จลง `<canvas>` 384px ด้วย `ctx.fillText` (**เรนเดอร์ไทยเนทีฟจาก browser font — กัน codepage TIS-620/CP874 เพี้ยนตามรุ่นเครื่อง**) → `canvasToEscposRaster` (luminance<128=ดำ, bit-pack MSB-first, `GS v 0 m xL xH yL yH` + `ESC @` + feed + partial cut) → `sendChunked` (chunk 200 byte, prefer `writeWithoutResponse`, delay 20ms). **`modules/receipt_bt.js` (ใหม่):** `connectSlipPrinter` (mirror `bt_printer.js` proven — `acceptAllDevices` + `optionalServices` generic thermal UUIDs, singleton, `gattserverdisconnected`→ล้าง), `isSlipSupported` **feature-detect** (iOS/no-BT → false ไม่ crash), `renderReceiptCanvas` (normalizer รับได้ทั้ง POS `lastReceipt` และ receipts record), `printReceipt`/`testPrint`. **UI:** settings About เพิ่มการ์ด "🖨️ เครื่องพิมพ์สลิป (Bluetooth)" (เชื่อม/ทดสอบ/ตัด + feature-detect ปิดปุ่มบน iOS แจ้งชัด); ปุ่ม "🖨️ สลิป BT" ในใบเสร็จหลังขาย (`main.js`) + reprint หน้ารายการใบเสร็จ (`receipts.js`). **null-guard** `window.open` เดิม (`main.js printLastReceipt` + `receipts.js rcPrintBtn`) กัน popup-block error เงียบ. **ขอบเขต: Android (Chrome/Edge) เท่านั้น** — iOS ไม่รองรับ Web Bluetooth. **ไม่แตะ:** checkout/`saveReceipt`/`auto_post`/money flow (อ่านใบเสร็จไปพิมพ์เท่านั้น) · `window.print()`/PDF/Share เดิม · `bt_printer.js` (label TSPL) · RLS/SQL. +guard `receipt_bt_raster`(6)/`receipt_bt_feature_detect`(6). unit 2634 · lint0. **ไม่มี SQL. ไม่เพิ่ม npm dependency** (Web API + canvas ล้วน). ⚠️ owner ต้องทดสอบพิมพ์ออกจริง/ไทยสวย/UUID บน Android + เครื่องสลิปจริง (ไม่มีฮาร์ดแวร์ใน CI).
- fix(pos,accounting,settings,build 584): **POS view sticky + JV header persist + settings nav listener bind-once (re-render/listener กินสถานะที่ผู้ใช้กรอก · 3 บั๊กอิสระ)** — **B (accounting correctness, §4.3):** `accounting/journal_form.js` header (วันที่/ประเภท/คำอธิบาย) เดิมอยู่ใน DOM เท่านั้น → กด "+ เพิ่มบรรทัด"/ลบบรรทัด rebuild `innerHTML` = รีเซ็ตเป็น today/JV/ว่าง **เงียบ**; `_save` อ่านจาก DOM → JV โพสต์ด้วย**วันนี้**แม้ผู้ใช้ตั้ง period ก่อน (`validateJournalDate` ไม่ดัก) = **โพสต์ผิด period เงียบ** + `doc_no` prefix ผิดเดือน. แก้: header เป็น module state `_header` (mirror `_lines`) — init วันที่เฉพาะ guard `!_header.doc_date`, template ผูก `escAttr(_header.*)` + option `selected`, header inputs → `_header`, `_save` อ่าน `_header` (single source ไม่พึ่ง DOM timing), reset `_header` คู่ `_lines` ที่ cancel+post-save. **A (UX รายวัน):** `pos.js`/`main.js` `refreshPosPage()` (mirror `refreshProductsPage`) — `renderAll` background reload (deferred `loadAllData` 10s–2min) เดิมเรียก `renderPosPage` เต็ม = เด้ง home/ดีดสกอลล์ระหว่างพิมพ์ numpad/เลือกจ่าย/ค้นหา; ตอนนี้ mid-flow (`posView!=home`) → short-circuit ไม่แตะ DOM, home → refresh แบนเนอร์ผ่าน `renderPosView` (**ไม่แตะ** `posView`/`numpadValue`/`quickPayAmount`/`_checkoutKey`/`_resetCreditState`); `renderAll` เพิ่ม `currentRoute==="pos" && refreshPosPage()` ต่อจาก products (navigate จริงผ่าน `showRoute` ยังเรียกเต็ม = เริ่ม home เดิม). **C (companion):** `settings/index.js` `navigate-settings` listener bind ครั้งเดียว (`_navBound`) — เดิมทุก render/navigate เพิ่ม listener ซ้ำ → navigate ทวีคูณ. **ไม่แตะ:** checkout/multi-pay/void/`_checkoutKey` logic · stock CAS · `_save` POST flow · `validateJournalDate`/`date_guard` · `doc_no` seq · `auto_post` · RLS/SQL · `loadAllData` cap · line handlers `_lines`. +guard `jv_form_header_persist`(6)/`pos_view_sticky`(4)/`settings_nav_listener_once`(2). unit 2622 · e2e 14/14 · lint0. **ไม่มี SQL.**
- fix(receipts,build 583): **ดึงใบเสร็จเต็มช่วงจาก DB — ยอดรวม/ค้นหา/Excel ไม่ขาดจาก cap 50 (ปิดกลุ่ม money-display)** — หน้าใบเสร็จ (`renderReceiptsPage`) summary "ยอดรวม" (เงิน) + ค้นหา + Excel + tab counts ทำบน `ctx.state.receipts` **cap 50** (`loadAllData`) → ใบเสร็จสะสม >50 = ยอดรวมขาด · ค้นใบเก่าไม่เจอ · Excel ไม่ครบ (เอกสารการเงินอ้างอิงบัญชี/ภาษี). **แก้:** `range_fetch.js` เพิ่ม **`fetchReceiptsSince(cutoffKey)`** (mirror `fetchExpensesSince` — `created_at >= bufferedSince`, paginated, `""`→ทั้งหมด, `order=created_at.desc`); `receipts.js` async-load (mirror loyalty Phase 581): module state `_rcAllRows`/`_rcState`/`_rcSeq`/`_rcKey` + `_loadReceiptsRange` (**cache keyed `_rcDateRange`** — เปลี่ยน range → refetch; search/tab → client-side ไม่ refetch; idle/seq-guard กัน loop/stale). `renderReceiptsPage`: **`receipts = (loaded && key ตรง) ? _rcAllRows : ctx.state.receipts` fallback (จุดเดียว)** → scoped/counts/summary/`filtered`/Excel อ่าน set เต็ม; client-side date filter (`dateBkk`) เดิมคง exact bound; loading/error → ป้าย "~50 ใบล่าสุด" + ปุ่ม `rcRetryBtn` (reset idle), loaded → เงียบ. **verify Excel:** `rcExportBtn` map จาก `filtered` ← `scopedReceipts` ← `receipts` (= `_rcAllRows` เมื่อ loaded) = ครบตาม range จริง (ไม่ใช่ state cap). **READ-ONLY** ไม่แตะ mutation handlers (multi-pay save/void/repost JV Phase 574/575) · `_repostReceiptJvIfChanged` · `_multiPayGuard` · `logActivity` · `loadAllData` cap · receipt detail/print · RLS. +guard `receipts_range_fetch` (9: behavioral mock-fetch + source). unit 2610 · e2e 14/14 · lint0. **ไม่มี SQL.**
- fix(reports,build 582): **top_customers + profit_by_product ดึงยอดขายเต็มจาก DB (sales ranking · money-display)** — 2 หน้ารายงานจัดอันดับอ่านจาก `state.sales` **cap 50** (`loadAllData`) → ranking/ยอดเพี้ยนเมื่อร้านมี >50 บิลในช่วง: `top_customers.js` (อันดับลูกค้าตามยอดซื้อ + `totalRevenue`/top5) · `profit_by_product.js` (กำไรรายสินค้า). **แก้ (mirror `profit_report.js:74`):** ทั้งสองหน้ามี period selector → `cutoffKey` (all→`""`) → **`fetchSalesSince(cutoffKey)`** ดึงเต็มช่วง (paginated); `visibleSalesForRole` ครอบ fetched rows (role isolation คงไว้); client-side date filter เดิมคง exact bound (helper buffer -2 วัน = candidate superset); **fetch ล้ม → fallback `state.sales` + toast + ป้าย ⚠️ "จาก ~50 บิลล่าสุด"** (ไม่ 0/เพี้ยนเงียบ). `top_customers` restructure โหลด sales ก่อน sale_items; `profit_by_product` wrap async IIFE (sales ก่อน sale_items) + `_ppRenderBody` รับ `salesFetchOk`. **READ-ONLY** ไม่แตะ `fetchSaleItemsForSaleIds` · money mutation · `loadAllData` cap · `visibleSalesForRole` · RLS. **verify ข้อ 4 (follow-up ไม่แก้):** `customers.js:137` `getCustomerTier(c.id, state.sales)` (tier จาก cap 50) · `cash_recon` per-day (flagged Phase 578) · receipts ยอดรวม/ค้นหา/Excel cap 50 = **Phase 583 (known)**; (`credit_tracker` ใช้ `fetchCreditSales` แล้ว · `dead_stock` เลี่ยง cap แล้ว). +guard `sales_ranking_fetch` (6). unit 2601 · e2e CI · lint0. **ไม่มี SQL.**
- fix(loyalty,build 581): **หน้าแอดมินดึงแต้มเต็มจาก DB — summary ไม่ขาดจาก cap 500 (companion Phase 580)** — หน้า loyalty ฝั่งแอดมิน (`renderLoyaltyPage`) summary (`customersWithPoints`/`totalEarned`/`totalRedeemed`/`totalRemaining`/`totalValue`) + per-customer อ่านจาก `state.loyaltyPoints` **cap 500** (`loadAllData`) → เมื่อ loyalty rows รวม >500 ตัวเลขสรุป**ต่ำกว่าจริง** + **"คงเหลือ" ติดลบได้** (earn เก่าหลุดหน้าต่างก่อน redeem). staff อ่าน `loyalty_points` ได้ (ไม่โดน customer-deny Phase 505) → fetch เต็ม paginated แล้ว aggregate จากชุดเต็ม. **แก้ (`loyalty.js`):** module state `_loyAllRows`/`_loyState`/`_loySeq` + `_loadAllLoyalty` (`fetchAllRowsRaw` paginate, idle-guard กัน loop, seq-guard กัน stale, re-render เมื่อเสร็จ, error → null cache) — mirror dashboard Phase 562; `renderLoyaltyPage`: `loyaltyPoints = loaded rows else state fallback` (จุดเดียว → summary/tabs/per-customer อ่านครบพร้อมกัน); ป้าย loaded → เงียบ / loading → "~500 ล่าสุด" / error → ปุ่ม retry (reset idle). **แต้มฝั่งลูกค้าแก้แล้วผ่าน proxy Phase 580** — เฟสนี้เฉพาะหน้าแอดมิน. **READ-ONLY** ไม่แตะ `getCustomerPoints`/redeem precheck (server-enforce Phase 540) · `earnPoints`/`redeemPoints` · `reverseEarnedPointsForSale` (อ่าน DB ตรงอยู่แล้ว) · `loyalty_settings` · `loadAllData` cap · RLS. +guard `admin_loyalty_fetch` (5). unit 2595 · e2e 14/14 · lint0. **ไม่มี SQL.**
- feat(loyalty,build 580): **proxy ให้ลูกค้าเห็นแต้มจริง (server-derived id — RLS-safe)** — `loyalty_points` มี RESTRICTIVE deny สำหรับ customer role (Phase 505 GROUP A) → `state.loyaltyPoints` ว่างสำหรับลูกค้า → `customer_dashboard` โชว์ **"0 แต้ม" เสมอ** (บั๊กตั้งแต่ Phase 505). แก้ด้วย Cloudflare Function proxy (pattern เดียวกับ ning-memory Phase 569 / verify-slipok): **`functions/api/v1/loyalty-balance.js` (GET)** อ่านด้วย service-role (bypass RLS) แต่ **★ derive customer identity จาก JWT ฝั่ง server เท่านั้น** (`data.user.email` → phone → `customers.id`) — **ห้ามรับ phone/customer_id จาก request** (กันลูกค้า A อ่านแต้ม B); `balance = Σ earn − Σ redeem` (mirror `getCustomerPoints`) + paginate loyalty rows; email non-customer/ning-agent → 403; `SUPABASE_SERVICE_ROLE_KEY` required (ไม่ fallback anon); error sanitize (`logServerError`/`clientError`). **`_middleware.js`:** +`/api/v1/loyalty-balance` ใน `REQUIRE_AUTH` + `RATE_LIMITS` (60/60s) — **ไม่** `STAFF_ONLY`/`NING_AGENT` (customer JWT ผ่านได้). **`customer_dashboard.js`:** points tab + hero badge เรียก proxy (แนบ JWT ลูกค้า) → cache keyed phone (re-render ไม่ refetch), loading → skeleton, error → ปุ่ม retry (ไม่โชว์ 0 หลอก), logout เคลียร์ cache (กัน A→B) — **เลิกพึ่ง `state.loyaltyPoints`** ในจุดแต้ม. **ไม่แตะ:** redeem flow (`redeem_loyalty_points_atomic` server-enforce) · `loyalty.js` แอดมิน (cap 500 = แยกเฟส) · RLS/SQL/auth flow. +guard `loyalty_balance_proxy` (9: behavioral `phoneFromEmail`/`getServiceAuth` + source-regex isolation/balance/middleware/dashboard/sanitize). unit 2590 · e2e CI · lint0. **ไม่มี SQL** (loyalty_points/customers มีอยู่แล้ว; service-role bypass RLS).
- fix(accounting,build 579): **ปิดงวด fail-closed — ตรวจไม่ครบ/เกิน cap = ⚠️ ไม่เขียวหลอก (period-close readiness · accounting blocker)** — close-readiness ของ "ปิดงวดบัญชี" (`modules/accounting/periods.js` · `fetchCloseReadiness`) เดิม 2 จุด **"fail-safe-green"** + cap 1000 → การ์ดโชว์ "ปิดงวดได้ ✅" ทั้งที่ตรวจไม่ครบ: **(a) completeness** — fetch source ids ไม่มี limit (cap 1000) + `id=in.(1000 ids)` URL ยาวเสี่ยง fail → `!ok`/`catch{}` เงียบ → `orphanSrc` คง 0 = เขียว; **(b) orphan JV** — `journal_entries` fetch ไม่มี limit (cap 1000) + existence check `er.ok ? Set : new Set(uniq)` (fail → **ถือว่ามีครบ**) + `catch{}` เงียบ → `orphanJV` คง 0 = เขียว. เทียบ **(c) service** ที่ทำ**ถูก**: fetch fail → `serviceUnknown=true` → ไม่เขียว. **แก้:** (a)/(b) fail-**CLOSED** เหมือน (c) — paginate ผ่าน `fetchAllRowsRaw` (เกิน 1000 ได้ครบ, throw บน error) + batch `id=in.(...)` chunk 120 กัน URL ยาว; fetch/existence fail → `srcUnknown`/`jvUnknown=true` (ไม่ใช่ข้ามเงียบ→เขียว). `return` += `srcUnknown,jvUnknown`; `ready` += `!srcUnknown && !jvUnknown`; `_monthNeedsAttention` + `_readinessLinesHtml` (บรรทัด ⚠️ unknown สีเหลือง + เงื่อนไข "ครบ ✅") + **lock-confirm issues dialog (consumer ที่ 3 — Iron Rule #1)** รวม `srcUnknown/jvUnknown` (กัน confirm บอก "✅ พร้อมปิด" หลอก). **READ-ONLY** ไม่แตะ Dr=Cr balance check/period lock trigger/การโพสต์ JV/(c) service/`_classifyOrphan`/RLS. +guard `period_readiness_failclosed` (9: behavioral pure fn `_monthNeedsAttention`/`_readinessLinesHtml` + source-regex). unit 2581 · e2e 14/14 · lint0. **ไม่มี SQL.**
- fix(reports,build 578): **profit_report + expense_overview ดึงรายจ่ายเต็มจาก DB (follow-up Phase 577 · money-display)** — เสียบ helper `range_fetch` (Phase 577) 2 จุดที่เหลือ. **(1) `profit_report.js`:** sales ดึงเต็มผ่าน `fetchSalesSince` (:74) แล้ว แต่ `expensesInRange` (:111) ยังกรองจาก `state.expenses` cap 200 → **"กำไรสุทธิ" สูงเกินจริง** (revenue เต็ม − expense ขาด) เมื่อร้านมี >200 รายจ่าย/ช่วง. แก้: `Promise.all([fetchSalesSince(fromDate), fetchExpensesSince(fromDate)])` (ขนาน); sales fail = hard-stop เดิม, **expenses fail = fallback `state.expenses` + warn** "กำไรสุทธิอาจสูงกว่าจริง" (ไม่ 0 เงียบ); `expensesInRange` กรองจาก `_fetchedExpenses` (client-side `fromTs/toTs` เดิมคง exact boundary). **(2) `expense_overview.js`:** raw `fetch` (:60) ไม่ paginate → >1000 รายจ่าย/ช่วง = ยอดรวม/เฉลี่ย/Top ขาดเงียบ. แก้: `fetchExpensesSince(startStr)` (paginated), คง `renderError`+`eoRetryBtn` เดิม (auth 401/403 hint คงไว้), **re-filter `expense_date >= startStr` client-side** (helper buffer -2 วัน = candidate superset — กัน over-count 2 วัน), ลบ `cfg/token/headers` ที่ไม่ใช้แล้ว. **READ-ONLY** ไม่แตะ money mutation/`auto_post`/P&L·TB·BS/`loadAllData` caps/`range_fetch.js`/RLS. **verify ข้อ 3 (follow-up ไม่แก้):** `top_customers.js` + `profit_by_product.js` (sum จาก `state.sales` cap 50, ไม่มี `fetchSalesSince`) · `expenses.js` month expense total (`state.expenses` cap 200) · `cash_recon.js` per-day cash-in/out (cap, >50 บิล/วัน). +guard `profit_expense_fetch` (9, source-regex; behavioral ของ helper cover แล้วใน `income_dashboard_fetch`). unit 2572 · e2e CI · lint0. **ไม่มี SQL.**
- fix(reports,build 577): **income/dashboard ดึงยอดเต็มจาก DB — เลิกโชว์ตัวเลขขาดจาก cap (money-display B1+B3)** — ตัวเลขเงินหน้า "ภาพรวมรายได้" (`income_overview.js` ทั้งหน้า) + Dashboard (กำไรสุทธิเดือน/รายจ่าย/รายได้บริการ/ออเดอร์เว็บ) เดิมคิดจาก `state` ที่ `loadAllData` cap ไว้ (`state.expenses` 200 · `state.serviceJobs` 50) → ร้านที่มี >200 รายจ่าย/>50 งาน ต่อช่วง **โชว์ต่ำกว่าจริงเงียบ ๆ** (Phase 562 แก้เฉพาะ sales ผ่าน `_dashSalesRows` แล้ว). แก้: `modules/range_fetch.js` ใหม่ (paginated read-only, mirror `sales_fetch.js`, reuse `bufferedSince`) — `fetchExpensesSince` + `fetchServiceJobsSince` (service ใช้ PostgREST OR `closed_at.gte|created_at.gte` = **superset** ของ income-date `closed_at` (Phase 542 cash-basis, ตรง JV) + web-order-date `created_at`); dashboard เพิ่มบล็อก aux **แยก** (`_dashExpenseRows`/`_dashServiceRows`/`_dashAuxState`/`_dashAuxSeq` — คงบล็อก sales Phase 562 เดิมไว้ครบ เพื่อไม่ทำ `dashboard_sales_fetch_guard` แดง) → KPI/ป้ายอ่านชุดเต็มเมื่อ `loaded`, fallback `state`+⚠️ เมื่อ error; `income_overview` จาก pure-state เป็น fetch-backed (skeleton→loaded/error+ปุ่ม retry, cache keyed user/role/ปี, filter ช่วงจริง client-side เหมือนเดิม). **READ-ONLY** ไม่แตะ money mutation/`auto_post`/P&L·TB·BS/`loadAllData` caps/RLS — worst case = พฤติกรรมเดิม. **verify (follow-up, ไม่แก้ในเฟสนี้):** `profit_report.js:111` netProfit ยังใช้ `state.expenses` cap 200 (revenue เต็มแต่ expense ขาด → net เกินจริง) · `expense_overview.js:60` fetch แต่ไม่ paginate — ทั้งคู่ใช้ helper นี้ได้. +guard `income_dashboard_fetch` (15, behavioral+source) + update `dashboard_income_guard` source (`state.serviceJobs`→`_serviceForAgg`, คง `serviceIncomeDate` invariant). unit 2563 · e2e CI · lint0. **ไม่มี SQL.**
- fix(quotations,build 576): **กันบันทึกทับตอนโหลด items ล้ม + เช็คผล delete/insert (quotations items integrity)** — `modules/quotations.js` มี 2 จุดเสริมกันจนอันตราย: (1) โหลด `quotation_items` ใบเดิมล้ม → `catch { _lineItems = [] }` **เงียบ** 4 จุด (pending-preview/`openEditForm`/`openPreview`/`convertToDeliveryInvoice`) — user ไม่รู้ว่าฟอร์ม/เอกสารว่างเพราะโหลดพัง (2) `saveQuotationFull` edit path: `xhrDelete("quotation_items")` + loop `xhrPost` **ไม่เช็คผล** → toast สำเร็จเสมอ. scenario ร้ายสุด: เน็ตสะดุดตอนกดแก้ไข → ฟอร์มว่าง → กดบันทึก → **DELETE รายการทั้งใบ + toast สำเร็จ = หายถาวรแบบเงียบ**. แก้: flag `_lineItemsLoadFailed` (set ใน catch โหลดล้ม · reset เมื่อโหลดสำเร็จ/เปิดใบใหม่/ออกฟอร์ม/บันทึกสำเร็จ) + toast แจ้งทุก catch; `openPreview`/convert โหลดล้ม = **ยกเลิกการเปิด/แปลง** (เอกสาร 0 รายการห้ามเกิด); `saveQuotationFull`: guard `_editingId && _lineItemsLoadFailed` block ก่อนถึง `xhrDelete` + เช็คผล delete (`!ok → throw`, เพิ่ม catch รับ → toast — เดิม try/finally ไม่มี catch) + insert loop เก็บ `failedItems` แบบ Phase 412 (มี fail แจ้งจำนวน + **ห้าม toast สำเร็จ**). **verify:** grep `_lineItems = []` ทุกจุด + `quotation_items` ทั้ง repo — จุดโหลดอยู่ใน quotations.js ครบทั้ง 4 แล้ว ไม่มีไฟล์อื่น. ไม่แตะ PDF flow/convert logic อื่น/ไฟล์อื่น. +guard `quotations_items_integrity` (13). unit 2548 · e2e 14 · lint0. **ไม่มี SQL.**
- fix(receipts,build 575): **เช็คผล PATCH ก่อน mutate/repost JV — ปิด multi-pay สำเร็จปลอม (money/GL)** — handler บันทึก multi-payment ใบเสร็จ (`receipts.js` ใต้ `_multiPayGuard`) เดิม `await window._appXhrPatch?.(...)` **ไม่เช็คผล** — `xhrPatch` ไม่เคย throw (คืน `{ok:false}` ทั้ง RLS/network/timeout/`undefined`) → ไหลต่อ: mutate `r.payments` + void/repost JV ตาม method ใหม่ที่ **DB ไม่ได้รับ** + toast "บันทึกแล้ว ✅" = **GL ไม่ตรงกับ receipts จริง**. แก้: `const res = await ...` + `if (!res?.ok) throw` **ก่อน** ทุก optimistic (payments/payment_method/`_repostReceiptJvIfChanged`/toast/re-render) → catch เดิม rollback ปุ่ม; error toast บอกสาเหตุจริง (เดิม hardcode "รัน SQL phase69" = mislead ตอนพังจาก RLS/network). **verify:** `_appXhrPatch` จุดอื่นใน receipts.js เช็ค `res.ok` ครบแล้ว (cancel/status/paid/created_at/method single-edit/invoice-revert ×4) — multipay เป็น**จุดเดียวที่หลุด**. ไม่แตะ `_repostReceiptJvIfChanged`/`_multiPayGuard`/handler อื่น. +guard `receipts_multipay_patch` (5). unit·e2e·lint0. **ไม่มี SQL.**
- feat(catalog,build 574): **แคตตาล็อกแอร์ sync ทุกเครื่องผ่าน `ac_catalog_doc` (รวมหน้าลูกค้า)** — เดิม (1) แคตตาล็อกเป็น localStorage ต่อเครื่อง → desktop/มือถือ staff ไม่ตรงกัน; (2) หน้าร้านลูกค้าอ่านไฟล์ static `data/ac_catalog.json` → **ราคาที่ owner แก้ ลูกค้าไม่เคยเห็น** (บั๊ก product จริงตั้งแต่ Phase 347). แก้ด้วยตารางใหม่ **`ac_catalog_doc`** (single-row jsonb): SELECT ได้ทุก `authenticated` (ราคาโชว์ลูกค้าโดยดีไซน์), INSERT/UPDATE เฉพาะ `NOT is_customer_role()` (reuse helper Phase 505), **ไม่มี DELETE policy** (ล้าง=UPDATE value=[]). `main.js`: `loadAcCatalogCloud()` (afterLogin ก่อน loadAllData ทุก role — array>0 → set `bsk_ac_catalog`+`from_cloud`; ไม่มีแถว+`user_edited`+non-customer → seed push local ขึ้น; fail → เงียบ ใช้ localStorage เดิม) + `saveAcCatalogCloud()` (upsert id=1, gate customer=no-op, expose `window._appSaveAcCatalog`) + `needRefresh` เพิ่ม `!fromCloud` (cloud=source of truth ห้าม static ทับ). `settings/ac-catalog.js`: `_writeCatalog` เขียน local **ก่อน** แล้ว sync cloud (fail=toast "บันทึกในเครื่องแล้ว แต่ sync ข้ามเครื่องไม่สำเร็จ"); ปุ่ม "โหลดใหม่จาก JSON" + "ล้างทั้งหมด" push ขึ้น cloud ด้วย (ปิดช่อง mutation ที่ไม่ผ่าน `_writeCatalog`). localStorage เหลือเป็น cache → **`customer_dashboard.js` ไม่ต้องแก้**. **★ ห้ามใช้ `app_settings`** (GROUP A Phase 505 = customer deny). 🔴 **owner รัน `supabase-phase574-ac-catalog-doc.sql`** ก่อน merge (code degrade-safe: ตารางไม่มี → fetch fail เงียบ → พฤติกรรมเดิม). **known:** last-write-wins ทั้งก้อน (ร้านแก้คนเดียว—รับได้). ไม่แตะ customer_dashboard/app_settings/ac_catalog.json/RLS ตารางอื่น. +guard `ac_catalog_cloud_sync` (9) + update `no_clobber` (needRefresh `!fromCloud`). unit·e2e·lint0.
- fix(boot,build 573): **safeParse localStorage — key เสียไม่ทำแอปขาว + self-heal** — `JSON.parse(localStorage.getItem(key))` ตอน **module evaluation** ไม่มี try/catch → key เดียวเก็บ JSON เสีย = **throw ตอน import = แอปขาวถาวร** (selfheal ล้างแค่ SW/Cache ไม่แตะ localStorage → refresh กี่รอบก็ไม่หาย = boot-loop). helper ใหม่ `modules/_safe_parse.js` `safeParse(key, fallback, storage)`: parse ผ่าน→ค่า · ไม่มี/ว่าง→fallback · **เสีย→`removeItem` (self-heal: boot ถัดไปสะอาด) + fallback** · `getItem` โดน block (SecurityError/private mode)→fallback ไม่ throw. ใช้ 3 จุด top-level: `main.js` state init 4 keys (`bsk_cart_v2`/`bsk_last_receipt`/`bsk_store_info`/`bsk_payment_info` — migrate IIFE ของ paymentInfo ต่อเหมือนเดิม, แตะเฉพาะบรรทัด parse) + `customer_dashboard.js` (`bsk_cust_cart` — เดิม throw = lazy import reject = ลูกค้าติดหน้าเปล่า). **corruption vector จริง:** หน้ากู้ backup (`settings/pages.js` restore) เขียน `bsk_*` เช็คแค่ `typeof string` → เพิ่ม allowlist `_JSON_KEYS` (store_info/payment_info/product_settings/ac_catalog/cart_v2/last_receipt/cust_cart) ต้อง `JSON.parse` ผ่านก่อน `setItem` (ไม่ผ่าน=ข้าม+นับ+แจ้งสรุป); key plain-string (dark_mode/store_logo/slipok_branch) restore ตามเดิม; คง deny `bsk_slipok_key` (Phase 543). **ไม่แตะ:** `selfheal.js` · `JSON.parse` ที่มี try/catch อยู่แล้ว (loadAllData/product_settings) · logic อื่น. +guard `boot_safe_parse` (9: behavioral valid/missing/corrupt+removeItem/block/empty + source main·custDash·pages). unit·e2e·lint0. **ไม่มี SQL.**
- fix(auth,build 572): **filter TOKEN_REFRESHED/event ซ้ำ — เลิก re-render ทั้งแอปทุกชั่วโมง (ต้นน้ำหน้าเด้ง)** — `onAuthStateChange` (main.js) เดิมเรียก `afterLogin()` **ทุก event ที่มี session** → (1) `TOKEN_REFRESHED` (ทุก ~1 ชม. + ตอน tab กลับ focus) ทำ `loadAllData`+`renderAll` เอง = **หน้า reset/ฟอร์มหาย/settings เด้ง** โดย user ไม่ได้ทำอะไร (นี่คือ**ต้นน้ำ**ที่ Phase 570 แก้ปลายน้ำ); (2) boot รัน afterLogin **ซ้ำ 2-3 รอบ** (getSession เรียกเอง + listener รับ `INITIAL_SESSION`/`SIGNED_IN` ซ้ำ). แก้: **token (`window._sbAccessToken`) ยัง set ทุก event เสมอ** (token สดคือหัวใจ — ห้ามพัง) แต่เพิ่ม 2 filter หลัง PASSWORD_RECOVERY branch: (c) `TOKEN_REFRESHED`/`USER_UPDATED` → `return` (ไม่ reload/re-render); (d) same-user guard — module var `_appSessionUserId` (ตั้งใน `afterLogin` หลัง `loadProfile`, ล้างตอน sign-out) → user เดิม init แล้ว = `return`. **ไม่แตะ:** token assignment · PASSWORD_RECOVERY branch · boot getSession · `createEmailAuth`/OTP/recovery flow · `loadAllData`/`renderAll`/afterLogin logic (นอกจากบรรทัดตั้ง var). +guard `auth_event_filter` (7: token-before-filter order + TOKEN_REFRESHED/USER_UPDATED return + same-user guard + sign-out clear + afterLogin mark + recovery order). unit·e2e·lint0. **ไม่มี SQL.**
- fix(pos,build 571): **`_checkoutKey` รอด background reload — กันบิลซ้ำตอน retry** — `renderPosPage` (pos.js) เดิม `_checkoutKey = null` **ทุกครั้ง** แต่ `renderAll()` หลัง background `loadAllData` (deferred 10s–2min หลัง save งานต่าง ๆ) ก็เรียก `renderPosPage` → จังหวะ retry หลัง checkout timeout ได้ **key ใหม่** → `uq_sales_checkout_key` ดัก replay ไม่ได้ = **บิลซ้ำ/ตัดสต็อกซ้ำ/JV ซ้ำ**. แก้ (บรรทัดเดียว): reset key **เฉพาะเมื่อ `state.cart` ว่าง** — ตะกร้าไม่ว่าง = intent เดิมยังไม่จบ → คง key (ตรงเจตนา comment Phase 520 "ใช้ค่าเดิมตอน re-submit/back-nav"); ตะกร้าว่าง = intent จบ/ใหม่ → ล้างเหมือนเดิม (success ล้าง cart+key ที่ L1653/1659 อยู่แล้ว). **ไม่แตะ:** `clearPosState` (logout ล้างเสมอ) · replay branch · success reset · `_resetCreditState` (Phase 581) · `doCheckout`/replay lookup/เครดิต/view state (`posView`/`numpadValue`). +assert ใน `checkout_key_credit_guard` (renderPosPage guarded + clearPosState unconditional; assert เดิม 11 ตัวไม่แก้). **known-risk:** ถ้า sale timeout (client เห็น error) แต่ server commit จริง แล้ว user เคลียร์ตะกร้าเอง (ไม่ผ่าน renderPosPage) + ใส่ของใหม่ → key เดิมค้าง → checkout ถัดไป replay บิลเก่า; edge แคบ + เดิมก็เสี่ยง dup ที่หนักกว่า — net ปลอดภัยขึ้น. **ไม่มี SQL.**
- fix(settings,build 570): **กัน settings หน้าย่อยเด้งกลับเมนู + แคตตาล็อกแอร์ไม่ถูกทับ + export ac_type** — (1) **หน้าย่อยเด้ง:** `showRoute` (main.js) เขียน hash ทับตอน background reload โดยเก็บแค่ `?query` ทิ้ง subpath → `#settings/ac-catalog` → `#settings` → `settings/index.js` restore เป็น 'main'. แก้: main route เดิม → **คง hash ทั้งก้อน** (subpath+query); route เปลี่ยนจริง → `#route` ใหม่ (แก้บล็อก replaceState เดียว). (2) **แคตตาล็อกแอร์ถูกทับ:** `loadAllData` (Phase 87.5) เดิม specs coverage <90% → fetch `ac_catalog.json` **ทับทั้งก้อน** → รุ่น/การแก้ไขที่ user เพิ่ม (ไม่มี spec → ลาก coverage ต่ำ) หาย. แก้ด้วย **flag** `bsk_ac_catalog_user_edited` (helper `_writeCatalog` ตั้ง flag เมื่อ add/edit/import/set-stock; manual "โหลดใหม่จาก JSON" เคลียร์) → auto-refresh **ข้ามเมื่อ user เคยแก้ + cache ใช้ได้**; refresh เฉพาะ cache ว่าง/พัง (กู้). (3) **export/import ac_type:** เพิ่ม `ac_type` (+ cost/sku/note) ใน `_EXPORT_HEADERS`/`_toExportRow`/`_fromImportRow` — import รับ key อังกฤษ (wall/ceiling/cassette) + หัวไทย ("ประเภท": ติดผนัง/แขวน/สี่ทิศทาง → map key) → owner export → เติมประเภท 223 รุ่นใน Excel → import กลับในรอบเดียว. **เลือก flag แทน merge** (ง่าย/robust: user data รอด 100% zero-clobber; trade-off = ไม่ได้ spec-refresh หลังแก้ครั้งแรก — ยอมรับได้ เพราะ user curate เอง + refresh ตอน cache พัง). **localStorage ล้วน** — ไม่แตะ DB/เงิน/สต็อกจริง/ac-stock-form/`acTypeOf` fallback "wall". +guard `settings_subpage_hash`/`ac_catalog_no_clobber` (24) + update `ac_stock_manager` (export 24→28 col, owner ขอกลับจากที่เคยล็อกห้าม). unit 2502·e2e 14·lint0. **ไม่มี SQL.**
- fix(service,build 568): **drawer สร้างงานช่างใหม่ ใช้ client_uuid+replay — ปิด insert gap ตัวสุดท้าย** — `saveServiceJob` (main.js) insert งานใหม่ผ่าน `xhrPost` (timeout 15s) **ไม่มี idempotency** → timeout/เน็ตหลุดหลัง commit → inflight guard ปล่อย → กดใหม่ = row ซ้ำ. **หนักกว่า 3 ฟอร์ม (Phase 567):** case `newJobAlreadyComplete` (แอดมินสร้างใหม่+ปิดงานเลย) drawer โพสต์ JV ตอน save ตรง ๆ → dup row = **dup JV โดยตรง**. แก้ (reuse helper Phase 567, **ไม่มี SQL ใหม่** — client_uuid+UNIQUE applied 2026-07-06): 3 จุดใน main.js — import helper · `openServiceJobDrawer(job==null)` gen `_serviceDrawerInsertKey` (edit ไม่ gen, PATCH by id idempotent) · insert branch เรียก `insertServiceJobWithReplay` ผ่าน **adapter คงรูป `res{ok,data,error}`** (downstream `res.ok`/`res.data?.id` ไม่แก้) + `fetchFn=appAuthFetch` (fetch-compat + inject token สด override + 401-refresh = auth เท่า xhrPost เดิม) + reset key หลังสำเร็จ/replay. **JV block คง flow เดิม** — replay: `jobId`=row เดิม → `postJournalForServiceJob` idempotent by `source_id` (โพสต์แล้ว skip / ยังไม่ลง โพสต์ให้ครบ; **ห้าม skip**). **ไม่แตะ:** xhrPatch/edit path · JV/void structure · stock deduct-on-close/precheck · `_serviceJobSaveGuard` · api.js · `_insert_idempotency.js`. +guard `service_drawer_idempotency_guard` (7) + widen deduct-on-close window (14k→16k). unit 2469·e2e 14·lint0. **ไม่มี SQL.**
- fix(service,build 567): **idempotency key กันใบงานช่างซ้ำจาก timeout/retry (3 ฟอร์ม service_form/ac_install/solar)** — ฟอร์มช่าง POST `/service_jobs` ด้วย raw fetch + ปุ่ม re-enable ใน finally → server commit แล้วแต่ตอบช้า/เน็ตหลุด → user กดใหม่ = ใบงานซ้ำ 2 row → แอดมินปิดทั้งคู่ = auto-post revenue JV ซ้ำ**ทางอ้อม** (source_id ต่างกัน = idempotency auto_post ช่วยไม่ได้). แก้ต้นเหตุ: helper กลาง `modules/_insert_idempotency.js` — `createInsertIntent()` gen `client_uuid` ต่อ 1 ใบงาน (gen ที่ render, retry ใช้ค่าเดิม, reset หลังสำเร็จ) + `insertServiceJobWithReplay()` POST พร้อม client_uuid → **409 unique** (DB partial UNIQUE) / **timeout(AbortError)** / **network หลัง commit** → replay-lookup `?client_uuid=eq` คืน row เดิม (ไม่ POST ซ้ำ). degrade-safe: column ยังไม่มี (owner ยังไม่รัน SQL) → retry ไม่มี client_uuid (บันทึกได้ แค่ไม่ dedup). 3 ฟอร์มเปลี่ยน call site เป็น helper (ac_install/solar ได้ 15s timeout เพิ่ม) + optimistic push กัน dup ตอน replay. **ไม่แตะ** JV dead-code (`COMPLETION_STATUSES=[]` Phase 88.15 เจตนา)/postJournalForServiceJob/stock/slip/status/RLS. **drawer main.js:3000 (saveServiceJob สร้างใหม่) มีบั๊กเดียวกัน = Phase 567b แยก**. 🔴 **owner รัน `supabase-phase567-service-client-uuid.sql`** (ADD client_uuid + partial UNIQUE + NOTIFY) ก่อน deploy. +guard `service_idempotency_guard` (16: behavioral helper 409/timeout/degrade + source-regex 3 ฟอร์ม). unit 2462·e2e 14·lint0.
- fix(pos,build 566): **"ยอดที่ต้องเก็บจริง" เดียวทุกวิธีจ่าย — VAT exclusive โอน/บัตร + fix ปุ่มเสร็จสิ้นค้างตอนใช้เครดิต** — เพิ่ม pure helper `calcPayable(baseAmount, paymentInfo, creditUsed)` (ยกสมการจาก cash-input: Phase 88.21 VAT-exclusive + 517b-3 หักเครดิต) แล้ว reuse 4 จุด: (a) บัตรเครดิต `pendingPaidAmount`, (b) transfer-qr `_tPayable` (+ โชว์บรรทัดย่อย "(base + VAT x)" ตอน exclusive), (c) cash-input refactor **พฤติกรรมเท่าเดิมเป๊ะ**, (d) `updateCollectBtn` (live-numpad) — **fix บั๊กสด:** threshold เดิมไม่หักเครดิต + `baseAmount=quickPayAmount` ไม่มี fallback `cartSum` → บิลใช้เครดิตแล้วพิมพ์เลขพอดี ปุ่ม "เสร็จสิ้น" ค้าง disabled / ขายจากตะกร้า threshold=0. เดิมโอน/บัตรใช้ยอด**ก่อน** VAT → ตอนเปิด VAT (exclusive) จะเก็บเงินขาดเท่า VAT. **ร้านยังไม่เปิด VAT** → path ไม่มีเครดิต+VAT ปิด = เท่าเดิมทุกสตางค์. ไม่แตะ `doCheckout`/JV/`auto_post`/`calcVAT`/CAS/inflight/RLS/refund (VAT refund = Phase 567 แยก). +guard `pos_payable_guard` (12: calcPayable math VAT off/exclusive/inclusive/เครดิต clamp + source-regex 4 branch) + อัปเดต `credit_use_jv_split_guard` ให้ชี้ helper (คงเจตนา). unit 2446·e2e 14/14·lint0.
- feat(dashboard,build 564): **แถบเด่น "📨 งานช่างรออนุมัติ N งาน" บนภาพรวมบริษัท → คลิกเข้าหน้าอนุมัติเลย** — ใต้ hero "ยอดขายวันนี้" เพิ่มแถบม่วง (โผล่เฉพาะ `pendingReviewCount > 0`) admin เห็นจากหน้าแรกว่ามีงานช่างส่งรอตรวจ; คลิก → เด้งไปหน้าใบรับงานพร้อม filter "รออนุมัติ" เปิดอยู่. count นับแบบเดียวกับ chip review (`allJobs` ตัด cancelled+[ลบแล้ว] → `isServiceJobPendingReview`) = เลขตรง chip. เพิ่ม `setServiceJobsFilter(key)` export ใน service_jobs.js (รับเฉพาะ 5 key valid); click handler `.dash-clickable[data-go]` ตั้ง filter จาก `dataset.sjFilter` ก่อน showRoute. **read-only display+nav** — ไม่ fetch/write. ไม่แตะ approve/JV/stock/normalize/service_jobs render·save/status DB. +7 test.
- fix(service_jobs,build 563): **drawer แก้ไขงานช่าง — dropdown สถานะโชว์ "📨 รออนุมัติ" ถูกตอนงานรออนุมัติ** — เดิม `openServiceJobDrawer` (main.js:2429) restore dropdown ด้วย `job.status` ดิบ = "pending" (งาน "รออนุมัติ" เก็บ DB เป็น pending + note marker `[รออนุมัติแอดมิน]`; pending_review = UI-pseudo, Phase 383/545) → dropdown โชว์ "รอดำเนินการ". แก้: `$("serviceStatus").value = isServiceJobPendingReview(job) ? "pending_review" : (job?.status||"pending")` (helper เดียวกับ banner). **display-only round-trip neutral** — save (:2929-2930) `normalizeServiceJobStatus("pending_review")→pending` + `serviceJobNoteWithReviewMarker` คง marker → DB ไม่เปลี่ยน. ไม่แตะ normalize/save/JV/stock/banner/dropdown options/status DB. +7 test.
- fix(ui,build 562): **admin เปิดแอปไปหน้า "ภาพรวมบริษัท" (ไม่ใช่ "หน้าหลักช่าง") + ย้ายเมนูหน้าหลักช่างไปกลุ่ม "งานหลัก"** — ราก: fresh-login default route = `allowed[0]`; admin ROLE_PAGES=ALL_ROUTES และ ALL_ROUTES[0]="tech_home" (Phase 549) → admin เปิดมาเจอหน้าช่างก่อน. แก้ `main.js`: default = role-aware (`_roleHome`: technician→tech_home, customer→customer_dashboard, ที่เหลือ→dashboard; guard `allowed.includes` ก่อน) แทน allowed[0]. `index.html`: ปุ่ม 🧰 หน้าหลักช่าง ย้ายจากท็อป "งานประจำวัน" → ใต้ label "งานหลัก". **technician ยัง land หน้าหลักช่างเป็นหน้าแรก** (ถูกต้องตาม owner). ไม่แตะ ROLE_PAGES/สิทธิ์/POS/JV/stock/SQL. +5 test.
- fix(dashboard,build 561): **KPI เดือน/ปี + trend/chart ภาพรวมบริษัท ดึงยอดขายจริงจาก DB (เลิกพึ่ง state.sales cap 50)** — เดิม period/month/trend reduce จาก `state.sales` ที่ loadAllData cap 50 บิลล่าสุด → ร้านขาย >50 บิล/เดือน tab "เดือนนี้/ปีนี้" ต่ำกว่าจริง ("วันนี้" ถูกเพราะ <50/วัน). แก้ (dashboard.js, display/report-only): ลอกโครง async-cache Phase 508 → `_dashSalesRows/_dashSalesState/_dashSalesSeq/_dashSalesCacheKey`; `fetchSalesSince("YYYY-01-01")` (sales_fetch.js Phase 492, paginated ไม่ cap) เฉพาะตอน idle (กัน re-render loop) → role-filter `visibleSalesForRole` → re-render; period/เดือน/ปี/trend/chart/recent อ่าน `_salesForAgg` (loaded=เต็ม / ระหว่างโหลด|error=fallback state ≤50 + ป้าย ⏳/⚠️ ไม่หน้าขาว). caption trend ซื่อตรงตาม state. **read-only GET** (fetch ผ่าน import — guard readonly เขียว). ไม่แตะ POS/JV/stock/checkout/main.js loader/state write/credit·service cache/SQL. **known-residual:** กำไรสุทธิฝั่งรายจ่ายยัง state.expenses cap 200 (ร้านนี้รายจ่าย/เดือนน้อย = ยังไม่กระทบ; follow-up ถ้า >200); trend เดือนปีก่อน (Dec–Jan) ไม่ครบเพราะ fetch จากต้นปี. +10 test.
- feat(pos,build 560): **POS แคชเชียร์ ล็อกบัญชีรับโอนตามกลุ่มลูกค้า "หน้าร้าน" ที่ผูกใน Settings** — reuse binding เดิม (Phase 439 `bank.customerGroup`) ไม่มี setting ใหม่: หน้า POS รับโอน ถ้ามีบัญชีผูกกลุ่ม "หน้าร้าน" → ล็อกบัญชีนั้น ซ่อน dropdown โชว์ป้าย "🔒 บัญชีรับเงินหน้าร้าน (ผูกไว้ในตั้งค่า)"; ไม่ผูก+หลายบัญชี → dropdown เดิม + เตือนเบา; owner เปลี่ยนการผูกใน Settings → POS เปลี่ยนตาม ไม่ต้องแก้โค้ด. **★ money guard:** JV note (`validBanks[selectedBankIdx]`) resolve บัญชีจาก idx อีกครั้งตอน checkout → helper pure `_resolvePosBankIdx(validBanks, group, fallbackIdx)` คืน index + render **set `selectedBankIdx = idx`** ให้จอ+JV ลงบัญชีเดียวกัน. ไม่แตะ postJournalForSale/BANK_COA format/checkout/stock/VAT/credit/service QR/settings/SQL. +11 test.
- feat(service_form,build 558): **งานช่าง — โชว์ QR + เลขบัญชีเมื่อเลือก "โอน/QR" ให้ลูกค้าสแกนหน้างาน** — drawer ใบงานช่าง ช่อง "วิธีรับเงิน" เมื่อเลือก "🏦 โอน/QR → Dr 1130" แสดง QR พร้อมเพย์ + ชื่อ/เลขบัญชีร้าน (จาก `state.paymentInfo` ที่ตั้งใน ตั้งค่า → ข้อมูลการชำระเงิน) ใต้ช่องนั้นทันที — ช่างเปิดหน้างานแล้วให้ลูกค้าสแกนได้เลย ไม่ต้องสลับไปหน้า POS. helper pure `_svPayQrHtml(paymentInfo, method)` (source เดียวกับ customer_dashboard); เลือกเงินสด/ว่าง → หาย; งาน/ร่างที่ payment=transfer อยู่แล้ว เปิด drawer โชว์ทันที; ยังไม่ตั้ง QR/บัญชี → ข้อความชวนไป Settings (ไม่ error). ทุก field escape กัน XSS. **UI additive + read-only** — ไม่แตะ save/status/JV/stock/payment_method value/slip-verify/POS. +12 test.
- fix(pos,build 557): **ต้นทุนบิล "ชุด (bundle)" ครบวงจร — sale_items.unit_cost ต้นทาง + backfill ย้อนหลัง** (ต่อจาก 555) — #130 แก้เฉพาะ `sales.gross_profit` (KPI) แต่ตอน checkout ยังเขียน `sale_items.unit_cost` = cost ตัวชุดแม่ (มักตั้ง 0) → `profit_report`/`profit_by_product` (อ่าน unit_cost, fallback products.cost = แม่ = 0) กำไรบิลชุด **เฟ้อทุกบิลใหม่ต่อไป**. แก้: extract helper `_bundleUnitCost` (= Σ(child.cost × recipe.qty) ต่อหน่วย; ไม่มีสูตร/ต้นทุน 0 → fallback parent cost) ใช้ทั้ง `_computeGrossProfit` (DRY, เลขเท่าเดิมทุก case) และ `itemPayload.unit_cost`. + SQL owner-run `supabase-phase557` backfill ย้อนหลัง (STEP1 verify → STEP2 sale_items.unit_cost → STEP3 sales.gross_profit → STEP4 verify). **โครงแถว sale_items ไม่เปลี่ยน** (product_id ตัวแม่ 1 แถว — bundle_revert/refunds/receipts พึ่งโครงนี้) แก้เฉพาะค่า unit_cost. ไม่แตะ stock/JV/VAT/checkout_key. **known:** backfill ใช้ cost children ปัจจุบัน (ไม่มี historical cost); สูตร/ต้นทุนที่เปลี่ยนหลังขายทำให้คลาดได้. +test.
- fix(receipts,build 556): **แก้ช่องทางชำระ/ธนาคารของใบเสร็จที่เก็บเงินแล้ว → ลงบัญชีใหม่ให้ตรง** — เดิมแก้ "วิธีชำระหลัก" หรือ "ธนาคารรับเงิน" ของใบเสร็จ paid (3 จุด: ชุดชำระหลายช่องทาง/dropdown/หน้าแก้ไข) บันทึกค่าใหม่แต่ JV ค้างบัญชีเดิม (เช่น เปลี่ยนเงินสด→โอน แต่สมุดรายวันยัง Dr เงินสด). แก้: repost JV อัตโนมัติเมื่อบัญชี Dr เปลี่ยนจริง (ข้าม เงินสด↔โอน หรือเปลี่ยนธนาคาร) — เปลี่ยนที่ไม่กระทบบัญชี (เช่น "เงินสด"→"cash", แก้ ref) ไม่แตะเลขเอกสาร; ใบเสร็จในงวดที่ปิดแล้วเตือนให้ปรับ manual (ไม่ซ้ำซ้อน). display/accounting-only ไม่แตะ POS/สต็อก. +10 test.
- fix(pos,build 555): **กำไรขั้นต้น (KPI) ของบิล "ชุด (bundle)" — คิดต้นทุนจากของในชุดจริง** (audit S12) — เดิม `_computeGrossProfit` คิดต้นทุน bundle จาก cost ของตัวชุดแม่ (มักตั้ง 0) → กำไรขั้นต้นเกินจริงสำหรับบิลที่ขายชุด. แก้: ขยายสูตร bundle → children แล้วรวมต้นทุนลูก (reuse `expandBundleForRevert`) + preload สูตรทั้งหมดที่ loadAllData (`state.bundleRecipes`); ไม่มีสูตร → fallback แบบเดิม (ไม่ regress). **reporting-only** — ไม่แตะยอด/VAT/JV/สต็อก/checkout. +6 test.
- fix(cash_recon,build 554): **กระทบยอดเงินสด — ดึงข้อมูลรายวันตรงจาก DB + นับเก็บหนี้สดเข้าลิ้นชัก** — หน้ากระทบยอดเงินสดคำนวณ "ควรมีในลิ้นชัก" ผิด 2 เหตุ: (1) อ่าน `state.sales`/`state.expenses` ที่ถูก cap (50/200) → วันขายเกิน 50 บิล ยอดขาด = "เกิน/ขาด" ปลอม → แก้ให้ `computeCashRecon` fetch ข้อมูล "วันที่เลือก" ตรงจาก Supabase; (2) เงินสดจากรับชำระลูกหนี้ (credit_payments เงินสด) ไม่เคยถูกนับ → วันมีเก็บหนี้สดโชว์ "เกิน" เสมอ → เพิ่มบรรทัด "รับชำระลูกหนี้ (เงินสด)" + บวกเข้า expected. **display/report-only** — ไม่แตะ POS/checkout/stock/JV. **⚠️ verify schema เจอ prompt bug:** credit_payments ใช้คอลัมน์ `paid_at` ไม่ใช่ `created_at` (ถ้าใช้ created_at = fetch ล้มเงียบ) — แก้แล้ว + guard. +7 test.
- fix(dashboard,build 553): **การ์ดรายได้ (รวมบริการ) นับด้วยวันปิดงาน — ตรงกับสมุดรายวัน** — dashboard + income_overview เดิมนับรายได้งานบริการด้วย `created_at` (วันสร้างงาน) แต่ JV/P&L รับรู้ด้วย `closed_at` (วันปิดงาน, Phase 542) → งานสร้างวันหนึ่งปิดอีกวัน การ์ดหน้าแรกไม่ตรงสมุดรายวัน (owner เจอ 2026-07-02: journal SV ~5,100 แต่การ์ด 210). แก้: +helper `serviceIncomeDate(j)=closed_at||created_at` (single source) ใช้ทั้ง today/month service income (dashboard) + serviceTotal/หมวด/จำนวนรายการ/กราฟเดือน (income_overview). **display-only** — web order + POS คง created_at (นอก scope, ยกเป็น Phase 554); ไม่แตะ JV/บัญชี/stock/checkout. +7 guard. **known:** service_jobs โหลด cap ≤50 → ถ้างานวันนี้ >50 การ์ดยัง undercount = phase แยก.
- fix(audit,build 552): **refund single-flight + TZ month-bounds + salary JV skip** — (1) refunds กดบันทึกซ้ำ = คืน/restock/JV/เครดิตซ้ำ → ห่อ `createInflightGuard`. (2) `monthBoundsBkk`/`monthsAgoStartBkk` pure TZ-safe → hr_overview/leave_management/expense_overview/payroll_overview เดิมปน offset+setMonth/toISOString → วันสิ้นเดือนหาย. (3) postJournalForExpense ข้ามหมวด salary/labor_hire/payroll ที่ writer เดียว (เดิม expenses insert/edit repost Dr 5200 ซ้ำ period JV). +3 guard. **owner smoke ผ่าน** (preview 552).
- fix(audit,build 551): **card→1130 JV · numpad stale closure · calendar XSS + DB guards** — (1) บัตรเครดิต JV ลง Dr 1200 ลูกหนี้ (regex `เครดิต` จับ "บัตรเครดิต") → `_selectSaleMappingKey` แยก is_credit→term / บัตร→1130. **owner smoke ผ่าน: JV SV2026070015 Dr 1130** ✅. (2) POS จอเงินสด numpad ใช้ closure ค้าง → ทอนผิด/ปุ่มตายเงียบ → อ่าน numpadValue สด. **owner smoke ผ่าน: บิล ฿20 รับ 100 ทอน 80** ✅. (3) calendar.js escHtml customer_name/description/job_address (stored XSS จากฟอร์มสาธารณะ). (4) SQL owner-run: period-lock กัน DELETE + service_jobs BEFORE INSERT admin guard — **✅ applied+verified 2026-07-02** (ดู DB_MIGRATIONS_APPLIED). +6 guard.

- feat(tech,build 550): **หน้าหลักช่าง — bucket "งานค้าง/รอดำเนินการ" + panel "🚚 อุปกรณ์ต้องเบิกขึ้นรถ"** — (1) **`serviceJobBuckets`** แยก 3 ถัง open jobs: **งานวันนี้** (`scheduled_date=today`) · **งานค้าง/รอดำเนินการ** (`scheduled_date<today` หรือ **ไม่มีวันนัด** + ยัง pending/progress) · **งานพรุ่งนี้** — กันงานเก่าที่ค้างหายเพราะ empty state "วันนี้ไม่มีงาน" (ก่อนหน้าจับด้วย `_jobDay` fallback created_at → งานไม่มีวันนัดโผล่ผิดถัง). left panel โชว์ "งานวันนี้ + งานค้าง" แยก section · tiles: งานวันนี้ · **งานค้าง** · ต้องเบิกขึ้นรถ · งานพรุ่งนี้. (2) **`truckLoadPlan`** (รับ jobsForLoad = **วันนี้+ค้าง**, ไม่ใช่แค่วันนี้): รวม `items_json` ต่อรถ `is_mobile` → เทียบ `warehouse_stock` (`remain`) → `need` (ต้องเบิก) + **สถานะสี** (🔴 ของหมด `remain≤0` / 🔴 ไม่พอ `remain<need` / 🟡 เหลือน้อย `≤need+2` / 🟢 เบิกได้) · **คืนทั้ง 2 คันเสมอ** (คันขาว/คันแดง — คันไม่มีของ = "ไม่มีของต้องเบิกคันนี้") + ปุ่ม "เบิกคันนี้ →". คง panel "ของที่ช่างใช้ล่าสุด 2 วัน" เป็นตัวรอง (คนละความหมาย — ไม่เอามาแทน). **READ-ONLY** — `state.serviceJobs/warehouses/warehouseStock/products`; ไม่มี write/fetch/deduct/stock_movements (guard `tech_home_readonly` 4/4 + behavioral `tech_home_truck_load` 5 — buckets today/backlog/tomorrow · need/remain/status · ทั้ง 2 คัน · ไม่ mutate input). ★ **ต้องช่างใส่อุปกรณ์ในงาน** (picker เดิม, งานเปิด=ไม่ตัดจนปิด) ระบบถึงเตือน. ไม่แตะ deduct-drawer/POS/SQL. unit 2297·e2e 14/14·lint0. build 550 (review patch, PR #126). **+ mobile patch:** `.tech-home-grid` ย้าย layout จาก inline → CSS class + `@media (max-width:640px)` **single-column** (เดิม 2-col ไม่มี breakpoint → มือถือบีบคอลัมน์ขวาแคบ ข้อความแตกทีละคำ) — panels (งานที่ต้องทำ/ต้องเบิกขึ้นรถ/ของที่ใช้ล่าสุด/งานพรุ่งนี้) เรียงลงมาเต็มกว้าง; font/line-height tweak scope ใต้ `#page-tech_home` (กันรั่วหน้าอื่น). +guard `tech_home_mobile` (4). unit 2301·e2e 14/14. CSS-only render (ship ใต้ v=550, ไม่ re-bump — 550 ยังไม่ live).
- feat(tech,build 549): **หน้าหลักช่าง (tech_home) — read-only landing** — เพิ่มหน้าแรกสำหรับ technician: งานช่างวันนี้/พรุ่งนี้ (ทั้งร้าน) + **ของที่ช่างใช้ล่าสุด "แยกตามรถ" (`recentTruckUsage` — `service_jobs.items_json` เก็บ `warehouse_id/warehouse_name` ต่ออุปกรณ์ = คันที่หยิบ → group per รถ `is_mobile` (คันขาว/คันแดง); ช่างใหม่รู้เติมชิ้นไหนเข้าคันไหน + ปุ่ม "เติมคันนี้ →" wh_kunkhao/wh_kundaeng, ไม่โชว์ต้นทุน)** + KPI. ★ owner iterate: จุดประสงค์จริง = "ของที่ช่างใช้→เติมเข้ารถ + รู้ว่าคันไหน" (ไม่ใช่ของเหลือน้อยในรถ). ★ key: stock_movements ไม่มี warehouse_id → ต้องใช้ items_json (ที่เดียวที่บอกคัน). **READ-ONLY ล้วน** — อ่าน `state.serviceJobs/warehouses/products/profile` เท่านั้น; ไม่มี fetch/POST/PATCH/DELETE/stock helper/journal/write; bindings = `showRoute` นำทางไปหน้าเดิม (calendar/wh_kunkhao/wh_kundaeng/stock_movements) อย่างเดียว (guard `tech_home_readonly` — FORBIDDEN write-paths). **additive** — `LAZY_ROUTES` + `titles` + `ROLE_PAGES.technician`(แรก) + admin `ALL_ROUTES` + `index.html` ปุ่ม 🧰 หน้าหลักช่าง + `<section id="page-tech_home">`. **★ audit handoff (จากทีมอื่น) แก้ 1 บั๊กก่อน integrate:** column จริง = `service_jobs.scheduled_date` (DATE-only) ไม่ใช่ `scheduled_at` (ไม่มีจริง) → `_jobDay` ใช้ `scheduled_date` (ไม่งั้นกรองงานด้วยวันสร้าง = โชว์งานผิดวัน) + ตัด time-label (ไม่มีเวลาใน data model). **ไม่แตะ** logic เดิม/ไม่มี SQL/ไม่แตะ RLS/**ไม่รับงาน-ไม่เบิก-ไม่ตัด-ไม่ปิดงาน** (แยกเฟส — live system risk ต่ำสุด). +guard `tech_home_readonly` (4). unit 2292·lint0. build 548→549.
- fix(accounting,build 548): **auto_post JV balance = round2 ทุก field + exact compare** (BUG_AUDIT · AH4 · §4.3) — `_postJournal` (`auto_post.js:238`) เดิม validate ด้วย tolerance `Math.abs(Dr−Cr) > 0.01` แต่ **DB balance trigger (Phase 498) บังคับ exact `NUMERIC(14,2)`** → satang drift ≤1 หลุด client → lines-insert fail = **orphan header** (§4.3). **แก้:** `_rd = round2` ทุก line เป็น `rLines` → header total (`_rd(sum)`) + journal_lines POST + validate ใช้ค่า round2 **เดียวกันหมด** + compare **exact** (`totalDebit !== totalCredit`). ตรง DB NUMERIC(14,2) กัน drift ต้นทาง (stricter: JV ที่ drift ≤1 สตางค์ตอนนี้ fail คลีน แทนหลุดไปเป็น orphan ที่ DB). **ไม่แตะ** mapping/keyMap/splitSaleVatLines/Dr-Cr/effective-gate/period-lock/doc_no retry/rollback. +guard `auto_post_ah4_round2` (4) + อัปเดต `auto_post`/`orphan_rollback` guard (match rLines/exact). **+log S3** (`supabase-phase536-error-log-hardening.sql`) ใน `DB_MIGRATIONS_APPLIED.md` — verified live (admin อ่าน error_log rows=1 · non-admin rows=0 = `is_admin()` policy active; เคยหายจาก ledger). unit 2288·e2e 14/14·lint0. **ไม่มี SQL ใหม่.**
- fix(products,build 547): **หน้าสินค้ากลับมา live filter ขณะพิมพ์** (Codex · products UX) — เพิ่ม `input` listener + **debounce 220ms** → `_runProdSearch` + **IME composition guard** (Thai composition รอ commit ก่อนค้น) + Enter ค้นทันที + blur deferred คงไว้. **🔄 ย้อน build 524** ที่ตั้งใจให้ค้นเมื่อ Enter/blur (กัน keyboard เด้งมือถือ) — **owner ยืนยัน intentional + เทสต์ preview บนมือถือผ่าน** (debounce+IME แก้เด้ง/ไทยซ้ำได้). guard test `products_search_ime_guard` กลับด้าน (assert live filtering + debounce + composition guard). แตะแค่ `modules/products.js` + test. build 546→547 (data-app-build+?v=×4+sw cache). unit 2284·e2e 14/14·lint0.
- fix(security,build 546): **ลบ/ยกเลิกใบรับงาน = admin เท่านั้น** (§4.4) — "ลบ" = **soft-delete** (`status='cancelled'` + note `[ลบแล้ว]` + คืนสต็อก) แต่ปุ่ม 🗑️ ลบ + handler **ไม่มี role gate** → ใครก็ลบได้ (UI + REST bypass). แก้: (1) **client** (`service_jobs.js`): render ปุ่ม 🗑️ ลบ **เฉพาะ admin** (`_isAdmin` — **ไม่ซ่อนหน้า**, technician ยังเห็น/แก้ใบงานได้) + handler guard `state.profile?.role !== "admin"` → `showToast("เฉพาะแอดมินลบงานได้","error")` + `return` **ก่อน confirm/PATCH/restore stock** ; (2) **DB trigger** `trg_service_jobs_delete_guard` (`BEFORE UPDATE service_jobs`, `public.is_admin()`, RAISE **42501**) block non-admin เมื่อ **(a)** transition เข้า `cancelled` (`OLD.status IS DISTINCT FROM NEW`) **หรือ (b)** เพิ่ม marker `[ลบแล้ว]` ใหม่. **ไม่ block** แก้ note ปกติ · งานที่ `cancelled` อยู่แล้ว · pending/progress · service_role (null uid). **independent จาก Phase 545 close guard** (trigger แยก). +guard `service_job_delete_admin` (source 3 ชั้น: UI admin-only+ไม่ซ่อนหน้า · handler guard-before-side-effects · SQL cancel/marker/is_admin/42501 · 545 ยัง intact). unit 2283·e2e 14/14·lint0. **🔴 owner ต้องรัน `supabase-phase546-service-delete-admin-guard.sql`** (DDL). **residual:** drawer dropdown "ยกเลิก" สำหรับ non-admin ยังเลือกได้ → DB 42501 (ไม่ใช่ delete-button; follow-up เล็กถ้าจะซ่อน option).
- fix(security,build 545): **ปิดงานช่าง (done/delivered/closed) = admin เท่านั้น** (§4.4) — การปิดงานทริก **auto-post JV + ตัดสต็อกจริง** แต่เดิม `saveServiceJob` **ไม่มี role gate** → technician/sales ปิดงานเองได้. แก้ **3 ชั้น**: (1) helpers pure ใน `service_status.js` (`SERVICE_COMPLETION_STATUSES`/`isServiceCompletionStatus`/`isServiceCloseTransition`) ; (2) **client** (`main.js`): drawer ซ่อน/disable option `done/delivered/closed` สำหรับ non-admin (คงสถานะปัจจุบันของงานที่ปิดแล้ว — **transition-only**) + `saveServiceJob` `return` ก่อน `closed_at`/JV/stock ถ้า `!requireAdmin() && isServiceCloseTransition(...)` ; (3) **DB trigger** `trg_service_jobs_close_guard` (`BEFORE UPDATE service_jobs`, `public.is_admin()`, RAISE **42501**) = **ด่านจริงกัน bypass ตรง REST**. **transition-only** (ไม่ใช่ absolute): แก้ note/field ของงานที่ปิดแล้วไม่ถูก block · `pending_review` (→ `pending` + note marker) ไม่ใช่ completion = ช่างยังส่งรออนุมัติได้ · technician/sales/customer/accountant โดน block เท่ากัน · service_role (null uid) ไม่ถูก gate. **ไม่แตะ** POS/credit/loyalty/stock helper อื่น/policy route (technician ยังเข้า service_jobs + ส่งงานได้). +guard `service_job_close_admin` (3 ชั้น: pure helpers + source client guard-before-side-effects + source SQL trigger). unit 2278·e2e 14/14·lint0. **🔴 owner ต้องรัน `supabase-phase545-service-close-admin-guard.sql`** (DDL — Claude ไม่รันแทน).
- fix(stock,sales,build 544): **ตัดสต็อกภายในงานขายเหมาจ่าย — ลูกค้าไม่เห็นรายการสินค้าภายใน** (feature) — หน้า preview ใบส่งสินค้าเพิ่มแผง "🔧 ตัดสต็อกภายใน" (admin/sales เท่านั้น, **วางนอก `#diDocPreview` → print/PDF/แชร์ ของลูกค้าไม่เห็น**): **ใช้ picker เดียวกับหน้างานช่าง** (`openEquipmentPicker`/`renderEquipmentList` — เลือกคลัง→สินค้า, ตะกร้า multi-add, qty/ลบ) + ปุ่มยืนยัน (precheck ทั้งตะกร้าก่อน) → ตัด stock จริงผ่าน `window._appApplyStockMovement` (CAS+floor, out, allowNegative:false) **โดยไม่เพิ่ม line เข้า `delivery_invoice_items`** (customer doc คงเป็นเหมาจ่าย). idempotency **per (doc,product,warehouse)** ผ่าน note marker `[SALES_INTERNAL_STOCK:docType:docId:productId:warehouseId]` (stock_movements ไม่มี source_* col → ใช้ note) — สินค้า+คลังเดิมตัดซ้ำไม่ได้ แต่ **append สินค้า/คลังอื่นในใบเดิมได้** + single-flight guard กัน double-click + re-query ยืนยัน log (ตัดแล้วแต่ log ไม่ยืนยัน → warning ชัด ไม่เงียบ) + stock ไม่พอ → block (helper floor + return ก่อน log = ไม่มี phantom). **ไม่แตะ** checkout/JV/credit/loyalty/receipt rendering/customer item tables/quotation pricing/SQL. +guard `sales_internal_stock_issue` (12: marker/note format + behavioral [ตัดสำเร็จ+log confirm · ซ้ำ→skip · สินค้าอื่น→append · ไม่พอ→block ไม่มี phantom · log ไม่ confirm→warn] + source [ใช้ helper ไม่ mutate ws ตรง · ไม่แตะ *_items · panel นอก diDocPreview · inflight · role gate]). unit 2269·lint0. **ไม่ต้องรัน SQL** (stock_movements note marker).
- fix(security,build 543): **ย้าย SlipOK API key ออกจาก browser ไป server-side proxy** (BUG_AUDIT · S14 · §4.4) — `customer_dashboard._verifySlip` เดิมอ่าน `bsk_slipok_key` จาก localStorage + ยิง `api.slipok.com` ตรงจากเบราว์เซอร์ (`x-authorization: <key>`) → คีย์ร้านรั่วในทุกเบราว์เซอร์ลูกค้า (localStorage + Network tab; XSS ขโมยได้). **แก้:** (1) function ใหม่ **`/api/verify-slipok`** เก็บ key ใน Cloudflare env (`SLIPOK_API_KEY`/`SLIPOK_BRANCH_ID`) + reuse `_error_sanitizer` (log server, generic client) + normalize response (**ไม่มี `raw`**) ; (2) customer_dashboard เรียก proxy ด้วย session JWT (เลิก localStorage/api.slipok.com; token หาย/401→"เซสชันหมดอายุ") ; (3) payment.js เลิกเก็บ key (เปลี่ยน input เป็น env-instruction read-only + `removeItem` cleanup) ; (4) pages.js restore deny-list `bsk_slipok_key` (export ไม่มีอยู่แล้ว). middleware: `verify-slipok` = REQUIRE_AUTH (customer JWT ได้, **ไม่ STAFF_ONLY**) + rate-limit 20/60. **ไม่แตะ** `/api/verify-slip` (Gemini OCR staff)/checkout/stock/accounting/loyalty/RLS. no_api graceful (env ยังไม่ตั้ง = slip ผ่าน manual review ไม่ crash). +guard `slipok_secret_proxy` (10: source browser-no-key + function env/no-raw + middleware auth + behavioral no_api/normalized-no-raw-key-not-in-response/bad-image). unit 2257·e2e 14/14·lint0. **functions-only+client read-path.** ⚠️ **owner ตั้ง `SLIPOK_API_KEY` (+ optional `SLIPOK_BRANCH_ID`) ใน Cloudflare env หลัง merge**.
- fix(accounting,build 542): **service JV ลงงวดตามวันปิดงาน (closed_at) ไม่ใช่วันสร้าง** (BUG_AUDIT · AH6 · §4.3) — `postJournalForServiceJob` (auto_post.js:802) docDate ใช้ `created_at` (วันสร้าง/นัด) → งานสร้างเดือนนึงปิดอีกเดือน ลง JV **ผิดงวด** (รับรู้รายได้ผิดเดือน). คาบ go-live 1 ก.ค. ร้ายกว่า: สร้าง มิ.ย. ปิด ก.ค. → docDate=มิ.ย. < effective → **JV skip = รายได้หายทั้งใบ**. **แก้:** `docDate = closed_at || created_at` (วันปิด=วันรับรู้รายได้ cash-basis; fallback created_at เมื่อ closed_at null). **★ audit-before-implement:** prompt บอก main.js `fullJob` มี closed_at — verify แล้ว**ไม่จริง** (main.js drawer ไม่เคย set closed_at → fix เป็น no-op สำหรับ path ปิดงานหลัก) → owner อนุมัติ fold: **main.js saveServiceJob stamp `payload.closed_at=now` ตอนงานเพิ่งปิด** (ไม่ทับของเดิมตอน edit; inline form set เองอยู่แล้ว). **ไม่แตะ** mapping/lines/Dr-Cr/effective-gate-logic/period-lock/sale-expense-receipt JV. +guard `service_job_docdate` (4 behavioral [created มิ.ย.+closed ก.ค.→post งวด ก.ค. · closed_at null→fallback created · fallback ยัง honour gate] + source 2 ไฟล์). unit 2248·e2e 14/14·lint0. **ไม่ต้องรัน SQL** (closed_at column มีอยู่แล้ว phase88). 🔴 **ควร live ก่อน 1 ก.ค.** (กัน service JV หายวันแรก go-live).
- fix(loyalty,build 541): **คืนแต้ม (void/refund) อ่าน DB จริง — บิลเก่านอก cache ก็คืนถูก** (BUG_AUDIT 2026-06-25 · S6 · §4.1) — เดิม `reverseEarnedPointsForSale` อ่าน earn/reverse/remaining จาก `state.loyaltyPoints` (cache cap ≤500) → void/refund บิลเก่า (earn row ไม่อยู่ใน cache) → ตี "ไม่มี earn" หรือ "reverse แล้ว" ผิด → **ไม่คืนแต้ม / cap จาก balance ไม่ครบ**. **แก้:** reverse fetch `loyalty_points` จาก DB ผ่าน `fetchAllRowsRaw` (paginate ไม่ cap) — earn+sale_reverse ของ sale (ref_id) + ทุก row ของ customer (remaining จริง). **signature เดิม `(saleId, options)` คงไว้** (audit จับ prompt เขียน `(sale,ctx)` ผิดจะพัง 2 caller refunds/sales — ไม่แตะ caller). **DB fetch fail → `{ok:false, skipped:false}`** (ไม่ silent skip / ไม่ insert reverse) → Phase 539 surface warning. idempotency: DB sale_reverse row + phase497 23505 คงเดิม. ลบ dead helper `customerRemainingFromState`. **ไม่แตะ** earn / redeem RPC(540) / checkout / credit 2180 / stock / SQL / RLS. +guard (loyalty_reverse_sale: 4 S6 behavioral [state ว่างแต่ DB มี earn→คืน · DB มี reverse→ไม่ซ้ำ · cap จาก DB · fetch-fail surface] + source). unit 2242·e2e 14/14·lint0. **ไม่ต้องรัน SQL** (client read-fix).
- fix(loyalty,build 540): **แลกแต้ม atomic ที่ DB — กัน race แลกเกิน + staff-only** (BUG_AUDIT 2026-06-25 · S5 · §4.1) — เดิม `loyalty.js redeemPoints` อ่าน balance จาก `state.loyaltyPoints` (cache cap ≤500, racy) แล้ว insert → 2 เครื่องแลกพร้อมกันผ่านทั้งคู่ → แต้มติดลบ. **แก้:** ย้ายไป DB RPC `redeem_loyalty_points_atomic` (`SECURITY DEFINER`, ใหม่ `supabase-phase540-loyalty-redeem-atomic.sql` — owner รัน) — `pg_advisory_xact_lock` ต่อ customer + อ่าน balance จาก DB จริง + over-redeem → `23514` + insert atomic. **★ role guard ใน function `IF NOT is_staff()→42501` + deny `is_customer_role()→42501`** (match policy เดิม `loyalty_points_rw WITH CHECK is_staff()` — กัน OTP customer/non-staff เรียก RPC ข้าม phase505 ผ่าน SECURITY DEFINER+GRANT authenticated; audit เจอก่อน implement → owner STEP0 ยืนยัน policy → tighten ให้ match). client เรียกผ่าน raw fetch `/rest/v1/rpc/` (mirror `_redeemCheckoutCredit`) + `Number(customerId)`; precheck `getCustomerPoints` คงไว้เป็น **UX เท่านั้น** (RPC = source of truth). **ไม่แตะ** earn/reverse-clawback/checkout/credit 2180/stock/RLS อื่น. +guard `loyalty_redeem_atomic` (9) · loyalty_reverse/auto_earn เดิมไม่ regress. unit 2237·e2e 14/14·lint0. ✅ **SQL applied prod 2026-06-28** (prosecdef=true · smoke staff✓/over→23514/customer→42501).
- fix(ux,build 539): **void/ลบ ไม่โชว์ "✅ เรียบร้อย" หลอกเมื่อคืนเงิน/สต็อกล้มเงียบ** (BUG_AUDIT 2026-06-25 · S7+S8 · §4.8) — **S7** `sales.js` ลบบิล: void-JV/คืนสต็อก/คืนแต้ม/คืนเครดิต = best-effort; เดิม fail แล้ว push "⚠️…fail" แต่ toast ยังนำหน้า "ลบรายการขายเรียบร้อย ✅" → คนกดเข้าใจว่าสำเร็จทั้งที่บัญชี/สต็อกไม่กลับ. **S8** `service_jobs.js` ลบงานช่าง: `restoreServiceJobStock` **throw** → catch console.error เฉย ๆ → `_restore={restored:false,errors:[]}` → ตกไป "ลบงานช่างเรียบร้อย ✅" ทั้งที่สต็อกไม่คืน เงียบ. **แก้:** S7 เก็บ `failures` แยก → ถ้ามี → warning toast (ไม่ ✅) + `captureMessage` (audit §4.8); S8 `stockIssue` flag (throw/partial) → warning + captureMessage + **gate ✅ ด้วย `!stockIssue`**. **display/messaging เท่านั้น — ไม่แตะ side-effect execution/ลำดับ/best-effort-no-rollback** (บิล/งาน soft-delete แล้วคงเดิม). +guard `void_delete_surface_fail` (4) + อัปเดต `void_release_credit` (release fail→failures). unit 2228·e2e 14/14·lint0.
- fix(tz,build 538): **receipts/tasks/birthdays filter "วันนี้" คิดบนเขตเวลาไทย (เลิก UTC)** (BUG_AUDIT 2026-06-25 · S9/S10/S11 · §4.7) — 3 หน้าใช้ `new Date().toISOString().slice(0,10)` = UTC → ช่วง 00:00–06:59 ไทย วัน UTC ยังเป็น "เมื่อวาน": **S9** หน้าใบเสร็จ filter วันนี้/7/30วัน/เดือนนี้ หลุดบิลที่สร้างเช้าไทย (`receipts.js:144,147,148` + `_receiptMatchesSearchDate:88` เทียบ `created_at` (timestamptz=UTC) ก็ UTC → **แก้ทั้ง 2 ฝั่งด้วย `dateBkk`**) · **S10** หน้างาน วันนี้/สัปดาห์/เสร็จวันนี้ นับผิด (`tasks.js:64,70` + `due_at/done_at`=UTC ts → `dateBkk`; overdue เทียบ instant คงไว้) · **S11** แจ้งวันเกิด LINE dedup key UTC → ส่งอวยพรซ้ำรอบเช้า (`birthdays.js:180` + match MD บน Bangkok). **แก้:** ใช้ `todayBkk()`/`addDaysBkk()`/`dateBkk()` (utils single source เดิม phase 525). display/filter เท่านั้น **ไม่แตะเงิน/สต็อก/บัญชี/JV**. +guard `tz_receipts_tasks_birthdays` (6: behavioral `_receiptMatchesSearchDate` เช้าไทย included + source 3 ไฟล์). unit 2224·e2e 14/14·lint0.
- fix(ux,build 537): **`_lazyImport` ค้างทั้ง session ถ้า lazy module โหลดล้มแวบเดียว** (BUG_AUDIT 2026-06-25 · S13 · availability) — `main.js:84` `_lazyMod.set(path, import(...))` ไม่มี `.catch` → import() reject (เน็ตสะดุด) = rejected promise ค้างใน cache ถาวร → ทุก nav เข้าหน้านั้น (lazy route) ใช้ promise เดิมที่ reject → หน้าตายจน full reload (caller `_renderLazy` โชว์ "โหลดหน้านี้ไม่สำเร็จ — ลองรีเฟรช"). **แก้ (1 บรรทัด):** `.catch(e => { _lazyMod.delete(path); throw e; })` → evict entry ที่ reject (keyed by path) + re-throw → nav ครั้งถัดไป re-import ได้ (ไม่ต้อง reload). resolved promise ยัง cache (per-session de-dup ไม่เปลี่ยน). availability fix · ไม่แตะ logic/เงิน/สต็อก/cache-bust. +guard ใน `lazy_import_cache_bust` (evict .catch + _lazyMod.delete + re-throw). unit 2218·e2e 14/14·lint0.
- fix(security,line,build 535): **`/api/line-notify` ไม่ leak raw error body จาก LINE API กลับ client** (BUG_AUDIT 2026-06-25 · S4 · §4.4/§4.8) — push LINE fail เดิม `detail = await resp.text()` (raw upstream body) + `to` (recipient id จาก env) ถูกส่งกลับใน `results[]` → staff browser เห็น raw upstream (quota/token state/req diagnostic) + recipient id. ขัด Phase 516 sanitizer (API คืน generic เท่านั้น). **แก้ (`functions/api/line-notify.js` results block เท่านั้น):** fail → `logServerError("[line-notify] LINE push failed", {status, detail})` (server-side, Cloudflare logs) + `results.push({status, ok})` เท่านั้น (ตัด `detail`+`to`). client (`line_notify.js`) อ่านแค่ `ok/configured/error/usedFallback` (results ถูกแค่ console.error) → ไม่กระทบ. **ไม่แตะ** flow ส่ง LINE จริง/probe(531)/usedFallback/daily-summary/UI/OTP/accounting/POS/stock. **functions-only แต่ bump build 534→535 ตาม protocol** (เหมือน 510/515/516 functions-only sanitizer — traceability; function deploy จริงไม่ขึ้นกับ marker: `wrangler pages deploy .` รวม functions/ + SW ข้าม POST). +guard `line_notify_error_sanitize` (4: behavioral upstream+recipient ไม่หลุด+log server-side · success clean · source). unit 2211·e2e 14/14·lint0.
- fix(accounting,build 534): **JV doc_no ชนแล้วถูก skip เงียบ → JV หาย** (BUG_AUDIT 2026-06-25 · B3 · §4.3 · MONEY) — `auto_post.js` สร้าง `doc_no` แบบ read-max+1 = racy; 2 checkout พร้อมกัน อ่าน max เท่ากัน → `doc_no` เดียวกัน → ตัวหลังโดน 409. โค้ดเดิม (`:287`) ตี **ทุก 409 = source ซ้ำ → skip "duplicate" เงียบ** → JV บิลนั้นไม่ถูกโพสต์ = **หายเงียบ** (รายได้ undercount, เสี่ยงสุด 1 ก.ค. หลายแคชเชียร์พร้อมกัน). **แก้ (`auto_post.js` block doc_no+POST เท่านั้น):** `classifyJeInsertError(status, body)` แยก 3 ทาง — `idx_je_source_unique`→`source-dup` (skip ถูก, idempotent) · `journal_entries_doc_no_key`→`docno-clash` (retry seq ใหม่ `Math.max(fetched, lastTried+1)` ก้าวหน้าเสมอ + jitter, bounded **5**) · ระบุไม่ได้→`unknown`→**throw** (ห้ามเดา). ครบ 5 ยังชน → **`failed/docno-clash-unresolved` + `captureMessage`** (ไม่ skip เงียบ §4.8). **GATE:** classify เฉพาะ unique violation (`409`/`23505`) — non-409 (RLS 403/42501) **throw → catch เดิม Phase 92.13** (RLS handling ไม่ regress). caller `pos.js:1528` จัดการ `failed` เดิม (warn+badge ไม่ rollback บิล). **ไม่แตะ** journal_lines/RLS/schema/period-lock/mapping/VAT/Dr-Cr; `journal_form.js` (manual JV) throw เห็น error อยู่แล้ว = ข้าม (UX follow-up). **+อัปเดต test เดิม** `auto_post_detailed_result.js` (mock 23505 ใส่ชื่อ constraint จริง — กันขัด classifier ใหม่) + guard `jv_docno_clash` (11). Option A (DB atomic counter) = follow-up แยกเฟส. unit 2200·e2e 14/14·lint0. ⚠️ pre-effective: auto-post sale ก่อน 1 ก.ค. = skip → smoke จริงด้วย guard behavioral test (หรือ test data docDate≥1ก.ค.)
- fix(pos,accounting,build 533): **void/ลบบิลที่จ่ายด้วยเครดิตลูกค้า → คืนเครดิต (2180)** (BUG_AUDIT 2026-06-25 · B4 · §4.1) — เดิม void บิล (`sales.js:268-347`) ทำ void-JV/revert-stock/reverse-loyalty แต่ **ไม่คืน credit** ที่ลูกค้าใช้จ่าย (`credit_used_amount>0`) → `customer_credit_ledger` ≠ GL 2180 + ลูกค้าเสียเครดิต. แก้: `pos.js` เปิด `window._appReleaseCheckoutCredit` (=`_releaseAndLog` → RPC `release_customer_credit` idempotent) + `sales.js` void flow เพิ่มขั้น (d) — `credit_used_amount>0` + `checkout_key` → release ด้วย source_key เดิม (best-effort เหมือน a/b/c, idempotent กัน re-void). **dormant ก่อน 1 ก.ค.** (credit UI ปิด → credit_used_amount=0). +guard `void_release_credit` (5). ไม่แตะ redeem/JV/stock/loyalty/RPC. unit 2198·e2e 14/14·lint0. ⚠️ owner smoke (void credit sale → ledger +amount) ก่อน merge
- fix(security,B2+S1): **ปิดช่อง `anon` (publishable key) เขียน `accounting_periods`** (BUG_AUDIT 2026-06-25, §4.4) — `supabase-phase88-19:46-52` ให้ `periods_insert`/`periods_update` = `TO authenticated, anon WITH CHECK(true)` → ใครถือ anon key ก็ INSERT/UPDATE งวดบัญชีได้โดยไม่ต้อง login = flip งวดปิด→เปิด แล้วโพสต์ JV ย้อน (ข้าม period-lock §4.3); `deny_customer` (phase505) ไม่ครอบ anon. **verified LIVE** ด้วย `pg_policy` ก่อนแก้. **แก้ (`supabase-phase532-periods-anon-fix.sql`):** ลบ anon ออกทุก policy + **gate writes=`is_accountant()`** (admin/accountant — ปิด S1 staff ทุก role เปิด/ปิดงวด รวมกัน) + คง SELECT `TO authenticated` (auto_post checkout อ่าน period ผ่าน). DB+test only **ไม่ bump build** (คง 531). +guard `rls_periods_anon`. ✅ SQL applied prod + verified pg_policy (ทุกแถว `{authenticated}`); ⚠️ owner smoke ปิดงวด+ขาย
- fix(ui,build 529): **การ์ดดำเองตอนมือถือเปิด OS dark mode (อ่านยาก) — แก้ให้แอปขาวปกติเสมอ** (owner ไม่ได้กดปุ่มโหมดมืด). ราก: `phase4-design-system.css` auto-dark ตาม OS (`@media prefers-color-scheme`) ทำงานไม่ครบ → `.card` (`var(--card-bg)`) ดำ แต่ `.stat-card` (`#fff`) ขาว = ปนกัน อ่านยาก. **แก้:** เปลี่ยนเป็น **toggle-driven** `:root[data-theme="dark"]` แทน prefers-color-scheme → app **ขาวปกติเสมอ**, ดำเฉพาะตอนกดปุ่ม "โหมดมืด" ในตั้งค่าเอง (+ phase4 ตอบ toggle ครบขึ้น). app-wide · display-only **ไม่กระทบเงิน/คลัง/logic** · bump `phase4-design-system.css?v=529`. ⚠️ รอ owner ดู preview มือถือ
- fix(ui,build 528): **หน้ารายการขาย (มือถือ) — เลขบิล "BSK-..." แตกแนวตั้ง (1 ตัว/บรรทัด)** — แก้แล้ว. บั๊ก **pre-existing** (มีบน prod ก่อนหน้า — *ไม่ใช่*จากงาน font 526/527; CSS layout การ์ดขายไม่ได้ถูกแตะ). ราก: การ์ด row `[ซ้าย เลขบิล flex:1;min-width:0 | ขวา ยอด+ปุ่ม]` + `.page{overflow-wrap:anywhere}` → จอแคบ ฝั่งซ้ายหดจนเหลือ ~1 ตัวอักษร → เลขบิลแตกแนวตั้ง. **แก้ targeted:** เพิ่ม class `.sale-card-row` (sales.js) + `@media (max-width:768px)` stack การ์ดแนวตั้ง (ข้อมูลบน / ยอด+ปุ่มล่าง) — **เฉพาะการ์ดขาย ไม่กระทบ dashboard/service_jobs**. display-only ไม่แตะ logic/เงิน. +guard `sales_card_mobile_stack`. ⚠️ รอ owner ดู preview มือถือ
- fix(ui,build 527): **หน้ามือถือ font เล็กไป — ขยายให้อ่านง่ายขึ้น + แก้การ์ด KPI dashboard** (owner). เพิ่ม `font-size` ใน `@media (max-width:768px/400px)` ของ `style.css`: เมนูล่าง (nav) 10→12, ป้าย/label/หัวตาราง 11→13, ข้อมูลในตาราง (th/td) 12→13, ปุ่ม 13→14, ช่องกรอก 14→**16** (ขยาย + กัน iOS zoom ตอนแตะช่อง), หัวข้อหน้า 18→20 (จอเล็ก <400px: nav 9→11, หัวข้อ 16→18). **display-only — ไม่กระทบการเงิน:** ตัวเลข/ยอด/VAT/เงินทอน คำนวณเหมือนเดิมเป๊ะ แค่ตัวอักษรใหญ่ขึ้น; **ใบเสร็จที่พิมพ์ (`@media print`) แยกต่างหาก ไม่กระทบ**. ไม่แตะ JS/logic. **+ แก้การ์ด KPI dashboard (จาก preview review รอบ 1):** `@media 480px` — `.kpi-value` `nowrap` + `clamp(13,4.2vw,17)` กันตัวเลขตกบรรทัดกลางคำ (`฿28,640.00`→`฿28,64/0.00`); `.kpi-label` `wrap` ได้ ไม่ตัด "..." (เห็นป้ายเต็ม). ⚠️ รอ owner ดู preview มือถือรอบ 2
- fix(credit,build 525): **Credit Tracker คิด "เกินกำหนด" (overdue) บนเขตเวลาไทย** (audit TZ #2, §4.7) — เดิม `credit_tracker.js` ใช้ `today = new Date().toISOString().slice(0,10)` = **UTC** → ช่วง 00:00–07:00 เวลาไทย `today(UTC)` ยังเป็น "เมื่อวาน" → บิลที่ครบกำหนดเมื่อวาน **ไม่ถูกนับเกินกำหนด** (ยอดค้าง/เกินกำหนดต่ำกว่าจริง) + ตัวเลขไม่ตรงหน้า dashboard (508 ใช้ `todayBkk` ถูกแล้ว). แก้: `today = todayBkk()` (Asia/Bangkok, single-source `utils.js`); `daysOverdue` คำนวณ diff โดย anchor ทั้งสองวันที่ที่เที่ยงคืนไทย (`+07:00`) แทน `Date.now()` (UTC ms) → กัน off-by-1. surgical เฉพาะ `today` + `daysOverdue` — ไม่แตะ fetch(507)/no-fallback/stale-guard/`processCreditPayment`/JV/sort. +guard `credit_tracker_overdue_tz`. reviewer audit + owner smoke ผ่าน; rebased บน build 524.
- fix(products,build 524): **หน้าสินค้า ช่องค้นหาบนมือถือ "keyboard เด้งขึ้นตลอด" ระหว่างพิมพ์** — แก้แล้ว (ต่อจาก 507/522 ที่แก้ตัวอักษรซ้ำได้แล้ว แต่ keyboard ยังเด้ง). สาเหตุที่เหลือ: ทุกครั้งที่ค้นหา ระบบวาดหน้าใหม่ = สร้างช่องค้นหาใหม่ + โฟกัสใหม่ → มือถือ keyboard หุบแล้วเด้งขึ้นใหม่ทุกครั้งที่ผลลัพธ์อัปเดต. **แก้ (เสี่ยงต่ำ ไม่รื้อ render ทั้งหน้า — กันปุ่มแก้/ลบสินค้าพัง):** ไม่วาดหน้าใหม่ระหว่างพิมพ์เลย — ค้นหาเมื่อ **กด Enter** หรือ **ออกจากช่อง (แตะที่อื่น)** → ตอนพิมพ์ keyboard นิ่ง (UX มาตรฐานบนมือถือ: พิมพ์แล้วกดค้นหา). เฉพาะ logic ช่องค้นหา `products.js` ไม่แตะปุ่มแก้/ลบ/pagination/bulk. +guard. ⚠️ รอ owner smoke (มือถือ); build 523 = งาน auto-post อีก session
- fix(accounting,build 523): harden auto_post JV rollback (audit #1) — `_postJournal` rollback ตอน lines-insert ล้ม เดิมเช็คแค่ `delResp.ok` → DELETE ที่โดน RLS block คืน 2xx+0row = false-positive "rollback OK" แต่ **orphan JV** (header ไม่มี lines) ค้างจริง → `unique(source_table,source_id)` block repost → **JV หาย** (รายได้ undercount; ถ้าใช้เครดิต = 2180 ledger≠งบ mismatch — สำคัญขึ้นเมื่อ 517b-3 credit ไหลจริง 1 ก.ค.). แก้ (mirror journal_form 509 + voidJvForSource 89.16): DELETE + `Prefer: return=representation` + นับ deleted rows → rollback สำเร็จเฉพาะ `ok && rollbackCount===1`; ไม่ครบ = orphan → `console.error` + `_errorReporter.captureMessage` (ไม่เงียบ §4.8) + credit-aware (lines มี Dr 2180 → เตือน reconcile). return shape เดิม (failed/lines-insert-failed). ไม่แตะ void path/buildSaleDebitLines/redeem/mapping. (renumber 522→**523** หลังทีม mobile-search merge build 522 — phase ชนเลข, คนละ branch). unit 2171/2171·e2e 14/14·lint0. ⚠️ owner review ก่อน merge
- fix(products,build 522): **หน้าสินค้า ช่องค้นหาบนมือถือ (พิมพ์ไทย) ตัวอักษรซ้ำ/เด้ง/ใส่เอง** — แก้รากให้หายขาด (ต่อจาก 507 ที่ยังไม่พอ). สาเหตุ: ทุกครั้งที่ค้นหา ระบบวาดหน้าใหม่ (`renderView`) = สร้างช่องค้นหาใหม่; ถ้าสร้างใหม่ "ระหว่างกำลังประกอบสระ/วรรณยุกต์" (Thai IME composition) → IME ใส่ตัวซ้ำ. 507 ข้าม `e.isComposing` แล้ว แต่ debounce ยังยิงตอนกำลังประกอบ "ตัวถัดไป" ได้ → ยังเด้ง. **แก้ราก:** ห้ามวาดหน้าใหม่ระหว่างประกอบตัวอักษรเด็ดขาด — ถ้าครบเวลา debounce ตอนกำลังประกอบ → เลื่อน (pending) ไปทำตอนประกอบเสร็จ (`compositionend`) → ช่องค้นหาไม่ถูกสร้างใหม่กลางพิมพ์เลย. surgical เฉพาะ search handler `products.js` ไม่แตะ render/binding/filter/สต็อก; ภาษาอังกฤษ/ตัวเลขทำงานเหมือนเดิม. +guard products_search_ime. ⚠️ รอ owner smoke (มือถือ)
- feat(pos,accounting,build 521): เปิด UI ใช้เครดิตลูกค้า 2180 + JV Dr 2180 split (Phase 517b-3) — ปลุกทุกอย่างที่ staged ไว้ 517a→520 (ก้าวสุดท้ายของ Phase 517 ก่อน go-live บัญชี 1 ก.ค.). **UI:** ช่อง "ใช้เครดิต" ใน payment-select (เมื่อลูกค้ามี balance) — fetch `SUM(customer_credit_ledger)` (read-only) + input clamp `0..min(balance, total)` + "ใช้เต็ม" + full-credit confirm; "ยอดชำระ" = `total − creditUsed`; thread payable เข้า cash-input/transfer/card (เงินทอน/ยอดเก็บถูก). **doCheckout:** flip `const creditUsed=0` → `clamp(_creditUsed, 0..total)`; `paid_amount`/`change` เทียบ `_payable`; redeem-first ปลุก (source_key=checkout_key จาก 520, idempotent). **JV (auto_post `postJournalForSale`):** ฝั่ง debit ใช้ helper ใหม่ `buildSaleDebitLines` → `credit_used>0`: **Dr 2180=credit_used + Dr cash/bank=(total−credit_used)** (ข้าม cash ถ้าใช้เต็ม); `credit_used=0`: โครงเดิม → **Σdebit=total เสมอ (บาลานซ์)**; Cr รายได้/VAT 2170 ไม่เปลี่ยน. **receipt:** "🎁 ใช้เครดิต / ชำระจริง". **ไม่มี SQL ใหม่** (columns/RPC ครบจาก 520/517a). **ไม่แตะ:** refund 2180 mapping (512) · ledger schema/RLS/redeem·release RPC · Phase 514 · stock · OTP · VAT. **+ B1 fix (reviewer, ก่อน merge):** gate credit-use ด้วย `_isAfterEffective(todayBkk())` (helper เดียวกับ JV gate) — ก่อน 1 ก.ค. ช่อง "ใช้เครดิต" ไม่โผล่ (UI gate `_showCredit`) + `creditUsed=0` เสมอ (defense ที่จุด clamp) → กัน redeem ตัด ledger ขณะ JV skip (pre-effective) = **ledger 2180 ≠ งบ 2180 mismatch ถาวร**. ใช้ได้ตั้งแต่ go-live พร้อม JV post. ไม่ bump build (แก้บน branch 521). unit 2166/2166·e2e 14/14·lint0. 🔴 ต้อง live ก่อน 1 ก.ค. ⚠️ owner preview smoke ขายใช้เครดิตจริงก่อน merge
- fix(pos,build 520): checkout_key idempotency + customer-credit-use backend (Phase 517b-2, UI ปิด) — reviewer addendum fold 4 จุด money. **(#1 BLOCKING double-redeem)** checkoutKey เดิม gen ตอน submit → re-click หลัง timeout = key ใหม่ = บิล/ตัดเครดิตซ้ำ. แก้เป็น **per-intent** (`_ensureCheckoutKey` lazy module var, gen ที่ payment-select, ใช้ค่าเดิมตอน re-submit/back, reset ตอนสำเร็จ/logout/เข้าหน้าใหม่) + `sales.checkout_key` + `uq_sales_checkout_key` (partial unique) → re-click/2 เครื่อง ms เดียว = key เดิม → insert **23505 → replay** (เปิดใบเสร็จเดิม ไม่ insert/redeem/JV/ตัดสต็อกซ้ำ). **(#1e)** ใช้เครดิต = **redeem-first** (RPC `redeem_customer_credit` `source_key=checkout_key` ก่อน insert; fail=abort ไม่สร้างบิล) — **UI ปิด (#4ก) → creditUsed=0 → dormant** (517b-3 เปิด). **(#2/#3)** RPC ใหม่ `release_customer_credit` (idempotent source_key + advisory lock) คืนเครดิตเมื่อ insert/items-stock fail หลัง redeem; release ล้ม = log (`console.error`+errorReporter) ไม่เงียบ (§4.8). **cash_recon**: เงินรับจริง = `total_amount − credit_used_amount` (กันนับเงินสดผีตอนใช้เครดิต — bug verify จริง). +`sales.credit_used_amount`. **ไม่แตะ:** refund 2180 (512) · ledger schema/redeem RPC (517a) · Phase 514 · stock internals · OTP. **JV Dr2180 split + เปิด UI = 517b-3 (ก่อน 1 ก.ค.).** unit 2151/2151·e2e 14/14·lint0. ⚠️ owner รัน `supabase-phase520` SQL + preview smoke ก่อน merge
- fix(pos,build 519): checkout journal status + 2180 credit-redeem prep (Phase 517b-1) — build 518 smoke พบ receipt โชว์ "เอกสารบัญชี: ยังไม่ลงบัญชี" หลอกตา (pre-go-live JV skip pre-effective + badge poll blind). (A) `doCheckout` เก็บผล JV จริง (`postRes.{status,reason}` ที่ 517b-0 await) → แนบ `state.lastReceipt._jvStatus` (in-memory, หลัง persist). (B) `main.js _fillReceiptAcctTrace` อ่าน `_jvStatus`: pre-effective → "🕓 ยังไม่ถึงรอบบัญชี"; failed/missing-mapping/unbalanced → "⚠️ ยังไม่ลงบัญชี/ต้องตรวจสอบ"; posted → lookup เดิม (badge+ลิงก์); บิลเปิดซ้ำ (ไม่มี `_jvStatus`) → lookup ปกติ. display-only คงเดิม. JV fail หลัง sale commit = **ไม่ rollback** (status เท่านั้น). (C) เตรียม helper `_redeemCheckoutCredit` (เรียก RPC `redeem_customer_credit` เท่านั้น, `source_key` ผูกบิล, ห้ามเขียน ledger ตรง) — **ยังไม่ wire UI / ไม่มี caller** (UI ใช้เครดิต = 517b-2). **ไม่แตะ:** refund 2180 mapping (512) · ledger schema/RLS/RPC (517a, เรียก RPC เท่านั้น) · Phase 514 · stock internals · OTP/RLS. unit 2140/2140·e2e 14/14·lint0. ⚠️ รอ owner preview smoke ก่อน merge
- fix(pos,build 518): checkout idempotency + failure semantics foundation (Phase 517b-0) — เตรียม checkout ให้ปลอดภัยพอสำหรับ 517b (use credit/Dr2180) **โดยยังไม่เปิด UI เครดิต/ยังไม่เรียก redeem**. (1) เพิ่ม `checkoutKey` (`crypto.randomUUID`) ก่อน insert sale + ฝัง `CHECKOUT_KEY:<key>` ใน note (ไม่ใช้ Date.now() เป็น source เดียว). (2) `sale_items`/stock deduct ล้ม = **HARD FAIL** (เดิม soft toast/ติดธง `[สต็อกไม่ครบ]` แล้วประกาศสำเร็จ) → reuse กลไกเดิม: คืนสต็อกที่ตัดจริง `_appRevertStockForSale` (qty-aware/atomic-claim) + soft-delete `[ลบแล้ว]` (visibleSalesForRole ซ่อน) + `CHECKOUT_FAILED:<key>` → ไม่ post JV/ไม่ clear cart/ไม่เปิดใบเสร็จ/ไม่ประกาศสำเร็จ; revert/soft-delete ล้ม = `needsManualReview` แจ้ง admin. (3) `postJournalForSale` เปลี่ยนจาก fire-and-forget → **await** + gate ข้อความ (JV failed → "ขายถูกบันทึกแล้ว แต่ลงบัญชีไม่สำเร็จ" ไม่ใช่ "เรียบร้อย"; บิล commit แล้วไม่ rollback). **ไม่แตะ:** credit_ledger/redeem RPC/refunds 517a/JV mapping/VAT/2180 split/credit_payments/RLS/UI เครดิต. ⚠️ พฤติกรรมเปลี่ยน — รอ owner preview smoke ก่อน merge. residual NIT: item insert ล้มแต่ stock ตัดสำเร็จ = helper iterate sale_items อาจ under-revert (edge หายาก)
- fix(accounting,build 517): customer credit 2180 ledger foundation (Phase 517a) — Phase 512 ลง Cr 2180 ตอนคืนแบบเครดิต/เปลี่ยนสินค้าอยู่แล้ว แต่ไม่มี source-of-truth ระดับลูกค้าว่าใครเหลือเครดิตเท่าไร. 517a วาง foundation: ตาราง `customer_credit_ledger` (+เพิ่ม/-ใช้) + RPC `redeem_customer_credit` (SECURITY DEFINER + advisory lock/customer + reject over-use 23514 + idempotent source_key — ยังไม่มี caller) + `refunds.js` เขียน +amount หลัง JV (best-effort/idempotent `uq_ccl_source`; customer_id null → ไม่สร้างเครดิตลอย เตือนแทน) + backfill refund credit/exchange ที่มี customer_id. **ไม่แตะ POS checkout / `postJournalForSale` / credit_payments / JV เดิม / Phase 512·514 guard.** การใช้เครดิตหน้า POS (Dr 2180 split) = Phase 517b แยก หลัง rework checkout ให้ rollback ปลอดภัย (กัน "ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ" — flow ปัจจุบัน post JV แบบ fire-and-forget หลัง sale commit). ⚠️ รอ owner run `supabase-phase517a` SQL + smoke + review
- fix(security,build 516): sanitize error responses ของ Cloudflare Functions ที่เหลืออีก 6 ตัว (audit S4 rollout ต่อจาก 515) — `ai-assistant.js` (help-error+top-catch detail), `log-error.js` (supabase detail + e.message), `line-notify.js` (e.message), `v1/reports/daily-summary.js` (e.message), `v1/service-job-submit.js` (lookup/update detail+supabase_status+exception), `v1/service-jobs.js` (insert detail+supabase_status+exception). reuse `_error_sanitizer.js`: ทุก error path → log ฝั่ง server + คืน client `{ok:false,error,code}` ไม่มี detail/supabase_status/stack/raw. v1 = server-to-server (Ning เช็ค ok flag) ไม่ break; log-error stack input (เก็บ stack ฝั่ง client) คงไว้. **ปิด audit รอบ2 ครบ: S1✅512 S2✅513 S3✅514 S4✅515+516.** ✅ MERGED+LIVE `1dccd66` build 516
- fix(security,build 515): sanitize Cloudflare Function error responses (audit S4) — `/api/parse-receipt` + `/api/verify-slip` เดิมคืน internals ดิบให้ client ตอน fail (JS stack, raw Gemini error body, model names, per-attempt dumps, Google promptFeedback) = info-leak. เพิ่ม `functions/api/_error_sanitizer.js` (`logServerError` = log เต็มฝั่ง server; `clientError` = generic message + stable code) แล้ว patch 2 functions ให้ error path log ฝั่ง server + คืน client แค่ `{ok:false,error,code}` (เก็บ user-facing `hint`/`configured`). ไม่แตะ success/verification/client UX. residual: อีก ~6 functions pattern เดียวกัน = Phase 516. ✅ MERGED+LIVE `3b83938` build 515
- fix(credit,build 514): กัน credit over-pay ระดับ DB (audit S3) — เดิมกันแค่ฝั่ง client (`credit_tracker.js:412`) → race/direct REST/หลายเครื่องจ่ายพร้อมกัน ทำให้ `SUM(credit_payments.amount)` เกิน `sales.total_amount` → AR/credit_paid_amount เพี้ยน. เพิ่ม owner-run SQL `supabase-phase514-credit-overpay-guard.sql`: trigger `trg_guard_credit_payment_overpay` BEFORE INSERT OR UPDATE → LOCK sales row FOR UPDATE (serialize) + reject amount≤0/non-credit/missing/overpay (SUM เดิม excl NEW.id + NEW > total+0.01) ไม่ auto-clamp; SECURITY DEFINER. JS แตะแค่ error message (shape เดิม). ✅ MERGED+LIVE `f430543` build 514 + SQL applied prod 2026-06-21 (negative smoke reject 23514 + normal pass)
- fix(stock,build 513): กัน phantom movement ตอนสร้าง warehouse_stock row ใหม่ (audit S2) — `_applyStockMovement` (main.js) ตอน "ไม่มี row เดิม" แล้ว insert (in/return/adjust หรือ allowNegative) เดิม `await xhrPost("warehouse_stock")` ไม่เช็ค `.ok`/ไม่ขอ id/ไม่ push cache → insert ล้ม (RLS/network/CHECK) แต่ยัง log stock_movements + return ok = audit หลอกว่ารับเข้าแล้วทั้งที่ของไม่เพิ่ม; แม้สำเร็จก็ under-count จน reload. แก้ mirror transfer (Phase 368): `{returnData:true}` + เช็ค `!res.ok||!res.data?.id` → return fail ก่อน log + push row ใหม่ (id จริง) เข้า cache. ไม่แตะ transfer/POS/sale/service-deduct/accounting/SQL/RLS. ✅ MERGED+LIVE `f005a12` build 513
- fix(accounting,build 512): refund credit/exchange ไม่ลงเงินสดหลอกอีกต่อไป — เดิม `postJournalForRefund` default ไป `refund_cash` ทำให้ credit/exchange refund ลง Cr1110 เงินสดทั้งที่ไม่มีเงินสดออก. แก้ mapping method ให้ cash→`refund_cash`, transfer→`refund_transfer`, credit→`refund_credit`, exchange→`refund_exchange`; unknown method = failed ชัดเจน ไม่ fallback เงินสด. เพิ่ม SQL owner-run seed COA `2180 เครดิตคงเหลือลูกค้า/เจ้าหนี้ลูกค้าจากใบลดหนี้` + mappings `refund_credit`/`refund_exchange` = Dr4110/Cr2180. ไม่แตะ POS/stock/credit_payments/customer-credit-ledger/use-credit-on-new-sale/VAT split. ⚠️ รอ owner run SQL + smoke + review
- fix(products,build 511): ช่องค้นหาหน้าสินค้าบน **มือถือ (แป้นไทย)** พิมพ์แล้วตัวอักษรซ้ำ/เด้ง ("หน้" → "หน้หน้า") — เพราะระบบวาดช่องค้นหาใหม่ทุกครั้งที่พิมพ์ (debounce) ขณะกำลังประกอบสระ/วรรณยุกต์. แก้: ข้ามการค้นหาระหว่างประกอบตัวอักษร (IME composing) แล้วค้นหาตอนประกอบเสร็จ (compositionend) — เดสก์ท็อป/แป้นอังกฤษเหมือนเดิม. (rebase งานเดิม build 507 → renumber 511 บน main ล่าสุด). ⚠️ รอ owner smoke (มือถือไทย) + review
- fix(security,build 510): ใส่ "เพดานจำนวนครั้งที่กรอก OTP ผิด" ฝั่ง **server** สำหรับ `/api/verify-otp` — เดิมจำกัด 5 ครั้งอยู่ฝั่งหน้าเว็บเท่านั้น (รีเฟรช/แก้ค่าในเครื่องก็ข้ามได้ → brute-force เดารหัส OTP 6 หลักได้). ตอนนี้ฝั่ง server นับครั้งที่ผิดต่อ "OTP ที่ออกแต่ละชุด" (เก็บใน KV, key เป็น HMAC ไม่เก็บรหัสดิบ) เดาผิด 5 ครั้ง = ล็อก (429) จน OTP หมดอายุหรือขอใหม่; กรอกถูก = รีเซ็ต; ถ้า KV ไม่พร้อม = ปฏิเสธชัดเจน (503) ไม่ปล่อยผ่าน. ลูกค้า OTP สมัคร/เข้าระบบปกติไม่กระทบ. ไม่แตะ RLS/Supabase auth/ส่ง SMS. ⚠️ รอ owner smoke + review
- fix(accounting,build 509): ฟอร์ม "บันทึกรายการบัญชีใหม่" (JV) — ถ้าบันทึก "หัวรายการ" สำเร็จแต่ "รายการ (lines)" ล้มเหลว ระบบจะ **ยกเลิก (ลบ) หัวรายการให้อัตโนมัติ** แทนที่จะปล่อยค้าง — เดิมเหลือ JV หัวเปล่าไม่มี lines ทำให้งบทดลอง/รายงานบัญชีผิดแบบเงียบ ๆ. ยกเลิกสำเร็จ → แจ้ง "ยกเลิกหัวรายการแล้ว ลองใหม่"; ยกเลิกไม่สำเร็จ → แจ้งเลขที่ JV/entry ให้ admin ตรวจ-ลบ (ไม่บอกว่าสำเร็จ/ไม่ออกจากหน้า/ไม่ล้างฟอร์ม). กรณีบันทึกสำเร็จปกติทำงานเหมือนเดิม. ไม่แตะ auto_post/schema/RLS/ปิดงวด/สูตรงบ. ⚠️ รอ owner smoke + review
- fix(dashboard,build 508): การ์ด "ต้องทำวันนี้" บนแดชบอร์ด — แถว **"ลูกค้าค้างชำระเกินกำหนด"** นับจากบิลเครดิต **ครบทั้งหมด** จากฐานข้อมูล (reuse helper เดียวกับ Credit Tracker Phase 507) แทนอ่านจากข้อมูลที่โหลดไว้บางส่วน (เดิม cap ~50 → จำนวนรายที่ค้างเกินกำหนด **ต่ำกว่าจริงแบบเงียบ ๆ**). โหลดครั้งเดียว (เปลี่ยนช่วงเวลา/รีเฟรชการ์ดไม่โหลดซ้ำ); ระหว่างโหลดแสดง "กำลังตรวจ…" (ไม่โชว์ 0 หลอก); โหลดไม่สำเร็จ = "ตรวจไม่สำเร็จ" (ไม่ตกกลับไปตัวเลขต่ำกว่าจริง). แดชบอร์ดยัง read-only — ไม่แตะ logic รับชำระ/POS/สต็อก/บัญชี. ⚠️ รอ owner smoke + review. 🔵 residual: ยังไม่มี DB over-pay trigger (แยกเฟส)
- fix(credit,build 507): หน้า "ลูกค้าค้างชำระ (Credit Tracker)" ดึงบิลเงินเชื่อ **ครบทั้งหมด** จากฐานข้อมูล แทนอ่านจากข้อมูลที่โหลดไว้บางส่วน (เดิม cap ~50 บิลล่าสุด → ยอดลูกหนี้ค้าง/เกินกำหนด/จำนวนบิล **ต่ำกว่าจริงแบบเงียบ ๆ**). โหลดแบบ paginated (ครบทุกหน้า) + แยกการโหลดออกจากการแสดงผล → กดสลับตัวกรอง (ยังค้าง/เกินกำหนด/ชำระแล้ว/ทั้งหมด) ไม่โหลดซ้ำ/ไม่กระพริบ; โหลดไม่สำเร็จ = ขึ้น error + ปุ่มลองใหม่ (ไม่ตกกลับไปใช้ตัวเลขเก่าที่ต่ำกว่าจริง); หลังรับชำระ refresh ยอดจากฐานข้อมูลจริง. ไม่แตะ logic รับชำระ/ลงบัญชี JV/POS/สต็อก. ⚠️ รอ owner smoke + review. 🔵 residual: KPI "เครดิตเกินกำหนด" บนแดชบอร์ดยังอ่านข้อมูลบางส่วน (แยกเฟส) · ยังไม่มี DB over-pay trigger (แยกเฟส)
- fix(security,DB-only): ปิดช่อง B3 — ลูกค้าที่ login ผ่าน OTP (เป็น authenticated จริง) เคยอ่านตารางหลังร้านทั้งหมดได้ (staff+PIN/ยอดขาย/รายจ่าย/สต็อก) เพราะ RLS เดิมเปิด `USING(true)` ให้ authenticated ทุกคน. เพิ่ม "ชั้นกันลูกค้า" RESTRICTIVE policy ทับตารางธุรกิจ (helper `is_customer_role()` ดู profiles.role + auth metadata) — staff ใช้งานเหมือนเดิม, customer ถูก deny; **เปิด INSERT ไว้เฉพาะ service_jobs (สั่งงาน) + customers (signup)**; `profiles` self-scope (ลูกค้าเห็นแค่ own row → ไม่อ่าน PII staff, login ไม่ fallback role). ไม่แตะ runtime/schema/permissive เดิม → build ไม่ขยับ. ✅ **APPLIED live 2026-06-20** (owner รัน SQL; 43 policies = 40 deny เต็ม + 2 service_jobs/customers + 1 profiles self-scope; +4 ตารางจาก STEP0 cross-check รวม staff_sessions); residual: หน้าลูกค้าจะไม่เห็น "ของฉัน" (ประวัติซื้อ/แต้ม) ชั่วคราว + ลูกค้ากดยืนยันปิดงานเองไม่ได้
- feat(service,build 506): ขยาย "ตะกร้าแคชเชียร์" (เฟส 502b) ไปหน้างานช่างที่เหลือ — **`service_form`** (ครอบ 9 หน้า: ซ่อม/ล้าง/ย้ายแอร์ · ตู้เย็น · เครื่องซักผ้า · ทีวี · CCTV · จานดาวเทียม · งานอื่นๆ) + **`solar`** (โซล่าเซลล์): ตัวเลือกอุปกรณ์เพิ่มหลายชิ้นรวดไม่เด้งปิด + ตะกร้าแก้ได้ในตัว ([− จำนวน +] / ✕ ลบ / ยอดรวมสด) + ป้าย "×N" + ปุ่ม "เสร็จ • N ชิ้น • ฿รวม" + กัน double-add จอสัมผัส. ใช้ helper กลาง `picker_cart.js` เดิม (reuse ไม่เขียนใหม่). UI/local-state ล้วน ไม่แตะ logic ตัดสต็อก/save/dedup/precheck + ไม่ทำ guard 453b/c (warehouse-first) พัง. ⚠️ รอ owner smoke + Codex review
- feat(service,build 505): หน้า "ติดตั้งแอร์" (ac_install) — ยกระดับตัวเลือกอุปกรณ์เป็น "ตะกร้าแคชเชียร์" (pilot เฟส 502a): เพิ่มหลายชิ้นรวดไม่เด้งปิด + **ตะกร้าแก้ได้ในตัว** ([− จำนวน +] / ✕ ลบ / ยอดรวมสด) + ป้าย "×N" บนสินค้าที่อยู่ในตะกร้าแล้ว + ปุ่ม "เสร็จ • N รายการ • ฿รวม" + **กัน double-add จอสัมผัส** (แตะตัวเดิมซ้ำ <350ms = ข้าม กันตัดสต็อกเกิน). แยกเป็น helper กลาง `modules/picker_cart.js` (reuse ได้ทุก picker — เฟสถัดไป service_form/solar/service_equipment). UI/local-state ล้วน ไม่แตะ logic ตัดสต็อก/save/dedup/precheck (ตัดสต็อกยังที่ปิดงาน) + ไม่ทำ guard 453a (warehouse-first) พัง. ⚠️ รอ owner smoke (จอสัมผัส) + Codex review
- fix(security,DB-only): ปิดช่อง B3 — ลูกค้าที่ login ผ่าน OTP (เป็น authenticated จริง) เคยอ่านตารางหลังร้านทั้งหมดได้ (staff+PIN/ยอดขาย/รายจ่าย/สต็อก) เพราะ RLS เดิมเปิด `USING(true)` ให้ authenticated ทุกคน. เพิ่ม "ชั้นกันลูกค้า" RESTRICTIVE policy ทับตารางธุรกิจ (helper `is_customer_role()` ดู profiles.role + auth metadata) — staff ใช้งานเหมือนเดิม, customer ถูก deny; **เปิด INSERT ไว้เฉพาะ service_jobs (สั่งงาน) + customers (signup)**; `profiles` self-scope (ลูกค้าเห็นแค่ own row → ไม่อ่าน PII staff, login ไม่ fallback role). ไม่แตะ runtime/schema/permissive เดิม → build คงเดิม (504). ✅ **APPLIED live 2026-06-20** (owner รัน SQL; 43 policies = 40 deny เต็ม + 2 service_jobs/customers + 1 profiles self-scope; +4 ตารางจาก STEP0 cross-check รวม staff_sessions); residual: หน้าลูกค้าจะไม่เห็น "ของฉัน" (ประวัติซื้อ/แต้ม) ชั่วคราว + ลูกค้ากดยืนยันปิดงานเองไม่ได้
- feat(service,build 501): หน้างานช่าง (service drawer) — (A) ตัวเลือก "เลือกอุปกรณ์ (จากสต็อก)" เพิ่มหลายชิ้นรวดได้ ไม่เด้งปิดทุกครั้ง (เหมือนตะกร้า POS) + toast บอกทุกครั้งที่เพิ่ม + ตัวนับ "เพิ่มแล้ว N ชิ้น" ที่หัว picker + **ตะกร้าเห็นสด** (รายการ/จำนวน/ยอดรวม ในตัว picker เหมือนแคชเชียร์) + **กัน double-add จอสัมผัส** (แตะตัวเดิมซ้ำใน 350ms = ข้าม กันตัดสต็อกเกินตอนปิดงาน — mirror POS); ปิดด้วยปุ่ม ✕ / คลิกพื้นหลัง. (B) แก้จอแสดง "คงเหลือในคลัง" เพี้ยนชั่วคราวหลังปิดงานตัดสต็อก — เดิมตัดในจอ 2 เท่า (optimistic ลบซ้ำกับที่ระบบ sync ให้แล้ว) จนรีโหลดถึงตรง; ตอนนี้ตัด 1 ครั้ง จอตรงกับ DB ทันที. **สต็อกจริงที่ฐานข้อมูลถูกอยู่แล้ว** (แก้เฉพาะ display + UX). ไม่แตะ logic ตัด/คืน/claim (#C-2)/CAS/DB + ไม่แตะ picker ของฟอร์มอื่น (ac_install/service_form/solar = Phase 502). ⚠️ รอ owner smoke + Codex review
- fix(stock,build 500): ปิด/ลบ/ยกเลิกงานช่างที่มีอุปกรณ์ พร้อมกันจาก 2 เครื่อง/2 tab จะไม่ตัด/คืนสต็อกซ้ำอีก — เดิมกันซ้ำด้วยการอ่านโน้ตในแอป (ไม่ atomic) → ทำพร้อมกันผ่านด่านทั้งคู่ → ตัด/คืนสต็อก 2 เท่า. ตอนนี้ "เคลม" สิทธิ์ที่ฐานข้อมูลแบบ atomic (2 คอลัมน์ใหม่ stock_deducted_at/stock_reverted_at) → เครื่องเดียวชนะ อีกเครื่อง skip; ปิดงานแล้วเช็คสต็อกไม่ได้ = เตือน (ไม่ตัดเงียบ). 🔴 owner รัน SQL (supabase-phase500-*.sql: ALTER 2 col + backfill 2 marker) "ก่อน deploy". ไม่แตะ logic ตัด/คืน CAS. ⚠️ รอ owner+Codex review

- fix(accounting,phase 498 · SQL-only): บังคับที่ฐานข้อมูลว่า "รายการ (lines) ของใบสำคัญบัญชี (JV) ต้องบาลานซ์ + ผลรวมตรงยอดหัวบิล" — เดิม DB การันตีแค่หัวบิล (total_debit=total_credit) ไม่เช็คว่าผลรวม lines ตรงหัวบิลหรือ Dr รวม=Cr รวม → JV ที่ lines ไม่ครบ/ไม่ตรง หลุดได้ → งบทดลอง/งบดุลเพี้ยนเงียบ. เพิ่ม CONSTRAINT TRIGGER (deferred) บน journal_lines. สำคัญก่อนเริ่มบัญชีจริง 1 ก.ค. 🔴 owner รัน SQL (supabase-phase498-*.sql; STEP0 เช็ค JV เดิมที่ผิดก่อน). ไม่แตะโค้ด/ไม่ bump build. ⚠️ รอ owner+Codex review
- fix(accounting,build 498): ฟอร์ม "บันทึกรายการบัญชีใหม่" (JV) พิมพ์ตัวเลขเดบิต/เครดิตได้รวดต่อเนื่อง — เดิมพิมพ์ทีละตัวแล้ว focus หลุด (ฟอร์มถูกวาดใหม่ทุกครั้งที่กดเลข) + ทศนิยมพังกลางคัน. ตอนนี้อัปเดตเฉพาะแถบยอดรวม/ปุ่มแบบสด ไม่วาดฟอร์มใหม่ → พิมพ์ "12345.67" รวดเดียวได้ + ป้าย เดบิต=เครดิต ขึ้นทันที. ไม่แตะ logic บันทึก/ตรวจสอบ. (manual JV ใช้จริง 1 ก.ค.) ⚠️ รอ owner+Codex review
- fix(stock,build 499): ลบบิล POS พร้อมกันจาก 2 เครื่อง/2 tab จะไม่คืนสต็อกซ้ำอีก — เดิมกันคืนซ้ำด้วยการอ่าน-แล้ว-เขียนในแอป (ไม่ atomic) → ลบพร้อมกันผ่านด่านทั้งคู่ → คืนสต็อก 2 เท่า (สต็อกพอง/เสี่ยงขายเกิน). ตอนนี้ "เคลม" สิทธิ์คืนที่ฐานข้อมูลแบบ atomic (คอลัมน์ใหม่ stock_reverted_at) → เครื่องเดียวชนะคืน อีกเครื่อง skip. ไม่แตะ logic คืนสต็อก/CAS/bundle. 🔴 owner รัน SQL (supabase-phase499-*.sql: ALTER + backfill marker เก่า) "ก่อน deploy". ⚠️ รอ owner+Codex review

- fix(loyalty,build 497): ยกเลิก/คืนบิลเดียวกันพร้อมกัน (2 เครื่อง/กดซ้ำ) จะไม่คืนแต้มซ้ำอีก — เดิมเช็คแค่ในแอป (cache) ไม่มีกันที่ฐานข้อมูล → คืนแต้ม 2 เท่า (ยอดแต้มติดลบได้). เพิ่ม unique index ที่ DB + แอปรู้ว่า "คืนไปแล้ว" → ข้ามเงียบ ไม่คืนซ้ำ. 🔴 owner รัน SQL (supabase-phase497-*.sql; STEP0 เช็ค dup ก่อน). ⚠️ รอ review

- fix(accounting,build 496): งบการเงิน (งบทดลอง/กำไรขาดทุน/งบดุล/สรุปงวด/ชุดส่งสรรพากร) ดึงข้อมูลครบทุกรายการแล้ว — เดิมดึง JV ตรง ๆ ไม่แบ่งหน้า → เซิร์ฟเวอร์จำกัด 1000 แถว → ถ้ารายการบัญชีในช่วงเกิน 1000 จะหล่นเงียบ ๆ ทำให้งบไม่ดุล/ตัวเลขต่ำกว่าจริง (งบดุลสะสมจาก 1 ก.ค. = ตัวแรกที่จะเกิน). ตอนนี้แบ่งหน้าโหลดครบทุกหน้า. ⚠️ รอ owner review ก่อน merge

- docs(rls,SQL phase 495): บันทึก trigger กัน self-promote-to-admin ที่มีอยู่จริงเข้า repo (เดิม apply ตรงใน Supabase ไม่เคย track) — audit #1 เคยเคลมว่า "ไม่มีการป้องกัน" แต่ verify ผิดชั้น (ดูจาก repo ไม่ใช่ DB จริง); จริง ๆ DB มี `guard_profile_role_update` (BEFORE UPDATE: ล็อก id+role admin-only) บล็อก exploit อยู่แล้ว. ไฟล์นี้ document ของจริง + ลบ trigger ซ้ำที่ผมเผลอเพิ่ม (`trg_guard_profiles_role`). 🔴 owner รัน DROP block (2 บรรทัด) ทิ้งตัวซ้ำ

- fix(stock,build 494): การรับ/คืนสต็อกที่บันทึกไม่สำเร็จ (เน็ตหลุด/สิทธิ์) จะไม่ทิ้ง "รายการเคลื่อนไหวหลอก" ไว้อีก — เดิมถ้าปรับสต็อกจริงล้มเหลว ยังบันทึกประวัติว่ารับเข้าแล้ว → รายงานสต็อกรับเกินจริง. ตอนนี้ล้มเหลว = หยุดก่อนบันทึกประวัติ (เหมือนฝั่งตัดขายที่แก้ไปแล้ว build 485). ⚠️ รอ owner review ก่อน merge

- fix(products,build 493): ป้าย "≈Nวันจะหมด" (สต็อกหมุนเวียน) ในรายการสินค้าแสดงจริงแล้ว — เดิมอ่านข้อมูลการขายที่ไม่เคยถูกโหลด → ป้ายไม่เคยขึ้นเลย. ตอนนี้ดึงยอดขาย 30 วันจริง (จากรายการเคลื่อนไหวสต็อก) มาคำนวณวันที่จะหมด แล้วเติมป้ายต่อสินค้าหลังโหลดหน้า. ⚠️ รอ owner review ก่อน merge

- fix(reports,build 492): รายงานช่วงเวลา (กำไรต่อช่วง, heatmap เวลาขายดี, รายรับ/กำไรเดือนนี้) ดึงยอดขายจริงทั้งช่วงจากเซิร์ฟเวอร์ — เดิมรวมจาก 50 บิลล่าสุดในแอป → ร้านที่ขายเกิน 50 บิล/ช่วง ตัวเลขต่ำกว่าจริงแบบเงียบ ๆ. ตอนนี้ดึงครบทั้งช่วง (ไม่พึ่ง cap 50) → ตัวเลขถูกทั้งระบบ; โหลดไม่สำเร็จ = แจ้ง error/ลองใหม่. ⚠️ รอ owner review ก่อน merge

- fix(payroll,build 491): รายการเงินเดือนที่ "จ่ายแล้ว" แก้ยอดไม่ได้แล้ว (กันรายจ่าย/บัญชีหลุด) — เดิมแก้ row ที่จ่ายแล้ว → ยอดรวมเปลี่ยน แต่รายจ่าย (expense) + บัญชี (JV) ค้างยอดเก่า = เงินจริงไม่ตรงบัญชี. ตอนนี้ row ที่จ่ายแล้ว = ฟิลด์เงินล็อก (แก้ได้แค่หมายเหตุ) + แบนเนอร์บอกให้ "ลบแล้วสร้างใหม่" ถ้าจะแก้ยอด (ระบบย้อนรายจ่ายให้). ⚠️ รอ owner review ก่อน merge

- fix(cash,build 490): หน้ากระทบยอดเงินสด (ปิดลิ้นชัก) เลิกขึ้น "↓ ขาด ฿0.00" หลอก — เดิมยอดที่ควรมี/ส่วนต่าง ไม่ปัด 2 ตำแหน่ง → เศษ floating-point ทำให้ส่วนต่างเป็นค่าติดลบจิ๋ว ๆ → ระบบตีว่า "ขาด" ทั้งที่นับตรงเป๊ะ. ปัด 2 ตำแหน่งทุกค่า → "ตรงกัน ✓" ถูกต้อง. ⚠️ รอ owner review ก่อน merge

- fix(payroll,build 489): ลบรายการเงินเดือนแล้วย้อนรายจ่าย — เลิกลบผิดตัว (เงินคนอื่นหาย) — เดิมลบ payroll id 5 ใช้ค้นหา "#payroll-5" แบบ substring → ไปลบรายจ่ายของ id 50/500 ที่ขึ้นต้นเหมือนกันด้วย (รายจ่ายเงินเดือนคนอื่นหายจริง). ตอนนี้ดึงรายการที่เข้าข่ายมาก่อน แล้วกรองให้ตรง id เป๊ะ (ขอบเขตชัด) ก่อนลบทีละ id; การเช็คซ้ำตอนจ่ายก็ใช้วิธีเดียวกัน (กันข้ามไม่สร้างรายจ่าย). โอกาสเกิดน้อย (ต้องมี id ขึ้นต้นชนกัน) แต่เป็นเงินจริง. ⚠️ รอ owner review ก่อน merge

- fix(accounting,build 488): ฟอร์ม "ลงยอดยกมา" กันลงซ้ำ (เดิมกดบันทึก 2 ครั้ง = งบดุลเบิ้ลตั้งแต่วันแรก) — เพิ่ม (1) กันกดซ้ำตอนกำลังบันทึก (disable ปุ่ม + ignore คลิกซ้ำ) + (2) เช็คก่อนบันทึก: ถ้ามียอดยกมาของวันเริ่มระบบอยู่แล้ว → เตือน + ให้ยืนยัน (บอกให้ลบใบเดิมก่อนถ้าจะแก้). แก้ข้อความที่เคยอ้างผิดว่า "กดซ้ำได้ มี idempotency กัน". สำคัญก่อน go-live บัญชี 1 ก.ค. ⚠️ รอ owner review ก่อน merge

- fix(security,build 487): บัญชี "สำนักงานบัญชี" (อ่านอย่างเดียว) เก็บเงิน/ยกเลิก/ลบ/อนุมัติ/แปลงเอกสาร ผ่าน dropdown สถานะแถว ไม่ได้แล้ว — เดิม gate read-only ครอบปุ่มแต่ "ไม่ครอบ dropdown สถานะ" ในใบเสร็จ/ใบเสนอราคา/ใบส่งของ → สำนักงานบัญชีเก็บเงิน (ลงบัญชีรายได้) หรือยกเลิก/ลบได้ (หลุด SoD). เพิ่มด่านที่ dropdown ทั้ง 3 + ในฟังก์ชันแปลง/ลบใบเสนอราคา. ไม่กระทบ admin/พนักงานขาย (เขียนได้เหมือนเดิม). ⚠️ รอ owner review ก่อน merge

- fix(reports,build 486): รายงาน/KPI ที่ใช้ข้อมูล "รายการสินค้าต่อบิล" แสดงค่าจริงแล้ว (เดิมว่าง/฿0/0-ชิ้นถาวร) — 6 จุดอ่าน `state.saleItems` ที่ระบบไม่เคยโหลด → ตอนนี้ดึง `sale_items` สดจากเซิร์ฟเวอร์เฉพาะตอนเปิดหน้า. แก้ 5 จุด: **กำไรต่อสินค้า** (ทั้งหน้าเคย ฿0), **Top 5 สินค้าขายดี** บนแดชบอร์ด, **ลูกค้าซื้อเยอะ** (คอลัมน์จำนวนชิ้น), **ประวัติการขาย** ในหน้าสินค้า, auto-fill ชื่อสินค้าตอนเพิ่ม Serial. โหลดไม่สำเร็จ = แจ้ง error/ลองใหม่ (ไม่เดาว่า "ไม่มีของขาย"). [เหลือ turnover badge หน้าสินค้า = follow-up] ⚠️ รอ owner smoke + Codex review

- fix(stock,build 485): ตัดสต็อก (in/out manual + งานช่าง) ที่ตัดไม่สำเร็จจาก CAS — เลิกบันทึกรายการเคลื่อนไหวหลอก — `_applyStockMovement` ฝั่งตัดออก (out/sale) เดิมถ้าตัดล้มแบบไม่ใช่ "สต็อกไม่พอ" (RLS/เน็ต) จะเตือนแล้วยัง log movement ว่าตัดสำเร็จ ทั้งที่สต็อกไม่เปลี่ยน → รายงาน reconcile รก. ตอนนี้คืน fail ก่อน (ไม่ log) ตรงกับฝั่ง POS ที่แก้ไปแล้ว. ไม่กระทบสต็อกจริง (CAS ไม่แตะ DB อยู่แล้ว). ⚠️ รอ owner review ก่อน merge

- fix(pos,build 484): บันทึกสินค้า — ปัดราคา/ต้นทุน/ราคาส่ง/ราคาโปรฯ เป็น 2 ตำแหน่ง (เดิมเก็บค่าดิบ → float drift + ไม่ตรงกับการแก้ราคาใน POS ที่ปัดแล้ว). ปัดผ่าน round2 กลางเหมือนหน้าอื่น. ⚠️ รอ owner review ก่อน merge

- fix(stock,build 483): ยกเลิก/ลบบิล POS — คืนสต็อก "ไม่เกินจำนวนที่ตัดจริง" — เดิมถ้าสินค้าตัวเดียวกันอยู่หลายบรรทัด (เดี่ยว + ในชุด bundle) แล้วตัดได้บางบรรทัด (บิลขายเกินสต็อก) ตอนยกเลิกอาจคืนเกินที่ตัดจริง = สต็อกผี (เสี่ยงขายเกิน). ตอนนี้คืนรวมต่อสินค้าไม่เกินยอดที่ตัดจริง (อ้างอิงรายการเคลื่อนไหวขายของบิลนั้น); เช็คไม่ได้ = คืนเต็มเหมือนเดิม (กันคืนขาด). บิลปกติ/บิล bundle คืนเท่าเดิม ไม่ regress. ⚠️ รอ owner smoke + Codex review ก่อน merge (money/stock)

- fix(service,build 482): งานช่าง — ตัดสต็อกอุปกรณ์ "ตอนปิด/ส่งมอบงาน" แทนตอนเพิ่ม + งานเดิมเพิ่มอุปกรณ์ได้ — เดิมตัดสต็อกตอนสร้าง/บันทึกงาน (ช่างยังไม่ได้ทำ ของก็หายจากคลังแล้ว) และงานเดิม (รวมงานจาก Ning/LINE) เพิ่มอุปกรณ์แล้วบันทึกไม่ติด. ตอนนี้: เพิ่ม/แก้อุปกรณ์ได้ตลอดงานยังไม่ปิด (ยังไม่ตัด) → ตัดจริงครั้งเดียวตอนเปลี่ยนเป็น เสร็จ/ส่งมอบ/ปิดงาน (พร้อมลงบัญชี); ยกเลิกงานที่ตัดแล้ว = คืนสต็อก. ⚠️ owner ต้องรัน `supabase-phase482-freeze-deducted-equipment.sql` (มาร์คงานเก่าที่ตัดไปแล้ว กันตัดซ้ำ). ⚠️ รอ owner smoke + Codex review ก่อน merge (money/stock)

- fix(pos,build 481): ฟอร์มบันทึกสินค้ากัน input พลาด — (1) เตือนเมื่อ **บาร์โค้ด/SKU ซ้ำ** กับสินค้าตัวอื่น (กดบันทึกต่อได้ถ้าตั้งใจ) กัน POS สแกนหยิบผิดตัว/ราคาผิด (ระบบไม่มี unique ระดับฐานข้อมูล); (2) **จำนวนสินค้าในชุด (bundle)** พิมพ์ตัวอักษร/0/ติดลบ → ใช้ 1 แทน (เดิม "2ก" = NaN เข้าสูตรชุดเสีย). ไม่แตะสต็อก/การขาย/ฐานข้อมูล. ⚠️ รอ owner+Codex review ก่อน merge

- fix(pos,build 480): กันขายเกิน (precheck) ตอน "ขายแบบอัตโนมัติ" เช็คสต็อก "คลังเดียวที่จะตัดจริง" ไม่ใช่ผลรวมทุกคลัง — เดิมของ 3(บ้าน)+4(รถ)=7 ขาย 5 → precheck ผ่าน แต่ตัดบ้านได้ 3 → ติดธง "[สต็อกไม่ครบ]" ผิดทั้งที่ของพอ. ตอนนี้ precheck กับการตัดสต็อกใช้ตัวเลือกคลังตัวเดียวกัน (บ้านก่อน ไม่งั้นคลังที่มีของมากสุด) → ตรงกัน ไม่มีธงผิด; ถ้าคลังที่จะขายไม่พอ → บล็อก + บอก "คลัง {ชื่อ} มี {N} (เลือกคลังอื่น/ลดจำนวน)". เลือกคลังเอง = เหมือนเดิม. ⚠️ รอ owner+Codex review + smoke ก่อน merge (money/stock)

- fix(stock,build 479): saveProduct + นำเข้า CSV เลิกเขียน `products.stock` ตรง (ปล่อย DB trigger 403 คุม) — `products.stock` = ยอดรวม derived = sum(`warehouse_stock`); เดิม "บันทึกสินค้า" ส่ง `stock=ยอดรวมทุกคลัง` ลง products เสมอ แล้วพึ่ง trigger ทับ — แต่ถ้าเขียนสต็อกบางคลัง fail (เตือน toast แต่ "ไม่ revert") → `products.stock` ค้าง "เกินจริง" → precheck กันขายเกินอ่านผิด = เสี่ยงขายเกิน. ตอนนี้สินค้าที่มีคลัง → ไม่เขียน stock ตรง (ให้ trigger derive; เขียนคลัง fail = ต่ำกว่าจริง = ปลอดภัย ไม่เกินจริง); สินค้าไม่มีคลัง (legacy) = เขียนตรงเหมือนเดิม. นำเข้า CSV = ข้อมูลสินค้าอย่างเดียว (ไม่ตั้งสต็อก — ตั้งผ่าน "รับเข้า/นับสต็อก"). `min_stock` ยังเขียนตรง (trigger ไม่ derive min_stock). ⚠️ รอ owner+Codex review + smoke ก่อน merge (money/stock)

- fix(stock,build 478): หน้า Dead Stock (สินค้าค้าง) คิดจากการขายจริงทั้งช่วง — เดิมอ่าน `state.saleItems` ที่ไม่เคยถูกโหลด (+ `state.sales` cap 50) → สินค้าที่มีสต็อกทุกตัวขึ้นเป็น "ค้าง/ไม่เคยขาย" (เพี้ยนทั้งหน้า). ตอนนี้ดึง `stock_movements` (type=sale) ตามช่วงวันที่เลือก แบบ paginate ครบ (ไม่ cap) → คิด dead จากของที่ "ไม่ขายในช่วง" จริง; โหลดไม่สำเร็จ = แจ้ง error + ปุ่มลองใหม่ (ไม่เดาว่า "ค้างทุกตัว"). อ่านอย่างเดียว ไม่กระทบเงิน/สต็อก. ⚠️ รอ owner+Codex review ก่อน merge

- fix(stock,build 477): คืนสต็อก "children" ของสินค้าชุด (bundle) เมื่อยกเลิก/ลบบิล POS — เดิมขาย bundle แล้ว void สต็อก children ที่ตัดตอนขาย "ไม่ถูกคืน" = สต็อกหายถาวร (sale_items เก็บ id ตัวแม่ แต่ตัวที่ถูกตัดคือ children → filter คืนเฉพาะที่ตัดจริงไม่เจอตัวแม่ → ข้าม). แก้ `_revertStockForSale`: เจอ bundle → ขยายสูตร (`product_bundles`) → คืน children qty = สูตร×จำนวนที่ขาย เข้าคลังที่ขาย ผ่าน CAS (กันคืนเกินด้วย gate เดิม + idempotent marker เดิม); สินค้าเดี่ยว = พฤติกรรมเดิมเป๊ะ. ⚠️ ต้องคืน owner+Codex review ก่อน merge (money/stock)

- feat(pos,build 464): เลือกคลังขายใน POS (คลังเดียวต่อบิล) → ตัดสต็อกจากคลังที่เลือก [เฟส 2/2] — แถบ "ขายจากคลัง: อัตโนมัติ/บ้าน/ศีขร/คันขาว/คันแดง" บนหน้าเลือกสินค้า → กรอง+โชว์คงเหลือเฉพาะคลังนั้น → จ่ายเงินตัดทั้งบิลจากคลังที่เลือก (CAS floor กัน oversell; สินค้าไม่มีในคลังที่เลือก=เตือน ไม่ตัดจากคลังอื่น); "อัตโนมัติ"=บ้าน-first เดิม (backward-compatible); + ปุ่ม + เพิ่มสินค้าแบบเงียบ (อยู่หน้าเลือกสินค้าเดิม กดเพิ่มหลายรายการรวดได้ ไม่เด้งกลับ home) + fix double-add จอสัมผัส (กด + 1 ที = เพิ่ม 1, debounce 350ms + touch-action). ✅ owner smoke ตัดสต็อกถูกคลังแล้ว (บ้าน 50→48/49→48)

- feat(pos,build 463): แก้ราคาขาย inline ในการ์ดสินค้าหน้า POS (เลือกสินค้า) — admin/sales กด ✏️ → กรอกราคาใหม่ → ยืนยัน → บันทึก (PATCH products.price เท่านั้น); gate สิทธิ์ + confirm old→new + ไม่แตะตะกร้า/ตัดสต็อก (ของในตะกร้าเดิมราคาไม่เปลี่ยน); + **กดที่การ์ด → เปิดหน้าสินค้าเต็ม** (ราคา/ต้นทุน/สต็อก/ชื่อ — reuse openProductDrawer) แบบ FlowAccount. [เฟส 1/2 — เฟส 2 = เลือกคลัง→ตัดจากคลังนั้น ทำต่อ]

- feat(products,build 462): พิมพ์บาร์โค้ดออกเป็น "แนวนอน" บนกระดาษ 30×50mm — หมุนเนื้อหา 90° ให้บาร์โค้ดยาวตามด้าน 50mm (กว้าง สแกนง่าย) ตรงกับป้ายตัวอย่างที่เจ้าของส่งมา; default = 30×50 แนวนอน, ยังเลือก 50×30/40×25/70×40 ได้; print-only ไม่แตะ DB/เงิน/สต็อก

- feat(serial,build 461): เพิ่มปุ่ม 🗑️ ลบ serial (ถาวร) ในหน้า Serial Number / Warranty — เดิมไม่มีปุ่มลบเลย (ลบ test001/ข้อมูลทดสอบไม่ได้); confirm ก่อนลบ + ตรวจผลจริง (ลบ 0 แถว/ไม่มีสิทธิ์ → แจ้ง error ชัด ไม่เงียบ ไม่ค้าง); hard DELETE product_serials (RLS FOR ALL อนุญาตอยู่แล้ว) ไม่แตะ edit/claim/add

- feat(stock,build 460): picker สินค้าใน modal "ย้ายสต็อกระหว่างคลัง" แสดงผลค้นหาเป็น "รายการคลิกได้" (เหมือนหน้าค้นหาสินค้า) — พิมพ์แล้วเห็นรายการที่ตรง ชื่อ/หมวด/SKU/บาร์โค้ด คลิกเลือกได้เลย (เดิมต้องเปิด dropdown เอง); UI-only — <select> ซ่อนไว้เป็น value-holder คง .value submit เดิม ไม่แตะ logic โอน/ไม่มี stock-write

- feat(stock,build 459): ช่องค้นหาสินค้าใน modal "ย้ายสต็อกระหว่างคลัง" — พิมพ์กรอง dropdown สินค้าตาม ชื่อ/หมวด/SKU/บาร์โค้ด (สินค้า ~1000 ตัวเลื่อนหายาก); UI-only filter ฝั่ง client คง id #smt-product-select + .value เดิม ไม่แตะ logic โอน/ไม่มี stock-write

- feat(products,build 458): ปุ่มทางลัด "🔄 โอนระหว่างคลัง" ในเมนูจัดการเพิ่มเติม (หน้าสินค้า/คลัง) → นำทางไปหน้ารายการเคลื่อนไหวสต็อกแล้วเปิด modal โอนให้เลย (PURE navigation/UI — reuse flow โอนเดิม ไม่มี stock-write ใหม่)

- feat(service,build 457): แถวอุปกรณ์ในงานช่าง แสดง "🔻 ตัดจาก {คลัง} • คงเหลือ {N} ชิ้น" ต่อรายการ — คงเหลือสดจาก state.warehouseStock (read-only display ไม่ยิง DB, ไม่แตะ deduct/qty)

- feat(products,build 456): การ์ดสรุปสต็อกแต่ละคลัง (หน้าสินค้า/คลัง) — แถวการ์ดต่อคลัง + "ทุกคลัง" แสดงจำนวนรายการ/ชิ้น คลิกสลับคลังได้ (read-only คำนวณจาก state เดิม ไม่ยิง DB)

- feat(service,build 455): warehouse-first picker — service_form (ทุกหน้าซ่อม) + solar (mirror 453a) → ทุกหน้างานช่าง consistent

- feat(service,build 454): warehouse-first picker หน้าแจ้งซ่อม/บริการ (service drawer) — เลือกคลังก่อน + กรองหมวด (rebased จาก 452 → bump 454)

---

## 5.69.1 (build 453) — 2026-06-16 ติดตั้งแอร์: เลือกอุปกรณ์ เลือกคลังก่อน + กรองหมวด

- **feat(service):** picker "🔧 เลือกอุปกรณ์" หน้า **ติดตั้งแอร์** (ac_install) เพิ่ม **"เลือกคลังก่อน"** — chips คลัง (ทุกคลัง/รถคันขาว/คันแดง/บ้าน) + dropdown หมวด → เลือกคลังแล้วลิสต์เหลือเฉพาะของคลังนั้น + tag เฉพาะคลังนั้น (กันสับสนสินค้าชื่อซ้ำข้ามคลัง)
- คลิกสินค้า → ใช้คลังที่เลือกเลย (ไม่เด้งถามคลังซ้ำ) · "ทุกคลัง" = flow เดิม (รถเดียว auto / หลายรถถาม / บ้าน fallback) · คง badge "⚠️ ยังไม่ได้โอนขึ้นรถ" + toast ยืนยันโอนตอนบันทึก
- 🔴 **UI picker เท่านั้น — ไม่แตะ logic transfer/ตัดสต็อก** (mobile/home, _pickMobileWarehouse, auto-transfer บ้าน→รถ, dedup, save/deduct คงเดิม) · `_items` contract เดิม (warehouse_id/warehouse_name/_stock_avail)
- คนละ picker กับงานแจ้งซ่อม (service_equipment.js) · +guard `ac_install_picker_guard` (7)
- _(หมายเหตุ build: 452 = equip picker งานแจ้งซ่อม ค้างอีก branch — 453 ฐานจาก main build 451)_

## 5.69.1 (build 451) — 2026-06-16 ใบเช็คสต็อก A4 (พิมพ์ตามคลัง/หมวด + QR ต่อตัว)

- **feat(products):** ปุ่ม "📋 พิมพ์ใบเช็คสต็อก" (เมนูจัดการเพิ่มเติม หน้าสินค้า/คลัง) → เปิดหน้า A4 พิมพ์ได้ สำหรับเอาขึ้นรถ/เช็คคลังมือ
- แยกหัวข้อตามหมวด · แต่ละแถว = ลำดับ · ชื่อสินค้า+barcode/SKU · **QR (=barcode)** · คงเหลือ(ระบบ) · ช่องว่าง **"นับจริง"** เขียนมือ
- ขอบเขต = **"พิมพ์ตามที่เห็นบนหน้าจอ"** (คลัง + หมวด + filter ที่เลือกอยู่): รถคันแดง→เฉพาะคันแดง, ทุกคลัง→ทั้งหมด, หมวดเดียว→หมวดนั้น
- **read-only ล้วน** (ไม่เขียน DB) · **ไม่มีราคา/ต้นทุน** ในใบ (เป็น stock-check ไม่ใช่ valuation; ช่างก็พิมพ์ได้) · QR ใช้ lib เดิม (ไม่เพิ่ม CDN)
- +`modules/stock_check_sheet.js` (pure builder) · +guard `stock_check_sheet_guard` (6)

## 5.69.1 (build 450) — 2026-06-16 สร้างบาร์โค้ด: เลือกขอบเขตได้ (filter / Bulk รายตัว)

- **feat(products):** ปุ่ม "🏷️ สร้างบาร์โค้ด" (หน้าสินค้า/คลัง) เดิมยิงทั้งแคตตาล็อกเสมอ → ตอนนี้เลือก scope ได้ 2 ทาง: (1) **ตามหมวด/หน้าที่กรองอยู่** (ถ้ามี filter ใช้อยู่ จะถามว่าเอาเฉพาะที่กรอง N รายการ หรือทั้งหมด M รายการ — mirror ปุ่ม Export) (2) **Bulk ติ๊กเลือกรายตัว** → ปุ่ม "🏷️ สร้างบาร์โค้ด" ในแถบ bulk action
- ทุกแบบ **เติมเฉพาะสินค้านับสต็อกที่ยังไม่มีบาร์โค้ด — ไม่ทับของเก่า** (กันบาร์โค้ดบนชั้นวางเพี้ยน); gen ทีละราย (คนละบาร์โค้ด) ผ่าน helper กลาง `_generateBarcodesForProducts`
- ไม่แตะ: stock/price/cost/ประเภท/หมวด · flow checkout/เงิน · algorithm `generateBarcodeEAN13` · ปุ่มพิมพ์บาร์โค้ด. +guard `products_barcode_scope_guard` (6)

## 5.69.1 (build 449) — 2026-06-16 หน้า "ตั้งรหัสผ่านใหม่" (เชิญทีมงาน) เด้งได้ทุกเครื่อง

- แก้: เชิญพนักงานใหม่แล้วบางเครื่อง (ที่ login ค้าง / มี cache เดิม เช่น เครื่องร้านใช้ร่วมกัน) เปิดลิงก์แล้ว **ไม่ขึ้นหน้าตั้งรหัสผ่าน แต่เด้งเข้าแอปเลย** — เพราะ hash `type=recovery` หายก่อนแอป boot
- `selfheal.js` จับสัญญาณ recovery ตั้งแต่วินาทีแรก (ก่อน Supabase client เคลียร์ hash) เก็บ flag `bsk_pending_set_password` ใน sessionStorage → `main.js` ใช้ flag นี้ตัดสินใจด้วย ไม่ใช่แค่ hash สด → หน้าตั้งรหัสเด้งแม้ hash หาย / SW reload / มี session ค้าง
- เคลียร์ flag เมื่อ: ตั้งรหัสสำเร็จ · ขอลิงก์ใหม่ · ออกจากระบบ · ลิงก์หมดอายุ (กัน login ปกติโดนเด้งไปหน้าตั้งรหัสผิด)
- ไม่แตะ: regex `type=recovery` เดิม · ปุ่มเชิญ (signup/recover) · เงิน/สต็อก · RLS. +guard `invite_setpassword_persist_guard` (6) · _(เดิมตั้ง build 448 แต่ชนงาน accountant-docs ที่ขึ้น 448 ก่อน → เลื่อนเป็น 449)_

## 5.69.0 (build 448) — 2026-06-15 สำนักงานบัญชี read-only บนเอกสาร (448a client gate)

- **feat(auth/SoD):** accountant (สำนักงานบัญชีภายนอก) กดปุ่มเขียนบน **ใบเสร็จ / ใบเสนอราคา / ใบส่งสินค้า** ไม่ได้ — ทุก write (สร้าง/แก้/ยกเลิก/ลบ/เก็บเงิน/แปลงเป็นใบเสร็จ) เด้ง toast "อ่านอย่างเดียว" + ไม่ทำงาน (กันแก้เอกสารต้นทาง = แยกหน้าที่)
- helper `_denyWriteForAccountant()` ต่อ module → guard **14 write entry** (receipts 6 · quotations 3 · delivery 5) + guard test
- เป็น **client gate (UX)** ปิด path จริงผ่าน UI; **448b (RLS DB backstop)** = ขั้นต่อไป (กัน API ตรง)
- bump 447→448 (data-app-version 5.68.0→5.69.0)

## 5.68.0 (build 447) — 2026-06-15 เงินเดือนลงบัญชีเป็น JV ก้อนเดียวต่องวด (Step 3a privacy)

- เปลี่ยนการลงบัญชีเงินเดือน: เดิม JV **รายคน** (เห็นชื่อ+ยอดต่อคน) → **JV ก้อนเดียวต่อรอบ** (Dr 5200 รวม / Cr เงินสด·ธนาคาร แยก, **ไม่มีชื่อ**) ผ่าน `postPayrollPeriodJournal` — สำนักงานบัญชี (accountant) เห็นแค่ยอดรวมในสมุดรายวัน
- โพสต์ผ่านปุ่ม admin **"📒 ลงบัญชีงวดนี้"** ในหน้าเงินเดือน (idempotent ต่องวด, append-only) + เตือนถ้าจ่ายยังไม่ครบงวด; ถอด per-person JV ออกจาก `_markPaid`
- กัน double-count: backfill ข้าม expense category salary/labor_hire/payroll + ถอด payroll ออกจาก INTEGRITY_CATS (กันงวดขึ้น orphan ลวง = ปิดงวดไม่ได้)
- staff_payroll + expense รายคน **ยังอยู่ครบเป็น HR detail** — 447a ปิด leak ทาง JV เท่านั้น; **เหลือ 447b (RLS staff_payroll + expenses-salary)** ถึงจะซ่อนรายคนจาก accountant ครบ
- +pure `_buildPayrollPeriodLines` + guard `payroll_aggregate_jv_guard` (balance/split/zero/rounding)
- **447b (SQL-only, applied 2026-06-15):** verify-first พบ privacy **ครบแล้วหลัง 447a** — `staff_payroll` RLS = admin+self · `expenses` = is_sales_or_admin (ไม่รวม accountant) → accountant อ่านเงินเดือนรายคนไม่ได้อยู่แล้ว. 447b เลยกลับเป็น "เปิดให้ accountant อ่าน": +RLS `expenses_accountant_read` (non-salary) + `customers_accountant_read` → accountant เห็นรายจ่าย/ลูกค้าที่จำเป็นปิดงบได้ (เงินเดือนยังซ่อน) — `supabase-phase447b-accountant-operational-read.sql`
- _(build 447 ยังรวม commit `61b1216` — daily-summary read-only endpoint ของ owner ที่ค้างใน working tree, ขึ้น main พร้อมกัน)_

## 5.67.0 (build 446) — 2026-06-14 บทบาท "สำนักงานบัญชี" (external accounting firm)

- ปรับบทบาท `accountant` ให้ตรงกับ **สำนักงานบัญชีภายนอก** (มาปิดงบ + ส่งสรรพากรทุก 6 เดือน) ไม่ใช่พนักงานในร้าน
- ตัดเมนู **เงินเดือน / ภาพรวมเงินเดือน / คืนเงิน** ออกจากบทบาทนี้ (สำนักงานบัญชีไม่ควรเห็น/จ่ายเงินเดือนพนักงาน) — เหลือ บัญชี/รายงาน/เอกสารการเงิน
- เปลี่ยนชื่อบทบาทที่แสดง "พนักงานบัญชี" → **"สำนักงานบัญชี"** (ROLE_LABELS + dropdown เพิ่ม/แก้ผู้ใช้); ค่า role ในระบบยังเป็น `'accountant'`
- _(รวมงาน build 444 เพิ่มบทบาท accountant + 445 เปิด RLS `is_accountant()` ที่ session ก่อนหน้าไม่ได้บันทึกใน CHANGELOG)_
- เป็น Step 1+2 จาก 4 — ขั้นต่อไป: RLS ซ่อนเงินเดือนรายคน + RLS read-only เอกสารปฏิบัติการ

## 5.66.0 (build 443) — 2026-06-14 Phase C (ปิดฟีเจอร์) ใบเสร็จลง JV เข้าบัญชีธนาคารถูกตัว

- **feat (MONEY/JV):** `postJournalForReceipt` อ่าน `receipt.bank_coa_code` → ลง JV โอน Dr บัญชีนั้น (เช่น **1132**) แทน 1130 รวมก้อน (ทั้ง VAT-split + no-VAT) = reconcile รายธนาคารครบ flow ใบเสร็จ (แก้ปัญหา audit)
- **validate ก่อนใช้:** reuse `_getValidCoaCodes` (pattern sale_transfer) — invalid/stale COA → warn+toast+fallback mapping default (ไม่โพสต์บัญชีมั่ว ไม่ silent) · ใช้ bank_coa_code เท่านั้น · เงินสด 1110 เดิม
- **ไม่แตะ:** ขาย/ช่าง/รายจ่าย 1130 (flow แยก ไม่มี customer-group) · ไม่มี SQL
- +guard `receipt_bank_jv_guard.test.js` (7: pure resolver behavioral 1131→1131/9999→1130/fail-open + wiring 2 lines/validate/code-not-label) · bump 443
- lint 0 / unit **1637** / e2e **14** / auto_post เดิม pass · ✅ **merged = build 443 live** (`34cec9a`) — CI success · Claude read-only verify preview (login): COA จริง 67 บัญชี · 1131→1131 · 1136→1136 · 9999→1130 fallback · null→1130 (ไม่โพสต์ JV) · JV เต็ม = Day-1/ซ้อมใหญ่ 1 ก.ค. (effective-date)
- 🎉 **ปิดฟีเจอร์กลุ่มลูกค้า→บัญชีรับเงิน ครบ A(438)/B1(439)/B2a(440)/B2b(442)/C(443)** — เลือกกลุ่ม→auto บัญชี→carry→แสดงพิมพ์→override+เตือน→ลง JV ถูกบัญชี

---

## 5.66.0 (build 442) — 2026-06-14 Phase 442 (B2b) แก้บัญชี override บนใบเสร็จ + เตือน paid

- **fix (เอกสาร · ไม่แตะ JV):** edit ใบเสร็จ เพิ่ม dropdown "บัญชีรับโอน" override (snapshot label จากบัญชีที่เลือก เหมือน B2a) → save → preview โชว์ทันที
- **เตือน paid (reviewer #4):** เก็บเงินใบเสร็จโอนที่ยังไม่ระบุบัญชี → App.confirm เตือน (ดำเนินต่อได้) **ก่อน** postJournalForReceipt ทั้ง 2 จุด (dropdown + preview) — ไม่ silent, ไม่เดา 1130
- single-bank (payments[] per-row = future) · **ไม่แตะ auto_post/JV** (Dr บัญชีจริง = Phase C)
- +guard `receipt_bank_override_guard.test.js` (7: ordering warn-ก่อน-post · snapshot · no-1130 · multi-pay) · ไม่มี SQL (col จาก B2a) · bump 442
- lint 0 / unit **1630** / e2e **14** · ✅ **merged = build 442 live** (`b12fb22`) — CI success · Claude smoke preview (login): edit ใบเสร็จ→dropdown บัญชี 7 ตัวเลือกมองเห็น prefill ถูก ปิดไม่ save · ไม่มี error (warn ทริกด้วยข้อมูลจริงไม่ได้ — ไม่มีใบโอน; guard-locked ordering)

---

## 5.66.0 (build 441) — 2026-06-14 Phase 441 (UX) สมุดรายชื่อจำหน้า/ตัวกรอง

- **fix (UX · ไม่แตะข้อมูล):** แก้ไขลูกค้าหน้า 2 → กดบันทึก → เด้งกลับหน้า 1 ทุกครั้ง (renderCustomersPage reset currentPage/search/filter ทุก showRoute). ตอนนี้จำสถานะ (renderView clamp หน้า) → workflow "กรองยังไม่ระบุกลุ่ม→ตั้งกลุ่มทีละราย" อยู่ที่เดิม
- หมายเหตุ: สมุดรายชื่อจำหน้า/ค้นหา/ตัวกรอง แม้ออก-กลับ (เปิดแอปใหม่=หน้า 1)
- +guard `customer_list_page_keep_guard.test.js` (2) · bump 441
- lint 0 / unit **1623** / e2e **14** · ✅ **merged = build 441 live** (`6d2a938`) — CI Tests+Deploy success · verified HTML prod 441 (preview 441 logged-out → ไม่ interactive smoke; guard-locked + deterministic)

---

## 5.66.0 (build 440) — 2026-06-14 Phase 440 (B2a) บัญชีรับโอนบนสายเอกสาร (auto-เติม+carry+แสดง)

- **feat (เอกสาร · ไม่แตะ JV):** ใบเสนอราคาเลือกลูกค้า→**บัญชีรับโอนเด้งอัตโนมัติตามกลุ่ม** (Phase 439 resolver, แก้ได้) → snapshot `bank_label` จากบัญชีที่เลือก → carry `bank_coa_code`+`bank_label` ลง ใบส่ง→ใบเสร็จ → **แสดงบนพิมพ์ทั้ง 3 ใบ** (อ่านจาก row ไม่ live settings)
- **reviewer-locked:** ใบเสนอราคา = display-only ไม่ post JV (#2) · snapshot จากบัญชีที่เลือกจริง (#1/#3) · print อ่าน `r.bank_label` จาก row (#5)
- **SQL ใหม่ `supabase-phase440-doc-bank.sql` (owner รันแล้ว):** +bank_coa_code +bank_label บน quotations/delivery_invoices/receipts (nullable; verify 6 rows queryable)
- **ไม่แตะ:** auto_post/JV (Phase C) · override บนใบเสร็จ + เตือน paid (Phase B2b) · POS
- +guard `doc_bank_carry_guard.test.js` (7) · bump 440
- lint 0 / unit **1621** / e2e **14** · ✅ **merged = build 440 live** (`4781e0d`) — owner รัน SQL (6 col text/YES) + tag 6 บัญชี→กลุ่มครบ · Claude smoke preview: เลือกลูกค้าราชการ→บัญชี 1131 เด้งจริง · resolver vs config จริงถูก · ไม่ mutate · ไม่มี error · verified HTML prod 440

---

## 5.66.0 (build 439) — 2026-06-14 Phase 439 (B1) แมปบัญชี↔กลุ่มลูกค้า + resolver

- **feat (settings/config · ไม่แตะเงิน):** ตั้งค่า→ชำระเงิน เพิ่ม dropdown "🏦 กลุ่มลูกค้า" ต่อบัญชีธนาคาร (เก็บ `paymentInfo.banks[].customerGroup` — JSON ใน app_settings, **ไม่มี SQL/DB schema**) → owner ผูกได้ว่าบัญชีไหน=กลุ่มไหน
- **ใหม่ `modules/customer_groups.js`** single source: `CUSTOMER_GROUPS` (5 กลุ่ม; customers.js import จากนี่แทน const เดิม) + `resolveBankForCustomerGroup()` → snapshot เต็ม {coaCode,bankName,bankAccount,label} / **null เมื่อไม่ match (ไม่ fallback 1130)** (reviewer note #1/#4)
- **ไม่แตะ** receipts/quotations/auto_post/JV/เงิน/สต็อก (= Phase B2/C) · ไม่มี SQL
- +guard `customer_group_bank_map_guard.test.js` (7: resolver behaviour จริง + payment wiring + import single-source) · อัปเดต 438 guard (const→import) · bump 439
- lint:errors 0 / unit **1614** / e2e **14** · ✅ **merged = build 439 live** (`3d4cd5c`) — CI Tests+Deploy success · Claude smoke preview: settings/ชำระเงิน 6 บัญชีมี dropdown กลุ่มครบ (ว่าง+5 กลุ่ม) ไม่มี error · verified HTML prod 439
- **owner ตั้ง mapping ครั้งเดียว:** ผูกบัญชี→กลุ่ม (1131/1132→ราชการ · 1133→POS · 1134→ช่าง · 1135→หน้าร้าน · 1136→ติดตั้ง)

---

## 5.66.0 (build 438) — 2026-06-14 Phase 438 กลุ่มลูกค้า (customer_group) — ฐาน auto บัญชีรับเงิน

- **feat (UX/DATA · additive):** เพิ่มฟิลด์ "กลุ่มลูกค้า" (`customers.customer_group`, nullable text) — dropdown 5 กลุ่ม (ราชการ/ขาย POS/งานช่าง/หน้าร้าน/ขายพร้อมติดตั้ง) ในฟอร์มลูกค้า + ตัวกรอง + badge 🏦 ในสมุดรายชื่อ
- **ทำไม:** ฐานสำหรับ Phase 439+ ที่จะ auto-เติมบัญชีรับเงิน (กลุ่ม→bank sub-account 1131-1136) ลงใบเสร็จ กันออกใบเสร็จผิดบัญชีโอน (owner เคาะ: เลือกตามกลุ่มลูกค้า + แบบ auto-เติม+เตือน แก้ได้)
- **ไม่แตะ** เงิน/สต็อก/บัญชี/payment/receipts — additive ล้วน (ลูกค้าเก่า group=NULL ไม่ backfill)
- **SQL ใหม่ `supabase-phase438-customer-group.sql` (owner รันแล้ว):** ADD COLUMN IF NOT EXISTS + NOTIFY pgrst + verify (re-run safe)
- +guard `customer_group_guard.test.js` (7) · bump 438
- lint:errors 0 / unit **1608** / e2e **14** · ✅ **merged = build 438 live** (`201524a`) — owner รัน SQL (verify customer_group|text|YES) · Claude smoke preview: dropdown 6 ตัวเลือกมองเห็น · ตัวกรอง 3 สถานะถูก · REST column query ได้ (save ไม่ PGRST204) · ไม่ mutate ข้อมูล · verified HTML prod 438

---

## 5.66.0 (build 437) — 2026-06-14 Phase 437 สต็อกห้ามติดลบเด็ดขาด (DB CHECK) — P1-③

- **fix (MONEY/STOCK · owner "ห้ามติดลบเด็ดขาด" — ของค้างจาก Phase 367):** ใส่ **DB CHECK `stock >= 0`** บน `warehouse_stock` + `products` (last line of defense ทับ floor 367/368/369) — client path ไหนพลาดก็เขียนค่าติดลบลง DB ไม่ได้
- **ปิดทาง manual override:** `stock_movements.js` เลิกส่ง `allowNegative:true` → ส่ง `false`; จ่ายออก/โอนที่จะติดลบเปลี่ยนจาก confirm "จะติดลบ ดำเนินการต่อ?" เป็น **hard block** ("ระบบไม่อนุญาตให้สต็อกติดลบ")
- **ไม่แตะ setting `allowNegativeStock` (ตั้งใจ):** มันคุม POS ขายสินค้า stock 0 (ค่าบริการ/ค่าแรง) — บังคับ off จะขายค่าบริการไม่ได้; ไม่เขียนค่าติดลบลง DB (floor+CHECK คุมแล้ว)
- **SQL ใหม่ `supabase-phase437-stock-nonneg-check.sql` (⚠️ owner รันเอง):** pre-check → data-fix (ถ้ามี) → ADD CHECK → verify (re-run safe)
- +guard `stock_nonneg_guard.test.js` (3) · อัปเดต `apply_stock_movement_floor.test.js` (369 guard เดิม → กลับด้านตาม 437) · bump 437
- lint:errors 0 / unit **1601** / e2e **14** · ✅ **merged = build 437 live** (`a076b7a`) — owner รัน SQL (pre-check 0 ติดลบ · ADD constraint · verify 2 แถว) + Phase 403 sync trigger (prerequisite) · Claude smoke บน preview: จ่ายออก 999999 (สต็อก 1) → hard-block "ไม่อนุญาตให้สต็อกติดลบ" ไม่เขียนข้อมูล · DB CHECK active · verified HTML จริง 437 → **ปิดแผน P1 ครบ 3 ข้อ** (①433 เงินเดือนกันจ่ายซ้ำ ②435 รายงานกัน cancelled verify ③437 สต็อกห้ามติดลบ)
- หมายเหตุ: build 435/436 (งานทีมขนาน — native confirm cleanup + document template fields) ไม่มี entry ใน CHANGELOG ตอน push

---

## 5.66.0 (build 434) — 2026-06-13 Phase 434 ช่างเข้าคลังเบิก/ตัดสต็อกเองได้ (ไม่เห็นต้นทุน) + ซ่อนหน้าสิทธิ์ที่ไม่ทำงาน

- **feat (PERMISSION/STOCK · owner request):** role "ช่าง" (+ผู้ช่วยช่างที่ตั้ง role=ช่าง) เข้าเมนู **สินค้า/คลัง** ได้แล้ว เพื่อเบิกของขึ้นรถ + ตัดสต็อกเองทุกครั้งที่ทำงาน — `ROLE_PAGES.technician` += `products`, `wh_kunkhao`, `wh_kundaeng`, `wh_sikhon`, `stock_movements` (เบิก/โอน/ตัด), `stock_count` (นับ)
- **🔒 ช่างไม่เห็นต้นทุน:** หน้า products สำหรับช่าง = **อ่านอย่างเดียว** — ปุ่มจัดการที่เป็นจุดเห็น/แก้ต้นทุน (นำเข้า/เพิ่ม/ส่งออก Excel ที่หัวหน้า + แก้ไข/รับสต็อก ต่อใบ) เปิดเฉพาะ admin/sales (`canManageProducts`/`canManageCard`); ช่างเห็นแค่ชื่อ+สต็อก+QR/พิมพ์บาร์โค้ด · **ไม่เปิด** รับเข้าสินค้า (`stock_in_wizard` โชว์ต้นทุน=งานจัดซื้อ) / มูลค่าสต็อก / สต็อกค้างนาน — ยืนยันแล้ว stock_movements + stock_count ไม่มีต้นทุน
- **ซ่อนหน้า "เมทริกซ์สิทธิ์" ที่ไม่ทำงาน:** ตารางสิทธิ์เดิมบันทึก checkbox ลง DB ได้แต่ **ไม่มีโค้ดเรียก `hasPermission()` ไปบังคับสิทธิ์เลย** (UI หลอกตา) → ถอดปุ่มออกจากเมนูตั้งค่า + เปลี่ยนหน้าเป็นข้อความ "ปิดปรับปรุง" ชี้ไปตั้ง role ที่ "ตั้งค่าผู้ใช้งาน" (สิทธิ์จริงคุมที่ role)
- +guard `tests/technician_stock_access_guard.test.js` (5 tests) · bump 434 + dashboard_readonly_guard → 434 · **ไม่แตะ RLS/เงิน/checkout** (technician เขียนสต็อกผ่าน POS/ใบงานได้อยู่แล้ว = RLS อนุญาตแล้ว)
- +fix พ่วง (เจอตอน Claude smoke เป็นช่างจริง): ปุ่มกรอง "⚠️ ไม่มี cost" ยังโชว์ให้ช่าง → gate ด้วย canManageProducts (ไม่เผยตัวเลขต้นทุน แต่อ้างคำว่า cost) — ช่างไม่เห็นคำว่า cost/ต้นทุนเลย
- lint:errors 0 / unit **1594** / e2e **14** · ✅ **merged = build 434 live** (`8f5cc73`) — Claude smoke เป็น session ช่างจริงผ่านครบ: เห็นเมนูสินค้า/คลัง+รถ · ข้อมูล 1116 รายการโหลด (RLS อ่านได้) · ไม่มีปุ่มนำเข้า/เพิ่ม/⋯จัดการ · เมนูการ์ด=QR/พิมพ์เท่านั้น · ประวัติสต็อก เปิด modal ย้ายคลัง(เบิก)+เพิ่มเคลื่อนไหว(ตัด) ได้ ไม่มีช่องต้นทุน · ไม่เจอคำ cost/ต้นทุน · owner สั่ง merge ถ้าผ่าน

---

## 5.66.0 (build 433) — 2026-06-13 Phase 433 กันจ่ายเงินเดือนซ้ำข้ามเครื่อง (PAYROLL · MONEY)

- **fix (MONEY — ปิด race ที่รู้จากการ audit 416-418):** สองเครื่อง/สองแท็บกด "จ่าย" แถวเดียวกันพร้อมกัน → เดิมสำเร็จทั้งคู่ = **รายจ่าย + JV ถูกสร้างซ้ำ 2 ชุด**
- **ชั้น 1 (client):** `_markPaid` PATCH เป็นแบบ CAS — `?id=eq.{id}&paid_at=is.null` + `Prefer: return=representation` → เครื่องที่แพ้ได้แถวว่าง → toast "ถูกจ่ายไปแล้วจากเครื่องอื่น" + ลง audit `payroll_pay_race_blocked` + reload — **ไม่ยิง expense/JV/audit-จ่าย ซ้ำ**; เครื่องที่ชนะ flow เดิมทุกอย่าง
- **ชั้น 2 (DB — ⚠️ owner ต้องรัน `supabase-phase433-payroll-pay-guard.sql` เอง):** trigger `trg_guard_payroll_double_pay` ล็อก `paid_at` เมื่อถูกตั้งแล้ว — บล็อกทั้งจ่ายทับและ**การล้างวันจ่ายโดย edit จาก state เก่า** (ช่องที่เจอเพิ่มตอนรีวิว); edit ปกติที่ส่งค่าเดิมกลับมา = ผ่าน (flow ปัจจุบันไม่สะดุด); additive ไม่แตะ RLS
- +guard `tests/payroll_pay_race_guard.test.js` (6 tests: CAS filter/Prefer · ผู้แพ้ return ก่อน side-effects · audit race · winner ยิง expense+JV อย่างละครั้ง · pre-check เดิมคงอยู่ · SQL trigger ครบ+re-run safe+ไม่แตะ RLS) · bump 433 + dashboard_readonly_guard → 433
- **+fix พ่วง (Phase 416 SQL ค้าง — เจอตอน smoke 433):** `supabase-phase416-payroll-period.sql` เดาชื่อ constraint ผิด (`uq_staff_payroll` แต่ของจริง `uq_staff_payroll_emp_month`) → DROP เงียบ ไม่เคย apply → สร้าง 2 รอบ/เดือนไม่ได้ (รอบ 25 มิ.ย. จะพัง). แก้ไฟล์ให้ drop ครบทุกชื่อ/ชนิด (self-healing) + owner รัน fix ใน DB แล้ว — พิสูจน์ live: รอบ 2 รอบ/เดือนสร้างได้ + ยังกันรอบเดิมซ้ำด้วย `uq_staff_payroll_period`
- lint:errors 0 / unit **1589** / e2e **14** · ✅ **merged = build 433 live** `a30c7a3` (owner รัน SQL 433 + smoke Claude บน preview ผ่านครบ: จ่าย→expense 1 ใบ · แท็บ 2 โดน CAS กัน · trigger บล็อก PATCH ตรง 400 · edit แถวจ่ายแล้วผ่าน · verified HTML จริง data-app-build=433)

---

## 5.66.0 (build 432) — 2026-06-13 ทีมขนาน: ตัดบิลยกเลิกออกจากยอดเงินทุกหน้า + VAT effective-date guard

- **fix (FINANCIAL · งานทีมขนาน — UI session ส่งแทนตามอนุญาตเฉพาะเคสของ owner):** session ทีมขนานทำเสร็จ+เทสผ่านแต่ commit/push ไม่ได้ (credit หมดตอนติด `.git/index.lock`) → owner วิเคราะห์และอนุญาตเป็นเคสเฉพาะกิจ ("ยืนยัน push งาน 432 แทนเขาได้") → UI session commit งานเขาทั้งก้อนแยกเป็น commit เดียว `6998cae` ระบุที่มา + **รันเทสยืนยันเองก่อนส่ง** (lint 0 / unit 1583/1583 / e2e 14/14 — ตรงรายงานเขา)
- เนื้องาน: บิล `status=cancelled` ไม่ถูกนับในยอดเงิน/รายงานทุกจุด (utils getCustomerTier+visibleSalesForRole, กระทบยอดเงินสด, ลูกหนี้, รายจ่าย, กำไรต่อสินค้า, dashboard, หน้าร้านลูกค้า, POS) + VAT ต้องเปิดใช้เอง**และ**ถึง `vatEffectiveDate` ก่อนถึงจะทำงาน (settings/payment, pos) + guard ใหม่ 2 ไฟล์ (`financial_cancelled_guard`, `vat_effective_date_guard`) + bump 432 ครบ
- CI Tests+Deploy success · ✅ **build 432 live** (verified HTML จริง)

---

## 5.66.0 (build 431) — 2026-06-13 Phase 431 เปลี่ยน skin ม่วง → สีฟ้า (owner: ม่วงแสบตา)

- **feat (UI · display-only):** สี indigo ทั้งระบบกลับเป็น **สีฟ้า sky เดิม** ตาม owner — tokens `--primary/--primary2` (light: `#0ea5e9/#0284c7` · dark: `#38bdf8/#0ea5e9`), `--bg` เป็นเทาอมฟ้า `#e8eef7` (คงความเข้มจาก 424 แต่เลิกอมม่วง), wash พื้นหลังเป็นฟ้า→ฟ้าอ่อน, hero/การ์ด/tile/ปุ่มลัด/donut/กราฟ/focus ring/gradient ทุกจุด (style.css + phase4 scale revert + dashboard.js + pos.js + customer_dashboard.js + hrx-hero ของ hr_overview ที่ใช้ indigo เก่า)
- **โครงทุกอย่างคงเดิม** (sidebar ขาว/จัดกลุ่ม, dashboard layout, การ์ดต้องทำวันนี้ ฯลฯ — เปลี่ยนเฉพาะ hue) · **หน้า products ไม่ต้องไล่แล้ว** — 35 จุดเดิมเป็นสีฟ้าอยู่แล้ว = ตรงโทนใหม่พอดี (คิวไล่สีที่เหลือ = ปรับเป็น token เฉย ๆ ไม่เร่ง)
- bump build **431** + guard ปรับด้านล็อกโทนฟ้า (`ui_theme_guard` ห้ามมี indigo ตกค้าง + `dashboard_readonly_guard` → 431)
- lint:errors 0 / unit **1570** / e2e **14** · ✅ **merged = build 431 live** (owner ดู preview แล้วสั่ง "ถ้าเทสผ่าน ก็ merge ได้", 2026-06-13 — ff push `branch:main` ไม่แตะ worktree เพราะทีมขนานกำลังแก้ไฟล์อยู่)

---

## 5.66.0 (build 428–430) — 2026-06-12/13 ทีมขนาน: receipts hardening ×3 (commits ตรงบน main — เพิ่ม entry ย้อนหลัง)

> งานอีก session: `829a990` **build 428 Surface receipt restore failures** — bulk delete ใบเสร็จ: จับผล PATCH ตอนคืนสถานะใบส่งสินค้า → fail ขึ้น toast เตือน (เดิม fail เงียบ = ใบส่งสินค้าค้างสถานะ receipted ทั้งที่ใบเสร็จถูกลบ) + guard test ใหม่ · `967d5da` **build 429 Align receipt filter counts** — ตัวนับ filter หน้าใบเสร็จให้ตรงเงื่อนไขกรองจริง + guard test · `d59e371` **build 430 Exclude cancelled receipts from totals** — ยอดรวมหน้าใบเสร็จไม่นับใบที่ยกเลิก + guard test · ทุกตัว bump build ครบ + CI เขียว · ✅ **build 430 live**

---

## 5.66.0 (build 427) — 2026-06-12 Phase 427 ถอดปุ่มคำแนะนำ (หลอดไฟ) + ไล่สีหน้าร้านลูกค้า

- **feat (UI · display-only):** ถอด **ปุ่มคำแนะนำหลอดไฟ (`#bs-help-fab` help tutor)** ออกทุกหน้า ตาม owner — main.js เลิก import/mount/setHelpContext (โมดูล `help_tutor.js` เก็บไว้แบบ dormant ไม่ลบไฟล์) · **AI ผู้ช่วยงานช่าง (`#bs-ai-fab`) ไม่ถูกแตะ** — ยังโชว์เฉพาะหน้างานช่าง desktop ตาม gating เดิม; AI ขายแอร์เข้าผ่านหน้า "AI ช่วยขายแอร์" ที่แยกเป็นหน้าของตัวเองในกลุ่ม หน้าร้านแอร์ (ติดกับ หน้าหลัก) ตามที่ owner ต้องการ
- **ไล่สีรอบ 2 — customer_dashboard (หน้าหลัก/หน้าร้านลูกค้า) ครบ 38 จุด:** ราคา/ปุ่มสั่งจอง/แท็บ/หัวข้อ/step สถานะ/กล่องจัดส่ง-ชำระเงิน/radio/แนบสลิป sky → indigo — **คงไว้:** การ์ดสินค้าโทนฟ้าอ่อน (ธีมความเย็นของแอร์) + ปุ่ม CTA ส้ม "สอบถามราคา" + ป้ายสถานะ
- bump build **427** + `dashboard_readonly_guard` → 427 · `ui_theme_guard` +1 test (help FAB unwired + gating ช่างคงเดิม + customer_dashboard ไม่มี sky)
- lint:errors 0 / unit **1567** / e2e **14** · ✅ **merged เข้า main แล้ว — อยู่ใน live แล้ว (ปัจจุบัน 430)** (session ขนาน ff ให้ 2026-06-12, owner อนุมัติ "merge ได้") · คิวต่อ: products 35 → hr_overview 16 → payroll 13 → leave 13 → DI 12 → quotations 11 → service_jobs 10

---

## 5.66.0 (build 426) — 2026-06-12 Phase 426 ตัดหมวด "ลัด" + ไล่เก็บสีรอบแรก (global + POS)

- **feat (UI · markup+CSS display-only):** ถอดหมวด "ลัด" 5 ปุ่มออกจาก sidebar ตาม owner ("เยอะเกิน ดูรก") — bindings `quick*` ใน main.js เป็น null-safe อยู่แล้ว ไม่ต้องแก้ JS
- **ไล่เก็บสี sky → indigo (เฉพาะ skin):** style.css — โลโก้/แบรนด์หน้า login, `.pos-banner`, ปุ่มกด active ใน POS (numpad/วิธีจ่าย/ไอคอน), `.set-save-btn` หน้า settings, focus ring ×2, ราคาใน global search, `.bsk-tag.active`, hover ของ dash-period/dash-clickable/profile-menu · pos.js — กล่องยอดรับชำระ (gradient), ตัวเลือกธนาคารโอน, ข้อความ VAT/COA/โน้ตลูกค้า, hover รายชื่อลูกค้า
- **คงไว้โดยเจตนา (ไม่ใช่ skin):** กล่อง info ฟ้า, ป้ายสถานะ, สีประจำชนิดเอกสารบนใบพิมพ์ (`.doc-*.inv` น้ำเงิน = อัตลักษณ์ใบแจ้งหนี้) — guard ล็อกไว้กันกวาดพลาดในอนาคต
- bump build **426** (data-app-build + ?v= ×4 + sw cache-v426) + `dashboard_readonly_guard` → 426 · `ui_theme_guard` +1 test (ปุ่มลัดหาย + skin ไม่มี sky + doc colors คงเดิม)
- lint:errors 0 / unit **1563** / e2e **14** · ✅ **merged เข้า main แล้ว — อยู่ใน live แล้ว (ปัจจุบัน 430)** · คิวไล่สีหน้าถัดไป: customer_dashboard (38 จุด), products (35), hr_overview/payroll/leave (16/13/13), delivery_invoices/quotations (12/11)

---

## 5.66.0 (build 425) — 2026-06-12 Phase 425 sidebar reorganization — ยุบเมนูเดี่ยวเข้ากลุ่ม + หัวข้อหมวด

- **feat (UI nav · markup-only ใน index.html — ทุก `data-route` คงเดิม ไม่แตะ logic):** จัดระเบียบเมนูข้างตาม owner ขอ — เมนูเดี่ยวที่ลอย 16 ปุ่มยุบเข้ากลุ่ม: **งานขาย** +Template ใบเสนอราคา/Serial Warranty/รายงาน Warranty · **งานช่าง** +แจ้งซ่อมบริการ · **สินค้า/คลัง** +ประวัติสต็อก/รับเข้า/นับจริง/มูลค่า/ค้างนาน · กลุ่มใหม่ **ลูกค้า/สมาชิก** (ลูกค้า+วันเกิด+สะสมแต้ม) · **หน้าร้านแอร์** (หน้าหลัก+AI ขายแอร์+แอร์ใหม่) · **เครื่องมือ** (BTU+Error Code ×3)
- เรียงลำดับใหม่ + หัวข้อหมวด 4 หัวข้อ: งานประจำวัน (ภาพรวม/ศูนย์ทีม AI/แคชเชียร์/Task/ปฏิทิน) → งานหลัก → การเงิน/รายงาน (การเงิน·บัญชี·ภาพรวม·HR) → หน้าร้านแอร์/เครื่องมือ → ตั้งค่า
- กลไกเดิมรองรับอัตโนมัติ: toggle กลุ่ม + role-filter ใน main.js เป็น generic; **กลุ่ม HR คง byte เดิมทุกตัว** (hr_forms_guard เขียว)
- bump build **425** (data-app-build + ?v= ×4 + sw cache-v425) + `dashboard_readonly_guard` → 425 · `ui_theme_guard` +1 test (กลุ่มใหม่ ×3 + ปุ่มย้าย 19 route เป็น sub + ปุ่มหลักคงลอย + ไม่มี route หาย/ซ้ำ)
- lint:errors 0 / unit **1562** / e2e **14** · ✅ **merged ff `01f3c09` = build 425 live** (owner ดู preview + สั่ง merge, 2026-06-12)

---

## 5.66.0 (build 424) — 2026-06-12 Phase 424 workspace wash — พื้นหลังเข้มขึ้น + wash ม่วง→ชมพู (CSS-only)

- **fix (UI · CSS-only):** owner feedback "พื้นหลังสว่างเกิน" — `--bg` ลึกขึ้น `#f5f5fb → #eaedf8` (indigo tint ชัดขึ้น การ์ด/sidebar ขาวเด้งจากพื้น) + **body wash gradient ม่วงอ่อน→ชมพูอ่อน** (`linear-gradient(160deg, #e8ebf8 → #eee9f6 → #f5ecf1)`) ตามบรรยากาศภาพต้นแบบ; dark theme คงพื้นเรียบ token เดิม (override `[data-theme="dark"] body`)
- bump build **424** (data-app-build + ?v= ×4 + sw cache-v424) + `dashboard_readonly_guard` → 424 · `ui_theme_guard`: ปรับ assertion `--bg` + เพิ่ม test PHASE 424 (wash มีจริง + dark เรียบ)
- lint:errors 0 / unit **1561** / e2e **14** · ✅ **merged ff `01f3c09` = live** (stamp ย้อนหลัง — ตกจากรอบ 425)

---

## 5.66.0 (build 423) — 2026-06-12 Phase 423 mock-F finishing pass — การ์ดต้องทำวันนี้ + โดนัทช่องทาง + stat tiles

- **feat (UI dashboard · display-only — dashboard.js คง read-only):** เก็บงานตามแบบ F ให้ครบ: (1) **รวมการ์ด "วันนี้" + "ที่ต้องดู" เป็น "📌 ต้องทำวันนี้" ใบเดียว** — แถวละเรื่อง (งานช่างวันนี้/งานเลท/ของใกล้หมด/ใบเสนอราคาใกล้หมดอายุ/หนี้เกินกำหนด/รายจ่ายประจำ) ไอคอนสี่เหลี่ยมสี + ตัวนับ + กดไปหน้านั้น (binding เดิม) — เงื่อนไข/ตัวนับเดิมทุกตัว; คำเตือนของใกล้หมดย้ายจาก hero chip มาอยู่การ์ดนี้ (hero สะอาดขึ้น)
- (2) **โดนัท "ยอดขายแยกตามช่องทาง (เดือนนี้)"** — SVG ล้วน รวมยอดจาก payment_method ของบิลเดือนนี้ใน state (role-filtered, ข้าม [ลบแล้ว]) top 4 + อื่น ๆ พร้อม **caption ซื่อตรง "จากบิลที่โหลดล่าสุด (~50) — ไม่ใช่ทั้งระบบ"** (บทเรียน Phase 396) — ไม่มีสูตรเงินใหม่ แค่รวมเพื่อแสดง
- (3) **stat tiles 9 ใบมีไอคอนวงกลมสี pastel** (`_kpiCard` รับ `icon/iconBg/iconFg` — เส้นทาง `data-go` เดิมล็อกด้วย guard) + (4) แถวปุ่มลัดวงกลมจัดกระชับกึ่งกลาง (จอกว้างไม่กระจาย)
- bump build **423** (data-app-build + ?v= ×4 + sw cache-v423) + `dashboard_readonly_guard` → 423 · `ui_theme_guard` +1 test (PHASE 423 css + การ์ดรวม + caption ซื่อตรง + routes ครบ)
- lint:errors 0 / unit **1560** / e2e **14** · ✅ **merged ff `f9bfcc0` = build 423 live** (owner ดู preview + สั่ง merge, 2026-06-12)

---

## 5.66.0 (build 422) — 2026-06-12 Phase 422 mock-F dashboard layout — ปุ่มลัดวงกลม + hero indigo

- **feat (UI dashboard · display-only — dashboard.js ยังคง read-only ตาม guard):** หน้า "ภาพรวมบริษัท" ปรับตาม mockup แบบ F ต่อจาก 421 — **แถวปุ่มลัดวงกลม 6 ปุ่ม** (ขายสินค้า/เปิดใบงาน/ใบเสนอราคา/ลูกค้า/เช็คสต็อก/รายงาน) บนสุดใต้ header, นำทางผ่าน `dash-clickable[data-go]` binding เดิม (ไม่มี handler/fetch ใหม่) + **hero ยอดขายวันนี้พื้น indigo อ่อน** (`.dash-today--brand` + dark variant)
- สี display ใน dashboard เปลี่ยน sky → indigo ครบ: KPI accent/sparkline, การ์ด "วันนี้", pro-chart titles/dots, `BLUE_PALETTE` โดนัท, กราฟ Chart.js (เก็บเงินแล้ว bar + เส้นรายได้), แถวธุรกรรมล่าสุด — ตัวเลข/สูตรเงินเดิมทุกตัว ไม่แตะ
- bump build **422** (data-app-build + ?v= ×4 + sw cache-v422; phase4-*.css คง 421 — cadence อิสระตาม e2e spec) + `dashboard_readonly_guard` → 422
- guard: `ui_theme_guard` +1 test (PHASE 422 css + QUICK_ACTIONS routes ครบ 6 + ปุ่มใช้ binding เดิม + hero modifier) · `dashboard_ui_guard` ปรับ regex hero รับ modifier (intent เดิม: ไม่มี gradient hero)
- lint:errors 0 / unit **1559** / e2e **14** · **⏸️ STOP รอ owner smoke preview** (branch เดิม `claude/phase-421-ui-skin-tokens-sidebar`)

---

## 5.66.0 (build 421) — 2026-06-12 Phase 421 ui-skin-refresh — โทนใหม่ indigo + sidebar ขาว (CSS-only)

- **feat (UI · CSS-only — ไม่แตะ JS/markup/เงิน/สต็อก/บัญชี/SQL):** เปลี่ยน skin ทั้งแอปตามทิศทาง mockup "แบบ F" ที่ owner เลือก — พื้น workspace `#f5f5fb` (lavender อ่อน), primary จาก sky → **indigo `#5b5bd6`** (ทั้ง light+dark), **sidebar จากเข้ม gradient → ขาว (surface)** + ปุ่ม active = indigo ทึบตัวหนังสือขาว — ทำเป็น block "PHASE 421" ท้าย `style.css` ชนะ cascade เหนือ Phase 386 (pattern เดิม รีวิว/ revert ง่าย)
- `phase4-design-system.css`: สเกล `--primary-50..900` sky → indigo + focus ring ใน `phase4-components.css` → indigo (ปุ่ม/ฟอร์มชุด phase4 เปลี่ยนตามอัตโนมัติ ไม่แตะ selector)
- bump build **421** ครบชุด: `data-app-build` + `?v=421` (style/selfheal/main/boot **+ phase4-design-system/phase4-components** จาก v=1/v=2) + sw `cache-v421` + `dashboard_readonly_guard` → 421
- +guard ใหม่ `tests/ui_theme_guard.test.js` (4 tests: tokens light/dark ไม่มี sky ตกค้าง · block PHASE 421 restyle sidebar/active pill ผ่าน token · phase4 scale sync — กัน phase หลัง revert เงียบ)
- lint:errors **0** / unit **1558** / e2e **14** · **⏸️ STOP รอ owner review + smoke preview ก่อน merge** (branch `claude/phase-421-ui-skin-tokens-sidebar`) · dashboard layout ตามแบบ F (ปุ่มลัดวงกลม + การ์ดต้องทำวันนี้) = **Phase 422** ถัดไป

---

## 5.66.0 (build 420) — 2026-06-12 Phase 420 hr-forms — รับสมัครงาน + ใบลาออก (admin-only)

> เลข **build 419 ถูกใช้ไปแล้ว**โดยงาน mobile drafts + service cancel fix (commits `0117013`/`9b651af`/`369ab2f`/`1cf2b66`/`e3930bf` ตรงบน main — ไม่มี entry ใน CHANGELOG) → งานนี้จึงเป็น **420**

- **feat (HR · additive — ไม่แตะเงิน/สต็อก/บัญชี/POS/payroll):** โมดูลใหม่ `modules/hr_forms.js` + 2 หน้าใหม่กลุ่ม บุคลากร/HR (admin-only ผ่าน ALL_ROUTES + `requireAdmin`)
- **📝 รับสมัครงาน (`hr_applications`):** list + filter chips สถานะ (ใหม่/นัดสัมภาษณ์/รับแล้ว/ไม่รับ) + search ชื่อ/เบอร์/ตำแหน่ง · ฟอร์มเพิ่ม/แก้ (full_name*, phone, address, position, expected_salary, experience, applied_date default วันนี้ Bangkok, note) · **แนบรูปเอกสารหลายรูป** (บัตร ปชช./เรซูเม่) upload → storage bucket `proofs` path `applications/` (pattern expenses.js) เก็บ `attachments` jsonb `[{url,label}]` + thumbnail กดดูเต็ม · เปลี่ยนสถานะ — **hired → ติด `hired_date` วันนี้ + กล่องเตือน "อย่าลืมสร้างบัญชีผู้ใช้ที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน" (❌ ไม่ auto-สร้าง user)** · พิมพ์ 2 แบบ: ฟอร์มเปล่ากรอกมือ (ช่องครบ+ที่ติดรูป+ลายเซ็น) / ใบสมัครพร้อมข้อมูล (A4, `window.open` pattern `_printAllPayslips`)
- **📤 ใบลาออก (`hr_resignations`):** ฟอร์ม employee_id (จาก profiles role≠customer — GET read-only เท่านั้น), submitted_date default วันนี้, last_working_date, reason, note · ปุ่ม **อนุมัติ** = `App.confirm` → PATCH `staff_resignations` (status=approved + approved_at/by) → **banner ค้างเตือน "พนักงานยังอยู่ในรายชื่อ active — ไปปิดสถานะที่ ตั้งค่า → ผู้ใช้งาน เมื่อถึงวันสุดท้าย (วันที่)" — ❌ ไม่มี PATCH `profiles` เด็ดขาด (ไม่ตัดพนักงานอัตโนมัติ)** · พิมพ์หนังสือลาออกทางการ (หัวร้านจาก storeInfo + ลายเซ็นพนักงาน/ผู้อนุมัติ)
- ทั้งคู่: `logActivity` ทุก action สำคัญ (create/update/status/approve/delete) · ลบ = `App.confirm` ระบุชื่อ · **ไม่มี `alert()`/native confirm** · print builders **escHtml ทุกค่าผู้ใช้** (XSS §4.5) · inflight guards (save ×2 + upload)
- **SQL ใหม่ `supabase-phase420-hr-forms.sql`** (⚠️ **owner รันเองใน Supabase SQL Editor ก่อน smoke** — ยังไม่ได้ apply): `staff_applications` + `staff_resignations` + CHECK status + indexes + updated_at trigger + **RLS admin-only (`is_accountant()`) ทั้ง 2 ตาราง** (pattern phase92-32) + NOTIFY pgrst + verify queries · ❌ ไม่มี trigger/ALTER แตะ profiles
- wiring: `main.js` LAZY_ROUTES + ALL_ROUTES (admin-only) + titles · `index.html` nav ×2 ใต้ 💰 รายการเงินเดือน + section ×2 · bump build **420** (data-app-build + ?v= ×4 + sw `cache-v420`)
- +guard `tests/hr_forms_guard.test.js` (21: SQL/RLS/no-profiles-write/upload-proofs/approve-confirm/hired-warning/logActivity/print-XSS-unit/pure-helpers/wiring) · `dashboard_readonly_guard` bump 420
- 🔁 **งานกู้จาก worktree ที่ตายกลางทาง** (เดิมทำเป็น Phase 419 ~80%): กู้ 3 ไฟล์ใหม่มา rename/แก้ markers 419→420 + ทำ wiring ใหม่บนฐาน `e3930bf` แล้ว rebase ขึ้น `f4ab6a1` = origin/main ล่าสุด (ไม่ apply patch เก่าตรง ๆ)
- lint:errors 0 / unit **1529** (รวม 21 ใหม่ของ hr_forms_guard) / e2e **14** (รวม service-mobile-draft ของทีม 419) · **STOP รอ review + owner รัน SQL + smoke preview**

---

## 5.66.0 (build 418) — 2026-06-11 Phase 418 Part C payroll-history-and-print-all — ประวัติรายคน + พิมพ์สลิปทุกคน

- **feat (payroll · MEDIUM — read-only + print เท่านั้น ไม่แตะ save/pay/JV):** ปุ่ม **"📜 ประวัติ"** ต่อแถว → modal ประวัติเงินเดือนรายคน: GET ครั้งเดียวตอนเปิด `staff_payroll?employee_id=eq.&order=period_start.desc.nullslast,period_month.desc.nullslast&limit=24` — คอลัมน์ รอบ / รวมสุทธิ (`total_amount` จาก DB) / สถานะ (จ่ายแล้ว+วันที่ / รอจ่าย) / ปุ่ม "สลิป" + แถวสรุปท้าย "รวมจ่ายแล้ว (จาก N รอบที่แสดง)"
- แถวเก่าก่อน 416 ไม่มี `period_start/end` → เรียงท้าย (nullslast) + label fallback ชื่อเดือนจาก `period_month` · ปุ่มสลิปประวัติส่ง row ตรงให้ `_printPayslip` (param ใหม่ `rowOverride`) — **สลิปเก่าออกได้แม้รอบบนหน้าเปลี่ยน**
- **ปุ่ม "🖨️ พิมพ์สลิปทุกคน"** ข้าง Excel (แสดงเฉพาะเมื่อมีรายการในรอบ): รวมสลิปทุกแถวของรอบเป็น HTML เดียว สลิปละ 2 หน้า (ต้นฉบับ/สำเนา) คั่น `page-break-after: always` + wrapper `slip-paid`/`slip-pending` override สีส่วนสถานะจ่ายต่อสลิป → เปิดหน้าต่างพิมพ์ (pattern เดียวกับพิมพ์ HR report)
- ⭐ extract `buildPayslipStyleCss` + `buildPayslipHtml` จาก `_printPayslip` แบบ **byte-preserving** (ย้าย template ด้วย slice ไม่พิมพ์ใหม่ + พิสูจน์ output byte-identical 5 เคส: unpaid/paid+note/daily-rate/legacy/XSS) — layout/ข้อความสลิปเดิมทุกตัวอักษร
- ❌ ไม่มี POST/PATCH/DELETE ใหม่ · ❌ ไม่แตะ `_savePayroll`/`_bulkGeneratePayroll`/`_markPaid`/JV/expense · `computePayrollTotal`/`computePayPeriods`/`buildPeriodAttendanceMap` · ตาราง/การ์ด 417 · hr_overview/time_clock/leave_management · SQL/DB
- +guard `payroll_partc_guard` (12: unit builders 4 + source-regex 8) · guard 416 (12) + 417 (13) เขียวครบ · lint 0 / unit 1493 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 417) — 2026-06-11 Phase 417 Part B payroll-period-full-screen — bulk draft + คอลัมน์เวลาเข้างาน + timesheet

- **feat (payroll · MEDIUM-HIGH — Part B ไม่แตะ pay/JV flow: สร้างร่าง + แสดงผลเท่านั้น):** ปุ่ม **"⚡ สร้างเงินเดือนทั้งรอบ"** — เตรียม "ร่าง" (สถานะรอจ่าย) ให้พนักงานทุกคนจากเวลาเข้างานจริง: App.confirm "สร้างร่าง...ให้ N คน (ข้าม M คนที่มีรายการแล้ว)?" → insert ทีละคนเฉพาะคนที่ยังไม่มีรายการรอบนี้ · inflight guard `_prBulkInflight` กันกดซ้ำ · toast สรุปสำเร็จ/fail + audit log
- payload bulk: daily ที่มี rate + วันทำงานจริง → `base = round2(rate × days)`; อย่างอื่น base 0 + days_worked null ให้ owner กรอกเอง · details schema 1 + attendance `{days_worked, ot_hours_autofill, late_count, leave_days}` · **❌ ไม่มี total_amount** (DB GENERATED — 428C9) · ❌ ไม่มีการจ่าย/mark paid/JV/expense
- **batch aggregation ต่อรอบ** (ไม่ยิง query ต่อคน): fetch staff_attendance + staff_leaves (approved) ทั้งรอบครั้งเดียว → pure `buildPeriodAttendanceMap` (days=distinct clock_in · OT=sumRegularOT closed · สาย=classifyPunctuality · ลา=clip ขอบรอบ)
- **คอลัมน์ใหม่ต่อแถว** วัน | OT ชม. | สาย | ลา (advisory; โหลด fail → "—") ก่อนคอลัมน์เงินเดิม + ตารางใช้ `.table-wrap` (mobile scroll) · **การ์ดสรุปเพิ่ม 2 ใบ**: OT รวม (ชม.) + มาสายรวม (ครั้ง)
- **กดชื่อพนักงาน** → timesheet modal รายวันของรอบ (read-only; reuse `buildEmployeeTimesheet` จาก hr_overview + rows ที่ batch แล้ว — ไม่ fetch ซ้ำ)
- ❌ ไม่แตะ `_markPaid`/`postJournalForPayroll`/`_createSalaryExpense` · `computePayrollTotal` · `computePayPeriods` (416) · สลิป PDF · `_savePayroll` modal · hr_overview.js/time_clock.js/leave_management.js (import only) · SQL/DB
- +guard `payroll_partb_guard` (13: unit map 7 + source-regex 6) · lint 0 / unit 1481 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 416) — 2026-06-11 Phase 416 Part A payroll-custom-pay-period — เงินเดือนรอบตัดที่ร้านกำหนด (10/25)

- **feat (payroll · HIGH):** เปลี่ยนรอบเงินเดือนจาก "เดือนปฏิทิน" → **รอบตัดที่ร้านกำหนด** (default ตัด 10/25 → รอบ 11–25 และ 26–10 ของเดือนถัดไป): pure `computePayPeriods` (string math — คร่อมเดือน/ปี/ก.พ. clamp ไม่มี invalid date) + แถบปุ่ม 3 รอบล่าสุด + "กำหนดเอง" (date from/to) แทน month select
- save payload เพิ่ม `period_start`/`period_end` + `details` jsonb snapshot (schema 1: rates/attendance/additions/deductions — อนาคต push ประกันสังคมเข้า deductions ได้โดยไม่แก้ DB) · `period_month` คงเขียนต่อ (= เดือนของวันสิ้นรอบ; สลิป slipNo/JV/expense เดิมอ่านต่อได้)
- โหลดรายการ filter รอบตรงตัว `period_start=eq.&period_end=eq.` · ยังไม่รัน SQL → error ชี้ "รัน supabase-phase416-payroll-period.sql" · OT autofill ดึงตามช่วงรอบจริง · unique error ใหม่ "พนักงานนี้มีรายการรอบนี้แล้ว"
- settings ข้อมูลร้านค้า: ช่อง "วันตัดรอบที่ 1/2" (`payrollCutoff1/2`, จำนวนเต็ม 1–28 clamp, default 10/25)
- **SQL ใหม่ (owner ต้องรันก่อน smoke):** `supabase-phase416-payroll-period.sql` — additive (3 คอลัมน์ + drop uq เดิม + unique ใหม่ per-รอบ; ตาราง 0 แถว ไม่ backfill)
- ❌ ไม่แตะ `computePayrollTotal` สูตร · mark paid/JV/expense side-effects · สลิป layout (แค่ข้อความ period label) · time_clock.js/leave_management.js
- +guard `payroll_period_guard` (12) · lint 0 / unit 1468 / e2e 12 · **STOP รอ review + owner รัน SQL + smoke preview**

---

## 5.66.0 (build 415) — 2026-06-10 Phase 415 ob-form-dynamic-bank-fields — ฟอร์มยอดยกมา ช่องธนาคาร dynamic จาก COA

- **feat (accounting §4.3):** ฟอร์ม "ลงยอดยกมา" ดึงช่องเงินฝากธนาคารจาก chart_of_accounts จริง (เดิม hardcode 1130/1140 — กรอกแยก 6 บัญชีใหม่ 1131–1136 ไม่ได้): `fetchBankAssetAccounts()` → type=asset · code 1130–**1169** (4 หลัก) · is_active · เฉพาะ leaf (header ที่มีลูกชี้มาไม่เอา) · เรียง sort_order
- **415-fix:** ขอบบนช่วงเดิม 1199 ดูด **1170 ภาษีซื้อ (Input VAT)** เข้ากลุ่มธนาคาร (COA จริงได้ 9 ช่องแทน 8) → เปลี่ยนเป็น ≤1169 + guard case 1170 ต้องไม่ติด
- render เป็น async: loading → ASSET = เงินสด(1110/1120) + ธนาคาร dynamic + ลูกหนี้/สินค้า(1200/1300) ใน `_assetFields` — Dr=Cr live calc + submit + reset loop จาก list ที่ render จริง
- fetch COA ล้ม/ว่าง → fallback ช่องพื้นฐาน 1130/1140 + แถบเตือน "โหลดผังบัญชีไม่สำเร็จ" (ไม่ crash/ฟอร์มไม่ว่าง)
- ❌ ไม่แตะ EQUITY/LIABILITY fields + App.confirm (414) · save semantics · effective_date.js · COA data/SQL
- guard `opening_balance_guard` 6→12 (behavioral fetch 3 + fallback/no-hardcode/regression 3) · lint 0 / unit 1455 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 414) — 2026-06-10 Phase 414 ob-form-coa-labels-and-confirm — ฟอร์มยอดยกมา label ตรง COA + App.confirm

- **fix (accounting §4.3):** ฟอร์ม "ลงยอดยกมา" label ตรง chart_of_accounts จริง — EQUITY: 3100 "ทุนจดทะเบียน"→**"ทุนเจ้าของ"** · 3200 "ทุนของเจ้าของ"→**"กำไรสะสม"** (เดิมพา owner ลงทุนเข้า "กำไรสะสม"; OB placeholder 10 มิ.ย. เข้าผิดมาแล้ว — ไม่ data-fix เพราะหลุดจาก cutoff 413) · LIABILITY: 2100→"หนี้สินหมุนเวียน" · 2120→"เจ้าหนี้อื่น" · 2200→"หนี้สินไม่หมุนเวียน" (label-only, code คงเดิมตาม scope) · ASSET 6 ช่องตรงอยู่แล้ว
- เลิก native confirm 2 จุด (reset/submit) → `await window.App?.confirm?.(...)` modal กลาง ข้อความเดิม · App.confirm ไม่มี (boot ผิดลำดับ) → **ไม่บันทึก** + toast เตือน (ห้าม fallback native)
- ⚠️ known: 2100/2200 เป็น **header account** (เจ้าหนี้การค้าจริง=2110, เงินกู้จริง=2160/2210) — ย้ายช่องไป leaf code = owner decision phase หน้า
- ❌ ไม่แตะ save semantics (doc_no OB/POST entry+lines/idempotency) · effective_date import (413) · confirmAsync ใน main.js · COA SQL/data · OB JV เดิมใน DB
- +guard `opening_balance_guard` (6) · lint 0 / unit 1449 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 413) — 2026-06-10 Phase 413 accounting-effective-date-to-jul1 — เริ่มบัญชีจริง 1 ก.ค. 2569 (cutoff)

- **chore (accounting §4.3):** เลื่อนวันเริ่มบัญชี `ACCOUNTING_EFFECTIVE_DATE` **2026-05-01 → 2026-07-01** — ข้อมูลก่อน 1 ก.ค. (บิลทดสอบ + OB placeholder 1 พ.ค.) หลุดจากรายงาน/auto_post อัตโนมัติ **ไม่ถูกลบ** (owner ยืนยัน cutoff อย่างเดียว; จะลง OB จริง 1 ก.ค.)
- ⭐ refactor: single source of truth ที่ `modules/accounting/effective_date.js` — 6 ไฟล์ (auto_post/balance_sheet/export_bundle/opening_balance/backfill/service_reconcile) import แทน const ท้องถิ่น · เปลี่ยนวันครั้งหน้า = แก้ที่เดียว
- Invariant: `_isAfterEffective("2026-06-30")=false` · `("2026-07-01")=true` · UI text backfill ใช้ interpolation
- ❌ ไม่แตะข้อมูล/SQL · double-entry/mapping/VAT/period-lock · OB form · POS/stock · tests HR/ลา/export (คนละฟีเจอร์ — เขียวพิสูจน์)
- tests date-sensitive 6 ไฟล์เลื่อนเป็น ก.ค. + fallback-today เปลี่ยนเป็น time-independent · +guard `effective_date_guard` (9) · lint 0 / unit 1443 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 412) — 2026-06-10 Phase 412 convert-doc-inflight-guard — กัน convert ซ้ำระหว่างกำลังสร้าง + write มีเสียง

- **fix (sales §4.1-4.2):** inflight guard ระดับฟังก์ชันที่ `convertToDeliveryInvoice` + `convertToReceipt` — Phase 409 กันได้เฉพาะใบที่ commit แล้ว; trigger ซ้ำระหว่างใบแรกกำลังสร้าง = ใบซ้ำทะลุ 1:1 → ตอนนี้ no-op + toast "กำลังสร้าง..." (guard ในฟังก์ชัน = คลุมทุกทางเข้า 5 จุด) + `try/finally` reset (ยกเลิก/fail → ทำใหม่ได้)
- items loop ทั้ง 2: เช็คผล insert → fail = toast "⚠️ สร้าง <เลขใบ> แล้ว แต่บันทึกรายการไม่สำเร็จ N รายการ..." (ห้าม rollback header) · PATCH status 3 จุด: เช็คผล → fail = toast เตือน (status = display, ตัวกัน 1:1 จริง = existence-check)
- ผลพลอยได้: กดรัวก่อนยืนยัน → dialog แรกคงอยู่ ไม่มี zombie await (ไม่แตะ confirmAsync/modal)
- ❌ ไม่แตะ duplicate-check 409 · payload/เลขเอกสาร · call sites · _qtSaveInflight เดิม · POS/stock/บัญชี/SQL · re-indent body รีวิวด้วย `git diff -w`
- +guard `convert_inflight` (11) · lint 0 / unit 1434 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 411) — 2026-06-10 Phase 411 backfill-skip-deleted-sales — Backfill/Integrity ข้ามบิลลบแล้ว (กัน JV รายได้ผี)

- **fix (accounting §4.3):** เอกสาร soft-delete (note มี `[ลบแล้ว]`) ต้องไม่ถูก post JV จากทุก path และไม่นับเป็น "ต้องแก้" — เดิม integrity panel โชว์ "ต้องแก้ 5" จากบิลลบแล้ว (#177-181, JV void แล้ว) และปุ่ม "เริ่ม Backfill" จะสร้าง **JV รายได้ผี** ให้บิลพวกนี้
- `backfill.js _classifyOrphan`: เช็คแรกสุด `[ลบแล้ว]` → `{bucket:"skipped", reason:"deleted"}` · chip แสดง "ข้าม: N (ลบแล้ว: M)" · actionable=0 → banner แดงไม่ขึ้น
- `auto_post.js postJournalForSale` + `postJournalForServiceJob`: early-return guard `[ลบแล้ว]` → `return null` (คง caller contract; service job ลบแต่ status done/closed ก็โดน guard) · checkout ปกติไม่กระทบ
- ❌ ไม่แตะ vw_* views/SQL · _postJournal/voidJvForSource · postJournalForReceipt/Expense/Payroll/CreditPayment · POS/sales.js/stock
- +guard `backfill_deleted` (unit จริง 4 + source-regex 2) · lint 0 / unit 1423 / e2e 12 · **STOP รอ review + owner smoke preview**

---

## 5.66.0 (build 410) — 2026-06-10 Phase 410 fix-revert-stock-cas-idempotent — คืนสต็อกลบบิล POS ผ่าน CAS + กันคืนซ้ำ

- **fix (stock §4.1-4.2):** `_revertStockForSale` (คืนสต็อกตอนลบบิล POS) — ทุก stock write ผ่าน **CAS** `_atomicAddStock` (warehouse_stock + legacy products; เดิม xhrPatch absolute จาก state cache = lost update) + **idempotent**: gate เช็ค marker `[คืนสต็อกแล้ว]` ใน sales.note สดก่อนคืน (เคยคืน → no-op skipped) · แปะ marker หลังคืน (partial ก็แปะ — กัน retry คืนซ้ำ) · GET เช็ค marker ล้ม → **fail-closed** ไม่เดินหน้า
- `sales.js` delete handler: pre-check `[ลบแล้ว]` → block ก่อน confirm + `newNote` append ต่อ note เดิม (ไม่ทับ marker) · CAS fail → ข้าม item (ไม่ log movement/ไม่นับ) · movement log fail = warn ไม่ rollback
- ❌ ไม่แตะ deduct/transfer/_applyStockMovement/stock_cas.js/service_equipment/POS checkout/JV/loyalty/บัญชี · heuristic คลัง "บ้าน" คงเดิม
- +guard `revert_stock_cas` (7) · ปรับ guard เดิม 2 ไฟล์ intent คงเดิม (stock_movement_type window→ทั้งฟังก์ชัน · stock_mirror_canonical assert CAS) · lint 0 / unit 1417 / e2e 12 · **STOP รอ review + owner smoke ผ่าน preview**

---

## 5.66.0 (build 409) — 2026-06-09 Phase 409 document-chain-1to1 — บล็อกออกเอกสารซ้ำทั้งเชน

- **fix (sales):** บังคับ **1:1** ทั้งเชนเอกสาร — quotation ที่มีใบส่งของ active แล้ว → **บล็อก**ออกใบส่งของซ้ำ · ใบส่งของที่มีใบเสร็จ active แล้ว → **บล็อก**ออกใบเสร็จซ้ำ (เดิมแค่ confirm แล้วกดยืนยันผ่านได้ = เอกสารซ้ำเละ) · ใบ `cancelled` ไม่บล็อก (ออกใหม่ได้)
- `quotations.js convertToDeliveryInvoice` + `delivery_invoices.js convertToReceipt` branch `active.length>0`: confirm-to-proceed → `showToast` + `return`
- ❌ ไม่แตะ branch else (ออกปกติ) · duplicate-check query/filter/catch · cash-basis 408 · cancel/delete · เงิน/สต็อก/บัญชี · ไม่ alert()
- +guard `doc_chain_1to1` (source-regex 2 ฟังก์ชัน) · lint 0 / unit 1410 / e2e 12 · **STOP รอ review**

---

## 5.66.0 (build 408) — 2026-06-09 Phase 408 cash-basis-revenue-core — รับรู้รายได้ที่ใบเสร็จ paid

- **feat (accounting §4.3):** เปลี่ยนการรับรู้รายได้สายเครดิต (ใบเสนอราคา→ใบส่งของ→ใบเสร็จ) จาก **accrual → cash-basis** — รายได้เกิดเมื่อใบเสร็จ `status="paid"` (Dr เงินสด/ธนาคาร / Cr รายได้ 4150) **เลิก**ลง revenue ตอนออกใบส่งของ
- `quotations.js` ปิด `postJournalForDeliveryInvoice` ตอนสร้างใบส่งของ · `auto_post.js` `postJournalForDeliveryInvoice` → guard `return null` (คงฟังก์ชัน) · `postJournalForReceipt` → mapping `receipt_revenue_cash`(Dr1110)/`receipt_revenue_transfer`(Dr1130) Cr 4150 + VAT split (vat>0 → 3 บรรทัด ผ่าน `splitSaleVatLines`) · `backfill.js` delivery_invoices → skip
- ⚠️ owner ต้องรัน `supabase-phase408-cashbasis.sql` (insert 2 mapping keys) **+ Phase B migration ก่อน smoke** (กัน revenue หาย/double-count)
- ❌ ไม่แตะ `receipt_payment`/`receipt_transfer` mapping เดิม (credit_payment ใช้ร่วม) · POS/service/credit_payment · receipt partial/pending (=A2) · migration (=B) · hasReceipt/delete (407)
- +guard `cashbasis_revenue_guard` (behavioral 7 ข้อ) · lint 0 / unit 1406 / e2e 12 · **STOP รอ review + owner SQL/Phase B**

---

## 5.66.0 (build 407) — 2026-06-09 Phase 407 delivery-invoice-delete-receipt-precheck — กัน 409 + บิลพัง

- **fix (sales):** ลบใบส่งสินค้าที่มี **ใบเสร็จ** (receipts.delivery_invoice_id FK) อ้างอิง เดิมลบ items ก่อน แล้วลบหัวบิลเจอ **HTTP 409** → items หายแต่หัวบิลค้าง = **บิลพัง** (0 รายการ แต่มียอด)
- เพิ่ม `_invoiceHasReceipt()` live pre-check (ทุกสถานะ — FK บล็อกแม้ใบเสร็จ cancelled) **ก่อน** ลบอะไร: single delete → บล็อก + บอกชัด "ลบใบเสร็จก่อน" · bulk → ข้ามใบที่มีใบเสร็จ (นับ fail + toast สื่อ)
- query ล้ม → ไม่บล็อก (ไม่ false-positive) · **no-receipt → behavior เดิมเป๊ะ**
- ❌ ไม่แตะ logic ลบจริง/restore quotation · cancel paths · date-edit lock · convertToReceipt/receipts.js/เงิน/สต็อก/บัญชี · +guard `di_delete_receipt_precheck_guard.test.js`
- known: atomic-delete refactor + restore-quotation-on-cancel = follow-up

## 5.66.0 (build 406) — 2026-06-09 Phase 406 auth-recovery-graceful (low risk · error-path only) — กู้ error หน้าตั้งรหัสผ่าน

- **fix (auth):** หน้า "ตั้งรหัสผ่านใหม่" (เพิ่มสมาชิก/recovery) กดบันทึกแล้ว session หมดอายุ → เด้ง raw **"Auth session missing!"** ค้าง → แก้ให้กู้ได้: ข้อความชัด "ลิงก์หมดอายุ/ถูกใช้ไปแล้ว" + ปุ่ม **"← ขอลิงก์ใหม่"** พากลับหน้า login
- `submitNewPassword` catch แยก session-dead (`AuthSessionMissingError`/401/regex) → โชว์ปุ่ม; error อื่นคงข้อความเดิม · +`requestNewRecoveryLink()` (สลับกลับ authScreen + reset `_recoveryMode`)
- **error path เท่านั้น:** ❌ ไม่แตะ initSupabase/onAuthStateChange/getSession (Fix B = follow-up) · login/signInWithPassword · happy-path/boot · เงิน/สต็อก/บัญชี · ไม่ alert() · +guard `auth_recovery_graceful_guard.test.js`

## 5.66.0 (build 405) — 2026-06-08 Phase 405 receipt-acct-badge-refresh (cosmetic · display-only) — ป้าย "ลงบัญชี" บนใบเสร็จเด้งเองหลัง auto_post

- **fix (display):** ป้าย "เอกสารบัญชี" บนใบเสร็จ POS ที่เด้งตอนจบบิลค้าง "ยังไม่ลงบัญชี" ทุกบิล ทั้งที่ลงบัญชีจริง — **ordering bug** (ไม่ใช่ data bug): `pos.js doCheckout` เปิดใบเสร็จ + ยิง lookup JV (`:1250`) **ก่อน** `postJournalForSale` สร้าง JV (`:1257`) + badge เติมครั้งเดียวไม่ re-poll
- **fix self-contained ใน `main.js _fillReceiptAcctTrace`** (ไม่แตะ checkout flow — `pos.js` revert กลับเดิม): lookup แรก "missing" → โชว์ "⏳ กำลังลงบัญชี…" + **retry lookup** จน JV โผล่ (สูงสุด 6 ครั้ง ทุก 1.5 วิ) → badge เด้ง "ลงบัญชีแล้ว" เองไม่ต้องปิด-เปิด
- หยุด retry ถ้าเปลี่ยนบิล (`String(lr.id)===String(sale.id)`) / ปิด drawer · unposted จริง → ครบ retry → คงเหลือง (honest)
- ❌ ไม่แตะ posting/auto_post/JV/money/stock/checkout flow (`pos.js` ไม่เปลี่ยน) — display retry ล้วน (read-only lookup) · +guard `receipt_acct_trace_refresh_guard.test.js` · bump 404→405

## 5.66.0 (build 404) — 2026-06-08 Phase 404 service-job-cancel-restore-stock (MONEY/STOCK §4.2) — ยกเลิก/ลบงานช่าง = คืนสต็อก

- **feat (service/stock):** งานช่างที่มีอุปกรณ์ (items_json) ตัดสต็อกตอนสร้าง (Phase 402) แต่ยกเลิก/ลบ **ไม่คืนสต็อก** → อุปกรณ์หายถาวร → เพิ่ม: cancel/delete งานที่มีอุปกรณ์ → **คืนสต็อก** (return movement) ผ่าน `_appApplyStockMovement("return")` → trigger 403 sync products.stock เอง
- helper `restoreServiceJobStock()` + `STOCK_RETURNED_MARKER` ใน `service_equipment.js` — **idempotent** (note marker กันคืนซ้ำ) · คืนเฉพาะ item ที่มี warehouse_id · ไม่มี items_json → no-op
- **wire ครบทุก cancel path (grep):** service_jobs.js delete · ai_sales.js cancel (AI order ไม่มี items_json = no-op) · main.js saveServiceJob edit→cancelled
- error คืนบางตัว → showToast เตือน ไม่ rollback cancel (§4.8) · ❌ ไม่แตะ warehouse CAS/floor/transfer/trigger/products.stock/auto_post/POS · +guard `service_job_cancel_restore_guard.test.js` (รวม completeness guard)

## 5.66.0 (build 403) — 2026-06-08 Phase 403 stock-mirror-canonical-sync (MONEY/STOCK §4.2) — products.stock = sum(warehouse_stock) ผ่าน DB trigger

- **fix (stock root):** `products.stock` (ยอดรวม derived) หลุด sync จาก `warehouse_stock` (truth) ได้ เพราะ `_applyStockMovement` เขียน 2 ตัวแยกกัน best-effort (Phase 402 smoke เจอ 6 ตัว −1) → ทำให้ products.stock เป็น **derived 100%**
- **Part A (owner รัน SQL):** `supabase-phase403-stock-sync-trigger.sql` — trigger `AFTER insert/update/delete on warehouse_stock` → `products.stock = sum(warehouse_stock)` + backfill + NOTIFY pgrst
- **⚠️ deploy order (ตอนร้านปิด):** deploy **build 403 ก่อน** → รัน trigger → รัน backfill → verify. (ห้ามอยู่สถานะ JS 402 เก่า + trigger live ตอนมีขาย = double-count; deploy 403 ก่อน = freeze ชั่วคราว กู้ได้ด้วย backfill)
- **Part B (JS full-derived):** เอา products.stock direct-write ออกจาก `_applyStockMovement` mirror + POS deduct (warehouse branch) + revert (warehouse branch) → เหลือ optimistic local sum · **คง legacy write เฉพาะเคสไม่มี warehouse row** (trigger ไม่ fire)
- **Part C (owner decision, ยังไม่ทำ):** ลบ/ยกเลิกงานช่างที่มีอุปกรณ์ ปัจจุบันไม่คืนสต็อก — ต้องการ reverse (return movement) ไหม = scope แยก
- ❌ ไม่แตะ warehouse_stock CAS/floor (truth) · transfer sum-neutral · auto_post/JV · +guard `stock_mirror_canonical_guard.test.js`

## 5.66.0 (build 402) — 2026-06-08 Phase 402 service-job-equipment-from-stock (MONEY/STOCK §4.1+§4.2) — อุปกรณ์จากคลังใน drawer งานช่าง

- **feat (service/stock):** drawer "เพิ่มงานช่าง" เพิ่ม section **🔧 อุปกรณ์ที่ใช้ (จากสต็อก)** — picker เลือกสินค้า + คลังที่มีสต็อก + qty → **ตัดสต็อกตอนสร้างงานใหม่** ผ่าน `window._appApplyStockMovement` (CAS/floor) + precheck `aggregateNeedByKey` (สต็อกไม่พอ → บล็อก ไม่บันทึก/ไม่ตัด)
- โมดูลใหม่ `modules/service_equipment.js` (deduct-only scope; import โดย main.js เท่านั้น — **ไม่แตะ service_form.js**) · `total_cost` รวมอุปกรณ์ (auto-post JV ใช้ค่านี้)
- **กันตัดซ้ำ:** งานเดิม (มี items_json) → อุปกรณ์ **read-only** + ป้าย "ตัดสต็อกแล้ว แก้ไม่ได้" · ตัดเฉพาะงานใหม่
- **invariant:** job insert สำเร็จก่อน → ค่อยตัด; ตัดบางตัว fail → ไม่ rollback (เตือน reconcile §4.8) · showToast ไม่ alert · +guard `service_job_equipment_guard.test.js`
- **addendum (กัน double-deduct):** ห่อ `saveServiceJob` ด้วย `createInflightGuard()` (ตัวเดียวกับ POS checkout) — กดบันทึกซ้ำขณะ save inflight = no-op → ไม่สร้างงานซ้ำ/ไม่ตัดสต็อกซ้ำ
- known: แก้/คืนอะไหล่หลังบันทึก + auto-transfer บ้าน→รถ = future phase

## 5.66.0 (build 401) — 2026-06-08 Phase 401 mobile-fix-report-headers (layout/CSS-only) — header รายงานบัญชีไม่แตกแนวตั้งบนมือถือ

- **fix (accounting/mobile):** header ของรายงานบัญชี **5 หน้า** (Trial Balance / P&L / Balance Sheet / Export Bundle / Opening Balance) — title ไทยแตกแนวตั้งบนจอ ~360px เพราะปุ่ม Excel/พิมพ์ ไม่ wrap ลงล่าง → บีบ title (Phase 400 audit พลาดจุดนี้)
- เปลี่ยน title div `<div style="flex:1;min-width:200px">` → class `.rep-head-main` + `@media≤600px` ให้ title basis 100% (min-width:0) → ปุ่มตกบรรทัดล่าง · desktop เหมือนเดิม
- **layout-only:** ไม่แตะ logic รายงาน/Dr-Cr/balance/export/print/period · ตาราง · ปุ่ม id · +guard `report_header_mobile.test.js`

## 5.66.0 (build 400) — 2026-06-08 Phase 400 mobile-fix-vertical-text (layout-only) — แก้ข้อความแตกแนวตั้งบนมือถือ

- **fix (ui/mobile):** หน้า **ยอดยกมา (Opening Balance)** — ชื่อบัญชีไทยแตก 1 ตัวอักษร/บรรทัดบนจอแคบ (~360px) เพราะ flex row ไม่ wrap + input fix 160px บีบชื่อ → แยกเป็น class `.ob-*` (flex-wrap + `.ob-name` min-width + `@media≤600px` input เต็มกว้าง)
- **hardening:** หน้า **คืนสินค้า** panel "เหตุผลที่ลูกค้าคืนมากที่สุด" — เพิ่ม `flex-wrap` + min-width ให้ข้อความเหตุผล (bar 200px wrap ลงบรรทัดล่างเมื่อจอแคบ)
- **layout-only:** ไม่แตะ logic ลงยอด/balance/JV (OB) · refund/total/pct (refunds) · คง input id `ob_${code}` + escHtml · +guard `mobile_row_layout.test.js`

## 5.66.0 (build 399) — 2026-06-08 Phase 399 topbar-notif-profile (display + navigation · READ-ONLY) — 🔔 แจ้งเตือน + 👤 เมนูโปรไฟล์

- **feat (ui):** เพิ่มใน topbar-right → ปุ่ม **🔔 แจ้งเตือน** (badge = จำนวนสินค้าใกล้หมด/หมด) คลิกไปหน้าสินค้า + **👤 ชิปโปรไฟล์/เมนู** (ชื่อ+role, ⚙️ ตั้งค่า / 🚪 ออกจากระบบ)
- **refactor:** แยก `_countLowStockItems()` เป็น **single source** ใช้ร่วมกันระหว่าง badge sidebar เดิม + bell ใหม่ → ตัวเลขไม่หลุดกัน
- ชื่อโปรไฟล์ผ่าน `escapeHtml` (XSS), logout reuse `window.__authLogout()` (auth.js), CSS อยู่ใน style.css (global)
- **read-only ล้วน:** ไม่ fetch/write · ไม่แตะ search/refresh/checkout/เงิน/สต็อก/บัญชี/schema · +guard `topbar_notif_profile.test.js`

## 5.66.0 (build 398) — 2026-06-07 Phase 398 fix-gross-profit-kpi (MONEY WRITE-PATH) — เขียน sales.gross_profit ตอน checkout

- **fix (money write-path §4.1):** KPI **"กำไรขั้นต้น"** บน dashboard อ่าน `sales.gross_profit` ที่แอป**ไม่เคยเขียน** → แสดง **฿0 เสมอ** (dead metric, verified column 42703). แก้โดยคำนวณ + เขียนตอน checkout
- **schema (owner ran already):** `ALTER TABLE sales ADD COLUMN IF NOT EXISTS gross_profit NUMERIC(14,2)` + `NOTIFY pgrst` (2026-06-07) — column verified มีจริง (REST คืน 42501 RLS, ไม่ใช่ PGRST204) · migration `supabase-phase398-gross-profit.sql` ใน commit เป็นหลักฐาน (ไม่รันซ้ำ)
- **`modules/pos.js`:** pure `_computeGrossProfit(cart, products, subtotal)` = **subtotal(ex-VAT) − Σ(products.cost × qty)** [cost = source เดียวกับ `sale_items.unit_cost`] · **null ถ้าตะกร้าว่าง/quick-pay** (ไม่ inflate กำไร) · round2
- **doCheckout:** เพิ่ม `gross_profit` ใน salePayload (subtotal เดิม**ไม่เปลี่ยนค่า** = `_saleSubtotal`) + **defensive fallback**: ถ้า POST sales fail ด้วย column error → ตัด gross_profit แล้ว retry (**กัน checkout พัง**)
- **ไม่แตะ:** amount/VAT/total/paid/change/discount เดิม · stock CAS · loyalty earn · JV auto-post (gross_profit เป็น field เกินที่ JV ignore) · inflight guard · sale_items/unit_cost (source) · dashboard.js
- **verify:** lint:errors **0** · +7 tests `pos_gross_profit` (สูตร 80/null/0-cost/VAT-ex + fallback wiring) · **multi_payment/quick_pay/checkout_inflight guards เดิมเขียว** · unit **1348** · e2e **12/12** · **pwa-cache:** bump 397→**398**
- **known risk:** บิลเก่า gross_profit=null (backfill แยก = future) · product cost=0 → กำไรเกินจริง (data quality)
- **manual smoke money-path:** ขายจริง 1 บิล (สินค้ามี cost) → checkout ไม่ error · quick-pay → ไม่พัง (null) · #dashboard "กำไรขั้นต้น" > 0 ตรง (ราคา−ต้นทุน) · DB: `select gross_profit from sales order by id desc limit 3` บิลใหม่ไม่ null

## 5.66.0 (build 397) — 2026-06-07 Phase 397 dashboard-recent-txn (display · read-only) — ตารางธุรกรรมล่าสุด แบบ scroll

- **feat (dashboard, display read-only):** เพิ่มบล็อก **"🧾 ธุรกรรมล่าสุด"** บนหน้า dashboard — ตารางรายการขายล่าสุด (≤30) แบบ scroll (max-height 360px) · columns: วันที่/เวลา · เลขที่บิล · ลูกค้า · ช่องทาง · ยอด (+ badge "เครดิต")
- **helper `_recentTxnRows(state)`:** source = `visibleSalesForRole(state.sales, profile, currentUser)` (**role-filtered + soft-delete** — non-admin เห็นเฉพาะของตัวเอง, กัน data leak) · **clone ก่อน sort** `[...sales].sort(desc created_at).slice(0,30)` (ไม่ mutate state.sales) · **escapeHtml ทุกค่าจาก DB** (XSS: order_no/customer_name/payment_method) · empty-state "ยังไม่มีธุรกรรม"
- **sub-label ซื่อตรง:** "รายการขายล่าสุด (สูงสุด ~50 ที่โหลด) — ไม่ใช่ทั้งระบบ" · แทรกหลัง top-products/expenses ก่อน ALERTS
- **read-only ล้วน:** ❌ ไม่ fetch/network/RPC/write · ไม่ mutate state.sales · ไม่แตะ checkout/pos/logic เงิน/สต็อก/บัญชี/schema/SQL · ไม่แตะ trend(396)/charts/KPI/period tabs/sidebar/topbar/shared CSS · ไม่ alert/dependency
- **verify:** lint:errors **0** · +3 tests `dashboard_recent_txn` · **xss_regression** + dashboard_readonly/income/ui/trend guards เดิมเขียว · unit **1341** · e2e **12/12** · **pwa-cache:** bump 396→**397**
- **known risk:** ตาราง = รายการล่าสุด ≤50 ที่โหลด — label ซื่อตรงแล้ว (ไม่อ้างทั้งระบบ)
- **manual smoke:** เปิด #dashboard (Ctrl+Shift+R) → ตาราง "ธุรกรรมล่าสุด" + scroll · ข้อมูลตรง · ไม่มี console error · trend/charts ไม่พัง

## 5.66.0 (build 396) — 2026-06-07 Phase 396 dashboard-trend-line (display · read-only) — กราฟเส้นแนวโน้มรายได้ vs ค่าใช้จ่าย เต็มความกว้าง

- **feat (dashboard, display read-only):** แปลงกราฟ bar **"ยอดขาย 12 เดือน"** (dataset เดียว, label หลอกว่า "12 เดือน" ทั้งที่ data cap) → **line chart เต็มความกว้าง 2 เส้น**: "รายได้" (ฟ้า #0284c7) vs "ค่าใช้จ่าย" (แดง #ef4444) ตามเดือนที่มีข้อมูลจริง
- **`renderChart(sales, expenses)`:** guard `typeof Chart` · helper `_trendMonths` (single source: markup empty-check + chart) bucket **เฉพาะเดือนที่มีข้อมูลจริง** จาก `state.sales`(cap ~50) + `state.expenses`(cap ~200) — sort **สำเนา** + slice(-12) (ไม่ mutate) · legend โชว์ 2 เส้น · y = moneyShort · empty-state ถ้าไม่มีเดือน
- **markup:** ย้าย `#salesChart` ออกจาก `.two-col` → **panel full-width** + title "📈 แนวโน้มรายได้ & ค่าใช้จ่าย" + **caption ซื่อตรง** "จากรายการล่าสุดที่โหลด (บิล ~50 / ค่าใช้จ่าย ~200) — ไม่ใช่ทั้งระบบ" (เลิก label "12 เดือน" misleading) · top-products/expenses re-parent เป็น grid ของตัวเอง (เนื้อหาเดิมครบ)
- **read-only ล้วน:** ❌ ไม่ fetch/network/RPC/write · ไม่ mutate state.sales/expenses · ไม่แตะ logic เงิน/สต็อก/บัญชี/schema/SQL · ไม่แตะ shared CSS `.two-col`/`.panel`/`.pro-*` · ไม่ย่อ sidebar · ไม่เพิ่ม dependency
- **verify:** lint:errors **0** · +4 tests `dashboard_trend_chart` · dashboard_readonly/income/ui guards เดิมเขียว · unit **1338** · e2e **12/12** · **pwa-cache:** bump 395→**396**
- **known risk:** กราฟแนวโน้มจำกัดที่ข้อมูล loaded (50/200) — caption ซื่อตรงแล้ว; true 12-month trend = phase ถัดไป (server-side RPC aggregate)
- **manual smoke:** เปิด #dashboard (Ctrl+Shift+R) → line chart เต็มกว้าง 2 เส้น + legend + caption · panel สินค้าขายดี/ค่าใช้จ่ายเดือนนี้ ยังอยู่ · chart/tabs อื่นไม่พัง

## 5.66.0 (build 395) — 2026-06-07 Phase 395 income-overview-page + dashboard-today-income (feature · read-only) — หน้า "ภาพรวมรายได้" + การ์ดรายได้วันนี้

- **feat (report, read-only):** เพิ่มหน้า **"ภาพรวมรายได้"** (`modules/income_overview.js`, คู่กับ ภาพรวมรายจ่าย) ในเมนู ภาพรวม/รายงาน + การ์ด **"รายได้วันนี้"** (รวมงานบริการ) ในหน้าภาพรวมบริษัท
- **นิยาม "รายได้" = เดียวกับ dashboard/P&L:** POS sales + web orders + งานบริการ (delivered/done/closed) — **reuse** `sumServiceJobIncome`/`isWebOrderServiceJob`/`isServiceIncomeJob` จาก dashboard.js (single source of truth, กัน divergence แบบ Phase 387) ไม่คิดสูตรเอง
- **income_overview.js (Part A):** อ่าน `ctx.state` เท่านั้น (read-only, ไม่ fetch/ไม่ mutate, admin-gated) · period today/เดือน/ปี · stat cards (รายได้รวม/POS/บริการ/เว็บ) · Chart.js donut ตามแหล่ง + bar รายเดือน · ยอดรวมเดือน = ที่ P&L/dashboard แสดง
- **dashboard.js (Part B):** +`todayServiceIncome`/`todayTotalIncome` + การ์ด `_kpiCard` "รายได้วันนี้" (go:`income_overview`) — **ไม่แก้** "ยอดขายวันนี้" (todayRevenue=POS+web) แค่เพิ่มการ์ดรายได้รวม · dashboard ยัง read-only
- **wire:** main.js LAZY_ROUTES + ALL_ROUTES(admin) + titles · index.html nav-btn (กลุ่มภาพรวม/รายงาน) + section
- **scope:** ❌ ไม่แตะ money write/POS/cart/stock · accounting JV/auto_post · schema/SQL/RLS
- **verify:** lint:errors **0** · +5 tests `income_overview_guard` (read-only + helper-reuse + wiring + dashboard card) · dashboard_readonly/income/ui guards เดิมเขียว · unit **1334** · e2e **12/12** · **pwa-cache:** bump 394→**395**
- **owner smoke:** เปิด "ภาพรวมรายได้" → ยอดรวมเดือน = P&L (เช่น มิ.ย. 2,110) · การ์ด "รายได้วันนี้" รวมงานบริการถูก · ปุ่ม nav ไปหน้าใหม่ได้

## 5.66.0 (build 394) — 2026-06-07 Phase 394 service-request-schema-column-mismatch-hotfix (HIGH · service blocked) — sync record กับ schema service_jobs

- **fix (HIGH, service):** หลัง 393 (total_cost) แก้แล้ว ฟอร์มแจ้งซ่อม `service_request.js` ยัง POST service_jobs ได้ **HTTP 400 เสมอ** เพราะ record ส่งคอลัมน์ผิด schema 3 จุด (live-probe verified):
  - `address` → service_jobs ไม่มีคอลัมน์นี้ (ต้อง `customer_address`) — **PGRST204**
  - `device_name` → ไม่มีคอลัมน์ — **PGRST204**
  - ขาด `job_no` (NOT NULL) — **23502**
- **fix (record literal เท่านั้น, ไม่แตะ schema):** `address`→`customer_address` · ลบ `device_name` (เก็บชนิดงานที่ `sub_service: typeVal`) · +`job_no: "JOB-"+Date.now()` (pattern เดียวกับ main/ai_sales) · คง `total_cost: 0` (จาก 393)
- **proof:** record ใหม่ `{job_no, customer_name, customer_phone, job_type, sub_service, description, customer_address, note, status:pending, total_cost:0, created_by}` → POST **201** ✅
- **audit ทุก POST service_jobs:** main/ai_sales/ac_shop/ac_install/solar/service_form/customer_dashboard ใช้ `customer_address` + `job_no` ถูก (มี data จริง) · `address:` ใน ac_install/service_form เป็น **local `_lastSavedJob` object** (ปุ่มใบเสร็จ/LINE) ไม่ใช่ DB write → ปลอดภัย
- **scope:** ❌ ไม่แตะ SQL/schema/constraint (แก้ client ให้ตรง schema) · accounting/POS/stock/payroll · LINE env
- **note:** แก้สมมติฐานผิดของ Phase 393 (เดา address valid เพราะ error เป็น total_cost — จริง PostgREST รายงาน NOT NULL ก่อน column-not-found)
- **verify:** lint:errors **0** · +1 guard `service_request schema columns` (รวม service_request_total_cost_guard 5) · unit **1329** · e2e **12/12** · **pwa-cache:** bump 393→**394**
- **owner smoke:** สร้าง "AI TEST" แจ้งซ่อม → save **201 เข้าใบรับงาน** + LINE queue · ลบงานทดสอบหลัง smoke

## 5.66.0 (build 393) — 2026-06-07 Phase 393 service-request-total-cost-notnull-hotfix (HIGH · service blocked) — กัน save ล้มจาก NOT NULL

- **fix (HIGH, service):** สร้างงานแจ้งซ่อมจาก AI/หน้า service_request → save ล้ม `"null value in column total_cost of relation service_jobs violates not-null constraint"` → งานไม่เข้า DB/คิวเลย (**ต้นเหตุจริงของ "งานช่างหลุดคิว"** ที่ Phase 391 ทำให้ error โผล่แทน success ปลอม)
- **root cause:** `service_jobs.total_cost` เป็น NOT NULL แต่ `service_request.js` POST record **ไม่มี field total_cost** → null → ชน constraint
- **fix (client-side, ไม่แตะ schema/constraint):** `service_request.js` +`total_cost: 0` (งานแจ้งซ่อม = ยังไม่คิดเงิน, ค่อยใส่ตอน quote/ปิดงาน)
- **audit ทุก POST service_jobs (8 paths) — เจอเพิ่ม 2:**
  - `ac_shop.js`: ขาด total_cost → +`total_cost: prod.p` (ราคาจริง เหมือนฝาแฝด ai_sales ที่ใช้ prodPrice)
  - `main.saveServiceJob`: เดิม `total_cost: ... : null` (ส่ง null เมื่อค่าแรง=0) → แก้เป็น `: 0` (ปิด NOT NULL bug เดียวกัน — admin job ค่าแรง=0 เซฟได้)
  - ai_sales / ac_install / solar / service_form / customer_dashboard: มี total_cost อยู่แล้ว ✓
- **auto_post ไม่ mis-post:** gate ที่ delivered/done/closed + total_cost>0 → status pending + total_cost 0 → ไม่โพสต์ SV
- **scope:** ❌ ไม่แตะ SQL/schema/constraint · accounting/auto_post · POS/stock/payroll
- **verify:** lint:errors **0** · +4 tests `service_request_total_cost_guard` · unit **1328** · e2e **12/12** · **pwa-cache:** bump 392→**393**
- **owner re-smoke:** สร้าง "AI TEST" ซ่อมทีวีจาก AI/แจ้งซ่อม → **save เข้าใบรับงานได้จริง** + เข้า LINE queue · ลบงานทดสอบหลัง smoke

## 5.66.0 (build 392) — 2026-06-07 Phase 391 ai-service-job-queue-line-hotfix (HIGH · service operation) — งานจาก AI เข้าคิว + รายงานผล LINE

- **fix (HIGH, service):** งานจาก AI chat / AI Sales / แจ้งซ่อม "ลงแล้วไม่เข้าใบรับงาน/คิวงานช่าง + ไม่ส่งกลุ่ม LINE คิวงาน" — งานเข้า DB จริง (POST awaited) แต่ UI หลอกว่า success ตอน save fail + LINE คิวงาน fail เงียบ
- **RC1 (`ai-chat-widget.js`):** `finishFill` โชว์ "✅ งานเข้าคิวแล้ว 🎉" ทันทีหลัง click ปุ่ม **ไม่รอผล save** → แก้ด้วย `waitForSaveResult()` รอ CustomEvent `service-job:saved`/`service-job:save-failed` (timeout 8s → "กรุณากดบันทึก/ตรวจสอบผล" ไม่ใช่ success ปลอม)
- **RC3 (`service_request.js`):** `sendLineNotify` ขาด arg `"queue"` → ไป LINE_USER_ID ไม่ใช่กลุ่มคิว → เพิ่ม target `"queue"` + await + handle result + dispatch saved/failed
- **RC4 (`ai_sales.js`):** LINE queue เป็น `.catch(()=>{})` swallow → `await` + `describeLineResult`
- **RC5 (`main.js` saveServiceJob):** queue LINE ไม่ await/ไม่ handle → `await` + handle + dispatch save signals (validation/!ok→failed, success→saved+job_no)
- **`line_notify.js`:** pure `describeLineResult()` แยก disabled / not-configured / send-error / fell-back-to-user + surface `usedFallback`
- **`functions/api/line-notify.js`:** return `usedFallback` boolean (ไม่เปิด secret) → client report queue→user fallback เมื่อยังไม่ตั้ง LINE_GROUP_QUEUE
- **invariant:** job save สำเร็จแม้ LINE fail (LINE fail = warning ชัด ไม่ใช่ job fail)
- **read-only/scope:** ❌ ไม่แตะ money/POS/stock/accounting/payroll/cart · SQL/RLS/schema/DB constraint · LINE env/config value จริง
- **verify:** lint:errors **0** · +10 tests `ai_service_queue_line_guard` · unit **1324** · e2e **12/12** · **pwa-cache:** bump 391→**392**
- **owner smoke (รออนุมัติสร้างงานทดสอบ):** สร้างงาน "AI TEST <เวลา>" → เข้าใบรับงาน + เข้า LINE_GROUP_QUEUE จริง · env ไม่ครบ/ปิด LINE → warning ชัด · save fail (เบอร์ผิด) → widget ขึ้น "ยังบันทึกไม่สำเร็จ" · ลบงานทดสอบหลัง smoke

## 5.66.0 (build 391) — 2026-06-07 Phase 389 structural-dashboard-shell-redesign (UI/UX visual-only) — ยกหน้า "ภาพรวมบริษัท" เป็น business dashboard

- **feat (ui, visual-only):** finalize ของ draft ที่ Codex approved — แทน **gradient marketing hero** ด้วย **flat business header** (`_dashHeader`) + today highlight + **KPI grid แบบ class-based** (`_kpiCard`) ใน `modules/dashboard.js`
- **how:** presentation อยู่ใน `style.css` block "Phase 389" (token-driven → `[data-theme="dark"]` ไม่พัง · class-based ไม่มี inline grid → cards stack บนมือถือเอง) · header = โลโก้ + ชื่อร้าน + "ภาพรวมธุรกิจ" + ปุ่ม ดูบิล/สรุปไลน์ · KPI grid 2 แถว (เงิน: ยอดขาย/ค่าใช้จ่าย+sparkline/กำไรขั้นต้น/กำไรสุทธิ · นับ: receipts/customers/products/service_jobs/quotations/pending/user/role)
- **read-only + hooks preserved:** dashboard.js ยังไม่ fetch/ไม่ mutate state · ทุก event hook ครบ (`dashboardReceiptBtn`/`sendDailySummaryBtn`, data-go nav 7 route, period tabs, low-stock, line-order, pro-range, chart canvas 6 ตัว) · escape `logoSrc`/`userName`/`shopName` (Codex fix)
- **ไม่แตะ:** accounting/service_reconcile/periods/backfill · POS/cart/sales · stock/CAS · payroll/HR · SQL/RLS/schema/RPC · main.js logic
- **verify:** lint:errors **0** · +9 tests `dashboard_ui_guard` · unit **1314** · e2e **12/12** · **pwa-cache:** bump 390→**391** · base = main build 390 (รวม Phase 390 accounting ครบ, merge สะอาดไม่ชน)
- **visual smoke:** desktop 1440×900 + mobile 390×844 — cards radius 12px/เงาบาง/หัวแบน/sidebar active accent · ปุ่มเดิมกดได้ครบ · dark mode ไม่เพี้ยน · ไม่มี horizontal scroll

## 5.66.0 (build 390) — 2026-06-07 Phase 390 accounting-readiness-service-scope-fix (HIGH · money-path visibility) — รวมรายได้งานบริการเข้าการตรวจความครบของบัญชี

- **fix (HIGH, money-path visibility):** close-readiness (`periods.js`) + Backfill Integrity (`backfill.js`) เดิมตรวจแค่ sales/expenses/payroll → ขึ้นเขียว **"📋 บิลมี JE ครบ ✅"** ทั้งที่งานบริการปิดแล้วยังไม่มี JE (live: `JOB-1780732840014` หลวงพี่ ฿600 ส่งมอบ 6 มิ.ย. → หลุดจาก P&L มิ.ย.)
- **service_reconcile.js:** `findUnpostedServiceJobs` จับคู่ **source_id เป็น primary** + job_no ใน description เป็น fallback (array signature เดิม backward-compat) · shared read-only `fetchServiceJVStatus({fromDate,toDate,effectiveDate})` ดึง `service_jobs` (date-scoped ไม่ใช่ state ≤50) + `journal_entries` source_id/description · UI บอกช่วงวันที่/จำนวนที่ดึง · ปุ่ม re-post เดิม (manual, idempotent)
- **periods.js:** `fetchCloseReadiness` +`serviceMissing`/`serviceUnknown` (**fetch fail → unknown ไม่เขียว**) · ตรวจ readiness **ทุกเดือนที่ไม่ใช่อนาคต** (เลิก gate `jvCount>0`) · `_monthNeedsAttention` → เดือน JV=0 ที่มีงานบริการค้าง/unknown ไม่ขึ้น "ไม่มีรายการในเดือนนี้" แต่ขึ้น "⚠️ ต้องตรวจ" + warning · readiness label แยก (Dr=Cr / บิล / orphan JV / **งานบริการ** / unknown) · lock-gate เตือน service
- **backfill.js:** integrity panel รวม service-missing เข้า actionable/unknown totals (ไม่เขียวทั้งระบบถ้า service ยังแดง) + chip + note ลิงก์ Service Reconcile
- **read-only:** ❌ ไม่แตะ SQL/RLS/schema/RPC · auto_post double-entry/COA internals (แค่เรียก postJournalForServiceJob) · raw JE insert · POS/stock/payroll/Phase 388/389 · ไม่ auto-post/auto-click/ไม่แก้ข้อมูลจริงอัตโนมัติ
- **verify:** lint:errors **0** · +14 tests `accounting_readiness_service_scope` + update `service_reconcile_guard` · unit **1306** · e2e **12/12** · **pwa-cache:** bump 388→**390** (ข้าม 389 — UI draft pending แยก)
- **owner smoke (หลัง deploy + re-post JOB-1780732840014):** Service Reconcile เขียว · P&L มิ.ย. revenue 510→**1,110** / ขาดทุน 978→**378** · Period Close มิ.ย. not-ready→**ready** · ถ้ามี service missing ใหม่ Period Close ต้อง not-ready

## 5.66.0 (build 388) — 2026-06-07 Phase 388 expense-delete-orphan-jv (HIGH · money path) — ลบรายจ่ายแล้ว void JV ด้วย

- **fix (HIGH, money path §4.8):** ลบรายจ่ายในเมนูรายรับ-รายจ่าย เดิมเรียกแค่ `_appXhrDelete("expenses")` ไม่ void JV ที่ auto-post ไว้ → JV ค้างเป็น **orphan** ในงบการเงิน (เป็นต้นเหตุของ orphan แบบ PV2069/หลวงพี่ที่เพิ่งตามเก็บ)
- **how (`expenses.js` delete handler):** `await voidJvForSource("expenses", id)` ก่อน `_appXhrDelete` (mirror edit flow ที่ void อยู่แล้ว; sales/receipts/delivery_invoices/payroll ก็ void ตอนลบเหมือนกัน — expenses เป็นตัวเดียวที่ตกหล่น)
- **ไม่แตะ:** voidJvForSource/auto_post internals (แค่เรียก) · sales/receipts/payroll (ถูกอยู่แล้ว) · schema/RLS/SQL · POS/stock
- **verify:** lint 0 · +3 tests `expense_delete_void_jv_guard` · unit 1292 · **pwa-cache:** bump 387→388

## 5.66.0 (build 387) — 2026-06-07 Phase 387 dashboard-net-profit-include-service-income — กำไรสุทธิ dashboard ตรง P&L

- **fix:** "ภาพรวมบริษัท" กำไรสุทธิเดือนนี้ เดิมคิดจาก POS sales + web orders เท่านั้น → ไม่รวมรายได้งานบริการ (delivered/done/closed) ที่งบ P&L นับ → กำไรเพี้ยน (เคสจริง −1,478 vs P&L −978)
- **how (dashboard.js · pure helpers):** isWebOrderServiceJob / isServiceIncomeJob / sumServiceJobIncome → monthServiceIncome (delivered/done/closed + total_cost>0, ไม่นับ web order ซ้ำ) + monthTotalIncome = monthRevenue + service → monthNetProfit ใช้ monthTotalIncome; การ์ด "ยอดขายเดือนนี้" คง monthRevenue (POS+web)
- **read-only:** dashboard ยังไม่ fetch/mutate (ผ่าน dashboard_readonly_guard, build markers bump 386→387)
- **ไม่แตะ:** POS/stock/accounting/JV/service write/schema
- **verify:** lint 0 · +6 tests `dashboard_income_guard` · unit 1289 · **pwa-cache:** bump 386→387
- **note:** หลัง fix กำไร dashboard มิ.ย. = −378 (นับงานบริการส่งมอบจริง 500+600); ยังต่าง P&L (−978) เพราะ JV ของ JOB-1780732840014 (หลวงพี่ 600) ยังเป็น orphan ไม่ถูกโพสต์ → re-post ผ่านหน้า "รายได้งานบริการเข้าบัญชี" แล้วทั้งคู่จะตรงที่ −378

## 5.66.0 (build 386) — 2026-06-07 Phase 386 professional-saas-dashboard-shell-polish — UI/UX visual polish (ยังไม่ merge · รอ owner/Codex review)

- **feat (ui, visual-only):** ยกหน้าตา app shell + หน้า "ภาพรวมบริษัท" ไปทาง business dashboard แบบ SaaS (FlowAccount tone) — calm/professional. **CSS เท่านั้น ไม่แตะ JS/logic เลย**
- **how (`style.css`):** (1) token light-mode 3 ตัว — `--shadow` หนา `0 10px 30px` → subtle `0 1px 3px + 0 1px 2px`; `--bg` `#eef3f7` → neutral `#f3f5f8`; `--line` `#e2e8f0` → `#e5e7eb`. (2) append section "Phase 386" (scope ชัด, ปิดท้ายไฟล์ = ชนะ specificity, revert ง่าย): card/stat-card/item-card radius 20→**12px** + subtle shadow; hero flatten — gradient เบาลง, amount 48→**34px**, radius 26→16px, shadow เบา; sidebar nav radius 14→**10px** + active เป็น **left-accent bar** สะอาด + hover นิ่ง; topbar solid+crisp + search box height 40/radius 10; page padding สม่ำเสมอ. **ทุกสีใช้ `var(--token)` → `[data-theme="dark"]` ไม่พัง**
- **read-only proof:** `modules/dashboard.js` ไม่ถูกแตะ (0 บรรทัด) — guard test ยืนยัน no fetch/xhr/supabase-write, no state mutation, ไม่อ้าง checkout/addToCart/decrementStock/autoPost/postJournal/loadAllData
- **ไม่แตะ:** dashboard.js · POS/cart/sales save · stock/CAS/warehouse · accounting auto_post/JV/period/schema · service job · payroll/HR · API endpoints · SQL/RLS/schema · package.json version
- **verify:** lint:errors **0** · +5 tests `dashboard_readonly_guard` (read-only + visual marker + build-bump sync) · unit **1268** · e2e **12/12** (รวม build-version-sync 3 ตัว) · **pwa-cache:** bump 384→386
- **⚠️ NOTE:** branch นี้ตัดสดจาก `origin/main` (build 384) — **ไม่รวม Phase 385 journal-date-guard** (build 385 Part A committed + Part B SQL) ซึ่งเป็น branch บัญชี **pending แยกต่างหาก** (owner-gated)
- **known risk:** เป็น polish phase แรก ยังไม่ครอบทุกหน้า · dashboard mobile 1-column stacking ของ inline grid (`style="grid-template-columns:repeat(4,1fr)"`) override ด้วย CSS ไม่ได้ถ้าไม่ใช้ `!important` → defer เป็น phase ถัดไป (กัน regression) · บางหน้าที่มี inline style เก่าอาจยังไม่เข้าชุด
- **STOP:** ยังไม่ push main — รอ owner/Codex review

## 5.66.0 (build 385) — 2026-06-07 Phase 385 journal-date-guard — กัน doc_date นอกช่วง + ลบบิลซ้ำ

- **fix (money path):** กัน JE ที่ doc_date ปีนอกช่วง (เช่น 2069) ที่ทำให้รายการหลุดจากงบปีที่ถูกต้อง
- **how (Part A):** `modules/accounting/date_guard.js` (pure) `validateJournalDate` + `findOutOfRangeEntries`; block ตอน save ใน `journal_form.js` + banner detector admin-only read-only ใน `journals.js`
- **Part B (owner-gated · SQL):** PV2069050001 เป็นบิลซ้ำของ PV2026050003 (แมกซ์การ์ด invoice เดียวกัน ฿988) → ลบ expense #5 + JV ที่ผูก
- **verify:** lint:errors 0 · +15 tests `journal_date_guard` · unit 1278 · **pwa-cache:** bump 384→385
- **follow-up:** (1) ลบบิลในแอปไม่ลบ JV ผูก=orphan (2) หมวด "น้ำมันรถ" ไม่ map COA → 5900

## 5.66.0 (build 384) — 2026-06-06 Phase 384 service-autopost-reconcile (Part B) — ตามเก็บรายได้งานบริการที่ JE หายเงียบ

- **fix (money path §4.8):** งานบริการที่ปิดแล้ว (delivered/done/closed) auto-post JV แบบ fire-and-forget ใน `service_form.js` → ถ้า post ล้ม = งาน delivered แต่ JE ไม่เกิด → **รายได้หายเงียบ** (เช่น หลวงพี่ JOB-1780732840014 ฿600)
- **how:** หน้าใหม่ **admin-only** `service_reconcile` (`modules/service_reconcile.js`) — pure `findUnpostedServiceJobs(jobs, jeDescriptions, {effectiveDate})` flag งาน delivered/done/closed + total_cost>0 + created_at≥2026-05-01 (dateBkk) + `job_no`(JOB-\d+) ไม่อยู่ใน JE description → ปุ่ม "ส่งเข้าบัญชีอีกครั้ง" เรียก `postJournalForServiceJob` (idempotent: 409→null ไม่ double-post) → สำเร็จ=toast+refresh / null=toast เตือน+refresh; inflight guard + admin double-gate
- **read-only fetch:** ดึง `journal_entries.description` ด้วย GET อย่างเดียว (re-post ผ่าน auto_post — ไม่ hand-roll JE insert)
- **ไม่แตะ:** auto_post double-entry/mapping/COA/period-lock (แค่ "เรียก") · schema/RLS/SQL · `service_jobs.js` (ทีม 383) · `service_form.js` Part A surface (เลื่อน — รอ owner ตัดสิน Finding 1) · stock/POS/payroll/refund
- **wiring:** LAZY_ROUTES + ALL_ROUTES (admin) + titles + index.html nav-btn (กลุ่มบัญชี) + section
- **verify:** lint:errors 0 · +18 tests `service_reconcile_guard` (pure findUnpostedServiceJobs + idempotent re-post + read-only/no-forbidden-write guards) · unit 1263 · e2e 12/12 · **pwa-cache:** bump 383→384
- **merged:** `0e2f6d3` ff (27f6077..0e2f6d3) → main · CI Tests+Deploy (Cloudflare) success · live build 384 verified
- **known risk:** orphan view อิง `state.serviceJobs` (≤50 ล่าสุด) — งานเก่ากว่านั้นไม่โผล่ (มี honesty label); re-post คืน null รวม idempotency/period-lock/eff-date/สำเร็จจริง → toast เตือนกว้าง (ตรง Finding 1)
- **next:** Part A surface (`service_form.js`) รอ owner ตัดสิน Finding 1 — `postJournalForServiceJob` ไม่เคย throw (failure/idempotency/eff-date คืน null หมด, auto_post.js:273-286) → "throw→เตือน, null→เงียบ" จะกลายเป็น ship no-op


## 5.66.0 (build 383) — 2026-06-06 Phase 383 service-job-status-db-safe-hotfix (HIGH) — กัน 400 ตอนช่างบันทึกใบงาน

- **fix (HIGH, production):** ช่างกดบันทึกใบงานแล้ว `POST service_jobs` ล้ม **HTTP 400 (23514)** เพราะ UI ส่ง `status` ที่ DB constraint `service_jobs_status_check` ไม่รับ (`pending_review` / `in_progress`) → ใบงานไม่ถูกสร้าง → หน้าใบรับงานไม่โชว์ + LINE notify ไม่ถูกเรียก (flow หยุดก่อน save)
- **how:** `modules/service_status.js` ใหม่ (pure) — `normalizeServiceJobStatus(status)`: `pending_review→pending`, `in_progress→progress`, valid→คงเดิม, unknown/null/empty→`pending`; `serviceJobNoteWithReviewMarker(note, uiStatus)`: คง intent "รออนุมัติ" ผ่าน note marker `[รออนุมัติแอดมิน]` เมื่อ UI เลือก pending_review (กัน duplicate, ไม่ทำ save ล้ม)
- **wire ทุก service_jobs write path:** `ac_install.js` / `service_form.js` / `solar.js` record.status + `main.js` saveServiceJob payload.status + reject flow (`in_progress`→`progress`). DB รับแค่ pending/progress/done/delivered/closed/cancelled
- **ไม่แตะ:** SQL/RLS/schema/constraint · LINE notify implementation · stock/POS/accounting/payroll · JV path (accounting, dead เพราะ isClosure=[]) · UI option labels (คงไว้ — normalize ตอน save)
- **review follow-up (same phase):** เพราะ normalize ทำให้ read-side ที่ดู `status === "pending_review"` ไม่เห็นงานใหม่ → เพิ่ม read-side helper `isServiceJobPendingReview(job)` (true ถ้า `status === "pending_review"` [row เก่า] **หรือ** `status === "pending"` + note มี `REVIEW_NOTE_MARKER` [งานใหม่]). wire `service_jobs.js` (cReview/review filter ใช้ helper; `open` exclude review กันนับซ้ำ; status label/color → "📨 รออนุมัติ" ม่วง; export) + `main.js` approve banner → คิว/แท็บ/banner "รออนุมัติ" กลับมาทำงาน
- **verify:** lint:errors 0 · +31 tests `service_status_guard` (normalize/marker + read-side helper + wiring 4 write paths + service_jobs read-side + approve banner) · unit 1245 · e2e build-sync 3/3 · **pwa-cache:** bump 382→383
- **known risk:** ถ้าต้องการสถานะ `pending_review` จริงใน DB ภายหลัง = schema decision แยก (เพิ่มค่าใน constraint + workflow) ไม่ใช่ hotfix นี้

## 5.66.0 (build 382) — 2026-06-06 Phase 382 hr-overview-gps-exception-filter — toggle กรอง "GPS น่าสงสัย"

- **feat (HR display):** HR Overview เพิ่ม toggle **"📍 GPS น่าสงสัย (N)"** (แยกจาก status bar, orthogonal) — กดแล้วกรองเฉพาะพนักงานที่ `gpsStatus` = missing/outside (จาก 379); compose กับ status/dept/role ได้; แสดงเฉพาะเมื่อตั้ง geofence; badge N = จำนวน exception ในมุมมองปัจจุบัน
- **how:** helpers ใหม่ exported `isGpsExceptionStatus(s)` + `countGpsExceptions(rows)`; `filterHrRows` รับ `filters.gpsException` (กรองเมื่อ `=== true` เท่านั้น = backward-compat); render: `_gpsFilterToggle` + `#hrGpsFilterBar` + state `activeGpsOnly` + handler flip + clear-filters reset gps + export ตามมุมมองที่เห็น
- **read-only (filter view เท่านั้น):** ❌ ไม่แตะ detection logic (detectExceptions/detectStuckCrossDaySessions) · loader query (select=*) · OT/payroll · clock enforcement · schema/SQL/RLS · DB write · mutate state/row · money/stock/POS/accounting
- **verify:** lint:errors 0 · +14 tests `hr_gps_filter_guard` (predicate/count/filter compose/backward-compat + wiring/gating/read-only) · unit 1214 · e2e build-sync 3/3 · **pwa-cache:** bump 381→382

## 5.66.0 (build 381) — 2026-06-06 Phase 381 hr-alert-staff-name — ใส่ชื่อพนักงานในกล่องแจ้งเตือน session ค้าง

- **feat (HR display):** กล่องแจ้งเตือน session ค้าง (section "สิ่งที่ต้องจัดการวันนี้") ขึ้น **ชื่อพนักงานนำหน้า** → admin เห็นทันทีว่า *ใคร* ค้าง. ครอบ 2 kind: `stuck_session_crossday` (380, ค้างข้ามวัน) + `stale_session` (วันนี้-เปิดค้าง ≥14 ชม.)
- **how:** renderHrOverviewPage สร้าง `nameById = new Map(data.profiles.map(p => [String(p.id), profileDisplayName(p)]))` ส่งเข้า 2 detector; แต่ละ detector ใส่ prefix `${ชื่อ} · ` **เฉพาะเมื่อมี nameById** (id ไม่อยู่ใน map → `พนักงาน #<id>`; ไม่ส่ง nameById → message เดิม ไม่มี prefix = backward-compat). escape ที่ `_alertRow` เดิม (ไม่ double-escape)
- **read-only (แก้แค่ message string):** ❌ ไม่แตะ `_alertRow` signature/markup · alert kind อื่น (geofence_out/late/early/unpaid/offline — คงข้อความเดิมเป๊ะ) · OT/payroll calc · clock enforcement · loader query · detection logic (เงื่อนไข flag เดิม) · schema/SQL/RLS · DB write · mutate state/row
- **verify:** lint:errors 0 · +7 tests (hr_stuck_session_guard รวม 22; ครอบ name prefix/fallback/backward-compat + stale ชื่อ + geofence_out ไม่มีชื่อ) · unit 1200 · e2e build-sync 3/3 · **pwa-cache:** bump 380→381
- **known note:** `geofence_out` ยังไม่มีชื่อ (นอก scope; future ถ้าอยาก consistency ทุก kind)

## 5.66.0 (build 380) — 2026-06-06 Phase 380 hr-overview-stuck-session-crossday (clock-out trap C2 · scope A read-only) — HR Overview โชว์ session ค้างข้ามวัน

- **feat (HR display, medium):** HR Overview section "สิ่งที่ต้องจัดการวันนี้" เพิ่มรายการ "session ค้างข้ามวัน" — clock_in มี + clock_out null + work_date < วันนี้ → admin เห็นไปตามปิดเอง. กัน OT/ชม. under-count เงียบ (open session ถูกตัดทิ้งใน OT calc → วันนั้น = 0 ชม.)
- **ช่องโหว่:** session ค้างข้ามวันอยู่ใน `attendanceMonth` แต่ **ไม่อยู่ใน `attendanceToday`** → `detectExceptions` (วน attendanceToday เท่านั้น) ไม่เห็น → ไม่ขึ้นที่ไหนเลย
- **how:** pure helper exported `detectStuckCrossDaySessions(attendanceMonth, { today })` → `[{kind:"stuck_session_crossday",severity:"high",message:"session ค้างข้ามวัน — เข้างาน <date> ยังไม่ลงเวลาออก (ค้าง N วัน)",userId,refId}]` (null-safe, ไม่ mutate, จับเฉพาะ work_date < today = **ไม่ทับ stale_session เดิม**). renderHrOverviewPage `exceptions.push(...)` → แสดงผ่าน `_alertRow` เดิม; +`alertActionFor` case → ปุ่ม "เปิด Time Clock"
- **read-only:** ❌ ไม่แก้สูตร OT/payroll (sumRegularOT/closedMonth/buildMonthlyHrReport) · ไม่แตะ clock enforcement (time_clock) · ไม่แตะ `detectExceptions` เดิม (helper แยก) · loader query (attendanceMonth select=*) · schema/SQL/RLS · DB write · mutate state/row · money/stock/POS/accounting
- **verify:** lint:errors 0 · +15 tests `hr_stuck_session_guard` (behavioral + source/read-only guard) · unit 1193 · e2e build-sync 3/3 · **pwa-cache:** bump 379→380
- **known limitation:** ครอบเฉพาะ "ในเดือนนี้" ตาม window `attendanceMonth`; session ค้างข้ามเดือน = future (ต้อง openOnly fetch แยก)

## 5.66.0 (build 379) — 2026-06-06 Phase 379 hr-overview-gps-exception-display (HR GPS hardening C / #5) — HR Overview โชว์ GPS น่าสงสัยวันนี้ (read-only)

- **feat (HR display, medium):** HR Overview เพิ่ม chip "GPS น่าสงสัย" ต่อพนักงานในรายการวันนี้ — `📍 ไม่มี GPS` (clock_in_lat ว่าง) / `📍 นอกรัศมี Xม. (กำหนด Yม.)` (clock_in_distance_m > geofence radius). ช่วย admin เห็น record เก่า/admin clock (warn-only) ที่ Phase 377 enforcement ไม่ครอบ
- **how:** pure helper exported `classifyGpsStatus(row, geofence)` → `na`/`missing`/`outside`/`inside` (null-safe; มี GPS แต่ distance non-finite → `inside` ลด noise) + `gpsChipMeta(status,{distanceM,radiusM})` → chip meta (inside/na → null). `renderHrOverviewPage` reuse `geofenceFromState(state)` (consolidate — เลิก inline parse ซ้ำที่ป้อน detectExceptions, radiusM เท่าเดิม); per-user row คำนวณ gpsStatus/gpsMeta; `_renderTbody` render `_gpsChip` ข้าง punctuality chip. โชว์เฉพาะ exception + เฉพาะเมื่อตั้ง geofence
- **read-only:** ❌ ไม่ POST/PATCH/PUT/DELETE/upsert/rpc-write · ไม่ mutate state/row · ไม่แตะ time_clock logic / clock enforcement / attendance loader query (select=*) / payroll/OT/punctuality / status-present logic / SQL/RLS/schema / money/POS/stock/accounting
- **verify:** lint:errors 0 · +21 tests `hr_gps_exception_guard` (behavioral classifyGpsStatus/gpsChipMeta + source/read-only guard) · unit 1178 · e2e build-sync 3/3 · **pwa-cache:** bump 378→379
- **known risk:** browser GPS spoof ได้ — feature นี้เป็น display/audit signal ไม่ใช่ anti-fraud server-side

## 5.66.0 (build 378) — 2026-06-06 Phase 378 store-settings-cloud-sync-feedback (HR GPS hardening A / #2) — แจ้ง error ชัดเมื่อ sync ค่าร้าน/GPS ขึ้นเซิร์ฟเวอร์ไม่สำเร็จ

- **fix (HR GPS integrity, medium):** `saveStoreInfo` (main.js) เดิม Supabase upsert `app_settings(key='store_info')` error/timeout → `console.warn` เฉย แล้ว `return` (void); `store.js` save handler โชว์ "บันทึกสำเร็จ ✅" **เสมอ (unconditional)** → cloud-sync ล้มเงียบ. geofence เป็น operational (377) → sync ล้มเงียบ = staff devices ได้ค่า GPS เก่า / enforcement เพี้ยนโดยไม่มีใครรู้
- **change:** `saveStoreInfo` คืน `{ ok:true, cloudSynced:boolean, error:string|null }` — ยังเซฟ localStorage **เสมอ ก่อน Supabase** + **❌ ไม่ throw** (ไม่ block offline; caller อื่นที่ ignore return ไม่กระทบ); `store.js` handler แตก branch: `cloudSynced:true`→success เดิม, `false`→⚠️ warning toast ชัด ("บันทึกในเครื่องแล้ว แต่ sync ขึ้นเซิร์ฟเวอร์ไม่สำเร็จ…") + ปุ่ม re-enable ใน `finally`
- **scope:** ❌ ไม่แตะ `savePaymentInfo` / `loadAppSettings` / time_clock / enforcement / schema/SQL/RLS / `app_settings` key+payload · ไม่ block การ save (รอบนี้แค่ "แจ้งชัด")
- **verify:** lint:errors 0 · +12 tests `store_settings_sync_guard` (behavioral: รัน source จริงของ `saveStoreInfo` ใน `node:vm` + source guard) · unit 1157 · e2e build-sync 3/3 · **pwa-cache:** bump 377→378
- **naming note:** "Phase 378" ก่อนหน้าใน docs = permissions-policy 377-followup (header-only, build คง 377); อันนี้คือ build 378 จริง

## 5.66.0 (build 377) — 2026-06-05 Phase 378 hr-gps-unblock-permissions-policy (377-followup) — เปิด geolocation ใน Permissions-Policy

- **fix (root cause ของ 377):** production `_headers` ตั้ง `Permissions-Policy: ... geolocation=() ...` → **browser block `navigator.geolocation` ตั้งแต่ก่อน app code รัน** → GPS self-clock (377) ใช้จริงไม่ได้ (Permissions Policy violation แทน permission prompt)
- **change:** `geolocation=()` → `geolocation=(self)` ใน `_headers` (origin เดียวกันใช้ได้, cross-origin iframe ยังถูกปิด)
- **ไม่แตะ (ตั้งใจคงเข้ม):** `microphone=()` · `payment=()` คงปิด · `camera=(self)`/`usb`/`bluetooth`/`serial` เดิม · CSP · X-Frame-Options · HSTS · Referrer-Policy ไม่แตะ
- **scope:** header-only — ❌ ไม่ bump build (377 คงเดิม; `_headers` เป็น server header เสิร์ฟสด ไม่ใช่ cached asset) · ไม่แตะ SQL/RLS/schema/money/POS/cart/accounting/stock
- **verify:** e2e guard ใหม่ยืนยัน `_headers` มี `geolocation=(self)` + ไม่มี `geolocation=()` + `microphone=()`/`payment=()` ยังปิด · e2e 12/12 · lint:errors 0 · unit 1145
- **note:** ต้องรอ deploy → ตรวจ live response header `permissions-policy` มี `geolocation=(self)` แล้ว Settings → "ใช้ตำแหน่งปัจจุบัน" จะขึ้น browser permission prompt แทน policy violation

## 5.66.0 (build 377) — 2026-06-05 Phase 377 hr-gps-self-clock-enforcement — บังคับ GPS geofence ตอนพนักงานกดลงเวลาเอง

- **fix (HR attendance integrity, medium):** เดิม (92.24) มี GPS config (`storeInfo.shopLat/shopLng/geofenceRadiusM`) แต่ **แค่ warn ไม่ block** — GPS หาย/อยู่นอกรัศมี ก็ยังลงเวลาได้ → self clock ไม่มี integrity จริง
- **how:** helper `_captureGpsForClock(ctx, { enforce })` ใน `modules/time_clock.js`:
  - `enforce=false` (admin/manager `#tcClockInBtn` / `[data-clock-out-id]`) = **warn-only เดิมเป๊ะ** (ผ่าน wrapper `_captureGpsAndWarn`)
  - `enforce=true` (self `#tcSelfClockIn` / `#tcSelfClockOut`): ไม่มี geofence → `{gps:null,geofence:null}` (ลงเวลาได้โดยไม่ต้อง GPS); มี geofence แต่ `getCurrentPosition()` คืน null → **throw `GPS_REQUIRED`**; อยู่นอกรัศมี → **throw `GEOFENCE_OUTSIDE`** (พร้อม distance/radius)
- **block ก่อนเขียน:** throw เกิด **ก่อน** `_insertClockIn`/`_patchClockOut` → ไม่มี attendance row และ **ไม่ enqueue offline** (กันลงเวลานอกพื้นที่ผ่านคิว); self handler catch → `showToast` ข้อความชัด (no alert/confirm)
- **schema:** verified live REST (HTTP 200) ว่า `staff_attendance` มี `clock_in/out_lat`, `clock_in/out_lng`, `clock_in/out_distance_m` อยู่แล้ว (92.24) — **ไม่สร้าง SQL**
- **scope:** ❌ ไม่แตะ SQL/RLS/schema · staff_attendance schema · payroll/payroll_overview · POS/cart/stock/accounting · admin-edit-attendance modal · offline-queue logic (เดิม) · return/data shape เดิม
- **verify:** lint:errors 0 · +12 tests `hr_gps_self_clock_guard` (behavioral navigator mock + source guard); time_clock(73)+hr_overview เดิมเขียว · unit 1145 · e2e 11/11 · **pwa-cache:** bump 376→377
- **known risk:** browser GPS spoof ได้ (เปลี่ยนพิกัดผ่าน devtools/มือถือ) — anti-fraud จริงต้อง server-side / device policy ภายหลัง; phase นี้ปิดช่อง "ลืม/ไม่เปิด GPS" และ "อยู่นอกพื้นที่" เท่านั้น

## 5.66.0 (build 376) — 2026-06-05 Phase 376 reconcile-report-exclude-cancelled (375b) — report ข้ามงานยกเลิก/ลบ

- **fix (false-positive):** report Phase 375 flag งานสถานะ `cancelled` ผิด (live: 5/5 ที่ flag = cancelled) — งานยกเลิก/ลบ ไม่ต้องตัดสต็อกอยู่แล้ว (found 0 = ถูกต้อง ไม่ใช่ปัญหา)
- **how:** pure helper `isReportableJobStatus(status)` → `false` เมื่อ `status === "cancelled"` (case-insensitive + trim); `detectAllJobs` ข้ามงาน `!isReportable` ก่อนคิด expected/actual (เพิ่ม `cancelledSkipped` count) → cancelled ไม่เข้า flagged/unverifiable เลย
- **ครอบ soft-delete:** soft-delete = `cancelled` + note `[ลบแล้ว]` → กรอง `status==="cancelled"` ครอบทั้งสองเคส (ไม่ต้องเช็ค `[ลบแล้ว]` แยก)
- **label:** เพิ่ม "ไม่รวมงานที่ยกเลิก/ลบ (cancelled) — งานเหล่านั้นไม่ต้องตัดสต็อก" ใต้ scope note (โปร่งใสว่ากรองอะไรออก)
- **คง invariant เดิมครบ:** read-only (ไม่ write/mutate state/fetch=GET) · admin gate · honesty labels · drill=showRoute · false-positive guards เดิม (service/non_stock filter · job_no ว่าง · data-incomplete)
- **scope:** ❌ ไม่แตะ schema/SQL/RLS · save path · deduct/transfer logic · POS/accounting
- **verify:** lint:errors 0 · +4 tests (isReportableJobStatus + cancelled-skip + active-still-flagged) `stock_reconcile_report_guard` (รวม 21) · unit 1133 · e2e 11/11 · **pwa-cache:** bump 375→376

## 5.66.0 (build 375) — 2026-06-05 Phase 375 stock-deduct-reconcile-report — หน้า report read-only admin-only "ตามเก็บ" งานที่ตัดสต็อกไม่ครบ

- **feat (read-only report):** หน้าใหม่ `stock_reconcile_report` (admin-only) surface service-job ที่ "น่าจะตัดสต็อกไม่ครบ" จาก post-save race (cache ผ่าน pre-check 370/372 แต่ DB CAS ไม่พอ → toast เตือนแต่ user อาจพลาด) ให้ admin ตรวจ/ตัดมือเอง — **heuristic best-effort ไม่ใช่ ledger เป๊ะ**
- **detection:** per งานล่าสุด ≤50 — expected = `items_json` ที่ `product_id && warehouse_id && qty>0` **และ** product ไม่ใช่ `product_type` service/non_stock (lookup `state.products`); actual = `stock_movements` type `out` ที่ note contains `job_no`; flag เมื่อ expected product มี out-movement ไม่ครบจำนวน line
- **กัน false-positive:** (1) กรอง service/non_stock ออก (ไม่ตัดสต็อก) (2) `state.stockMovements` ≤50 ไม่พอ → **fetch read-only** out-movements ตั้งแต่วันงานเก่าสุด (limit 2000); ได้ครบ limit / fetch ล้ม → state "ตรวจไม่ได้" (ไม่ flag มั่ว, ไม่ hardcode 0); งานไม่มี job_no → "ตรวจไม่ได้"
- **read-only proof:** ไฟล์ไม่มี POST/PATCH/PUT/DELETE/rpc-write/xhr-write/insert/upsert · ไม่ mutate state (clone jobs ก่อน) · ไม่เรียก stock-mutation hook ใด · drill = ปุ่ม "ไปหน้างาน" (`showRoute('service_jobs')`) เท่านั้น · ป้าย honesty บังคับ
- **scope:** wiring เฉพาะ LAZY_ROUTES / ALL_ROUTES (admin-only — ไม่อยู่ใน role อื่น) / page title + index.html page section + nav-btn (กลุ่มรายงาน) · ❌ ไม่แตะ schema/SQL/RLS/DB func/save path/deduct-transfer logic/POS/accounting · ไม่ auto-fix/ไม่ตัดย้อนหลัง
- **verify:** lint:errors 0 · +17 tests `stock_reconcile_report_guard` · unit 1129 · e2e 11/11 · **pwa-cache:** bump 374→375
- **known risk:** heuristic ไม่เป๊ะ 100% (จับคู่ note-string; งานเก่ากว่า window/ข้อมูลขาด → "ตรวจไม่ได้" ไม่ flag) — เป็น "ตัวช่วยตรวจ" ให้ admin ไม่ใช่บัญชี authoritative

## 5.66.0 (build 374) — 2026-06-05 Phase 374 wire-transfer-rpc — `_transferWarehouseStock` เรียก RPC atomic ก่อน (คง fallback ทางเดิม)

- **feat (stock §4.1/4.2):** `_transferWarehouseStock` (`main.js`) เดิมโอนระหว่างคลังด้วย multi-xhr client-side (source CAS+floor / target add / rollback / log = best-effort) — atomicity ข้าม 2 row ไม่จริง (known-risk 368). ใหม่: **ลอง RPC atomic ก่อน** `POST /rest/v1/rpc/transfer_warehouse_stock` (DB func 373.5: source−/target+/log ใน 1 transaction + FOR UPDATE lock + rollback อัตโนมัติ)
- **how:** map jsonb ที่ func คืน — `{ok:true}` → sync cache (refetch 2 แถว `warehouse_stock` ที่กระทบ best-effort) → `return {ok:true}`; `{ok:false,insufficient,error}` → return ตรง ๆ (business result ถูกต้อง, **❌ ไม่ fallback**); RPC ใช้ไม่ได้จริง (HTTP 404 / PostgREST `PGRST202` / network throw) → **fallback ไป logic multi-xhr เดิมทั้งก้อน** (เก็บไว้เป็น path สำรอง กัน deploy เก่า/function หาย)
- **scope:** ❌ ไม่ลบ logic multi-xhr เดิม · ไม่แตะ DB function · `_atomicDecrementStock`/`_atomicAddStock`/`stock_cas.js`/`_applyStockMovement`/`_deductStockForSaleItem` (POS) · `products.stock` (โอนระหว่างคลัง = ผลรวมเท่าเดิม) · 4 callers (ac_install/service_form/solar/stock_movements) · schema/SQL/RLS/POS/accounting · return shape `{ok,error,insufficient}` เดิมเป๊ะ
- **verify:** lint:errors 0 · +10 tests `transfer_rpc_wiring_guard` · unit 1112 · e2e 11/11 (build-sync) · **pwa-cache:** bump 373→374 · ⚠️ **owner ต้อง smoke โอนจริงข้ามคลัง + เคสเกินสต็อก บน live ก่อน merge** (แตะ stock จริง)
- **risk:** RPC จำกัด/scope ที่ DB; ถ้า env ไม่มี func จะ fallback ทางเดิมอัตโนมัติ (ปลอดภัย); cache refetch ล้ม = แค่ warn (DB ถูกแล้ว)

## 5.66.0 (build 373) — 2026-06-05 Phase 373 auth-pin-login-promise-executor-safe — เลิก async Promise executor ใน showStaffLogin

- **fix (auth robustness):** `showStaffLogin` (`modules/auth.js`) เดิม `new Promise(async (resolve) => {...})` (suppressed `no-async-promise-executor`) — async executor กลืน error ตอน setup (staff load / modal build) เงียบ → promise ค้าง / login ค้าง
- **how:** executor เป็น sync `(resolve) =>` + async logic ใน IIFE `(async () => {...})().catch(err => console.error)` → error surface ไม่เงียบ; **คง resolve semantics เป๊ะ** (resolve เฉพาะ login สำเร็จ `verifyPin → resolve(staffObj)`; ไม่เพิ่ม `resolve(null)`); body ไม่แตะ (minimal-diff); ลบ TODO + eslint-disable
- **verify:** lint:errors 0 (no-async-promise-executor หายโดยไม่ต้อง disable) · +4 tests `auth_pin_executor_guard` · unit 1102 · e2e 11 · branch CI green → merge ff → **owner smoke PIN login บน live 373 ผ่าน ✅**
- **scope:** ❌ ไม่แตะ verifyPin / session insert / PIN logic / initAuth · **pwa-cache:** bump 372→373

## 5.66.0 (build 372) — 2026-06-05 Phase 372 service-job-precheck-aggregate — pre-check รวม qty ต่อสินค้า+คลัง (กันรวมเกินสต็อก)

- **fix (stock §4.1/4.2):** pre-check ก่อน save ใน `ac_install`/`service_form`/`solar` เดิมวนเช็คทีละ line — ถ้าสินค้าเดียวกัน+คลังเดียวกันถูกแยกหลาย line ผลรวม qty เกินสต็อก แต่ละ line ผ่านเดี่ยว ๆ → หลุด pre-check → ใบงาน POST แล้ว deduct fail-clean (369) / โอนซ้ำ
- **how:** helper pure `aggregateNeedByKey` (ไฟล์ใหม่ `modules/stock_precheck.js`) รวม qty ต่อ `product_id|warehouse_id`; loop dedup `_checkedKeys` (เช็ค/โอนครั้งเดียวต่อ key) + ใช้ยอดรวมแทน `it.qty` — single-line เหมือนเดิมเป๊ะ (กัน over-block regression); floor 367/369 ยังเป็น backstop
- **scope:** ❌ ไม่แตะ Part 1 `isHome`→throw (370) · non-home throw · confirm-transfer dialog · deduct/transfer logic (369/368) · POST/JV/schema · **test:** +8 `service_job_precheck_aggregate_guard.test.js` (behavioral aggregator + wiring 3 ไฟล์), unit 1098, e2e 11 · **pwa-cache:** bump 371→372

## 5.66.0 (build 371) — 2026-06-05 Phase 371 revert-out-of-scope-stock-unresolved-flag — ถอด Part 2 (STOCK_UNRESOLVED flag) ที่เกินสเปก

- **fix (scope correction):** Phase 370 ใส่ "Part 2" reconcile-flag (post-save PATCH `service_jobs` note += `⚠️[STOCK_UNRESOLVED]`) เข้ามาทั้งใน `ac_install`/`service_form`/`solar` + test ทั้งที่ owner สั่งให้ทำ **Part 1 อย่างเดียว** รอบนี้ → ถอด Part 2 ออกให้หมด
- **how:** ลบ Part 2 block (คอมเมนต์ + `if (jobId) { try { ...PATCH... } catch {} }`) ออกจาก `if (stockOpsFailed)` ทั้ง 3 ไฟล์ → block กลับไปเหลือแค่ `showToast?.(...)` **byte-identical กับ build 369** (ยืนยันด้วย `git diff 67834c9 HEAD -- modules/*` เหลือเฉพาะ Part 1). test ตัว Part 2 พลิกเป็น **absence-assert** (กัน flag กลับมา)
- **kept (ไม่แตะ):** Part 1 (`isHome` → `throw` block ก่อน POST) คงไว้ทั้ง 3 ไฟล์ · non-home throw · `transfersNeeded` · confirm-transfer dialog · deduct/transfer logic (369/368) · POST payload/endpoint/status/auto-post JV · POS/cart/accounting/schema/SQL
- **note:** forward commit (build 371) — ❌ ไม่ใช้ `git revert e852c78` (จะลบ Part 1 ทิ้งด้วย) · **test:** `service_job_block_save_guard.test.js` 12 (Part 2 → absence), unit 1090, e2e 11 · **pwa-cache:** bump 370→371

## 5.66.0 (build 370) — 2026-06-05 Phase 370 service-job-block-save-on-insufficient — block save เมื่อคลังบ้านไม่พอ + flag reconcile

- **fix (severity สูง — oversell/สต็อก §4.1/4.2):** pre-save stock check ใน `ac_install` / `service_form` / `solar` เดิม `if (isHome) continue;` ทำให้เคส **"user เลือกคลังบ้าน แล้วบ้านไม่พอ"** ถูกข้าม → ใบงานถูก POST → Phase 369 deduct fail-clean (ไม่เขียนติดลบ) แต่ผลคือ **"ใบงาน save แล้ว แต่สต็อกไม่ถูกตัด"** เตือนแค่ toast
- **how (part 1, hard block):** `if (isHome) continue;` → `throw new Error("❌ {ชื่อ}: ของไม่พอ — คลังบ้านมี X, ต้องใช้ Y (เติมสต็อกก่อนบันทึก)")` — throw ถูก catch โดย save handler เดิม → statusEl โชว์ error + ปุ่ม re-enable (finally เดิม) → **ไม่มี POST** (ไม่เกิดใบงาน)
- **how (part 2, best-effort reconcile):** ในบล็อก `stockOpsFailed` (race: cache ผ่าน pre-check แต่ DB CAS เจอไม่พอ หลัง save) → PATCH `service_jobs` note += `⚠️[STOCK_UNRESOLVED ตัดสต็อกไม่ครบ]` (slice 500) ด้วย config/token เดียวกับ POST ในไฟล์นั้น (ac_install/solar = `cfg`; service_form = `supaCfg`) — `try/catch`, PATCH ล้ม → `console.warn` เท่านั้น (**ไม่ throw / ไม่ rollback / ไม่ลบใบงาน**); ยังคง `showToast` เดิม
- **scope:** ❌ ไม่แตะ non-home throw (mobile short + บ้านโอนไม่ไหว) · confirm-transfer dialog · deduct/transfer logic (369/368) · `_applyStockMovement`/`_atomicDecrementStock`/`stock_cas.js` · ลำดับ save→stock-ops (reorder) · POST payload/endpoint/status workflow/auto-post JV/quotation · schema/RLS/SQL/POS/cart/accounting · **test:** +12 `service_job_block_save_guard.test.js`, unit 1090, e2e 11 · **pwa-cache:** bump 369→370
- **known risk:** race window เล็กลงแต่ไม่หมด (flag เป็น best-effort, PATCH เองก็ล้มได้ → warn); per-product aggregation ข้ามหลาย item ในใบเดียว = future; atomicity จริง (reorder/DB RPC) = future

## 5.66.0 (build 369) — 2026-06-04 Phase 369 fix-applystockmovement-oversell-floor — floor out/sale ของ service-job auto-deduct

- **fix (severity สูง — oversell/สต็อก §4.1/4.2):** `_applyStockMovement` (`main.js`; ใช้โดยฟอร์ม stock_movements + **service-job auto-deduct** ใน ac_install/service_form/solar ผ่าน `movementType:"out"`) เดิม out/sale ใช้ `_atomicAddStock(delta ติดลบ)` **ไม่มี floor** → floor 367(POS)/368(transfer) **ไม่ครอบเส้นนี้** → งานบริการตัดเกินสต็อก = **เขียนค่าติดลบเงียบ ๆ** (น่าจะต้นเหตุ `warehouse_stock` product 1809 = **-1**)
- **how:** เพิ่ม param `allowNegative = false`. out/sale (default) ตัดผ่าน `_atomicDecrementStock` (floor 367 + CAS) ทั้ง `warehouse_stock` + `products` mirror — `dec.insufficient` → `return {ok:false, insufficient:true, error:"สต็อกคลังไม่พอ (เหลือ X)"}` **ทันทีก่อน** log `stock_movements` (ไม่ log หลอกว่าตัดสำเร็จ); ไม่มี ws row → `return "คลังนี้ไม่มีสินค้านี้ (สต็อก 0)"` **ห้าม insert row ติดลบ** (ขนานกับ transfer 368)
- **how (override):** ฟอร์ม stock_movements ส่ง `allowNegative:true` (มี confirm "จะติดลบ — บันทึกต่อ?" อยู่แล้ว = admin จงใจ) → คง `_atomicAddStock`/insert เดิมทุกอย่าง. ac_install/service_form/solar **ไม่ต้องแก้** (พึ่ง default → floored; เช็ค `!r.ok → stockOpsFailed` อยู่แล้ว = fail-clean)
- **scope:** ❌ ไม่แตะ `in`/`return` (additive เดิม) · `adjust` (absolute set เดิม) · `_deductStockForSaleItem` (POS) · `_transferWarehouseStock` (368) · `stock_cas.js` helper · CAS retry/race · return shape เดิม `{ok,error}` (เพิ่ม `insufficient` แบบ additive) · schema/RLS/SQL/POS/cart/accounting · **test:** +10 `apply_stock_movement_floor.test.js`, unit 1078, e2e 11 · **pwa-cache:** bump 368→369
- **known risk:** manual override (`allowNegative`) ยังตั้งใจให้ติดลบได้; service-job ยัง **save ได้** แม้ deduct fail (การบล็อก save = P2 follow-up แยก); atomicity ข้าม 2 row ของ transfer ยัง client-side (368)

## 5.66.0 (build 368) — 2026-06-04 Phase 368 harden-warehouse-transfer-cas-floor — CAS+floor+rollback ตอนโอนสต็อกระหว่างคลัง

- **fix (severity สูง — oversell/สต็อก §4.1/4.2):** `_transferWarehouseStock` (ปุ่ม "โอนบ้าน→รถ" ใน ac_install/service_form/solar + transfer modal หน้า stock_movements) เดิมใช้ **raw `xhrPatch` ทั้ง 2 ฝั่ง ไม่เช็ค `.ok`** — และเพราะ `xhrPost/xhrPatch` **resolve `{ok:false}` ไม่ throw** → `try/catch` จับ error ไม่ติด + **ไม่มี floor** → โอนเกินต้นทาง = **เขียนค่าติดลบ**, race, ปลายทางล้ม = **ของหาย**
- **how:** (0) normalize `transferQty = Number(qty)` ใช้ตลอด (กัน string "5"). (1) source → `_atomicDecrementStock` (floor จาก 367 กันติดลบ + CAS กัน race); ไม่มี source row → `"คลังต้นทางไม่มีสินค้านี้"` (**ห้ามสร้าง row ต้นทาง**); `!dec.ok` → `{ok:false, insufficient, error:"สต็อกต้นทางไม่พอ (เหลือ X)"}`. (2) target → มี id ใช้ `_atomicAddStock`; ไม่มี → `xhrPost(returnData:true)` แล้ว push row `{id:res.data.id,...}` เข้า cache (มี id จริง)
- **how (atomicity):** (3) **rollback เฉพาะกรณี target ล้ม หลัง source ตัดสำเร็จ** → คืน source. (5) **log movement = best-effort** (try/catch) — log ล้ม → `warn` แต่ **ยัง `ok:true` ❌ ห้าม rollback** (rollback ตอน log ล้ม = source คืนแต่ target เพิ่มไปแล้ว = เพี้ยนหนักกว่าเดิม)
- **scope:** ❌ ไม่แตะ `products.stock` (โอนระหว่างคลัง = ผลรวมไม่เปลี่ยน → ถูกแล้ว) · CAS internal · return shape เดิม `{ok,error}` (เพิ่ม `insufficient` เท่านั้น — caller ac_install/service_form/solar/stock_movements พึ่งอยู่) · schema/RLS/SQL/POS/cart/accounting/transfer UI (P2) · **test:** +8 `warehouse_transfer_cas.test.js`, unit 1069, e2e 11 · **pwa-cache:** bump 367→368
- **known risk:** atomicity ข้าม 2 row ยัง best-effort client-side (robust จริง = DB RPC/transaction ภายหลัง)

## 5.66.0 (build 367) — 2026-06-04 Phase 367 fix-stock-oversell-negative-guard — floor CAS decrement กันสต็อกติดลบ

- **fix (severity สูง — oversell/สต็อก §4.1/4.2):** `atomicDecrementStock` เขียน `after = before - qty` **โดยไม่เช็ค before ≥ qty** → ขายเกินสต็อก = **เขียนค่าติดลบ** (พบจริง: `warehouse_stock` product 1809 = **-1**)
- **how:** ใส่ **floor ที่ CAS เป็น last line of defense** — ก่อนคำนวณ `after` ทุก attempt ถ้า `before < qty` → `return { ok:false, insufficient:true, before, error:"insufficient ..." }` **ไม่ PATCH / ไม่เขียนติดลบ**. ถ้า CAS refetch รอบใหม่เจอ stock ต่ำกว่า qty (มีคนตัดไปก่อน) ก็ fail insufficient แทน retry ต่อ
- **how (caller):** `_deductStockForSaleItem` (`main.js`): `dec.insufficient` → toast ชัด **"⚠️ สต็อกไม่พอ: {ชื่อ} (เหลือ X)"**; logic `skipProductsCas` เดิม (`stocks.length>0 && !dec.ok`) ครอบ products.stock อยู่แล้ว
- **scope:** ❌ ไม่แตะ CAS retry/race เดิม · `atomicAddToField` (credit) · pre-checkout/cart/products↔warehouse sync (**Phase B แยก**) · schema/RLS/SQL (data fix ตัวติดลบ + CHECK constraint = **owner รันแยก**) · **test:** +4 `stock_cas.test.js` (20 total), unit 1061, e2e 11 · **pwa-cache:** bump 366→367

## 5.66.0 (build 366) — 2026-06-04 Phase 366 fix-loadalldata-1000-row-cap — แก้บั๊กโหลดได้แค่ 1000 แถว/ตาราง

- **fix:** `loadAllData` เคยโหลดได้แค่ **1000 แถว/ตาราง** (PostgREST default `max-rows=1000`) → `products` ใน DB = 1075 แต่แอปโหลด 1000 = **หาย 75 ตัว** (ขายไม่ได้/นับผิด); `warehouse_stock` (สินค้า×คลัง) อาจหลายพัน → **stock เพี้ยน + "หมดสต็อก" พองปลอม**
- **how:** ไฟล์ใหม่ `modules/fetch_paginated.js` — pure exported `fetchAllPaginated(queryFn, pageSize=1000)` วนโหลดด้วย `.range(from,to)` จนครบ (`data.length < pageSize` หรือว่าง → break; error → throw ไม่กลืน). `main.js` `loadAllData`: **products / customers / warehouse_stock** ใช้ helper; `warehouse_stock` **เพิ่ม stable `.order("id")` ก่อน `.range()`** (เดิมไม่มี order = ข้ามหน้าซ้ำ/หาย); helper คืน array ตรง ๆ → ใช้ `valArr` (paginated) vs `val` ({data})
- **scope:** ❌ ไม่แตะ query `.limit(50)` เจตนา (sales/quotations/serviceJobs/receipts/deliveryInvoices) · ❌ schema/RLS/SQL/server config · ❌ stock-CAS/POS/cart/accounting/payroll logic · state shape เดิม (array, แค่ครบขึ้น) · **test:** +8 `load_all_pagination.test.js`, unit 1057, e2e 11 · **pwa-cache:** bump 365→366

## 5.66.0 (build 365) — 2026-06-04 Phase 365 team-center-documents-list-category-readonly — หมวด "เอกสาร" ในมุมมอง list (read-only)

- **feat:** เพิ่ม filter category **"เอกสาร"** (วางหลัง "รออนุมัติ") ในมุมมอง list — รวม 3 ชนิด ใบเสนอราคา+ใบเสร็จ+ใบส่งของ (`categoryOf` case documents → `mergeRecentDocs` wrapper `{it,type}`); ใช้ **search / date-range / sort / export** ได้ครบ (pipeline แยก `renderDocsListBody` พก per-item type, อ่าน `w.it`)
- **feat:** เติม branch receipt/delivery ใน pure helper เดิม: `itemSearchText` (receipt_no/inv_no), `amountOf` (grand_total), `mdItemLine`; `sortDocs` clone `[...wrappers]` ก่อน sort (ไม่ mutate); overview recent group "เอกสารล่าสุด" + ปุ่ม "ดูทั้งหมด" → documents
- **honesty:** stats หมวดเอกสาร = **นับตามชนิด + นับตามสถานะ** + ป้าย ≤50 — **ไม่มี "ยอดรวม" ข้ามชนิด** (ข้อเสนอ ≠ เงินจริง = หลอกตา)
- **scope:** single-type categories เดิมไม่กระทบ (path แยก) · drill-down read-only (receipt→receipts, delivery→delivery_invoices) · ❌ fetch/POST/PATCH/PUT/DELETE · ❌ mutate state · ❌ POS/stock/accounting/payroll/service · admin-only · **test:** guard 24→28, unit 1049, e2e 11 · **pwa-cache:** bump 364→365

## 5.66.0 (build 364) — 2026-06-03 Phase 364 team-center-recent-documents-merge-readonly — รวมเอกสารล่าสุดหลายชนิด (read-only)

- **feat:** recent group **"เอกสารล่าสุด"** (overview) รวม 3 ชนิด: ใบเสนอราคา (quotations) + ใบเสร็จ (receipts) + ใบส่งของ (deliveryInvoices) — merge read-only (`mergeRecentDocs`: tag doc-type ต่อ item ผ่าน `.map`, spread, sort `created_at` desc บน array ใหม่ ไม่ mutate state), เอา top 3; แต่ละแถว: doc-type badge chip + เลขที่ (receipt_no/inv_no/#id) + ลูกค้า + ยอด + วันที่ + status chip
- **feat:** `rowHtml`/`findItem`/`detailHtml` รองรับชนิด **receipt** (→ route `receipts`) + **delivery** (→ route `delivery_invoices`) — drill-down read-only, ปุ่ม "ไปหน้าต้นทาง" navigate เท่านั้น; field ไม่มี → "—"
- **scope:** ไม่ทำ stretch list-category (เลี่ยงความเสี่ยง refactor pipeline) · ❌ fetch/POST/PATCH/PUT/DELETE · ❌ mutate state · ❌ save/approve/submit/delete · ❌ POS/stock/accounting/payroll/service · admin-only · **test:** guard 21→24, unit 1045, e2e 11 · **pwa-cache:** bump 363→364

## 5.66.0 (build 363) — 2026-06-03 Phase 363 team-center-aggregate-summary-readonly — สรุป aggregate (read-only)

- **feat:** เพิ่ม pure helper `summarizeStats(items, type)` → `{byStatus, count, amountSum}` (reduce อ่านอย่างเดียว; `amountSum` เฉพาะ quote, type อื่น null)
- **feat:** **stats bar** เหนือ list หมวดที่ผูกวันที่ (ใบเสนอราคา/งานบริการ) คิดจากรายการที่กรอง (search+date+sort): chips นับตามสถานะ (เรียง `statusRank`) + chip ยอดรวม(ที่กรอง) เฉพาะ quote + ป้ายบังคับ **"📊 จากรายการที่กรอง · ข้อมูลที่โหลดล่าสุด ≤50 ไม่ใช่ยอดทั้งระบบ"**; ไม่มีรายการ → ไม่โชว์ chip (ไม่ hardcode 0)
- **feat:** markdown export (`buildListSummary`) มี stats block + ป้าย ≤50 เหนือรายการ; overview เพิ่ม mini status breakdown ของ quotations + ป้ายเดียวกัน
- **scope:** CSS อยู่ใน shared style block (`.team-stats-bar`, wrap ได้) · ❌ fetch/POST/PATCH/PUT/DELETE · ❌ mutate state (reduce-only; sort เดิม clone `[...items]`) · ❌ POS/stock/accounting/payroll/service · admin-only · **test:** guard 18→21, unit 1042 · **pwa-cache:** bump 362→363

## 5.66.0 (build 362) — 2026-06-03 Phase 362 team-center-datepreset-input-clear — read-only UX fix

- **fix:** กดปุ่ม date preset (วันนี้/7วัน/...) หลังพิมพ์ custom from/to → เคลียร์ค่าช่อง `#teamDateFrom`/`#teamDateTo` ใน DOM ด้วย (เดิม reset แค่ตัวแปร `_dateFrom`/`_dateTo` แต่ input ยังโชว์ค่าค้างเพราะ `refreshListBody` re-render เฉพาะ `#teamListBody`) — **cosmetic, การกรองเดิมถูกต้องอยู่แล้ว**
- **scope:** ไม่แก้ logic filter/sort/search/export · read-only คงเดิม · ❌ fetch/POST/PATCH/PUT/DELETE · ❌ mutate state · ❌ POS/stock/accounting/payroll/service · admin-only · **test:** +1 regression (guard 17→18), unit 1039 · **pwa-cache:** bump 361→362

## 5.66.0 (build 361) — 2026-06-03 Phase 361 team-center-date-range-and-export-readonly — เพิ่ม date-range + recent groups + export (read-only)

- **feat:** **date-range filter** ในมุมมอง list หมวดที่ผูกวันที่ (ใบเสนอราคา/งานบริการ) — preset วันนี้/7วัน/30วัน/เดือนนี้/ทั้งหมด + custom from/to; กรองจาก `created_at` เดิมใน memory (`dateInRange` ใช้ `dateKeyBkk`), ไม่ fetch
- **feat:** **recent groups** บน overview (อ่านอย่างเดียว): งานล่าสุด / เอกสารล่าสุด / ลูกค้าล่าสุด / สินค้าล่าสุด (top 3, กดดูรายละเอียด / ดูทั้งหมด)
- **feat:** **export Markdown** — `buildListSummary` (รายการปัจจุบันตาม filter/search/date/sort) + `buildOverviewSummary` (สรุปภาพรวม) → **คัดลอกเข้า clipboard เท่านั้น** (ไม่สร้างไฟล์/ไม่ upload/ไม่ POST)
- **scope:** drill-down ยัง read-only (ไม่มี save/approve/submit/delete) · sort ยัง clone `[...items]` · date/search/sort/filter wrap ได้ · ❌ fetch/POST/PATCH/PUT/DELETE · ❌ mutate state · ❌ POS/stock/accounting/payroll/service · ❌ ไม่เปิด sales/customer · **test:** guard 14→17, unit 1038 · **pwa-cache:** bump 360→361

## 5.66.0 (build 360) — 2026-06-03 Phase 360 team-center-list-search-polish — เพิ่ม search/sort/list polish (read-only)

- **feat:** **search box** ใต้ filter chips ในหน้า "ศูนย์ทีม AI" — ค้นจาก `ctx.state` ใน memory (เลขเอกสาร/ลูกค้า/สถานะ/source/รุ่น-BTU); ไม่ fetch/ไม่ save query; ไม่พบ → "ไม่พบรายการตามคำค้นนี้"
- **feat:** **sort** (ล่าสุดก่อน / เก่าสุดก่อน / ยอดเงินมากก่อน / สถานะ-ความสำคัญ) — ทำใน memory, **clone array (`[...items]`) ก่อน sort เสมอ** ไม่ mutate state
- **ui:** เรียง overview cards ใหม่ตาม priority (งานที่ต้องดู → รออนุมัติ → งานแอร์ → เอกสารล่าสุด → ลูกค้า → สินค้า); list rows แสดงเป็นรายการจริงขึ้น (title/เลขเอกสาร + subtitle + status/date/amount/source chips, กดแถว=ดูรายละเอียด)
- **prompt:** prompt generator มีบริบทขึ้น (`[ประเภท]` + เลข/ลูกค้า/สถานะ + สิ่งที่ควรตรวจ) — ยัง clipboard/text draft เท่านั้น
- **perf/ux:** re-render เฉพาะ `#teamListBody` ตอน search/sort (คง focus ช่องค้นหา); search/sort/filter wrap ได้
- **scope:** drill-down ไม่มี save/approve/submit/delete · ❌ ไม่ fetch/POST/PATCH/PUT/DELETE · ❌ ไม่ mutate state · ❌ ไม่แตะ POS/stock/accounting/payroll/service · ❌ ไม่เปิด sales/customer · **test:** guard 12→14, unit 1035 · **pwa-cache:** bump 359→360

## 5.66.0 (build 359) — 2026-06-03 Phase 359 team-center-owner-action-surface — เพิ่ม read-only action surface (filter/drill-down/prompt)

- **feat:** หน้า **"ศูนย์ทีม AI"** เพิ่ม **filter chips** (ทั้งหมด/รออนุมัติ/งานต้องดู/งานแอร์/ลูกค้า/สินค้า) — กรองใน memory จาก `ctx.state` เท่านั้น (ไม่ fetch); หมวดว่าง → "ยังไม่มีรายการในหมวดนี้"
- **feat:** **drill-down modal (read-only)** — กด row เปิด panel แสดง เลขเอกสาร/ลูกค้า/สถานะ/วันที่/ยอดเงิน/source เท่าที่มีจริง (ไม่มี → "—"); ปุ่มเฉพาะ **ไปหน้าต้นทาง (`showRoute`) / คัดลอก prompt / ปิด** — ไม่มี save/approve/submit จริง
- **feat:** **owner prompt generator** (`buildPrompt`) สร้าง text draft ต่อรายการ → copy clipboard เท่านั้น (ไม่ส่ง network/ไม่ save DB)
- **wording:** subtitle "มุมมองอ่านอย่างเดียวสำหรับเจ้าของร้าน" · Team Chat → "บันทึก Draft / Prompt" · integration คง "ยังไม่เชื่อมต่อ · รอ owner อนุมัติ"
- **layout:** filter wrap ได้ · modal z-index 9995 เหนือ bottom nav/FAB · max-height + scroll บนมือถือ · reuse `money`/`formatDate`/`parseAirJobMeta`
- **scope:** ❌ ไม่ fetch/POST/PATCH/PUT/DELETE · ❌ ไม่ mutate state · ❌ ไม่แตะ POS/stock/accounting/payroll/service · ❌ ไม่เปิด sales/customer · **test:** guard 9→12, unit 1033 · **pwa-cache:** bump 358→359

## 5.66.0 (build 358) — 2026-06-03 Phase 358 team-center-ui-polish-readonly — ปรับ "ศูนย์ทีม AI" เป็น owner dashboard (ยัง read-only)

- **ui:** เปลี่ยนหน้า **"ศูนย์ทีม AI"** จาก game/avatar board → **owner dashboard** ด้วย work cards จาก `ctx.state` จริง: รออนุมัติใบเสนอราคา / งานที่ต้องดู / งานบริการ-แจ้งซ่อม / **งานแอร์จากแคตตาล็อก** (reuse `parseAirJobMeta`) / ลูกค้า / สินค้า / เอกสารล่าสุด — กดการ์ด → `showRoute` ไปหน้าจริง
- **honesty:** field ที่ไม่มีจริง → "ยังไม่มีข้อมูล" (ไม่ hardcode 0) · ลบ avatar/room/desk/map/dot ออกหมด · integration 6 ช่อง = placeholder **"ยังไม่เชื่อมต่อ · รอ owner อนุมัติ"** (ไม่มี OAuth/token/connector) · ผู้ช่วย AI = label **"ตัวอย่าง"** · Team Chat → **"บันทึกย่อ/Draft ในหน้านี้เท่านั้น"** (ไม่ส่งหา AI/ไม่ save DB)
- **layout:** overflow-safe — auto-fill `minmax()` grids, `min-width:0`, `word-break`, `max-width:100%`, ไม่ใช้ `vw`, มี mobile breakpoint 640px
- **scope:** ❌ ไม่ fetch/POST/PATCH/PUT/DELETE · ❌ ไม่ mutate state · ❌ ไม่แตะ POS/stock/accounting/service workflow · ❌ ไม่เปิด sales/customer · **test:** guard 8→9 (เพิ่ม layout-overflow), unit 1030 · **pwa-cache:** bump 357→358

## 5.66.0 (build 357) — 2026-06-03 Phase 357 team-center-readonly — หน้าใหม่ "ศูนย์ทีม AI" (admin-only, read-only)

- **feat:** เพิ่มหน้า **"🧠 ศูนย์ทีม AI"** (route `team_center`, `modules/team_command_center.js`) — dashboard ภาพรวมทีมสำหรับเจ้าของ แบบ **read-only** ดึงตัวเลขจาก `ctx.state` ที่โหลดแล้วเท่านั้น (ใบเสนอราคารออนุมัติ / งานช่างเปิด / บิลวันนี้ / ลูกค้า / สินค้า)
- **honesty:** field ที่ไม่มีจริงใน state (`tasks`/`auditLog`) แสดง **"—"/"ยังไม่มีข้อมูล"** ไม่ hardcode 0 หลอกตา · integration 6 ช่อง (Notion/Gmail/Drive/Meta/Google Ads/Codex) = placeholder **"ยังไม่เชื่อมต่อ · รอ owner อนุมัติ"** (ไม่มี live integration จริง) · agent 6 ตัว label **"ตัวอย่างบทบาททีม (concept)"**
- **scope:** **admin-only** (ไม่อยู่ใน sales/customer role) · team chat = local draft (ไม่ save DB) · ปุ่ม = copy prompt / navigate เท่านั้น · ❌ ไม่ fetch · ❌ ไม่ POST/PATCH/PUT/DELETE · ❌ ไม่ mutate state · ❌ ไม่แตะ POS/stock/accounting/service workflow · **test:** +8 `team_center_readonly_guard.test.js` (unit 1029) · **pwa-cache:** bump 356→357

## 5.66.0 (build 356) — 2026-06-02 Phase 356 quotation-save-inflight-guard — กันกดบันทึกใบเสนอราคารัว/ดับเบิลคลิก

- **fix:** กดปุ่ม **"บันทึก"** ใบเสนอราคารัว/ดับเบิลคลิก (โดยเฉพาะ flow งานแอร์ build 353-355) เคยอาจสร้าง **เอกสารซ้ำ** เพราะ `saveQuotationFull` async ไม่มี inflight guard → กดก่อน `await xhrPost` รอบแรกเสร็จ = POST สองครั้ง
- **how:** module flag `_qtSaveInflight` — เช็คตอนต้น (กดซ้ำ → toast "กำลังบันทึก..." แล้ว return), set true **หลังผ่าน validation เบื้องต้น**, disable ปุ่ม `qtSaveBtn`, ครอบด้วย **try/finally** reset flag + enable ปุ่มกลับเสมอ (แม้ xhr/loadAllData fail)
- **scope:** ❌ ไม่เปลี่ยน payload/endpoint/save semantics เดิม · ❌ ไม่เปลี่ยน service job status · ❌ ไม่ POST/PATCH `service_jobs` · ❌ ไม่แตะ stock/POS/cart/products/schema/SQL · ❌ ไม่ auto-save (user กดเอง) · Phase 355 note link-back ยังอยู่ · **test:** +11 `quotation_save_inflight_guard.test.js` (unit 1021) · **pwa-cache:** bump 355→356

## 5.66.0 (build 355) — 2026-06-02 Phase 355 air-quotation-save-linkback — อ้างอิงงานต้นทางลงใน note ตอนกดบันทึก

- **feat:** กด **"บันทึก"** ใบเสนอราคาที่มาจากงานแอร์ (`source=air_job`) → append บรรทัดอ้างอิงงานต้นทางลงใน **note (field เดิม)** เพื่อ trace ได้ว่ามาจากงานแอร์ใด
- **format:** `สร้างจากงานแอร์: {เลขงาน} | {สั่งจอง·สอบถามราคา} | {แบรนด์ รุ่น BTU} | ราคาเสนอ {price} บาท` (fallback **"สร้างจากงานแอร์จากแคตตาล็อก"** เมื่อไม่มี `serviceJobId`)
- **safety:** inject เฉพาะตอน **กดบันทึกเอง** (ไม่ auto-save/ไม่ก่อนกด) · **preserve note เดิมของผู้ใช้** แล้ว append ต่อท้าย · **กัน duplicate** ด้วย marker check (กด save ซ้ำ / แก้เอกสารเดิม ไม่เพิ่มซ้ำ) + เคลียร์ `_airDraftMeta` หลังบันทึก
- **scope:** ❌ ไม่เปลี่ยน service job status · ❌ ไม่ POST/PATCH `service_jobs` (ปุ่ม "ดูงานต้นทาง" ยัง navigation เท่านั้น) · ❌ ไม่แตะ stock/products/POS/cart · ❌ ไม่แก้ SQL/schema (ใช้ note เดิม) · ❌ ไม่เปลี่ยน save endpoint · ไม่กระทบ draft 346/action·polish 353-354 · `buildAirJobNoteRef`/`appendAirJobNoteRef` = pure exported helpers · **test:** +13 `air_quotation_save_linkback.test.js` + browser smoke · **pwa-cache:** bump 354→355

## 5.66.0 (build 354) — 2026-06-02 Phase 354 quotation-air-draft-polish — ขัดเกลาหน้าใบเสนอราคาตอนรับ draft จากงานแอร์

- **ux:** banner **"รายการร่างจากงานแอร์"** + **source summary chips** (งานเลขที่ / intent สั่งจอง·สอบถามราคา / รุ่น·BTU·ราคา / 📅 นัดหมาย)
- **ux:** customer prefill + hint *"ℹ️ เติมจากงานแจ้งบริการ — ตรวจสอบ/แก้ไขได้ (ยังไม่บันทึกลูกค้าใหม่)"* — **ไม่สร้าง/ไม่ save customer อัตโนมัติ**
- **ux:** ปุ่ม **"🔧 ดูงานต้นทาง"** (เฉพาะมี `serviceJobId`) → กลับหน้า `service_jobs` (navigation เท่านั้น — ไม่เปลี่ยนสถานะงาน)
- **safety:** ถ้า draft ไม่มีราคา (ต้องเช็คราคา) → **คำเตือน "⚠️ ยังไม่มีราคา — กรุณากรอกราคาก่อนส่งให้ลูกค้า"** (ไม่ใส่ 0 หลอกว่าฟรี) · consume-once กัน reload เติมซ้ำ (เดิม)
- **scope:** ❌ ไม่ save quotation/สร้างเลขเอกสารอัตโนมัติ · ❌ ไม่แตะ stock/products/POS/cart/schema · ❌ ไม่เปลี่ยน save endpoint · ❌ ไม่กระทบ draft 346 (catalog banner ยังเป็น "แคตตาล็อกแอร์")/filter·priority·action 351-353 · `ac_quotation_draft`+`service_jobs` ส่ง `serviceJobNo` เพิ่ม · **test:** +7 `air_job_quotation_draft.test.js` + mobile/desktop smoke · **pwa-cache:** bump 353→354

## 5.66.0 (build 353) — 2026-06-02 Phase 353 air-job-to-quotation-draft-action — ปุ่ม "สร้างใบเสนอราคา" จากงานแอร์

- **feat:** งานจากแคตตาล็อกแอร์ในหน้า `service_jobs` มีปุ่ม **"📝 ใบเสนอราคา"** → ส่งข้อมูลงานไปหน้าใบเสนอราคาเป็น **draft** (ใช้ build 346 mechanism, `source="air_job"`) — งานทั่วไป**ไม่มี**ปุ่มนี้
- **safety:** **ไม่ save quotation อัตโนมัติ · ไม่สร้างเลขเอกสาร** — user กด "บันทึก" เองในหน้าใบเสนอราคา · consume-once กัน reload เติมซ้ำ
- **how:** `ac_quotation_draft.js` `pushAirQuoteDraft` รองรับ `source`/`originalSource`/`serviceJobId`/`customerName`/`customerPhone`/`summary`/`intent`/`appointment` (additive, backward-compatible build 346) · `quotations.js` แสดง notice **"รายการร่างจากงานแอร์"**, line item ใช้ summary, prefill ลูกค้า name/phone (เฉพาะสร้างใหม่)
- **scope:** ❌ ไม่แตะ stock/products/POS/cart · ❌ ไม่ตัด/เพิ่ม stock · ❌ ไม่แก้ SQL/schema · ❌ ไม่เปลี่ยน workflow/status งาน · ❌ ไม่กระทบ quotation draft (346)/customer dashboard·service_request (347-350)/filter·priority (351-352) · **test:** +6 `air_job_quotation_draft.test.js` + mobile/desktop smoke · **pwa-cache:** bump 352→353

## 5.66.0 (build 352) — 2026-06-02 Phase 352 air-job-filter-and-priority — กรอง + priority งานจากแคตตาล็อกแอร์

- **feat:** หน้า `service_jobs` เพิ่ม **filter ที่มา**: ทั้งหมด / 🌬️ จากแคตตาล็อกแอร์ / 🔧 งานทั่วไป (โชว์เมื่อมีงานแอร์อย่างน้อย 1) — ช่วยเจ้าของร้าน/ช่างหางานแอร์ได้เร็ว
- **feat:** **priority badge** บนงานแอร์ (derive จาก note/intent/appointment เดิม): `มีวันนัดหมาย` (มี date/ช่วงเวลา) · `รอยืนยันราคา` (intent สอบถามราคา) · `รอนัดหมาย` (intent สั่งจอง) · `รอตรวจสอบ` (ข้อมูลไม่ครบ)
- **how:** `air_job_meta.js` + `airPriority(meta)`/`airPriorityBadgeHtml` (READ-ONLY — ไม่แตะ status จริงของงาน); `service_jobs.js` `_sjSourceFilter` (all/air/general) filter ผ่าน `parseAirJobMeta().isAir`
- **scope:** ❌ ไม่แก้ SQL/schema · ❌ ไม่แตะ stock/POS/cart/products · ❌ ไม่เปลี่ยน submit endpoint · ❌ ไม่กระทบงานทั่วไป (ไม่มี badge) · ❌ ไม่สร้างใบเสนอราคาอัตโนมัติ · **test:** +4 `air_job_meta.test.js` + mobile/desktop smoke · **pwa-cache:** bump 351→352

## 5.66.0 (build 351) — 2026-06-02 Phase 351 service-job-air-source-visibility — เห็นงานจากแคตตาล็อกแอร์ในรายการงาน

- **feat:** รายการงาน (งานช่าง admin + "งานของฉัน" ลูกค้า) แสดง **badge "🌬️ จากแคตตาล็อกแอร์ · สั่งจอง/สอบถามราคา"** + กล่องสรุป **รุ่น/BTU/ราคาเสนอ/นัดหมาย** — เจ้าของร้าน/ช่าง/ลูกค้าเห็นที่มางานชัด
- **how:** ไฟล์ใหม่ `modules/air_job_meta.js` — `parseAirJobMeta(job)` **detect marker `source=air_catalog`** จาก `note` เดิม (best-effort regex, ไม่ crash ถ้าข้อมูลไม่ครบ) → `{isAir,intent,summary,btu,price,appointment}`; `airBadgeHtml`/`airJobInfoHtml` (escape XSS) — **READ-ONLY ไม่เพิ่ม DB column**
- **wire:** `service_jobs.js` (การ์ดงานช่าง) + `customer_dashboard.js` แท็บ "งานของฉัน" · งานทั่วไป/ออเดอร์เว็บ ไม่โดน badge · ซ่อน raw note ที่มี marker ในแท็บลูกค้า (กล่องสรุปแสดงแทน — ไม่โชว์ `[source=air_catalog]` ดิบ)
- **scope:** ❌ ไม่แตะ products/POS/cart/stock · ❌ ไม่ตัด/เพิ่ม stock · ❌ ไม่สร้างใบเสนอราคาอัตโนมัติ · ❌ ไม่แก้ SQL/schema · ❌ ไม่เปลี่ยน submit endpoint/workflow/สถานะงาน · ❌ ไม่กระทบ service_request ปกติ/quotation(346)/booking(347-350) · **filter chip เลื่อนเป็น phase ถัดไป** (ทำ badge/card ก่อน) · **test:** +8 `air_job_meta.test.js` + mobile/desktop smoke · **pwa-cache:** bump 350→351

## 5.66.0 (build 350) — 2026-06-02 Phase 350 service-request-air-form-polish — ขัดเกลา UX หน้าแจ้งงาน (เฉพาะมี air draft)

- **ux:** ช่อง **วันที่/ช่วงเวลา** มี placeholder/aria ชัด ("เลือกวันที่สะดวก", "เลือกช่วงเวลา (ไม่ระบุก็ได้)") + hint *"ยังไม่ระบุก็ได้ — เจ้าหน้าที่จะติดต่อยืนยันเวลานัดหมายอีกครั้ง"* (เลิกดูเหมือนกรอบ error)
- **ux:** ปุ่ม **"AI ช่วยแจ้งงาน"** — เมื่อมี air draft: ย้ายเป็น **secondary link ท้ายฟอร์ม** (ไม่แทรกกลาง flow); ไม่มี draft: คงปุ่มเด่นบนสุดเดิม
- **ux:** **ลดข้อความซ้ำ** — "รายละเอียดเพิ่มเติม" prefill สั้น (`จองติดตั้ง/สอบถามราคาแอร์ {brand} {model} {btu}`) ส่วนข้อมูลครบ (ประเภท/รุ่น/BTU/ราคา/สเปก/ประกัน/`source=air_catalog`) ย้ายไปอยู่ใน **หมายเหตุ** ที่ submit ส่งจริง
- **ux:** ช่อง **หมายเหตุ** เปลี่ยน `input`→`textarea` (min-height 56px, resize) — ข้อความยาวไม่ถูกตัด
- **ux:** **confirmation หลังส่ง** ชัดเจน: *"ส่งคำขอแล้ว! เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันราคาและเวลานัดหมาย"* + ปุ่ม **"📋 ดูงานของฉัน"** (→ customer_dashboard)
- **scope:** UX เฉพาะกรณีมี air_catalog draft — ❌ ไม่กระทบ service_request ปกติ · ❌ ไม่แตะ products/POS/cart/stock/quotation · ❌ ไม่แก้ SQL/schema · ❌ ไม่เปลี่ยน submit endpoint (POST service_jobs pending เหมือนเดิม) · **test:** +7 `service_request_air_form_polish.test.js` + mobile/desktop smoke · **pwa-cache:** bump 349→350

## 5.66.0 (build 349) — 2026-06-02 Phase 349 service-request-air-booking-polish — หน้าแจ้งงานรับ booking จากแคตตาล็อกแอร์ให้ชัด

- **ux:** หน้า `service_request` แสดง **กล่องสรุป "🌬️ รายการจากแคตตาล็อกแอร์"** — ประเภท / แบรนด์·รุ่น / BTU / ราคาเสนอ หรือ "ต้องเช็คราคา" / ประกัน / สเปก + chip intent (📅 สั่งจอง / 💬 สอบถามราคา) + disclaimer *"ยังไม่ใช่การซื้อจริง เจ้าหน้าที่จะยืนยันราคาและเวลานัดหมายอีกครั้ง — ยังไม่ได้ส่ง"*
- **ux:** **intent-aware** — heading + ปุ่ม submit เปลี่ยนตาม intent: `booking` → "📨 ส่งคำขอจอง / แจ้งงาน" · `ask_price` → "📨 ส่งคำขอสอบถามราคา" (ใช้ submit flow เดิม)
- **ux:** prefill ประเภทงาน=ติดตั้งแอร์ + รายละเอียด (airType/brand/model/BTU/ราคา/spec/`source=air_catalog`) + หมายเหตุ (รุ่น + note + ประกัน) · เพิ่มช่อง **นัดหมาย (วันที่ + ช่วงเวลา)** → map ลง `note` เดิม (**ไม่แก้ DB schema**)
- **chore:** booking draft (`ac_booking_draft.js` + customer_dashboard `_book`) พก `note`/`spec`/`warranty` เพิ่ม (additive — old drafts ไม่ crash)
- **scope:** ❌ ไม่แตะ stock/products/POS/cart · ❌ ไม่ตัดสต็อก/เพิ่มคลัง · ❌ ไม่สร้างใบเสนอราคาอัตโนมัติ · ❌ ไม่แก้ SQL/schema · ❌ ไม่กระทบ quotation draft (346)/booking (347/348) · submit = manual (POST service_jobs status pending เหมือนเดิม) · consume-once กัน reload เติมซ้ำ · **test:** +9 `service_request_air_booking.test.js` + mobile/desktop smoke · **pwa-cache:** bump 348→349

## 5.66.0 (build 348) — 2026-06-02 Phase 348 remove-customer-cart-tab-for-air-catalog — เอา tab "ตะกร้า" ออกจากหน้าร้านแอร์

- **ux:** เอา **tab "🛒 ตะกร้า"** ออกจาก customer dashboard (หน้าร้านแอร์ = flow **จอง/สอบถามราคา** ไม่ใช่ POS cart/checkout) — กันลูกค้าเข้าใจผิดว่าซื้อทันที · เหลือ tab: ร้านค้า / ประวัติซื้อ / งานของฉัน / แต้มสะสม
- **safety:** guard `if (_custTab === "cart") _custTab = "shop"` → สาขา cart/checkout เดิม **คงไว้ (dormant) ไม่ render** (ไม่ลบ logic)
- **ux:** ปุ่มการ์ดยังเป็น "📅 สั่งจอง" (พร้อมเสนอขาย) / "💬 สอบถามราคา" (ต้องเช็คราคา) → booking draft → service_request (build 347) — **ไม่ addToCart/saveCustCart/checkout/ตัด stock**
- **ux(mobile):** ซ่อน floating help 💡 (`#bs-help-fab`) บน route `customer_dashboard` (กันทับการ์ด) — คนละปุ่มกับ AI `#bs-ai-fab`
- **scope:** ❌ ไม่ลบ cart/POS logic ทั่วระบบ (`pos.js` + `saveCustCart` คงไว้) · ❌ ไม่กระทบ POS/งานขายจริง/stock/products/Supabase/SQL · ❌ ไม่กระทบ quotation draft (346) / booking draft (347) · **test:** +4 `air_catalog_store_sync.test.js` + mobile/desktop smoke · **pwa-cache:** bump 347→348

## 5.66.0 (build 347) — 2026-06-02 Phase 347 air-catalog-public-store-sync — หน้าร้านอ่านแคตตาล็อกแอร์ชุดเดียวกัน (สั่งจอง ไม่ใช่ตะกร้า)

- **feat:** หน้าหลัก/customer dashboard แสดงรายการแอร์จาก **แคตตาล็อกชุดเดียวกัน** (`bsk_ac_catalog`) กับหน้า "จัดการแคตตาล็อกแอร์" — **แยกจากคลังจริง 100%**
- **ux:** filter ตาม **ประเภทแอร์** (ทั้งหมด/แอร์ติดผนัง/แอร์แขวน/แอร์สี่ทิศทาง) นับจากรายการที่ "พร้อมเสนอขาย" · แสดงเฉพาะ พร้อมเสนอขาย + ต้องเช็คราคา (ซ่อน "เลิกขาย")
- **ux:** card = BTU badge / แบรนด์ / รุ่น / ราคาเสนอ / "รวมติดตั้ง" / spec สั้น (inverter·R32·warranty) · ปุ่ม **"📅 สั่งจอง"** (พร้อมเสนอขาย) หรือ **"💬 สอบถามราคา"** (ต้องเช็คราคา) · ไม่มีคำว่า "คงเหลือ/สต็อก" · notice *"ราคาสำหรับเสนอขาย กรุณารอเจ้าหน้าที่ยืนยันก่อนสั่งซื้อจริง"*
- **feat:** ปุ่มสั่งจอง → เก็บ **booking draft** (`modules/ac_booking_draft.js`, sessionStorage) + ไปหน้า `service_request` (lead flow เดิม) → prefill อาการ/หมายเหตุ/ประเภท(ติดตั้งแอร์) + notice "ยังไม่ได้ส่ง" — **ผู้ใช้กดส่งเอง**
- **scope:** ❌ ไม่ผูก products/POS · ❌ ไม่เพิ่ม/ตัด stock · ❌ ไม่รวมมูลค่า inventory · ❌ "สั่งจอง" ไม่ใช่ addToCart/POS · ❌ ไม่กระทบ quotation draft (346) · `product_detail_modal.js` +opts `reserveOnly`/`ctaLabel` (booking mode) · **test:** +11 `air_catalog_store_sync.test.js` + mobile/desktop flow smoke · **pwa-cache:** bump 346→347

## 5.66.0 (build 346) — 2026-06-02 Phase 346 air-catalog-to-quotation-draft — "นำไปเสนอราคา" → รายการร่างในใบเสนอราคา

- **feat:** กด **"นำไปเสนอราคา"** บน card รุ่นแอร์ → ส่งข้อมูลรุ่นเป็น **รายการร่าง** เข้าฟอร์มสร้างใบเสนอราคา (prefill) — **ไม่สร้างเอกสารจริงอัตโนมัติ** ผู้ใช้ต้องกด "บันทึก" เอง
- **mechanism:** ไฟล์ใหม่ `modules/ac_quotation_draft.js` — bridge ผ่าน **sessionStorage** (`push` / `consume-once` / `peek`); หน้าใบเสนอราคา consume แล้ว clear → **reload ไม่เติมซ้ำ**
- **ux:** หลังกดแสดง toast *"เพิ่มเป็นรายการร่างในใบเสนอราคาแล้ว"* + หน้าใบเสนอราคามี notice *"🌬️ มีรายการร่างจากแคตตาล็อกแอร์ N รายการ — ยังไม่ได้บันทึกเอกสาร"*
- **mapping:** line item `[product_id:null]` ชื่อ = `${airType} ${brand} ${model} ${btu} BTU` (+ note), qty 1, ราคา = offerPrice, marker `_source:"air_catalog"`/`_estCost` (in-memory เท่านั้น — save เลือกเฉพาะ field คงที่ → ไม่ persist/ไม่แตะ schema)
- **scope:** ❌ ไม่เพิ่ม/ตัด stock จริง · ❌ ไม่ผูก products/POS/cart/billing/stock-core · ❌ ไม่ save Supabase จนกว่าผู้ใช้กดเอง · ❌ ไม่แก้ SQL/schema · ❌ ไม่เปลี่ยน import/export format · existing quotation save flow (`qtSaveBtn`→`saveQuotationFull`) ไม่แตะ · **test:** +9 `air_catalog_quotation_draft.test.js` (behavioral push/consume-once + source guards) + mobile/desktop flow smoke · **pwa-cache:** bump 345→346

## 5.66.0 (build 345) — 2026-06-02 Phase air-catalog-not-real-stock-correction — แก้ wording ให้ชัดว่าเป็น "แคตตาล็อกทำราคา" ไม่ใช่สต็อกจริง

- **context:** owner clarify — หน้าแอร์ชุดนี้คือ **แคตตาล็อกสำหรับตั้งราคา/ทำใบเสนอราคา ก่อนค่อยสั่งของเข้าคลังจริง** ไม่ใช่สต็อกจริงในร้าน
- **ux:** หัวข้อ "จัดการสต็อกแอร์" → **"จัดการแคตตาล็อกแอร์"** + subtitle *"ใช้สำหรับตั้งราคาและเลือกสินค้าไปทำใบเสนอราคา — ไม่ใช่สต็อกจริงในคลัง"* (label เมนู Settings ด้วย)
- **ux(wording):** summary `มีสต็อก/หมดสต็อก` → **`พร้อมเสนอขาย/ยังไม่เปิดขาย`** · ลบ **`คงเหลือ`** ออกจากการ์ด · ปุ่ม `ตั้งสต็อก 5 เครื่องทุกรุ่น` → **`ตั้งค่าเริ่มต้นแคตตาล็อก`** (confirm เดิม) · ปุ่ม `+ เพิ่มเข้าคลัง` → **`นำไปเสนอราคา`** (navigation ไปหน้าใบเสนอราคา — **ไม่ตัดคลัง/ไม่แตะ cart/billing**)
- **ux:** การ์ดแสดง แบรนด์/รุ่น/BTU/**ราคาขายเสนอ**/**ต้นทุนประมาณการ**/**กำไรประมาณการ**(ถ้ามี cost)/รหัสอ้างอิง/หมายเหตุ + **badge 3 สถานะ**: พร้อมเสนอขาย / ต้องเช็คราคา (ยังไม่ใส่ราคา) / เลิกขาย
- **ux(form):** `ราคาขาย`→`ราคาขายเสนอ` · `ต้นทุน`→`ต้นทุนประมาณการ` · `จำนวนสต็อก`→`สถานะเสนอขาย` (>0 = พร้อมเสนอขาย)
- **scope:** wording/UI/UX เท่านั้น — **ไม่ผูกข้อมูลเข้า products/POS, ไม่รวมมูลค่าคลัง, ไม่นับ stock จริง, ไม่แตะ stock-core/billing/cart/Supabase/SQL, ไม่ migration** · tabs 3 ประเภท + fallback "wall" คงเดิม · import/export format เดิม (24 คอลัมน์) · **test:** 14 `ac_stock_manager_guard.test.js` (+ mobile render smoke) · **pwa-cache:** bump 344→345

## 5.66.0 (build 344) — 2026-06-02 Phase air-stock-manager-safe-step — "จัดการแคตตาล็อกแอร์" → "จัดการสต็อกแอร์" (แยก 3 ประเภท)

- **ux:** เปลี่ยนหัวหน้าเป็น **"จัดการสต็อกแอร์"** + เพิ่ม **tab 3 ประเภท**: แอร์ติดผนัง / แอร์แขวน / แอร์สี่ทิศทาง (label เมนู Settings ด้วย)
- **ux:** สินค้าเดิมที่ยังไม่มี field ประเภท → **derive fallback เป็น "แอร์ติดผนัง"** ใน UI (`acTypeOf`) — **ไม่ migrate DB / ไม่แตะข้อมูลเดิม**
- **ux:** summary cards (รุ่นทั้งหมด / แบรนด์-กลุ่ม / มีสต็อก / หมดสต็อก) scope ตาม tab + **product cards** (รุ่น/แบรนด์/BTU/ราคา/คงเหลือ/SKU/badge สถานะ + ปุ่ม `แก้ไข` / `+ เพิ่มเข้าคลัง` / `⋯` แก้สเปก)
- **ux:** ปุ่มหลัก `+ เพิ่มรุ่นแอร์` / `📂 นำเข้า Excel` / `⋯ จัดการเพิ่มเติม` — **ย้ายปุ่มเสี่ยง "ตั้งสต็อก 5 เครื่องทุกรุ่น"** + export + reset + ล้างทั้งหมด เข้าเมนู (**confirm เดิมครบ**); import drop-zone → section รอง (ขั้นสูง)
- **feat:** ฟอร์มเพิ่ม/แก้รุ่น (`ac-stock-form.js` ใหม่) — ประเภท/แบรนด์/รุ่น/BTU/ราคา/ต้นทุน/สต็อก/SKU/หมายเหตุ · เปิดจาก tab ไหน → default ประเภทตาม tab นั้น
- **scope (safe step):** **localStorage (`bsk_ac_catalog`) เท่านั้น** — ไม่แตะ auth/API/DB schema/billing/cart/stock-core · **ไม่เปลี่ยน format import/export** (Excel/CSV คง 24 คอลัมน์เดิม; ฟิลด์ใหม่ ac_type/cost/sku/note ยังไม่อยู่ใน Excel รอบนี้) · **test:** +12 `ac_stock_manager_guard.test.js` (+ mobile/desktop render smoke) · **pwa-cache:** bump 343→344

## 5.66.0 (build 343) — 2026-06-02 Phase inventory-action-menu + category-collapse — จัดหน้า สินค้า/คลัง ให้โล่ง

- **ux(mobile):** **Header action menu** — เหลือปุ่มหลัก `นำเข้า` / `+ เพิ่มสินค้า` + เมนู **"⋯ จัดการเพิ่มเติม"** (`<details>`); ย้าย `ส่งออก`/`สร้างบาร์โค้ด`/`พิมพ์บาร์โค้ด`/`จัดการหมวด`/`รวมหมวดซ้ำ`/`Bulk`/`ลบทั้งหมด` เข้าเมนู — `ลบทั้งหมด` อยู่**ท้ายเมนู** + **danger style** + เส้นคั่นกันกดพลาด (confirm เดิมครบ)
- **ux(mobile):** **Product card action menu** — เหลือปุ่มด่วน **`+ บิล`**; ปุ่มอื่น (`แก้ไข`/`รับสต็อก`/`QR`/`พิมพ์`/`ลบ`) เข้าเมนู **"⋯"** ต่อ `data-action` เดิม
- **ux(mobile):** **Category collapse** — โชว์ ~10 หมวดแรก ที่เหลือซ่อนใต้ **`+ หมวดทั้งหมด`** (toggle ไม่ re-render); **หมวดที่เลือกอยู่เห็นเสมอ** แม้อยู่นอก 10 อันแรก
- **ux:** ปุ่ม **`✕ ล้างตัวกรองทั้งหมด`** โผล่เมื่อมี filter ใด ๆ active (รีเซ็ต category/status/quick/tag/search)
- **scope:** UI/markup/CSS เท่านั้น — **ไม่แตะ** stock/barcode/import-export/billing/auth/API · **`id`/`data-action`/handler เดิมครบ** (ปุ่มแค่ย้ายที่ — wiring ไม่เปลี่ยน) · เมนูใช้ `<details>` inline-flow กัน clip จาก `.prod-list`/`.panel` overflow · **test:** +7 `mobile_layout_guard.test.js` (รวม mobile smoke 390×844) · **pwa-cache:** bump 342→343

## 5.66.0 (build 342) — 2026-06-02 Phase inventory-mobile-polish — จัดหน้า สินค้า/คลัง บนมือถือ (safe wins)

- **ux(mobile):** เพิ่ม **summary cards 4 ใบ** บนหน้า สินค้า/คลัง — 📦 ทั้งหมด / พร้อมขาย (เขียว) / ใกล้หมด (ส้ม) / หมดสต็อก (แดง) — derive จาก count ที่คำนวณไว้แล้ว (`countTypeAll`/`countInstock`/`countLow`/`countOut`) **ไม่มี query ใหม่**
- **fix(mobile):** filter/type tabs (`.prod-filter-tabs`/`.prod-type-tabs`) `@media ≤768px` **wrap** แทน overflow-x scroll → เห็นทุกแท็บ ไม่ทับ/ไม่ถูกซ่อน
- **fix(mobile):** product card — ราคา/คงเหลือ อยู่คนละฝั่ง + ปุ่ม action ลงแถวเต็มกว้างของตัวเอง (ไม่ล้น/ทับ)
- **fix(mobile):** ซ่อน floating help 💡 (`#bs-help-fab`) บน route `products`/`wh_kunkhao`/`wh_kundaeng`/`wh_sikhon` (กันทับรายการ) — คนละปุ่มกับ AI `#bs-ai-fab`
- **scope:** UI/CSS + 1 markup (summary) เท่านั้น — **ไม่แตะ** stock/barcode/import-export/billing/auth/API หรือ wiring ปุ่ม · action menu จริง (header/per-card) **เลื่อนรอบหน้า** · **test:** +3 `mobile_layout_guard.test.js` · **pwa-cache:** bump 341→342

## 5.66.0 (build 341) — 2026-06-02 Phase sales-doc-mobile — แก้ layout overlap หน้าเอกสารขาย (มือถือ)

- **fix(mobile):** status filter tabs ใบเสนอราคา/ใบส่ง/ใบเสร็จ (`.qt-tabs`/`.di-tabs`/`.rc-tabs`) เดิม flex+overflow-x:auto แต่ปุ่มไม่มี `flex-shrink:0` → บีบจนข้อความ nowrap ทับกัน → `@media ≤768px` wrap เป็น **chip** (`border-radius:999px`, `flex:0 0 auto`) เห็นครบทุกแท็บ ไม่ทับ (desktop คง underline-tab เดิม)
- **fix(mobile):** `doc-list-table` wrapper เปลี่ยนจาก inline `overflow-x:auto` div → shared `.table-wrap` (มี `min-width:520px` + full-bleed) → scroll แนวนอนชัด เลขเอกสาร/สถานะ/ปุ่ม ไม่ถูกตัด/ทับ
- **fix(mobile):** ซ่อน floating help 💡 (`#bs-help-fab`) บน route `quotations`/`delivery_invoices`/`receipts` (กันทับ row ตาราง) — คนละปุ่มกับ AI assistant `#bs-ai-fab` ไม่กระทบ flow build 340
- **scope:** CSS + markup เท่านั้น — ไม่แตะ business/API/auth/accounting · **test:** +3 `mobile_layout_guard.test.js` · **pwa-cache:** bump 340→341

## 5.66.0 (build 340) — 2026-06-02 Phase mobile-layout follow-up #3 — AI entry UX (inline แทน FAB)

- **fix/ux(mobile):** เลิกใช้ floating FAB บนมือถือทั้งหมด (`@media ≤768px { #bs-ai-fab { display:none !important } }`) — fixed FAB ลอยทับ input/select/textarea แม้ icon-only/route-gate → แทนด้วย **inline button ในเนื้อหา**
- **ux:** เพิ่มทางเข้า AI ในflowงาน — `customer_dashboard` การ์ด CTA "🤖 ให้ AI ช่วยแจ้งงาน / ลงคิวงาน", `service_request` ปุ่ม "🤖 AI ช่วยแจ้งงาน / ลงคิวงาน", `service_form`/`ac_install`/`solar` ปุ่ม "🤖 AI ช่วยกรอกใบงานนี้" — ทุกปุ่ม reuse `window.BoonsookAI.open()` (ไม่แตะ flow/submit เดิม)
- **ux:** desktop/tablet คง FAB เฉพาะ service flow (solar/ac_install/service_* ยกเว้น service_jobs); เอา service FAB ออกจาก `ai_sales`/`ac_shop` (มี AI ขายของตัวเองแล้ว) → แยกบทบาท "ช่วยแจ้งงาน" vs "ช่วยขายแอร์" ชัด
- **scope:** UI/UX + CSS เท่านั้น — ไม่แตะ API/Auth/business/accounting/submit · **test:** +guards `mobile_layout_guard.test.js` · **pwa-cache:** bump 339→340

## 5.66.0 (build 339) — 2026-06-02 Phase mobile-layout follow-up #2 — ซ่อน AI FAB ตาม route (มือถือ)

- **fix(mobile):** icon-only ยังไม่พอ — fixed FAB ลอยทับ content (content scroll ผ่านหลัง FAB ได้) → ซ่อน `#bs-ai-fab` **เป็นค่าเริ่มต้นบนมือถือ** (`@media ≤768px { display:none }`) แล้วโชว์เฉพาะ route ที่ "กรอกงานจริง": `solar` / `ac_install` / `ai_sales` / `ac_shop` / `service_*` (ยกเว้น `service_jobs` ที่เป็น list) → Settings/เพิ่มเติม/dashboard/expenses ไม่มี FAB บังการ์ด "สำรอง / กู้คืน config" อีก
- **mechanism:** `main.js` `showRoute()` set `document.body.dataset.route = route` → CSS อ้าง `body[data-route="…"] #bs-ai-fab`. allowlist ไม่ใช้ `!important` → กฎซ่อนตอน drawer/sidebar/modal เปิดยัง override ได้
- **scope:** CSS + 1 บรรทัด DOM-state เท่านั้น — ไม่แตะ API/Auth/business · **test:** +2 `mobile_layout_guard.test.js` · **pwa-cache:** bump 338→339

## 5.66.0 (build 338) — 2026-06-02 Phase mobile-layout follow-up — AI FAB บังการ์ด Settings

- **fix(mobile):** AI FAB ยังบังการ์ดเนื้อหาหน้า Settings/เพิ่มเติม (โดยเฉพาะ "สำรอง / กู้คืน config") → `@media max-width:480px` ทำ `#bs-ai-fab` เป็น **icon-only วงกลม 52px** (ซ่อน `.bs-fab-label` เหลือ 🤖 + คง `aria-label`/`title` สำหรับ a11y/tooltip)
- **fix(mobile):** เพิ่ม `.page` bottom padding บนมือถือ 100→**160px** (จอ ≤400px → 150px) → การ์ดท้ายหน้า scroll พ้น FAB + bottom nav ได้
- **scope:** CSS + markup label-wrap เท่านั้น — ไม่แตะ API/Auth/business · **test:** +2 `mobile_layout_guard.test.js` · **pwa-cache:** bump 337→338

## 5.66.0 (build 337) — 2026-06-02 Phase mobile-layout — แก้ overlap 4 จุดบนมือถือ (390×844)

- **fix(mobile):** expenses filter bar — เพิ่ม `.exp-filter-row` → แต่ละ field (จากวันที่/ถึงวันที่/หมวดหมู่) เต็มแถว + ปุ่มแบ่งครึ่ง ไม่ทับกัน (เดิม inline `min-width:200px` เบียดบนจอแคบ)
- **fix(mobile):** mobile sidebar — `z-index:60` (เหนือ bottom nav 40 + backdrop 50) + `toggleSidebar`/`closeSidebar` คุม `body.sidebar-open` + โชว์/ซ่อน backdrop (แตะ backdrop / เปลี่ยนหน้า = ปิด) → เปิดแล้วไม่ถูก nav บัง, ฉากหลัง dim ชัด, ล็อก scroll
- **fix(mobile):** AI FAB — ยกขึ้น `bottom:calc(72px+safe-area)` บนมือถือ (พ้น bottom nav) + ซ่อนตอน sidebar เปิด (`body.sidebar-open`/`#sidebar.open`)
- **fix(mobile):** tables ใน panel — `.table-wrap` คง `overflow-x:auto` + `max-width:100%` → scroll แนวนอนได้ ไม่ถูก clip
- **scope:** CSS + DOM-state เท่านั้น — ไม่แตะ business/API/accounting/auth/OCR · **test:** +9 `mobile_layout_guard.test.js` · **pwa-cache:** bump 336→337

## 5.65.0 (build 336) — 2026-06-01 Phase 92.66 — verify-slip (SlipOK) 401 auth fix (follow-up 92.65)

- **fix(payment):** ปุ่ม/auto "🤖 ตรวจสลิป" ใน 4 หน้า (main.js drawer, service_form, ac_install, solar) ยิง `/api/verify-slip` แบบไม่มี token → middleware (`REQUIRE_AUTH_ENDPOINTS`) ตอบ 401 ก่อนถึง SlipOK = ตรวจสลิปการโอนพังทุกหน้า
- **fix:** แต่ละ caller แนบ `Authorization: Bearer window._sbAccessToken` (อ่านตอนเรียก) · ไม่มี token/หมดอายุ → guard ก่อนยิง + จับ 401 แสดง "เข้าสู่ระบบใหม่" แทน error กว้าง · ไม่ fallback anonKey (publishable key ไม่ใช่ JWT → 401 อยู่ดี)
- **test:** +24 `verify_slip_auth.test.js` (source-guard × 4 call site: Bearer / _sbAccessToken / no-anonKey / no-token guard / 401 / re-login) · **pwa-cache:** bump 335→336

## 5.65.0 (build 335) — 2026-06-01 Phase 92.65 — AutoKey (parse-receipt) 401 auth fix

- **fix(expenses):** ปุ่ม "🔍 ให้ AI วิเคราะห์ใบเสร็จ" (AutoKey) ยิง `/api/parse-receipt` แบบไม่มี token → middleware (`REQUIRE_AUTH_ENDPOINTS`) ตอบ 401 ก่อนถึง Gemini = ฟีเจอร์พังทั้งหมด
- **fix:** แนบ `Authorization: Bearer window._sbAccessToken` (อ่านตอนกด) · ไม่มี token/หมดอายุ → guard + จับ 401 แสดง "เข้าสู่ระบบใหม่" แทน error กว้าง · ไม่ fallback anonKey (publishable key ไม่ใช่ JWT → จะ 401 อยู่ดี)
- **test:** +6 `expenses_autokey_auth.test.js` (source-guard: Bearer / _sbAccessToken / no-anonKey / 401 / re-login) · **pwa-cache:** bump 334→335

## 🏁 Finance Audit — CLOSED ที่ build 334 (2026-06-01)

ปิดครบ 9 ข้อ: refund over-refund (client+DB trigger), recurring expense JV + idempotency, VAT split Dr=Cr, profit_report XSS, recurring/profit TZ, payroll fail→audit log, PromptPay dead-code removed, **period-lock DB trigger verified** (`journal_entries` → `trg_check_period_locked` → `check_period_not_locked`). ไม่มี item ค้าง

## 5.64.0 (build 334) — 2026-06-01 Phase 92.64 — Balance sale VAT journal split (audit #4)

- **fix(accounting):** VAT split ของ sale JV เดิมใช้ `subtotal_before_vat` + `vat_amount` ที่ปัดเศษแยกกัน → Dr≠Cr (drift >0.01 = JV ถูก reject เงียบ revenue หาย, ≤0.01 = Trial Balance เพี้ยนสะสม)
- **helper:** `splitSaleVatLines(total, vatAmount)` (pure) — anchor ที่ total, `vat=round2`, `subtotal=round2(total-vat)` → Dr(total) === Cr(subtotal+vat) ภายใน satang เสมอ (residual เข้า revenue line — ถูกหลักบัญชี)
- **scope:** เฉพาะ VAT-split block ใน `postJournalForSale` · ไม่แตะ COA/formula/refund/expense/payroll · **test:** +7 `auto_post.test.js` (inclusive/exclusive/drift/edge/2-line/refund regression) · **pwa-cache:** bump 333→334

## 5.64.0 (build 333) — 2026-06-01 Phase 92.63 — Finance audit quick wins (#5 XSS / #6b TZ / #8 log)

- **fix(security):** profit_report.js escape ชื่อสินค้า + หมวดหมู่ (เดิม render ดิบ = stored-XSS) [#5]
- **fix(tz):** profit_report (ช่วงวันที่ default) + profit_by_product (cutoff 30d/เดือน/ปี) ใช้ `todayBkk()`/`addDaysBkk()` แทน UTC `new Date()`/`toISOString()` → กัน off-by-1 [#6b]
- **fix(audit):** payroll จ่ายแล้วแต่ auto-expense/auto-JV ล้มเหลว → ลง `logActivity('payroll_expense_failed'/'payroll_journal_failed')` ใน audit log (เดิมแค่ console → ตามรอย P&L/cash drift ไม่ได้) [#8]
- **test:** +4 `finance_audit_92_63.test.js` · **pwa-cache:** bump 332→333

## 5.64.0 (build 332) — 2026-06-01 Phase 92.62 — รายจ่ายประจำ: JV + idempotency + TZ (audit #2/#3/#6)

- **fix(accounting):** generate รายจ่ายประจำ → **auto-post JV** (เหมือน expenses ปกติ) → ค่าเช่า/น้ำไฟเข้าสมุดบัญชีคู่ (เดิมไม่ลง → P&L/Trial Balance ไม่ตรง)
- **fix(recurring):** กันสร้างซ้ำ — tag `#recur-{id}-{งวด}` ใน note + pre-check ก่อน insert + in-flight guard (เดิม PATCH next_due พลาดแล้วกดซ้ำ = รายจ่ายซ้ำ)
- **fix(tz):** ใช้ `todayBkk()` แทน UTC ทุกจุด (expense_date/overdue/form) + `_calcNextDue` เขียนใหม่เป็น pure date math (deterministic ไม่ขึ้น runtime TZ)
- **test:** +9 `recurring_expenses.test.js` · **pwa-cache:** bump 331→332

## 5.64.0 (build 331) — 2026-06-01 Phase 92.61 — Refund คืนซ้ำ/คืนเกิน (audit fix #1)

- **fix(refunds):** กันคืนซ้ำ/คืนเกิน — เปิด modal คืนบิลเดิมจะหัก "จำนวนที่คืนไปแล้ว" ออกจาก max ต่อรายการ (`computeRefundableItems`) + แสดง "คืนแล้ว N / ครบ" + disable ช่องที่คืนครบ + re-validate ก่อนบันทึก (`validateRefundWithinRemaining`) → กันเงิน+สต็อก+JE รั่ว
- **scope:** client guard (จับคู่ด้วย product_id / fallback ชื่อ) · **test:** +11 `refunds_cap.test.js` · **pwa-cache:** bump 330→331
- **(92.61b) server-side guard:** `supabase-phase92-61b-refund-guard.sql` — BEFORE INSERT trigger `trg_guard_refunds_insert` บน `refunds` กันคืนเกิน qty เดิมระดับ DB (ทุก role, defense-in-depth) · **✅ applied ใน Supabase แล้ว (2026-06-01)** · ไม่ bump build (SQL-only)

## 5.64.0 (build 330) — 2026-06-01 Phase 92.60 — HR Overview premium UI/UX

- **style(hr):** ปรับหน้า HR ให้ดูพรีเมียม — พื้นหลัง gradient, hero gradient + title gradient-clip + eyebrow pill, toolbar navy→indigo glassy, การ์ด/พาเนล shadow ซ้อนชั้น + มุมโค้ง 16px + hover ยกตัว, แท่ง/โดนัทกราฟ indigo→violet, ผิวการ์ดทุกใบ refined
- **visual-only:** ไม่เปลี่ยนโครงสร้าง/คลาส/logic — ไม่แตะ data/SQL/RLS/payroll (CSS อยู่ใน scoped `<style>` ของ hr_overview.js) · renumber 92.58→92.60 (Codex ใช้ 92.58/92.59) · **pwa-cache:** bump 329→330

## 5.64.0 (build 329) — 2026-06-01 Phase 92.59 — Period-close readiness gate (accounting)

- **feat(accounting):** หน้า "ปิดงวดบัญชี" (periods.js) เพิ่ม **close-readiness gate ตามมาตรฐาน**: การ์ดแต่ละเดือนโชว์ ⚖️Dr=Cr · 📋บิลมี JE ครบ · 🧹orphan-JV; ปุ่มปิดงวดเตือน (soft-close) ถ้ายังไม่พร้อม → ตรวจ+ปิดที่เดียวกัน
- **refactor:** ยุบหน้า "เช็คก่อนปิดงวด" (เดิม 92.51) เข้า periods.js → ปลด route/menu + ลบ `period_close.js` · reuse trial-balance/`_classifyOrphan` (no drift) · read-only · build 328→329

## 5.64.0 (build 328) — 2026-06-01 Phase 92.58 — POS money audit fixes (S2+S3)

- **fix(pos):** checkout เตือนชัดเมื่อ `sale_items` บางรายการ insert ไม่สำเร็จ (toast + error log; เดิม console.error เงียบ → บิลบันทึกแต่รายการขาด = COGS/สต็อก/รายงานเพี้ยน) [S2]
- **fix(stock):** `_applyStockMovement` (manual in/out/return/sale) ใช้ atomic CAS (`atomicAddToField`) แทน read-modify-write บน cache → กัน lost-update/oversell ตอนทำพร้อมกัน; `adjust` คงเดิม [S3] · จาก read-only money audit · build 327→328

## 5.64.0 (build 327) — 2026-06-01 Phase 92.57 — Export PDF / พิมพ์รายงาน HR

- **feat(hr):** ปุ่ม "🖨️ พิมพ์ / PDF" ในรายงาน HR — เปิดหน้าพิมพ์ (browser-native print → Save as PDF ได้) ครอบทั้งตารางพนักงาน + สรุปแผนก + totals + ช่วงวันที่ + เวลาพิมพ์
- **feat(hr):** `buildHrReportPrintHtml()` pure helper — สร้าง HTML doc พร้อม print CSS + auto `window.print()` · escape ทุกค่า (กัน XSS)
- **no dependency:** ใช้ browser print ล้วน ไม่เพิ่ม lib · read-only · ไม่แตะ SQL/RLS/payroll/accounting · **test:** +3 `hr_overview.test.js` · **pwa-cache:** bump 326→327

## 5.64.0 (build 326) — 2026-06-01 Phase 92.56 — รายงานระดับแผนก

- **feat(hr):** `buildDepartmentReport()` pure helper — รวม per-employee report ตามแผนก (จำนวนคน/วันทำงาน/ชม.ปกติ/OT/มาสาย/ออกก่อน/ลา) + totals
- **feat(hr):** ตาราง "🏢 สรุปตามแผนก" ใต้ตาราง per-employee ในรายงาน HR — ใช้ข้อมูลช่วงเดียวกัน (อัปเดตตาม date-range อัตโนมัติ) + ปุ่ม Export แผนก (`hr_dept_report_<from>_<to>.xlsx`)
- **read-only:** aggregate จาก rows เดิม ไม่ fetch เพิ่ม · ไม่แตะ SQL/RLS/payroll/accounting · **test:** +3 `hr_overview.test.js` · **pwa-cache:** bump 325→326

## 5.64.0 (build 325) — 2026-06-01 Phase 92.55 — Timesheet รายคน

- **feat(hr):** `buildEmployeeTimesheet()` pure helper — daily grid ของพนักงาน 1 คน: 1 แถว/วัน (เข้าเร็วสุด/ออกช้าสุด/ชม.ปกติ+OT รวมทุก session/สถานะตรงเวลา/notes) + totals (วันทำงาน/ปกติ/OT/สาย/ออกก่อน)
- **feat(hr):** เพิ่ม tab "🗓️ Timesheet" ใน employee drill-down modal — lazy-fetch เดือนปัจจุบัน (month-to-date) + cache; รวม session หลายครั้ง/วัน, แสดงวันว่างเป็น "ไม่มีบันทึก"
- **read-only:** reuse `_fetchUserAttendanceRange` + `computeRegularOT` + `classifyPunctuality` · ไม่แตะ SQL/RLS/payroll/accounting · **test:** +4 `hr_overview.test.js` · **pwa-cache:** bump 324→325

## 5.64.0 (build 324) — 2026-06-01 Phase 92.54 — HR report date-range picker + re-fetch

- **feat(hr):** รายงาน HR เลือกช่วงวันที่เองได้ (date-range จาก/ถึง + ปุ่มค้นหา) — `_fetchReportRange(from,to)` ดึง staff_attendance + staff_leaves เฉพาะช่วง แล้ว rebuild + re-render เฉพาะ `#hrReportSection` (loading state + rebind) ไม่ re-fetch ทั้งหน้า
- **feat(hr):** Export filename ตามช่วง `hr_report_<from>_<to>.xlsx` · validate จาก ≤ ถึง
- **read-only:** profiles/departments ใช้ใน memory · staff_leaves graceful · ไม่แตะ SQL/RLS/payroll/accounting · **test:** +2 source-level · **pwa-cache:** bump 323→324

## 5.64.0 (build 323) — 2026-06-01 Phase 92.53 — Monthly HR report (รายงานรวมรายเดือน ต่อพนักงาน)

- **feat(hr):** `buildMonthlyHrReport()` pure helper — สรุป 1 แถว/คน ในเดือน: วันทำงาน · ชม.ปกติ · OT · มาสาย(ครั้ง+นาที) · ออกก่อน · วันลา(อนุมัติ) + totals
- **feat(hr):** section "📋 รายงาน HR รายเดือน" ใน HR Overview (เดือนปัจจุบัน) + ปุ่ม Export Excel (`hr_report_<month>.xlsx`)
- **read-only:** reuse `sumRegularOT` + `summarizePunctuality` + ข้อมูลที่โหลดอยู่แล้ว — ไม่ fetch เพิ่ม ไม่แตะ payroll/accounting/RLS/schema · **test:** +8 `hr_overview.test.js` · **pwa-cache:** bump 322→323

## 5.64.0 (build 322) — 2026-06-01 Phase 92.52 — HR attendance exception follow-ups

- **feat(hr):** `summarizePunctuality(rows, shift, opts)` pure helper + สรุปความตรงต่อเวลาช่วงที่กรอง + คอลัมน์ punctuality (สถานะตรงเวลา/นาทีสาย/นาทีออกก่อน) ใน Excel export หน้า Time Clock (manager)
- **feat(hr):** chip มาสาย/ออกก่อน/ตรงเวลา ในประวัติ Time Clock ฝั่งพนักงาน (self-view)
- **feat(hr):** HR Overview export เพิ่มคอลัมน์ punctuality
- **feat(hr):** executive dashboard เพิ่ม panel "พนักงานมาสายบ่อย (เดือนนี้)" — `buildHrDashboardMetrics.monthlyPunctuality` (top-late + flag ≥3 ครั้ง) จาก attendance รายเดือน
- **feat(settings):** audit log `attendance_rules_update` เมื่อ grace/กะ เปลี่ยน (best-effort, ไม่ทำให้ save fail)
- **note:** phase เลื่อน 92.51→92.52 (Codex ใช้ 92.51 = Period Close) · **ไม่กระทบ:** payroll / OT / leave / accounting / JE RLS · ไม่มี SQL/schema change · **test:** +6 `time_clock.test.js` · +6 `hr_overview.test.js` · **pwa-cache:** bump 321→322

## 5.64.0 (build 321) — 2026-06-01 Phase 92.51 — Period Close Checklist (accounting)

- **feat(accounting):** หน้าใหม่ "🧾 เช็คก่อนปิดงวด" (เมนูบัญชี · route `accounting_period_close`) — checklist read-only ก่อนปิดงวด: เดบิต=เครดิต (reuse trial_balance), ขาย/รายจ่ายทุกบิลมี JE รายเดือน (reuse `_classifyOrphan`), สถานะงวด · ส่วน HR (payroll/leave) defer ให้ทีม HR
- **note:** phase เลื่อน 92.49→92.51 (ทีม HR ใช้ 92.49/92.50) · **pwa-cache:** rebase บน HR build 320 → bump 321 · **test:** +4 `period_close.test.js`

## 5.64.0 (build 320) — 2026-06-01 Phase 92.50 — HR executive dashboard detail view

- **feat(hr):** HR Overview เพิ่ม dashboard รายละเอียดครบแบบตัวอย่าง: hero/benefits, context filter strip, KPI cards, chart แยกแผนก, donut แยกตำแหน่ง, สถานะลงเวลาวันนี้, แนวโน้มคนลงเวลา, สรุปวันลา, ตารางสัญญา/ทดลองงานใกล้ครบ และ notes แหล่งข้อมูล
- **read-only:** ใช้ข้อมูลเดิมจาก profiles/departments/staff_attendance/staff_payroll + fetch `staff_leaves` แบบ graceful; ไม่แตะ payroll/accounting/RLS/schema
- **test/pwa-cache:** เพิ่ม `buildHrDashboardMetrics` test + bump 319→320 (`index.html` asset query strings + `sw.js` cache)

## 5.64.0 (build 319) — 2026-06-01 Phase 92.49 — HR attendance exception rules

- **feat(hr):** กฎ "มาสาย / ออกก่อนเวลา / attendance exception" — pure helper `classifyPunctuality(row, shift, opts)` ใน `time_clock.js` คืน `{status, lateMinutes, earlyLeaveMinutes}` (on_time / late / early_leave / late_and_early_leave / missing_clock_out / none) บน Asia/Bangkok
- **feat(hr):** HR Overview เพิ่ม chip มาสาย/ออกก่อน ใน row + drill-down + alert รวม (late_arrivals / early_leaves); หน้า Time Clock (manager) แสดง chip ในรายงาน — **informational เท่านั้น ไม่ block clock-in/out**
- **feat(settings):** ตั้งค่า `lateGraceMinutes` / `earlyLeaveGraceMinutes` (default 15, เก็บใน storeInfo pattern เดิม — ไม่มี SQL/schema change)
- **ไม่กระทบ:** payroll / OT / leave / accounting / JE RLS
- **test:** +18 `time_clock.test.js` (classifyPunctuality/rules/chip) · +7 `hr_overview.test.js` (exception counting) · **pwa-cache:** bump 318→319

## 5.64.0 (build 318) — 2026-06-01 Phase 92.48 hotfix — integrity panel sales fetch

- **fix(accounting):** การ์ด integrity ดึง orphan row ด้วย `select=*` — เดิม sales select มี `grand_total` ที่ sales ไม่มีคอลัมน์ → PostgREST 400 → 85 รายการขึ้น "classify ไม่ได้" 🟡; ตอนนี้ classify ได้ → 🟢 (รายจ่ายไม่โดนเพราะ select แค่คอลัมน์ที่มีจริง)
- **pwa-cache:** bump 317→318

## 5.64.0 (build 317) — 2026-06-01 Phase 92.48 — Accounting Integrity status panel

- **feat(accounting):** การ์ด "🩺 สถานะความครบของบัญชี" บนหน้า Backfill — เรียก `accounting_integrity_summary()` + แยก orphan เป็น actionable vs ข้าม (test ก่อน go-live / ฿0) ด้วย `_classifyOrphan` (mirror `auto_post._isAfterEffective`+amount → ไม่ drift) กัน raw count หลอกตา (85 → actionable 0)
- **pwa-cache:** bump build 316→317 (backfill.js = lazy module) · **test:** +8 `accounting_integrity_panel.test.js`

## 5.64.0 (build 316) — 2026-06-01 Phase 92.47b — PWA cache bump + shared session notes

- **fix(pwa-cache):** bumped `APP_BUILD` / asset query strings / `sw.js` `CACHE_NAME` from 315 to 316 so deployed clients can receive the Phase 92.47 expense export Bangkok-TZ fix without relying on manual hard refresh.
- **docs/ops:** added `SESSION_START_SHARED.md` as the shared first-read note for Codex/Claude sessions and pointed older handoff/runbook files at it.
- **ops(accounting):** committed JE REST RLS verification helpers (`verify:je`, `diag_je_rest`) for repeatable live checks after the Phase 92.46c SQL fix.

## 5.64.0 (build 315 — no client bump) — 2026-06-01 🛠️ Phase 92.47 — Expense export date filter (TZ off-by-1)

- **fix(expenses) [export-empty]:** default date filter ของหน้ารายจ่ายใช้ `toISOString()` (UTC) → เช้าวันที่ 1 เวลาไทย (เช่น 06:37 ICT = 23:37 UTC วันก่อน) ทำให้ from/to ยุบเป็นวันสุดท้ายของเดือนก่อน → export ได้ผลว่าง (fallback "ไม่มีข้อมูล")
- เปลี่ยนเป็น `todayBkk()` (Asia/Bangkok helper Phase 89.1) ทุกจุด: default filter from/to + thisMonth, clear-filter handler, `_getFormValueDate()` (form default off-by-1 เป็น "เมื่อวาน" ตอนเช้า), OCR result date
- **test:** `expenses_export_filter.test.js` freeze clock → deterministic (เดิมผ่านเฉพาะเดือน พ.ค. 2026)
- **Gates:** lint:errors 0/0 · unit 777/777 · ไม่แตะ `exportToExcel` fallback (ใช้ร่วมหลายโมดูล)

## 5.64.0 (build 315 — no client bump) — 2026-05-28 🛠️ Phase 92.47 — Orphan Journal Backfill Tool (script-only)

- **feat(accounting/backfill) [orphan-recovery]:** เครื่องมือ backfill journal entries สำหรับ sales/expenses ที่ไม่มี JV (root cause: Phase 92.46 RLS bug — sales role ถูก deny insert journal_entries; 92.46 ปิด root cause แต่ orphan เก่าค้าง)
- **Audit ก่อนเริ่ม:** 107 sales + 3 expenses ไม่มี JV (เม.ย. 85, พ.ค. 25) — payroll 0 (92.44 wire ใหม่ครอบทัน)
- **ขอบเขตจริง:** เม.ย. = intentional skip (ก่อน `ACCOUNTING_EFFECTIVE_DATE=2026-05-01` = test data); พ.ค. ~25 rows = real backfill
- **`scripts/backfill_orphan_journals.js`** + **`npm run backfill:orphans`**
  - Strategy: **window shim + reuse `auto_post.js`** (ไม่ replicate logic — กัน drift จาก mapping/VAT/BANK_COA override)
  - Auth admin (`.env` เดียวกับ verify scripts) → fetch from `vw_sales_without_journal` / `vw_expenses_without_journal` → loop `postJournalForSale/Expense(row)`
  - Before+after `accounting_integrity_summary()` snapshot → diff
  - Flags: `--dry-run`, `--sales-only`, `--expenses-only`
  - Exit: 0 success / 1 partial fail / 2 fatal
  - Idempotent (re-run safe — unique partial index `(source_table, source_id)` ของ JV)
- **ไม่แตะ:** auto_post.js (zero browser regression), SQL schema, client UI, effective date
- **Tests +19** (`tests/backfill_orphan_journals.test.js`): summarizeResults 4 / formatSummaryLine 2 / source-level guards 13 (window shim order, pathToFileURL Windows-safe, resetMappingCache, flags, integrity snapshot before+after, exit codes, main guarded, npm script registered)
- **Gates:** lint:errors 0/0 · unit **758 → 777** · e2e ไม่กระทบ · audit 0
- **No client code change** → APP_BUILD ยัง 315 / version ยัง 5.64.0
- **⚠️ Action required (user):** ดู HANDOFF — DRY-RUN ก่อน LIVE

---

## 5.64.0 (build 315 — no client bump) — 2026-05-28 🔧 Phase 92.46 — Auto-Journal RLS Re-apply + Tighten + Integrity Views (SQL-only)

- **fix(accounting/rls):** ปิด incident "`auto_post_jv deferred (RLS denied role) for sales#155`" — re-apply + tighten `je_insert_auto`/`jl_insert_auto` policies
- **SQL:** [`supabase-phase92-46-je-rls-rerun-and-tighten.sql`](supabase-phase92-46-je-rls-rerun-and-tighten.sql) (rerun-safe)
  - Re-applies phase89-25 policies (defense vs. "policy never applied/was reverted" — likely root cause)
  - Tightens WITH CHECK: non-admin INSERT ต้อง `source_table` IN whitelist 8 ตัว (sales/expenses/staff_payroll/service_jobs/receipts/delivery_invoices/credit_payments/refunds)
  - Adds 3 diagnostic VIEWs (`vw_sales_without_journal`, `vw_expenses_without_journal`, `vw_payroll_without_journal`) — admin only via base table RLS
  - Adds RPC `accounting_integrity_summary()` admin-only — counts (groundwork สำหรับ Phase 92.47 dashboard)
- **Tests:** +6 source-level (SQL structure + whitelist drift guard vs. auto_post.js sourceTable values)
- **Gates:** lint 0 / unit 758/758 / e2e 11/11 / audit 0
- **No client code change** → APP_BUILD ยัง 315 / version ยัง 5.64.0
- **⚠️ Action required (user):** Supabase Dashboard → SQL Editor → paste SQL → Run → smoke ตาม [INCIDENT_NOTES.md](INCIDENT_NOTES.md)

---

## 5.64.0 (build 315) — 2026-05-28 🔒 Phase 92.45 — Leave SQL/RLS Hardening + Audit Enforcement

- **feat(security/leave) [S3 closed]:** ปิดช่อง spoof reviewer fields ฝั่ง DB — defense-in-depth ทับ RLS เดิม
- **SQL:** `supabase-phase92-45-leave-hardening.sql`
  - BEFORE INSERT trigger `_guard_staff_leaves_insert` — non-admin POST: บังคับ `user_id=auth.uid()`, `status='pending'`, ล้าง `reviewed_by/_at/_note` (กัน spoof ผ่าน payload ที่ผ่าน RLS เดิม)
  - BEFORE UPDATE trigger `_guard_staff_leaves_update` — non-admin: preserve OLD reviewer/user_id/leave_type/created_by + RAISE EXCEPTION ถ้าพยายามแก้ status ออกนอก pending/cancelled หรือยุ่ง row terminal; admin: auto-set `reviewed_by=auth.uid()` + `reviewed_at=now()` ตอน approve/reject
  - RPC `public.review_staff_leave(p_leave_id, p_status, p_note)` — admin-only clean path (status whitelist + GRANT EXECUTE authenticated)
- **Client (`modules/leave_management.js`):**
  - `_doReview` ใช้ RPC แทน `_patchLeave` — เลิกส่ง `reviewed_by`/`reviewed_at` จาก client (server-trusted)
  - Form submit แยก branch: existing → `_patchLeave(safe fields)` + `leave_update` audit; insert → `leave_create` audit
  - Safe fields whitelist สำหรับ edit: `leave_type/start_date/end_date/days_count/reason` (ห้าม `status/reviewed_*/user_id/created_by`)
- **Audit:** +`leave_create` +`leave_update` (เพิ่มจาก approve/reject/cancel/delete เดิม)
- **Tests:** +8 source-level (RPC helper + _doReview switch + audit metadata server-trusted + form branch + safe-fields whitelist + create/update audit + SQL trigger/RPC structure)
- **Gates:** lint 0 / unit 760/760 / e2e 11/11 / audit moderate 0

---

## 5.63.1 (build 314) — 2026-05-27 🔗 Phase 92.44 — Payroll Payment Journal Visibility

- **fix(payroll/accounting) [missing-pv]:** หลังจ่าย payroll หน้า "บัญชี → สมุดรายวัน" ไม่มีรายการให้ตรวจ — PV ขาด → ปิดงวด/audit smoke ผ่านไม่ได้
- **Root cause:** `_markPaid` สร้างแค่ expense row (Phase 76, `#payroll-{id}` tag) แต่ไม่มีใครเรียก `postJournalForExpense` ตามมา → ไม่มี PV journal เกิดขึ้น

### New export: `postJournalForPayroll(payroll, paidAt, paymentMethod, opts)`
- **ไฟล์:** `modules/accounting/auto_post.js`
- **Source marker:** `source_table="staff_payroll"`, `source_id=payroll.id` (direct path — ไม่ผ่าน expense)
- **Doc type:** `"PV"` (จ่าย)
- **Mapping:** ใช้ `payroll_salary` ที่มีอยู่แล้ว (Dr 5200 / Cr 1110 default)
- **Override credit:** `transfer/โอน/bank/cheque` → 1130 (เงินฝากธนาคาร)
- **Description format ตาม spec:** `"จ่ายเงินเดือน — {employeeName} — {periodLabel}"` (เช่น `"จ่ายเงินเดือน — sompong — พฤษภาคม 2569"`)
- **Idempotency:** ผ่าน `_postJournal` core ที่มี unique partial index `(source_table, source_id)` อยู่แล้ว → กดจ่ายซ้ำ = 409 = ไม่สร้างซ้ำ
- **Period lock + RLS handling:** ผ่าน core เดิม

### Wire-up
- **`_markPaid`:** หลัง `_createSalaryExpense` → lazy import + call `postJournalForPayroll({ ...payroll, paid_at: paidAt, payment_method: method }, paidAt, method, { employeeName, periodLabel })`
  - Silent fail — payroll paid + expense ลงไปแล้ว ไม่ block UX; admin re-post manually ทีหลังได้
- **`_deletePayroll`:** ถ้า paid → `voidJvForSource("staff_payroll", id)` **ก่อน** DELETE expense + DELETE payroll
  - Idempotent — voidJV silent ถ้าไม่มี
  - เก็บ `reversedJournal` count → audit metadata `reversed_journal_count`
  - Toast: `"ลบ payroll + ย้อนรายจ่าย + JV {count} แล้ว ✅"`

### ไม่แตะ
- SQL schema — unique index `idx_je_source_unique` มีอยู่แล้วใน Phase 88 (รองรับ `source_table="staff_payroll"`)
- Payroll math formula (Phase 92.41b dailyRate fix อยู่)
- audit_log `payroll_pay`/`payroll_delete` (Phase 92.43 B4) — ทำงานเหมือนเดิม + เพิ่ม `reversed_journal_count` ใน metadata
- Expense row creation (Phase 76 `#payroll-{id}` tag) — ยังสร้างเหมือนเดิม (สำหรับ expense list view)
- Leave Calendar / HR Overview (Phase 92.40-42)

### Tests +6 source-level (`tests/payroll.test.js`)
- `postJournalForPayroll` export + source_table="staff_payroll" + PV doc + payroll_salary mapping + description format + transfer override
- ผ่าน `_postJournal` core (idempotency เดิม)
- `_markPaid` เรียก + ส่ง employeeName/periodLabel + lazy import
- `_deletePayroll` เรียก `voidJvForSource("staff_payroll", id)` + `reversed_journal_count` ใน audit
- Zero amount guard
- Uses `dateBkk` (B2 regression guard — ห้าม UTC slice)
- Unit **738 → 744**

### Gates ✅
- `npm run lint:errors` exit 0
- `npm test` = **744/744**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 313 → 314; version 5.63.0 → 5.63.1 (patch — visibility/journal link, ไม่เปลี่ยน schema/math)

---

## 5.63.0 (build 313) — 2026-05-27 🛡️ Phase 92.43 — Payroll/Accounting Audit Hardening (B1-B4)

> **MINOR bump 5.62→5.63** — behavior change ใหญ่ในด้าน accounting/audit ก่อนใช้ปิดงวดจริง

### B1 — total_amount persistence (no more NULL)
- `_savePayroll` payload ส่ง `total_amount` ผ่าน pure helper ใหม่ `computePayrollTotal(payroll)` ทุกครั้ง
- Formula: `round2(base_salary + overtime + welfare + bonus + commission - deductions)`
- ฝั่ง app คำนวณเอง — ถ้า DB มี trigger/generated column ก็ยอมรับค่าที่ส่ง

### B2 — paid expense_date timezone fix (off-by-1 ตอนเที่ยงคืน-06:59 ไทย)
- Pure helper ใหม่ `expenseDateForPaidPayroll(when?)` wrap `dateBkk()` (Asia/Bangkok)
- `_createSalaryExpense` เปลี่ยน `expense_date: paidAt.slice(0,10)` (UTC) → `expenseDateForPaidPayroll(paidAt)` (BKK)
- เคสที่กระทบ: จ่าย payroll ตอน 00:00-06:59 ไทย (UTC 17:00-23:59 previous day) → expense_date เคยตกเป็นวันเมื่อวาน → period ผิด

### B3 — paid payroll delete reverses linked expense (no orphans)
- Pure helper ใหม่ `canDeletePayroll(payroll)` → `{allowed, requiresReverse, expenseTag, reason}`
- `_deletePayroll`:
  - ถ้า paid → confirm บอกชัด "รายจ่ายที่เชื่อมอยู่จะถูกลบด้วย"
  - DELETE expense by `note ilike "%#payroll-{id}%"` ก่อน (idempotent — ถ้าไม่มี = no-op)
  - แล้วค่อย DELETE payroll
  - เก็บ `reversedExpense` flag ใน audit metadata
- `_markPaid` idempotency guard — payroll.paid_at มีอยู่แล้ว → skip (กันกดซ้ำ)

### B4 — Audit trail via `logActivity` (Phase 57)
- เพิ่ม logActivity calls ทั้ง 7 mutations:
  - **payroll_create / payroll_update** — metadata: `{before, after, employee_id, period_month, total_amount}`
  - **payroll_pay** — metadata: `{payment_method, paid_at, expense_date_bkk, total_amount, expense_tag}`
  - **payroll_delete** — metadata: `{was_paid, reversed_expense, expense_tag, before snapshot}`
  - **leave_approve / leave_reject** — metadata: `{before:{status,reviewed_by,reviewed_at}, after, review_note, leave_type, days_count}`
  - **leave_cancel** — metadata: `{before, after, leave_type, days_count}`
  - **leave_delete** — metadata: `{before snapshot}` (เก็บก่อน DELETE)

### iOS PWA safe: `window.prompt` → custom modal
- `_doReview` ใน leave_management.js ใช้ `_askReviewNote(decisionLabel)` (textarea + OK/Cancel + ESC/backdrop close)
- Pattern เดียวกับ `_askPaymentMethod` (Phase 75) — iOS PWA standalone บางครั้งไม่แสดง prompt → modal safe ทุก device
- Role=dialog + aria-modal=true (a11y)

### ไม่แตะ
- SQL/RLS schema — ฝั่ง app handle total_amount
- payroll math formula (Phase 92.41b dailyRate fix ยังอยู่)
- Leave Calendar UI / popover (Phase 92.40-92.42)
- HR Overview navigation (Phase 92.41)

### Tests +24 (ไฟล์ใหม่ `tests/payroll.test.js`)
- `computePayrollTotal` 5 (formula / production scenario / round / missing / negative)
- `expenseDateForPaidPayroll` 5 (03:00/23:59/00:01 BKK + ISO string + default now)
- `canDeletePayroll` 3 (unpaid / paid / no-id)
- Source-level 11 (payload total_amount / expense_date helper / no paidAt.slice / reverse expense / audit calls / idempotency / no window.prompt / askReviewNote modal a11y)
- Unit **718 → 738** (+20 net หลังลบ duplicates)

### Gates ✅
- `npm run lint:errors` exit 0
- `npm test` = **738/738**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 312 → 313; version 5.62.9 → 5.63.0 (minor — accounting/audit behavior change)

---

## 5.62.9 (build 312) — 2026-05-27 ✨ Phase 92.42 — Leave Page Click-through Cards / Internal Navigation

- **feat(leave/cards) [click-through]:** ทำ KPI + Balance cards ในหน้า "วันลา" คลิกได้ — drill-down ภายในหน้า (filter, ไม่เปลี่ยน route)
- **Pure helpers ใหม่:**
  - `kpiFilterActionFor(kind)` → `{status, clearMonth, switchTable}`
    - `pending` → clearMonth + switchTable (sub label = "ทุกเดือน" + ให้ admin approve/reject ได้สะดวก)
    - `approved`/`rejected`/`approvedDays` → keep month + keep view (sub label = monthTh)
  - `balanceFilterActionFor(leaveType)` → `{leaveType, clearMonth, resetStatus}` (5 types ใน `LEAVE_TYPES`)
    - balance scope = ทั้งปี → clear month + reset status=all เห็นทุก row ของ type นั้น
- **`_kpiCard`:** เพิ่ม `clickKind` param → wrapper เป็น `class="lm-kpi-card"` + `data-lm-kpi-kind` + `role="button"` + `tabindex="0"` + `aria-label` dynamic + chevron `›`
- **`_renderBalanceCard`:** wrapper เป็น `class="lm-balance-card"` + `data-lm-balance-type` + `role="button"` + `tabindex="0"` + `aria-label` + chevron `›`
- **Container `<style>`:** `.lm-kpi-card:hover` + `.lm-balance-card:hover` (translateY -1px + shadow + border darken) + `:focus-visible` outline 2px solid #0284c7
- **Wiring `_rerender`:**
  - `.lm-kpi-card[data-lm-kpi-kind]` click + Enter/Space → `kpiFilterActionFor(kind)` → set activeStatus/Month/View + rerender + scroll to lmTbody/lmCalendar
  - `.lm-balance-card[data-lm-balance-type]` click + Enter/Space → `balanceFilterActionFor(type)` → set activeType + clear month + reset status + rerender + scroll
- **ไม่แตะ:** route navigation (filter ภายในเท่านั้น), pending alert (Phase 92.41c ยังทำงาน), SQL/payroll/balance calc/calendar logic/event chip/popover
- Tests +11 (kpi 4 mappings + balance 2 + 5 source-level wiring/regression). Unit **705 → 718** (+13 รวม assertions)
- verify เขียว: lint:errors 0/0 · unit 718/718 · e2e 11/11 · audit 0

**Build:** 311 → 312; version 5.62.8 → 5.62.9 (minor — feature)

---

## 5.62.8 (build 311) — 2026-05-27 🧯 Phase 92.41c — HOTFIX Leave Page Pending Alert/KPI Sync

- **fix(leave/kpi) [month-scope-mismatch]:** หน้า "วันลา" KPI "รออนุมัติ" แสดง 0 ทั้งที่ HR Overview เห็น alert "คำขอลารออนุมัติ 1 รายการ" + Balance card เห็น pending +3
- **Root cause:** KPI value ใช้ `summary.pending` จาก `summarizeLeaves(leaves, activeMonth)` ที่ filter ด้วย `activeMonth` → pending leaves ที่ `start_date` นอกเดือนนี้ถูกตัดออก. แต่ KPI sub label = **"ทุกเดือน"** (สื่อว่าไม่ filter month) → mismatch.
- **แก้:**
  - Pure helper ใหม่ `countPendingLeaves(rows)` — นับ pending ทั้งหมด **ไม่ filter month**
  - Pure helper ใหม่ `pendingLeaveAlertMeta(count, role)` — return `{count, message, actionLabel}` ถ้า `role === "admin"` + `count > 0`, null อื่น ๆ
  - `_rerender`: คำนวณ `pendingTotal = countPendingLeaves(leaves)` → ใช้เป็น value ของ KPI "รออนุมัติ" (ตรงกับ "ทุกเดือน" label + ตรงกับ HR Overview)
  - Render admin alert chip **"⏳ คำขอลารออนุมัติ X รายการ — [ดูรายการรออนุมัติ →]"** ใต้ KPI cards (เฉพาะ admin + pendingTotal > 0)
  - Click alert → `activeStatus="pending"` + `activeMonth=""` (clear) + `activeView="table"` + rerender + scroll table
- **ไม่แตะ:** `summarizeLeaves` signature (existing tests ผ่าน), payroll, balance/quota, calendar, idempotency
- Tests +10 (countPendingLeaves 3 cases + pendingLeaveAlertMeta 3 cases + filterLeaves status=all regression + 4 source-level wiring/regression). Unit **695 → 705**
- verify เขียว: lint:errors 0/0 · unit 705/705 · e2e 11/11 · audit 0

**Build:** 310 → 311; version 5.62.7 → 5.62.8 (patch hotfix — KPI/alert sync)

---

## 5.62.7 (build 310) — 2026-05-27 🧯 Phase 92.41b — HOTFIX Payroll Leave Deduction Wrong Daily Rate

- **fix(payroll/leave) [wrong-rate-26-baht]:** production scenario:
  - เปิดคำนวณค่าจ้างรายวัน, จำนวนวันทำงาน=13, ค่าจ้าง/วัน=400, เงินเดือน=5200 ถูก
  - Leave over quota = 2 วัน ถูก
  - แต่ suggested deduction แสดง **฿26** (= 2 × 13) — ผิด ควรเป็น **฿800** (= 2 × 400)
- **Root cause:** `_refreshLeaveDecision` ใน `modules/payroll.js` ternary:
  ```js
  const dailyRate = dailyOn && dailyInp > 0 ? dailyInp : Number(emp?.daily_rate || 0);
  ```
  ตอน `dailyInp` ว่างชั่วคราว / race / 0 → fallback ไปอ่าน `emp.daily_rate` จาก profiles
  ถ้าค่าใน DB เป็น 13 (เช่นเคยบันทึก hourly rate ผิดที่) → ใช้เป็น dailyRate ทันที = bug 26 บาท
- **แก้:** ลบ fallback `emp.daily_rate` ออก → `dailyRate = dailyOn && dailyInp > 0 ? dailyInp : 0`
  - ส่ง 0 ให้ helper `decidePayrollLeaveImpact` → ตก fallback ไป `baseSalary÷30` อย่างเดียว (predictable)
  - profile rate ไม่มาเกี่ยว → ห้าม stale value ส่งผลกับ payroll period นี้
- **Mapping guard:** เพิ่ม source-level test ห้าม swap `prDailyRate` (ค่าจ้าง/วัน) ↔ `prDaysWorked` (จำนวนวันทำงาน)
- **Helper ไม่แตะ:** `decidePayrollLeaveImpact` + `calcUnpaidLeaveDeduction` คืน 800 ถูกอยู่แล้วถ้า dailyRate=400 ส่งมา — bug อยู่ที่ call site ของ payroll.js
- **ไม่แตะ:** payroll math, save flow, leave balance, idempotency marker
- Tests +4 (regression 13/400/2 → 800 · dailyRate=0 fallback ÷30 → 346.67 · helper priority dailyRate > baseSalary · source guard no-fallback). Unit **691 → 695**
- verify เขียว: lint:errors 0/0 · unit 695/695 · e2e 11/11 · audit 0

**Build:** 309 → 310; version 5.62.6 → 5.62.7 (patch hotfix — money math correctness)

---

## 5.62.6 (build 309) — 2026-05-27 ✨ Phase 92.41 — HR Overview Click-through Navigation

- **feat(hr_overview) [click-through]:** ขยาย KPI cards 5 ใบหลักให้ drill-down ไปหน้าเกี่ยวข้องผ่าน pure helper `kpiClickRouteFor(kind)`
  - **เดิม:** เฉพาะ Payroll (เฉพาะตอน unpaid > 0) + Offline Queue คลิกได้
  - **ใหม่:** ทุกใบคลิกได้ (รวม Payroll 0/0 — drill-down ดีกว่า disable เงียบ)
  - Mapping: `total_staff → departments`, `present_today / open_sessions / offline_pending → time_clock`, `ot_month → payroll_overview`, `payroll → payroll`
  - Destination pages default = วันนี้/เดือนปัจจุบันอยู่แล้ว → ไม่ต้องส่ง filter ข้ามหน้า (lean)
- **feat(hr_overview) [a11y]:** `_kpiCard` เพิ่ม `aria-label` dynamic ("label — value — sub (เปิดเพื่อจัดการ)") + `role="button"` + `tabindex="0"` + small chevron `›` แทน text ลอย "คลิกเพื่อจัดการ →" (UX: 5 ใบ noisy)
- **feat(hr_overview) [affordance]:** Container `<style>` rules ใหม่ — `.hr-kpi-card:hover` (translateY -1px + shadow + border darken), `:focus-visible` outline 2px solid #0284c7, `.hr-row-employee:hover` + `:focus-within`
- **feat(hr_overview) [modal]:** Employee drill-down modal footer เพิ่มปุ่ม **"💰 ไป Payroll"** คู่กับ "🕒 ไป Time Clock" (data-hr-action delegation เดิม close modal then navigate)
- **ไม่แตะ:** SQL/RLS, payroll math, leave deduction, time clock helpers, employee modal logic, filter state ข้ามหน้า
- Tests +11 (`kpiClickRouteFor` 6 mappings + valid-route sanity + 4 source-level wiring). Unit **680 → 691**
- verify เขียว: lint:errors 0/0 · unit 691/691 · e2e 11/11 · audit 0

**Build:** 308 → 309; version 5.62.5 → 5.62.6 (minor — feature)

---

## 5.62.5 (build 308) — 2026-05-27 🧯 Phase 92.40b — HOTFIX day-list hint copy not clickable

- **fix(leave/day-list) [misleading-copy]:** hint ใต้ day-list popover "คลิกรายการเพื่อดูรายละเอียด" ทำให้ user คิดว่า hint เป็นปุ่มกดได้ (แต่จริง ๆ ต้องกด event item ด้านบน)
- **แก้:**
  - เปลี่ยน copy: "คลิกรายการเพื่อดูรายละเอียด" → **"เลือกรายการด้านบนเพื่อเปิดรายละเอียด"** — ชัดเจนว่าเป็น instruction ไม่ใช่ action
  - Style เป็น help text: `color:#94a3b8` (อ่อนลง), `cursor:default`, `user-select:none`, `font-style:italic`, `class="lm-day-hint"` + `aria-hidden="true"`
  - **เสริม a11y ของ event chip** (UX upside): เพิ่ม `aria-label="เปิดรายละเอียดคำขอลา {name} ประเภท{type} สถานะ{status}"` + `.lm-cal-event:focus-visible { outline:2px solid #0284c7 }` → keyboard/screen reader users เห็นว่ากดได้
- **ไม่แตะ:** event click flow / behavior อื่น
- Tests +4 source-level (no old hint copy / new copy + class + aria + style / chip aria-label + cursor:pointer / focus-visible rule). Unit **676 → 680**
- verify เขียว: lint:errors 0/0 · unit 680/680 · e2e 11/11 · audit 0

**Build:** 307 → 308; version 5.62.4 → 5.62.5 (patch hotfix — UX copy/affordance)

---

## 5.62.4 (build 307) — 2026-05-27 ✨ Phase 92.40 — Leave Calendar Event Detail Actions Polish

- **feat(leave/calendar) [actions]:** popover รายละเอียดของ event ใน Calendar ใช้ helper เดียวเป็น single source of truth + ขยาย detail/UX
  - `calendarDetailActionsFor(leave, currentUserId, role)` — pure helper คืน descriptor array `{kind, label, style}` (test ได้, reuse `canEditLeave` + `canReviewLeave` ไม่สร้าง rule ใหม่)
    - admin pending: `approve`/`reject`/`edit`/`delete`/`viewInTable`
    - admin non-pending: `edit`/`delete`/`viewInTable`
    - non-admin own pending: `cancel`/`viewInTable`
    - non-admin อื่น ๆ: `viewInTable` เท่านั้น (ไม่เห็น admin actions)
  - `_renderLeavePopover` เสริม: header แสดง email + role ใต้ชื่อ, body เพิ่มบรรทัด "ผู้พิจารณา: ... · 27 พ.ค. 14:30" (helper `formatReviewedAt` Asia/Bangkok), inline error banner `#lmPopError`
- **feat(leave/calendar) [navigate]:** ปุ่ม "📋 ดูในตาราง" ทุก role → `_jumpToTableRow`: switch view → scroll + highlight row 2.5s (`@keyframes lmRowHighlight`)
  - ถ้า row อยู่นอก filter ปัจจุบัน → `window.confirm` ก่อน reset (status=all, type=all, month=row.start_date) — ไม่ทำให้ user เสีย state โดยไม่รู้ตัว
  - `<tr data-lm-id="...">` ใน `_renderTbody` เป็น anchor สำหรับ `querySelector`
- **fix(leave/calendar) [error-stays-open]:** `_doReview`/`_doCancel`/`_doDelete` คืน `{ok, error}` แทน void; `_openLeavePopover` ใช้ `_runPopoverAction` wrapper — await **ก่อน** close → success ค่อยปิด, fail ค้าง popover + แสดง banner + busy-guard กัน double-click
- **ไม่แตะ:** SQL/RLS, payroll leave deduction, balance/quota, table row UI/handlers (เพิ่มเฉพาะ `data-lm-id`)
- Tests +21 (`calendarDetailActionsFor` 8 role/status matrices + `formatReviewedAt` 3 + source-level 10). Unit **655 → 676**
- verify เขียว: lint:errors 0/0 · unit 676/676 · e2e 11/11 · audit 0

**Build:** 306 → 307; version 5.62.3 → 5.62.4 (minor — feature)

---

## 5.62.3 (build 306) — 2026-05-26 🧯 Phase 92.39d — HOTFIX dense day popover invisible (CSS scope bug)

- **fix(leave/popover) [css-scope]:** Phase 92.39c ยังไม่แก้ root cause — คลิก "+N รายการ" backdrop เปิด แต่ day-list dialog content **invisible**
  - สาเหตุจริง: `.lm-pop-dialog`/`.lm-pop-body` CSS rules ถูก inject ผ่าน inline style tag ใน `_renderLeavePopover` template literal เท่านั้น → `_renderDayListPopover` ใช้ class เดียวกันแต่ render โดยไม่ inject CSS → dialog ใช้ browser default → no width/max-height/background → **invisible** (เห็นแค่ backdrop blur)
- **แก้:**
  - ย้าย `.lm-pop-dialog`/`.lm-pop-body` CSS rules จาก `_renderLeavePopover` template ไปอยู่ใน container scope (style tag หลัง `#lmPopover`) → render ครั้งเดียวต่อ `_rerender` → CSS available ตอน popover ใดเปิดก็ตาม
  - **DRY refactor:** รวม `_openLeavePopover` + `_openDayListPopover` ใช้ shared `_openPopover(html, kind, bindActions)`:
    - Guard empty content (console.warn + `return false` ถ้า html ว่าง)
    - Sanity check ว่ามี `.lm-pop-dialog` markup ใน html (กัน scope bug ซ้ำ)
    - Inject + `display:block` + focus close + register Esc + backdrop click → shared logic
    - kind-specific bind actions ผ่าน callback parameter
- **ไม่แตะ:** behavior — เฉพาะ CSS scope + open function refactor
- Tests +6 source-level (no inline style in popover templates / container CSS รวม dialog rules / `_openPopover` guard + DRY / day list output structure). Unit **651 → 655** (net +4 หลังตัด focus duplicate test)
- verify เขียว: lint:errors 0/0 · unit 655/655 · e2e 11/11 · audit 0

**Build:** 305 → 306; version 5.62.2 → 5.62.3 (patch hotfix — root cause fix, no SQL)

---

## 5.62.2 (build 305) — 2026-05-26 🧯 Phase 92.39c — HOTFIX popover visibility/position

- **fix(leave/popover) [viewport-clipping]:** คลิก "+N รายการ" → backdrop เปิด แต่ day-list popover อาจตกขอบจอ
  - สาเหตุ: `#lmPopover` ใช้ `display:block` + `.lm-pop-dialog` ใช้ `position:relative; margin:60px auto` → ไม่มี flex centering, ไม่มี max-height, content สูงเกินขอบจอ = ทะลุล่าง + container `overflow:visible` ไม่ scroll
- **แก้:**
  - `#lmPopover` (selector `[style*="display:block"]`) → `display:flex; align-items:flex-start; justify-content:center; overflow-y:auto; padding:48px 16px` (desktop)
  - Mobile (≤768px): `align-items:stretch; padding:0; overflow:hidden` เพื่อให้ bottom sheet เต็มจอ
  - `.lm-pop-dialog` desktop: `max-height: calc(100vh - 96px); display:flex; flex-direction:column; z-index:1`
  - `.lm-pop-body` class ใน inner content ของทั้ง `_renderLeavePopover` + `_renderDayListPopover` → `flex:1 1 auto; overflow-y:auto` (inner scroll ไม่ทำ dialog ขยาย)
  - Backdrop explicit `z-index:0` (กัน dialog ถูก stack ใต้)
  - Focus close button หลัง open ผ่าน `setTimeout` — a11y + ยืนยัน popover visible
- **ไม่แตะ:** behavior อื่น — เฉพาะ layout/visibility
- Tests +5 source-level (container flex, dialog max-height, z-index hierarchy, body class, focus). Unit **646 → 651**
- verify เขียว: lint:errors 0/0 · unit 651/651 · e2e 11/11 · audit 0

**Build:** 304 → 305; version 5.62.1 → 5.62.2 (patch hotfix — no behavior change, no SQL)

---

## 5.62.1 (build 304) — 2026-05-26 🧪 Phase 92.39b — Calendar Dense Day "+N รายการ" verification

- **test(leave/calendar) [dense-day-edges]:** เพิ่ม edge tests สำหรับ `limitCalendarDayEvents`:
  - 0 events → visible=[] overflow=0 (ไม่ render chip)
  - boundary `events.length === cap` → visible เต็ม overflow=0
  - `events.length === cap+1` → off-by-one check (visible cap, overflow 1)
  - 5 events dense scenario (cap=3) → 3 visible + 2 overflow + ลำดับ preserve
  - cap=2 tighter → 5 events → 2 visible + 3 overflow
  - immutability: `visible.push()` ไม่กระทบ events เดิม
- **test(leave/calendar) [source-wiring]:** verify end-to-end pipeline:
  - Template "+ ${overflowCount} รายการ" + class `lm-cal-more` + `data-lm-date="${escHtml(cell.dateStr)}"`
  - `_renderCalendarMonthGrid` เรียก `limitCalendarDayEvents(events, _CAL_DESKTOP_MAX_VISIBLE)` กับ cap=3
  - Click delegation: `closest('.lm-cal-more')` → `_openDayListPopover(dateStr, filtered)`
  - `_openDayListPopover` flow: `groupLeavesByDate(filtered, activeMonth)` → `byDate.get(dateStr)` → `_renderDayListPopover(dateStr, evs, profileMap)`
  - `_renderDayListPopover` map events → `_calendarEventChip` (เหมือน cell desktop)
  - Chained: click event ใน popover → close → `setTimeout(_openLeavePopover(leave), 0)`
  - Esc key + backdrop close ทำงานทั้ง 2 popover types
- **ผลลัพธ์:** pipeline verified ไม่มี bug → pure verification release (ไม่แตะ behavior)
- Tests +13 (7 helper edges + 6 source-level). Unit **633 → 646**
- verify เขียว: lint:errors 0/0 · unit 646/646 · e2e 11/11 · audit 0

**Build:** 303 → 304; version 5.62.0 → 5.62.1 (patch verification release — no behavior change, no SQL)

---

## 5.62.0 (build 303) — 2026-05-26 📱 Phase 92.39 — Leave Calendar Mobile Agenda + Dense Day Polish

- **feat(leave/calendar) [mobile-agenda]:** breakpoint 720→768px; mobile agenda empty state ดีขึ้น (icon ใหญ่ + sub-hint)
- **feat(leave/calendar) [dense-day]:** desktop cell cap = 3 events (ผ่าน `limitCalendarDayEvents`); overflow → "+N รายการ" → day-list popover; cell `max-height: 140px` กัน grid แตก; chip truncate `text-overflow:ellipsis`
- **feat(leave/popover) [bottom-sheet]:** mobile popover (≤768px) เป็น bottom sheet — `position:fixed bottom:0`, full-width, slide-up animation, max-height 80vh, grabber bar; desktop ยัง centered modal เดิม
- **feat(leave/popover) [esc-close]:** Esc key ปิด popover ได้ (register on open, unregister on close — กัน listener leak)
- **3 pure helpers ใหม่:** `groupCalendarAgendaDays` (Map → array + dow info) · `limitCalendarDayEvents` ({visible, overflowCount}) · `formatAgendaDateLabel` ("วันพุธ 14 พ.ค.")
- **refactor:** `_renderCalendarMonthGrid` / `_renderCalendarAgenda` / `_renderDayListPopover` ใช้ pure helpers (test ได้ทั้งหมด, ลบ inline logic)
- **ไม่แตะ:** SQL / RLS / Payroll flow / Balance / Quota warning (build 302) / Time Clock / desktop chip rendering / edit modal
- Tests +11 (group 4 + limit 4 + format 3). Unit **622 → 633**
- verify เขียว: lint:errors 0/0 · unit 633/633 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 302 → 303; version 5.61.2 → 5.62.0 (minor — UI/UX polish + new helpers, no SQL)

---

## 5.61.2 (build 302) — 2026-05-26 🧯 Phase 92.38c — HOTFIX Leave edit quota warning double-count

- **fix(leave/quota-warn) [edit-exclude-self]:** quota warning ใน edit leave modal นับ record ตัวเองซ้ำ
  - sompong vacation approved 2+10 = 12/10 → edit record 2 วัน → warning "เกิน quota 4 วัน" (ควรเป็น 2)
  - edit record 10 วัน → warning "เกิน quota 12 วัน" (ควรเป็น 2)
  - สาเหตุ: logic เดิมลบเฉพาะ `existing.days_count` ของ `status === "pending"` — **approved record ถูกนับซ้ำใน `b.used`**
- **แก้:** `calcBalancesForUser` รับ optional `excludeLeaveId` (param ใหม่)
  - filter row นี้ออกก่อนนับ (ทั้ง approved + pending) · cross-type id compare (string ↔ number safe)
  - `_refreshQuotaWarn` ใน form modal ส่ง `excludeLeaveId: existing?.id` ตอน edit
  - calc delta ถูกเมื่อเปลี่ยน days (2→5 = +3, 10→8 = -2) หรือเปลี่ยน leave_type bucket
  - Create mode (existing=null → excludeLeaveId=undefined) → behavior เดิม (no-op)
- **ไม่แตะ:** SQL / RLS / Calendar view / Payroll decision / Balance render — เฉพาะ quota warning ใน leave form modal
- Tests +7 (edit approved 2/10, edit pending, change bucket, non-existent id, undef/null/empty, number/string id). Unit **615 → 622**
- verify เขียว: lint:errors 0/0 · unit 622/622 · audit 0

**Build:** 301 → 302; version 5.61.1 → 5.61.2 (patch hotfix — no SQL)

---

## 5.61.1 (build 301) — 2026-05-26 🧯 Phase 92.38b — HOTFIX TZ-dependent calendar helpers

- **fix(leave/calendar) [ci-tz-parity]:** CI Linux (TZ=UTC) ทำให้ 2 unit tests fail
  - `expandLeaveRangeToMonthDays — leave ข้ามเดือน → clip` และ `getCalendarMonthGrid — first cell คือ Sunday` (ผ่านบน local Bangkok TZ แต่ fail บน CI)
  - สาเหตุ: ใช้ `Date.getDay()` / `Date.setDate()` / `toLocaleDateString({timeZone: ...})` ที่อ่าน local TZ ของ environment
- **แก้:** เพิ่ม internal helpers pure epoch math:
  - `_bkkMidnightMs(yyyyMmDd)` = `Date.parse(s + "T00:00:00+07:00")`
  - `_bkkDateStr(ms)` = format UTC components หลัง shift +7h
  - `_bkkDow(ms)` = epoch day + 4 offset (1970-01-01 = Thu)
- ใช้ helpers ใหม่ใน `expandLeaveRangeToMonthDays` + `getCalendarMonthGrid` แทน Date method ที่พึ่ง local TZ
- **ไม่กระทบ behavior:** local Bangkok TZ ยังผ่าน 615/615 · Simulated UTC env (`$env:TZ='UTC'`) ผ่าน 108/108 ใน leave_management tests
- ไม่แตะ UI / payroll / SQL / RLS / Leave foundation
- verify เขียว: lint:errors 0/0 · unit 615/615 · audit 0

**Build:** 300 → 301; version 5.61.0 → 5.61.1 (patch hotfix — CI parity, no SQL)

---

## 5.61.0 (build 300) — 2026-05-26 📅 Phase 92.38 — Calendar Leave View

- **feat(leave) [calendar-view]:** หน้า "วันลา" รองรับ 2 มุมมอง (ตาราง/ปฏิทิน) toggle ใน filter bar — default ตาราง
- **desktop:** 7-col grid (อา–เสาร์, Sun-first), 6 แถว, event chips สีตามประเภท (พักร้อน/ป่วย/กิจ/ไม่รับค่าจ้าง/อื่นๆ)
  - pending = dashed border · rejected/cancelled = faded · today highlight (เหลือง) · weekend = แดง · overflow >3 → "+N เพิ่มเติม" → day list popover
- **mobile (≤720px):** agenda list รายวัน group เฉพาะวันที่มี event + day-of-week label ไทย
- **interaction:** click chip → popover รายละเอียด + ปุ่ม approve/reject/cancel/edit/delete ตาม role (canEditLeave/canReviewLeave guard เดิม)
- **multi-day:** leave หลายวัน expand เป็นรายวัน + suffix "(ต่อ)" บนวันที่ไม่ใช่วันเริ่ม · leave ข้ามเดือน clip เฉพาะวัน in-month
- **ไม่แตะ:** DB schema / RLS / payroll flow / Leave Balance helpers / Leave foundation / Time Clock
- 3 pure helpers ใหม่: `expandLeaveRangeToMonthDays` · `groupLeavesByDate` · `getCalendarMonthGrid` (Asia/Bangkok)
- Tests +20 (expand 7 + group 6 + grid 7 — edge: ข้ามเดือน, leap year, weekend col, today, overflow). Unit **595 → 615**
- verify เขียว: lint:errors 0/0 · unit 615/615 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 299 → 300; version 5.60.0 → 5.61.0 (minor — UI addition, no SQL)

---

## 5.60.0 (build 299) — 2026-05-26 🧮 Phase 92.37 — Payroll Save + Leave Deduction Finalization Audit

- **audit(payroll) [save-flow]:** ตรวจ flow หลังกด "+ บันทึก" ใน Payroll modal — `deductions`, `total_amount` และ `note` (รวม marker `หักลา N วัน`) ถูก persist ตามที่คาด · reopen รายการเดิมแล้วค่าไม่หาย
- **feat(payroll) [reopen-guard]:** กด "ดึงสรุปวันลา" ซ้ำหลังเปิดรายการเดิม — ระบบตรวจ marker ใน `prNote` ก่อนแสดงปุ่ม apply
  - ถ้ามี marker อยู่แล้ว → ปุ่ม `→ เติมลงช่องหัก` กลายเป็น disabled + label `✓ เติมแล้ว` (สีเทา)
  - แสดง info แบบ `ⓘ ตรวจพบรายการหักวันลาแล้ว (เติม ฿X ไว้แล้ว — แก้ช่องหัก/หมายเหตุก่อนบันทึก)`
  - apply row ยังเห็น policy breakdown อยู่ (ไม่ซ่อนเร็วเกินไป)
- **feat(payroll) [live-guard]:** `_refreshLeaveDecision` re-evaluate marker presence เมื่อ admin แก้ `prBase`/`prDailyRate`/`prDailyToggle`/`prNote` → ลบ marker จาก note ปุ่ม apply กลับมา active
- **ไม่แตะ:** payroll math / daily-rate logic / leave policy decision / save payload shape / DB / RLS / SQL / auto-deduction behavior
- Tests +5 (idempotency edge cases: smoke roundtrip, decimal markers, manual notes without marker, null/whitespace safety, exact-vs-regex priority). Unit **590 → 595**
- verify เขียว: lint:errors 0/0 · unit 595/595 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 298 → 299; version 5.59.1 → 5.60.0 (minor — UX behavior change, no SQL)

---

## 5.59.1 (build 298) — 2026-05-26 🧯 Phase 92.36b — Payroll leave apply idempotency hotfix

- **fix(payroll) [leave-deduction-idempotent]:** ปุ่ม "→ เติมลงช่องหัก" ใน Payroll modal กันกดซ้ำแบบ robust ขึ้น
  - Production smoke เจอว่า exact `note.includes(marker)` ยังหลุดได้ ทำให้ `หัก (-)` บวกซ้ำจาก `800 → 1600`
  - เพิ่ม `hasLeaveDeductionNoteMarker(note, marker)` ตรวจ pattern `หักลา ... วัน` ใน note ก่อนบวกยอดเสมอ แม้เลข/format marker จะต่างกัน (`2` vs `2.00`)
  - ถ้าเคยเติม leave deduction แล้ว → แจ้ง "เติมแล้วก่อนหน้านี้" และไม่บวกซ้ำ
- **ไม่แตะ:** payroll math / daily-rate logic / leave policy decision / DB / RLS / SQL / auto-deduction behavior
- Tests +1 (idempotency marker drift). Unit **589 → 590**
- verify เขียว: lint:errors 0/0 · unit 590/590 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 297 → 298; version 5.59.0 → 5.59.1 (patch hotfix — no SQL)

---

## 5.59.0 (build 297) — 2026-05-26 🧮 Phase 92.36 — Paid Leave Policy → Payroll Decision

- **feat(payroll) [policy decision]:** Payroll modal ปุ่ม "ดึงสรุปวันลา" ตอนนี้คำนวณ "policy breakdown" ตาม quota รายปี + แสดง 5 cards: ✅ Paid (in quota) · ⚠️ เกิน quota · 💸 ลาไม่รับค่าจ้าง · 📌 อื่น ๆ · → แนะนำหักรวม
  - vacation/sick/personal **ภายใน quota → ไม่หัก** (paid leave)
  - ส่วนที่เกิน quota → **แนะนำ** หักเฉพาะวันที่เกิน (advisory)
  - unpaid → แนะนำหักทั้งหมดเหมือนเดิม
  - other → ไม่หัก (info only)
- **feat(payroll) [apply button]:** ปุ่ม "→ เติมลงช่องหัก" รวม unpaid + over-quota เป็นยอดเดียว — idempotent ผ่าน combined marker ใน note (`หักลา N วัน (ไม่รับค่าจ้าง U, เกิน quota O)`) — กดซ้ำไม่บวกซ้ำ
- **UX:** copy ชัดว่า "แนะนำ" ไม่ใช่หักอัตโนมัติ + ข้อความ italic ใต้ปุ่ม apply
- **Pure helpers ใหม่:** `decidePayrollLeaveImpact({monthSummary, balances, dailyRate, baseSalary})` → returns paid/over/unpaid/other days + suggestedDeduction + perType breakdown · `leaveDeductionNoteMarker(decision)` → string marker สำหรับ idempotent check
- **Graceful:** ถ้ายังไม่มี SQL/policy หรือ balance fetch fail → balances=null → tracked types treat เป็น paid ทั้งหมด (ไม่ crash, unpaid logic ยังหักปกติ)
- **ไม่แตะ:** Leave Balance UI (92.35) / Time Clock self responsive (92.34) / staff_leaves write / payroll save / RLS เก่า / dep ใหม่
- Tests +13 (decidePayrollLeaveImpact 8 + leaveDeductionNoteMarker 5). Unit **576 → 589**
- verify เขียว: lint:errors 0/0 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 296 → 297; version 5.58.0 → 5.59.0 (minor — feature, no SQL)

---

## 5.58.0 (build 296) — 2026-05-26 💼 Phase 92.35 — Leave Policy + Balance/Quota Foundation

> ⚠️ **ต้องรัน SQL ก่อนใช้:** [`supabase-phase92-35-leave-policies-balances.sql`](supabase-phase92-35-leave-policies-balances.sql) — ก่อนรัน UI fallback ไป default policies + แสดงป้าย "ใช้ค่า default" (ไม่ crash)

- **feat(leave) [quota foundation]:** ตาราง `leave_policies` + `staff_leave_overrides` รองรับ quota รายปีต่อ leave_type พร้อม per-user override
  - Seed defaults: vacation **10**, sick **30**, personal **3**, unpaid **null** (ไม่นับ quota), other **null**
  - RLS: policies → ทุก authenticated user อ่านได้ + admin write · overrides → admin all + user อ่านของตัวเอง
  - 4 CHECK + 2 indexes + 2 updated_at triggers + 8 RLS policies + NOTIFY + verify · Re-run safe
- **feat(leave) [UI balance section]:** หน้า "🌴 วันลา" เพิ่ม **"💼 Balance / Quota (year)"** ใต้ KPI
  - Non-admin: balance ของตัวเอง · Admin: dropdown เลือกพนักงาน
  - 5 cards (vacation/sick/personal/unpaid/other) — used/quota + pending + remaining + chip สี (เขียว/ส้ม/แดง)
  - ป้าย "ใช้ค่า default" เมื่อ policies ยังไม่อยู่ใน DB
- **feat(leave) [form warning]:** Form modal "ขอลา" → ป้ายส้ม "⚠️ จะเกิน quota X วัน" (advisory) เมื่อ projected used+pending+new จะเกิน · ไม่ block submit
- **feat(payroll) [year balance]:** ปุ่ม "ดึงสรุปวันลา" ใน Payroll modal เพิ่ม **balance ทั้งปี advisory** ของพนักงาน · vacation/sick/personal **ยังไม่หักเงิน** · unpaid logic เดิม (suggest deduction + apply)
- **Pure helpers ใหม่ (test-friendly):** `defaultLeavePolicies` · `effectiveQuotaForUser` (override > policy > default) · `calcLeaveBalance` (used/pending/remaining/overQuota/willExceed) · `calcBalancesForUser` (per type, filter ปี, overlap) · `isOverQuotaWarning` · `formatBalanceLabel` · `fetchLeavePolicies` · `fetchLeaveOverridesForUser` (graceful NO_TABLE)
- **ไม่แตะ:** money math เดิม / staff_leaves write logic / payroll save / RLS เก่า / Time Clock self responsive (build 295) ไม่ regression / dep ใหม่
- Tests +28 (defaultPolicies 1 + effectiveQuota 6 + calcBalance 5 + calcBalancesForUser 4 + isOverQuotaWarning 4 + formatBalanceLabel 5 + fetch 3). Unit **548 → 576**
- verify เขียว: lint:errors 0/0 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 295 → 296; version 5.57.1 → 5.58.0 (minor — feature + SQL migration)

---

## 5.57.1 (build 295) — 2026-05-26 🕒 Phase 92.34 — Time Clock responsive fix

- **fix(time-clock) [self-responsive]:** หน้า “ลงเวลาทำงาน” ของพนักงานปรับจาก inline fixed card เป็น layout class-based (`tc-self-*`)
  - Desktop: ขยายจากการ์ดแคบกลางจอเป็น shell กว้างขึ้น พร้อม profile/action/summary/history ที่ใช้พื้นที่จอได้สมเหตุสมผล
  - Mobile: เปลี่ยนเป็น single column, จำกัดความกว้างทุก section, ปุ่มเต็มความกว้าง และให้ตารางประวัติ scroll ภายในกรอบแทนการดันทั้งหน้าออกขวา
- **ไม่แตะ** attendance logic / OT math / payroll / DB schema / RLS / API behavior
- **Version sync:** `style.css/main/selfheal/boot ?v=295`, `data-app-build="295"`, `data-app-version="5.57.1"`, SW cache `v295`
- verify เขียว: lint:errors 0/0 · unit 548/548 · e2e 11/11 · audit moderate 0 vulnerabilities · Playwright overflow check: mobile body/page 390px, table scroll เฉพาะ wrapper, desktop shell 1120px

**Build:** 294 → 295; version 5.57.0 → 5.57.1 (patch — responsive UI fix)

---

## 5.57.0 (build 294) — 2026-05-26 💸 Phase 92.33 — Leave → Payroll Integration (advisory + optional apply)

- **feat(payroll) [leave-integration]:** Payroll modal เพิ่ม section ใหม่ **🌴 วันลาในรอบเดือน** (สีส้ม, ก่อน Time Clock section)
  - ปุ่ม **📥 ดึงสรุปวันลา** — fetch approved leaves ของพนักงาน+เดือนนั้น (overlap query: `start_date <= toDate AND end_date >= fromDate`)
  - แสดง breakdown by leave_type: ป่วย / กิจ / พักร้อน / **ไม่รับค่าจ้าง** (ตัวหนาสีแดง) / อื่น ๆ
  - ถ้ามี **unpaidDays > 0** → คำนวณ suggested deduction + ป้าย "แนะนำหัก: ฿X (N วัน × daily_rate)" หรือ "N วัน × เงินเดือน÷30" ตามที่หาได้
  - ปุ่ม **→ เติมลงช่องหัก** — **additive** (บวกค่าเดิม ไม่ทับ) + ต่อ note "หักลาไม่รับค่าจ้าง N วัน" (idempotent กันต่อซ้ำ) + trigger recalc total อัตโนมัติ
  - recompute suggestion เมื่อแก้ `base_salary` / `daily_rate` / `daily_toggle` ภายหลัง
- **Pure helpers ใหม่ใน leave_management.js (test-friendly):**
  - `summarizeApprovedLeavesForPayroll(leaves)` → `{totalApprovedDays, unpaidDays, sickDays, personalDays, vacationDays, otherDays, records}` — skip non-approved + invalid days + ปัด 2 ตำแหน่ง
  - `calcUnpaidLeaveDeduction({unpaidDays, dailyRate, baseSalary})` → dailyRate priority 1, baseSalary÷30 fallback, ปัด 2 ตำแหน่ง, invalid → 0
  - `fetchApprovedLeavesForUser(userId, fromDate, toDate)` → **graceful** return shape `{ok:true,rows}` หรือ `{ok:false,code:NO_TABLE|BAD_INPUT|NO_CONFIG|HTTP, message}` (ไม่ throw)
- **★ Advisory only — ไม่ auto-mutate:** admin ต้องกด apply เอง · vacation/sick/personal แสดงข้อมูลเฉย ๆ ไม่หักเงิน · เฟสนี้ไม่บังคับ save อัตโนมัติ
- **Graceful ก่อนรัน SQL:** ถ้าตาราง `staff_leaves` ยังไม่มี → warning "⚠️ ยังไม่ได้ติดตั้งตารางวันลา (รัน supabase-phase92-32-leave-management.sql)" ไม่ crash modal
- **ไม่แตะ DB schema / RLS / money math เดิม / payroll save logic / dep ใหม่**
- Tests +12 (summarizeApprovedLeavesForPayroll 5 + calcUnpaidLeaveDeduction 5 + fetchApprovedLeavesForUser 2). Unit **536 → 548**
- verify เขียว: lint:errors 0/0 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 293 → 294; version 5.56.0 → 5.57.0 (minor — HR/payroll integration feature)

---

## 5.56.0 (build 293) — 2026-05-26 🌴 Phase 92.32 — Leave Management Foundation

> ⚠️ **ต้องรัน SQL ก่อนใช้:** เปิด Supabase Dashboard → SQL Editor → รัน [`supabase-phase92-32-leave-management.sql`](supabase-phase92-32-leave-management.sql) ก่อน. ฟีเจอร์ทำงาน graceful ก่อนรัน (แสดง error state ที่หน้า "วันลา" + HR Overview ไม่ขึ้น alert leave) — ไม่มี crash.

- **feat(leave) [foundation]:** ระบบจัดการ "วันลา / Leave Management" — เมนูใหม่ใน HR group **🌴 วันลา**
- **DB migration** `supabase-phase92-32-leave-management.sql` — additive only:
  - ตาราง `staff_leaves` (id, user_id uuid→auth.users, leave_type, start_date, end_date, days_count numeric(6,2), reason, status, reviewed_by, reviewed_at, review_note, created_by, created_at, updated_at)
  - 4 CHECK constraints (leave_type IN ภาวะที่ระบุ, status IN, end>=start, days>0)
  - 5 indexes (user_id, status, start_date, end_date, created_at desc)
  - `updated_at` trigger (auto-bump)
  - 4 RLS policies: **admin** ทำได้ทุกอย่าง · **non-admin** SELECT/INSERT own pending · UPDATE own pending → pending/cancelled · DELETE admin only
  - NOTIFY pgrst + verify queries
- **modules/leave_management.js** ใหม่ — admin + self view (role-aware):
  - KPI cards: รออนุมัติ / อนุมัติแล้ว / ปฏิเสธ / รวมวันที่อนุมัติ (filter by เดือน)
  - Filters: เดือน (date picker + "ทุกเดือน") + สถานะ + ประเภทลา
  - Table: พนักงาน · ประเภท chip สี · ช่วงวันที่ · วัน · เหตุผล · status chip · ผู้พิจารณา · action (approve/reject/cancel/delete)
  - Form modal: dropdown พนักงาน (admin only) · leave_type · start/end + auto-calc days (แก้ได้ครึ่งวัน) · reason
  - Approve/reject ผ่าน prompt() เก็บ `review_note` + confirm ก่อน mutation ทุกครั้ง
  - Export Excel ตาม filter ปัจจุบัน
- **Pure helpers (test-friendly):** `calcLeaveDays`, `leaveTypeLabel`, `leaveStatusMeta`, `filterLeaves`, `summarizeLeaves`, `canEditLeave`, `canReviewLeave` + `fetchPendingLeaveCount` (graceful)
- **HR Overview integration:**
  - `detectExceptions` รับ `pendingLeaves` → alert "คำขอลารออนุมัติ N รายการ" (medium severity)
  - `alertActionFor("pending_leaves")` → route `leave_management`
  - `fetchPendingLeaveCount()` graceful 0 ถ้าตารางยังไม่มี (ไม่ crash, ไม่แสดง alert)
- **ROLE_PAGES:** admin + sales + technician เข้าได้ (RLS server-side คุม self-scope สำหรับ non-admin)
- **Safety:** ไม่แตะ payroll/time_clock write behavior, money math, RLS เก่า · ไม่เพิ่ม dep · ไม่มี inline `onclick` · escape HTML ทุกค่า · confirm ก่อน approve/reject/cancel/delete · graceful HTTP error
- Tests +32 (leave_management 29: calcLeaveDays 4 + labels 6 + filterLeaves 8 + summary 3 + canEdit 5 + canReview 4 · hr_overview pending_leaves integration 3). Unit **504 → 536**
- verify เขียว: lint:errors 0/0 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 292 → 293; version 5.55.1 → 5.56.0 (minor — feature ใหม่ + SQL migration)

---

## 5.55.1 (build 292) — 2026-05-26 🔎 Phase 92.31 — HR Overview Department/Role Filters

- **feat(hr_overview) [filter]:** เพิ่ม **secondary filter bar** ที่ทำงานร่วมกับ status filter เดิม
  - **Department dropdown:** "ทุกแผนก" + แต่ละแผนก (พร้อม count) + **"ไม่ระบุแผนก"** สำหรับ profile ที่ไม่มี `department_id`
  - **Role chips:** ทั้งหมด / Admin / Sales / Technician / **อื่น ๆ** — ซ่อน bucket ที่ว่างยกเว้น "all" และ active
  - **ปุ่ม ✕ ล้างตัวกรอง** แสดงเฉพาะเมื่อ filter ใดไม่ใช่ default
- **feat(hr_overview) [cascade counts]:** ตัวเลขใน chips สะท้อนสถานะจริงตามลำดับ
  - dept counts = ใช้ rows ทั้งหมด
  - role counts = หลัง dept filter
  - status counts = หลัง dept + role filter
- **feat(hr_overview) [summary]:** ข้อความเหนือตาราง: **"แสดง X จาก Y คน · แผนก: Z · Role: W · สถานะ: V"** (ซ่อน segment ที่เป็น default)
- **feat(hr_overview) [empty state]:** ข้อความเปลี่ยนเป็น **"ไม่พบพนักงานตามตัวกรองนี้"** เพื่อสะท้อน multi-filter
- **feat(hr_overview) [export]:** filename ใช้ `buildHrExportFilename` สร้าง suffix เช่น `hr_overview_2026-05-26_dept-12_role-technician_working.xlsx` — **sanitize ตัวอักษรอันตราย** (`\/:*?"<>|` + control chars + whitespace + double underscore)
- **KPI ด้านบน:** ยังแสดงตัวเลขทั้งองค์กรเหมือนเดิม (Option A — ไม่ทำให้สับสน) — filter แสดงผลที่ตารางเท่านั้น
- **Modal employee drill-down:** ทำงานเหมือนเดิม (คลิกแถวที่ filter แล้วก็ยังเปิด modal ได้ปกติ)
- **Pure helpers ใหม่ (test-friendly):** `filterHrRows`, `countDepartmentBuckets`, `countRoleBuckets`, `isDefaultHrFilters`, `filterSummaryLabel`, `buildHrExportFilename`
- **ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior** — pure UI filter + helpers · ไม่ refetch DB · ไม่เพิ่ม dependency
- Tests +26 (filterHrRows 7 · countDept 3 · countRole 3 · isDefault 3 · summary 4 · filename 6). Unit **478 → 504**
- verify เขียว: lint:errors 0/0 · e2e 11/11 · `npm audit --audit-level=moderate` = **0 vulnerabilities**

**Build:** 291 → 292; version 5.55.0 → 5.55.1 (patch — UX filter)

---

## 5.55.0 (build 291) — 2026-05-26 👤 Phase 92.30 — HR Employee Drill-down Modal

- **feat(hr_overview) [drill-down]:** คลิกแถวพนักงานใน "สถานะพนักงานวันนี้" → เปิด **modal รายละเอียดพนักงาน** (max-width 860px, mobile responsive, Esc + backdrop คลิกเพื่อปิด, body scroll lock, `role="dialog"` + `aria-modal`)
- **Modal header:** ชื่อ · role chip · แผนก · email · status chip + mini-KPI (เข้า/ออก/ปกติ/OT) วันนี้
- **3 tabs:**
  - **📍 วันนี้** — clock in/out + ปกติ/OT/รวม cards + GPS distance พร้อมป้าย "ในพื้นที่/นอกพื้นที่" (ถ้ามี geofence) + notes; ถ้าสถานะ `not_in` → empty state + ปุ่ม "▶️ ลงเวลาให้พนักงาน" ไป Time Clock
  - **📅 7 วันล่าสุด** — **lazy fetch** ตอนเข้า tab (cache per `userId`) → tableจัดกลุ่ม 7 entries (วันนี้ + 6 ก่อนหน้า) เรียงใหม่→เก่า · open session ไฮไลต์ส้ม · header summary รวม ปกติ/OT/รวม 7 วัน · graceful error ถ้า fetch fail
  - **💰 เงินเดือน** — base/ot/welfare/bonus/commission/deductions/total + paid/unpaid chip + วันที่จ่าย + payment method + note + ปุ่มไปหน้า Payroll; ถ้ายังไม่มี payroll → empty state + ปุ่ม "+ เพิ่มรายการเงินเดือน"
- **Footer:** ปุ่ม "🕒 ไป Time Clock" + ปุ่ม "ปิด"
- **Row click delegation:** skip ถ้าผู้ใช้คลิก `[data-hr-action]` / `<button>` (ปุ่มในแถวยังทำงานเหมือนเดิม) · ไม่มี inline `onclick`
- **Pure helpers ใหม่ (test-friendly):** `formatDistanceLabel` (radius-aware), `groupAttendanceLast7Days` (เรียงใหม่→เก่า, fill-7), `employeePayrollSummary` (match `employee_id === profile.id`, รวม base+ot+wel+bon+com-ded ถ้า total หาย), `buildEmployeeModalSummary` (presentation-ready), `modalTabFor` (validate tab key)
- **ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior** — read-only drill-down เท่านั้น (1 fetch endpoint ใหม่: `staff_attendance` filter by user_id 7 วัน)
- Tests +19 (formatDistanceLabel 4 + groupAttendanceLast7Days 4 + employeePayrollSummary 5 + buildEmployeeModalSummary 3 + modalTabFor 3). Unit **459 → 478**
- verify เขียว: lint:errors 0/0, e2e 11/11

**Build:** 290 → 291; version 5.54.1 → 5.55.0 (minor — feature UX ใหม่)

---

## 5.54.1 (build 290) — 2026-05-26 ✨ Phase 92.29 — HR Overview polish + filters + actionable alerts

- **feat(hr_overview) [filter]:** เพิ่ม **filter bar** เหนือตารางสถานะวันนี้ — 5 ปุ่ม segmented (ทั้งหมด / ยังไม่เข้า / กำลังทำงาน / ออกแล้ว / ต้องตรวจสอบ) แสดง count ในปุ่ม · filter in-memory ไม่ refetch DB · default = ทั้งหมด · empty state เมื่อ filter แล้วไม่มีข้อมูล
- **feat(hr_overview) [polish]:**
  - Role เป็น **chip สี** ในตาราง: admin = ม่วง, sales = ฟ้า, technician = เขียว, อื่น ๆ = เทา
  - Status wording: `abnormal` "ผิดปกติ" → **"ต้องตรวจสอบ"** (ทั้งใน chip / filter button / Export)
- **feat(hr_overview) [actionable]:** ทุก alert ใน "สิ่งที่ต้องจัดการวันนี้" มีปุ่มไป route ที่เกี่ยว — `stale_session`/`geofence_out`/`offline_pending` → Time Clock, `unpaid_payroll` → Payroll (ใช้ event delegation, ไม่มี inline onclick)
- **feat(hr_overview) [row action]:** ปุ่มในแต่ละแถว label dynamic ตาม status — `not_in` = "▶️ ลงเวลา", `working`/`abnormal` = "⏱️ จัดการเวลา", `out` = "👁️ ดูเวลา" (ทุกปุ่มไป `time_clock` route เหมือนเดิม) + สีปุ่มสะท้อน severity
- **feat(hr_overview) [shortcut]:** KPI card **Payroll** คลิกได้เมื่อมีค้าง (`payrollUnpaid > 0`) → Payroll · KPI **Offline Queue** คลิกได้เมื่อ pending > 0 → Time Clock · keyboard accessible (Enter/Space)
- **feat(hr_overview) [quick actions]:** เรียงใหม่ + label สั้น — ลงเวลา / เงินเดือน / ภาพรวมเงินเดือน / แผนก / ประวัติ / Export
- **Export Excel:** export ตาม `activeFilter` ปัจจุบัน — filename suffix `_status` (เช่น `hr_overview_2026-05-26_working.xlsx`) เพื่อให้ชัดเจน
- **Pure helpers ใหม่ (test-friendly):** `countStatusBuckets`, `filterRowsByStatus`, `rowActionLabel`, `roleChipMeta`, `alertActionFor`
- **ไม่แตะ DB / RLS / money math / payroll / time_clock behavior** — pure UI polish + additive helpers
- Tests +21 (countStatusBuckets 4 + filterRowsByStatus 4 + rowActionLabel 4 + roleChipMeta 4 + alertActionFor 5). Unit **438 → 459**
- verify เขียว: lint:errors 0/0, e2e 11/11

**Build:** 289 → 290; version 5.54.0 → 5.54.1 (patch — UX polish)

---

## 5.54.0 (build 289) — 2026-05-26 📊 Phase 92.28 — ภาพรวม HR / HR Center

- **feat(hr) [dashboard]:** หน้าใหม่ **📊 ภาพรวม HR** ใน sidebar กลุ่ม "บุคลากร / HR" (ก่อน "ตั้งค่าแผนก") — read-only dashboard สำหรับ admin เพื่อเห็นสถานะ HR ทั้งระบบในหน้าเดียว
- **modules/hr_overview.js** ใหม่:
  - **KPI cards:** พนักงานทั้งหมด · เข้างานวันนี้ (X/Total %) · ยังไม่ลงเวลาออก · OT เดือนนี้ · Payroll เดือนนี้ (จ่าย/ค้าง พร้อมยอดเงิน) · Offline Queue (เฉพาะเมื่อ > 0)
  - **🛎️ สิ่งที่ต้องจัดการวันนี้:** alert chips แยก severity — `stale_session` (ลืม clock-out > 14 ชม., high), `geofence_out` (เข้า/ออกนอกพื้นที่, medium), `unpaid_payroll` (medium), `offline_pending` (low)
  - **ตารางสถานะพนักงานวันนี้:** เรียงตามสถานะ (working → abnormal → out → not_in) — คอลัมน์ พนักงาน · แผนก/role · เข้า · ออก · ชม.ทำงาน · OT · status chip · action ไป Time Clock
  - **Quick actions:** ไป Time Clock / Payroll / Departments / Payroll Overview / Audit Log + **Export Excel** สรุปวันนี้
- **Pure helpers (test-friendly):** `classifyAttendanceStatus`, `aggregateHrKpi`, `detectExceptions`, `indexAttendanceByUser`
- **Reuse helpers จาก time_clock.js** ทั้งหมด: `workDateBangkok`, `timeBangkok`, `computeRegularOT`, `sumRegularOT`, `shiftHoursFromState`, `profileDisplayName`, `offlinePendingCount` — ไม่ duplicate logic
- **Route + admin gate:** `main.js` เพิ่ม `hr_overview` ใน `ALL_ROUTES` (admin only via `ROLE_PAGES.admin`), `LAZY_ROUTES`, page title — sales/technician/customer ไม่เห็นเมนู (sidebar auto-hide ตาม allowedPages)
- **ไม่แตะ DB schema / RLS / money math / payroll / time_clock behavior** — เป็น dashboard อ่านอย่างเดียว: GET `profiles_with_email` (fallback `profiles`), `departments`, `staff_attendance` (today + month), `staff_payroll` (current month)
- **Safety:** `requireAdmin()` guard ฝั่ง client (UX) + RLS เป็นด่านความปลอดภัยจริง · `escHtml` ทุก output · error state เมื่อ fetch fail (ไม่ crash)
- Tests +22 (classifyAttendanceStatus: 6, aggregateHrKpi: 5, detectExceptions: 7, indexAttendanceByUser: 4). Unit **416 → 438**
- verify เขียว: lint:errors 0/0, e2e 11/11 (build sync passes)

**Build:** 288 → 289; version 5.53.1 → 5.54.0 (minor — feature dashboard ใหม่)

---

## 5.53.1 (build 288) — 2026-05-24 🐛 Phase 92.27b HOTFIX — Time Clock dropdown ว่าง

- **fix(time_clock) [Blocking]:** dropdown ใน Manager view แสดง "— ยังไม่มีผู้ใช้ในระบบ —" + ตารางรายงานแสดง user เป็น "—" ทั้งที่ระบบมี 4 user accounts
- **Root cause:** `state.allProfiles` ถูก load โดย `loadUsers()` ใน main.js ที่ guard ด้วย `requireAdmin()` + trigger เฉพาะตอนเปิด **Settings → ตั้งค่าผู้ใช้งาน**. ถ้า admin เข้า Time Clock ตรง ๆ (โดยไม่เคยเปิด Settings users) → `state.allProfiles` ว่าง → `_staffProfiles(state)` คืน `[]` → dropdown + profMap ว่าง
- **แก้:** เพิ่ม `_ensureProfilesLoaded(state)` helper — ถ้า `state.allProfiles` ว่าง → fetch จาก `profiles_with_email` VIEW (fallback `profiles` table). เรียกตอนเริ่ม `_renderManagerView` + `_renderSelfView` (best-effort, silent fail). RLS จะ filter เองถ้า role ไม่มีสิทธิ์อ่าน
- **ไม่แตะ DB / behavior อื่น** — แค่ load data เพิ่มถ้าจำเป็น
- verify เขียว exit 0 (lint 0/0, unit 416 ไม่เปลี่ยน)

**Build:** 287 → 288; version 5.53.0 → 5.53.1 (patch — blocking UI bug)

---

## 5.53.0 (build 287) — 2026-05-24 📥 Phase 92.27 — Offline queue (IndexedDB) — เฟสสุดท้ายของ Time Clock series

- **feat(time_clock) [resilience]:** ถ้าเน็ตหลุดตอนกดลงเวลา → ระบบเก็บไว้ใน **IndexedDB queue** + แสดง toast `📥 ออฟไลน์ — เก็บคิวไว้ จะ sync เมื่อกลับมา online` (ไม่ block, ไม่ขาดข้อมูล)
- **Auto-sync:** ตอนเข้าหน้า Time Clock + online + มี pending → drain queue อัตโนมัติ (toast `📥 Sync auto: ✅ N record`)
- **Manual sync:** Manager view แสดงปุ่ม **📥 Sync ออฟไลน์ (N)** สีส้มเมื่อ pending > 0 — กดเพื่อ retry
- **Idempotency:** clock-in ทุกครั้งสร้าง `client_uuid` (crypto.randomUUID) → DB partial UNIQUE กัน duplicate insert ตอน sync รัน 2 รอบ (409 → success-drop)
- **modules/_offline_queue.js** ใหม่: IndexedDB wrapper (`boonsook-offline-queue` DB, `queue` store, auto-increment id) + 6 helpers (`openQueue, enqueue, listAll, remove, bumpAttempt, count, clear`) + 2 pure helpers (`isOfflineLike, generateClientUuid`)
- **modules/time_clock.js**:
  - `_insertClockIn` + `_patchClockOut` — wrap fetch ใน try/catch → ถ้า `isOfflineLike(err)` → `OfflineQueue.enqueue` + throw `code:"QUEUED"`
  - handlers จับ `QUEUED` → toast + re-render (ไม่ throw error generic)
  - export `syncOfflineQueue()` — drain ทุก item, 409 = drop (idempotency win), fail = bumpAttempt
  - export `offlinePendingCount()` — สำหรับ UI badge
- **ไม่แตะ DB** — schema reserve `client_uuid` มาตั้งแต่ Phase 92.22 ใช้ได้ทันที
- Tests +7 (isOfflineLike: TypeError/network/generic/null + generateClientUuid: v4 shape/uniqueness/100 unique). Unit 409 → **416**
- verify เขียว exit 0 (lint 0/0)

**Build:** 286 → 287; version 5.52.0 → 5.53.0 (minor — resilience feature ใหม่)

---

## 5.52.0 (build 286) — 2026-05-24 📍 Phase 92.24 — GPS geo-fence

- **feat(settings/store):** section ใหม่ "📍 ตำแหน่งร้าน (GPS)" — input **Lat/Lng/รัศมี** + ปุ่ม **📍 ใช้ตำแหน่งปัจจุบัน** (Geolocation API)
- **feat(time_clock) [GPS]:** ตอนพนักงานลงเวลาเข้า/ออก — ระบบขอ GPS จากเบราว์เซอร์ (ถ้าตั้ง geofence ใน Settings) → คำนวณระยะ Haversine จากร้าน → บันทึกใน `clock_in_lat/lng/distance_m` / `clock_out_lat/lng/distance_m`
- **Warn (ไม่ block):** ถ้าอยู่นอกรัศมี → toast `⚠️ คุณอยู่ห่างร้าน Xm (เกิน Ym) — บันทึกแล้วแต่ระบบจะ flag` (record ยังถูกบันทึก ไม่ขัดงาน — admin ตรวจทีหลังจาก distance_m)
- **เว้นว่าง = ปิด feature** — ไม่ตั้ง Lat/Lng ใน Settings → ระบบไม่ขอ GPS, ไม่บันทึก, ไม่ warn
- **Pure helpers ใหม่:** `haversineMeters(lat1,lng1,lat2,lng2)` + `geofenceFromState(state)` + `getCurrentPosition({timeoutMs:8000})` (silent fail if denied/unsupported)
- **ไม่แตะ DB** — schema reserve cols จาก Phase 92.22 (`clock_in/out_lat/lng/distance_m`) ใช้ได้ทันที
- Tests +9 (haversine: 0m, 1° lat at equator, 1° lng, cos rule at 60° lat, invalid args; geofenceFromState: default/custom/missing/partial/invalid radius). Unit 398 → **409**
- verify เขียว exit 0 (lint 0/0)

**Build:** 285 → 286; version 5.51.0 → 5.52.0 (minor — feature ใหม่ user-visible)

---

## 5.51.0 (build 285) — 2026-05-24 💰 Phase 92.26 — Payroll integration (OT auto-fill จาก Time Clock)

- **feat(payroll) [integration]:** modal เพิ่ม/แก้รายการเงินเดือน — เพิ่ม section **"🕒 ดึงจาก Time Clock"**
- กดปุ่ม **📥 ดึงสรุป** หลังเลือกพนักงาน + รอบเดือน → fetch attendance รวม regular/OT ชม. ในเดือนนั้น (Asia/Bangkok, ใช้ shift hours จาก storeInfo)
- แสดงสรุป: `✅ X record • ปกติ 0.00 ชม. • OT 0.00 ชม.` (+ hint ถ้ามี open session ยังไม่ออก)
- คำนวณ: **ค่า OT/ชม. × ตัวคูณ (default 1.5) = บาท** → ปุ่ม "→ เติม" ลงช่อง "ค่าล่วงเวลา" ตรงๆ (auto-trigger recalc total)
- เดา rate จาก `daily_rate÷8` ถ้าพนักงานมี — admin override ได้
- **feat(time_clock) [helper]:** export `fetchUserAttendanceSummary(userId, fromDate, toDate, shiftOpts)` → `{regular, ot, total, records, openCount}` — reuse `_fetchAttendance` + `sumRegularOT`, graceful `NO_TABLE` error
- **ไม่แตะ DB** — payroll table มี field `overtime` (บาท) อยู่แล้ว, ใช้ field เดิม
- ไม่กระทบ flow บันทึก/calc รวมสุทธิ — แค่ช่วยกรอกตัวเลข
- verify เขียว exit 0 (lint 0/0, unit 398)

**Build:** 284 → 285; version 5.50.1 → 5.51.0 (minor — feature ใหม่)

---

## 5.50.1 (build 284) — 2026-05-24 ⚙️ Phase 92.25b — Settings page ชั่วโมงทำงานกะ

- **feat(settings/store) [UI]:** เพิ่ม section "🕒 ชั่วโมงทำงาน" ในหน้า ตั้งค่า → ข้อมูลร้านค้า — admin ตั้ง startHour/endHour เอง (default 08-17)
- **feat(time_clock) [helper]:** ใหม่ `shiftHoursFromState(state)` อ่านจาก `state.storeInfo.shiftStartHour/EndHour` พร้อม fallback default 8/17 ถ้าไม่ตั้ง/ผิดรูป (NaN, นอก 0-23, start≥end). ส่งเป็น opts ให้ทุก `computeRegularOT` + `sumRegularOT` ใน manager/self-service/export
- **Header แสดงช่วงกะ:** Manager report "(กะ HH:00-HH:00 — เกินเป็น OT)" + self-service "สรุปสัปดาห์นี้ — กะ HH:00-HH:00" ตามที่ตั้งใน Settings
- **ไม่แตะ DB schema** — `storeInfo` persist ผ่าน `app_settings` JSON ที่มีอยู่แล้ว
- Tests +5 (shiftHoursFromState: default fallback / invalid values / inverted start≥end / string number / null state). Unit 393 → **398**
- verify เขียว exit 0 (lint 0/0)

**Build:** 283 → 284; version 5.50.0 → 5.50.1 (patch — additive config)

---

## 5.50.0 (build 283) — 2026-05-24 ⏰ Phase 92.25 — OT auto-detect + Admin edit (กะ 08:00-17:00)

- **feat(time_clock) [OT]:** กำหนดกะมาตรฐาน **08:00-17:00** (hardcode รอบนี้) — เวลานอกกะ = OT auto-detect ทันที
  - เข้า 08:00 ออก 19:00 → ปกติ 9.0 + **OT 2.0** ชม.
  - เข้า 07:00 ออก 17:00 → ปกติ 9.0 + **OT 1.0** (ก่อนเข้างาน)
  - เข้า 09:00 ออก 16:00 → ปกติ 7.0 + OT 0
- **feat(time_clock) [Admin edit]:** ปุ่ม **✏️** ต่อแถวในรายงาน → modal แก้ไข
  - input datetime-local สำหรับ `clock_in_at` + `clock_out_at` (Bangkok TZ)
  - textarea หมายเหตุ
  - Validation: เวลาออกต้องหลังเวลาเข้า
  - PATCH staff_attendance + **best-effort `logActivity("edit_attendance", ...)`** → audit trail ใน activity_log table (action, entity, summary, metadata.old/new)
- **Manager report:** เพิ่ม 3 columns — **ปกติ / OT (highlight สีส้ม) / รวม** + sub-total ที่ header section
- **Self-service week summary:** แสดงแยก 3 ค่า — ปกติ + OT + รวม + ตารางประวัติเพิ่ม column OT
- **Export Excel:** เพิ่ม 3 columns (ปกติ, OT, รวม)
- **Pure helpers ใหม่:** `computeRegularOT(row, {startHour:8, endHour:17})` + `sumRegularOT(rows)` + `isoToBangkokInput` + `bangkokInputToIso` (Bangkok TZ conversion สำหรับ datetime-local input)
- **ไม่หัก break** เที่ยง — ระบบเก็บแค่ clock in/out (payroll จัดการเอง). Settings page (เปลี่ยนชั่วโมงกะ) deferred — hardcode ก่อน
- **ไม่ต้องรัน SQL migration** — schema เดิมจาก Phase 92.22e พอ
- tests เพิ่ม +15 (computeRegularOT 12 cases รวม edge: ก่อนเข้า, หลังออก, ครอบ, สั้น, custom shift, นาที, null, corrupted + sumRegularOT 2 + open session). Unit 378 → **393**
- verify เขียว exit 0 (lint 0/0)

**Build:** 282 → 283; version 5.49.0 → 5.50.0 (minor — user-visible feature: OT calc + admin edit)

---

## 5.49.0 (build 282) — 2026-05-24 🔄 Phase 92.22e — Pivot Time Clock from staff → profiles

> ⚠️ **DB migration required:** ผู้ดูแลระบบต้องรัน [`supabase-phase92-22e-use-profiles.sql`](supabase-phase92-22e-use-profiles.sql) ใน Supabase SQL Editor ก่อนใช้งานหน้านี้ — ★ **migration นี้ DELETE test data ของ Phase 92.22 (2 records ของ "เจ้าของร้าน")** เป็น breaking change schema

- **refactor(time_clock) [Pivot]:** User ชี้ว่า Settings → ตั้งค่าผู้ใช้งาน มี **4 user accounts** (gangboo / boonsuk admin1 / sompong / passamon) แต่ Time Clock dropdown ของ Phase 92.22 ดึงจาก `staff` table ที่มีแค่ 1 row → ใช้ไม่ได้กับทุกคน. User เลือก option "Profiles" → refactor ครบทั้ง stack
- **DB schema change** ([`supabase-phase92-22e-use-profiles.sql`](supabase-phase92-22e-use-profiles.sql)):
  - `staff_attendance.staff_id (uuid → staff.id)` → **`user_id (uuid → auth.users.id)`**
  - DELETE FROM staff_attendance (ล้าง test data Phase 92.22)
  - Indexes rename: `idx_attendance_user_date`, `idx_attendance_one_open_session_user`
  - RLS policies simpler: `user_id = auth.uid()` (ไม่ต้อง EXISTS subquery บน staff)
- **modules/time_clock.js fully rewritten:**
  - `_staffProfiles(state)` ใช้ `state.allProfiles` (already loaded) filter `role !== 'customer'`
  - body insert + URL filter: `user_id` (ไม่ใช่ staff_id)
  - Self-service: ใช้ `auth.uid()` ตรง ๆ — **ไม่ต้อง email auto-claim** เพราะ `profile.id = auth.uid()`
  - Manager dropdown แสดง full_name + role badge (ภาษาไทย)
  - ลบ `canAutoClaim`, `_findStaffByEmail`, `_claimStaff` (ไม่ใช้แล้ว)
  - เพิ่ม `profileDisplayName(p)` — fallback `full_name > email prefix > 'ผู้ใช้ใหม่'` (mirror users.js)
- **modules/staff.js revert:** ลบช่อง "อีเมล" ใน add/edit modal — ไม่จำเป็นแล้ว (`staff.email` + `staff.user_id` ที่ Phase 92.22 เพิ่มยังอยู่ใน DB แต่ Time Clock ไม่ใช้ → dead columns ปลอดภัย)
- **Tests:** ตัด `canAutoClaim` 7 ตัว / เพิ่ม `profileDisplayName` 5 ตัว. Unit 380 → **378**
- verify เขียว exit 0 (lint 0/0, unit 378)

**Build:** 281 → 282; version 5.48.4 → 5.49.0 (minor — schema pivot ทำให้ Time Clock ใช้งานได้ครบทุก user)

---

## 5.48.4 (build 281) — 2026-05-24 🐛 Phase 92.22d — Fix Export CSV TypeError in time_clock

- **fix(time_clock) [Blocking on Export]:** กด "📥 Export CSV" ในหน้าลงเวลาทำงาน → `TypeError: r.forEach is not a function` (xlsx.full.min.js:24). User clock-in/out flow ไม่กระทบ — bug เฉพาะ Export
- **Root cause:** `exportToExcel(filename, rows, sheetName)` (utils.js:60) — filename มาเป็น arg แรก. ผมเขียน `exportToExcel(data, filename)` กลับด้าน → `XLSX.utils.json_to_sheet(filename)` ได้ string มาแทน array → `filename.forEach()` undefined → throw
- **แก้:** สลับ args ตามที่ payroll/expenses/delivery_invoices/accounting modules ทุกตัวใช้: `exportToExcel(filename, rows, "Attendance")`. เปลี่ยน extension `.csv` → `.xlsx` ให้ตรงกับที่ `XLSX.writeFile` produce ออกมาจริง
- audit แล้วเป็น only call site ที่ผิด — ไม่กระทบ caller อื่นใน repo (ทุกตัวเดิมถูกอยู่แล้ว)
- verify เขียว exit 0 (lint 0/0, unit 380)

**Build:** 280 → 281; version 5.48.3 → 5.48.4 (patch — Export CSV fix)

---

## 5.48.3 (build 280) — 2026-05-24 🐛 Phase 92.22c — Fix admin sidebar missing "🕒 ลงเวลาทำงาน"

- **fix(main) [Blocking]:** ปุ่ม "🕒 ลงเวลาทำงาน" ไม่โผล่ใน sidebar ของ admin — เพราะ `ALL_ROUTES` (main.js:595) เป็น **static list** (ไม่ใช่ `Object.keys(LAZY_ROUTES)`) → admin allowedPages ไม่มี `time_clock` → sidebar JS ซ่อนปุ่มเงียบ ๆ
- **Root cause:** Phase 92.22 ผมเพิ่ม `time_clock` ใน `LAZY_ROUTES` + `ROLE_PAGES.sales/technician` (ที่ระบุ list explicit) แต่ลืม `ALL_ROUTES` ที่ admin ใช้ — admin จะเข้าหน้าได้ผ่าน URL `#time_clock` ตรง ๆ ก็ได้ แต่ sidebar ไม่แสดงปุ่ม
- **แก้:** เพิ่ม `"time_clock"` ใน `ALL_ROUTES` array (1 บรรทัด) — admin เห็นปุ่ม sidebar
- **ไม่กระทบ** sales/technician — มี route ใน ROLE_PAGES อยู่แล้วตั้งแต่ 92.22
- verify เขียว exit 0 (lint 0/0, unit 380)

**Build:** 279 → 280; version 5.48.2 → 5.48.3 (patch — sidebar visibility)

---

## 5.48.2 (build 279) — 2026-05-24 🏷️ Phase 92.22b — Fix About page version display drift

- **fix(settings/pages) [user-visible]:** หน้า "เกี่ยวกับระบบ" (About) แสดง **Version: 5.47.8** + **build 274** มาตั้งแต่ Phase 92.18 — drift 5 phases (92.19/92.20/92.21/92.22/92.22-hotfix). ปุ่ม "ตรวจหาอัปเดต" บอก build 278 ถูก แต่ header ของ About เก่า → user งง
- **Root cause:** [modules/settings/pages.js:25-26](modules/settings/pages.js:25) hardcode `<div>Version: 5.47.8</div>` + `<div>Release: May 2026 (build 274)</div>` — เคยอยู่ใน 4-sub-item version-sync checklist แต่ผมลืมตอน 92.19+ ทำไม่ครบ 5 จุด
- **แก้ถาวร (dynamic):**
  - `selfheal.js`: เพิ่ม `window.APP_VERSION` (จาก `data-app-version` attribute) คู่กับที่มี `window.APP_BUILD` อยู่แล้ว
  - `index.html`: `<script src="./selfheal.js" data-app-build="279" data-app-version="5.48.2">` — bump 2 attr แทน 1
  - `pages.js`: render `${window.APP_VERSION}` + `${window.APP_BUILD}` (escHtml ปลอดภัย, fallback `-`)
- **ผลลัพธ์:** version-sync 4-sub-items เดิมยังครอบ pages.js โดยอัตโนมัติ — ไม่ต้อง bump 5 จุด, ไม่มี risk ลืม About page อีก
- **ไม่แตะ** money / DB / RLS / posting — เป็น UI text + boot-time globals
- verify เขียว exit 0 (lint 0/0, unit 380 ไม่เปลี่ยน)

**Build:** 278 → 279; version 5.48.1 → 5.48.2 (patch — UI display fix)

---

## 5.48.1 (build 278) — 2026-05-24 🐛 Phase 92.22 HOTFIX — uuid type mismatch (staff.id)

- **fix(sql) [Blocking]:** `supabase-phase92-22-time-clock.sql` ใช้ `staff_id bigint` ผูก `staff.id` — แต่ staff ใน prod เป็น **uuid** (สร้างผ่าน Supabase Dashboard ไม่ใช่ migration script ใน repo) → Postgres reject ตอน CREATE TABLE ด้วย error `42804: foreign key constraint cannot be implemented: incompatible types bigint and uuid` → migration ล้มเหลว, table ไม่ถูกสร้าง
- **แก้:** เปลี่ยน `staff_attendance.staff_id` จาก `bigint` → **`uuid`** (FK พอดี + RLS subquery ที่ใช้ `s.id = staff_attendance.staff_id` ก็ match) — re-run SQL ปลอดภัย (IF NOT EXISTS / IF EXISTS ทั้งหมด)
- **fix(time_clock.js) [Blocking]:** `Number(document.getElementById("tcStaffSelect")?.value)` ทำให้ uuid string → `NaN` → manager กดบันทึกเข้างานไม่สำเร็จ. แก้เป็น `value?.trim() || ""` (string passthrough). `attendance.id` ยังเป็น bigserial → Number() cast บน `data-clock-out-id` คงเดิม
- **ที่ไม่เปลี่ยน:** `_findMyStaff` query by `auth.uid()` (uuid match uuid อยู่แล้ว), `_fetchAttendance` URL `staff_id=eq.${...}` (encodeURIComponent รับ uuid string), `staffMap[s.staff_id]` (string key OK)
- **Root cause:** ผม assume type จาก `modules/staff.js` (ใช้ sb client = type-agnostic) แทนที่จะ verify ใน Supabase Dashboard ก่อน — บันทึกเป็นบทเรียน [feedback_id_type_mismatch](feedback_id_type_mismatch)
- ไม่มี behavior change กับ users ที่ยังรัน SQL ไม่ผ่าน (เพิ่งเริ่ม); สำหรับ users ที่ apply ส่วนแรกแล้ว (ALTER staff add user_id+email สำเร็จ) — re-run SQL ตัวใหม่ → ALTER เป็น no-op + CREATE TABLE สำเร็จ
- verify เขียว exit 0 (lint 0/0, unit 380 ไม่เปลี่ยน — เป็น SQL fix + 1 line JS)

**Build:** 277 → 278; version 5.48.0 → 5.48.1 (patch — hotfix SQL + JS cast)

---

## 5.48.0 (build 277) — 2026-05-24 🕒 Phase 92.22+92.23 — Time Clock (Foundation + Self-service)

> ⚠️ **DB migration required:** ผู้ดูแลระบบต้องรัน [`supabase-phase92-22-time-clock.sql`](supabase-phase92-22-time-clock.sql) ใน Supabase SQL Editor ก่อนใช้งานหน้านี้ (รายละเอียดใน HANDOFF section 92.22)

- **feat(time_clock) [HR]:** เมนูใหม่ **🕒 ลงเวลาทำงาน** ใต้กลุ่ม "บุคลากร / HR"
- **Manager view (admin):** dropdown เลือกพนักงาน + ปุ่ม "บันทึกเข้างาน" + การ์ด "กำลังทำงานอยู่" พร้อมปุ่มลงเวลาออก + รายงานช่วงวันที่ + filter พนักงาน + Export CSV
- **Self-service view (sales/technician ที่ผูก auth):** ปุ่มเข้า/ออกของตัวเอง + สรุปชั่วโมงสัปดาห์นี้ + ประวัติ 7 วันล่าสุด
- **Auto-claim (Phase 92.23):** admin set `staff.email` ตรงกับบัญชี Supabase Auth → user login ครั้งแรก → ระบบ PATCH `staff.user_id = auth.uid()` อัตโนมัติ → next visit เห็น self-service view
- **DB:** ใหม่ `staff_attendance` (work_date, clock_in_at, clock_out_at, GPS cols reserve สำหรับ 92.24, client_uuid สำหรับ 92.27 idempotency, source admin/self/queued) + `staff.user_id` + `staff.email` + RLS (admin all / staff self ผ่าน user_id) + partial unique index กัน "open session ซ้อน" 1 staff
- **Constraints:** 1 staff = มี open session ได้ครั้งละ 1 (DB enforced); email format check ฝั่ง client + UNIQUE บน lower(email)
- **Graceful fallback:** ถ้า table ยังไม่มี (admin ยังไม่รัน SQL) → หน้าโชว์ error card ชัดเจน "ต้องรัน migration ก่อน" + ปุ่ม retry
- **ขอบเขต Phase นี้:** ไม่แตะ posting / payroll math / GPS / offline — schema reserve cols ไว้ให้ Phase 92.24-27 ใช้ต่อ
- **ไฟล์:** new `modules/time_clock.js` (~480 lines), `supabase-phase92-22-time-clock.sql`, `tests/time_clock.test.js` (+24); edit `main.js` (LAZY_ROUTES + ROLE_PAGES.sales/technician เพิ่ม time_clock), `index.html` (sidebar + page section), `modules/staff.js` (email field ใน add/edit modal)
- verify เขียว exit 0 (lint 0/0, unit **380** (356→+24))

**Build:** 276 → 277; version 5.47.10 → 5.48.0 (minor — feature ใหม่ ไม่ทำ breaking change)

---

## 5.47.10 (build 276) — 2026-05-24 🛡️ Phase 92.21 — Guard race on async badge handlers

- **fix(sales,audit_log) [scanner]:** ใส่ `if (!btn.isConnected) return;` หลัง `await findJournalForSale` ทั้ง 2 handler — ถ้า list re-render ระหว่าง await แล้ว btn จะอยู่ orphan, handler bail ทันทีก่อน mutate/replaceWith
- ปิด GH-scanner annotation "Possible race condition: `btn.disabled`/`btn.textContent` might be assigned based on an outdated state of `btn`" ที่เคยเตือนใน [modules/sales.js](modules/sales.js) + [modules/audit_log.js](modules/audit_log.js)
- **ไม่มี behavior change** สำหรับ flow ปกติ (non-racy) — guard ทำงานเฉพาะกรณี list re-render ระหว่าง async lookup (ก่อนหน้านี้ mutate/replaceWith orphan = no-op หรือ throw silently)
- pattern เดียวกับ "เปิดบิล" handler ที่ [modules/sales.js:147](modules/sales.js:147) มีอยู่แล้ว
- **ไม่แตะ** posting / auto_post / money / stock / loyalty / RLS / SQL — pure DOM-safety guard
- verify เขียว exit 0 (lint 0/0, unit 356 ไม่เปลี่ยน — เป็น defensive guard, test ไม่ใช่ behavior)

**Build:** 275 → 276; version 5.47.9 → 5.47.10 (patch — scanner cleanup, defensive)

---

## 5.47.9 (build 275) — 2026-05-24 🔗 Phase 92.20 — JV drawer deep-link (3 surfaces)

- **feat(accounting) [deep-link]:** ปุ่ม **📒 บัญชี** ทั้ง 3 surface (รายการขาย / ใบเสร็จ / Audit Log) — กดแล้ว**เปิด JV drawer ของบิลใบนั้นทันที** (เดิมไปหน้าสมุดรายวันเปล่า ต้องเลื่อนหา/คลิกเอง)
- **feat(sale_trace) [helper]:** `navigateToJv(jvId, opts)` ใหม่ — dynamic import `journals.js` → `setPendingJvId(jvId)` → `showRoute("accounting_journals")` → renderJournalsPage หลังโหลด entries เสร็จ → consume pending → `_openJvDrawer` อัตโนมัติ (1-shot, clear ทั้งตอน consume + ตอน fetch error)
- **feat(journals) [API]:** export `setPendingJvId(id)` ใหม่ + consume logic ที่ปลาย `renderJournalsPage`; queueMicrotask กัน DOM bind ยังไม่เสร็จ; ถ้า JV id ไม่อยู่ใน 200 ล่าสุด → log info แล้วผ่าน (drawer ไม่เปิด) ไม่ crash
- **safe fallback:** ถ้า dynamic import `journals.js` ล้ม (offline/CSP) → navigate ปกติแทน deep-link (ผู้ใช้เห็นหน้ารายวัน, เลื่อนหา JV เองได้) — ไม่ block
- **ไม่แตะ** posting / auto_post / money / stock / loyalty / RLS / SQL — เพิ่มเฉพาะ navigation glue + 1 read-only consume hook
- test เพิ่ม 6 ตัวใน `sale_trace.test.js` (happy/string-id/null/no-router/import-fail/no-method) — unit 350 → 356
- verify เขียว exit 0 (lint 0/0, unit 356)

**Build:** 274 → 275; version 5.47.8 → 5.47.9 (minor feature — UX deep-link, additive)

---

## 5.47.8 (build 274) — 2026-05-22 📒 Phase 92.18 — Audit Log accounting trace (deleted POS sales) ✅ MERGED (#45) + DEPLOYED + SMOKE PASSED

- **feat(sales) [audit]:** soft-delete บิลขายตอนนี้บันทึก `logActivity("delete_sale", {entityType:"sale", entityId:saleId, ...})` แบบ **best-effort** (มี bill_no/customer/total ใน summary+metadata) — ถ้า log fail การลบบิล**ไม่ fail** (ห่อ try + logActivity กลืน error อยู่แล้ว). เดิม POS sale deletion ไม่ทิ้งร่องรอยใน Audit Log เลย
- **feat(audit_log) [trace]:** row การลบบิลขาย (entity_type='sale') มีปุ่ม **📒 ดูบัญชี** → on-demand `findJournalForSale` ด้วย key `source_table='sales' + source_id=entity_id` → เจอ = แสดง `SV...` กดไปสมุดรายวันได้; ไม่เจอ = **"ยังไม่ลงบัญชี"**; error = "ตรวจบัญชีไม่ได้" (ไม่เงียบ/ไม่ crash)
- **safe id extraction:** `saleIdFromAuditLog()` ใช้เฉพาะ `entity_type==='sale' + entity_id` — **ห้ามเดา** จาก summary/doc_no/customer/amount (มี test ยืนยัน receipt-row/summary-only → null)
- **ไม่แตะ** posting / auto_post / stock / loyalty / money math / RLS / SQL — reuse helper 92.17 (read-only lookup)
- test เพิ่มใน `sale_trace.test.js` (saleIdFromAuditLog + trace flow found/missing/error/no-crash) — unit 342 → 350
- verify เขียว exit 0 (lint 0/0, unit 350, e2e 11)

**Build:** 273 → 274; version 5.47.7 → 5.47.8 (minor feature — audit-log trace, additive)

---

## 5.47.7 (build 273) — 2026-05-22 🔗 Phase 92.17 — Accounting trace links (POS sale → JV) ✅ MERGED (#42) + DEPLOYED + SMOKE PASSED

- **feat(accounting) [trace]:** บิล POS เห็นได้แล้วว่า "ลงบัญชีหรือยัง" — helper ใหม่ `modules/accounting/sale_trace.js` (`findJournalForSale`, `renderSaleTraceBadge`) ค้น JV ด้วย key หลัก `source_table='sales' + source_id=sale.id` (read-only, ไม่สร้าง/ไม่แก้ journal)
- **feat(sales) [list]:** หน้า "รายการขาย" เพิ่มปุ่ม **📒 บัญชี** ต่อแถว — กดแล้ว lookup on-demand → เจอ = แสดงเลข `SV...` กดไปสมุดรายวันได้; ไม่เจอ = **"ยังไม่ลงบัญชี"**; error = "ตรวจบัญชีไม่ได้" (ไม่เงียบ)
- **feat(receipt) [drawer]:** ใบเสร็จที่เปิดอยู่เพิ่ม section **เอกสารบัญชี** — แสดงสถานะ/เลข SV + คลิกไปสมุดรายวัน (ปิด drawer + นำทาง)
- **ไม่แตะ** posting / auto_post / money / RLS / SQL — เพิ่มเฉพาะ read-only lookup + UI; doc_no/description ใช้เป็น label เท่านั้น (ไม่ใช่ key)
- test ใหม่ `sale_trace.test.js` (found/missing/error/invalid + badge click-target + XSS escape) — unit 332 → 342
- verify เขียว exit 0 (lint 0/0, unit 342, e2e 11)
- **defer → Phase 92.18:** trace link ในหน้า Audit Log (delete_sale)

**Build:** 272 → 273; version 5.47.6 → 5.47.7 (minor feature — accounting trace, additive)

---

## 5.47.6 (build 272) — 2026-05-22 🔍 Phase 92.16 — Console noise audit

- **chore(logging):** audit console output จาก smoke flows หลัก แล้วแยกเป็น SAFE_NOISE / ACTIONABLE_LOW / BUG (ตารางเต็มใน HANDOFF) — **ไม่เจอ bug จริง**
- **chore(logging):** demote 3 expected diagnostics จาก `console.log` → `console.info` (เป็น no-op ที่คาดไว้ ไม่ใช่ความผิดพลาด): `sales.js` loyalty reverse attempt + skipped, `refunds.js` loyalty reverse skipped
- ยืนยันของเดิมถูกต้องอยู่แล้ว: `[auto_post] created/voided` = `console.info` แล้ว; `loadAllData timeout after committed delete` = `console.warn` ที่ระบุชัดว่า delete commit สำเร็จแล้ว (Phase 92.15)
- `Could not find window.__TAURI_METADATA__` = warning จาก external lib (ไม่ใช่โค้ดเรา) — browser-only, harmless, document only
- **ไม่มี** การเปลี่ยน money/stock/JV/loyalty behavior — แก้เฉพาะ log level
- verify เขียว exit 0 (lint 0/0, unit 332, e2e 11)

**Build:** 271 → 272; version 5.47.5 → 5.47.6 (patch — logging clarity only)

---

## 5.47.5 (build 271) — 2026-05-22 🗑️ Phase 92.15 — Sale delete refresh resilience

- **fix(sales) [UX]:** ลบบิลสำเร็จ (soft-delete PATCH `note = [ลบแล้ว]`) แล้ว mirror note ลง `state.sales` ในเครื่อง + re-render list ทันที — แถวที่ลบหายเลย ไม่ต้องรอ `loadAllData()`
- **fix(sales) [resilience]:** `loadAllData()` หลัง committed delete เป็น **best-effort (warning-only)** — ถ้า timeout/เน็ตช้า แถวที่ลบไม่ "เด้งกลับ" มาอีก (เดิม: toast ขึ้น "ลบเรียบร้อย ✅" แต่แถวค้างจอ)
- **ไม่มี** การเปลี่ยน money/stock/JV/loyalty side-effect — แก้เฉพาะ local state + re-render ของ list view
- verify เขียว exit 0 (lint 0/0, unit 332, e2e 11)

**Build:** 270 → 271; version 5.47.4 → 5.47.5 (patch — sale delete refresh UX)

---

## 5.47.4 (build 270) — 2026-05-21 💰 Phase 92.14 — Money/accounting closure (round2 + verify-slip)

- **fix(money) [round2]:** ปิด float drift 2 จุดที่เหลือจาก money audit 4.1 — `pos.js` cart total (5 จุด inline reduce → `cartSum()` = round2) + `refunds.js` ยอดคืน (`refundTotal()` = round2 ก่อนลง DB `refund_amount` + JV). checkout write path round2 อยู่แล้ว
- **fix(verify-slip) [mismatch confirm]:** แยก `buildSlipVerification` (pure, unit-tested) + harden — ถ้ามี expected_amount แต่อ่านยอดในสลิปไม่ได้ (≤0) → `is_safe=false` (เดิมเงียบ → โชว์ "✅ ผ่าน" หลอก) + เตือนให้ยืนยันยอดเอง. ทั้ง 3 ฟอร์มบริการ (ac_install/service_form/solar) ใช้ `is_safe` ร่วมกัน → mismatch โชว์ "⚠️ ต้องตรวจเพิ่มเติม" เชื่อถือได้
- **audit(RLS):** journal_entries RLS — JS handle 403 graceful แล้ว (Phase 92.13); ยืนยัน "closed" ต้องรัน read-only verify query ใน prod (ดู HANDOFF) — ยังไม่รัน (รอ user)
- **ไม่มี** SQL migration / ไม่แตะ proven paths (loyalty/CAS/credit/receipt/SW)
- verify เขียว exit 0 (lint 0/0, unit 317 → 332, e2e 11)

**Build:** 269 → 270; version 5.47.3 → 5.47.4 (patch — money correctness hardening)

---

## 5.47.3 (build 269) — 2026-05-21 🐛 Phase 92.13 — Production smoke bugs (stock reverse type + JV RLS handling)

- **fix(stock) [Blocking]:** ลบบิล POS แล้ว reverse สต็อกเคย insert `stock_movements.type = "return_sale"` → ละเมิด check constraint `stock_movements_type_check` (code 23514) → คืนสต็อกล้มเหลวเงียบ. แก้เป็น `type: "return"` (ค่าที่ flow คืนสินค้า/หน้า movement ใช้อยู่แล้ว, semantic เดียวกัน) + guard test สแกน main.js กันทุก stock_movements insert ใช้ type นอก allowed set
- **fix(accounting) [handling]:** auto-post JV โดน RLS 403 (code 42501) ที่ `journal_entries` สำหรับ role ที่ไม่ใช่ accountant → เดิม log เป็น `console.error "entry insert failed"` ดูเหมือน crash. แยกเคส 403/42501 → log warn ชัดเจน "JV deferred (RLS) — sale saved OK" + ชี้ DB fix (`supabase-phase89-25-fix-je-rls-pos.sql`). **POS sale ไม่เคยถูก block** (fire-and-forget อยู่แล้ว); ไม่ fake success ฝั่ง client
- **ℹ️ DB action required (ไม่ใช่ JS):** RLS 403 แก้จริงต้องยืนยัน policy `je_insert_auto`/`jl_insert_auto` มีอยู่ใน prod (SESSION_LOG ระบุ applied แล้วแต่ live ยัง 403 = discrepancy) — รัน/verify `supabase-phase89-25-fix-je-rls-pos.sql`
- **doc:** credit payment page (`credit_tracker`) **ไม่ใช่ admin-only** — อยู่ใน `ROLE_PAGES.sales` + sidebar กลุ่ม "💰 การเงิน" → "💳 ลูกค้าค้างชำระ" (sub-item ที่ group ยุบอยู่)
- verify เขียว exit 0 (lint 0/0, unit 314 → 317, e2e 11)

**Build:** 268 → 269; version 5.47.2 → 5.47.3 (patch — production smoke bug fix)

---

## 5.47.2 (build 268) — 2026-05-21 💰 Phase 92.12 — Money audit fixes (credit CAS + cash recon refund)

- **fix(credit) [Blocking]:** รับชำระหนี้ (credit_tracker) เคยเขียน `credit_paid_amount` แบบ absolute จาก state ที่อาจ stale (read-modify-write) → 2 staff รับชำระบิลเดียวกันพร้อมกันเขียนทับกัน = payment หาย + ลูกหนี้ (A/R) เกินจริง. เปลี่ยนเป็น **CAS increment** (`atomicAddToField` ใหม่ใน stock_cas.js — refetch → PATCH `?credit_paid_amount=eq.{before}` → stale=retry; column NUMERIC ทำให้ eq match เป๊ะ). `credit_payments` ledger + JV posting ไม่แตะ
- **fix(cash_recon) [Should-fix]:** กระทบยอดเงินสดเดิม**ไม่หัก cash refund** → คืนเงินสดทำให้ลิ้นชัก "ขาด" หลอกทุกรอบ. เพิ่ม `refunds` param + `cashRefundOut` (เฉพาะ refund_method=cash, เฉพาะวันที่เลือก); expected = opening + cashIn − cashOut − cashRefundOut. math เดิม (cashIn/cashOut/transferIn) ไม่เปลี่ยน
- **fix(credit) [review hardening]:** กัน duplicate ledger เมื่อ partial failure — แยก `processCreditPayment` (testable): หลัง credit_payments insert = committed → ไม่เปิดปุ่มให้กดซ้ำ. CAS fail → reconcile cache จาก ledger SUM (JS-only); `credit_paid_at` = best-effort (ไม่ throw); cache/status sync degraded → non-retry warning + reload
- **JS-only** ไม่มี SQL migration (column เป็น NUMERIC → client CAS พอ); TDD ทุก fix (test red ก่อนแก้)
- verify เขียวครบ exit 0 (lint 0/0, unit 302 → 314, e2e 11)

**Build:** 267 → 268; version 5.47.1 → 5.47.2 (patch — money bug fix)

---

## 5.47.1 (build 267) — 2026-05-21 🐛 Phase 92.11 — Fix silent "เปิดบิล" + verify health + version sync

- **fix(receipt):** ปุ่ม "เปิดบิล" (หน้ารายการขาย) เคยกดแล้วเงียบ — `loadReceipt` ใช้ Supabase JS client ที่ค้างบนมือถือ/throw เมื่อ client ยังไม่พร้อม. เปลี่ยนเป็น `fetch` + AbortController timeout 8s (pattern เดียวกับ pos.js) และคืน `{ok,error}` → caller toast เมื่อ fail + เปิด drawer เฉพาะตอนโหลดสำเร็จ
- ใช้ fix เดียวกันกับจุดเปิดบิลใน customer drawer (silent twin)
- **lint:** เคลียร์ 2 warnings เหลือ 0 — pos.js `state.lastReceipt` (ขยาย eslint-disable ครอบ assignment ที่ guard ด้วย `_posCheckoutGuard` อยู่แล้ว) + loyalty.js `requireAdmin` (false positive: forward ผ่าน ctx ทั้งก้อนเข้า renderSettingsTab — guard test ล็อกชื่อไว้ → justified inline disable)
- **chore(version):** sync `package.json` 5.43.42 → 5.47.1 (drift จากของจริงที่ ship อยู่)
- ไม่มี behavior change กับ money/accounting/RLS; verify เขียวครบ (lint 0/0, unit 302, e2e 11)

**Build:** 266 → 267; version 5.47.0 → 5.47.1 (patch — bug fix)

---

## 5.47.0 (build 266) — 2026-05-21 ♻️ Phase 92.10 CAPSTONE — Extract boot orchestration → `modules/boot.js`

ปิด decomposition series 92.1-92.10 — ย้าย **boot IIFE** (self-invoking async ที่รันตอน main.js โหลด) ออกไป `modules/boot.js`. ผลลัพธ์: main.js เป็น **side-effect-free module** แล้ว (ไม่มี IIFE รันเองตอน import) → boot orchestration testable + module boundary สะอาด.

- ย้าย boot IIFE → `export async function runBoot({...7 deps})` ใน `modules/boot.js`; main.js เรียก `runBoot({...})` (fire-and-forget) ที่ท้ายไฟล์แทน
- **Dependency injection** — boot.js รับ deps (initDarkMode/bindStaticEvents/updateAppLogos/initSupabase/afterLogin/syncLogo/getCurrentUser) ผ่าน params → ไม่ import main.js (ตัด circular)
- Byte-identical: ลำดับ 6 steps + early-return (`!ok`, `!currentUser`) + background `.then()` logo repaint เป๊ะเดิม; แก้แค่ `state.currentUser`→`getCurrentUser()`, `window._appSyncLogo()`→`syncLogo()`
- ไม่แตะ `updateAppLogos` wrapper + `window.updateAppLogos`
- Tests: +9 (5 behavioral: happy-path order / bail-no-supabase / bail-no-user / pre-steps-always / logo-repaint + 4 source pins)
- **Series complete:** main.js 4690 → 4247 บรรทัด; modules แยก = branding · lazy_libs · share_doc · utils · api · boot

**Build:** 265 → 266; version 5.46.0 → 5.47.0 (minor — new module + capstone)

---

## 5.46.0 (build 265) — 2026-05-20 ♻️ Phase 92.9 — Extract XHR/API data layer → `modules/api.js`

ต่อยอด decomposition 92.1-92.8 — ย้าย **data-access layer** (auth-critical: token refresh + auth-fetch + XHR REST helpers) ที่ทุก data operation พึ่งพา. Refactor-only, byte-identical.

- ย้าย `refreshAccessToken` / `appAuthFetch` / `xhrPost` / `xhrPatch` / `xhrDelete` + single-flight guard `_refreshInflight` จาก main.js → `modules/api.js`
- **Factory `createApi({ windowRef })`** — closure เก็บ `_refreshInflight` + internal 401-retry recursion ให้ทำงานเหมือนเดิม (plain exports ทำไม่ได้เพราะมี shared mutable state + recursion + positional `_isRetry` param)
- main.js destructure 5 functions ผูก `window._app*` wrappers เดิม → 13 module callers + main.js local callers ไม่แตะ
- แก้แค่ global → `windowRef.*` (SUPABASE_CONFIG/_sbAccessToken/App/fetch/XMLHttpRequest); retry/refresh/headers/timeout/status/JSON-guards byte-identical
- main.js: 4454 → 4247 บรรทัด (−207); Tests: +18 (14 behavioral + 4 source-level pins)

**Build:** 264 → 265; version 5.45.1 → 5.46.0 (minor — new auth-critical module)
**Verify:** lint 0 + 293 unit + 11 e2e green

---

## 5.45.1 (build 264) — 2026-05-20 ♻️ Phase 92.8 — Extract Thai-locale formatters → `modules/utils.js`

ต่อยอด decomposition 92.1-92.7 — ย้าย pure formatters ไปรวมกับ shared utils (cohesion กับ escHtml/date helpers ที่มีอยู่). Refactor-only, byte-identical.

- ย้าย `money` / `formatNumber` / `formatCurrency` / `formatDate` / `formatDateTime` จาก main.js → `modules/utils.js` (วางใกล้ todayBkk/dateBkk)
- Pure functions (zero DOM/state/side-effect); main.js import กลับใช้ชื่อเดิม → `window.App` exports + 6 จุด `money()` ไม่แตะ call site เลย
- Caller compat ผ่าน ES import live binding (pattern เดียวกับ escHtml dedup Phase 51); `formatCurrency` เรียก `money` ภายใน module เดียวกัน
- main.js: 4467 → 4454 บรรทัด (−13); Tests: +12 (8 behavioral + 4 source-level pins)

**Build:** 263 → 264; version 5.45.0 → 5.45.1 (patch — refactor)
**Verify:** lint 0 + 275 unit + 11 e2e green

---

## 5.45.0 (build 263) — 2026-05-20 ♻️ Phase 92.7 — Extract `_appShareDoc` → `modules/share_doc.js`

ต่อยอด decomposition 92.1-92.6 — ย้าย Share/PDF overlay (chunk ใหญ่สุดที่เหลือใน main.js) ออกเป็น module. Behavior byte-identical, refactor-only.

- ย้าย Share/PDF overlay (~223 บรรทัด) จาก main.js → `modules/share_doc.js` เป็น `shareDoc({ docElementId, docName, documentRef, windowRef, loadHtml2Canvas, showToast, logger })`
- main.js เก็บ thin `window._appShareDoc` wrapper bind live globals → 4 callers (delivery_invoices/doc-utils/quotations/receipts) ไม่แตะ
- ทุก `document.`/`window.`/`navigator.`/`console.` + html2canvas loader route ผ่าน injected ref (global-leak guard PASS → กัน ReferenceError แบบ Phase 89.35)
- Phase 92.5 fallback (html2canvas โหลดไม่ได้ → error + ปิด modal ได้) preserved; source pin ย้ายตามไป share_doc.js
- main.js: 4690 → 4467 บรรทัด (−223); Tests: +10 (behavioral null-guard/modal-build/h2c-fail + source pins)

**Build:** 262 → 263; version 5.44.9 → 5.45.0 (minor — new module)
**Verify:** lint 0 errors + 263 unit + 11 e2e green

## 5.44.9 (build 262) — 2026-05-20 🛡️ Phase 92.6 — Share/PDF + Logo Sync hardening (3 review findings)

จาก code review หลัง 92.5 — defensive hardening 3 จุดใน 2 module (refactor-only, ไม่เพิ่ม feature). TDD ทุกข้อ (test red ก่อน fix)

**Issue 1 — `loadHtml2Canvas` concurrent dedup** (`modules/lazy_libs.js`)
- user double-click ปุ่ม Share ก่อน script โหลดเสร็จ → inject `<script>` ซ้ำ
- Fix: module-level `_pendingH2c` cache promise ที่ in-flight → concurrent callers ใช้ promise เดียวกัน. clear เมื่อ settle ทั้ง success+failure (success → call ถัดไป short-circuit ที่ `window.html2canvas`; failure → retry ได้)
- **หมายเหตุ:** prompt แนะนำให้ "ห้าม reset on success" แต่ตรวจแล้วว่า reset on success ก็ production-equivalent + กัน module-state leak ข้าม unit tests → user ยืนยันเลือกแบบ clear-on-success
- Tests: +2 (concurrent dedup + retry-after-fail)

**Issue 2 — `syncAppLogo` redundant repaint ทุก boot** (`modules/branding.js`)
- เดิม condition key จาก `!startsWith("data:")` → user ที่ logo เป็น Supabase http URL จะ `setItem()` + `onUpdated()` (repaint DOM) + return true ทุก boot แม้ URL ไม่เปลี่ยน
- Fix: early-exit เมื่อ `bsk_store_logo_url === publicUrl` (ดู URL ตรงพอ — ครอบ data: URI dedup case + ยัง refresh เมื่อ URL ต่างจริง)
- Tests: +1 (skip when URL unchanged)

**Issue 3 — `syncAppLogo` token CRLF (defense-in-depth)** (`modules/branding.js`)
- `accessToken` concat ลง Authorization header ตรงๆ (Supabase JWT กันได้ใน prod แต่ปิด gap ราคา 1 บรรทัด)
- Fix: `String(token).replace(/[\r\n]/g, "")` ก่อน inject
- Tests: +1 (CRLF strip)

**Build:** 261 → 262; version 5.44.8 → **5.44.9** (patch — hardening)
**Verify:** lint 0 errors + **253 unit** (249 → 253, +4) + 11 e2e green
**Scope guard:** แตะแค่ `modules/lazy_libs.js` + `modules/branding.js` + test 2 ไฟล์ + build-bump files. ไม่มี push (รอ user)

### How to test (manual smoke หลัง deploy build 262)
1. Ctrl+Shift+R → version **5.44.9 (build 262)**
2. เปิดใบเสร็จ/ใบเสนอราคา → Share/PDF → สร้าง PDF ปกติ
3. Double-click ปุ่ม Share รัวๆ → DevTools Elements เห็น `<script src*=html2canvas>` ตัวเดียว (ไม่ใช่ 2-3)
4. (offline) Network=Offline → Share → toast "โหลดตัวสร้าง PDF ไม่สำเร็จ" + modal ปิดได้
5. Boot 3 รอบ (user ที่ logo sync แล้ว) → Network ไม่มี Storage list call ซ้ำ / `bsk_store_logo_url` ไม่ rewrite ทุก boot

---

## 🧭 สรุป build 256 → 261 (Phase 91.4 → 92.5)

- **256** (5.44.3) — Phase 91.4: Loyalty audit CLOSED (baseline)
- **257** (5.44.4) — Phase 92.1 refactor: extract `updateAppLogos()` → `modules/branding.js`
- **258** (5.44.5) — Phase 92.2 refactor: extract `getAppLogo()` → `modules/branding.js`
- **259** (5.44.6) — Phase 92.3 refactor+harden: extract `syncAppLogo()` → `modules/branding.js` (+ AbortController timeout)
- **260** (5.44.7) — Phase 92.4 refactor: extract `loadHtml2Canvas()` → new `modules/lazy_libs.js`
- **261** (5.44.8) — Phase 92.5 🚑 hotfix: html2canvas CDN cdnjs → jsdelivr (CSP-allowed) + Share/PDF no longer hangs

257→261 = "Phase 92 main.js decomposition" — logo logic + html2canvas loader ย้ายออกจาก `main.js` หมด, `main.js` เหลือ thin wrapper. Unit 204→249, e2e 11 คงที่. รายละเอียดต่อ build ดูด้านล่าง + [HANDOFF.md](HANDOFF.md).

---

## 5.44.8 (build 261) — 2026-05-20 🚑 Phase 92.5 HOTFIX — html2canvas CDN blocked by CSP, Share/PDF stuck

### Symptom
เปิดเอกสาร (ใบเสนอราคา ฯลฯ) → กด Share/LINE/PDF → modal ค้างที่ "กำลังสร้าง PDF..." ตลอด ไม่มีไฟล์ออก. Console: `Loading the script 'https://cdnjs.cloudflare.com/.../html2canvas.min.js' violates Content Security Policy "script-src-elem ..."`

### Root cause
`HTML2CANVAS_CDN_URL` ชี้ไป `cdnjs.cloudflare.com` ซึ่ง **production CSP บล็อก** (script-src-elem อนุญาตเฉพาะ jsdelivr/unpkg/sheetjs/esm.sh). URL นี้เป็นค่า**เดิม**มาตั้งแต่ก่อน 92.4 (extract ไม่ได้เปลี่ยน) — share/PDF ผ่าน html2canvas พังเงียบมานานแล้ว เพิ่งเจอตอน smoke 92.4. ซ้ำร้าย `_appShareDoc` ไม่เช็ค return ของ loader → เมื่อ html2canvas โหลดไม่ได้ block สร้าง PDF ถูก skip ไม่มี else → ค้าง

### Fix
1. **`modules/lazy_libs.js`** — `HTML2CANVAS_CDN_URL` → `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js` (CSP-allowed host)
2. **`main.js` `_appShareDoc`** — capture `const _h2cReady = await _loadHtml2Canvas();` แล้วถ้า `!_h2cReady || !window.html2canvas`:
   - เปลี่ยน thumbnail "กำลังสร้าง PDF..." → ข้อความ error สีแดง "โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่"
   - `showToast("โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่")`
   - ผูกปุ่มปิด + click-outside แล้ว `return` (ไม่ค้าง)
3. behavior เมื่อโหลดสำเร็จ **ไม่เปลี่ยน**

### Build sync
- `selfheal.js?v=261`, `main.js?v=261`, `boot.js?v=261`, `style.css?v=261`, `data-app-build="261"`
- `sw.js` CACHE_NAME `v260` → `v261`
- `modules/settings/pages.js` Version `5.44.7` → **5.44.8**, build `260` → `261`

### Test
- `tests/lazy_libs_load_html2canvas.test.js` (13 tests, +3 net):
  - URL pin → jsdelivr 1.4.1; host ∈ {jsdelivr, unpkg} ห้าม cdnjs; **cross-check `_headers` CSP จริงว่า allow host นั้น** (กัน regression URL↔CSP)
  - source-level: `_appShareDoc` capture `await _loadHtml2Canvas()` return + มี failure message (กัน stuck modal กลับมา)
- `npm run verify`: lint + **249 unit** (246 → 249) + 11 e2e

### How to test (manual smoke หลัง deploy build 261)
1. Hard refresh → version **5.44.8 (build 261)**
2. เปิดใบเสนอราคา → กด Share/LINE/PDF → **ไม่มี CSP error**, html2canvas โหลดจาก jsdelivr, สร้าง PDF/thumbnail ได้
3. กด "บันทึก PDF" → ได้ไฟล์; กด LINE/แชร์ → ดำเนินการต่อด้วยไฟล์ที่สร้าง
4. กดซ้ำ → ไม่ inject script ซ้ำ, ไม่ค้าง
5. (regression) ถ้าโหลด html2canvas ไม่ได้ → เห็น toast + modal ปิดได้ ไม่ค้าง

### Lesson recorded
extract แบบ byte-identical ก็ "preserve" bug เดิมได้ — URL ที่ pin มาตั้งแต่ก่อน refactor (cdnjs) ไม่ตรง CSP allowlist. Smoke external-resource path (CDN/script inject) ต้องเทียบกับ CSP `_headers` ด้วย ไม่ใช่แค่ contract ของฟังก์ชัน

---

## 5.44.7 (build 260) — 2026-05-20 🧱 Phase 92.4 — extract html2canvas lazy loader

### Goal
ต่อจาก 92.3 — แยก `_loadHtml2Canvas` (lazy-load html2canvas ~350KB) ออกจาก `main.js` ไป module ใหม่ `modules/lazy_libs.js` แบบ behavior-preserving

### Change
**ย้าย loader ไป `modules/lazy_libs.js` เป็น `loadHtml2Canvas({ windowRef, documentRef, scriptUrl, logger })`**

- รักษา contract เดิม: resolve `true` ทันทีถ้า `window.html2canvas` มีอยู่แล้ว (idempotent ไม่ inject ซ้ำ) / inject `<script>` → `onload` resolve true, `onerror` resolve false / **ไม่เคย reject**
- export `HTML2CANVAS_CDN_URL` (pin 1.4.1 cdnjs) แยกเป็น constant
- เพิ่มจุดเดียวจากเดิม: `logger.warn` ตอน script โหลด fail (เดิมเงียบ) — **ไม่เปลี่ยน** resolve contract / control flow แค่ surface CDN/offline failure ให้ debug ง่ายขึ้น
- `main.js`: import `loadHtml2Canvas as _loadHtml2CanvasImpl`; `_loadHtml2Canvas()` body 9 บรรทัด → wrapper 1 บรรทัด เรียก `_loadHtml2CanvasImpl({ windowRef: window, documentRef: document })`. caller เดียว (`window._appShareDoc` L488) ไม่เปลี่ยน

### Scope note
`_loadHtml2Canvas` เป็น function private ใน main.js (ไม่อยู่บน window), มี caller เดียว. modules อื่น (delivery_invoices/quotations/receipts) แค่เช็ค `window.html2canvas` — พึ่ง share flow โหลดให้ → ไม่กระทบ

### Build sync
- `selfheal.js?v=260`, `main.js?v=260`, `boot.js?v=260`, `style.css?v=260`, `data-app-build="260"`
- `sw.js` CACHE_NAME `v259` → `v260`
- `modules/settings/pages.js` Version `5.44.6` → **5.44.7**, build `259` → `260`

### Test
- ใหม่ `tests/lazy_libs_load_html2canvas.test.js` — **10 tests, 2 layers** (no browser):
  - **Behavioral** (6): already-loaded → true + no script (idempotent), inject + src + append → onload true, onerror → false + log once, custom scriptUrl, null documentRef → false (no throw), `HTML2CANVAS_CDN_URL` pin 1.4.1
  - **Source-level** (4): lazy_libs.js export loadHtml2Canvas, main.js import จาก `./modules/lazy_libs.js`, main.js ไม่มี inline cdnjs html2canvas URL แล้ว, wrapper `_loadHtml2Canvas` delegate `_loadHtml2CanvasImpl`
- `npm run verify`: lint + **246 unit** (236 → 246, +10) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version **5.44.7 (build 260)**
2. เปิดเอกสาร (ใบเสร็จ/ใบเสนอราคา/ใบส่งของ) → กดแชร์/PDF → html2canvas โหลด + สร้าง PDF ได้ตามเดิม
3. แชร์ครั้งที่ 2 → ไม่โหลด script ซ้ำ (idempotent)
4. (option) offline → กดแชร์ → ไม่ crash, console เห็น `[loadHtml2Canvas] failed to load` (ของใหม่)

### Phase 92 roadmap (เหลือ)
1. ~~92.1~~ ✅ ~~92.2~~ ✅ ~~92.3~~ ✅ logo decomposition / ~~92.4~~ ✅ lazy_libs
2. **92.5+** — boot IIFE → `modules/boot.js`; sidebar/navigation → `modules/sidebar.js`; auth/profile boot

### Lesson recorded
ไม่มี — extract เรียบ, caller เดียว, contract ชัด (เพิ่มแค่ logger.warn บน fail path ที่ flag ไว้แล้ว)

---

## 5.44.6 (build 259) — 2026-05-20 🧱 Phase 92.3 — extract + harden logo Supabase sync

### Goal
ต่อจาก 92.2 — แยก `_appSyncLogo` (pull โลโก้จาก Supabase Storage) ออกจาก `main.js` ไป `modules/branding.js` **พร้อม harden** timeout

### Change
**ย้าย logic pull โลโก้ ไป `modules/branding.js` เป็น `syncAppLogo({ config, accessToken, storageRef, fetchImpl, timeoutMs, onUpdated, logger })`**

- รักษา flow เดิม byte-identical: POST storage list `store-assets` (prefix "logo") → หา `logo.*` → สร้าง public URL (cache-bust `?t=`) → เขียน localStorage + repaint **เฉพาะเมื่อ cache stale** (ไม่ทับ data: URI ที่ URL ตรงกันอยู่)
- **HARDEN** (2 จุด — ของเดิมไม่มี):
  1. list fetch ห่อด้วย `AbortController` timeout (default 8s) — เดิมใช้ raw `fetch` ไม่มี timeout → network ค้างได้เงียบๆ
  2. failure (offline / abort / non-OK) log ผ่าน injected `logger.warn` แทนการกลืน error เงียบ — localStorage cache ยังเสิร์ฟโลโก้ได้ตามเดิม UI ไม่พัง
- `main.js`: import `syncAppLogo as _syncAppLogoImpl`; `window._appSyncLogo` body 26 บรรทัด → wrapper เรียก `_syncAppLogoImpl({ config: window.SUPABASE_CONFIG, accessToken: window._sbAccessToken, onUpdated: () => updateAppLogos() })` — boot caller (L4660) ไม่เปลี่ยน

### หมายเหตุ smoke เดิม
console `Supabase save failed (using localStorage): supabase timeout` มาจาก **`saveStoreInfo()`** (คนละ path — save, มี 3s timeout อยู่แล้ว) ไม่ใช่ `_appSyncLogo` — ทำงานถูกแล้ว (localStorage fallback). 92.3 hardening แก้คนละจุด (pull path ที่ไม่เคยมี timeout)

### Build sync
- `selfheal.js?v=259`, `main.js?v=259`, `boot.js?v=259`, `style.css?v=259`, `data-app-build="259"`
- `sw.js` CACHE_NAME `v258` → `v259`
- `modules/settings/pages.js` Version `5.44.5` → **5.44.6**, build `258` → `259`

### Test
- ใหม่ `tests/branding_sync_app_logo.test.js` — **14 tests, 2 layers** (no network, no window):
  - **Behavioral** (9): happy path cache+repaint, header apikey/Bearer token + anonKey fallback, no config/fetch/storage → false, non-OK → no write, no `logo.*` → no write, dedup data: URI ตรง URL → skip, URL ต่าง → refresh, non-data → refresh
  - **Hardening** (2): fetch reject → caught + logged + false (no throw); stalled fetch → abort ด้วย timeoutMs + logged (ไม่ค้าง)
  - **Source-level** (3): branding.js export `syncAppLogo`, main.js ไม่มี inline `storage/v1/object/list/store-assets` แล้ว, wrapper `window._appSyncLogo` delegate `_syncAppLogoImpl`
- `npm run verify`: lint + **236 unit** (222 → 236, +14) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version **5.44.6 (build 259)**
2. Boot ปกติ → โลโก้มาจาก Supabase/localStorage ตามเดิม (sidebar/auth/docs)
3. Network ช้า/offline ตอน boot → ไม่ค้าง, ใช้ localStorage cache, console เห็น `[syncAppLogo] sync skipped` (ของใหม่ — ไม่ใช่ error)
4. Upload logo ใหม่ → cross-device sync ผ่าน storage ตามเดิม

### Phase 92 roadmap (เหลือ)
1. ~~92.1 updateAppLogos~~ ✅ / ~~92.2 getAppLogo~~ ✅ / ~~92.3 syncAppLogo~~ ✅ — logo logic แยกออกจาก main.js ครบแล้ว
2. **92.4** — `loadHtml2Canvas` lazy loader → `modules/lazy_libs.js`
3. **92.5+** — boot IIFE / sidebar / auth

### Lesson recorded
smoke log อาจชี้คนละ function กับที่คิด — `Supabase save failed` = save path (มี timeout), แต่ pull path (`_appSyncLogo`) ต่างหากที่ไม่มี timeout. ตรวจ stack/ข้อความให้ตรง function ก่อน harden

---

## 5.44.5 (build 258) — 2026-05-20 🧱 Phase 92.2 — extract logo source resolver (zero-behavior)

### Goal
ต่อจาก 92.1 — แยก **logo source resolver** (`_appGetLogo`) ออกจาก `main.js` ไป `modules/branding.js` แบบ refactor-only, ห้ามเปลี่ยน behavior

### Change
**ย้าย logic resolve โลโก้ ออกไป `modules/branding.js` เป็น `getAppLogo({ stateRef, storageRef, defaultLogo })`**

- `modules/branding.js` เพิ่ม export ที่สอง:
  ```js
  getAppLogo({ stateRef, storageRef = localStorage, defaultLogo = "./icons/logo.svg" })
  ```
  รักษา priority chain เดิม byte-identical: `state.storeInfo?.logoUrl || localStorage["bsk_store_logo"] || default` (ใช้ `||` → empty/null falls through เหมือนเดิม). `state` + `storage` ถูก inject → pure + testable
- `main.js`:
  - import `getAppLogo as _getAppLogoImpl` เพิ่มจาก branding.js
  - `window._appGetLogo` body 3 บรรทัด → wrapper 1 บรรทัด `return _getAppLogoImpl({ stateRef: state });` — bind live `state`
  - call sites ทั้งหมด (pos / dashboard / payroll / receipts / quotations / delivery_invoices ผ่าน `window._appGetLogo()`) ทำงานเหมือนเดิม **0 behavior surface เปลี่ยน**

### ยังไม่แตะ (flag ไว้ 92.3)
- `window._appSyncLogo` — async, fetch จาก Supabase Storage ผ่าน `SUPABASE_CONFIG` + `_sbAccessToken` — ต้อง inject config + token ก่อน

### Build sync
- `selfheal.js?v=258`, `main.js?v=258`, `boot.js?v=258`, `style.css?v=258`, `data-app-build="258"`
- `sw.js` CACHE_NAME `v257` → `v258`
- `modules/settings/pages.js` Version `5.44.4` → **5.44.5** (patch — refactor), build `257` → `258`

### Test
- ขยาย `tests/branding_update_app_logos.test.js` (+8 → 18 รวม):
  - **Behavioral** (5): storeInfo.logoUrl ชนะ, fall-through ไป localStorage เมื่อ storeInfo ว่าง/null/empty, fall-through ไป default, custom defaultLogo, null storageRef ไม่ throw
  - **Source-level** (3): branding.js export `getAppLogo`, main.js ไม่มี inline chain `storeInfo.logoUrl || localStorage.getItem("bsk_store_logo")` แล้ว, wrapper `window._appGetLogo` ยังอยู่ + delegate `_getAppLogoImpl({ stateRef: state })`

### How to test (manual smoke)
1. Ctrl+Shift+R → version **5.44.5 (build 258)**
2. Settings → โลโก้ใน sidebar + profile ต้องเหมือนเดิม
3. เอกสาร (ใบเสร็จ / ใบเสนอราคา / ใบส่งของ) → โลโก้บนหัวเอกสารต้องมา (call ผ่าน `window._appGetLogo()`)
4. Upload logo ใหม่ → ทุกจุดอัปเดต (Phase 36 flow)
5. โหมด offline (ไม่มี storeInfo จาก DB) → ยังเห็นโลโก้จาก localStorage cache

### Phase 92 roadmap (เหลือ)
1. ~~92.1 updateAppLogos~~ ✅ / ~~92.2 getAppLogo~~ ✅
2. **92.3** — Extract `_appSyncLogo` (inject `SUPABASE_CONFIG` + token)
3. **92.4** — `loadHtml2Canvas` lazy loader → `modules/lazy_libs.js`

### Lesson recorded
ไม่มี — pattern ตรงตาม 92.1 (small extraction, inject globals, zero-behavior, behavioral + source-level tests)

---

## 5.44.4 (build 257) — 2026-05-19 🧱 Phase 92.1 — main.js decomposition first cut (zero-behavior)

### Goal
เริ่มแยก `main.js` (4,600+ บรรทัด) แบบปลอดภัยที่สุด — refactor-only, ห้ามเปลี่ยน behavior, revert ง่าย

### Change
**ย้ายเฉพาะ `updateAppLogos()` (DOM painter ล้วน) ออกไป `modules/branding.js`**

- ใหม่: `modules/branding.js` มี export เดียว
  ```js
  updateAppLogos({ documentRef = document, getLogo = () => window._appGetLogo?.() })
  ```
  Logic ตรง byte-identical กับ main.js L4658-4673 เดิม — paint .sidebar-logo-img / .auth-logo-img / .set-profile-logo / .spinner-logo / favicon (เฉพาะ data: URI)
- `main.js`:
  - เพิ่ม `import { updateAppLogos as _updateAppLogosImpl } from "./modules/branding.js";` กับ imports อื่น
  - แทนที่ body 16 บรรทัด ด้วย wrapper 3 บรรทัด — wrapper เรียก `_updateAppLogosImpl({...})` ผ่าน document + getLogo
  - Wrapper รักษา closure identity → `window.updateAppLogos`, `window.App.updateAppLogos`, และ 4 call sites ภายใน (L421/L975/L4687) ทำงานเหมือนเดิม **0 byte ของ behavior surface เปลี่ยน**

### ไม่แตะใน 92.1 (flag ไว้สำหรับ 92.2/92.3)
- `window._appGetLogo` — couple กับ `state.storeInfo.logoUrl` + localStorage
- `window._appSyncLogo` — couple กับ `SUPABASE_CONFIG` + `_sbAccessToken` (async network)
ทั้งคู่ต้อง design seam สำหรับ inject state + config ก่อนค่อยย้าย

### Out-of-scope finds (flag, ไม่แก้ปน per scope guard)
- `loadAppSettings` (L965+) เรียก `updateAppLogos()` ผ่าน `typeof === "function"` check — ตอนนี้ guarantee แล้วว่ามี → simplify เป็น direct call ได้, แต่ถือเป็น behavior-adjacent. Phase 92.x candidate
- `boot` IIFE ที่ท้ายไฟล์ — candidate ธรรมชาติสำหรับ `modules/boot.js` หลัง dependency เดิมๆ ย้ายออกหมด

### Build sync
- `selfheal.js?v=257`, `main.js?v=257`, `boot.js?v=257`, `style.css?v=257`
- `data-app-build="257"` ใน index.html
- `sw.js` CACHE_NAME `v256` → `v257`
- `modules/settings/pages.js` Version `5.44.3` → **5.44.4** (patch — refactor), build `256` → `257`

### Test
- เพิ่ม `tests/branding_update_app_logos.test.js` — **10 unit tests, 2 layers**:
  - **Behavioral** (6 tests, minimal Document stub):
    1. Paints every slot (sidebar / profile / spinner / 2 auth elements)
    2. Favicon **เฉพาะ** `data:` URI — http URL ไม่แตะ (กัน spurious fetch — original behavior)
    3. Missing favicon element OK — ไม่ throw
    4. Empty/null/undefined/false logo → no-op (defensive)
    5. Null documentRef → no-op (Node test env without document)
    6. `querySelectorAll('.auth-logo-img')` paint ทุก element ไม่ใช่แค่ตัวแรก (multi-element selector pin)
  - **Source-level** (4 tests):
    7. main.js มี `import ... from "./modules/branding.js"`
    8. branding.js มี `export function updateAppLogos(`
    9. main.js **ไม่มี** inline `querySelector('.sidebar-logo-img'|'.auth-logo-img'|'.set-profile-logo'|'.spinner-logo')` แล้ว — กัน regression
   10. main.js ยังคงมี `function updateAppLogos()` wrapper + `window.updateAppLogos = updateAppLogos` — preserves contract
- `npm run verify` ผ่านครบ: lint + **214 unit** (เดิม 204 +10) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version **5.44.4 (build 257)**
2. Settings → ดูโลโก้ใน sidebar (มุมบนซ้าย) + profile section
3. Logout → login → ดูโลโก้ในหน้า auth/login
4. Loading overlay ตอน boot → ดูโลโก้ใน spinner
5. Favicon ใน browser tab — ต้องเหมือนเดิม (ถ้าเป็น http URL → ใช้ default static favicon; ถ้าเป็น data: URI → override)
6. Settings → upload logo ใหม่ → ทุกจุดต้องอัปเดตทันที (Phase 36 flow ผ่าน `window.updateAppLogos`)

### Phase 92 roadmap (suggested next cuts in order of safety)
1. **Phase 92.2** — Extract `_appGetLogo` to `modules/branding.js` (inject `state`, keep `window._appGetLogo` wrapper)
2. **Phase 92.3** — Extract `_appSyncLogo` to `modules/branding.js` (inject `state` + `SUPABASE_CONFIG`)
3. **Phase 92.4** — Extract `loadHtml2Canvas` lazy loader → `modules/lazy_libs.js`
4. **Phase 92.5+** — Auth/profile boot → `modules/boot/auth.js`; sidebar/navigation → `modules/sidebar.js`; etc.

### Lesson recorded
ไม่มี — pattern ตรงตามที่ user สั่ง (small extraction, zero-behavior, ทดสอบ behavioral + source-level, defer ส่วนที่ couple กับ globals)

---

## 5.44.3 (build 256) — 2026-05-19 🔥 Phase 91.4 HOTFIX — Reverse-loyalty wiring pre-gate removed

### Symptom (build 255 smoke fail)
- sale #143, BSK-1779196282363, customer jeerasuk, amount 500
- POS auto-earn worked → jeerasuk +5
- User กดลบ sale จาก "รายการขาย" → console: `[auto_post] voided 1 JV(s) for sales#143` ขึ้นปกติ
- **Loyalty summary ไม่ลด** (610/100/510 → ยังเป็น 610/100/510)
- Expected: 605/100/505 (หรือใน schema เรา: 610/105/505 — แต้มหายอย่างน้อย -5 จาก remaining)

### Root cause
Phase 91.3 wiring ใน `modules/refunds.js` L419 และ `modules/sales.js` L244 ใส่ pre-gate บน sale-row `customer_id`:
```js
if (targetSale?.customer_id) {           // ← guard
  await mod.reverseEarnedPointsForSale(...);
}
```
แต่ `sales.customer_id` เป็น opt-in column — pos.js comment L1119: "ถ้ามี customer_id field ในตาราง — ใส่ด้วย (รองรับ schema ที่ extend แล้ว)". ถ้า column ไม่มี / มีแต่ null สำหรับ row นี้ → guard pass false → helper ไม่ถูกเรียก → ไม่มี log ไม่มี toast ไม่มี DB record → user ไม่เห็นอะไรเปลี่ยน

แต่ใน Phase 91.3 helper ออกแบบให้ resolve customer_id จาก earn record (`loyalty_points.customer_id` มีเสมอตั้งแต่ Phase 91.1):
```js
const customerId = optCustomerId != null ? optCustomerId : earnRecords[0].customer_id;
```
ตัว guard ของ wiring strict กว่า contract ของ helper → fallback path ใช้งานไม่ได้

### Fix
- `modules/refunds.js` — ลบ `&& _selectedSale?.customer_id` จาก guard. ผ่าน `customerId: _selectedSale.customer_id || null` ให้ helper
- `modules/sales.js` — ลบ `if (targetSale?.customer_id) { ... }` wrapper. ผ่าน `customerId: targetSale?.customer_id || null`
- เพิ่ม diagnostic `console.log("[sales delete] loyalty reverse attempt:", { saleId, saleCustomerId, earnCount })` ก่อน helper — smoke ครั้งต่อจะ self-diagnose ใน DevTools

### Build sync
- `selfheal.js?v=256`, `main.js?v=256`, `boot.js?v=256`, `style.css?v=256`
- `data-app-build="256"` ใน index.html
- `sw.js` CACHE_NAME `v255` → `v256`
- `modules/settings/pages.js` Version `5.44.2` → **5.44.3** (patch — wiring fix), build `255` → `256`

### Test
- เพิ่ม 4 unit tests ใน `tests/loyalty_reverse_sale.test.js`:
  1. **Behavioral**: `reverseEarnedPointsForSale(143, { state, customerId: null })` → helper resolves customer_id จาก earn record → reverse 5 ออกมาถูกต้อง พร้อม customer_id ใน record
  2. **Behavioral**: option key `customerId` ละไว้ (undefined) → fallback ทำงานเหมือนกัน
  3. **Source-level**: `modules/refunds.js` ห้ามมี `&& _selectedSale?.customer_id` ใน guard (strip comments ก่อนเช็ค กัน false positive จาก explainer)
  4. **Source-level**: `modules/sales.js` ห้ามมี `if (targetSale?.customer_id)` wrapper
- `npm run verify` ผ่านครบ: lint + **204 unit** (เดิม 200 +4) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version **5.44.3 (build 256)**
2. POS → เลือก jeerasuk → ขาย 500 → +5 (jeerasuk Y+5)
3. รายการขาย POS → ลบบิลนี้
4. DevTools Console จะมี: `[sales delete] loyalty reverse attempt: {saleId, saleCustomerId: <null หรือเลข>, earnCount: 1}` — แสดง earn record ถูกเจอ
5. ตามด้วย: `[sales delete] loyalty reverse skipped` (ถ้าซ้ำ) หรือไม่มี (ถ้า reverse ครั้งแรก)
6. Toast: `ลบรายการขายเรียบร้อย ✅ (... คืนแต้ม 5)` — มี `คืนแต้ม` ใน sideEffectsMsg
7. Loyalty summary jeerasuk: lower by 5 (remaining ลด -5 ตามที่คาด)

### Lesson recorded
**Wiring guards ห้าม strict กว่า contract ของ helper.** Helper บอก "customer_id optional, ฉันจะ resolve จาก earn record" แต่ wiring บอก "ไม่มี customer_id → ปฏิเสธ" → branch ของ helper ที่จัดการ edge case นี้ unreachable. Rule: ที่ call site, gate เฉพาะ inputs ที่ helper REQUIRE (here: `saleId`) และปล่อยให้ helper ตัดสินใจสิ่งที่ optional

→ บันทึก `feedback_wiring_guard_too_strict.md` ใน memory

---

## 5.44.2 (build 255) — 2026-05-19 ↩️ Phase 91.3 — Refund/cancel reverse loyalty auto-earn

### Goal
ปิด over-credit risk จาก Phase 91.1 — ถ้าบิลที่ได้แต้มอัตโนมัติถูก refund หรือ soft-delete ลูกค้ายังเก็บแต้มฟรี. Phase 91.3 ใส่ "claw back" idempotent ทั้ง 2 reverse path

### Schema decision
ใช้ schema เดิม **ไม่เพิ่ม `type` enum ใหม่** (ลดความเสี่ยง regression ต่อ summary/history/getCustomerPoints):
```
type      = 'redeem'         (existing — subtract path เดิม)
ref_type  = 'sale_reverse'   (ค่าใหม่ — column เป็น text ไม่มี CHECK)
ref_id    = <saleId>         (anchor idempotency เข้ากับ sale ต้นทาง)
```
`getCustomerPoints` หัก `redeem` ทุก row อยู่แล้ว → balance อัปเดตเอง. `ref_type` แยก auto-reverse จาก manual redeem ใน history modal ได้

### Helper (`modules/loyalty.js`)
3 functions ใหม่ที่ export ให้ caller ทุก reverse path เรียก:
- `getSaleEarnedPoints(state, saleId, customerId?)` — sum earn ของ sale หนึ่ง
- `hasReversedLoyaltyForSale(state, saleId, customerId?)` — idempotency probe
- `reverseEarnedPointsForSale(saleId, { state, customerId?, refundId? })` — main entry

Return shape:
```js
{ ok: true,  reversed: N, totalEarned: T, capped: boolean }
{ ok: false, skipped: true,  reason: '...' }    // expected silent skip
{ ok: false, skipped: false, reason: '...' }    // real failure
```
ไม่ throw — caller จัดการได้

### Wiring (2 จุด)
1. **`modules/refunds.js`** (~L412) — fire-and-forget หลัง `postJournalForRefund`. Dynamic import `./loyalty.js?v=APP_BUILD` (Phase 90.7 invariant). ผ่าน `state` + `customerId` + `refundId` ให้ helper. Toast `คืนแต้ม N แต้ม` ตอน success, มี `(จาก N)` suffix ถ้า capped
2. **`modules/sales.js`** soft-delete (~L237) — side-effect (c) เคียงข้าง void JV + revert stock. ใช้ dynamic import เหมือนกัน. ค้นหา `customer_id` จาก `state.sales` ตาม `saleId`. ใส่ `คืนแต้ม N/T` เข้า sideEffectsMsg เดิม

### Guarantees
- **Idempotent**: scan `state.loyaltyPoints` หา row ที่มี `ref_type='sale_reverse'` + `ref_id=saleId` + `customer_id=cid` แล้ว skip ทันทีถ้ามี
- **No negative balance**: cap reverse ที่ `min(earnedFromSale, customer.remaining)`. ถ้าลูกค้าใช้แต้มไปก่อนแล้ว note จะใส่ `(3 แต้มถูก redeem ไปแล้ว)`
- **Silent skip** สำหรับ: ไม่มี `customer_id` ใน sale / ไม่เคย earn / remaining=0
- **Main flow safe**: try/catch + console.warn. refund/cancel ปกติยังเสร็จเสมอแม้ loyalty layer fail (RLS, network, missing XHR)

### Build sync
- `selfheal.js?v=255`, `main.js?v=255`, `boot.js?v=255`, `style.css?v=255`
- `data-app-build="255"` ใน index.html
- `sw.js` CACHE_NAME `v254` → `v255`
- `modules/settings/pages.js` Version `5.44.1` → **5.44.2** (patch — closes loyalty gap), build `254` → `255`

### Tests
- เพิ่ม `tests/loyalty_reverse_sale.test.js` — **18 unit tests with mocked `window._appXhrPost`**:
  1-5. `getSaleEarnedPoints` — null guards, sale/customer filtering, redeem rows ignored, String() coerce
  6-8. `hasReversedLoyaltyForSale` — true/false, distinguishes ref_type='sale_reverse' from manual `'redemption'`
  9-10. Happy path: earn 5 → reverse 5, record shape ครบ, refundId append เข้า note
  11. Idempotency: existing reverse row → skip + 0 xhr calls
  12-13. Skips: no earn / no customer_id
  14. **Cap**: earn 5 + redeem 3 → reverse 2, capped=true, note shows `2/5`
  15. Skip when remaining=0 (used all)
  16. Defense — negative remaining → skip (เผื่อ corrupt data)
  17. Missing `window._appXhrPost` → `ok:false, skipped:false` (ไม่ throw)
  18. RLS denied → `ok:false, skipped:false`, attempted insert
- `npm run verify` ผ่านครบ: lint + **200 unit** (เดิม 182 +18) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version แสดง **5.44.2 (build 255)**
2. **Setup:** Loyalty settings → "ทุก 100 บาท = 1 แต้ม" + เปิด is_active
3. **Round 1 (happy path):**
   - POS → เลือก jeerasuk → ขาย 500 บาท → `+5 แต้ม` ✓
   - Refunds → คืนบิลนี้ → ✅ toast `คืนแต้ม 5 แต้ม` + Loyalty summary jeerasuk -5
   - History modal → row "เพิ่มแต้ม 5 — sale #X" + row "แลกแต้ม 5 — sale_reverse #X" คู่กัน
4. **Round 2 (idempotency):** กดสั่ง refund บิลเดิมอีกครั้ง (ถ้า UX อนุญาต) → ✅ console log `loyalty reverse skipped: already reversed` (ไม่มี duplicate -5)
5. **Round 3 (no customer):** ขายไม่เลือกลูกค้า → refund → ไม่มี loyalty side effect (silent skip)
6. **Round 4 (cap behavior):**
   - ขาย jeerasuk 500 → +5 (รวม remaining = X+5)
   - Loyalty manual tab → redeem 3 แต้มของ jeerasuk
   - Refund บิลนี้ → ✅ toast `คืนแต้ม N (จาก 5)` โดย N = remaining ที่เหลือ. History note ใส่ `(3 แต้มถูก redeem ไปแล้ว)`
7. **Round 5 (sale soft-delete):** Sales tab → กดลบบิลที่มี loyalty earn → toast `ลบรายการขายเรียบร้อย ✅ (...คืนแต้ม 5)`

### Lesson recorded
ไม่มี — pattern เดียวกับ Phase 91.1 (fire-and-forget side-effect + Phase 90.7 ?v=APP_BUILD cache-bust + Phase 90.10 String() compare). Composition ของ pattern ที่มีอยู่

---

## 5.44.1 (build 254) — 2026-05-19 🔥 Phase 91.2 HOTFIX — Earn formula divide-not-multiply

### Severity
**CRITICAL** — production build 253 ทำให้ลูกค้าได้แต้มเกินจริง 10,000 เท่า. ตัวอย่าง: `jeerasuk` ปิดบิล 500 บาท + ตั้ง "ทุก 100 บาท = 1 แต้ม" → ได้แต้ม 50,000 (ที่ถูกคือ 5). กระทบทุก sale ตั้งแต่ build 253 deploy

### Root cause
column DB ชื่อ `points_per_baht` แต่ UI label เขียน "ทุกกี่บาทได้ 1 แต้ม" → ค่าเก็บคือ **บาท-ต่อ-แต้ม** (ตัวหาร) ไม่ใช่ **แต้ม-ต่อ-บาท** (ตัวคูณ). `modules/loyalty.js:79` คำนวณคูณตามชื่อ var:
```js
const pointsToAdd = Math.floor(Number(amount || 0) * pointsPerBaht);
//                                                 ^ ผิด — ต้องเป็น /
```
500 × 100 = **50,000** ที่ถูกควรเป็น 500 / 100 = **5**

### Fix
Export helper รวมศูนย์ใน `modules/loyalty.js`:
```js
export function calcEarnPoints(amount, settings) {
  const bahtPerPoint = Number(settings?.points_per_baht || 0);
  const spendAmount = Number(amount || 0);
  if (!settings?.is_active || bahtPerPoint <= 0 || spendAmount <= 0) return 0;
  return Math.floor(spendAmount / bahtPerPoint);
}
```
`earnPoints()` เรียก `calcEarnPoints(amount, settings)` แทน inline math. Future caller (เช่น POS preview pill, customer self-service page) ก็เรียก helper เดียวกัน — drift จากกันไม่ได้

### Cleanup ข้อมูลเสีย
Records ผิดถูก insert ตั้งแต่ build 253 deploy. User อาจอยากลบมือ:
```sql
-- ดูก่อนลบ
SELECT id, customer_id, points, ref_id, created_at
FROM loyalty_points
WHERE type='earn'
  AND points > 1000
  AND created_at >= '2026-05-19';

-- ถ้าตรงตามคาด:
DELETE FROM loyalty_points
WHERE type='earn'
  AND points > 1000
  AND created_at >= '2026-05-19';
```
จากนั้น Loyalty → สรุปแต้ม จะแสดงยอดถูกหลัง reload

### Build sync
- `selfheal.js?v=254`, `main.js?v=254`, `boot.js?v=254`, `style.css?v=254`
- `data-app-build="254"` ใน index.html
- `sw.js` CACHE_NAME `v253` → `v254`
- `modules/settings/pages.js` Version `5.44.0` → **5.44.1** (patch — bug fix), build `253` → `254`

### Test
- เพิ่ม `tests/loyalty_calc_earn_points.test.js` — **14 unit tests, real behavior (ไม่ใช่ source-level)**:
  1. **Anti-regression**: 500 baht @ rate 100 = 5 (**NEVER 50000**) — explicit
  2. Boundary: 99 → 0, 100 → 1, 1000 → 10
  3. Floor: 549, 599.99 → 5
  4. Defensive null/undefined/empty settings → 0
  5. `is_active=false` → 0, rate ≤ 0 → 0, amount ≤ 0 → 0
  6. String coercion (Supabase อาจคืน string สำหรับ numeric column)
  7. Rate 1 → 1:1, rate 50 → 2x earning
  8. **Integration**: earnPoints mock — posted record.points = 5 (NEVER 50000) สำหรับ 500/100
  9. **Integration**: amount < threshold → 0 POST calls (ไม่เขียน DB row เสียทรัพยากร RLS)
- `npm run verify` ผ่านครบ: lint + **182 unit** (เดิม 168 +14) + 11 e2e

### How to test (manual smoke after deploy)
1. Ctrl+Shift+R → version **5.44.1 (build 254)**
2. (Optional) cleanup ข้อมูลเสีย via SQL ข้างบน
3. Loyalty settings: ตั้ง "ทุก 100 บาท = 1 แต้ม" + เปิดใช้งาน
4. POS → เลือกลูกค้า test → ปิดบิล 500 บาท
   - ✅ Expected: toast **`บันทึกแต้ม 5 แต้มสำหรับลูกค้า`** (ไม่ใช่ 50,000)
5. POS → ปิดบิล 99 บาท → ไม่มี earn toast (floor 99/100 = 0)
6. POS → ปิดบิล 1000 บาท → toast `บันทึกแต้ม 10 แต้ม`
7. Loyalty → สรุปแต้ม → ยอด customer = 5 + 10 = 15 (จาก test 4 + 6)

### Lesson
**Misleading column name = silent bug.** column ชื่อ `points_per_baht` สื่อ "rate of points-per-baht" → invite multiplication. แต่ UI semantic = "baht-per-point" (divisor). Fix: ใช้ helper รวมศูนย์ + ตั้งชื่อ var ตรงกับความหมายจริง (`bahtPerPoint`) แม้ column DB ยังเป็นชื่อเดิม (rename ต้อง migration)

---

## 5.44.0 (build 253) — 2026-05-19 ⭐ Phase 91.1 — POS checkout auto-earn loyalty points [NEW FEATURE]

### What's new
ปิดบิล POS → ระบบเพิ่มแต้มสะสมให้ลูกค้าอัตโนมัติ. ก่อนหน้านี้แม้ระบบแต้มเปิดใช้งานและตั้งอัตราไว้ ก็ต้อง admin ไปแท็บ "เพิ่ม/แลกแต้มด้วยตนเอง" ใส่แต้มเอง

### กติกาที่ใช้
- **เพิ่มแต้มก็ต่อเมื่อ** มีลูกค้าใน slip (`_posCustomer.id` ตั้งจาก ✚ เลือก/เพิ่มลูกค้า) + ระบบแต้มเปิด (`loyaltySettings.is_active`) + ตั้งอัตรา (`points_per_baht > 0`)
- **Amount** = ยอดที่ลูกค้าจ่ายจริง (`actualTotal` — รวม VAT, หักส่วนลดแล้ว). ตัวอย่าง: ตั้ง "ทุก 100 บาทได้ 1 แต้ม" + บิล 1,500 บาท → ได้ 15 แต้ม (`Math.floor(1500 * 0.01)`)
- **Silent skip** ทุกกรณีที่ไม่ตรงเงื่อนไข — ไม่มี toast รบกวนคนขายตอน loyalty ปิด
- **Fire-and-forget** — ไม่ block UI. ถ้า earn ล้มเหลว (เน็ตหลุด, etc.) เข้า console.warn ไม่กระทบ flow ปิดบิล

### Trace
- earn record มี `ref_type='sale'` + `ref_id=<saleId>` → เปิดดูใน Loyalty → tab สรุปแต้ม → ปุ่ม history ของลูกค้า → ตารางจะแสดงรายการ "เพิ่มแต้ม N — sale #<saleId>"

### Out of scope (รอ phase ถัดไป)
- **Refund/cancel reversal** — ถ้า user refund หรือ soft-delete sale → earn record ยังคา = over-credit. ต้อง wire reverse-record (`redeemPoints` หรือ DELETE row) ใน `modules/refunds.js` + sale void path
- **Manual tab role gate** — sales กดเพิ่ม/แลกได้อยู่ (product decision)

### Change
- `modules/pos.js`:
  - หลัง `saleId` validate: capture `_earnCustomerId = _posCustomer?.id` + `_earnAmount = actualTotal` (ต้องจับก่อน state-reset เคลียร์ `_posCustomer`)
  - หลัง `postJournalForSale(...).catch(...)`: เพิ่ม fire-and-forget block ที่ dynamic import `./loyalty.js?v=APP_BUILD` แล้วเรียก `m.earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx)` กับ ctx ที่มี state + showToast + loadAllData

### Build sync
- `selfheal.js?v=253`, `main.js?v=253`, `boot.js?v=253`, `style.css?v=253`
- `data-app-build="253"` ใน index.html
- `sw.js` CACHE_NAME `v252` → `v253`
- `modules/settings/pages.js` Version `5.43.48` → **5.44.0** (minor bump — new feature, ไม่ใช่ patch fix), build `252` → `253`

### Test
- เพิ่ม `tests/pos_loyalty_auto_earn.test.js` — 8 source-level assertions:
  1. Capture: `_earnCustomerId = _posCustomer?.id` + `_earnAmount = actualTotal`
  2. Capture หลัง `xhrPostPOS("sales", ...)` (ต้องมี saleId ก่อน)
  3. Capture ก่อน `_posCustomer = null` ในส่วน post-checkout reset (anchor ด้วย comment "เคลียร์ลูกค้าหลังจบบิล")
  4. Guard มีครบ 3 เงื่อนไข (`_earnCustomerId` + `is_active` + `points_per_baht`)
  5. Call signature ตรง: `.earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx)`
  6. Dynamic import URL มี `?v=APP_BUILD` cache-bust (Phase 90.7 invariant)
  7. ไม่มี `await` บน import chain (fire-and-forget, pattern เดียวกับ postJournalForSale)
  8. `.catch` log ด้วย `console.warn` — ไม่ silent swallow
- `npm run verify` ผ่านครบ: lint + **168 unit** (เดิม 160 +8) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version แสดง **5.44.0 (build 253)**
2. **Setup once:** Login เป็น admin → Loyalty → ตั้งค่า → เปิด "เปิดใช้งานระบบแต้ม" + ตั้ง "ทุกกี่บาทได้ 1 แต้ม" (เช่น 100) + บันทึก
3. **Happy path:** ไปหน้า POS → กด ✚ เลือกลูกค้า "jeerasuk" → ใส่สินค้า/ยอด 500 บาท → ปิดบิล
   - ✅ Expected: toast "บันทึกการขายเรียบร้อย ✅" + toast "บันทึกแต้ม 5 แต้มสำหรับลูกค้า" (ตามมาหลัง JV/Line notify) + Loyalty → สรุปแต้ม จะเห็น jeerasuk เพิ่ม 5 แต้ม
4. **Silent skip — ไม่เลือกลูกค้า:** ปิดบิลโดยไม่กดเลือกลูกค้า → toast "บันทึกการขายเรียบร้อย ✅" เท่านั้น ไม่มี toast แต้ม ไม่มี error
5. **Silent skip — ปิดระบบแต้ม:** ไปปิด "เปิดใช้งานระบบแต้ม" → กลับไป POS → เลือกลูกค้า → ปิดบิล → toast ปกติ ไม่มี toast แต้ม
6. **Trace:** Loyalty → tab สรุปแต้ม → กดประวัติของลูกค้า → modal แสดงรายการ "เพิ่มแต้ม N — sale #<id>"

### Lesson recorded
ไม่มี — pattern fire-and-forget + capture-before-reset + lazy import with cache-bust = pattern เดิมที่มีอยู่ในระบบ (postJournalForSale, line notify) แค่นำมา compose

---

## 5.43.48 (build 252) — 2026-05-19 🧹 Phase 90.13 — Loyalty history modal listener leak (Phase 90.11 audit B1)

### Bug shape
`modules/loyalty.js` → `showPointHistory(...)` ผูก `modal.addEventListener('click', ...)` ทุกครั้งที่ user เปิด modal ประวัติแต้ม. เปิด 10 ครั้ง = 10 listeners ซ้อนกันบน element เดียว. Action ด้านในเป็น idempotent (`display = 'none'`) → ปุ่มกดยังทำงาน, ไม่มี UX bug — แต่เป็น DOM listener leak จริง. ถ้า future refactor เพิ่ม logic ใน handler นี้ (เช่น analytics ping) จะยิง N ครั้ง

### Fix
- `renderLoyaltyPage` (L253-263) ผูก click-outside listener ครั้งเดียวพร้อม close-button binding ที่มีอยู่
- `showPointHistory` ตอนนี้แค่ `modal.style.display = 'block'` — ไม่ผูก listener อีก
- Comment ทั้งสองจุดอ้างถึง Phase 90.13 เพื่อให้ future maintainer เข้าใจ pattern

### Build sync
- `selfheal.js?v=252`, `main.js?v=252`, `boot.js?v=252`, `style.css?v=252`
- `data-app-build="252"` ใน index.html
- `sw.js` CACHE_NAME `v251` → `v252`
- `modules/settings/pages.js` Version `5.43.47` → `5.43.48`, build `251` → `252`

### Test
- เพิ่ม `tests/loyalty_history_modal_listener.test.js` — 4 source-level assertions:
  1. `showPointHistory` **ไม่** เรียก `modal.addEventListener` (strip comments ก่อนเช็ค กัน false positive จาก explainer)
  2. `renderLoyaltyPage` มี click listener บน `#loyalty-history-modal` พร้อม `e.target === this` gate (กัน child click ปิด modal)
  3. Handler ตั้ง `display = 'none'` หลัง guard
  4. Phase 89.23 close-button binding ยังอยู่ (scoped fix ไม่กระทบของเดิม)
- `npm run verify` ผ่านครบ: lint + 160 unit (เดิม 156 +4) + 11 e2e

### How to test (manual smoke)
1. Ctrl+Shift+R → version แสดง 5.43.48 (build 252)
2. หน้า Loyalty → tab "สรุปแต้ม" → กดดู history ของลูกค้าคนหนึ่ง → modal เปิด
3. ปิดด้วยปุ่ม ✕ → ปิดด้วยคลิกพื้นหลัง (overlay สีดำใส) → กดเปิด-ปิดสลับ ≥ 5 ครั้ง
4. เปิด DevTools → Elements → เลือก `#loyalty-history-modal` → Event Listeners panel → click ควรมี **1 listener** เท่านั้น (ไม่ใช่ N ตามจำนวนครั้งที่เปิด)
5. Verify ทุกการเปิด-ปิดยังทำงานปกติ (close button + คลิกพื้นหลัง + click ใน content ไม่ปิด)

### What's still deferred
- Manual tab role gate — product decision (sales granting/redeeming = store value), user ยังไม่ได้ขอ

---

## 5.43.47 (build 251) — 2026-05-19 🔐 Phase 90.12 — Loyalty settings save runtime admin guard (defense-in-depth)

### Goal
ปิด audit finding A1 จาก Phase 90.11 — save handler ของ loyalty settings ไม่มี runtime guard. UI gate ที่ render time (L230 `${isAdmin ? renderSettingsTab(...) : 'block message'}`) ป้องกัน non-admin เห็นปุ่มอยู่แล้ว แต่ถ้า:
- Role โดน downgrade กลางคัน → DOM ยังคงปุ่ม save พร้อม handler
- DevTools / extension inject click ตรงๆ
- Refactor ในอนาคตเผลอลบ render-time gate

→ handler เก่าจะยอม save ให้ (จนกว่า Supabase RLS จะ reject — แต่ user เห็น error toast แบบไม่เป็นมิตร)

### Change (`modules/loyalty.js`)
1. `renderLoyaltyPage` destructure: `requireAdmin: _requireAdmin` → `requireAdmin` (เลิก unused-prefix เพราะใช้แล้ว)
2. `renderSettingsTab` destructure: เพิ่ม `requireAdmin` รับจาก ctx
3. Save click handler บรรทัดแรก:
```js
if (!requireAdmin?.()) {
  if (showToast) showToast('สิทธิ์ไม่พอ — เฉพาะผู้ดูแลระบบเท่านั้น', 'error');
  return;
}
```

Real gate ยังเป็น Supabase RLS — ตัวนี้คือ defense-in-depth + ข้อความ refusal ที่ user-friendly แทน HTTP error

### Build sync
- `selfheal.js?v=251`, `main.js?v=251`, `boot.js?v=251`, `style.css?v=251`
- `data-app-build="251"` ใน index.html
- `sw.js` CACHE_NAME `v250` → `v251`
- `modules/settings/pages.js` Version `5.43.46` → `5.43.47`, build `250` → `251`

### Test
- เพิ่ม `tests/loyalty_settings_admin_guard.test.js` — 5 source-level assertions:
  1. `renderSettingsTab` destructure `requireAdmin` (ไม่ใช่ `_requireAdmin`)
  2. Save handler invoke `requireAdmin?.()` หรือ `requireAdmin()` (ไม่ใช่แค่ bare reference)
  3. Guard call site อยู่ก่อน `await window._appXhrPatch/_appXhrPost(...)` actual call (กัน "decoration, not enforcement")
  4. Guard branch มี `return` (early-return ไม่ใช่ fall-through)
  5. Refusal branch มี `showToast` (ไม่ silent)
- `npm run verify` ผ่านครบ: lint + 156 unit (เดิม 151 +5) + 11 e2e

### How to test (manual smoke)
1. Login เป็น admin → Loyalty → ตั้งค่า → แก้ค่า → กดบันทึก → toast "บันทึกการตั้งค่าสำเร็จ" (พฤติกรรมเดิม)
2. **Edge case test (เลียนแบบ DevTools injection):**
   - Login เป็น admin → เปิด Loyalty → ตั้งค่า tab
   - Console: `window.App.state.profile.role = 'sales'` (เลียนแบบ role downgrade กลางคัน)
   - กดบันทึก → ต้องได้ toast `สิทธิ์ไม่พอ — เฉพาะผู้ดูแลระบบเท่านั้น` + ไม่มี network request ออกไป
3. Login เป็น sales → Loyalty → ตั้งค่า tab → เห็น "เฉพาะผู้ดูแลระบบเท่านั้น" (render-time gate เดิมยังทำงาน — ไม่เห็นปุ่มด้วยซ้ำ)

### What's still deferred
- B1: history modal click-outside listener leak (`showPointHistory` L631) — low risk
- Manual tab role gate — product decision (sales granting/redeeming = store value), user ยังไม่ได้ขอ

---

## 5.43.46 (build 250) — 2026-05-19 🔄 Phase 90.11 — Update UX hardening (periodic + visibilitychange SW update)

### Goal
ลดโอกาส user ติด build เก่าตอนเปิดแอปทิ้งไว้นาน (เช่น cashier เปิดทั้งวัน). Update banner เดิมจะเด้งก็ต่อเมื่อมี `updatefound` event — ซึ่งจะ trigger เฉพาะตอนที่ browser ตัดสินใจ refetch sw.js หรือมี `reg.update()` call. ของเดิมเรียก `reg.update()` แค่ครั้งเดียวตอน register

### Change (`boot.js`)
เพิ่ม `startPeriodicUpdate(reg)` ที่เรียกจาก SW register `.then()` — ทำ 2 อย่าง:
1. `setInterval(() => reg.update(), 10 * 60 * 1000)` — ทุก 10 นาที
2. `document.addEventListener('visibilitychange', ...)` — เมื่อ tab กลับมา visible → `reg.update()`

ทั้ง 2 path **ไม่ reload เอง** — แค่ trigger SW update check. ถ้ามี build ใหม่ flow เดิม (`updatefound` → installed → `showUpdateBanner` → user คลิก "อัปเดตเลย" → SKIP_WAITING → controllerchange → reload) จะทำงานต่อ. User ที่กำลังพิมพ์อยู่ไม่โดน yank

### Edge cases handled
- `reg.update()` คืน Promise — wrapped ด้วย `.catch(() => {})` กัน uncaught rejection (offline, browser throttle, etc.)
- `visibilitychange` ยิงทั้งตอน hide + show — gated ด้วย `if (document.hidden) return` เพื่อ trigger เฉพาะตอนกลับมา visible

### Build sync
- `selfheal.js?v=250`, `main.js?v=250`, `boot.js?v=250`, `style.css?v=250`
- `data-app-build="250"` ใน index.html
- `sw.js` CACHE_NAME `v249` → `v250`
- `modules/settings/pages.js` Version `5.43.45` → `5.43.46`, build `249` → `250`

### Test
- เพิ่ม `tests/boot_periodic_sw_update.test.js` — 6 source-level assertion (interval scheduled, visibility gated, no reload, errors swallowed, wired in)
- `npm run verify` ผ่านครบ: lint clean + 151 unit + 11 e2e (รวม build version sync test ที่ validate 250 ทุก ?v=)

### How to test (manual smoke — บ่อยขึ้นจริงๆ ต้องรอเวลา)
1. Ctrl+Shift+R → version แสดง 5.43.46 (build 250)
2. เปิด DevTools → Application → Service Workers → ดู timestamp ของ "Last updated"
3. รอ ~10 นาที (หรือ Tab ออกไปทำอะไรอื่นแล้วกลับมา) → ดู Network tab จะเห็น GET sw.js ใหม่ + timestamp อัปเดต
4. ถ้ามี build ใหม่ระหว่างที่เปิดแอปทิ้งไว้ → banner "🔄 มีเวอร์ชันใหม่ — คลิกเพื่อใช้งาน" จะเด้ง โดยไม่ต้อง reload

### What this does NOT change
- Auto-reload behavior — ยังคง user-initiated เท่านั้น (กดปุ่มในแบนเนอร์ หรือ Settings → ตรวจหาอัปเดต)
- Manual update buttons ใน Settings ทำงานเหมือนเดิมครบ 3 ระดับ (check / hard refresh / nuke)
- Watch-for-update + SKIP_WAITING + controllerchange — unchanged

### Audit findings deferred (out of scope per user spec)
- Settings save runtime requireAdmin guard (defense-in-depth) — defer
- History modal listener leak — low risk, defer
- Manual tab role gate — product decision, awaiting user direction

---

## 5.43.45 (build 249) — 2026-05-19 🐛 Phase 90.10 — Loyalty customer_id type mismatch (bigint vs string)

### Symptom (manual smoke on build 248)
- Phase 90.9 fix verified: form ไม่ clear เมื่อ redeem fail ✓
- แต่ redeem ลูกค้า `jeerasuk` 100 แต้ม → ยัง toast `แต้มไม่พอแลก` ทั้งที่เพิ่งกด "เพิ่มแต้ม" ให้ลูกค้าคนเดียวกันสำเร็จก่อนหน้านี้

### Root cause
DB column `customers.id` = `bigint` (number ใน JS) แต่ `<select>.value` คืน **string เสมอ** (DOM API spec). `getCustomerPoints` ใช้ `===`:
```js
if (t.customer_id === customerId) { ... }  // 1 === "1" → false ตลอดกาล
```
→ `customerPoints.remaining` = 0 → "แต้มไม่พอแลก" ไม่ว่าจะมีแต้มจริงเท่าไหร่

อาการพ่วงที่ user อาจไม่ได้ report: summary tab + history modal ใช้ `customers.find(c => c.id === customerId)` แบบเดียวกัน → แสดง `ลูกค้า #N` แทนชื่อจริง

### Fix
แก้ 4 จุดใน `modules/loyalty.js` — cast `String(...)` ทั้งสองข้างของ `===`:
- L41 `getCustomerPoints` — comparison หลักที่ block redeem
- L302 summary tab `customers.find` — แสดงชื่อใน list
- L562 `showPointHistory` — แสดงชื่อใน modal title
- L566 `showPointHistory` — filter transactions

ไม่แตะ insert side (L81/128/526 ที่ทำ `customer_id: customerId`) เพราะ PostgREST coerce string → bigint อัตโนมัติ. JS strict equality เท่านั้นที่จุกจิก

### Build sync
- `selfheal.js?v=249`, `main.js?v=249`, `boot.js?v=249`, `style.css?v=249`
- `data-app-build="249"` ใน index.html
- `sw.js` CACHE_NAME `v248` → `v249`
- `modules/settings/pages.js` Version `5.43.44` → `5.43.45`, build `248` → `249`

### Test
- 145/145 unit tests pass
- Lint clean บนไฟล์ที่แก้

### How to test (manual smoke)
1. Ctrl+Shift+R → version แสดง 5.43.45 (build 249)
2. หน้า สะสมแต้ม → tab "สรุปแต้ม"
   - ✅ Expected: ลูกค้าที่มีแต้มแสดง **ชื่อจริง** (เช่น "jeerasuk") ไม่ใช่ `ลูกค้า #N`
3. tab "เพิ่ม/แลกแต้มด้วยตนเอง" → เลือก `jeerasuk` + "แลกแต้ม" + ใส่จำนวน ≤ ที่มี + บันทึก
   - ✅ Expected: toast `แลกแต้ม N แต้ม สำเร็จ` + ฟอร์ม clear + summary refresh
   - ❌ Build 248 ก่อนหน้า: toast `แต้มไม่พอแลก` (false negative)
4. กดดู history ของลูกค้าใน summary tab → ✅ modal แสดงรายการ earn/redeem ครบ + title แสดงชื่อจริง

### Lesson
DOM `<select>.value` คืน `string` เสมอ. ถ้า DB column เป็น `bigint` → `===` จะ false ตลอด. Cast `String(...)` ที่จุด compare ทั้งสองข้าง (cast ที่ boundary เสี่ยงพลาดเพราะมีหลาย boundary: DOM, JSON, Object.entries)

---

## 5.43.44 (build 248) — 2026-05-19 🐛 Phase 90.9 — Loyalty manual redeem regression (form clears on failure)

### Symptom (manual smoke on build 247)
1. หน้า สะสมแต้ม → แท็บ "เพิ่ม/แลกแต้มด้วยตนเอง"
2. เลือกลูกค้า `jeerasuk` (มี 0 แต้ม) + เลือก "แลกแต้ม" + ใส่ 100
3. กดบันทึก → toast `แต้มไม่พอแลก` (ถูกต้อง) แต่ ฟอร์ม clear customer + points (ผิด — user ต้องเลือก/พิมพ์ใหม่)

### Root cause (regression จาก 90.8)
Phase 90.8 ทำ `redeemPoints` เป็น `async` แล้วใส่ `await` ที่ manual handler. แต่ `redeemPoints` early-return paths (`!is_active`, `points < min_redeem`, `points > remaining`) ยังคืน `void` — manual handler แยกผลสำเร็จ/ล้มเหลวไม่ได้ → `clear form` ทำงาน unconditional หลัง await

### Fix
- `earnPoints` + `redeemPoints` ทุก exit path คืน `{ok, error}` แบบเดียวกับ xhrPost
- Manual tab redeem branch: `const r = await redeemPoints(...); if (r?.ok) { clear form }`
- Manual tab earn branch ใช้ `r?.ok` ของ xhrPost อยู่แล้วตั้งแต่ 90.8 — pattern consistent

### Build sync
- `selfheal.js?v=248`, `main.js?v=248`, `boot.js?v=248`, `style.css?v=248`
- `data-app-build="248"` ใน index.html
- `sw.js` CACHE_NAME `v247` → `v248`
- `modules/settings/pages.js` Version `5.43.43` → `5.43.44`, build `247` → `248`

### Test
- 145/145 unit tests pass
- Lint clean

### How to test (manual smoke)
1. Hard refresh (Ctrl+Shift+R) → version แสดง 5.43.44 (build 248)
2. ไปหน้า สะสมแต้ม → แท็บ "เพิ่ม/แลกแต้มด้วยตนเอง"
3. เลือกลูกค้าที่มี 0 แต้ม + "แลกแต้ม" + ใส่ 100 + บันทึก
   - ✅ Expected: toast "แต้มไม่พอแลก" + **ฟอร์มเก็บค่าเดิม** (customer + points ยังอยู่)
   - ❌ ก่อนหน้า: toast บอกถูก แต่ฟอร์ม clear → user ต้องกรอกใหม่
4. เลือกลูกค้าที่มีแต้มพอ + ใส่จำนวนที่แลกได้ + บันทึก
   - ✅ Expected: toast "แลกแต้ม N แต้ม สำเร็จ" + ฟอร์ม clear
5. เลือก "เพิ่มแต้ม" + ใส่ 50 + บันทึก
   - ✅ Expected: toast "เพิ่มแต้ม 50 แต้มสำเร็จ" + ฟอร์ม clear (พฤติกรรมเดียวกับ 90.8)

### Lesson
Async refactor ต้อง revisit caller ทุกตัว — ไม่ใช่แค่เพิ่ม `await`. ถ้า caller ใช้ผลในเชิง UX (clear form, toast, navigation) ต้องเปลี่ยน return signature ของ callee ให้ caller แยกแยะได้

---

## 5.43.43 (build 247) — 2026-05-19 🐛 Phase 90.8 — Loyalty XHR helper signatures (audit + fix 3 sites)

### Audit
Phase 90.6 fix settings save แต่ใน `modules/loyalty.js` ยังมี 3 จุดใช้ signature เก่า — เกรปด้วย `_appXhr*` เจอ pattern เดียวกัน:
- `earnPoints()` line 89 — dead code (ไม่มี caller) แต่ fix ไว้กัน future trap
- `redeemPoints()` line 133 — LIVE (เรียกจาก Manual tab)
- Manual-earn click handler line 528 — LIVE

### Bug
ทั้ง 3 จุดเรียก `window._appXhrPost('/api/loyalty-points', rec, callback)` ซึ่งผิด 2 ชั้น:
1. arg 1 ต้องเป็นชื่อตาราง Supabase — `xhrPost` ต่อ URL เป็น `<sb>/rest/v1/<arg1>` → `/rest/v1//api/loyalty-points` = 404
2. arg 3 คือ `opts = {}` ไม่ใช่ callback — `xhrPost` คืน Promise → callback ที่ส่งไปไม่เคยถูกเรียก → ไม่มี toast / ไม่ reload

### Fix
ทั้ง 3 จุดเปลี่ยนเป็น pattern เดียวกับ Phase 90.6 (`loyalty.js:437-440`):
```js
const r = await window._appXhrPost('loyalty_points', newRecord);
if (r?.ok) { showToast?.(...); loadAllData?.(); }
else { showToast?.('...ล้มเหลว: ' + r?.error?.message, 'error'); }
```
- `earnPoints` + `redeemPoints` ทั้งสอง export กลายเป็น `async`
- Manual-earn click listener กลายเป็น `async function`

### Build sync
- `selfheal.js?v=247`, `main.js?v=247`, `boot.js?v=247`, `style.css?v=247`
- `data-app-build="247"` ใน index.html
- `sw.js` CACHE_NAME `v246` → `v247`
- `modules/settings/pages.js` Version `5.43.42` → `5.43.43`, build `246` → `247`

### Test
- 145/145 unit tests pass (ไม่มี test ใหม่ — signature fix ตรงๆ, ใช้ pattern ที่ existing tests cover)
- Lint clean บนไฟล์ที่แก้

### How to test (manual smoke)
1. Hard refresh (Ctrl+Shift+R) → version แสดง 5.43.43 (build 247)
2. ไปหน้า สะสมแต้ม → แท็บ "เพิ่ม/แลกแต้มด้วยตนเอง"
3. เลือกลูกค้า + เลือก "เพิ่มแต้ม" + ใส่จำนวน + กดบันทึก → ต้องเห็น toast "เพิ่มแต้ม N แต้มสำเร็จ" + ตารางใต้จะ refresh
4. ทำซ้ำ เลือก "แลกแต้ม" → toast "แลกแต้ม N แต้ม สำเร็จ"
5. ถ้า error → toast จะบอก reason จาก Supabase (ก่อนหน้านี้เงียบสนิท)

### Feature gap flagged (out-of-scope)
`earnPoints()` export แล้วไม่มี caller ใน repo — POS checkout ไม่ auto-earn loyalty points แม้ schema/UI พร้อม. ดู HANDOFF.md Phase 90.8 section

---

## 5.43.35 (build 239) — 2026-05-15 🐛 Phase 89.29 — JV gaps fix (audit C2+C3+C4)

### Audit findings (Critical)
3 ช่องโหว่บัญชีที่ทำให้ Balance Sheet / P&L ไม่ตรง DB:

| # | จุด | บัค | ผลกระทบ |
|---|----|-----|--------|
| **C2** | `credit_tracker.js:248-276` | รับชำระลูกหนี้ → ไม่ post JV | A/R ใน BS ค้างถาวร, ลูกหนี้ไม่ตัด |
| **C3** | `refunds.js:343-410` | บันทึก refund → ไม่ post JV | รายได้ใน P&L เกินจริง (ไม่หักยอดคืน) |
| **C4** | `expenses.js:522-526` | แก้รายจ่าย (PATCH) → ไม่ void+repost JV | P&L ไม่ตรง DB ทุกครั้งที่แก้ amount |

### SQL migration ต้องรัน (ที่ Supabase Dashboard SQL Editor)
**`supabase-phase89-29-jv-gaps.sql`** — ก่อน deploy build 239
- Seed account `4110` "รับคืนสินค้า/ส่วนลดจ่าย" (contra-revenue)
- Seed mapping `refund_cash` (Dr 4110 / Cr 1110)
- Seed mapping `refund_transfer` (Dr 4110 / Cr 1130)
- Note: `credit_payment` reuse `receipt_payment`/`receipt_transfer` (Dr Cash/Bank / Cr 1200) — ไม่ต้องเพิ่ม mapping

### New auto_post functions
- **[modules/accounting/auto_post.js](modules/accounting/auto_post.js)** — เพิ่ม 2 functions:
  - `postJournalForCreditPayment(payment)` — Dr 1110/1130 / Cr 1200 (ตัด A/R)
  - `postJournalForRefund(refund)` — Dr 4110 / Cr 1110/1130

### Module changes
- **`modules/credit_tracker.js:250-300`** — INSERT credit_payments ใช้ `return=representation` → call `postJournalForCreditPayment` หลัง PATCH sales สำเร็จ. + Audit M1 fix: เช็ค `r.ok` ทั้ง step 1 และ step 2 → กัน DB inconsistent
- **`modules/refunds.js:377-415`** — INSERT refunds ใช้ `return=representation` → call `postJournalForRefund` หลัง insert + restock
- **`modules/expenses.js:522-535`** — Edit expense: void JV เดิม (`voidJvForSource("expenses", id)`) → PATCH → repost JV ด้วย payload ใหม่. Same pattern as sale soft-delete

### Test
- **87/87 pass** (เดิม + ไม่ break)
- New JV functions follow existing pattern (`postJournalForReceipt`, `postJournalForExpense`) — pattern test coverage shared

### ผลกระทบ user
- ✅ **Balance Sheet ลูกหนี้ตรงจริง** หลังรับชำระ — A/R ลดลงตามยอดเก็บ
- ✅ **P&L ตรงจริง** หลังคืนเงิน — รายได้ขาย หัก ยอดคืน = ยอดสุทธิ
- ✅ **แก้รายจ่าย** ไม่ทำให้ P&L เพี้ยน — JV ใหม่แทน JV เก่า
- ✅ Trial Balance / Profit & Loss / Balance Sheet สอดคล้อง DB หลัง deploy

### Smoke test หลัง deploy
1. **C2:** ขายเครดิต ฿1,000 → รับชำระบางส่วน ฿400 → เปิด accounting/journals → ต้องมี JV RV ใหม่ Dr 1110 ฿400 / Cr 1200 ฿400
2. **C3:** บันทึก refund ฿200 → เปิด journals → ต้องมี JV Dr 4110 ฿200 / Cr 1110 ฿200
3. **C4:** เพิ่มรายจ่าย ฿500 → แก้เป็น ฿700 → เปิด journals → JV เดิม ฿500 หาย, JV ใหม่ ฿700 มา
4. Trial Balance สมดุล (Dr = Cr) ทุกกรณี

### Audit ที่ยังเหลือ
- **High:** H1/H2/H3 XSS + H5 doc_no race + H6 lazy + H7 service close JV
- **Med/Low:** M1 (done!), M2 birthdays TZ, M3 stock CAS, M4 dead_stock TZ, S5-S8 + 4 รายการ
- **SQL pending:** `phase89-25` (RLS) + `phase89-26` (audit) + `phase89-29` (this) ต้องรันที่ Supabase

---

## 5.43.34 (build 238) — 2026-05-15 🐛 Phase 89.28 — Dashboard TZ fix (audit M4)

### User-visible bug
หน้า "ภาพรวมบริษัท" แสดง **"วันนี้ขายได้ ฿0.00 จาก 0 ออเดอร์"** ทั้งที่หน้าแคชเชียร์เห็น **฿65 จาก 3 บิล** (เวลา 06:28-06:37 BKK)

### Root cause
`created_at` ใน DB เป็น **timestamptz UTC**. POS home ใช้ `Date.toDateString()` (TZ-aware) → ✅ ส่วน dashboard ใช้ `created_at.slice(0,10)` → ได้ UTC date string. บิลตอน 06:37 BKK = 23:37 UTC วันก่อน → slice ได้ "2026-05-14" แต่ `todayKey()` (browser local BKK) = "2026-05-15" → ไม่ match → ฿0.

ตรงกับ audit **M4** ที่ flag ไว้: "modules/dashboard.js:23,184-195,243-244,270 ใช้ slice(0,10) เป็น 'today' เทียบ created_at (UTC) → ช่วง 17:00-23:59 BKK วันนี้แสดงผิด"

### Fix
- [modules/dashboard.js](modules/dashboard.js) — ใช้ `dateBkk(x.created_at)` จาก utils.js แทน `slice(0,10)` ทุกจุดที่เทียบ `created_at`/`scheduled_at` กับ "today"/"period" key
- 12 จุดในไฟล์ครอบคลุม: `_renderTodayAndAlerts`, `filterByPeriod`, `filterByMonths`, hero todaySales/todayWebOrders, monthSales, recentSales, panel bucket filters (revenueBar, paymentBar, jobStatus), chart 12-month, daily summary timer, `_last7DaysSeries`, `monthsAgoKey`, `buildTimeBuckets`
- `todayKey()` + `weekAgoKey()` แก้ให้ delegate ไป `todayBkk()`/`dateBkk()` — กันบราวเซอร์ที่ TZ ไม่ใช่ BKK (เดิมพึ่ง `toLocaleDateString("en-CA")` ที่ใช้ local TZ ของ browser)

### Test
- **87/87 pass** (87 = 79 + 8 ใหม่ใน `tests/tz_today_filter.test.js`)
- Cover: 06:37 BKK boundary case, 17:00 UTC boundary, midnight UTC, null/invalid, Date object input, regression vs old logic (assert old logic returns 0 sales, new returns 3)

### ผลกระทบ user
- ✅ Dashboard hero "วันนี้ขายได้" ตรงกับ POS แคชเชียร์
- ✅ Sparkline 7d / chart 12-month / period stats / panel bucket = ใช้ BKK day grouping ทั้งหมด
- ✅ Service jobs "วันนี้และที่ต้องดู" ตรงกับ scheduled day จริง (BKK)
- ✅ Daily summary LINE notify ที่ admin trigger 22:00 ใช้ BKK day

### Audit ที่ยังเหลือ
- C2/C3/C4 (JV gaps), H1/H2/H3 XSS, H5 race, H6 lazy, H7 service close JV, M1/M2/M3 + 10 รายการ
- SQL `phase89-25` + `phase89-26` ยังต้องรันที่ Supabase

### Smoke test
1. **Admin** → ภาพรวมบริษัท → "วันนี้ขายได้" ต้อง = ที่ POS เห็น
2. ทำขาย 1 บิลตอน 23:30 BKK (16:30 UTC) → refresh dashboard → ยังคงนับเป็นวันนั้น (ไม่ใช่วันถัดไป)
3. ทำขายตอน 06:00 BKK → dashboard hero ขึ้นเป็นยอดวันนี้ทันที (เดิม 00:00-06:59 BKK แสดงเป็นยอดเมื่อวาน)

---

## 5.43.33 (build 237) — 2026-05-15 🐛 Phase 89.27 — Sales filter completeness (C1+H4 audit fix)

### Audit findings (3-agent parallel review)
หลังรัน multi-angle audit เจอ **C1 Critical** (Phase 89.24 filter ไม่ทำงานจริง) + **H4 High** (4 หน้า report เห็นยอดของคนอื่น)

### C1: Phase 89.24 filter ค้ำเพดาน .limit(50)
- **Bug:** [main.js:1450](main.js:1450) ดึง 50 sales ล่าสุดของทุก user → client filter `created_by === myId` ตัดทีหลัง → ช่วงร้านยุ่ง 50 rows ของ admin/คนอื่นเต็มหน้าต่าง → ช่าง/sales เห็น **"วันนี้ขายได้ ฿0"** ทั้งที่ขายได้จริง
- **Fix:** server-side filter — non-admin → `.or("created_by.eq.<myId>,created_by.is.null")` ที่ Supabase query → ส่ง 50 rows ของตัวเอง (+ legacy NULL) มาแน่นอน
- Banner "เฉพาะของคุณ" ยังคงเหมือนเดิม (ทั้ง POS home + sales list)

### H4: 4 หน้า report ยังไม่ filter ตาม 89.24
- **dashboard.js** — hero "วันนี้ขายได้", overdueCredit, sparkline 7d, main chart
- **profit_report.js** — salesInRange + monthly activeSales
- **top_customers.js** — ranking by customer
- **sales_heatmap.js** — day×hour matrix
- **Fix:** ทุกจุดเรียก `visibleSalesForRole(sales, profile, currentUser)` (helper ใหม่ใน utils.js)

### Helper — `visibleSalesForRole(sales, profile, currentUser)`
- **[modules/utils.js](modules/utils.js)** — extract logic + central place
- Idempotent บน server-filtered data (defense-in-depth)
- ตรงกับ Phase 89.24 semantics: legacy NULL `created_by` ยังเห็นได้ (admin/non-admin)
- 8 unit tests ใน `tests/sales_filter.test.js`

### Daily summary LINE notify → admin-only
- [modules/dashboard.js:1101](modules/dashboard.js:1101) `setupDailySummaryTimer` — เพิ่ม guard `if (!isAdmin) return;`
- ป้องกัน sales role ที่ login ตอน 22:00 ส่งสรุปยอด LINE ที่มีแค่ data ของตัวเอง (ลวง)

### Test
- **79/79 pass** (เดิม 71 + 8 ใหม่จาก sales_filter.test.js)
- Cover: admin/sales/technician roles, NULL created_by, mismatch, idempotency

### ผลกระทบ user
- ✅ ช่าง/sales เห็นยอด "วันนี้ขายได้" ตรงตามจริง — ไม่ขึ้น ฿0 ลวง
- ✅ Dashboard hero แสดง badge "เฉพาะของคุณ" ตอน non-admin
- ✅ Profit report / Top customers / Sales heatmap ตอน sales role = personal performance
- ✅ Admin ไม่เปลี่ยน — ยังเห็นรวมทุกคนเหมือนเดิม

### Smoke test หลัง deploy
1. **Login as admin** → Dashboard → hero ไม่มี badge "เฉพาะของคุณ" → "วันนี้ขายได้" = ทุกคน
2. **Login as ช่าง** (technician) → POS home → "เฉพาะของคุณ" badge → ยอด = ของตัวเอง (ลอง check ใน ครั้งที่ admin1 ใช้ build 236 เห็น ฿0)
3. **Login as sales** → Dashboard → hero "เฉพาะของคุณ" + Profit report = ของตัวเองเท่านั้น
4. **22:00 sales user logged in** → ไม่ส่ง LINE summary (admin เท่านั้น)
5. Network tab — `?or=(created_by.eq...,created_by.is.null)` ใน sales query ตอน non-admin

---

## 5.43.32 — Audit query (no build bump) — 2026-05-14 🔍 Phase 89.26 — Audit missing JVs

### Purpose
หลังรัน Phase 89.25 RLS fix แล้ว bills/expenses ใหม่จะลง JV ได้. **แต่ rows ที่ขายไปก่อนหน้าตอน RLS block อยู่ → JV ตกหล่น → P&L ขาด**

### File
**[supabase-phase89-26-audit-missing-jvs.sql](supabase-phase89-26-audit-missing-jvs.sql)** — read-only audit (4 queries)
1. **Count + revenue** ของ rows ที่ JV ขาด ทุก source (sales/expenses/receipts/delivery_invoices/service_jobs)
2. **Sample 20** sales ล่าสุดที่ตก JV — พร้อม `created_by` + role
3. **Sample 10** expenses ที่ตก
4. **Date range coverage** — earliest/latest missing → ใช้ตั้ง backfill range

### ⚠️ ไม่ได้ทำ SQL backfill (เพราะ Backfill UI ดีกว่า)
- **Backfill UI** ([modules/accounting/backfill.js](modules/accounting/backfill.js)) เรียก `postJournalForSale` ของ auto_post.js ตรง ๆ → ครอบ:
  - `account_mapping` config (cash/transfer → COA codes ต่างกัน)
  - `doc_no` sequence generation (SV202605####)
  - VAT inclusive/exclusive (Phase 88.21)
  - `period_locked` trigger check (Phase 88.19)
  - Balanced Dr=Cr check
- **Pure-SQL backfill** ต้อง replicate logic ทั้งหมด → high risk ของ subtle bug + drift

### Workflow แนะนำ
1. รัน Phase 89.25 RLS fix SQL → POS auto-post หาย 403
2. ลอง POS sale 1 บิลทดสอบ → console clean
3. รัน Phase 89.26 audit SQL → ดู count + date range ของ rows ที่ตก
4. **Login as admin** → Accounting → "Backfill JV ย้อนหลัง"
5. ติ๊ก source ที่ missing_count > 0 + ตั้ง date range
6. กด "ดูรายการที่จะ process" → preview → "เริ่ม Backfill"
7. รอ JV ถูกสร้าง (idempotent — รันซ้ำได้)
8. รัน audit SQL อีกครั้ง → ทุก count = 0
9. Accounting → Trial Balance / P&L → ตัวเลขกลับมาตรง

---

## 5.43.32 — DB migration (no build bump) — 2026-05-14 🩹 Phase 89.25 — Fix JV RLS for POS auto-post

### Bug จาก smoke test build 236
boonsuk admin1 (role: ช่าง) login → POS sale ฿10.00 → bill บันทึกได้, แต่ console error:
```
[auto_post] entry insert failed: HTTP 403
{"code":"42501","message":"new row violates row-level security policy for table journal_entries"}
```

### Root cause
- Phase 88.0 (`accounting-foundation.sql`) ตั้ง `je_admin` FOR ALL → admin เท่านั้น
- Phase 88.1a-fix (`hotfix-rls.sql`) ตั้งใจ split policy ให้ INSERT ผ่านได้ถ้ามี source_table+source_id
- **แต่ไฟล์ hotfix-rls.sql ไม่ได้รัน / ถูก revert / production ยังอยู่ที่ Phase 88.0**
- ผล: technician POS sale → JV insert ตก RLS → P&L ขาดยอด

### Fix
**[supabase-phase89-25-fix-je-rls-pos.sql](supabase-phase89-25-fix-je-rls-pos.sql)** — re-apply 88.1a-fix policy แบบ targeted + idempotent
- `journal_entries` — split: SELECT/UPDATE/DELETE admin-only, INSERT allow `source_table+source_id` (auto-post)
- `journal_lines` — split: เหมือนกัน + INSERT check EXISTS journal_entries source
- `account_mapping` — SELECT เปิด authenticated (client ต้องอ่าน mapping ก่อน decide debit/credit)
- `NOTIFY pgrst 'reload schema'` ปิดท้าย

### ⚠️ User action required (รัน 1 ครั้ง)
1. Supabase Dashboard → SQL Editor → paste `supabase-phase89-25-fix-je-rls-pos.sql` → Run
2. ตรวจ verify query ปลายไฟล์: ต้องได้ 10 rows (policies ที่ active)
3. ลอง POS sale อีกครั้ง (login as ช่าง) → console ไม่ควรมี HTTP 403 อีก
4. เช็คใน Accounting → สมุดรายวัน → JV ของ sale ใหม่ต้องโผล่

### Re-run safe
ทุก DROP ใช้ IF EXISTS — รันซ้ำได้ไม่ crash

### ผลกระทบ user
- ✅ Technician/sales role → POS auto-post JV ทำงาน → P&L ตรง
- ✅ Admin permissions ไม่เปลี่ยน
- ✅ Manual JV (no source) ยังจำกัด admin เหมือนเดิม

---

## 5.43.32 (build 236) — 2026-05-14 👤 Phase 89.24 — Non-admin sees own sales only

### User request
จากภาพ smoke test build 234 — admin1 (role: ช่าง) login → POS home แสดง "วันนี้ขายได้ ฿10.00" แต่ ฿10 นั่นเป็นของคนอื่นที่ test. user request: "หน้า staff ควรเห็นงานขายของหน้าตัวเอง แยกออกมา"

### Filter — เฉพาะ role ≠ admin
**[modules/pos.js](modules/pos.js)** — POS home banner ("วันนี้ขายได้")
- เดิม: `(state.sales).filter(s => !deleted && d.toDateString() === today)` → ทุก seller
- ใหม่: เพิ่ม `if (!isAdmin && myId && s.created_by && s.created_by !== myId) return false`
- + badge "เฉพาะของคุณ" บน label (non-admin เห็น)

**[modules/sales.js](modules/sales.js)** — Sales list page ("รายการขายล่าสุด")
- เดิม: filter เฉพาะ "[ลบแล้ว]"
- ใหม่: เพิ่มเงื่อนไข created_by === myId สำหรับ non-admin
- + badge "เฉพาะของคุณ" บน h3 (non-admin เห็น)

### Logic
- `isAdmin = state.profile?.role === "admin"` → ดูทุกคน
- `myId = state.currentUser?.id` → uuid ของ user ปัจจุบัน
- `s.created_by === myId` → filter (ใช้ String coerce กัน type mismatch)

### Test
- 71/71 pass — node syntax check ทั้ง 2 ไฟล์

### ผลกระทบ user
- ✅ Technician/sales login → POS home + Sales list เห็นเฉพาะของตัวเอง (ลด confusion)
- ✅ Admin ยังเห็นทุกคนเหมือนเดิม (ไม่กระทบ reports)
- ✅ Badge "เฉพาะของคุณ" บอกชัดว่าทำไมตัวเลขน้อยกว่าที่คิด
- ⚠️ Cash recon, Receipts, Delivery invoices, Profit report — **ไม่ filter** (เป็น business documents ต้อง pool รวม)

---

## 5.43.31 (build 235) — 2026-05-14 🧹 Phase 89.23 — Inline handler sweep iter #1

### Refactor — 13 inline `on*=` handlers → `addEventListener` (CSP M4 pre-req)
Convert event handlers from inline HTML attribute to programmatic binding (no behavior change):

**[loyalty.js](modules/loyalty.js)** — 1 handler
- history modal close (`id=loyalty-history-close`) — เลิก `onclick="document.getElementById(...).style.display='none'"`

**[staff.js](modules/staff.js)** — 4 handlers
- 4 × `<button class="staff-modal-close-btn">` — single `querySelectorAll` + addEventListener loop
- เลิก global `window.__staffCloseModal` (ใน edit modal + PIN modal)

**[auth.js](modules/auth.js)** — 3 handlers
- chip login/logout indicator (id=`__auth-chip-login` / `__auth-chip-logout`)
- "← เลือกคนอื่น" button (id=`__staff-list-back`)
- เลิก inline `onclick="window.__authLogout && window.__authLogout()"` pattern
- Bonus: escHtml ครอบ `staff.name` ใน chip render (defense-in-depth)

**[expenses.js](modules/expenses.js)** — 2 handlers
- AutoKey OCR error state — 2 × "← กลับ" button (id=`ak-back-btn-1`, `ak-back-btn-2`)

**[settings/store.js](modules/settings/store.js)** — 2 handlers
- "← ย้อนกลับ" + "ยกเลิก" → shared `navMain` handler

**[accounting/backfill.js](modules/accounting/backfill.js)** — 1 handler
- "📒 สมุดรายวัน" link (id=`bf-go-journals`)

**[accounting/opening_balance.js](modules/accounting/opening_balance.js)** — 2 handlers
- 2 × success-screen nav link (id=`ob-go-journals`, `ob-go-balance`)

### เหลือใน sweep รอบหน้า (ไม่กระทบ M4)
- 7 × `onerror="this.style.display='none'"` / `this.src='./icons/logo.svg'` — constant strings, ไม่มี interpolation, ไม่ block CSP M4 ถ้า declare `style-src` ผ่อนผัน
- 1 × `products.js:1329` — inside print preview popup (separate document context)

### Test
- 71/71 pass — node syntax check ผ่าน 7 ไฟล์

### ผลกระทบ user
- ✅ ฟังก์ชั่นเหมือนเดิม 100% — pure refactor
- ✅ ปลด CSP M4 path — เหลือแค่ const-only inline handlers + popup context

---

## docs (no build bump) — 2026-05-13 📚 Phase 89.22 — HANDOFF archive Phase 1-75

### Refactor — split HANDOFF.md (261 KB) into 2 files
- **[HANDOFF.md](HANDOFF.md)** (now 149 KB, -43%): keep Phase 80+ + reference sections (config, schema, gotchas, cheat sheet)
- **[HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)** (new, 123 KB): Phase 1 → 75 history (2,045 lines)
- Cross-link both ways

### ผลกระทบ
- ✅ ลด context load สำหรับ next session (active handoff = HANDOFF.md เท่านั้น)
- ✅ ไม่กระทบ runtime / build — pure doc reorg
- ✅ Phase history ยังครบ — แค่อยู่คนละไฟล์

---

## 5.43.30 (build 234) — 2026-05-13 ⚡ Phase 89.21 — Code-split iteration #2 (+25 modules, ~540KB extra)

### Refactor — extend LAZY_ROUTES table จาก 19 → 44 routes (pattern เดิมจาก 89.20)
**[main.js](main.js)** — เพิ่ม 25 routes ใน LAZY_ROUTES + ลบ 25 static imports + ลบ 25 dispatcher `if` lines

### Lazy modules ใหม่ (25 ตัว, ~540KB รวม)
**Admin reports + ops (10):**
- `receipts.js` (77KB), `delivery_invoices.js` (57KB), `expenses.js` (53KB)
- `profit_report.js`, `audit_log.js`, `departments.js`
- `payroll_overview.js`, `expense_overview.js`, `profit_by_product.js`, `quote_templates.js`

**Stock ops (5):** `stock_value`, `dead_stock`, `stock_count`, `stock_in_wizard`, `serials`

**Finance/customer (5):** `cash_recon`, `loyalty`, `recurring_expenses`, `credit_tracker`, `refunds`

**Reports (3):** `top_customers`, `sales_heatmap`, `calendar`

**Utility (2):** `btu_calculator`, `service_request`

### Eager modules ที่เหลือ (landing/boot-critical)
- `dashboard`, `pos`, `products`, `sales`, `customers`, `quotations`, `service_jobs`, `settings`
- `stock_movements` (operations frequent)
- `service_form` (SERVICE_TYPES used at module-eval)
- `tasks`, `birthdays`, `warranty_report` (boot-time check functions)
- `line_notify`, `permission_matrix`, `help_tutor`, `validators`, `auth`, `stock_cas`, `error_reporter` (shared infra)
- `accounting/auto_post.js` (used in POS checkout flow)

### Test
- 71/71 pass — node syntax check ✅
- ไม่มี stale render* identifiers

### ผลกระทบ user
- ✅ First load ลดเพิ่มอีก ~540KB (สะสมจาก 89.20 → ~1.1MB shifted off first-load)
- ✅ main.js shrink: 252KB → ประมาณ 70-80KB (estimated)
- ✅ Page เพิ่งเข้าครั้งแรก → +50-200ms loading; cache หลังจากนั้น

### Smoke test หลัง deploy
1. **Footer** เห็น `5.43.30 (build 234)`
2. **Network tab** — main.js?v=234 ขนาดเล็กกว่า 232 มาก (60-70% reduction expected)
3. **Eager routes** (dashboard/pos/products/sales) → ยังโหลดเร็วเหมือนเดิม
4. **Lazy routes** (เช่น receipts, expenses, calendar, cash_recon) → ครั้งแรก network show เอ็กซ์ตร้า request, ครั้งที่ 2 เร็ว

---

## 5.43.29 (build 233) — 2026-05-13 ⚡ Phase 89.20 — Code-split first-load (~550KB shifted to on-demand)

### Refactor — lazy-load admin/service-only page modules
**[main.js](main.js)** — 4 จุด:
1. ลบ static imports 18 modules (9 service+admin + 9 accounting)
2. เพิ่ม `_lazyMod` Map + `_lazyImport()` (cache promise per path — load ครั้งเดียวต่อ session)
3. เพิ่ม `LAZY_ROUTES` map + `_renderLazy()` dispatcher
4. `async showRoute()` + `if (await _renderLazy(route, ctx)) return;` ที่หัว dispatcher
5. Logout — `clearCustomerDashboardState` เรียกเฉพาะถ้า module loaded แล้ว (no force-load)

### Lazy modules (18 ตัว, ~550KB รวม)
**Service/Admin heavy (9):**
- `customer_dashboard.js` (72KB), `solar.js` (46KB), `ac_install.js` (77KB)
- `error_codes.js` (124KB), `error_codes_fridge.js` (35KB), `error_codes_washer.js` (34KB)
- `payroll.js` (46KB), `ai_sales.js` (66KB), `ac_shop.js` (44KB)

**Accounting (9):**
- `accounting/journals.js`, `journal_form.js`, `coa.js`, `backfill.js`
- `trial_balance.js`, `profit_loss.js`, `balance_sheet.js`, `opening_balance.js`
- `export_bundle.js`, `periods.js`
- (`auto_post.js` ยัง eager — ใช้ใน POS checkout flow)

### Test
- 71/71 pass — node syntax check ผ่าน
- ไม่มี stale render* references

### ผลกระทบ user
- ✅ First load ลด ~550KB JS (จาก 252KB main.js + 1.13MB modules → main bundle เล็กลง)
- ✅ Page transition ครั้งแรกของ lazy route → +50-200ms loading (browser cache หลังจากนั้น)
- ✅ ทุก route ครั้งที่ 2+ ใน session เร็วเท่าเดิม (promise cache)

### Smoke test หลัง deploy
1. กดเข้าหน้า "ใบงานช่าง → ข้อมูลรหัสช่าง (error codes)" — โหลดช้านิดครั้งแรก, เร็วครั้งต่อไป
2. กดเข้าหน้า "บัญชี → สมุดรายวัน" → ทุก accounting subpage โหลดเฉพาะตอนเข้า
3. Network tab — main.js?v=233 size ลดลง ~30-40% เทียบ build 232
4. Logout → ไม่มี error console

---

## 5.43.28 (build 232) — 2026-05-13 🔒 Phase 89.19 — M5 XSS hardening (products + staff)

### 2 จุด refactor — เลิกใช้ JS template injection ผ่าน inline HTML attribute
**products.js getProductAvatar** ([products.js:98-108](modules/products.js:98))
- เดิม: `onerror="this.style.display='none';this.parentElement.innerHTML='${escHtml(letter)}'..."` — JS string ภายใน HTML attribute ผ่าน `${escHtml(...)}` interpolation
  - single char ผ่าน escHtml ไม่ exploit ตรง ๆ แต่ pattern เปราะ (สามชั้น escape: JS-in-HTML-in-template)
  - block CSP M4 path (drop `script-src 'unsafe-inline'`)
- ใหม่: CSS layering — letter span absolute underneath, img absolute บนทับ. `onerror="this.remove()"` constant (no interpolation)
- [style.css:741+](style.css:741): เพิ่ม `.prod-avatar-img`, `.prod-avatar-letter`, `.prod-avatar-photo` overlay rules

**staff.js openChangePINModal** ([staff.js:355](modules/staff.js:355))
- เดิม: `onclick="window.__savePIN('${staffId}')"` — staffId จาก DB interpolate ลง inline JS
- ใหม่: `addEventListener('click', savePIN)` หลัง modal render — staffId capture ผ่าน closure, ไม่ต้อง global function

### Test
- 71/71 pass (no regression)

### ผลกระทบ user
- ✅ ปิด XSS surface ที่ HANDOFF backlog M5 ระบุไว้
- ✅ Avatar fallback ยังทำงานเหมือนเดิม (letter โผล่เมื่อ img โหลดไม่ขึ้น)
- ✅ ลด inline JS interpolation จุดเปราะ → ปูทาง CSP M4 (drop unsafe-inline)

---

## 5.43.27 (build 231) — 2026-05-13 🧪 Phase 89.18 — Audit batch + Test coverage hot-paths

### 3 bugs จาก full audit (4 ด้าน: security/correctness/architecture/performance)
**Refunds TZ filter** ([refunds.js:42-43](modules/refunds.js:42))
- เดิม: `d.toISOString()` UTC → filter 30 วันที่ปุ่ม "30 วัน" ตก ~7-14 ชม. ของวันต้นใน Asia/Bangkok
- Fix: ใช้ `addDaysBkk(-30) + 'T00:00:00%2B07:00'` — start-of-day BKK ตรง

**Loyalty history stored XSS** ([loyalty.js:563-571](modules/loyalty.js:563))
- เดิม: `t.note` + `t.ref_type` + `t.ref_id` interpolate ลง innerHTML โดยไม่ escape — note เป็น free text จาก staff
- Fix: ใช้ `escHtml()` ครอบทั้ง 3 fields

**Service Worker precache ขาด CSS** ([sw.js:7-13](sw.js:7))
- เดิม: precache แค่ `style.css` — offline ทำให้สไตล์ phase4 / doc-print หายหมด
- Fix: เพิ่ม `phase4-design-system.css`, `phase4-components.css`, `doc-print.css`, `boot.js`, `selfheal.js`, `manifest.json`

### Test
- 71/71 pass (+38 tests ใหม่ครอบ hot-paths)

### Test coverage hot-paths (Phase 4 ของ backlog)
**[tests/cash_recon.test.js](tests/cash_recon.test.js)** — 10 tests
- M3 TZ filter: late-night BKK sale (22:30, 00:30) ตรงวัน
- payment method classification (เงินสด / cash / transfer / โอน / บัตร)
- expense filter + null payment_method = cash legacy
- deleted-marker filter ([ลบแล้ว])
- amount string coercion

**[tests/auto_post.test.js](tests/auto_post.test.js)** — 13 tests
- M1 voidJvForSource silent-fail detection (RLS block → toast warn)
- pre-check resilience (network error ไม่ block DELETE)
- URL injection guard (sourceTable encoded)
- _isAfterEffective effective date guard (2026-05-01 cutoff)

**[tests/pos.test.js](tests/pos.test.js)** — 15 tests
- calcVAT inclusive/exclusive math (7%, 10%)
- VAT rounding drift (subtotal + vat === total)
- round2 edge: strings, null, NaN, negatives, float precision
- disabled VAT short-circuit

### Refactor (no behavior change)
- `cash_recon.js`: แตก `computeCashRecon()` pure helper ออกจาก renderCashReconPage — DOM render เรียก helper เดิม
- `auto_post.js`: export `_isAfterEffective`
- `pos.js`: export `round2`, `calcVAT`

### ผลกระทบ user
- ✅ Refund report "30 วัน" / "90 วัน" รวมข้อมูลครบช่วงต้นวัน
- ✅ ปิด stored XSS surface ใน loyalty history (note free text)
- ✅ Offline mode สไตล์ไม่พังอีก (PWA install ใช้งานได้จริง)
- ✅ Hot-path regression จะถูกจับโดย CI ก่อน ship (กัน Phase 89.13/89.16/89.17 repeat)

---

## 5.43.26 (build 230) — 2026-05-12 🛡️ Phase 89.17 — Reliability batch (M2 + M3 + L2)

### 3 bugs จาก audit
**M2 — `products.stock` CAS divergence** ([main.js:3200](main.js:3200))
- เดิม: ถ้า `warehouse_stock` CAS fail → ยังรัน `products.stock` CAS ต่อ → 2 fields diverge (warehouse=X, products=X-qty) → ขายซ้ำได้ + retry over-deduct
- Fix: `skipProductsCas = stocks.length > 0 && !dec.ok` → guard products CAS ถ้า warehouse fail (กัน divergence). กรณีไม่มี warehouse (legacy) ยังลด products เหมือนเดิม

**M3 — `cash_recon.js` filter TZ mismatch** ([cash_recon.js:42, 51](modules/cash_recon.js:42))
- เดิม: `String(s.created_at).slice(0,10) === _crDate` — `created_at` UTC vs `_crDate` BKK (Phase 89.9 fix) → ตอน 22:00-23:59 BKK ตก UTC วันก่อน → ขายเงินสดตกหายจาก cash recon
- Fix: ใช้ `dateBkk(timestamp)` helper จาก [utils.js](modules/utils.js) — แปลง timestamptz → BKK date ก่อน compare → ตรงทุก hour
- ครอบ sales + expenses (2 filters)

**L2 — `stock_cas.js` null === 0** ([stock_cas.js:52](modules/stock_cas.js:52))
- เดิม: `Number(rows[0][field] || 0)` → field=null treated as 0 → CAS PATCH `?field=eq.0` → DB null ไม่ match → retry forever → CAS contention error (false alarm)
- Fix: explicit `if (rawValue == null) return { ok:false, error: "...uninitialized" }` — fail fast แทน infinite retry

### Test
- 33/33 pass (existing tests). Null case for stock_cas ครอบโดย bad-args/row-not-found tests indirectly — สามารถเพิ่ม test เฉพาะ null ใน Phase 4 ทีหลัง

### ผลกระทบ user
- ✅ Stock fields (warehouse vs products) จะไม่ diverge อีก
- ✅ Cash reconciliation รวมยอดถูกแม้ขายช่วงดึก (22:00-23:59 BKK)
- ✅ ถ้า field null → user ได้ error ที่ชัดเจน + actionable แทน "CAS contention" สับสน

---

## 5.43.25 (build 229) — 2026-05-12 🚨 Phase 89.15b — Hotfix CSP regression + UI refresh bug

### 2 ปัญหาที่ user แจ้ง

**1. CSP block inline event handlers** (regression ของ M4 Phase 89.15 — build 226)
- Console: `Executing inline event handler violates CSP directive: script-src 'self' ...` (16 errors)
- Root cause: ผม drop `'unsafe-inline'` จาก `script-src` แต่ไม่ได้ inventory `onclick=...`, `onchange=...`, `onerror=...` ใน HTML strings ที่ JS modules render ผ่าน `innerHTML`/template literal
- ผล: ปุ่ม / handler บางตัวใน modules ใช้ไม่ได้ (silently blocked)

**2. UI refresh bug** — กดเก็บเงิน → DB + JV update ถูกต้อง แต่ status ค้าง "รออนุมัติ" ใน UI
- Root cause: [receipts.js](modules/receipts.js) — `ctx.loadAllData()` fire-and-forget (ไม่ await) → `renderReceiptsPage()` รันด้วย state เก่า → display stale
- User workaround เดิม: กด F5

### Fix
- **[_headers](_headers)** — restore `'unsafe-inline'` ใน `script-src` + `script-src-elem` (rollback M4) จนกว่าจะ refactor inline handlers ทั้งหมด
- **[modules/receipts.js](modules/receipts.js)** — 4 paths ของ status change (bulk cancel/delete + single primary/fallback) เปลี่ยน `.catch()` fire-and-forget → `try { await loadAllData() } catch` → render ด้วย state ใหม่
- Build bump 228 → 229 (4 sub-items)

### Implications + recovery plan สำหรับ M4
- M4 (drop unsafe-inline) **ยังไม่ complete** — ต้องเก็บไว้ทำใหม่หลัง refactor inline handlers
- เพิ่ม task ใหม่: "Inventory + refactor `on*=` HTML attributes ใน modules → `addEventListener`" (Phase 5 หรือก่อนนั้น)
- Grep target: `onclick=`, `onchange=`, `onerror=`, `onload=`, `oninput=`, `onsubmit=` ใน `modules/**/*.js`
- หลัง refactor + ทดสอบครบ — drop unsafe-inline ใหม่อย่าง confident

### Test plan
1. Ctrl+Shift+R → build 229
2. Console — ต้องไม่มี "CSP violation" สีแดงอีก
3. กดเก็บเงิน 1 ใบ → status เปลี่ยนเป็น "ชำระแล้ว" **ทันที** (ไม่ต้อง F5)
4. กดยกเลิกใบเสร็จ → status เปลี่ยนเป็น "ที่ยกเลิก" ทันที + ใบส่งสินค้ากลับ "รอดำเนินการ"

### ตามจริง — ผมขอโทษ
Phase 89.15 ผม drop unsafe-inline โดยไม่ inventory inline handlers ใน modules ก่อน → ผมก็เห็น 121 inline styles แล้วเตือนตัวเอง drop ของ style-src แต่ดันไม่ขยายไปคิด script-src ของ `on*=` event handlers (ที่กระจายมากกว่า inline `<script>` 2 จุด)

Lesson: ก่อน drop CSP keyword — ต้อง grep **ทุก pattern ที่ keyword นั้นอนุญาต** (inline script + inline event handler + inline style + javascript: URL) ไม่ใช่แค่จุด explicit ที่เห็น

---

## 5.43.24 (build 228) — 2026-05-12 💰 Phase 89.16 (M1) — voidJvForSource silent-fail detection (double-revenue risk)

### ปัญหา (จาก audit)
- `voidJvForSource()` ใน [auto_post.js](modules/accounting/auto_post.js) ใช้ใน 8 จุดทั่วแอป (cancel receipt/invoice/sale/service_job)
- ถ้า RLS DELETE policy block → Supabase ตอบ 2xx + array ว่าง → return 0 silent — function "ดู" เหมือนทำงานปกติ
- User เห็น "ยกเลิกเรียบร้อย" toast → แต่ JV ค้างใน sumud → **P&L นับรายได้ซ้ำ = double-revenue ใน accounting report**
- ผม audit รอบแรก (Phase 89.13) จับ `.catch()` dead code แต่ไม่ catch semantic ของ "return 0 silent fail"

### Fix
- **[modules/accounting/auto_post.js:83-138](modules/accounting/auto_post.js:83)** — `voidJvForSource()` refactor:
  - **Pre-check query** `journal_entries?source_table=X&source_id=Y&select=id` → expected count
  - **DELETE** เหมือนเดิม
  - **Detect silent fail:** ถ้า `expected > 0 && deleted === 0` → console.error + `showToast("⚠️ JV ของ X#Y ลบไม่ได้ (RLS อาจบล็อค) — กรุณาตรวจ P&L manually")`
  - **HTTP error:** ถ้า expected>0 + HTTP non-2xx → showToast + console.error
  - Backwards compat: return type ยังเป็น `number` (count of deleted rows) → 8 callers ไม่ต้อง refactor
- **Clean .catch() dead code** 3 จุด (voidJv ไม่ throw — handle ภายในตัว):
  - [modules/delivery_invoices.js:315](modules/delivery_invoices.js:315) (bulk cancel)
  - [modules/delivery_invoices.js:416](modules/delivery_invoices.js:416) (single cancel)
  - [modules/receipts.js:773](modules/receipts.js:773) (preview cancel)

### ผลกระทบต่อ user
- ❌ ของเดิม: cancel แล้วเห็น success — JV ค้าง — P&L รายงานรายได้ซ้ำเงียบๆ — ผิดบัญชี
- ✅ ใหม่: ถ้า RLS DELETE block → user เห็น toast แดง "⚠️ JV ลบไม่ได้ — ตรวจ P&L manually" + console.error → catch ปัญหาทันที

### Risk
- ปกติ DELETE policy ของ `journal_entries` ผ่านได้สำหรับ authenticated → trigger toast นี้ = sign ของ RLS misconfiguration (good signal)
- Pre-check เพิ่ม 1 round trip ต่อ cancel — overhead ~100-200ms (acceptable)

### Test plan
1. Ctrl+Shift+R → build 228
2. ออกใบเสร็จ + ยกเลิก → ดู console — ต้องเห็น `[auto_post] voided N JV(s) for receipts#X` (N = จำนวนจริง)
3. ถ้าเคยมี RLS issue → จะเห็น toast แดง + console.error แทน silent fail

---

## 5.43.23 (build 227) — 2026-05-12 🩹 Phase 89.15a — Hotfix: `window.APP_BUILD` ยัง undefined หลัง 89.15

### ปัญหา (user verify ใน Console)
- Phase 89.15 อ้างว่า fix `window.APP_BUILD` bug — แต่ `window.APP_BUILD` ใน Chrome console ยังเป็น `undefined`
- Root cause: `document.currentScript` ใน **async IIFE** อาจ return `null` ใน browser ที่ก่อน first-tick ของ async function เกิดขึ้น script tag ปัจจุบันอาจ "completed parsing" แล้ว → currentScript = null → `dataset.appBuild` = undefined → `parseInt(undefined||'0')` = 0 (แต่ใน edge case ผ่าน try/catch silent → window.APP_BUILD ยัง undefined)

### Fix
- [selfheal.js](selfheal.js) — แยก **sync APP_BUILD setter** ออกจาก async IIFE:
  - sync IIFE (top of file) — `document.currentScript || querySelector('script[data-app-build]')` → set `window.APP_BUILD` ทันทีตอน script load
  - async IIFE (cache recovery) — รันถัดมา + ใช้ `__APP_BUILD` ที่ sync part set ไว้แล้ว
- `querySelector` fallback = robust ต่อ browser ที่ currentScript flaky ใน async context

### Test plan
1. Ctrl+Shift+R
2. Console: `window.APP_BUILD` → ต้องเห็น **`227`** (ไม่ใช่ `undefined`)
3. Settings → "เกี่ยวกับระบบ" → build 227
4. (regression) cache recovery + SW banner ยังทำงาน

---

## 5.43.22 (build 226) — 2026-05-12 🔐 Phase 89.15 — CSP drop script-src `unsafe-inline` (M4) + bonus APP_BUILD global fix

### ปัญหา (จาก audit)
- **M4:** CSP `script-src 'unsafe-inline'` ยังอยู่ — ปิด unsafe-eval (89.10) + SRI (89.5) แล้ว แต่ inline script ยัง bypass injection protection ได้
- **Bonus bug ผมเจอตอนแก้ M4:** `window.APP_BUILD` ไม่เคย set จริง! `var APP_BUILD` ใน inline IIFE scoped function เท่านั้น → main.js:1288 + pages.js:195 อ่าน `window.APP_BUILD` ได้ `undefined` ตลอด → error_log `build` field = null เสมอ + backup `app_build` = null

### Fix
- **Externalize inline scripts** (2 จุด):
  - [selfheal.js](selfheal.js) (NEW) — cache recovery (Phase 35 logic) + set `window.APP_BUILD` global ทันที (อ่านจาก `data-app-build` ของ script tag)
  - [boot.js](boot.js) (NEW) — loading overlay + SW register + update banner (เดิมคือ inline block หลัง main.js)
- **[index.html](index.html)** — 2 inline `<script>...</script>` หายไป เหลือแค่ `src=` 4 ตัว (chart/jspdf/qr/xlsx CDN + selfheal/main/boot/ai-chat-widget local)
- **[_headers](_headers)** — CSP: drop `'unsafe-inline'` จาก `script-src` + `script-src-elem` (`style-src` ยัง keep — refactor 121 inline styles แยก task)
- **[modules/settings/pages.js](modules/settings/pages.js)** — แก้ bug: `typeof APP_BUILD !== "undefined" ? APP_BUILD : null` → `typeof window.APP_BUILD === "number" ? window.APP_BUILD : null` (consistent กับ main.js + ใช้ global ที่ selfheal.js set)

### ผลกระทบ
- ✅ XSS via inline `<script>` injection ปิดได้สมบูรณ์ (CSP enforce — browser block inline ไม่ว่าจะมี SQL injection หรือ DOM-based ก็ตาม)
- ✅ Error tracking มี `build` ที่ถูก — track regression ได้ตามเวอร์ชั่นจริง
- ✅ Backup config มี `app_build` ที่ถูก — รู้ว่า user ใช้ build ไหน import กลับ
- ⚠️ ถ้า selfheal.js หรือ boot.js โหลดช้า/ขัดข้อง → SW update banner + cache recovery จะ defer 200-500ms (acceptable trade-off)

### Test plan
1. Ctrl+Shift+R → DevTools Console ไม่มี CSP error
2. DevTools → Network → `selfheal.js?v=226` + `boot.js?v=226` ทั้งคู่ load 200 OK
3. Console: `window.APP_BUILD` ต้องเป็น `226` (ไม่ใช่ undefined)
4. Settings → "เกี่ยวกับระบบ" → build 226
5. (regression) PWA install + offline mode → ยัง work เพราะ SW จัดการ
6. (regression) ปุ่ม Service Worker update banner → ยังเด้งเมื่อมี build ใหม่

### Style-src refactor (M4 part 2) — defer
- `style-src 'unsafe-inline'` ยังอยู่ — refactor 121 inline `style="..."` ใน HTML strings + `.style.cssText` ทั้งหมด → จะทำใน batch แยก หลัง Phase 2-3-4 เสร็จ (มี test coverage แล้ว ปลอดภัยกว่าแก้)

---

## 5.43.21 (build 225) — 2026-05-12 🔒 Phase 89.14 — Security batch (M6+L4+M7)

### ปัญหา (จาก audit Phase 89.13)
- **M6**: `/api/parse-receipt` (Gemini OCR) + `/api/verify-slip` (SlipOK) **เปิด anon** ใครก็เรียกได้ → cost-abuse ผ่าน Gemini quota / SlipOK API
- **L4**: `error_log.url` เก็บ `window.location.href` ดิบ → `?token=`/`?code=` จาก share.html, reset-password, OTP fallback ลงทุก crash
- **M7**: `error_log` RLS anon `INSERT WITH CHECK (true)` → 50/session cap = client-side เท่านั้น → attacker spam ตรงผ่าน publishable key

### Fix
- **M6** — [functions/_middleware.js](functions/_middleware.js):
  - `REQUIRE_AUTH_ENDPOINTS` += `/api/parse-receipt`, `/api/verify-slip`
  - `RATE_LIMITS` += parse-receipt 10/min, verify-slip 20/min (กัน abuse แม้ login แล้ว)
- **L4** — [modules/error_reporter.js](modules/error_reporter.js):
  - `_redactUrl()` ตัด query string + hash ก่อน log (เก็บแค่ origin + pathname)
- **M7** — [modules/error_reporter.js](modules/error_reporter.js) + [functions/api/log-error.js](functions/api/log-error.js) (NEW):
  - POST ผ่าน `/api/log-error` proxy แทน Supabase REST direct
  - Proxy: rate limit 60/min/IP + validate shape + forward to Supabase
  - SQL migration ([supabase-phase89-14-error-log-rate-limit.sql](supabase-phase89-14-error-log-rate-limit.sql)) — DB trigger: global 500/min cap + per-fingerprint 100/hr cap (last line of defense ถ้า attacker bypass proxy)
- Tests updated: 33/33 pass — adjusted URL pattern + headers ตาม proxy interface

### Action required
**รัน SQL migration:** `supabase-phase89-14-error-log-rate-limit.sql` (PG trigger เพิ่ม)

### ผลกระทบ
- ❌ ปิด: anon ใช้ Gemini/SlipOK direct + direct spam error_log
- ✅ เปิด: staff login ใช้งานปกติ (transparent — error_reporter handle JWT pass-through)

---

## 5.43.20 (build 224) — 2026-05-12 🩹 Phase 89.13b — Hotfix: status="invoiced" ผิด enum (Phase 89.6 typo มาตั้งแต่ build 215)

### ปัญหา (user เจอตอน smoke test build 223)
- หลังกดยกเลิกใบเสร็จ → ใบส่งสินค้าใน UI แสดง status raw **"invoiced"** (ไม่ใช่ "รอดำเนินการ" ตามที่ Phase 89.6 ตั้งใจ)
- Root cause: `delivery_invoices.status` enum = `pending|delivered|receipted|cancelled|partial` ([modules/delivery_invoices.js:30-36](modules/delivery_invoices.js:30))
- **"invoiced" เป็นค่าของ `quotations.status` ไม่ใช่ `delivery_invoices.status`** — Phase 89.6 copy-paste ผิด table
- ผม (Phase 89.13) audit เจอ `.catch()` dead code แต่ไม่ verify enum value — propagate bug ต่อ
- รวม 9 จุดผิดใน receipts.js (6 code + 3 comments)

### Fix
- [modules/receipts.js](modules/receipts.js) — replace `"invoiced"` → `"pending"` ทั้ง 9 จุด (cancel/delete x 3 paths: bulk + single primary + single fallback + preview)
- **Migration SQL ที่ต้องรัน:** [supabase-phase89-13b-fix-invoiced-status.sql](supabase-phase89-13b-fix-invoiced-status.sql)
  ```sql
  UPDATE delivery_invoices SET status = 'pending' WHERE status = 'invoiced';
  ```
  → repair row เก่าที่ค้าง status="invoiced" จาก Phase 89.6/89.13 ทำให้ UI แสดง raw

### Action required by user
**ลำดับสำคัญ:**
1. รัน SQL migration ก่อน (Supabase Studio → SQL Editor → paste file content → run)
2. รอ deploy ของ commit นี้เสร็จ (~1-2 min)
3. Ctrl+Shift+R + verify build 224

### Lesson (เพิ่มใน memory แล้ว)
- ก่อน PATCH field enum → grep enum source-of-truth (`STATUS_LABELS` หรือ schema) เพื่อ verify ค่าตรงกัน
- ไม่ trust comment เก่า (`"invoiced" (รอดำเนินการ)`) — comment โกหก code ก็ผิด → ตาม source-of-truth ของ code/schema เสมอ

---

## 5.43.19 (build 223) — 2026-05-12 🔖 Phase 89.13a — Hotfix: `main.js?v=` cache-buster ค้างที่ 218

### ปัญหา
- หลัง deploy build 222 → user เปิด "ตรวจหาอัปเดต" เห็น **"build 218"** (แต่ footer/Settings เห็น 222)
- Root cause: [index.html:866](index.html:866) `<script src="./main.js?v=218">` ลืม bump ตั้งแต่ Phase 89.9 (build 218 → 222 = ค้าง 4 builds)
- "ตรวจหาอัปเดต" ใช้ `?v=` ใน script tag เป็น source-of-truth ของ update check — ไม่ใช่ APP_BUILD
- ผลข้างเคียง: หน้าจอ user ที่ใช้ SW เก่า ยัง resolve `main.js?v=218` จาก cache → ไม่โหลด JS ใหม่จริง

### Fix
- [index.html:866](index.html:866) `?v=218` → `?v=223`
- [index.html:817](index.html:817) APP_BUILD 222 → 223
- [sw.js:3](sw.js:3) CACHE_NAME v222 → v223
- [modules/settings/pages.js:25](modules/settings/pages.js:25) version 5.43.18/222 → 5.43.19/223

### Lesson (เพิ่มใน memory)
- bump build **4 จุด** ไม่ใช่ 3: APP_BUILD + sw.js cache + pages.js version + **`main.js?v=` ใน index.html**

---

## 5.43.18 (build 222) — 2026-05-12 🚑 Phase 89.13 — Critical regression fix batch (5 bugs)

### ปัญหา (พบจาก audit)
1. **`sw.js` CACHE_NAME ค้างที่ `v206`** ทั้งๆ ที่ live ที่ build 221 → user offline/Ctrl+R เสิร์ฟไฟล์เก่าจาก SW cache → bug fix หลัง build 207 ไม่ถึง user หลายคน
2. **Phase 89.6 cancel receipt → restore invoice ไม่ทำงานจริง** — `_appXhrPatch` return resolved promise (`{ok,error}`) เสมอ ไม่เคย reject → `.catch()` 3 จุดใน [receipts.js](modules/receipts.js) เป็น dead code → ถ้า RLS block PATCH `delivery_invoices` → receipt cancel ผ่าน แต่ invoice ค้าง `รับเงินแล้ว` เงียบๆ
3. **`error_reporter` dedup race + per-session cap leak** — `sent.add(fp)` + `stats.sent++` วางหลัง `await beforeSend` → 2 errors เดียวกัน fire พร้อมกันผ่าน `sent.has()` ก่อนทั้งคู่ → burst หลายสิบ POST ก่อน cap fire
4. **`beforeSend` throw → infinite loop** — payload=null + return ก่อน `sent.add()` → error เดิม trigger send() ซ้ำๆ
5. **JWT single-flight refresh ใช้ไม่ได้** — `_refreshInflight = null` ใน `finally` sync ก่อน promise resolve → concurrent 401 trigger refreshSession() พร้อมกัน → Supabase rate-limit/token race

### Fixes
- [sw.js:3](sw.js:3) — CACHE_NAME `v206` → `v222`
- [index.html:817](index.html:817) — APP_BUILD 221 → 222 (+ [modules/settings/pages.js:25](modules/settings/pages.js:25) version sync)
- [modules/error_reporter.js](modules/error_reporter.js) — ย้าย `sent.add(fp)` + `stats.sent++` ขึ้นก่อน `await beforeSend` (fix race + throw loop) + refund slot ถ้า filtered + lazy `build` (รับ function ได้) + check `r.ok` หลัง POST (4xx/RLS ไม่ silent)
- [modules/receipts.js](modules/receipts.js) — 3 จุด (bulk cancel + single cancel primary + single cancel fallback) เปลี่ยน `.catch()` → `await ... ; if (!ok) showToast + warn`
- [main.js:124](main.js:124) — `setTimeout(()=>{_refreshInflight=null}, 3000)` แทน sync clear ใน finally (absorb thundering herd 3s)

### ผลกระทบ user
- **กด Ctrl+Shift+R ครั้งเดียวหลัง deploy** — SW cache เก่าถูกลบ (CACHE_NAME เปลี่ยน) → ทุก browser โหลด build 222
- ใบเสร็จยกเลิก → ใบส่งสินค้ากลับสถานะ `รอดำเนินการ` ถูกต้องแล้ว (ของจริง — Phase 89.6 ที่อ้างว่า fix)
- Error tracking ไม่ spam ตอนเจอ infinite loop bug + RLS reject ใน error_log ไม่หายเงียบ
- JWT expire 1 ชม → refresh ครั้งเดียวต่อหน้าจอ (ก่อนหน้านี้อาจ 10+ ครั้ง)

### Test plan
- [ ] Ctrl+Shift+R → DevTools Application → Cache Storage เห็น `boonsook-pos-v5-cache-v222` เท่านั้น (v206 หาย)
- [ ] เปิด POS → footer/Settings เห็น "build 222"
- [ ] ออกใบเสร็จ → กดยกเลิก → เปิด tab "ใบส่งสินค้า" → status กลับเป็น "รอดำเนินการ"
- [ ] ทิ้ง POS เปิด >1 ชม. → กด refresh data → ไม่เห็น "Session หมดอายุ" หลายครั้ง
- [ ] (optional) Console: `errorReporter._stats()` → cap ทำงาน

---

## 5.43.17 (build 221) — 2026-05-12 📡 Phase 89.12 — Error tracking via Supabase `error_log` (homegrown, replaces Sentry)

### ปัญหาเดิม (audit finding)
- ไม่มี error tracking → user เจอ bug แล้วเรารู้ได้แค่ตอนเขาบ่น
- Sentry signup + DSN management = friction; app ไม่มี source-map (no build step) ทำให้ Sentry value หลักหาย → คุ้มน้อย
- มี Supabase อยู่แล้ว → เพิ่ม table ฟรี ไม่ต้อง vendor ใหม่

### Migration (`supabase-phase89-12-error-log.sql`)
- Table `error_log` — id / ts / severity (error|warning|info) / message / stack / source / url / user_id / user_agent / build / fingerprint / extra(jsonb)
- 4 indexes: ts DESC, severity, fingerprint, build
- RLS: anon+authenticated `INSERT` (errors เกิดก่อน login ได้), authenticated `SELECT` (UI admin filter เพิ่มในชั้น app)
- View `error_log_grouped` — aggregate by fingerprint (occurrences, first_seen, last_seen, affected_users)

### Module — `modules/error_reporter.js`
- `installErrorReporter({fetcher, supabaseUrl, anonKey, getAccessToken, getUserId, build, beforeSend, maxPerSession, logger, windowRef})`
- Hooks `window.error` + `window.unhandledrejection`
- **Dedup** ฝั่ง client (Set ต่อ session) — error ซ้ำ fingerprint เดียวกัน ส่งแค่ครั้งเดียว
- **Spam guard** — cap `maxPerSession` (default 50) → infinite-loop ไม่ flood DB
- **`beforeSend` hook** — filter ResizeObserver loop, Script error, Non-Error rejection noise + redact-friendly
- **Fire-and-forget POST** — fetch fail ไม่ throw, แค่ console.warn → reporter เองพังไม่ทำ POS ค้าง
- Truncate message≤2000, stack≤8000, source≤500, url≤1000, UA≤500 (defensive)
- API: `captureMessage()`, `captureException()`, `teardown()` (สำหรับ tests)

### Wired in `main.js:initSupabase`
- Install ทันทีหลัง SUPABASE_CONFIG verified — capture init errors ทัน
- inject `state.currentUser?.id` ผ่าน `getUserId` callback → token rotation ไม่ stale
- Filter known noise: ResizeObserver loop, Script error (CORS), Non-Error rejection

### Tests (17 cases — all passing; total suite now 33/33)
- Listener install/teardown
- Capture error event with stack/source
- Capture promise rejection (Error reason + plain-string reason)
- Dedup identical errors (same fingerprint → 1 send + 2 dedupped)
- Different errors NOT dedupped together
- maxPerSession cap (10 fired → 2 sent + 8 dropped)
- beforeSend null → drop
- beforeSend mutate → custom message sent
- beforeSend throw → drop + no crash
- POST shape (method, headers, Authorization, body fields)
- captureMessage / captureException manual API
- Network throw on POST → caught + warn
- Disabled config (missing url or anonKey) → no-op reporter, never fetches
- Truncation (5000-char message → 2000, 20000-char stack → 8000)
- accessToken fallback to anonKey when getAccessToken returns null
- Fingerprint stability across calls

### Test plan (manual smoke)
- หลัง deploy + `supabase-phase89-12-error-log.sql` รันแล้ว — เปิด console ใน POS → `throw new Error("test phase 89.12")` → ดูใน Supabase `select * from error_log_grouped order by last_seen desc limit 5;`
- POS ปกติทำงานต่อ — ไม่มี request ค้างหรือ slowdown

### Files
- `supabase-phase89-12-error-log.sql` (new — DDL + RLS + view, run แบบ manual ใน Supabase SQL editor)
- `modules/error_reporter.js` (new)
- `tests/error_reporter.test.js` (new, 17 cases)
- `main.js` (+ import + bootstrap call ใน initSupabase)
- `sw.js` `index.html` `modules/settings/pages.js` `package.json` `CHANGELOG.md` (build 220→221, cache v205→v206, version 5.43.16→5.43.17)

---

## 5.43.16 (build 220) — 2026-05-12 🧪 Phase 89.11 — Extract CAS to module + first unit tests (16 cases)

### ปัญหาเดิม (audit finding)
- `_atomicDecrementStock` (CAS logic ที่กัน race condition stock) อยู่ใน main.js god-object → ทดสอบไม่ได้
- ทั้ง repo **0 tests** → refactor ครั้งหน้าอาจพังเงียบ — CAS logic เป็น hot-path ทางการเงิน ถ้าพังคือขายเกินสต็อก

### Refactor
- **`modules/stock_cas.js`** (ใหม่) — pure function `atomicDecrementStock({fetcher, supabaseUrl, anonKey, accessToken, table, rowId, qty, field, maxRetries, logger})` รับ fetcher แบบ inject ได้ → unit test ไม่ต้องชน network
- **[main.js:3110](main.js:3110)** — เปลี่ยน `_atomicDecrementStock` เป็น **thin wrapper** (12 บรรทัด) ที่ delegate ไป module ใหม่ พร้อม inject `window.SUPABASE_CONFIG` + `window._sbAccessToken`
- **Behavior ไม่เปลี่ยน** — public API เดิม, _deductStockForSaleItem ใช้ได้เหมือนเดิม

### Tests (16 cases — all passing)
- Happy path: success on first attempt
- CAS retry: first PATCH loses (0 rows) → retry succeeds
- CAS contention: ทั้ง 3 attempts ล้มเหลว → return error
- Row not found (refetch returns [])
- Fetch HTTP error / PATCH HTTP error
- Network throw on fetch / on PATCH (try/catch coverage)
- Bad args (6 variants): null rowId, empty rowId, qty=0, negative qty, empty table, non-numeric qty
- Bad args: missing supabaseUrl / missing anonKey
- URL encoding: rowId มี special chars (spaces, quotes, &, =, /)
- Custom field: products.stock เหมือนกัน warehouse_stock
- accessToken fallback to anonKey when omitted
- PATCH body shape `{[field]: after}`
- PATCH WHERE clause มี `&{field}=eq.{before}` (essence ของ CAS)
- logger.warn called บน retry, **ไม่ใช่** บน success

### Infrastructure (ใหม่)
- **`package.json`** — `type: "module"`, `npm test` → `node --test tests/*.test.js` (zero dependencies)
- **`tests/stock_cas.test.js`** — 16 tests ใช้ Node built-in test runner (มาตั้งแต่ Node 20)
- **`.github/workflows/test.yml`** — รัน tests on every push to `main`/`claude/**` + PR to `main`

### Test plan (manual smoke)
- POS checkout ปกติ → stock ลด → ทำงานเหมือนเดิม
- `npm test` → 16/16 pass

### Files
- `modules/stock_cas.js` (new, 78 lines)
- `tests/stock_cas.test.js` (new, 215 lines)
- `package.json` (new)
- `.github/workflows/test.yml` (new)
- `main.js` (replace 50-line impl → 12-line wrapper + import)
- `sw.js` `index.html` `modules/settings/pages.js` `CHANGELOG.md` (build 219→220, cache v204→v205)

---

## 5.43.15 (build 219) — 2026-05-12 🔒 Phase 89.10 — Drop CSP `'unsafe-eval'` (security hardening)

### ปัญหาเดิม
- CSP `script-src` มี `'unsafe-eval'` → ถ้ามี XSS หลุด attacker สามารถใช้ `eval()` / `new Function()` แปลง string เป็น code ได้
- เป็น CRITICAL finding จาก audit Phase 89.10 (audit แอป)

### ตรวจสอบก่อนตัด
- `grep eval(` ทั้ง repo — **0 matches**
- `grep "new Function("` — **0 matches**
- `grep setTimeout/setInterval ที่รับ string` — **0 matches**
- `grep setAttribute('on...')` (event handler injection) — **0 matches**
- → codebase ไม่ได้ใช้ eval-like primitive เลย → ตัดออกได้สะอาด

### Fix
- [_headers:70](\_headers) — ลบ `'unsafe-eval'` ออกจาก `script-src`
- `script-src-elem` ไม่มี `unsafe-eval` อยู่แล้ว → ไม่ต้องแก้
- คง `'unsafe-inline'` ไว้ก่อน (ต้อง refactor inline scripts ใน index.html ก่อน — Phase ถัดไป)

### Test plan
- เปิดแอป → check console **ห้ามมี** `Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source`
- ทดสอบ feature ที่ใช้ CDN libs: Chart (dashboard), jsPDF (export PDF), html5-qrcode (สแกน), SheetJS (export Excel), JsBarcode (พิมพ์บาร์โค้ด) — ทุกตัวต้องทำงานปกติ
- ถ้าฝั่ง CDN lib ใดใช้ eval ภายใน → จะ fail loud → revert ได้ทันที

### Files
- `_headers` (CSP tightening)
- `sw.js` `index.html` `modules/settings/pages.js` (build 218→219, cache v203→v204)

---

## 5.43.14 (build 218) — 2026-05-12 🔒 Phase 89.9 — Stabilization Sprint Batch 2 (H10 stock race + H11 cash_recon TZ)

ต่อจาก Phase 89.8 (Batch 1 — 10 blockers) → Batch 2 เก็บ HIGH ที่เหลือใน BUGS.md

### H10 — Stock decrement race condition (cached state → double-deduct)
- **ปัญหา:** `_deductStockForSaleItem` อ่าน `state.warehouseStock` (JS cache) → คำนวณ `before - qty` → `xhrPatch` ตรง
  - 2 checkout พร้อมกันบน device 2 เครื่อง: ทั้งคู่อ่าน `before = 10` → ทั้งคู่ PATCH `stock = 9` (ที่จริงควรเป็น 8) → **ขายเกินสต็อก**
- **Fix ([main.js:3110](main.js)):** เพิ่ม `_atomicDecrementStock(table, rowId, qty, field)` helper ใช้ **CAS** (Compare-And-Swap) pattern:
  1. Refetch ค่า `field` ปัจจุบันจาก DB (ไม่ trust cache)
  2. PATCH `?id=eq.X&{field}=eq.{before}` — atomic UPDATE WHERE บน PostgreSQL
  3. ถ้า return 0 rows → CAS ชน (มี writer อื่น) → retry สูงสุด 3 ครั้ง
  4. ใช้ทั้ง `warehouse_stock` และ `products` (ทั้ง 2 table มี race เหมือนกัน)
- **Trade-off:** ไม่ต้องเพิ่ม SQL function (ใช้ PostgREST conditional update) — atomic จริงผ่าน DB UPDATE WHERE

### H11 — Cash recon UTC date → "วันนี้" ก่อน 07:00 BKK = เมื่อวาน
- **ปัญหา:** `let _crDate = new Date().toISOString().slice(0,10)` คืน UTC date
  - 00:00–06:59 BKK (= 17:00–23:59 UTC ของวันก่อน) → tab "วันนี้" แสดง recon ของเมื่อวาน
- **Fix ([cash_recon.js:7,26,164,170](modules/cash_recon.js)):** import `todayBkk` + `dateBkk` from `utils.js` (มีอยู่จาก Phase 89.1) — แทน UTC slice ทั้ง 3 จุด:
  - Module init `_crDate`
  - ปุ่ม "วันนี้" handler
  - ปุ่ม "เมื่อวาน" handler

### Test plan
- **H10:** เปิด POS 2 tab → ขายสินค้าเดียวกันพร้อมกัน → ตรวจ `warehouse_stock.stock` ลด 2 หน่วยจริง (ไม่ใช่ 1)
- **H11:** ปรับเวลาเครื่องเป็น 02:00 BKK → เข้าหน้า cash recon → ดู `_crDate` = วันนี้ (ไม่ใช่เมื่อวาน)

### Files
- `main.js` (atomic CAS helper + refactor `_deductStockForSaleItem`)
- `modules/cash_recon.js` (3 จุด UTC → BKK)
- `index.html` `sw.js` `modules/settings/pages.js` (build bumps)

---

## 5.43.12 (build 216) — 2026-05-11 🎨 Phase 89.7 — Filter chip UX clarity

### ปัญหา (user รายงาน)
- User คลิก chip "ยกเลิก (0)" ในหน้าใบเสนอราคา → คิดว่าเป็นปุ่ม action → ใบเสนอราคา "หาย"
- จริงๆ ใบยังอยู่ครบ แค่ filter เปลี่ยน → empty state ทำให้สับสน

### Root cause
Chip "ยกเลิก" ดูเหมือนปุ่ม action — ซ้ำกับคำเดียวกันที่ใช้ใน dropdown ของแต่ละแถว

### Fix — 3 หน้าใช้ pattern เดียวกัน
- **quotations.js / delivery_invoices.js / receipts.js**:
  - เพิ่ม label "กรองตามสถานะ:" เหนือ chips (font 11px, สีเทา)
  - แต่ละ chip ใส่ emoji icon นำหน้า:
    - 📋 แสดงทั้งหมด
    - 🟡 รออนุมัติ / 🟡 รอดำเนินการ
    - ✅ ชำระแล้ว / ✅ อนุมัติแล้ว
    - 📦 ออกใบส่ง/ใบเสร็จแล้ว
    - 💰 เปิดใบเสร็จแล้ว
    - **❌ ที่ยกเลิก** ← เพิ่มคำ "ที่" + ไอคอน → ชัดว่าเป็น filter ไม่ใช่ action

### Test
- เปิด **ใบเสนอราคา/ใบส่งสินค้า/ใบเสร็จรับเงิน** → ดู label "กรองตามสถานะ:" + emoji
- คลิก "❌ ที่ยกเลิก" → filter ใบที่ status=cancelled (เหมือนเดิม แต่ชัดกว่า)

---

## 5.43.11 (build 215) — 2026-05-11 🔄 Phase 89.6 — Cancel receipt → restore invoice

### ปัญหา (user รายงาน)
- ยกเลิกใบเสร็จ RC20260511020 → ใบส่งสินค้า INV20260511780 ยังเป็น "เปิดใบเสร็จแล้ว"
- ลูกค้าไม่สามารถออกใบเสร็จใหม่ได้ → flow ค้าง

### Root cause
Phase 89.1 ผมใส่ `voidJvForSource("receipts")` ตอน cancel แต่**ลืม restore `delivery_invoices.status="invoiced"`**
Inconsistent กับ rcDeleteBtn (ลบ) ที่ restore อยู่แล้ว

### Fix — เพิ่ม restore invoice status ที่ 3 จุด cancel
- **Bulk cancel** ([receipts.js:357-363](modules/receipts.js:357))
- **Dropdown cancel** (XHR path + Supabase fallback path)
- **Preview cancel** ([receipts.js:768-771](modules/receipts.js:768))
- Toast message: "ยกเลิกใบเสร็จเรียบร้อย — ใบส่งสินค้ากลับเป็น 'รอดำเนินการ'"

### Test
1. สร้าง invoice → ออกใบเสร็จ → ยกเลิกใบเสร็จ (ดร็อปดาวน์ หรือ preview)
2. กลับไปที่ **ใบส่งสินค้า/ใบแจ้งหนี้** → invoice ต้องกลับเป็น "รอดำเนินการ"
3. กดออกใบเสร็จใหม่ได้

---

## 5.43.10 (build 214) — 2026-05-11 🔐 Phase 89.5 — CDN SRI (Subresource Integrity)

### ปัญหาเดิม
- CDN scripts ใน index.html ไม่มี SRI hash → ถ้า jsdelivr/unpkg/sheetjs ถูก compromise หรือ DNS poison → attacker แทรก script ที่ steal session/token ได้

### Fix
- เพิ่ม `integrity="sha384-..."` + `crossorigin="anonymous"` ให้ 5 CDN scripts ใน [index.html](index.html):
  - chart.js@4.4.7 UMD — `sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC`
  - jspdf@2.5.1 UMD — `sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk`
  - html5-qrcode@2.3.8 — `sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+`
  - xlsx@0.20.1 (SheetJS) — `sha384-QCIdq2UMVEoSRhR3ZWZwdz2/pivLowr+eokFMdYyukq7qI26VYRxFa4Nl6FKetmL`
  - jsbarcode@3.11.6 — `sha384-Kk5SjBOKprEnGfyBWfD2zROFd1Cu8kwOXxG2GIhYPcoDL2rBJS9P8Ud1ZMy4412a`
- Hashes computed via `curl <URL> | openssl dgst -sha384 -binary | openssl base64`
- ถ้า CDN content เปลี่ยน → browser refuse to execute → app เห็น `Chart is not defined` แต่ปลอดภัย (deny by default)

### Risk note
- ถ้าวันใดต้อง upgrade version ของ library → ต้อง regenerate hash + update integrity attribute (ไม่งั้น script จะไม่โหลด)
- ถ้า script ไม่โหลด → ดู Console: `Failed to find a valid digest in the 'integrity' attribute`

### Test
- Console ห้ามมี integrity error
- Chart ใน dashboard, PDF export, Excel export, barcode print, QR scanner ต้องทำงานปกติ

---

## 5.43.9 (build 213) — 2026-05-11 🛡️ Phase 89.4 — Hot-path coverage + double-click + round2

### Defensive batch — เน้นไม่ให้แอปพัง (ทำตอน user ไปทำงาน)

**1. แก้ log "will re-post" → "voided"**
- [auto_post.js:92](modules/accounting/auto_post.js:92) — log message ที่ misleading (พบตอนทดสอบ delete POS sale)
- เดิม: `voided 1 JV(s) for sales#126 (will re-post)`
- ใหม่: `voided 1 JV(s) for sales#126`

**2. Migrate raw `fetch()` → `window._appAuthFetch` ที่ critical write sites**
- `_authFetch()` helper ใน [auto_post.js](modules/accounting/auto_post.js) — 4 จุด: void JV, post entry, post lines, rollback entry
- `delivery_invoices.js` bulk delete + single delete — ใช้ `authFetch` (alias of `_appAuthFetch`)
- `receipts.js` bulk delete — เหมือนกัน
- **ผล:** ทุก critical write path ครอบ 401-retry-with-refresh (Phase 89.2d) — JWT expire ตอน accounting/cancel ก็จะ auto refresh ไม่ต้อง Ctrl+Shift+R

**3. Double-click guard เพิ่ม 4 ปุ่ม**
- `diBulkCancel`, `diBulkDelete` ใน delivery_invoices.js
- `rcBulkCancel`, `rcBulkDelete` ใน receipts.js
- Pattern: `if (btn.disabled) return; btn.disabled = true; btn.style.opacity = "0.6"` → render ใหม่ DOM cleanup

**4. `round2()` export กลาง + ใช้ใน quotations form**
- `utils.js` export `round2(n)` — single source
- `quotations.js:714` — `item.line_total = round2(qty * unit_price * (1 - discount/100))`
- pos.js ใช้ตัวเดียวกันได้ (จาก local helper ใน Phase 89.2)
- **ผล:** ใบเสนอราคา/ใบส่งสินค้า/ใบเสร็จ ไม่มี `0.30000000000000004` อีก

### ที่เก็บไว้
- ac_install/solar/service_form: line_total ยังไม่ round (low-traffic, ทำเป็น Phase ถัดไปได้)
- BANK_COA validate ที่ receipt/invoice: ไม่มี bank picker UI → ไม่จำเป็น

### Test (รอ deploy 213)
1. ลบใบส่งสินค้า/ใบเสร็จ bulk — กดรัวๆ → ปุ่มเทาทันที กด PATCH ครั้งเดียว
2. ใช้แอปจน JWT expire (1+ ชม.) → กดลบ/post JV → ต้องไม่ต้อง refresh เอง — มี toast ก็ต่อเมื่อ refresh fail
3. แก้ qty/price ใน line item ของใบเสนอราคา → line_total ต้องเป็น 2 ตำแหน่งทศนิยม

---

## 5.43.8 (build 212) — 2026-05-11 🗑️ Phase 89.3 — Delete POS sale ครบวงจร

### ปัญหาเดิม
- ปุ่ม "🗑️ ลบ" ใน [รายการขาย POS](modules/sales.js:137) ทำแค่ **soft-delete** (เปลี่ยน `sales.note = "[ลบแล้ว]..."`)
- ไม่ revert side effects → **P&L ยังเห็นรายได้ + stock ลดถาวร**
- ผลกระทบ: ลบบิล POS ฿600 → JV `Dr 1110 / Cr 4100 = ฿600` ยังลง → รายได้ในงบกำไรขาดทุนเพี้ยน

### Fix
- **`voidJvForSource("sales", saleId)`** ใน sales delete handler → JV หายจากสมุดรายวัน → P&L ถูกต้อง
- **`window._appRevertStockForSale({saleId, orderNo})`** ใน main.js — best-effort:
  - Query `sale_items` ของบิลที่ลบ
  - คืน `warehouse_stock += qty` (เลือก "บ้าน" ก่อน)
  - คืน `products.stock += qty` (legacy)
  - INSERT `stock_movements` type=`return_sale` qty=+ note="คืนสต็อกจากลบ POS..."
- **Toast แจ้งผล:** `"ลบรายการขายเรียบร้อย ✅ (JV 1 entry, คืนสต็อก 3 รายการ)"`
- Best-effort: ถ้า void/revert ล้มเหลว → warning toast + console.warn แต่ไม่ block soft-delete

### Test plan
1. POS → ขายของ ฿100 → checkout
2. เปิด **บัญชี → งบกำไรขาดทุน** → จดยอด 4100
3. ไป **งานขาย → รายการขาย POS** → กดลบบิล
4. Toast ต้องขึ้น "ลบรายการขายเรียบร้อย ✅ (JV 1 entry, คืนสต็อก 1 รายการ)"
5. กลับมา P&L → reload → 4100 **ลดลง ฿100**
6. ไป **คลัง → ประวัติเคลื่อนไหวสต็อก** → ต้องเห็น movement type="return_sale"

---

## 5.43.7 (build 211) — 2026-05-11 🔄 Phase 89.2d — Auto-refresh access token on 401

### ปัญหาที่เจอ
- User login เกิน 1 ชั่วโมง → Supabase JWT expire
- `window._sbAccessToken` ยังเก็บ token เก่า
- DELETE/PATCH/POST → return HTTP 401
- เดิม ต้อง `Ctrl+Shift+R` หรือ logout/login เพื่อ refresh — UX papercut

### Fix
- **`refreshAccessToken()`** ใน [main.js](main.js) — single-flight, parallel calls แชร์ promise เดียว
- **xhrPost / xhrPatch / xhrDelete** — เพิ่ม `_isRetry` flag → ถ้า 401 → refresh + retry ครั้งเดียว
- **`window._appAuthFetch()`** — global wrapper สำหรับ raw fetch sites (auto-inject headers + retry)
- **rcDeleteBtn** ใน [receipts.js](modules/receipts.js) — wrap raw fetch เป็น `_appAuthFetch`
- ถ้า refresh fail → toast "⚠️ Session หมดอายุ — กรุณา login ใหม่"

### Coverage
- ✅ ทุก call ผ่าน `window._appXhrPost/Patch/Delete` (modules มากกว่า 40+ จุด)
- ✅ Delete receipt ที่ user เพิ่งเจอ (Phase 89.2c)
- ⚠️ Raw fetch sites อื่นๆ ใน modules (เช่น auto_post.js, delivery_invoices.js) ยังไม่ wrap — สามารถ migrate เพิ่มทีหลังได้โดยเปลี่ยน `fetch(...)` → `window._appAuthFetch(...)`

### Test
- ใช้แอปต่อเนื่อง 1+ ชั่วโมง → ทำ insert/update/delete → ต้อง work เงียบ ๆ (มี toast แค่ถ้า refresh fail)
- Network tab: ตอน 401 → จะเห็น 2 requests (1st: 401, 2nd: 200 หลัง refresh)

---

## 5.43.6 (build 210) — 2026-05-11 🚑 Phase 89.2c — CSP connect-src CDN

### Root cause หลังจาก 209 ยังพัง:
- Service Worker [sw.js:110](sw.js:110) intercept CDN script request แล้วทำ `fetch()` เพื่อ cache
- Chrome enforces SW `fetch()` ต้องผ่าน document CSP `connect-src`
- CSP `connect-src` ผมใส่แค่ `'self' supabase esm.sh cloudflareinsights` — ไม่มี CDN domains → fetch fail → script unavailable → `Chart is not defined`

### Fix
- `_headers` CSP `connect-src` เพิ่ม: `https://cdn.jsdelivr.net`, `https://unpkg.com`, `https://cdn.sheetjs.com`, `https://static.cloudflareinsights.com`

### Test (รอ deploy 210 + hard reload)
- Console ห้ามมี `Fetch API cannot load https://cdn.jsdelivr.net/...`
- ห้ามมี `Chart is not defined`
- dashboard chart โหลดได้

---

## 5.43.5 (build 209) — 2026-05-11 🚑 Phase 89.2b — Hotfix CSP + Chart.js

### Critical hotfix หลัง deploy 208 พบ dashboard error
- **fix(CSP):** `_headers` — เพิ่ม `https://static.cloudflareinsights.com` ใน script-src + connect-src (Cloudflare Web Analytics beacon)
- **fix(CSP):** เพิ่ม `script-src-elem` directive ระบุชัด (CSP3 standard — browser fallback ไม่เสถียร)
- **fix(CSP):** `worker-src 'self' blob:` (กัน Chart.js/lib ที่สร้าง worker จาก blob URL)
- **fix(Chart.js):** [index.html:17](index.html:17) — เดิม `cdn.jsdelivr.net/npm/chart.js` ไม่ pin version → jsdelivr resolve เป็น CJS (`chart.cjs`) → `window.Chart` undefined → dashboard render crash
- **fix(Chart.js):** pin เป็น `chart.js@4.4.7/dist/chart.umd.min.js` (UMD bundle define global Chart)

### Test
- F12 Console → reload หน้า dashboard → ห้ามมี `Chart is not defined`
- ห้ามมี CSP violation สำหรับ `static.cloudflareinsights.com`

---

## 5.43.4 (build 208) — 2026-05-11 🛡️ Phase 89.2 — Defensive Fixes (Batch 1)

### 5 defensive fixes — low-risk เน้น stability
- **fix(auto_post):** JV orphan rollback — เดิม entry สร้างผ่าน แต่ lines fail = orphan JV → trial balance พังเงียบ ตอนนี้ DELETE entry เพื่อ rollback ([auto_post.js:223-243](modules/accounting/auto_post.js:223))
- **fix(auto_post):** BANK_COA regex tighten — `(?:^|[\s•])BANK_COA:(\d{4,5})(?=$|[\s•])` (anchor + word boundary) + validate กับ chart_of_accounts ก่อน override Dr account — ป้องกัน FK error เงียบ
- **fix(pos):** Float math — เพิ่ม `round2()` helper, ใช้กับ numpad sum + line_total + ทุก money field ใน salePayload → กัน `0.1+0.2 = 0.30000000000000004` เข้า DB
- **fix(backfill):** เปลี่ยน effective date จาก stale `2026-01-01` → `2026-05-01` ทั้งใน UI warning + cutoff logic (ตรงกับ Phase 88.18b)
- **fix(receipts):** Double-click guard ที่ปุ่ม "เก็บเงิน" + "ยกเลิก" ใน preview — กัน user double-tap = patch ซ้ำ/JV post ซ้ำ (มี DB unique index จับได้แล้ว แต่ป้องกัน UX confusing)

### Test plan
- POS: สั่งของ `0.1` + `0.2` (ถ้าทำได้) → ดู line_total = `0.30` (ไม่ใช่ `0.30000...4`)
- Cancel ใบเสร็จ → ดู P&L ลดลง + JV ถูก void
- Backfill UI: เปิดหน้าใหม่ → ต้องเห็น "Effective date 2026-05-01"
- กดปุ่มเก็บเงินใน receipt preview รัวๆ → patch ครั้งเดียว + JV 1 entry

---

## 5.43.3 (build 207) — 2026-05-11 🛡️ Phase 89.1 — Phase A Security & Critical Bug Sweep

### 🚨 Critical fixes (5 bugs ระดับบัญชี/ภาษี/ความปลอดภัย)
- **fix(POS auto-post):** เดิม `postJournalForSale()` รับแค่ 6 fields → Phase 88.20 (bank picker) + 88.21 (VAT split) พังเงียบ ทั้งที่ดู UI ผ่าน — แก้โดย spread `salePayload` ทั้งก้อนรวม `note`, `vat_amount`, `vat_rate`, `subtotal_before_vat`
- **fix(JV void on cancel):** ยกเลิกใบส่งสินค้า / ใบเสร็จ → JV เก่ายังลอย → P&L นับรายได้ซ้ำ — wire `voidJvForSource("delivery_invoices"|"receipts", id)` ทั้ง 5 จุด (bulk + dropdown + preview)
- **fix(timezone):** เพิ่ม `todayBkk()` + `dateBkk()` ใน utils.js — แทน `new Date().toISOString().slice(0,10)` (UTC) ใน auto_post / backfill / profit_loss / trial_balance / balance_sheet / journal_form / export_bundle เพื่อกัน 00:00–06:59 ลง doc_date เป็นเมื่อวาน
- **fix(XSS):** share.html — เปลี่ยน `onclick="window.open('${esc(url)}')"` (apostrophe-decode-in-attr gotcha) เป็น `data-photo-url` + delegated listener + `safeUrl()` (http/https only) + `safeTel()` (digit-only)
- **feat(security headers):** `_headers` — เพิ่ม CSP, HSTS, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy ครอบทุก path

### User actions required (สำคัญมาก!)
1. **ปิด `OTP_WEB_FALLBACK` ใน Cloudflare Pages env** — เดิม endpoint `/api/send-otp` คืน `devCode` ใน response → ใครรู้เบอร์ลูกค้าก็เข้าบัญชีได้
   → Cloudflare → Pages → boonsook-pos → Settings → Environment variables → ลบ `OTP_WEB_FALLBACK` หรือเปลี่ยนเป็น `false`
2. หลัง deploy → ทดสอบ POS ขายของจริง → ดู JV ต้องมี 3 บรรทัด (เปิด VAT) + Dr account ตรงธนาคารที่เลือก
3. ทดสอบ Cancel ใบเสร็จ → เปิด P&L → รายได้ต้องลดลง (JV ถูก void)

---

## 5.43.0 (build 204) — 2026-05-10 ⭐ Phase 88.21 — VAT Support MVP 📜

### Phase 88.21 — รองรับภาษีมูลค่าเพิ่ม (VAT 7%) — MVP
- **feat:** SQL — เพิ่ม COA + mapping + columns
  - COA `1170` (ภาษีซื้อ — Input VAT) / `2170` (ภาษีขาย — Output VAT)
  - Mapping `vat_output` / `vat_input`
  - sales/expenses/delivery_invoices: + columns `vat_amount`, `vat_rate`, `subtotal_before_vat`
- **feat:** Settings → ข้อมูลการเงิน → section "📜 ภาษีมูลค่าเพิ่ม (VAT)"
  - Toggle เปิด/ปิด VAT
  - Tax ID 13 หลัก
  - อัตราภาษี (default 7%)
  - Mode: exclusive (บวก VAT) / inclusive (ราคารวม VAT แล้ว)
- **feat:** POS Cashier — calc VAT auto + แสดง breakdown ในหน้ายืนยัน
  - "ยอดสินค้า ฿X / VAT 7% ฿Y / รวมสุทธิ ฿Z"
  - บันทึก vat_amount + subtotal_before_vat ใน sales
- **feat:** auto_post.js `postJournalForSale` — split JV เป็น 3 บรรทัดเมื่อมี VAT
  - Dr 1110/1130 (เงิน) ฿107
  - Cr 4100 (รายได้) ฿100
  - Cr 2170 (Output VAT) ฿7
- **scope MVP:** POS sale only — Phase ถัดไป: expense (Input VAT) + invoice + service jobs

### User actions required
1. Run SQL: `supabase-phase88-21-vat-support.sql`
2. ตั้งค่า → ข้อมูลการเงิน → ✅ เปิด VAT 7%
3. ทดสอบ POS → ขายของ → ดู breakdown ในหน้ายืนยัน → JV 3 บรรทัด

---

## 5.42.0 (build 203) — 2026-05-09 ⭐ Phase 88.20

### Phase 88.20 — POS Cash breakdown + Bank account picker
- **feat:** POS หน้า "ยืนยันการชำระ" — เพิ่ม breakdown รับเงิน-เงินทอน เด่นชัด
  - 2 columns: 💵 รับเงินจากลูกค้า / 💸 เงินทอน
  - แสดงเสมอ (ไม่ใช่เฉพาะกรณีทอน)
- **feat:** POS Transfer — dropdown เลือกบัญชีธนาคารปลายทาง (ถ้ามีหลายบัญชี)
  - QR + ข้อมูลบัญชีเปลี่ยนตามที่เลือก
  - แสดง COA Code ถ้ากรอกใน settings
- **feat:** Settings → ข้อมูลการเงิน — เพิ่ม "📊 รหัสบัญชี COA" ใน bank card
  - บัญชีแรก default = 1130 (suggestion)
- **feat:** Sales note บันทึก:
  - `BANK_COA:XXXX` — สำหรับ auto-post ใช้
  - `🏦 ชื่อธนาคาร (เลขบัญชี)` — readable
  - `💵 รับ ฿X ทอน ฿Y` — สำหรับ cash
- **feat:** auto_post.js `postJournalForSale` — ตรวจ note BANK_COA → override Dr account

### User actions
- ตั้งค่า → ข้อมูลการเงิน → เพิ่มบัญชี → กรอก COA Code (1130, 1131, 1132)
- POS Transfer → ≥ 2 บัญชี → dropdown โผล่

---

## 5.41.2 (build 202) — Phase 88.19c (table fix)
- **fix:** `journal_entry_lines` → `journal_lines` ใน periods.js fetchPeriodSummary

## 5.41.1 (build 201) — Phase 88.19b (route fix)
- **fix:** เพิ่ม `accounting_periods` ใน `ALL_ROUTES` (ลืม register)

## 5.41.0 (build 200) — 2026-05-09 ⭐ Phase 88.19 — Period Close 🎉

### Phase 88.19 — ปิดงวดบัญชี (Lock Periods)
- **feat:** ตารางใหม่ `accounting_periods` (year/month/status/locked_at/locked_by/unlock_reason)
- **feat:** หน้าใหม่ "🔒 ปิดงวดบัญชี" ใน เมนูบัญชี
  - Grid 12 เดือน × N ปี + summary (revenue/expense/net/JV count)
  - ปุ่ม Lock งวด — confirm dialog แสดง summary
  - ปุ่ม Unlock — กรอกเหตุผล (≥5 chars) → audit trail
- **feat:** Validation 2 ชั้น (defense in depth):
  - Front-end: `auto_post.js` ตรวจ period status ก่อน insert JV
  - Back-end: DB trigger `check_period_not_locked` กัน insert/update ผิดงวด
- **feat:** อนุญาต void JV ใน locked period (soft delete) — ห้าม insert/update
- **SQL:** `supabase-phase88-19-period-close.sql`

### User actions required
1. Run SQL: `supabase-phase88-19-period-close.sql`
2. ลอง: เมนู → บัญชี → "🔒 ปิดงวดบัญชี" → คลิกเดือน → Lock

🎯 **Build 200 — milestone!**

---

## 5.40.2 (build 199) — 2026-05-09 ⭐ Phase 88.18c

### Phase 88.18c — Expense form: แยก ถ่ายรูป / แกลเลอรี่
- **fix:** หน้ารายรับ-รายจ่าย → ฟอร์มแก้ไข → ปุ่ม "ถ่ายรูป / เลือกรูปบิล" ปุ่มเดียว
  - บน mobile: บังคับเปิดกล้องเสมอ — เลือกรูปจากแกลเลอรี่ไม่ได้
  - แก้: แยก 2 ปุ่ม "📷 ถ่ายรูป" (capture=environment) + "🖼️ แกลเลอรี่" (no capture)
  - ใช้ pattern เดียวกับ Phase 88.11 (service form slip)
- **feat:** ปุ่ม "เปลี่ยนรูป" (กรณีมีรูปแล้ว) แยก 2 ปุ่ม: "📷 ถ่ายใหม่" / "🖼️ เลือกใหม่"

---

## 5.40.1 (build 198) — 2026-05-09 ⭐ Phase 88.18b — Production start

### Phase 88.18b — เลื่อน ACCOUNTING_EFFECTIVE_DATE → 2026-05-01
- **change:** Effective date 2026-01-01 → **2026-05-01** ใน 4 ไฟล์
  - auto_post.js / balance_sheet.js / export_bundle.js / opening_balance.js
- **เหตุผล:** User เริ่ม production จริงตั้งแต่ 1 พ.ค. — ก่อนหน้านี้คือ test data
- **ผล:**
  - ระบบจะ reject auto-post JV ของ docDate < 1 พ.ค. โดยอัตโนมัติ
  - กัน backfill mock data + กันสร้าง JV ผิดวันโดยไม่ตั้งใจ
  - Balance Sheet / Export bundle ใช้ 1 พ.ค. เป็น cumulative start
- **User action:** Run SQL void JV ของ เม.ย. 2026 (mock data) → P&L สะอาด

---

## 5.40.0 (build 197) — 2026-05-09 ⭐ Phase 88.17 + 88.18

### Phase 88.17 — Receipt Approval Workflow
- **fix:** ใบเสร็จออกใหม่ default `status="pending"` (เดิม "paid" auto)
  - delivery_invoices.js line 731 — เปลี่ยน default
- **fix:** `postJournalForReceipt` ตรวจ `status="paid"` ก่อน post JV
  - กัน JV เกิดทั้งที่ user ยังไม่ยืนยันรับเงิน
- **feat:** receipts.js UI:
  - Default filter chip = "🟡 รออนุมัติ" (ม่วง — เน้นความสำคัญ)
  - STATUS_LABELS: paid="✅ ชำระแล้ว" / pending="🟡 รออนุมัติ" / cancelled="⚫ ยกเลิก"

### Phase 88.18 — B2B Revenue Split + Fix JV Chain ⚠️ บั๊กบัญชีสำคัญ
- **bug fix:** เดิม invoice ออกแล้ว revenue **ไม่เคย post** เข้า P&L → ลูกหนี้ติดลบ + ขาดทุนปลอม
- **feat:** เพิ่ม COA **4150** "รายได้ขายสินค้า — งานราชการ/บริษัท"
- **feat:** Rename COA 4100 → "รายได้ขายสินค้า — หน้าร้าน (POS)"
- **feat:** เพิ่ม mapping `invoice_credit` (Dr 1200 / Cr 4150)
- **feat:** เพิ่ม `postJournalForDeliveryInvoice()` ใน auto_post.js
  - quotations.js หลัง insert invoice → fire JV (Dr 1200 / Cr 4150)
- **feat:** Backfill page เพิ่ม source "🧾 ใบส่งสินค้า (B2B)"
  - User backfill ย้อนหลังให้ invoice เก่าได้

### User actions required
1. Run SQL: `supabase-phase88-17-revenue-split.sql`
2. Backfill ย้อนหลัง: บัญชี → Backfill ย้อนหลัง → เลือก "ใบส่งสินค้า" + date range → รัน

---

## 5.39.5 (build 196) — 2026-05-09 ⭐ Phase 88.16

### Phase 88.16 — Solar revenue mapping → 4300
- **feat:** เพิ่ม COA 4300 "รายได้บริการ — โซล่าเซลล์"
  - SQL migration: `supabase-phase88-16-solar-mapping.sql`
- **feat:** เพิ่ม `account_mapping.service_solar` (Dr 1110 / Cr 4300)
- **fix:** `auto_post.js` keyMap: `solar → service_solar` (เดิม fallback service_other → 4240)
- **impact:** P&L แยกรายได้โซล่าออกจาก "บริการอื่นๆ" — ดู revenue mix ของแต่ละสายงานได้ชัด
- **action:** ⚠️ User ต้อง run SQL ใน Supabase SQL Editor ก่อน mapping ใหม่จะใช้ได้

---

## 5.39.4 (build 195) — 2026-05-09 ⭐ Phase 88.15

### Phase 88.15 — แยกสิทธิ์ ช่าง vs admin (delivered/closed = admin only)
- **fix:** ลบ option "📦 ส่งมอบแล้ว (ลง JV ทันที)" + "🎉 ปิดงาน + รับเงิน (ลง JV ทันที)" ออกจากฟอร์มช่าง
  - 11 หน้า: solar.js / ac_install.js / service_form.js (9 routes)
  - ช่างเลือกได้: pending / in_progress / done / pending_review เท่านั้น
- **fix:** `COMPLETION_STATUSES = []` ในฟอร์มช่าง — JV ไม่ trigger เองอีก
  - JV เกิดผ่าน admin drawer (approve banner) เท่านั้น
- **impact:** ป้องกันช่างกดผิดแล้ว JV เกิด — workflow ชัดเจน: ช่างส่ง → admin อนุมัติ

---

## 5.39.3 (build 194) — 2026-05-09 ⭐ Phase 88.14

### Phase 88.14 — Fix new service jobs ไม่โผล่ในใบรับงาน
- **fix:** `solar.js` / `ac_install.js` / `service_form.js` (9 routes) บันทึกแล้ว job ใหม่ไม่ push เข้า `state.serviceJobs`
  - ทำให้หน้า "ใบรับงาน" ไม่เห็น job ใหม่จนกว่าจะ refresh page
  - เพิ่ม optimistic update: `state.serviceJobs = [inserted[0], ...state.serviceJobs]` หลัง insert สำเร็จ
  - Pattern เดียวกับ `saveServiceJob` ใน main.js
- **impact:** ทุกหน้างานช่าง (11 หน้า) — บันทึก → เปลี่ยนหน้าใบรับงาน → เห็นทันที

---

## 5.39.2 (build 193) — 2026-05-09 ⭐ Phase 88.13

### Phase 88.13 — Solar equipment ↔ Stock link
- **feat:** หน้าโซล่าเซลล์ — อุปกรณ์/วัสดุ ลิ้งกับสต็อก (warehouse) แทน free-text
  - ปุ่ม "+ เพิ่มอุปกรณ์" เปิด modal picker จาก state.products + แสดงสต็อกในรถ/บ้าน
  - แสดงตาราง อุปกรณ์/คลัง/qty stepper/ราคา/รวม + ลบรายการ
  - ตอน save → ตัดสต็อกอัตโนมัติ (window._appApplyStockMovement) + auto-transfer บ้าน→รถ ถ้าไม่พอ
  - เก็บ items_json ลง service_jobs
  - ไม่กระทบ section ปิดงาน/สลิป/AI verify/JV trigger ของ Phase 88.12

---

## 5.39.1 (build 192) — 2026-05-09 ⭐ Phase 88.12 final

### Phase 88.12 — Approval Workflow ครบ 13 หน้างานช่าง
- **feat:** ทุกหน้างานช่างมี section "ปิดงาน + แนบสลิป + AI verify"
  - 9 service types (service_form.js) + ติดตั้งแอร์ (ac_install.js) + โซล่าเซลล์ (solar.js)
  - ปุ่มแยก 📷 ถ่ายรูป / 🖼️ แกลลอรี่
  - Auto AI verify ถ้า payment=transfer/qr
- **feat:** Status ใหม่ `pending_review` (📨 รออนุมัติ)
  - ช่างเลือก → JV ไม่เกิด (รอ admin)
  - filter chip "รออนุมัติ" สีม่วง ในใบรับงาน
- **feat:** Admin approve banner ใน drawer (ม่วง) + ปุ่ม "อนุมัติ + ลงรายได้"
  - กด → status=delivered → save → JV เกิด

---

## 5.38.6 (build 190) — 2026-05-09 ⭐ Phase 88.11 final

### Phase 88.11 — Slip Upload + AI Verify (Gemini Vision)
- **feat:** ช่างแนบสลิปการโอน + AI ตรวจ tampering ใน drawer
  - `functions/api/verify-slip.js`: Gemini Vision API + 4-model fallback chain
  - Compact prompt + maxTokens 4000 (รองรับ Thai)
  - Extract: sender/recipient/amount/datetime/ref + tampering_score
  - Smart name match (strip prefix + bank name) — กัน false positive
  - Tampering threshold สอน AI: phone-of-phone ≠ tampering
- **feat:** drawer section สีม่วง — 📷 ถ่าย / 🖼️ แกลลอรี่ + auto-verify
- 7 builds (184-190) — debug journey: token truncate, name match, tampering threshold

---

## 5.37.2 (build 183) — 2026-05-09

### Phase 88.10b — Re-post JV ตอน user แก้ total/method
- **fix:** เพิ่ม `editCompleteWithChange` trigger — งาน complete + แก้ total/method
- เก็บ origTotalCost + origPaymentMethod ใน state ตอน open drawer

## 5.37.1 (build 182) — 2026-05-09

### Phase 88.10 — Re-post JV (initial)
- **fix:** เพิ่ม `voidJvForSource()` — DELETE JV เดิมก่อน post ใหม่
- กัน idempotent unique block POST ตอน user แก้ amount

---

## 5.37.0 (build 181) — 2026-05-09 ⭐ Phase 88.7-88.9

### Phase 88.7 — JV Drill-down (สมุดรายวัน → drawer)
- **feat:** คลิก row JV → drawer แสดง:
  - Meta (วันที่/ประเภท/สถานะ) + คำอธิบาย
  - Lines table (Dr/Cr ทุกบรรทัด) + balance check
  - Source preview (ถ้ามี source_table/source_id) — sales/expenses/receipts/service_jobs
  - ปุ่ม "เปิดหน้า [source]" → navigate ไป list page
  - Audit info (created_at / approved_at / voided_at)

### Phase 88.8 — Drawer service edit: ค่าแรง/discount + payment_method
- **feat:** เพิ่ม section "💰 ค่าแรง / ปิดงาน" ใน serviceJobDrawer
  - input ค่าแรง / ส่วนลด / ยอดสุทธิ (auto-recalc)
  - dropdown payment_method (cash → Dr 1110 / transfer → Dr 1130)
- **feat:** saveServiceJob ใส่ `total_cost` + `payment_method` ใน payload
  - ส่ง payment_method ไปยัง postJournalForServiceJob — override Dr account
  - แก้ pain point: drawer ก่อนหน้านี้ไม่มีช่อง total_cost (ต้องไป SQL UPDATE manual)

### Phase 88.9 — Comparative P&L
- **feat:** toggle "📊 เทียบกับงวดก่อน" ในหน้างบกำไรขาดทุน
  - Auto-compute previous period (เดือน/ไตรมาส/ปี/custom = ขนาดเท่ากัน)
  - Fetch 2 งวดพร้อมกัน → render side-by-side (5 columns: รหัส | ชื่อ | งวดนี้ | งวดก่อน | Δ)
  - Net Income compare card (3 ตัวเลข + % change)

---

## 5.36.0 (build 180) + SQL hotfix — 2026-05-08 ⭐ Phase 88.6

### Phase 88.6 — Service Job Closure Workflow
- **feat:** ช่างปิดงานในหน้าเดียว — JV ลงรายได้อัตโนมัติตามประเภทงาน
  - SQL: ALTER service_jobs (total_cost/payment_method/payment_slip_url/closed_at)
    + 5 COA ใหม่ (4250-4290) + 5 mappings (satellite/fridge/washer/cctv/tv)
  - auto_post.js: keyMap 9 ประเภทครบ + payment_method override (transfer→1130)
  - service_form.js: section "🔚 ปิดงาน" (status + payment + slip upload + auto JV)
- **SQL hotfix** (c89a75c): ลืม payment_method ในรอบแรก — เพิ่ม + NOTIFY pgrst
- ✅ User verified: SV2026050003 ฿3,000 จากงานซ่อมแอร์ลูกค้าดาหมอก

---

## 5.35.2 (build 179) — 2026-05-08

### Hotfix — service_jobs.total_cost
- **fix:** service_form.js เพิ่ม `total_cost: net` ใน record ตอน insert
  - Bug: postJournalForServiceJob skip silent ถ้า total_cost=NULL

---

## 5.35.1 (build 178) — 2026-05-08

### Hotfix — Backfill date range
- **fix:** `created_at=lte.YYYY-MM-DD` exclude row ที่ created 12:56 UTC
  - แก้: timestamptz field ใช้ `lt.<nextDay>`, DATE field ใช้ `lte.<to>`

---

## 5.35.0 (build 177) — 2026-05-08

### Hotfix — Mobile service form save
- **fix:** ใช้ `window._sbAccessToken` cache แทน `supabase.auth.getSession()`
  (มือถือ slow network → getSession hang ตลอด)
- **fix:** wire `postJournalForServiceJob` ใน service_form.js (เดิม wire ผิดที่ใน main.js)

---

## 5.34.9 (build 176) — 2026-05-08

### Hotfix — service_form fetch timeout
- **fix:** AbortController + 15s timeout — กัน "กำลังบันทึก..." ค้างไม่จบ

---

## 5.34.8 (build 175) — 2026-05-08 ⭐ Phase 88 FINAL

### Phase 88.5 — Opening Balance wizard + Export bundle (FINAL)
- **feat:** wizard ลงยอดยกมา (Opening Balance) — `modules/accounting/opening_balance.js`
  - 3 sections (Asset/Liability/Equity) + live balance check Dr=Cr
  - หลัง save → JV `OB2026010001` doc_type=OB ลงวันที่ effective date
  - แก้ปัญหา BS แสดงตัวเลขลบ (ไม่มี opening balance)
- **feat:** export bundle ส่งสำนักงานบัญชี — `modules/accounting/export_bundle.js`
  - Excel 1 ไฟล์ มี 4 sheets: TB / P&L / BS / Journal
  - ใช้ window.XLSX (SheetJS) — single fetchAll() reuse data
  - Period picker month/quarter/year/custom
- 🎉 **Phase 88 ครบสมบูรณ์** — รองรับทุก use case จาก spec ของ user

---

## 5.34.7 (build 174) — 2026-05-08

### Phase 88.4 — งบดุล Balance Sheet
- **feat:** หน้างบดุล — สมการบัญชี Assets = Liabilities + Equity
  - `modules/accounting/balance_sheet.js` (~310 lines): closing balance
    cumulative ตั้งแต่ effective date 2026-01-01 → as-of date
  - 3 sections: Assets (Dr-Cr) / Liabilities (Cr-Dr) / Equity (Cr-Dr)
    + Retained Earnings (Σincome-Σexpense) → row พิเศษใน Equity
  - Equation card: balance check ✓ สีเขียว / ⚠️ สีแดง + ผลต่าง
  - Negative number warning → แนะนำลง JV ประเภท OB (Phase 88.5)
- "As of date" picker (default=today, min=2026-01-01) + Excel + พิมพ์

---

## 5.34.6 (build 173) — 2026-05-08

### Phase 88.3 — งบกำไรขาดทุน (P&L)
- **feat:** หน้างบกำไรขาดทุน — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุนสุทธิ
  - `modules/accounting/profit_loss.js`: 2 sections (รายได้ 4xxx / ค่าใช้จ่าย 5xxx)
    + Net Income card (สีเขียวถ้ากำไร / แดงถ้าขาดทุน) + Margin %
  - ใช้ logic ตรงมาตรฐานบัญชี: income normal Cr balance, expense normal Dr balance
  - Period picker + Export Excel + พิมพ์ (เหมือน Trial Balance)

---

## 5.34.5 (build 172) — 2026-05-08

### Phase 88.2 — Trial Balance Report
- **feat:** หน้ารายงานยอดทดลอง (รายงานหัวใจของบัญชี — ส่งสำนักงานบัญชีได้)
  - `modules/accounting/trial_balance.js`: period picker (เดือน/ไตรมาส/ปี/custom)
    + auto-aggregate Dr/Cr per account + balance check Dr=Cr
  - 5 sections (สินทรัพย์/หนี้สิน/ส่วนของเจ้าของ/รายได้/ค่าใช้จ่าย) + subtotals
  - Export Excel (5 columns + total row) + พิมพ์ (popup window)
- ใช้ "4-point checklist" — เพิ่ม route ครบทั้ง 4 จุด (index.html + ALL_ROUTES +
  ROUTE_GROUP + routeTitles/showRoute) — ไม่พลาดเหมือน Phase 88.1b initial

---

## 5.34.4 (build 171) — 2026-05-08

### Phase 88.1b hotfix + verified end-to-end
- `cb4c13b` **fix:** เพิ่ม `accounting_backfill` ใน `ALL_ROUTES` list
  - Phase 88.1b (build 170) ลืมจุดนี้ → admin canAccessPage = false →
    กดปุ่ม Backfill แล้ว redirect ไป fallback (เข้าหน้าไม่ได้)
- ✅ **Verified end-to-end:** Backfill 91 rows → สร้าง JV ใหม่ 90 (1 มี JV แล้ว)
  - สมุดรายวัน 3 → 93 รายการ
  - PV/SV ครบทั้งเดือน เม.ย.-พ.ค. 2026 → trial balance ครบจริง

---

## 5.34.3 (build 170) — 2026-05-08

### Phase 88.1b — Receipts/Service Jobs auto-post + Backfill UI
- **feat:** auto-post JV จาก 4 sources ใหม่ + Backfill UI
  - `auto_post.js`: เพิ่ม `postJournalForReceipt` (RV) + ขยาย `EXPENSE_CATEGORY_MAP`
    (salary/labor_hire/payroll/materials/utilities)
  - `receipts.js`: wire 2 จุด (dropdown + preview button) — fire ตอน status=paid
  - `main.js saveServiceJob`: wire ตอน status transition → done/delivered/closed
    (xhrPost ใส่ `returnData: true` ขอ id; ใช้ `state.serviceJobs` ที่ optimistic update
    เพื่อได้ total_cost)
  - `modules/accounting/backfill.js`: หน้าใหม่ — เลือก source + date range → preview/run
    batch post (idempotent)
- **Architecture:** Payroll ไม่ wire ตรง — ใช้ expense flow (Phase 76 auto-create
  expense category=salary ตอน markPaid → triggers postJournalForExpense)
  เพื่อกัน duplicate JV (1 transaction = 1 JV)

---

## 5.34.2 (build 169) — 2026-05-08

### Phase 88.1a-fix — RLS hotfix + wire auto-post ที่ pos.js (จุดที่ POS ใช้จริง)
- `60b8fee` **fix:** wire `postJournalForSale` ใน `modules/pos.js doCheckout()`
  (build 168 wire ผิดที่ — main.js:checkout() เป็น legacy ไม่ถูกเรียก)
- `6b2ff34` **fix:** RLS hotfix — split `je_admin`/`jl_admin` policies
  (Phase 88.0 ใช้ FOR ALL → block INSERT จาก non-admin → JV ไม่เกิด)
  - Run `supabase-phase88-hotfix-rls.sql` post-deploy
- ✅ **Verified end-to-end:** ขาย POS → JV `SV2026050001` เกิดอัตโนมัติ Dr 1110 / Cr 4100

---

## 5.34.1 (build 168) — 2026-05-08

### Phase 88.1a — Auto-post JV (sales + expenses)
- **feat:** auto-post Journal Entry จาก POS sale + expense (fire-and-forget)
  - `supabase-phase88-auto-post.sql`: partial unique index บน
    `(source_table, source_id)` → idempotent + 22 seed mappings
    (4 sales + 10 expenses + 5 services + 2 receipts + 2 payroll)
  - `modules/accounting/auto_post.js`: postJournalForSale/Expense/
    ServiceJob — effective date 2026-01-01, mapping cache lazy-loaded
  - `main.js`: wire `postJournalForSale` ใน checkout()
  - `modules/expenses.js`: wire 2 จุด (manual save + AutoKey OCR flow)
- **⚠️ Post-deploy:** ต้องรัน `supabase-phase88-auto-post.sql` ใน Supabase

---

## 5.34.0 (build 167) — 2026-05-08

### Phase 88.0 — Accounting Foundation
- `98f5574` **feat:** accounting foundation
  - SQL: chart_of_accounts (51 Thai accounts) + journal_entries
    (je_balanced CHECK) + journal_lines (line_one_side CHECK) +
    fiscal_periods + is_accountant() helper + 4 RLS policies admin-only
  - JS: journals.js (สมุดรายวัน list) + journal_form.js (manual JV) +
    coa.js (ผังบัญชี + CSV/Excel import/export)

---

## 5.33.5 (build 166) — 2026-05-08

### Phase 87.5 — Full catalog spec seed
- `aabd340` **feat:** seed extended specs ครบ 211 รุ่นที่เหลือ → 223/223 (100%)
  - Python script `scripts/seed_specs.py` — 45+ section templates + per-BTU class scaling
  - main.js cache logic เปลี่ยน: ratio-based (≥90% specced) แทน "any feature" check
  - Caveat: แบรนด์เล็ก (FRIO, MAVELL, STAR AIR ฯลฯ) ใช้ default ตาม BTU class — ไม่ใช่ official spec sheet

---

## 5.33.4 (build 165) — 2026-05-07

### Phase 87.4 — Copy spec from another SKU (Hybrid workflow boost)
- `8712bb1` **docs:** HANDOFF sync to 5.33.4
- `8266167` **feat:** ปุ่ม "📥 ดูด" — fill spec form จากรุ่น A → B (ลด 8 นาที → 1.5 นาที/รุ่น = 5x faster)
  - Green panel ใต้ header + dropdown optgroup ตาม section
  - Self-filter: ไม่แสดงรุ่นปัจจุบันใน dropdown
  - Backwards-compat: ถ้า sourceList ว่าง → ไม่ render panel

---

## 5.33.3 (build 164) — 2026-05-07

### Phase 87.3 — CSV/Excel round-trip 24 columns
- `17c2d0a` **docs:** HANDOFF sync to 5.33.3
- `b7106f3` **feat:** Excel/CSV export/import รองรับ 24 columns (พื้นฐาน 8 + extended 16)
  - Helpers: `_arrToPipe`, `_pipeToArr`, `_tryNum`, `_toExportRow`, `_fromImportRow`
  - Smart serialization: arrays → `"item1 | item2"`, ranges → `"0.4-4.5"` string
  - Backwards-compat: old 8-column CSV ยัง import ได้

---

## 5.33.2 (build 163) — 2026-05-07

### Phase 87.2 — Admin spec editor + 12 SKUs seeded
- `847d718` **feat:** Modal form ใหม่สำหรับ admin กรอก spec (16 fields) + seed 8 SKUs เพิ่ม (รวม 12)
  - ✏️ button per row: `+ สเปก` (เทา) / `📋 แก้` (เขียว)
  - Number fields fall back to string (เช่น `"0.4-4.5"`)
  - 12 SKUs: TCL MFS/T-PROWD series, Carrier 38TVDB010, LG ISC10E, Daikin FTM 09 PV2S, Mitsubishi MSY-JZ 09 VF

---

## 5.33.1.1 (build 162) — 2026-05-07

### Phase 87.1.1 — Schema auto-refresh hotfix
- `111e052` **fix:** localStorage v1 cache ไม่ load JSON v2 — เพิ่ม detect `features|seer|description` แล้ว overwrite cache

---

## 5.33.1 (build 161) — 2026-05-07

### Phase 87.1 — Product detail modal + extended catalog schema
- `c315fd5` **feat:** modal สวยเหมือนห้างใหญ่ (hero image, badge, warranty, features, spec table) + schema v2 (16 extended fields)
  - ไฟล์ใหม่: `modules/product_detail_modal.js` (212 lines)
  - Wire ใน `customer_dashboard.js`: spread `...c` + click `[data-view-product]`
  - Seed 2 sample SKUs: MFS10, T-PROWD10
  - ESC + click-outside dismiss + mobile full-screen <640px

---

## 📋 Format guidelines

- **Headline** = 1 บรรทัด — `<commit> <type>: <สรุป>`
- **Types**: `feat` (ของใหม่), `fix` (แก้ bug), `docs` (เอกสาร), `refactor` (จัดโครงสร้าง), `chore` (อื่นๆ)
- **Bullets** = 1-2 ข้อ ต่อ commit ใหญ่ — เน้น user-impact
- **Skip**: tiny chores, version-bump-only commits — ดู git log ก็พอ
- **เนื้อหาลึก** (why / trade-off / architecture) — ใส่ใน HANDOFF.md ไม่ใช่ตรงนี้
# Phase 536 note

- fix(security,build 536): harden `error_log` spoof/read exposure (BUG_AUDIT 2026-06-25 S2+S3). `/api/log-error` now derives `user_id` from Authorization JWT `sub` only after UUID validation. New SQL `supabase-phase536-error-log-hardening.sql` blocks direct REST user_id spoofing (`user_id IS NULL OR user_id = auth.uid()`), changes `error_log` SELECT to admin-only (`public.is_admin()`), and sets `error_log_grouped` to `security_invoker`. +guard `error_log_hardening`. Build/cache 535->536.
