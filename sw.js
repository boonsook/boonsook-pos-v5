// Boonsook POS V5 Service Worker
// v300 (2026-05-26): Phase 92.38 — Calendar Leave View. หน้า "วันลา" รองรับ 2 มุมมอง: ตาราง (default คงเดิม) และ ปฏิทิน — toggle ใน filter bar. Desktop calendar = 7-col grid (อา–เสาร์, Sun-first), 6 แถว, แสดง events เป็น chip สีตามประเภท (พักร้อน/ป่วย/กิจ/ไม่รับค่าจ้าง/อื่นๆ) + pending=dashed border + rejected/cancelled=faded; cell มี today highlight + weekend สีแดง; overflow >3 → "+N เพิ่มเติม" → day-list popover. Mobile (≤720px) = agenda list รายวัน group เฉพาะวันที่มี event + dow label ไทย. Leave หลายวัน expand แบบ daily แต่ละ cell แสดงรายการ พร้อม suffix "(ต่อ)" บนวันที่ไม่ใช่วันเริ่ม. Leave ข้ามเดือน clip เฉพาะวันใน month ที่ดู (expandLeaveRangeToMonthDays). Click event chip → popover รายละเอียด + ปุ่ม approve/reject/cancel/edit/delete ตาม role + canEditLeave/canReviewLeave guard. View toggle ใช้ filter เดียวกัน (month/status/type) → คงสอดคล้องระหว่าง views. Non-admin เห็นเฉพาะของตัวเอง (client filter + RLS server-side). ไม่แตะ DB schema / RLS / payroll flow / Leave Balance helpers — เพิ่ม 3 pure helpers (expandLeaveRangeToMonthDays, groupLeavesByDate, getCalendarMonthGrid) testable, all Asia/Bangkok TZ. Tests +20 (expand 7 + group 6 + grid 7). Unit 595→615.
// v299 (2026-05-26): Phase 92.37 — Payroll Save + Leave Deduction Finalization Audit. Verified _savePayroll flow persists deductions + note marker as expected and reopen edit restores values. UX polish: when prNote already contains a "หักลา ... วัน" marker (existing record reopened OR after first apply), the "→ เติมลงช่องหัก" button becomes disabled with label "✓ เติมแล้ว" and a yellow info box appears ("ⓘ ตรวจพบรายการหักวันลาแล้ว ...") instead of hiding the apply row — admin can still see the policy breakdown and verify deductions. _refreshLeaveDecision now re-evaluates marker presence so editing prBase/prDailyRate/prDailyToggle/prNote toggles the guard live (deleting marker from note re-enables apply). Tests +5 (idempotency edge cases: smoke roundtrip, decimal markers, manual notes without marker, null/whitespace safety, exact-vs-regex priority). No SQL, no payroll math change, no auto-deduction; behavior unchanged for first-time apply.
// v298 (2026-05-26): Phase 92.36b — HOTFIX Payroll leave deduction idempotency. The 92.36 apply button guarded with exact note.includes(marker), but production showed duplicate apply could add the same leave deduction again (800→1600) when the note marker format drifted. New hasLeaveDeductionNoteMarker(note, marker) treats any existing "หักลา ... วัน" marker as already applied before adding. No SQL, no payroll math change, no auto-deduction.
// v296 (2026-05-26): Phase 92.35 — Leave Policy + Balance/Quota Foundation. ใหม่ supabase-phase92-35-leave-policies-balances.sql: 2 ตาราง — leave_policies (PK=leave_type, annual_quota, tracks_balance, description) + staff_leave_overrides (id, user_id uuid, leave_type, annual_quota, effective_year, UNIQUE(user_id,leave_type,effective_year)) + 4 CHECK + 2 indexes + 2 updated_at triggers + 8 RLS policies (policies: all read · admin write; overrides: admin all + user select own) + seed 5 defaults (vacation 10/sick 30/personal 3/unpaid null/other null) + NOTIFY + verify. Re-run safe. modules/leave_management.js: +9 helpers — defaultLeavePolicies, effectiveQuotaForUser (override > policy > default), calcLeaveBalance (used/pending/remaining/overQuota/willExceed), calcBalancesForUser, isOverQuotaWarning, formatBalanceLabel, fetchLeavePolicies (graceful NO_TABLE), fetchLeaveOverridesForUser. UI หน้าวันลา: section '💼 Balance / Quota' ใต้ KPI · admin dropdown เลือก user · 5 cards แสดง used/quota + pending + remaining + chip สี (เขียว/ส้ม/แดง) · ป้าย default ถ้ายังไม่รัน SQL · Form modal: warning เกิน quota (advisory, ไม่ block) recompute on user/type/days. Payroll modal: ปุ่มดึงสรุปวันลาเพิ่ม advisory balance ทั้งปี (5 cards) — ไม่หักเงิน vacation/sick/personal เหมือนเดิม, unpaid logic เดิม. ไม่ regression Time Clock self responsive (build 295). Tests +28 (defaultPolicies 1 + effectiveQuota 6 + calcBalance 5 + balancesForUser 4 + isOverQuotaWarning 4 + formatBalanceLabel 5 + fetch 3). Unit 548→576. Lint 0/0.
// v295 (2026-05-26): Fix Time Clock self-service responsive layout. Desktop now uses a wider operational shell; mobile uses a single-column layout with table scrolling contained inside the history block. No DB or attendance logic changes.
// v294 (2026-05-26): Phase 92.33 — Leave → Payroll Integration (advisory + optional apply). modules/leave_management.js: เพิ่ม 3 helpers ใหม่ — (1) summarizeApprovedLeavesForPayroll(leaves) → {totalApprovedDays, unpaidDays, sickDays, personalDays, vacationDays, otherDays, records} (skip non-approved, skip invalid days, ปัด 2 ตำแหน่ง); (2) calcUnpaidLeaveDeduction({unpaidDays, dailyRate, baseSalary}) → dailyRate priority 1, baseSalary÷30 fallback, ปัด 2 ตำแหน่ง, invalid→0; (3) fetchApprovedLeavesForUser(userId, fromDate, toDate) → {ok:true,rows} หรือ {ok:false,code:NO_TABLE/BAD_INPUT/NO_CONFIG/HTTP} graceful ไม่ throw — overlap query (start<=toDate AND end>=fromDate). modules/payroll.js: import helpers + เพิ่ม section ใหม่ใน modal ก่อน Time Clock section — 'วันลาในรอบเดือน' (สีส้ม) มีปุ่ม 'ดึงสรุปวันลา' → fetch approved overlap เดือนนั้น → แสดง breakdown (ป่วย/กิจ/พักร้อน/ไม่รับค่าจ้าง/อื่น ๆ); ถ้ามี unpaidDays > 0 → คำนวณ suggested deduction + แสดง 'แนะนำหัก: ฿X' + source description + ปุ่ม 'เติมลงช่องหัก' (additive — บวกค่าเดิม, ไม่ทับ; ต่อ note 'หักลาไม่รับค่าจ้าง N วัน' idempotent; trigger recalc total). recompute suggestion เมื่อแก้ base_salary/daily_rate/daily_toggle. graceful NO_TABLE → warning 'ยังไม่ได้ติดตั้งตารางวันลา (รัน supabase-phase92-32-leave-management.sql)' ไม่ crash. ★ Advisory only — admin ต้องกด apply เอง, ไม่ auto-mutate, vacation/sick/personal แสดงข้อมูลเฉย ๆ ไม่หักเงิน. ไม่แตะ DB schema / RLS / money math เดิม / payroll save logic / dep ใหม่. Tests +12 (summarize 5 + calcDeduction 5 + fetch 2). Unit 536→548. Lint 0/0.
// v293 (2026-05-26): Phase 92.32 — Leave Management Foundation. ใหม่: ตาราง staff_leaves (id, user_id uuid→auth.users, leave_type sick/personal/vacation/unpaid/other, start_date, end_date, days_count numeric, reason, status pending/approved/rejected/cancelled, reviewed_by, reviewed_at, review_note, created_by, created_at, updated_at) + 4 CHECK constraints + 5 indexes + updated_at trigger + 4 RLS policies (admin all · user select+insert+update own pending · admin only delete) + NOTIFY pgrst + verify queries. supabase-phase92-32-leave-management.sql ต้องรันก่อนใช้ฟีเจอร์. modules/leave_management.js ใหม่: pure helpers (calcLeaveDays, leaveTypeLabel, leaveStatusMeta, filterLeaves, summarizeLeaves, canEditLeave, canReviewLeave) + admin/self view (KPI: pending/approved/rejected/approvedDays + filter เดือน+status+type + table approve/reject/cancel/delete buttons + create form modal + Export Excel). graceful ถ้าตารางยังไม่มี (renderError 'ยังไม่ได้รัน SQL staff_leaves' + retry). main.js + index.html: route 'leave_management' ใน HR group หลัง 'ลงเวลาทำงาน' · ROLE_PAGES: admin+sales+technician เข้าได้ (RLS server-side คุม self-scope). hr_overview.js integration: detectExceptions รับ pendingLeaves → alert 'คำขอลารออนุมัติ N รายการ' (medium severity) + alertActionFor('pending_leaves') → leave_management · fetchPendingLeaveCount() ใน leave_management graceful 0 ถ้าไม่มีตาราง. ไม่แตะ payroll/time_clock write behavior, money math, RLS เก่า, ไม่เพิ่ม dep. Tests +32 (leave_management 29 + hr_overview pending_leaves 3). Unit 504→536. Lint 0/0.
// v292 (2026-05-26): Phase 92.31 — HR Overview Department/Role Filters. modules/hr_overview.js: เพิ่ม secondary filter bar (department dropdown + role chips + ปุ่มล้างตัวกรอง) ทำงานร่วมกับ status filter เดิม. (1) Department dropdown: 'ทุกแผนก' + แต่ละแผนกพร้อม count + 'ไม่ระบุแผนก' (__none__) สำหรับ profile ที่ไม่มี department_id. (2) Role segmented chips: ทั้งหมด/Admin/Sales/Technician/อื่น ๆ พร้อม count — ซ่อน bucket ที่ว่างยกเว้น 'all' และ active. (3) Cascade counts: dept counts ใช้ rows ทั้งหมด · role counts หลัง dept filter · status counts หลัง dept+role filter — เลขสะท้อนสถานะจริง. (4) Summary label เหนือตาราง: 'แสดง X จาก Y คน · แผนก: Z · Role: W · สถานะ: V'. (5) ปุ่ม '✕ ล้างตัวกรอง' แสดงเฉพาะเมื่อ filter ไม่ใช่ default. (6) Empty state เปลี่ยน 'ไม่มีพนักงานในสถานะที่เลือก' → 'ไม่พบพนักงานตามตัวกรองนี้'. (7) Export filename ใช้ buildHrExportFilename สร้าง suffix เช่น 'hr_overview_2026-05-26_dept-12_role-technician_working.xlsx' + sanitize ตัวอักษรอันตราย (\\/:*?\"<>| + control chars + whitespace + double underscores). KPI ด้านบนยังเป็นทั้งองค์กรเหมือนเดิม (option A). Modal employee drill-down ทำงานเหมือนเดิม. Pure helpers +6: filterHrRows, countDepartmentBuckets, countRoleBuckets, isDefaultHrFilters, filterSummaryLabel, buildHrExportFilename. Tests +26 (filterHrRows 7 + countDept 3 + countRole 3 + isDefault 3 + summary 4 + filename 6). Unit 478→504. Lint 0/0. ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior.
// v291 (2026-05-26): Phase 92.30 — HR Employee drill-down Modal. modules/hr_overview.js: คลิกแถวพนักงาน (ไม่ทับปุ่ม action) → เปิด modal รายละเอียดพนักงาน 3 tabs. Modal header: ชื่อ + role chip + แผนก + email + สถานะวันนี้ + เข้า/ออก/ปกติ/OT mini-KPI. Tabs: (1) 📍 วันนี้ — clock in/out + ปกติ/OT/รวม + GPS distance (ใน/นอกพื้นที่) + notes; (2) 📅 7 วันล่าสุด — table groupAttendanceLast7Days (7 entries เรียงใหม่→เก่า, วันที่ไม่มีบันทึก = ไม่มีบันทึก, open session highlight ส้ม) + summary รวม regular/OT/total 7 วัน — lazy fetch ตอนเข้า tab (cache per userId); (3) 💰 เงินเดือน — base/ot/welfare/bonus/commission/deductions/total + paid/unpaid chip + วันที่จ่าย/method + note + ปุ่มไปหน้า Payroll. Modal: max-width 860px, mobile responsive (width:calc(100% - 24px)), Esc + backdrop คลิกเพื่อปิด, body scroll lock, role=dialog/aria-modal. Pure helpers +5: formatDistanceLabel (radius-aware), groupAttendanceLast7Days, employeePayrollSummary (match employee_id===profile.id), buildEmployeeModalSummary, modalTabFor (validate key). Event delegation: row click skip ถ้า target ใน button/[data-hr-action]; modal route buttons → close modal + showRoute. Tests +19 (formatDistanceLabel 4 + groupAttendanceLast7Days 4 + employeePayrollSummary 5 + buildEmployeeModalSummary 3 + modalTabFor 3). Unit 459→478. Lint 0/0. ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior — read-only drill-down เท่านั้น.
// v290 (2026-05-26): Phase 92.29 — HR Overview polish + filters + actionable alerts. modules/hr_overview.js: (1) status filter bar เหนือตาราง (segmented buttons: ทั้งหมด/ยังไม่เข้า/กำลังทำงาน/ออกแล้ว/ต้องตรวจสอบ) แสดง count ในปุ่ม + filter in-memory ไม่ refetch DB, default "all", empty state "ไม่มีพนักงานในสถานะที่เลือก". (2) Role chip สี: admin=ม่วง / sales=ฟ้า / technician=เขียว / fallback=เทา. (3) Status wording: abnormal "ผิดปกติ"→"ต้องตรวจสอบ". (4) Row action label dynamic ตาม status: not_in="▶️ ลงเวลา" / working/abnormal="⏱️ จัดการเวลา" / out="👁️ ดูเวลา" (ทุกปุ่มไป time_clock). (5) Alert มีปุ่มไป route ที่เกี่ยว: stale_session="เปิด Time Clock" / geofence_out="ตรวจรายการลงเวลา" / unpaid_payroll="ไปจ่ายเงินเดือน" / offline_pending="ไป Sync" (event delegation, ไม่มี inline onclick). (6) KPI Payroll คลิกได้เมื่อมีค้าง (kpi.payrollUnpaid>0) + Offline Queue card คลิกได้ → time_clock. (7) Quick actions reorder: ลงเวลา/เงินเดือน/ภาพรวมเงินเดือน/แผนก/ประวัติ/Export + label สั้นลง. (8) Export ตาม activeFilter (filename suffix _status). Pure helpers +5 (countStatusBuckets, filterRowsByStatus, rowActionLabel, roleChipMeta, alertActionFor). Tests +21 (countStatusBuckets 4 + filter 4 + rowActionLabel 4 + roleChipMeta 4 + alertActionFor 5). Unit 438→459. Lint 0/0.
// v289 (2026-05-26): Phase 92.28 — ภาพรวม HR / HR Center. modules/hr_overview.js ใหม่: read-only dashboard รวม Time Clock + Payroll + Departments + Profiles ในหน้าเดียว (admin only). KPI cards (พนักงานทั้งหมด/เข้างานวันนี้/ยังไม่ลงเวลาออก/OT เดือนนี้/Payroll/Offline queue), 'สิ่งที่ต้องจัดการวันนี้' (alerts: stale_session/geofence_out/unpaid_payroll/offline_pending), ตารางสถานะวันนี้ (เรียงตามสถานะ working→abnormal→out→not_in), Quick actions + Export Excel. Pure helpers ที่ test ได้: classifyAttendanceStatus, aggregateHrKpi, detectExceptions, indexAttendanceByUser. Reuse helpers จาก time_clock.js (workDateBangkok/timeBangkok/computeRegularOT/sumRegularOT/shiftHoursFromState/profileDisplayName/offlinePendingCount). Sidebar: 📊 ภาพรวม HR ก่อน 'ตั้งค่าแผนก' ใน HR group. main.js: เพิ่ม hr_overview ใน ALL_ROUTES (admin only via ROLE_PAGES) + LAZY_ROUTES + page title. ไม่แตะ DB schema, ไม่แตะ money math, ไม่แตะ payroll/time_clock behavior. Tests +22 (classify 6 + aggregate 5 + detect 7 + index 4). Unit 416→438. Lint 0/0.
// v288 (2026-05-24): Phase 92.27b — HOTFIX time_clock dropdown ว่าง. state.allProfiles ถูก load โดย loadUsers() ที่ trigger เฉพาะตอนเปิด Settings → ตั้งค่าผู้ใช้งาน. ถ้า admin เข้า Time Clock ตรง ๆ โดยไม่ผ่านหน้านั้น → allProfiles ว่าง → dropdown แสดง "ยังไม่มีผู้ใช้" + ตารางรายงานแสดงชื่อเป็น "—". แก้: เพิ่ม _ensureProfilesLoaded(state) ที่ fetch จาก profiles_with_email VIEW (fallback profiles) ถ้า state.allProfiles ว่าง — เรียกที่ตอนเริ่ม _renderManagerView + _renderSelfView. RLS filter เองถ้า role ไม่มีสิทธิ์อ่าน. ไม่แตะ DB schema. Lint 0/0, unit 416 (ไม่เปลี่ยน).
// v287 (2026-05-24): Phase 92.27 — Offline queue (IndexedDB). modules/_offline_queue.js: IndexedDB wrapper (DB 'boonsook-offline-queue', store 'queue') + helpers enqueue/listAll/remove/bumpAttempt/count/clear + isOfflineLike (TypeError 'Failed to fetch' / navigator.onLine=false) + generateClientUuid (crypto.randomUUID with fallback). time_clock.js: _insertClockIn + _patchClockOut wrap fetch in try/catch — เน็ตหลุด → OfflineQueue.enqueue + throw code='QUEUED'. Handlers (manager + self clock-in/out) จับ 'QUEUED' → toast 'ออฟไลน์ — เก็บคิวไว้ จะ sync เมื่อกลับมา online'. ใหม่ syncOfflineQueue() drain queue (POST/PATCH ทุก item, 409 idempotency = success-drop, fail = bumpAttempt). offlinePendingCount() count. Manager view header แสดง '📥 Sync ออฟไลน์ (N)' badge ถ้า pending > 0. Auto-sync on render หน้า: ถ้า online + pending > 0 → drain (guarded by window._tcSyncing flag). client_uuid generate ทุก clock-in (idempotency key ใช้ทั้ง online + offline path — DB partial UNIQUE กัน double-insert ตอน sync). Tests +7 (isOfflineLike + generateClientUuid uniqueness/v4 shape). Unit 409→416. Lint 0/0.
// v286 (2026-05-24): Phase 92.24 — GPS geo-fence. modules/time_clock.js: new helpers haversineMeters(lat1,lng1,lat2,lng2) + geofenceFromState(state) (config จาก storeInfo.shopLat/Lng/geofenceRadiusM, default radius 200m, null ถ้าไม่ตั้ง = ปิด feature) + getCurrentPosition(opts) (Geolocation API wrapper, 8s timeout, return null ถ้า denied/unsupported). Clock-in/out (manager + self) capture GPS ถ้ามี geofence config → ส่งให้ insertClockIn/patchClockOut → บันทึก clock_in_lat/lng/distance_m (schema reserve cols จาก Phase 92.22). _captureGpsAndWarn helper: ถ้าเกิน radius → toast warn (ไม่ block — record ยังถูกบันทึก). modules/settings/store.js: section ใหม่ 'ตำแหน่งร้าน (GPS)' — input Lat/Lng/Radius + ปุ่ม 📍 'ใช้ตำแหน่งปัจจุบัน' (Geolocation API ฝั่ง Settings). storeInfo persist ผ่าน app_settings JSON เดิม — ไม่แตะ DB. Tests +9 (haversine: 0m / 1° lat / 1° lng / cos rule lat=60° / invalid; geofenceFromState: default/custom/missing/partial/invalid). Unit 398→409. Lint 0/0.
// v285 (2026-05-24): Phase 92.26 — Payroll integration (OT auto-fill จาก Time Clock). modules/payroll.js: เพิ่ม section 'ดึงจาก Time Clock' ใน modal เพิ่ม/แก้ payroll. กดปุ่ม 📥 ดึงสรุป → fetchUserAttendanceSummary ของพนักงาน+เดือนนั้น → แสดง 'ปกติ X.X / OT Y.Y ชม. (Z records)'. เปิด section คำนวณ: ค่า OT/ชม. (เดาจาก daily_rate÷8) × ตัวคูณ (default 1.5) = บาท → ปุ่ม → เติม ลงช่อง ค่าล่วงเวลา. modules/time_clock.js: export fetchUserAttendanceSummary(userId, fromDate, toDate, shiftOpts) — reuse _fetchAttendance + sumRegularOT + count records, graceful NO_TABLE. ไม่แตะ DB. Lint 0/0, unit 398.
// v284 (2026-05-24): Phase 92.25b — Settings page เพิ่มชั่วโมงทำงาน (shift hours config). Admin set startHour/endHour ใน Settings → ข้อมูลร้านค้า ใหม่ 2 fields (default 08:00-17:00). time_clock.js เพิ่ม helper shiftHoursFromState(state) อ่านจาก state.storeInfo (fallback default 8/17, clamp 0-23, fallback ถ้า start >= end) — ส่งให้ computeRegularOT/sumRegularOT ทุกที่. ไม่แตะ DB — storeInfo persist ผ่าน app_settings JSON ที่มีอยู่แล้ว. Header รายงาน + self-service summary แสดงช่วงกะตามที่ตั้ง. Tests +5 (shiftHoursFromState: default/missing/invalid/inverted/string). Unit 393→398. Lint 0/0.
// v283 (2026-05-24): Phase 92.25 — OT auto-detect + Admin edit attendance. New pure helpers: computeRegularOT(row, {startHour:8, endHour:17}) splits hours into regular/OT (before 08:00 or after 17:00 = OT). sumRegularOT aggregates. Manager report adds 3 columns (ปกติ/OT/รวม) with orange highlight on OT > 0, plus ✏️ edit button per row. New _openEditAttendanceModal lets admin edit clock_in_at/clock_out_at/notes via datetime-local inputs (Bangkok TZ conversion via isoToBangkokInput + bangkokInputToIso helpers). PATCH staff_attendance + best-effort logActivity("edit_attendance", {entityType:"staff_attendance", entityId, summary, metadata:{old,new}}) for audit trail. Self-service week summary shows 3 columns (ปกติ/OT/รวม). Export Excel adds 3 columns. Rules hardcoded 08:00-17:00 — settings page deferred. Tests +15 (computeRegularOT 12 + sumRegularOT 2 + edge). Unit 378→393. Lint 0/0.
// v282 (2026-05-24): Phase 92.22e — pivot Time Clock from staff table to profiles/auth.users. User pointed out the Settings → ตั้งค่าผู้ใช้งาน page has 4 user accounts but my Phase 92.22 dropdown was reading from staff table (had only 1 row). Per user choice, refactored to use state.allProfiles (loaded at boot) filtered by role≠customer. DB migration: supabase-phase92-22e-use-profiles.sql DELETEs test data, DROPs staff_id column, ADDs user_id uuid REFERENCES auth.users(id), recreates 2 indexes (user_date + one_open_session_user) and 4 RLS policies (simpler: user_id = auth.uid() instead of EXISTS subquery on staff). modules/time_clock.js fully rewritten: _staffProfiles from state, _fetchAttendance/insertClockIn/patchClockOut use user_id, _renderSelfView uses auth.uid() directly (no email auto-claim — profile.id = auth.uid() is the same uuid). Self-service flow now works for any logged-in non-customer user immediately. Removed canAutoClaim, _findStaffByEmail, _claimStaff. modules/staff.js: reverted email field add (no longer needed). Tests: -7 canAutoClaim, +5 profileDisplayName (display name fallback chain). Unit 380→378. Lint 0/0.
// v281 (2026-05-24): Phase 92.22d — fix Export CSV TypeError in time_clock manager view. exportToExcel signature is (filename, rows, sheetName) but time_clock.js was calling (data, filename) — swapped. xlsx.json_to_sheet(filename) treated the filename string as rows, then tried filename.forEach() → "r.forEach is not a function". Now matches the pattern used by payroll/expenses/delivery_invoices/accounting modules. Also changed extension .csv → .xlsx to match what XLSX.writeFile produces. Lint 0/0, unit 380.
// v280 (2026-05-24): Phase 92.22c — fix admin sidebar missing "🕒 ลงเวลาทำงาน". main.js ALL_ROUTES (admin allowedPages) didn't include "time_clock" — I only added it to ROLE_PAGES.sales/technician but admin gets ALL_ROUTES which is a static list, not Object.keys(LAZY_ROUTES). Sidebar JS hid the button silently. Adds "time_clock" to ALL_ROUTES so admin sees the menu. No behavior change for non-admin (already had the route in their ROLE_PAGES). Lint 0/0, unit 380.
// v279 (2026-05-24): Phase 92.22b — fix About page version display drift. Previously modules/settings/pages.js hardcoded "Version: 5.47.8" / "Release: May 2026 (build 274)" — was last bumped at Phase 92.18 and never updated through 92.19/92.20/92.21/92.22/92.22-hotfix (5 phases drift). Now dynamic: index.html adds data-app-version="5.48.2" to selfheal.js script tag, selfheal.js exposes window.APP_VERSION (mirror of APP_BUILD pattern), pages.js reads both globals + escHtml. Version sync 4 sub-items kept the same — pages.js no longer counts as a 5th item to bump manually. Lint 0/0, unit 380.
// v278 (2026-05-24): Phase 92.22 HOTFIX — staff.id in prod is uuid (not bigint as initially assumed). Fixes (1) supabase-phase92-22-time-clock.sql: staff_attendance.staff_id changed bigint -> uuid (closes Postgres error 42804 "foreign key constraint cannot be implemented: incompatible types bigint and uuid"). (2) modules/time_clock.js: remove Number() cast on tcStaffSelect.value (would yield NaN for uuid) — use trim()/string passthrough. attendance.id stays bigserial; clock-out-id Number() cast unchanged. SQL re-run safe (IF NOT EXISTS). No unit test change needed (tests use pure helpers). Lint 0/0, unit 380.
// v277 (2026-05-24): Phase 92.22+92.23 — Time Clock (Foundation + Self-service). New module modules/time_clock.js: admin manager flow (dropdown staff + clock in/out + active sessions card + history report + CSV export) and self-service flow (sales/technician with linked staff: own clock in/out + week summary + 7-day history). DB migration supabase-phase92-22-time-clock.sql adds staff.user_id (FK auth.users) + staff.email (unique) + staff_attendance table (work_date, clock_in_at, clock_out_at, GPS cols reserved for 92.24, client_uuid for 92.27 idempotency, source admin/self/queued) + RLS policies (admin all + staff own via user_id) + partial unique index gating "one open session per staff". Auto-claim flow: staff row with email matching auth.user().email gets user_id set on first visit. Sidebar adds 🕒 ลงเวลาทำงาน under บุคลากร/HR. ROLE_PAGES.technician/sales include time_clock. Email field added to staff modal (modules/staff.js). Tests +24 (time_clock.test.js — pure helpers: workDateBangkok TZ, workHours, clockState, sumWorkHours, canAutoClaim case-insensitive+null-safe). Unit 356→380.
// v276 (2026-05-24): Phase 92.21 — guard race-condition on async badge click handlers. Adds `if (!btn.isConnected) return;` after the await in two acct-trace handlers (modules/sales.js line ~167, modules/audit_log.js line ~163) so that if the list re-renders while findJournalForSale is pending, the handler bails before mutating/replacing the orphan button. Closes the GH-scanner "Possible race condition: btn.disabled/textContent might be assigned based on an outdated state of btn" annotations. No behavior change for the normal (non-racy) flow. No tests changed (unit still 356).
// v275 (2026-05-24): Phase 92.20 — JV drawer deep-link from 3 trace surfaces. New navigateToJv(jvId) in sale_trace.js: dynamic-imports journals.js → setPendingJvId() → showRoute('accounting_journals') → journals.js consumes pending after entries load → _openJvDrawer of that JV opens automatically. Wired into sales list, receipt drawer (closeAllDrawers first), and audit log. 1-shot pending (cleared on consume + on fetch error). No posting/auto_post/money/stock/loyalty/RLS/SQL change. Tests +6 (unit 356).
// v274 (2026-05-22): Phase 92.18 — audit-log accounting trace for deleted POS sales. (1) sales.js soft-delete now writes a best-effort logActivity('delete_sale', entityType:'sale', entityId:saleId) — never fails the delete. (2) audit_log.js shows a "📒 ดูบัญชี" button on sale-deletion rows → on-demand findJournalForSale (source_table='sales'+source_id) → found=กดไปสมุดรายวัน / missing="ยังไม่ลงบัญชี" / error="ตรวจบัญชีไม่ได้". Sale id taken ONLY from entity_type==='sale'+entity_id (no guessing). No posting/auto_post/money/stock/loyalty/RLS/SQL change.
// v273 (2026-05-22): Phase 92.17 — forward accounting trace. New read-only helper modules/accounting/sale_trace.js (findJournalForSale by source_table='sales'+source_id; renderSaleTraceBadge). Wired into sales list (on-demand "📒 บัญชี" button) + receipt drawer (เอกสารบัญชี section). found→กดไปสมุดรายวัน; missing→"ยังไม่ลงบัญชี"; error→ไม่เงียบ. No posting/auto_post/money/RLS/SQL change.
// v272 (2026-05-22): Phase 92.16 — console noise audit. Demoted 3 expected "loyalty reverse skipped/attempt" diagnostics from console.log to console.info (sales.js x2, refunds.js x1). No money/stock/JV/loyalty behavior change; logging only. auto_post created/voided + loadAllData-timeout-after-committed-delete were already at correct levels.
// v271 (2026-05-22): Phase 92.15 — sale delete refresh resilience. After a committed soft-delete, modules/sales.js now mirrors the [ลบแล้ว] note into local state.sales + re-renders immediately, so the row disappears even if the background loadAllData() times out (timeout downgraded to warning-only). No money/stock/JV/loyalty side-effect change.
// v262 (2026-05-20): Phase 92.6 hardening (3 review findings) — (1) loadHtml2Canvas dedupes concurrent callers via in-flight promise cache (no duplicate <script> on double-click Share); (2) syncAppLogo early-exits when stored logo URL already matches (no redundant boot repaint/setItem); (3) syncAppLogo strips CR/LF from accessToken before Authorization header (defense-in-depth). modules/lazy_libs.js + modules/branding.js only.
// v261 (2026-05-20): Phase 92.5 HOTFIX — html2canvas CDN (cdnjs.cloudflare.com) was blocked by production CSP → Share/PDF stuck on "กำลังสร้าง PDF..." forever. Switched HTML2CANVAS_CDN_URL to cdn.jsdelivr.net (CSP-allowed). Also: _appShareDoc now captures loadHtml2Canvas() result + on failure shows a toast and closes cleanly instead of hanging.
// v260 (2026-05-20): Phase 92.4 — Extracted html2canvas lazy loader _loadHtml2Canvas() from main.js to new modules/lazy_libs.js (loadHtml2Canvas). Resolve true/false contract preserved exactly; only addition is a logger.warn on CDN load failure (was silent). main.js keeps thin _loadHtml2Canvas() wrapper.
// v259 (2026-05-20): Phase 92.3 — Extracted Supabase Storage logo pull _appSyncLogo() from main.js to modules/branding.js (syncAppLogo). HARDENED: list fetch now has an AbortController timeout (default 8s; original had none = could hang) + failures logged via injected logger instead of swallowed. localStorage cache still serves logo on failure. window._appSyncLogo kept as thin wrapper binding config+token.
// v258 (2026-05-20): Phase 92.2 — Extracted logo source resolver getAppLogo() from main.js to modules/branding.js (zero-behavior refactor). Priority chain state.storeInfo.logoUrl > localStorage > default; state injected. window._appGetLogo kept as thin wrapper binding live state. _appSyncLogo still in main.js (couples to SUPABASE_CONFIG/token).
// v257 (2026-05-19): Phase 92.1 — Extracted updateAppLogos() from main.js to modules/branding.js (zero-behavior refactor). _appGetLogo / _appSyncLogo stay in main.js for now (couple to state/SUPABASE_CONFIG). Window.App + window.updateAppLogos contracts preserved via thin wrapper.
// v256 (2026-05-19): Phase 91.4 HOTFIX — refund/cancel reverse-loyalty wiring was gated on sale-row customer_id (opt-in column). Helper auto-resolves from earn record — removed the pre-check. Added diagnostic log so future smoke explains itself.
// v255 (2026-05-19): Phase 91.3 — Refund/cancel reverse loyalty auto-earn. Idempotent helper inserts type='redeem' + ref_type='sale_reverse'. Caps at remaining (no negative balance). Wired into modules/refunds.js (after JV post) and modules/sales.js soft-delete (alongside void JV + revert stock).
// v254 (2026-05-19): Phase 91.2 HOTFIX — earn formula was multiplying instead of dividing (500 baht at rate 100 = 50000 pts not 5). Centralized to calcEarnPoints(amount, settings) = floor(amount / bahtPerPoint).
// v266 (2026-05-21): Phase 92.10 CAPSTONE — extract boot orchestration to modules/boot.js via runBoot({...deps}) dependency injection. main.js is now side-effect-free (no self-invoking IIFE on load); boot.js does not import main.js (no circular). Decomposition series 92.1-92.10 COMPLETE.
// v265 (2026-05-20): Phase 92.9 — extract XHR/API data layer (refreshAccessToken/appAuthFetch/xhrPost/xhrPatch/xhrDelete) to modules/api.js via createApi factory (closure preserves single-flight + 401-retry recursion; 13 callers via window._app* wrappers; byte-identical)
// v264 (2026-05-20): Phase 92.8 — extract Thai-locale formatters (money/formatNumber/formatCurrency/formatDate/formatDateTime) to modules/utils.js (byte-identical; caller compat via import binding)
// v263 (2026-05-20): Phase 92.7 — extract _appShareDoc Share/PDF overlay to modules/share_doc.js (thin window wrapper; behavior byte-identical)
// v253 (2026-05-19): Phase 91.1 — POS checkout auto-earn loyalty points (fire-and-forget after sale insert; gated on customer + is_active + points_per_baht; amount = actualTotal)
// v252 (2026-05-19): Phase 90.13 — Loyalty history modal click-outside listener leak: bind once in renderLoyaltyPage instead of re-attach on every showPointHistory call
// v295 (2026-05-26): Fix Time Clock self-service responsive layout. Desktop now uses a wider operational shell; mobile uses a single-column layout with table scrolling contained inside the history block. No DB or attendance logic changes.
// v296 (2026-05-26): Phase 92.35 — Leave Policy + Balance/Quota foundation. Adds leave_policies + staff_leave_overrides tables, pure helpers (effectiveQuota/calcBalance/calcBalancesForUser), UI balance section on Leave page, form warning advisory, payroll year-balance preview. No money math change.
// v297 (2026-05-26): Phase 92.36 — Paid Leave Policy → Payroll Decision. Adds decidePayrollLeaveImpact + leaveDeductionNoteMarker pure helpers; Payroll modal now shows policy breakdown (paid/over/unpaid/other) and Apply fills deduction = unpaid + over-quota (advisory; idempotent via marker). vacation/sick/personal within quota stay paid.
const CACHE_NAME = 'boonsook-pos-v5-cache-v300';
const OFFLINE_PAGE = './index.html';

// Files to pre-cache on install (only essential files)
// Phase 89.18: เพิ่ม CSS ที่ index.html อ้างถึง — เดิม offline สไตล์พังเพราะ precache ตก
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './phase4-design-system.css',
  './phase4-components.css',
  './doc-print.css',
  './main.js',
  './boot.js',
  './selfheal.js',
  './manifest.json',
  './icons/logo.svg'
];

// Install event: pre-cache core files (with graceful error handling)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ✅ Cache files individually (don't fail on missing file)
      return Promise.allSettled(
        PRECACHE_URLS.map(url => {
          return cache.add(url).catch(err => {
            console.warn(`Cache failed for ${url}:`, err.message);
            return null;
          });
        })
      );
    }).catch((error) => {
      console.error('Cache init error:', error);
    })
  );
  // Note: no auto-skipWaiting — client sends SKIP_WAITING after user clicks update banner
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: implement Network First with Cache Fallback strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // ★ Skip non-http(s) requests (เช่น chrome-extension://) ที่ cache ไม่ได้
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // API requests: Network only (don't cache)
  if (url.pathname.includes('/rest/v1/') || url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // If offline and no network, return error response
          return new Response(
            JSON.stringify({ error: 'Offline - API not available' }),
            { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // ★ Phase 34: JS modules + ai-chat-widget — bypass HTTP cache (cache: 'reload')
  // เหตุผล: import URLs ไม่มี ?v= → browser cache by URL → stale ตลอดถ้า _headers เป็น immutable
  // ใช้ cache: 'reload' บังคับ browser ดึงจาก network ทุกครั้ง (revalidate ETag)
  if (url.origin === self.location.origin && (url.pathname.startsWith('/modules/') || url.pathname === '/ai-chat-widget.js')) {
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match(request).then(r => r || new Response('Module unavailable offline', { status: 503 })))
    );
    return;
  }

  // CDN resources: Cache first
  if (isCdnResource(url.hostname)) {
    event.respondWith(
      caches.match(request)
        .then((response) => {
          if (response) {
            return response;
          }
          return fetch(request).then((response) => {
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
            return response;
          });
        })
        .catch(() => {
          return new Response('CDN resource not available', { status: 503 });
        })
    );
    return;
  }

  // Local assets: Network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request)
          .then((response) => {
            if (response) {
              return response;
            }
            // Offline fallback for HTML pages
            if (request.mode === 'navigate') {
              return caches.match(OFFLINE_PAGE);
            }
            return new Response('Resource not available offline', { status: 503 });
          });
      })
  );
});

// Helper function to detect CDN resources
function isCdnResource(hostname) {
  const cdnDomains = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'cdn.skypack.dev',
    'esm.sh',
    'cdn.plot.ly',
    'code.jquery.com',
    'maxcdn.bootstrapcdn.com'
  ];
  return cdnDomains.some((domain) => hostname.includes(domain));
}

// Message handling for cache control
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});
