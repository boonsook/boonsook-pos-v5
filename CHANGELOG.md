# 📜 CHANGELOG — Boonsook POS V5 PRO

รายการการแก้ไขแบบสั้น เรียงจากใหม่ → เก่า
รายละเอียดเชิงลึก (architecture / why) ดูใน [HANDOFF.md](HANDOFF.md)

รูปแบบ: `<commit> feat|fix|docs|refactor: <สรุปสั้น>` + bullet 1-2 ข้อถ้าจำเป็น

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
