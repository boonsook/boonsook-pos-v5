# Boonsook POS V5 - Shared Session Start

Last updated: 2026-06-02 (Phase 353 air-job-to-quotation-draft-action — ปุ่มสร้างใบเสนอราคาจากงานแอร์, build 353) · ⏸️ STOP รอ owner/Codex review ก่อน Phase 354

Purpose: this is the common first-read note for Codex, Claude, or any next agent opening a fresh session on this project. Read this before changing files so both teams start from the same facts.

> **ทีม implement / Claude:** เริ่มจาก [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) ก่อน — ต้องอ่าน + ทำตาม STEP 0–7 ก่อนลงมือ phase ใหม่ และต้อง **หยุดหลังจบ phase รอ owner/Codex review** เสมอ

## Project Snapshot

- Project: Boonsook POS V5 PRO, Thai POS PWA.
- Workspace: `C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github`
- Main app version: `5.66.0` (build 353) · ⏸️ STOP — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 354
- 🆕 build 353 = air-job-to-quotation-draft-action: งานแอร์ใน service_jobs มีปุ่ม "📝 ใบเสนอราคา" → pushAirQuoteDraft(source="air_job") → หน้า quotations เป็น draft (notice "รายการร่างจากงานแอร์", prefill ลูกค้า+line item). **ไม่ save อัตโนมัติ/ไม่สร้างเลขเอกสาร** (user กดบันทึกเอง). งานทั่วไปไม่มีปุ่ม. ac_quotation_draft.pushAirQuoteDraft generalize source/serviceJobId/customer (backward-compatible 346). ไม่แตะ stock/POS/cart/schema/workflow.
- 🆕 build 352 = air-job-filter-and-priority: service_jobs เพิ่ม filter "ที่มา:" (ทั้งหมด/จากแคตตาล็อกแอร์/งานทั่วไป) + priority badge (มีวันนัดหมาย/รอยืนยันราคา/รอนัดหมาย/รอตรวจสอบ) บนงานแอร์. air_job_meta.js +airPriority/airPriorityBadgeHtml (READ-ONLY derive จาก note marker; ไม่แตะ status จริง/schema/stock/POS/cart). งานทั่วไปไม่มี badge.
- 🆕 build 351 = service-job-air-source-visibility: รายการงาน (service_jobs admin + "งานของฉัน" ลูกค้า) แสดง badge "🌬️ จากแคตตาล็อกแอร์ · สั่งจอง/สอบถามราคา" + กล่องสรุปรุ่น/BTU/ราคา/นัดหมาย. ไฟล์ใหม่ `modules/air_job_meta.js` (parseAirJobMeta — READ-ONLY detect marker `source=air_catalog` จาก note ที่ build 350 เขียน; ไม่เพิ่ม DB column). ไม่แตะ stock/POS/cart/schema/workflow. filter chip = phase ถัดไป.
- 🆕 build 350 = service-request-air-form-polish: ขัดเกลา UX หน้า service_request เฉพาะมี air_catalog draft — date/timeslot มี placeholder+hint ชัด; ปุ่ม AI ย้ายเป็น secondary ท้ายฟอร์ม (ไม่มี draft = เด่นบนสุดเดิม); รายละเอียด prefill สั้น + ข้อมูลครบ (source=air_catalog) ไปอยู่ note; หมายเหตุ input→textarea (ไม่ตัด); confirmation "ส่งคำขอแล้ว..." + ปุ่มดูงานของฉัน. submit endpoint เดิม. ไม่กระทบ flow ปกติ/POS/cart/quotation.
- 🆕 build 349 = service-request-air-booking-polish: หน้า service_request รับ booking draft (347) → summary card "🌬️ รายการจากแคตตาล็อกแอร์" (ประเภท/รุ่น/BTU/ราคา/ประกัน/สเปก) + disclaimer "ยังไม่ใช่การซื้อจริง...ยังไม่ได้ส่ง"; intent-aware heading+ปุ่ม (จอง vs สอบถามราคา); prefill ประเภท/รายละเอียด/หมายเหตุ; ช่องนัดหมาย (วันที่+ช่วงเวลา)→map ลง note (ไม่แก้ schema); submit manual เดิม (POST service_jobs pending). booking draft พก note/spec/warranty เพิ่ม. ไม่แตะ stock/POS/cart/quotation.
- 🆕 build 348 = remove-customer-cart-tab-for-air-catalog: เอา tab "🛒 ตะกร้า" ออกจาก customer_dashboard (หน้าร้านแอร์ = จอง/สอบถามราคา ไม่ใช่ cart/checkout). guard `_custTab==="cart"→"shop"` → สาขา cart/checkout เดิม dormant (ไม่ลบ). ปุ่มการ์ด สั่งจอง/สอบถามราคา → booking draft (347) ยังทำงาน. ซ่อน #bs-help-fab บน customer_dashboard มือถือ. **ไม่ลบ POS/cart logic ทั่วระบบ** (pos.js + saveCustCart คงไว้).
- 🆕 build 347 = air-catalog-public-store-sync: หน้าร้าน/customer_dashboard แสดงแอร์จาก `bsk_ac_catalog` (ชุดเดียวกับหน้าจัดการ) แยกคลังจริง 100%. filter ตามประเภทแอร์, แสดงเฉพาะพร้อมเสนอขาย+ต้องเช็คราคา (ซ่อนเลิกขาย), ปุ่ม "📅 สั่งจอง"/"💬 สอบถามราคา" → `ac_booking_draft.js` (sessionStorage) + service_request prefill (user กดส่งเอง). **ไม่ addToCart/POS/ตัด stock**. cart tab เดิมเหลือ dormant (ไม่มี path เพิ่มของเข้าตะกร้าแล้ว — เอาออกได้ในเฟสถัดไป). product_detail_modal +opts reserveOnly/ctaLabel.
- 🆕 build 346 = air-catalog-to-quotation-draft: ปุ่ม "นำไปเสนอราคา" ในแคตตาล็อกแอร์ → ส่งรุ่นเป็น **draft item** เข้าฟอร์มใบเสนอราคา ผ่าน sessionStorage (`bsk_air_quote_draft`, ไฟล์ `modules/ac_quotation_draft.js` push/consume-once). **ไม่สร้างเอกสารจริงอัตโนมัติ** (user กดบันทึกเอง), ไม่แตะคลัง/POS/cart/Supabase/SQL. quotations.js consume draft ตอน render → เปิดฟอร์มใหม่ + notice "ยังไม่ได้บันทึกเอกสาร"; reload ไม่เติมซ้ำ.
- ⚠️ **AC catalog = ไม่ใช่สต็อกจริง** (owner clarify): Settings → "จัดการแคตตาล็อกแอร์" คือชุดข้อมูลสำหรับ **ตั้งราคา/ทำใบเสนอราคา** เท่านั้น (localStorage `bsk_ac_catalog`, คนละ store กับ products/POS). field `stock` = "สถานะเสนอขาย" (>0=พร้อมเสนอขาย) ไม่ใช่จำนวนในคลัง. **ห้าม**ผูกเข้าคลัง products/รวมมูลค่าสต็อก/นับเป็น stock จริง.
- 🆕 build 345 = air-catalog-not-real-stock-correction: แก้ wording (หัวข้อ "จัดการสต็อกแอร์"→"จัดการแคตตาล็อกแอร์" + subtitle; มีสต็อก/หมดสต็อก→พร้อมเสนอขาย/ยังไม่เปิดขาย; ลบ "คงเหลือ"; "+เพิ่มเข้าคลัง"→"นำไปเสนอราคา" nav-only; badge 3 สถานะ + ต้นทุน/กำไรประมาณการ). wording/UI เท่านั้น.
- build 344 = air-stock-manager-safe-step: tab 3 ประเภท (แอร์ติดผนัง/แขวน/สี่ทิศทาง, `acTypeOf` fallback "wall") + ฟอร์มใหม่ `ac-stock-form.js`. NOTE: import ยัง overwrite ทั้งก้อน + ac_type/cost/sku/note ยังไม่อยู่ใน Excel (24 คอลัมน์เดิม) — รอบถัดไปค่อยเพิ่มคอลัมน์ + merge-by-id.
- Recent mobile-UX line (builds 337–343, all CSS/markup — no business/API/auth/accounting): 337 overlap-4 (filter/sidebar/FAB/table) · 338 FAB icon-only · 339 FAB route-gate · 340 AI entry inline (no mobile floating FAB; service assistant `#bs-ai-fab` vs sales AI `ai_sales`/`ac_shop` แยกกัน) · 341 sales-doc (tabs chip-wrap + `.table-wrap` + hide `#bs-help-fab`) · 342 inventory-mobile-polish (summary cards + filter wrap + card relayout + hide `#bs-help-fab` on products/wh_*) · 343 inventory-action-menu (header "⋯ จัดการเพิ่มเติม" + per-card "⋯" `<details>` menus — ปุ่มรองย้ายเข้าเมนู, id/data-action/handler เดิมครบ + category collapse ~10+selected + ล้างตัวกรองทั้งหมด).
- Latest pushed commits seen:
  - `3b4072b` `fix(92.48): integrity panel orphan fetch uses select=* (build 318)`
  - `71ef2ba` `fix(92.48): bump boot.js + style.css ?v= to 317 (build-sync smoke)`
  - `50ec7dd` `feat(92.48): accounting integrity status panel on backfill page`
  - `6e33358` `docs(ops): align Codex guardrail docs with project`
  - `d0d2b2f` `chore(92.47b): bump PWA cache and add shared ops notes`
  - `cb6dbf0` `docs(92.46c): close JE REST RLS incident - verified + applied SQL`
  - `a11bc9a` `fix(92.47): expense export date filter - use Bangkok TZ not UTC`
- Git push range previously reported successful: `f858008..cb6dbf0`
- GitHub Actions reported successful:
  - Tests workflow: success
  - Deploy to Cloudflare Pages: success
- Production domain used in prior smoke work: `https://boonsukair.com/`
- Supabase project URL used by verification scripts: `https://rwmmjljelpcpwohwiplu.supabase.co`

## Current Truth As Of 2026-06-01

**FINANCE AUDIT CLOSED at build 334.** All 9 findings resolved (refund over-refund guard client+DB, recurring-expense JV + idempotency, VAT split Dr=Cr rounding, profit_report XSS, recurring + profit TZ, payroll failed-side-effect audit logging, PromptPay dead-code removed) and the period-lock DB trigger is verified present: table `journal_entries` → trigger `trg_check_period_locked` → function `check_period_not_locked` (confirmed via DB query by gangboo, 2026-06-01) — posting into a locked period is blocked at the DB.

**Auth follow-up (no SQL/runtime-logic change to servers): two client-side 401 fixes shipped after the audit closed.**

Phase 92.66 fixes the verify-slip (SlipOK) 401 across all 4 call sites (build 336).

- Root cause: `/api/verify-slip` is in `REQUIRE_AUTH_ENDPOINTS` (functions/_middleware.js, Phase 89.14); the global middleware's `verifyAuthToken` requires a real 3-part Supabase user JWT in `Authorization: Bearer`. The "🤖 ตรวจสลิป" callers all POSTed with only `Content-Type` (no token) → 401 before reaching SlipOK = transfer-slip verification broken on every page.
- Fix: each caller now attaches `Authorization: Bearer window._sbAccessToken` (read at call time), guards the no-token case (fail fast + re-login prompt instead of a broad error), and catches 401 → "เข้าสู่ระบบใหม่". The 4 call sites closed: `main.js` `_verifySlip`, `modules/service_form.js` `_doVerifySlip`, `modules/ac_install.js` `_verifyAcSlip`, `modules/solar.js` `_verifySolSlip`.
- No anonKey fallback — `anonKey`/publishable key (`sb_publishable_...`) is NOT a JWT, so `verifyAuthToken` rejects it (`parts.length !== 3`) = 401 anyway. Slip-image upload still uses anonKey storage (different endpoint, correct). Server `functions/api/verify-slip.js` untouched; no SQL/RLS. +24 tests `tests/verify_slip_auth.test.js` (source-guard × 4 call site). PWA cache 335→336.

Phase 92.65 fixes the AutoKey (parse-receipt) 401 (build 335).

- Root cause: `/api/parse-receipt` is in `REQUIRE_AUTH_ENDPOINTS` too; the AutoKey "🔍 ให้ AI วิเคราะห์ใบเสร็จ" button in `modules/expenses.js` (`_openAutoKeyModal`) POSTed with no header → 401 before reaching Gemini = AutoKey receipt scan broken.
- Fix: attach `Authorization: Bearer window._sbAccessToken` (read on click), guard no-token (don't burn Gemini quota → show re-login), special-case 401. No anonKey fallback. Server `functions/api/parse-receipt.js` untouched; no SQL/RLS. +6 tests `tests/expenses_autokey_auth.test.js`. PWA cache 334→335.
- Endpoint security is still correct: a no-token request to `/api/parse-receipt` or `/api/verify-slip` MUST get 401 — that is the intended behavior. To smoke-test OCR/slip for real you must be logged in as a real user first; an anon `curl` returning 401 is a PASS, not a regression.

Phase 92.64 balances the sale VAT journal split (build 334).

- Finance audit #4: the sale VAT-split JE used `subtotal_before_vat` + `vat_amount` rounded independently, so Dr (total) could differ from Cr (subtotal+vat) — a >0.01 drift made `_postJournal` silently reject the JE (lost revenue), ≤0.01 accumulated trial-balance error.
- Fix (modules/accounting/auto_post.js): new pure `splitSaleVatLines(total, vatAmount)` anchors on `total`, sets `vat=round2(vatAmount)`, derives `subtotal=round2(total-vat)` → Dr===Cr within a satang every time. Only the VAT-split block in `postJournalForSale` changed; non-VAT/refund/expense/payroll JEs (2-line Dr=Cr) untouched. +7 tests.
- Also done this session (no build bump): e2e smoke now allowlists transient esm.sh 503; dead module `payment_gateway.js` removed.
- Finance-audit REMAINING: none — closed at build 334 (period-lock trigger verified; #7 PromptPay dead code removed).

Phase 92.63 finance-audit quick wins are implemented and deployed (build 333).

- #5: profit_report.js now escapes product name + category (was stored-XSS). #6b: profit_report default date range + profit_by_product cutoff use Bangkok TZ (todayBkk/addDaysBkk) instead of UTC. #8: payroll logs `payroll_expense_failed` / `payroll_journal_failed` to the audit log when the auto-expense or auto-JV side-effect fails (was console-only). +4 tests.
- Finance-audit REMAINING items: #4 VAT float drift in auto_post (handle carefully — touches JE balance), #7 PromptPay QR generator (verify whether showPromptPayModal is actually used before changing), and verifying the period-lock DB trigger exists.

Phase 92.62 Recurring-expense audit fixes are implemented and deployed (build 332).

- Finance audit #2/#3/#6 (modules/recurring_expenses.js): (#2) generating a recurring expense now auto-posts a balanced JV (was missing → P&L/Trial Balance mismatch); (#3) idempotency via `#recur-{id}-{period}` note tag + existence pre-check + in-flight guard (was duplicating on retry/double-click); (#6) Bangkok TZ everywhere via `todayBkk()` and a rewritten pure `_calcNextDue` (was UTC, off-by-one). +9 tests.
- Remaining finance-audit items: #4 VAT float drift (auto_post), #5 profit_report XSS (productName/category), #6 TZ in profit_report/profit_by_product, #7 PromptPay QR generator (verify usage), #8 payroll JV error logging, and verifying the period-lock DB trigger exists.

Phase 92.61 Refund over-/double-refund cap is implemented and deployed (build 331). Server-side DB trigger (92.61b) applied in Supabase.

- Finance audit found the refund modal set max refundable qty to the original sale qty every time (no subtraction of prior refunds) → a bill could be fully refunded repeatedly, leaking money + stock + reversing JE.
- Fix (modules/refunds.js, client guard): new pure helpers `computeRefundableItems` (max = original − already-refunded, matched by product_id / name fallback) and `validateRefundWithinRemaining`; the modal now fetches the bill's prior refunds, caps each line, shows "คืนแล้ว N", disables fully-refunded lines, and re-validates before insert. +11 tests.
- NOTE: refund over-refund is now guarded on BOTH sides. Client guard (92.61) is live in build 331. The DB-level trigger `trg_guard_refunds_insert` from `supabase-phase92-61b-refund-guard.sql` was **APPLIED in Supabase by gangboo on 2026-06-01** (BEFORE INSERT on `refunds`, rejects over-refund per product_id, all roles). DDL state not independently verifiable from anon creds — based on user confirmation. This was audit finding #1 of a larger finance audit (remaining: recurring-expense JV + idempotency, VAT float drift, profit_report XSS/TZ, payroll JV error logging, period-lock trigger verification).

Phase 92.60 HR Overview premium UI/UX is implemented and deployed (build 330). (Codex shipped 92.58 POS money audit + 92.59 period-close gate in parallel; HR UI renumbered 92.58→92.60 and rebased on build 329.)

- Visual-only refresh of the HR Overview page (scoped `<style>` + inline styles in `modules/hr_overview.js`): page gradient background, gradient hero + gradient-clip title + pill eyebrow, navy→indigo glassy toolbar, premium cards/panels (layered shadows, 16px radius, hover lift), indigo→violet chart gradients.
- No structural/class/logic change; no data/SQL/RLS/payroll impact. Unit tests unchanged (837).

Phase 92.57 Export PDF / print HR report is implemented and deployed (build 327).

- New pure helper `buildHrReportPrintHtml()` returns a standalone printable HTML doc (print CSS + auto `window.print()`, all values escaped). A "🖨️ พิมพ์ / PDF" button in the HR report opens it in a new window for browser-native print / Save-as-PDF.
- No new dependency (browser print only); read-only; no SQL/RLS/payroll/accounting change.
- HR roadmap complete: 92.55 Timesheet ✓ · 92.56 department report ✓ · 92.57 PDF/print ✓. period-close-readiness branch (cef6b98) → ≥92.58.

Phase 92.56 รายงานระดับแผนก is implemented and deployed (build 326).

- New pure helper `buildDepartmentReport(rows)` aggregates the per-employee monthly report rows by department (headcount, days worked, regular/OT hours, late, early-leave, leave days) + totals.
- A "🏢 สรุปตามแผนก" table renders below the per-employee table in the HR report section (same data + date-range, auto-updates) with its own Excel export (`hr_dept_report_<from>_<to>.xlsx`). Read-only; no SQL/RLS/payroll/accounting change.
- HR roadmap: 92.55 Timesheet ✓ → 92.56 department report ✓ → 92.57 PDF/print (next). period-close-readiness branch (cef6b98) → ≥92.58.

Phase 92.55 Timesheet รายคน is implemented and deployed (build 325).

- New pure helper `buildEmployeeTimesheet()` in `modules/hr_overview.js` produces a per-employee daily grid (one row per day: earliest in / latest out / summed regular+OT / punctuality status / notes) plus totals.
- New "🗓️ Timesheet" tab in the employee drill-down modal, lazy-fetching the current month (month-to-date) via `_fetchUserAttendanceRange` + a `timesheetCache` (mirrors the existing week tab). Read-only; no SQL/RLS/payroll/accounting change.
- HR roadmap in progress: 92.55 Timesheet (done) → 92.56 department report → 92.57 PDF/print. A separate period-close-readiness branch (cef6b98) will renumber to ≥92.58.

Phase 92.54 HR report date-range picker is implemented and deployed (build 324).

- The Monthly HR report section in HR Overview now has from/to date inputs + a search button. Choosing a range calls `_fetchReportRange(from,to)` (staff_attendance + staff_leaves for that range only), rebuilds `buildMonthlyHrReport`, and re-renders only `#hrReportSection` (loading state + rebind) — it does NOT re-fetch the whole page.
- Export filename reflects the range (`hr_report_<from>_<to>.xlsx`). profiles/departments stay in memory; read-only; no SQL/RLS/payroll/accounting change.

Phase 92.53 Monthly HR report is implemented and deployed (build 323).

- New pure helper `buildMonthlyHrReport()` in `modules/hr_overview.js` aggregates one row per employee for the current month: days worked, regular/OT hours, late count+minutes, early-leave count+minutes, approved leave days, plus totals.
- New "📋 รายงาน HR รายเดือน" section in HR Overview (between today's table and Quick actions) with an Excel export button (`hr_report_<monthKey>.xlsx`).
- Read-only: reuses already-fetched data (profiles/attendanceMonth/leaves) + `sumRegularOT`/`summarizePunctuality`. No extra fetch, no SQL/RLS/payroll/accounting change.

Phase 92.52 HR attendance exception follow-ups is implemented and deployed (build 322). NOTE: Codex shipped Phase 92.51 = Period Close Checklist (accounting, build 321) in parallel; HR follow-ups were renumbered 92.51→92.52 and rebased on top of it.

- Builds on the 92.49 punctuality helpers. All client-side, read-only over existing data. No SQL/RLS/schema/payroll/accounting change.
- `modules/time_clock.js`: new pure `summarizePunctuality(rows, shift, opts)`; manager report shows a period punctuality summary + 3 Excel columns (สถานะตรงเวลา/นาทีสาย/นาทีออกก่อน); self-view history shows punctuality chips.
- `modules/hr_overview.js`: HR export gains 3 punctuality columns; `buildHrDashboardMetrics` accepts `shiftOpts`+`attendanceRules` (additive) and returns `monthlyPunctuality` (top-late + frequentLate ≥3), rendered as the "พนักงานมาสายบ่อย" dashboard panel.
- `modules/settings/store.js`: best-effort `logActivity('attendance_rules_update', {before, after})` when grace/shift values change.
- Note: Codex was building Phase 92.50 (and later 92.51 Period Close) in parallel; 92.49+92.50 committed together in `1cc586c` (build 320), Codex's 92.51 Period Close = build 321, HR follow-ups = build 322 (this commit). Verified: lint 0, unit 818, e2e 11 (build-sync 322).

Phase 92.50 HR executive dashboard detail view is implemented locally (build 320).

- `modules/hr_overview.js` now renders a full dashboard-style section above the existing HR operational table: hero/benefits, context filters, KPI cards, department bars, role donut, attendance status, recent attendance trend, leave breakdown, contract/probation watchlist, and data-source notes.
- New pure helper: `buildHrDashboardMetrics()` aggregates read-only HR metrics from profiles, departments, attendance, payroll, and leave rows.
- `_fetchHrData()` adds a graceful `staff_leaves` read. If the table/RLS/network fails, the page shows the existing warning pattern and does not crash.
- No SQL/RLS/schema change; no payroll/accounting/JE mutation.
- Build/cache bumped 319 -> 320 across `index.html` and `sw.js`.

Phase 92.49 HR attendance exception rules is implemented (build 319).

- Adds late / early-leave classification using existing Time Clock + shift data. Informational only — does NOT block clock-in/out and does NOT touch payroll, OT, leave, accounting, or JE RLS.
- New pure helpers in `modules/time_clock.js` (exported, tested): `classifyPunctuality(row, shift, opts)` returning `{status, lateMinutes, earlyLeaveMinutes}` with statuses `on_time|late|early_leave|late_and_early_leave|missing_clock_out|none`; `attendanceRulesFromState(state)` reading `lateGraceMinutes`/`earlyLeaveGraceMinutes` (default 15/15) from `storeInfo`; `punctualityChipMeta(punc)`.
- `modules/hr_overview.js`: late/early chips in the today table + drill-down modal, plus aggregated `late_arrivals`/`early_leaves` alerts (gated on passing `shiftOpts`+`attendanceRules` so old behavior/tests are preserved).
- `modules/time_clock.js` manager report shows the chip per row.
- `modules/settings/store.js`: new grace-minute inputs (validate >= 0, clamp 0–240) stored in `storeInfo`. NO SQL/RLS/schema change.
- Verification: `npm.cmd run lint:errors` clean; `npm.cmd test` 809 pass (+25 new); `npm.cmd run verify` e2e 11 pass including build-sync smoke.
- Build/cache bumped 318 -> 319 across `index.html` (data-app-build + selfheal/main/boot/style.css `?v=`) and `sw.js` (`cache-v319` + version marker).

Phase 92.48 accounting integrity status panel is shipped.

- Commit: `50ec7dd`
- Adds an accounting integrity status panel on the backfill page (`modules/accounting/backfill.js`).
- Reuses `accounting_integrity_summary()` and the `vw_*_without_journal` views.
- Buckets orphan rows into actionable vs intentionally skipped so stable legacy/test rows are not treated as an active failure.
- Hotfix commit: `3b4072b`
  - Changed orphan-row fetch to `select=*`.
  - Reason: build 317 selected `grand_total` from `sales`, but `sales` has no `grand_total` column, causing PostgREST 400 and classifying 85 sales rows as unknown.
  - Build/cache bumped from 317 to 318.
- Verification recorded in repo history:
  - `tests/accounting_integrity_panel.test.js` added
  - lint clean
  - build bumped from 316 to 318 through the Phase 92.48 commits
- Commit `71ef2ba` completed build-sync by bumping `boot.js?v=` and `style.css?v=` to 317.

Phase 92.47 expense export date filter is fixed and shipped.

- Root cause was UTC date usage in `modules/expenses.js`.
- The fix uses Bangkok-date behavior for default filters and form/OCR dates.
- Commit: `a11bc9a`
- Verified by the previous team:
  - `node --test tests/expenses_export_filter.test.js` passed `3/3`
  - `node --test tests/*.test.js` passed `777/777`
  - `npm run lint:errors` passed
- Build/cache delivery note: Phase 92.47 initially shipped without a client bump, then Phase 92.47b/92.48 bumped PWA build/cache. Current local and live build markers are 318.

Phase 92.46c accounting JE REST RLS is fixed, SQL was applied in Supabase, and verification passed.

- Commit: `cb6dbf0`
- Root cause was not the INSERT whitelist. Non-admin INSERT worked with `return=minimal`.
- Real blocker was PostgREST SELECT-back after insert (`return=representation` / `headers-only`) being blocked by admin-only `je_select`.
- Applied DB fix: add permissive `je_select_auto` SELECT policy for non-admin auto-post source headers, excluding `staff_payroll`.
- Verified after SQL apply:
  - `node scripts/diag_je_rest.js`
    - non-admin representation: `201`
    - non-admin minimal: `201`
    - non-admin headers-only: `201`
  - `npm.cmd run verify:accounting`
    - A1-A6 all PASS
    - A2 sales journal entry: `201`
    - A2b orphan count stayed `85 -> 85`
  - `npm.cmd run verify:je`
    - entry insert: `201`
    - journal lines insert: `201`

Backfill decision:

- Live backfill was intentionally skipped after dry-run/analysis because remaining rows were non-actionable skips.
- Expected remaining summary is not an open incident:
  - pre-effective rows before `2026-05-01`
  - zero-amount sale row
  - remaining counts such as `sales_without_journal=85` are treated as stable intentional/non-actionable state unless new evidence appears.

## Current Worktree Notes

As of 2026-06-01 13:45 ICT, `git status --short --branch` showed `main...origin/main` with only this `SESSION_START_SHARED.md` documentation update modified.

The previous local artifact files are now committed:

- `SKILL.md`
- `WORK_CONTINUATION_RUNBOOK.md`
- `project-patterns.md`
- `scripts/diag_je_rest.js`
- `scripts/verify_je_fix.js`

## Start-Of-Session Checklist

Run these first when taking over:

```powershell
git status --short --branch
git log -3 --pretty=format:'%h %ad %s' --date=iso
npm.cmd run lint:errors
npm.cmd test
```

For accounting/RLS work only, also run:

```powershell
node scripts\diag_je_rest.js
npm.cmd run verify:accounting
npm.cmd run verify:je
```

Use `npm.cmd` on Windows PowerShell because plain `npm` may be blocked by script execution policy.

## Operating Rules For Both Teams

- This is a live business POS. Make narrow, verified changes.
- Search before guessing. Prefer `rg`.
- Preserve Thai UI copy unless the user explicitly asks to rewrite it.
- Do not rename public IDs, localStorage keys, exported functions, cache names, event names, or DB policy names without tracing every usage.
- Do not change service worker/cache behavior unless the request is specifically about deployment/cache/offline behavior.
- Do not mark an accounting incident closed unless `verify:accounting` and `verify:je` pass against live Supabase.
- If a SQL fix must be applied, the user may need to run it in Supabase SQL Editor. The local `.env` has anon/user credentials, not a postgres/service-role DDL path.
- When committing, stage only files relevant to the current task. Leave unrelated dirty files alone.

## Good Next Actions

If opening a new session with no new user request:

1. Verify the live app build markers on `boonsook-pos-v5.pages.dev` if deployment freshness matters: `data-app-build="334"`, `main.js?v=334`, `style.css?v=334`, `boot.js?v=334`, and `sw.js` cache `v334`.
2. If the user wants a project monitor automation, use this file as the source-of-truth prompt context.

## Short Human Summary

Latest app build is 334 on `main`. Phase 92.64 balances the sale VAT journal split (Dr=Cr rounding via splitSaleVatLines). Phase 92.63 fixes finance-audit quick wins (profit_report stored-XSS, profit reports UTC→Bangkok TZ, payroll failed-side-effect audit logging). Phase 92.62 fixes recurring-expense bugs (missing JV, duplicate generation, UTC timezone). Phase 92.61 fixes a refund over-/double-refund money+stock leak (client cap + applied DB trigger). Phase 92.60 is a premium visual refresh of the HR Overview page — visual-only. Phase 92.59 (Codex) adds a period-close readiness gate (accounting); Phase 92.58 (Codex) POS money audit fixes. Phase 92.57 adds a "พิมพ์ / PDF" button (browser-native print) to the HR report. Phase 92.56 adds a department-level summary table (+ export) to the HR report section. Phase 92.55 adds a per-employee Timesheet tab (daily in/out/hours/punctuality for the month) in the HR employee modal. Phase 92.54 adds a from/to date-range picker to the Monthly HR report (re-fetches only that range, re-renders only the report section). Phase 92.53 adds the Monthly HR report (one row per employee: days worked / hours / OT / late / early-leave / leave days, with Excel export) in HR Overview — read-only. Phase 92.52 adds HR punctuality follow-ups (period summary + Excel columns, self-view chips, dashboard "พนักงานมาสายบ่อย", grace-change audit log) — informational only. Phase 92.51 (Codex) adds the Period Close Checklist (accounting, read-only, build 321). Phase 92.50 adds the HR executive dashboard; Phase 92.49 adds HR late/early-leave attendance exception rules. All client-only, no payroll/leave/accounting/RLS/SQL impact. Phase 92.48 adds the accounting integrity status panel and hotfixes the orphan fetch to `select=*`. Expense export timezone bug is fixed and delivered through later PWA cache bumps. JE REST RLS is fixed and live-verified after SQL apply. Remaining accounting orphan counts are currently understood as intentional/non-actionable skips, not an active failure. Start new work from `git status`, avoid touching unrelated user work, and verify with `npm.cmd` commands on Windows.
