# 📋 HANDOFF — Boonsook POS V5 PRO

> Prompt brief skill: read [`PROMPT_PHASE_BRIEF_SKILL.md`](PROMPT_PHASE_BRIEF_SKILL.md) before drafting, reviewing, or implementing phase prompts for Claude/Codex. It locks the required baseline, scope, failure semantics, tests, build/docs, and STOP marker.

**build 540 (Phase 540 / S5 — loyalty redeem atomic RPC + staff-only · BUG_AUDIT 2026-06-25 · §4.1 · ⚠️ owner-run SQL):** **Baseline:** main `abb2b0c` (build 539 — S7/S8 PR #114). **บั๊ก (verified from source `loyalty.js:295-337`):** `redeemPoints` คำนวณ `remaining` จาก `getCustomerPoints` (อ่าน `state.loyaltyPoints` = in-memory cap ≤500, racy) แล้ว `_appXhrPost('loyalty_points', {type:'redeem'})` = read-then-insert จาก client → 2 เครื่อง/แท็บแลก customer เดียวกันพร้อมกัน ผ่าน in-memory check ทั้งคู่ → balance ติดลบ (over-redeem). **★ audit-before-implement เจอ security gap ใน prompt (owner เห็นด้วย+เพิ่ม requirement):** prompt เดิมให้ RPC `SECURITY DEFINER` + `GRANT EXECUTE TO authenticated` แต่ **ไม่มี role check** → SECURITY DEFINER bypass RLS + customer (OTP) อยู่ใน role `authenticated` → ลูกค้า login เรียก RPC redeem แต้มใครก็ได้ = ข้าม phase505 `deny_customer_loyalty_points` (RESTRICTIVE, loyalty_points อยู่ GROUP A) = privilege escalation. (มีหลักฐานว่า `redeem_customer_credit` ต้นแบบ guard ที่ DB อยู่แล้ว — pos.js:1188 comment.) **แก้ (3 ไฟล์ + SQL):** (1) **`supabase-phase540-loyalty-redeem-atomic.sql`** (owner รัน): fn `redeem_loyalty_points_atomic(p_customer_id bigint, p_points numeric, p_note text)` `SECURITY DEFINER SET search_path=public RETURNS loyalty_points` — **role guard แรกสุด** `IF NOT COALESCE(public.is_staff(),false) THEN RAISE…42501` + `IF COALESCE(public.is_customer_role(),false) THEN RAISE…42501` (auth.uid() ใน DEFINER = caller จริง; ★ STEP0 พบ policy เดิม `loyalty_points_rw WITH CHECK is_staff()` → guard ต้อง require is_staff ให้ match ไม่ loosen — owner ปรับ + ผม sync source ตรง prod) → validate (`23514` ถ้า customer_id null/points≤0) → `pg_advisory_xact_lock(hashtextextended('loyalty:'||id,0))` ต่อ customer → balance = SUM(earn)−SUM(redeem) จาก DB → `remaining < p_points` → `23514` → `INSERT type='redeem', ref_type='redemption', ref_id=NULL` `RETURNING *`; `GRANT EXECUTE TO authenticated` (customer ถูกกันใน fn ไม่ใช่ที่ grant) + `NOTIFY pgrst`. STEP0 ใน SQL = inspect `pg_policy` ของ loyalty_points ก่อน (RLS on? INSERT/SELECT role? phase505 deny present?) → guard ต้อง ≥ ของเดิม. (2) **`modules/loyalty.js redeemPoints`**: เลิก direct insert → raw `fetch(cfg.url+"/rest/v1/rpc/redeem_loyalty_points_atomic")` (mirror `_redeemCheckoutCredit` pos.js:1169) body `{p_customer_id:Number(customerId), p_points:Number(points), p_note}`; `!r.ok` → parse `await r.text()` map `23514`→"แต้มไม่พอแลก" / อื่น→HTTP; success → toast+loadAllData+`{ok:true}`. **precheck `getCustomerPoints` คงไว้แต่เป็น UX เท่านั้น** (RPC = source of truth). return `{ok,error}` คงเดิม → caller `:766 if(r?.ok)` clear form ยังทำงาน. **ref_type='redemption' ตรงกับเดิม** (`:322`) ไม่ break ประวัติ; phase497 unique index `WHERE ref_type='sale_reverse'` ไม่ชน. **ไม่แตะ:** `earnPoints` (ยัง direct insert loyalty_points), `reverseEarnedPointsForSale` (clawback), checkout/credit 2180/redeem_customer_credit, stock/refund/SlipOK/OTP, RLS อื่น. **redeemPoints ถูกเรียกที่เดียว (`loyalty.js:765` manual page) ไม่เข้า checkout** (verified). **ไฟล์:** `supabase-phase540-loyalty-redeem-atomic.sql` (ใหม่, owner-run) · `modules/loyalty.js` · `tests/loyalty_redeem_atomic_guard.test.js` (ใหม่ 9 — SQL: SECURITY DEFINER/role-guard-42501-before-balance/advisory-lock/balance-23514/insert-grant · JS: rpc call+Number cast+23514 map/no-direct-insert-in-redeem/earn-untouched/form-clear-on-ok) · build 539→**540** (data-app-build + ?v=×4 + sw cache-v540 + comment + `dashboard_readonly_guard`). **Verification:** lint:errors 0 · unit **2237/2237** (loyalty_reverse_sale + pos_loyalty_auto_earn + loyalty_settings เดิมไม่ regress) · e2e **14/14** (build 540 sync) · EOL LF. **🔴 owner SQL ก่อน merge:** STEP0 inspect → apply `supabase-phase540` → `SELECT prosecdef … = true` → smoke: staff redeem ≤ balance ✓ / over-balance → 23514 / customer JWT → 42501 / `NOTIFY pgrst`. **manual smoke:** หน้า loyalty แลกแต้มลูกค้ามีแต้มพอ → ผ่าน+แต้มลดถูกหลัง reload · แลกเกิน → ไม่ผ่าน+ฟอร์มไม่ถูก clear · ไม่มี console error. **known residual (audit คงเหลือ):** S6 clawback cap · S12 bundle gross profit · S14 SlipOK key localStorage · S15 OTP KV fail-open. **Status: ✅ SQL applied prod 2026-06-28 (owner) — STEP0 policy=`loyalty_points_rw WITH CHECK is_staff()` + deny_customer present · `prosecdef=true` · smoke staff redeem✓/over→23514/customer→42501 (rows left=0) · DB_MIGRATIONS_APPLIED.md logged. SQL file ใน branch sync ตรง prod (เพิ่ม `is_staff()` guard) + guard test assert is_staff. 🔜 branch `claude/phase-540-loyalty-redeem-atomic` — รอ review/merge.**

**build 539 (Phase 539 / S7+S8 — void/delete surface failed side-effects · BUG_AUDIT 2026-06-25 · §4.8 · ✅ MERGED+LIVE `abb2b0c` PR #114):** **Baseline:** main `c50cc09` (build 538 — TZ S9/S10/S11 PR #113). **บั๊ก (verified from source):** การ์ด "best-effort ✅ หลอก" — side-effect การเงิน/สต็อกล้มเงียบ แต่ toast บอกสำเร็จ. **S7 `sales.js:268-353`** ลบบิล: (a) `voidJvForSource` (b) `_appRevertStockForSale` (c) `reverseEarnedPointsForSale` (d) `release_customer_credit` ทั้งหมด best-effort; เดิม fail → `sideEffects.push("⚠️…fail")` แต่บรรทัดสุดท้ายยัง `showToast("ลบรายการขายเรียบร้อย ✅" + sideEffectsMsg)` เสมอ → ถ้า void JV/คืนสต็อก/คืนเครดิตล้ม คนกดเห็น "✅ เรียบร้อย (⚠️ …fail)" = เข้าใจว่าโอเค. **S8 `service_jobs.js:402-418`** ลบงานช่าง: `restoreServiceJobStock` ถ้า **throw** → `catch(re){ console.error }` เฉย ๆ → `_restore` คง `{restored:false,errors:[]}` → ทั้ง `if(_restore.restored)` และ `if(_restore.errors?.length)` ไม่เข้า → ตกไป `showToast("ลบงานช่างเรียบร้อย ✅")` ทั้งที่สต็อก**ไม่คืน** (throw กลางคัน) = เงียบสนิท. **แก้ (pattern เดียวกัน, mirror `pos.js:1501 needsManualReview`):** **S7** เพิ่ม `const failures = []` — ทุก fail path เปลี่ยน `sideEffects.push("⚠️…")` → `failures.push("<label>")` (void JV/คืนสต็อก/คืนแต้ม/คืนเครดิต); ท้าย flow `if (failures.length)` → `captureMessage("sale delete side-effects failed", {saleId,failures,ok})` + `showToast("⚠️ ลบบิลแล้ว แต่ … ไม่สำเร็จ — โปรดตรวจสอบ…", "warning")` (ไม่ ✅); else → ✅ เดิม. **S8** เพิ่ม `let stockIssue=false`; catch(throw) → `captureMessage("service_job delete: restore stock threw", {jobId,error})` + warning toast + `stockIssue=true`; `_restore.errors?.length` → warning + `stockIssue=true`; ปิดท้าย `if (showToast && !stockIssue) showToast("ลบงานช่างเรียบร้อย ✅")`. **★ display/messaging เท่านั้น — ไม่แตะ side-effect execution/ลำดับ/best-effort-no-rollback** (บิล/งาน soft-delete สำเร็จแล้ว ไม่ rollback; แค่บอกความจริงว่าอะไรไม่กลับ → admin แก้มือ). **ไม่แตะ:** void JV/revert-stock/reverse-loyalty/release-credit logic (a-d) · `restoreServiceJobStock` helper · marker PATCH (413) · success-path สต็อกปกติ. **ไฟล์:** `modules/sales.js` · `modules/service_jobs.js` · `tests/void_delete_surface_fail_guard.test.js` (ใหม่ 4 — source: S7 failures→warning+capture+gate ✅ · S8 stockIssue throw/partial+capture+gate ✅) · `tests/void_release_credit_guard.test.js` (อัปเดต assertion :67 — release fail ตอนนี้ไป `failures` แทน inline "⚠️ คืนเครดิต fail"; intent "surfaced not silent" คงเดิม strictly stronger) · build 538→**539** (data-app-build + ?v=×4 + sw cache-v539 + comment + `dashboard_readonly_guard`). **Verification:** lint:errors 0 · unit **2228/2228** (B4 void_release_credit + service_job_cancel_restore เดิมไม่ regress) · e2e **14/14** (build 539 sync) · EOL LF. **owner smoke:** ลบบิลปกติ → "✅ เรียบร้อย" เหมือนเดิม · (จำลอง fail ยาก — แต่ logic: ถ้า void JV/คืนสต็อกล้ม → เห็น "⚠️ … ไม่สำเร็จ" สีเหลือง ไม่ใช่ ✅) · ลบงานช่างที่ตัดสต็อกแล้ว → ถ้าคืนสต็อกสำเร็จ "✅", ถ้าล้ม "⚠️". **Status: 🔜 branch `claude/phase-539-void-delete-surface-fail` — รอ owner review + merge.**

**build 538 (Phase 538 / S9+S10+S11 — Bangkok-TZ "today" filter receipts/tasks/birthdays · BUG_AUDIT 2026-06-25 · §4.7 · ✅ MERGED+LIVE `c50cc09` PR #113):** **Baseline:** main `534e704` (build 537 — S13 lazy-import PR #112). **บั๊ก (verified from source):** 3 หน้าคิด "วันนี้"/cutoff ด้วย `new Date().toISOString().slice(0,10)` = UTC → ช่วง 00:00–06:59 ไทย (=17:00–23:59 UTC เมื่อวาน) วัน UTC ยังเป็นเมื่อวาน. **★ deeper-than-audit:** ฝั่งค่าที่เอามาเทียบก็เป็น UTC timestamptz — แก้ boundary อย่างเดียว = half-fix ผิด → ต้องแปลงค่าเทียบด้วย `dateBkk()`. **S9 `receipts.js`:** `:144` `today`, `:147/:148` 7d/30d cutoff (UTC) + `_receiptMatchesSearchDate:88` เทียบ `created_at.slice(0,10)` (UTC) → บิลสร้าง 01:30 ไทย (created_at=18:30 UTC เมื่อวาน) หลุด filter "วันนี้". แก้: `today=todayBkk()`, cutoff `addDaysBkk(-7/-30)`, month `today.slice(0,7)+"-01"`, เทียบ `dateBkk(r?.created_at) < cutoff`. **S10 `tasks.js`:** `:64` `today`(UTC) + `:65` `weekFromNow`(UTC) + เทียบ `String(t.due_at/done_at).slice(0,10)` (UTC ts จาก `.toISOString()` :234/:263). แก้: `today=todayBkk()`, `weekEnd=addDaysBkk(7)`, เทียบ `dateBkk(t.due_at)===today`/`<=weekEnd`/`dateBkk(t.done_at)===today`. **overdue คง `new Date(t.due_at)<now`** (เทียบ instant TZ-agnostic). **S11 `birthdays.js`:** `checkTodayBirthdaysAndNotify:180` dedup key `today.toISOString().slice(0,10)` (UTC) → ส่งอวยพรซ้ำ 00:00–06:59. แก้: `todayBkkStr=todayBkk()`, `todayKey=todayBkkStr`, + match `todayMD=todayBkkStr.slice(5,10)` (ลบ `new Date()` local-tz → consistent Bangkok). **ใช้ helper เดิม `utils.js` todayBkk/addDaysBkk/dateBkk (Asia/Bangkok, single source — phase 89.1/525).** **ไม่แตะ:** เงิน/สต็อก/บัญชี/JV/VAT · receipt date display (`dateTH`) · task create/done write (`.toISOString()` เก็บ UTC ปกติ) · birthday manual-send path (157) · overdue instant compare. **ไฟล์:** `modules/receipts.js` · `modules/tasks.js` · `modules/birthdays.js` · `tests/tz_receipts_tasks_birthdays_guard.test.js` (ใหม่ 6 — behavioral `_receiptMatchesSearchDate`: เช้าไทย included/genuine-yesterday excluded · source 3 ไฟล์ strip-comment) · build 537→**538** (data-app-build + ?v=×4 + sw cache-v538 + comment + `dashboard_readonly_guard`). **Verification:** lint:errors 0 · unit **2224/2224** (รวม receipt_filter_counts + tz_today_filter เดิมไม่ regress) · e2e **14/14** (build 538 sync) · EOL LF. **owner smoke (ช่วงเช้า <07:00 ไทย เห็นชัดสุด หรือทุกเวลา):** หน้าใบเสร็จ filter "วันนี้" เห็นบิลของวันนี้ครบ · หน้างาน count วันนี้/สัปดาห์ตรง · (S11 ตรวจยาก — เปิดแอป 2 รอบเช้า ไม่ส่ง LINE อวยพรซ้ำ). **Status: 🔜 branch `claude/phase-538-tz-receipts-tasks-birthdays` — รอ owner review + merge.**

**build 537 (Phase 537 / S13 — _lazyImport evict rejected import · BUG_AUDIT 2026-06-25 · availability · ✅ MERGED+LIVE `534e704` PR #112):** **Baseline:** main `9932d9e` (build 536 — S2/S3 error_log hardening PR #111, codex). **บั๊ก (verified from source `main.js:83-85`):** `_lazyImport(path)` = `if(!_lazyMod.has(path)) _lazyMod.set(path, import(_bustedUrl(path))); return _lazyMod.get(path)`. `import()` ที่ reject (เน็ตสะดุดแวบเดียว/โหลด chunk ล้ม) → **rejected promise ถูก cache ใน `_lazyMod` ถาวร** → ทุก nav เข้า lazy route นั้น (LAZY_ROUTES ~12 หน้า: team_center/customer_dashboard/accounting ฯลฯ) reuse promise เดิมที่ reject → caller `_renderLazy:151-164` (มี try/catch) โชว์ "โหลดหน้านี้ไม่สำเร็จ — ลองรีเฟรช" ซ้ำทุกครั้ง = หน้าตายทั้ง session จน full reload. **แก้ (1 บรรทัด, คงสไตล์ single-line กัน `extractFn` boundary):** `_lazyMod.set(path, import(_bustedUrl(path)).catch(e => { _lazyMod.delete(path); throw e; }))` → entry ที่ reject ถูก evict (keyed by bare path) + re-throw ให้ caller เห็น error เดิม (ไม่ swallow) → nav ครั้งถัดไป re-import ใหม่ได้. resolved promise ยัง cache (per-session de-dup keyed by path ไม่เปลี่ยน). caller contract เดิม (reject ยัง propagate เหมือนเดิม แค่ retry ได้). **ไม่แตะ:** `_bustedUrl` cache-bust (`?v=APP_BUILD`) · LAZY_ROUTES · `_renderLazy` · `_lazyMod.get` ใน clearCustomerDashboardState (1048) · logic/เงิน/สต็อก/บัญชี. **ไฟล์:** `main.js` (`_lazyImport` + comment) · `tests/lazy_import_cache_bust.test.js` (+1 test S13: fn body มี `.catch(` + `_lazyMod.delete(path)` + `throw`; test เดิม 5 ตัวยังเขียว — `extractFn` หยุดที่ `\n}\n` column-0, inner `.catch` brace mid-line ไม่กระทบ) · build 536→**537** (data-app-build + ?v=×4 + sw cache-v537 + comment + `dashboard_readonly_guard`). **Verification:** lint:errors 0 · unit **2218/2218** · e2e **14/14** (build 537 sync) · EOL LF. **owner smoke:** เปิดหน้า lazy (เช่น team_center/รายงาน) ระหว่าง throttle/ตัดเน็ต → "โหลดไม่สำเร็จ" → เปิดเน็ต + กดเข้าหน้าเดิมอีกครั้ง (ไม่ reload) → โหลดได้. **Status: 🔜 branch `claude/phase-537-lazy-import-evict-reject` — รอ owner review + merge.**

**build 535 (Phase 535 / S4 — line-notify error-body sanitize · BUG_AUDIT 2026-06-25 · §4.4/§4.8 · functions-only · ✅ MERGED+LIVE `5edc416` PR #110):** **Baseline:** main `0646050` (build 534 — B3 PR #109). **บั๊ก (verified from source `functions/api/line-notify.js:90-94`):** push LINE fail → `detail = await resp.text()` (raw upstream body) แล้ว `results.push({ to, status, ok, detail })` → response ส่ง `results[].detail` (raw LINE API body: quota/token state/req diagnostic) + `results[].to` (recipient id จาก env `LINE_USER_ID`/group) กลับ client → staff browser เห็น (`line_notify.js:364` `console.error(JSON.stringify(result.results))` ตอน fail). ขัด Phase 516 sanitizer (API endpoint คืน generic error/code เท่านั้น; server log ได้ client ห้าม). guard `function_error_sanitizer_guard` ROLLOUT คุม line-notify แต่ regex จับแค่ `detail: text.slice` (gemini pattern) ไม่จับ `results.push({detail})` = **gap**. **แก้ (`line-notify.js` results block เท่านั้น):** `if(!resp.ok){ let detail=null; try{detail=await resp.text()}catch{}; logServerError("[line-notify] LINE push failed",{status:resp.status, detail}) }` + `results.push({ status: resp.status, ok: resp.ok })` (ตัด `to`+`detail`). `logServerError` import อยู่แล้ว (`:11`, ใช้ใน catch). **verify caller:** client `sendLineNotify` อ่าน `result.ok/configured/error/usedFallback` เท่านั้น; `result.results` ถูกแค่ `console.error` ตอน fail (ไม่มี logic อ่าน detail/to) → ไม่กระทบ. consumer 2 `customer_dashboard.js:1144` เรียก `sendLineNotify().catch()` ไม่อ่าน results. **ดร็อป `to` ด้วย** (= recipient id, อยู่ใน risk list ของ S4; same sink; Phase 516 "generic only"). **คงรูป response** `{ok, configured, target, usedFallback, results}` (ai_service_queue_line_guard:94 เช็ค `usedFallback,\n results`). **ไม่แตะ:** flow ส่ง LINE จริง (fetch api.line.me/push/safeMessage/recipient logic) · probe(531) · usedFallback · empty-message 400 · `daily-summary`/Ning · UI/`line_notify.js` · OTP/accounting/POS/stock · CORS/`onRequestOptions`. **ไฟล์:** `functions/api/line-notify.js` (results sink + header comment) · `tests/line_notify_error_sanitize_guard.test.js` (ใหม่ 4 — behavioral: fail → upstream body+recipient ไม่อยู่ใน response แต่ logged server-side · success → result clean ไม่มี to/detail · source-regex: `results.push` ไม่มี detail/to + `logServerError(...detail)` + push = status+ok). **bump build 534→535** (functions-only แต่ bump ตาม protocol เพื่อ traceability — เหมือน Phase 510/515/516 ที่เป็น functions-only sanitizer เหมือนกัน; review ยืนยัน function deploy จริงไม่ขึ้นกับ marker: `main.yml` `wrangler pages deploy .` รวม `functions/` + `sw.js:312` ข้าม POST → `/api/line-notify` ไป network เสมอ ไม่ cache): `data-app-build` + `?v=`×4 (style.css/selfheal/main/boot) + sw `cache-v535` + comment + `dashboard_readonly_guard` 534→535. **Verification:** lint:errors 0 · unit **2211/2211** · e2e **14/14** (build 535 sync; APP_BUILD smoke flake = SW state ค้าง → ล้าง test-results เขียวครบ) · EOL LF. **owner smoke (env-driven, e2e ไม่ครอบ auth):** ตั้งค่า LINE → ส่งทดสอบ fail (เช่น token ผิด) → response client **ไม่มี** raw LINE body/recipient id (ดู Network tab) แต่ Cloudflare function log มี full detail; ส่งสำเร็จปกติ. **Status: 🔜 branch `claude/phase-535-line-notify-error-sanitize` — รอ owner review + merge.**

**build 534 (Phase 534 / B3 — JV doc_no clash classify+retry · BUG_AUDIT 2026-06-25 · §4.3 · MONEY · ✅ MERGED+LIVE `0646050` PR #109):** **Baseline:** main `5fcc8dc` (build 533 — B4 void-release-credit PR #108). **บั๊ก (verified from source):** `auto_post._postJournal` สร้าง `doc_no = {docType}{YYYY}{MM}{####}` แบบ **read-max+1** (`:247-262`) = RACE — 2 checkout พร้อมกันอ่าน max เท่ากัน → `doc_no` เดียวกัน → ตัวหลังโดน **409** (`journal_entries_doc_no_key`, `supabase-phase88-accounting-foundation.sql:48` `TEXT UNIQUE`). โค้ดเดิม `:287 if (r.status === 409 || r.status === 23505) return skipped "duplicate"` = ตี **ทุก 409 = source ซ้ำ** โดยไม่ดูว่าชน constraint ไหน → doc_no clash ถูก skip เงียบ → **JV บิลนั้นหาย** (รายได้ undercount เงียบ ตรวจยาก; `:295` check `idx_je_source_unique` ถูก short-circuit). UNIQUE บน journal_entries มีแค่ 2: `journal_entries_doc_no_key` (doc_no) + `idx_je_source_unique` (partial `(source_table,source_id)` `supabase-phase88-auto-post.sql:23-25`). **แก้ (`auto_post.js` block `247-317` → retry loop เท่านั้น):** (1) export `classifyJeInsertError(status, body)` pure — `idx_je_source_unique`→`source-dup` · `journal_entries_doc_no_key`||`/unique constraint.*doc_no/i`→`docno-clash` · else→`unknown`. (2) for-loop **ข้างใน try เดิม** (`MAX_DOCNO_RETRY=5`): a. read max→`fetchedNextSeq` (inner try/catch fallback=1, read miss ไม่ throw) · b. `nextSeq=Math.max(fetchedNextSeq, lastTriedSeq+1)` (ก้าวหน้าเสมอแม้ read stale) · c. POST `_authFetch` (คง 401-retry) · d. `r.ok`→entryId+posted+break · e. **GATE `isUniqueViolation = r.status===409 || /23505/.test(txt)`; non-unique→throw→catch เดิม Phase 92.13 (RLS 403/42501 ไม่ regress)**; classify: source-dup→skipped/duplicate · docno-clash→`lastTriedSeq=nextSeq`+`_docnoRetrySleep(50+rand*100)`+continue · unknown→throw. (3) ครบ 5 ยัง !posted → `console.error`+`window._errorReporter?.captureMessage?.("auto_post doc_no clash unresolved",{...})` + **return `failed/docno-clash-unresolved`** (ไม่ skip เงียบ §4.8). `_setDocnoRetrySleepForTest` = inject no-op ให้ test เร็ว/deterministic. caller `pos.js:1528` อ่าน `status==="failed"` → warn+badge "ต้องตรวจสอบ" **ไม่ rollback** (บิล/สต็อก commit แล้ว; `failed` เป็น status ที่ caller รับอยู่แล้ว = entry-insert-failed → ไม่ใช่ status ใหม่). **journal_form.js (manual JV) = ข้าม** (plain `fetch` ไม่ใช่ `_authFetch` + โครงต่าง → share retry ไม่สะอาด; `:319 if(!r.ok) throw` เห็น error อยู่แล้ว = ไม่ silent loss → UX follow-up แยกเฟส). **ไม่แตะ:** journal_lines POST/rollback (509/523) · constraints/schema/RLS/DB · period-lock (`:233-245`) · mapping/VAT/Dr-Cr math · RLS catch Phase 92.13 (`:304+` คงเป๊ะ) · pos.js/stock/refund. **★ Blocking ที่ verify เจอ+ปิด:** test เดิม `auto_post_detailed_result.test.js:91` mock `makeRes(409,{code:"23505"})` (body ไม่มีชื่อ constraint) → classifier ใหม่ตี `unknown→throw→failed` = test แดง. แก้ที่ **mock** ให้สมจริง (ใส่ `idx_je_source_unique` → `source-dup`→คง skipped/duplicate); **ไม่อ่อน classifier** (prod จริง message มีชื่อ constraint เสมอ → `unknown→throw` ไม่เคย fire กับ unique violation จริง). **ไฟล์:** `modules/accounting/auto_post.js` · `tests/auto_post_detailed_result.test.js` (อัปเดต mock) · `tests/jv_docno_clash_guard.test.js` (ใหม่ 11 — classifier 4 · retry behavioral 3 [clash→posted+doc_no advance · source-dup→skipped · clash×5→failed+report] · gate non-409 2 [403/500→entry-insert-failed ไม่ retry] · source-regex 2) · build 533→**534** (data-app-build + ?v=×4 + sw cache-v534 + comment + `dashboard_readonly_guard`). **Option A (DB atomic `next_je_doc_number` counter — eliminate race) = follow-up แยกเฟส (ไม่อยู่ scope นี้).** **Verification:** lint:errors 0 · unit **2200/2200** · e2e **14/14** (build 534 sync) · EOL LF. **owner smoke (⚠️ pre-effective):** ก่อน 1 ก.ค. auto-post sale = skip (pre-effective) → smoke ขายปกติ "ไม่แตะ doc_no path" → ตัวยืนยันหลักก่อน go-live = **guard behavioral test** (classifier+retry+gate); หรือ test data `docDate≥2026-07-01`. หลัง 1 ก.ค.: ขายจริง 2 บิลเร็วๆ → ทั้งคู่มี JV (ไม่หาย 1). **Status: 🔜 branch `claude/phase-534-jv-docno-classify-retry` — รอ owner/Codex review + merge.**

**build 533 (Phase B4 — void-release-customer-credit · BUG_AUDIT 2026-06-25 · §4.1 · MONEY):** **Baseline:** main `7d98fcb` (build 531 + B2/S1 phase532 merged PR #107). **บั๊ก (verify from source):** void/ลบบิลขาย (`modules/sales.js:268-347` success branch) ทำ side-effect ครบ — (a) `voidJvForSource` (b) `_appRevertStockForSale` (c) `reverseEarnedPointsForSale` — **แต่ไม่เรียก `release_customer_credit`** → บิลที่จ่ายด้วยเครดิต 2180 (`sales.credit_used_amount>0`, redeem ตอน checkout = ledger −amount) พอ void → JV void คืน Cr 2180 ใน GL แต่ `customer_credit_ledger` ไม่คืน → **ledger ≠ GL + ลูกค้าเสียเครดิตถาวร**. **แก้ (2 ไฟล์ + guard):** (1) `pos.js` (หลัง `_releaseAndLog` :1213) เปิด `window._appReleaseCheckoutCredit = _releaseAndLog` (mirror redeem :1190; `_releaseAndLog` POST `/rpc/release_customer_credit` `{p_source_key}` idempotent phase520). (2) `sales.js` void flow เพิ่มขั้น (d) หลัง (c): หา sale ใน `state.sales` (`main.js:1141` loadAllData `select("*")` → มี `credit_used_amount`+`checkout_key`) → `creditUsed=Number(credit_used_amount||0)`, `srcKey=checkout_key` → `if creditUsed>0 && srcKey && helper` → `await window._appReleaseCheckoutCredit(srcKey, customer_id, creditUsed, "void-sale")` → push sideEffect "คืนเครดิต ฿X"/"⚠️ คืนเครดิต fail" (best-effort ไม่ block void, §4.8). idempotent ต่อ source_key → re-void ปลอดภัย. **latent:** credit UI gate ปิดจน 1 ก.ค. → `credit_used_amount`=0 ก่อน go-live → (d) dormant (ship ก่อน go-live ปลอดภัย). **ไม่แตะ:** redeem (`pos.js:1375`) · checkout-failure release (1402/1495) · void-JV/revert-stock/reverse-loyalty (a/b/c) · `release_customer_credit` RPC (phase520) · ledger schema/RLS · effective gate · VAT/JV mapping/stock CAS. **ไฟล์:** `modules/pos.js` · `modules/sales.js` · `tests/void_release_credit_guard.test.js` (ใหม่ 5 — source-regex: pos expose helper+RPC · void เรียก helper ด้วย srcKey · guard creditUsed>0 · ordered after c · fail ไม่เงียบ) · build bump 531→**533** (data-app-build + ?v=×4 + sw cache-v533 + comment + `dashboard_readonly_guard`) [ข้าม 532 = B2 DB-only]. **Verification:** lint:errors 0 · unit **2198/2198** · e2e **14/14** (build sync 533 รวม smoke:218 all-?v=-match) · EOL LF. **🔴 owner smoke (ก่อน merge — money path):** void บิลเครดิต (test data: sale `credit_used_amount`>0 + `checkout_key` + redeem ledger row) → ledger ได้ release row (+amount) + balance ลูกค้ากลับ + GL 2180 (JV void) ↔ ledger ตรง · void บิลปกติ (ไม่ใช้เครดิต) → ไม่มี release (creditUsed=0). **Status: 🔜 branch `claude/phase-533-void-release-credit` — รอ owner smoke + merge.**

**Phase 532 (B2+S1 — accounting_periods anon write-hole · BUG_AUDIT 2026-06-25 · §4.4 · DB+test only, build คงเดิม 531):** **Baseline:** main `1b3160e` (build 531 — LINE probe badge PR #106). **บั๊ก (verified LIVE ด้วย `pg_policy` 2026-06-27 ก่อนแก้):** `supabase-phase88-19-period-close.sql:46-52` สร้าง `accounting_periods` RLS `periods_select`/`periods_insert`/`periods_update` = `TO authenticated, **anon** WITH CHECK(true)` → ใครก็ได้ที่ถือ publishable (anon) key **INSERT/UPDATE accounting_periods ผ่าน REST โดยไม่ต้อง login** = flip งวดที่ปิด/ล็อกกลับเป็น "open" แล้วโพสต์/back-date JV เข้างวดที่ปิด (ข้าม period-lock §4.3 — trigger ล็อกแค่ตอนงวด *locked*; reopen ผ่าน anon = เลี่ยง control ทั้งชุด). `deny_customer_accounting_periods` (phase505 RESTRICTIVE) ไม่ช่วย — เป็น `TO authenticated` ไม่แตะ anon. ไม่มี migration ไหน drop anon (445 อัปเดต `is_accountant()` fn · 505 deny authenticated-scoped · 92-46 ข้าม table นี้). **= B2 + S1 รวมกัน** (S1: staff ทุก role [sales/tech] เปิด/ปิดงวดได้เพราะ `USING(true)`; BUG_AUDIT แนะ "แก้รวม B2: gate is_accountant()"). **แก้ (`supabase-phase532-periods-anon-fix.sql` — idempotent DROP IF EXISTS + CREATE ใน BEGIN/COMMIT):** (1) ลบ `anon` ทุก policy → anon ไม่มี permissive policy = denied เต็ม read+write. (2) gate writes: `periods_insert` WITH CHECK `public.is_accountant()` · `periods_update` USING+WITH CHECK `public.is_accountant()` (=`role IN ('admin','accountant')` phase445:51 — ตรง ROLE_PAGES ที่เข้าหน้า "🔒 ปิดงวดบัญชี"; `periods.js` = sole writer 189/198/229). (3) **คง SELECT `TO authenticated USING(true)`** — `auto_post.js:234` อ่าน period status ตอน checkout (รันเป็น cashier) เพื่อ honour lock; gate select เป็น is_accountant() = **checkout cashier พัง** → ต้องเปิดอ่านให้ authenticated. (4) DELETE คงไม่มี permissive policy (งวดลบไม่ได้). **verify-first:** grep ทุก writer (เขียนที่เดียว=periods.js หน้า admin/accountant · auto_post แค่ READ) + is_accountant()=admin+accountant ตรง ROLE_PAGES. **ไม่แตะ:** period-lock trigger · auto_post/JV math · deny_customer (คงเดิม) · table/policy อื่น. **ไฟล์:** `supabase-phase532-periods-anon-fix.sql` (owner-run) · `tests/rls_periods_anon_guard.test.js` (ใหม่ 4 — source-regex: ไม่มี anon ใน CREATE POLICY · drop ก่อน recreate · writes=is_accountant() · select คง authenticated USING true). **ไม่ bump build** (DB+test ไม่แตะ app bundle; index.html/sw.js คง 531). **Verification:** guard 4/4 pass · lint clean · **DB verified live** (owner รัน `pg_policy` → ทุกแถว `{authenticated}` ไม่มี anon · writes=is_accountant()). **owner smoke:** "ปิดงวดบัญชี" (admin) ปิด/เปิดงวดได้ + ขาย 1 บิล (auto_post อ่าน period ผ่าน). **Status: ✅ SQL applied prod 2026-06-27 (B2+S1 CLOSED, verified pg_policy). 🔜 commit branch `claude/phase-532-periods-anon-fix` รอ owner review/merge (no app change).**

**build 525 (Phase 525 — credit_tracker-overdue-timezone · audit TZ #2 · §4.7 · ✅ MERGED+LIVE `f6eefb1` PR #102):** **Baseline:** main `34e3bdd` (build **524** — mobile-search Enter/blur, PR #101). **บริบท (audit TZ #2):** `credit_tracker.js` คิด "เกินกำหนด" (overdue) ด้วย `const today = new Date().toISOString().slice(0,10)` = **UTC** → ช่วง 00:00–07:00 เวลาไทย `today(UTC)` ยังเป็น "เมื่อวาน" → บิลที่ `credit_due_date`=เมื่อวาน **ไม่ถูกนับ overdue** (undercount ยอดเกินกำหนด/AR ต่ำกว่าจริง) + ตัวเลขไม่ตรงหน้า dashboard (`dashboard.js:100/129` ใช้ `todayBkk()` ถูกอยู่แล้ว). **แก้ (`modules/credit_tracker.js` — เฉพาะ today + daysOverdue):** (1) import `todayBkk` จาก `utils.js`; (2) `const today = todayBkk()` (Asia/Bangkok "YYYY-MM-DD", single-source §4.7) → overdue boundary `s.credit_due_date < today` คิดบนวันไทย; (3) `daysOverdue` เปลี่ยนจาก `Date.now()` (UTC ms) → diff โดย anchor ทั้งสองวันที่ที่เที่ยงคืนไทย `new Date(today+"T00:00:00+07:00") − new Date(credit_due_date+"T00:00:00+07:00")` / 86400000 (`Math.max(0,…)`) → กัน off-by-1 vs boundary. `credit_due_date` = Postgres `DATE` (rls-policies.sql:404) → "YYYY-MM-DD" → concat `+07:00` valid. **ไม่แตะ:** `fetchCreditSales`(507)/no-fallback/stale-guard/`processCreditPayment`/JV/sort/render. **ไฟล์:** `modules/credit_tracker.js` · `tests/credit_tracker_overdue_tz_guard.test.js` (ใหม่ 7 — source no-UTC/Date.now (strip comment กัน false-positive) + behavioral due=เมื่อวาน(BKK)→overdue/daysOverdue=1·3, due=วันนี้→ไม่ overdue, จ่ายแล้ว→ไม่ overdue) · `index.html`/`sw.js`/`dashboard_readonly_guard`→525 · CHANGELOG/HANDOFF. **Verification:** lint:errors 0 · unit **2179/2179** · e2e **14/14** (build 525 sync) · EOL LF · rebase บน main 524 (conflict เฉพาะ build markers + CHANGELOG → เก็บ 525 + ทั้ง 2 entry; credit_tracker ไม่ conflict). **owner smoke preview ผ่าน** (credit_tracker เปิดได้ + ตรง dashboard 0=0 + ไม่ regress) + reviewer audit diff. **DB:** ไม่มี SQL (JS-only). **Status: ✅ MERGED main `f6eefb1` (PR #102 squash) + LIVE pages.dev build 525 / sw v525 / ?v=525 ครบ (CI Tests+Deploy success) 2026-06-24.**

**build 523 (Phase 523 — auto_post-orphan-JV-rollback-hardening · audit #1 · ✅ MERGED+LIVE `9cfa59b` PR #100):** **Baseline:** main `ba31bb4` (build **522** — ทีม mobile-search IME merged PR #99). **⚠️ collision lesson:** ผม (Claude) เริ่มงานนี้เป็น branch "522" ทับเลข phase ที่ owner มอบทีมอื่น (mobile-search) — เช็ค git ครั้งเดียวตอนเริ่ม + ไม่อ่าน [[feedback-parallel-work-check]] ให้ครบ → shared working-dir race เขียน build-bump ทับกัน. **แก้: renumber → 523** (cherry-pick logic commit เดิม `dda451e` มาบน main 522 ใหม่ → bump 523; ลบ branch 522 ที่ตั้งผิด). **บริบท (audit #1):** `auto_post._postJournal` rollback ตอน lines-insert ล้ม เดิมเช็คแค่ `delResp.ok` → DELETE โดน RLS block คืน 2xx+0row = false "rollback OK" แต่ orphan JV ค้าง → `unique(source_table,source_id)` block repost → **JV หาย** (รายได้ undercount; credit sale = 2180 ledger≠งบ). **แก้ (`modules/accounting/auto_post.js` rollback block เท่านั้น):** DELETE + `Prefer: return=representation` + `const rollbackCount = deleted.length` → rollback OK เฉพาะ `delResp.ok && rollbackCount===1`; ไม่ครบ → `console.error` + `window._errorReporter?.captureMessage?.("auto_post orphan JV (rollback failed)", {entryId,sourceTable,sourceId,ok,deleted,usedCredit})` (ไม่เงียบ §4.8) + credit-aware `_usedCredit = lines.some(l=>l.account_code==="2180" && debit>0)` → toast เตือน reconcile ledger↔งบ; exception path ก็ report. **return shape เดิม** (failed/lines-insert-failed) — caller pos.js ไม่กระทบ. mirror journal_form 509 + voidJvForSource 89.16. **ไม่แตะ:** void path (89.16 มี pre-check) · `buildSaleDebitLines`/redeem-first/release/`postJournalForSale` mapping · stock/RLS. **ไฟล์:** `modules/accounting/auto_post.js` · `tests/auto_post_orphan_rollback_guard.test.js` (ใหม่ 5) · `index.html`/`sw.js`/`dashboard_readonly_guard`→523 · CHANGELOG/HANDOFF. **Verification:** lint:errors 0 · unit **2171/2171** (รวม guard ทีม mobile-search products_search_ime) · e2e **14/14** (build 523 sync) · diff-check clean · EOL LF. **Status: ✅ MERGED main `9cfa59b` (PR #100) + LIVE build 523. (orphan rollback = residual audit #1 ก่อน go-live 1 ก.ค.)**

**build 521 (Phase 517b-3 — enable-credit-UI + JV-Dr2180-split + B1 effective-gate · ✅ MERGED+LIVE `f38751f` (PR #98 squash)):** **Baseline:** main `59398f7` (build 520). **เป้าหมาย:** ก้าวสุดท้าย Phase 517 — เปิดให้ลูกค้าใช้เครดิต 2180 จริง + ทำงบ 2180 ให้ตรง ledger (postJournalForSale Dr 2180 split). ปลุกทุกอย่าง staged 517a→520. **🔴 ต้อง live ก่อน 1 ก.ค.** (go-live บัญชี — ไม่งั้นบิลใช้เครดิตลง JV ผิด). **ไม่มี SQL ใหม่** (sales.checkout_key/credit_used_amount + redeem/release RPC ครบจาก 520/517a). **แก้:** (1) **`auto_post.js`** — helper ใหม่ `buildSaleDebitLines(debitAccount, totalDebit, creditUsed, desc)` (export): `cu>0` → `[{2180:cu},{debitAccount:total−cu}]` (ข้าม cash ถ้า=0), `cu=0` → `[{debitAccount:total}]`, clamp `cu≤total` → **Σdebit=total เสมอ**. `postJournalForSale` ทั้ง 2 path (VAT 3-line + non-VAT) เปลี่ยนฝั่ง debit เป็น `...buildSaleDebitLines(debitAccount, v.total|amount, sale.credit_used_amount, desc)`; Cr รายได้/2170 ไม่แตะ. 2180 = hardcode (เหมือน 2170; COA 512 seed แล้ว). (2) **`pos.js` UI** — payment-select: `_posCustomer?.id && balance>0` → fetch `_fetchCustomerCredit` (read SUM ledger, cache `_creditFetchedFor`) → กล่องเครดิต (input clamp `0..min(balance,amount)` + "ใช้เต็ม" `_creditUsed=_maxCredit` + full-credit `_payable<=0` → `posCreditFullConfirm` ข้ามจอรับเงิน); "ยอดชำระ" box = `_payable`. module var `_creditUsed`/`_posCustomerCredit`/`_creditFetchedFor` + `_resetCreditState()` ที่ def + clearPosState + renderPosPage + success. (3) **thread payable** — cash-input: `payable=amount−_creditOnBill` แทน amount ใน change/confirm-gate/exact/display; transfer: `_tPayable` (display+pendingPaidAmount); card: `pendingPaidAmount=amount−_creditUsed`. (4) **doCheckout** — `const creditUsed = _posCustomer?.id ? clamp(_creditUsed,0..actualTotal) : 0`; `_payable=actualTotal−creditUsed`; `paid_amount=paidAmount||_payable`, `change=max((paidAmount||_payable)−_payable,0)`; note "🎁 ใช้เครดิต"; redeem-first (520) ปลุกเพราะ creditUsed อาจ>0. (5) **receipt (`main.js`)** — `credit_used_amount>0` → แถว "🎁 ใช้เครดิต −X" + relabel "รับเงิน"→"ชำระจริง". **ไม่แตะ:** checkout_key/redeem/release/_ensureCheckoutKey (520 — เรียก/อ่าน) · ledger schema/RLS/redeem·release RPC (517a/520) · refund 2180 (512) · Phase 514 · stock CAS/deduct/revert · OTP/RLS · VAT/total/revenue (credit=วิธีจ่าย ไม่ใช่ส่วนลด) · 517b-0/b-1 hard-fail/single-flight/_jvStatus. **ไฟล์:** `modules/pos.js` · `modules/accounting/auto_post.js` · `main.js` (receipt row) · `tests/credit_use_jv_split_guard.test.js` (ใหม่ 13 — รวม **unit test จริง `buildSaleDebitLines` balance ทุกกรณี**) · `tests/{checkout_key_credit(creditUsed→UI on),auto_post(non-VAT→buildSaleDebitLines),+offset-window 5 ไฟล์}` · `index.html`/`sw.js`/`dashboard_readonly_guard`→521 · docs. **Verification:** lint:errors 0 · unit **2164/2164** · e2e **14/14** (build 521 sync) · diff-check clean · EOL LF. **🔴 owner preview smoke build 521 #pos (test data ก่อน 1 ก.ค.):** ลูกค้ามีเครดิต → ใช้บางส่วน → บิลสำเร็จ; ledger −cu; cash_recon เงินรับ=total−cu; **JV: Dr 2180 cu + Dr cash (total−cu) + Cr รายได้ + Cr 2170 บาลานซ์** (ตรวจสมุดรายวัน) · ใช้เกิน balance → redeem 23514 abort · ใช้เต็ม → ไม่มี Dr cash, JV บาลานซ์ · ขายปกติ (ไม่ใช้เครดิต) → JV/cash_recon เหมือนเดิม · double-click → 1 บิล. **★ B1 fix (reviewer audit build 521, ก่อน merge — ไม่ bump build):** credit UI + redeem ไม่ gate effective-date → ใช้เครดิตก่อน 1 ก.ค. = redeem ตัด `customer_credit_ledger −cu` (เคลื่อนจริง) แต่ JV Dr 2180 = pre-effective skip (auto_post:383) → **ledger 2180 ≠ งบ 2180 mismatch ถาวร** (backfill ก็ skip). แก้: `pos.js` import `_isAfterEffective` (helper เดียวกับ JV gate, single source effective_date.js="2026-07-01") → (1) UI gate `const _creditEnabled = _isAfterEffective(todayBkk()); _showCredit = ...&& _creditEnabled` (ก่อน 1 ก.ค. ช่อง "ใช้เครดิต" ไม่โผล่) (2) defense ที่ clamp `const creditUsed = (_posCustomer?.id && _isAfterEffective(todayBkk())) ? round2(...) : 0` (creditUsed=0 ก่อน effective → ไม่ redeem/ledger ไม่เคลื่อน/JV skip = ปกติ). ใช้เครดิตเปิดพร้อม JV active. tests: behavioral `_isAfterEffective("2026-06-23")=false / "2026-07-01")=true` + source-regex 2 gates. ไม่แตะ JV split/redeem/release/cash_recon (แค่เพิ่ม gate). unit **2166/2166**·e2e 14/14·lint0·EOL LF. commit B1 บน branch 521 เดิม.

**Status: ✅ MERGED main `f38751f` (PR #98 squash) + LIVE pages.dev build 521 / sw v521 / ?v=521 ครบ (CI Tests+Deploy success) 2026-06-23. reviewer verified diff+guard+CI; owner preview smoke ผ่าน (ขายปกติ + receipt "🕓 ยังไม่ถึงรอบบัญชี เริ่ม 1 ก.ค." = effective gate live → credit UI ปิดก่อน go-live). ไม่มี SQL ใหม่ (520 phase520 SQL applied แล้ว; 521 = JS/UI). 🎉🎉 **ปิด Phase 517 customer-credit-2180 ครบทั้งชุด: 517a ledger foundation (517) → 517b-0 checkout idempotency (518) → 517b-1 JV status (519) → 517b-2 checkout_key+backend (520) → 517b-3 credit UI+Dr2180 split+B1 gate (521).** credit ใช้ได้ตั้งแต่ 1 ก.ค. (พร้อม JV active). 🔴 residual ก่อน 1 ก.ค.: (1) `auto_post.js:331` orphan-JV rollback ไม่นับ row (สำคัญขึ้นเมื่อ credit ไหลจริง) (2) go-live prep: OB จริง / bank sub-accounts / ซ้อมใหญ่ JV / Day-1 smoke.**

**build 520 (Phase 517b-2 — checkout_key-idempotency + customer-credit-use-backend · ✅ MERGED+LIVE `0899b15` + SQL applied prod):** **Baseline:** main `84a0481`/`fcb71fc` (build 519). **บริบท:** reviewer verify แผน 517b-2 → fold 4 จุด money (โดยเฉพาะ **#1 double-redeem**). **#4(ก) เลือก: UI ใช้เครดิต "ปิด" ใน 520** (backend พร้อม, smoke ผ่าน RPC/SQL ตรง) จน 517b-3 (JV Dr2180) live — กันงบ 2180 ≠ ledger. **แก้:** **(#1)** `checkoutKey` เดิม (517b-0) gen ตอน submit → re-click หลัง timeout = key ใหม่ = double-sale/double-redeem. เปลี่ยนเป็น **per-intent**: `let _checkoutKey` module var + `_ensureCheckoutKey()` (lazy, gen ถ้า null) เรียกที่ payment-select (intent เริ่ม) + ใช้ใน doCheckout; reset `_checkoutKey=null` ตอนสำเร็จ (หลัง cart clear) + `clearPosState` (logout) + `renderPosPage` (เข้าหน้าใหม่) → re-click/back-nav = key เดิม. `salePayload.checkout_key` + `uq_sales_checkout_key` (partial unique, legacy null ไม่ชน) → insert ซ้ำ = **23505 → `_openExistingSaleByCheckoutKey` replay** (query บิลเดิม + เปิดใบเสร็จ + toast "บันทึกแล้ว กันซ้ำ" + reset key + return; ไม่ insert/redeem/JV/stock ซ้ำ). **(#1e)** redeem-first: `if (creditUsed>0 && customer)` → `_appRedeemCheckoutCredit({sourceKey:checkoutKey,...})` **ก่อน** insert; fail (overuse 23514/network) → abort ไม่สร้างบิล. **UI ปิด → `const creditUsed = 0` → path นี้ dormant** (517b-3 เปิด). **(#2)** SQL RPC ใหม่ `release_customer_credit(p_source_key)` SECURITY DEFINER + advisory lock + **idempotent** (เช็ค sale_credit_release ของ source_key ก่อน insert → กัน double-release) + คืน +amount (=−redeem.amount). **(#3)** `_releaseAndLog` เรียก release RPC เมื่อ redeem ok แต่ sale insert fail / items-stock hard-fail; release ล้ม → `console.error` + `window._errorReporter.captureMessage` + toast (ไม่ swallow, §4.8) → admin คืนมือตาม source_key. **cash_recon.js**: `cashIn`/`transferIn` = Σ`(total_amount − credit_used_amount)` (กันนับเงินสดผีตอนใช้เครดิต — **bug verify จริง** `cash_recon.js:36` เดิมนับ total เต็ม). SQL: +`sales.checkout_key` +`sales.credit_used_amount numeric(14,2) default 0`. **ไม่แตะ:** refund 2180 mapping (512) · `customer_credit_ledger` schema/RLS/`redeem_customer_credit` (517a — เรียกเท่านั้น) · Phase 514 · stock CAS/deduct/revert internals · OTP/RLS · `postJournalForSale` mapping/VAT/Dr2180 split (= 517b-3) · UI เครดิต (ปิด). **ไฟล์:** `modules/pos.js` · `modules/cash_recon.js` · `supabase-phase520-credit-use-checkout-key.sql` (owner-run) · `tests/checkout_key_credit_guard.test.js` (ใหม่ 11) · `tests/{checkout_idempotency(key-source→_ensureCheckoutKey),pos_gross_profit(fallback broaden),service_pos_jv_background,receipt_acct_trace,checkout_journal_status,checkout_stock_precheck}` (bump window จาก doCheckout โต) · `index.html`/`sw.js`/`dashboard_readonly_guard`→520 · docs. **Verification:** lint:errors 0 · unit **2151/2151** · e2e **14/14** (build 520 sync) · diff-check clean · EOL LF. **🔴 owner action ก่อน merge:** (1) รัน `supabase-phase520` (STEP0 inspect → ALTER 2 col + uq + release RPC + NOTIFY) (2) **SQL smoke** (STEP4 ในไฟล์): insert 2 sale checkout_key เดียว → ใบ 2 ERROR 23505 · redeem 2× source_key เดียว → ตัดครั้งเดียว · release 1×/2× → idempotent (สุทธิ 0) · ใช้ test data ก่อน 1 ก.ค. (3) preview smoke build 520 #pos: ขายปกติ (ไม่ใช้เครดิต) สำเร็จ + double-click = 1 บิล (replay ไม่ได้ 2 บิล) + receipt "🕓 ยังไม่ถึงรอบบัญชี". **residual:** redeem-first orphan (crash หลัง redeem ก่อน insert) = เครดิตค้าง consumed จน admin คืน (log แล้ว) — dormant ใน 520 (UI ปิด). **Status: ✅ MERGED main `0899b15` (ff) + LIVE pages.dev build 520 / sw v520 / ?v=520 ครบ (CI Tests+Deploy success) 2026-06-22. SQL applied prod + STEP4 smoke live DB ผ่าน: 4b double-sale 23505 · 4c redeem/release idempotent net=0 (ดู ledger). credit UI ยังปิด (dormant). 🔜 517b-3 (JV Dr2180 split + เปิด UI ใช้เครดิต) = ก้าวสุดท้าย ก่อน 1 ก.ค.**

**build 519 (Phase 517b-1 — checkout-journal-status + 2180-credit-redeem-prep · ✅ MERGED+LIVE `fcb71fc`):** **Baseline:** main `0bfbb80`/`95000a3` (build 518). **บริบท:** build 518 smoke (owner) — sale สำเร็จแต่ receipt โชว์ "เอกสารบัญชี: ยังไม่ลงบัญชี". **Reconcile:** prompt item 1/2 (await JV แทน fire-and-forget + failure semantics) = **517b-0 ทำไปแล้ว** (postJournalForSale awaited + `_jvWarn` gate toast + hard-fail revert/soft-delete). **delta จริงของ 517b-1** = (A) receipt badge ยัง lookup เอง blind → pre-go-live JV skip (pre-effective) = poll 9 วิ แล้วโชว์ "ยังไม่ลงบัญชี" หลอกตา + (B) เตรียม redeem path. **แก้:** (A) `pos.js doCheckout` เก็บ `_jvStatus={status,reason}` จาก `postRes` → แนบ `state.lastReceipt._jvStatus` **หลัง** `localStorage.setItem` (in-memory; บิลเปิดซ้ำ/reload ไม่มี → lookup ปกติ กัน stale). (B) `main.js _fillReceiptAcctTrace` (attempt 0 + มี `_jvStatus`): `skipped`+`pre-effective` → "🕓 ยังไม่ถึงรอบบัญชี (เริ่ม 1 ก.ค. 69)" (no retry/no alarm); `failed` หรือ `skipped`+`missing-mapping`/`unbalanced` → "⚠️ ยังไม่ลงบัญชี / ต้องตรวจสอบ" (no retry); `posted`/อื่น → ตกไป lookup เดิม (render badge "ลงบัญชีแล้ว"+ลิงก์ JV); ไม่มี `_jvStatus` (เปิดซ้ำ) → lookup+retry เดิม. **display-only คงเดิม** (แค่ `slot.innerHTML`, ไม่ write/post). JV fail หลัง sale commit = **ไม่ rollback** (status เท่านั้น — สต็อกตัดถูก). (C) helper `_redeemCheckoutCredit({customerId,sourceKey,amount,note})` ใน pos.js = POST `/rpc/redeem_customer_credit` เท่านั้น (atomic+idempotent+over-use 23514 = 517a); `source_key` รับเข้า (caller ผูก `sale:<id>`); ห้ามเขียน `customer_credit_ledger` ตรง; expose `window._appRedeemCheckoutCredit` (guard `typeof window` กัน node import พัง). **⚠️ ยังไม่ wire UI / ไม่มี caller ใน doCheckout = credit UI ยังไม่เปิด (STOP report).** **ไม่แตะ:** refund 2180 mapping (Phase 512) · ledger schema/RLS/RPC `redeem_customer_credit` (517a — เรียกเท่านั้น) · Phase 514 overpay · stock CAS/deduct/revert internals · refund/service flow · OTP/RLS · ไม่ rollback sale แบบกว้างหลัง commit. **ไฟล์:** `modules/pos.js` · `main.js` (`_fillReceiptAcctTrace`) · `tests/checkout_journal_status_guard.test.js` (ใหม่ 7) · `tests/{checkout_idempotency,service_pos_jv_background,receipt_acct_trace_refresh}` (widen doCheckout window 17k→18k จากโค้ดที่โต + checkout_idempotency scope guard: redeem helper "ไม่ถูกเรียกใน checkout") · `index.html`/`sw.js`(+v518/v519 comment ย้อน)/`dashboard_readonly_guard`→519 · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit **2140/2140** · e2e **14/14** (build 519 sync) · diff-check clean · EOL LF. **🔴 owner preview smoke (ก่อน merge):** preview build 519 #pos → ขายชิ้นเดียวเงินสด → บิลสำเร็จ/cart clear/ใบเสร็จเปิด → **receipt ไม่ค้าง "กำลังลงบัญชี…" ถาวร**; pre-go-live ควรเห็น "🕓 ยังไม่ถึงรอบบัญชี" (ไม่ใช่ "ยังไม่ลงบัญชี" แดง); console ไม่มี error ใหม่ (ยกเว้น LINE env warning เดิม). **credit UI = ยังไม่เปิด** (helper พร้อม รอ 517b-2 wire). **Status: ✅ MERGED main `fcb71fc` (ff-merge) + LIVE pages.dev build 519 / sw v519 / ?v=519 ครบ (CI Tests+Deploy success) 2026-06-22. owner preview smoke ผ่าน (ขายเงินสด: บิลสำเร็จ+cart clear+ใบเสร็จ; receipt ไม่ค้าง "กำลังลงบัญชี…"; pre-go-live เห็น "🕓 ยังไม่ถึงรอบบัญชี"). credit UI ยังไม่เปิด (helper `_redeemCheckoutCredit` พร้อม). 🔜 517b-2 = wire UI ใช้เครดิต + ลำดับ redeem-first/compensation-release + `postJournalForSale` Dr 2180 split.**

**build 518 (Phase 517b-0 — checkout-idempotency-failure-semantics · ✅ MERGED+LIVE `95000a3`):** **Baseline:** main `37ffd3b`/`198ab63` (build 517). **เป้าหมาย:** เตรียม POS checkout ให้ปลอดภัยพอสำหรับ 517b (use credit/Dr2180) **โดยยังไม่เปิด UI เครดิต + ยังไม่เรียก redeem_customer_credit**. **บริบท (verify จริง `pos.js doCheckout`):** เดิม `INSERT sales` (`:1191`) commit **ก่อน** loop items/stock; `sale_items`/stock fail = soft (push failedItems/stockFailedItems + toast/ติดธง `[สต็อกไม่ครบ]` แล้วประกาศสำเร็จ); JV = `void(async…)` fire-and-forget หลัง sale → เปิดช่อง "ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ". **owner เลือก strategy: reuse soft-delete + revert (ไม่เพิ่ม sales.status, ไม่เขียน path คืนสต็อกใหม่).** **แก้ 3 จุด (`modules/pos.js` doCheckout):** (1) **idempotency key** — `const checkoutKey = globalThis.crypto?.randomUUID?.() || (orderNo+"-"+Math.random…)` ก่อน insert (single-flight `_posCheckoutGuard` กัน double-click อยู่แล้ว = 1 attempt 1 key) + `noteParts.push("CHECKOUT_KEY:"+checkoutKey)` (order_no คงไว้แสดงผล; sales ไม่มี doc_no → ไม่กระทบเลขบัญชี). (2) **HARD FAIL** — `if (failedItems.length>0 || stockFailedItems.length>0)`: คืนสต็อก `await window._appRevertStockForSale({saleId,orderNo})` (helper เดิม Phase 499/483 — atomic-claim + qty-aware cap, iterate sale_items ∩ stock_movements ของ orderNo) + soft-delete `PATCH sales note += " [ลบแล้ว] CHECKOUT_FAILED:"+key` (marker เดิม `visibleSalesForRole` ซ่อน) → **ไม่ post JV · ไม่ clear cart (ให้ retry) · ไม่เปิดใบเสร็จ · ไม่ประกาศสำเร็จ** → `return {ok:false, needsManualReview, …}`; `needsManualReview = !revertOk || !softDeleteOk` → toast error ให้ admin ตรวจ (ลบ flag `[สต็อกไม่ครบ]` PATCH เดิมทิ้ง = แทนด้วย hard rollback). (3) **await JV** — ย้าย `postJournalForSale({…},{detailed:true})` จาก fire-and-forget → `await` ก่อนเปิดใบเสร็จ → `_jvWarn` gate ข้อความ (failed → "ขายถูกบันทึกแล้ว แต่ลงบัญชีอัตโนมัติไม่สำเร็จ"; posted/skipped pre-effective → "เรียบร้อย ✅"); บิล commit แล้ว JV fail = **ไม่ rollback** (สต็อกตัดถูก). **ไม่แตะ `auto_post.js`** (มี detailed:true อยู่แล้ว). **ไม่แตะ:** credit_ledger/redeem RPC/`refunds.js` 517a · JV mapping/VAT/2180 split · credit_payments + Phase 514 · stock CAS internals · UI เครดิต · RLS/customer OTP · service JV (ยัง background). **ไฟล์:** `modules/pos.js` · `tests/checkout_idempotency_guard.test.js` (ใหม่ 7) · `tests/service_pos_jv_background_guard.test.js` (POS→awaited, service ยัง background) · `tests/receipt_acct_trace_refresh_guard.test.js` (POS→awaited; JV post ก่อนเปิดใบเสร็จ = badge เจอ JV เร็วขึ้น) · `tests/checkout_stock_precheck_guard.test.js` (widen window 18k→20k) · `index.html`/`sw.js`/`dashboard_readonly_guard`→518 · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit **2133/2133** · e2e **14/14** (build 518 sync) · diff-check clean · EOL LF. **🔴 owner preview smoke (ก่อน merge — พฤติกรรม checkout เปลี่ยน):** (a) ขายปกติ → "เรียบร้อย ✅" + ใบเสร็จ + สต็อกตัด (preview pre-go-live JV=skip ปกติ). (b) จำลอง sale_items/stock fail (เช่น RLS/offline) → ต้อง **ไม่** ประกาศสำเร็จ + บิลหาย (soft-deleted) + สต็อกคืน + cart คงอยู่. (c) double-click → 1 บิล (single-flight). **residual NIT:** item insert ล้ม "แต่" stock ตัดสำเร็จ → `_revertStockForSale` iterate sale_items (item นั้นไม่อยู่) → อาจ under-revert (edge หายาก: insert+deduct คนละ table; precheck กัน oversell ส่วนใหญ่) — harden ใน 517b-1 ถ้าจำเป็น. **Status: ✅ MERGED main `95000a3` (ff-merge) + LIVE pages.dev build 518 / sw v518 / ?v=518 ครบ (CI Tests+Deploy success) 2026-06-22. owner preview smoke ผ่าน: บิลจริง BSK-1782133005691 (50฿) เก็บเงิน+ใบเสร็จ+cart clear; double-click=1 บิล. (receipt badge "ยังไม่ลงบัญชี" = คาดไว้ pre-go-live JV skip — งาน 517b-1). 🔜 517b-1 (await JV ชัด + ใช้ redeem_customer_credit ตอนใช้เครดิต + 2180 clearing atomic + compensation/release ตรวจสอบได้ ห้าม rollback มั่วหลังขายสำเร็จ) = phase ใหม่ ต่อจากนี้.**

**build 517 (Phase 517a — customer-credit-2180-ledger-foundation · ✅ MERGED+LIVE `198ab63` + SQL applied prod):** **Baseline:** main `5df2f4a` (build 516). **บริบท:** owner ส่ง prompt Phase 517 (use customer credit 2180 on new sale) — engineer audit เทียบ source จริงก่อนทำ. **ผล audit (verify จริง):** Phase 512 ลง Cr 2180 ตอนคืนเครดิต/เปลี่ยนสินค้าอยู่แล้ว แต่ **ไม่มี source-of-truth ระดับลูกค้า** ว่าใครเหลือเครดิตเท่าไร · `customers.id`=**bigint** (ไม่ใช่ uuid — prompt เขียนกว้าง) · `refunds.customer_id`=`|| null` (walk-in คืนเครดิตได้แต่ผูกลูกค้าไม่ได้ = STOP condition จริง) · `postJournalForSale` **ยังไม่ split multi-payment** (3 บรรทัด Dr cash/Cr rev/Cr 2170) · **🔴 checkout rollback ไม่พอ:** `pos.js doCheckout` post JV แบบ **async fire-and-forget หลัง sale commit** (`pos.js:1328-1341`) + `order_no="BSK-"+Date.now()` ไม่ใช่ idempotency key เสถียร + ไม่มี compensation/release → ถ้า redeem สำเร็จ + sale commit + JV fail = **"ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ"** (ledger ↔ GL 2180 diverge). **→ owner ตัดสิน: split → ทำ 517a (foundation, ปลอดภัย) เลย / เลื่อน 517b (POS use-credit) จนกว่า rework checkout.** **517a ทำอะไร:** (1) `supabase-phase517a-customer-credit-ledger.sql` (owner รัน) = ตาราง `customer_credit_ledger` (customer_id bigint FK, source_type [refund_credit/refund_exchange/sale_credit_use/adjustment], source_id, source_key, amount NUMERIC(14,2) +เพิ่ม/-ใช้) · `uq_ccl_source`(source_type,source_id) + `uq_ccl_source_key`(source_type,source_key) idempotency · idx customer_id · RLS: PERMISSIVE staff อ่านได้ + insert ได้เฉพาะ `amount>0 AND source_type IN (refund_credit,refund_exchange)` หรือ `is_admin()` (= client ลง negative sale_credit_use ตรงไม่ได้) + RESTRICTIVE deny `is_customer_role()` (ตารางใหม่ ไม่อยู่ใน loop phase505) · **RPC `redeem_customer_credit(customer_id,source_key,amount,note)`** SECURITY DEFINER + `pg_advisory_xact_lock` ต่อลูกค้า + idempotent (source_key replay→คืน row เดิม) + reject `balance<amount-0.01` หรือ `amount<=0` ด้วย 23514 + insert `-amount` (**ยังไม่มี caller — 517b เรียก**) · STEP0 inspect (count refund ไม่มี customer_id / มี / net 2180) · backfill refund credit/exchange ที่มี customer_id (ON CONFLICT DO NOTHING) · NOTIFY pgrst. (2) `modules/refunds.js` — หลัง JV (step 3) เพิ่ม step 3b: ถ้า `refundMappingKeyForMethod(method)` ∈ {refund_credit,refund_exchange} + มี customer_id → POST `customer_credit_ledger` +amount (round2, source_id=refund.id) **best-effort** (409=idempotent ok; fail→toast warning ไม่ rollback refund); customer_id null → warn ไม่สร้างเครดิตลอย. (3) guard `tests/customer_credit_2180_use_guard.test.js` (11) + ขยาย window `refund_restock_guard` (+1.5KB จาก block ใหม่ ไม่ลด assertion) + bump `dashboard_readonly_guard`→517. **ไม่แตะ:** POS checkout · `postJournalForSale` · credit_payments + Phase 514 guard · refund cash/transfer mapping · JV เดิม Phase 512 (refund ยัง Dr4110/Cr2180) · VAT · customer OTP. **Verification:** lint:errors 0 · unit **2126/2126** (รวม guard ใหม่ 11) · e2e **14/14** (build 517 sync) · diff-check clean · EOL LF ทุกไฟล์. **Smoke (owner รัน SQL ก่อน):** STEP0 inspect → apply → ลูกค้ามีเครดิต 100 → ใช้ RPC redeem 80 ได้ ledger -80 เหลือ 20 → redeem 120 โดน 23514 ไม่ผ่าน. **🔴 owner action:** รัน `supabase-phase517a` SQL (ตรวจ STEP0-A customers.id=bigint ก่อน; ถ้า STEP0-B>0 = refund เครดิตไม่มีลูกค้า ตัดสินใจผูกย้อนหลัง). **Status: ✅ MERGED main `198ab63` (ff-merge) + LIVE pages.dev build 517 / sw cache v517 / ?v=517 ครบ (CI Tests+Deploy success) 2026-06-22. SQL applied prod (owner: RLS enabled / indexes / PostgREST reload / STEP0 สะอาด — ดู ledger). 🔒 517b (POS use-credit, Dr 2180 split) ยังไม่เริ่ม — ต้อง rework checkout ก่อน: idempotency key เสถียร (แทน order_no=Date.now()) + redeem compensation/release + 2180-clearing JV ไม่ fire-and-forget (กัน "ขายสำเร็จแต่ล้าง 2180 ไม่สำเร็จ").**

**build 516 (Phase 516 — cf-sanitizer-rollout · audit S4 (ปิดครบ) · ✅ MERGED+LIVE `1dccd66` · functions-only):** **Baseline:** main `2e9a821` (build 515). **ต่อจาก 515** (residual ที่ owner เลือกแยกเฟส): rollout `_error_sanitizer.js` ไปอีก **6 functions** ที่ leak pattern เดียวกัน — `ai-assistant.js` (`:298` help-catch `error:"AI error:"+helpErr.message` · `:465` top-catch `detail:String(err.message)`) · `log-error.js` (`:105` `detail:errTxt`(supabase) · `:114` `error:e.message`) · `line-notify.js` (`:94` `error:String(e.message)`) · `v1/reports/daily-summary.js` (`:298` `error:e.message`) · `v1/service-job-submit.js` (`:77/:99` `supabase_status`+`detail` · top-catch `detail:e.name+message`) · `v1/service-jobs.js` (`:130` `supabase_status`+`detail` · top-catch `detail`). **แก้:** ทุก error path → `logServerError(label, ...detail)` ฝั่ง server + คืน client `clientError(code, genericMsg)` = `{ok:false,error,code}` ไม่มี detail/supabase_status/stack/raw. import helper ตาม path: `./` (api/) · `../` (v1/) · `../../` (v1/reports/). **Verify-first:** v1 endpoints (daily-summary/service-job-submit/service-jobs) = **server-to-server ไม่มี caller ใน modules** + Ning เช็ค `ok` flag ไม่ใช่ `detail` (comment ยืนยันใน service-jobs.js) → strip ไม่ break; ai-assistant ← help_tutor.js, line-notify ← line_notify.js อ่าน `.error` (generic) ไม่ใช่ detail. **ไม่แตะ:** success path/business logic · `log-error.js` `stack` INPUT (`:84` รับ client stack เก็บลง DB = หน้าที่ endpoint ไม่ใช่ leak out) · `_middleware`/auth. **ไฟล์:** 6 functions + `tests/function_error_sanitizer_guard.test.js` (ขยาย +12 = 22) · `index.html` · `sw.js` · `tests/dashboard_readonly_guard.test.js` · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit (guard 22) · e2e · diff-check · EOL LF. **Smoke:** source-regex guard (no detail/supabase_status/stack/raw message ใน response ทั้ง 6) + helper behavioral; function-level ต้อง env/key. **🎉 audit รอบ2 ปิดครบ S1–S4** (512/513/514/515/516). **Status: ✅ MERGED main `1dccd66` + LIVE pages.dev build 516 (CI Tests+Deploy success) 2026-06-21 — owner ปิด audit รอบ2 S1-S4 ครบ.**

**build 515 (Phase 515 — cf-function-error-sanitizer · audit S4 · ✅ MERGED+LIVE `3b83938` · functions-only):** **Baseline:** main `24d5142` (build 514). **บั๊ก (audit S4):** Cloudflare Functions `/api/parse-receipt` + `/api/verify-slip` คืน internals ดิบให้ client ตอน fail → info-leak ช่วย recon: `parse-receipt.js:177` `stack: e.stack` · `:127` `detail: errTxt`(raw Gemini) · `:151` `attempts`(model names+raw) · `:167` `raw: text`(AI output); `verify-slip.js` `detail`/`attempts` + `:237` ก้อนใหญ่ (`raw`+`parseError`+`model`+`finishReason`+Google `promptFeedback`) + top-catch `error: e?.message`. **แก้ (functions-only):** helper ใหม่ `functions/api/_error_sanitizer.js` — `logServerError(label,...detail)` (console.error เต็มฝั่ง server/Cloudflare logs, never throws) + `clientError(code,message,extra)` (คืน `{ok:false,error,code,...extra}` ไม่มี stack/detail/raw/attempts; `extra` = whitelist `hint`/`configured` เท่านั้น). patch ทุก error path ของ 2 functions: log detail ฝั่ง server → คืน client generic message + stable code (`gemini_api_error`/`no_model_available`/`ai_invalid_json`/`internal_error`). **ไม่แตะ:** success path (`{ok:true,data,...}` คงเดิม) · `buildSlipVerification`/verification logic · client UX (`j.detail`/`j.raw` ที่ client แสดง = optional graceful no-op เมื่อหาย — ตรวจ expenses.js/service_form.js แล้ว) · status code เดิม (parse 200 / verify-slip top-catch 500). **Verify ก่อนแก้:** client field reads (expenses `j.ok/configured/error/detail/data` · ac_install/solar `j.error` · service_form `j.error/j.raw`) — strip แล้วไม่ break เพราะทุกตัว conditional. **เสริม:** keep operator `hint` (API-key guidance ไม่ใช่ leak). **ไฟล์:** `functions/api/_error_sanitizer.js` (ใหม่) · `functions/api/parse-receipt.js` · `functions/api/verify-slip.js` · `tests/function_error_sanitizer_guard.test.js` (ใหม่ 10) · `index.html` · `sw.js` · `tests/dashboard_readonly_guard.test.js` · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit (รวม guard 10) · e2e · diff-check · EOL LF. **Smoke:** function-level ยาก (ต้อง Gemini key/env) → guard เป็น helper-behavioral + source-regex (no stack/detail/raw/promptFeedback ใน response); manual: ทำให้ parse-receipt/verify-slip fail (เช่น key ผิด) → client เห็นข้อความ generic + code ไม่มี stack/raw. **🔴 residual (Phase 516 — narrow-scope, owner เลือก):** อีก 5 functions มี pattern เดียวกัน — `ai-assistant.js:465` `detail:String(err.message)` · `log-error.js:105/114` · `daily-summary.js:298` · `service-job-submit.js:77/99/109` (`detail`+`supabase_status`+raw) · `service-jobs.js:131/151` · + `line-notify.js:94` (owner เพิ่ม). helper พร้อม reuse. **Status: ✅ MERGED main `3b83938` + LIVE pages.dev build 515 (CI Tests+Deploy success) 2026-06-21. owner review: narrow-scope (parse-receipt+verify-slip) ยอมรับ → ทำ Phase 516 ต่อทันที.**

**build 514 (Phase 514 — credit-overpay-db-guard · audit S3 · ✅ MERGED+LIVE `f430543` + SQL applied):** **Baseline:** main `9a54e2e` (build 513). **บั๊ก (audit S3):** `credit_payments` กัน over-pay แค่ฝั่ง client (`modules/credit_tracker.js:412` `amount > sale._due + 0.01`) → race / direct REST API / หลายเครื่องจ่ายพร้อมกัน → `SUM(credit_payments.amount)` เกิน `sales.total_amount` → `credit_paid_amount`/AR เพี้ยน (ยอดค้างติดลบ/ผี). **แก้ (DB last-line guard):** `supabase-phase514-credit-overpay-guard.sql` — function `_guard_credit_payment_overpay()` + trigger `trg_guard_credit_payment_overpay` **BEFORE INSERT OR UPDATE OF amount, sale_id** บน `credit_payments`: (1) reject `amount<=0` (2) **LOCK sales row `FOR UPDATE`** → serialize จ่ายพร้อมกัน (เครื่องที่ 2 เห็นยอดเครื่องแรกที่ commit แล้ว) (3) reject sale หาย / `is_credit` ไม่ใช่ true (4) `SUM(amount เดิม excl NEW.id) + NEW.amount > total_amount + 0.01` → reject (ไม่ auto-clamp). **mirror** `trg_guard_refunds_insert` (92.61b) + ERRCODE 23514 + NOTIFY pgrst. **★ เสริมจาก prompt (3):** `SECURITY DEFINER` (SUM เห็นทุก row จริง ไม่ถูก RLS บังหน้า=bypass) · **STEP0 inspect** legacy `credit_payments` บน non-credit sale ก่อน apply (กัน false-positive reject) · JS error message ชัดเมื่อ overpay. **JS:** `processCreditPayment` Step-1 insert-fail path คืน `{ok:false, ledgerInserted:false, retrySafe:true}` **อยู่แล้ว** (DB reject ตกที่นี่) + `atomicAdd` (sync credit_paid_amount) อยู่ Step-2 หลัง insert → reject = ไม่ sync **โดยอัตโนมัติ** (test ล็อก); แตะแค่ error string. **ไม่แตะ:** COA/account_mapping/JV/refund/stock/RLS เดิม/dashboard/use-credit-on-new-sale. **ไฟล์:** `supabase-phase514-credit-overpay-guard.sql` · `modules/credit_tracker.js` (error msg) · `tests/credit_overpay_db_guard.test.js` (ใหม่ 10) · `index.html` · `sw.js` · `tests/dashboard_readonly_guard.test.js` · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit (รวม guard ใหม่ 10) · e2e · diff-check · EOL LF. **Owner SQL smoke:** STEP0 inspect (legacy=0 ก่อน apply) → STEP1 apply → STEP2 trigger enabled → STEP3 negative (จ่ายเกิน → ERROR + credit_paid_amount ไม่ขยับ) → STEP4 normal (จ่ายไม่เกิน → ผ่าน). **Known residual:** use-credit-on-new-sale (ล้าง 2180) แยกเฟส; guard กันเพิ่มเท่านั้น ไม่ลบ over-paid เก่า (STEP0-b ดูได้). **Status: ✅ MERGED main `f430543` + LIVE pages.dev build 514 (CI Tests+Deploy success) + SQL applied prod 2026-06-21 (owner: STEP0-a/b=0 · trigger enabled tgenabled=O · prosecdef=true · STEP3 negative 23514 reject · STEP4 normal pass · cleanup สะอาด; ดู `DB_MIGRATIONS_APPLIED.md`).**

**build 513 (Phase 513 — stock-new-warehouse-insert-guard · audit S2 · ✅ MERGED+LIVE `f005a12`):** **Baseline:** main `5bbfbee` (build 512). **บั๊ก (audit S2):** `_applyStockMovement` (`main.js`) ตอน "ไม่มี warehouse_stock row เดิม" ของ (product,warehouse) นี้ แล้วต้อง insert row ใหม่ (movement in/return/adjust หรือ allowNegative override) — เดิม `await xhrPost("warehouse_stock", {...})` (1 บรรทัด) **ไม่เช็ค `.ok` / ไม่ขอ row id (`returnData`) / ไม่ push เข้า `state.warehouseStock`** → insert ล้ม (RLS/network/DB CHECK) ก็ไหลต่อไป recompute + `xhrPost("stock_movements")` + return `ok:true` = **phantom movement** (audit หลอกว่ารับเข้าแล้วทั้งที่ของไม่เพิ่ม); แม้ insert สำเร็จ cache ก็ไม่มี row ใหม่ → `products.stock` recompute under-count จน reload. **แก้ (main.js เฉพาะ branch ไม่มี `ws?.id`):** mirror transfer new-target (Phase 368, `_transferWarehouseStock`): `xhrPost("warehouse_stock", {...}, { returnData: true })` → ถ้า `!res.ok || !res.data?.id` → `return { ok:false, error }` **ก่อน** ถึง stock_movements → ถ้าสำเร็จ set `after` จาก `res.data.stock` + `state.warehouseStock.push({ id: res.data.id, ... })`. **ไม่แตะ:** `_transferWarehouseStock` (new-target check มีอยู่แล้ว คนละจุด) · out/sale no-row + `!allowNegative` ยัง return insufficient (ไม่ insert ติดลบ) · POS/sale/service-deduct/accounting/JV/credit/SQL/RLS/schema/DB trigger · `products.stock` direct write (Phase 403 trigger derive). **Verify ก่อนแก้:** `xhrPost` (`modules/api.js:81`) `opts.returnData` → `return=representation` → คืน `{ok, data:row, error}` (row มี id/stock/min_stock ครบ); property cache = `state.warehouseStock` (camelCase) ✓; line/contract ตรง prompt 100%. **ไฟล์:** `main.js` · `tests/apply_stock_movement_insert_guard.test.js` (ใหม่ 7 assert) · `index.html` · `sw.js` · `tests/dashboard_readonly_guard.test.js` · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit (รวม guard ใหม่ 7) · e2e · diff-check clean · EOL LF. **Owner smoke:** หน้า stock movement/รับเข้า → เลือกสินค้า+คลังที่ยังไม่มี row → รับเข้า 1 ชิ้น → ต้องเห็น warehouse_stock row ใหม่ (id จริง) + stock_movements log เฉพาะเมื่อ insert สำเร็จ; force insert fail (ถ้าทำได้) → error + ไม่มี movement หลอก. **Status: ✅ MERGED main `f005a12` + LIVE pages.dev build 513 (CI Tests+Deploy success) 2026-06-21.**

**build 512 (Phase 512 — refund-credit-customer-liability-2180 · accounting policy · owner-run SQL):** **Baseline:** main `6677d38` (build 511). **บั๊ก:** `postJournalForRefund` default credit/exchange refund ไป `refund_cash` → Cr1110 เงินสด ทั้งที่ลูกค้าไม่ได้รับเงินสดออกจริง (phantom cash). **แก้:** เพิ่ม `refundMappingKeyForMethod()` ใน `modules/accounting/auto_post.js`: cash→`refund_cash`, transfer→`refund_transfer`, credit→`refund_credit`, exchange→`refund_exchange`; unknown method = return detailed `{ status:"failed", reason:"unknown-refund-method" }` ไม่ fallback เงินสด. **SQL owner-run:** `supabase-phase512-refund-credit-2180.sql` seed/update COA `2180 เครดิตคงเหลือลูกค้า/เจ้าหนี้ลูกค้าจากใบลดหนี้` + mappings `refund_credit`/`refund_exchange` = Dr4110/Cr2180; ไม่แตะ `refund_cash`/`refund_transfer`. **ไม่แตะ:** POS/stock/credit_payments/customer-credit-ledger/use-credit-on-new-sale/VAT split/RLS. **ไฟล์:** modules/accounting/auto_post.js · supabase-phase512-refund-credit-2180.sql · tests/refund_credit_2180_guard.test.js · index.html · sw.js · tests/dashboard_readonly_guard.test.js · CHANGELOG/HANDOFF/SESSION_START. **Verification:** lint:errors 0 · unit 2076/2076 · e2e 14/14 · diff check clean · EOL LF. **Owner smoke:** run SQL → hard refresh cache v512 → ทำ refund cash/transfer/credit/exchange แล้วตรวจ JV: cash Cr1110, transfer Cr1130, credit/exchange Cr2180; unknown method ต้อง failed/เตือน ไม่ลง JV เงินสด. **Known residual:** customer credit ledger/use-credit-on-new-sale แยกเฟส; refund VAT split แยกเฟส; DB over-pay trigger credit/payment ยังเป็น residual แยกจากเฟสนี้. **Status: ✅ MERGED+LIVE build 512 `5bbfbee` + SQL applied prod 2026-06-21 (owner รัน — STEP3 mappings 4 แถวถูก, COA 2180 ยืนยันผ่าน FK; ดู `DB_MIGRATIONS_APPLIED.md`).**

> 🆕 **เปิด session ใหม่? อ่าน [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) ก่อน** (canonical protocol) แล้วตามด้วย [`SESSION_START_SHARED.md`](SESSION_START_SHARED.md) + ส่วนล่าสุดของ HANDOFF/CHANGELOG
> 🆕 และ [`SESSION_LOG.md`](SESSION_LOG.md) — push history, SQL tracker, audit progress
> ⚠️ `CLAUDE_SESSION_HANDOFF.md` / `CLAUDE_CODE_PROMPT.md` / `CLAUDE_CODE_WORKFLOW.md` = **superseded** (historical) — เป็น redirect ไป `IMPLEMENT_TEAM_PROTOCOL.md` แล้ว อย่าใช้เป็น workflow หลัก

**build 511 (Phase 511 — mobile Thai IME search · rebase ของ branch 507 เดิม · 🔵 UI low-risk):** **Baseline:** main `f664ae4` (build 510). **ที่มา:** branch `claude/phase-507-mobile-search-ime` (`c934736`, base 2e366cb=build 506 era) ค้าง build 507 — owner สั่ง rebase main ล่าสุด + renumber 507→**511** ก่อน merge (507-510 ใช้ไปแล้วโดย credit/dashboard/JV/OTP). **บั๊ก:** `products.js renderView` (`#prodSearchInput`) — search handler debounce 300ms แล้ว `renderView` (สร้าง input ใหม่); ทำกลาง **Thai IME composition** (ประกอบสระ/วรรณยุกต์) → ตัวซ้ำ/เด้ง ("หน้"→"หน้หน้า") บนมือถือ. **แก้ (products.js เท่านั้น, 13 บรรทัด):** แยก `_runProdSearch(val)` (debounce+trim+renderView focusSearch เดิม); `input` listener → `if (e.isComposing) return` (ข้ามระหว่างประกอบ กัน input re-render กลางพิมพ์) + เพิ่ม `compositionend` listener → `_runProdSearch` (commit ตัวไทยเสร็จค่อยค้นหา). เดสก์ท็อป/แป้นอังกฤษ (ไม่มี composition) = ทำงานเหมือนเดิม. **rebase วิธี:** products.js บน main == base ของ branch (ไม่ถูกแตะ build 507-510) → หยิบ `modules/products.js` + `tests/products_search_ime_guard.test.js` จาก branch ตรง ๆ (ไม่ cherry-pick build markers เก่า) + bump 511 สด. **ไม่แตะ:** deduct/save/price-edit/warehouse-pick (POS 463/464) · stock/credit/accounting · search อื่น (stock_movements transfer search = Phase 459/460 คนละจุด). **bump 510→511 ครบ** (data-app-build + style/selfheal/main/boot ?v=511 + sw cache-v511 + comment; data-app-version 5.69.22/package คงเดิม; grep 510 build-tracking ว่าง). **ไฟล์ (5):** modules/products.js · index.html · sw.js · +tests/products_search_ime_guard.test.js (4 guard: isComposing-bail · compositionend-listener · debounce+renderView+trim คง · isComposing guard อยู่ใน input listener) · tests/dashboard_readonly_guard.test.js (510→511) (+CHANGELOG/HANDOFF/SESSION_START). **Verification:** lint:errors 0 · unit **2073/2073** (+4) · e2e **14/14** (build-sync 511) · EOL LF. **สถานะ:** ✅ **MERGED + LIVE build 511** (squash `6282c20`, 2026-06-21, owner สั่ง merge; CI Tests+Deploy success; prod data-app-build 511 + cache-v511). branch เดิม `claude/phase-507-mobile-search-ime` ลบแล้ว (superseded). **owner smoke (มือถือไทย):** หน้าสินค้า → ช่องค้นหา → พิมพ์ไทยมีสระ/วรรณยุกต์ ("น้ำ"/"หน้า") บนมือถือ → ตัวไม่ซ้ำ/ไม่เด้ง + ผลค้นหาขึ้นหลังพิมพ์เสร็จ; เดสก์ท็อปพิมพ์ปกติ. **Known residual:** branch เดิม `claude/phase-507-mobile-search-ime` (build 507) = superseded → owner/ผม ลบทิ้งได้หลัง 511 merged. **STOP: yes.**

**build 510 (Phase 510 — security: server-side OTP verify attempt cap):** **Baseline:** main `065858d` (build 509). **บั๊ก (audit round2 open):** `/api/verify-otp` (functions/api/verify-otp.js) stateless HMAC — attempt cap เดาผิดอยู่ฝั่ง **client** `auth_otp.js:147-148` (`_pendingOtp.attempts > 5`) bypass ได้ (refresh/แก้ state/ยิง API ตรง); middleware `_middleware.js:19` `/api/verify-otp` 10/min/IP = **coarse per-IP** ไม่ผูกกับ issued OTP. → attacker เรียก `/api/send-otp` เอา `hash`+`expiresAt` ของเหยื่อ แล้ว brute-force code 000000-999999. **แก้ (server-side, functions เท่านั้น):** เพิ่ม attempt store ใน `RATE_LIMIT_KV` (KV เดียวกับ middleware, bound prod แล้ว). flow: validate→expiry(ก่อนแตะ store=ไม่สร้าง key ค้าง)→OTP_SECRET→**KV ไม่มี=fail-closed 503**→derive `attemptKey="otpatt:"+HMAC(secret,\`otp-attempt:${cleanPhone}:${expiresAt}:${hash}\`)` (ผูก issued OTP, ไม่เก็บ raw phone/code)→`kv.get` count (read error=503)→**count>=5→429 locked**→verify HMAC→ผิด: `kv.put` count+1 TTL=อายุ OTP เหลือ+30s (write error=503), ถึง 5→429 ไม่ถึง→400+remaining→ถูก: `kv.delete` (reset, best-effort) + 200 authPassword เดิม. MAX=5. **client ไม่แตะ:** `auth_otp.js:166-168` โชว์ `verifyData.error` + `return showToast` อยู่แล้ว → server 429 message ("ลองผิดเกินกำหนด กรุณาขอ OTP ใหม่") เด้งเอง, ไม่ reload/clear state; client cap เดิมคงไว้เป็น UX. **ไม่แตะ:** RLS/SQL/profiles/customers/B3 · Supabase auth role · signup/login flow หลัง OTP ผ่าน · send-otp/Twilio/SMS · POS/stock/credit/accounting/service · middleware rate-limit (coarse, คงเดิม). **bump 509→510 ครบ** (data-app-build + style/selfheal/main/boot ?v=510 + sw cache-v510 + comment; data-app-version 5.69.22/package คงเดิม; grep 509 build-tracking ว่าง). **ไฟล์ (4):** functions/api/verify-otp.js · index.html · sw.js · +tests/verify_otp_attempt_cap_guard.test.js (8 guard, **behavioral** import onRequestPost+mock KV: ถูก→200+clear key · 5 ผิด→429 locked+ถูกหลัง lock ไม่ผ่าน · success reset counter · expired→ไม่สร้าง key · no-KV→503 fail-closed · key/value ไม่มี raw code · source server-store-not-client · source middleware coarse คงอยู่) · tests/dashboard_readonly_guard.test.js (509→510 build marker) (+CHANGELOG/HANDOFF/SESSION_START). **Verification:** lint:errors 0 · unit **2069/2069** (+8) · e2e **14/14** (build-sync 510) · EOL LF. **สถานะ:** ✅ **MERGED + LIVE build 510** (`de8ffe6`, 2026-06-20, owner สั่ง push main; CI Tests+Deploy success; prod data-app-build 510 + cache-v510). ⚠️ `claude/phase-507-mobile-search-ime` build 507 ค้าง → rebase main ล่าสุด + renumber **511** (507-510 ใช้แล้ว) ก่อน merge. **owner smoke (post-merge):** ขอ OTP→ใส่ผิด 5 ครั้ง→ครั้งที่ 6 โดน block จาก server แม้ refresh/แก้ client state (Network: `/api/verify-otp` = 429)→ขอ OTP ใหม่ใส่ถูก = login/signup ได้ปกติ→customer OTP account สร้าง/login flow เดิมไม่กระทบ B3. **🔴 Known residual/risk:** (a) **fail-closed 503 เมื่อ KV ไม่ bound/มี error** — prod RATE_LIMIT_KV bound แล้ว (memory audit#A) แต่ถ้า KV หลุด = OTP login 503 ทั้งระบบ (security>availability ตาม requirement; middleware coarse ยัง fail-open แยกกัน); (b) attacker ขอ OTP ใหม่ได้ fresh 5 ครั้ง (by design — send-otp rate-limited 5/min/IP); (c) DB over-pay trigger (credit) ยังไม่ทำ; (d) `mobile-search-ime` build 507 ค้าง → renumber **511** ก่อน merge. **STOP: yes.**

**build 509 (Phase 509 — journal-form-rollback-orphan-header · 🔵 accounting integrity · surgical):** **Baseline:** main `042d9ce` (build 508). **บั๊ก (audit round2 open):** `journal_form.js` save manual JV = POST `journal_entries` (header, `return=representation` → entryId) **ก่อน** แล้ว POST `journal_lines`; เดิมถ้า lines fail (`:344-346`) แค่ toast "entry สร้างแล้วแต่ไม่มี lines" → **ทิ้ง orphan header** ที่ trial balance/รายงานบัญชีอ่านผิดเงียบ ๆ (ต่างจาก auto_post.js:314 ที่ rollback อยู่แล้ว). **แก้ (surgical, mirror auto_post pattern):** ใน catch ของ POST lines → `DELETE /rest/v1/journal_entries?id=eq.${entryId}` (auth headers เดิม `cfg.anonKey`+`token`, ไม่ import private `_authFetch`); **`Prefer:return=representation` + parse `deleted.length` → rollback สำเร็จเฉพาะ `delResp.ok && rollbackCount===1`** (patch รอบ review: filtered/RLS DELETE ลบ 0 row ก็คืน 2xx → `ok` เฉย ๆ false-positive ว่า rollback สำเร็จทั้งที่ orphan ค้าง; เคสเดียวกับ Phase 461 serial 0-row) — **rollback ok** → `return showToast("บันทึก lines ไม่สำเร็จ จึงยกเลิกหัวรายการแล้ว กรุณาลองใหม่")`; **rollback fail** (!ok หรือ throw delErr) → `return showToast("⚠️ JV ${docNo}/entry ${entryId} ค้าง … ต้องให้ admin ตรวจ/ลบ")`. ทุก path ใน catch = **early return** → ไม่ reset `_lines` · ไม่ `location.hash` · ไม่ success toast. (lines POST atomic = fail → 0 lines → DELETE header สะอาด; FK cascade เผื่อ partial). **ไม่แตะ:** auto_post.js · journal_entries schema/SQL/RLS · period-close/trial-balance/balance-sheet formula · doc_no gen · validation เดิม (date guard/validLines≥2/Dr=Cr/line_one_side/COA read-only) · POS/sales/expense/service/refund/stock · DB over-pay trigger · mobile-search-ime. **bump 508→509 ครบ** (data-app-build + style/selfheal/main/boot ?v=509 + sw cache-v509 + comment; data-app-version 5.69.22/package คงเดิม; grep 508 build-tracking ว่าง). **ไฟล์ (5):** modules/accounting/journal_form.js · index.html · sw.js · +tests/journal_form_orphan_header_guard.test.js (7 guard: entry POST return=representation · lines-fail DELETE entry?id=eq.entryId+check ok · **rollback verify deleted 1 row (2xx+0row ไม่นับสำเร็จ): return=representation+parse json+count===1** · fail path ไม่ reset/navigate/success+early-return · rollback-fail ระบุ docNo/entryId+admin+catch delErr · success path คง toast/reset/hash · validation คง) · tests/dashboard_readonly_guard.test.js (508→509 build marker — จำเป็นเพราะ guard pin build number) (+CHANGELOG/HANDOFF/SESSION_START). **Verification:** lint:errors 0 · unit **2061/2061** (+7) · e2e **14/14** (build-sync 509) · EOL LF. **สถานะ:** ✅ **MERGED + LIVE build 509** (squash `37a88f7`, 2026-06-20; owner smoke #accounting_journal_new ผ่าน + review patch 0-row-guard; CI Tests+Deploy success; prod data-app-build 509 + cache-v509). ⚠️ `claude/phase-507-mobile-search-ime` ยัง build 507 ค้าง → rebase main ล่าสุด + renumber **510** (507/508/509 ใช้แล้ว) ก่อน merge. **owner smoke (post-merge):** เปิด `#accounting_journal_new` → บันทึก JV balanced ปกติ = สำเร็จ+กลับหน้ารายการ; (จำลอง lines fail เช่น offline ตอน POST lines / account_code ผิด) = **ไม่ออกจากหน้า, ไม่ขึ้น ✅, header ไม่ค้าง** (เช็ค accounting_journals ไม่มี JV หัวเปล่า). **Known residual:** ถ้า DELETE ถูก RLS บล็อก (non-admin) → rollback-fail path แจ้ง admin (header ค้างจนลบมือ) — ยอมรับได้ (fail-safe + แจ้งชัด); DB over-pay trigger (credit) ยังไม่ทำ; `mobile-search-ime` build 507 ค้าง → renumber **510** ก่อน merge. **STOP: yes.**

**build 508 (Phase 508 — dashboard-overdue-credit-full-fetch · 🔵 AR display · low-risk · ต่อ 507):** **Baseline:** main `130ca57` (build 507). **บั๊ก (residual ของ 507):** `dashboard.js:116` การ์ด "ต้องทำวันนี้" คำนวณ `overdueCredit` จาก `visibleSalesForRole(state.sales,...)` (loadAllData cap ≤50) → จำนวนรายค้างเกินกำหนด undercount เงียบ (บั๊กเดียวกับ Credit Tracker ก่อน 507). **แก้ (reuse Phase 507 helper, ไม่ query ซ้ำ):** (1) import `fetchCreditSales` จาก `credit_sales_fetch.js`. (2) module-scope cache `_dashCreditRows`/`_dashCreditState`(idle·loading·loaded·error)/`_dashCreditSeq` + **`_dashCreditCacheKey`=`"<userId>:<role>"`** (patch รอบ review): top ของ renderDashboard เช็ค key — สลับ user/role ใน session เดียว (SPA ไม่ reload) → invalidate (rows=null/state=idle/seq++) → refetch (กันโชว์ count ของ user/role เก่า; เช็คก่อน build innerHTML = ไม่ flash ตัวเลขเก่า). (3) async IIFE ใน `renderDashboard` (mirror Phase 486 sale_items pattern): guard `if (state==='loaded'||'loading') return` (period change ไม่ refetch) → `fetchCreditSales()` → seq guard ทิ้ง stale → `visibleSalesForRole(res.rows,...)` role-filter → cache → **patch เฉพาะ `#dashTodoCard`** (`document.body.contains` guard) + re-bind clickables (binding line ~795 เป็น per-element). (4) `_renderTodayAndAlerts` อ่าน count จาก cache: loaded→count จริง (logic overdue เดิม due<today/ค้าง>0.01) · idle/loading→null→แถว "กำลังตรวจ…" (ไม่โกหก 0) · error→-1→แถว "ตรวจไม่สำเร็จ" (ไม่ fallback ต่ำกว่าจริง) · count 0→ไม่มีแถว. **read-only คงเดิม:** ไม่มี raw `fetch(` (helper `fetchCreditSales(` ไม่ match guard regex `\bfetch\s*\(` — มี fetchSaleItems อยู่แล้ว), ไม่ write verbs, ไม่ mutate state (`card.innerHTML` ไม่ใช่ state). **ไม่แตะ:** payment/processCreditPayment · POS/sales save · stock/warehouse/refund/service · accounting/JV · RLS/SQL · `credit_sales_fetch.js` (Credit Tracker ไม่ regress) · `mobile-search-ime` branch · payment-channel donut (line ~152 ยังใช้ state.sales = display-only labelled, นอก scope). **bump 507→508 ครบ** (data-app-build + style/selfheal/main/boot ?v=508 + sw cache-v508 + comment; data-app-version 5.69.22/package คงเดิม; grep 507 build-tracking ว่าง). **ไฟล์ (6):** modules/dashboard.js · index.html · sw.js · +tests/dashboard_overdue_credit_full_fetch.test.js (7 guard: import+call fetchCreditSales · overdue block ไม่ใช้ state.sales · role-filter res.rows · loader stale-seq+no-refetch-cache+no-fallback · **cache scoped by user/role + key change resets/refetches** · loading ไม่โชว์ 0 หลอก · read-only no-write) · tests/dashboard_readonly_guard.test.js (507→508) (+CHANGELOG/HANDOFF/SESSION_START). **Verification:** lint:errors 0 · unit **2054/2054** (+7) · e2e **14/14** (build-sync 508) · EOL LF. **สถานะ:** ✅ **MERGED + LIVE build 508** (squash `94bf567`, 2026-06-20; owner smoke #dashboard ผ่าน + review patch cache-scope; CI Tests+Deploy success; prod data-app-build 508 + cache-v508). ⚠️ `claude/phase-507-mobile-search-ime` ยัง build 507 ค้าง → ถ้าจะ merge ต้อง rebase main ล่าสุด + renumber **509** (507/508 ใช้ไปแล้ว). **owner smoke (post-merge):** เปิด `#dashboard` → การ์ด "ต้องทำวันนี้" ขึ้น (อาจเห็น "กำลังตรวจ…" แวบแล้วเป็นจำนวนจริง/หาย) → จำนวนค้างเกินกำหนดควรครบกว่าเดิมถ้าบิลเครดิต >50 → กดแถว → ไป `#credit_tracker` ได้ → เปลี่ยนช่วงเวลา (วันนี้/สัปดาห์/เดือน/ปี) ไม่ยิง fetch credit ซ้ำ (ดู Network) → hard refresh cache v508. **Known residual:** ยังไม่มี DB over-pay trigger · `mobile-search-ime` ยัง build 507 ต้อง renumber เองก่อน merge. **STOP: yes.**

**build 507 (Phase 507 — credit-tracker-full-fetch · 🔵 AR display · low-risk):** **Baseline:** main `2e366cb` (build 506). **บั๊ก (audit round2 "Credit cap-50"):** `credit_tracker.js:154` เดิม `renderCreditTrackerPage` sync อ่าน `visibleSalesForRole(state.sales,...)` ที่ `loadAllData` cap ≤50 (latest) → ยอดค้าง/เกินกำหนด/จำนวนบิล undercount เงียบเมื่อบิลเครดิต >50. **แก้:** (1) helper ใหม่ `modules/credit_sales_fetch.js` `fetchCreditSales()` = mirror `sales_fetch.js` (raw `fetch`, `{ok,rows,error}`, never silent-empty) → `sales?select=*&is_credit=eq.true&order=id.asc` **paginated PAGE=1000** (order PK stable กัน boundary dup/miss; `select=*` กัน PGRST204). (2) แยก fetch ออกจาก render: module-scope `_creditRows`/`_creditLoadState`(idle·loading·loaded·error)/`_creditLoadError`/`_creditLoadSeq`. `loadCreditSales(ctx,{force})` async → fetch → `visibleSalesForRole(res.rows,...)` (role behavior คงเดิม) → cache → re-render; **seq guard** ทิ้งผล fetch รอบเก่าที่ resolve ช้า; `renderCreditTrackerPage` = dispatcher (idle→loading+load · loading/error UI · loaded→render sync จาก cache). (3) **filter buttons render-only** (เรียก `renderCreditTrackerPage` เฉย ๆ — loaded → ไม่ยิง network) → ไม่กระพริบ/ไม่โหลดซ้ำ. (4) fetch fail = error + ปุ่ม "🔄 ลองใหม่" (`loadCreditSales force`) — **ห้าม fallback `state.sales`** (กัน undercount). (5) หลังรับชำระ: เดิม `loadAllData()` → เปลี่ยนเป็น `loadCreditSales(ctx,{force:true})` (refresh จาก credit-fetch จริง, ไม่พึ่ง state.sales). over-pay guard (`:366`) ตอนนี้อ่าน `_due` จาก fetch สด = แม่นขึ้น. **ไม่แตะ:** `processCreditPayment`/`reconcileCreditPaidFromLedger`/`postJournalForCreditPayment` (ledger insert→CAS→JV contract เดิม) · POS/sales save · stock/refund/service/RLS · ไม่เพิ่ม DB over-pay trigger · ไม่ mutate `ctx.state.sales`. **bump 506→507 ครบ** (data-app-build + style/selfheal/main/boot ?v=507 + sw cache-v507 + comment; data-app-version 5.69.22/package คงเดิม; grep 506 build-tracking ว่าง). **ไฟล์ (6):** modules/credit_tracker.js · modules/credit_sales_fetch.js (ใหม่) · index.html · sw.js · +tests/credit_tracker_full_fetch.test.js (10 guard: helper paginated/is_credit/id.asc/{ok,false} · ไม่ใช้ state.sales · cache+seq · filter render-only · ไม่ loadAllData · post-pay force · processCreditPayment intact) · tests/dashboard_readonly_guard.test.js (506→507) (+CHANGELOG/HANDOFF/SESSION_START). **Verification:** lint:errors 0 · unit **2047/2047** (+10) · e2e **14/14** (build-sync 507) · EOL LF. **สถานะ:** ✅ **MERGED + LIVE build 507** (PR #96 `dc2737f`, 2026-06-20; CI Tests+Deploy success; prod data-app-build 507 + cache-v507). ⚠️ merge order: branch นี้ merge ก่อน `claude/phase-507-mobile-search-ime` (ซึ่งก็ใช้ 507) → **mobile-search-ime ต้อง renumber → 508** ก่อน merge (build/cache marker ชน 507 ที่ live แล้ว). **owner smoke (post-merge):** เปิด `#credit_tracker` → loading แล้วเห็น list/stats (ยอดควรครบกว่าเดิมถ้าบิลเครดิต >50) → สลับ filter open/overdue/paid/all = สลับทันที ไม่กระพริบ/ไม่ยิง network ซ้ำ (ดู Network tab) → ปิด network/mock fail = ขึ้น error+ลองใหม่ ไม่ใช่ตัวเลขเก่า → รับชำระ 1 บิล (preview/test data) แล้ว list refresh + ยอดถูก. **Known residual:** (a) **dashboard.js:116 `overdueCredit` KPI ยังอ่าน `visibleSalesForRole(state.sales)`** = undercount เดียวกัน → แยกเฟส (Phase 508?) · (b) ยังไม่มี DB over-pay trigger (client guard `:366` เท่านั้น) · (c) credit list cache ค้างข้าม navigation จนกว่า force/retry/payment (ตั้งใจตาม design — กัน re-fetch ทุก filter). **STOP: yes.**

**Phase 505 (security — RLS restrictive deny customer OTP · audit B3 · DB-only · build คงเดิม 504):** **Baseline:** main `7398a08` (build 504), tree สะอาด. **ปัญหา (B3, full-system audit รอบ2):** `supabase-rls-policies.sql` เปิด `FOR ALL TO authenticated USING(true) WITH CHECK(true)` แทบทุกตาราง. ลูกค้า login ผ่าน OTP = `role=authenticated` **จริง** (ไม่ใช่ anon) → พิมพ์ `sb.from('staff').select('*')` ใน console อ่าน **PIN/ยอดขาย/รายจ่าย/สต็อก/credit** ทั้งร้านได้. **discriminator (reviewer verify live 2026-06-20):** customer OTP ทั้ง 6 ราย `profiles.role='customer'` AND `raw_user_meta_data->>'role'='customer'` ตรงกัน; staff ที่ meta='customer' = 0 → ใช้ `profiles.role='customer'` เป็นหลัก + metadata เป็น belt-and-suspenders (ไม่ต้อง backfill/แก้ handle_new_user). **วิธี (แคบ — ไม่ rewrite permissive staff):** เพิ่ม helper `public.is_customer_role()` (SECURITY DEFINER STABLE search_path, dual-source, GRANT authenticated) + **RESTRICTIVE policy `deny_customer_<t>`** ทับตารางธุรกิจ. RESTRICTIVE = AND กับ permissive เดิม → staff (NOT customer) ผ่าน → ใช้ policy เดิม; customer ไม่ผ่าน → deny. **★ ต้อง `NOT COALESCE(is_customer_role(),false)`** — qual=NULL บน RESTRICTIVE จะ deny ทุกคนรวม staff. **2 กลุ่ม:** **(A) deny เต็ม FOR ALL** (USING+CHECK = NOT COALESCE...) **40 ตาราง** (repo 36 + 4 จาก STEP0-A live): staff/sales/sale_items/expenses/stock_movements/warehouse_stock/warehouses/products/credit_payments/refunds/receipts(+items)/quotations(+items)/delivery_invoices(+items)/loyalty_points/product_serials/product_bundles/recurring_expenses/tasks/quote_templates/app_settings + บัญชี/payroll/HR (journal_entries/journal_lines/chart_of_accounts/accounting_periods/account_mapping/fiscal_periods/staff_payroll/staff_attendance/staff_applications/staff_leaves/staff_leave_overrides/staff_resignations/leave_policies) **+4 live cross-check** (line_notify_settings/loyalty_settings/permissions/staff_sessions). **(B) deny อ่าน แต่เปิด INSERT** (USING=deny, **WITH CHECK=true**) 2 ตาราง: `service_jobs` (สั่งงาน/สั่งซื้อ — checkout จงใจไม่ส่ง created_by → ★ ห้ามใส่ created_by ใน CHECK) + `customers` (signup auth_otp.js:221). **(C) profiles self-scope** (`deny_customer_profiles` RESTRICTIVE, USING+CHECK = `NOT customer OR id=auth.uid()`): customer เห็น/แก้แค่ own row, staff เห็นหมด — ★ ไม่ใส่ profiles ใน A (login main.js:1070 อ่าน own row ไม่ได้→fallback role='sales'=escalation) หรือ B (CHECK true→insert profile ปลอม role); guard_profile_role_update(495) ยังคุม role-change; profiles_with_email (security_invoker) inherit→customer เห็นแค่ own. DO-block loop + `to_regclass` guard (ตารางไม่มี = skip ไม่ error) + idempotent (DROP IF EXISTS) + ปิดท้าย `NOTIFY pgrst`. **ไม่แตะ:** runtime JS/schema/column · permissive `auth_all_*` เดิม · POS/stock deduct-restore/transfer/refund-math/auto_post/phase499-500 markers · profiles (login อ่าน own profile — เว้นไว้, ดู residual). **bump:** ❌ ไม่แตะ runtime → **ไม่ bump build/cache** (data-app-build/?v=/sw CACHE_NAME คงเดิม 504; e2e build-sync ยืนยัน). **ไฟล์ (4):** `supabase-phase505-rls-customer-deny.sql` (ใหม่, GROUP A+B+C) · `tests/rls_customer_deny_guard.test.js` (ใหม่, 9 guard) · CHANGELOG.md · HANDOFF.md · DB_MIGRATIONS_APPLIED.md (pending). **Verification:** lint:errors 0 · unit **2011/2011** (รวม 9 guard ใหม่) · e2e **14/14** · EOL LF. **สถานะ:** ✅ **APPLIED live 2026-06-20** (owner รัน SQL Editor — **43 policies** verified: customer JWT staff=0/profiles=1 · INSERT service_jobs สำเร็จ · admin ขายจริง end-to-end ไม่ regress). STEP0-A cross-check เพิ่ม **4 ตาราง** (line_notify_settings/loyalty_settings/permissions/staff_sessions [FOR ALL true อันตรายสุด]; store_settings เว้น public-by-design) → **GROUP A = 40** (repo file sync ตรง live แล้ว commit 3). branch `claude/phase-505-rls-customer-deny` — **รอ owner merge main** (RLS ทำงานแล้วผ่าน NOTIFY pgrst ไม่ต้องรอ merge/deploy). **Owner SQL smoke (ในไฟล์ §5):** customer JWT → SELECT staff/sales/credit_payments/expenses = 0 row (deny) + INSERT service_jobs/customers = สำเร็จ; admin/sales/technician/accountant อ่าน-เขียนงานหลัก ไม่ regress; customer signup/login OTP ในแอปยังเข้าได้. **🔴 Known residual (ระบุชัด ให้ owner ชั่งใจ):** (a) หน้าลูกค้า (`customer_dashboard`) จะไม่เห็น "ของฉัน" — mySales/myServiceJobs/myPoints/customer-record (อ่านผ่าน RLS ตรง → deny → 0 row, ไม่ error เพราะ allSettled+[]); (b) **ลูกค้ากด "ยืนยันรับงาน/ปิดงาน" เองไม่ได้** (`customer_dashboard.js:797` xhrPatch service_jobs status=closed → Group B USING deny UPDATE → 0 row) — เป็น behavior change ที่ owner ควรรับทราบ; (c) write-abuse คงเดิม (WITH CHECK true เปิด INSERT — ไม่ regress แต่ยังไม่ harden); (d) ✅ **ปิดแล้ว (GROUP C, commit 2):** `profiles` self-scope → ลูกค้าอ่านชื่อ/เบอร์/email staff จาก profiles/profiles_with_email ไม่ได้แล้ว (เห็นแค่ own row; login role='customer' ไม่ fallback 'sales'). **Known follow-up (นอก scope):** ownership model (customers.auth_user_id/sales owner link) คืน "ของฉัน" + ปุ่มปิดงานลูกค้า · write-abuse hardening · Phase 506 Cloudflare fn error-detail leak (parse-receipt/verify-slip). **STOP: yes.**

**build 454 (Phase 452 — service-drawer picker warehouse-first):** picker "เลือกอุปกรณ์" หน้าแจ้งซ่อม/บริการ (`service_equipment.js openEquipmentPicker`, เปิดจาก service job drawer main.js:2416 serviceAddEquipmentBtn — **คนละ picker กับ 453a ติดตั้งแอร์**) เพิ่มเลือกคลังก่อน+กรองหมวด (mirror 453a). ✅ **MERGED + LIVE build 454** (2026-06-16; rebased Phase 452 onto main + re-bump 452→454 กันเลขถอย [452<453 live]; re-apply service_equipment.js+guard บน main สะอาด [main ไม่แตะไฟล์นี้]; smoke PASSED บนหน้าแจ้งซ่อม/drawer: chips ครบ 5+เลือกคันแดง→list เหลือคันเดียว showsOther=0+console 0 error; ❌ ไม่แตะ deduction/onPick contract/0 write). เหลือคิว: 453b service_form · 453c solar · equip-remaining display.

**build 455 (Phase 453b/c — service_form + solar pickers warehouse-first):** picker "เลือกอุปกรณ์" ของ `service_form.js _openItemPicker` (svpk — ครอบ**ทุกหน้าซ่อม**: ซ่อมแอร์/ล้าง/ย้าย/ตู้เย็น/ซักผ้า/ทีวี/CCTV/จานดาวเทียม/งานอื่นๆ ผ่าน SERVICE_FORM_ROUTES) + `solar.js _solOpenItemPicker` (solpk — โซลาร์) เพิ่มเลือกคลังก่อน+กรองหมวด (mirror 453a เป๊ะ — pickers ทั้ง 3 เป็น near-copy กัน ต่างแค่ id prefix/helper alias). ทำโดย implement subagent + verify อิสระ (click handler ตรง 453a, 0 write, ไม่แตะ deduction/transfer/_pickMobileWarehouse/add-payload, guard 26 picker test). ✅ **MERGED ff `adf93db` + LIVE build 455** (2026-06-16; ff ตรง base=main `92c6bb7`; owner เลือก push เลย ไม่ smoke [โค้ด mirror 453a/452 ที่ smoke live แล้ว, origin preview ใหม่ติด login]). 🎉 **ครบทุกหน้างานช่าง warehouse-first:** ติดตั้งแอร์(453a)·drawer แจ้งซ่อม(452)·ทุกหน้าซ่อม(453b)·โซลาร์(453c). ⚠️ owner เช็คใบจริงใบแรกว่าตัดสต็อกถูกคัน. เหลือ: equip-remaining display (โชว์ตัดจากคลัง+คงเหลือ ต่อแถวอุปกรณ์ — prompt พร้อม).

**build 456 (Phase 456 — per-warehouse stock summary cards, หน้าสินค้า/คลัง):** เพิ่มแถวการ์ดสรุปสต็อกต่อคลังเหนือ dropdown เลือกคลัง ใน `products.js renderView` (READ-ONLY DISPLAY). การ์ด "🏪 ทุกคลัง" (data-wh-card="all") ก่อน แล้วการ์ดต่อคลัง (is_mobile→🚐/📦) — แต่ละใบโชว์ `{N} รายการ · {M} ชิ้น` (รายการ = product ที่ stock>0 ในคลังนั้น นับซ้ำข้ามคลังตามตั้งใจ; ชิ้น = sum stock). คลิกการ์ด = สลับ `selectedWarehouse` + `currentPage=1` + re-render (mirror handler dropdown เป๊ะ). โชว์เฉพาะ `!warehouseFilter && warehouses.length>0` (ซ่อนบน sub-page คลังล็อก). compute `_whSummary/_whGrandItems/_whGrandQty` จาก `state.warehouseStock` ที่โหลดไว้แล้ว — **0 fetch/query/write, ไม่แตะ ctx.state, ไม่แตะ getDisplayStock/filter/selectedWarehouse semantics เดิม**. escHtml ชื่อคลังทุกใบ + `.toLocaleString()` (1,893). **ไฟล์ (6):** modules/products.js · index.html · sw.js · +tests/warehouse_summary_guard.test.js (4 guard: compute จาก warehouseStock+stock>0 · render data-wh-card รวม 'all' · click→selectedWarehouse+renderView · read-only no fetch/XHR/POST/PATCH ทั้ง render block + compute block) · tests/dashboard_readonly_guard.test.js (455→456) (+CHANGELOG/HANDOFF). **bump 455→456 ครบ** (data-app-build + 4×?v= + sw cache-v456 + comment; data-app-version 5.69.1 / package คงเดิม; grep '455' index.html ว่าง). **Verification:** lint:errors 0 · unit เขียว · e2e 14/14 · EOL LF. **สถานะ:** ⏳ branch `claude/phase-456-warehouse-summary` pushed — **รอ owner review/smoke (ยังไม่ merge main)**. owner smoke: หน้าสินค้า/คลัง → เห็นแถวการ์ด → คลิกการ์ดคลัง = list กรองตามคลัง (เหมือนเลือก dropdown), การ์ด active ขอบฟ้า. **Known risks:** การ์ดอ่าน state.warehouses/warehouseStock — ถ้ายังไม่โหลด = ว่าง/0 (ปกติ loadAllData โหลดแล้ว); grand "รายการ" นับ product ซ้ำต่อคลังที่มันอยู่ (overlap ตั้งใจ ไม่ใช่ distinct ทั้งร้าน).

**build 457 (Phase 457 — equip-remaining display, แถวอุปกรณ์งานช่าง):** ในรายการ "🔧 อุปกรณ์ที่ใช้" บน service-job drawer (openServiceJobDrawer) แต่ละแถวแสดง **"🔻 ตัดจาก {คลัง} • คงเหลือ {N} ชิ้น • ฿{ราคา}/ชิ้น"** (READ-ONLY DISPLAY). `renderEquipmentList` (modules/service_equipment.js) รับ option `state` เพิ่ม → helper `_remainFor(it)` lookup `state.warehouseStock` ด้วย product_id+warehouse_id (String-tolerant) คืนสต็อกสด (null ถ้าไม่รู้/ไม่มีคลัง). prefix "🔻 ตัดจาก " เฉพาะ readOnly view (งานเดิมที่ตัดสต็อกแล้ว); editable (งานใหม่) แสดงชื่อคลัง+คงเหลือ ไม่มี 🔻. **backward-compatible:** ไม่มี state/warehouse_id/product_id → แสดงแค่ราคาเหมือนเดิม (byte-identical no-warehouse path). escHtml ชื่อคลัง. **0 write** (ไม่ fetch/XHR/PATCH/POST, ไม่ mutate state) — display ล้วน, ไม่แตะ deduct/onPick/qty·remove controls/readOnly gate/toItemsJson/save. **call site:** main.js:2374 `_equipRenderList(...)` เพิ่ม `state` (เป็น const module-level @main.js:260 — in scope; เป็น call site เดียวของ `_equipRenderList`/`renderEquipmentList` นอก module def). **bump 456→457 ครบ** (data-app-build + 4×?v= + sw cache-v457 + comment; data-app-version 5.69.1 / package คงเดิม; grep '456' index.html ว่าง). **ไฟล์ (6):** modules/service_equipment.js · main.js · index.html · sw.js · +tests/equip_remaining_guard.test.js (12: behavioral lookup/string-tolerant/no-leak + backward-compat no-state·missing-id·not-found + empty-state + source-regex signature/keys/guard/no-network + main.js wiring) · tests/dashboard_readonly_guard.test.js (456→457) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit เขียว · e2e 14/14 · EOL LF. **สถานะ:** ⏳ branch `claude/phase-457-equip-remaining` pushed — **รอ owner review/smoke (ยังไม่ merge main)**. owner smoke: เปิดงานช่างเดิมที่มีอุปกรณ์ → แถวอุปกรณ์เห็น "🔻 ตัดจาก {คลัง} • คงเหลือ N ชิ้น"; งานใหม่เพิ่มอุปกรณ์ → เห็นชื่อคลัง+คงเหลือ (ไม่มี 🔻). **Known risks:** คงเหลืออ่าน state.warehouseStock — ถ้ายังไม่โหลด/ไม่มี row = ไม่แสดงคงเหลือ (graceful, แสดงแค่ราคา); ค่าคงเหลือเป็น snapshot ตอน render (ไม่ live-poll หลังเปิด drawer).

**build 458 (Phase 458 — "โอนระหว่างคลัง" shortcut, หน้าสินค้า/คลัง):** เพิ่มปุ่มทางลัด **"🔄 โอนระหว่างคลัง"** (id `prodTransferBtn`, class `prod-more-item`) ในเมนู "⋯ จัดการเพิ่มเติม" (`products.js renderView`, ถัดจาก `#prodStockSheetBtn` — อยู่ใน gate `canManageProducts` admin/sales เดิม). **PURE navigation/UI:** handler ตั้ง `window._smOpenTransfer = true` แล้ว `location.hash = "stock_movements"` → หน้า stock-movements (`renderStockMovementsPage`, modules/stock_movements.js) เห็น flag ถัดจากบรรทัด wire `$transferBtn.onclick = openTransferModal` (~:461) → `if (window._smOpenTransfer) { window._smOpenTransfer = false; openTransferModal(); }` (one-shot — ล้าง flag ทันที, `openTransferModal` const @:278 in scope). **reuse flow โอนเดิมทั้งดุ้น** (`_transferWarehouseStock` main.js + modal logic) — **0 stock-write/transfer logic ใหม่**: handler ใหม่ "ไม่" call `_transferWarehouseStock`/`_atomic*`/fetch/XHR/POST/PATCH (guard ล็อก). ไม่แตะ permission/gating/modal body. **bump 457→458 ครบ** (data-app-build + 4×?v= + sw cache-v458 + comment; data-app-version 5.69.1 / package คงเดิม; grep '457' index.html ว่าง). **ไฟล์ (6):** modules/products.js · modules/stock_movements.js · index.html · sw.js · +tests/warehouse_transfer_shortcut_guard.test.js (4 guard: ปุ่ม prodTransferBtn ในเมนู · handler set _smOpenTransfer + hash→stock_movements · handler ไม่มี transfer/fetch/XHR/write · stock_movements auto-open+clear flag one-shot ลำดับหลัง wire) · tests/dashboard_readonly_guard.test.js (457→458) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit เขียว · e2e 14/14 · EOL LF. **สถานะ:** ⏳ branch `claude/phase-458-transfer-shortcut` pushed — **รอ owner review/smoke (ยังไม่ merge main)**. owner smoke: หน้าสินค้า/คลัง → เมนูจัดการเพิ่มเติม → กด "🔄 โอนระหว่างคลัง" → เด้งไปหน้ารายการเคลื่อนไหวสต็อก + modal "โอนระหว่างคลัง" เปิดเอง; กดเข้าหน้า stock-movements ตรง ๆ (ไม่ผ่านปุ่ม) → modal ไม่เปิด (flag ไม่ติด). **Known risks:** flag เป็น window-global — ถ้าเด้ง hash แล้ว `renderStockMovementsPage` ไม่ถูกเรียก (เช่น route ไม่มี) flag จะค้าง true แล้วเปิด modal ครั้งถัดไปที่เข้าหน้านี้ (เปิด modal เปล่า ผู้ใช้ปิดได้ ไม่กระทบข้อมูล); ปกติ hash=stock_movements route มีจริง → render ทันที → ล้าง flag.

**build 459 (Phase 459 — searchable product picker, modal ย้ายสต็อกระหว่างคลัง):** เพิ่มช่องค้นหา **`#smt-product-search`** เหนือ `<select id="smt-product-select">` ใน modal "🔄 ย้ายสต็อกระหว่างคลัง" (`stock_movements.js renderStockMovementsPage`). พิมพ์ → `filterTransferProducts(query)` rebuild `<option>` ของ select ตาม **ชื่อ/หมวด/SKU/บาร์โค้ด** (case-insensitive, query ว่าง=ทั้งหมด) — แก้ปัญหาสินค้า ~1000 ตัวเลื่อนหาไม่เจอใน plain select. **UI-ONLY:** filter ฝั่ง client เท่านั้น (rebuild innerHTML ของ select เดิม) — คง id `#smt-product-select` + `.value` submit contract เป๊ะ, คง `$smtProd.onchange = updateTransferFromStock` (เรียก `updateTransferFromStock()` หลัง rebuild ให้ from-stock display อัปเดต), preserve selection เดิมถ้ายัง match (`prev`). **0 stock-write:** `filterTransferProducts` ไม่ call `_transferWarehouseStock`/`_appTransferWarehouseStock`/`_appApplyStockMovement`/fetch/XHR/POST/PATCH (guard ล็อก body). escHtml ทั้ง p.id + p.name. `closeTransferModal` เพิ่ม `smt-product-search` ใน reset list + เรียก `filterTransferProducts('')` คืนลิสต์เต็มก่อนเปิดรอบหน้า. ไม่แตะ `_transferWarehouseStock`/save logic/from-to selects/modal "เพิ่มเคลื่อนไหว" (#sm-product-select — out of scope). **bump 458→459 ครบ** (data-app-build + 4×?v= + sw cache-v459 + comment; data-app-version 5.69.1 / package คงเดิม; grep '458' index.html ว่าง). **ไฟล์ (6):** modules/stock_movements.js · index.html · sw.js · +tests/transfer_product_search_guard.test.js (9 guard: search input อยู่เหนือ select · filter by name/category/sku/barcode + exclude service/non_stock · rebuild #smt-product-select + keep prev + updateTransferFromStock · escHtml id/name · wired via oninput · close resets search id · source-regex NO _transferWarehouseStock/fetch/XHR/POST/PATCH/insert-update · submit ยังอ่าน #smt-product-select .value) · tests/dashboard_readonly_guard.test.js (458→459) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit เขียว · e2e 14/14 · EOL LF. **สถานะ:** ⏳ branch `claude/phase-459-transfer-product-search` pushed — **รอ owner review/smoke (ยังไม่ merge main)**. owner smoke: หน้ารายการเคลื่อนไหวสต็อก → "🔄 ย้ายระหว่างคลัง" → พิมพ์ในช่องค้นหา → dropdown เหลือเฉพาะที่ match (ชื่อ/หมวด/SKU/บาร์โค้ด); เลือกสินค้าแล้วเลือกคลังต้นทาง → from-stock แสดงถูก; ย้ายได้ปกติ (logic เดิม). **Known risks:** filter อ่าน state.products ที่โหลดไว้ (ไม่ยิง DB) — ถ้ายังไม่โหลด=ลิสต์ว่าง (ปกติ loadAllData โหลดแล้ว); selection จะถูกล้างถ้า query กรองจน option ที่เลือกไว้หาย (intended — กันส่ง id ที่ไม่อยู่ในลิสต์).

**build 460 (Phase 460 — clickable search results list, modal ย้ายสต็อกระหว่างคลัง):** เปลี่ยน picker สินค้าใน modal "🔄 ย้ายสต็อกระหว่างคลัง" (`stock_movements.js renderStockMovementsPage`) จาก "กรอง `<select>`" (Phase 459) → **"ผลการค้นหาแบบคลิกได้"** เหมือนหน้าค้นหาสินค้าหลัก: พิมพ์ใน `#smt-product-search` → `renderTransferSearchResults(query)` แสดงรายการที่ตรง **ชื่อ/หมวด/SKU/บาร์โค้ด** (cap 30, query ว่าง=ซ่อนลิสต์, 0 ตัว=แถว "ไม่พบสินค้า") ใน `#smt-product-results` (`<button class="smt-result-row" data-pid>` ต่อแถว) + ป้ายสินค้าที่เลือก `#smt-product-selected`. **`<select id="smt-product-select">` ถูกซ่อน (`display:none`) แต่คง option ครบทุกตัว = value-holder** — คลิกแถว (delegation บน `#smt-product-results` → อ่าน `data-pid`) ตั้ง `sel.value = pid` + `dispatchEvent(new Event('change',{bubbles:true}))` (→ `updateTransferFromStock` ทำงานเหมือนเดิม) + ตั้งป้าย "✓ {ชื่อ}" + ล้างช่องค้นหา + ซ่อนลิสต์. **คง `.value` submit contract เป๊ะ** (submit ยังอ่าน `#smt-product-select`.value; `$smtProd.onchange = updateTransferFromStock` คงเดิม). **0 stock-write:** `renderTransferSearchResults` ไม่ call `_transferWarehouseStock`/`_appTransferWarehouseStock`/`_appApplyStockMovement`/fetch/XHR/POST/PATCH/insert-update (guard ล็อก body — client-side ล้วน). escHtml ทุกค่า DB (id/name/category/barcode/sku). `closeTransferModal` ล้าง search+select+ป้าย+ซ่อน results; `openTransferModal` โฟกัสช่องค้นหา (select ซ่อนแล้ว) + ตั้งป้าย "— ยังไม่เลือกสินค้า —". **ไม่แตะ:** `_transferWarehouseStock`/save logic/from-to selects/modal "เพิ่มเคลื่อนไหว" (`#sm-product-select` — out of scope). **bump 459→460 ครบ** (data-app-build + 4×?v= + sw cache-v460 + comment; data-app-version 5.69.1 / package คงเดิม; grep '459' index.html ว่าง). **ไฟล์ (6):** modules/stock_movements.js · index.html · sw.js · tests/transfer_product_search_guard.test.js (เขียนใหม่ Phase 460 — 12 guard: search/selected/results markup + results เริ่มซ่อน · select hidden+คง option ครบ+search ไม่แตะ select · filter name/category/sku/barcode + cap30 + empty/ไม่พบ · row คลิกได้ data-pid + button · escHtml 5 ค่า · oninput→renderTransferSearchResults · row click ตั้ง sel.value+dispatch change+ป้าย · onchange→updateTransferFromStock · close resets ครบ · NO write/fetch/XHR · submit ยังอ่าน .value) · tests/dashboard_readonly_guard.test.js (459→460) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit เขียว · e2e 14/14 · EOL LF. **สถานะ:** ✅ MERGED live **build 460** (ff `d03f5b4`, 2026-06-17, CI Tests+Deploy success; live verified app-build 460 + cache-v460; guard 11/11). owner smoke: หน้ารายการเคลื่อนไหวสต็อก → "🔄 ย้ายระหว่างคลัง" → พิมพ์ในช่องค้นหา → เห็นรายการคลิกได้ (ชื่อ/หมวด/SKU/บาร์โค้ด); คลิกเลือก → ป้าย "✓ {ชื่อ}" + เลือกคลังต้นทาง → from-stock แสดงถูก; ย้ายได้ปกติ (logic เดิม). **Known risks:** อ่าน state.products ที่โหลดไว้ (ไม่ยิง DB) — ถ้ายังไม่โหลด=ลิสต์ว่าง (ปกติ loadAllData โหลดแล้ว); cap 30 — ถ้า match เกิน 30 ต้องพิมพ์ให้แคบลง (intended).

**build 461 (Phase 461 — ปุ่มลบ serial, หน้า Serial Number / Warranty):** เพิ่มปุ่ม **🗑️ ลบ (ถาวร)** ต่อแถวในหน้า Serial Number Tracking (`modules/serials.js renderSerialsPage`) — เดิมมีแค่ ✏️ แก้ไข / 🔧 รับเคลม / + เพิ่ม Serial **ไม่มีปุ่มลบเลย** (git history ยืนยันไม่เคยมี) = owner ลบ serial ทดสอบ (test001 ฯลฯ) ไม่ได้ → "ค้างกำลังลบ ไม่ลบให้". **เนื้องาน (serials.js ไฟล์เดียว, ไม่มี SQL):** (1) ปุ่ม `sr-del-btn data-id=${s.id}` 🗑️ ต่อจาก sr-claim-btn ในแถว (2) listener `.sr-del-btn` → lookup `_srResults` → `deleteSerial(ctx, s.id, s.serial_no)` (ขนาน sr-edit/sr-claim) (3) `async deleteSerial`: **confirm ก่อนเสมอ** (`await window.App?.confirm?.` — ไม่ยืนยัน/ไม่มี App.confirm → return ไม่ลบ, fail-safe) → `fetch DELETE /rest/v1/product_serials?id=eq.${encodeURIComponent(id)}` + `Prefer: return=representation` → `!r.ok`→throw→catch→toast error → **rows.length===0 (RLS บล็อก/id ไม่ตรง — PostgREST คืน 200+[]) → toast "ลบไม่สำเร็จ — ไม่พบรายการ หรือไม่มีสิทธิ์ลบ" + return (ไม่อ้างว่าสำเร็จ = แก้ตรงอาการลบเงียบ)** → สำเร็จ → toast + renderSerialsPage. **RLS:** `product_serials` policy `auth_all_product_serials FOR ALL TO authenticated USING(true)` → DELETE อนุญาต (policy เดียวกับ claim/PATCH ที่ใช้งานได้) — ไม่ต้องแก้ SQL. **hard delete (owner เลือก ลบถาวร)** ไม่ใช่ soft [ลบแล้ว]. numeric id เท่านั้นใน DOM ใหม่. **ไม่แตะ:** openSerialModal (edit/add) · updateStatus (claim) · loadSerials query · warranty_report · main.js bulk SN create. **bump 460→461 ครบ** (data-app-build + 4×?v= + sw cache-v461; data-app-version 5.69.1 / package คงเดิม; grep 460 index.html ว่าง). **ไฟล์ (5):** modules/serials.js · index.html · sw.js · +tests/serial_delete_guard.test.js (9: ปุ่ม+🗑️ · listener→deleteSerial · confirm ก่อน fetch+early-return · DELETE product_serials?id=eq.+encodeURIComponent · !r.ok throw+catch toast · 0-row→error+return · renderSerialsPage ใน success path · return=representation · ไม่มี alert) · tests/dashboard_readonly_guard.test.js (460→461) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit 1773/1773 · e2e 14/14 · EOL LF. **สถานะ:** ✅ MERGED live **build 461** (ff `eff6fa5`, 2026-06-17, owner gated "merge 461 ก่อน"; CI Tests+Deploy success; live verified app-build 461 + cache-v461; guard 11/11). owner smoke: หน้า Serial Number / Warranty → กด 🗑️ แถว test001 → ยืนยัน → แถวหาย + toast; กดยกเลิก → ไม่ลบ. **Known risks:** hard delete กู้ไม่ได้ (มี confirm กัน); ถ้าอนาคต RLS ห้าม non-admin ลบ → 0-row guard แจ้ง ไม่ลบเงียบ.

**build 462 (Phase 462 — barcode label print LANDSCAPE บนกระดาษ 30×50mm):** เครื่องพิมพ์ฉลากของร้านใช้กระดาษ 30mm กว้าง × 50mm ยาว แต่ owner ต้องการเนื้อหา **แนวนอน** (ชื่อร้าน/ชื่อสินค้า/บาร์โค้ดกว้าง/เลข/ราคา) เหมือนป้ายตัวอย่าง — บาร์โค้ดแนวนอนยาวเต็มสแกนง่ายกว่าบีบในความกว้าง 30mm. **(หมายเหตุ: รอบแรกทำเป็น 30×50 "แนวตั้ง" บาร์โค้ดเล็ก = ผิดทิศ owner ทักให้แก้เป็นแนวนอน — branch portrait เดิมทิ้งแล้ว).** วิธี: `@page size 30mm 50mm` (กระดาษจริง Chrome ไม่ auto-rotate) + เนื้อหาอยู่ใน `.sticker-inner` (50mm×30mm landscape) `position:absolute; top/left:50%; transform:translate(-50%,-50%) rotate(90deg)` → หมุน+กึ่งกลางพอดี 30×50 → อ่านแนวนอน บาร์โค้ดยาวตามด้าน 50mm (~46mm). **เนื้องาน (products.js print template ใน openBarcodePrintWindow):** (1) `.sticker` = 30×50 paper (position relative, overflow hidden) ครอบ `.sticker-inner` 50×30 หมุน 90° (2) HTML ห่อเนื้อหาใน `<div class=sticker><div class=sticker-inner>` (3) `@page 30mm 50mm` ทั้ง base+@media print (4) dropdown default `30x50r` (rotated) + คง 50×30/40×25/70×40 (5) `SIZES` รื้อเป็น {paperW,paperH,innerW,innerH,rot,bcH,bcMax,bcW,fontN,fontP}; `changeSize` สร้าง stylesheet จาก paper/inner + `rotate(rot?90:0)` (6) `renderBarcodes(heightMM,barW)` + JsBarcode `width:barW||1.2` (7) load `renderBarcodes(12,1.2)` + hint Custom 30×50mm. **print-only — ไม่มี DB/เงิน/สต็อก/บัญชี** (แก้ HTML หน้าต่างพิมพ์). esc ค่า DB เหมือนเดิม. ไม่แตะ `_printBarcodesWithScope`/`openBulkBarcodePrintModal`/scope (450) · gen barcode PATCH · qty cap 200. **bump 461→462 ครบ** (data-app-build + 4×?v= + sw cache-v462; data-app-version 5.69.1/package คงเดิม; grep 461 index ว่าง). **ไฟล์ (5):** modules/products.js · index.html · sw.js · +tests/barcode_label_landscape_guard.test.js (8: @page 30mm 50mm ×2/ไม่มี 50mm 30mm · sticker-inner 50×30+rotate90+translate center · sticker 30×50 relative · markup wrap · dropdown 30x50r selected+คง 3 ขนาด+hint · SIZES.30x50r rot:true paper30×50 inner50×30+50x30 rot:false · changeSize paperW/H+innerW/H+rotate toggle · renderBarcodes(heightMM,barW)+width barW||1.2+pass bcW+load(12,1.2)) · tests/dashboard_readonly_guard.test.js (461→462) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit 1780/1780 · e2e 14/14 · EOL LF. **สถานะ:** ✅ MERGED live **build 462** (ff `4732ee5`, 2026-06-17, owner gated "merge 462"; CI Tests+Deploy success; live app-build 462 + cache-v462). 🎉 **owner ยืนยันด้วยป้ายจริง:** พิมพ์แนวนอนเต็มดวง บาร์โค้ดกว้างคมชัด ทิศหมุนถูก (กล่องดาวเทียมPSI S9/฿850) — หลัง owner ตั้ง Chrome ขนาดกระดาษ="ม้วนฉลากใหญ่" (one-time, Chrome จำ). ปัญห ารอบแรก (เนื้อหาเล็ก/มี header about:blank) = print dialog config (paper size/headers) ไม่ใช่โค้ด. owner smoke: หน้าสินค้า → พิมพ์บาร์โค้ด → default 30×50 แนวนอน, บาร์โค้ดกว้างเต็มเหมือนป้ายตัวอย่าง; Chrome dialog Paper=Custom 30×50mm + Margins=None → พิมพ์จริง 1 ดวง. **⚠️ ทิศหมุน:** ใช้ rotate(90deg) — ถ้าพิมพ์ออกมา**กลับหัว** สลับเป็น -90deg (แก้บรรทัดเดียว) = follow-up เร็ว. **Known risks:** ทิศหมุนต้องยืนยันด้วยการพิมพ์จริง; transform print ทุกเครื่องพิมพ์รองรับ (Chrome rasterize) แต่ rare driver อาจเพี้ยน — ถ้าเพี้ยนใช้ option 50×30 (กระดาษแนวนอน ไม่หมุน) แทน.

**build 463 (Phase 463 — POS แก้ราคาขาย inline ในการ์ดสินค้า) [เฟส 1/2]:** owner ขอหน้า POS "เลือกสินค้า" (pos.js posView=products) ให้ (1) แก้ราคาขายได้ทุกชิ้น (2) แยกคลัง/เลือกคลังตัดสต็อก. **แยก 2 เฟส** (POS=ไฟล์เสี่ยงสูงสุด money/stock): เฟสนี้ทำ **(1) แก้ราคา inline** ก่อน. **เนื้องาน (pos.js เท่านั้น, ไม่มี SQL):** (a) `canEditPosPrice(state)` = `[admin,sales].includes(profile.role)` (ตรง canManageProducts หน้าสินค้า); (b) `renderProductCards(products, canEdit)` + `priceRowHtml(p,canEdit)` → แถวราคาเพิ่มปุ่ม ✏️ **เฉพาะ canEdit** (cashier ธรรมดาไม่เห็น); ทั้ง 2 call site (initial line ~922 + search re-render line ~1346) ส่ง `canEditPosPrice(state)`; (c) `bindPriceEdit(state,signal)` **delegation บน #posProductList** (กัน search re-render ทำ listener หลุด) → คลิก ✏️ → re-check สิทธิ์ (defense-in-depth) → แทนแถวราคาด้วย `<input number>` + ✓/✗ → ✓: validate (isNaN/ติดลบ reject, round2) → ถ้าเปลี่ยน confirm `App.confirm(฿เก่า→฿ใหม่)` → **PATCH products?id=eq. {price:newPrice} เท่านั้น** (mirror bulkPriceChange, XHR return=minimal) → สำเร็จ: `prod.price=newPrice` (optimistic state) + restore + toast; ล้มเหลว: toast error + restore (ไม่แก้ state) → Enter=save/Esc=cancel. **+ กดที่ตัวการ์ด (ไม่ใช่ +/✏️/ช่องกรอก) → `ctx.openProductDrawer(prod)` เปิดฟอร์มสินค้าเต็ม** (ราคา/ต้นทุน/สต็อก/ชื่อ/บาร์โค้ด — reuse ฟอร์มเดิม main.js:1320, gate requireAdminOrSales เหมือนกัน) แบบ FlowAccount; card มี `data-product-id`, cursor:pointer เฉพาะ canEdit; cashier กดการ์ดไม่ทำอะไร (ไม่เปิด drawer/ไม่มี toast). delegation เดียวคุมทั้ง ✏️+card-tap (closest กัน + / ช่องกรอกราคา ไม่ให้เปิด drawer). **🔴 invariant ที่ guard ล็อก:** gate admin/sales · confirm ก่อน PATCH · PATCH price field เดียว · validate+round2 · state update หลัง !saved guard เท่านั้น · **ไม่แตะ addToCart/checkout/DeductStock/sale_items/state.cart** (ราคาล้วน ไม่มี side-effect การขาย; ของในตะกร้า snapshot ราคาเก่า) · escHtml ชื่อ · ไม่มี prompt/alert. **ไม่แตะ:** checkout/ตัดสต็อก/_appDeductStockSmart/cart payload/promo `_appGetActivePrice`/payment flow. **bump 462→463 ครบ** (data-app-build + 4×?v= + sw cache-v463; package/version คงเดิม; grep 462 index ว่าง). **ไฟล์ (4):** modules/pos.js · index.html · sw.js · +tests/pos_price_edit_guard.test.js (11: gate/affordance/defense/confirm-before-PATCH/PATCH-price-only/validate/optimistic-after-saved/no-cart-checkout/escHtml/no-prompt-alert + card-tap→openProductDrawer gated) · tests/dashboard_readonly_guard.test.js (462→463) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit 1790/1790 (POS guards multi_payment/quick_pay/checkout_inflight 20/20 เขียว) · e2e 14/14 · EOL LF. **สถานะ:** ✅ MERGED live **build 463** (ff `6a474bd`, 2026-06-17, owner gated "merge 463"; CI Tests+Deploy success; live app-build 463 + cache-v463). 🎉 **owner smoke ผ่านบน preview:** ✏️ ราคา inline + กดการ์ด→หน้าสินค้าเต็ม (รีโมท TCL เปิดฟอร์มครบ). **เฟส 2 (เลือกคลัง→ตัดจากคลังนั้นบน POS) = งานต่อไป** (owner ยืนยัน "เหลือ ระบุ แต่ละคลัง"; คลังจริง: บ้าน/ศีขร/คันขาว/คันแดง). owner smoke (admin): POS→เลือกสินค้า→เห็น ✏️ ข้างราคา→กด→กรอกราคาใหม่→ยืนยัน→ราคาอัปเดต+toast; ลอง login เป็น cashier/ช่าง → ไม่เห็น ✏️; ของในตะกร้าก่อนแก้ราคา = ราคาไม่เปลี่ยน. **⚠️ เฟส 2 (ค้าง) = เลือกคลัง→ตัดจากคลังนั้นบน POS:** แตะ core ตัดสต็อก (`_appDeductStockSmart`/cart payload warehouse_id/`_deductStockForSaleItem`) — ต้องอ่าน deduct path ครบ + guard กัน oversell + **owner smoke ตัดจริงบน preview** ก่อน merge (เฟสแยก หลัง 463 เข้า). **Known risks:** ไม่ลง audit_log (ตรง pattern bulkPriceChange เดิมที่ไม่ลง — ถ้าต้องการ audit ราคา เพิ่มภายหลังได้); ราคา promo (`_appGetActivePrice`) แยกจาก base price ที่แก้ (แก้ base ถูกต้อง).

**build 464 (Phase 464 — POS เลือกคลังขาย → ตัดจากคลังนั้น) [เฟส 2/2 · 🔴 MONEY/STOCK สูงสุด]:** owner เลือก **Option A = คลังเดียวต่อบิล** (ไม่ใช่ต่อชิ้น — แก้ตะกร้าน้อย ปลอดภัยกว่า). **เดิม:** POS ตัด "บ้าน" ก่อนอัตโนมัติ (`_deductStockForSaleItem` sort home-first → CAS floor); cart ผูก product id ล้วน. **เนื้องาน — core (main.js, backward-compatible):** (1) `_deductStockForSaleItem({product,qty,orderNo,warehouseId})` +param `warehouseId`; ถ้า `_hasPicked` (มี/ไม่ใช่ ""/"auto") → `ws = stocks.find(warehouse_id===warehouseId)`; **ไม่เจอ → showToast เตือน + return (★ ไม่ falls back ตัดคลังอื่น)**; เจอ → CAS `_atomicDecrementStock("warehouse_stock", ws.id, qty)` เดิม (floor กัน oversell). ไม่มี warehouseId → sort บ้าน-first เดิมเป๊ะ (caller อื่นทุกตัวไม่กระทบ). (2) `_appDeductStockSmart` +param warehouseId → ส่งต่อ non-bundle; **bundle children = auto heuristic** (ไม่ผูกคลังที่เลือก — ลูกอาจคนละคลัง). **UI (pos.js):** (3) `_posWarehouseId` module-level (localStorage `bsk_pos_warehouse`, default ""=auto); (4) แถบ chips `_posWarehouseChips` (อัตโนมัติ⚙️ + state.warehouses 🚐/📦) บนหน้าเลือกสินค้า; (5) `_posProductsForWh` กรองเฉพาะ stock>0 ในคลังที่เลือก (auto=ทั้งหมด) ใช้ทั้ง initial+search; (6) การ์ดโชว์ "🔻 ตัดจาก {คลัง} • คงเหลือ N" เมื่อเลือกคลัง; (7) `bindWarehouseChips` คลิก→set+persist+`renderPosView`; (8) checkout ส่ง `warehouseId:_posWarehouseId||undefined` ให้ทุก item. **(9) UX fix (owner ขอ): ปุ่ม + เพิ่มสินค้าแบบ silent** — `addToCart(productId, opts={})` +param `opts.silent`; `if(!opts.silent) showRoute(...)` (เดิม showRoute เสมอ → renderPosPage reset posView=home → เด้งออกหลังเพิ่ม 1 ตัว); POS bindProductList กด + → `addToCart(id,{silent:true})` + `updateStickyBar` เอง → อยู่หน้าเลือกสินค้าเดิม เพิ่มหลายรายการรวด ไม่ดีดสกอลล์; context อื่น (scanner/หน้าสินค้า) คง re-render เดิม. **(10) FIX double-add (owner จับได้บน smoke):** จอสัมผัส POS ยิง click 2 ครั้ง/1 แตะ → กด [+] 1 ที เพิ่ม 2 (เดิม non-silent re-render กลบบางส่วน; silent เห็นชัด). แก้: debounce id เดิม <350ms ใน bindProductList (`_posLastAdd={id,t}`; สินค้าคนละตัวรัวได้ id ต่างกัน) + `touch-action:manipulation` บนปุ่ม +. guard +1 (one-tap-one-add). **🔴 invariant guard ล็อก (pos_warehouse_deduct_guard 10):** รับ warehouseId · เลือก row ตรงคลัง · **ไม่เจอ→return ไม่ตัดคลังอื่น (no-fallback)** · CAS คงอยู่ · auto=home-first เดิม · smart ส่งต่อ · checkout ส่ง _posWarehouseId · filter stock>0 · default auto · chip set+rerender. **ไม่แตะ:** CAS internals/`_atomicDecrementStock`/`_transferWarehouseStock` · products.stock trigger (403) · cart payload/sale_items · payment/checkout guard เดิม · ราคา/promo. **bump 463→464 ครบ.** **ไฟล์ (5):** main.js · modules/pos.js · index.html · sw.js · +tests/pos_warehouse_deduct_guard.test.js (11: +silent-add) · (แก้ regex 2 จุดใน pos_price_edit_guard ให้รับ arg ใหม่ — intent เดิม) · tests/dashboard_readonly_guard (463→464) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit 1801/1801 · POS/stock guards (multi_payment/quick_pay/stock_cas/checkout_inflight) 40/40 เขียว · e2e 14/14 · EOL LF. **สถานะ:** ⏳ branch `claude/phase-464-pos-warehouse-deduct` (ฐาน main d2b939b=build 463) pushed — **✅ MERGED live build 464** (ff `eacdd12`, 2026-06-17, owner gated "merge 464"; CI Tests+Deploy success; live app-build 464+cache-v464). owner smoke ผ่าน: ตัดสต็อกถูกคลัง (บ้าน 50→48/49→48) + เพิ่มรัวได้ + กด 1 ที=เพิ่ม 1 (หลังแก้ double-add จอสัมผัส). owner smoke: POS→เลือกสินค้า→เลือกชิป "คันแดง"→list เหลือเฉพาะของคันแดง+เห็นคงเหลือ→ขาย 1 บิล→หลังจ่าย เช็ค **สต็อกคันแดงลดเท่าที่ขาย, คลังอื่นไม่ขยับ** (ดูหน้าสินค้า/คลัง); ลองเลือก "อัตโนมัติ"→ตัดบ้านก่อนเหมือนเดิม. **Known limitations (ตั้งใจ scope เฟสนี้):** (a) addToCart จำกัด qty ด้วย **สต็อกรวมทุกคลัง** ไม่ใช่คลังที่เลือก → เพิ่มเกินคลังที่เลือกได้ แต่ตอนตัด CAS floor กัน oversell + เตือน "สต็อกไม่พอ" (ไม่ติดลบ — ปลอดภัย แค่ UX ไม่เนียน; ตึงขึ้นได้เฟสหน้า); (b) bundle ตัด children แบบ auto (ไม่ผูกคลังเลือก); (c) คลังที่เลือกจำข้ามวัน (localStorage) — แถบโชว์ชัดเจน owner เห็นตลอด.

**build 477 (Phase 477 — restock bundle children on sale void) [🔴 MONEY/STOCK §4.1-4.2 · BLOCKING]:** **Baseline:** origin/main `42b9b67` (build 476 live; phase-476 oversell-button-fix merged ก่อนเริ่ม — prompt เขียนตอน 475 แต่ verify ก่อนเริ่มได้ 476 → next=477; ไม่มี uncommitted ของ session อื่นแล้ว). **บั๊ก (AUDIT_STOCK_2026-06-18.md §B1, verified อ่านโค้ดจริง):** ขายสินค้า bundle → `_appDeductStockSmart` ขยาย children แล้วตัดสต็อก children ทีละตัว (log movement `type=sale` ใต้ **child** product_id, note มี orderNo). แต่ `sale_items` เก็บ `product_id` = **bundle แม่** (pos.js:1209). ตอน void/ลบบิล `_revertStockForSale` สร้าง `deductedIds` = product_id จาก sale movements = **child ids**; loop เช็ค `deductedIds.has(item.product_id)` โดย item.product_id = แม่ → `false` → `continue` ข้าม → **children ไม่ถูกคืน = สต็อกหายถาวรทุกครั้งที่ขาย bundle แล้ว void**. **เงื่อนไข:** latent ถ้าร้านยังไม่มี bundle จริง — owner ต้อง verify `select count(*) from products where is_bundle=true;` (Claude ไม่มี DB access จาก session นี้); แก้กันอนาคตไม่ว่ามี bundle ตอนนี้ไหม. **เนื้องาน (main.js `_revertStockForSale` + helper ใหม่):** (1) แยก per-item restock เป็น **nested `restockProduct(prod, qty, soldWhId, label)`** ภายใน `_revertStockForSale` (ใช้ทั้ง non-bundle + bundle children) → resolve targetWs (sale_items.warehouse_id ก่อน, ไม่มี→home-first เดิม) → CAS `_atomicAddStock` → optimistic local sum (ไม่เขียน products.stock ตรง, ให้ trigger 403 คุม) → log `return` movement (note ต่อท้าย `[bundle:ชื่อ]` ถ้า child) → คืน `{ok,error}` (caller นับ revertedCount เฉพาะ ok, push error — **ไม่ rollback item อื่น**). (2) loop เจอ `product.is_bundle` → fetch `product_bundles?bundle_id=eq.{id}&select=child_product_id,qty` → `expandBundleForRevert(recipeRows, lineQty)` (โมดูลใหม่ **`modules/bundle_revert.js`** pure: childQty = `Number(recipe.qty||1) × lineQty` mirror deduct) → ต่อ child: lookup state.products → **gate `deductedIds.has(childId)`** (คืนเฉพาะ child ที่ถูกตัดจริง — กันคืนเกิน) → `restockProduct(childProd, c.qty, soldWhId, [bundle:ชื่อ])` → `continue` (แม่ไม่คืนตรง ไม่มี warehouse_stock row). non-bundle = เส้นทาง+ตัวแปรเดิม (gate `item.product_id`). **Failure semantics:** อ่านสูตร bundle ไม่ได้→push error "โปรดคืนเองทาง stock_movements" + ไม่ rollback; child CAS fail→error+continue (child อื่นคืนต่อ); child ถูกลบ (ไม่อยู่ state.products)→error+skip; bundle ไม่มี children→log+ไม่คืน. **idempotency เดิมคงไว้** (`_STOCK_RETURNED_MARKER` gate ต้นฟังก์ชัน + แปะเมื่อ revertedCount>0 รวม partial → void ซ้ำ=no-op). **return shape `{ok,reverted,errors}` เดิมเป๊ะ.** **🔴 invariant guard ล็อก (bundle_revert_restock_guard ใหม่):** behavioral helper (qty=recipe×line / empty→[] / NaN→fallback1 / non-array·line≤0→[] / no-child-id→drop) + source-regex wiring (is_bundle branch · fetch product_bundles · expandBundleForRevert · per-child deductedIds gate · restockProduct+CAS · [bundle:] label · recipe-fail→error · non-bundle gate+marker คงเดิม). **ปรับ guard เดิม 2 ตัว (intent เดิม, แค่ shape เปลี่ยนจาก refactor):** `revert_stock_cas_guard` (CAS fail: continue→return {ok:false} ก่อน log + caller `if(rr.ok) revertedCount++`) · `stock_mirror_canonical_guard` (`product.`→`prod.` ใน restockProduct). **❌ ไม่แตะ:** deduct path (`_appDeductStockSmart`/`_deductStockForSaleItem`) · stock_cas.js · marker/idempotency contract · pos.js checkout · SQL/schema/RLS (product_bundles/stock_movements มีพอแล้ว). **bump 476→477 ครบ** (data-app-build + 4×?v= [style.css/selfheal.js/main.js/boot.js] + sw cache-v477 + comment; data-app-version 5.69.1 / package 5.66.0 คงเดิม ตาม precedent build 476; e2e build-sync smoke 12-14 เขียว). **ไฟล์ (7):** main.js · **+modules/bundle_revert.js** · index.html · sw.js · **+tests/bundle_revert_restock_guard.test.js** · tests/revert_stock_cas_guard.test.js · tests/stock_mirror_canonical_guard.test.js · tests/dashboard_readonly_guard.test.js (476→477) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1849/1849** (revert/bundle/cas guards เขียวครบ) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-477-bundle-revert-restock` (ฐาน origin/main `42b9b67`=build 476) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke (ต้องมี bundle จริง):** สร้าง/มีสินค้า bundle ที่มี children + สต็อก → ขาย bundle 1 บิล (สังเกตสต็อก children ลด) → ยกเลิก/ลบบิล → **เช็คสต็อก children กลับมาเท่าเดิม, คลังถูก** (sale_items.warehouse_id), ลบซ้ำ=ไม่คืนเพิ่ม; non-bundle void ยังคืนปกติ. **Known risks/limitations:** (1) **recipe-change limitation:** ถ้าแก้สูตร bundle หลังขาย → คืนตาม recipe **ปัจจุบัน** × line qty (gated ด้วย deductedIds child ids) ไม่ใช่ qty ที่ตัดจริงตอนขาย — ความเป๊ะ 100% ต้องเปลี่ยนเป็น movement-based (ขยาย deductedIds query เป็น select=product_id,qty) = เลือก recipe-based เพราะ minimal/ตรงกับ deduct + เคส recipe-change ระหว่างขาย-void หายาก; (2) bundle children ถูก deduct แบบ auto-warehouse (Phase 466 ส่ง warehouseId ของ bundle line ต่อให้ child) → คืนเข้า sale_items.warehouse_id เดียวกัน (consistent); ถ้าตอนขายเป็น auto/null → คืน home-first เหมือน non-bundle (limitation เดิม).

**build 478 (Phase 478 — dead-stock report uses real period sales) [STOCK · report-only §S1]:** **Baseline:** origin/main `064d5a3` (build 477 live — Phase 477 bundle-revert merged `49ec159` + audit-docs `064d5a3`; collision กับ 477 ที่ทำ session ก่อนหน้า "หมดไป" เพราะ 477 merge แล้ว → phase นี้ = 478 สะอาด). **บั๊ก (AUDIT_STOCK_2026-06-18.md §S1, verified):** `modules/dead_stock.js` คิด "ขายในช่วง" จาก `state.saleItems` ที่ **ไม่เคยถูก assign** (grep `state.saleItems =` = 0; loadAllData ไม่โหลด sale_items เข้า state — fetch on-demand ต่อบิลเท่านั้น) → `soldProductIds` ว่างเสมอ → `dead = ทุกสินค้า stock>0`; ซ้อนด้วย `state.sales` cap 50 (recentSales เห็นแค่ 50 บิล). ผล: KPI/% /Excel/ตาราง **เพี้ยนทั้งหน้า** (สินค้าขายดีขึ้นเป็น "ไม่เคยขาย" → ตัดสินใจล้างของผิด). report-only ไม่กระทบเงิน/สต็อกจริง. **เนื้องาน (dead_stock.js ไฟล์เดียว):** render เปลี่ยนเป็น **async fetch-driven**: (1) `loadingHtml(days)` ก่อน (period buttons ใช้ได้ระหว่างโหลด); (2) **`fetchSaleMovementsSince(cutoffKey)`** — raw GET `window.SUPABASE_CONFIG` (mirror stock_reconcile_report) `stock_movements?type=eq.sale&created_at=gte.{cutoff}&select=product_id,created_at&order=id.asc&limit=1000&offset=N` **วน paginate จนหน้าสุดท้าย (page.length<PAGE) — ไม่ cap**; HTTP fail/bad-shape/exception → `{ok:false,reason}`; (3) `.then`: เช็ค `document.body.contains(container)` + `_deadStockDays===days` (กัน render ทับเมื่อเปลี่ยนช่วง/ออกหน้าระหว่างโหลด); **!ok → `errorHtml(reason)` + ปุ่มลองใหม่ + showToast (★ ไม่ fallback "ทุกตัว dead" เงียบ ๆ)**; ok → `indexSaleMovements(rows)`→`{soldSet,lastSaleMap}` → `computeDeadStock({products,soldSet,lastSaleMap,nowMs})` → render. **เลือก stock_movements (ไม่ใช่ sale_items)** เพราะ: (a) bundle ขาย → movement ลงใต้ **child id** (sale_items เก็บ parent) → จับ children ที่ขายจริงถูก (sale_items จะ miss → children ขึ้น dead ผิด); (b) เลี่ยง cap. **pure helpers (export, tested):** `indexSaleMovements(rows)` = soldSet distinct + lastSaleMap max(created_at)/product; `computeDeadStock(...)` = stock>0 & ไม่ใน soldSet = dead, enrich value=stock×cost, sort desc, totalValue. **label ซื่อตรง:** dead row → "⚠️ ไม่ขายมา ≥ {days} วัน" (เดิมเคลม "ไม่เคยขาย" ผิด — window พิสูจน์ never-ever ไม่ได้); KPI sub "ไม่มีการขายในช่วง {days} วัน"; caption "อ้างอิงการขายจริง (stock movements) ตั้งแต่ {cutoff}". **READ-ONLY** (ไม่มี POST/PATCH/DELETE/xhr* / ไม่ mutate state). period change/edit/export wiring คงเดิม. **❌ ไม่แตะ:** loadAllData batch (★ ไม่โหลด sale_items ทั้งตารางเข้า state — ใหญ่/ช้า) · stock/money write · pos.js · SQL/schema/RLS. **bump 477→478 ครบ** (data-app-build + 4×?v= + sw cache-v478 + comment; data-app-version 5.69.1 / package 5.66.0 คงเดิม; e2e build-sync smoke 12-14 เขียว). **ไฟล์ (5):** modules/dead_stock.js · index.html · sw.js · **+tests/deadstock_real_sales_guard.test.js** (10: behavioral indexSaleMovements [distinct/max-date/empty] + computeDeadStock [dead rule/exclude service·non_stock·zero/empty-soldSet=all-dead/sort+total/daysSince deterministic] + source [ไม่อ้าง state.saleItems · fetch type=eq.sale+cutoff+offset paginate · error-before-compute returns early ไม่ fallback · read-only no write-verbs]) · tests/dashboard_readonly_guard.test.js (477→478) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1859/1859** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-478-deadstock-real-sales` (ฐาน origin/main `064d5a3`=build 477) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke:** เปิดหน้า "สต็อกค้างนาน (Dead Stock)" → เห็น loading แวบ → รายการ dead = **สินค้าที่ไม่ได้ขายจริงในช่วงเท่านั้น** (สินค้าขายบ่อย/เพิ่งขาย **ไม่** ขึ้น dead แล้ว); สลับช่วง 30/90/365 → ตัวเลขเปลี่ยนตามจริง; ลองตัดเน็ต/ทำให้ fetch fail → เห็น "โหลดไม่สำเร็จ + ปุ่มลองใหม่" (ไม่ใช่ "ค้างทุกตัว"). **Known risks:** (1) **movements vs sale_items semantic:** ใช้ movement type=sale = "เคยตัดสต็อก/มี demand"; **บิลที่ถูกลบ [ลบแล้ว]** ยังมี sale movement (การลบสร้าง return movement แยก) → product นั้นนับว่า "เคยขายในช่วง" = ไม่ขึ้น dead — ถ้า owner ต้อง exclude บิลลบ = งานเพิ่ม (cross-ref) ยังไม่ทำตาม scope; (2) lastSaleMap เป็น window-bounded → dead item (ไม่ขายในช่วง) ไม่มีวันที่ขายล่าสุดให้โชว์ → ใช้ label "≥{days} วัน" แทน (ตรง/ไม่ overclaim); (3) ช่วงกว้าง (365) + ขายเยอะ = fetch หลายหน้า (paginate ครบ ช้าขึ้นเล็กน้อย แต่ถูกต้อง — report เปิดไม่บ่อย).

**build 479 (Phase 479 — saveProduct/CSV stop writing derived products.stock) [🔴 MONEY/STOCK §4.2 · audit §S2 · SHOULD-FIX]:** **Baseline:** origin/main `c3a0f3d` (build 478 live — Phase 478 dead-stock `6e33806` + audit-docs `c3a0f3d`; working tree สะอาด ไม่มี uncommitted ของ session อื่น). **บั๊ก (AUDIT_STOCK_2026-06-18.md §S2, verified อ่านโค้ดจริง):** `products.stock` = **derived** = sum(`warehouse_stock`) canonical ผ่าน DB trigger 403. แต่ 2 จุดเขียน `products.stock` **ตรง**: (a) `main.js saveProduct` payload ส่ง `stock: totalStock`+`min_stock: totalMinStock` เสมอ — ปกติ trigger ทับให้ถูกหลัง warehouse_stock writes แต่ถ้า warehouse write บางตัว **fail** (`_whFails` build 474 เตือน toast แต่ "ไม่ revert") → `products.stock` ค้าง = totalStock (รวมคลังที่ fail) = **overstated** → oversell precheck (อ่าน `products.stock`) ผ่านทั้งที่ของไม่พอ; (b) `modules/products.js` CSV import เขียน `stock`/`min_stock` ตรงเข้า products (POST on_conflict=sku merge / PATCH by sku) **ไม่แตะ warehouse_stock** → re-import สินค้าที่มี warehouse rows → ทับ `products.stock` ผิด (warehouse_stock=truth ไม่เปลี่ยน) → diverge. **หลักฐานทางที่ถูก:** runtime deduct/revert ไม่เขียน `products.stock` ตรง (optimistic local sum + trigger canonical — locked `stock_mirror_canonical_guard`). **เนื้องาน (a) main.js saveProduct:** เพิ่ม `const hasWarehouse = whStockData.length > 0`; แยกการ set stock/min_stock ออกจาก object literal → `if (productType==="service") {stock=0;min_stock=0}` `else {min_stock=totalMinStock; if(!hasWarehouse) stock=totalStock}` — **มีคลัง → omit `stock` จาก payload** (ปล่อย trigger 403 derive จาก warehouse_stock writes ด้านล่าง); warehouse write fail บางตัว → `products.stock` = **understated** (trigger ไม่ fire คลังที่ fail) = ปลอดภัย กันขายเกิน ไม่ใช่ overstated; **★ ไม่ revert** (toast เตือนเดิมคงไว้). new-product POST: `createPayload = hasWarehouse && !service ? {...payload, stock:0} : payload` — **seed stock:0** กัน column NOT NULL (ถ้ามี); trigger overwrite = sum หลัง warehouse writes; ห้าม seed totalStock (overstate ถ้า wh fail). **⚠️ ตัดสินใจสำคัญ — min_stock เขียนตรงต่อ (deviate จาก prompt ที่ว่า omit ทั้งคู่):** grep พบ trigger 403 derive เฉพาะ `stock` (`set stock = sum(...)`) **ไม่ derive min_stock**; `products.min_stock` ถูกอ่านจริงโดย `getDisplayStock` "all" view (products.js:204) + `_isLowStock` (main.js:621) + dashboard → ถ้า omit จะค้าง stale; min_stock = threshold เตือน **ไม่ใช่ vector ขายเกิน** (overstate/understate แค่ปรับความไวการเตือน) → เขียนตรงปลอดภัย/ถูกต้องกว่า omit. **(b) products.js CSV import — แนวทาง (ii) strip:** ตัด `stock`/`min_stock` ออกจาก payload (CSV = master data; upsert on_conflict=sku merge-duplicates ที่ใส่ stock จะทับ `products.stock` สินค้าที่มี warehouse → diverge/เสี่ยงขายเกิน) + toast "นำเข้าข้อมูลสินค้า … — ตั้งสต็อกผ่าน รับเข้า/นับสต็อก". เลือก (ii) เพราะ CSV=ข้อมูลสินค้า, ตั้งสต็อกที่ถูกต้องต้อง route ผ่าน warehouse_stock→trigger; (i) route-home ต้องรู้ product id หลัง upsert (return=minimal ไม่คืน id) + ซับซ้อนกว่า. **state/cache:** payload omit stock → optimistic merge (edit) เก็บค่า stock เดิมจาก DB (ไม่ใช่ totalStock พอง); new product ใช้ savedProduct (POST returnData = stock 0) → `setTimeout(loadAllData,100)` เดิม refetch ค่าจริงจาก trigger. **🔴 invariant guard (ขยาย stock_mirror_canonical_guard +2 test):** saveProduct — `payload.stock = totalStock` มี **ครั้งเดียว** หลัง `if (!hasWarehouse)` (regex count===1) · ไม่มี pattern `stock: productType==="service" ? 0 : totalStock` เดิม · new-warehouse seed `{ ...payload, stock: 0 }` · `payload.min_stock = totalMinStock` ยังอยู่ · มี comment "trigger 403"; CSV — payload ไม่มี `stock: Number(getVal(row, COL.stock)` / `min_stock: Number(...)`. **❌ ไม่แตะ:** trigger 403 / SQL / schema (trigger ถูกแล้ว) · runtime deduct/revert (`_deductStockForSaleItem`/`_revertStockForSale`/`_applyStockMovement`) · `stock_cas.js` · `pos.js` · warehouse_stock writes + `_whFails` toast (คงเดิม). **bump 478→479 ครบ** (data-app-build + 4×?v= [style.css/selfheal.js/main.js/boot.js] + sw cache-v479 + comment; data-app-version 5.69.1→**5.69.2** + package.json 5.66.0→**5.69.2** [align ตาม memory version-sync] ; e2e build-sync smoke 12-14 เขียว). **ไฟล์ (7):** main.js · modules/products.js · index.html · sw.js · package.json · tests/stock_mirror_canonical_guard.test.js (+2 test) · tests/dashboard_readonly_guard.test.js (478→479) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1861/1861** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-479-saveproduct-csv-derived-stock` (ฐาน origin/main `c3a0f3d`=build 478) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke:** (1) แก้สินค้าที่มีหลายคลัง (เปลี่ยน stock คลังนึง) → บันทึก → หน้าสินค้า/คลัง `products.stock` (ทุกคลัง) = **sum(warehouse_stock) จริง** ไม่ใช่ค่า optimistic; (2) จำลอง warehouse write fail (เช่น offline ชั่วขณะ/RLS) → เห็น toast "บันทึกสต็อกบางคลังไม่สำเร็จ" + `products.stock` **ไม่เกินจริง** (≤ sum ที่เขียนสำเร็จ); (3) นำเข้า CSV ที่มีคอลัมน์คงเหลือ → `products.stock` ของสินค้าที่มีคลัง **ไม่ถูกทับ** (คงค่า warehouse-derived เดิม) + toast บอกตั้งสต็อกผ่านรับเข้า/นับสต็อก; สินค้าใหม่จาก CSV → สร้างได้ (ไม่ error NOT NULL). **Known risks:** (1) **NOT NULL บน products.stock:** ถ้า schema เป็น NOT NULL ไม่มี default → PATCH omit stock (edit warehouse product) ไม่ error (ไม่ส่ง field=ไม่แตะ); POST new warehouse product seed 0 กันไว้แล้ว; **CSV insert สินค้าใหม่ omit stock** — ถ้า NOT NULL no-default จะ error (Phase 437 CHECK ระบุ NULL ผ่านได้ → คาดว่า nullable; owner smoke ข้อ 3 ยืนยัน); (2) min_stock เขียนตรง → warehouse min write fail บางตัว = `products.min_stock` อาจไม่ตรง sum (เตือน low-stock ไวผิดเล็กน้อย — benign ไม่ใช่ oversell); (3) CSV เลิกตั้งสต็อก = behavior change ผู้ใช้ที่เคยใช้ CSV ตั้งสต็อก ต้องใช้รับเข้า/นับสต็อกแทน (toast แจ้ง).

**build 480 (Phase 480 — oversell precheck uses single sold warehouse, not sum) [🟠 MONEY/STOCK §4.2 · audit §S3 · SHOULD-FIX low-med]:** **Baseline:** origin/main `0c09c99` (build 479 live — Phase 479 saveProduct/CSV `f89f1d3` + audit-docs `0c09c99`; working tree สะอาด). **บั๊ก (AUDIT_STOCK_2026-06-18.md §S3, verified อ่านโค้ดจริง):** doCheckout precheck (Phase 473, `pos.js`) ตอน **auto mode** (ไม่เลือกคลัง, `_posWarehouseId=""`) เทียบ qty กับ `Number(_p.stock||0)` = `products.stock` = **ผลรวมทุกคลัง**; แต่ deduct (`main.js _deductStockForSaleItem` auto branch) ตัด **คลังเดียว** (บ้านก่อน ไม่งั้นคลัง stock มากสุด, `stocks[0]` หลัง sort) ไม่ spill ข้ามคลัง → mismatch: ของ 3(บ้าน)+4(รถ)=7 ขาย 5 → precheck ผ่าน (5≤7) แต่ตัดบ้านได้ 3 → ติดธง `[สต็อกไม่ครบ]` (Phase 469) ทั้งที่ของพอ (fails closed = undersell/false flag ไม่ใช่ oversell). picked mode (เลือกคลัง) precheck ใช้ `_posWhStock` = คลังนั้น = ถูกอยู่แล้ว. **เนื้องาน — extract shared helper (กัน drift):** +`modules/warehouse_pick.js` export **pure** `pickAutoWarehouseStock(state, productId)` — ดึง auto-pick logic (filter stock>0 → sort บ้าน-first → max stock; slice copy ไม่ mutate) ออกจาก deduct มาเป็น **single source**; คืน `{warehouse_id, stock}` ของคลังที่จะหยิบ หรือ `null` ถ้าไม่มี warehouse row. (1) **main.js deduct auto branch:** แทน inline `stocks.sort(...)+stocks[0]` ด้วย `const _pick = pickAutoWarehouseStock(state, product.id); ws = (_pick && stocks.find(warehouse_id===_pick.warehouse_id)) || stocks[0]` — behavior ตัดเดิมเป๊ะ (ตัดคลังเดียว, home-first) แค่ pick ผ่าน helper. (2) **pos.js precheck auto branch:** `_avail = _pick ? _pick.stock : Number(_p.stock||0)` (helper เดียวกับ deduct → คลังตรงกัน 100%) + `_whName` ของคลังนั้น; block message ระบุ "คลัง {ชื่อ} มี {N} (ในบิล {qty})" + toast เพิ่ม "เลือกคลังอื่น". picked branch คงเดิม (`_posWhStock`). **⚠️ ตัดสินใจสำคัญ — legacy no-warehouse fallback (deviate จาก prompt edge ที่ว่า "ไม่มี row → avail 0 → block"):** grep deduct พบสินค้า **ไม่มี warehouse row** (stocks.length===0) → deduct ตัด **`products.stock` ตรง** ผ่าน legacy CAS branch (`main.js:3211` `_atomicDecrementStock("products",...)`) = ขายได้ปกติ. ถ้า precheck block (avail 0) จะ **ขวางการขาย legacy product ที่ขายได้จริง = regression**. จึง `pickAutoWarehouseStock` คืน null → precheck **fallback `products.stock`** = ค่าที่ deduct legacy ตัดจริง → precheck/deduct consistent ทั้ง warehouse + legacy. (เลือก consistent-with-deduct ดีกว่า block ตาม prompt — ตรง concept "เช็คคลังที่ deduct จะตัดจริง"). **🔴 invariant guard:** +`tests/precheck_single_warehouse_guard.test.js` (8: pure helper — home-first แม้รถมีมากกว่า [คืน 3 ไม่ใช่ sum 7] · home 0→max stock · no row→null · all 0→null · ไม่ mutate input (sort copy) · string/number id tolerant; source — deduct ใช้ helper + ไม่มี inline home-sort เหลือ (drift guard) · precheck import+ใช้ helper auto + `_posWhStock` picked + legacy fallback `products.stock` + message ระบุคลัง+"เลือกคลังอื่น"). **ปรับ guard เดิม 2 ตัว (intent เดิม shape เปลี่ยนจาก refactor):** `pos_warehouse_deduct_guard` ("auto home-first" → assert ใช้ `pickAutoWarehouseStock` แทน inline sort; home-first rule ล็อกใน guard ใหม่แทน) · `checkout_stock_precheck_guard` (slice window 16000→18000 เพราะ precheck ยาวขึ้น ดัน "reset UI buttons" marker เกิน window — intent เดิม: precheck ใน try ก่อน finally). **❌ ไม่แตะ:** deduct **behavior** (ตัดคลังเดียว = ถูกตามคอนเซ็ป ไม่เปลี่ยนเป็น spill ข้ามคลัง) · revert · `stock_cas.js` · Phase 469 flag (backstop race คงเดิม) · SQL/RLS/schema. **bump 479→480 ครบ** (data-app-build + 4×?v= [style/selfheal/main/boot] + sw cache-v480 + comment; data-app-version 5.69.2→**5.69.3** + package.json **5.69.3**; e2e build-sync smoke 12-14 เขียว). **ไฟล์ (8 + 2 ใหม่):** main.js · modules/pos.js · **+modules/warehouse_pick.js** · index.html · sw.js · package.json · **+tests/precheck_single_warehouse_guard.test.js** · tests/pos_warehouse_deduct_guard.test.js · tests/checkout_stock_precheck_guard.test.js · tests/dashboard_readonly_guard.test.js (479→480) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1869/1869** (+8 · POS/stock guards multi_payment/quick_pay/stock_cas/checkout_inflight/pos_warehouse_deduct เขียวครบ) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-480-precheck-single-warehouse` (ฐาน origin/main `0c09c99`=build 479) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke:** (1) auto mode: สินค้าที่มี บ้าน 3 + รถ 4 (รวม 7) → ใส่ตะกร้า 5 → กดจ่าย → **บล็อก + ข้อความ "คลัง บ้าน… มี 3"** (ไม่สร้างบิล, ไม่ติดธงผิด); ลดเหลือ 3 → ขายได้ ตัดบ้าน; (2) เลือกคลัง "รถคันแดง" (มี 4) → ขาย 4 ได้ / ขาย 5 บล็อกระบุคลังรถ — เหมือนเดิม; (3) สินค้า legacy ไม่มีคลัง (products.stock>0) auto → ขายได้ปกติ (ไม่ถูกบล็อกผิด). **Known risks:** (1) precheck ใช้ cache (`state.warehouseStock`) เป็น UX gate ชั้นแรก — ด่านจริง = CAS floor ตอน deduct + Phase 469 flag (ไม่เปลี่ยน); cache stale = อาจ block/ผ่านคลาดเล็กน้อย แต่ CAS กัน oversell จริงเสมอ; (2) ขายข้ามคลังในบิลเดียวยัง **ไม่รองรับ** (ตั้งใจ — concept 1-บิล-1-คลัง; ถ้าของกระจาย 3+4 อยากขาย 5 ต้องเลือกคลังที่มีพอ/โอนรวมก่อน/แยกบิล); (3) helper pick = cache-based เหมือน deduct → ถ้า 2 เครื่องขายพร้อมกันคลังเดียวกัน CAS ที่ deduct คือด่านตัดสินจริง (precheck แค่ UX).

**build 481 (Phase 481 — product-save input validation: dup barcode/SKU warn + bundle qty NaN) [🟢 audit §S4 §S5 · low-med · input-validation]:** **Baseline:** origin/main `49ce9cd` (build 480 live — Phase 480 precheck `572c382` + audit-docs `49ce9cd`; working tree สะอาด). **บั๊ก (AUDIT_STOCK_2026-06-18.md §S4 §S5, verified):** (S5) `saveProduct` (main.js) validate ชื่อ+ราคา+auto-gen SKU แต่ **ไม่เช็ค barcode/sku ซ้ำ**; ไม่มี DB unique constraint บน barcode/sku → 2 สินค้า barcode เดียวกันได้ → POS สแกนเจอตัวแรก = mis-scan เงียบ (ผิดตัว/ราคาผิด). (S4) bundle child qty = `Number(inp.value||1)` (qty input edit) + `Number($("bundleQtyInput")||1)` (add button, guard `qty<=0`) → `Number("2ก")=NaN`; `NaN<=0`=false → **NaN รอด guard** → `product_bundles.qty` corrupt (Phase 474 fix NaN ให้ price/cost/stock แต่ตก bundle qty). latent (0 bundle ในระบบ) แต่ corrupt ถ้าพิมพ์ qty ผิด. **เนื้องาน — +`modules/product_validation.js` (pure, unit-tested):** `findDuplicateProduct(products, {sku,barcode}, excludeId)` = หาสินค้าตัวอื่น (id≠excludeId) ที่ barcode/sku ตรง (ค่าไม่ว่าง, trim); **เช็ค barcode ก่อน** (POS สแกน barcode) แล้ว sku → คืน `{field,value,product}` หรือ null. `normalizeBundleQty(v)` = `Number.isFinite(q)&&q>0 ? q : 1` (mirror Phase 474). **main.js wiring:** (1) **S5** saveProduct หลัง auto-gen SKU/ก่อน `showToast("กำลังบันทึก")` → `_dup = findDuplicateProduct(state.products,{sku,barcode},state.editingProductId)`; เจอ → ถ้า `typeof window.App?.confirm==="function"` → `await App.confirm("บาร์โค้ด/SKU {x} ซ้ำกับ '{ชื่อ}' — บันทึกต่อ?")` → cancel `return` (ไม่ save); modal ไม่พร้อม → showToast เตือน **แต่ไม่ block** (warn-only allow-proceed — owner ตัดสินต่อ case, ไม่ขวาง edit ที่ตั้งใจ). modal escape ผ่าน `showConfirmModal`→`escapeHtml` (XSS safe). (2) **S4** qty input edit (`bd-item-qty`) → `normalizeBundleQty(inp.value)` (เดิม `Number(inp.value||1)`); add button (`bundleAddBtn`) → guard เปลี่ยนเป็น `!Number.isFinite(_rawQty)||_rawQty<=0` (เดิม `qty<=0` ปล่อย NaN รอด); bundle insert payload → `.filter(it=>it&&it.product_id!=null&&it.product_id!=="").map(...qty:normalizeBundleQty(it.qty))` (drop row ไม่มี child id + normalize). **🔴 invariant guard:** +`tests/product_validation_guard.test.js` (12: behavioral findDuplicateProduct [dup barcode/sku/priority barcode/exclude self/empty skip/trim match/non-array] + normalizeBundleQty [valid keep / "2ก"·NaN·0·neg·empty·undefined→1] + source saveProduct [findDuplicateProduct exclude self · App.confirm cancel→return · dup ก่อน products write · no alert] + bundle insert [normalizeBundleQty+filter no-child-id] + input handler/add-button normalize/reject). **❌ ไม่แตะ:** deduct/revert/stock paths · pos.js checkout · SQL/schema (★ ไม่เพิ่ม DB unique index — client warn ก่อน; DB constraint = follow-up ถ้า owner ต้องการ) · saveProduct guards เดิม (name/price/stock-derived Phase 479 ไม่อ่อนลง). **bump 480→481 ครบ** (data-app-build + 4×?v= [style/selfheal/main/boot] + sw cache-v481 + comment; data-app-version 5.69.3→**5.69.4** + package.json **5.69.4**; e2e build-sync 12-14 เขียว). **ไฟล์ (5 + 2 ใหม่):** main.js · index.html · sw.js · package.json · **+modules/product_validation.js** · **+tests/product_validation_guard.test.js** · tests/dashboard_readonly_guard.test.js (480→481) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1881/1881** (+12) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-481-product-save-validation` (ฐาน origin/main `49ce9cd`=build 480) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke:** (1) สร้าง/แก้สินค้าใส่ barcode ที่ตรงกับสินค้าอื่น → กดบันทึก → **modal เตือน "บาร์โค้ด … ซ้ำกับ '<ชื่อ>'"** → กดยกเลิก=ไม่บันทึก / ยืนยัน=บันทึกต่อ; ใส่ SKU ซ้ำ → เตือนเหมือนกัน; แก้สินค้าเดิม (barcode ตัวเอง) → **ไม่เตือน**; (2) ฟอร์มชุด (bundle): พิมพ์จำนวน "2ก"/0/ติดลบ ในช่อง qty → กลายเป็น 1 (ไม่ใช่ NaN/ค่าพัง); ปุ่มเพิ่มสินค้าในชุด พิมพ์จำนวนเป็นตัวอักษร → เตือน "จำนวนต้องเป็นตัวเลขมากกว่า 0" (ไม่เพิ่ม). **Known risks:** (1) **ไม่มี DB unique** → ถ้า owner กด "บันทึกต่อ" หรือยิง API ตรง ยังซ้ำได้ (client warn เป็นด่านเดียว — DB partial unique index = follow-up ถ้าต้องการ hard-block); (2) dup check อ่าน `state.products` ที่โหลดไว้ (cap ครบ — loadAllData paginate) — ถ้าสินค้ายังโหลดไม่ครบ (rare) อาจไม่เจอ dup; (3) bundle qty fractional (เช่น 1.5) ยังผ่าน (normalize เช็คแค่ finite&>0 ไม่ force integer — คงพฤติกรรม `Number` เดิม ไม่เปลี่ยน scope).

**build 482 (Phase 482 — ตัดสต็อกอุปกรณ์งานช่าง "ตอนปิดงาน" ไม่ใช่ตอนเพิ่ม + งานเดิมเพิ่มอุปกรณ์ได้) [🔴 MONEY/STOCK §4.1+4.2 · owner model change]:** **Baseline:** origin/main `b7d7cc5` (build 481 live — Phase 481 S4/S5 merged โดย owner; working tree สะอาด). **โมเดล owner:** ช่างเพิ่ม/แก้อุปกรณ์ได้ตลอดช่วงงาน "ยังไม่ปิด" = ยังไม่ตัดสต็อก; ตัดจริง "ครั้งเดียว" ตอน owner ปิด/ส่งมอบ (done/delivered/closed) + ได้เงิน (พร้อม JV); ยกเลิกงานที่ตัดแล้ว → คืนสต็อก. **บั๊กเดิม:** (ก) Phase 402 + service_form ตัดสต็อก "ตอนสร้าง/บันทึกงาน" (ช่างยังไม่ทำ ของหายจากคลังแล้ว); (ข) งานเดิม (รวมงาน Ning/LINE ที่ items_json=[]) เพิ่มอุปกรณ์แล้ว save ทิ้ง (gate `isNewJob`). **เนื้องาน:** **(1) modules/service_equipment.js** — +`STOCK_DEDUCTED_MARKER="[ตัดสต็อกแล้ว]"` + `deductServiceJobStock(job)` (idempotent: items ว่าง / note มี marker → `{deducted:false}`; ไม่งั้นเรียก `deductEquipmentStock` per-item out/CAS/floor + คืน `newNote` ที่ต่อ marker) + แก้ gate `restoreServiceJobStock` เป็น **คืนเฉพาะงานที่ "เคยตัดจริง"** (`items.length===0 || !note.includes(DEDUCTED) || note.includes(RETURNED)` → no-op) กันคืน phantom stock ของงานที่เพิ่มอุปกรณ์แต่ยังไม่ปิด. **(2) main.js openServiceJobDrawer** — readonly = `["done","delivered","closed"].includes(job?.status)` (เดิม `_hasExistingItems`) → งานเปิด (pending/progress รวมงาน Ning items ว่าง) แก้อุปกรณ์ได้; clone `items_json` มาแสดงเสมอ. **(3) main.js saveServiceJob** — `_equipItemsForSave` gate `(!_serviceDrawerEquipReadonly)` (ลบ `isNewJob &&` → งานเดิมบันทึก items_json ได้); precheck คงเดิม; **ลบ deduct-on-save block**; **+deduct-on-close block หลัง JV block** เงื่อนไข `(transitionedToDone || newJobAlreadyComplete)` (★ ไม่รวม editCompleteWithChange — งานปิดอยู่แล้วไม่ตัดซ้ำ): build `jobForDeduct` (state+payload, items_json ?? จาก drawer) → `_equipDeductOnClose` → ถ้า deducted: optimistic + `xhrPatch note=newNote` (แปะ marker กันตัดซ้ำ; PATCH fail → toast "ห้ามปิดซ้ำ") + sync marker ลง local state (กัน cancel-ทันทีหลังปิด restore พลาด) + เตือนถ้า stockOpsFailed (ไม่ rollback §4.8). **(4) modules/service_form.js** — ลบ deduct loop (`movementType:"out"`) + optimistic-deduct mirror (ฟอร์มรับงานไม่ตัดสต็อกแล้ว — `record.items_json` ยังบันทึก → drawer ตัดตอนปิด); **คง auto-transfer** (`_appTransferWarehouseStock` ย้ายคลังเตรียมของ ไม่ใช่ consume). **(5) +supabase-phase482-freeze-deducted-equipment.sql (owner รัน)** — มาร์คงานเก่าที่มี items_json ว่า `[ตัดสต็อกแล้ว]` (idempotent, note-only) กัน **double-deduct** ตอนปิดงานเก่า + ให้ restore-on-cancel งานเก่าทำงาน (gate ใหม่ต้องมี marker). **⚠️ ตัดสินใจ/deviate:** (a) ลบ optimistic-deduct ใน service_form ด้วย (นอกเหนือ deduct loop ที่ prompt ระบุ) — เพราะถ้าเหลือไว้ state.warehouseStock จะลดทั้งที่ไม่ตัดจริง = แสดงสต็อกผิด; (b) sync marker ลง local state.serviceJobs หลัง PATCH (กัน cancel ทันทีอ่าน note เก่าไม่มี marker → restore พลาด). **🔴 guard:** +`tests/service_equipment_deduct_on_close.test.js` (14: deductServiceJobStock empty/marker-idempotent/deduct+marker/empty-note + restore gate no-marker/deducted/returned + source main readonly·items_json gate·no-deduct-on-save·deduct-on-close+marker + service_form no-out). **ปรับ guard เดิม 4 (lock โมเดลใหม่):** `service_job_equipment_guard` (deduct-on-create→items-when-editable+deduct-on-close), `service_job_cancel_restore_guard` (fixtures +DEDUCTED marker), `apply_stock_movement_floor` (service_form ไม่ deduct; ac_install/solar ยัง), `service_job_block_save_guard` (toast prefix). **➕ Addendum (commit ถัดไป, build ยัง 482, ก่อน merge):** review พบ deduct-on-close ทำให้งาน ac_install.js/solar.js **ตัดซ้ำ** (สร้าง pending+items_json+ตัดตอนสร้าง → ปิดผ่าน drawer → close-deduct ตัดอีก; SQL freeze ครอบแค่งานเก่า ไม่ครอบงานใหม่หลัง deploy). แก้: **ลบ deduct loop (`movementType:"out"`) + optimistic-deduct ใน ac_install.js + solar.js** (mirror service_form เป๊ะ) คง transfer + items_json → ตอนนี้ **ทั้ง 4 path (drawer/service_form/ac_install/solar) สร้างงาน=ไม่ตัด, ตัดครั้งเดียวตอนปิดผ่าน drawer**. guard: ขยาย `service_equipment_deduct_on_close` (no-out ครบ 3 ฟอร์ม) + `apply_stock_movement_floor` (รวมเป็น "intake forms ไม่ตัดตอนสร้าง; floor ที่ deduct-on-close"). **❌ ไม่แตะ:** POS checkout/`_deductStockForSaleItem`/`_revertStockForSale` · สูตร/mapping JV `auto_post.js` (แตะแค่ "เมื่อไหร่ตัด") · `stock_cas.js`/trigger 403/RLS/schema · transfer loop ทุกฟอร์ม (คงไว้). **bump 481→482 ครบ** (data-app-build + 4×?v= + sw cache-v482 + comment; data-app-version 5.69.4→**5.69.5** + package **5.69.5**; e2e build-sync 12-14 เขียว). **ไฟล์ (10 + 2 ใหม่):** main.js · modules/service_equipment.js · modules/service_form.js · index.html · sw.js · package.json · **+supabase-phase482-freeze-deducted-equipment.sql** · **+tests/service_equipment_deduct_on_close.test.js** · tests/{service_job_equipment,service_job_cancel_restore,apply_stock_movement_floor,service_job_block_save,dashboard_readonly}_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1895/1895** · e2e **14/14** · EOL LF. **สถานะ:** ✅ **MERGED + LIVE build 482** (origin/main `6a30c87` รวม addendum; CI Tests+Deploy success) + ✅ **owner รัน `supabase-phase482-freeze-deducted-equipment.sql` แล้ว 2026-06-18** (งานเก่ามี items มาร์ค [ตัดสต็อกแล้ว] → double-deduct risk ปิด). **owner smoke (preview):** (1) สร้างงาน+อุปกรณ์ status pending → save → **สต็อกไม่ลด** + items_json บันทึก; (2) เปิดงาน pending นั้น **เพิ่มอุปกรณ์ได้อีก** (ไม่ readonly) → save ติด; (3) เปลี่ยน→delivered → save → **สต็อกลดครั้งเดียว** + JV เกิด + note มี [ตัดสต็อกแล้ว]; (4) re-save งานที่ปิด → **ไม่ลดซ้ำ**; (5) ยกเลิกงานที่ปิด → **คืนสต็อก**; (6) ยกเลิกงาน pending ที่ใส่อุปกรณ์แต่ยังไม่ปิด → **ไม่คืน phantom**. **Known risks:** (1) ✅ **RESOLVED — SQL รันแล้ว 2026-06-18** (งานเก่ามี items มาร์ค [ตัดสต็อกแล้ว] → ปิดงานเก่าไม่ตัดซ้ำ + ยกเลิกงานเก่าคืนได้); (2) ✅ **ac_install.js/solar.js แก้แล้วใน addendum** (ไม่ตัดตอนสร้างแล้ว — กัน double-deduct; เดิม known-risk นี้ = resolved); (3) งานที่สร้างเป็นสถานะปิด "โดยตรงจากฟอร์มรับงาน" (ไม่ผ่าน drawer) จะไม่ถูกตัด (ฟอร์ม `COMPLETION_STATUSES=[]` ไม่ post JV อยู่แล้ว — flow ปกติ = ฟอร์มสร้าง pending → ปิดผ่าน drawer); (4) transfer ยัง on-create (ย้ายของเตรียม ไม่ใช่ consume — ตั้งใจ).

**build 483 (Phase 483 — revert คืนสต็อกไม่เกินที่ตัดจริง · qty-aware) [🟠 MONEY/STOCK §4.2 · audit §S6 · should-fix]:** **Baseline:** origin/main `6a30c87` (build 482 live — Phase 482 + addendum merged โดย owner; working tree สะอาด). **บั๊ก (AUDIT_STOCK_2026-06-18.md §S6):** `_revertStockForSale` (void/ลบบิล POS) gate ด้วย `deductedIds = Set(product_id)` boolean แต่ restock = per-line `item.qty` → ถ้า product เดียวโผล่หลายบรรทัด (standalone + ใน bundle) และตัดได้ "บางบรรทัด" (oversell force-sold `[สต็อกไม่ครบ]` → ตัดได้ < ที่สั่ง) → gate boolean ปล่อย "ทุกบรรทัด" → คืนรวม > qty ที่ตัดจริง = **phantom stock** (เสี่ยง oversell รอบหน้า). **เนื้องาน — +`modules/revert_qty.js` (pure, unit-tested):** `buildDeductedQty(movRows)` = `Map(String(product_id) → sum Number(qty))` จาก sale movements ของบิล (ไม่ใช่ array → `null` = เช็คไม่ได้ → fallback; NaN qty → 0); `takeRestockQty(deductedQty, productId, want)` = `min(want, remaining)` floored 0 + **หัก quota** (mutate map) → null map → คืน `want` เต็ม (fallback กัน under-credit). **main.js `_revertStockForSale`:** (1) fetch movement `select=product_id,qty` (เพิ่ม qty); (2) `deductedIds = new Set(...)` → `deductedQty = buildDeductedQty(movRows)` (build **ครั้งเดียวก่อนลูป**); (3) non-bundle gate → `restockQty = takeRestockQty(deductedQty, item.product_id, qty); if (deductedQty != null && restockQty <= 0) continue; restockProduct(product, restockQty, ...)`; (4) bundle child gate → `childRestock = takeRestockQty(deductedQty, c.childId, c.qty)` แบบเดียวกัน. **strict improvement:** ไม่มีทางคืน > เดิม (cap ที่ deducted); product เดียวหลายบรรทัด → บรรทัดแรกได้ก่อน, ที่เหลือได้เท่าที่เหลือ (แบ่งจาก deducted total ถูก); ไม่เคยตัด/ครบ quota → 0 → ข้าม. **คงเดิมทุกอย่าง:** `_STOCK_RETURNED_MARKER` idempotency · fail-closed note check · per-item best-effort (ไม่ rollback) · `restockProduct` ภายใน (เลือกคลัง sale_items.warehouse_id→home fallback / CAS / movement log) — **เปลี่ยนแค่ "คืนเท่าไหร่" ไม่ใช่ "คืนคลังไหน"**. **🔴 guard:** +`tests/revert_qty_guard.test.js` (11: buildDeductedQty non-array→null/sum/multi-key/NaN→0 + takeRestockQty null→full/cap/split-across-lines/exhaust→0/missing-key→0 + source: ใช้ build+take, ไม่มี `new Set`/`.has`/`deductedIds`, select `product_id,qty`). **ปรับ guard เดิม 2 (intent เดิม — กลไก boolean→qty-aware):** `revert_only_deducted_items_guard` (Phase 471 Set→qty quota), `bundle_revert_restock_guard` (per-child/non-bundle gate→qty-aware). **❌ ไม่แตะ:** `_deductStockForSaleItem`/checkout/`pos.js`/oversell precheck · `_atomicAddStock`/`_atomicDecrementStock`/trigger 403/marker · `restockProduct` ภายใน · สูตร JV. **bump 482→483 ครบ** (data-app-build + 4×?v= + sw cache-v483 + comment; data-app-version 5.69.5→**5.69.6** + package **5.69.6**; e2e build-sync 12-14 เขียว). **ไฟล์ (4 + 2 ใหม่):** main.js · index.html · sw.js · package.json · **+modules/revert_qty.js** · **+tests/revert_qty_guard.test.js** · tests/{revert_only_deducted_items,bundle_revert_restock,dashboard_readonly}_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1904/1904** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-483-revert-qty-aware` (ฐาน origin/main `6a30c87`=build 482) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke (preview · money/stock):** (1) void บิลปกติ (product ไม่ซ้ำบรรทัด) → คืนเท่าเดิม (ไม่ regress); (2) void บิล bundle → คืน children เท่าเดิม (Phase 477 ไม่ regress); (3) [ถ้าจัดฉากได้] บิล product ซ้ำ 2 บรรทัด ตัดได้บรรทัดเดียว (oversell flagged) → void → คืน "แค่ที่ตัดจริง" ไม่เกิน. **Known risks:** (1) qty-aware พึ่ง sale movement ของบิล (note ilike orderNo) — ถ้า movement note ไม่ตรง/fetch ล้ม → fallback คืนเต็ม (เหมือนเดิม, กัน under-credit แต่อาจ over-credit เคส flagged — เท่า Phase 471 เดิม ไม่แย่ลง); (2) substring match note (orderNo = ms timestamp, collision ต่ำ — residual เดิมจาก Phase 471 ไม่เปลี่ยน); (3) ไม่แตะการเลือกคลังคืน (sale_items.warehouse_id) — qty อาจถูก cap แต่คลังที่คืนยังเป็นของ restockProduct เดิม.

**build 484 (Phase 484 — saveProduct ปัดเงิน 2 ตำแหน่ง) [🔵 audit NIT · low-risk]:** **Baseline:** origin/main `ed04362` (build 483 live; working tree สะอาด). **NIT (AUDIT_STOCK_2026-06-18.md):** `saveProduct` เก็บ price/cost ดิบ (Number ผ่าน `_n0`) ไม่ปัด 2 ตำแหน่ง ขณะที่ inline POS price edit (`pos.js`) ปัดด้วย `round2` แล้ว = inconsistent + float drift (เช่น 19.999). **เนื้องาน (main.js saveProduct เท่านั้น):** import `round2` จาก `modules/utils.js` (มีอยู่แล้ว `Math.round(n*100)/100`) → ปัดทุก money field: `price:round2(_n0(...))`, `cost:round2(_n0(...))`, `wholesale = round2(Number(...))`, `promoPrice = round2(Number(...))`. **❌ ไม่แตะ:** `stock`/`min_stock` (จำนวน ไม่ใช่เงิน — `_n0` เดิม) · `_n0` helper · validation/dup-barcode/bundle-qty (481) · deduct/revert/JV. **🔴 guard:** +`tests/product_money_round_guard.test.js` (source: import round2 + 4 field ปัด); ปรับ `save_product_integrity_guard` (price/cost `_n0`→`round2(_n0(` — NaN-safe เดิมคงอยู่ใน wrap). **bump 483→484 ครบ** (data-app-build + 4×?v= + sw cache-v484 + comment; data-app-version 5.69.6→**5.69.7** + package **5.69.7**; e2e build-sync 12-14 เขียว). **ไฟล์ (4 + 1 ใหม่):** main.js · index.html · sw.js · package.json · **+tests/product_money_round_guard.test.js** · tests/{save_product_integrity,dashboard_readonly}_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1906/1906** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-484-saveproduct-round-money` (ฐาน origin/main `ed04362`=build 483) — **รอ owner review (ยังไม่ push main).** **owner smoke:** บันทึกสินค้าใส่ราคา 19.999 / ต้นทุน 5.005 → เปิดดูใหม่ = 20.00 / 5.01 (ปัด 2 ตำแหน่ง ไม่เก็บค่าหาง). **Known risks:** ต่ำมาก — round2 = helper เดิมใช้ทั่ว money math; ไม่กระทบ flow อื่น (เปลี่ยนแค่ค่าที่เขียนตอน save).

**build 485 (Phase 485 — `_applyStockMovement` ไม่ log movement เมื่อ CAS fail) [🔵 audit NIT3 · §4.8 · reconcile-noise]:** **Baseline:** origin/main `2680d14` (build 484 live; tree สะอาด). **NIT3 (AUDIT_STOCK_2026-06-18.md, verified อ่านโค้ดจริง):** `_applyStockMovement` (main.js, ใช้โดย manual stock-movements form + service-equipment deduct + stock_count/stock_in_wizard/refunds/products) ฝั่ง out-flow (`isOutFlow && !allowNegative`, main.js:3742): `dec.insufficient` → return ก่อน log ✅ แต่ **CAS fail แบบ non-insufficient** (RLS/network/retry หมด) → แค่ `console.warn` แล้ว fall through ไป `xhrPost("stock_movements")` (main.js:3795) ทั้งที่ `_atomicDecrementStock` ไม่ได้แตะ DB → **movement หลอก** (`type=out` ที่สต็อกไม่เปลี่ยน + `after` = optimistic `before+delta` ผิด) = reconcile noise. **ไม่ corrupt** (CAS ไม่เปลี่ยนสต็อก) → จัด NIT ถูก. **เนื้องาน (main.js 1 จุด):** ใน else ของ out-flow branch (non-insufficient CAS fail) → เพิ่ม `return { ok: false, error: dec.error || "..." }` ก่อน fall through (mirror Phase 465 ที่ `_deductStockForSaleItem` ทำแล้ว). **caller-safe:** ฟังก์ชัน return `{ok:false}` หลายจุดเดิม (insufficient/conflict/HTTP fail) → callers (service_equipment `!r?.ok`→stockOpsFailed, stock_movements, refunds, stock_count, stock_in_wizard, products) เช็ค `.ok` อยู่แล้ว = contract เดิม; เปลี่ยนแค่ rare non-insufficient fail จาก ok:true(หลอก)→ok:false(จริง) = honest failure. **🔵 scope note (deliberate):** แก้เฉพาะ out-flow (ตรง NIT3). **sibling เดียวกัน** ที่ยังเหลือ: in/return + allowNegative-override path (`_atomicAddStock` else, main.js:3756-3764) ก็ fall-through log เมื่อ add CAS fail — class เดียวกัน แต่ audit ไม่ได้ flag + เป็น stock-IN path (behavior change ต้อง verify caller เพิ่ม) → **ไม่แก้รอบนี้** (follow-up ถ้า owner ต้องการ consistency เต็ม). **🔴 guard:** ขยาย `apply_stock_movement_floor.test.js` +1 (non-insufficient CAS fail return ก่อน log; source-regex บน extracted body). **❌ ไม่แตะ:** insufficient/floor/adjust(472)/in-return/allowNegative path · `_atomicDecrementStock`/`_atomicAddStock`/trigger 403 · POS checkout/`_deductStockForSaleItem`. **bump 484→485 ครบ** (data-app-build + 4×?v= + sw cache-v485 + comment; data-app-version 5.69.7→**5.69.8** + package **5.69.8**; e2e build-sync 12-14 เขียว). **ไฟล์ (4):** main.js · index.html · sw.js · package.json · tests/{apply_stock_movement_floor,dashboard_readonly}_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1907/1907** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-485-applymovement-no-log-on-fail` (ฐาน origin/main `2680d14`=build 484) — **รอ owner review (ยังไม่ push main).** **owner smoke (ยากจัดฉาก — rare path):** ปกติทำงานเหมือนเดิม (deduct สำเร็จ = log ปกติ; สต็อกไม่พอ = block ปกติ); เคส CAS fail non-insufficient (เช่น RLS ปิด write ชั่วคราว) → เดิม "บันทึกแล้ว" + movement หลอก; ใหม่ → caller เห็น fail (toast "ตัดสต็อกล้มเหลว") + ไม่มี movement row. **Known risks:** ต่ำมาก — เปลี่ยน rare failure case ให้ honest (ok:false); callers เช็ค ok เดิม; ไม่กระทบ happy path. sibling in/return ยังเหลือ (noted ข้างบน, benign กว่าเพราะ stock-IN over-report = conservative).

**build 486 (Phase 486 — fetch sale_items on-demand: 6 consumers อ่าน state.saleItems ว่าง) [🔴 REPORTS · per-page audit B-1 · cross-cutting]:** **Baseline:** origin/main `56914cd` (build 485 live; tree สะอาด). **บั๊ก (per-page bug sweep 2026-06-18, verified):** `loadAllData` ไม่เคย assign `state.saleItems` (grep `state.saleItems =` = 0) แต่ **6 consumer** อ่านมัน → array ว่างเสมอ → รายงาน/KPI เป็น ฿0/ว่าง/0-ชิ้น เงียบ ๆ. **class เดียวกับ S1 dead_stock (478) + refunds (467)** ที่แก้ไป — เหลืออีก 6. **เนื้องาน — +`modules/sale_items_fetch.js` (read-only, mirror dead_stock fetch):** `fetchSaleItemsForSaleIds(saleIds)` (sale_id=in.() + chunk 100 + paginate 1000; empty→{ok:true,rows:[]} ไม่ยิง; fail→{ok:false,error} **ไม่ silent empty**), `fetchSaleItemsForProduct(productId)` (product_id=eq, paginate), `indexQtyByProduct(rows)` (pure Map(pid→{qty,revenue,name})). **แก้ 5 consumer ดึงสดจาก DB:** (1) `profit_by_product.js` — render เป็น **async** (loading→fetch→error/retry→aggregate) extract `_ppFilterBar`/`_ppBindFilters`/`_ppRenderBody`; ทั้งหน้าเคย ฿0; (2) `top_customers.js` — async, fetch saleItems ของ sales ในช่วง → qty column + sort-by-qty; fail→qty 0 + toast เตือน (ยังโชว์ยอดเงิน); (3) `dashboard.js` Top5 — **lazy-fill** `#dashTopSellers` (ไม่ทำทั้ง dashboard async; fetch recentSales→indexQtyByProduct→patch; fail→"โหลดไม่สำเร็จ"); (4) `main.js` `_renderProductRecentActivity` — async per-product fetch + **stale-guard** (`el.dataset.activityPid`) กันเปิด drawer สินค้าอื่นทับ; (5) `serials.js` `#srSale` change — async per-bill fetch auto-fill ชื่อสินค้า. **⚠️ เลื่อน 1 consumer (deliberate, documented):** `products.js:1044` turnover hint (`≈Ndays` badge) — อยู่ใน `renderProductItem` (sync, **4+ call-site** [list/search re-render], อยู่ใน products-list render ที่เพิ่ง harden 477-485) → lazy-fill เสี่ยง regression สูง/ค่าต่ำ → **follow-up phase แยก** (badge นี้ silently absent อยู่แล้ว = ไม่ regress; guard track ไว้). **⚠️ คงข้อจำกัด (ไม่แก้ใน phase นี้):** range-aggregate (profit_by_product/top_customers/dashboard) ยัง derive saleIds จาก `state.sales` ที่ **cap 50** → ผลยังจำกัด ≤50 บิลล่าสุด (= finding S-5, follow-up; เท่า profit_report เดิม ไม่ regress). **🔴 guard:** +`tests/sale_items_fetch_guard.test.js` (15: pure indexQtyByProduct 4 + behavioral fetch [empty→no-request/in.()/HTTP-fail→ok:false/non-array→ok:false/no-config→ok:false] 6 + source: 5 consumer ไม่มี `(state.saleItems` + ใช้ helper + import; residual track products.js). **❌ ไม่แตะ:** `loadAllData` (★ ไม่โหลด sale_items เข้า state กลาง = cap/perf) · `state.sales` cap (S-5) · checkout/`_deductStockForSaleItem`/JV/auto_post · pos.js · SQL/schema/RLS (sale_items อ่านได้ผ่าน RLS เดิม). **bump 485→486 ครบ** (data-app-build + 4×?v= + sw cache-v486 + comment; data-app-version 5.69.8→**5.69.9** + package **5.69.9**; e2e build-sync 12-14 เขียว). **ไฟล์ (8 + 2 ใหม่):** modules/{profit_by_product,top_customers,dashboard,serials}.js · main.js · index.html · sw.js · package.json · **+modules/sale_items_fetch.js** · **+tests/sale_items_fetch_guard.test.js** · tests/dashboard_readonly_guard.test.js (485→486) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1919/1919** (+13) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-486-fetch-saleitems` (ฐาน origin/main `56914cd`=build 485) — **รอ owner smoke + Codex review (ยังไม่ push main).** **owner smoke (preview · visual):** (1) หน้า "กำไรต่อสินค้า" → เห็นตัวเลขจริง (ไม่ ฿0 ทั้งหน้า) + สลับช่วง/เรียง ทำงาน; (2) Dashboard → การ์ด "Top 5 ขายดี 30 วัน" มีสินค้าจริง (โหลดแวบนึง); (3) Top customers → คอลัมน์จำนวนชิ้น > 0 + sort-by-qty ได้; (4) เปิด drawer สินค้า → "ประวัติการเคลื่อนไหว" เห็นสถิติขาย; (5) เพิ่ม Serial → เลือกบิล → auto-fill ชื่อสินค้า; (6) ตัดเน็ต/fetch ล้ม → เห็น "โหลดไม่สำเร็จ/ลองใหม่" ไม่ใช่ "ไม่มีของขาย". **Known risks:** (1) range-aggregate ยัง cap 50 (S-5 follow-up); (2) products turnover badge ยัง absent (deferred); (3) sale_items chunk 100/paginate 1000 — บิลเยอะมากในช่วงกว้าง = หลาย request (report เปิดไม่บ่อย); (4) dashboard/serials/product-drawer = lazy/async → ถ้าออกหน้าระหว่างโหลด มี stale-guard กันแล้ว.

**build 487 (Phase 487 — accountant SoD: ปิด client-gate ที่ row-status dropdown) [🔴 SECURITY §4.4 SoD · per-page audit B-2]:** **Baseline:** origin/main `e1e6cc4` (build 486 live; tree สะอาด). **บั๊ก (per-page sweep B-2, verified อ่านโค้ดจริง):** role `accountant` (= สำนักงานบัญชีภายนอก, ออกแบบ read-only ตาม SoD — memory `project_accountant_role`) **bypass client gate ผ่าน "row-status dropdown"** ของ receipts/quotations/delivery_invoices. `_denyWriteForAccountant()` ถูกเรียกที่ปุ่ม bulk/preview/saveFull/convertToReceipt แต่ **ไม่ครอบ dropdown change handler** (receipts.js:514 `.rc-status-select`, quotations.js:484 `.qt-status-select`, delivery_invoices.js:436 `.di-status-select`) → accountant กด `paid` (PATCH + `postJournalForReceipt` ลง JV รายได้จริง), `cancelled` (void JV), `approved`/`convert`/`delete` ได้หมด. **test gap:** `accountant_doc_readonly_guard` เดิมนับจำนวน gate call-site เฉย ๆ ไม่ enumerate dropdown handler → เขียวทั้งที่ช่องเปิด. RLS write-deny (5b) ยัง optional (API ตรงเขียนได้ แต่ UI ควรกัน) → **client gate = ด่านจริง และรั่วตรง dropdown**. **เนื้องาน (5 จุด, surgical):** + `if (_denyWriteForAccountant()) { e.target.value=""; return; }` เป็นบรรทัดแรกของ change handler ทั้ง 3 dropdown + **defense-in-depth** `if (_denyWriteForAccountant()) return;` ใน `convertToDeliveryInvoice` (1297) + `deleteQuotation` (1250) — เพราะเรียกได้จากหลายทาง (dropdown/ฟอร์ม qtConvertFromForm/preview qtConvertBtn). `convertToReceipt` มี gate ภายในอยู่แล้ว (Phase 448). **🔴 guard:** ขยาย `accountant_doc_readonly_guard` — bump `minGuards` 6/3/5→**7/6/6**, count regex รวม braced form `{ ...return; }` (เดิมนับเฉพาะ bare `return;`), + test ใหม่ "row-status dropdown handler gates accountant FIRST" ทั้ง 3 module (lock ช่องที่เคยหลุด). **❌ ไม่แตะ:** logic เก็บเงิน/convert/void JV/`postJournalForReceipt` · RLS/SQL · role อื่น (admin/sales เขียนได้เหมือนเดิม). **bump 486→487 ครบ** (data-app-build + 4×?v= + sw cache-v487 + comment; data-app-version 5.69.9→**5.69.10** + package **5.69.10**; e2e build-sync 12-14 เขียว). **ไฟล์ (4):** modules/{receipts,quotations,delivery_invoices}.js · index.html · sw.js · package.json · tests/{accountant_doc_readonly,dashboard_readonly}_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1922/1922** (+3 dropdown-gate guards) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-487-accountant-dropdown-gate` (ฐาน origin/main `e1e6cc4`=build 486) — **รอ owner review (ยังไม่ push main).** **owner smoke:** login เป็น accountant → หน้าใบเสร็จ/ใบเสนอราคา/ใบส่งของ → กด dropdown สถานะแถว เลือก "เก็บเงิน/ยกเลิก/อนุมัติ/แปลง/ลบ" → **เด้ง toast "สำนักงานบัญชี — อ่านอย่างเดียว" + ไม่เกิด action** (dropdown reset); login เป็น admin/sales → ทำได้ปกติ. **Known risks:** ต่ำ — client gate (UX/SoD) ไม่ใช่ security boundary จริง (RLS คือด่าน DB; 5b RLS write-deny ยัง optional — API ตรงยังเขียนได้ ถ้าต้องการ hard-block ต้องเปิด RLS write-deny แยก = follow-up); การแก้นี้ปิด UI hole ที่ accountant เข้าถึงผ่านแอปจริง.

**build 488 (Phase 488 — Opening Balance idempotency: กัน OB ซ้อน → งบดุลเบิ้ล) [🟠 ACCOUNTING §4.3 · per-page audit S-3 · ก่อน go-live 1 ก.ค.]:** **Baseline:** origin/main `de992e4` (build 487 live; tree สะอาด). **บั๊ก (per-page sweep S-3, verified):** ฟอร์ม "ลงยอดยกมา" (`opening_balance.js _onSubmit`) กดบันทึกซ้ำ → สร้าง JV `doc_type=OB` ซ้อน → งบดุล/งบทดลอง (นับเฉพาะ `status=approved`) **นับซ้อน = เบิ้ลตั้งแต่วันแรก**. เดิม comment เคลม "กดปุ่มซ้ำได้ มี idempotency กัน" แต่ **ไม่จริง** — OB POST ไม่ใส่ `source_table`/`source_id` (unique partial index คุมแค่คู่นี้ — auto_post.js:13) + ไม่มี inflight guard ที่ปุ่ม (ต่างจาก backfill ที่มี `_running`). **เนื้องาน (opening_balance.js เท่านั้น):** (1) **inflight guard** — module-level `let _obSubmitting` + wrapper `_onSubmit` (`if(_obSubmitting)return; set flag; ปุ่ม disabled=true; try{await _onSubmitInner()} finally{flag=false; ปุ่ม disabled=false}`) ครอบ body เดิม (rename → `_onSubmitInner`, ไม่แตะข้างใน) → double-click/เน็ตช้า = no-op; binding ปุ่ม `obSubmitBtn` ยังชี้ wrapper เดิม. (2) **existence check** ก่อน POST (หลัง confirm/headers) — GET `journal_entries?doc_type=eq.OB&doc_date=eq.{ACCOUNTING_EFFECTIVE_DATE}&status=eq.approved` เจอ → `App.confirm` เตือน "มี OB อยู่แล้ว {docNo} — ลงซ้ำงบจะนับซ้อน, ลบใบเดิมก่อน" **proceed-to-confirm** (ยกเลิก → setStatus + return ไม่ POST); query ล้ม → ไม่บล็อก (inflight กัน double-click + กัน transient error ขวางการลง OB ใบแรก). (3) แก้ comment ที่หลอกให้ตรงจริง. **🔴 guard:** ขยาย `opening_balance_guard` (inflight flag + finally reset + `_onSubmitInner` + existence query approved + confirm-abort + ก่อน POST); ของเดิม (no native confirm/≥2 App.confirm/doc_type OB/docNoPrefix/effective-date import/missing-confirm guard) เขียวครบ (ไม่อ่อนลง). **❌ ไม่แตะ:** save semantics (`doc_type:"OB"`/docNoPrefix/POST entry+lines/Dr=Cr block/effective date) · COA/SQL/RLS · period-lock · field labels (414/415). **bump 487→488 ครบ** (data-app-build + 4×?v= + sw cache-v488 + comment; data-app-version 5.69.10→**5.69.11** + package **5.69.11**; e2e build-sync 12-14 เขียว). **ไฟล์ (3):** modules/accounting/opening_balance.js · index.html · sw.js · package.json · tests/{opening_balance,dashboard_readonly}_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1924/1924** (+2) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-488-ob-idempotency` (ฐาน origin/main `de992e4`=build 487) — **รอ owner review (ยังไม่ push main).** **owner smoke:** เปิดหน้า "ลงยอดยกมา" → กรอก + บันทึก → กดปุ่มรัว ๆ = บันทึกใบเดียว (ปุ่ม disable); ลองบันทึกอีกครั้งทั้งที่มี OB อยู่แล้ว → **เด้งเตือน "มี OB อยู่แล้ว {docNo}"** + ยกเลิกได้ (ไม่เกิดใบซ้อน); ลบใบเดิมในสมุดรายวันก่อน → ลงใหม่ผ่านปกติ. **Known risks:** (1) existence check นับเฉพาะ `status=approved` (voided OB ไม่เตือน — ถูกต้อง เพราะไม่กระทบ BS); (2) query ล้ม → ไม่บล็อก (fail-open — inflight guard ยังครอบ double-click; ความเสี่ยงเหลือ = OB เก่า + query ล้ม + user proceed = น้อยมาก); (3) ไม่ได้บังคับ hard-block ระดับ DB (ถ้าต้องการ = unique index บน doc_type=OB+doc_date ฝั่ง Supabase = follow-up). **🔵 owner action ก่อน go-live 1 ก.ค.:** ลบ OB placeholder (OB2026050001 — memory `project_opening_balance_placeholder`) ก่อนลง OB จริง; ตอนนี้ฟอร์มจะเตือนถ้ามีของเก่าค้าง.

**build 489 (Phase 489 — payroll expense-tag exact boundary: กันลบ expense ผิด id) [🔴 MONEY §4.1 · per-page audit S-2]:** **Baseline:** origin/main `05d99c2` (build 488 live; tree สะอาด). **บั๊ก (per-page sweep S-2, verified อ่านโค้ดจริง):** `_deletePayroll` ย้อนรายจ่ายเงินเดือนด้วย **blind DELETE** `DELETE /rest/v1/expenses?note=ilike.%#payroll-{id}%` (payroll.js:1362-1364) = **substring match** → ลบ payroll id=5 → `%#payroll-5%` โดน `#payroll-50/51/500…` ด้วย → **ลบรายจ่ายเงินเดือนของพนักงานคนอื่นทิ้ง = เงินจริงหาย** (เงื่อนไข: มี id ที่ขึ้นต้นชนกัน + ทั้งคู่มี salary expense — โอกาสน้อยแต่ data-loss จริง). create dup-check (`_createSalaryExpense`:1566) มี flaw เดียวกัน (read) → false "มีแล้ว" → **ข้ามไม่สร้าง expense ของ id 5** (รายจ่ายตกหล่น). **เนื้องาน — +`modules/payroll_tag.js` (pure):** `payrollTagMatches(note, id)` = regex `#payroll-{id}(?![0-9])` (มีขอบเขต — `#payroll-5` ≠ `#payroll-50`; position-independent ไม่ต้องเป็น suffix; id escaped). **payroll.js:** (1) delete-reverse → GET candidates (`expenses?select=id,note&note=ilike.%tag%`) → `.filter(payrollTagMatches(r.note, id))` → DELETE `expenses?id=in.(exactIds)` เฉพาะที่ตรงจริง (idempotent: 0 ตรง → reversedExpense=true; candidate fetch fail → ไม่ลบ + warn ไม่ throw); (2) create dup-check → `select=id,note` → `arr.some(payrollTagMatches(r.note, payroll.id))`. **backward-compat:** tag ที่ "เขียน" ลง note คงเดิม `#payroll-{id}` (ไม่ต้อง migrate ข้อมูลเก่า — เปลี่ยนแค่วิธี "match"). **🔴 guard:** +`tests/payroll_tag_guard.test.js` (pure 5≠50/500 / own-id / position-independent / string-id / empty→false + source: no blind DELETE-by-ilike, ใช้ id=in.()+payrollTagMatches ทั้ง delete+create); ปรับ `payroll.test.js` (delete-reverse assertion: blind ilike→fetch+filter+id=in.()). **❌ ไม่แตะ:** `canDeletePayroll` guard · CAS double-pay (433) · `total_amount` GENERATED · `voidJvForSource` · expense payload/`expense_tag` format ที่เขียน · edit-paid sync (= S-1 follow-up แยก). **bump 488→489 ครบ** (data-app-build + 4×?v= + sw cache-v489 + comment; data-app-version 5.69.11→**5.69.12** + package **5.69.12**; e2e build-sync 12-14 เขียว). **ไฟล์ (3 + 2 ใหม่):** modules/payroll.js · index.html · sw.js · package.json · **+modules/payroll_tag.js** · **+tests/payroll_tag_guard.test.js** · tests/{payroll,dashboard_readonly}.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1930/1930** (+7) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-489-payroll-tag-boundary` (ฐาน origin/main `05d99c2`=build 488) — **รอ owner review (ยังไม่ push main).** **owner smoke (จัดฉากยาก — ต้องมี id prefix collision):** (1) ลบ payroll ปกติ → expense ของคนนั้นหาย, คนอื่นอยู่ครบ; (2) [ถ้าจัดได้] มี payroll id 5 + 50 ที่จ่ายแล้วทั้งคู่ → ลบ id 5 → expense ของ id 50 **ยังอยู่** (เดิมหาย). **Known risks:** (1) candidate fetch ล้ม → ไม่ย้อน expense (reversedExpense=false, audit บันทึก) แต่ลบ payroll ต่อ (พฤติกรรมเดิม กัน expense orphan = warn ไม่ throw); (2) edit-paid-row ยังไม่ sync expense/JV (= S-1, follow-up แยก ไม่อยู่ scope นี้); (3) ความเสี่ยง data-loss เดิมต่ำ (ต้องชนกันพอดี) แต่ตอนนี้ปิดสนิท.

**build 490 (Phase 490 — cash_recon round2: กัน false "↓ ขาด ฿0.00") [🔵 MONEY §4.1 · per-page audit S-4 · low-risk]:** **Baseline:** origin/main `6584f07` (build 489 live; tree สะอาด). **บั๊ก (per-page sweep S-4, verified):** `renderCashReconPage` (cash_recon.js) คำนวณ `expected = openingCash + cashIn - cashOut - cashRefundOut` (cashIn/Out/Refund = ผลรวม `reduce` ของหลายบิล → float drift เช่น 0.1+0.2=0.300…04) + `diff = countedCash - expected` **ไม่ปัด 2 ตำแหน่ง** → `diff` อาจเป็น `-1e-13` → ไม่เข้า `diff === 0` แต่เข้า branch `diff < 0` ("ขาด") → UI โชว์ "↓ ขาด -฿0.00" (money() ปัดแสดงเป็น 0.00) **ทั้งที่นับตรงเป๊ะ** (countedCash = denomination exact) → เสียความเชื่อมั่นรายงานลิ้นชัก + ค่า `diff` ผิดถูก `localStorage.setItem` (L259/264). **เนื้องาน (cash_recon.js เท่านั้น, 4 บรรทัด):** import `round2` (utils.js มีอยู่แล้ว) + `expected = round2(...)`, `countedCash = round2(denomTotal>0?denomTotal:expectedCounted)`, `diff = round2(countedCash - expected)` → diff เป็น 2dp สะอาด → `diff === 0` / `> 0` / `< 0` (branch สี/ข้อความ/save/toast) เชื่อถือได้ทั้งหมด (ไม่ต้องแก้ branch — round2 ทำให้ drift→0 เป๊ะ). **🔴 guard:** ขยาย `cash_recon.test.js` (source-regex: import round2 + expected/countedCash/diff ปัด); pure `computeCashRecon` tests เดิม (TZ/payment-split/refund) เขียวครบ. **❌ ไม่แตะ:** `computeCashRecon` (pure data fn) · branch/สี/display/save semantics · DENOMINATIONS · refund subtract (92.12) · openingCash. **bump 489→490 ครบ** (data-app-build + 4×?v= + sw cache-v490 + comment; data-app-version 5.69.12→**5.69.13** + package **5.69.13**; e2e build-sync 12-14 เขียว). **ไฟล์ (3):** modules/cash_recon.js · index.html · sw.js · package.json · tests/{cash_recon,dashboard_readonly}.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1931/1931** (+1) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-490-cashrecon-round2` (ฐาน origin/main `6584f07`=build 489) — **รอ owner review (ยังไม่ push main).** **owner smoke:** เปิดหน้ากระทบยอด/ปิดลิ้นชัก วันที่มีบิลเงินสดหลายใบ (ที่ยอดควรตรง) → กรอกนับเงินให้ตรง expected → **โชว์ "✓ ตรงกัน ฿0.00"** ไม่ใช่ "↓ ขาด -฿0.00". **Known risks:** ต่ำมาก — round2 = helper เดิมใช้ทั่ว money math; เปลี่ยนแค่ค่ากลางการคำนวณ ไม่กระทบ logic อื่น.

**build 491 (Phase 491 — paid payroll row = edit note only: กันรายจ่าย/JV หลุด sync) [🔴 MONEY §4.1 · per-page audit S-1 · owner decision]:** **Baseline:** origin/main `f923436` (build 490 live; tree สะอาด). **บั๊ก (per-page sweep S-1, verified):** `_savePayroll` (payroll.js) PATCH `staff_payroll` ทั้ง payload **ทุก row รวมที่จ่ายแล้ว** (`paid_at != null`) — ปุ่ม "แก้" (row 542) เปิด modal ได้กับ paid row ไม่มี gate. แต่ save **ไม่แตะ** expense `#payroll-{id}` (ลงตอน mark-paid ผ่าน `_createSalaryExpense`) + JV งวด (`postPayrollPeriodJournal` Phase 447) → แก้ยอด paid row → `total_amount` (GENERATED) เปลี่ยน แต่ `expenses.amount` + period JV ค้างยอดเก่า = **เงินจริงไม่ตรงบัญชี**. **owner decision (AskUserQuestion):** เลือก **บล็อกแก้ยอด** (ไม่มี unpay fn; period JV = manual admin button อยู่แล้ว → re-post เองตามปกติ; delete ย้อน expense ถูกแล้ว 489). **เนื้องาน (payroll.js, 2 จุด):** (1) `_savePayroll` — `const patchBody = existing.paid_at ? { note: payload.note } : payload;` → paid row PATCH **เฉพาะ note** (financial fields ไม่ถูกส่ง → total_amount/expense/JV ไม่หลุด); row ยังไม่จ่าย → PATCH full payload เหมือนเดิม. (2) `_openPayrollModal` (หลัง save binding) — `if (payroll?.paid_at)` → disable ฟิลด์เงิน (prEmp/prDept/prDaysWorked/prDailyRate/prDailyToggle/prBase/prOT/prWel/prBonus/prCom/prDed; opacity 0.6) + แบนเนอร์ใน `prModalStatus` "🔒 จ่ายแล้ว — แก้ยอดไม่ได้, ลบรายการแล้วสร้างใหม่ (ระบบย้อนรายจ่าย + ลง JV งวดใหม่)". prNote ยังแก้ได้. **🔴 guard:** ขยาย `payroll.test.js` (source: paid→`patchBody = ... ? {note} : payload`; modal paid→disable financial inputs + locked banner); guards เดิม (canDeletePayroll/CAS/delete-reverse 489/total_amount GENERATED) เขียวครบ. **❌ ไม่แตะ:** mark-paid CAS double-pay (433) · `_deletePayroll` (489) · `total_amount` GENERATED · period JV post (447) · row ที่ยังไม่จ่าย (แก้ได้ครบเหมือนเดิม). **bump 490→491 ครบ** (data-app-build + 4×?v= + sw cache-v491 + comment; data-app-version 5.69.13→**5.69.14** + package **5.69.14**; e2e build-sync 12-14 เขียว). **ไฟล์ (3):** modules/payroll.js · index.html · sw.js · package.json · tests/{payroll,dashboard_readonly}.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1932/1932** (+1) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-491-payroll-paid-edit-lock` (ฐาน origin/main `f923436`=build 490) — **รอ owner review (ยังไม่ push main).** **owner smoke:** เปิด "แก้" row เงินเดือนที่จ่ายแล้ว → ฟิลด์เงิน disable + แบนเนอร์ "🔒 จ่ายแล้ว"; แก้หมายเหตุ → บันทึกได้ (ยอดไม่เปลี่ยน); row ที่ยังไม่จ่าย → แก้ได้ครบเหมือนเดิม; ต้องการแก้ยอด paid → ลบ (ย้อนรายจ่าย) + สร้างใหม่ + admin re-post JV งวด. **Known risks:** (1) แก้ยอด paid ต้อง delete+recreate (ตั้งใจ — ตรงหลักบัญชี ไม่แก้ย้อนรายการที่จ่ายแล้ว); (2) period JV ยังต้อง admin re-post เองหลังแก้ใด ๆ ในงวด (เดิม — JV เป็น manual button, ไม่ auto); (3) ไม่มี unpay fn (ถ้า owner อยากได้ "ยกเลิกจ่าย" แทน delete = follow-up แยก).

**Phase 495 (SQL — profiles.role guard: CORRECTION + document live trigger + ลบตัวซ้ำ) [🟠 SECURITY §4.4 · DDL]:** **⚠️ CORRECTION:** audit รอบ2 #1 เคลมว่า profiles "ไม่มี trigger ล็อก role" = **ผิด** — verify จาก **repo SQL** ไม่เจอ แต่ **DB จริงมีอยู่แล้ว** (apply ตรงใน Supabase ไม่เคย commit): `guard_profile_role_update` BEFORE UPDATE ON profiles (ล็อก id เปลี่ยนไม่ได้ + role เปลี่ยนได้เฉพาะ `is_admin()`; raise "Only admins can change profile role" P0001). **exploit (PATCH role→admin) ถูกบล็อกอยู่ก่อนแล้ว** — owner test ยืนยัน (non-admin → P0001). บทเรียน: **DB trigger verify ที่ DB จริง ไม่ใช่ repo** (เพิ่ม verify-live ใน audit). **ที่เกิดขึ้น:** first attempt ผมเพิ่ม trigger ซ้ำ `trg_guard_profiles_role` + `guard_profiles_role()` (BEFORE INSERT/UPDATE) — ซ้ำบน UPDATE (ตัวเดิมยิงก่อนตามตัวอักษร → ของผมไม่เคยถูกพิสูจน์ + signup-bypass untested) + ผม `CREATE OR REPLACE is_admin()` (เป็นนิยามมาตรฐานถูกต้อง, test ผ่าน — ตัวเดิมก็ใช้ is_admin() นี้). **การแก้ (repo `supabase-phase495-profiles-role-lock.sql` เขียนใหม่):** (1) document ของจริงเข้า repo (idempotent CREATE OR REPLACE `is_admin()` + `guard_profile_role_update()` + trigger — ปิด gap จริง: control นี้ไม่เคยอยู่ใน version control) (2) **DROP block (owner รัน): `DROP TRIGGER trg_guard_profiles_role` + `DROP FUNCTION guard_profiles_role()`** ทิ้งตัวซ้ำ — **เก็บ is_admin()** (ตัวเดิม depend). **🛑 อย่า DROP is_admin()** (เคยให้คำสั่งผิด — จะทำ trigger เดิมพัง). **สถานะ:** ⏳ branch `claude/phase-495-profiles-role-lock` — owner รัน DROP block 2 บรรทัด (ส่วน CREATE OR REPLACE = live แล้ว ไม่ต้องรัน). **Gap ยังเปิด (แยก phase ถ้าต้องการ):** INSERT side ตัวเดิมไม่คุม (low risk — self-INSERT conflict + is_admin อ่าน row ตัวเอง); handle_new_user default role='sales' (over-privilege ตั้งต้น). **Verification (repo):** lint 0 · unit 1942 · e2e 14 · EOL LF (SQL+docs only). audit รอบ2 ที่เหลือ: #2 report 1000-cap (code), #3 je_insert arbitrary (SQL), #4 double-void (DB+code).

**[SUPERSEDED — กรอบเดิมก่อน correction]** Phase 495 (SQL-only — lock profiles.role กัน privilege escalation; audit รอบ2 #1 BLOCKING security) [🔴 SECURITY §4.4 · DDL — owner ต้องรันเอง]: **Baseline:** origin/main `cad8fca` (build 494; ไม่แตะ app/build — SQL ล้วน). **ช่องโหว่ (verified อ่าน source เอง):** policy เดียวบน `public.profiles` = `auth_all_profiles FOR ALL TO authenticated USING(true) WITH CHECK(true)` (supabase-rls-policies.sql:57-63) + **ไม่มี** `BEFORE UPDATE ON profiles` trigger เลย (grep ทั้ง repo=0) + `profiles_role_check` ยอมรับ 'admin'. → ใครที่ login (แม้ลูกค้า OTP) ยิง `PATCH /rest/v1/profiles?id=eq.<ตัวเอง>` body `{"role":"admin"}` ด้วย anon key+JWT ตัวเอง → WITH CHECK(true) ผ่าน → เป็น admin → ปลด is_accountant()/is_staff()/accounting RLS/สิทธิ์ทั้งระบบ. client `changeRole() requireAdmin()` = ไร้ผล (REST bypass). ตรง memory [[feedback-rls-column-lock]] (เคยทำ reviewer/approver แต่ลืม profiles.role). **lifecycle ที่ verify ก่อนเขียน trigger (กันพัง signup):** `handle_new_user()` (AFTER INSERT auth.users, SECURITY DEFINER, role='sales' hardcoded ไม่ใช่จาก metadata) สร้าง profile ตอน signup โดย **auth.uid()=NULL** (auth-admin context ไม่มี request JWT) → bypass ได้; auth_otp.js client POST role='customer' (authenticated) = path ที่ guard. **เนื้องาน (`supabase-phase495-profiles-role-lock.sql`, idempotent):** (1) `is_admin()` SECURITY DEFINER STABLE (`role='admin' for auth.uid()`; mirror is_accountant; +GRANT authenticated); (2) `guard_profiles_role()` BEFORE INSERT/UPDATE trigger — **bypass ถ้า `auth.uid() IS NULL` (service/migration/handle_new_user) OR is_admin()**; non-admin authenticated: UPDATE→block ถ้า `NEW.role IS DISTINCT FROM OLD.role`, INSERT→block ถ้า `NEW.role <> 'customer'` (ERRCODE check_violation); (3) trigger `trg_guard_profiles_role`. ไฟล์มี VERIFY (a-d: trigger exists / exploit blocked 4xx / admin changeRole ยังได้ / signup ยังได้) + ROLLBACK. **❌ ไม่แตะ:** app code (changeRole UX คงเดิม) · handle_new_user (role='sales' default = แยกประเด็น, ดู Known) · is_accountant/other RLS · build markers (ไม่ deploy). **Verification (ฝั่ง repo):** lint 0 · unit 1942 · e2e 14 · EOL LF (ไม่มี JS change — รันยืนยันไม่พัง). **สถานะ:** ⏳ branch `claude/phase-495-profiles-role-lock` — **รอ owner review + 🔴 รัน SQL ใน Supabase เอง (ผมไม่รันแทน DDL)** แล้วทดสอบตาม VERIFY (a-d). **Known/bonus (แยก phase):** handle_new_user ตั้ง default role='sales' ให้ทุก auth user ใหม่ (รวมลูกค้า OTP ที่ client ตั้งใจให้ 'customer' แต่ ON CONFLICT DO NOTHING ทำให้ 'sales' ชนะ) = over-privilege ตั้งต้น ควร audit แยก (อาจเปลี่ยน default เป็น 'customer'); + audit รอบ2 ที่เหลือ: #2 report 1000-cap (code), #3 je_insert arbitrary (SQL คู่กับนี้), #4 double-void loyalty/stock (DB unique+code). **Known risks:** ถ้า auth.uid() ไม่ NULL ตอน handle_new_user (ต่าง env) อาจบล็อก signup → VERIFY (d) บังคับทดสอบ signup จริงก่อนถือว่าเสร็จ; rollback = DROP TRIGGER บรรทัดเดียว.

**Phase 498 (SQL-only — JE lines=header balance DB constraint; audit รอบ4 #A) [🔴 ACCOUNTING §4.3 · DDL owner รันเอง · ไม่ bump build]:** **Baseline:** origin/main `aa5c526` (build 497; tree clean; SQL+guard test ล้วน ไม่แตะ app/build). **บั๊ก (audit รอบ4 #A, verified อ่าน SQL+code เอง):** `je_balanced CHECK (total_debit=total_credit)` (phase88-accounting-foundation.sql:69) เช็คแค่ "หัวบิล" สองช่องเท่ากันเอง; `journal_lines` มีแค่ `line_one_side`/`line_no_neg` ต่อบรรทัด — **ไม่มี constraint/trigger** บังคับ `SUM(lines.debit)=SUM(credit)=header.total_debit/credit` → JV ที่ lines ว่าง/ไม่ตรงหัวบิล/Dr≠Cr commit หลุดที่ DB → TB Dr≠Cr / งบดุลไม่ดุล / P&L เพี้ยนเงียบ. สำคัญก่อน go-live 1ก.ค. **VERIFY-FIRST (อ่าน code จริงก่อนเขียน — ผิด=พัง auto_post ทั้งระบบ):** auto_post.js(:242,:295) + journal_form.js(:267,:300) โพสต์เป็น **2 transaction แยก** (TX1 POST journal_entries หัวบิลเดี่ยว `return=representation` → TX2 POST journal_lines **bulk array ครั้งเดียว**); auto_post lines-fail→rollback DELETE header(cascade), journal_form ไม่ rollback(=orphan,out-of-scope). → **ห้ามวาง constraint บน journal_entries** (reject หัวบิลทุกใบที่ TX1); ใช้ **CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED บน journal_lines** เช็คตอน COMMIT (lines ครบ+header committed แล้ว). **เนื้องาน (`supabase-phase498-je-lines-balance.sql`, idempotent, owner รัน):** STEP0a รายงาน JV เดิมที่ lines≠header/Dr≠Cr + STEP0b orphan header (trigger ไม่ย้อนปฏิเสธของเก่า) → STEP1 `enforce_je_lines_balance()` (header NOT FOUND→RETURN NULL [void cascade ข้าม]; SUM lines; raise check_violation ถ้า Dr≠Cr หรือ lines≠header; NUMERIC(14,2) exact) → STEP2 `trg_je_lines_balance` AFTER INS/UPD/DEL DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → NOTIFY pgrst → STEP3 negative test (DO block, expect raise). **🔴 guard:** +`tests/je_lines_balance_guard.test.js` (8 source-regex: function/constraint-trigger deferred/on journal_lines all-DML/NOT-FOUND skip/raise×2/sum-vs-header/NOTIFY + scope: ห้าม trigger บน journal_entries · ห้าม alter je_balanced · ห้ามแตะ RLS). **❌ ไม่แตะ:** JS runtime ใด ๆ (auto_post/journal_form/main) · je_balanced เดิม · period-lock trigger · je_insert/jl_insert RLS · build markers/cache. **ไม่ bump build (SQL-only).** **ไฟล์ (2):** +supabase-phase498-je-lines-balance.sql · +tests/je_lines_balance_guard.test.js (+CHANGELOG/HANDOFF/SESSION_START). **Verification (repo):** guard **8/8** · lint:errors **0** · unit **1959/1959** · ไม่มี JS runtime change → e2e ไม่กระทบ · EOL LF. **สถานะ:** ⏳ branch `claude/phase-498-je-lines-balance` — **รอ owner review + 🔴 รัน SQL เอง (STEP0 ก่อน — ถ้ามี JV violate/orphan ต้อง data-fix; แล้ว STEP1+2; STEP3 negative).** **Known risks/limitations:** (1) **orphan header** (entry ไม่มี lines) trigger กันไม่ได้ (header-first 2-TX) — คู่กับ journal_form rollback = phase แยก; (2) **exact NUMERIC(14,2) ไม่มี tolerance** — auto_post ปลอดภัย (splitSaleVatLines anchor total, audit รอบ4 verified 0 mismatch) แต่ถ้า path ใดส่ง header total เป็น float-drift / line >2 ทศนิยม จะถูก reject → ควรทำ round2-header (finding แยก) คู่กัน; (3) UPDATE ที่ย้าย line.entry_id ข้าม entry (ไม่มีใน flow) เช็คเฉพาะ NEW entry; (4) ของเก่า violate ไม่ถูกย้อนปฏิเสธ (STEP0 รายงานให้ owner). audit รอบ4 เหลือ: #C double-restock (#4b, schema change), #B je_insert (downgrade/skip).
**build 498 (Phase 498 — JV form number inputs keep focus: no full re-render) [🟢 ACCOUNTING form · UI/UX-only · LOW แต่ใช้จริง 1ก.ค.]:** **Baseline:** origin/main `aa5c526` (build 497; tree clean). **บั๊ก (verified อ่านโค้ดจริง):** `journal_form.js` handler ช่องเดบิต(187-193)/เครดิต(194-200) ผูก event `input` → เรียก `renderJournalFormPage(ctx)` ทุก keystroke → `container.innerHTML` สร้างใหม่ทั้งฟอร์ม → `<input>` ที่กำลังพิมพ์ถูกแทน → **focus หลุดหลังพิมพ์ 1 ตัว** + ทศนิยม ("10.5") พัง. handler desc(201-204) อัปเดต state เฉย ๆ ไม่ re-render = ต้นแบบที่ถูก. manual JV ใช้จริง 1ก.ค. **เนื้องาน (journal_form.js เท่านั้น):** (1) +pure export `computeJvTotals(lines)`→`{totalDebit,totalCredit,balanced}` + `jvBalStateHtml(...)` (single source ป้าย กัน drift); (2) +id `jvTotDr`/`jvTotCr`/`jvBalState` footer; (3) `_refreshSummary()` set textContent ยอดรวม + innerHTML ป้าย + toggle disabled/opacity 2 ปุ่ม — ไม่แตะ tbody/inputs; (4) handler เดบิต/เครดิต ลบ `renderJournalFormPage` → `_refreshSummary()` + เคลียร์ช่องตรงข้ามในจอ (line_one_side). **invariant คงครบ:** focus อยู่กับที่ · เดบิต>0→เครดิต=0 (state+จอ) · แถบรวม/ป้ายสด · ปุ่ม enable เฉพาะ balanced · add/del ยัง re-render. **❌ ไม่แตะ:** _save/validate/POST/2-TX · DB trigger 498 · period/effective-date · handler acct/desc/add/del · ฟอร์มอื่น/เงิน/บัญชี. **bump 497→498 ครบ** (data-app-build + 4×?v= + sw cache-v498 + comment; data-app-version 5.69.19→**5.69.20**; package.json คงเดิม). **ไฟล์ (5):** modules/accounting/journal_form.js · index.html · sw.js · +tests/jv_form_focus_guard.test.js (12: unit computeJvTotals 5 + guard 7) · tests/dashboard_readonly_guard.test.js (497→498) (+CHANGELOG/SESSION_START). **Verification:** guard 12/12 · lint:errors 0 · unit **1964/1964** · e2e **14/14** (build-sync เขียว) · EOL LF. **สถานะ:** ⏳ branch `claude/phase-498-jv-form-focus` — **รอ owner smoke + Codex review (ไม่ push main).** **owner smoke:** หน้า "บันทึกรายการบัญชีใหม่" → พิมพ์ "12345.67" เดบิตรวดเดียว (focus ไม่หลุด) → ใส่เครดิตอีกบรรทัด → ป้าย "✅ เดบิต=เครดิต" สด → "บันทึก+อนุมัติ" สำเร็จ; พิมพ์เดบิตทับบรรทัดที่มีเครดิต → เครดิตเคลียร์. **Known risks:** ต่ำมาก UI-only. ⚠️ แยก: ใน `supabase-phase498-je-lines-balance.sql` (อีก branch SQL) STEP3 negative-test `doc_type='TEST'` ชน CHECK + RAISE ก่อน COMMIT — owner flag ควรแก้ก่อน merge SQL phase นั้น.
**build 500 (Phase 500 — service-job stock TOCTOU: atomic claim ใน deduct/restore; audit #C-2) [🔴 MONEY/STOCK §4.2 · code+SQL · HIGH · sibling ของ #C]:** **Baseline:** main `eb2d734` (build 499 merged/live — #C เข้า main แล้ว ตาม precondition). **บั๊ก (audit #C-2):** `deductServiceJobStock`/`restoreServiceJobStock` (service_equipment.js) gate กันซ้ำเดิมอ่าน `job.note` จาก **memory** (ไม่ fetch สด ไม่ fail-closed) + เขียน marker แยกใน caller ทีหลัง = TOCTOU เดียวกับ #C → ปิด/ลบ/ยกเลิกงานเดียวกันพร้อมกัน 2 เครื่อง/2 tab → ตัด/คืนสต็อกซ้ำ. **เนื้องาน (service_equipment.js — ย้าย claim เข้า helper เอง → ทุก caller คุ้มครองพร้อมกัน):** +`_claimServiceJob`/`_releaseServiceJob` (raw fetch, mirror 499). (1) **deduct**: claim `PATCH service_jobs?id=eq.X&stock_deducted_at=is.null` body `{stock_deducted_at:now}` → ชนะ 1 row=ตัด / 0 row=`{deducted:false,skipped:true}` / error=`{deducted:false,claimError:true}` fail-closed; safety-net note-marker; ทุก item fail → release `stock_deducted_at:null`. (2) **restore**: claim รวมเงื่อนไข `stock_deducted_at=not.is.null&stock_reverted_at=is.null` (เคยตัด+ยังไม่คืน) → 0 row=skip (กัน phantom จากงานไม่เคยตัด + คืนซ้ำ); error=claimError; ทุก item fail → release `stock_reverted_at:null`. **PostgREST `not.is.null` = IS NOT NULL (standard).** **caller deduct (main.js:3052):** เพิ่ม `else if (ded.claimError)`→toast เตือน "ปิดงานแล้วแต่เช็ค/ตัดสต็อกไม่สำเร็จ" (เดิม deducted=false เงียบ) + all-fail toast. **restore 3 caller (main.js/service_jobs.js/ai_sales.js) ไม่ต้องแก้** (รับ skipped/claimError ได้: restored:false→ไม่แปะ marker; claimError→errors toast เดิม surface). **note-marker 2 ตัวยังเขียน** (display+safety-net). **🔴 SQL `supabase-phase500-service-job-stock-markers.sql` (owner รัน "ก่อน deploy"):** STEP0 count + 2×`ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS stock_deducted_at/stock_reverted_at`+NOTIFY + STEP2 backfill 2 marker (`[ตัดสต็อกแล้ว]`/`[คืนสต็อกแล้ว]`→now()) + STEP3 RLS verify-note. **❌ ไม่แตะ:** `deductEquipmentStock`/`_appApplyStockMovement` (CAS/floor)/Phase 482 model/optimistic · `xhrPatch`/`_appXhrPatch` เดิม · POS `_revertStockForSale` (#C). **bump 499→500 ครบ** (data-app-build+4×?v=+sw cache-v500+comment; data-app-version 5.69.21→**5.69.22**; package คงเดิม). **ไฟล์ (3+1 SQL):** modules/service_equipment.js · main.js · index.html · sw.js · **+tests/service_job_stock_claim_guard.test.js** (9) · **+supabase-phase500-*.sql** · ปรับ behavioral guard เดิม (service_equipment_deduct_on_close/service_job_cancel_restore: mock +SUPABASE_CONFIG/fetch claim + job.id; idempotent→claim 0-row — invariant loop เดิมคงไว้) + service_job_equipment (drop `fetch(` จาก forbidden — claim fetch ไป service_jobs ไม่ใช่ warehouse_stock) · dashboard_readonly (499→500) (+CHANGELOG/SESSION_START). **Verification:** guard ใหม่ 9/9 + service guards เขียวครบ · lint:errors 0 · unit **1987/1987** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-500-service-job-stock-claim` — **รอ owner review + 🔴 รัน SQL "ก่อน deploy".** **owner smoke (preview):** (1) ปิดงานช่างมีอุปกรณ์ → สต็อกลด 1 เท่า + `stock_deducted_at` set; ปิด/บันทึกซ้ำ → ไม่ตัดเพิ่ม; (2) ยกเลิก/ลบงาน 2 tab พร้อมกัน → คืนครั้งเดียว; (3) งานเพิ่มอุปกรณ์แต่ไม่ปิด → ยกเลิก → ไม่คืน (ไม่ phantom). **🔴 Known risks:** (1) **deploy ordering** — deploy code ก่อนรัน SQL = ปิดงานได้แต่ไม่ตัดสต็อก/ลบได้แต่ไม่คืน (fail-closed+toast) จนรัน ALTER; (2) ไม่ backfill = ตัด/คืนงานเก่าซ้ำ (safety-net note ช่วยชั้นหนึ่ง); (3) crash-mid → claim ค้าง ไม่ auto-retry (admin แก้มือ); (4) `ai_sales` order ไม่มี items_json = no-op (latent, ไม่ทำพัง).

**build 499 (Phase 499 — double-restock TOCTOU: atomic claim sales.stock_reverted_at; audit #C / #4b) [🔴 MONEY/STOCK §4.2 · code+SQL · HIGH]:** **Baseline:** origin/main `aa5c526` (build 497; tree clean; เว้น build 498 = jv-form branch แยก). **บั๊ก (audit #C, verified):** ลบบิล POS → `_revertStockForSale` (main.js) gate กันคืนซ้ำเดิม (Phase 410) = read-then-write (GET `sales.note`→เช็ค `[คืนสต็อกแล้ว]`→...→แปะ marker ตอนจบ) = **TOCTOU**: ลบบิลเดียวกัน "พร้อมกัน 2 เครื่อง/2 tab" → ผ่าน gate ทั้งคู่ → restock ทั้งคู่ → **สต็อกพองเกินจริง (oversell)**; CAS กัน lost-update แต่ไม่กัน double-execution. **เนื้องาน (main.js `_revertStockForSale` only):** (1) gate ใหม่ = **atomic claim** raw fetch PATCH `sales?id=eq.X&stock_reverted_at=is.null&select=id,note` body `{stock_reverted_at:now}` `return=representation` → ชนะ 1 row (เดินหน้า) / แพ้ **0 row→skip** `{ok:true,reverted:0,skipped:true,errors:[]}` / HTTP!ok·bad-response·exception → **fail-closed** `{ok:false}`; **safety-net** เช็ค note-marker หลังชนะ claim (เผื่อ ALTER แล้วยังไม่ backfill). (2) **ไม่ใช้ xhrPatch** (0-row=error ใช้ทำ claim ไม่ได้) — raw fetch คุม 0/1/error เอง. (3) `_releaseClaim()` (PATCH `stock_reverted_at:null`) เมื่อ **เคลมแล้วไม่ได้คืนอะไรเลย**: revertedCount===0 + items-fetch!ok + exception-ก่อนคืน → retry ได้ (กัน transient บล็อกถาวร = regression ที่ verify-first จับ); partial/crash (revertedCount>0) → **คง claim** กัน retry คืนซ้ำ (admin แก้มือ). (4) `revertedCount` ย้าย function scope (catch อ่านได้). **note-marker `_STOCK_RETURNED_MARKER` ยังแปะตอนจบ** (ai_sales/service อ่าน note). **return shape `{ok,reverted,errors}` เดิม** (caller sales.js:285 เข้ากันได้). **🔴 SQL `supabase-phase499-sales-stock-reverted-at.sql` (owner รัน "ก่อน deploy"):** STEP0 count + STEP1 `ALTER TABLE sales ADD COLUMN IF NOT EXISTS stock_reverted_at timestamptz`+NOTIFY + STEP2 **backfill** `UPDATE ... SET stock_reverted_at=now() WHERE note ILIKE '%[คืนสต็อกแล้ว]%' AND stock_reverted_at IS NULL` + STEP3 RLS note (row-level policy เดิมครอบ — verify `pg_policies` ไม่เขียนใหม่). **❌ ไม่แตะ:** restock loop/CAS `_atomicAddStock`/`takeRestockQty`(483)/`expandBundleForRevert`(477)/return shape · `xhrPatch`/`xhrPost` เดิม · note-marker contract · `restoreServiceJobStock` (=audit #C-2 แยก). **bump 497→499 ครบ** (เว้น 498; data-app-build+4×?v=+sw cache-v499+comment; data-app-version 5.69.19→**5.69.21**; package คงเดิม). **ไฟล์ (4+1 SQL):** main.js · index.html · sw.js · **+tests/double_restock_claim_guard.test.js** (7) · **+supabase-phase499-*.sql** · tests/revert_stock_cas_guard.test.js (gate→claim, fail-closed×3 คงเดิม) · dashboard_readonly (497→499) (+CHANGELOG/SESSION_START). **Verification:** guard 7/7 + revert group 49/49 · lint:errors 0 · unit **1959/1959** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-499-double-restock-claim` — **รอ owner review + 🔴 รัน SQL "ก่อน deploy".** **owner smoke (preview):** ลบบิลทดสอบ → สต็อกคืน 1 เท่า + `stock_reverted_at` ถูกเซ็ต; ลบซ้ำ/2 tab → ครั้งที่ 2 skip. **🔴 Known risks:** (1) **deploy ordering** — deploy code ก่อนรัน SQL = ลบบิลได้แต่ไม่คืนสต็อก (fail-closed+toast) จนรัน ALTER → ต้องรัน SQL ก่อน/พร้อม merge; (2) ไม่ backfill = ลบบิลเก่าซ้ำ→restock ซ้ำ (safety-net note ช่วยชั้นหนึ่ง, backfill=ด่านหลัก); (3) crash-mid → claim ค้าง ไม่ auto-retry (admin แก้มือ — ดีกว่าเดิม); (4) #C-2 service-job restock ยังไม่แก้.

**build 497 (Phase 497 — #4a loyalty reverse idempotent: DB unique กัน double point-reversal; audit รอบ2 #4a) [🟠 LOYALTY/MONEY §4.1 · code+SQL]:** **Baseline:** origin/main `8517391` (build 496). **บั๊ก (audit รอบ2 #4a, verified code+DB):** void/refund บิล → `reverseEarnedPointsForSale` (loyalty.js) คืนแต้มโดย insert `redeem`/`ref_type='sale_reverse'`/`ref_id=saleId`; idempotency = **cache-only** (`hasReversedLoyaltyForSale` อ่าน `state.loyaltyPoints`) + **ไม่มี DB unique** (verified live: loyalty_points มีแค่ `loyalty_points_pkey`; ไม่มี trigger บน sales/loyalty; ไม่มี revert column — ต่างจาก #1/#3 ที่มี out-of-band) → void บิลเดียวกัน 2 แท็บ/เครื่อง (หรือ double-click ก่อน loadAllData refresh cache) = ผ่าน cache check ทั้งคู่ → insert 2 sale_reverse → **คืนแต้ม 2 เท่า** (balance ติดลบได้; cap คิดจาก stale cache ด้วย). **เนื้องาน:** (1) **SQL owner รัน** `supabase-phase497-loyalty-reverse-unique.sql` — STEP0 dup-check (ต้อง 0 ก่อน; ถ้ามี = double-void เกิดแล้ว → STEP0b dedup keep MIN(id)) → `CREATE UNIQUE INDEX uq_loyalty_sale_reverse ON loyalty_points(ref_id) WHERE ref_type='sale_reverse'`; (2) `loyalty.js` — POST ล้มด้วย `code==='23505'` หรือ msg duplicate/uq_loyalty_sale_reverse → `{skipped:true,'already reversed (db unique — concurrent void)'}` (idempotent ไม่ใช่ error; cache check ยัง fast-path; first reverse สำเร็จ cap ถูก, second โดน unique→skip → ไม่ double); (3) `api.js` xhrPost error object +`code`(PG code จาก parsed.code)+`status`(xhr.status) — กัน string-match เปราะ (backward-compat: เดิมมีแค่ message). **🔴 guard:** ขยาย `loyalty_reverse_sale.test.js` (+3: 23505→skip not error / non-unique 42501→fail [ไม่กลืน] / source api.js surface code+status); 22 test เดิมเขียว. **❌ ไม่แตะ:** cap logic · refund over-refund guard (92.61b) · earn path · **stock-revert (=#4b แยก** — note RMW main.js:3494-3501 ทำ atomic ผ่าน PostgREST ไม่ได้ → ต้อง column `stock_reverted_at` + claim-first restructure + schema change). **bump 496→497 ครบ** (5.69.18→**5.69.19**; e2e build-sync เขียว). **ไฟล์ (2 code + 1 SQL):** modules/api.js · modules/loyalty.js · **+supabase-phase497-*.sql** · index/sw/package · tests/{loyalty_reverse_sale,dashboard_readonly}.test.js (+CHANGELOG/HANDOFF). **Verification:** lint 0 · unit **1952/1952** (+3) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-497-loyalty-reverse-unique` — **รอ owner review + 🔴 รัน SQL (STEP0 ก่อน CREATE INDEX — ถ้า dup มีต้อง dedup).** **owner smoke:** ลบบิลที่มีแต้ม 2 แท็บพร้อมกัน → คืนแต้มครั้งเดียว (แท็บที่ 2 = skip เงียบ ไม่ error/ไม่ double); ลบปกติ = คืนเหมือนเดิม. **Known risks:** ต่ำ — unique index = strict; ถ้ามี dup เก่า ต้อง dedup ก่อน (STEP0 บังคับเช็ค). audit รอบ2 เหลือ: **#4b stock double-restock** (atomic claim, schema change); #3 je_insert (low, ข้ามแล้ว — live whitelist + detective controls).

**build 496 (Phase 496 — accounting reports paginate JE/JL กัน 1000-row cap; audit รอบ2 #2) [🟠 ACCOUNTING §4.3 · verified code-only]:** **Baseline:** origin/main `cad8fca` (build 494; **495 SQL branch ยังไม่ merge** — 496 branch จาก main ไม่ชน build markers เพราะ 495 ไม่แตะ; ⚠️ แต่ทั้งคู่แตะ CHANGELOG/HANDOFF top → merge ตัวที่สอง rebase). **บั๊ก (audit รอบ2 #2, verified อ่าน code เอง):** TB/P&L/BS/period-summary/export-bundle aggregate `journal_entries`+`journal_lines` ด้วย raw `fetch()` **ไม่ paginate** (`journal_entries?select=id&...status=eq.approved` ไม่มี limit/offset) → PostgREST cap 1000 → JV>1000 ในช่วง = หล่นเงียบ → **TB Dr≠Cr / BS ไม่ดุล / P&L ต่ำกว่าจริง / ชุดส่งสรรพากรขาด** (latent: สะอาดตอน volume ต่ำ พังเมื่อโต; BS สะสมจาก 1ก.ค.=ข้าม 1000 ก่อน). periods.js ยัง `entry_id=in.(ids.join)` ทั้งหมด = URL ยาวด้วย. **เนื้องาน:** (1) +`fetchAllRowsRaw(urlFor,headers)` ใน fetch_paginated.js (raw-fetch paginate; urlFor ต้องมี &order stable; throw ไม่ truncate เงียบ); (2) +`modules/accounting/je_fetch.js` `fetchApprovedJournalLines(from,to,lineSelect)` (paginate entries order id.asc + chunk ids 200 + paginate lines/chunk order entry_id,line_no; no entries→[]); (3) TB/PL/BS/periods → helper (DRY; periods +entry_id → `jvCount=new Set(entry_id).size`; ลบ cfg/token/headers ที่ไม่ใช้); (4) export_bundle → fetchAllRowsRaw ×3. **🔴 guard:** +`tests/je_fetch_guard.test.js` (behavioral paginate/throw/empty + source 5 report ใช้ helper + ไม่มี raw uncapped fetch). **❌ ไม่แตะ:** auto_post/journal_form write · coa fetch (≤1000) · สูตร/display · status=eq.approved · periods readiness fetch (แยก). **bump 494→496** (เว้น 495 SQL phase; 5.69.17→**5.69.18**; e2e build-sync เขียว). **ไฟล์ (6+2):** fetch_paginated.js · accounting/{trial_balance,profit_loss,balance_sheet,periods,export_bundle}.js · **+accounting/je_fetch.js** · index/sw/package · **+tests/je_fetch_guard.test.js** · dashboard_readonly. **Verification:** lint 0 · unit **1949/1949** (+7) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-496-report-pagination` — **รอ owner review.** **owner smoke (latent ตอนนี้):** เปิดงบทดลอง/งบดุล/กำไรขาดทุน → ตัวเลขเท่าเดิม (JV<1000) ไม่ error; พิสูจน์เต็มต้อง JV>1000 (Dr=Cr ยังดุลหลังโต). **Known risks:** ต่ำ — paginate = superset (≤1000 เท่าเดิม); order keys verified มีจริง. audit รอบ2 เหลือ: #3 je_insert (SQL, verify DB จริงก่อน), #4 double-void (DB+code).

**build 494 (Phase 494 — `_applyStockMovement` in/return CAS-fail return ก่อน log; ปิด NIT-B = sibling ของ 485) [🟠 STOCK §4.2 · per-page audit NIT-B · low-risk]:** **Baseline:** origin/main `02f1bda` (build 493 live; tree สะอาด). **บั๊ก (audit NIT-B, verified อ่านโค้ดจริง build 493):** `_applyStockMovement` (main.js) เส้นทาง **in/return** (additive `_atomicAddStock`, L3765-3774) เมื่อ CAS ล้มแบบ non-insufficient (RLS/network/retry หมด) เดิม `console.warn` แล้ว**ไหลต่อ**ไป log `stock_movements` (L3804) ด้วย `after = before+delta` ที่ไม่เกิดจริง → movement หลอกว่ารับ/คืนแล้ว ทั้งที่ warehouse_stock ไม่ขยับ = reconcile noise (**over-report ฝั่งรับ**, conservative — ไม่อันตรายเท่าฝั่งขาย). **เป็น sibling ตรง ๆ ของ out-flow fix Phase 485** (NIT3) ที่ทำค้าง (485 แก้แค่ out/sale path L3759). **เนื้องาน (main.js, 1 branch):** else-branch (in/return) CAS fail → `console.warn(...(in/return)...) ; return { ok: false, error: dec.error || "ปรับสต็อกคลังไม่สำเร็จ (CAS)" }` ก่อน log (mirror 485). **🔴 guard:** ขยาย `apply_stock_movement_floor.test.js` (+test: in/return CAS-fail `console.warn (in/return) → return ok:false` + structural ก่อน `xhrPost("stock_movements")`); out/sale 485 guard เดิม + insufficient + no-row floor เขียวครบ. **❌ ไม่แตะ:** out/sale path (485) · insufficient early-return (465) · adjust CAS-guard (472) · no-row insert (in/return → xhrPost throw→outer catch→ok:false เดิม, ปลอดภัยอยู่แล้ว) · products.stock trigger-derived (403). **bump 493→494 ครบ** (data-app-version 5.69.16→**5.69.17** + package **5.69.17**; e2e build-sync เขียว). **ไฟล์ (1):** main.js · index.html · sw.js · package.json · tests/{apply_stock_movement_floor,dashboard_readonly}.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1942/1942** (+1) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-494-applystock-in-cas` (ฐาน `02f1bda`=build 493) — **รอ owner review (ยังไม่ push main).** **owner smoke:** ยาก trigger ตรง ๆ (ต้อง CAS fail) — เชิงพฤติกรรม: รับสต็อก/คืนสต็อกตอนเน็ตหลุด/RLS ปฏิเสธ → ได้ error (ไม่ใช่ "สำเร็จ" หลอก) + ไม่มี movement หลอกในประวัติ; รับ/คืนปกติ = ทำงานเหมือนเดิม. **Known risks:** ต่ำมาก — strict improvement (เดิม return ok:true + phantom log → ตอนนี้ return ok:false จริง); caller ที่ ignore result เดิมก็แค่ไม่ได้ phantom success. **🔵 audit NIT ตรวจครบ:** NIT-B = ตัวเดียวที่มี data-integrity angle (แก้ที่นี่); A (price scalar last-writer-wins, pos.js:1450) / C (count-adjust before-cache false-conflict, CAS-guarded 472, main.js:3732) / D (note ilike orderNo ไม่ anchored, ms-timestamp collision ~0, main.js:3347) = **benign จริง ปล่อยได้**; loyalty/serials = escHtml ครบ, journal_form period-lock = DB trigger บังคับ = ไม่ใช่บั๊ก. **🎉 per-page sweep 2026-06-18 ปิดสมบูรณ์ (486-494): B-1(6/6)·B-2·S-1..S-6·NIT-B — เหลือแค่ NIT benign.**

**build 492 (Phase 492 — range-reports fetch sales by date range, not capped state.sales) [🟠 REPORTS · per-page audit S-5 · stacked on 491]:** **Baseline:** stacked บน branch 491 (`58758ae`); origin/main = `f923436` (build 490). ⚠️ **build serialization:** 491 (payroll) + 492 (reports) แตะ build markers ทั้งคู่ → ต้อง merge ตามลำดับ (491 ก่อน 492, ff ทั้งคู่) หรือ merge 492 (รวม 491). **บั๊ก (per-page sweep S-5, verified):** `loadAllData` cap `state.sales` ที่ 50 (main.js:1141 `.limit(50)`). รายงานช่วงเวลา aggregate `state.sales` → ร้านขายเกิน 50 บิล/ช่วง = ตัวเลขต่ำกว่าจริงเงียบ ๆ นำเสนอเป็นยอดทั้งระบบ: `profit_report.js:75` (salesInRange กำไร/ต้นทุน) + `:322` (renderMonthlyTrend 6เดือน), `sales_heatmap.js:38` (matrix), `expenses.js:58/66` (รายรับ/กำไรเดือนนี้). **owner decision (AskUserQuestion):** ดึงจริงตามช่วง (ไม่ใช่แค่ติดป้าย). **เนื้องาน — +`modules/sales_fetch.js` (read-only, mirror dead_stock/486):** `fetchSalesSince(cutoffKey)` (GET `sales?created_at=gte.{cutoff−2วัน buffer}`; cutoffKey="" → ทั้งหมด; paginate 1000; fail→{ok:false} ไม่ silent empty) + `bufferedSince(cutoffKey, days=2)` (pure, TZ-safe superset — buffer ±2วันครอบ UTC/local boundary; caller คง client-filter เดิม slice/getTime). **แก้ 3 report:** (1) `profit_report` — `loadProfitReport` fetch `fetchSalesSince(fromDate)` ใช้ทั้ง `salesInRange` (L75) + ส่งเข้า `renderMonthlyTrend(...,_fetchedSales)` (param ใหม่ `salesRows`, fallback state.sales); + เปลี่ยน sale_items จาก raw `.in(saleIds)` → **`fetchSaleItemsForSaleIds` (486, chunk+paginate)** กัน URL ยาว/1000-cap เมื่อ saleIds มากหลังเลิก cap; fetch fail → toast เตือน; (2) `sales_heatmap` — render เป็น **async** (loading→fetch→error/retry→matrix จาก fetched) extract `_shFilterBar`/`_shBindFilters`/`_shRenderBody`; (3) `expenses` — **lazy-fill** `#expMonthIncome`/`#expProfitCard` (ไม่ทำทั้งหน้า async — render ใหญ่ 10+ call-site; IIFE +try/catch กัน lazy-fill throw รบกวน render test/prod). **🔴 guard:** +`tests/sales_fetch_guard.test.js` (pure bufferedSince + behavioral fetch [gte buffered / ""=all / HTTP fail→ok:false / non-array / no-config] + source: 3 report ใช้ fetchSalesSince + heatmap salesRows + profit_report chunked sale_items). **❌ ไม่แตะ:** `loadAllData` cap (state.sales ยังใช้ที่อื่น) · checkout/JV/SQL/RLS · `state.expenses` cap 200 (นอก S-5 — expenses lazy-fill เฉพาะฝั่งรายรับ sales; monthExpenses ยังจาก state). **bump 491→492 ครบ** (data-app-build + 4×?v= + sw cache-v492 + comment; data-app-version 5.69.14→**5.69.15** + package **5.69.15**; e2e build-sync 12-14 เขียว). **ไฟล์ (4 + 2 ใหม่):** modules/{profit_report,sales_heatmap,expenses}.js · index.html · sw.js · package.json · **+modules/sales_fetch.js** · **+tests/sales_fetch_guard.test.js** · tests/dashboard_readonly_guard.test.js (491→492) (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1941/1941** (+10) · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-492-sales-range-fetch` (stacked บน 491) — **รอ owner review + merge 491→492 ตามลำดับ (ยังไม่ push main).** **owner smoke (preview · ร้านที่ขายเกิน 50 บิล/ช่วง):** (1) "กำไรต่อช่วง" ช่วง year/all → ยอดขาย/กำไรสูงกว่าเดิม (เคยตัน 50 บิล); (2) Sales Heatmap → ช่อง heatmap เข้มขึ้น/ครบ (เคยเห็นแค่ 50 บิล); (3) หน้ารายจ่าย → การ์ด "รายรับเดือนนี้" = ยอดจริงทั้งเดือน; (4) ตัดเน็ต → "โหลดไม่สำเร็จ/ลองใหม่". **Known risks:** (1) ช่วงกว้าง (all/ปี) + บิลเยอะ = fetch หลายหน้า (paginate ครบ, report เปิดไม่บ่อย); (2) renderMonthlyTrend ยังกรองด้วย selected period (pre-existing — trend 6 เดือนเต็มต้อง period=year/all); (3) profit_report main range ใช้ getTime local (NIT เดิม) — buffer 2วันครอบ boundary แล้ว; (4) expenses monthExpenses ยัง cap 200 (นอก S-5).

**build 493 (Phase 493 — products turnover badge: lazy-fill จาก stock_movements; B-1 consumer ตัวที่ 6/6 — ปิดครบ) [🟢 REPORTS · per-page audit B-1 #6 · low-risk]:** **Baseline:** origin/main `96db346` (build 492 live; tree สะอาด). **บั๊ก (B-1 #6, deferred จาก 486):** badge "≈Nวันจะหมด" (stock turnover) ต่อ product row ใน `renderProductItem` อ่าน `state.saleItems` ที่ `loadAllData` **ไม่เคยโหลด** (ว่าง) → badge **ไม่เคยโชว์** (silent dead feature). consumer สุดท้ายของ B-1 (อีก 5 ตัวแก้ที่ 486); deferred เพราะอยู่ใน sync render. **เนื้องาน (products.js):** (1) turnover block (เดิมอ่าน state.sales+state.saleItems) → **placeholder** `<span class="prod-turnover" data-turnover-pid data-turnover-stock>` (เฉพาะ pType=stock & stock>0); (2) `_fillTurnoverHints(el)` หลัง `renderView` ตั้ง el.innerHTML (call-site เดียว — grid ทุก render ผ่าน renderView L344) → fetch `stock_movements?type=eq.sale&created_at=gte.{30วัน}&select=product_id,qty` (paginate, read-only) → **`indexQtyByProduct`** (reuse 486) sum qty/product → `daysLeft=floor(stock/(qty30/30))` → `span.outerHTML`=badge สี (<=7แดง/<=14ส้ม/เทา); fail/ไม่มีข้อมูล=เงียบ + `document.body?.contains?.(span)` กัน stale. ใช้ **stock_movements** (ไม่ใช่ sale_items) → bundle ลงใต้ child = turnover ตรงตัวที่กินสต็อกจริง. **🔴 guard:** `sale_items_fetch_guard.test.js` พลิก test "RESIDUAL→fixed" (products.js ไม่มี `(state.saleItems` + มี `_fillTurnoverHints` + `stock_movements?type=eq.sale` + placeholder); ทั้ง repo เหลือ `(state.saleItems` 0 จุดในโค้ด (เหลือ comment docstring). **❌ ไม่แตะ:** loadAllData/checkout/JV/SQL · getDisplayStock · list filter/search/pagination. **bump 492→493 ครบ** (data-app-version 5.69.15→**5.69.16** + package **5.69.16**; e2e build-sync เขียว). **ไฟล์ (2):** modules/products.js · index.html · sw.js · package.json · tests/{sale_items_fetch,dashboard_readonly}.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1941/1941** · e2e **14/14** · EOL LF. **สถานะ:** ⏳ branch `claude/phase-493-products-turnover` (ฐาน `96db346`=build 492) — **รอ owner review (ยังไม่ push main).** **owner smoke:** หน้าสินค้า (มีบิลขายสต็อก 30วัน) → badge "≈Nวัน" ขึ้นข้างสต็อก; ไม่มีขาย=ไม่มี badge; ตัดเน็ต=ไม่ crash. **Known risks:** ต่ำ — read-only decoration; turnover ใช้ display-stock (เลือกคลังเฉพาะ=วันจะหมดของคลังนั้น, intent OK). **🎉 per-page sweep ปิดครบ (486-493): B-1(6/6)·B-2·S-1..S-5 ทั้งหมด; เหลือแค่ NIT benign.**

**อัปเดตล่าสุด:** 16 มิถุนายน 2026 (Phase 453a acinstall-picker-warehouse — **build 453**, **SERVICE/UX — เลือกอุปกรณ์ติดตั้งแอร์ เลือกคลังก่อน**). **Baseline:** branch `claude/phase-453a-acinstall-picker-warehouse` จาก origin/main `b70db85` (build 451 live, Phase 451 merged; **Phase 452 equip-picker [งานแจ้งซ่อม] ยังค้างอีก branch → 453 ฐาน 451, gap build 452**). **เป้า (owner):** picker "เลือกอุปกรณ์" หน้า **ติดตั้งแอร์** (`_openItemPicker`, ac_install.js, modal `acItemPickerModal`) เพิ่ม "เลือกคลังก่อน" + กรองหมวด — กันสับสนสินค้าชื่อซ้ำข้ามคลัง. **🔴 STOCK PATH = UI picker เท่านั้น ไม่แตะ transfer/deduct.** *(คนละ picker กับ Phase 452 service_equipment.js — นั่นคือ drawer งานแจ้งซ่อม; นี่คือหน้าติดตั้งแอร์)* **เนื้องาน (ac_install.js ไฟล์เดียว, ไม่มี SQL):** ใน `_openItemPicker` (1) state `_acPickerWh="all"`/`_acPickerCat="all"` (2) `_acStockInWh(p,whId)` = รวม `_getMobileStocks` ที่ warehouse_id===whId + `_getHomeStock` ถ้า warehouse_id===whId; `_acBaseForWh()` = all→allInStock เดิม / else→product ที่ `_acStockInWh>0` (3) chips `#acpkWhChips` (ทุกคลัง + state.warehouses, is_mobile→🚐/📦) + dropdown `#acpkCat` (distinct หมวดใน base) — delegation บน container คงอยู่ (4) renderList: `_acBaseForWh`→filter `_acPickerCat`→search เดิม→slice 50; เลือกคลัง→กรอง mobileStocks/homeStock tag เหลือเฉพาะคลังนั้น (warningBadge "ยังไม่ได้โอนขึ้นรถ" คงตรรกะ inMobile) (5) click: `_acPickerWh!=="all"` → `mobileStocks.find(warehouse_id===_acPickerWh)` ใช้เลย / home wh → chosenWh=homeStock + toast เดิม / ไม่เจอ→fallback flow เดิม. all → flow เดิม (1 mobile auto / >1 `_pickMobileWarehouse` / home fallback). dedup + `_items.push`(warehouse_id/warehouse_name/_stock_avail) + transfer-on-save = เดิมทุกบรรทัด. **bump 451→453 ครบ** (data-app-version 5.69.1 · package 5.66.0 คงเดิม). **Guard:** +`ac_install_picker_guard.test.js` (7: _acPickerWh/Cat+chips/cat · _acStockInWh mobile+home+_acBaseForWh+_acPickerCat ก่อน slice · คลังเฉพาะ→mobileStocks.find มาก่อน _pickMobileWarehouse · ทุกคลัง→คง _pickMobileWarehouse+ไม่ลบ · _items.push contract · ❌ ไม่แตะ transfer/deduct/_applyStockMovement/no-write · คง toast บ้าน) · `dashboard_readonly_guard` 451→453. **ไฟล์ (6):** modules/ac_install.js · index.html · sw.js · +tests/ac_install_picker_guard.test.js · tests/dashboard_readonly_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1714/1714** (ac_stock_manager_guard + stock_cas เขียว) · e2e **14/14** · EOL LF · CI Tests เขียวบน branch. **❌ ไม่แตะ:** `_pickMobileWarehouse` · `_getMobileStocks`/`_getHomeStock` · auto-transfer บ้าน→รถ ตอน save · dedup · `_items.push` contract · save/deduct/`_applyStockMovement` · service_equipment.js (Phase 452) · **0 write** · ไม่ใช้ alert. **Known risks:** (1) chips อ่าน state.warehouses/warehouseStock — ไม่โหลด=ว่าง (ปกติโหลดแล้ว) (2) สินค้าไม่มีในคลังที่เลือก=ไม่อยู่ในลิสต์ (intended). **สถานะ:** ✅ **MERGED ff `3021d29` + LIVE build 453** (2026-06-16; ff ตรง base=main `b70db85`, owner smoke PASSED บนหน้าติดตั้งแอร์: เลือกคันแดง→list+tag เหลือคันเดียว→คลิกไม่เด้งถามคลัง→เพิ่ม 'จาก รถคันแดง', transfer/deduct ไม่แตะ, 0 write, console 0 error). ⚠️ smoke ไม่ได้ save (กันตัดสต็อกจริง) → เส้นทาง warehouse_id→deduct ตอน save พิสูจน์ตอน owner ทำใบจริงใบแรก (เช็คตัดถูกคัน). **แผนต่อ (ทุกหน้าบริการ ทีละไฟล์):** 453b service_form · 453c solar · 452 service_equipment(drawer แจ้งซ่อม — โค้ดเสร็จแล้ว, จะ rebase+bump build เป็น current+1 ตอน merge กันเลขถอย).

**ก่อนหน้า:** 16 มิถุนายน 2026 (Phase 451 stock-check-sheet — **build 451**, **PRODUCTS/UX — ใบเช็คสต็อก A4 พิมพ์ได้**). **Baseline:** branch `claude/phase-451-stock-check-sheet` จาก origin/main `1a610eb` (build 450 live, Phase 450 merged). **เป้า (owner):** ปุ่ม "พิมพ์ใบเช็คสต็อก" หน้าสินค้า/คลัง → เปิดหน้า A4 พิมพ์ เอาขึ้นรถ/เช็คคลังมือ: แยกหมวด · แถว = ลำดับ/ชื่อ+barcode/**QR**/คงเหลือ(ระบบ)/ช่อง "นับจริง" เขียนมือ. ขอบเขต = "ตามที่เห็นบนหน้าจอ" (คลัง+หมวด+filter). read-only ล้วน · ไม่มีราคา/ต้นทุน (stock-check ไม่ใช่ valuation; ช่างพิมพ์ได้). **เนื้องาน (ไม่มี SQL):** (1) **`modules/stock_check_sheet.js` (ใหม่, pure)** `buildStockCheckSheetHtml({warehouseName, dateStr, groups, shopName})` → HTML A4 (`@page A4`, toolbar ซ่อนตอน print, หัว=ชื่อร้าน+คลัง+วันที่+รวม N, ต่อหมวด=หัวข้อ+ตาราง #/ชื่อ(+barcode·SKU)/QR(`<img src=qrDataUrl>`)/คงเหลือ/นับจริง[ช่องว่าง]); escHtml ทุกค่า DB; `page-break-inside:avoid` ต่อแถว; ไม่มีคอลัมน์ราคา/ต้นทุน). (2) **`products.js` orchestrator `openStockCheckSheet(ctx)`:** base = `_currentWarehouseProducts(state)` (Phase 450 warehouse-aware) + filter ชุดเดียวกับ Export/generate (type/category/currentFilter/quickFilter/searchQuery) → เฉพาะ `detectProductType==="stock"` → sort ตาม currentSort → group ตามหมวด; **QR:** `loadQrLib()` (qrcodejs CDN เดิม, อยู่ใน CSP แล้ว) เรนเดอร์ใน hidden `<div>` ที่ parent แล้วดึง `canvas.toDataURL("image/png")` ฝังเป็น qrDataUrl (ไม่โหลด lib ในหน้าต่าง print — กัน async/CSP); barcode||sku ว่าง → qr ว่าง (placeholder ไม่ error); `getDisplayStock` = คงเหลือ; `window.open`+document.write+toolbar print (popup block → showToast เหมือน openBarcodePrintWindow). (3) ปุ่ม `id="prodStockSheetBtn"` "📋 พิมพ์ใบเช็คสต็อก" ในเมนูจัดการเพิ่มเติม (ข้าง พิมพ์บาร์โค้ด) + wire. **bump 450→451 ครบ** (data-app-version 5.69.1 คงเดิม · package 5.66.0 คงเดิม). **Guard:** +`stock_check_sheet_guard.test.js` (6: builder A4 หัวหมวด+แถว+นับจริง+คงเหลือ+QR img · ❌ ไม่มี ราคา/ต้นทุน/cost/฿ · XSS escape <script>/<img onerror> · groups ว่าง=empty state · ปุ่ม prodStockSheetBtn wire openStockCheckSheet+import · openStockCheckSheet read-only doesNotMatch XHR/fetch/PATCH/POST + ใช้ _currentWarehouseProducts+getDisplayStock+builder) · `dashboard_readonly_guard` 450→451. **ไฟล์ (6):** +modules/stock_check_sheet.js · modules/products.js · index.html · sw.js · +tests/stock_check_sheet_guard.test.js · tests/dashboard_readonly_guard.test.js (+CHANGELOG/HANDOFF). **Verification:** lint:errors 0 · unit **1699/1699** · e2e **14/14** · EOL LF · CI Tests เขียวบน branch. **❌ ไม่แตะ:** generate/print barcode (Phase 450) · openBarcodePrintWindow body · stock_count.js · getDisplayStock/warehouse_stock/products.stock (อ่านอย่างเดียว) · **0 write (ไม่มี XHR/fetch/PATCH/POST)** · ไม่ใช้ alert · ไม่เพิ่ม CDN (ใช้ qrcodejs เดิม). **Known risks:** (1) QR ใช้ `new QRCode → canvas.toDataURL` แบบ sync (qrcodejs draw sync) — owner ต้อง smoke ว่า QR ขึ้นจริงในใบ (ถ้า canvas ไม่ทัน/ลิบเปลี่ยน → fallback img.src) (2) สินค้าเยอะ → QR เยอะ = หน้าพิมพ์หนัก (ยังไม่ cap จำนวน) (3) popup-block → toast เตือน. **สถานะ:** ✅ **MERGED ff `be03e8d` + LIVE build 451** (2026-06-16; rebased onto `dc54f42` กัน collision, range-diff = + blob products/stock_check_sheet เหมือนเป๊ะ; owner smoke PASSED). **+commit barcode `47bb84a`:** เปลี่ยน QR → **แท่งบาร์โค้ด 1D** (เพิ่ม `loadBarcodeLib` = JsBarcode CDN jsdelivr เดิม; `barcodeDataUrlFor` = canvas `JsBarcode(...,{format:'CODE128',displayValue:true})`→`toDataURL`; คอลัมน์ 'บาร์โค้ด' แทน 'QR'; `loadQrLib` ฟังก์ชันคงไว้ไม่ลบ) + **เลขลำดับ # นับใหม่ 1,2,3 ต่อหมวด** (ย้าย idx ไปนับหลัง group). เหตุ: owner ส่วนมากใช้บาร์โค้ด 1D (สแกนเลเซอร์), QR ไม่ค่อยใช้. unit **1702** · guard `stock_check_sheet` 9 · smoke PASSED (73 แท่งบาร์โค้ด render จริง + เลขต่อหมวด [1,2,1,2..] + scope รถคันแดง + console 0 error).

**ก่อนหน้า:** 16 มิถุนายน 2026 (Phase 450 barcode-scope — **build 450**, **PRODUCTS/UX — สร้างบาร์โค้ดเลือกขอบเขตได้**). **Baseline:** branch `claude/phase-450-barcode-scope` จาก origin/main `a7d9354` (build 449 live; commit สุดท้ายเป็น API-only ไม่ bump build). **ปัญหา (owner):** ปุ่ม "🏷️ สร้างบาร์โค้ด" (หน้าสินค้า/คลัง) ยิงให้ทั้งแคตตาล็อกเสมอ — อยากเลือกขอบเขตได้: (1) ตามหมวด/หน้าที่กรอง (2) ติ๊กเลือกรายตัวผ่าน Bulk. **เนื้องาน (products.js ไฟล์เดียว, ไม่มี SQL):** (1) แยก helper กลาง `_generateBarcodesForProducts(ctx, list, scopeLabel)` (ย้าย XHR PATCH loop เดิมมาทั้งดุ้น — sequential await คงไว้, generateBarcodeEAN13 ต่อราย) — `targets = list.filter(type==="stock" && !barcode.trim())` → ถ้า 0 toast "ทุกตัว (scope) มีบาร์โค้ดแล้ว" · App.confirm นับ targets+scopeLabel · loop PATCH {barcode} · toast success/failed + loadAllData + renderView. (2) `generateAllBarcodes` เขียนใหม่ให้ "รู้ filter" — mirror ปุ่ม Export (currentTypeFilter/currentFilter/currentCategory/quickFilter/searchQuery เงื่อนไขชุดเดียวกัน): นับ target ใน filtered เทียบ all → ถ้า hasFilter && ต่างกัน → `_appConfirm("ตกลง=เฉพาะ N ที่กรอง / ยกเลิก=ทั้งหมด M")` เลือก scope · ไม่มี filter/เท่ากัน → all. (3) ปุ่ม bulk `id="prodBulkGenBarcodeBtn"` "🏷️ สร้างบาร์โค้ด" + handler: map `bulkSelected`→products→`_generateBarcodesForProducts(ctx, sel, "ที่เลือก N รายการ")` → clear+renderView. **bump 449→450 ครบ** (data-app-version 5.69.1 คงเดิม · package version 5.66.0 คงเดิม). **Guard:** +`products_barcode_scope_guard.test.js` (6: helper exist+กรอง stock&!barcode.trim() · helper doesNotMatch `_bulkPatchProducts` · generateAllBarcodes อ้าง currentCategory+quickFilter+_appConfirm · ปุ่ม prodBulkGenBarcodeBtn ผูก helper+bulkSelected · generateBarcodeEAN13 prefix 200+check digit คงเดิม) · `dashboard_readonly_guard` 449→450. **ไฟล์ (6):** modules/products.js · index.html · sw.js · +tests/products_barcode_scope_guard.test.js · tests/dashboard_readonly_guard.test.js · CHANGELOG/HANDOFF. **Verification:** lint:errors 0 · unit **1676/1676** · e2e **14/14** · EOL LF. **❌ ไม่แตะ:** barcode ที่มีค่าแล้ว (เฉพาะ !trim) · stock/price/cost/product_type/category/min_stock · checkout/pos/money · openBarcodePrintWindow/openBulkBarcodePrintModal (print แยกเรื่อง) · algorithm generateBarcodeEAN13. **Known risks:** (1) **batch barcode collision** — `generateBarcodeEAN13` = prefix200 + `Date.now().slice(-7)` + 2 random digits; ใน loop ที่ await XHR แต่ละรอบ (ช้ากว่า 1ms) Date.now ต่างกัน + random 0-99 → ชนยากแต่ไม่ 0% (ไม่มี uniqueness check; ไม่แก้ตาม scope — algorithm ห้ามแตะ) (2) ปุ่ม bulk clear+renderView แม้ user cancel confirm (ตาม pattern bulk เดิม) — minor UX. **สถานะ:** ✅ **MERGED ff `5bf756a` + LIVE build 450** (2026-06-16; rebased onto `7967c85` กัน collision, range-diff = ทุก commit, products.js blob เหมือนเป๊ะ; owner smoke PASSED). **ขยายจาก 1 → 5 commits:** (1) generate ตาม scope (2) **print ตาม scope** (`_printBarcodesWithScope` + `openBulkBarcodePrintModal(ctx, presetList)`) (3) **qty default = สต๊อกคลัง** (`_defaultQtyFor`/`getDisplayStock` warehouse-aware + แสดง 'คงเหลือ N') (4) **ปุ่ม '🖨️ พิมพ์บาร์โค้ดหมวดนี้'** (`prodCatPrintBtn` ข้าง QR หมวดนี้) (5) **FIX scope ตามคลัง** (`_currentWarehouseProducts` ใช้ 4 จุด renderView/generate/print/cat-print — กัน print/gen ดูดสินค้าข้ามคลัง [bug: คันแดง+งานดาวเทียม เห็น 2 แต่พิมพ์ 3]; คืน `[...products]` clone กัน `renderView.sort()` mutate `state.products`). unit **1692** · guard barcode **22** · e2e **14** · lint 0 · EOL LF.

**ก่อนหน้า:** 16 มิถุนายน 2026 (Phase 448 invite-set-password-persist — **build 449**, **AUTH/UX — หน้า "ตั้งรหัสผ่านใหม่" (เชิญทีมงาน) เด้งได้ทุกเครื่อง**) · onboarding fix. **Baseline:** branch `claude/distracted-bassi-860192` จาก origin/main `016a584` (build 447); **rebased บน `28ad037` (build 448 accountant-docs) → build ชน → เลื่อนเป็น 449** (data-app-version 5.69.0→5.69.1). **อาการ (owner):** เพิ่มทีมงาน → ผู้ถูกเชิญเปิดลิงก์แล้ว "ไม่ขึ้นให้ตั้งรหัสผ่าน แต่เด้งเข้าแอปเลย" (#customer_dashboard). **Diagnosis (verify สดผ่าน Chrome+Gmail บน build 447):** (1) `addNewUser` (main.js) = client signup(random pw)+`/recover` email; (2) อีเมลฉบับเดียว "Reset Your Password" → confirm-email OFF; (3) `redirect_to=https://boonsukair.com` = prod origin จริง (api_utils.js:33); (4) เดิม set-password เด้งจาก **live hash** `type=recovery` (main.js:948) อย่างเดียว → หายง่ายบนเครื่อง login ค้าง+SW cache → isRecovery=false → afterLogin → default route. **✅ พิสูจน์สด:** Incognito/เครื่องสะอาด = ขึ้นหน้าตั้งรหัสถูก → โค้ดไม่พัง แค่สัญญาณหาย. **Fix:** (1) `selfheal.js` (รันก่อน Supabase client) จับ `type=recovery` → `sessionStorage['bsk_pending_set_password']='1'` (2) `main.js` boot: `isRecovery = live hash || flag` + else-if(no session) เคลียร์ flag+_recoveryMode (กัน hijack token หมดอายุ) (3) SIGNED_OUT เคลียร์ flag (4) `auth_email.js` เคลียร์ตอน submit สำเร็จ + requestNewRecoveryLink. ทุก sessionStorage wrap try/catch. **ไม่ broaden regex.** **Guard:** +`invite_setpassword_persist_guard.test.js` (6) · `dashboard_readonly_guard` 448→449. **ไฟล์ (7):** selfheal.js · main.js · modules/auth_email.js · index.html · sw.js · tests/dashboard_readonly_guard.test.js · +tests/invite_setpassword_persist_guard.test.js. **Verification:** lint:errors 0 · unit **1665/1665** · e2e **14/14** · EOL LF · **preview smoke จริง (build 448→449) PASSED:** owner login preview → set flag + reload (ไม่มี hash) → เด้งหน้า "ตั้งรหัสผ่านใหม่" (recoveryMode=true) + cleanup กลับปกติ; no-session safety verified (flag เคลียร์). **❌ ไม่แตะ:** addNewUser signup/recover · regex เดิม · money/stock · RLS · accountant-docs (448a) · Supabase Site URL. **Workaround เดิม (ยังใช้ได้):** Supabase dashboard reset. **สถานะ:** rebased + resolved (build/CHANGELOG/HANDOFF ร่วมกับ 448a) → **merged to main**.

**ก่อนหน้า:** 15 มิถุนายน 2026 (Phase 448a accountant-doc-readonly — **build 448**, **AUTH/SoD — สำนักงานบัญชี read-only บนเอกสาร**) · Step 5 (read-only enforcement, owner เลือก "A"). **Baseline:** branch `claude/phase-448a-accountant-doc-readonly` จาก origin/main `016a584` (build 447 + daily-summary). **ปัญหา:** accountant (external) เปิดหน้า receipts/quotations/delivery_invoices (ROLE_PAGES) + ปุ่มเขียนไม่มี role gate (receipts.js ไม่มี role check) + RLS = `*` USING true → กด **ยกเลิก/ลบ/แก้/เก็บเงิน/แปลงเป็นใบเสร็จ** ได้จริง (ยกเลิกใบเสร็จ = void JV รายได้ด้วย) = ผิดหลักแยกหน้าที่ (SoD). **448a (client gate):** helper `_denyWriteForAccountant()` (เช็ค `window.App?.state?.profile?.role === "accountant"` → showToast + return true) ต่อ module + `if (_denyWriteForAccountant()) return;` ต้น write handler ทุกตัว — **receipts** (6: bulk-cancel/bulk-delete/collect/cancel/delete/edit-save) · **quotations** (3: bulk-cancel/bulk-delete/saveQuotationFull) · **delivery** (5: bulk-cancel/bulk-delete/delete/edit-save/convertToReceipt). อ่านอย่างเดียวยังทำได้ (เปิด/พิมพ์/export). **bump 447→448 ครบ** (data-app-version 5.69.0). **Guard:** +`accountant_doc_readonly_guard.test.js` (6: helper มี role-check+toast + นับ guard ≥ minGuards ต่อ module). **ไฟล์ (7):** receipts.js · quotations.js · delivery_invoices.js · index.html · sw.js · +accountant_doc_readonly_guard + dashboard_readonly_guard.test.js. **Verification:** lint:errors 0 · unit **1659/1659** · e2e **14/14** · EOL LF · guards served preview (receipts 6/quotations 3/delivery 5). **✅ MERGED = build 448 live** (2026-06-15, owner "merge ได้" — ff `d9edb04` · main Deploy success · live build 448 + receipts guards=7). **⚠️ 448a = client gate (UX) เท่านั้น — กัน path ผ่าน UI; API ตรงยังเขียนได้ (RLS receipts/quotations/delivery = `*` USING true).** **เหลือ 448b (RLS backstop, ถ้าต้องการ defense-in-depth):** `is_pure_accountant()` helper (≠ `is_accountant()` ที่รวม admin → ห้ามใช้ ไม่งั้น block admin) + RESTRICTIVE write-deny หลายตาราง (receipts/+receipt_items/quotations/+quotation_items/delivery_invoices/+delivery_invoice_items + je void path). blast radius เล็ก (กระทบเฉพาะ accountant แท้; admin/sales ไม่โดน) แต่ต้อง enumerate write target ครบ ไม่งั้นรั่ว.

**ก่อนหน้า:** 15 มิถุนายน 2026 (Phase 447a payroll-aggregate-jv — **build 447**, **MONEY/JV — เงินเดือนลงบัญชีเป็น JV ก้อนเดียวต่องวด**) · Step 3a จาก 4 (privacy สำนักงานบัญชี). **Baseline:** branch `claude/phase-447a-payroll-aggregate-jv` จาก origin/main `6502e1f` (build 446 live). **ปัญหา:** เงินเดือนรายคนรั่วถึง accountant 3 ทาง — #1 `staff_payroll` #2 `expenses`(salary) #3 JV; `je_select USING(is_accountant())` ทำให้ accountant (จาก 445) เห็น JV รายคน (Dr 5200 + ชื่อ + ยอด). **447a ปิด #3:** (1) +`postPayrollPeriodJournal(periodStart,periodEnd,opts)` (auto_post.js) — รวม staff_payroll ที่ paid ในงวด → JV ก้อนเดียว: Dr payroll_salary (5200) รวม / Cr แยกวิธีจ่าย (cash→credit_account_code 1110, transfer·cheque→1130), desc `"เงินเดือนพนักงาน — งวด {label}"` (ไม่มีชื่อ), `source_table="payroll_period"` + `source_id=YYYYMMDD(period_end)` BIGINT (idempotent ต่องวด), gated `_isAfterEffective` + balance/zero/period-lock ผ่าน `_postJournal`. admin-only → is_accountant()=true → je_insert ผ่าน (payroll_period ไม่ต้อง/ไม่ควรอยู่ใน non-admin whitelist; drift guard exclude แล้ว) (2) +pure `_buildPayrollPeriodLines(rows,mapping,desc)` (balance เป๊ะ: round2 ก่อนรวม) (3) ถอด per-person `postJournalForPayroll` ออกจาก `_markPaid` (payroll.js) — คง CAS PATCH + `_createSalaryExpense` (HR/operational) ไว้ (4) ปุ่ม admin "📒 ลงบัญชีงวดนี้" + handler `_postPayrollPeriodJV` (App.confirm + เตือนถ้าจ่ายไม่ครบงวด + inflight guard + audit `payroll_period_journal`/`payroll_journal_failed`) (5) backfill expenses ข้าม category salary/labor_hire/payroll (กัน double-count 5200) + ถอด payroll จาก INTEGRITY_CATS (กัน close-readiness orphan ลวง). **bump 446→447 ครบ** (data-app-version 5.66.0→5.68.0). **Guard:** +`payroll_aggregate_jv_guard.test.js` (7: behavioral money-math + source-regex wiring) · อัปเดต `payroll`/`payroll_pay_race`/`accounting_integrity_panel`/`auto_post` drift guard (ตรง design ใหม่). **ไฟล์ (12):** auto_post.js · payroll.js · backfill.js · index.html · sw.js · +payroll_aggregate_jv_guard + accounting_integrity_panel/auto_post/payroll/payroll_pay_race/dashboard_readonly_guard.test.js · +PHASE_447_SALARY_PRIVACY_SPEC.md. **Verification:** lint:errors 0 · unit **1652/1652** · e2e **14/14** · EOL LF · staged เฉพาะ 12 ไฟล์ผม. **✅ MERGED = build 447 live** (2026-06-15, owner "merge ได้" — ff, main CI Tests+Deploy success · live build 447 + postPayrollPeriodJournal=1 + _markPaid JV=0). **⚠️ co-merge:** commit `61b1216` (daily-summary read-only endpoint, author gangboo — functions/api/v1/+_middleware+guard) ค้างใน working tree → session อื่น commit บน branch ผม → ติดขึ้น main ด้วย (แยกไฟล์ ไม่ปน, CI เขียว). **⚠️ 447a ปิดแค่ #3 (JV) — accountant ยังเห็นเงินเดือนรายคนทาง #2 `expenses` (มีเมนูรายจ่าย = UI เห็น!) + #1 `staff_payroll` (API). ต้อง 447b (RLS) ถึงปิดครบ.** **✅ 447b DONE (SQL-only, applied 2026-06-15 โดย owner):** VERIFY-FIRST (pg_policy dump) พบ **privacy ครบแล้วหลัง 447a** — `staff_payroll` RLS = `payroll_admin_all`(admin) + `payroll_self_read`(self) → accountant อ่านของคนอื่นไม่ได้ · `expenses` = `expenses_admin`(is_sales_or_admin, **ไม่รวม accountant**) → บล็อก · is_sales_or_admin/is_staff ทั้งคู่ไม่รวม accountant. ∴ leak จริงทางเดียว = JV header (447a ปิด). **447b เลยเป็น "กลับด้าน":** accountant อ่าน operational เพื่อปิดงบไม่ได้ → +RLS read-only: `expenses_accountant_read` (is_accountant() AND COALESCE(category,'') NOT IN salary/labor_hire/payroll) + `customers_accountant_read` (is_accountant()). [sales/receipts/quotations/delivery_invoices/products อ่านได้อยู่แล้ว USING true]. ไฟล์ `supabase-phase447b-accountant-operational-read.sql` (record). **🎉 บทบาท สำนักงานบัญชี ครบ:** ปิดงบได้ (อ่าน journals/งบ/ขาย/ใบเสร็จ/รายจ่าย-non-salary/ลูกค้า) · ไม่เห็นเงินเดือนรายคน · ไม่จ่ายเงินเดือน/refund. **เหลือ (optional, step แยก):** read-only enforcement บน receipts/quotations/delivery_invoices (policy `*` USING true = authenticated เขียนได้) — จำกัด write accountant ต้องแก้ shared policy ทุก role = งานใหญ่ (UI gate ด้วย ROLE_PAGES/canManage อยู่แล้ว). **Known limitation 447a:** delete-paid-payroll ไม่ reverse period-aggregate JV · late-pay หลังกดปุ่ม = ไม่รวม (post ครั้งเดียว/งวด).

**ก่อนหน้า:** 14 มิถุนายน 2026 (Phase 446 accountant-external-scope — **build 446**, **AUTH/role — re-scope บทบาท accountant → สำนักงานบัญชีภายนอก**) · Step 1+2 จาก 4. **Baseline:** branch `claude/phase-446-accountant-external-scope` จาก origin/main `322e517` (build 444 live + 445 RLS record). **บริบท:** owner ยืนยัน บทบาท `accountant` = **สำนักงานบัญชีภายนอก** (มาปิดงบ + ส่งสรรพากรทุก 6 เดือน) ไม่ใช่พนักงานในร้าน → ไม่ควรเห็น/จ่ายเงินเดือนพนักงาน. **เนื้องาน (client-only, ไม่มี SQL):** (1) `ROLE_PAGES.accountant` (main.js) ตัด `payroll` · `payroll_overview` · `refunds` ออก (comment → "EXTERNAL accounting firm") (2) `ROLE_LABELS.accountant` "พนักงานบัญชี" → **"สำนักงานบัญชี"** (3) dropdown เพิ่มผู้ใช้ (index.html) + แก้ผู้ใช้ (modules/settings/users.js) label → "สำนักงานบัญชี". ค่า role ยังเป็น `'accountant'` (ไม่แตะ DB/RLS). **bump 444→446 ครบ** (445 = SQL-only ไม่มี app build). **Guard:** `accountant_role_guard.test.js` ย้าย `refunds`/`payroll`/`payroll_overview` includes→excludes + relabel "สำนักงานบัญชี" (3/3). **ไฟล์ (6):** main.js · index.html · modules/settings/users.js · sw.js · tests/accountant_role_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification:** lint:errors 0 · unit **1645/1645** · e2e **14/14** · EOL LF · commit เฉพาะ 6 ไฟล์ผม (ไม่ติด daily-summary ของ session อื่น). **❌ ไม่แตะ:** ROLE_PAGES role อื่น · RLS/DB (`is_accountant()` ยัง admin+accountant) · payroll runtime · accounting flow · daily-summary (session อื่น). **✅ MERGED = build 446 live** (2026-06-14, owner "merge ได้" — ff `ca56b2a` · CI Tests+Deploy success · curl prod build 446 + `ROLE_PAGES.accountant` grep payroll/refunds = 0). **เหลือ Step 3+4 (money/security → spec ก่อน, owner review):** Step 3 = RLS ซ่อนเงินเดือนรายคน (staff_payroll + per-person payroll JV) จาก accountant แต่คงยอดรวมเงินเดือนใน P&L · Step 4 = RLS read-only เอกสารปฏิบัติการ (receipts/sales/quotations) สำหรับ accountant.

**ก่อนหน้า:** 14 มิถุนายน 2026 (Phase C receipt-JV-bank-route — **build 443**, **MONEY/JV — ปิดฟีเจอร์กลุ่มลูกค้า→บัญชี**) · เฟสสุดท้าย Phase B/C. **Baseline:** branch `claude/phase-443-receipt-jv-bank-route` จาก origin/main `e933be4` (build 442 live). **เนื้องาน (auto_post.js จุดเดียว, ไม่มี SQL):** `postJournalForReceipt` — เพิ่ม pure helper `_resolveReceiptDebitAccount(candidate, mappingDefault, validCodes)` (exported, pure → unit-test ตรง) + ใน function: ถ้า `mappingKey==="receipt_revenue_transfer" && receipt.bank_coa_code` → validate ด้วย `_getValidCoaCodes()` (reuse sale_transfer 88.20/89.2) → valid/fail-open → debitAccount=bank_coa_code · invalid → fallback mapping.debit_account_code + console.warn + showToast. ใช้ `debitAccount` แทน `mapping.debit_account_code` ใน **ทั้ง 2 ชุด lines** (VAT-split + no-VAT). credit 4150 เดิม. **bump 443 ครบ.** **Guard:** +`receipt_bank_jv_guard.test.js` (7: behavioral pure resolver [1131→1131/1136→1136/9999→1130/empty=fail-open/null→default] + wiring [2 lines debitAccount, validate, ไม่มี `account_code: mapping.debit_account_code`, credit เดิม, ไม่ใช้ bank_label]). **ไฟล์ (5):** modules/accounting/auto_post.js · index.html · sw.js · +tests/receipt_bank_jv_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification:** lint 0 · unit **1637/1637** · e2e **14/14** · auto_post เดิม pass (ไม่ regress) · EOL LF. **❌ ไม่แตะ:** sale_transfer/service/expense 1130 (L489/549/625 — flow แยก ไม่มี customer-group) · mapping · credit 4150 · VAT split · status/effective/zero guards · balance · receipts/quotations/pos · RLS · ไม่มี SQL. **Known risks:** (1) JV เต็ม (โพสต์จริง) เกิดเฉพาะใบเสร็จ ≥ 1 ก.ค. (effective-date) → smoke จริง = Day-1/ซ้อมใหญ่ (2) transfer+ไม่มี bank → 1130 + warn (B2b เตือน UI ตอนเก็บเงินแล้ว) (3) ขาย/ช่าง/รายจ่าย ยัง 1130. **✅ MERGED = build 443 live** (2026-06-14, owner "merge ได้" — ff `34cec9a` · CI Tests+Deploy success · verified HTML prod 443). **Claude read-only verify preview (owner login):** COA จริง 67 บัญชี · 1131-1136 valid · `_resolveReceiptDebitAccount`: ราชการ1131→1131 · ติดตั้ง1136→1136 · bogus9999→1130 fallback · null→1130 (ไม่โพสต์ JV). **🎉 ปิดฟีเจอร์กลุ่มลูกค้า→บัญชีรับเงิน ครบทั้ง chain:** A(438 customer_group field) · B1(439 mapping settings+resolver) · B2a(440 carry+display 3 ใบ) · B2b(442 override+warn) · C(443 JV routing). flow: เลือกกลุ่มลูกค้า→ใบเสนอราคา auto บัญชี→carry ลงใบส่ง/ใบเสร็จ→แสดงพิมพ์→แก้/เตือนบนใบเสร็จ→ลง JV เข้าบัญชีถูกตัว. **เหลือ (optional/future):** JV smoke จริง Day-1 1 ก.ค. · auto_post per-bank ขาย/ช่าง/รายจ่าย (flow แยก) · multi-pay per-row bank · holder name ใน bank_label.

---

**Prev (442):** 14 มิถุนายน 2026 (Phase 442 (B2b) receipt-bank-override — **build 442**, **DOCUMENT/UX · ไม่แตะ JV**) · ครึ่งหลังของ B2 (B2a=carry+display แล้ว). **Baseline:** branch `claude/phase-442-receipt-bank-override` จาก origin/main `3b11249` (build 441 live). **เนื้องาน (receipts.js ไฟล์เดียว, ไม่มี SQL — column มาจาก B2a):** (1) `_openReceiptEditDrawer` (~L1063) เพิ่ม `<select id="rcEdBankCoa">` (จาก paymentInfo.banks filter coaCode, prefill r.bank_coa_code) + save payload (~L1084) snapshot `bank_label` จาก**บัญชีที่เลือก** (`.find(coaCode===_edBankCoa)` ไม่ re-derive — reviewer #3) + bank_coa_code. preview re-render โชว์ทันที. (2) helper `_confirmTransferBankSet(r)`: ถ้า transfer && !bank_coa_code → App.confirm เตือน (warn+proceed; ข้อความชัดว่าบัญชีในเอกสารว่าง + JV เฟส C ใช้ default) · ไม่ใช่โอน/มีบัญชี → true. wire **ก่อน** postJournalForReceipt 2 จุด: dropdown action paid (~L505) + preview rcPreviewCollect (~L797). single-bank only (payments[] per-row = future #5). **bump 442 ครบ.** **Guard:** +`receipt_bank_override_guard.test.js` (7: edit select+snapshot · helper warn-only-transfer-no-bank · **ordering warn ก่อน post ทั้ง 2 จุด** [indexOf region] · ไม่มี `|| "1130"` fallback · multi-pay note). **ไฟล์ (5):** modules/receipts.js · index.html · sw.js · +tests/receipt_bank_override_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification:** lint 0 · unit **1630/1630** · e2e **14/14** · EOL LF. **❌ ไม่แตะ:** auto_post/postJournalForReceipt/JV (Phase C — JV ยังลง 1130 จนกว่า C) · quotation/invoice (B2a) · เงิน/สต็อก · RLS · ไม่มี SQL. **Known risks:** (1) warn=warn+proceed (ไม่ block) ตาม owner เลือก "แก้ได้" (2) JV ยังลง 1130 จนกว่า C (3) warn ทริก live ไม่ได้ — ใบเสร็จโหลด 6 ใบ (เครดิต/เช็ค/เงินสด) ไม่มีโอน; guard ล็อก ordering แทน. **✅ MERGED = build 442 live** (2026-06-14, owner "merge ได้" หลัง smoke — ff `b12fb22` · CI Tests+Deploy success · verified HTML prod 442). **Claude smoke preview (login admin):** เปิดใบเสร็จ→แก้ไข→ #rcEdBankCoa 7 options (ว่าง+6 บัญชี ป้ายอ่านง่าย) มองเห็น prefill ว่าง · ปิดไม่ save · ไม่มี console error. **Next: Phase C** (build **443**, ปิดท้าย — **MONEY/JV ⚠️ ต้อง smoke JV จริง preview ก่อน merge**) — `postJournalForReceipt` (auto_post.js:652; mapping `receipt_revenue_transfer`=Dr 1130/Cr 4150) อ่าน receipt.bank_coa_code → โอน+มี bank → Dr <bank นั้น> แทน 1130 · โอน+ไม่มี → คง 1130 + log/warn (ไม่ silent) · เงินสด→1110 เดิม. acceptance: transfer+1132→Dr 1132 · cash→1110 · cancelled ไม่ post.

---

**Prev (441):** 14 มิถุนายน 2026 (Phase 441 customer-list-keep-page — **build 441**, **UX · ไม่แตะข้อมูล**) · owner รายงาน: แก้ไขลูกค้าหน้า 2 แล้ว save เด้งกลับหน้า 1 ทุกครั้ง (กวนตอนตั้งกลุ่มลูกค้าทีละหน้า). **Baseline:** branch `claude/phase-441-customer-list-keep-page` จาก origin/main `8bfd071` (build 440 live). **Root cause:** main.js:803 showRoute("customers")→renderCustomersPage · main.js:2272 saveCustomer→showRoute("customers") หลัง save → renderCustomersPage reset `currentPage=1`/searchQuery/currentFilter/currentGroupFilter ทุกครั้ง (bug pre-existing, เพิ่งกวนตอนตั้งกลุ่ม). **Fix:** ลบ reset ทั้ง 4 จาก `renderCustomersPage` (modules/customers.js) → จำสถานะ; `renderView` clamp `if(currentPage>totalPages)` อยู่แล้ว = stale page ปลอดภัย. **bump 441 ครบ.** **Guard:** +`customer_list_page_keep_guard.test.js` (2: renderCustomersPage body ไม่มี reset · renderView clamp ยังอยู่). **ไฟล์ (5):** modules/customers.js · index.html · sw.js · +tests/customer_list_page_keep_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification:** lint 0 · unit **1623/1623** · e2e **14/14** · EOL LF. **❌ ไม่แตะ:** เงิน/ข้อมูล/SQL/receipts/auto_post · filter/search handler ยัง reset page=1 ตอนเปลี่ยน filter (ถูกต้อง คงไว้). **พฤติกรรมใหม่:** สมุดรายชื่อจำหน้า/ค้นหา/ตัวกรอง ข้าม nav (เปิดแอปใหม่=default หน้า 1). **✅ MERGED = build 441 live** (2026-06-14, owner "merge ได้" — ff `6d2a938` · CI Tests+Deploy success · verified HTML prod 441 + fix served). preview 441 logged-out → interactive page-2 smoke ทำไม่ได้; fix deterministic + guard-locked. **Next: Phase B2b** (build **442**) — receipts.js `_openReceiptEditDrawer` (~L1010) bank picker override + PATCH bank_coa_code/bank_label + เตือนตอน status→paid (~L511/L800) ถ้า transfer แต่ไม่มี bank_coa_code (reviewer #4 ไม่ silent 1130). **Phase C** (build **443**) — postJournalForReceipt (auto_post.js:652) อ่าน receipt.bank_coa_code → Dr <bank> แทน 1130.

---

**Prev (440):** 14 มิถุนายน 2026 (Phase 440 (B2a) bank-on-doc-chain — **build 440**, **DOCUMENT/UX · ไม่แตะ JV — ใบเสร็จ auto-เติมบัญชีรับโอน**) · ต่อจาก B1 ตามแผน Phase B (กันออกใบเสร็จผิดบัญชีโอน). **Baseline:** branch `claude/phase-440-doc-bank` จาก origin/main `b66b7f5` (build 439 live). **B2 แยกเป็น 2 merge เพราะใหญ่/money-path: B2a (นี้)=resolve+carry+display · B2b (ถัดไป)=override บนใบเสร็จ+เตือน paid.** **เนื้องาน B2a:** (1) **SQL ใหม่ `supabase-phase440-doc-bank.sql` (owner รันแล้ว, verify 6 rows queryable):** +`bank_coa_code`+`bank_label` (text nullable) บน `quotations`/`delivery_invoices`/`receipts`. (2) **`modules/quotations.js`** import `resolveBankForCustomerGroup`; คลิกเลือกลูกค้าใน autocomplete (~L820) → resolve จาก `c.customer_group` → set `#qt_bankCoa`; เพิ่ม `<select id="qt_bankCoa">` (จาก paymentInfo.banks, prefill editDoc, แก้ได้); save snapshot `bank_label` จาก**บัญชีที่เลือก** (`.find(b=>b.coaCode===_bankCoa)` ไม่ re-derive จาก group — reviewer #3) + carry invoicePayload; quotation print แสดง `q.bank_label`. (3) **`modules/delivery_invoices.js`** receiptPayload carry + invoice print แสดง `inv.bank_label`. (4) **`modules/receipts.js`** doc-bank-line print เติม `r.bank_label` เมื่อ transfer (อ่านจาก row ไม่ live — reviewer #5). **bump 440 ครบ.** **Guard:** +`doc_bank_carry_guard.test.js` (7: SQL 6 col · quotation resolve+snapshot-from-selected+carry+print · invoice carry+print · receipt print row-snapshot+no-live-resolve · quotation no-postJournal [strip comment]). **ไฟล์ (8):** +supabase-phase440-doc-bank.sql · modules/quotations.js · modules/delivery_invoices.js · modules/receipts.js · index.html · sw.js · +tests/doc_bank_carry_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification:** lint 0 · unit **1621/1621** · e2e **14/14** · EOL LF · scope 8 ไฟล์ผม. **❌ ไม่แตะ:** auto_post/postJournalForReceipt/JV (Phase C) · receipt edit-override + paid-warn (B2b) · pos.js/POS lastReceipt · เงิน/ยอด/สต็อก · RLS. **Known risks:** (1) payload ส่ง bank cols เสมอ → SQL ต้องมาก่อน (owner รันแล้ว, queryable) (2) full chain create→save→ใบเสร็จ→print ยังไม่ smoke (เลี่ยง mutate) — auto-fill smoke ผ่าน + carry/print guard-locked + column queryable (3) multi-pay receipt: print bank อยู่ฝั่ง single-pay branch; per-row = future (#5). **✅ MERGED = build 440 live** (2026-06-14, owner "merge ได้" หลัง smoke — ff `claude/phase-440-doc-bank:main` = `4781e0d` · CI Tests+Deploy success · verified HTML prod 440). **owner รัน SQL + tag 6 บัญชี→กลุ่ม ครบ** (1131/1132→ราชการ·1133→POS·1134→ช่าง·1135→หน้าร้าน·1136→ติดตั้ง). **Claude smoke preview (login admin):** resolver "ราชการ"→1131 snapshot เต็ม / "ขาย POS"→1133 · ฟอร์มใบเสนอ #qt_bankCoa 7 options · เลือกลูกค้า(กลุ่มราชการ in-memory test)→`#qt_bankCoa=1131` เด้งจริง · restore ไม่แตะ DB · ไม่มี console error. **Next: Phase B2b** (build 441) — receipts.js `_openReceiptEditDrawer` (~L1010) เพิ่ม bank picker override + PATCH + เตือนตอน status→paid (~L511/L800) ถ้า transfer แต่ไม่มี bank_coa_code (reviewer #4, ไม่ silent 1130). **Phase C** (build 442) — `postJournalForReceipt` (auto_post.js:652) อ่าน receipt.bank_coa_code → Dr <bank> แทน 1130 (#3).

---

**Prev (439):** 14 มิถุนายน 2026 (Phase 439 (B1) bank↔customer-group mapping — **build 439**, **SETTINGS/CONFIG · ไม่แตะเงิน — ฐาน auto-เติมบัญชีใบเสร็จ**) · ต่อจาก 438 ตามแผน Phase B (owner: ผูกบัญชีรับเงินตามกลุ่มลูกค้า กันออกใบเสร็จผิดบัญชีโอน). **Baseline:** branch `claude/phase-439-bank-group-map` จาก origin/main `824929c` (build 438 live). **เนื้องาน B1 (mapping + resolver เท่านั้น — ยังไม่แตะใบเสร็จ/auto_post):** (1) **ใหม่ `modules/customer_groups.js`** = single source: `export CUSTOMER_GROUPS` (5 กลุ่ม) + `resolveBankForCustomerGroup(group, paymentInfo)` → หา bank แรกที่ `bank.customerGroup===group` คืน snapshot เต็ม `{coaCode,bankName,bankAccount,bankHolder,bankBranch,label}`; **ไม่เจอ/ว่าง/ไม่มี banks → null (ไม่ fallback 1130)** — รองรับ reviewer note #1 (snapshot freeze บนใบเสร็จ) + #4 (no silent fallback). (2) **`modules/settings/payment.js`** เพิ่ม `<select data-bank-field="customerGroup">` ต่อ bank card (ใต้ coaCode, options จาก CUSTOMER_GROUPS.map) + เก็บใน `_syncBanksFromDom` + save handler `updatedBanks`. (3) **`modules/customers.js`** เปลี่ยน `const CUSTOMER_GROUPS` เดิม (438) → `import` จาก customer_groups.js (dedupe single-source; dropdown/filter เดิมทำงานเท่าเดิม). **mapping เก็บใน `paymentInfo` (JSON ใน app_settings) → ไม่มี SQL/DB schema ในเฟสนี้.** **bump 439 ครบ** (data-app-build/?v=×4/sw cache-v439/dashboard_readonly_guard→439). **Guard:** +`customer_group_bank_map_guard.test.js` (7: CUSTOMER_GROUPS=5 ตรง · customers import จาก shared ไม่มี const ซ้ำ · payment render+sync+save customerGroup · resolver match→snapshot+first-wins · miss→null ไม่ใช่ 1130) — **import resolver จริงมาเทส behaviour ไม่ใช่แค่ regex** · อัปเดต `customer_group_guard.test.js` (438 test const→import). **ไฟล์ (8):** +modules/customer_groups.js · modules/customers.js · modules/settings/payment.js · index.html · sw.js · +tests/customer_group_bank_map_guard.test.js · tests/customer_group_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification จริง:** lint:errors **0** · unit **1614/1614** · e2e **14/14** · scope เฉพาะ 8 ไฟล์ผม · EOL LF. **❌ ไม่แตะ:** receipts/quotations/delivery_invoices · auto_post/JV · pos.js · เงิน/สต็อก · RLS · ไม่เพิ่ม dependency · ไม่มี SQL. **Known risks:** (1) dropdown ยังว่างหมดจนกว่า owner ผูกกลุ่ม→บัญชี (config ครั้งเดียวใน settings/ชำระเงิน; เก็บ cloud app_settings ไม่ผูก build) (2) ราชการมี 2 บัญชี (1131/1132) — resolver คืน **ตัวแรกที่เจอใน banks[]** (live order 1131 มาก่อน → ตรง default ราชการ→1131). **✅ MERGED = build 439 live** (2026-06-14, owner "merge ได้" หลัง smoke — ff `claude/phase-439-bank-group-map:main` = `3d4cd5c` · CI Tests+Deploy success · verified HTML prod data-app-build=439). **Claude smoke preview (login admin, settings/ชำระเงิน):** 6 bank cards ทุกใบมี dropdown กลุ่ม (everyBankHasGroupSelect ✓) · options=[ว่าง,ราชการ,ขาย POS,งานช่าง,หน้าร้าน,ขายพร้อมติดตั้ง] · มองเห็นจริง · default ว่าง · coaCode เดิมครบ 1131-1136 · ไม่ mutate/save · ไม่มี console error. **Next: Phase B2** (build 440) — ใบเสร็จ auto-เติมบัญชีจากกลุ่มลูกค้า (resolve ตอนเลือกลูกค้าในใบเสนอราคา→พา bank_coa_code+snapshot ลง chain quotation→invoice→receipt) + แก้ได้+เตือน + snapshot บนใบพิมพ์ (reviewer #1) · quotation = display-only ห้าม JV (#2) · โอนไม่เจอบัญชี = เตือนไม่ silent 1130 (#4) · multi-pay รอบแรกบัญชีหลักเท่านั้น (#5) · SQL คอลัมน์ใหม่ต้องมาก่อน merge (#6). Phase C = `postJournalForReceipt` (auto_post.js:652, mapping `receipt_revenue_transfer`=Dr 1130/Cr 4150) อ่าน bank_coa_code → Dr <bank> ที่ระบุ (#3).

---

**Prev (438):** 14 มิถุนายน 2026 (Phase 438 customer-group — **build 438**, **UX/DATA · additive — ฐานสำหรับ auto บัญชีรับเงินในใบเสร็จ**) · owner: "จากใบเสนอราคา แยกกลุ่มลูกค้าได้มั้ย + ผูกกรอกบัญชีธนาคารแยกประเภทลูกค้าลงใบเสร็จ กันออกใบเสร็จพลาดเรื่องบัญชีโอน" → ออกแบบ 3 เฟส (owner เคาะ: เลือกบัญชี **ตามกลุ่มลูกค้า** + 5 กลุ่ม = ราชการ/ขาย POS/งานช่าง/หน้าร้าน/ขายพร้อมติดตั้ง map ราชการ→1131(สลับ1132)·POS→1133·ช่าง→1134·หน้าร้าน→1135·ติดตั้ง→1136 + บังคับแบบ **auto-เติม+เตือน แก้ได้**). **Baseline:** branch `claude/phase-438-customer-group` จาก origin/main `1ce21d9` (build 437 live). **เนื้องาน Phase A (เฟสนี้ = วางฐานเท่านั้น ยังไม่แตะใบเสร็จ/บัญชี):** (1) **SQL ใหม่ `supabase-phase438-customer-group.sql` (owner รันแล้ว):** `ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group text` (nullable, ไม่มี DEFAULT/CHECK — ค่าคุมที่ UI dropdown, ลูกค้าเก่า=NULL, future-flexible) + `NOTIFY pgrst` (กัน PGRST204) + verify. additive ล้วน ไม่ backfill. (2) **index.html** customerDrawer เพิ่ม `<select id="customerGroup">` ถัดจาก contact_type — 6 ตัวเลือก (ว่าง + 5 กลุ่ม; value = string ไทยตรง vocab เพื่อ match บัญชีเฟส B). (3) **main.js** `openCustomerDrawer` (~L1866) โหลด `customer?.customer_group` + `saveCustomer` (~L2243) payload เพิ่ม `customer_group: $("customerGroup")?.value || null`. (4) **modules/customers.js** เพิ่ม `CUSTOMER_GROUPS` const (5 กลุ่ม) + `currentGroupFilter` + dropdown กรอง `contactGroupFilter` (ทุกกลุ่ม/5กลุ่ม/ยังไม่ระบุ) ใน toolbar + badge 🏦 ในแถว (escHtml) — filter narrow บน `filtered` (clone ของ state.customers, ไม่ mutate). **bump 438 ครบ** (data-app-build/?v=×4/sw cache-v438/dashboard_readonly_guard→438). **Guard:** +`tests/customer_group_guard.test.js` (7: SQL additive+nullable+no-CHECK+notify · dropdown 5 กลุ่ม+ว่าง · main load+save · customers.js const+filter+badge+no-state-mutation). รอบแรก fail 1 (regex `CHECK\(` ชนคำ "no CHECK (" ในคอมเมนต์ SQL เอง → strip comment lines ก่อนเช็ค structural). **ไฟล์ (7):** index.html · main.js · modules/customers.js · sw.js · +supabase-phase438-customer-group.sql · +tests/customer_group_guard.test.js · tests/dashboard_readonly_guard.test.js. **Verification จริง:** lint:errors **0** · unit **1608/1608** · e2e **14/14** · scope = เฉพาะ 7 ไฟล์ผม · EOL LF ครบ. **❌ ไม่แตะ:** pos.js · auto_post · receipts · quotations · stock · payment · contact_type logic เดิม · RLS · ไม่เพิ่ม dependency. **Known risks:** (1) `saveCustomer` ส่ง `customer_group` ใน payload เสมอ → **ต้องรัน SQL ก่อน merge** ไม่งั้น PGRST204 ทุกการบันทึกลูกค้า (owner รันแล้ว — verify column live) (2) 3 กลุ่ม (POS/ช่าง/ติดตั้ง) จริง ๆ คือประเภทงานไม่ใช่ตัวลูกค้า → ลูกค้ามีได้ 1 กลุ่มหลัก; รับด้วยตัวเลือก "แก้ได้" (default จากกลุ่ม สลับตอนออกใบเสร็จได้) เฟส B. **✅ MERGED = build 438 live** (2026-06-14, owner "merge ได้" หลัง smoke ผ่าน — ff `claude/phase-438-customer-group:main` = `201524a` · CI Tests+Deploy success · verified HTML prod data-app-build=438). **owner รัน SQL แล้ว** (verify: `customer_group | text | YES`). **Claude smoke preview (login admin):** APP_BUILD=438 · dropdown 🏦 มองเห็นจริงใน drawer 6 ตัวเลือก default ว่าง · ตัวกรอง 3 สถานะถูก (ราชการ→0 / ยังไม่ระบุ→ทั้งหมด / ทุกกลุ่ม→reset) · REST `customers?select=customer_group` = 200 (save ไม่ PGRST204) · 225 ลูกค้าไม่ mutate · ไม่มี console error. **Next: Phase B** (build 439) — map กลุ่ม→บัญชี (ใน settings ธนาคารเดิม owner แก้ได้) + ช่องบัญชีในใบเสนอราคา/ใบเสร็จ auto-เติม+เตือน (เพิ่ม col `receipts`/`quotations`, reuse `coaCode`+`BANK_COA` note pattern) → แก้ปัญหา auto_post 1130 รวมก้อนไปด้วย; แล้ว Phase C = auto_post อ่านบัญชีจากใบเสร็จ.

---

**Prev (437):** 14 มิถุนายน 2026 (Phase 437 stock-nonneg-CHECK — **build 437**, **MONEY/STOCK · P1-③**) · owner "สต็อกห้ามติดลบเด็ดขาด" (ของค้างจาก Phase 367). **Baseline:** branch `claude/phase-437-stock-nonneg-check` จาก origin/main `30088e3` (build 436 live — ทีมขนาน document template fields). **ลำดับเหตุการณ์ session นี้:** หลัง 434 merged → owner สั่งทำ P1-② + ③ → **P1-② (Phase 435) = verify แล้วไม่ต้องแก้** (3 หน้ารายงานกัน cancelled ถูกต้องตั้งแต่ build 432: profit_report saleIds จาก salesInRange / top_customers saleIdSet จาก sales กรองแล้ว / sales_heatmap visibleSalesForRole) — ผมร่าง guard แต่**ถอยออก**เพราะอีก session active สร้าง build 435 ในเครื่องเดียวกัน (working tree ร่วม) → owner สั่งรอ session โน้นว่าง → 435 ("native confirm cleanup") + 436 ("document template fields") ของเขา merged → tree สะอาด → ลุย P1-③. **เนื้องาน P1-③:** (1) **SQL ใหม่ `supabase-phase437-stock-nonneg-check.sql` (⚠️ owner รันเอง):** DB CHECK `chk_ws_stock_nonneg`+`chk_products_stock_nonneg` `CHECK (stock >= 0)` บน warehouse_stock + products — STEP 1 pre-check แถวติดลบ (ต้อง 0 ก่อน ADD เพราะ validate ทันที) → STEP 2 data-fix (uncomment ถ้ามี) → STEP 3 ADD (DROP IF EXISTS re-run safe) → STEP 4 verify. เป็น last line of defense ทับ floor 367/368/369. (2) **`modules/stock_movements.js` ปิดทาง manual override ที่เป็นตัวเขียนค่าติดลบลง DB ตัวเดียว:** เลิกส่ง `allowNegative:true` → `false` (floor 369 บังคับ); การจ่ายออก (out/sale, ~L564) + โอนต้นทาง (~L487) ที่จะติดลบ เปลี่ยนจาก `App.confirm("จะติดลบ ดำเนินการต่อ?")` → **hard block** `showToast("...ไม่อนุญาตให้สต็อกติดลบ") + return`. **(ไม่แตะ POS/setting):** `allowNegativeStock` (bsk_product_settings) คง default true — มันคุม **POS UX** (addToCart/cart cap ให้ขายสินค้า stock 0 เช่นค่าบริการ/ค่าแรง) ไม่ใช่ตัวเขียนค่าติดลบลง DB (service/non_stock ไม่ deduct; stock items ถูก floor 367 อยู่แล้ว) → บังคับ off จะพังการขายค่าบริการ จึงคงไว้ (อธิบายให้ owner แล้ว — เป็น deviation จาก option "บังคับ setting off" ที่เสนอ เพราะ option นั้นจะ break services). **bump 437 ครบ** (data-app-build/?v=×4/sw cache-v437/dashboard_readonly_guard→437). **Guards:** +`stock_nonneg_guard.test.js` (3: SQL CHECK 2 ตาราง+re-run safe+pre-check ก่อน ADD · stock_movements ไม่มี allowNegative:true เหลือ false · hard-block message + ไม่มี proceed-to-negative confirm) · **อัปเดต `apply_stock_movement_floor.test.js`** (guard Phase 369 เดิมล็อก "confirm จะติดลบ + allowNegative:true" → 437 กลับด้าน เขียนใหม่ assert allowNegative:false + ไม่มี true; ไม่ลบ test เปลี่ยน intent พร้อมคอมเมนต์). **ไฟล์ (8):** +supabase-phase437-stock-nonneg-check.sql · modules/stock_movements.js · index.html(?v=) · sw.js · +tests/stock_nonneg_guard.test.js · tests/apply_stock_movement_floor.test.js · tests/dashboard_readonly_guard.test.js · docs ×3. **Verification จริง:** lint:errors **0** · unit **1601/1601** (รอบแรก fail 1 = apply_stock_movement_floor guard เก่า ตามคาด → แก้ intent) · e2e **14/14**. **❌ ไม่แตะ:** RLS · POS/checkout/cart/addToCart · `_deductStockForSaleItem`/`_transferWarehouseStock`/`stock_cas.js` floor internals (CAS เดิมทำงานต่อ) · `allowNegativeStock` setting/toggle · เงิน/บัญชี. **Known risks:** (1) **ยังไม่ render วัดจริง** — owner รัน SQL + smoke: จ่ายออก/โอน เกินสต็อก → ต้องถูก hard block (ไม่ใช่ confirm); ลอง UPDATE stock=-1 ใน SQL Editor → ต้อง ERROR check constraint; ขายค่าบริการ/POS ปกติยังได้ (ไม่กระทบ) (2) `adjust` movement ที่ set ค่าติดลบโดยตรง (ฟอร์มมี min ไหมไม่ได้ตรวจ) → ถ้าหลุดมา DB CHECK จะ reject ด้วย error generic (form line 587 แสดง "ข้อผิดพลาด") — ยอมรับได้ (CHECK เป็น backstop) (3) ก่อน owner รัน SQL → มีแค่ floor+client block (เครื่องที่ค้างแอปเก่ายังไม่มี block ใหม่จนรีเฟรช). **Smoke checklist (preview, login admin):** ① ประวัติสต็อก → จ่ายออกเกินสต็อก → ขึ้น "ไม่อนุญาตให้สต็อกติดลบ" (ไม่มีปุ่มยืนยันติดลบ) ② โอนระหว่างคลังเกินต้นทาง → block เดียวกัน ③ จ่ายออกไม่เกิน → สำเร็จปกติ ④ (หลังรัน SQL) SQL Editor `UPDATE warehouse_stock SET stock=-1 WHERE id=...` → ERROR ⑤ POS ขายค่าบริการ (stock 0) → ยังได้ปกติ. **✅ MERGED = build 437 live** (2026-06-14, `a076b7a` ff branch:main · CI Tests+Deploy success · verified HTML จริง data-app-build=437). **owner รัน SQL ครบ:** STEP 1 pre-check = 0 ติดลบ (warehouse_stock + products) → STEP 3 ADD constraint Success → STEP 4 verify = 2 แถว (`chk_ws_stock_nonneg`/`chk_products_stock_nonneg` active) · **+ owner รัน Phase 403 sync trigger** (`supabase-phase403-stock-sync-trigger.sql` — products.stock = sum(warehouse_stock) derived; เป็น prerequisite ที่เหมาะก่อน 437, ทำให้สต็อกรวม sync; เพิ่งถูก apply ตอนนี้). **Claude smoke บน preview (login admin):** จ่ายออก 999999 (สต็อกเหลือ 1) → hard-block toast "สต็อกคลังนี้เหลือ 1 — จ่ายออก 999999 ไม่ได้ (ระบบไม่อนุญาตให้สต็อกติดลบ)" ไม่มี confirm-ติดลบ + ไม่เขียน data ✓. **🎉 ปิดแผน P1 ครบ 3:** ①build 433 payroll double-pay guard ②build 435 P1-② verify (รายงานกัน cancelled ถูกตั้งแต่ 432 — ไม่ต้องแก้) ③build 437 stock non-negative CHECK. **Next (ถ้า owner สั่ง):** P2 — ป้าย "ของใกล้หมด 675" บวม / HR ตัดกล่องโฆษณา+ม่วงตกค้าง / มือถือ bottom-nav.

---

**Prev (434):** 13 มิถุนายน 2026 (Phase 434 technician-stock-access — **build 434**, **PERMISSION/STOCK · owner request ด่วน**) · เปิดให้ role "ช่าง" (technician; ผู้ช่วยช่าง = ตั้ง role=ช่าง) เข้าสินค้า/คลังเพื่อเบิกขึ้นรถ + ตัดสต็อกเอง โดย **ไม่เห็นต้นทุน**. **Baseline:** branch `claude/phase-434-technician-stock-access` จาก origin/main `833d71a` (build 433 live). **เนื้องาน:** (1) `main.js` `ROLE_PAGES.technician` += `products`,`wh_kunkhao`,`wh_kundaeng`,`wh_sikhon`,`stock_movements`,`stock_count` (ตรวจแล้ว stock_movements + stock_count = ไม่มี string ต้นทุน/cost เลย; เบิกขึ้นรถ = transfer modal บน stock_movements, ตัดสต็อก = movement out). **❌ ไม่ให้** `stock_in_wizard` (รับเข้า — โชว์ "ต้นทุน/ชิ้น"+มูลค่ารวม = งานจัดซื้อ), `stock_value` (มูลค่า/ต้นทุนรวม), `dead_stock` — ตาม owner "ไม่เห็นต้นทุน". (2) `modules/products.js` gate จุดเห็น/แก้ต้นทุนเป็น admin/sales: เพิ่ม `canManageProducts` ใน `renderView` (หัวactions: นำเข้า/เพิ่ม/⋯จัดการเพิ่มเติม[ส่งออก Excel มี ต้นทุน/บาร์โค้ด/หมวด/bulk/ลบทั้งหมด]) + `canManageCard` ใน `renderProductItem` (เมนูการ์ด: ✏️แก้ไข[drawer โชว์ cost] + 📦รับสต็อก[openQuickStockInModal โชว์ "ต้นทุนใหม่ต่อชิ้น"]) — ช่างเห็นเฉพาะ ชื่อ/สต็อก/whBreakdown/turnover + QR/พิมพ์บาร์โค้ด (ไม่มีต้นทุน); delete ยัง isAdmin เดิม. การ์ดไม่โชว์ cost อยู่แล้ว (ตรวจ render). (3) **ซ่อนหน้า "เมทริกซ์สิทธิ์":** พบว่า `permission_matrix.js` เป็น **UI หลอกตา** — checkbox บันทึกลงตาราง `permissions` ได้ แต่ `hasPermission()` **ไม่เคยถูกเรียกใช้ที่ไหนเลย** (grep ทั้ง repo: import+ใส่ ctx+นิยาม เท่านั้น ไม่มี call site) → owner ยืนยัน "ทำไว้โชว์". แก้: `menu.js` ถอดปุ่ม `data-target="permissions"` ออก (เหลือคอมเมนต์) + `settings/permissions.js` เลิกเรียก `renderPermissionMatrix` เปลี่ยนเป็นข้อความ "ปิดปรับปรุง" ชี้ไปตั้ง role ที่ "ตั้งค่าผู้ใช้งาน"; `permission_matrix.js` คงไฟล์ไว้ (dormant). **bump 434 ครบ** (data-app-build/?v=×4/sw cache-v434/dashboard_readonly_guard→434). **+guard `tests/technician_stock_access_guard.test.js` (5):** technician มี stock pages / technician ไม่มี stock_in_wizard·stock_value·dead_stock / sales คงสิทธิ์เดิม / products gate canManageProducts+canManageCard (edit·stock-in gated, ไม่มี ungated) / menu ไม่มีปุ่ม permissions + permissions.js ไม่เรียก matrix + มี "ปิดปรับปรุง". รอบแรก fail 3 จุด (lint: canManageProducts ผิด scope — header อยู่ใน `renderView` ไม่ใช่ `renderProductsPage` → ย้าย const · test regex `sales:[` ชน LAZY_ROUTES key → anchor ใน ROLE_PAGES block ก่อน · คอมเมนต์ menu มี literal `data-target="permissions"` → ลบออก) แก้ครบ. **ไฟล์ (8):** main.js · modules/products.js · modules/settings/menu.js · modules/settings/permissions.js · index.html(?v=) · sw.js · +tests/technician_stock_access_guard.test.js · tests/dashboard_readonly_guard.test.js · docs ×3. **Verification จริง:** lint:errors **0** · unit **1594/1594** · e2e **14/14**. **❌ ไม่แตะ:** RLS/SQL (ไม่มี SQL ในเฟสนี้ — technician เขียน warehouse_stock/stock_movements ผ่าน POS checkout + ใบงานช่างได้อยู่แล้ว = RLS อนุญาต technician แล้ว การเพิ่มเมนูจึงเป็น client UX unlock) · เงิน/checkout/auto_post · `_markPaid`/payroll · sales/admin behavior (gate ใช้ allowlist admin+sales = ของเดิมไม่เปลี่ยน). **Known risks:** (1) **ยังไม่ render วัดจริง** — owner (หรือ Claude) ต้อง smoke login เป็น "ช่าง" จริงดูว่า: เห็นเมนูสินค้า/คลัง + คลังรถ, เปิดดูได้ + ข้อมูลโหลด (RLS read products/warehouse_stock อนุญาต technician?), ทำ transfer บ้าน→รถ + movement out ได้ (RLS write), **ไม่เห็นปุ่มนำเข้า/เพิ่ม/ส่งออก/แก้ไข/รับสต็อก + ไม่เห็นต้นทุนที่ไหนเลย**. ⚠️ ถ้า RLS อ่าน products/warehouse_stock บล็อก technician → จะเห็นหน้าแต่ข้อมูลว่าง → ต้องเพิ่ม RLS policy (เฟสแยก) — แต่คาดว่าอ่านได้ (POS technician โหลด products อยู่แล้ว) (2) empty-state ปุ่ม "+ เพิ่มสินค้า" ยังโชว์ถ้า list ว่าง (catalog จริง 1000+ ไม่ว่าง = ไม่กระทบ; residual เล็ก) (3) per-card 📱QR/🖨️พิมพ์บาร์โค้ด ยังเปิดให้ช่าง (ตั้งใจ — ไม่มีต้นทุน, มีประโยชน์ตอนเบิก). **Smoke checklist (preview):** login ช่าง → ① เห็นกลุ่ม สินค้า/คลัง + คันขาว/แดง/ศีขร ② เปิดหน้าสินค้า → เห็นรายการ+สต็อก ไม่มีปุ่ม นำเข้า/เพิ่ม/⋯จัดการ, เมนูการ์ดไม่มี แก้ไข/รับสต็อก ③ เปิด ประวัติสต็อก → ทำ transfer/เบิก + ตัดสต็อก ได้ ④ ไล่หาคำว่า "ต้นทุน" ทั้งหน้า — ต้องไม่เจอ ⑤ login admin → ทุกอย่างเหมือนเดิม (regression) ⑥ ตั้งค่า → ไม่มีเมนู "สิทธิ์การใช้งาน"; เข้า #settings/permissions ตรง ๆ → เห็น "ปิดปรับปรุง". **✅ MERGED = build 434 live** (2026-06-13, `8f5cc73` ff branch:main · CI Tests+Deploy success · verified HTML จริง data-app-build=434). **Claude smoke เป็น session ช่างจริง (boonsuk admin1/ช่าง) บน preview ผ่านครบ:** ① เมนู สินค้า/คลัง + คันขาว/แดง/ศีขร + ประวัติสต็อก + นับสต็อก โผล่ให้ช่าง (ไม่มี รับเข้า/มูลค่า/ค้างนาน) ② products โหลด 1116 รายการ → **RLS อ่าน products/warehouse_stock อนุญาต technician แล้วจริง** (ความเสี่ยงที่กังวลไว้ = เคลียร์) ③ header ไม่มี นำเข้า/เพิ่ม/⋯จัดการ · เมนูการ์ด = QR+พิมพ์บาร์โค้ด เท่านั้น (ไม่มี แก้ไข/รับสต็อก) ④ ปุ่มกรอง "ไม่มี cost" หายหลัง fix → ช่างไม่เห็นคำ cost/ต้นทุนเลย ⑤ ประวัติสต็อก: เปิด modal "ย้ายสต็อกระหว่างคลัง" (เบิกบ้าน→รถ: สินค้า/ต้นทาง/ปลายทาง/จำนวน/หมายเหตุ — ไม่มีช่องต้นทุน) + "เพิ่มเคลื่อนไหวสต็อก" (ตัด) ได้; ตารางไม่มีคอลัมน์ต้นทุน (ไม่ submit จริง = ไม่เขียน data). **fix พ่วงระหว่าง smoke:** no_cost quick-chip gate ด้วย canManageProducts (`8f5cc73`). **เหลือ residual เล็ก:** empty-state "+ เพิ่มสินค้า" ยังไม่ gate (catalog ไม่ว่าง = ไม่กระทบ). **Next P1 ที่ owner อนุมัติ:** ② normalize 3 หน้า visibleSalesForRole ③ CHECK สต็อก≥0.

---

**Prev (433):** 13 มิถุนายน 2026 (Phase 433 payroll-pay-race-guard — **build 433**, **PAYROLL · MONEY — แตะ `_markPaid` จุดเดียว + SQL ใหม่**) · งานแรกของแผน P1 ที่ owner อนุมัติ ("เริ่ม P1-① ก่อน เริ่มลุยตามคุณแนะนำ") — ปิด race จ่ายเงินเดือนซ้ำข้ามเครื่องจาก audit 416-418. **Baseline:** branch `claude/phase-433-payroll-pay-guard` จาก main `a2f8b94` (build 432 live). **เนื้องาน:** (1) `modules/payroll.js` แก้ใน `_markPaid` เท่านั้น — PATCH เปลี่ยนเป็น **CAS**: URL เพิ่ม `&paid_at=is.null` + header `Prefer: return=representation` → อ่านแถวที่คืนมา; **แถวว่าง = แพ้ race** → toast เตือน + `logActivity("payroll_pay_race_blocked")` + `loadAllData()` + re-render + `return` **ก่อนถึง** `_createSalaryExpense`/`postJournalForPayroll`/audit "payroll_pay" (กันรายจ่าย+JV+audit ซ้ำ); winner = flow เดิม byte-เดิมทุกบรรทัดหลังจุดนี้; pre-check local เดิม (idempotent guard) คงไว้เป็นด่านแรกถูก ๆ. ตรวจ writer ครบตามกฎเหล็ก: `staff_payroll` ถูก PATCH จาก payroll.js เท่านั้น (×3: save-edit ×2 ส่ง paid_at ค่าเดิม → ผ่าน trigger · markPaid) — โมดูลอื่น (hr_overview/payroll_overview/auto_post/backfill/periods) อ่านอย่างเดียว. (2) **SQL ใหม่ `supabase-phase433-payroll-pay-guard.sql`** (pattern 92.61b refund-guard; **⚠️ owner รันเองใน SQL Editor — ยังไม่ apply**): `_guard_payroll_paid_lock()` + `trg_guard_payroll_double_pay` BEFORE UPDATE WHEN (OLD.paid_at IS NOT NULL) → `NEW.paid_at IS DISTINCT FROM OLD.paid_at` = RAISE 'Phase433...' — บล็อกจ่ายทับ + **บล็อก stale-edit ล้าง paid_at เป็น NULL** (ช่องที่พบเพิ่มตอนรีวิว: ฟอร์มแก้ไขส่ง payload จาก state ค้างอาจ clobber วันจ่าย); แก้ field อื่นของแถวจ่ายแล้ว = ผ่านเท่าเดิม (เรื่อง edit-paid-row ไม่ sync expense/JV = งานแยก); DELETE ไม่เกี่ยว; re-run safe + VERIFY (a)-(d) ท้ายไฟล์; ไม่แตะ RLS. (3) +`tests/payroll_pay_race_guard.test.js` (6 tests — extract `_markPaid` body ก่อน regex ตามกฎ; รอบแรก fail 1 เพราะ negative-assert ของผมชนคำใน comment SQL เอง → แก้ comment ไม่ใช้คำต้องห้าม). **bump 433 ครบ** + dashboard_readonly_guard→433. **ไฟล์ (9):** modules/payroll.js · +supabase-phase433-payroll-pay-guard.sql · +tests/payroll_pay_race_guard.test.js · tests/dashboard_readonly_guard.test.js · index.html (?v=) · sw.js · docs ×3. **Verification จริง:** lint:errors **0** · unit **1589/1589** (รวม payroll guards 416-418 เดิมเขียว = ไม่กระทบ extract-block ตำแหน่ง) · e2e **14/14**. **❌ ไม่แตะ:** `_savePayroll`/`_bulkGeneratePayroll`/`_createSalaryExpense` internals · `postJournalForPayroll`/auto_post · computePayrollTotal/รอบจ่าย 416 · สลิป/ตาราง 417-418 · RLS/total_amount · หน้าอื่นทุกหน้า. **Known risks:** (1) จนกว่า owner รัน SQL → มีแค่ชั้น client (ปิด race ได้เฉพาะเครื่องที่รันโค้ด 433 แล้ว — เครื่องที่ค้างแอปเก่ายังเสี่ยงจนรีเฟรช+รัน SQL) (2) `_createSalaryExpense` dedup ภายใน (#payroll-{id} check-then-insert) ยัง racy ในตัวเอง แต่ถูกปิดจากต้นทางด้วย CAS แล้ว — DB unique constraint ที่ expenses = hardening อนาคตถ้าต้องการ (3) un-pay จะทำไม่ได้อีกต่อไป (ตั้งใจ — ไม่มี UI un-pay อยู่แล้ว; ถ้าจำเป็นจริง owner ปิด trigger ชั่วคราวใน SQL Editor). **Smoke checklist (หลังรัน SQL บน preview):** ① จ่าย payroll แถว test 1 แถว → สำเร็จ + expense + JV ตามปกติ ② เปิด 2 แท็บที่แถวยังไม่จ่ายเดียวกัน กด "จ่าย" ไล่กัน → แท็บสอง toast "ถูกจ่ายไปแล้ว" + ไม่มี expense/JV ซ้ำ (เช็คหน้ารายจ่าย + สมุดรายวัน เห็นอย่างละ 1) ③ แก้ไขแถวที่จ่ายแล้ว (ไม่แตะช่องจ่าย) → บันทึกผ่าน ④ ใน SQL Editor ลอง UPDATE paid_at ของแถวจ่ายแล้ว → ต้องได้ ERROR Phase433 ⑤ audit log มี payroll_pay_race_blocked จากข้อ ② **✅ SMOKE PASSED (Claude ทำเองบน preview ตาม owner อนุญาต 2026-06-13, owner รัน SQL 433 + VERIFY แล้ว tgenabled=O):** ① จ่าย payroll id 47 (ton yuttana ฿350 โอน) → สำเร็จ + expense id 30 (#payroll-47 ฿350 salary) **1 ใบเป๊ะ** ② แท็บ 2 (state เก่า) กดจ่ายซ้ำ id 47 → CAS แถวว่าง → toast "ถูกจ่ายไปแล้วจากเครื่อง/แท็บอื่น" + **ไม่มี expense/audit-pay ซ้ำ** (activity_log: payroll_pay 1 + payroll_pay_race_blocked 1) ③ PATCH paid_at ตรงข้าม UI → **HTTP 400 P0001 "Phase433...paid_at is locked"** (trigger ชั้น 2 ทำงาน) ④ edit field อื่นของแถวจ่ายแล้ว → ผ่าน (200) ⑤ JV = 0 ถูกต้องตาม effective-date (ก่อน 1 ก.ค.). **🐛 บั๊กของเก่าที่เจอระหว่าง smoke (P0 ของ owner — แก้แล้ว):** SQL Phase 416 **ไม่เคยถูก apply สำเร็จ** เพราะ DROP เดาชื่อผิด (`uq_staff_payroll` แต่ของจริง `uq_staff_payroll_emp_month`) → unique เก่า (employee_id+period_month) ยังอยู่ → สร้าง 2 รอบ/เดือนไม่ได้ (รอบ 25 มิ.ย. จะพังจริง). **owner รัน fix แล้วใน DB** (`DROP CONSTRAINT/INDEX uq_staff_payroll_emp_month`) + **แก้ไฟล์ `supabase-phase416-payroll-period.sql`** ใน repo ให้ drop ครบทุกชื่อ/ชนิด (self-healing). พิสูจน์ live: insert รอบ 11–25 ผ่าน (201) · insert ซ้ำรอบเดิมโดน `uq_staff_payroll_period` (409) · ลบ test row สะอาด. **test residue (pre-go-live, นโยบาย test ไม่ลบ):** staff_payroll id 47 = paid test + expense id 30 — ปล่อยไว้ (consistent), จะถูก wipe ตอน go-live; ถ้า owner อยากลบตอนนี้ DELETE row ได้ (trigger เป็น UPDATE-only). **✅ MERGED = build 433 live** (2026-06-13, owner สั่ง "merge ได้" หลัง smoke ผ่าน) — ff `branch:main` = `a30c7a3` · CI Tests+Deploy success · verified HTML จริง data-app-build=433 · ฐานข้อมูล: trigger 433 + fix 416 owner รัน apply แล้ว (tgenabled=O). **Next P1 ที่ owner อนุมัติแผนไว้:** ② normalize 3 หน้า (รายงานกำไร/ยอดขายตามช่วงเวลา/ลูกค้าซื้อเยอะสุด) ให้ใช้ `visibleSalesForRole` (ปิด invariant cancelled ของ build 432 ให้สนิท — เฟสจิ๋ว display-only) ③ CHECK constraint สต็อก ≥ 0 (SQL ใบใหม่ — ของค้างจาก Phase 367).

**Prev (432):** 13 มิถุนายน 2026 (build 432 — **งานทีมขนาน financial-cancelled + VAT guard, UI session ส่งแทน**) · session ทีมขนานทำเสร็จ+เทสผ่าน แต่ stall ก่อน commit (credit หมดตอนติด `.git/index.lock`) → owner อนุญาต**เฉพาะเคส** ("ขอเป็นเคสเฉพาะกิจ ผมวิเคราะห์และอนุญาตตามเคส ๆ ไป — ยืนยัน push งาน 432 แทนเขาได้") → UI session: ① ตรวจ inventory งานเขา 18 ไฟล์ (เนื้องาน: บิล `status=cancelled` ไม่นับยอดเงิน/รายงานทุกจุด — utils getCustomerTier+visibleSalesForRole · cash_recon · credit_tracker · expenses · profit_by_product · dashboard · customer_dashboard · pos + VAT ต้องเปิดใช้และถึง `vatEffectiveDate` ก่อนทำงาน — settings/payment, pos + guard ใหม่ `financial_cancelled_guard`/`vat_effective_date_guard` + bump 432 ครบ) ② **รันเทสยืนยันอิสระก่อนส่ง** lint 0 / unit **1583/1583** / e2e **14/14** (ตรงรายงานเขา) ③ commit ก้อนเดียวแยกของเขา `6998cae` ระบุที่มาใน message → push branch `claude/phase-432-financial-cancelled-vat` → CI เขียว → ff `branch:main` → **build 432 live** (verified HTML จริง). **บทเรียน/กติกา:** ข้ามเส้น "ต่างคนต่างแก้" ได้เฉพาะ owner อนุญาตเป็นเคส ๆ + ต้อง verify เอง + commit แยกระบุที่มา — ถ้า session ทีมขนานตื่นมา จะเจอ tree สะอาด (งาน commit แล้ว) ไม่ต้องทำซ้ำ. **⚠️ note ถึงทีมขนาน:** เครดิตงานเป็นของคุณทั้งหมด commit message ระบุไว้ชัด.

**Prev (431):** 13 มิถุนายน 2026 (Phase 431 blue-skin — **build 431**, **UI · display-only — เปลี่ยน hue เท่านั้น ไม่แตะโครง/logic**) · owner: "สีขอเป็นสีฟ้า สีม่วงแสบตา" + สั่งไล่สี products ต่อ → ผล: products **ไม่ต้องไล่** (35 จุดเป็น sky เดิมอยู่แล้ว = ตรงโทนใหม่). งานจริง = ถอด indigo ทั้งระบบกลับ sky: **(1) style.css** tokens light `--bg #eaedf8→#e8eef7` (คงความเข้ม 424, เลิกอมม่วง) · `--line #e9e9f2→#e7ecf3` · `--primary #6b6be0→#0ea5e9` · `--primary2 #5b5bd6→#0284c7`; dark `#8a8af2/#6b6be0→#38bdf8/#0ea5e9`; replace_all ทั้งไฟล์: gradient `(135deg,#8a8af2,#5b5bd6)→(#38bdf8,#0284c7)` ×4 (auth/brand/pos-banner/set-save) · `rgba(91,91,214,→rgba(2,132,199,` (hover/ring/shadow) · tint `#eef0ff→#e0f2fe` / `#e2e4fb→#bae6fd` / text ramp `#4949b8→#0369a1` `#33338f→#075985` `#6363c9→#0284c7` · wash 424 → `#e4ecf7→#e9f3fa→#f3f8fc` · dark hero 422 → `#0f3049/#1d567c` + text ฟ้า. **(2) phase4-design-system** primary scale revert กลับชุด sky เดิมทั้งบล็อก + **phase4-components** ring กลับ `rgba(14,165,233,.1)`. **(3) dashboard.js** `BLUE_PALETTE` revert sky เดิม · `#5b5bd6→#0284c7` (KPI accent/sparkline/dots/donut/Chart.js) · tile/icon `#eef0ff→#e0f2fe` `#4949b8→#0369a1` · donut track `#f1f0fa→#eef4f9` · trend fill rgba → sky. **(4) pos.js** กล่องยอดจ่าย gradient → `(#0284c7,#0ea5e9)` เดิม + hover/bank tint → sky. **(5) customer_dashboard.js** ternary `'#5b5bd6'→'#0284c7'` + border/accent/gradient/slip-btn → sky เดิม + spec `#4949b8→#0369a1`. **(6) hr_overview.js** `.hrx-hero` (indigo เก่าก่อนยุค redesign: `#eef0ff/#f5f6ff` + เงา `rgba(79,70,229,.32)`) → ฟ้า `#f2f8fd/#e0f2fe` + `rgba(2,132,199,.25)`. **bump 431 ครบ** (data-app-build/?v=×4/sw comment+cache-v431). **Guards:** `ui_theme_guard` ปรับด้าน — ล็อกค่าฟ้า + ห้าม indigo ตกค้าง (tokens/421 block/426 blocks/427 customer_dashboard/phase4) · `dashboard_readonly_guard` 430→431. **ไฟล์ (14):** style.css · phase4 ×2 · modules ×4 (dashboard/pos/customer_dashboard/hr_overview) · index.html (?v=) · sw.js · tests ×2 · docs ×3. **Verification จริง:** lint:errors **0** · unit **1570/1570** (รวม guards ทีม receipts 428-430) · e2e **14/14** · grep indigo ตกค้างทั้ง repo (นอก tests/docs) = **0**. **❌ ไม่แตะ:** โครง layout/markup ทุกเฟสก่อนหน้า · สี semantic (ส้ม CTA/สถานะ/doc-type) · เงิน/สต็อก/บัญชี · main.js. **Known risks:** (1) ยังไม่ render วัดจริง — owner ดู preview (dashboard/login/POS จ่ายเงิน/HR overview + dark mode) (2) คิวไล่สีหน้าที่เหลือเปลี่ยนความหมายเป็น "normalize เป็น var(--primary2)" (สีถูกแล้ว ไม่เร่ง — ทำเมื่อแตะหน้านั้นครั้งหน้า). **✅ merged = build 431 live (2026-06-13) — owner ดู preview (screenshot POS โทนฟ้า) + สั่ง "ถ้าเทสผ่าน ก็ merge ได้" · CI Tests+Deploy success · live verified data-app-build=431. เทคนิค merge: `git push origin claude/phase-431-blue-skin:main` (ff บน remote ตรง ๆ) เพราะ switch ไป main ไม่ได้ — ทีมขนานมีไฟล์แก้ค้างใน worktree ทับกับ dashboard.js/customer_dashboard.js (กติกา owner 2026-06-13: "ต่างคนต่างแก้งานตัวเอง ไม่ push งานเขาปนเข้างานเรา" — local main ref ค้างที่ d59e371 ไม่เป็นไร, fetch แล้ว origin/main ถูกต้อง).**

**Prev (427):** 12 มิถุนายน 2026 (Phase 427 remove-help-fab + sweep-customer-dashboard — **build 427**, **UI · display-only**) · owner ส่งภาพแคตตาล็อกแอร์ + สั่ง "ลบคำแนะนำออก / อยากได้หน้า AI ไว้หน้าหลักหน้าเดียวแยกออกมา / งานอื่นทำตามแผน" → สืบแล้ว: ปุ่มหลอดไฟ = `#bs-help-fab` (modules/help_tutor.js, mount ใน main.js:1077) ส่วนไอคอนกลม 2 ตัวขอบขวากลางจอในภาพ **ไม่ใช่ของแอป** (น่าจะ Edge sidebar/Copilot — `#bs-ai-fab` ผู้ช่วยช่างถูก gate เฉพาะ route งานช่าง desktop: solar/ac_install/service_* ไม่โชว์บนแคตตาล็อก). **(1) ถอด help tutor FAB:** main.js 3 จุด (import :47 / setHelpContext :781 / mountHelpButton :1077 → คอมเมนต์ระบุ Phase 427) — โมดูลคงไว้ dormant; ไม่มี test อ้าง; CSS hide rule เดิมใน style.css คงอยู่ (harmless). **การตีความ "หน้า AI หน้าเดียว":** AI ขายแอร์มีหน้าแยกอยู่แล้ว (`ai_sales` ในกลุ่ม หน้าร้านแอร์ ติดกับ หน้าหลัก จาก Phase 425) + FAB ผู้ช่วยช่างคงไว้ตาม gating (คนละระบบ ใช้หน้างานช่าง) — **ไม่ได้แตะ ai-chat-widget.js** + guard ล็อก gating ไว้. **(2) ไล่สี customer_dashboard.js ครบ 38 จุด** (replace_all ตาม pattern): accent-color radio ×3 · border 2px/dashed/left ×6 · gradient hero `#8a8af2→#5b5bd6` + ปุ่มแนบสลิป `#eef0ff→#e0e3fd` · `background:#0284c7` ×2 · `color:#0284c7` ×~18 → var(--primary2) · ternary `'#0284c7'` ×4 (แท็บ active/step indicator/ปุ่มสั่งจอง) → `'#5b5bd6'` · `#0369a1` สเปก → `#4949b8` — **คงไว้:** tile สินค้าฟ้าอ่อน (#e0f2fe ธีมแอร์ ไม่อยู่ใน 38 จุดนี้), CTA ส้ม, สถานะ; รวม checkout/cart branch ที่ dormant (build 348) ด้วยเพื่อความสม่ำเสมอ. **bump 427 ครบ** + dashboard_readonly_guard→427 + ui_theme_guard +1 (PHASE 427: main.js unwired ×3 + gating `#bs-ai-fab` solar ต้องคงอยู่ + customer_dashboard sky=0). **ไฟล์ (9):** main.js (3 คอมเมนต์) · modules/customer_dashboard.js · index.html (?v=) · sw.js · tests ×2 · CHANGELOG · SESSION_START · HANDOFF. **Verification จริง:** lint:errors **0** · unit **1567/1567** · e2e **14/14**. **❌ ไม่แตะ:** ai-chat-widget.js / `#bs-ai-fab` gating · help_tutor.js (ไฟล์คงอยู่) · ธีมการ์ดสินค้า/CTA · เงิน/สต็อก/บัญชี. **Known risks:** (1) help tutor หายทุกหน้า — ถ้า owner อยากได้กลับบางหน้าต้อง re-mount (2) ไอคอนกลม 2 ตัวในภาพถ้าไม่หายหลัง deploy = ของ browser ไม่ใช่แอป (แจ้ง owner แล้ว) (3) ยังไม่ render วัดจริง — owner ดู preview หน้า หน้าหลัก/แคตตาล็อก. **คิวไล่สีต่อ:** products 35 → hr_overview 16 → payroll 13 → leave_management 13 → delivery_invoices 12 → quotations 11 → service_jobs 10 → รายย่อย (sales_heatmap 9 / hr_forms 9 / doc-utils 8 — doc-utils ระวังสีเอกสารพิมพ์). **✅ merged เข้า main แล้ว (owner สั่ง "merge ได้" → session ขนาน ff ให้พร้อมงาน receipts ของเขา 2026-06-12) — ตามด้วย build 428 `829a990` Surface receipt restore failures + build 429 `967d5da` Align receipt filter counts (ทีมขนาน, bump ครบ, CI เขียว) = build 429 live (verified HTML จริง). Note: งาน receipts ที่เคยติด `git add -A` ของผม → ถอดออกถูกต้อง แล้วทีมเดิม commit เองเรียบร้อย — ไฟล์ไม่หาย.**

**Prev (426):** 12 มิถุนายน 2026 (Phase 426 trim-shortcuts + color-sweep-r1 — **build 426**, **UI · markup+CSS display-only**) · owner: "ทางลัดตัดออกได้ เยอะเกิน ดูรก + ไล่เก็บสีทีละหน้า" → branch `claude/phase-426-trim-shortcuts-color-sweep`: **(1) ตัดหมวด "ลัด"** (label + ปุ่ม 5: quickAddProduct/Customer/Quotation/ServiceJob/quickOpenReceipt) ออกจาก index.html — ตรวจแล้ว main.js อ้างทุกจุดแบบ null-safe (`if ($(...))` บรรทัด 843-847 + `?.addEventListener` 4532-4536) → ไม่แตะ main.js (dead bindings ปลอดภัย); ไม่มี test อ้างปุ่มพวกนี้. **(2) ไล่สี sky→indigo เฉพาะ skin:** style.css 14 จุด (auth-logo/auth-logo-img/brand-badge gradient+shadow · pos-banner · pos-action-icon-wrap/pos-pay-method-btn:active/pos-numpad-btn:active `#e0f2fe→#eef0ff` · prod-more-active · set-save-btn gradient+shadow ×2 · focus ring `rgba(2,132,199,.12)` ×2 · gs-item-amount/bsk-tag.active → var(--primary2) · hover rgba `.08` ×2 + dash-clickable shadow `.15`) + pos.js 6 จุด (VAT span/bank picker border+bg/COA text/pay amount box gradient `#5b5bd6→#8a8af2`/customer note/inline hover `#dbeafe→#eef0ff`). **หลักการ: คง semantic colors** — กล่อง info (pos.js L252), ป้ายสถานะฟ้า, `.doc-*.inv` (อัตลักษณ์เอกสารพิมพ์ — ใบแจ้งหนี้น้ำเงิน) + `.tc-self-action-card--closed` (info card time-clock) **ไม่แตะ** และ guard ล็อก `.doc-page-badge.inv` ต้องคง `#0284c7`. **bump 426 ครบ** + dashboard_readonly_guard→426 + ui_theme_guard +1 (PHASE 426: ปุ่มลัดหาย 5 + skin 4 class ไม่มี sky + doc color คงเดิม). **ไฟล์ (8):** index.html · style.css · modules/pos.js · sw.js · tests ×2 · CHANGELOG · SESSION_START. **Verification จริง:** lint:errors **0** · unit **1563/1563** · e2e **14/14**. **❌ ไม่แตะ:** main.js/JS logic · checkout/เงิน/สต็อก · doc-print colors · dark tokens. **Known risks:** (1) ยังไม่ render วัดจริง — owner ดู preview (หน้า login, POS จ่ายเงิน/โอน, settings ปุ่มบันทึก) (2) สี sky ในโมดูลอื่นยังเหลือ — คิวถัดไป: customer_dashboard 38 · products 35 · hr_overview 16 · payroll 13 · leave_management 13 · delivery_invoices 12 · quotations 11 · service_jobs 10 (ทีละหน้า ทีละ commit). **⏸️ STOP — push + preview แล้ว รอ owner ดู + สั่ง merge หรือสั่งไล่หน้าต่อ (ห้าม push main).**

**Prev (425):** 12 มิถุนายน 2026 (Phase 425 sidebar-reorganization — **build 425**, **UI nav · index.html markup-only**) · owner ส่งภาพ sidebar + ขอ "จัดระเบียบเอกสารด้านข้าง" → branch เดิม `claude/phase-424-bg-tint` (รวม 424+425 รอ merge ด้วยกัน): ยุบเมนูเดี่ยว 16 ปุ่มเข้ากลุ่ม + หัวข้อหมวด 4 (`nav-group-label`): **งานประจำวัน** dashboard/team_center/pos/tasks/calendar (ลอยเหมือนเดิม — calendar ย้ายขึ้นจากท้ายลิสต์) → **งานหลัก**: sales group +3 (quote_templates/serials/warranty_report) · service group +1 (service_request วางหลังใบรับงาน) · products group +5 (stock_movements/stock_in_wizard/stock_count/stock_value/dead_stock ต่อท้ายคลังรถ) · กลุ่มใหม่ `customers_crm` (customers/birthdays/loyalty) → **การเงิน / รายงาน**: finance + accounting + overview + hr (4 กลุ่มเดิมย้ายมารวมโซน — **byte ภายในเดิมทุกกลุ่ม**; hr ห้ามแตะเพราะ hr_forms_guard ใช้ extractBetween) → **หน้าร้านแอร์ / เครื่องมือ**: กลุ่มใหม่ `air_shop` (customer_dashboard/ai_sales/ac_shop — label ปุ่มเดิมทุกตัว ไม่เปลี่ยน wording) + กลุ่มใหม่ `tools` (btu_calculator/error_codes ×3) → ตั้งค่า + ลัด/dark mode/logout เดิม. **กลไกไม่ต้องแก้:** main.js bind `.nav-group-toggle` + role-filter (`.nav-group` ซ่อนเมื่อ subs ถูกซ่อนหมด) เป็น generic — กลุ่มใหม่ทำงานทันที; มือถือใช้ sidebar ตัวเดียวกัน (drawer ผ่าน #menuToggle) ได้ผลด้วย. **bump 425 ครบ** (data-app-build/?v=×4/sw comment+cache-v425/dashboard_readonly_guard→425). **Guard:** `ui_theme_guard` +1 test PHASE 425 (กลุ่มใหม่ 3 · route ย้าย 19 ตัวต้องเป็น `nav-btn sub` · ปุ่มหลัก 6 ตัวคงลอย · loyalty ปรากฏครั้งเดียว — กันหาย/ซ้ำ). **ไฟล์ (7):** index.html (sidebar block + ?v=) · sw.js · tests ×2 · CHANGELOG · SESSION_START · HANDOFF. **Verification จริง:** lint:errors **0** · unit **1562/1562** (hr_forms_guard ผ่าน = กลุ่ม HR intact) · e2e **14/14**. **❌ ไม่แตะ:** main.js/JS ทุกไฟล์ · data-route values · mobile bottom-nav · CSS (label ใช้ของเดิม 421) · เงิน/สต็อก/บัญชี. **Known risks:** (1) muscle memory เปลี่ยน — เมนูที่เคยลอย (เช่น ลูกค้า, ประวัติสต็อก) ต้องกดเปิดกลุ่มก่อน 1 คลิก; owner ตัดสินบน preview (2) role อื่น (sales/technician) เห็นกลุ่มตาม route ที่ตัวเองมีสิทธิ์ — ควร smoke 1 role non-admin ว่ากลุ่มยุบ/โชว์ถูก (3) ยังไม่ render วัดจริง — รอ owner ดู preview. **✅ merged ff `01f3c09` = build 425 live (2026-06-12) — owner ดู preview แล้วสั่ง merge · CI Tests+Deploy success · live verified data-app-build=425 + data-group="customers_crm" ใน HTML จริง (smoke checklist เต็มบน live ค้างให้ owner ยืนยัน — รายการอยู่ใน Known risks).**

**Prev (424):** 12 มิถุนายน 2026 (Phase 424 workspace-wash — **build 424**, **UI · CSS-only**) · owner feedback หลัง 423 live: "พื้นหลังสว่างเกิน เพิ่มสีหน่อย" → branch `claude/phase-424-bg-tint`: (1) `--bg` `#f5f5fb → #eaedf8` (indigo tint ลึกขึ้น — กระทบทุก surface ที่ใช้ var(--bg): hover/inset/tabs ตามตั้งใจ) (2) block "PHASE 424" ท้าย style.css: `body` light theme = wash gradient `160deg #e8ebf8 → #eee9f6 (55%) → #f5ecf1` (ม่วง→ชมพูอ่อนตามภาพ reference ที่ owner ส่งตอนแรก; ไม่ใช้ background-attachment:fixed กัน jank มือถือ; html ยังเป็น var(--bg) เนียนกัน overscroll) + `[data-theme="dark"] body { background: var(--bg) }` คงเรียบ (3) bump 424 ครบ (data-app-build/?v=×4/sw comment+cache-v424/dashboard_readonly_guard→424) (4) `ui_theme_guard`: assertion `--bg`→`#eaedf8` + test ใหม่ PHASE 424 (wash gradient มีจริง + dark เรียบ). **ไฟล์ (7):** style.css · index.html (?v=) · sw.js · tests ×2 · CHANGELOG · SESSION_START. **Verification จริง:** lint:errors **0** · unit **1561/1561** · e2e **14/14**. **❌ ไม่แตะ:** JS/markup · dark tokens · phase4-*.css · เงิน/สต็อก/บัญชี. **Known risk:** hero `.dash-today--brand` (#eef0ff) จะกลืนกับพื้นใหม่ขึ้นเล็กน้อย — ถ้า owner รู้สึกจืดให้ขยับ hero เข้มขึ้นเป็น tweak ถัดไป. **⏸️ STOP — push branch + preview แล้ว รอ owner ดู + สั่ง merge (ห้าม push main).**

**Prev (423):** 12 มิถุนายน 2026 (Phase 423 mock-F-finishing-pass — **build 423**, **UI dashboard · display-only — dashboard.js คง read-only guard เขียว**) · เฟสปิดท้ายชุด ui-redesign ตาม owner สั่ง "ทำให้จบ ค่อย merge" — branch เดิม `claude/phase-421-ui-skin-tokens-sidebar` (3 commits: 421 skin / 422 layout / 423 finishing). **(1) การ์ด "📌 ต้องทำวันนี้"** — รวม 2 การ์ดเดิม ("📅 วันนี้" + "🚨 ที่ต้องดู") เป็นใบเดียวใน `_renderTodayAndAlerts`: `todoRows[]` สร้างจากเงื่อนไข/ตัวนับเดิมทุกตัว (todayJobs/overdueJobs/**lowStock — ย้ายมาจาก hero chip**/expSoon/overdueCredit/overdueRecurring) แถวละเรื่อง icon สี่เหลี่ยม pastel + title/sub + `dash-clickable[data-go]` เดิม (service_jobs/products/quotations/credit_tracker/recurring_expenses) + chip "N เรื่อง" แดง / "ไม่มีค้าง" เขียว; **early-return "" ถูกถอด** — การ์ดแสดงเสมอ (empty state "ทุกอย่างปกติ"); hero status chip เป็น static `ok ✓ เชื่อมต่อฐานข้อมูลแล้ว` (warn ของใกล้หมดย้ายเข้า todo การ์ด). **(2) โดนัท "ยอดขายแยกตามช่องทาง (เดือนนี้)"** ข้างการ์ด todo (grid auto-fit เดิม): **SVG ล้วน** (stroke-dasharray, ไม่แตะ Chart.js lifecycle) — รวม `total_amount` ของบิลเดือนนี้จาก `visibleSalesForRole` (ข้าม `[ลบแล้ว]`) group ตาม `payment_method` (map คำไทย cash/transfer/promptpay/card/credit/multi/cod; ค่าอื่น escapeHtml; ว่าง+is_credit→เครดิต) top 4 + "อื่น ๆ"; legend % + ฿moneyShort; **caption บังคับ "จากบิลที่โหลดล่าสุด (~50) — ไม่ใช่ทั้งระบบ"** (Phase 396 honesty) + empty state; **ไม่มีสูตรเงินใหม่** — reduce เพื่อแสดงเท่านั้น (pattern เดียว expByCat เดิม). **(3) stat tiles:** `_kpiCard` เพิ่ม optional `icon/iconBg/iconFg` → `.kpi-tile` (grid icon-circle 38px ซ้าย + label/value ขวา) — **บรรทัด `const goAttr...` ที่ dashboard_ui_guard ล็อกไว้ ไม่ถูกแตะ**; caller 9 ใบย้าย emoji จาก label เข้า icon วงกลมสี. **(4) quick row กระชับ:** override `.dash-quick` → `repeat(6, minmax(0,150px)) + justify-content:space-evenly` (จอกว้างไม่กระจาย; มือถือ ≤700px คง 3 คอลัมน์). **CSS:** block "PHASE 423" ต่อท้าย (dash-todo-*/dash-chan-*/kpi-tile — token-driven dark-safe). **bump 423** (data-app-build/?v=×4/sw comment+`cache-v423`/dashboard_readonly_guard→423). **Guards:** `ui_theme_guard` +1 test PHASE 423 (css 4 class · การ์ดรวมมีจริง · markup title เดิม `ที่ต้องดู ${` หายไป (คอมเมนต์ยังอ้างได้) · donut + honest caption · hero chip static ok · routes ครบ 5) — รอบแรก fail เพราะ assertion เข้มเกิน (`!includes("ที่ต้องดู")` ชน comment) → แก้เช็ค markup pattern แทน. **ไฟล์ (8):** modules/dashboard.js · style.css · index.html (?v=) · sw.js · tests/ui_theme_guard.test.js · tests/dashboard_readonly_guard.test.js · CHANGELOG.md · SESSION_START_SHARED.md. **Verification จริง:** lint:errors **0** · unit **1560/1560** · e2e **14/14** · dashboard guards (readonly + ui_guard ครบทุก hook/canvas id/route) เขียว. **❌ ไม่แตะ:** สูตร/ตัวเลขเงินเดิม · fetch/state mutation · chart canvas ids + wiring · pendingOrders/lowstock widget/topsellers/pro-grid sections · phase4-*.css · เงิน/สต็อก/บัญชี/SQL. **Known risks:** (1) ยังไม่ render วัดจริง — **owner smoke preview เป็น gate สุดท้าย** (light+dark+มือถือ 390px: การ์ด todo แถวกด, โดนัท legend ไม่ล้น, tiles 9 ใบ) (2) ชื่อช่องทางมาจาก payment_method ดิบ — ถ้าข้อมูลจริงมีค่าแปลก จะโชว์ตามจริง (escape แล้ว) (3) การ์ด todo แสดงเสมอ (เดิมหายไปเมื่อไม่มีเรื่อง) = พื้นที่เพิ่มเล็กน้อยตอนว่าง. **Next:** owner smoke → **merge 421+422+423 เข้า main ทีเดียว** (ff) + verify live + stamp docs. **✅ merged ff `f9bfcc0` = build 423 live (2026-06-12) — owner ดู preview แล้วสั่ง merge (smoke checklist เต็มบน live ยังไม่ได้รายงาน — รายการอยู่ใน Known risks ข้อ 1) · CI Tests+Deploy success · live verified data-app-build=423 / style.css?v=423.**

**Prev (422):** 12 มิถุนายน 2026 (Phase 422 mock-F-dashboard-layout — **build 422**, **UI dashboard · display-only**) · ต่อยอด 421 บน branch เดียวกัน `claude/phase-421-ui-skin-tokens-sidebar` หลัง owner ดู preview แล้วบอก "ยังไม่เหมือน mockup" — ส่วนที่ขาดคือ layout หน้า dashboard. **(1) `modules/dashboard.js`:** helper ใหม่ `_quickActions()` + `const QUICK_ACTIONS` (6 ปุ่ม: pos/service_jobs/quotations/customers/products/income_overview — emoji ในวงกลมสี pastel + label) แทรกใต้ `_dashHeader` เหนือ hero; ทุกปุ่ม `class="dash-quick-btn dash-clickable" data-go=...` = ใช้ click-binding เดิมของหน้า (querySelectorAll `.dash-clickable[data-go]` → showRoute) — **ไม่มี handler/fetch/state ใหม่ → `dashboard_readonly_guard` เขียวโดยไม่แก้ invariant**; hero เปลี่ยน `class="dash-today"` → `"dash-today dash-today--brand"`; สี display sky→indigo ทั้งไฟล์: KPI accent+valueColor+sparkline `#0284c7→#5b5bd6`, การ์ด "วันนี้" border/heading/icon-circle (`#33338f`/`#eef0ff`/`#4949b8`), `.pro-title`+dots+strong → `var(--primary2)`/`#5b5bd6`, `BLUE_PALETTE` → indigo ramp 8 ค่า, job-status progress/in_progress → `#5b5bd6`, Chart.js bar "เก็บเงินแล้ว" + เส้น "รายได้" (`borderColor #5b5bd6` + `rgba(91,91,214,.08)`), ธุรกรรมล่าสุด amount + สินค้าขายดี revenue → `var(--primary2)`, top-1 bg `#eff6ff→#eef0ff` — **ตัวเลข/เงื่อนไข/สูตรเงินไม่แตะแม้ตัวเดียว**. **(2) `style.css` block "PHASE 422"** ต่อท้าย 421: `.dash-quick` (grid 6 คอลัมน์ · มือถือ ≤700px → 3 คอลัมน์) + `.dash-quick-btn/-ic/-label` (วงกลม 44px hover token) + `.dash-today--brand` (พื้น `#eef0ff` ขอบ `#e2e4fb` ตัวหนังสือ indigo ramp + `[data-theme="dark"]` variant `#262650`/`#3a3a7a` — border shorthand ทับ border-left 4px ของ 389 โดย cascade). **(3) bump build 422:** data-app-build + `?v=422` ×4 (style/selfheal/main/boot — **phase4-*.css คงไว้ 421** เพราะไม่ได้แก้ และ e2e ALL-?v= spec ระบุ skip phase4 เป็น independent cadence) + sw.js comment v422 + `CACHE_NAME cache-v422` + `dashboard_readonly_guard` → 422. **(4) guards:** `ui_theme_guard` +1 test (PHASE 422 section + `.dash-quick`/`.dash-quick-ic`/`.dash-today--brand`+dark · `QUICK_ACTIONS` ครบ 6 route · ปุ่มต้องมี `dash-quick-btn dash-clickable` · hero ต้องมี modifier) · `dashboard_ui_guard` แก้ regex 1 จุดแบบ intent คงเดิม: `/class="dash-today( dash-today--brand)?"/` (ของเดิม fail เพราะ literal ต้องปิด quote — gradient-hero-gone check อื่นคงเดิมทั้งหมด). **ไฟล์ (8):** modules/dashboard.js · style.css · index.html (?v=) · sw.js · tests/ui_theme_guard.test.js · tests/dashboard_ui_guard.test.js · tests/dashboard_readonly_guard.test.js · docs ×3. **Verification จริง:** lint:errors **0** · unit **1559/1559** (รอบแรก fail 1 ที่ dashboard_ui_guard ตามคาด → แก้ regex แบบคง intent → เขียว) · e2e **14/14**. **❌ ไม่แตะ:** สูตร/ตัวเลขเงินทุกตัว · fetch/state (read-only invariant) · KPI counts grid · pendingOrders/lowstock/topsellers sections · phase4-*.css · เงิน/สต็อก/บัญชี/SQL. **Known risks:** (1) ยังไม่ render วัดจริง — รอ owner smoke preview (Iron Rule #3) ทั้ง light/dark + มือถือ 390px (.dash-quick 3 คอลัมน์) (2) แบบ F บางส่วนยังไม่ทำ: สถิติ tile แบบ icon-circle, รวมการ์ด "วันนี้/ที่ต้องดู" เป็น "ต้องทำวันนี้" ใบเดียว, donut ช่องทางขาย — ถ้า owner อยากได้ = Phase 423 (3) เมนูด่วน chip แถวล่างของ mockup ไม่ทำ (ซ้ำกับปุ่มวงกลมบน). **Next:** owner smoke → merge 421+422 พร้อมกัน หรือสั่งปรับเพิ่ม. **⏸️ STOP — branch `claude/phase-421-ui-skin-tokens-sidebar` (2 commits) รอ owner review + preview smoke (ห้าม push main).**

**Prev (421):** 12 มิถุนายน 2026 (Phase 421 ui-skin-refresh — **build 421**, **UI · CSS-only — ไม่แตะ JS/logic/markup/เงิน/สต็อก/บัญชี/SQL**) · ทิศทางจาก mockup **"แบบ F"** ที่ owner เลือกในแชต (โครงตามภาพอ้างอิง ERP + โทน indigo, sidebar ขาว) — เฟสนี้ = เฟสแรก (tokens + sidebar skin) เท่านั้น, dashboard layout = Phase 422 แยก. **(1) tokens `style.css :root`:** `--bg #f3f5f8→#f5f5fb` (lavender) · `--line #e5e7eb→#e9e9f2` · `--primary #0ea5e9→#6b6be0` · `--primary2 #0284c7→#5b5bd6`; dark theme: `--primary #38bdf8→#8a8af2` · `--primary2 #0ea5e9→#6b6be0` (token อื่นเดิมรวม `--shadow` ที่ guard ล็อกไว้). **(2) appended block "PHASE 421"** ท้าย `style.css` (ชนะ cascade เหนือ Phase 386 — pattern เดียวกับ 386/389 รีวิว/revert เป็นก้อนเดียว): `.sidebar` จาก dark gradient → `background: var(--surface)` + `border-right: 1px solid var(--line)` + `color: var(--text)`; `.nav-btn`/`.nav-btn.sub`/`.nav-group-toggle` = `var(--muted)`, hover/sub-active = `rgba(91,91,214,.10)` + `var(--primary2)`; **`.nav-btn.active` = `var(--primary2)` ทึบ ตัวขาว + `box-shadow:none`** (ตัด inset accent ของ 386); `.user-box`→`var(--bg)`+border · `.user-role`→`var(--primary2)` · `.nav-group-label`/`.sidebar-sub`→muted; dark override: nav text `#cbd5e1`, label `#94a3b8` (sidebar dark = `--surface #1e293b` อัตโนมัติ). **(3) `phase4-design-system.css`:** สเกล `--primary-50..900` sky→indigo (`500 #6b6be0` / `600 #5b5bd6` / `700 #4949b8` ฯลฯ — `--btn-primary-*`/`--input-border-focus` ใน components ชี้ token พวกนี้อยู่แล้วเลยเปลี่ยนตามหมด) + `phase4-components.css` focus ring `rgba(14,165,233,.1)→rgba(91,91,214,.12)` (จุดเดียว). **(4) bump build 421 ครบ:** `data-app-build="421"` + `?v=421` ที่ style/selfheal/main/boot **+ phase4-design-system (เดิม v=1) + phase4-components (เดิม v=2)** + sw.js comment v421 + `CACHE_NAME cache-v421` + `dashboard_readonly_guard` → 421. **+guard ใหม่ `tests/ui_theme_guard.test.js`** (4 tests: light tokens · dark tokens + ห้ามมี sky token ตกค้าง · block PHASE 421 มีจริง + sidebar ใช้ token + active pill indigo + `box-shadow:none` + ห้ามมี rgba sky ใน block · phase4 scale sync — กัน phase หลัง revert ทิศทางเงียบ ๆ). **ไฟล์ (9):** style.css (tokens 2 จุด + append ~50 บรรทัด) · phase4-design-system.css (10 บรรทัด) · phase4-components.css (1) · index.html (เฉพาะ `?v=` 6 จุด + data-app-build) · sw.js (comment + CACHE_NAME) · tests/dashboard_readonly_guard.test.js (420→421) · +tests/ui_theme_guard.test.js · CHANGELOG.md · SESSION_START_SHARED.md. **Verification จริง:** lint:errors **0** · unit **1558/1558** pass · e2e **14/14** pass (รวม build-version-sync specs ที่บังคับ ?v= ตรง data-app-build). **❌ ไม่แตะ:** JS ทุกไฟล์ (modules/main/boot/selfheal) · markup index.html (นอกจาก ?v=) · dashboard.js/layout (Phase 422) · เงิน/สต็อก/บัญชี/POS/SQL/schema · `--shadow`/`--radius` tokens. **Known risks/residual:** (1) สี sky hardcode รายจุดนอก scope ยังอยู่ — `.bsk-tag.active`/`.gs-item-amount` `#0284c7`, `.auth-logo`/`.brand-badge`/`.sidebar-logo` gradient sky, `.hero` gradient sky (dashboard เดิม — จะถูกแทนใน Phase 422), `.nav-group.open` สี `#38bdf8` (โดน block ใหม่ override แล้ว) → เก็บกวาดเป็น polish phase (2) **ยังไม่ได้ render วัดจริงใน session นี้** (Iron Rule #3) — e2e เป็น static checks; ต้อง owner smoke บน preview ทั้ง light+dark + มือถือ 390px ก่อน merge (3) สี indigo บนหน้าเงิน (POS pay screen ตัวเลขใหญ่ ฯลฯ ที่ใช้ `var(--primary2)`) เปลี่ยนเป็น indigo ทั้งหมดโดยเจตนา — owner ดูบน preview ว่าโอเคไหม. **Next:** **Phase 422 — dashboard layout ตามแบบ F** (แถวปุ่มลัดวงกลม 6 ปุ่ม + hero ยอดขายวันนี้ + การ์ด "ต้องทำวันนี้" จากข้อมูล `_renderTodayAndAlerts` เดิม + จัดกลุ่ม KPI — แตะ `modules/dashboard.js` render markup (read-only invariant คงเดิม) + CSS block ใหม่). **⏸️ STOP — push branch `claude/phase-421-ui-skin-tokens-sidebar` แล้ว รอ owner review + preview smoke ก่อน merge (ห้าม push main).**

**Prev (420):** 12 มิถุนายน 2026 (Phase 420 hr-forms — **build 420**, **HR · additive — ไม่แตะเงิน/สต็อก/บัญชี/POS/payroll**) · ⚠️ เลข **build 419 ถูกใช้แล้ว**โดยทีม mobile drafts (commits ตรงบน main `0117013`/`9b651af`/`369ab2f`/`1cf2b66`/`e3930bf` — inventory/technician mobile drafts + service cancel stock-restore order + doc-delete acct order) → งานนี้ = **420**. 🔁 **งานกู้จาก worktree agent ที่ตายกลางทาง** (เดิม spec เป็น 419 ทำไว้ ~80%): กู้ 3 ไฟล์ใหม่ (`modules/hr_forms.js` 1030 บรรทัด / SQL / guard test) มาตรวจกับสเปก + rename SQL phase419→**phase420** + แก้ markers ทุกจุด แล้ว**ทำ wiring ใหม่บนฐาน `e3930bf`** (ไม่ apply patch เก่าตรง ๆ — main.js/index.html เปลี่ยนจากทีม 419 แล้ว). **2 หน้าใหม่กลุ่ม บุคลากร/HR (admin-only):** **(1) 📝 รับสมัครงาน `hr_applications` (`renderHrApplicationsPage`):** list + filter chips (new/interview/hired/rejected) + search ชื่อ/เบอร์/ตำแหน่ง (pure `filterApplications`) · ฟอร์มเพิ่ม/แก้ full_name* + phone/address/position/expected_salary/experience/applied_date (default `todayBkk()`)/note · **แนบรูปเอกสารหลายรูป** → upload Supabase storage **bucket `proofs` path `applications/`** (pattern expenses.js: `_compressImage` + x-upsert + public URL; upload ล้ม = แจ้งตรง ๆ ไม่ยัด base64) เก็บ `attachments` jsonb `[{url,label}]` + label เลือกได้ (บัตร ปชช./เรซูเม่/วุฒิ/อื่น ๆ) + thumbnail กดดูเต็มจอ (DOM API ไม่ inject HTML) · เปลี่ยนสถานะผ่าน select ต่อแถว — **hired → PATCH `hired_date=todayBkk()` + กล่องเตือน "อย่าลืมสร้างบัญชีผู้ใช้พนักงานใหม่ที่ ตั้งค่า → ตั้งค่าผู้ใช้งาน" (❌ ไม่ auto-สร้าง user / ไม่มี auth admin call)**; ออกจาก hired → ล้าง hired_date · พิมพ์ 2 แบบ (pattern `_printAllPayslips`: `window.open` + document.open/write/close + A4 CSS): **ฟอร์มเปล่ากรอกมือ** (ช่องครบทุก field + ที่ติดรูป 1 นิ้ว + checkbox เอกสารแนบ + ลายเซ็นผู้สมัคร/ผู้รับสมัคร) / **ใบสมัครพร้อมข้อมูล** (+สถานะ+วันเริ่มงาน+รายการเอกสารแนบ). **(2) 📤 ใบลาออก `hr_resignations` (`renderHrResignationsPage`):** ฟอร์ม employee_id (dropdown จาก `profiles` role≠customer — **GET read-only เท่านั้น** pattern payroll.js) + submitted_date (default วันนี้) + last_working_date (validate ≥ submitted) + reason/note · ปุ่ม **"✓ อนุมัติ"** (เฉพาะ status=submitted): `App.confirm` (ระบุชื่อ+วันสุดท้าย+ย้ำไม่ตัดอัตโนมัติ) → **PATCH `staff_resignations` เท่านั้น** (status=approved + approved_at=now ISO + approved_by=currentUser) → กล่องเตือน + **banner ค้างถาวรในแถว approved**: "⚠️ พนักงานยังอยู่ในรายชื่อ active — ไปปิดสถานะที่ ตั้งค่า → ผู้ใช้งาน เมื่อถึงวันทำงานวันสุดท้าย (DD/MM)" — **❌ ไม่มี PATCH/POST/DELETE ไป `profiles` แม้แต่จุดเดียว (guard ล็อก)** · พิมพ์หนังสือลาออกทางการ (หัวร้านจาก `storeInfo` + ข้อความมาตรฐาน + ลายเซ็นพนักงาน/ผู้อนุมัติ + วันที่อนุมัติถ้ามี). **ทั้งคู่:** `requireAdmin` ใน render (role อื่นเห็น error state) + admin-only ผ่าน ALL_ROUTES (role อื่นไม่มี route) · `logActivity` 7 actions (app create/update/status/delete + resig create/approve/delete) · ลบ = `App.confirm` ระบุชื่อ · ❌ ไม่มี `alert()`/native confirm · print builders pure + **escHtml ทุกค่าผู้ใช้** (รวม store header) · inflight guards `_appSaveInflight`/`_resigSaveInflight`/`_appUploadInflight` (+บล็อก save ระหว่าง upload). **SQL `supabase-phase420-hr-forms.sql` (⚠️ owner รันเองก่อน smoke — ❌ ยังไม่ apply):** `staff_applications` (15 cols; applied_date default Bangkok; attachments jsonb '[]'; CHECK new/interview/hired/rejected) + `staff_resignations` (11 cols; employee_id uuid NOT NULL; CHECK submitted/approved) + indexes ×4 + trigger updated_at + **RLS enable + policy admin-only `is_accountant()` FOR ALL ทั้ง 2 ตาราง** (pattern phase92-32 leave-management) + NOTIFY pgrst + verify queries (a)-(g) · ❌ ไม่มี ALTER/trigger/policy แตะ profiles. **Wiring:** main.js LAZY_ROUTES ×2 (หลัง leave_management) + ALL_ROUTES ×2 (admin เท่านั้นที่ได้ — role อื่น list แยก) + titles ×2 · index.html nav-btn ×2 ใต้ 💰 รายการเงินเดือน ในกลุ่ม `data-group="hr"` + section `page-hr_applications`/`page-hr_resignations` · **bump build 420**: data-app-build + ?v=420 ×4 (style/selfheal/main/boot — sweep `?v=` ทั้งไฟล์แล้ว 0 ตกค้าง) + sw.js comment v420 + `CACHE_NAME cache-v420` + dashboard_readonly_guard → 420. **Deviations จาก spec เดิม:** ไม่มีเชิงเนื้อหา — เปลี่ยนเฉพาะเลข build 419→420 + ชื่อไฟล์ SQL + วันที่ comment sw. **ไฟล์ (7):** +modules/hr_forms.js (1030) · +supabase-phase420-hr-forms.sql (179) · +tests/hr_forms_guard.test.js (319 — 21 tests: SQL 2 CREATE+RLS+policy+NOTIFY+CHECK+no-profiles / no alert·confirm / profiles GET-only / write targets ล็อก 2 ตาราง+storage / upload proofs+inflight / approve confirm+เตือนปิดสถานะ+no profiles / hired วันนี้+เตือนสร้าง user+no auto-create / logActivity 7 / print XSS unit จริง 3 builders / pure helpers / wiring LAZY+ALL_ROUTES+role-exclusion+nav+section / no POS·stock·journal refs) · main.js (+7) · index.html (+12/-4) · sw.js (+2/-1) · tests/dashboard_readonly_guard.test.js (420). **Verification จริง:** lint:errors **0** · unit **1529/1529** pass (รวม 21 ใหม่ + guards ทีม mobile drafts เขียวหมด) · e2e **14/14** pass (รวม `service-mobile-draft.spec.js` 2 ของทีม 419; หมายเหตุ: รัน e2e ติดกัน 2 instance อาจชน port — รอบ clean ผ่านหมด) · `git ls-files --eol` = LF ทุกไฟล์ที่แตะ · branch `claude/phase-420-hr-forms` จาก origin/main `e3930bf`. **❌ ไม่แตะ:** payroll.js/time_clock.js/leave_management.js/hr_overview.js · profiles (เขียน) · เงิน/สต็อก/บัญชี/POS/checkout · service_drafts/mobile drafts ทีม 419 · SQL execution · main (push branch เท่านั้น). **Known risks:** (1) **ตารางยังไม่มีจริงใน DB** — หน้าจะขึ้น error state พร้อมบอกให้รัน SQL จนกว่า owner รัน `supabase-phase420-hr-forms.sql` (ออกแบบไว้แล้ว ไม่ crash) (2) RLS ใช้ `is_accountant()` = admin-only ตาม spec — ถ้าอนาคตอยากให้ sales/hr role อื่นเข้าถึงต้องเพิ่ม policy ใหม่ (3) upload ต้องมี storage bucket `proofs` อยู่แล้ว (มีจริง — expenses ใช้) + RLS storage ของ bucket เดิมคุม path ใหม่ `applications/` ด้วยหรือไม่ owner ควร smoke upload จริง 1 รูป (4) attachments เก็บ public URL ของ bucket proofs — ใครได้ URL ตรงเปิดดูได้ (พฤติกรรมเดียวกับสลิป/บิล expenses เดิม ไม่ใช่ regression ใหม่) (5) ลบใบสมัครไม่ลบรูปใน storage (แจ้งใน confirm แล้ว — orphan files สะสมได้) (6) `_showInfoModal` แสดงผลตาม flow ปกติ; popup print ต้องอนุญาต popup เหมือนสลิปเดิม. **Owner ต้องทำก่อน smoke:** รัน `supabase-phase420-hr-forms.sql` ใน Supabase SQL Editor (+ตรวจ verify queries (a)-(g) ท้ายไฟล์). **Smoke checklist (preview):** (1) login admin → เมนู บุคลากร/HR เห็น "📝 รับสมัครงาน" + "📤 ใบลาออก"; login role อื่น → ไม่เห็น+เข้า route ตรงไม่ได้ (2) เพิ่มผู้สมัคร (ชื่ออย่างเดียว) → แสดงในลิสต์ สถานะ ใหม่ (3) แนบรูป 2 รูป (label ต่างกัน) → thumbnail ขึ้น กดดูเต็ม + บันทึก → reload ยังอยู่ (4) เปลี่ยนสถานะ → hired → เห็นกล่องเตือนสร้างบัญชี + วันเริ่มงานติดในแถว (5) พิมพ์ฟอร์มเปล่า + พิมพ์ใบสมัคร → A4 ครบช่อง ไม่มี HTML หลุด (ลองชื่อมี `<b>` ดู escape) (6) บันทึกใบลาออก (เลือกพนักงาน + วันสุดท้าย) → อนุมัติ → confirm → banner เหลืองค้าง + **ตรวจว่า user พนักงานนั้นยัง login ได้/ยัง active ใน ตั้งค่า → ผู้ใช้งาน (พิสูจน์ไม่แตะ profiles)** (7) พิมพ์หนังสือลาออก → หัวร้าน+ลายเซ็นครบ (8) audit log มี hr_application_*/hr_resignation_* (9) regression: หน้า วันลา/เงินเดือน/ลงเวลา เปิดปกติ + มือถือ 390px เมนู HR ไม่แตก. **✅ merged ff `e06882d` = build 420 live (2026-06-12) · review + SQL applied + smoke PASSED.**

**Prev (419 — ทีม mobile drafts, ไม่มี HANDOFF entry ของทีมนั้น):** inventory/technician mobile draft fix + cache bump 419 + service-mobile-draft e2e guard + service job cancel stock restore order + doc delete accounting order (`0117013`→`e3930bf` ตรงบน main)

**Prev (418):** 11 มิถุนายน 2026 (Phase 418 **Part C** payroll-history-and-print-all — build 418, **PAYROLL · MEDIUM — read-only + print เท่านั้น ไม่แตะ save/pay/JV**) · ชิ้นสุดท้ายของชุดเงินเดือน (416-A + 417-B merged+smoke PASSED แล้ว): ประวัติเงินเดือนย้อนหลังรายคน + ปุ่มพิมพ์สลิปทุกคนของรอบ. **(1) ประวัติรายคน (`modules/payroll.js` — `_openPayrollHistoryModal` ฟังก์ชันใหม่ วางก่อน `_bulkGeneratePayroll` ไม่ชน marker ของ guard 416/417):** ปุ่ม "📜 ประวัติ" ต่อแถว (ทางเลือก per-row button — diff เล็กกว่า tab ใน timesheet modal และเห็นชัดต่อพนักงานในตาราง) → modal read-only "ประวัติเงินเดือน — {ชื่อ}": เปิดโครง modal ก่อน (สถานะ "⏳ กำลังโหลด") → **GET ครั้งเดียว** `staff_payroll?select=*&employee_id=eq.{id}&order=period_start.desc.nullslast,period_month.desc.nullslast&limit=24` (แถวเก่าก่อน 416 ไม่มี period_start → ไปท้าย เรียงต่อด้วย period_month); fetch ล้ม → กล่อง error ใน modal ไม่ crash; `m.isConnected` เช็คก่อนเติม (ผู้ใช้ปิดระหว่างโหลด → no-op). คอลัมน์: รอบ (`formatPayPeriodLabel(period_start,end)`; fallback ชื่อเดือนไทยจาก `period_month` ผ่าน toLocaleDateString th-TH) + chip "รอบนี้" ถ้าตรงรอบที่เลือกบนหน้า · รวมสุทธิ (`total_amount` จาก DB GENERATED) · สถานะ (✓ จ่ายแล้ว + วันที่ / รอจ่าย) · ปุ่ม "🖨️ สลิป" → `_printPayslip(ctx, r.id, r)` ส่ง **row ตรง** (param ใหม่ `rowOverride` — เดิม lookup `_payrolls` ของรอบปัจจุบันอย่างเดียว ทำให้สลิปรอบเก่าออกไม่ได้) · แถวสรุปท้าย "รวมจ่ายแล้ว (จาก N รอบที่แสดง)" = ผลรวม total_amount เฉพาะแถว paid_at ไม่ null (label ซื่อตรง — จากที่แสดง ไม่เคลมทั้งระบบ). **(2) พิมพ์สลิปทุกคน (`_printAllPayslips` ใหม่ หลัง `_printPayslip`):** ปุ่ม "🖨️ พิมพ์สลิปทุกคน" ข้าง Excel แสดงเฉพาะ `_payrolls.length > 0` → รวมสลิปทุกแถวของรอบปัจจุบันเป็น HTML เดียว (ไม่ fetch — ใช้ rows ที่โหลดแล้ว) สลิปละ 2 หน้า ต้นฉบับ/สำเนา ห่อ `<div class="slip slip-paid|slip-pending">`; CSS เพิ่มเฉพาะใน print-all: `.slip .page:last-child{page-break-after:always}` + `.slip:last-child .page:last-child{avoid}` (แก้ `.page:last-child` ของ base ที่จะตัด page-break ระหว่างสลิป) + override สี `.pay-section/.pay-title/.pay-detail` ต่อสถานะ (base CSS bake สีจากสลิปแรกตัวเดียว — รอบผสมจ่ายแล้ว/รอจ่ายต้อง override) → `window.open` + print (pattern พิมพ์ HR report; ไม่แตะ hr_overview.js). **(3) ⭐ extract แบบ byte-preserving:** `buildPayslipStyleCss(p)` + `buildPayslipHtml(p, {emp,dept,store,logo})` exported pure ใหม่ — เนื้อ template **ย้ายด้วย script slice จาก source เดิมทั้งก้อน ไม่พิมพ์ใหม่** แล้ว `_printPayslip` ประกอบกลับ `${buildPayslipStyleCss(p)}` + `${buildPayslipHtml(...)}`; **พิสูจน์ runtime byte-identical กับ HEAD เดิม 5 เคส** (unpaid+period / paid+method+note / daily-rate / legacy-no-period / xss-name) ด้วย harness ชั่วคราว (eval template เก่าจาก `git show HEAD` เทียบ composition ใหม่ ตรงทุก byte) — layout/ข้อความสลิปเดิม 100%. **Deviations:** (ก) order เพิ่ม `,period_month.desc.nullslast` ต่อจาก spec เพื่อให้กลุ่ม null เรียงตามเดือนจริง (spec บอกแค่ "เรียงท้ายด้วย period_month") (ข) สรุปท้าย label "จาก N รอบที่แสดง" แทน "ทั้งหมด" (จำกัด limit 24 — ไม่โกหก) (ค) `_printPayslip` เพิ่ม optional param `rowOverride` (caller เดิมไม่ส่ง = พฤติกรรมเดิมเป๊ะ). **ไฟล์:** payroll.js (+246 บรรทัดสุทธิ) · index.html + sw.js (bump 418) · tests/dashboard_readonly_guard (418) · +tests/payroll_partc_guard.test.js (12: unit builders 4 [ชื่อ escape+ยอด+2 copy+label รอบ / fallback เดือน / daily×days+XSS note / CSS paid-pending+page-break] + source-regex 8 [history fetch ครั้งเดียว+order+limit / fallback+paidSum / สลิปส่ง row / rowOverride+compose / print-all loop+page-break+ว่าง / wiring / read-only ไม่มี method:POST·PATCH·PUT·DELETE+builders pure / no alert]). **Verification จริง:** lint:errors 0 (2 warn require-atomic-updates = ของเดิม HEAD) · unit **1493** pass (1481+12) · e2e **12/12** · guard 416 (12)+417 (13) เขียวครบ · EOL LF ทุกไฟล์ที่แตะ. ❌ ไม่แตะ: `_savePayroll`/`_bulkGeneratePayroll`/`_markPaid`/`postJournalForPayroll`/`_createSalaryExpense` · `computePayrollTotal`/`computePayPeriods`/`buildPeriodAttendanceMap` · ตาราง/คอลัมน์/การ์ด 417 · timesheet modal · hr_overview/time_clock/leave_management (import-only เดิม) · SQL/DB/package.json. **Known risks:** (1) ประวัติ fetch ที่ 24 รอบ — พนักงานเก่ามากเกิน 24 รอบจะไม่เห็นรอบแรกสุด (สรุปท้ายก็คิดจากที่แสดง — label บอกแล้ว) (2) print-all เปิด popup — browser block popup ต้องอนุญาตเหมือนสลิปรายคนเดิม (3) สลิปรอบเก่าใช้ snapshot ใน row เอง ถ้าข้อมูล profiles/departments เปลี่ยน (ลบแผนก) ชื่อแผนกจะ "-" ตาม lookup ปัจจุบัน (พฤติกรรมเดียวกับสลิปเดิม). **Owner/reviewer smoke ที่ต้องทำบน preview:** (1) หน้าเงินเดือน → กด "📜 ประวัติ" คนที่มีรายการหลายรอบ → เห็นรอบเรียงใหม่→เก่า + ยอด + สถานะ + chip รอบนี้; (2) กด "สลิป" จากแถวประวัติรอบเก่า (ไม่ใช่รอบที่เลือกอยู่) → สลิปออกถูกคน-ถูกยอด-ถูก label รอบ; (3) กด "🖨️ พิมพ์สลิปทุกคน" รอบที่มีหลายคน (ผสมจ่ายแล้ว/รอจ่าย) → print preview เห็นสลิปครบทุกคน คนละ 2 หน้า ขึ้นหน้าใหม่ทุกสลิป + สีส่วนสถานะถูกต่อคน; (4) สลิปรายคนเดิม (ปุ่มสลิปในตาราง) → เหมือนเดิมทุกประการ; (5) รอบว่าง → ไม่มีปุ่มพิมพ์ทุกคน; (6) regression 417: bulk draft / timesheet / คอลัมน์ วัน-OT-สาย-ลา ยังปกติ. **✅ MERGED → main (ff `5efd30f`) · live build 418 · Claude review+smoke PASSED 2026-06-11 (read-only verified: ประวัติ 2 รอบจริงเรียงถูก+chip รอบนี้+สรุปซื่อตรง · print-all จับ HTML จริง = 7 สลิปครบ ชื่อถูก page-break ทุกใบ · diff ไม่มี POST/PATCH/DELETE ใหม่ 0 hit · ข้อมูลเงินเดือนจริงของ owner/passamon ไม่ถูกแตะ). เดิมรอ review ก่อน merge. ห้ามเริ่ม phase ถัดไปเอง.**

**Prev (417):** 11 มิถุนายน 2026 (Phase 417 **Part B** payroll-period-full-screen — build 417, **PAYROLL · MEDIUM-HIGH — Part B ไม่แตะ pay/JV flow: สร้างร่าง + แสดงผลเท่านั้น**) · ต่อยอดหน้าเงินเดือนรอบตัด (416-A ซึ่ง merged + SQL applied + smoke PASSED แล้ว) ให้ครบจอตาม mockup ที่ owner อนุมัติ. **(1) Batch aggregation ต่อรอบ (`modules/payroll.js`):** `renderPayrollPage` fetch เพิ่ม 2 ก้อนใน `Promise.all` เดิม — `staff_attendance?work_date=gte.{start}&lte.{end}&limit=5000` + `staff_leaves?status=eq.approved&start_date=lte.{end}&end_date=gte.{start}&limit=1000` (ทั้งรอบครั้งเดียว ทุกคน — **ห้ามยิงต่อคน×หลายตาราง**; ทั้งคู่ `.catch(()=>null)` = advisory ไม่ block หน้า; flag `_attLoadOk/_leaveLoadOk` แยก → โหลด fail คอลัมน์โชว์ "—" ไม่โกหกเป็น 0) → pure export ใหม่ **`buildPeriodAttendanceMap(attRows, leaveRows, {shift, rules, periodStart, periodEnd})`** → `Map<user_id,{days,otHours,lateCount,leaveDays}>`: days = distinct work_date ที่มี clock_in (pattern `buildMonthlyHrReport`) · otHours = `sumRegularOT` เฉพาะ session ปิดแล้ว (เหมือน `fetchUserAttendanceSummary`) · lateCount = นับ row ที่ `classifyPunctuality` เป็น late/late_and_early_leave (per-row — session บ่ายของวันเดียวกันนับด้วย เหมือน `summarizePunctuality` ใน HR overview) · leaveDays = ลา approved clip ขอบรอบ (string compare + `calcLeaveDays`); period ไม่ valid → Map ว่าง. raw rows เก็บใน `_periodAttRows` ให้ timesheet modal ใช้ต่อ (ไม่ยิงซ้ำ). **(2) คอลัมน์ใหม่ต่อแถว** วัน | OT ชม. | สาย | ลา (advisory จาก map) แทรกหลังแผนก ก่อนคอลัมน์เงินเดิม (เงินเดือน/OT฿/สวัสดิการ/โบนัส/คอม/หัก/รวมสุทธิ/สถานะ/ปุ่ม ครบเดิม) + wrapper ตารางเปลี่ยน `overflow-x:auto` → **`.table-wrap`** (shared mobile pattern: min-width 520 + scroll ≤600px). **(3) การ์ดสรุปเพิ่ม 2 ใบ** ต่อจาก 4 ใบเดิม: "🕒 OT รวม (ชม.)" + "⏰ มาสายรวม (ครั้ง)" ของรอบ (จาก map; fail → "—"). **(4) ปุ่ม "⚡ สร้างเงินเดือนทั้งรอบ" (`_bulkGeneratePayroll` — ฟังก์ชันใหม่ท้ายไฟล์ ไม่แตะลำดับ marker ของ guard 416):** กด → เช็ค `_prBulkInflight` ก่อนทุกอย่าง (pattern `_qtConvertInflight` + try/finally reset + disable ปุ่ม) → `window.App.confirm` "สร้างร่างเงินเดือนรอบ {label} ให้พนักงาน {N} คน (ข้าม {M} คนที่มีรายการแล้ว)?" (App.confirm ไม่มี → toast + ไม่สร้าง, **ห้าม native confirm**) → insert **ทีละคน** เฉพาะ staff (role!==customer) ที่ยังไม่มีรายการรอบนี้ (เทียบ `_payrolls` ที่โหลดแล้ว; ชน unique 23505/uq_staff_payroll_period → fail พร้อมข้อความ "มีรายการรอบนี้แล้ว"). payload ต่อคน: employee_id + department_id (จาก profile) + period_start/end + period_month (เดือนของ end + "-01") + **เฉพาะ pay_type=daily && daily_rate>0 && days>0 → days_worked + daily_rate + base_salary=round2(rate×days); อย่างอื่น base 0 + days_worked null ให้ owner กรอกเอง** + overtime/welfare/bonus/commission/deductions = 0 + note "สร้างอัตโนมัติทั้งรอบ — ตรวจก่อนจ่าย" + details schema 1 + attendance `{days_worked, ot_hours_autofill, late_count, leave_days}` — **❌ ห้ามมี total_amount (DB GENERATED — Postgres 400 428C9 ปฏิเสธทั้งคำสั่ง; พิสูจน์จาก smoke 416)**. เก็บผลสำเร็จ X / fail Y → toast สรุป + `logActivity("payroll_bulk_create")` 1 entry + reload list. **❌ ไม่มีการจ่าย/mark paid ใด ๆ — สร้างสถานะ "รอจ่าย" เท่านั้น.** **(5) กดชื่อพนักงานในแถว** (ปุ่ม `.pr-name-btn`) → **timesheet modal** (`_openTimesheetModal` — read-only): reuse **`buildEmployeeTimesheet`** จาก `hr_overview.js` (export อยู่แล้ว — verify จริง; **ไม่แก้ hr_overview.js**) บน `_periodAttRows` ที่ filter ต่อ user (ไม่ fetch ซ้ำ — guard test ล็อก) → ตารางทุกวันของรอบ: วันที่/เข้า/ออก (`timeBangkok`)/ชม.ปกติ/OT/สถานะตรงเวลา (`punctualityChipMeta` chip) + tfoot รวม + ปุ่มปิด ×2 + คลิกฉากหลังปิด. **Imports เพิ่ม (import-only):** time_clock.js +`attendanceRulesFromState/classifyPunctuality/sumRegularOT/timeBangkok/punctualityChipMeta` · hr_overview.js +`buildEmployeeTimesheet` (ไม่มี circular — hr_overview ไม่ import payroll) · leave_management.js +`calcLeaveDays`. **❌ ไม่แตะ:** `_markPaid`/`postJournalForPayroll`/`_createSalaryExpense` (pay/JV/expense side-effects) · `computePayrollTotal` · `computePayPeriods`/`formatPayPeriodLabel` (416) · สลิป `_printPayslip` · `_savePayroll` ของ modal (bulk เป็นฟังก์ชันแยก) · `_openPayrollModal` · hr_overview.js/time_clock.js/leave_management.js (ไฟล์ต้นทาง) · SQL/DB (schema 416 รองรับครบแล้ว — ไม่มี migration ใหม่) · package.json (5.66.0). **Tests ใหม่ `tests/payroll_partb_guard.test.js` (13):** unit จริง `buildPeriodAttendanceMap` 7 (หลายคน/distinct days/open session/leave clip ขอบ/leave คร่อมรอบ/นอกรอบ+ไม่ approved/ว่าง→Map ว่าง) + source-regex 6 (extract block ก่อน assert: bulk **ไม่มี total_amount/paid_at/postJournalForPayroll/_createSalaryExpense** · inflight ก่อน confirm ก่อน POST + finally reset + skip คนที่มีรายการ + ห้าม native confirm · render มี batch fetch + คอลัมน์ 4 + คอลัมน์เงินเดิมครบ + การ์ด 2 + ปุ่ม bulk wired · timesheet ใช้ `_periodAttRows` + ไม่มี fetch + reuse buildEmployeeTimesheet · import-only · ไม่มี alert). guard 416 `payroll_period_guard` (12) เขียวครบ — function ใหม่วางท้ายไฟล์ ไม่กระทบ `extractBetween` markers เดิม. **Build bump 416→417 ครบ:** `data-app-build="417"` + `?v=417` ×4 (style/selfheal/main/boot) + sw.js `CACHE_NAME` v417 + comment v417 + `dashboard_readonly_guard` bump 417 · EOL LF ทุกไฟล์. **Verify (รันจริง):** `lint:errors` 0 · unit **1481** pass (1468 เดิม + 13 ใหม่) · e2e **12** pass (รวม build-sync 3 ตัว). **Known risks:** (ก) lateCount นับ per-row — พนักงานที่ clock-in หลายรอบ/วัน (เช่น พักเที่ยงแล้วเข้าใหม่บ่าย) session บ่ายจะนับสาย ตรงกับ behavior HR overview เดิม แต่ owner ควรรู้ตอนอ่านตัวเลข; (ข) bulk ใช้ snapshot `_attMap` ตอนเปิดหน้า — ถ้ามีคน clock-in ระหว่างเปิดหน้าค้างไว้ ตัวเลข draft จะเป็นของตอนโหลด (กด refresh/เปลี่ยนรอบ = โหลดใหม่); (ค) race ข้ามเครื่อง: 2 admin กด bulk พร้อมกัน → unique index กันซ้ำที่ DB แล้ว (คนหลังได้ fail "มีรายการรอบนี้แล้ว" — ไม่มีแถวซ้ำ); (ง) ปุ่ม bulk แสดงเสมอแม้ attendance โหลด fail — payload จะได้ days 0/base 0 (ปลอดภัย: ไม่มีเงินคำนวณจากข้อมูลที่ไม่มี แต่ owner ควร reload ก่อนถ้าการ์ดโชว์ "—"). **Owner/reviewer ต้อง smoke (preview):** (1) เปิดหน้าเงินเดือน → การ์ด 6 ใบ + คอลัมน์ วัน/OT/สาย/ลา ขึ้น (มีข้อมูล clock จริงของรอบ); (2) กด ⚡ สร้างเงินเดือนทั้งรอบ → confirm แสดง N/M ถูก → รายการร่างขึ้นครบ สถานะรอจ่าย base ถูกเฉพาะ daily; (3) กดซ้ำทันที → toast "กำลังสร้าง..." + หลังเสร็จกดอีกรอบ → "ทุกคนมีรายการรอบนี้แล้ว"; (4) กดชื่อพนักงาน → timesheet ตรงกับหน้า Time Clock; (5) มือถือ ~390px ตาราง scroll ได้ไม่ล้น; (6) แก้/ลบ/จ่าย/สลิปของรายการเดิมยังทำงานปกติ (Part A regression). **✅ MERGED → main (ff `c682a12`) · live build 417 · Claude review+smoke PASSED 2026-06-11 (bulk 7/7: คนเข้างานจริงได้ เรท×วัน อัตโนมัติ คนอื่น 0 · total_amount จาก DB · details snapshot ครบ · timesheet modal 15 วัน read-only · ลบร่างทดสอบสะอาด 0 แถว). เดิมรอ merge. ห้ามเริ่ม Part C (จ่ายทั้งรอบ/สลิปรวม) เอง.**

**Prev (416):** 11 มิถุนายน 2026 (Phase 416 **Part A** payroll-custom-pay-period — build 416, **PAYROLL · HIGH — เงินเดือนพนักงาน ผิดรอบ = จ่ายผิด**) · เปลี่ยนรอบเงินเดือนจาก "เดือนปฏิทิน" → **รอบตัดที่ร้านกำหนด** (default ตัด 10 และ 25 → รอบ A = 11–25 เดือนเดียวกัน, รอบ B = 26–10 ของเดือนถัดไป) + เก็บ snapshot รายละเอียดต่อรอบลง jsonb เผื่ออนาคต (ประกันสังคม/ประกันชีวิต). ฐาน: `staff_payroll` **0 แถว** (verify 2026-06-10) → ไม่มี backfill. **(1) SQL ใหม่ `supabase-phase416-payroll-period.sql` — ⚠️ owner ต้องรันใน Supabase SQL Editor "ก่อน" smoke (agent ไม่ได้รัน — เขียนไฟล์เท่านั้น):** ADD COLUMN IF NOT EXISTS `period_start date` / `period_end date` / `details jsonb DEFAULT '{}'` + **DROP CONSTRAINT IF EXISTS `uq_staff_payroll`** (unique เดิม employee+period_month ชนเมื่อ 2 รอบจบเดือนเดียวกัน เช่น 26 พ.ค.–10 มิ.ย. กับ 11–25 มิ.ย. → period_month = มิ.ย. ทั้งคู่) + CREATE UNIQUE INDEX `uq_staff_payroll_period(employee_id, period_start, period_end)` + NOTIFY pgrst — additive ปลอดภัยต่อ build เก่า. **(2) `modules/payroll.js`:** pure export `computePayPeriods({cutoff1,cutoff2,refDate,count})` + `formatPayPeriodLabel(start,end)` — **string math ล้วน** (Date.UTC ใช้แค่หา days-in-month; ไม่มี toISOString บน local Date), cutoff ต้องเป็นจำนวนเต็ม 1–28 + c1<c2 ไม่งั้น fallback 10/25, คร่อมเดือน/คร่อมปี ok, วันตัดชนปลายเดือนสั้น (เช่น ตัด 28 ใน ก.พ.) → clamp รอบถัดไปเริ่ม 1 มี.ค. **ไม่มี invalid date**; UI: แถบปุ่ม 3 รอบล่าสุด + ปุ่ม "⚙️ กำหนดเอง" (date from/to + validate from≤to) แทน `prMonthSelect` เดิม; state `_periodStart/_periodEnd` (ส่วน `_periodMonth` เดิม **กลายเป็น derived = เดือนของวันสิ้นรอบ** — สลิป slipNo "PS"+YYYYMM / JV periodLabel ใน `_markPaid` / expense periodTH เดิมอ่านต่อได้ ไม่แตะ); โหลด `period_start=eq.{}&period_end=eq.{}` (รอบตรงตัว ไม่ใช่ overlap) + ยังไม่รัน SQL (400 + 42703/PGRST204/ชื่อคอลัมน์) → renderError ชี้ "รัน supabase-phase416-payroll-period.sql"; save payload เพิ่ม `period_start/period_end` + `period_month` (= เดือน period_end + "-01") + **`details` jsonb schema 1**: `{rates:{daily_rate}, attendance:{days_worked, ot_hours_autofill}, additions:[overtime/welfare/bonus/commission เฉพาะ >0], deductions:[{type:"manual"} เฉพาะ >0]}` — comment shape เหนือโค้ด: อนาคตประกันสังคม = push `{type:"sso",...}` เข้า deductions ไม่ต้องแก้ schema; modal ช่อง `prMonth` (type=month) → **read-only display** label รอบที่เลือก (เปลี่ยนรอบจากหน้าหลัก); OT autofill (92.26) เรียก `fetchUserAttendanceSummary(empId, _periodStart, _periodEnd, shiftOpts)` ช่วงรอบจริงแทนขอบเดือน (helper รับ custom range อยู่แล้ว — **ไม่แตะ time_clock.js**) + snapshot `_otAutofillHours` ลง details; leave summary box ยังคิดรายเดือน (เดือนของวันสิ้นรอบ ผ่าน `_periodMonth` — label "(เดือนของวันสิ้นรอบ)"; จุดอ่าน prMonth เดิม 2 จุด [OT/leave] ต้องย้าย source เพราะ input หายไป — mechanical consequence); unique error → **"พนักงานนี้มีรายการรอบนี้แล้ว — แก้ไขรายการเดิมแทน"** (เช็ค uq_staff_payroll_period + uq_staff_payroll + 23505); summary card "ยอดรวมรอบนี้ (label)" / empty "รอบนี้" / Excel คอลัมน์ "รอบจ่าย" = start→end + ชื่อไฟล์ `เงินเดือน_{start}_ถึง_{end}` / สลิป meta "รอบจ่าย" + ช่วงรอบ (fallback period_month สำหรับแถวเก่า — layout เดิมทุกอย่าง); ลบ dead `_formatMonth` (ผู้เรียกเดียวคือ month select เดิม). **(3) `modules/settings/store.js`:** ช่อง "วันตัดรอบที่ 1/2" (id `storePayCut1/2`, default 10/25, parseInt + จำนวนเต็ม ≥1 clamp ≤28 ตาม pattern lateGrace) → `storeInfo.payrollCutoff1/payrollCutoff2` ผ่าน `saveStoreInfo` เดิม (cloud sync + {ok,cloudSynced} เดิม — ไม่แตะ attendance audit). ❌ **ไม่แตะ:** สูตร `computePayrollTotal` (guard ล็อก regex + behavioral) · mark paid flow/`postJournalForPayroll`/`_createSalaryExpense`/expense side-effects · สลิป PDF layout · bulk-generate ทั้งรอบ/คอลัมน์สาย-ลา/ประวัติรายคน (**Part B/C — ไม่ทำเกิน**) · `time_clock.js`/`hr_overview.js`/`leave_management.js` · POS/stock/accounting อื่น · **ไม่รัน SQL/ไม่แตะ DB**. +guard ใหม่ `payroll_period_guard` (**12**: unit จริง 7 — refDate 2026-06-10 → 26 พ.ค.–10 มิ.ย./11–25 พ.ค./26 เม.ย.–10 พ.ค. · คร่อมปี 2026-01-05 → 25 ธ.ค.68–10 ม.ค.69 · คร่อม ก.พ. + วันที่ทุกตัว valid · cutoff 28 ชน ก.พ. → เริ่ม 1 มี.ค. · labels ไทย พ.ศ. 2 หลัก · count + contiguous ไม่มี gap/overlap · cutoff ผิด → fallback 10/25; source-regex extract block 5 — payload มี period_start+period_end+details+schema:1+ot_hours_autofill+period_month คงอยู่+ข้อความ error ใหม่ · โหลด period_start=eq + ห้ามเหลือ period_month=gte + ชี้ไฟล์ SQL · OT autofill ใช้ _periodStart/_periodEnd + signature ครบ · ไม่มี alert() ทั้งไฟล์ · สูตร total เดิม `base + ot + wel + bon + com - ded` + behavioral check) + bump `dashboard_readonly_guard` 416. lint 0 / unit **1468** (1456+12) / e2e 12. bump 415→416 (index.html data-app-build + ?v= ×4 selfheal/main/boot/style.css + sw.js CACHE_NAME cache-v416 + comment; package.json คง 5.66.0). **✅ MERGED → main (ff `f5434d1` รวม fix 428C9) · live build 416 · SQL รันแล้ว + Claude full smoke PASSED 2026-06-11 (ปุ่ม 3 รอบถูก · save จริงผ่าน: DB row period 2026-06-11→25 + details snapshot + total_amount DB-generated ตรงสูตร UI · กันซ้ำ "มีรายการรอบนี้แล้ว" · ลบสะอาด 0 แถว). 🎁 fix 428C9 = แก้บั๊กเก่า 92.43 ที่ทำให้บันทึกเงินเดือน manual ไม่เคยผ่าน (total_amount = DB GENERATED — ห้าม client ส่ง). (เดิมรอ: (1) รัน `supabase-phase416-payroll-period.sql` ใน Supabase SQL Editor ก่อน (2) review + smoke preview หน้าเงินเดือน:** เปิดหน้าเงินเดือน → เห็นแถบปุ่ม 3 รอบ (วันนี้ 11 มิ.ย. → รอบปัจจุบัน "11–25 มิ.ย. 69") → settings ข้อมูลร้านค้า เห็นช่องวันตัด 10/25 → เพิ่มรายการเงินเดือน (modal โชว์รอบ read-only) + ดึง OT จาก Time Clock (ช่วง = รอบ) → บันทึก → รายการโผล่ในรอบที่เลือก → บันทึกพนักงานเดิมรอบเดิมซ้ำ → error "พนักงานนี้มีรายการรอบนี้แล้ว" → สลับรอบ → list เปลี่ยน → สลิป/Excel โชว์ช่วงรอบ. **known risks:** (1) ยังไม่รัน SQL → หน้าเงินเดือนขึ้น error ชี้ไฟล์ SQL (จงใจ fail-explicit — ส่วนอื่นของแอปไม่กระทบ) (2) รายการที่ไม่มี period_start/end (สร้างจาก build เก่า) จะไม่โผล่ใน list รอบใหม่ — ตาราง 0 แถว = ไม่มีผลจริง (3) custom range unique ต่อช่วงที่กรอกเป๊ะ ๆ (ตั้งใจ — รอบไม่ตรงกัน = คนละรายการ) (4) เปลี่ยน cutoff ใน settings ภายหลัง → รอบเก่าหาไม่เจอจากปุ่ม ต้องใช้ "กำหนดเอง" จิ้มช่วงเดิม (Part B พิจารณา selector ประวัติรอบ) (5) จุดเสี่ยงที่รีวิวควรเพ่ง: derived `_periodMonth` sync ใน renderPayrollPage เท่านั้น — flow ที่เปิด modal โดยไม่ผ่าน render (ไม่มีใน UI ปัจจุบัน) จะได้ค่า stale.
**Prev (415):** 10 มิถุนายน 2026 (Phase 415 ob-form-dynamic-bank-fields — build 415, **ACCOUNTING §4.3 · form-only**) · ฟอร์ม "ลงยอดยกมา" (`modules/accounting/opening_balance.js`) แสดงช่องเงินฝากธนาคารจาก chart_of_accounts จริงแบบ **dynamic** — เดิม ASSET_FIELDS hardcode 1130/1140 → owner กรอก OB แยก 6 บัญชีใหม่ **1131–1136** (เพิ่มใน COA 2026-06-10 ผ่าน CSV-import) ไม่ได้. **(1) `fetchBankAssetAccounts()` (export ใหม่):** GET `chart_of_accounts?select=code,name,parent_code,is_active,sort_order&type=eq.asset&order=sort_order.asc` → filter `is_active !== false` · code 4 หลักล้วน (`/^\d{4}$/` — กัน code แปลกหลุดเข้า DOM id/HTML) · ช่วง "1130"–"1169" (**415-fix:** ขอบบนเดิม "1199" ดูด **1170 ภาษีซื้อ (Input VAT)** เข้ากลุ่มธนาคาร — verify COA จริงได้ 9 ช่องแทน 8; เงินฝากจริง = 113x–116x → แก้เป็น ≤1169 + guard case 1170 ต้องไม่ติด + ล็อกขอบบนใน source) · **เฉพาะ leaf** (Set จาก parent_code ทุกแถว asset — บัญชีที่มีลูกชี้มา = header ไม่เอา) · sort ซ้ำฝั่ง JS ตาม sort_order → map `{code, label:name, emoji:"🏦"}`; HTTP fail/ผังว่าง → throw ให้ caller จัดการ. **(2) `renderOpeningBalancePage` → async** (caller `main.js:146 _renderLazy` เรียก `fn(ctx)` ไม่ await = fire-and-forget — ฟังก์ชันต้อง handle error เองทั้งหมด): โชว์ "⏳ กำลังโหลดผังบัญชี..." → await fetch → ASSET list = `CASH_FIELDS`(1110/1120) + banks + `RECEIVABLE_INVENTORY_FIELDS`(1200/1300) เก็บใน **`_assetFields` (module-level let)** — `updateBalance` (Dr live calc) / wire input / reset / `_onSubmit` collect / reset-after-save **loop จาก `_assetFields` ทั้งหมด ไม่ hardcode ซ้ำ** (id ช่อง = `ob_<code>` pattern เดิม; label จาก DB ผ่าน escHtml เดิม). **(3) fallback:** fetch ล้ม/ไม่พบบัญชีในช่วง → `DEFAULT_BANK_FIELDS` (1130/1140 ชุดเดิม) + แถบส้ม "⚠️ โหลดผังบัญชีไม่สำเร็จ — แสดงช่องพื้นฐาน (1130/1140) · รีเฟรชหน้าเพื่อลองใหม่" + console.error — **ห้าม crash/ฟอร์มว่าง**. ❌ ไม่แตะ EQUITY/LIABILITY fields + `window.App?.confirm?.` (Phase 414 คงเดิมทุกตัว — guard 414 ยังคุม) · `_onSubmit` save semantics (doc_no OB gen/POST entry+lines/idempotency — แค่เปลี่ยน list ที่ loop) · `effective_date.js` · chart_of_accounts data/SQL · main.js. +guard `opening_balance_guard` **6→12**: behavioral จริง 3 (stub window+fetch แล้ว import โมดูล — leaf/inactive/นอกช่วง/code แปลก ถูกตัด + เรียง sort_order + label จาก name · HTTP 500 → throw · ผังว่าง → throw) + source-regex 3 (fallback DEFAULT_BANK_FIELDS + ข้อความเตือน · ไม่ hardcode "1131"–"1136" ใน source · regression: 1110/1120/1200/1300 ยังอยู่ + ASSET_FIELDS เก่าหายหมด + `_assetFields` ใช้ใน submit/calc) · `dashboard_readonly` bump 415. lint 0 / unit **1455** (1449+6) / e2e 12, bump 414→415 (index.html + sw.js; package.json คง 5.66.0). คาดหวังบน prod: ช่องธนาคาร **8 ช่อง** (1130, 1131–1136, 1140) ชื่อตรงผังบัญชี — หมายเหตุ: ถ้า 1131–1136 ถูก import โดยตั้ง parent_code=1130 → 1130 จะกลายเป็น header แล้วหายจากฟอร์ม (เหลือ 7 ช่อง) = พฤติกรรมถูกต้องตามเงื่อนไข leaf ไม่ใช่บั๊ก. ✅ **MERGED → main (ff `bca3823` รวม 415-fix) · live build 415 · Claude review+smoke PASSED 2026-06-10 (preview: ช่องธนาคาร 8 ช่องเป๊ะ 1130+1131–1136(ชื่อ/เลขท้ายถูกครบ)+1140 · ไม่มี 1170 ✓ · Dr=Cr modal วันที่ 2026-07-01 ✓ · ยกเลิก=ไม่บันทึก OB ยัง 2 ใบ ✓). เดิมรอ owner review/smoke: เปิดหน้า ลงยอดยกมา → เห็นช่องธนาคารครบชื่อตรง COA → กรอก 2 ช่องให้ Dr=Cr → กด "บันทึก" → modal แอปแสดงยอดถูก → ยกเลิก → ไม่บันทึก.**
**Prev (414):** 10 มิถุนายน 2026 (Phase 414 ob-form-coa-labels-and-confirm — build 414, **ACCOUNTING §4.3 · form-only**) · ฟอร์ม "ลงยอดยกมา" (`modules/accounting/opening_balance.js`) พร้อมลง OB จริง 1 ก.ค.: **(1) label ตรง chart_of_accounts จริง** (verify กับ COA seed `supabase-phase88-accounting-foundation.sql:177-211` — ตรงกับ DB ที่ verify 2026-06-10): EQUITY `3100 "ทุนจดทะเบียน"→"ทุนเจ้าของ"` (ช่องหลัก owner ลงทุนยกมา) · `3200 "ทุนของเจ้าของ"→"กำไรสะสม"` — เดิมพา owner ลง "ทุนเจ้าของ" เข้า 3200 ซึ่งใน COA จริงคือกำไรสะสม (OB placeholder รอบ 10 มิ.ย. เข้าผิดมาแล้ว — **ไม่ data-fix** เพราะหลุดจากงบโดย cutoff 413; ของจริง 1 ก.ค. ห้ามผิดซ้ำ); LIABILITY ผิดอีก 3 ช่อง (พบตอน verify ตาม prompt ข้อ 2): `2100 "เจ้าหนี้การค้า"→"หนี้สินหมุนเวียน"` (เจ้าหนี้การค้าจริงคือ **2110**) · `2120 "เจ้าหนี้อื่น (บัตรเครดิต ฯลฯ)"→"เจ้าหนี้อื่น"` · `2200 "เงินกู้ยืม"→"หนี้สินไม่หมุนเวียน"` (เงินกู้จริงคือ 2160 สั้น/2210 ยาว) — **label-only, code คงเดิมตาม scope (Forbidden)**; ASSET 6 ช่อง (1110/1120/1130/1140/1200/1300) ตรง COA อยู่แล้วไม่แตะ. ⚠️ **known: 2100/2200 เป็น header account** (parent ของ 2110-2160/2210) — JV ที่ลงช่องนี้ post เข้า header ตรง ๆ (พฤติกรรมเดิมตั้งแต่ 88.5; งบรวมถูกเพราะ type liability เหมือนกัน แต่ drill-down ราย sub-account จะไม่เห็น) — ย้ายช่องไป leaf code = **owner decision phase หน้า**. **(2) เลิก native confirm 2 จุด** (reset :158 / submit :198) → `await window.App?.confirm?.(...)` (confirmAsync modal กลาง `main.js:4795 App.confirm` — pattern เดียวกับ quotations/delivery_invoices); ข้อความ confirm เดิมคงไว้ (รีเซ็ตทั้งหมด? / ยืนยันบันทึกยอดยกมา? Dr=Cr=... ลงวันที่ ... N รายการ); reset handler → async; submit เพิ่ม type-check `typeof window.App?.confirm !== "function"` (boot ผิดลำดับ) → **ไม่บันทึก** + `_ctx?.showToast` + setStatus "ระบบยืนยันยังไม่พร้อม..." (**ห้าม fallback ไป native confirm**). ❌ ไม่แตะ `_onSubmit` save semantics (doc_no OB gen / POST journal_entries+lines / idempotency note) · `effective_date.js` import ของ 413 · `confirmAsync`/`showConfirmModal` ใน main.js · chart_of_accounts SQL/data · OB JV เดิมใน DB · Dr≠Cr block เดิม (ยังบล็อกก่อนถึง confirm) · ASSET/LIABILITY codes. +guard `opening_balance_guard` (6 ข้อ: equity labels ใหม่ + label เก่าต้องหาย · liability labels 3 ช่อง · strip `window.App?.confirm` แล้วห้ามเหลือ `confirm(`/`alert(` + ต้องมี `await window.App?.confirm?.(` ≥2 จุด · type-check + ข้อความเตือน · `import { ACCOUNTING_EFFECTIVE_DATE }` ยังอยู่ · `doc_type: "OB"` + docNoPrefix ยังอยู่) · `dashboard_readonly` bump 414. lint 0 / unit **1449** (1443+6) / e2e 12 (รอบแรก flake 1 ข้อ "APP_BUILD is set" undefined — รันซ้ำเขียวทั้ง suite 12/12; กลไก selfheal ไม่เกี่ยว diff), bump 413→414 (index.html + sw.js; package.json คง 5.66.0). ✅ **MERGED → main (ff `52eb0be`) · live build 414 · Claude code-review PASSED 2026-06-10 (labels ตรง COA verified กับ seed SQL · finding 2100/2200=header ยืนยันถูก → phase แยก · guard 6 ข้อ · CI เขียว; live-smoke modal เลื่อนไปก่อน 1 ก.ค. — extension หลุดชั่วคราว, mechanism เดียวกับทั่วแอป). smoke เดิม (ไม่ต้องบันทึกจริง): เปิดหน้า ลงยอดยกมา → label 3100 "ทุนเจ้าของ"/3200 "กำไรสะสม" + ฝั่งหนี้สิน 3 ช่อง label ใหม่ → กรอกเลขสมมติ Dr=Cr → กด "บันทึก" → ต้องเป็น modal ของแอป (ไม่ใช่กล่อง browser) → "ยกเลิก" → ไม่บันทึก · กด "รีเซ็ตทั้งหมด" → modal แอปเช่นกัน.**
**Prev (413):** 10 มิถุนายน 2026 (Phase 413 accounting-effective-date-to-jul1 — build 413, **ACCOUNTING §4.3 · system-wide cutoff**) · เลื่อนวันเริ่มบัญชี `ACCOUNTING_EFFECTIVE_DATE` จาก **2026-05-01 → 2026-07-01** = เริ่มบัญชีจริง 1 ก.ค. 2569 (owner = บุคคลธรรมดา ไม่จด VAT, ยืนยัน **cutoff อย่างเดียว ไม่ลบข้อมูลเก่า** — ของก่อน 1 ก.ค. แค่หลุดจากรายงาน/auto_post อัตโนมัติ). **⭐ refactor single source of truth:** ไฟล์ใหม่ `modules/accounting/effective_date.js` (`export const ACCOUNTING_EFFECTIVE_DATE = "2026-07-01"`) → 6 ไฟล์ import แทน const ท้องถิ่น (เปลี่ยนวันครั้งหน้า = แก้ที่เดียว กันตกหล่นแบบ 6-จุด-กระจาย): **(1) `auto_post.js`** (`_isAfterEffective` — คุม skip ของทุก poster) **(2) `balance_sheet.js` (3) `export_bundle.js` (4) `opening_balance.js` (5) `backfill.js`** (`cutoff` ใน `_fetchSourceRows` + UI text 2 จุด [:86 effective date banner / :516 ข้อความ orphan] เปลี่ยนเป็น `${ACCOUNTING_EFFECTIVE_DATE}` interpolation) **(6) `service_reconcile.js`** (`DEFAULT_EFFECTIVE_DATE = ACCOUNTING_EFFECTIVE_DATE`; `opts.effectiveDate` override ยังทำงาน; comment/jsdoc อัปเดต). Invariant ยืนยันด้วย test: `_isAfterEffective("2026-06-30")=false` · `("2026-07-01")=true`. **ผลตั้งใจ:** งบดุล/P&L/trial balance/integrity/service-reconcile รวมยอด "ตั้งแต่ 1 ก.ค."; OB placeholder (1 พ.ค.) + บิลทดสอบ พ.ค.–มิ.ย. หลุดจากรายงานอัตโนมัติ **ไม่ถูกลบ** (owner จะลง OB จริงวันที่ 1 ก.ค. ภายหลัง — หน้า opening_balance ใช้วันที่ใหม่อัตโนมัติแล้ว). **Tests:** อัปเดต date-sensitive **6 ไฟล์** (verify ทีละไฟล์ว่าเป็น effective-date จริงก่อนแก้): `auto_post.test` boundary ใหม่ (2026-06-30 false / 2026-07-01 true / 2026-05-01 = pre-effective แล้ว) · `accounting_integrity_panel` scenario เลื่อนเป็น ก.ค. + test "fallback today" เปลี่ยนเป็น **time-independent** (expected คำนวณจาก `_isAfterEffective(todayBkk())` — เดิม hardcode actionable จะพังเพราะวันนี้ 10 มิ.ย. < 1 ก.ค. และจะพังอีกถ้า hardcode skipped เมื่อเวลาจริงข้าม 1 ก.ค.) · `accounting_readiness_service_scope` + `service_reconcile_guard` AFTER_EFF → 2026-07-06 · `cashbasis_revenue_guard` → 2026-07-09 · `backfill_deleted_guard` → 2026-07-08 (ไฟล์ที่ 6 — ใหม่กว่า prompt [Phase 411] แต่ date-sensitive เหมือนกัน). **+guard ใหม่ `effective_date_guard` (9 ข้อ):** ค่า = 2026-07-01 · boundary จริงผ่าน import · 6 source ไม่มี "2026-05-01"/ไม่มี const ท้องถิ่น/import effective_date.js ครบ · นิยามวันที่เดียวในไฟล์ shared. **❌ ไม่แตะ:** ข้อมูล/SQL/migration (cutoff = ค่าคงที่ ของเก่าคงอยู่) · double-entry/mapping/VAT split/period-lock · OB form fields (3200 = Phase แยก) · POS/stock · `tests/expenses_export_filter`/`hr_overview`/`leave_management` ("2026-05-01" ในนั้น = วันที่ scenario ของ HR/ลา/export คนละฟีเจอร์ — **เขียวทั้งหมด = พิสูจน์ไม่โดนแตะ**) · `scripts/backfill_orphan_journals.js:19` comment เก่า (script one-off นอก scope — test ที่อ้างใช้ regex alternation ยังเขียว). `dashboard_readonly` bump 413. lint 0 / unit **1443** (1434+9) / e2e 12, bump 412→413 (index.html + sw.js; package.json คง 5.66.0). ✅ **MERGED → main (ff `0520975`) · live build 413 · Claude smoke preview PASSED + owner ยืนยันวัน 1 ก.ค. 2026-06-10 (งบดุลว่าง "ตั้งแต่ 2026-07-01" ✓ · backfill text 2026-07-01 + integrity เขียว ✓ · P&L เดือนเก่า = ดู JE เทสต์เดิมตาม period ที่เลือก = expected). ⚠️ ช่วง 11–30 มิ.ย.: บิลขายไม่ post JV โดยเจตนา (pre-effective). smoke เดิม: เปิดงบดุล/P&L → ตัวเลขเป็น 0/ว่าง (ของทดสอบก่อน 1 ก.ค. หลุดหมด — ตั้งใจ) · หน้า Backfill → "Effective date: 2026-07-01" + integrity card นับ orphan เดิมเป็น "ข้าม" เพิ่ม (pre-effective) ไม่มี banner แดง · ขายบิลทดสอบวันนี้ (<1 ก.ค.) → ไม่มี JV (auto_post skip = ตั้งใจ; อย่าลืมลบบิลทดสอบ). known: ตั้งแต่วันนี้ถึง 30 มิ.ย. ทุกการขายจริงจะ "ไม่ลงบัญชี" โดยเจตนา (รายได้/P&L = 0 จนถึง 1 ก.ค.) — ถ้า owner ต้องการเริ่มก่อนนั้นต้องแก้วันใน effective_date.js ที่เดียว.**
**Prev (412):** 10 มิถุนายน 2026 (Phase 412 convert-doc-inflight-guard — build 412, **SALES documents §4.1-4.2**) · ปิดช่องสร้างเอกสารซ้ำที่ flow convert (`quotations.js convertToDeliveryInvoice` ใบเสนอราคา→ใบส่งของ · `delivery_invoices.js convertToReceipt` ใบส่งของ→ใบเสร็จ): Phase 409 บล็อกด้วย **existence-check "ก่อนสร้าง"** เท่านั้น — กดยืนยันแล้ว trigger ซ้ำระหว่างใบแรกกำลังสร้าง (dup-check รอบสองวิ่งก่อน create รอบแรก commit) = **เอกสารซ้ำ 2 ใบทะลุ 1:1**. **(1) Inflight guard ระดับฟังก์ชัน:** `_qtConvertInflight`/`_diConvertInflight` (module-level, mirror `_qtSaveInflight` Phase 356) — เช็คบรรทัดแรก**ก่อน duplicate-check** → trigger ซ้ำ = no-op + toast ("กำลังสร้างใบส่งสินค้า..." / "กำลังออกใบเสร็จรับเงิน รอสักครู่..."); set true → ครอบ body เดิมทั้งหมดด้วย `try{...}finally{flag=false}` (early return ทุกจุด — dup-block/ยกเลิก confirm/create fail — ผ่าน finally = trigger ใหม่ได้เสมอ); guard ในฟังก์ชัน = **คลุมทุกทางเข้า** (quotations: dropdown แถว + ปุ่มฟอร์ม qtConvertFromForm + ปุ่ม preview qtConvertBtn · DI: dropdown แถว + ปุ่ม preview diConvertReceiptBtn). ผลพลอยได้: กดรัวก่อนยืนยัน → call ที่สองโดน early-return ก่อนถึง confirm → dialog แรกคงอยู่ ไม่มี zombie await (❌ ไม่แตะ confirmAsync/showConfirmModal ใน main.js). **(2) items loop ทั้ง 2:** `const ir = await xhrPost(...)` → `!ir?.ok` → `failedItems.push(item_name)`; หลัง loop fail>0 → console.error + toast `⚠️ สร้าง <เลขใบ> แล้ว แต่บันทึกรายการไม่สำเร็จ N รายการ (3 ตัวแรก…) — เปิดใบเพื่อตรวจ/เพิ่มเอง` — **ห้าม rollback/ลบ header** (ใบเกิดแล้ว; 409 existence-check กันออกซ้ำตอน retry). **(3) PATCH status 3 จุด** (quotations→invoiced / delivery_invoices→receipted / quotations→receipted ถ้า linked): capture ผล (`sp`/`sp1`/`sp2`) → fail ใด ๆ → console.warn + toast เดียว `⚠️ อัปเดตสถานะเอกสารต้นทางไม่สำเร็จ — ใบใหม่ถูกสร้างแล้ว` — **ห้าม rollback** (status = display; ตัวกัน 1:1 จริง = existence-check). body re-indent +1 ระดับ — **รีวิวด้วย `git diff -w`** = เห็นเฉพาะการแก้จริง (guard/failedItems/sp checks) logic อื่นไม่เปลี่ยน. ❌ ไม่แตะ duplicate-check 409 (active→block+toast+return · catch→confirm fallback = residual เดิมที่รู้อยู่) · payload/เลขเอกสาร/status "pending" · cash-basis comment block (408) · call sites ทั้ง 5 (ไม่ disable ปุ่ม) · `saveQuotationFull`/`_qtSaveInflight` เดิม · delete/cancel/share flow · POS/stock/accounting · SQL · ไม่ alert(). +guard `convert_inflight` (source-regex extract body ก่อน, 11 ข้อ: flag module-level ×2 · ordering guard→set→dup-check ×2 · finally reset ×2 · failedItems+!ir?.ok+toast partial ×2 · xhrPatch status assigned+fail-branch+ไม่มี fire-and-forget เหลือ ×2 · branch 409+filter cancelled คงเดิม+no alert ×2 · sp1/sp2 รวม toast เดียว ×1) · `dashboard_readonly` bump 412. lint 0 / unit **1434** (1423+11) / e2e 12, bump 411→412 (index.html + sw.js; package.json คง 5.66.0). ✅ **MERGED → main (ff `139003f`) · live build 412 · Claude live smoke PASSED 2026-06-10 (ยิง convert 2 คลิกซ้อน tick เดียวทั้ง quotation→DI และ DI→receipt → guard เด้ง toast คลิก 2, คลิก 1 confirm ปกติ → DB: DI=1/receipt=1 ใบเดียว รายการถูก status invoiced/receipted/pending receipt ไม่ paid=ไม่มี JV; เก็บกวาดครบ DB เหลือ 0). smoke เดิม (ลูกค้า "ทดสอบ" ยอดเล็ก): (1) สร้างใบเสนอราคาทดสอบ → "📦 สร้างใบส่งสินค้า" จาก dropdown → ยืนยัน → ทันทีที่ dialog ปิด รีบ trigger ซ้ำ → ต้องเจอ toast "กำลังสร้างใบส่งสินค้า..." ไม่มี dialog ใหม่ → ได้ใบส่งของใบเดียว; (2) กดปุ่ม convert รัว 2 ครั้งก่อนยืนยัน → dialog เดียว (ไม่กะพริบ/ถูกแทน) → ยืนยัน → ใบเดียว; (3) จากใบส่งของนั้น "🧾 ออกใบเสร็จ" ทำท่าเดียวกัน → ใบเสร็จใบเดียว + รายการครบ + DI เป็น receipted; (4) ลบเอกสารทดสอบย้อนลำดับ ใบเสร็จ→ใบส่งของ→ใบเสนอราคา. known residual: dup-check catch-fallback (network fail → confirm-to-proceed) = เดิมตาม 409 · guard เป็น per-tab (คนละเครื่อง/แท็บกดพร้อมกันเป๊ะ ๆ ยังแข่งได้ — ปิดสนิท = DB unique constraint phase อนาคต).**
**Prev (411):** 10 มิถุนายน 2026 (Phase 411 backfill-skip-deleted-sales — build 411, **ACCOUNTING §4.3**) · Integrity panel + Backfill นับเอกสาร soft-delete (note มี "[ลบแล้ว]") เป็น **"ข้าม"** ไม่ใช่ "ต้องแก้" และ auto-post **ปฏิเสธ** post JV ให้เอกสารลบแล้วทุก path. ปัญหาเดิม (พบจาก live-audit 2026-06-10): หน้า accounting_backfill โชว์ **"ต้องแก้: 5"** + banner แดง ทั้งที่เป็นบิลลบแล้ว (sales #177-181 — JV ถูก void ถูกต้องตอนลบ) และปุ่ม "เริ่ม Backfill" จะเรียก `postJournalForSale(row)` ให้บิลพวกนี้ → สร้าง **JV รายได้ผี** จากบิลที่ไม่มีอยู่จริง. **(1) `backfill.js _classifyOrphan` (export):** เพิ่มเช็ค**แรกสุด** `String(row.note || "").includes("[ลบแล้ว]")` → `{bucket:"skipped", reason:"deleted"}` (pattern เดียวกับ main.js:2063/2134/3857/4294; expenses/payroll ไม่มี marker นี้ = ไม่กระทบ; บิลลบ+pre-effective → โดน deleted ก่อน = ไม่ actionable แน่นอน). **(2) integrity chip:** นับแยก `skippedDeleted` → แสดง "ข้าม: N **(ลบแล้ว: M)**" เมื่อ M>0; เหลือแต่บิลลบ → actionable=0 → banner แดงไม่ขึ้น. **(3) `auto_post.js postJournalForSale` + `postJournalForServiceJob`:** early-return guard ต้นฟังก์ชัน (หลังเช็ค id/amount) `note` มี "[ลบแล้ว]" → `console.info("[auto_post] skip deleted...")` + `return null` — เงียบแบบ skip case อื่น (pre-effective/zero-amount) คง caller contract (ทุก caller รองรับ null: fire-and-forget `.catch` + backfill นับ `stats.skipped`); service job ลบแต่ status ยัง done/delivered/closed ผ่าน filter backfill มา → guard กันได้; checkout ปกติ (pos.js) ไม่กระทบ — marker ใส่โดย flow ลบเท่านั้น. ❌ ไม่แตะ vw_* SQL views / supabase SQL (view นับ raw ได้ — client จัด bucket เอง) · backfill run UI flow อื่น · `_postJournal`/`voidJvForSource` internals · postJournalForReceipt/Expense/Payroll/CreditPayment/Refund (ไม่มี soft-delete แบบ note) · POS/sales.js/stock · ไม่ alert(). +guard `backfill_deleted` (unit จริง import `_classifyOrphan`+`INTEGRITY_CATS` 4 ข้อ: deleted→skipped/deleted · ปกติ→actionable (รวม note null ไม่ crash) · pre-effective→skipped เดิม · deleted+amount0→ไม่ actionable; source-regex extract body 2 ข้อ: postJournalForSale/postJournalForServiceJob มี guard [ลบแล้ว]→return null) · `dashboard_readonly` bump 411. lint 0 / unit **1423** (1417+6) / e2e 12, bump 410→411 (index.html + sw.js; package.json คง 5.66.0). ✅ **MERGED → main (ff `68a4323`) · live build 411 · owner smoke preview PASSED 2026-06-10 (การ์ดการขาย: ต้องแก้ 0 · ข้าม 91 (ลบแล้ว: 91) — DB-verified ทั้ง 91 orphan มี [ลบแล้ว] จริง (84 test ก่อน go-live + บิลลบ มิ.ย. + smoke #186), notDeleted=0, banner แดงหาย, การ์ดอื่นเท่าเดิม). smoke ที่ใช้: เปิด accounting_backfill → integrity card "การขาย" ต้องเป็น "ต้องแก้: 0 · ข้าม: 90 (ลบแล้ว: 5)" (ตัวเลขตาม prod ปัจจุบัน — เดิมข้าม 85 + บิลลบ 5) ไม่มี banner แดง · การ์ดอื่น (รายจ่าย/เงินเดือน/งานช่าง) ตัวเลขเท่าเดิม. known: บิลลบที่ pre-effective นับ reason เปลี่ยนจาก pre-effective → deleted (bucket ข้ามเหมือนเดิม ไม่กระทบ actionable).**
**Prev (410):** 10 มิถุนายน 2026 (Phase 410 fix-revert-stock-cas-idempotent — build 410, **MONEY/STOCK §4.1-4.2**) · ทำให้คืนสต็อกตอนลบบิล POS (`main.js _revertStockForSale` — เรียกจาก `modules/sales.js` delete handler) ปลอดภัย: **(1) CAS ทุก write** — warehouse branch `_atomicAddStock("warehouse_stock", targetWs.id, qty)` / legacy ไม่มี warehouse row `_atomicAddStock("products", product.id, qty)` (เดิม `xhrPatch` absolute จากค่า state cache = lost update ทับการขาย/โอนที่เกิดระหว่างนั้นจากเครื่องอื่น แล้ว trigger Phase 403 propagate ค่าผิดเข้า products.stock ต่อ); CAS fail → push error + `continue` (ไม่ log movement / ไม่นับ reverted); local cache sync จาก `add.after` (ค่าจริงที่ CAS คืน). **(2) Idempotent** — gate ต้นฟังก์ชัน GET `sales.note` สดจาก DB: มี `_STOCK_RETURNED_MARKER` ("[คืนสต็อกแล้ว]" reuse จาก service_equipment.js) → return `{ok:true,reverted:0,skipped:true}` no-op (กันคืนเบิ้ลทุก path รวม cross-device); **GET ล้ม → fail-closed** return `{ok:false,error:"เช็คสถานะคืนสต็อกไม่ได้..."}` ห้ามเดินหน้า revert; หลังจบ loop `revertedCount>0` (**รวม partial** — ถ้าไม่แปะแล้ว retry รอบใหม่ item ที่คืนแล้วถูกคืนซ้ำ = สต็อกพองเกิน = เสี่ยง oversell; รายการ fail surface ผ่าน errors ให้แอดมินแก้ทาง stock_movements) → re-GET note ล่าสุด → append marker (`xhrPatch sales.note`); marker PATCH ล้ม → warn + push errors **ห้าม rollback สต็อก**; revertedCount=0 → ไม่แปะ (retry ได้เต็ม). **(3) movement log fail = warn เท่านั้น** ห้าม rollback (ขนาน Phase 368). **(4) `modules/sales.js` delete handler:** pre-check `targetSale.note` มี "[ลบแล้ว]" → `showToast("บิลนี้ถูกลบไปแล้ว")` + return **ก่อน confirm** (กันยิง side-effect chain void JV/revert/loyalty ซ้ำจาก stale UI); `newNote` เขียนทับ → **append** ต่อ note เดิม (เก็บ marker ไม่ให้ถูกล้าง — ตัวแปรเดียวใช้ทั้ง PATCH + supabase fallback). คง return shape `{ok,reverted,errors}` + เพิ่ม `skipped` (caller อ่าน `rev?.reverted`/`rev?.errors?.length` — ไม่กระทบ) · คงลำดับ side effects + toast เดิม · คง heuristic คลัง "บ้าน" (future: เลือกคลังที่ขายจริงจาก movement เก่า). ❌ ไม่แตะ `_deductStockForSaleItem`/`_transferWarehouseStock`/`_applyStockMovement`/`_atomicAddStock`-`_atomicDecrementStock` internals/`stock_cas.js`/`service_equipment.js`/POS checkout (pos.js)/`voidJvForSource`/loyalty reverse/delivery_invoices/quotations/accounting/SQL · ไม่ alert(). +guard `revert_stock_cas` (source-regex extract body ก่อน, 7 ข้อ: CAS 2 branch · ห้าม xhrPatch absolute · marker gate+append · fail-closed ≥3 path · CAS fail→continue ≥2 · sales pre-check ordering+return · newNote append · no alert) · **ปรับ guard เดิม 2 ไฟล์ (justified — intent คงเดิม ไม่อ่อนลง):** `stock_movement_type_guard` (slice window ตายตัว 4000 chars → ถึงจบฟังก์ชัน เพราะฟังก์ชันยาวขึ้น; assertion `type:"return"` เดิมเป๊ะ) + `stock_mirror_canonical_guard` (invariant "เขียน products ตรงเฉพาะ legacy branch" เดิม แต่ regex ล็อก xhrPatch literal โค้ดเก่า → assert `_atomicAddStock("products"` ใน else branch + **เพิ่ม** ห้าม `xhrPatch("products"` ทั้งฟังก์ชัน = แข็งขึ้น) · `dashboard_readonly` bump 410. lint 0 / unit **1417** (1410+7) / e2e 12, bump 409→410 (index.html + sw.js; package.json คง 5.66.0). ✅ **MERGED → main (ff `7da1aea`) · live build 410 · owner smoke preview PASSED 2026-06-10 (บิลทดสอบ #186: JV SV2026060026 สร้าง→void ครบ, stock_movements sale 8→7 + return +1, sales.note ลงท้าย "[ลบแล้ว] … [คืนสต็อกแล้ว]", งอ90 กลับ 13 บ้าน:8 — DB-verified). smoke steps ที่ใช้: ขายบิลทดสอบ 1 บิล (สินค้า stock จริง) → สต็อกลด → ลบบิล → สต็อกกลับเท่าเดิม + stock_movements "return" 1 แถว/สินค้า + sales.note = "[ลบแล้ว] ... [คืนสต็อกแล้ว]" → ลองลบซ้ำ → toast "บิลนี้ถูกลบไปแล้ว" ไม่คืนเพิ่ม. known residual: (a) race window แคบ GET marker ↔ marker-PATCH เมื่อลบพร้อมกัน 2 เครื่อง (ปิดสนิท = DB-side guard phase อนาคต) (b) partial fail = marker แปะแล้ว → item ที่ fail แก้ manual ทาง stock_movements.**
**Prev (409):** 9 มิถุนายน 2026 (Phase 409 document-chain-1to1 — build 409, **SALES · UX guard**) · บังคับ **1:1 ทั้งเชนเอกสาร** — quotation ที่มีใบส่งของ active แล้ว → **บล็อก**ออกใบส่งของซ้ำ · ใบส่งของที่มีใบเสร็จ active แล้ว → **บล็อก**ออกใบเสร็จซ้ำ (เดิม branch `active.length>0` = confirm-to-proceed → ผู้ใช้กดยืนยันออกซ้ำได้ = เอกสารซ้ำเละ). ใบ `cancelled` ไม่บล็อก (ออกใหม่ได้). **(1) `quotations.js convertToDeliveryInvoice` (~1267):** branch active → `window.App?.showToast?.("มีใบส่งสินค้า <inv_no> จากใบเสนอราคานี้แล้ว — ลบ/จัดการใบเดิมก่อนถึงออกใบใหม่ได้")` + `return` (ไม่สร้างซ้ำ). **(2) `delivery_invoices.js convertToReceipt` (~724):** branch active → `showToast("มีใบเสร็จ <receipt_no> จากใบส่งสินค้านี้แล้ว...")` + `return`. คง `filter status!=="cancelled"` + branch else (confirm เดิม) + catch fallback เดิม (network fail บน check → ยัง confirm-to-proceed = residual out-of-scope). ❌ ไม่แตะ else branch (ออกปกติ) · duplicate-check query/filter/catch · cash-basis 408 (di-post no-op คนละส่วน) · convert logic อื่น · cancel/delete · เงิน/สต็อก/บัญชี · ไม่ alert(). +guard `doc_chain_1to1` (source-regex: branch active → showToast+return ไม่มี confirm-to-proceed · ยัง filter cancelled · else ยัง confirm); dashboard_readonly bump 409; lint 0 / unit 1410 / e2e 12, bump 408→409. ⏸️ **STOP — committed branch `claude/phase-409-doc-chain-1to1` (ยังไม่ push), รอ owner review. smoke: quotation ที่มีใบส่งของแล้ว กด "ออกใบส่งสินค้า" → บล็อก+toast (ไม่มีปุ่มยืนยันให้ผ่าน) · ใบส่งของที่มีใบเสร็จแล้ว กด "ออกใบเสร็จ" → บล็อก+toast · ที่ยังไม่มี/ใบเดิม cancelled → ออกได้ปกติ.**
**Prev (408):** 9 มิถุนายน 2026 (Phase 408 cash-basis-revenue-core — build 408, **ACCOUNTING §4.3 · owner-gated**) · เปลี่ยนการรับรู้รายได้สายเครดิต (ใบเสนอราคา→ใบส่งของ→ใบเสร็จ) จาก **accrual → cash-basis**: รายได้เกิดเมื่อใบเสร็จ `status="paid"` (Dr เงินสด/ธนาคาร / Cr รายได้ 4150) **เลิก**ลง revenue ตอนออกใบส่งของ. **(1) `quotations.js`** ปิดเรียก `postJournalForDeliveryInvoice` ตอนสร้างใบส่งของ (ถอด import + comment block). **(2) `auto_post.js postJournalForDeliveryInvoice`** → guard `return null` บรรทัดแรก (คงฟังก์ชัน + export ไว้). **(3) `auto_post.js postJournalForReceipt`** → `mappingKey` ใหม่ `receipt_revenue_cash`(Dr 1110)/`receipt_revenue_transfer`(Dr 1130) Cr 4150 (เดิม receipt_payment/transfer Cr 1200 A/R — **ห้ามแตะ key เดิม เพราะ `postJournalForCreditPayment` ใช้ร่วม**) + VAT split (`vat_amount>0.01` → 3 บรรทัด Dr เต็มยอด/Cr 4150 subtotal/Cr 2170 vat ผ่าน `splitSaleVatLines`; vat=0 → 2 บรรทัด Dr/Cr 4150) คงเงื่อนไข `status==="paid"`. **(4) `backfill.js`** case delivery_invoices → `result=null` (skip กัน backfill สร้าง revenue ซ้ำ). **owner รัน:** `supabase-phase408-cashbasis.sql` (INSERT mapping receipt_revenue_cash/transfer + NOTIFY pgrst) — **จนกว่ารัน mapping ยังไม่มี → receipt paid return null (ไม่มี JV) + invoice ก็ไม่ post = revenue หายชั่วคราว**. ❌ ไม่แตะ receipt_payment/receipt_transfer mapping · postJournalForSale(POS)/postJournalForServiceJob/postJournalForCreditPayment · receipt partial/pending (=Phase A2) · migration ข้อมูลเก่า (=Phase B แยก) · schema นอกจาก mapping · hasReceipt/delete (407). +guard `cashbasis_revenue_guard` (behavioral: invoice→null no-post / receipt paid vat=0→Dr1110·Cr4150 / transfer→Dr1130 / vat>0→3บรรทัด Σdr=Σcr / pending·partial→null / quotations source-regex ไม่เรียก di-post); dashboard_readonly bump 408; lint 0 / unit 1406 / e2e 12, bump 407→408. ⏸️ **STOP — committed branch `claude/phase-408-cashbasis-revenue-core` (ยังไม่ push), รอ owner review. ⚠️ owner smoke ทำ "หลัง" รัน SQL mapping + Phase B migration เท่านั้น (กัน double-count): ออกใบส่งของใหม่→ตรวจ "ไม่มี" JV รายได้ · เปิดใบเสร็จ "รับเงิน"(paid)→JV Dr เงินสด/Cr 4150 · Period Close รายได้ขึ้นตอน paid. Phase A2(installment)+B(migration) แยก.**
**Prev (407):** 9 มิถุนายน 2026 (Phase 407 delivery-invoice-delete-receipt-precheck — build 407, **กัน 409 + บิลพัง**) · ลบใบส่งสินค้าที่มี **ใบเสร็จ** (receipts.delivery_invoice_id FK) อ้างอิง เดิม = ลบ items ก่อน แล้วลบหัวบิลเจอ **HTTP 409** → items หายแต่หัวบิลค้าง = **บิลพัง** (0 รายการ มียอด, เคสจริง INV...146) → แก้: `_invoiceHasReceipt(invId)` live pre-check (ทุกสถานะ — FK บล็อกแม้ใบเสร็จ cancelled) **ก่อน** ลบอะไร: (1) diDeleteBtn → blocked → showToast "ลบไม่ได้ — มีใบเสร็จ <no> อ้างอิงอยู่ กรุณาลบ/จัดการใบเสร็จก่อน" + return (ไม่ลบอะไร); (2) diBulkDelete loop → blocked → fail++/continue + toast "ข้าม/ไม่สำเร็จ N (บางใบมีใบเสร็จ)" · query ล้ม → ไม่บล็อก (ไม่ false-positive) · **no-receipt → behavior เดิมเป๊ะ** · ❌ ไม่แตะ logic ลบจริง/restore quotation · cancel paths · date-edit lock (hasReceipt@448) · convertToReceipt/receipts.js/เงิน/สต็อก/บัญชี/POS · ไม่ alert() · lint 0 / unit 1399 / e2e 12 · ⏸️ **STOP — pushed branch `claude/phase-407-di-delete-receipt-precheck`, รอ Codex/owner review; owner smoke (ลบใบที่มีใบเสร็จ→บล็อก+บิลครบ; ใบไม่มีใบเสร็จ→ลบได้; ลบใบเสร็จก่อน→ลบใบส่งได้); known: atomic-delete+restore-quotation = follow-up**
**Version:** 5.66.0 (build 407) — Phase 407 delivery-invoice-delete-receipt-precheck (**กัน 409 + บิลพัง**: ลบใบส่งสินค้าที่มีใบเสร็จอ้างอิง [receipts.delivery_invoice_id FK] เดิม flow = DELETE delivery_invoice_items → DELETE delivery_invoices [หัวบิล]. ถ้ามีใบเสร็จ FK → DELETE หัวบิล 409 **หลัง** items ถูกลบไปแล้ว → items หาย หัวบิลค้าง = บิลพัง [0 รายการ แต่ grand_total มียอด; เคสจริง INV...146]. **fix [modules/delivery_invoices.js]:** +`export async function _invoiceHasReceipt(invId)` — live GET `receipts?delivery_invoice_id=eq.<id>&select=receipt_no,status` ผ่าน `window._appAuthFetch||fetch` [**ทุกสถานะ ไม่ filter status** — FK บล็อกแม้ใบเสร็จ cancelled; ไม่อ่าน state.receipts cache ที่อาจเก่า]; `!r.ok`/throw → `{blocked:false}` [query ล้ม=ไม่บล็อก, กัน false-positive บล็อก delete ที่ถูกต้อง]; มี rows → `{blocked:true, receipts}`. **(1) diDeleteBtn [single]:** หลัง confirm/**ก่อน**ลบ items → `_rc=await _invoiceHasReceipt(inv.id)`; blocked → `_ctx.showToast("ลบไม่ได้ — มีใบเสร็จ "+nos+" อ้างอิงอยู่ กรุณาลบ/จัดการใบเสร็จก่อน")` + **return [ไม่ลบอะไรเลย]**. **(2) diBulkDelete [loop]:** ต่อ id **ก่อน**ลบ items → blocked → `fail++; continue` [ข้าม ไม่ลบ]; toast สรุป "ลบสำเร็จ N, ข้าม/ไม่สำเร็จ M (บางใบมีใบเสร็จ)". **no-receipt path = behavior เดิมเป๊ะ** [DELETE items/invoice + restore quotation approved + audit log]. ❌ ไม่แตะ logic ลบจริง [DELETE/restore quotation] · cancel paths [PATCH status=cancelled — ไม่ลบ ไม่ corrupt] · hasReceipt@448 [date-edit lock, คนละเรื่อง] · convertToReceipt · receipts.js · เงิน/สต็อก/บัญชี/POS/JV · createClient · ไม่ alert(). +7 tests di_delete_receipt_precheck [behavioral: cancelled-receipt→blocked / []→ไม่บล็อก / !ok→ไม่บล็อก / throw→ไม่บล็อก / query targets FK ทุกสถานะ; source-ordering: pre-check ก่อน DELETE items ทั้ง single+bulk, blocked→return/continue]; dashboard_readonly bump 407; guards เดิมเขียว; unit 1399, e2e 12, lint 0, bump 406→407. **known [follow-up phase แยก]:** atomic-delete refactor [ลบ items+หัว+restore ใน txn เดียว/RPC] + restore-quotation-on-cancel. **owner smoke:** (1) ใบส่งที่ **มีใบเสร็จ** กดลบ → "ลบไม่ได้ — มีใบเสร็จ RC... อ้างอิงอยู่..." + บิล/items ยังครบ [ไม่พัง]; (2) ใบส่งที่ **ไม่มีใบเสร็จ** กดลบ → ลบได้ปกติ; (3) ลบใบเสร็จในหน้าใบเสร็จก่อน → กลับมาลบใบส่ง → ลบได้. **STOP — รอ review ก่อน merge/push main**)
**Previous:** 5.66.0 (build 406) — Phase 406 auth-recovery-graceful · ✅ merged → main (f580289) · CLOSED · (error-path only: หน้าตั้งรหัสผ่าน session หมดอายุ → submitNewPassword catch แยก session-dead → ข้อความชัด + ปุ่ม "ขอลิงก์ใหม่" [requestNewRecoveryLink กลับ login]; ไม่แตะ initSupabase/login/boot/money. Fix B [boot session gate] = follow-up. +5 tests auth_recovery_graceful.)
**Prev (406 detail):** 5.66.0 (build 406) — Phase 406 auth-recovery-graceful (**low risk · error-path only**: หน้า "ตั้งรหัสผ่านใหม่" [#setPasswordScreen — เพิ่มสมาชิก/recovery link] กดบันทึก → `submitNewPassword` เรียก `state.supabase.auth.updateUser({password})` → ถ้า session หมดอายุ/ลิงก์ถูกใช้แล้ว throw "Auth session missing!" → เดิม catch โชว์ raw error + ปุ่มกลับมา enable แต่ผู้ใช้ติดหน้าเดิม **ทำอะไรต่อไม่ได้** [งง]. **fix [modules/auth_email.js]:** (1) `submitNewPassword` catch ตรวจ `sessionDead = err?.name==="AuthSessionMissingError" || err?.status===401 || /session.*missing|missing.*session|expired|invalid|jwt/i.test(msg)` → ถ้าใช่: `setStatus("ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่")` + `$("setPwRequestNewBtn")?.classList.remove("hidden")` [โชว์ปุ่ม]; ไม่ใช่: `"บันทึกไม่สำเร็จ: <msg>"` [เดิม]; btn re-enable เสมอ. (2) +`requestNewRecoveryLink()` [export ใน return]: `state._recoveryMode=false` + `history.replaceState` ล้าง hash + ซ่อน `#setPasswordScreen` + โชว์ `#authScreen` + `setText("authStatus", 'ลิงก์หมดอายุ — กรอกอีเมล+กด "ลืมรหัสผ่าน?"')` + focus `#loginEmail`. **index.html:** ปุ่ม `<button id="setPwRequestNewBtn" class="btn light mt8 hidden">← ขอลิงก์ใหม่</button>` หลัง #setPasswordStatus. **main.js:** destructure `requestNewRecoveryLink` จาก createEmailAuth + wire `$("setPwRequestNewBtn")?.addEventListener("click", requestNewRecoveryLink)` ข้าง setPasswordBtn. ❌ ไม่แตะ initSupabase/onAuthStateChange/getSession/showSetPasswordScreen [**Fix B [boot session gate] = follow-up ยังไม่ทำ**] · login/requestStaffPasswordReset/signInWithPassword · happy-path/boot · เงิน/สต็อก/บัญชี/POS/service · createClient options · ไม่ alert(). +5 tests auth_recovery_graceful [behavioral fake-DOM: session-dead→status "หมดอายุ"+ปุ่มโผล่+btn re-enable; 401→ปุ่มโผล่; non-session→"บันทึกไม่สำเร็จ:"+ปุ่มยังซ่อน; requestNewRecoveryLink→screen swap+_recoveryMode=false; source: index ปุ่ม hidden + main wire]; auth_pin_executor/otp_verify guards เดิมเขียว; unit 1392, e2e 12, lint 0, bump 405→406. **note:** Fix B [boot session gate — getSession ตอน boot กัน recovery flow โผล่ตอน session ยังไม่พร้อม] = follow-up phase แยก. **owner smoke:** ใช้ลิงก์ตั้งรหัสเก่า/ปล่อย session หมด → กดบันทึก → ขึ้น "ลิงก์หมดอายุ..." + ปุ่ม "← ขอลิงก์ใหม่" → กดแล้วกลับหน้า login พร้อมข้อความ [ไม่ค้าง/ไม่ raw "Auth session missing!"] · happy-path [ตั้งรหัสปกติ session ยังอยู่] ไม่กระทบ. **STOP — รอ review ก่อน merge/push main**)
**Previous:** 5.66.0 (build 405) — Phase 405 receipt-acct-badge-refresh · ✅ merged --no-ff → main (4c1e7b4) + live build 405 + owner preview-smoke PASSED (badge flip เอง "SV2026060026 ลงบัญชีแล้ว", journal 60=60) · CLOSED · (cosmetic display-only: ป้ายบัญชีบนใบเสร็จ POS ค้าง "ยังไม่ลงบัญชี" จาก ordering [lookup ก่อน JV เกิด] → main.js _fillReceiptAcctTrace retry-poll lookup จน JV โผล่ flip เอง; pos.js untouched. +guard receipt_acct_trace_refresh.)
**Prev (405 detail):** 5.66.0 (build 405) — Phase 405 receipt-acct-badge-refresh (**cosmetic · display-only**: ป้ายเอกสารบัญชีบนใบเสร็จ POS ค้าง "ยังไม่ลงบัญชี" ทุกบิลทั้งที่ลงบัญชีจริง — **deterministic ordering bug** ไม่ใช่ data bug. badge=live lookup [Phase 92.17 sale_trace `findJournalForSale` key source_table='sales'+source_id=sale.id] ยิงตอนเปิดใบเสร็จ. **checkout flow `pos.js doCheckout`:** `openReceiptDrawer()` [`:1250`, ยิง lookup] → `await loadAllData()` → `postJournalForSale()` [`:1257`, สร้าง JV fire-and-forget] → lookup รัน**ก่อน** JV เกิดเสมอ → "missing"="ยังไม่ลงบัญชี" + ไม่ re-poll → ค้างจนปิด-เปิดใหม่. **fix [self-contained ใน main.js _fillReceiptAcctTrace — ไม่แตะ checkout flow; pos.js revert กลับเดิม diff ว่าง]:** lookup แรกได้ "missing" [JV ยังไม่ลง] → โชว์ "⏳ กำลังลงบัญชี…" + **retry lookup ตัวเอง** [setTimeout chain `attempt+1`] จน status≠missing หรือครบ `RECEIPT_TRACE_MAX_RETRY=6` [ทุก `RECEIPT_TRACE_RETRY_MS=1500ms` ≈ 9s ครอบ loadAllData+post]; **stop-guard:** retry เฉพาะถ้า `String(lr.id)===String(sale.id)` [ยังบิลเดิม กัน poll ผิดบิล+type mismatch] && `#receiptAcctTrace` ยังอยู่ [drawer เปิด]; เจอ → badge "ลงบัญชีแล้ว" [คลิกไป JV ได้ 92.20]; ครบ retry ยัง missing → "ยังไม่ลงบัญชี" [honest: unposted จริง before-effective/post-fail]. ❌ ไม่แตะ posting/auto_post/JV/money/stock/loyalty/sale_trace internals/**checkout flow (pos.js diff ว่าง)** — display retry ล้วน [read-only lookup]. +guard receipt_acct_trace_refresh [source-wiring: retry bounded attempt<MAX/recursive attempt+1/setTimeout ไม่ใช่ setInterval/stop-guard id+drawer/no write-post-stock · pos.js untouched + .catch เดิมคงอยู่]; dashboard_readonly bump 405; unit 1387, lint 0, bump 404→405. **why retry แทน .then [first attempt revert]:** เดิมลอง pos.js post `.then()` refresh — แต่ post อยู่หลัง `await loadAllData` → flip ช้าหลายวินาที + janky (owner smoke เห็นเหลืองค้าง); retry-poll flip เองทันที JV โผล่ + ไม่แตะ money path = robust กว่า. **🔴 owner smoke:** [1] ขายบิลใหม่ → ใบเสร็จเด้งเอง → "⏳ กำลังลงบัญชี…" → **"📒 SV… ลงบัญชีแล้ว" เองใน ~few วิ** [ไม่ต้องปิด-เปิด]; [2] เปิดบิลเดิมจากรายการขาย → เขียวทันที; [3] ปิดใบเสร็จก่อน flip → ไม่ค้าง/ไม่ error [retry หยุดเอง]. **✅ merged --no-ff → main (4c1e7b4) + live build 405 + owner preview-smoke PASSED (auto-popped receipt badge flip เอง → "SV2026060026 ลงบัญชีแล้ว", journal Dr เงินสด 60=Cr รายได้ 60) · CLOSED**)
**Previous (build 404):** 8 มิถุนายน 2026 (Phase 404 service-job-cancel-restore-stock — build 404, **MONEY/STOCK §4.2 · = Part C ของ 403 ที่ owner ตัดสินทำ**) · งานช่างที่มีอุปกรณ์ ตัดสต็อกตอนสร้าง (Phase 402) แต่ยกเลิก/ลบ **ไม่คืนสต็อก** → อุปกรณ์หายถาวร → เพิ่ม cancel/delete → **คืนสต็อก** (return movement) ผ่าน `_appApplyStockMovement("return")` → trigger 403 sync products.stock เอง · helper `restoreServiceJobStock()`+`STOCK_RETURNED_MARKER` (idempotent note-marker กันคืนซ้ำ; คืนเฉพาะ item มี warehouse_id; ไม่มี items_json→no-op) · **wire ครบ 3 cancel path (grep กฎเหล็ก #1):** service_jobs.js delete · ai_sales.js cancel (AI ไม่มี items_json=no-op) · main.js saveServiceJob edit→cancelled · error คืนบางตัว→showToast ไม่ rollback (§4.8) · ไม่แตะ warehouse CAS/floor/transfer/trigger/products.stock/auto_post/POS · lint 0 / unit 1382 / e2e 12 / money-stock guards 70 ไม่แดง · ✅ **merged --no-ff → main (123bc0d) + live build 404 verified (data-app-build=404 · sw cache v404 · restoreServiceJobStock บน prod) + owner preview-smoke PASSED (งอโค้ง 12→10 ตัด, ลบงาน 10→12 คืนเข้าคลังบ้านเดิม +2 เป๊ะ, divergence=0, สมุดรายวันนิ่ง 86/81/5) · CLOSED; un-cancel re-deduct = future**
**Prev (404 detail):** 5.66.0 (build 404) — Phase 404 service-job-cancel-restore-stock (**MONEY/STOCK §4.2 · owner-approved (= Part C ของ Phase 403)**: งานช่างที่มีอุปกรณ์ [items_json] ตัดสต็อกตอนสร้าง [Phase 402] แต่ยกเลิก/ลบ **ไม่คืนสต็อก** → อุปกรณ์หายจากคลังถาวร [ต้นเหตุที่ owner เจอ]. **helper modules/service_equipment.js:** `STOCK_RETURNED_MARKER="[คืนสต็อกแล้ว]"` + `restoreServiceJobStock(job)` → loop items_json คืนผ่าน `window._appApplyStockMovement({movementType:"return",productId,warehouseId,qty})` [trigger 403 sync products.stock เอง — ไม่แตะ products ตรง]; **idempotent:** note มี marker แล้ว → restored:false no-op [กันคืนซ้ำ]; items_json ว่าง → no-op; **คืนเฉพาะ item ที่มี warehouse_id** [ถูก warehouse-deduct จริง; ไม่มี→skip ไม่เดาคลัง]; คืน {restored,newNote,errors}. **wire ครบทุก cancel path [กฎเหล็ก #1 grep 'status cancelled' service_jobs — เจอ 3, ยืนยันไม่มีเพิ่ม; customer_dashboard:791=closed ไม่ใช่ cancel]:** (1) **service_jobs.js delete** [342, soft-delete cancelled+[ลบแล้ว]]: restore ก่อนสร้าง updatePayload + ใส่ marker ใน newNote ถ้า restored||note เดิมมี marker + showToast ถ้า errors; (2) **ai_sales.js cancel** [676, ลูกค้ายกเลิกผ่าน AI]: restore({...orderData,id}) + marker ถ้า restored [AI order ไม่มี items_json+ไม่ deduct ตอนสร้าง = no-op, ใส่ตาม completeness]; (3) **main.js saveServiceJob** [edit→cancelled transition: editingServiceJobId && payload.status===cancelled && origStatus≠cancelled]: restore job จาก state.serviceJobs + ใส่ marker ใน payload.note. error คืนบางตัว → showToast เตือน ไม่ rollback cancel [§4.8 ไม่กลืนเงียบ]. ❌ ไม่แตะ warehouse CAS/floor/transfer/trigger 403 · products.stock [derived] · auto_post/JV · POS · deduct logic [Phase 402]. +7 tests service_job_cancel_restore [behavioral: return-movement/idempotent-marker/empty-noop/skip-no-warehouse/partial-fail-surfaced/no-products-write + **completeness guard: ทุก cancel path เรียก restoreServiceJobStock** กัน path ใหม่ลืม]; stock_mirror_canonical/stock_cas/service_equipment/auto_post/floor guards เดิมเขียว; unit 1382, e2e 12, lint 0, bump 403→404. **known risks:** un-cancel [cancelled→active re-deduct] = future phase [marker ค้างจะกัน — แต่ flow นี้ยังไม่มี]; deploy ปกติ [ไม่มี trigger ordering issue เหมือน 403]. **🔴 owner money/stock smoke บังคับ:** (1) สร้างงาน+อุปกรณ์ qty2 [stock−2] → ลบงาน → stock+2 คืน [warehouse+products ตรง via trigger, divergence=0]; (2) ลบซ้ำ/re-save → ไม่คืนซ้ำ [marker]; (3) ยกเลิกผ่าน AI → คืน [ถ้ามี items]; (4) งานไม่มีอุปกรณ์ → ลบ → ไม่ error/ไม่คืน. **✅ merged --no-ff → main (123bc0d) + live build 404 + owner preview-smoke PASSED (ตัด −2 → ลบงาน คืน +2 เข้าคลังเดิม, divergence=0, journal unchanged) · CLOSED**)
**Previous:** 5.66.0 (build 403) — Phase 403 stock-mirror-canonical-sync · ✅ merged --no-ff → main (a887d7c) + live build 403 + owner deploy (deploy 403 → trigger → backfill) + smoke PASSED (divergence=0 ทุกตัว, products.stock=sum) · CLOSED · (products.stock = sum(warehouse_stock) ผ่าน DB trigger [full-derived]; JS ถอด direct-write 3 จุด เหลือ legacy เฉพาะ no-warehouse; deploy 403 ก่อน trigger. +5 guard stock_mirror_canonical.)
**Prev (403 detail):** 5.66.0 (build 403) — Phase 403 stock-mirror-canonical-sync (**MONEY/STOCK §4.2 · owner-approved full-derived**: `products.stock` [ยอดรวม derived] หลุด sync จาก `warehouse_stock` [truth ต่อคลัง] เพราะ `_applyStockMovement` อัปเดต 2 ตัวแยกกัน best-effort [ตัวนึงพลาด=ไม่ rollback] → Phase 402 smoke เจอ 6 ตัวเพี้ยน −1 [resync มือแล้ว]. แก้ราก: products.stock = sum(warehouse_stock) เสมอ. **audit direct writers เจอ 4 จุด:** (1) manual edit saveProduct [products.stock=totalStock=sum แล้วเขียน warehouse → trigger เขียนทับด้วยค่าเท่ากัน = OK, ปล่อยไว้]; (2) _applyStockMovement mirror; (3) POS _deductStockForSaleItem [3045]; (4) _revertStockForSale [3135]. **เจอ contradiction:** prompt Part B ลบแค่ #2 + ห้ามแตะ POS — แต่ trigger เป็น AFTER trigger บน warehouse_stock [รันใน txn] → #3/#4 เขียน products.stock ตรงหลัง warehouse → **double-count** [POS=sum−qty ทุกบิล]. owner เลือก **full-derived: ถอด direct write ทุกจุด**. **Part A [owner รัน SQL]:** supabase-phase403-stock-sync-trigger.sql — function sync_product_stock() update products set stock=coalesce(sum(warehouse_stock where product_id=pid),0) + trigger AFTER insert/update/delete on warehouse_stock for each row + one-time backfill [สินค้าที่ไม่มี wh row คง stock เดิม ไม่ตั้ง 0] + NOTIFY pgrst. **Part B [JS full-derived]:** #2 mirror block [CAS/decrement/add/adjust products] ลบ → เหลือ optimistic local recompute `prod.stock = sum(warehouseStock cache)` ไม่เขียน DB; #3 POS: `if(stocks.length>0)` → optimistic local sum [ไม่เขียน products ตรง, กันตัดซ้ำ], `else`[ไม่มี warehouse row] → คง `_atomicDecrementStock("products")` + legacy movement log; #4 revert: `if(targetWs)` → sync local targetWs.stock + product.stock=sum local, `else` → คง `xhrPatch("products",{stock:+qty})`. เหลือ products direct write 2 จุด = legacy no-warehouse เท่านั้น [trigger ไม่ fire → JS ต้องเขียนเอง]. **⚠️ DEPLOY ORDER [แก้ addendum — ของเดิมเขียน "trigger ก่อน" ผิด → double-count]:** ทำตอนร้านปิด/ไม่มีบิล: (1) ยืนยันไม่มีการขาย → (2) **deploy build 403 ก่อน** [JS ใหม่ defer trigger ไม่เขียน products.stock บิล warehouse] → (3) รัน Part A trigger → (4) รัน backfill → (5) verify divergence=0 + ขายทดสอบ −1 ครั้งเดียว. **เหตุผล:** ถ้ารัน trigger ตอน prod ยัง 402 [JS เก่ายังเขียน products ทุกบิล] + มีขาย → warehouse −1 → trigger ตั้ง products=sum → JS 402 ลบซ้ำ = sum−qty double-count ทุกบิลจน 403 deploy [backfill แก้ได้แค่อดีต]. deploy 403 ก่อน = products.stock บิล warehouse freeze ชั่วคราว [ร้านปิด=ไม่กระทบ, freeze กู้ได้ด้วย backfill — ปลอดภัยกว่า]. backfill = run ปิดท้ายเสมอ. ❌ ไม่แตะ warehouse_stock CAS/floor [truth, Phase 367-369] · transfer sum-neutral [3272] · auto_post/JV · POS warehouse deduct logic. +5 guard stock_mirror_canonical [migration ships/mirror removed/warehouse floor kept/POS legacy-branch-only/revert legacy-branch-only]; อัปเดต apply_stock_movement_floor 3 tests [products mirror assertion → trigger-derived, warehouse floor คงเดิม — design เปลี่ยนจริง ไม่ใช่ปิด test]; stock_cas/auto_post/checkout/service_equipment guards เดิมเขียว; unit 1375, e2e 12, lint 0, bump 402→403. **Part C [owner decision, ยังไม่ทำ]:** service-job delete/cancel [service_jobs.js → status=cancelled] ปัจจุบันไม่ reverse stock → อุปกรณ์ที่ตัดไปไม่คืน [ต้นเหตุที่ owner เจอ, resync มือแล้ว]. ต้องการ "cancel งานที่มีอุปกรณ์ = คืนสต็อก [_applyStockMovement movementType:return]" ไหม = scope แยก. **🔴 owner smoke บังคับ [หลังรัน Part A trigger]:** SELECT divergence=0; (a) POS ขาย 1 → warehouse+products ลดตรงกัน; (b) งานช่าง+อุปกรณ์ → ตรงกัน; (c) แก้สต็อกมือ → products sync; (d) transfer บ้าน↔รถ → products.stock ไม่เปลี่ยน [sum เท่าเดิม]; (e) กดรัวๆ → ไม่เพี้ยน; ทุกเคส divergence=0. **✅ merged --no-ff → main (a887d7c) + live build 403 + owner smoke PASSED (divergence=0, products.stock=sum ทุกตัว, ขาย −1 ครั้งเดียว) · CLOSED**)
**Previous:** 5.66.0 (build 402) — Phase 402 service-job-equipment-from-stock · ✅ merged --no-ff → main (c0dbb6a) + live build 402 + owner money/stock smoke PASSED (สต็อกลดจริง + กดรัวๆ ไม่ซ้ำ via inflight guard) · PR #66 · CLOSED · (drawer งานช่างเพิ่มอุปกรณ์จากสต็อก [picker+precheck+deduct via _appApplyStockMovement, งานใหม่เท่านั้น, งานเดิม read-only], modules/service_equipment.js, +addendum inflight guard บน saveServiceJob. +9+2 guards.)
**Prev (402 detail):** 5.66.0 (build 402) — Phase 402 service-job-equipment-from-stock (**MONEY/STOCK §4.1+§4.2 · deduct-only scope, owner-approved via AskUserQuestion**: drawer "เพิ่มงานช่าง" (openServiceJobDrawer, main.js) เดิมไม่มี concept อุปกรณ์ [มีแค่ labor/discount; _itemsTotal อ่าน read-only จาก items_json เดิม] — ห้องอื่น (service_form.js ใบงานซ่อม/ติดตั้งแอร์) มีอยู่แล้ว. **เพิ่ม:** section "🔧 อุปกรณ์ที่ใช้ (จากสต็อก)" + ปุ่ม "+ เพิ่มอุปกรณ์" → picker (modal) เลือกสินค้า + คลังที่ **มีสต็อกอยู่แล้ว** [mobile/home, ไม่ auto-transfer] + qty → list แก้ qty/ลบได้ + "รวมอุปกรณ์" → ยอดสุทธิ. **save (เฉพาะสร้างงานใหม่, mirror service_form.js):** precheck `aggregateNeedByKey` รวม qty ต่อ (product|warehouse) เทียบสต็อกจริง → ไม่พอ = บล็อก showToast ไม่บันทึก/ไม่ตัด [floor กันติดลบ]; `items_json`=fullItems (product_id/warehouse_id/qty/unit_price/line_total/is_main); `total_cost`=itemsTotal+labor−discount [auto-post JV ใช้ค่านี้]; **invariant:** job insert สำเร็จก่อน → ค่อยตัดสต็อกผ่าน `window._appApplyStockMovement({movementType:"out",...})` [CAS/floor — ไม่ raw warehouse_stock write]; ตัดบางตัว fail → stockOpsFailed → showToast เตือน ไม่ rollback job [reconcile §4.8 ไม่กลืนเงียบ]; optimistic state.warehouseStock [Phase 45.4, ไม่ await loadAllData]. **กันตัดซ้ำ:** งานเดิม (มี items_json) → `_serviceDrawerEquipReadonly=true` → clone items แสดง read-only + ป้าย "🔒 ตัดสต็อกแล้ว แก้ไม่ได้" + ปุ่มเพิ่ม/picker ปิด → `_equipItemsForSave=[]` → ไม่ deduct. **โมดูลใหม่ modules/service_equipment.js** [import โดย main.js เท่านั้น — **service_form.js ไม่ถูกแตะเลย**]: warehouseStockOptions/equipmentTotal/precheckEquipmentStock/toItemsJson/deductEquipmentStock/optimisticDeduct/renderEquipmentList/openEquipmentPicker [+_pickWarehouse modal]. ❌ ไม่แตะ auto_post double-entry/JV internals/period-lock/COA [แค่ให้ total_cost รวมอุปกรณ์ถูก] · POS/cart · schema/SQL/RLS [items_json/total_cost columns มีแล้ว — service_form ใช้อยู่] · service_form.js behavior · stock CAS internals · ไม่มี auto-transfer บ้าน→รถ. +9 tests service_job_equipment_guard [pure: equipmentTotal/precheck-aggregate-block/toItemsJson/deduct-out-surface-fail/optimistic-floor; source: no-raw-write+reuse-precheck, deduct-new-only, edit-readonly-clone, showToast-not-alert]; stock_cas/auto_post/checkout guards เดิมเขียว; unit 1369, e2e 12, lint 0, bump 401→402. **known risks:** แก้/คืนอะไหล่หลังบันทึก = future phase [edit อุปกรณ์ read-only]; cross-warehouse auto-transfer (บ้าน→รถ) = future [scope นี้เลือกคลังที่มีสต็อกอยู่แล้วเท่านั้น]; product cost/price=0 → line_total 0. **🔴 owner money/stock smoke บังคับ ก่อน merge:** (1) สร้างงานช่างใหม่ + อุปกรณ์ qty 2 จากคลัง X → บันทึก → สต็อกลด 2 จริง [`select stock from warehouse_stock where product_id=.. and warehouse_id=X` before/after] + ยอดรวมถูก; (2) อุปกรณ์เกินสต็อก → บล็อก/เตือน ไม่ติดลบ; (3) แก้งานเดิม + re-save → สต็อกไม่ลดซ้ำ; (4) ปิดงาน delivered → JV รวมอุปกรณ์ถูก [total_cost]; (5) service_form.js ใบงานซ่อม/แอร์ → ทำงานเหมือนเดิม. **✅ merged --no-ff → main (c0dbb6a) + live build 402 + owner smoke PASSED · CLOSED**)
**Previous:** 5.66.0 (build 401) — Phase 401 mobile-fix-report-headers · ✅ merged --no-ff → main (e3cce2e) + live build 401 verified + deployed code confirmed [.rep-head-main + @media≤600px live] · CLOSED · (layout/CSS-only: report header title block → class .rep-head-main + @media≤600px → ปุ่ม Excel/พิมพ์ wrap ลงล่าง, title ไม่แตกแนวตั้ง; 5 หน้า TB/P&L/BS/Export/OB; ไม่แตะ report/export/print logic/ปุ่ม id. +4 tests report_header_mobile.)
**Prev (401 detail):** 5.66.0 (build 401) — Phase 401 mobile-fix-report-headers (**layout/CSS-only · ไม่แตะ logic**: header รายงานบัญชี 5 หน้า [pattern เดียวกัน: emoji + title block `<div style="flex:1;min-width:200px">` มี h2+subtitle + ปุ่ม Excel/พิมพ์] title ไทยแตกแนวตั้งบนมือถือ ~360px — **audit Phase 400 พลาด** [มองว่า min-width:200px safe แต่จริงปุ่มไม่ wrap → บีบ title]. **แก้:** title div → class `.rep-head-main` ใน trial_balance/profit_loss/balance_sheet/export_bundle/opening_balance [header]; เนื้อหา h2/subtitle/ปุ่ม/period picker/ตาราง คงเดิม. **style.css [global]:** `.rep-head-main{flex:1 1 auto;min-width:200px}` + `@media(max-width:600px){flex:1 1 100%;min-width:0}` → ≤600px title เต็มแถว → ปุ่ม wrap ลงบรรทัดล่าง [parent row มี flex-wrap:wrap อยู่แล้ว]; desktop เหมือนเดิม. ❌ layout/CSS-only: ไม่แตะ logic รายงาน/คำนวณ Dr-Cr/balance/export/print/period · ตาราง · ปุ่ม id [tbExportBtn/plExportBtn/bsExportBtn/ebDownloadBtn/obSubmitBtn ฯลฯ] · .panel/shared CSS อื่น · หน้าอื่น · ไม่ inline media query [ใช้ class] · ไม่ alert/dependency. +4 tests report_header_mobile [5 ไฟล์ class+ไม่เหลือ inline flex:1;min-width:200px · h2 คงอยู่ · button id คงอยู่ · css @media เต็มแถว]; mobile_row_layout/dashboard guards เดิมเขียว; unit 1360, e2e 12, lint 0, bump 400→401. **owner smoke มือถือ ~360px:** เปิดทั้ง 5 หน้า [#accounting_trial_balance/_profit_loss/_balance_sheet/_export_bundle/_opening_balance] → title**ไม่แตกแนวตั้ง** + ปุ่ม Excel/พิมพ์ บรรทัดล่างเต็ม · กด "ดูรายงาน" ได้ปกติ · desktop ทั้ง 5 เหมือนเดิม. **✅ merged --no-ff → main (e3cce2e) + live build 401 verified**)
**Previous:** 5.66.0 (build 400) — Phase 400 mobile-fix-vertical-text · ✅ merged --no-ff → main (1b874e1) + live build 400 verified + deployed code confirmed [.ob-row class + @media≤600px live] · CLOSED · (layout-only: opening_balance row .ob-* [flex-wrap+min-width, mobile input เต็มกว้าง] + refunds top-reasons flex-wrap+min-width; คง input id+escHtml; ไม่แตะ balance/JV/refund logic. +4 tests mobile_row_layout.)
**Prev (400 detail):** 5.66.0 (build 400) — Phase 400 mobile-fix-vertical-text (**layout-only · ไม่แตะ logic**: บั๊กมือถือ ~360px "ข้อความไทยแตกแนวตั้ง" จาก flex row ไม่ wrap + control fix-width บีบ text. audit ทั้ง codebase 2026-06-08 เจอ 2 จุด [ที่เหลือกันด้วย flex-wrap/min-width/auto-fit อยู่แล้ว — ไม่แตะ]. **(1) accounting/opening_balance.js [หลัก]:** 3 row block [asset/liability/equity เหมือนกัน] จาก inline-style flex [width:160px input บีบชื่อจน ~0] → class `.ob-row`/`.ob-emoji`/`.ob-code`/`.ob-name`/`.ob-input`; **คง `id="ob_${f.code}"` [save อ้าง] + type/step/min + `escHtml(f.label)` เป๊ะ**. **style.css [global, ปลายไฟล์]:** `.ob-row` flex-wrap · `.ob-name` flex:1 1 auto + **min-width:110px** [กันยุบ] · `.ob-input` 160px · `@media(max-width:600px)` `.ob-input` width:100%+flex:1 1 100% [เต็มกว้างจอแคบ]. **(2) refunds.js [hardening]:** row panel เหตุผลคืนสินค้า [204-205]: +`flex-wrap:wrap` + reason div `flex:1 1 120px;min-width:120px` [bar 200px wrap ลงล่างบนจอแคบ, เหตุผลกว้างเต็ม; desktop เหมือนเดิม] · คง `escHtml(r)`. ❌ layout-only: ไม่แตะ live balance calc[107+]/ปุ่มบันทึก/JV idempotency/debit=credit [OB] · refund action/total/pct/bar logic [refunds] · *_FIELDS/topReasons values · input id · หน้าอื่นที่ audit ว่า clean · ไม่ inline media query [OB ใช้ class] · ไม่แตะ JS logic. +4 tests mobile_row_layout [class ใช้แล้ว+ไม่เหลือ inline width:160px · id คงอยู่+escHtml · css min-width+@media · refunds flex-wrap+min-width]; dashboard guards เดิมเขียว; unit 1356, e2e 12, lint 0, bump 399→400. **owner smoke มือถือ ~360px:** #accounting_opening_balance → ชื่อบัญชี**ไม่แตกแนวตั้ง** + input กรอกง่าย + กรอก 1 ช่อง live balance ยังถูก · #refunds → panel เหตุผลอ่านง่ายไม่คับ · desktop ทั้ง 2 หน้าเหมือนเดิม. **✅ merged --no-ff → main (1b874e1) + live build 400 verified**)
**Previous:** 5.66.0 (build 399) — Phase 399 topbar-notif-profile · ✅ merged --no-ff → main (76dda45) + live build 399 verified + deployed code confirmed [notifBell/profileChip live] · CLOSED · (display + navigation · READ-ONLY: topbar-right 🔔 notification bell [badge=low-stock→products] + 👤 profile chip/menu [settings/logout]; extract _countLowStockItems single source [sidebar+bell]; ชื่อผ่าน escapeHtml; logout reuse __authLogout; CSS global. +5 tests topbar_notif_profile.)
**Prev (399 detail):** 5.66.0 (build 399) — Phase 399 topbar-notif-profile (**display + navigation · READ-ONLY**: เพิ่มใน topbar-right [index.html] → ปุ่ม **🔔 notification bell** [`#notifBell` + badge `#notifBadge` = จำนวนสินค้า product_type=stock ที่ stock≤0 หรือ stock≤min_stock; คลิก→showRoute("products")] + **👤 profile chip/menu** [`#profileChip`→toggle `#profileMenu` aria-expanded sync · avatar ตาม role 🛡️/💼/🔧 · ⚙️ตั้งค่า→showRoute("settings") · 🚪ออกจากระบบ→`window.__authLogout?.()` reuse auth.js ไม่ re-implement · click-outside ปิด]. **main.js:** extract pure `_countLowStockItems(products)` = **single source** → `_updateLowStockBadge` [sidebar เดิม] + `_updateNotifBell` ใช้ helper เดียวกัน [เลขไม่ divergent]; `_updateProfileChip` ชื่อ=full_name||email-prefix||"ผู้ใช้" ผ่าน **escapeHtml** [XSS], avatar map; ทั้งคู่เรียกใน renderAll. wiring หลัง menuToggle. **CSS [style.css global, ไม่ per-template `<style>`]:** .topbar-notif/.notif-badge/.topbar-profile-wrap/.topbar-profile/.profile-avatar/.profile-name/.profile-menu/.profile-menu-item — token-driven [dark-safe], .hidden=display:none, mobile<560px ซ่อนชื่อเหลือ avatar. ❌ READ-ONLY display+nav: ไม่ fetch/network/RPC/write · ไม่แตะ topbar-left/global-search/refreshBtn/checkout/pos/เงิน/VAT/stock/accounting/JV/schema/SQL/RLS/dependency · ไม่ alert [navigation ผ่าน showRoute]. +5 tests topbar_notif_profile [markup ids/keep search+refresh · single-source shared · escapeHtml+logout-reuse+settings/bell nav · read-only no fetch/write]; dashboard_readonly/income/ui/trend/recent_txn + xss guards เดิมเขียว; unit 1352, e2e 12, lint 0, bump 398→399. **owner smoke:** topbar เห็น 🔔 [badge=จำนวนสินค้าใกล้หมด ตรง sidebar] + 👤 [ชื่อ/role ถูก] · คลิก 🔔→หน้าสินค้า · คลิก 👤→เมนู → ตั้งค่า→หน้าตั้งค่า · ออกจากระบบ→logout จริง · คลิกนอกเมนู→ปิด · dark mode ไม่เพี้ยน · มือถือไม่ล้น. **✅ merged --no-ff → main (76dda45) + live build 399 verified**)
**Previous:** 5.66.0 (build 398) — Phase 398 fix-gross-profit-kpi · ✅ merged ff → main (e0f6625) + live build 398 verified + deployed code confirmed · ✅ **owner money-path smoke PASSED (2026-06-08: ขายจริง #pos → checkout ไม่ error + gross_profit เขียนเข้า DB)** · **CLOSED** · (MONEY WRITE-PATH §4.1: pos.js _computeGrossProfit เขียน sales.gross_profit ตอน checkout + fallback กัน checkout พัง.)
**Prev (398 detail):** 5.66.0 (build 398) — Phase 398 fix-gross-profit-kpi (**MONEY WRITE-PATH §4.1**: KPI "กำไรขั้นต้น" [dashboard.js:310] อ่าน sales.gross_profit ที่แอปไม่เคยเขียน → ฿0 เสมอ [dead metric, 42703]. **schema [owner ran]:** ALTER TABLE sales ADD gross_profit NUMERIC(14,2) + NOTIFY pgrst [2026-06-07; verified column มีจริง — REST คืน 42501 RLS ไม่ใช่ PGRST204]; migration supabase-phase398-gross-profit.sql ใน commit. **pos.js:** pure _computeGrossProfit(cart,products,subtotal) = subtotal[ex-VAT] − Σ(products.cost×qty) [cost = source เดียวกับ sale_items.unit_cost], null ถ้าตะกร้าว่าง/quick-pay [ไม่ inflate], round2. doCheckout: +gross_profit ใน salePayload [subtotal เดิมไม่เปลี่ยน=_saleSubtotal] + defensive fallback ตัด gross_profit retry ถ้า column error [กัน checkout พัง]. ❌ ไม่แตะ amount/VAT/total/paid/change/discount/stock CAS/loyalty/JV auto-post [gross_profit เป็น field เกินที่ JV ignore]/inflight guard/sale_items/dashboard.js. +7 tests pos_gross_profit; multi_payment/quick_pay/checkout_inflight guards เดิมเขียว; unit 1348, e2e 12, lint 0, bump 397→398. **known:** บิลเก่า=null [backfill future]; product cost=0 → กำไรเกินจริง. **owner money-path smoke:** ขายจริง→checkout ไม่ error · quick-pay ไม่พัง · #dashboard กำไรขั้นต้น>0 ตรง · DB บิลใหม่ gross_profit ไม่ null.)
**Previous:** 5.66.0 (build 397) — Phase 397 dashboard-recent-txn · ✅ merged (9ec6bda) + live · MERGED/LIVE · (display · read-only: เพิ่มบล็อก "🧾 ธุรกรรมล่าสุด" [ตารางขายล่าสุด ≤30 + scroll], _recentTxnRows role-isolated + escapeHtml + clone ก่อน sort, sub-label ซื่อตรง. +3 tests dashboard_recent_txn.)
**Prev (397 detail):** 5.66.0 (build 397) — Phase 397 dashboard-recent-txn (display · READ-ONLY: เพิ่มบล็อก **"🧾 ธุรกรรมล่าสุด"** บนหน้า dashboard — panel full-width ตารางรายการขายล่าสุด ≤30 + scroll [max-height 360px]. helper _recentTxnRows(state): source visibleSalesForRole(state.sales,profile,currentUser) [role-filtered + soft-delete; non-admin เห็นเฉพาะของตัวเอง = กัน data leak], clone ก่อน sort [...sales].sort(desc created_at).slice(0,30) [ห้าม mutate state.sales], columns วันที่/เลขที่บิล/ลูกค้า/ช่องทาง/ยอด + badge เครดิต, **escapeHtml ทุกค่าจาก DB** [XSS: order_no/customer_name/payment_method], empty-state "ยังไม่มีธุรกรรม". sub-label ซื่อตรง "รายการขายล่าสุด (สูงสุด ~50 ที่โหลด) — ไม่ใช่ทั้งระบบ". แทรกหลัง top-products/expenses ก่อน ALERTS. ❌ read-only ล้วน: ไม่ fetch/RPC/write · ไม่ mutate state.sales [clone ก่อน sort] · ไม่แตะ checkout/pos/logic เงิน/สต็อก/บัญชี/schema/SQL/trend(396)/charts/KPI/sidebar/shared CSS/dependency. +3 tests dashboard_recent_txn; xss_regression + dashboard_readonly/income/ui/trend guards เดิมเขียว; unit 1341, e2e 12, lint 0, bump 396→397. **known:** ตาราง = ล่าสุด ≤50 ที่โหลด, label ซื่อตรงแล้ว. **manual smoke:** #dashboard Ctrl+Shift+R → ตาราง + scroll · ข้อมูลตรง · ไม่มี console error · charts ไม่พัง.)
**Previous:** 5.66.0 (build 396) — Phase 396 dashboard-trend-line · ✅ merged ff → main (f0e389f) + live build 396 · (display · READ-ONLY: แปลงกราฟ bar "ยอดขาย 12 เดือน" [dataset เดียว, label หลอก "12 เดือน" ทั้งที่ data cap] → **line chart เต็มความกว้าง 2 เส้น** "รายได้"[ฟ้า #0284c7] vs "ค่าใช้จ่าย"[แดง #ef4444] ตามเดือนที่มีจริง. renderChart(sales,expenses): guard typeof Chart, helper _trendMonths [single source: markup empty-check + chart] bucket เฉพาะเดือนที่มีจริงจาก state.sales[cap~50]+state.expenses[cap~200] sort สำเนา slice(-12), legend 2 เส้น, y=moneyShort, empty-state. markup: salesChart ออกจาก .two-col → panel full-width + title "📈 แนวโน้มรายได้ & ค่าใช้จ่าย" + caption "จากรายการล่าสุดที่โหลด — ไม่ใช่ทั้งระบบ" [เลิก "12 เดือน"]; top-products/expenses re-parent grid ของตัวเอง [เนื้อหาเดิม]. call site renderChart(allSales,expenses). ❌ read-only ล้วน: ไม่ fetch/RPC/write/mutate state · ไม่แตะ logic เงิน/สต็อก/บัญชี/schema/SQL/shared CSS/sidebar/dependency. +4 tests dashboard_trend_chart; dashboard_readonly/income/ui guards เดิมเขียว; unit 1338, e2e 12, lint 0, bump 395→396. **known:** trend จำกัด data loaded → caption ซื่อตรง; true 12-month = future RPC. **manual smoke:** #dashboard Ctrl+Shift+R → line 2 เส้น + legend + caption · panel ล่างยังอยู่ · chart อื่นไม่พัง.)
**Previous:** 5.66.0 (build 395) — Phase 395 income-overview-page + dashboard-today-income · ✅ merged (51e8df6) + live · MERGED/LIVE · (feature READ-ONLY report: เพิ่มหน้า **"ภาพรวมรายได้"** [modules/income_overview.js คู่ expense_overview] + การ์ด **"รายได้วันนี้"** [รวมงานบริการ] ในหน้าภาพรวมบริษัท. **นิยาม "รายได้" = dashboard/P&L:** POS sales + web orders + งานบริการ[delivered/done/closed] — reuse sumServiceJobIncome/isWebOrderServiceJob/isServiceIncomeJob จาก dashboard.js [single source, กัน divergence Phase 387]. **Part A income_overview.js:** อ่าน ctx.state เท่านั้น [read-only/admin-gated], period today/เดือน/ปี, Chart.js donut ตามแหล่ง + bar รายเดือน, ยอดรวมเดือน=P&L. **Part B dashboard.js:** +todayServiceIncome/todayTotalIncome + การ์ด go:income_overview — ไม่แก้ "ยอดขายวันนี้"[todayRevenue=POS+web]. wire LAZY_ROUTES/ALL_ROUTES[admin]/titles + index.html nav+section. ❌ ไม่แตะ money write/POS/cart/stock/accounting JV/auto_post/schema/SQL. +5 tests income_overview_guard; dashboard_readonly/income/ui guards เดิมเขียว; unit 1334, e2e 12, lint 0, bump 394→395. **note:** titles map เดิมไม่มี expense_overview [prompt anchor off เล็กน้อย] → เพิ่มทั้ง expense_overview+income_overview. **owner smoke:** เปิด "ภาพรวมรายได้" → ยอดเดือน=P&L · การ์ดรายได้วันนี้รวมบริการถูก · nav ได้.)
**Previous:** 5.66.0 (build 394) — Phase 394 service-request-schema-column-mismatch-hotfix · ✅ merged (f2b49fe) + live · MERGED/LIVE · (HIGH service blocked: หลัง 393 ฟอร์มแจ้งซ่อม service_request.js ยัง POST service_jobs **HTTP 400** เพราะ record ส่งคอลัมน์ผิด schema 3 จุด [live-probe verified]: `address` ไม่มีคอลัมน์ [ต้อง customer_address, PGRST204] · `device_name` ไม่มีคอลัมน์ [PGRST204] · ขาด `job_no` [NOT NULL 23502]. schema จริง service_jobs: job_no/job_type/sub_service/customer_name/customer_phone/customer_address/description/status/total_cost/note/created_by [ไม่มี address/device_name]. **fix [record literal, ไม่แตะ schema]:** address→customer_address · ลบ device_name [เก็บชนิดงานที่ sub_service:typeVal] · +job_no:"JOB-"+Date.now() · คง total_cost:0. record ใหม่ → POST 201. **audit:** main/ai_sales/ac_shop/ac_install/solar/service_form/customer_dashboard ใช้คอลัมน์ถูก [address: ใน ac_install/service_form = local _lastSavedJob object ไม่ใช่ DB write]. ❌ ไม่แตะ SQL/schema/constraint/accounting/POS/stock/payroll/LINE env. +1 guard [schema columns], unit 1329, e2e 12, lint 0, bump 393→394. **note:** แก้สมมติฐานผิด 393 [เดา address valid เพราะ error เป็น total_cost — จริง NOT NULL รายงานก่อน column-not-found]. **owner smoke:** "AI TEST" แจ้งซ่อม → save 201 เข้าใบรับงาน + LINE queue · ลบงานทดสอบหลัง smoke.)
**Previous:** 5.66.0 (build 393) — Phase 393 service-request-total-cost-notnull-hotfix · ✅ merged (312868d) + live · MERGED/LIVE · (HIGH service blocked: `service_jobs.total_cost` = NOT NULL แต่ POST จาก **service_request.js ไม่มี field total_cost** → null → ชน not-null constraint → งานแจ้งซ่อมไม่เข้า DB/คิวเลย [smoke 391 เจอ]. **fix client-side [ไม่แตะ schema/constraint]:** service_request.js +total_cost:0 [งานแจ้งซ่อม=ยังไม่คิดเงิน, ใส่ตอน quote/ปิดงาน]. **audit ทุก POST service_jobs [8 paths] เจอเพิ่ม 2:** ac_shop.js +total_cost:prod.p [ราคาจริง เหมือน ai_sales] · main.saveServiceJob total_cost `:null`→`:0` [เดิมส่ง null เมื่อค่าแรง=0 → admin เซฟไม่ได้]. ai_sales/ac_install/solar/service_form/customer_dashboard มีอยู่แล้ว. auto_post ไม่ mis-post [gate delivered/done/closed + total_cost>0; pending/0 ไม่โพสต์]. ❌ ไม่แตะ SQL/schema/constraint/accounting/auto_post/POS/stock/payroll. +4 tests service_request_total_cost_guard, unit 1328, e2e 12, lint 0, bump 392→393. **owner re-smoke:** "AI TEST" ซ่อมทีวี → save เข้าใบรับงานได้จริง + LINE queue · ลบงานทดสอบหลัง smoke. **⚠️ contradiction ที่ surface ตอน audit [owner approved fix]:** prompt บอก main "default 0/ห้ามแตะ" แต่จริงส่ง null เมื่อ 0 → owner ให้แก้ null→0; prompt scope "service_request เท่านั้น" แต่ audit เจอ ac_shop ขาดด้วย → owner ให้ใส่ prod.p.)
**Previous:** 5.66.0 (build 392) — Phase 391 ai-service-job-queue-line-hotfix · ✅ merged (1c9eb73) + live + CLOSED · (HIGH service: งานจาก AI chat/AI Sales/แจ้งซ่อม ลงแล้วไม่เข้าใบรับงาน/คิว + ไม่ส่งกลุ่ม LINE คิวงาน. งานเข้า DB จริง [POST awaited] แต่ UI หลอก success ตอน save fail + LINE คิว fail เงียบ. **RC1 ai-chat-widget.js:** finishFill โชว์ "งานเข้าคิวแล้ว" ทันทีหลัง click ไม่รอผล → waitForSaveResult() รอ CustomEvent service-job:saved/save-failed [timeout 8s→"กรุณากดบันทึก/ตรวจสอบผล" ไม่ใช่ success ปลอม]. **RC3 service_request.js:** sendLineNotify ขาด target "queue" → ไป LINE_USER_ID → เพิ่ม "queue"+await+handle+dispatch. **RC4 ai_sales.js:** LINE queue .catch(()=>{}) swallow → await+describeLineResult. **RC5 main.saveServiceJob:** queue LINE ไม่ await → await+handle+dispatch save signals [validation/!ok→failed, success→saved+job_no]. **line_notify.js:** describeLineResult() แยก disabled/not-configured/error/fallback + surface usedFallback. **functions/api/line-notify.js:** return usedFallback boolean [ไม่เปิด secret]. invariant: job save สำเร็จแม้ LINE fail. ❌ ไม่แตะ money/POS/stock/accounting/payroll/SQL/RLS/schema/LINE env value. +10 tests ai_service_queue_line_guard, unit 1324, e2e 12, lint 0, bump 391→392 [⚠️ ไม่ใช่ 390→391 ตามที่ brief assume — verify จริง live=391 แล้ว]. **owner smoke [รออนุมัติสร้างงานทดสอบ]:** AI TEST → เข้าใบรับงาน + LINE_GROUP_QUEUE จริง · env ไม่ครบ→warning ชัด · save fail→"ยังบันทึกไม่สำเร็จ" · ลบงานทดสอบหลัง smoke.)
**Previous:** 5.66.0 (build 391) — Phase 389 structural-dashboard-shell-redesign · ✅ merged (9bfb3c2) + live + visual smoke passed · CLOSED · (UI/UX **visual-only**: หน้า "ภาพรวมบริษัท" — แทน gradient marketing hero ด้วย flat business header `_dashHeader` [โลโก้+ชื่อร้าน+"ภาพรวมธุรกิจ"+ปุ่ม ดูบิล/สรุปไลน์] + today highlight + **KPI grid class-based** `_kpiCard`. style.css block "Phase 389" [token-driven dark-mode safe · class-based ไม่มี inline grid → mobile 2-up stack]. read-only + ทุก hook ครบ + escape logoSrc/userName/shopName. +9 tests dashboard_ui_guard, unit 1314, e2e 12, lint 0.)
**Prev (391 detail):** 5.66.0 (build 391) — Phase 389 structural-dashboard-shell-redesign (UI/UX **visual-only**: หน้า "ภาพรวมบริษัท" — แทน gradient marketing hero ด้วย flat business header `_dashHeader` [โลโก้+ชื่อร้าน+"ภาพรวมธุรกิจ"+ปุ่ม ดูบิล/สรุปไลน์] + today highlight + **KPI grid class-based** `_kpiCard` [แถวเงิน: ยอดขาย/ค่าใช้จ่าย+sparkline/กำไรขั้นต้น/กำไรสุทธิ · แถวนับ: receipts/customers/products/service_jobs/quotations/pending/user/role]. presentation อยู่ใน style.css block "Phase 389" [token-driven → dark-mode safe · class-based ไม่มี inline grid → cards stack มือถือ]. **read-only คงเดิม** [dashboard.js ไม่ fetch/ไม่ mutate state] · **ทุก event hook ครบ** [dashboardReceiptBtn/sendDailySummaryBtn · data-go nav 7 route · period tabs · low-stock · line-order · pro-range · chart canvas 6] · escape logoSrc/userName/shopName [Codex fix]. ❌ ไม่แตะ accounting/service_reconcile/periods/backfill · POS/cart/sales · stock/CAS · payroll/HR · SQL/RLS/schema/RPC · main.js logic. +9 tests dashboard_ui_guard, unit 1314, e2e 12, lint 0, bump 390→391. base = main build 390 [Phase 390 accounting ครบ, merge สะอาดไม่ชน — 390 ไม่แตะ dashboard.js/style.css]. **visual smoke:** desktop 1440×900 + mobile 390×844 [cards 12px/เงาบาง/หัวแบน/sidebar active accent · ปุ่มเดิมกดได้ · dark mode ไม่เพี้ยน · no horizontal scroll].)
**Previous:** 5.66.0 (build 390) — Phase 390 accounting-readiness-service-scope-fix · ✅ merged (708f52f) + live + owner smoke PASSED · CLOSED · (HIGH money-path **visibility** bug: close-readiness [periods.js] + Backfill Integrity [backfill.js] เดิมตรวจแค่ sales/expenses/payroll → ขึ้นเขียว "บิลมี JE ครบ ✅" ทั้งที่งานบริการปิดแล้วยังไม่มี JE [live: JOB-1780732840014 หลวงพี่ ฿600 ส่งมอบ 6 มิ.ย. หลุดจาก P&L]. **service_reconcile.js:** findUnpostedServiceJobs จับคู่ source_id primary + job_no/description fallback [array signature เดิม backward-compat] + shared read-only fetchServiceJVStatus({fromDate,toDate,effectiveDate}) ดึง service_jobs date-scoped [เลิกพึ่ง state ≤50] + journal_entries source_id/description; UI บอกช่วง/จำนวน; re-post เดิม manual idempotent. **periods.js:** fetchCloseReadiness +serviceMissing/serviceUnknown [fetch fail→unknown ไม่เขียว] + ตรวจ readiness **ทุกเดือนที่ไม่ใช่อนาคต** [Codex fix: เลิก gate jvCount>0 → เดือน JV=0 ที่มี service ค้างถูกตรวจ] + _monthNeedsAttention [การ์ด JV=0 ที่ค้าง/unknown ขึ้น "⚠️ ต้องตรวจ" + warning ไม่ใช่ "ไม่มีรายการในเดือนนี้"] + label แยก [Dr=Cr/บิล/orphan JV/service/unknown] + lock-gate. **backfill.js:** integrity panel รวม service-missing เข้า actionable/unknown + chip + ลิงก์ Service Reconcile. ❌ ไม่แตะ SQL/RLS/schema/RPC/auto_post double-entry/COA internals[แค่เรียก]/raw JE insert/POS/stock/payroll/Phase 388/389; ไม่ auto-post/auto-click. +14 tests accounting_readiness_service_scope + update service_reconcile_guard, unit 1306, e2e 12, lint 0, bump 388→390 [ข้าม 389=UI draft pending]. **owner smoke [หลัง re-post JOB-1780732840014]:** Service Reconcile เขียว · P&L มิ.ย. revenue 510→1,110 / ขาดทุน 978→378 · Period Close มิ.ย. not-ready→ready · service missing ใหม่ → not-ready.)
**Previous:** 5.66.0 (build 388) — Phase 388 expense-delete-orphan-jv (HIGH · money path: ลบรายจ่ายเดิมเรียกแค่ _appXhrDelete("expenses") ไม่ void JV auto-post → JV ค้าง orphan ในงบ [ต้นเหตุ orphan แบบ PV2069/หลวงพี่]. แก้ expenses.js delete handler: await voidJvForSource("expenses", id) ก่อน _appXhrDelete — mirror edit flow + sales/receipts/delivery_invoices/payroll ที่ทำถูกอยู่แล้ว [expenses ตกหล่นตัวเดียว]. +3 tests expense_delete_void_jv_guard, unit 1292, lint 0, bump 387→388. ❌ ไม่แตะ voidJvForSource/auto_post internals/sales/receipts/payroll/schema/POS/stock.)
**Previous:** 5.66.0 (build 387) — Phase 387 dashboard-net-profit-include-service-income ("ภาพรวมบริษัท" กำไรสุทธิเดือนนี้ เดิม monthRevenue=POS+web orders เท่านั้น ไม่รวมรายได้งานบริการ delivered/done/closed → เพี้ยนจาก P&L. แก้ dashboard.js [pure]: isWebOrderServiceJob/isServiceIncomeJob/sumServiceJobIncome → monthServiceIncome + monthTotalIncome=monthRevenue+service → monthNetProfit; การ์ดยอดขายคง monthRevenue. dashboard ยัง read-only. +6 tests dashboard_income_guard, unit 1289, lint 0, bump 386→387. ❌ ไม่แตะ POS/stock/accounting/JV/service write/schema. **note:** กำไร dashboard มิ.ย.=−378 [รวม 500+600 งานบริการ]; ต่าง P&L −978 เพราะ JOB-1780732840014 หลวงพี่ 600 ยัง orphan [JV ไม่ถูกโพสต์] → re-post ผ่านหน้า reconcile แล้วตรงที่ −378.)
**Previous:** 5.66.0 (build 386) — Phase 386 professional-saas-dashboard-shell-polish (ยก app shell + หน้า "ภาพรวมบริษัท" ไปทาง business dashboard แบบ SaaS/FlowAccount — calm/professional. **CSS เท่านั้น ไม่แตะ JS/logic**. `style.css`: token light-mode 3 ตัว [`--shadow` หนา 0 10px 30px→subtle 0 1px 3px+0 1px 2px; `--bg` #eef3f7→#f3f5f8 neutral; `--line` #e2e8f0→#e5e7eb] + append section "Phase 386" [ปิดท้ายไฟล์=ชนะ specificity, revert ง่าย]: card/stat-card/item-card radius 20→**12px**+subtle shadow; hero flatten [gradient เบา, amount 48→**34px**, radius 26→16, shadow เบา]; sidebar nav radius 14→**10** + active **left-accent bar** + hover นิ่ง; topbar solid+crisp + search 40px/radius10; page padding สม่ำเสมอ. **ทุกสีใช้ var(--token) → [data-theme="dark"] ไม่พัง**. **read-only proof:** modules/dashboard.js ไม่ถูกแตะ [0 บรรทัด] — guard ยืนยัน no fetch/xhr/supabase-write · no state mutation · ไม่อ้าง checkout/addToCart/decrementStock/autoPost/postJournal/loadAllData. ❌ ไม่แตะ dashboard.js·POS/cart·stock/CAS·accounting auto_post/JV/period·service job·payroll/HR·API·SQL/RLS/schema·package.json version. +5 tests dashboard_readonly_guard, unit 1268, e2e 12/12 [รวม build-version-sync 3], lint 0. bump 384→386. **owner smoke:** เปิด "ภาพรวมบริษัท" desktop 1440×900 + mobile 390×844 → cards มน 12px/เงาบาง/หัวแบนลง/sidebar active มีแถบซ้าย; ปุ่มเดิมทุกตัวยังกดได้ [ดูบิลล่าสุด/สรุปไลน์/period tabs/quick stats/nav routes]; dark mode สลับแล้วไม่เพี้ยน; ไม่มี horizontal scroll. **known:** polish phase แรก ยังไม่ครบทุกหน้า; mobile 1-col stacking ของ dashboard inline grid = phase ถัดไป [override inline ต้อง !important]. **STOP — รอ review ก่อน merge/push main**)
**Previous:** 5.66.0 (build 385) — Phase 385 journal-date-guard (Part A: pure validateJournalDate [reject future_year เช่น 2069/future_date/too_old/invalid_format] + findOutOfRangeEntries [date_guard.js] → block ตอน save ใน journal_form.js + banner detector admin-only read-only ในสมุดรายวัน. +15 tests, unit 1278, lint 0, bump→385. Part B [owner-gated, SQL บน live]: PV2069050001 เป็นบิลซ้ำของ PV2026050003 [แมกซ์การ์ด ฿988; ใบถูก=#7/5210 ค่าน้ำมัน/2026-05-03] → ลบ expense #5 + JV. ❌ ไม่แตะ record อื่น/auto_post/mapping/period-lock/schema/POS/stock. **follow-up:** ลบบิลไม่ลบ JV [orphan] + หมวด "น้ำมันรถ" ไม่ map COA.)
**Previous:** 5.66.0 (build 384) — Phase 384 service-autopost-reconcile (Part B, money path §4.8: งานช่างปิดแล้ว auto-post JV เป็น fire-and-forget [service_form.js] → post ล้ม = งาน delivered แต่ JE ไม่เกิดเงียบ [เช่น หลวงพี่ JOB-1780732840014 ฿600]. หน้าใหม่ admin-only service_reconcile [modules/service_reconcile.js]: pure findUnpostedServiceJobs(jobs, jeDescriptions, {effectiveDate}) flag งาน delivered/done/closed + total_cost>0 + created_at≥2026-05-01 [dateBkk] + job_no[JOB-\d+] ไม่อยู่ใน JE description → ปุ่ม "ส่งเข้าบัญชีอีกครั้ง" เรียก postJournalForServiceJob [idempotent: 409→null ไม่ double] → entryId=toast สำเร็จ+refresh / null=toast เตือน+refresh; inflight guard + admin double-gate. fetch journal_entries.description [READ-ONLY GET; re-post ผ่าน auto_post ไม่ hand-roll JE insert]. ❌ ไม่แตะ auto_post double-entry/mapping/COA/period-lock [แค่เรียก] · schema/RLS/SQL · service_jobs.js [ทีม 383] · service_form.js Part A surface [เลื่อน — รอ owner ตัดสิน Finding 1] · stock/POS/payroll/refund. wiring: LAZY_ROUTES/ALL_ROUTES[admin]/titles + index.html nav-btn[กลุ่มบัญชี]+section. +18 tests service_reconcile_guard, unit 1263, e2e 12/12, lint 0. merged 0e2f6d3 ff [27f6077..0e2f6d3] → main, CI Tests+Deploy[Cloudflare] success, live 384 verified. bump 383→384. **owner smoke:** เมนูบัญชี → รายได้งานบริการเข้าบัญชี → ควรเห็นหลวงพี่ JOB-1780732840014 ฿600 → กด "ส่งเข้าบัญชีอีกครั้ง" → JE ฿600 โผล่ในสมุดรายวัน + แถวหายจาก list [back-fill สำเร็จ]; กดซ้ำ → ไม่เกิด JE ซ้ำ [idempotency 409→null→toast]. **known risk:** orphan view อิง state.serviceJobs [≤50 ล่าสุด]; re-post null รวม idempotency/period-lock/eff-date/สำเร็จจริง = toast เตือนกว้าง [Finding 1]. **next:** Part A surface service_form.js รอ owner ตัดสิน Finding 1 — postJournalForServiceJob ไม่เคย throw [null=ทั้ง skip+failure, auto_post.js:273-286].)
**Previous (build 383, merged main):** 6 มิถุนายน 2026 (Phase 383 service-job-status-db-safe-hotfix — build 383) · ✅ **Codex APPROVED + merged ff → main** (CI Tests+Deploy success; live build 383 verified) · **HIGH hotfix** · รอ owner manual smoke · ⚠️ build 384 (service-autopost-reconcile) + 385 (journal-date-guard) docs ยังไม่อยู่บน main — pending บน branch บัญชีแยก
**Previous (build 383 detail):** 5.66.0 (build 383) — Phase 383 service-job-status-db-safe-hotfix (HIGH production bug: ช่างบันทึกใบงาน → POST service_jobs ล้ม HTTP 400 [23514] เพราะ UI ส่ง status [pending_review/in_progress] ที่ constraint service_jobs_status_check ไม่รับ → ใบงานไม่ถูกสร้าง + LINE notify ไม่ถูกเรียก. DB รับแค่ pending/progress/done/delivered/closed/cancelled. แก้: modules/service_status.js ใหม่ [pure] normalizeServiceJobStatus(status) [pending_review→pending, in_progress→progress, valid→คงเดิม, unknown/null/empty→pending] + serviceJobNoteWithReviewMarker(note,uiStatus) [คง intent รออนุมัติ ผ่าน note marker เมื่อ UI=pending_review, กัน duplicate]. wire ทุก service_jobs write path: ac_install/service_form/solar record.status + main.saveServiceJob payload.status + main reject flow [in_progress→progress]. UI option labels คงไว้ [normalize ตอน save]. ❌ ไม่แตะ SQL/RLS/schema/constraint · LINE notify impl · stock/POS/accounting/payroll · JV path [accounting, dead isClosure=[]]. **review follow-up (same phase, Codex finding):** normalize ทำให้ read-side ที่ดู status==="pending_review" ไม่เห็นงานใหม่ → เพิ่ม read-side helper isServiceJobPendingReview(job) [true ถ้า status==="pending_review" (row เก่า) หรือ status==="pending" + note มี REVIEW_NOTE_MARKER (งานใหม่)]; wire service_jobs.js [cReview/review filter ใช้ helper; open exclude review กันนับซ้ำ; status label/color → "📨 รออนุมัติ" ม่วง; export] + main.js approve banner [ใช้ helper แทน status==="pending_review" ดิบ] → คิว/แท็บ/banner "รออนุมัติ" กลับมาทำงานสำหรับงานใหม่. +31 tests service_status_guard, unit 1245, e2e build-sync 3/3, lint 0. bump 382→383. **owner smoke:** (1) ฟอร์มล้างแอร์/ac_install → เลือก "รออนุมัติ" → บันทึก → ไม่เจอ 400 + ใบงานขึ้นหน้าใบรับงาน + LINE notify ตาม path เดิม [LINE disabled = save ผ่าน skipped]; (2) งานที่เลือก "รออนุมัติ" ต้องขึ้นแท็บ "📨 รออนุมัติ" + เปิด drawer เห็น approve banner. **known risk:** pending_review จริงใน DB = schema decision แยก [ไม่ใช่ hotfix นี้].)
**Previous:** 5.66.0 (build 382) — Phase 382 hr-overview-gps-exception-filter (HR Overview เพิ่ม toggle "📍 GPS น่าสงสัย (N)" แยกจาก status bar [orthogonal] → กรองเฉพาะ row gpsStatus missing/outside [379]; compose กับ status/dept/role; แสดงเฉพาะเมื่อตั้ง geofence [showGpsFilter=!!geofence]; badge N = exception ในมุมมองปัจจุบัน. helpers ใหม่ exported isGpsExceptionStatus(s)/countGpsExceptions(rows); filterHrRows รับ filters.gpsException [=== true เท่านั้น = backward-compat, filterHrRows tests เดิมเขียว]; render _gpsFilterToggle + #hrGpsFilterBar + state activeGpsOnly + handler flip + clear-filters reset + export ตามมุมมอง. ❌ READ-ONLY [filter view]: ไม่แตะ detection logic[detectExceptions/detectStuckCrossDaySessions]/loader[select=*]/OT/payroll/clock enforcement/schema/SQL/RLS/DB write/mutate state·row/money/stock/POS/accounting. +14 tests hr_gps_filter_guard, unit 1214, e2e build-sync 3/3, lint 0. bump 381→382. **owner smoke:** ตั้ง geofence แล้วเปิด HR Overview → เห็น toggle "GPS น่าสงสัย (N)"; กด → ตารางเหลือเฉพาะ missing/outside; กดร่วม dept/status ได้; ปิด toggle/clear → กลับมาครบ; ไม่ตั้ง geofence → ไม่มี toggle.)
**Previous:** 5.66.0 (build 381) — Phase 381 hr-alert-staff-name (ใส่ "ชื่อพนักงาน" นำหน้า message ในกล่องแจ้งเตือน session ค้าง [section "สิ่งที่ต้องจัดการวันนี้"] ครอบ 2 kind: stuck_session_crossday [380] + stale_session [วันนี้-เปิดค้าง≥14ชม.] → admin เห็นทันทีว่าใครค้าง. renderHrOverviewPage สร้าง `nameById=new Map(data.profiles.map(p=>[String(p.id),profileDisplayName(p)]))` ส่งเข้า 2 detector; แต่ละตัวใส่ prefix `${ชื่อ} · ` เฉพาะเมื่อมี nameById [id ไม่อยู่ใน map→"พนักงาน #<id>"; ไม่ส่ง→message เดิม=backward-compat]. escape ที่ _alertRow เดิม. ❌ READ-ONLY [แก้แค่ message string]: ไม่แตะ _alertRow signature/markup · alert kind อื่น[geofence_out/late/early/unpaid/offline คงเดิม] · OT/payroll · clock enforcement · loader · detection logic[เงื่อนไข flag เดิม] · schema/SQL/RLS · DB write · mutate state/row · money/stock/POS/accounting. +7 tests [hr_stuck_session_guard รวม 22: name prefix/fallback/backward-compat + stale ชื่อ + geofence_out ไม่มีชื่อ], unit 1200, e2e build-sync 3/3, lint 0. bump 380→381. **owner smoke:** session ค้างข้ามวัน/วันนี้-ค้าง → alert ขึ้นชื่อพนักงานนำหน้า + วันที่/ชม.; alert kind อื่นไม่มีชื่อเพิ่ม. **known note:** geofence_out ยังไม่มีชื่อ = นอก scope [future consistency].)
**Previous:** 5.66.0 (build 380) — Phase 380 hr-overview-stuck-session-crossday (clock-out trap C2 · scope A read-only) (HR Overview section "สิ่งที่ต้องจัดการวันนี้" เพิ่มรายการ "session ค้างข้ามวัน" [clock_in มี + clock_out null + work_date < วันนี้] → admin ไปตามปิดเอง กัน OT/ชม. under-count เงียบ [open session ถูกตัดใน OT calc → 0 ชม.]. ช่องโหว่: ค้างข้ามวันอยู่ใน attendanceMonth แต่ไม่อยู่ใน attendanceToday → detectExceptions [วน attendanceToday เท่านั้น] ไม่เห็น. pure helper exported `detectStuckCrossDaySessions(attendanceMonth,{today})`→[{kind:"stuck_session_crossday",severity:"high",message:"session ค้างข้ามวัน — เข้างาน <date> ยังไม่ลงเวลาออก (ค้าง N วัน)",userId,refId}] [null-safe, ไม่ mutate, จับเฉพาะ work_date<today = **ไม่ทับ stale_session เดิม**]. renderHrOverviewPage `exceptions.push(...detectStuckCrossDaySessions(data.attendanceMonth,{today}))` → แสดงผ่าน _alertRow เดิม; +alertActionFor case stuck_session_crossday→ปุ่ม "เปิด Time Clock". ❌ READ-ONLY: ไม่แก้สูตร OT/payroll[sumRegularOT/closedMonth/buildMonthlyHrReport] · ไม่แตะ clock enforcement[time_clock] · ไม่แตะ detectExceptions เดิม[helper แยก] · loader query[attendanceMonth select=*] · schema/SQL/RLS · DB write · mutate state/row · money/stock/POS/accounting. +15 tests `hr_stuck_session_guard`, unit 1193, e2e build-sync 3/3, lint 0. bump 379→380. **note:** _alertRow ไม่แสดง "ชื่อ" [ทุก alert รวม stale_session เดิมก็ไม่มีชื่อ — message ถือข้อมูลเอง]; ใส่ชื่อ = ต้อง wire profiles เข้า _alertRow ทุก kind = future. **owner smoke:** มี session clock_in เมื่อวานไม่ปิด → ขึ้น "ค้างข้ามวัน" + วันที่ + จำนวนวัน; ปิดแล้ว/วันนี้เปิดไม่นาน ไม่ขึ้น; ไม่มีปุ่ม write. **known limitation:** ครอบเฉพาะเดือนนี้ตาม attendanceMonth window; ค้างข้ามเดือน = future [openOnly fetch แยก].)
**Previous:** 5.66.0 (build 379) — Phase 379 hr-overview-gps-exception-display (HR GPS hardening C / #5) (HR Overview เพิ่ม chip "GPS น่าสงสัยวันนี้" ต่อพนักงาน read-only: `📍 ไม่มี GPS` [clock_in_lat ว่าง] / `📍 นอกรัศมี Xม. (กำหนด Yม.)` [clock_in_distance_m > geofence.radiusM]. ช่วย admin เห็น record เก่า/admin clock warn-only ที่ 377 enforcement ไม่ครอบ. pure helper exported `classifyGpsStatus(row,geofence)`→na/missing/outside/inside [null-safe; มี GPS แต่ distance non-finite→inside ลด noise; distance===radius→inside] + `gpsChipMeta(status,{distanceM,radiusM})`→chip meta [inside/na→null]. renderHrOverviewPage **consolidate** geofence ให้ใช้ `geofenceFromState(state)` ตัวเดียว [เลิก inline parse ซ้ำที่ป้อน detectExceptions — radiusM เท่าเดิม, detectExceptions อ่านแค่ radiusM]; per-user row คำนวณ gpsStatus/gpsMeta; `_renderTbody` render `_gpsChip` ข้าง punctuality chip; โชว์เฉพาะ exception + เฉพาะเมื่อตั้ง geofence. ❌ READ-ONLY: ไม่ POST/PATCH/PUT/DELETE/upsert/rpc-write · ไม่ mutate state/row · ไม่แตะ time_clock logic/clock enforcement/attendance loader query[select=*]/payroll/OT/punctuality/status-present logic/SQL/RLS/schema/money/POS/stock/accounting. +21 tests `hr_gps_exception_guard` [behavioral + source/read-only guard], unit 1178, e2e build-sync 3/3, lint 0. bump 378→379. **owner smoke:** เปิด HR Overview → record ไม่มี GPS ขึ้น "ไม่มี GPS", record distance>radius ขึ้น "นอกรัศมี...", record ในรัศมี/ยังไม่ตั้ง geofence → ไม่ขึ้น chip, ไม่มีปุ่มแก้/write ใหม่. **deviation:** prompt คาดว่า `geofence` ยังไม่มีในฟังก์ชัน แต่มี inline parse อยู่แล้ว → แทนด้วย geofenceFromState [DRY, ตรง intent "ห้าม parse ซ้ำ"]. **known risk:** browser GPS spoof — display/audit signal ไม่ใช่ anti-fraud server-side.)
**Previous:** 5.66.0 (build 378) — Phase 378 store-settings-cloud-sync-feedback (HR GPS hardening A / #2) (`saveStoreInfo` [main.js] เดิม Supabase upsert `app_settings`[key='store_info'] error/timeout → console.warn เฉย + `return` void; store.js save handler โชว์ "บันทึกสำเร็จ ✅" **เสมอ** → cloud-sync ล้มเงียบ. geofence operational [377] → sync ล้มเงียบ = staff devices ได้ค่า GPS เก่า/enforcement เพี้ยนโดยไม่รู้. ใหม่: saveStoreInfo คืน `{ok:true,cloudSynced:boolean,error:string|null}` — เซฟ localStorage **เสมอ ก่อน Supabase** + **❌ ไม่ throw** [ไม่ block offline; caller ignore return ไม่กระทบ]: `!state.supabase`→cloudSynced:false; upsert error/timeout/throw→cloudSynced:false [คง console.warn]; สำเร็จ→cloudSynced:true. store.js handler อ่าน result: true→success เดิม; false→⚠️ warning toast ชัด ["บันทึกในเครื่องแล้ว แต่ sync ขึ้นเซิร์ฟเวอร์ไม่สำเร็จ ({error})…"] + ปุ่ม re-enable ใน `finally`. ❌ ไม่แตะ savePaymentInfo/loadAppSettings/time_clock/enforcement/schema/SQL/RLS/app_settings key+payload · ไม่ block save [รอบนี้แค่ "แจ้งชัด"]. +12 tests `store_settings_sync_guard` [behavioral node:vm รัน source จริง + source guard], unit 1157, e2e build-sync 3/3, lint 0. bump 377→378. **owner smoke:** ก) แก้ค่าร้าน+บันทึก เน็ตปกติ→success+ตรวจ app_settings.store_info sync จริง ข) จำลอง sync ล้ม [offline/throttle]→เห็น ⚠️ ชัด ไม่ใช่ success เขียว + ค่ายังอยู่ local. **naming:** "Phase 378" ก่อนหน้า = permissions-policy 377-followup [header-only build คง 377]; อันนี้ build 378 จริง.)
**Previous:** 5.66.0 (build 377) — Phase 378 hr-gps-unblock-permissions-policy (377-followup, header-only ไม่ bump build) (**root cause ของ 377:** production `_headers` ตั้ง `Permissions-Policy: ... geolocation=() ...` → browser block `navigator.geolocation` ตั้งแต่ก่อน app code รัน → GPS self-clock [377] ใช้จริงไม่ได้. **change:** `geolocation=()`→`geolocation=(self)` ใน `_headers` เท่านั้น. ❌ ไม่ relax `microphone=()`/`payment=()` [คงปิด]/camera/usb/bluetooth/serial · ไม่แตะ CSP/X-Frame-Options/HSTS/Referrer-Policy · ไม่ bump build [server header เสิร์ฟสด ไม่ใช่ cached asset] · ไม่แตะ SQL/RLS/schema/money/POS/cart/accounting/stock. +e2e guard [geolocation=(self) มี, geolocation=() ไม่มี, mic/payment ยังปิด], e2e 12/12, lint 0, unit 1145. **owner ต้อง smoke หลัง deploy:** live header `permissions-policy` มี `geolocation=(self)` + Settings→"ใช้ตำแหน่งปัจจุบัน" ขึ้น browser permission prompt แทน policy violation.)
**Previous:** 5.66.0 (build 377) — Phase 377 hr-gps-self-clock-enforcement (เดิม 92.24 มี GPS config [storeInfo.shopLat/shopLng/geofenceRadiusM] แต่แค่ warn ไม่ block → self clock ไม่มี integrity. ใหม่: helper `_captureGpsForClock(ctx,{enforce})` ใน time_clock.js — `enforce=false` [admin #tcClockInBtn/[data-clock-out-id]] = warn-only เดิมเป๊ะ [wrapper `_captureGpsAndWarn`]; `enforce=true` [self #tcSelfClockIn/#tcSelfClockOut]: ไม่มี geofence→{gps:null,geofence:null}; มี geofence แต่ getCurrentPosition()=null→throw "GPS_REQUIRED"; นอกรัศมี→throw "GEOFENCE_OUTSIDE" [distance/radius]. **throw ก่อน _insertClockIn/_patchClockOut** → ไม่มี row + ไม่ enqueue offline; catch→showToast [no alert/confirm]. schema verified live REST: clock_in/out_lat/lng/distance_m มีแล้ว [92.24] → ไม่สร้าง SQL. ❌ ไม่แตะ SQL/RLS/schema/staff_attendance schema/payroll/POS/cart/stock/accounting/admin-edit-modal/offline-queue logic/return shape. +12 tests hr_gps_self_clock_guard [navigator mock + source guard], time_clock 73+hr_overview เขียว, unit 1145, e2e 11/11. bump 376→377. **known risk: browser GPS spoof ได้ — anti-fraud จริงต้อง server/device policy ภายหลัง; phase นี้ปิดช่อง "ไม่เปิด GPS"+"อยู่นอกพื้นที่" เท่านั้น.**)
**Previous:** 5.66.0 (build 376) — Phase 376 reconcile-report-exclude-cancelled (375b) (report Phase 375 flag งานสถานะ `cancelled` เป็น false-positive [live: 5/5 ที่ flag = cancelled; งานยกเลิก/ลบ ไม่ต้องตัดสต็อก → found 0 ถูกต้อง]. แก้: pure helper `isReportableJobStatus(status)` → `false` เมื่อ status==="cancelled" [case-insensitive+trim]; `detectAllJobs` ข้ามงาน `!isReportable` ก่อนคิด expected/actual [+`cancelledSkipped` count] → cancelled ไม่เข้า flagged/unverifiable. ครอบ soft-delete อัตโนมัติ [soft-delete = cancelled + note "[ลบแล้ว]" → กรอง status==="cancelled" ครอบทั้งคู่]. +label "ไม่รวมงานที่ยกเลิก/ลบ (cancelled)". **คง invariant เดิมครบ:** read-only [ไม่ write/mutate/fetch=GET]/admin gate/honesty/drill=showRoute/false-positive guards เดิม [service filter·job_no ว่าง·data-incomplete]. ❌ ไม่แตะ schema/SQL/save path/deduct/POS/accounting. +4 tests [isReportableJobStatus+cancelled-skip+active-still-flagged] รวม 21, unit 1133, e2e 11/11. bump 375→376)
**Previous:** 5.66.0 (build 375) — Phase 375 stock-deduct-reconcile-report (หน้า report read-only **admin-only** ใหม่ `stock_reconcile_report` [modules/stock_reconcile_report.js] "ตามเก็บ" residual ของ post-save race [service-job save แล้ว deduct ไม่ครบ: cache ผ่าน pre-check 370/372 แต่ DB CAS ไม่พอ → toast เตือนแต่ user อาจพลาด] → surface ให้ admin ตรวจ/ตัดมือเอง. **HEURISTIC best-effort ไม่ใช่ ledger.** detection per งานล่าสุด ≤50: expected = items_json ที่ `product_id && warehouse_id && qty>0` และ product ไม่ใช่ product_type service/non_stock [lookup state.products]; actual = stock_movements type out ที่ note contains job_no; flag เมื่อ expected product มี movement ไม่ครบจำนวน line. **กัน false-positive:** กรอง service/non_stock + fetch read-only out-movements ตั้งแต่วันงานเก่าสุด [limit 2000; ได้ครบ limit/fetch ล้ม/ไม่มี job_no → "ตรวจไม่ได้" ไม่ flag มั่ว]. drill = ปุ่ม "ไปหน้างาน" showRoute service_jobs เท่านั้น. ป้าย honesty บังคับ. ❌ READ-ONLY ล้วน: ไม่ POST/PATCH/PUT/DELETE/rpc-write/stock mutation/mutate state [clone jobs] · ไม่แตะ schema/SQL/RLS/save path/deduct logic/POS/accounting · ไม่ auto-fix/ไม่ตัดย้อนหลัง. wiring เฉพาะ LAZY_ROUTES/ALL_ROUTES[admin-only]/title + index.html page section + nav-btn. +17 tests stock_reconcile_report_guard, unit 1129, e2e 11/11. bump 374→375. **known risk:** heuristic ไม่เป๊ะ 100% [จับคู่ note-string; ข้อมูลขาด→"ตรวจไม่ได้"] = ตัวช่วยตรวจ ไม่ใช่บัญชี authoritative)
**Previous:** 5.66.0 (build 374) — Phase 374 wire-transfer-rpc (`_transferWarehouseStock` [main.js; ปุ่ม "โอนบ้าน→รถ" ac_install/service_form/solar + transfer modal stock_movements] เดิมโอนด้วย multi-xhr client-side [source CAS+floor / target add / rollback / log best-effort] = atomicity ข้าม 2 row ไม่จริง [known-risk 368]. ใหม่: **ลอง RPC atomic ก่อน** `POST /rest/v1/rpc/transfer_warehouse_stock` [DB func 373.5 owner-verified: source−/target+/log ใน 1 tx + FOR UPDATE + rollback อัตโนมัติ; headers apikey=anonKey, Bearer=`_sbAccessToken||anonKey`; body p_product_id/p_from_wh/p_to_wh/p_qty=transferQty/p_note/p_created_by=`currentUser?.id||null`]. map jsonb: `{ok:true}`→sync cache [helper ใหม่ `_syncWarehouseRowsAfterTransfer` refetch 2 แถว warehouse_stock by product+`warehouse_id=in.(from,to)`, upsert state.warehouseStock by id, best-effort warn]→`return{ok:true}`; `{ok:false,insufficient,error}`→return ตรง [business result, **❌ ไม่ fallback**]; RPC ใช้ไม่ได้จริง [HTTP 404 / PostgREST PGRST202 / network throw]→**fallback logic multi-xhr เดิมทั้งก้อน** [catch ไม่ return, ตกลง legacy block]. ❌ ไม่ลบ logic เดิม/ไม่แตะ DB func/_atomicDecrement·AddStock/stock_cas/_applyStockMovement/_deductStockForSaleItem[POS]/products.stock/4 callers/schema/SQL/RLS/POS/accounting. return shape {ok,error,insufficient} เดิมเป๊ะ. +10 tests transfer_rpc_wiring_guard, unit 1112, e2e 11/11. bump 373→374. ⚠️ **owner ต้อง smoke โอนจริงข้ามคลัง + เคสเกินสต็อก บน live ก่อน merge** [แตะ stock จริง]. **known risk:** browser/RPC ป้องกันที่ DB เท่านั้น; ถ้า env ไม่มี func→fallback อัตโนมัติ [ปลอดภัย]; cache refetch ล้ม=warn [DB ถูกแล้ว])
**Previous:** 5.66.0 (build 373) — Phase 373 auth-pin-login-promise-executor-safe (`showStaffLogin` [modules/auth.js] เดิม `new Promise(async (resolve)=>{...})` [suppressed no-async-promise-executor] → async executor กลืน error setup [staff load/modal build] เงียบ = promise ค้าง. ใหม่: executor sync `(resolve)=>` + async IIFE `(async()=>{...})().catch(err=>console.error)` → error surface; **คง resolve semantics เป๊ะ** [resolve เฉพาะ login สำเร็จ verifyPin→resolve(staffObj); ไม่เพิ่ม resolve(null)]; body ไม่แตะ [minimal-diff, under-indent ยอมรับ]; ลบ TODO+eslint-disable. ❌ ไม่แตะ verifyPin/session/PIN logic/initAuth. +4 tests auth_pin_executor_guard, unit 1102, e2e 11. ทำบน branch claude/phase-373-auth-pin-executor [CI green] → merge ff → **owner smoke PIN login บน live 373 ผ่าน ✅**. bump 372→373)
**Previous:** 5.66.0 (build 372) — Phase 372 service-job-precheck-aggregate (pre-check ก่อน save ใน ac_install/service_form/solar เดิมวนเช็คทีละ line → สินค้าเดียวกัน+คลังเดียวกันแยกหลาย line ผลรวม qty เกินสต็อก แต่ละ line ผ่านเดี่ยว ๆ → หลุด pre-check → ใบงาน POST แล้ว deduct fail-clean[369]/โอนซ้ำ. ใหม่: helper pure `aggregateNeedByKey` [ไฟล์ใหม่ modules/stock_precheck.js] รวม qty ต่อ `product_id|warehouse_id`; loop dedup `_checkedKeys` [เช็ค/โอนครั้งเดียวต่อ key] + ใช้ยอดรวมแทน `it.qty`. **single-line = เดิมเป๊ะ** [กัน over-block regression — _needByKey.get(key)=it.qty เมื่อ line เดียว]; floor 367/369 ยังเป็น backstop ถ้าหลุด. ❌ ไม่แตะ Part 1 `isHome`→throw[370]/non-home throw/confirm-transfer dialog/deduct-transfer logic[369/368]/POST/JV/schema. +8 tests service_job_precheck_aggregate_guard [behavioral: sum/diff-wh/single/skip/null/non-numeric + wiring 3 ไฟล์], unit 1098, e2e 11. bump 371→372. **known risk คงเดิม:** post-save race [cache ผ่าน pre-check แต่ DB CAS ไม่พอ] ยังเตือนแค่ toast; atomicity จริง = DB RPC future)
**Previous:** 5.66.0 (build 371) — Phase 371 revert-out-of-scope-stock-unresolved-flag (scope correction: Phase 370 ใส่ "Part 2" reconcile-flag [post-save PATCH `service_jobs` note += `⚠️[STOCK_UNRESOLVED]`] เข้า ac_install/service_form/solar + test ทั้งที่ owner สั่งทำ **Part 1 อย่างเดียว** → Phase 371 ถอด Part 2 ออกหมด: ลบ block ใน `if (stockOpsFailed)` ทั้ง 3 ไฟล์ → เหลือแค่ `showToast?.(...)` **byte-identical กับ build 369** [ยืนยัน `git diff 67834c9 HEAD -- modules/*` เหลือเฉพาะ Part 1]. test Part 2 พลิกเป็น **absence-assert** กัน flag กลับมา. **คง Part 1** [`isHome`→`throw` block ก่อน POST] ทั้ง 3 ไฟล์. forward commit — ❌ ไม่ใช้ `git revert e852c78` [จะลบ Part 1 ด้วย]. ❌ ไม่แตะ non-home throw/confirm dialog/deduct logic[369/368]/POST payload/JV/schema. test service_job_block_save_guard 12, unit 1090, e2e 11. bump 370→371)
**Previous:** 5.66.0 (build 370) — Phase 370 service-job-block-save-on-insufficient (severity สูง oversell/§4.1-4.2: pre-save stock check ใน ac_install/service_form/solar เดิม `if (isHome) continue;` ทำให้เคส "เลือกคลังบ้าน แล้วบ้านไม่พอ" ถูกข้าม → ใบงาน POST → 369 deduct fail-clean (ไม่ติดลบ) แต่ **"save แล้วสต็อกไม่ถูกตัด"** เตือนแค่ toast. ใหม่: **(1)** `isHome`→`throw "❌ {ชื่อ}: ของไม่พอ — คลังบ้านมี X, ต้องใช้ Y (เติมสต็อกก่อนบันทึก)"` (block ก่อน POST; catch โดย save handler เดิม→statusEl error+ปุ่ม re-enable). **(2)** post-save `stockOpsFailed` (race) → best-effort PATCH `service_jobs` note += `⚠️[STOCK_UNRESOLVED ตัดสต็อกไม่ครบ]` (slice 500; config/token เดียวกับ POST: ac_install/solar=`cfg`, service_form=`supaCfg`; try/catch→warn เท่านั้น, **ไม่ throw/rollback/ลบใบงาน**; คง showToast เดิม). ❌ ไม่แตะ non-home throw/confirm dialog/deduct-transfer logic(369/368)/_applyStockMovement/stock_cas/reorder save→stock-ops/POST payload/JV/schema. +12 tests service_job_block_save_guard, unit 1090, e2e 11. **known risk:** race window เล็กลงไม่หมด (flag เองก็ best-effort); per-product aggregation ข้าม item = future; atomicity จริง (reorder/DB RPC) = future)
**Previous:** 5.66.0 (build 369) — Phase 369 fix-applystockmovement-oversell-floor (severity สูง oversell/§4.1-4.2: `_applyStockMovement` [main.js; ฟอร์ม stock_movements + **service-job auto-deduct** ใน ac_install/service_form/solar ผ่าน movementType:"out"] เดิม out/sale ใช้ `_atomicAddStock(delta ติดลบ)` **ไม่มี floor** → floor 367[POS]/368[transfer] **ไม่ครอบเส้นนี้** → งานบริการตัดเกินสต็อก=เขียนค่าติดลบเงียบ ๆ [น่าจะต้นเหตุ warehouse_stock product 1809 = -1]. ใหม่: เพิ่ม param `allowNegative=false`; out/sale [default] ตัดผ่าน `_atomicDecrementStock` [floor 367+CAS] ทั้ง warehouse_stock+products mirror — `dec.insufficient`→`return {ok:false,insufficient,error:"สต็อกคลังไม่พอ (เหลือ X)"}` **ทันทีก่อน** log stock_movements [ไม่ log หลอก]; ไม่มี ws row→`return "คลังนี้ไม่มีสินค้านี้ (สต็อก 0)"` **ห้าม insert row ติดลบ** [ขนานกับ transfer 368]. ฟอร์ม stock_movements ส่ง `allowNegative:true` [มี confirm เตือนติดลบอยู่แล้ว=admin override]→คง _atomicAddStock/insert เดิม. in/return ยัง additive · adjust ยัง absolute set · ❌ ไม่แตะ _deductStockForSaleItem[POS]/_transferWarehouseStock[368]/stock_cas.js/CAS retry. ac_install/service_form/solar ไม่ต้องแก้ [พึ่ง default→floored; เช็ค !r.ok→stockOpsFailed อยู่แล้ว]. +10 tests [apply_stock_movement_floor], unit 1078, e2e 11. **known risk:** manual override ยังติดลบได้โดยตั้งใจ; service-job ยัง save ได้แม้ deduct fail [บล็อก save = P2 แยก])
**Previous:** 5.66.0 (build 368) — Phase 368 harden-warehouse-transfer-cas-floor (severity สูง oversell/§4.1-4.2: `_transferWarehouseStock` [main.js; ปุ่ม "โอนบ้าน→รถ" ac_install/service_form/solar + transfer modal stock_movements] เดิม raw xhrPatch ทั้ง 2 ฝั่ง ไม่เช็ค .ok — xhrPost/xhrPatch **resolve {ok:false} ไม่ throw** → try/catch จับไม่ติด + ไม่มี floor → โอนเกินต้นทาง=ติดลบ/race/target ล้ม=ของหาย. ใหม่: (0) transferQty=Number(qty) ใช้ตลอด. (1) source→_atomicDecrementStock [floor 367+CAS]; ไม่มี srcWs.id→return "คลังต้นทางไม่มีสินค้านี้" [ห้ามสร้าง row ต้นทาง]; !dec.ok→{ok:false,insufficient,error:"สต็อกต้นทางไม่พอ (เหลือ X)"}. (2) target: มี id→_atomicAddStock; ไม่มี→xhrPost{returnData:true}→push {id:res.data.id,...} เข้า cache. (3) **rollback เฉพาะ target ล้มหลัง source ตัดสำเร็จ**→คืน source. (5) log movement=best-effort try/catch→log ล้ม warn แต่ ok:true [❌ ห้าม rollback ตอน log ล้ม]. (6) ❌ ไม่แตะ products.stock [โอนระหว่างคลัง=ผลรวมเท่าเดิม]. return shape {ok,error}(+insufficient) เดิม—caller พึ่งอยู่. +8 guard tests [warehouse_transfer_cas], unit 1069, e2e 11. **known risk:** atomicity ข้าม 2 row ยัง best-effort client-side [robust=DB RPC ภายหลัง])
**Previous:** 5.66.0 (build 367) — Phase 367 fix-stock-oversell-negative-guard (severity สูง oversell/§4.1-4.2: `atomicDecrementStock` เขียน after=before-qty โดยไม่เช็ค before≥qty → ขายเกินสต็อก=เขียนติดลบ [พบจริง warehouse_stock product 1809 = -1]. ใส่ **floor ที่ CAS** last line of defense; CAS refetch เจอ stock<qty ก็ fail insufficient. caller `_deductStockForSaleItem` toast "สต็อกไม่พอ". ❌ ไม่แตะ CAS retry/race/atomicAddToField/pre-checkout/sync/schema. +4 tests [stock_cas 20], unit 1061, e2e 11. **🔧 owner ต้องรัน data fix:** `update warehouse_stock set stock=0 where stock<0` [product 1809=-1] + optional CHECK constraint)
> **🔧 owner action (data fix — หลัง deploy 367):** product 1809 ติดลบอยู่ใน DB ต้องรันใน Supabase SQL Editor: `update warehouse_stock set stock = 0 where stock < 0;` (1 แถว). ทางเลือกแข็งกว่า (ทำเมื่อมั่นใจไม่มี negative ค้าง): `alter table warehouse_stock add constraint chk_stock_nonneg check (stock >= 0);` + `alter table products add constraint chk_pstock_nonneg check (stock >= 0);` — CAS floor จะทำให้ PATCH ติดลบ fail 400 ชัดเจน. **Claude รันไม่ได้** (anon creds ไม่มี DDL path)
**Previous:** 5.66.0 (build 366) — Phase 366 fix-loadalldata-1000-row-cap (CORE BUG: loadAllData โหลดได้แค่ 1000 แถว/ตาราง [PostgREST max-rows=1000] → products DB 1075 หาย 75, warehouse_stock เพี้ยน. ไฟล์ใหม่ modules/fetch_paginated.js: fetchAllPaginated(queryFn,pageSize=1000) วน .range() จนครบ [len<pageSize/ว่าง→break, error→throw]. loadAllData: products/customers/warehouse_stock paginate; warehouse_stock เพิ่ม stable .order("id") ก่อน range [เดิมไม่มี order=ข้ามหน้าซ้ำ/หาย]; helper คืน array → valArr vs val. ❌ ไม่แตะ limit-50 เจตนา/schema/RLS/SQL/stock-CAS/POS/accounting; state shape เดิม. +8 tests, unit 1057, e2e 11)
**Pre-prev:** 5.66.0 (build 365) — Phase 365 team-center-documents-list-category-readonly (filter category "เอกสาร" รวม 3 ชนิดในมุมมอง list; renderDocsListBody แยก pipeline; stats นับตามชนิด+สถานะ ไม่มียอดรวมข้ามชนิด; guard 28)
**Pre-prev-c0:** 5.66.0 (build 364) — Phase 364 team-center-recent-documents-merge-readonly (recent "เอกสารล่าสุด" รวม 3 ชนิด + receipt/delivery branch; guard 24)
**Previous:** 5.66.0 (build 364) — Phase 364 team-center-recent-documents-merge-readonly (recent "เอกสารล่าสุด" รวม 3 ชนิด + receipt/delivery branch ใน rowHtml/findItem/detailHtml; guard 24)
**Pre-prev-b0:** 5.66.0 (build 363) — Phase 363 team-center-aggregate-summary-readonly (summarizeStats + stats bar + markdown stats + overview breakdown; ป้าย ≤50; guard 21)
**Pre-prev-a0:** 5.66.0 (build 362) — Phase 362 team-center-datepreset-input-clear (cosmetic: กด date preset แล้วเคลียร์ค่าช่อง custom from/to ใน DOM; guard 18)
**Pre-prev-e0:** 5.66.0 (build 361) — Phase 361 team-center-date-range-and-export-readonly (date-range filter [preset+custom from/to] กรอง created_at ใน memory; overview recent groups; export Markdown → clipboard เท่านั้น; guard 17)
**Pre-prev-d0:** 5.66.0 (build 360) — Phase 360 team-center-list-search-polish (search box + sort [clone ก่อน sort] + reorder cards + chips rows + prompt บริบท; guard 14)
**Pre-prev-s0:** 5.66.0 (build 359) — Phase 359 team-center-owner-action-surface (filter chips + drill-down modal read-only + prompt generator clipboard; guard 12)
**Pre-prev-u0:** 5.66.0 (build 358) — Phase 358 team-center-ui-polish-readonly (game/avatar board → owner dashboard ด้วย work cards จาก ctx.state; ลบ avatar/room/map; chat → "บันทึกย่อ/Draft"; layout overflow-safe; guard 9)
**Pre-prev-t0:** 5.66.0 (build 357) — Phase 357 team-center-readonly (หน้าใหม่ `team_center` admin-only + read-only dashboard; integration placeholder; agent concept; chat local draft; +8 guards)
**Pre-prev-q0:** 5.66.0 (build 356) — Phase 356 quotation-save-inflight-guard (module flag `_qtSaveInflight` + try/finally + disable ปุ่ม → กันสร้างเอกสารซ้ำ; ไม่เปลี่ยน save semantics/endpoint; ไม่แตะ service_jobs/stock/POS/cart/schema)
**Pre-prev-air0:** 5.66.0 (build 355) — Phase 355 air-quotation-save-linkback (append อ้างอิงงานแอร์ลง note ตอนกดบันทึกเอง; preserve note เดิม + กัน duplicate)
**Pre-prev-0:** 5.66.0 (build 354) — Phase 354 quotation-air-draft-polish (banner+source summary+back-to-job+price warning+customer hint)
**Pre-prev-0:** 5.66.0 (build 353) — Phase 353 air-job-to-quotation-draft-action (ปุ่ม→quotation draft)
**Pre-prev-1m:** 5.66.0 (build 352) — Phase 352 air-job-filter-and-priority
**Pre-prev-1l:** 5.66.0 (build 351) — Phase 351 service-job-air-source-visibility
**Pre-prev-1k:** 5.66.0 (build 350) — Phase 350 service-request-air-form-polish
**Pre-prev-1j:** 5.66.0 (build 349) — Phase 349 service-request-air-booking-polish (summary card + intent + prefill)
**Pre-prev-1i:** 5.66.0 (build 348) — Phase 348 remove-customer-cart-tab
**Pre-prev-1h:** 5.66.0 (build 347) — Phase 347 air-catalog-public-store-sync (storefront + booking flow)
**Pre-prev-1g:** 5.66.0 (build 346) — Phase 346 air-catalog-to-quotation-draft (→ ใบเสนอราคา)
**Pre-prev-1f:** 5.66.0 (build 345) — Phase air-catalog-not-real-stock-correction (wording ≠ สต็อกจริง)
**Pre-prev-1e:** 5.66.0 (build 344) — Phase air-stock-manager-safe-step (แยก 3 ประเภท — localStorage)
**Pre-prev-1d:** 5.66.0 (build 343) — Phase inventory-action-menu + category-collapse (UI/markup/CSS — สินค้า/คลัง)
**Pre-prev-1c:** 5.66.0 (build 342) — Phase inventory-mobile-polish (UI/CSS safe wins — สินค้า/คลัง)
**Pre-prev-1b:** 5.66.0 (build 341) — Phase sales-doc-mobile (CSS/markup — เอกสารขาย)
**Pre-prev-1:** 5.66.0 (build 340) — Phase mobile-layout follow-up #3 (AI entry UX inline แทน FAB)
**Pre-prev0:** 5.66.0 (build 339) — Phase mobile-layout follow-up #2 (ซ่อน AI FAB ตาม route บนมือถือ)
**Pre-prev:** 5.66.0 (build 338) — follow-up (FAB icon-only) · 337 = mobile-layout (overlap 4 จุด)
**Pre-prev2:** 5.65.0 (build 336) — Phase 92.66 (verify-slip แนบ Supabase JWT × 4 caller — client only, no SQL)
**Pre-prev:** build 335 = 92.65 (AutoKey JWT) · 334 = 92.64 (VAT split Dr=Cr) · 333 = 92.63 (profit XSS/TZ + payroll log) · 332 = 92.62 recurring · 331 = 92.61 refund (+SQL ✓)

> 🆕 **ไม่มี SQL/RLS/schema change ในเฟส 92.64** (client helper เท่านั้น)
> 🏁 **FINANCE AUDIT CLOSED ที่ build 334** — ครบทุกข้อ: #1✓✓ #2✓ #3✓ #4✓ #5✓ #6✓ #6b✓ #7✓(dead code ลบแล้ว) #8✓ #9✓
> ✅ **#9 period-lock DB trigger VERIFIED** (gangboo query DB, 2026-06-01): `journal_entries` → trigger `trg_check_period_locked` → function `check_period_not_locked` → insert เข้า period ที่ locked ถูกกันที่ DB จริง (เส้นแบ่งความปลอดภัยตาม CLAUDE.md 4.3)

---

## 🛠️ Phase 356 quotation-save-inflight-guard — กันกดบันทึกใบเสนอราคารัว/ดับเบิลคลิก (build 356)

**Root cause:** `saveQuotationFull` (`modules/quotations.js`) เป็น async ที่ไม่มี inflight guard — กดปุ่ม "บันทึก" รัว/ดับเบิลคลิกก่อน `await xhrPost("quotations")` รอบแรกเสร็จ → ทั้งสองครั้งอ่าน `_editingId=null` → POST เอกสารใหม่ **สองครั้ง** = ใบเสนอราคาซ้ำ (เด่นใน flow งานแอร์ build 353-355 ที่เปิดฟอร์ม draft มาให้กดบันทึก). เป็น known risk ที่ note ไว้ตั้งแต่ Phase 355.

**เป้าหมาย:** กันสร้างเอกสารซ้ำจากการกดซ้ำ โดยไม่เปลี่ยน save semantics/endpoint และไม่แตะ flow อื่น.

**Scope/ข้อห้าม:** ❌ เปลี่ยน payload/endpoint/save semantics · ❌ เปลี่ยน service job status · ❌ POST/PATCH `service_jobs` · ❌ stock/POS/cart/products/schema/SQL · ❌ auto-save (user กดเอง).

**Fix (`modules/quotations.js` เท่านั้น):**
1. module flag `let _qtSaveInflight = false` (ข้าง module state อื่น).
2. ใน `saveQuotationFull()`:
   - validation เบื้องต้นเดิม (ชื่อลูกค้า / line items) **อยู่นอก guard** → validation fail ไม่ล็อก flag.
   - ถ้า `_qtSaveInflight` แล้ว → `return _ctx.showToast("กำลังบันทึก...")` (กันกดซ้ำ).
   - set `_qtSaveInflight = true` + `qtSaveBtn.disabled = true` (ถ้าหา element ได้).
   - ครอบ logic save ทั้งหมด (compute payload → xhrPost/xhrPatch → quotation_items → reset state → loadAllData → render) ด้วย **`try { ... } finally { ... }`**.
   - `finally`: `_qtSaveInflight = false` + re-query `qtSaveBtn` แล้ว `disabled = false` เสมอ (DOM อาจถูก re-render หลัง save สำเร็จ; re-enable element ที่หายไป = no-op ปลอดภัยด้วย `?`).
   - early-return เดิม (`!res.ok`) อยู่ใน try → finally ยัง reset flag/ปุ่มให้ (กดใหม่ได้หลัง error).

**ยืนยันไม่แตะ save semantics/ของต้องห้าม:** payload/endpoint/auto-QT/quotation_items insert เดิมทุกตัว (แค่ย้ายเข้า try, ไม่แก้ค่า); Phase 355 `appendAirJobNoteRef(qt_note, _airDraftMeta)` ยังอยู่ในตำแหน่งเดิม; guard test ตรวจ `quotations.js` ไม่มี `xhrPost/xhrPatch("service_jobs"`/`rest/v1/service_jobs`/addToCart/saveCustCart/_custCart/`.stock=`/`from("products")`/`ALTER·CREATE TABLE`.

**Verify:** lint:errors 0 · unit **1021** (+11 `quotation_save_inflight_guard.test.js`: module flag default false · early-return เมื่อ inflight · set flag หลัง validation · disable ปุ่มก่อน save · try/finally โครงสร้าง · finally reset flag+enable ปุ่ม · network save อยู่ใน try · Phase 355 link-back ยังอยู่ · auto-QT/items insert เดิม · ไม่แตะ service_jobs/stock/POS/cart/products · ไม่มี SQL DDL) · Phase 355 test เดิม **13/13** ยังผ่าน · e2e 11/11 (build-sync ?v=356) · **bump 355→356.**

> ⏸️ **STOP ที่ build 356** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 357.

---

## 🛠️ Phase 355 air-quotation-save-linkback — อ้างอิงงานต้นทางลงใน note ตอนกดบันทึก (build 355)

**เป้าหมาย:** เมื่อกดบันทึกใบเสนอราคาที่มาจากงานแอร์ (`source=air_job`, build 353/354) → ฝังข้อมูลอ้างอิงงานต้นทางลงใน `note` (field เดิม) เพื่อ trace ได้ว่าเอกสารนี้สร้างมาจากงานแอร์ใด — โดยไม่เปลี่ยน workflow/status งานบริการ, ไม่ auto-save, ไม่แก้ schema.

**Scope/ข้อห้าม:** ❌ save quotation อัตโนมัติ/ก่อนกดบันทึก · ❌ เปลี่ยน service job status · ❌ POST/PUT `service_jobs` · ❌ stock/products/POS/cart · ❌ SQL/schema · ❌ เปลี่ยน save endpoint · ❌ กระทบ draft 346 (catalog)/action·polish 353-354.

**Fix (`modules/quotations.js` เท่านั้น):**
1. **2 pure exported helpers** (testable):
   - `buildAirJobNoteRef(meta)` — เฉพาะ `meta.source === "air_job"` → `สร้างจากงานแอร์: {serviceJobNo|#serviceJobId} | {สั่งจอง|สอบถามราคา} | {แบรนด์ รุ่น BTU} | ราคาเสนอ {price} บาท`. ไม่มี job id → fallback `"สร้างจากงานแอร์จากแคตตาล็อก"`. source อื่น (air_catalog/null) → `""`.
   - `appendAirJobNoteRef(existingNote, meta)` — idempotent: source ไม่ใช่ air_job → คืน note เดิม; note มี marker `"สร้างจากงานแอร์"` อยู่แล้ว → ไม่ append ซ้ำ; มี note เดิม → ขึ้นบรรทัดใหม่ต่อท้าย (preserve ของผู้ใช้).
2. **`saveQuotationFull` payload.note** = `appendAirJobNoteRef(qt_note.value.trim(), _airDraftMeta)` — inject **เฉพาะตอนกดบันทึกเอง** (เป็นจุดเดียวที่เขียน note).
3. **reset `_airDraftMeta = null`** ใน post-save block → กด save อีกครั้งไม่ append ซ้ำ (คู่กับ marker-check = double-safe).

**กลไกกัน duplicate:** marker `"สร้างจากงานแอร์"` เป็นทั้งข้อความอ่านง่าย (ไทย ไม่ใช่ raw technical) **และ** ตัวตรวจซ้ำ — (ก) แก้เอกสารเดิม: `openEditForm` ไม่ตั้ง `_airDraftMeta` (null) → ref="" → note ที่ load มา (มี marker อยู่แล้ว) คงเดิม. (ข) กด save ซ้ำในฟอร์มเดิม: `_airDraftMeta` ถูกเคลียร์หลัง save แรก + ถึงไม่เคลียร์ marker-check ก็กันอยู่.

**ยืนยันไม่เปลี่ยน job status / ไม่แตะ stock·POS·cart·schema:** guard test — `quotations.js` ไม่มี `xhrPost("service_jobs"`/`xhrPatch("service_jobs"`/`rest/v1/service_jobs` (service_jobs ปรากฏแค่ `showRoute` navigation จาก build 354); ปุ่ม `qtBackToJob` ไม่มี status/save; ไม่มี addToCart/saveCustCart/_custCart/`.stock=`/`from("products")`; note ใช้ field เดิม (ไม่เพิ่มคอลัมน์/ไม่แก้ SQL).

**Verify:** lint:errors 0 · unit **1010** (+13 `air_quotation_save_linkback.test.js`: format job no/intent/รุ่น·BTU/ราคา · `#id` เมื่อไม่มี serviceJobNo + ask→สอบถามราคา · fallback ไม่มี job id · source อื่น→"" · append note ว่าง · preserve+append note ผู้ใช้ · re-save ไม่ duplicate · แก้เอกสารเดิม meta=null คงเดิม · air_catalog ไม่แตะ · wiring saveQuotationFull+reset · inject manual-save เท่านั้น (consume block ไม่ save) · ไม่ POST/PATCH service_jobs · ไม่แตะ stock/POS/cart + ไม่เพิ่มคอลัมน์) · **browser smoke (temp chromium, ลบแล้ว):** `buildAirJobNoteRef`/`appendAirJobNoteRef` ใน browser จริง → number grouping (9,000/12,900), dedup, preserve, fallback, air_catalog untouched ตรงกับ unit. e2e 11/11 (build-sync ?v=355). **bump 354→355.**

> ⏸️ **STOP ที่ build 355** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 356.

---

## 🛠️ Phase 354 quotation-air-draft-polish — ขัดเกลาใบเสนอราคารับ draft จากงานแอร์ (build 354)

**เป้าหมาย:** ปรับหน้า quotations ตอน consume draft `source=air_job` (build 353) ให้ชัด/ปลอดภัย: เห็นที่มางาน + ข้อมูลครบ + ทางกลับงานต้นทาง + ยังไม่ save จนกดเอง.

**Scope/ข้อห้าม:** ❌ save quotation/สร้างเลขเอกสารอัตโนมัติ · ❌ stock/products/POS/cart · ❌ SQL/schema · ❌ เปลี่ยน save endpoint · ❌ กระทบ draft 346 (catalog)/service_jobs 351-353.

**Fix (`quotations.js` + `ac_quotation_draft.js` + `service_jobs.js`):**
1. module state `_airDraftMeta` = draft แรก (capture ตอน consume, reset ตอนกลับ list).
2. **banner รวย:** `รายการร่างจาก{งานแอร์|แคตตาล็อกแอร์} N รายการ` + (air_job) source-summary chips: `งานเลขที่ {serviceJobNo}` / intent (`ask`→สอบถามราคา, `booking`→สั่งจอง) / `summary` (airType·brand·model·BTU·price) / `📅 {appointment}`.
3. **price warning:** `priceMissing = isJob && !(offerPrice>0)` → แถบ "⚠️ ยังไม่มีราคา (ต้องเช็คราคา) — กรุณากรอกราคาก่อนส่งให้ลูกค้า" (line item ยังเป็น 0 แต่เตือน visible; **ไม่แตะ saveQuotationFull** — soft warn per spec "อย่างน้อยเตือนก่อน").
4. **back-to-job:** ปุ่ม `#qtBackToJob` เฉพาะ `isJob && serviceJobId!=null` → `_ctx.showRoute("service_jobs")` (bindFormEvents). navigation เท่านั้น.
5. **customer hint:** ใต้หัวข้อ "ข้อมูลลูกค้า" (เฉพาะ `!isEdit && air_job && customer.name`): "ℹ️ เติมจากงานแจ้งบริการ — ... ยังไม่บันทึกลูกค้าใหม่". prefill ใช้ `_airDraftCustomer` (build 353) — ไม่ insert customer.
6. `ac_quotation_draft.pushAirQuoteDraft` + `service_jobs` handler ส่ง `serviceJobNo` เพิ่ม (additive).

**ยืนยันไม่ save/ไม่แตะ stock:** guard — consume block + back-to-job ไม่มี saveQuotationFull/xhrPost/_appXhr/status/customers insert/addToCart/.stock=; เลขเอกสารว่างจนกดบันทึก (smoke: state.quotations=0, #qt_docNo="").

**Verify:** lint:errors 0 · unit **997** (+7: serviceJobNo round-trip · banner source summary · back-to-job เฉพาะมี id + nav-only · price-missing warning · customer hint ไม่สร้าง customer · catalog 346 ยัง "แคตตาล็อกแอร์" + แก้ guard 353 ที่ pin notice เก่า) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** banner "งานแอร์"+chips(งานเลขที่/intent/นัดหมาย), customer hint+prefill, ready job ไม่มี warning / no-price job มี warning, ปุ่มดูงานต้นทาง nav→service_jobs, state.quotations=0 + docNo ว่าง, draft consumed, ไม่มี h-overflow. **bump 353→354.**

> ⏸️ **STOP ที่ build 354** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 355.

---

## 🛠️ Phase 353 air-job-to-quotation-draft-action — ปุ่มสร้างใบเสนอราคาจากงานแอร์ (build 353)

**เป้าหมาย:** ในงานจากแคตตาล็อกแอร์ (service_jobs) เพิ่มปุ่ม "สร้างใบเสนอราคา" → ส่ง draft ไปหน้าใบเสนอราคา (ไม่สร้างเอกสารจริงอัตโนมัติ).

**Scope/ข้อห้าม:** ❌ save quotation อัตโนมัติ · ❌ สร้างเลขเอกสารอัตโนมัติ · ❌ stock/products/POS/cart · ❌ SQL/schema · ❌ เปลี่ยน workflow/status งาน · ❌ กระทบ quotation draft(346)/customer dashboard·service_request(347-350)/filter·priority(351-352).

**Fix:**
1. **`ac_quotation_draft.js`** — `pushAirQuoteDraft` generalize: รับ `item.source` (default "air_catalog") + เก็บ `originalSource/serviceJobId/customerName/customerPhone/summary/intent/appointment` เพิ่ม. **Additive, backward-compatible** — ac-catalog (346) เรียกแบบเดิมยังได้ source=air_catalog.
2. **`service_jobs.js`** — import `pushAirQuoteDraft`; ปุ่ม `data-air-quote="${j.id}"` **เฉพาะ `airMeta.isAir`** (ใน action column ของการ์ด, สีฟ้า "📝 ใบเสนอราคา"); handler: `parseAirJobMeta(job)` → `pushAirQuoteDraft({source:"air_job", originalSource:"air_catalog", serviceJobId, customerName/Phone, summary, btu, offerPrice(parse จาก meta.price), intent, appointment})` + `showRoute("quotations")`. **ไม่เรียก saveQuotationFull/xhrPost/ไม่ตัด stock/ไม่เปลี่ยนสถานะงาน.** งานทั่วไปไม่มีปุ่ม.
3. **`quotations.js`** — `airDraftToLineItem`: ถ้า `d.summary` (air_job) → item_name = summary ตัดส่วนราคา (`split("·")[0]`); else เดิม (air_catalog brand/model/btu). consume เก็บ `_airDraftSource`/`_airDraftCustomer`. notice = "รายการร่างจาก**งานแอร์**" เมื่อ source=air_job (ไม่งั้น "แคตตาล็อกแอร์"). prefill `qt_customerSearch`/`qt_customerPhone` จาก `_airDraftCustomer` **เฉพาะตอนสร้างใหม่** (`!isEdit`). consume-once + ไม่ auto-save (build 346 เดิม).

**ยืนยันไม่ save อัตโนมัติ/ไม่แตะ stock/POS/cart/schema:** guard — handler air-quote ไม่มี saveQuotationFull/xhrPost/_appXhr/qt_no/addToCart/.stock=/rest; consume block ไม่ save; quotations เลขเอกสารยังว่าง (placeholder) จนกดบันทึก; draft = sessionStorage. smoke ยืนยัน `state.quotations.length===0` + `#qt_docNo` ว่าง หลังกดปุ่ม.

**Verify:** lint:errors 0 · unit **991** (+6 `air_job_quotation_draft.test.js`: air_job draft round-trip + consume-once · 346 backward-compat source=air_catalog · ปุ่มเฉพาะ air job · handler stage+nav ไม่ save/ไม่แตะ stock · quotations summary line item + "งานแอร์" notice + customer prefill · ไม่ auto-save; + แก้ guard เดิม 346/351/352 ที่ pin ค่าเก่า) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** air job มีปุ่ม / general ไม่มี → กด → quotations form "งานแอร์" notice + line item MFS10 + customer prefill + เลขเอกสารว่าง + state.quotations=0 + draft consumed + ไม่มี h-overflow. **bump 352→353.**

> ⏸️ **STOP ที่ build 353** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 354.

---

## 🛠️ Phase 352 air-job-filter-and-priority — กรอง + priority งานแอร์ (build 352)

**เป้าหมาย:** เจ้าของร้าน/ช่างหา "งานจากแคตตาล็อกแอร์" ได้ง่าย + เห็นสถานะที่ควรทำต่อ (รอยืนยันราคา/รอนัดหมาย).

**Scope/ข้อห้าม:** READ-ONLY — ❌ SQL/schema · ❌ stock/POS/cart/products · ❌ เปลี่ยน submit endpoint · ❌ กระทบงานทั่วไป · ❌ ใบเสนอราคาอัตโนมัติ.

**Filter logic (`service_jobs.js`):** module state `_sjSourceFilter` (all|air|general); `cAir = count(parseAirJobMeta(j).isAir)`, `cGeneral = total − cAir`; apply หลัง status/tag filter (`air`→`filter(isAir)`, `general`→`filter(!isAir)`). chip row "ที่มา:" โชว์เมื่อ `cAir>0` (ทั้งหมด/🌬️จากแคตตาล็อกแอร์/🔧งานทั่วไป) + handler `[data-sj-source]` re-render. แยกอิสระจาก status filter เดิม (compose ได้).

**Priority logic (`air_job_meta.js` `airPriority(meta)`):** ลำดับ — `appointment` มี → **มีวันนัดหมาย** (เขียว) > `!summary` (ข้อมูลไม่ครบ) → **รอตรวจสอบ** (เทา) > intent `ask` → **รอยืนยันราคา** (เหลือง) > intent `booking` → **รอนัดหมาย** (ฟ้า). `airPriorityBadgeHtml(meta)` → badge "⏳ {label}" ("" ถ้าไม่ใช่งานแอร์). แสดงในการ์ด service_jobs ข้าง air badge. **derive จากข้อมูลเดิม ไม่แตะ status จริงของงาน.**

**ยืนยันไม่แตะ schema/stock/POS/cart:** air_job_meta read-only (guard เดิม); service_jobs เพิ่มแค่ filter (in-memory) + display badge — guard ตรวจไม่มี addToCart/.stock=/quotation/from("products")/alter table.

**Verify:** lint:errors 0 · unit **985** (+4: priority appointment/booking/ask/incomplete · source filter chips+apply+handler+priority badge no-mutation) · **smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** ที่มา-chip (air 2/general 1), priority "มีวันนัดหมาย"+"รอยืนยันราคา", filter air→ซ่อนงานทั่วไป, filter general→ซ่อนงานแอร์+ไม่มี priority badge, งานทั่วไปไม่มี badge, ไม่มี h-overflow. **bump 351→352.**

> ⏸️ **STOP ที่ build 352** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 353.

---

## 🛠️ Phase 351 service-job-air-source-visibility — เห็นงานจากแคตตาล็อกแอร์ในรายการงาน (build 351)

**เป้าหมาย:** ฝั่งหลังบ้าน/รายการงาน — เจ้าของร้าน/ช่าง/ลูกค้าเห็นว่างานมาจาก "แคตตาล็อกแอร์" + รุ่น/BTU/ราคา/intent.

**Scope/ข้อห้าม:** READ-ONLY — ❌ products/POS/cart/stock · ❌ เพิ่ม/ตัด stock · ❌ ใบเสนอราคาอัตโนมัติ · ❌ SQL/schema (ไม่เพิ่ม column) · ❌ เปลี่ยน submit/workflow/สถานะงาน · ❌ กระทบ service_request ปกติ/quotation(346)/booking(347-350).

**วิธี parse `source=air_catalog`:** marker อยู่ใน `service_jobs.note` ที่ build 350 เขียน (`[source=air_catalog] {airType} {brand} {model} {btu} BTU · {ราคา} | สเปก.. | ประกัน.. | {note} | นัดหมาย {date} {ช่วงเวลา}`). ไฟล์ใหม่ **`modules/air_job_meta.js`**:
- `parseAirJobMeta(job)` — `isAir = /source=air_catalog/.test(note)`; intent จาก description ("สอบถามราคา"→ask, อื่น→booking) หรือ note ("ต้องเช็คราคา"→ask); `summary` = ช่วงแรกหลัง marker จนถึง ` | ` (มี airType/brand/model/BTU/ราคา); `btu`/`price`/`appointment` regex. best-effort, ไม่ crash (null/undefined/ไม่ครบ → `{isAir:false}` หรือ field ว่าง).
- `airBadgeHtml(meta)` = badge ฟ้า "🌬️ จากแคตตาล็อกแอร์ · {สั่งจอง|สอบถามราคา}"; `airJobInfoHtml(meta)` = กล่องสรุป (escape XSS).

**Pages/route ที่เพิ่ม badge:**
1. **`service_jobs.js`** (รายการงานช่าง admin) — `airMeta = parseAirJobMeta(j)`; badge ในแถว status + info box ในการ์ด. งานทั่วไป/ออเดอร์เว็บ (isWebOrder) ไม่โดน.
2. **`customer_dashboard.js`** แท็บ "งานของฉัน" — badge ใต้ type label + info box; **ซ่อน raw `💬 note` block เมื่อ `airMeta.isAir`** (กล่องสรุปแสดงแทน — ไม่โชว์ `[source=air_catalog]` ดิบให้ลูกค้า).

**Detail view (item 5):** กล่อง "รายการจากแคตตาล็อกแอร์" แสดง inline ในการ์ดรายการอยู่แล้ว (เห็นรุ่น/BTU/ราคา/นัดหมายโดยไม่ต้องเปิด) — ไม่แตะ edit drawer/workflow.

**Filter chip (item 4):** **เลื่อนเป็น phase ถัดไป** ตามที่ spec อนุญาต (ทำ badge/card ก่อนให้ปลอดภัย).

**ยืนยันไม่แตะ stock/POS/cart/schema:** air_job_meta ไม่มี fetch/localStorage/sessionStorage/SUPABASE_CONFIG/addToCart/.stock=/rest (guard); service_jobs/customer_dashboard เพิ่มแค่ display string จาก meta (ไม่แตะ mutation เดิม).

**Verify:** lint:errors 0 · unit **981** (+8 `air_job_meta.test.js`: parse booking/ask · normal=no badge · malformed ไม่ crash · marker เฉพาะ note ไม่ใช่ description · badge/info render + XSS escape · air_job_meta read-only · service_jobs+customer_dashboard wired ไม่มี cart/stock/POS/quotation) · **smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** air job → badge + info (รุ่น/BTU/ราคา/นัดหมาย) ทั้ง service_jobs + งานของฉัน; งานทั่วไปไม่มี badge (note ปกติคงอยู่); ไม่โชว์ marker ดิบ; ไม่มี h-overflow. **bump 350→351**.

---

## 🛠️ Phase 350 service-request-air-form-polish — ขัดเกลา UX หน้าแจ้งงาน (build 350)

**เป้าหมาย:** จาก mobile screenshot 349 หน้า service_request ใช้ได้แล้วแต่มี UX ที่ควรปรับ (วันที่กรอบเปล่า, ปุ่ม AI แทรกกลาง flow, รายละเอียดซ้ำกล่องสรุป, หมายเหตุถูกตัด, ไม่มี confirmation ชัด). ปรับ **เฉพาะกรณีมี air_catalog draft** — ไม่กระทบ flow ปกติ.

**Scope/ข้อห้าม:** ❌ products/POS/cart/stock · ❌ เพิ่ม/ตัด stock · ❌ ใบเสนอราคาอัตโนมัติ · ❌ SQL/schema · ❌ เปลี่ยน submit endpoint · ❌ กระทบ service_request ปกติ/quotation(346)/customer dashboard booking(347/348).

**Fix (modules/service_request.js เท่านั้น):**
1. **date/timeslot ชัด:** `#srPrefDate` ได้ `aria-label="เลือกวันที่สะดวก"`/title; `#srPrefTime` option แรก "เลือกช่วงเวลา (ไม่ระบุก็ได้)"; เพิ่ม hint "ยังไม่ระบุก็ได้ — เจ้าหน้าที่จะติดต่อยืนยันเวลานัดหมายอีกครั้ง".
2. **AI button gating:** top button (เด่น) render เฉพาะ `!_isBooking`; เมื่อ `_isBooking` → secondary dashed link "🤖 หรือให้ AI ช่วยกรอกรายละเอียดแทน" ท้ายฟอร์ม (หลังปุ่ม submit). ทั้งคู่ใช้ id `srAiBtn` (render ทีละอัน) → handler `window.BoonsookAI.open()` เดิมผูกได้.
3. **ลดข้อความซ้ำ:** prefill `#srSymptom` สั้น = `{จองติดตั้ง|สอบถามราคา}แอร์ {brand} {model} {btu}` (label "รายละเอียดเพิ่มเติม (ถ้ามี)"); ข้อมูลเต็ม (`[source=air_catalog] airType brand model BTU · ราคา` + spec + ประกัน + note) ย้ายไป `#srNote` ที่ submit ส่งจริง. (prefill ใช้ `if(sym && !sym.value)` กันทับที่ user พิมพ์).
4. **note ไม่ตัด:** `#srNote` เปลี่ยน `input`→`textarea` rows=2 min-height 56px resize.
5. **confirmation:** สำเร็จ → "✅ ส่งคำขอแล้ว! / เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันราคาและเวลานัดหมาย" (booking) + ปุ่ม `#srViewJobs` "📋 ดูงานของฉัน" → `ctx.showRoute("customer_dashboard")` (fallback hash). non-draft = wording เดิม. toast intent-aware.

**submit เดิมไม่เปลี่ยน:** manual click → POST `/rest/v1/service_jobs` (status pending), ใช้ `finalNote` (note + นัดหมาย จาก 349). description=symptom (สั้น), note=ข้อมูลครบ → เจ้าหน้าที่เห็นครบ.

**Verify:** lint:errors 0 · unit **973** (+7 `service_request_air_form_polish.test.js`: date hint/aria · AI gating (top !_isBooking / secondary _isBooking) · short symptom + source ใน note + label "รายละเอียดเพิ่มเติม" · note textarea min-height · confirmation+ดูงานของฉัน · submit endpoint+ไม่มี cart/stock/POS/quotation · normal flow ไม่กระทบ) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** booking→AI อยู่ท้าย (หลัง submit), date hint, symptom สั้น (<80, ไม่มี source ในช่อง), note textarea มี source=air_catalog, submit→confirmation "ส่งคำขอแล้ว"+ดูงานของฉัน, reload no-draft→top AI กลับมา, ไม่มี h-overflow. **bump 349→350**.

---

## 🛠️ Phase 349 service-request-air-booking-polish — หน้าแจ้งงานรับ booking แคตตาล็อกแอร์ (build 349)

**เป้าหมาย:** ปรับ `service_request` (รับ booking draft จาก 347) ให้สวย/ชัด: แสดงว่ามาจาก "แคตตาล็อกแอร์" + ข้อมูลรุ่น/BTU/ราคา/ประเภท, intent-aware, นัดหมาย — ปลอดภัย.

**Scope/ข้อห้าม:** ❌ ไม่แตะ stock/products/POS/cart · ❌ ไม่ตัดสต็อก/เพิ่มคลัง · ❌ ไม่สร้างใบเสนอราคาอัตโนมัติ · ❌ ไม่แก้ SQL/schema · ❌ ไม่กระทบ quotation draft (346)/booking (347/348).

**Fix:**
1. **`ac_booking_draft.js` + `customer_dashboard._book`** — booking draft พก `note`/`spec`/`warranty` เพิ่ม (additive; old drafts → "" ไม่ crash). 347/348 flow ไม่พัง.
2. **`service_request.js`:**
   - **consume-once** `consumeAirBookingDrafts()` (เดิม 347) — อ่านแล้วลบ → reload ไม่เติมซ้ำ; draft เสีย/ไม่มี → ไม่ crash (try/catch).
   - **intent vars:** `_isAsk = intent !== "booking"` (รองรับ price_inquiry/ask_price), `_heading`, `_submitLabel`, `_priceTxt` (ราคาเสนอ | "ต้องเช็คราคา").
   - **summary card** "🌬️ รายการจากแคตตาล็อกแอร์": ประเภท/แบรนด์·รุ่น/BTU/ราคา/ประกัน/สเปก + chip intent + disclaimer "ยังไม่ใช่การซื้อจริง...ยังไม่ได้ส่ง".
   - **heading/ปุ่ม intent-aware:** booking→"📅 สั่งจอง/แจ้งติดตั้งแอร์" + "📨 ส่งคำขอจอง/แจ้งงาน"; ask→"💬 สอบถามราคาแอร์" + "📨 ส่งคำขอสอบถามราคา"; ไม่มี draft = เดิม "🛠️ แจ้งซ่อม/บริการ" + "📨 ส่งคำแจ้งซ่อม".
   - **prefill:** `#srType`=ติดตั้งแอร์; `#srSymptom`=label+airType+brand+model+BTU+price+spec+`[source=air_catalog]`; `#srNote`=รุ่น+note+ประกัน.
   - **นัดหมาย (ใหม่):** `#srPrefDate` (date) + `#srPrefTime` (select ช่วงเวลา) — **optional, map ลง `note` ตอน submit** (`finalNote = note + " | นัดหมาย <date> <time>"`) → **ไม่แก้ schema** (service_jobs ไม่มีคอลัมน์ appointment).
   - **submit เดิมไม่เปลี่ยน:** manual click → POST `/rest/v1/service_jobs` (status pending, job_type=resolveJobType). ใช้ `finalNote` แทน `note`.

**ยืนยันไม่แตะคลัง/POS/cart:** guard test — service_request ไม่มี addToCart/saveCustCart/_custCart/`.stock=`/quotation/`from("products")`; prefill/consume ไม่ POST (POST เฉพาะตอนกดปุ่ม); appointment ไป note ไม่ใช่คอลัมน์ใหม่.

**Verify:** lint:errors 0 · unit **966** (+9 `service_request_air_booking.test.js`: draft พก note/spec/warranty · _book ส่งต่อ · consume not peek · summary card+disclaimer · intent label · prefill type/symptom/note · นัดหมาย→finalNote · no cart/stock/POS/quotation · submit flow intact) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** booking→card+ปุ่ม "ส่งคำขอจอง"+prefill source=air_catalog; ask(price=0)→"ต้องเช็คราคา"+"ส่งคำขอสอบถามราคา"; นัดหมาย fields มี; reload→card หาย (consumed); cart ว่าง; ไม่มี h-overflow. **bump 348→349**.

---

## 🛠️ Phase 348 remove-customer-cart-tab-for-air-catalog — เอา tab "ตะกร้า" ออก (build 348)

**เป้าหมาย:** หน้าร้าน/customer_dashboard เป็น flow **จอง/สอบถามราคา** (build 347) แต่ยังมี tab "🛒 ตะกร้า" → ลูกค้าเข้าใจผิดว่าซื้อทันที. เฟสนี้เอา tab ตะกร้า + cart/checkout wording ออกจากหน้าร้านแอร์.

**Scope/ข้อห้าม:** ❌ ไม่ลบ cart/POS logic ทั่วระบบ · ❌ ไม่กระทบ POS/งานขายจริง · ❌ ไม่แตะ stock/products core/Supabase/SQL · ❌ ไม่กระทบ quotation draft (346)/booking draft (347).

**Fix (customer_dashboard.js + style.css):**
1. **ตัด `{id:"cart"}` ออกจาก tab nav array** → เหลือ ร้านค้า/ประวัติซื้อ/งานของฉัน/แต้มสะสม (ไม่มี cartCount badge แล้ว).
2. **guard `if (_custTab === "cart") _custTab = "shop"`** ต้น render → สาขา `else if (_custTab==="cart")` (cart UI 393-558) + checkout handlers (839-1140) **คงไว้แต่ unreachable (dormant)** — ไม่ลบ (กัน regression + เคารพ "ห้ามลบ cart logic"). cartCount/cartTotal/saveCustCart/_custCart ยังถูกอ้างใน dead branch → ไม่มี unused-var.
3. ปุ่มการ์ดยังเป็น `data-book` → `_book` (booking draft → service_request) จาก 347 — ไม่แตะ.
4. **style.css @media≤768:** เพิ่ม `body[data-route="customer_dashboard"] #bs-help-fab { display:none }` (กัน help FAB ทับการ์ด) — รวมในบล็อกเดียวกับ products/wh_*. **คนละปุ่มกับ AI `#bs-ai-fab`** (build 340 มือถือซ่อน AI FAB อยู่แล้ว).

**ยืนยันไม่กระทบ POS/cart จริง:** `modules/pos.js` ไม่แตะ (POS ใช้ cart ของตัวเอง คนละ store); customer_dashboard cart logic = dormant ไม่ถูกลบ; guard test ยืนยัน pos.js + saveCustCart ยังอยู่. `_custTab` ไม่ persist (default "shop") → ไม่มีทางเข้าสาขา cart.

**Verify:** lint:errors 0 · unit **957** (+4: no cart tab in nav · _custTab guard · help-fab hide customer_dashboard mobile (ไม่แตะ AI FAB) · POS/cart logic preserved) · **smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** tab ไม่มี cart, ไม่มีคำ ตะกร้า/เพิ่มลงตะกร้า/ชำระเงิน/คงเหลือ, กดสั่งจอง→service_request, `bsk_cust_cart` ว่าง, ไม่มี h-overflow. **bump 347→348**.

---

## 🛠️ Phase 347 air-catalog-public-store-sync — หน้าร้านอ่านแคตตาล็อกแอร์ชุดเดียวกัน (build 347)

**เป้าหมาย:** หน้าหลัก/ร้านค้า (customer_dashboard) แสดงแอร์จาก **แคตตาล็อกชุดเดียวกับหน้าจัดการ** (`bsk_ac_catalog`) แต่**แยกจากคลังจริง 100%**; ปุ่ม "สั่งจอง" = booking/lead ไม่ใช่ addToCart/POS.

**Source เดิมของหน้าร้าน:** customer_dashboard อ่าน `bsk_ac_catalog` อยู่แล้ว (line ~180) แต่ map เป็น "products" + เข้า **cart→checkout** (สร้าง service_jobs). ปุ่มเดิม: stock>0 → "🛒 เพิ่มลงตะกร้า" (addToCart), stock≤0 → "📞 สั่งจอง" (toast). filter เดิม = by brand (section).

**Scope/ข้อห้าม:** ❌ ไม่ผูก products/POS · ❌ ไม่เพิ่ม/ตัด stock · ❌ ไม่รวมมูลค่า inventory · ❌ "สั่งจอง" ไม่ใช่ addToCart/POS · ❌ ไม่กระทบ quotation draft (346) · ไม่แตะ SQL.

**Fix:**
1. **customer_dashboard.js** — เพิ่ม `_acStatusOf` (price≤0→check, price>0&&stock>0→ready, อื่น→inactive); `visibleProducts` = products ที่ไม่ใช่ inactive (ซ่อน "เลิกขาย"). filter dropdown เปลี่ยนเป็น **ประเภทแอร์** (`p._acType` = `acTypeOf`, AC_TYPES 3 อัน) นับจาก visibleProducts. การ์ดใหม่ `_acCardHtml` (BTU/แบรนด์/รุ่น/ราคาเสนอ/รวมติดตั้ง/spec inverter·R32·warranty) ปุ่ม `data-book` → "📅 สั่งจอง"(ready)/"💬 สอบถามราคา"(check). **เลิกใช้ addToCart สำหรับ card แอร์** — ลบ `_addToCart`/`_reserve`/`data-add-cart`; เพิ่ม `_book`/`_bindBook`/`_openAcDetail`. notice "ราคาสำหรับเสนอขาย กรุณารอเจ้าหน้าที่ยืนยัน". **cart tab + checkout เดิมคงไว้ (dormant)** — ไม่มี path เพิ่มของเข้าตะกร้าแล้ว (follow-up: เอา tab ตะกร้าออกได้ภายหลัง).
2. **ไฟล์ใหม่ `modules/ac_booking_draft.js`** — sessionStorage `bsk_air_booking_draft` (push/consume-once/peek). `_book` → `pushAirBookingDraft({source:"air_catalog",catalogId,airType,brand,model,btu,offerPrice,intent})` + `showRoute("service_request")`. **ไม่ addToCart/ไม่ตัด stock/ไม่ POS/ไม่ save**.
3. **service_request.js** — `consumeAirBookingDrafts()` ต้น render (อ่านแล้วลบ) → prefill `#srSymptom` ("สนใจสั่งจอง/สอบถามราคา {airType} {brand} {model} {btu} BTU (ราคาเสนอ ...) [source=air_catalog]"), `#srNote`, `#srType`→ "❄️ ติดตั้งแอร์"; notice banner "ยังไม่ได้ส่ง". **submit เดิมไม่แตะ — user กดส่งเอง** (manual).
4. **product_detail_modal.js** — opts `reserveOnly` + `ctaLabel`: โหมดจอง (ปุ่มเดียว → onReserve, ไม่มีตะกร้า). backward-compatible (caller เดิมไม่ส่ง = พฤติกรรมเดิม).

**ยืนยันไม่แตะคลังจริง:** _book ไม่มี `_custCart`/addToCart/saveCustCart/`.stock=`; booking draft = sessionStorage (หายเมื่อปิดแท็บ); consume ใน service_request ไม่ POST (prefill เท่านั้น); customer_dashboard ไม่ import pos/stock_cas/products module; การ์ดไม่มีคำว่า สต็อก/คงเหลือ.

**Verify:** lint:errors 0 · unit **953** (+11 `air_catalog_store_sync.test.js`: booking helper push/consume-once/sessionStorage-only · storefront อ่าน bsk_ac_catalog + filter by type · ซ่อน inactive · card data-book ไม่มี add-cart/คงเหลือ · disclaimer · _book no cart/stock/POS · ไม่ import products/POS · service_request consume+prefill ไม่ auto-submit · quotation draft 346 intact) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** storefront โหลด, การ์ดจาก catalog, filter ประเภททำงาน, ซ่อนเลิกขาย, กดสั่งจอง → service_request prefilled "ยังไม่ได้ส่ง", cart ว่าง, booking draft consumed, ไม่มี h-overflow. **bump 346→347**.

---

## 🛠️ Phase 346 air-catalog-to-quotation-draft — "นำไปเสนอราคา" → รายการร่างในใบเสนอราคา (build 346)

**เป้าหมาย:** ปุ่ม "นำไปเสนอราคา" (build 345 เป็น nav-only) ตอนนี้**ส่งข้อมูลรุ่นแอร์เป็น draft item** เข้าฟอร์มใบเสนอราคา. **ไม่สร้างใบเสนอราคาจริงอัตโนมัติ** + **ไม่แตะคลังจริง**.

**Scope/ข้อห้าม:** ❌ ไม่เพิ่ม/ตัด stock จริง · ❌ ไม่ผูก products/POS/cart/billing/stock-core · ❌ ไม่ save Supabase จนกว่าผู้ใช้กดบันทึกเอง · ❌ ไม่แก้ SQL/schema · ❌ ไม่เปลี่ยน import/export format.

**กลไก draft (ไฟล์ใหม่ `modules/ac_quotation_draft.js`):** bridge ผ่าน **sessionStorage** key `bsk_air_quote_draft`.
- `pushAirQuoteDraft(item)` — append draft (source/catalogId/airType/brand/model/btu/offerPrice/estimatedCost/sku/note).
- `consumeAirQuoteDrafts()` — **อ่านแล้วลบ** (consume-once) → กันเติมซ้ำตอน re-render/reload.
- `peekAirQuoteDraftCount()`.

**Flow:**
1. `ac-catalog.js` ปุ่ม `data-ac-quote` → `pushAirQuoteDraft({...})` + toast "เพิ่มเป็นรายการร่าง..." + `showRoute("quotations")`.
2. `quotations.js` `renderQuotationsPage` (ต้นฟังก์ชัน ก่อน clear block) → `consumeAirQuoteDrafts()`; ถ้ามี → `_editingId=null; _viewMode="form"; _lineItems = drafts.map(airDraftToLineItem); _airDraftNotice = n`.
3. `airDraftToLineItem(d)` → `{product_id:null, item_name:"${airType} ${brand} ${model} ${btu} BTU"(+note), qty:1, unit:"เครื่อง", unit_price:offerPrice, line_total, _source:"air_catalog", _estCost, _catalogId}`. marker `_*` **in-memory เท่านั้น** — save (line ~810) เลือกเฉพาะ product_id/item_name/qty/unit/unit_price/discount_pct/line_total/sort_order → ไม่ persist marker, ไม่แตะ schema.
4. ฟอร์มโชว์ notice "🌬️ มีรายการร่างจากแคตตาล็อกแอร์ N รายการ — ยังไม่ได้บันทึกเอกสาร". `_airDraftNotice` reset เป็น 0 เมื่อกลับ list (clear block).

**ยืนยันไม่แตะคลังจริง:** quote handler ไม่เรียก addToCart/_appXhr/SUPABASE_CONFIG/products; consume block ไม่เรียก saveQuotationFull/xhrPost; draft อยู่ sessionStorage (หายเมื่อปิดแท็บ); estimatedCost เก็บเป็น trace ไม่เข้า quotation_items (ฟอร์มไม่มี cost column). existing save flow `qtSaveBtn→saveQuotationFull` ไม่แตะ.

**Verify:** lint:errors 0 · unit **942** (+9 `air_catalog_quotation_draft.test.js`: push→sessionStorage · consume returns+clears+ไม่ re-consume · multi-push · estCost null · helper sessionStorage-only · quotations consume→form ไม่ auto-save · line item product_id:null · notice "ยังไม่ได้บันทึก" · existing save flow intact; + ac guard quote test = stage-draft+nav ไม่แตะ stock/cart) · **flow smoke (temp Playwright, ลบแล้ว) mobile 390×844 + desktop:** catalog → กด "นำไปเสนอราคา" → ฟอร์มเปิดพร้อม notice + line item "แอร์ติดผนัง TCL... MFS10 9,000 BTU", `state.quotations` ยัง 0 (ไม่ save), sessionStorage ถูก consume, render ซ้ำ (reload) ไม่เติม row เพิ่ม, ไม่มี h-overflow. **bump 345→346**.

---

## 🛠️ Phase air-catalog-not-real-stock-correction — แคตตาล็อกทำราคา ≠ สต็อกจริง (build 345)

**Context (owner clarify):** หน้าแอร์ (Settings → ac-catalog) **ไม่ใช่สต็อกจริงในร้าน** — เป็น **แคตตาล็อกสำหรับตั้งราคา/เลือกสินค้าไปทำใบเสนอราคา** ก่อนค่อยสั่งของหรือเพิ่มเข้าคลังจริงภายหลัง. build 344 ตั้งชื่อ "จัดการสต็อกแอร์" สื่อผิด → เฟสนี้แก้ wording.

**Scope:** **wording/UI/UX เท่านั้น** — ❌ ไม่ผูก products/POS · ❌ ไม่รวมมูลค่าคลัง · ❌ ไม่นับ stock จริง · ❌ ไม่แตะ stock-core/billing/cart/Supabase/SQL · ❌ ไม่ migration. (ยังเป็น localStorage `bsk_ac_catalog` เดิม — คนละ store กับ products)

**Fix (ac-catalog.js + ac-stock-form.js + menu.js):**
1. หัวข้อ "จัดการสต็อกแอร์" → **"จัดการแคตตาล็อกแอร์"** + subtitle box "ใช้สำหรับตั้งราคา/ทำใบเสนอราคา — ไม่ใช่สต็อกจริงในคลัง" + menu label.
2. wording: summary `มีสต็อก/หมดสต็อก` → `พร้อมเสนอขาย/ยังไม่เปิดขาย`; **ลบ "คงเหลือ"** จากการ์ด; ปุ่มเสี่ยง `ตั้งสต็อก 5 เครื่อง` → `ตั้งค่าเริ่มต้นแคตตาล็อก` (confirm เดิม, set พร้อมเสนอขาย); `+ เพิ่มเข้าคลัง` → `📝 นำไปเสนอราคา`.
3. **`นำไปเสนอราคา` (`data-ac-quote`)** = navigation อย่างเดียว → `ctx.showRoute("quotations")` (fallback `location.hash`). **ไม่ตัดคลัง/ไม่ persist/ไม่แตะ cart** (เดิม `data-ac-addstock` prompt บวก stock — ลบทิ้งเพราะสื่อว่าเป็นคลังจริง).
4. การ์ด: แบรนด์/รุ่น/BTU/**ราคาขายเสนอ**/**ต้นทุนประมาณการ**/**กำไรประมาณการ**(price−cost ถ้ามี cost)/รหัสอ้างอิง(sku)/หมายเหตุ + **badge 3 สถานะ**: `price≤0`→ต้องเช็คราคา(amber) · `price>0 && stock>0`→พร้อมเสนอขาย(green) · `price>0 && stock≤0`→เลิกขาย(gray).
5. ฟอร์ม: `ราคาขาย`→`ราคาขายเสนอ`, `ต้นทุน`→`ต้นทุนประมาณการ`, `จำนวนสต็อก`→`สถานะเสนอขาย` (>0=พร้อมเสนอขาย; field key `stock` ภายในคงเดิม).

**หมายเหตุ semantics:** field `stock` ในแคตตาล็อกนี้ถูก reframe เป็น **"สถานะเสนอขาย" (>0=เปิด)** ไม่ใช่จำนวนในคลัง — ไม่เปลี่ยน data key (กัน customer_dashboard ที่อ่าน `c.stock>0` เพื่อโชว์ "พร้อมส่ง" พัง). tabs 3 ประเภท + fallback "wall" + import/export 24-col คงเดิม.

**Verify:** lint:errors 0 · unit **933** (14 `ac_stock_manager_guard.test.js`: rename+subtitle · misleading words removed (คงเหลือ/เพิ่มเข้าคลัง/มีสต็อก/หมดสต็อก/พร้อมส่ง) · offer wording · 3-state badge+cost/profit · นำไปเสนอราคา nav-only ไม่ mutate · setStock5 reworded+confirm · import/export ids · export 24-col · form fields · NOT wired to products/POS/API) · **mobile smoke 390×844 (temp, ลบแล้ว):** title+subtitle, badge 3 แบบ, กำไรฯแสดง, "นำไปเสนอราคา" → showRoute("quotations") + localStorage **ไม่เปลี่ยน**, ไม่มี h-overflow. **bump 344→345**.

---

## 🛠️ Phase air-stock-manager-safe-step — จัดการสต็อกแอร์ แยก 3 ประเภท (build 344)

**Scope (SAFE STEP):** ปรับ "จัดการแคตตาล็อกแอร์" (Settings → ac-catalog) เป็น **"จัดการสต็อกแอร์"** แยก 3 ประเภท. **localStorage (`bsk_ac_catalog`) เท่านั้น** — **ไม่แตะ** auth/API/DB schema/billing/cart/stock-core, **ไม่เปลี่ยน format import/export** (Excel/CSV คง 24 คอลัมน์เดิม), **ไม่ลบข้อมูลเดิม**, **ไม่ bulk-migrate**. หน้านี้แยกจากตาราง products/POS (คนละ store) — consumers (`customer_dashboard.js`, `main.js`) อ่าน field เดิมอย่างเดียว → เพิ่ม `ac_type` เป็น additive ปลอดภัย.

**UX issue:** หน้าเดิมเป็น list grouped-by-brand + ปุ่มเสี่ยง "ตั้งสต็อก 5 เครื่องทุกรุ่น" เด่นโต่ง + ไม่มีฟอร์มเพิ่ม/แก้รุ่น (มีแต่ import + spec editor).

**Fix:**
1. **3 air-type tabs** — `AC_TYPES` (wall/ceiling/cassette = แอร์ติดผนัง/แอร์แขวน/แอร์สี่ทิศทาง) ใน `ac-stock-form.js`. `acTypeOf(c)` = `c.ac_type` ถ้าอยู่ใน 3 keys ไม่งั้น **fallback "wall"** → ข้อมูลเดิม (ไม่มี field) โผล่ใน "แอร์ติดผนัง" โดยไม่ migrate. tab state = module-level `_acTab` (default wall).
2. **summary cards** (scope ตาม tab): รุ่นทั้งหมด/แบรนด์-กลุ่ม/มีสต็อก(stock>0)/หมดสต็อก(stock≤0).
3. **product cards** ต่อ tab: รุ่น/แบรนด์(section)/BTU/ราคา/คงเหลือ/SKU/badge(พร้อมส่ง·หมดสต็อก) + ปุ่ม `แก้ไข`(data-ac-edit→core form) / `+ เพิ่มเข้าคลัง`(data-ac-addstock→prompt +N, localStorage) / `⋯`(data-edit-spec→spec editor เดิม).
4. **header actions**: `+ เพิ่มรุ่นแอร์`(`#acAddModelBtn`) / `📂 นำเข้า Excel`(`#acImportQuickBtn`→trigger `#acCatalogFileInput` เดิม) / `⋯ จัดการเพิ่มเติม`(`.prod-more-menu` reuse build 343) ที่เก็บ: export xlsx/csv, **ตั้งสต็อก5 (เสี่ยง, confirm เดิม)**, refresh-JSON, ล้างทั้งหมด(danger). ทุก id/handler เดิม **ไม่แตะ** — แค่ย้ายที่.
5. **import drop-zone** → section รอง `<details>` "นำเข้า/ส่งออกไฟล์ (ขั้นสูง)"; format เดิม, IDs เดิม (`acCatalogFileInput`/`acCatalogImportBtn`/`acCatalogImportStatus`).
6. **`ac-stock-form.js` (ใหม่)** — modal core fields: ประเภท/แบรนด์/รุ่น/BTU/ราคา/ต้นทุน/สต็อก/SKU/หมายเหตุ. add → default ประเภท = tab ปัจจุบัน, id = max+1; edit → spread ของเดิมครบ (คงสเปกเทคนิค/ประกัน/รูป). `cost/sku/note/ac_type` = ฟิลด์ใหม่ใน localStorage.
7. menu label "คลังสินค้า AC" → "จัดการสต็อกแอร์".

**⚠️ Known limitation (ตั้งใจ — รอบถัดไป):** import ยัง **overwrite** catalog ทั้งก้อน (พฤติกรรมเดิม) + Excel/CSV ยังไม่มีคอลัมน์ ac_type/cost/sku/note → ถ้า user import ทับ ฟิลด์ใหม่จะหาย. รอบนี้ลูกค้าสั่ง "ห้ามแตะ import/export format". รอบหน้าค่อยเพิ่มคอลัมน์ + merge-by-id.

**Verify:** lint:errors 0 · unit **931** (+12 `ac_stock_manager_guard.test.js`: 3 types+labels · acTypeOf fallback wall · rename · 3 tabs · summary · primary buttons · setStock5 ย้ายเข้าเมนู+confirm · import/export ids preserved · export 24-col ไม่เปลี่ยน · form 9 fields · default type ตาม tab · form no-API) · **render smoke (temp Playwright, ลบแล้ว):** mobile 390×844 + desktop 1280 — รีโหลด, 3 tabs, legacy→แอร์ติดผนัง, สลับ tab, +เพิ่มรุ่น default type ตาม tab, edit เปิดฟอร์ม, menu เปิด/ปิด, import section คงอยู่, ไม่มี h-overflow. **bump 343→344**.

---

## 🛠️ Phase inventory-action-menu + category-collapse — จัดหน้า สินค้า/คลัง ให้โล่ง (build 343)

**Scope:** ต่อจาก 342 ที่ทำ safe wins — เฟสนี้ทำ **action menu จริง** ที่ 342 เลื่อนไว้ + category collapse. **UI/markup/CSS** เท่านั้น — ไม่แตะ stock/barcode/import-export/billing/auth/API/pricing. **`id`/`data-action`/handler เดิมครบทุกปุ่ม** (ย้าย markup เข้าเมนูเฉย ๆ — event binding by id / event-delegation by attr ยังหาเจอ).

**Root cause (ความรก):** header 9 ปุ่มเรียงพรืด · per-card 4–6 ปุ่ม · หมวด 18+ อันดันรายการลงไกล.

**Fix (modules/products.js + style.css):**
1. **Header menu** — `.prod-header-actions` เหลือ `#prodImportBtn` + `#prodAddBtn` (primary) + `<details class="prod-more-menu">` "⋯ จัดการเพิ่มเติม". ย้ายเข้า panel: `#prodExportBtn`/`#prodGenAllBarcodesBtn`/`#prodPrintBarcodesBtn`/`#prodManageCatBtn`/`#prodMergeCatBtn`/`#prodBulkModeBtn`/`#prodDeleteAllBtn`. **`#prodDeleteAllBtn` = ปุ่มสุดท้าย** + class `prod-more-danger` (สีแดง + เส้นคั่นบน) → handler เดิม `deleteAllProducts(ctx)` (มี confirm) ไม่แตะ.
2. **Per-card menu** — `renderProductItem` (grid+list) เหลือ `+ บิล` (`data-prod-add`) นอกเมนู + `<details class="prod-card-menu">` "⋯" ที่บรรจุ `data-prod-edit`/`data-prod-stockin`/`data-qr-prod`/`data-prod-print`/`data-prod-del` (เงื่อนไข stock/admin เดิม). delegation `el.querySelectorAll("[data-prod-*]")` ยังผูกได้.
3. **Category collapse** — `CAT_CAP=10`. chip index ≥10 ติด class `prod-cat-extra`; chip ที่ตรง `currentCategory` ติด `is-active`; bar ติด `has-extra` ถ้า > CAP. ปุ่ม `#prodCatToggleBtn` (มี 2 label more/less). CSS `@media≤768`: `.prod-category-bar.has-extra:not(.cat-expanded) .prod-cat-extra:not(.is-active){display:none}` → ซ่อนส่วนเกินยกเว้นที่เลือก. toggle = `classList.toggle("cat-expanded")` (ไม่ re-render — คง scroll).
4. **ล้างตัวกรองทั้งหมด** — `#prodClearAllFilters` โชว์เมื่อ `currentCategory!='all' || currentFilter!='all' || quickFilter || currentTagFilter || searchQuery`; handler reset ครบทุก dimension + `renderView`.

**⚠️ ข้อควรระวัง (เหตุผลออกแบบ):** เมนูใช้ `<details>` **inline-flow** (panel เป็น block ดันเนื้อหา ไม่ใช่ `position:absolute`) เพราะ `.prod-list{overflow:hidden}` + `.panel{overflow-x:auto}` (มือถือ) จะ **clip** dropdown ที่ลอย. Header dropdown = absolute เฉพาะ desktop, inline บนมือถือ. accordion: เปิด details ตัวนึงปิดตัวอื่น (`toggle` listener).

**Verify:** lint:errors 0 · unit **919** (+7: header-menu relocate · ลบทั้งหมด last+danger+confirm · card +บิล/⋯ · accordion+inline no-clip · category collapse · clear-filters) · e2e smoke 11 ✓ (build-sync 343) · **mobile smoke 390×844 (temp Playwright, ลบแล้ว):** header เหลือปุ่มหลัก, เมนูเปิด/ปิด, ลบทั้งหมดสีแดงท้ายเมนู, หมวดย่อโชว์ 10+หมวดที่เลือก, +บิลเด่น, ⋯เปิดเมนูได้, ไม่มี h-overflow. **bump 342→343** (data-app-build + style/main/boot/selfheal `?v=343` + sw cache-v343; semver 5.66.0).

---

## 🛠️ Phase inventory-mobile-polish — จัดหน้า สินค้า/คลัง บนมือถือ (safe wins, build 342)

**Scope (ลูกค้ายืนยัน "safe wins ก่อน"):** UI/CSS เท่านั้น — **ไม่แตะ** stock/barcode/import-export/billing/auth/API หรือ **wiring ของปุ่ม** (`#prodImportBtn`/`#prodAddBtn`/`data-prod-*` ฯลฯ เดิมหมด). **action menu จริง** (header "จัดการเพิ่มเติม" + per-card "...") **เลื่อนรอบหน้า** เพราะต้องย้าย markup ของปุ่มที่ต่อ logic.

**Root cause (ความรก):** 9 ปุ่ม header เรียงพรืด · filter 5 ชั้น (type/warehouse/status/tag/search/quick/category) · per-card 6 ปุ่ม action แน่น · help 💡 FAB ลอยทับรายการ.

**Fix (modules/products.js + style.css):**
1. **summary cards** — เพิ่มแถวการ์ด 4 ใบหลัง `.prod-header` (`products.length>0`): ทั้งหมด/พร้อมขาย(เขียว #16a34a)/ใกล้หมด(ส้ม #d97706)/หมดสต็อก(แดง #dc2626). ใช้ `countTypeAll`/`countInstock`/`countLow`/`countOut` ที่ `renderView` คำนวณอยู่แล้ว — **ไม่มี query ใหม่**. CSS `.prod-summary` grid 4-col (≤400px → 2×2).
2. **filter wrap** — `@media≤768`: `.prod-filter-tabs`/`.prod-type-tabs` `flex-wrap:wrap !important` + `overflow-x:visible` (เดิม nowrap+scroll ซ่อนแท็บ) → เห็นครบ ไม่ทับ.
3. **product card** — `@media≤768`: `.prod-list-right` wrap, price `flex:1`, stock ชิดขวา, `.prod-list-actions` `flex-basis:100%` (ลงแถวเต็มกว้างของตัวเอง ไม่ล้น/ทับ).
4. **help FAB** — `@media≤768`: `body[data-route="products"|"wh_kunkhao"|"wh_kundaeng"|"wh_sikhon"] #bs-help-fab { display:none !important }`. **คนละปุ่มกับ AI `#bs-ai-fab`** (build 340) — guard เช็ค.

**Verify:** lint:errors 0 · unit **913** (+3: summary derive/colors · tabs-wrap+actions-row · help-fab-hide ไม่แตะ AI) · Playwright @390×844: summary 4 ใบ in-viewport, status tabs wrap 2 แถว `overlap:false`, per-card action ไม่ overlap, `#bs-help-fab` none (products) vs flex (dashboard); desktop summary 4-col + help-fab flex ปกติ. **bump 341→342** (data-app-build + style/main/boot/selfheal `?v=342` + sw cache-v342; ai-chat-widget คง `?v=9`; semver 5.66.0).

---

## 🛠️ Phase sales-doc-mobile — แก้ layout overlap หน้าเอกสารขาย (build 341)

**Issue:** หน้ากลุ่มงานขายบนมือถือ (ใบเสนอราคา/ใบส่งสินค้า-ใบแจ้งหนี้/ใบเสร็จรับเงิน) มี text/layout overlap 3 จุด.

**Fix (CSS + markup เท่านั้น — ไม่แตะ business/API/auth/accounting):**
1. **status filter tabs ทับกัน** — `.qt-tabs`/`.di-tabs`/`.rc-tabs` เป็น `flex` + `overflow-x:auto` แต่ปุ่ม (`.qt-tab-btn` ฯลฯ) ไม่มี `flex-shrink:0` → flex บีบปุ่ม จนข้อความ `white-space:nowrap` ล้นทับปุ่มข้าง ๆ. **Fix (style.css @media≤768):** containers `flex-wrap:wrap !important` + `border-bottom:0`; buttons `flex:0 0 auto` + `border-radius:999px` (chip) + `border/bg !important` → wrap เป็น chip เห็นครบทุกแท็บ ไม่ทับ. active ยังบอกด้วยสีตัวอักษร (inline). desktop คง underline-tab เดิม.
2. **doc table กว้างเกินจอ** — wrapper เดิม `<div style="overflow-x:auto;margin-top:12px">` (ไม่ใช่ shared). **Fix:** เปลี่ยนเป็น `<div class="table-wrap" style="margin-top:12px">` ใน `quotations.js`/`delivery_invoices.js`/`receipts.js` → ได้ `.table-wrap` mobile (min-width:520px + full-bleed `margin:0 -16px` + scroll) → เลขเอกสาร/สถานะ/ปุ่ม ไม่ถูกตัด/ทับ.
3. **floating help 💡 ทับ row** — `#bs-help-fab` (modules/help_tutor.js, `position:fixed bottom:90px`). **Fix (style.css @media≤768):** `body[data-route="quotations"|"delivery_invoices"|"receipts"] #bs-help-fab { display:none !important }`. ใช้ `body.dataset.route` (มีอยู่จาก build 339). **คนละปุ่มกับ AI `#bs-ai-fab`** — ไม่กระทบ AI flow build 340.

**Verify:** lint:errors 0 · unit **910** (+3 guards: chip-wrap / .table-wrap / help-fab-hide ไม่แตะ AI) · Playwright @390×844 (quotations): tabs 5 อัน wrap 3 แถว `overlap:false` ทุกอันใน viewport, table scrollable, `#bs-help-fab` display none (vs dashboard flex). **bump 340→341** (data-app-build + style/main/boot/selfheal `?v=341` + sw cache-v341; ai-chat-widget คง `?v=9` ไม่ได้แตะ; semver 5.66.0).

---

## 🛠️ Phase mobile-layout follow-up #3 — AI entry UX: inline แทน floating FAB (build 340)

**Issue หลัง build 338/339:** FAB ไม่ทับ bottom nav/settings แล้ว แต่ในหน้า service form (เช่น "ใบงานติดตั้งแอร์") FAB ยัง `position:fixed` ลอยทับ select/input. รากปัญหา: fixed FAB ลอยทับ content เสมอ (content scroll ผ่านหลังได้) — route-gate/icon-only/bottom-padding ไม่พอ.

**UX decision (ลูกค้ายืนยัน: inline-only บนมือถือ):**
- **มือถือ (≤768px):** ไม่มี floating FAB เลย → ใช้ **inline button ในเนื้อหา**
- **Desktop/tablet:** คง FAB เฉพาะ **service flow** (solar / ac_install / service_* ยกเว้น service_jobs — service_request เข้าผ่าน prefix); **เอาออกจาก ai_sales / ac_shop** (มี AI ขายของตัวเอง — `ai_sales.js` หน้า AI ขาย, `ac_shop.js` ปุ่ม `shopGoAi` "ช่วยเลือก")
- **แยกบทบาท copy:** ลูกค้า = "AI ช่วยแจ้งงาน / ลงคิวงาน"; ใบงานช่าง = "AI ช่วยกรอกใบงานนี้"; ขาย = ของเดิม "AI ช่วยขายแอร์"

**สิ่งที่ทำ (UI/UX + CSS — ไม่แตะ API/Auth/business/submit):**
- `ai-chat-widget.js`: FAB base `display:none` (เดิม flex) + allowlist `body[data-route="solar"|"ac_install"|^="service_"(:not service_jobs)] #bs-ai-fab:not(.hidden) { display:flex }` (desktop). `@media ≤768px { #bs-ai-fab { display:none !important } }`. ลบ icon-only/positioning rules เดิม (ไม่ใช้แล้ว). label FAB → "AI ช่วยแจ้งงาน".
- inline buttons (ทุกปุ่ม `?.addEventListener("click", () => window.BoonsookAI?.open())`):
  - `modules/customer_dashboard.js` `#custAiCta` — การ์ด CTA ระหว่าง hero กับ tab nav
  - `modules/service_request.js` `#srAiBtn` — full-width ใต้ h3
  - `modules/service_form.js` `#svAiBtn` · `modules/ac_install.js` `#acAiBtn` · `modules/solar.js` `#solAiBtn` — ในหัว panel ใต้คำอธิบาย
- `BoonsookAI.open()` เดิมรับ 0 args + detect solar/service จาก visible page (greeting ต่างกัน) — reuse ตรง ๆ ไม่แก้ widget logic.

**Verify:** lint:errors 0 · unit **907** (+guards: mobile FAB hidden / desktop route-gate ไม่รวม sales / inline buttons+wiring+copy) · Playwright @390×844: form มือถือ `fabDisplay none`, inline btn `position static` ไม่ overlap select; settings มือถือ FAB none; desktop ac_install FAB flex, settings/ai_sales none. **bump 339→340** (data-app-build + style/main/boot/selfheal `?v=340` + ai-chat-widget `?v=9` + sw cache-v340).

---

## 🛠️ Phase mobile-layout follow-up #2 — ซ่อน AI FAB ตาม route บนมือถือ (build 339)

**Issue หลัง build 338:** icon-only ช่วยให้เล็กลง แต่ `#bs-ai-fab` ยัง `position:fixed` มุมขวาล่าง → **ลอยทับ content** หน้า Settings/เพิ่มเติม (การ์ด "สำรอง / กู้คืน config") เพราะ content scroll ผ่าน**หลัง** fixed FAB ได้ (เพิ่ม bottom padding อย่างเดียวไม่พอ).

**Fix (route-gated visibility — CSS + 1 บรรทัด DOM-state, ไม่แตะ API/Auth/business):**
- `main.js` `showRoute(route)`: เพิ่ม `document.body.dataset.route = route;` (หลัง `state.currentRoute = route`) → เปิดเผย route ปัจจุบันบน `<body>` ทุกครั้งที่เปลี่ยนหน้า (รวม initial load).
- `ai-chat-widget.js` `@media (max-width:768px)`: `#bs-ai-fab { display:none }` เป็นค่าเริ่มต้น + **allowlist** โชว์เฉพาะหน้ากรอกงานจริง:
  `body[data-route="solar"|"ac_install"|"ai_sales"|"ac_shop"] #bs-ai-fab` และ `body[data-route^="service_"]:not([data-route="service_jobs"]) #bs-ai-fab` → `display:flex`.
  (`service_request` + `service_<type>` ทั้ง 9 เข้าผ่าน prefix `service_`; `service_jobs` = list ถูกกัน). allowlist **ไม่ใช้ `!important`** → กฎซ่อนตอน drawer/sidebar/modal เปิด (ที่เป็น `!important`) ยัง override ได้ปกติ.
- desktop ไม่กระทบ (อยู่ใน `@media ≤768px`).

**Verify:** lint:errors 0 · unit **906** (+2 guards: body.dataset.route + route allowlist/no-important) · Playwright @390×844 ตรวจ computed `display` ต่อ route: hidden = dashboard/**settings**/expenses/**service_jobs**/customers · shown = service_request/service_repair_ac/solar/ac_install/ai_sales/ac_shop. **bump 338→339** (data-app-build + style/main/boot/selfheal `?v=339` + ai-chat-widget `?v=8` + sw cache-v339; semver คง 5.66.0).

---

## 🛠️ Phase mobile-layout follow-up — AI FAB icon-only กันบังการ์ด Settings (build 338)

**Issue หลัง build 337:** AI FAB ไม่ทับ bottom nav แล้ว แต่ยัง **บังการ์ดเนื้อหา**หน้า Settings/เพิ่มเติม — โดยเฉพาะการ์ด "สำรอง / กู้คืน config" (FAB เป็น pill กว้างมีข้อความ "AI ช่วยกรอก" → กินพื้นที่มุมขวาล่าง).

**Fix (CSS-only, ไม่แตะ API/Auth/business):**
- `ai-chat-widget.js`: ห่อ label ใน `<span class="bs-fab-label">` + เพิ่ม `title="AI ช่วยกรอก"` (อ่านคู่ `aria-label="เปิด AI ผู้ช่วย"` เดิม). `@media (max-width:480px)` → `#bs-ai-fab { padding:0; width:52px; height:52px; border-radius:50%; gap:0; font-size:22px }` + `.bs-fab-label { display:none }` = **icon-only วงกลม** (เหลือ 🤖, label ซ่อนแต่ a11y/tooltip ยังอยู่).
- `style.css`: `.page` mobile bottom padding 100→**160px** (`@media 768`) และ 100→150px (`@media 400`) → การ์ดท้ายหน้า scroll พ้น FAB (bottom ~72px + สูง) + bottom nav.

**Verify:** lint:errors 0 · unit **904** (+2 guards: icon-only + page padding) · Playwright @390×844 (settings-like page): FAB `52×52 radius 50% labelHidden`, scroll สุด → การ์ด "สำรอง/กู้คืน" `cardBottom 596 < fabTop 720` (พ้น FAB), FAB ยังเหนือ nav. **bump 337→338** (data-app-build + style/main/boot/selfheal `?v=338` + ai-chat-widget `?v=7` + sw cache-v338; semver คง 5.66.0 — follow-up เฟสเดียวกัน).

---

## 🛠️ Phase mobile-layout — แก้ Mobile Overlap 4 จุด (390×844, build 337)

**Scope:** CSS + DOM-state wiring เท่านั้น — **ไม่แตะ** business logic / API / accounting / auth / OCR. ทุก media rule อยู่ใน `@media (max-width:768px)` → desktop ไม่กระทบ.

**Root cause + fix (4 จุด):**
1. **Expenses filter bar ทับกัน** — `.row` (`justify-content:space-between`) + inline `min-width:200px` บน flex children → label/input/ปุ่มเบียดบนจอแคบ. **Fix:** เพิ่ม class `exp-filter-row` (`modules/expenses.js`) + mobile CSS → `> div { flex:1 1 100% !important; min-width:0 !important }` (field เต็มแถว) · `> .btn { flex:1 1 calc(50% - 8px) }` (ปุ่มแบ่งครึ่ง).
2. **Sidebar ถูก bottom nav บัง + ไม่มี state** — `.sidebar` z-index **30** < `.mobile-nav` **40**; toggle เดิมแค่ `.open` ไม่มี backdrop/body class. **Fix:** `style.css` mobile `.sidebar { z-index:60 }` (เหนือ nav 40 + backdrop 50) + `body.sidebar-open { overflow:hidden }`. `main.js`: เพิ่ม `toggleSidebar()`/`closeSidebar()` → คุม `.open` + `body.sidebar-open` + โชว์/ซ่อน `#backdrop` (ซ่อนเฉพาะตอนไม่มี drawer ค้าง). wire `menuToggle`→toggle, backdrop click→`closeSidebar()+closeAllDrawers()`, route change→`closeSidebar()`.
3. **AI FAB ทับ bottom nav + ไม่ซ่อนตอน sidebar เปิด** — `bottom:20px` ชนแถบล่าง ~52px. **Fix:** `ai-chat-widget.js` mobile `#bs-ai-fab { bottom:calc(72px + env(safe-area-inset-bottom)) }` + เพิ่ม `body.sidebar-open #bs-ai-fab` / `body:has(#sidebar.open) #bs-ai-fab` ใน hide list (และ backdrop ที่โชว์ตอน sidebar เปิดก็ทริกเกอร์ rule `body:has(#backdrop:not(.hidden))` เดิมอยู่แล้ว).
4. **Tables ใน panel ถูก clip** — `.table-wrap` มี `overflow-x:auto` อยู่แล้ว แต่ขาดคุมความกว้าง. **Fix:** `.table-wrap { max-width:100% }` → scroll แนวนอนภายใน ไม่ดัน `.panel` (mobile `overflow-x:hidden`) ล้น. (expenses list table wrap อยู่แล้ว.)

**Verify:** lint:errors 0 · unit **902** (+9 `mobile_layout_guard.test.js`: source guards z-order/state/FAB/filter/table) · Playwright @390×844 (real style.css): `fabClearsNav` true (772<801), filter groups `[340,340,340]`, `tableScrollable` true (360<792), `sidebarZ 60 > backdropZ 50 > navZ 40`, `fabHidden` true ตอน sidebar เปิด. **bump 336→337** (data-app-build + style/main/boot/selfheal `?v=337` + ai-chat-widget `?v=6` + sw cache-v337 + package 5.66.0 + data-app-version 5.66.0).

---

## 🛠️ Phase 92.66 — verify-slip (SlipOK) 401 Auth Fix (follow-up ของ 92.65)

**Root cause:** `/api/verify-slip` อยู่ใน `REQUIRE_AUTH_ENDPOINTS` (functions/_middleware.js, Phase 89.14) → middleware `verifyAuthToken` ต้องการ Supabase JWT (3-part) ใน `Authorization: Bearer`. caller "🤖 ตรวจสลิป" **ทั้ง 4 จุด** ยิงแบบมีแค่ `Content-Type` ไม่มี token → โดน 401 ก่อนถึง SlipOK = ฟีเจอร์ตรวจสลิปการโอน (verify การโอนเงินของลูกค้า) พังทั้งหมด นี่คือ follow-up ที่ Phase 92.65 ระบุไว้ (pattern เดียวกับ AutoKey เป๊ะ)

**caller ที่แก้ (เพิ่ม token guard + `Authorization: Bearer window._sbAccessToken` + จับ 401):**
- `main.js` `_verifySlip` (service drawer, line ~2505)
- `modules/service_form.js` `_doVerifySlip` (line ~227)
- `modules/ac_install.js` `_verifyAcSlip` (line ~242)
- `modules/solar.js` `_verifySolSlip` (line ~513)

**สิ่งที่ทำ (ต่อ caller):**
- อ่าน `window._sbAccessToken` **ตอนเรียก verify** (กันทั้ง path ปุ่ม "ตรวจ AI" + auto-verify ตอน payment=โอน/QR) → ไม่มี token → guard แสดง "เข้าสู่ระบบก่อนตรวจสลิป" ก่อนยิง (ไม่เปลือง SlipOK quota)
- แนบ `Authorization: Bearer <token>` ใน fetch · server ตอบ **401** (token หมดอายุ/เพิกถอนระหว่างทาง) → จับแยกแสดง "เข้าสู่ระบบใหม่" แทน `❌ Unauthorized: ...` กว้าง ๆ
- **ไม่ fallback `|| cfg.anonKey`** — anonKey = `sb_publishable_...` ไม่ใช่ JWT → `verifyAuthToken` reject (`parts.length !== 3`) = 401 อยู่ดี (pattern เดียวกับ `ai-chat-widget.js` / `line_notify.js` / AutoKey 92.65)

**Behavior preserved:** flow upload สลิป (ใช้ anonKey storage upload — ถูกต้อง, คนละ endpoint) / preview / auto-verify / ปุ่มตรวจซ้ำ / แสดงผล verification เดิม · ไม่แตะ `functions/api/verify-slip.js` (server) · ไม่มี SQL/RLS

**Gate:** lint:errors 0 · unit 893 (+24 `verify_slip_auth.test.js`: source-guard × 4 call site) · build 335→336

---

## 🛠️ Phase 92.65 — AutoKey (parse-receipt) 401 Auth Fix

**Root cause:** `/api/parse-receipt` อยู่ใน `REQUIRE_AUTH_ENDPOINTS` (functions/_middleware.js, Phase 89.14) → middleware `verifyAuthToken` ต้องการ Supabase JWT (3-part) ใน `Authorization: Bearer`. ปุ่ม AutoKey "🔍 ให้ AI วิเคราะห์ใบเสร็จ" ใน `modules/expenses.js` (`_openAutoKeyModal`) ยิงแบบไม่มี header เลย → โดน 401 ก่อนถึง Gemini = ฟีเจอร์ AutoKey สแกนใบเสร็จในหน้า รายรับ-รายจ่าย พังทั้งหมด

**สิ่งที่ทำ (`modules/expenses.js`, `_openAutoKeyModal`):**
- อ่าน `window._sbAccessToken` **ตอนกดวิเคราะห์** (ไม่ใช่ตอนเปิด modal — เผื่อ token refresh ระหว่างทาง) → แนบ `Authorization: Bearer <token>`
- ไม่มี token → `_akShowAuthError()` guard ก่อนยิง (ไม่เปลือง Gemini quota) · server ตอบ **401** (token หมดอายุ/เพิกถอน) → จับแยกแสดง "เข้าสู่ระบบใหม่" แทน "Server ตอบไม่ใช่ JSON" กว้าง ๆ
- **ไม่ fallback `|| cfg.anonKey`** — anonKey = `sb_publishable_...` ไม่ใช่ JWT → `verifyAuthToken` reject (`parts.length !== 3`) = 401 อยู่ดี (pattern เดียวกับ `ai-chat-widget.js` / `line_notify.js` ที่ยิง require-auth endpoint)

**✅ Related (แก้แล้วใน Phase 92.66):** `/api/verify-slip` ก็อยู่ใน `REQUIRE_AUTH_ENDPOINTS` เหมือนกัน — caller ทั้ง 4 (`main.js:2505`, `service_form.js:227`, `ac_install.js:242`, `solar.js:513`) เดิมยิงแบบไม่มี token → 401 เช่นกัน → แก้ครบใน Phase 92.66 (build 336) ด้วย pattern เดียวกัน (ดูหัวข้อด้านบน)

**Behavior preserved:** flow OCR/parse/แสดงผล/back-button เดิม · ไม่แตะ `functions/api/parse-receipt.js` (server) · ไม่มี SQL/RLS

**Gate:** lint:errors 0 · unit 869 (+6 `expenses_autokey_auth.test.js`: source-guard บน `_openAutoKeyModal`) · build 334→335

---

## 🛠️ Phase 92.64 — Balance Sale VAT Journal Split (audit #4)

**Root cause:** `postJournalForSale` VAT split (auto_post.js) ใช้ Dr=`total`, Cr=`subtotal_before_vat`(DB) + `vat_amount`(DB) ที่ปัดเศษแยกกัน → ผลรวมอาจ ≠ total → `_postJournal` balance guard (tol 0.01): drift >0.01 reject JV เงียบ (revenue หาย), ≤0.01 ผ่านแต่ TB เพี้ยนสะสม

**สิ่งที่ทำ (modules/accounting/auto_post.js):**
- `import round2` จาก `../utils.js`
- `splitSaleVatLines(total, vatAmount)` (exported, pure) → `{total:round2(total), vat:round2(vatAmount), subtotal:round2(total-vat)}` → Dr(total)===Cr(subtotal+vat) ภายใน satang เสมอ (residual เศษเข้า revenue line)
- VAT-split block ใช้ helper: Dr `v.total` / Cr revenue `v.subtotal` / Cr 2170 `v.vat` (เลิกเชื่อ sale.subtotal_before_vat)

**Behavior preserved:** path ไม่มี VAT (2-line Dr=Cr=amount) เดิม · refund/expense/payroll/service/delivery (2-line) ไม่แตะ · COA mapping/formula ไม่เปลี่ยน · balance guard คงอยู่ · ไม่มี SQL

**Gate:** lint 0 · unit 863 (+7 auto_post.test.js: inclusive/exclusive/drift/edge/2-line/refund-regression) · e2e 11 · build 333→334

---

## 🛠️ Phase 92.63 — Finance Audit Quick Wins (#5 XSS / #6b TZ / #8 log)

**สิ่งที่ทำ:**
- **#5 (security)** `modules/profit_report.js` — import `escHtml`; wrap `${escHtml(p.productName)}` (ตารางสินค้า) + `${escHtml(c.category)}` (ตารางค่าใช้จ่าย) → ปิด stored-XSS จากชื่อสินค้า/หมวดที่มาจาก DB
- **#6b (TZ)** profit_report default range → `addDaysBkk(-30)`/`todayBkk()` (ถอด `formatDateForInput` local-TZ); `modules/profit_by_product.js` cutoff (30d/เดือน/ปี) → `todayBkk()`/`addDaysBkk()` แทน `toISOString()` UTC
- **#8 (audit)** `modules/payroll.js` — catch ของ `_createSalaryExpense` + `postJournalForPayroll` เพิ่ม `logActivity('payroll_expense_failed'/'payroll_journal_failed', {error, paid_at, method, employee_id})` (best-effort) → failed money side-effect ตามรอยใน audit log ได้

**Behavior preserved:** ไม่แตะ money math/formula · profit_report month-bucketing (saleDate.getMonth() local) ยังคงเดิม (ICT device ถูกต้อง — residual ความเสี่ยงต่ำ) · ไม่มี schema change

**Gate:** lint 0 · unit 856 (+4 `finance_audit_92_63.test.js`) · e2e build-sync 333 · build 332→333

---

## 🛠️ Phase 92.62 — Recurring Expense: JV + Idempotency + TZ (audit #2/#3/#6)

**สิ่งที่ทำ (modules/recurring_expenses.js):**
- **#2 JV:** `import postJournalForExpense` · `_createExpenseFromRecurring` เปลี่ยน insert เป็น `return=representation` → เรียก `postJournalForExpense(inserted)` (fire-and-forget เหมือน expenses.js) → รายจ่ายประจำเข้าสมุดบัญชีคู่
- **#3 idempotency:** `recurringExpenseTag(id, periodKey)` (exported) = `#recur-{id}-{next_due||today}` ใส่ใน note · `_recurringExpenseExists()` pre-check (note ilike) ก่อน insert → ถ้ามีแล้ว skip insert แต่ยัง advance next_due (recover) · `_reGenBusy` in-flight guard กัน double-click race · generateOne/All คืน "exists" เพื่อ toast แยก
- **#6 TZ:** `todayBkk()` แทน UTC `toISOString().slice(0,10)` ทุกจุด (expense_date/overdue filter/form default) · `_calcNextDue` (exported) เขียนใหม่เป็น **pure integer/UTC math** (split YYYY-MM-DD → คำนวณ) deterministic ไม่ขึ้น runtime TZ; monthly clamp วัน ≤28

**Behavior preserved:** generate flow เดิม (ปุ่ม 💸 สร้าง / สร้างทั้งหมด) · ไม่แตะ schema · expenses ปกติ/payroll JV เดิมไม่กระทบ

**Gate:** lint 0 · unit 852 (+9 `recurring_expenses.test.js`) · e2e build-sync 332 · build 331→332

---

## 🛠️ Phase 92.61 — Refund Over-/Double-Refund Cap (this session, audit fix #1)

**บริบท:** audit หน้าการเงินเจอ — refund modal ตั้ง `max_qty = sale_items.qty` ทุกครั้ง ไม่หักของที่คืนไปแล้ว → เปิดคืนเต็มบิลซ้ำได้ → เงิน+สต็อก+JE รั่ว (loyalty กันแล้ว แต่ amount/stock/JV ไม่กัน)

**สิ่งที่ทำ (modules/refunds.js):**
- `computeRefundableItems(saleItems, priorRefunds)` (exported, pure) → `max_qty = qty เดิม − Σ qty ที่คืนแล้ว`; จับคู่ด้วย `product_id` (fallback ชื่อ ถ้า id null), parse `items_json` ได้ทั้ง object + JSON string, cap `refundedQty` ไม่เกิน qty เดิม (max_qty ไม่ติดลบ)
- `validateRefundWithinRemaining(itemsToRefund, saleItems, priorRefunds)` (exported, pure) → guard ตอน save
- `_fetchRefundsForSale(saleId)` → GET refunds เดิมของบิล (`sale_id=eq.`)
- sale-select handler (async): fetch prior → `computeRefundableItems` → renderItems แสดง "คืนแล้ว N / ครบ" + disable ช่องคืนครบ + ปิดปุ่มถ้าคืนครบทั้งบิล
- save handler: re-fetch + `validateRefundWithinRemaining` ก่อน insert → block + toast ถ้าเกิน (กัน race / modal ค้าง)

**Behavior preserved:** flow refund ปกติ (เลือกบิล→เลือกจำนวน→คืน) เหมือนเดิม · loyalty/stock/JV reversal เดิมไม่แตะ · ไม่มี schema change

**Gate:** lint 0 · unit 843 (+11 `refunds_cap.test.js`) · e2e build-sync 331 · build 330→331

**✅ server-side guard (92.61b):** เพิ่มไฟล์ `supabase-phase92-61b-refund-guard.sql` แล้ว — BEFORE INSERT trigger `trg_guard_refunds_insert` + function `_guard_refunds_insert()` บน `refunds`: รวม qty ใหม่ (NEW.items_json) + ที่คืนแล้ว (refunds เดิม sale_id เดียวกัน) เทียบ sale_items ต่อ product_id → เกิน = RAISE EXCEPTION (ERRCODE 23514). ทุก role, SECURITY INVOKER (auth_all read policies พอ), NOTIFY pgrst reload, rerun-safe. ตรวจเฉพาะ product_id != null (custom item ปล่อย — client จับคู่ชื่อให้).
> **✅ APPLIED:** gangboo รัน `supabase-phase92-61b-refund-guard.sql` ใน Supabase SQL Editor แล้ว (2026-06-01) → trigger `trg_guard_refunds_insert` live ใน DB · refund over/double-refund ถูกกันทั้ง client (92.61) + server (92.61b) แล้ว · (ตรวจ DDL ฝั่ง Claude ไม่ได้เพราะ anon creds — อิง user confirm + VERIFY queries)

---

## 🛠️ Phase 92.60 — HR Overview Premium UI/UX (prev session)

**เป้าหมาย:** ทำหน้า HR ให้ "ดูหรู ดูแพง" ตามที่ user ขอ — visual refresh ล้วน

**สิ่งที่ทำ (modules/hr_overview.js, CSS only):**
- `.hr-page` page gradient background + font-smoothing (เพิ่ม class ที่ root wrapper)
- KPI cards + section panels ทุกใบ: border `#eceff6` + layered shadow + radius 16px (replace_all `border:1px solid #e2e8f0;border-radius:14px`)
- `.hrx-hero` gradient surface + `.hrx-hero h2` gradient-clip title + `.hrx-eyebrow` pill + benefits chips โค้งมน
- `.hrx-toolbar` navy→indigo gradient + glassy chips (backdrop-blur)
- `.hrx-mini-card`/`.hrx-panel` premium + hover lift; `.hrx-mini-icon` radius 13
- bar/donut/vbar gradients → indigo→violet (#4f46e5→#7c3aed); `.hrx-info-card` refined
- KPI hover lift แรงขึ้น + focus ring indigo

**Behavior preserved:** โครงสร้าง HTML/คลาส/logic เดิมทั้งหมด · ไม่แตะ data fetch/SQL/RLS/payroll · unit 837 ผ่านเท่าเดิม (ไม่มี test ใหม่ — visual)

**Gate:** lint 0 · unit 837 · e2e build-sync 330 · build 329→330 (rebased บน Codex 92.59/329)

---

## 🛠️ Phase 92.57 — Export PDF / พิมพ์รายงาน HR (this session)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildHrReportPrintHtml({from, to, employeeRows, empTotals, deptRows, deptTotals, storeName, generatedAt})` (exported, pure) → standalone HTML doc + print CSS + `<body onload="window.print()">`; `escHtml` ทุกค่า (กัน XSS)
  - ปุ่ม "🖨️ พิมพ์ / PDF" ในรายงาน HR → `window.open("","_blank")` + `document.write(html)` + `close()`/`focus()` (auto-print); guard popup-blocked → toast
- **No dependency** — browser-native print, user เลือก "Save as PDF" เองได้ (เลี่ยง jsPDF/dep ตาม CLAUDE.md)

**Gate:** lint 0 · unit 837 (+3) · e2e build-sync 327 · build 326→327

---

## 🛠️ Phase 92.56 — รายงานระดับแผนก (this session)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildDepartmentReport(rows)` (exported, pure) → group per-employee report rows (จาก `buildMonthlyHrReport`) ตาม `department` → `{rows:[{department, headcount, daysWorked, regularHours, otHours, lateCount, earlyLeaveCount, leaveDays}], totals}` · sort headcount desc · bucket "—" สำหรับไม่ระบุแผนก
  - render ตาราง "🏢 สรุปตามแผนก" ใน `_renderMonthlyHrReport` (ใต้ตาราง per-employee, ใช้ `report.rows` เดียวกัน → อัปเดตตาม date-range อัตโนมัติ) + ปุ่ม `hrDeptReportExportBtn` → `hr_dept_report_<from>_<to>.xlsx` (bind ใน `_bindReport`)

**Behavior preserved:** ไม่ fetch เพิ่ม (aggregate client-side) · per-employee report/date-range/timesheet เดิมไม่เปลี่ยน

**Gate:** lint 0 · unit 834 (+3) · e2e build-sync 326 · build 325→326

---

## 🛠️ Phase 92.55 — Timesheet รายคน (this session)

**เป้าหมาย:** ดูตารางเวลารายวันของพนักงาน 1 คน (drill-down)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildEmployeeTimesheet({rows, fromDate, toDate, shiftOpts, attendanceRules})` (exported, pure) → `{days[], totals}` · iterate ทุกวันในช่วง, group attendance ตาม work_date, 1 แถว/วัน (เข้าเร็วสุด/ออกช้าสุด/รวม regular+OT ทุก session/punctuality บน synthesized day row/notes รวม) · วันไม่มีบันทึก = `hasData:false`
  - tab "🗓️ Timesheet" ใน employee modal (MODAL_TABS + modalTabFor + _renderTabTimesheet + _renderModalBody case) · lazy-fetch เดือนปัจจุบัน (`${monthKey}-01`..today) ผ่าน `_fetchUserAttendanceRange` + `timesheetCache` (mirror week-tab pattern)

**Behavior preserved:** ไม่แตะ payroll/leave/accounting · reuse `_fetchUserAttendanceRange` เดิม (limit 200 พอสำหรับ 1 เดือน) · week/payroll tab เดิมไม่เปลี่ยน

**Gate:** lint 0 · unit 831 (+4) · e2e build-sync 325 · build 324→325

---

## 🛠️ Phase 92.54 — HR Report Date-Range Picker + Re-fetch (this session)

**เป้าหมาย:** ต่อยอด 92.53 ให้ผู้ใช้เลือกช่วงวันที่เองได้ (ไม่จำกัดเดือนปัจจุบัน)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `_fetchReportRange(from, to)` — ดึง `staff_attendance` (work_date gte/lte) + `staff_leaves` (start_date gte/lte) เฉพาะช่วง (staff_leaves graceful)
  - `_renderMonthlyHrReport(report, {from, to, loading})` — เพิ่ม date inputs (`hrReportFrom`/`hrReportTo`) + ปุ่มค้นหา (`hrReportSearchBtn`) + loading state; export ปุ่ม disabled ตอน loading/ว่าง
  - closure ใน `renderHrOverviewPage`: `reportFrom`/`reportTo` (default = เดือนปัจจุบัน 1st..สิ้นเดือน, ใช้ data ที่โหลดแล้ว), `_renderReportSection(loading)` + `_bindReport()` → ค้นหา = fetch ช่วง → rebuild `buildMonthlyHrReport` → re-render เฉพาะ `#hrReportSection` + rebind
  - Export filename = `hr_report_<from>_<to>.xlsx`; validate from ≤ to
- **ไม่ refetch ทั้งหน้า** — profiles/departments ใช้ใน memory (data.profiles, deptNameById)

**Gate:** lint 0 · unit 827 · e2e build-sync 324 · build 323→324

---

## 🛠️ Phase 92.53 — Monthly HR Report (prev session)

**เป้าหมาย:** รายงาน HR รายเดือน รวมต่อพนักงาน (user เลือก option A) — ตารางสรุป 1 แถว/คน + Excel export

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildMonthlyHrReport({profiles, attendanceMonth, leaves, shiftOpts, attendanceRules, deptNameById})` (exported, pure) → `{rows[], totals}` · per-row: daysWorked (distinct work_date), regularHours/otHours (`sumRegularOT`), lateCount/lateMinutes + earlyLeaveCount/earlyLeaveMinutes (`summarizePunctuality`), leaveDays (staff_leaves status=approved)
  - `_renderMonthlyHrReport(report, monthTh)` — section ใหม่ใต้ตารางสถานะวันนี้ (เหนือ Quick actions) + tfoot totals + ปุ่ม `hrReportExportBtn`
  - Export Excel `hr_report_<monthKey>.xlsx` (11 คอลัมน์)
- ใช้เดือนปัจจุบัน (monthKey เดียวกับ dashboard) — ไม่มี date-picker/fetch เพิ่ม (v1)

**Behavior preserved:** ไม่แตะ payroll/leave calc/accounting/RLS · ไม่ fetch เพิ่ม (reuse `data.attendanceMonth`/`data.leaves`/`data.profiles`)

**Gate:** lint 0 · unit 826 (+8) · e2e build-sync 323 · build 322→323

---

## 🛠️ Phase 92.52 — HR Attendance Exception Follow-ups (prev session)

**เป้าหมาย:** ต่อยอด punctuality (92.49) ครบ 5 จุดที่ user สั่ง "ทำทั้งหมด"

**สิ่งที่ทำ:**
- `modules/time_clock.js`:
  - `summarizePunctuality(rows, shift, opts)` (exported, pure) → `{total, onTime, late, earlyLeave, lateAndEarly, missingClockOut, none, totalLateMinutes, totalEarlyLeaveMinutes}`
  - Manager report: summary line "ความตรงต่อเวลา (ช่วงนี้)" + Excel export +3 คอลัมน์ (สถานะตรงเวลา/นาทีสาย/นาทีออกก่อน)
  - Self-view (พนักงาน): chip punctuality ในประวัติ 7 วัน
- `modules/hr_overview.js`:
  - HR export +3 คอลัมน์ punctuality
  - `buildHrDashboardMetrics` รับ `shiftOpts`+`attendanceRules` (additive) → คำนวณ `monthlyPunctuality {lateOccurrences, frequentLateCount(≥3), topLate[5]}` จาก `attendanceMonth`; render `_hrDashTopLate` ใน panel "พนักงานมาสายบ่อย (เดือนนี้)"
- `modules/settings/store.js`: import `logActivity` จาก `../utils.js`; เมื่อ grace/กะ เปลี่ยน → `logActivity('attendance_rules_update', {before, after})` best-effort (ไม่ทำให้ save fail)

**Behavior preserved:** `buildHrDashboardMetrics` ถ้าไม่ส่ง shiftOpts+rules → `monthlyPunctuality` ว่าง (test เดิมไม่พัง) · ไม่แตะ payroll/OT/leave/accounting/JE RLS · clock-in/out เดิม

**Gate:** lint 0 · unit 818 (+12) · e2e build-sync 322 · build 321→322 (index.html ×4 + sw.js) · rebased บน Codex Period Close (92.51/321)

---

## 🛠️ Phase 92.50 — HR Executive Dashboard Detail View (this session)

**เป้าหมาย:** ยกระดับหน้า HR Overview ให้มี dashboard รายละเอียดครบตามภาพตัวอย่าง โดยยังคงตาราง/alert/quick actions เดิมไว้ด้านล่าง

**สิ่งที่ทำ:**
- `modules/hr_overview.js` — เพิ่ม `buildHrDashboardMetrics()` สำหรับรวม KPI แบบ read-only จาก profiles/departments/staff_attendance/staff_payroll/staff_leaves
- เพิ่ม section dashboard ใหม่: hero + benefits, context filter strip, KPI cards, chart แยกแผนก, donut แยกตำแหน่ง, สถานะลงเวลาวันนี้, แนวโน้มลงเวลา 8 วันล่าสุด, สรุปวันลา, ตารางสัญญา/ทดลองงานใกล้ครบ และ info cards แหล่งข้อมูล
- `_fetchHrData()` fetch `staff_leaves` แบบ graceful; ถ้า RLS/table มีปัญหา dashboard ยังไม่ crash และมี warning banner เหมือนตารางอื่น
- `tests/hr_overview.test.js` — เพิ่ม coverage สำหรับ `buildHrDashboardMetrics`
- `index.html`/`sw.js` — bump build 319→320

**ไม่แตะ:** SQL/RLS/schema, payroll calculation, accounting, JE, Time Clock write flow

---

## 🛠️ Phase 92.49 — HR Late / Attendance Exception Rules (this session)

**เป้าหมาย:** ใช้ข้อมูล Time Clock + กะ ที่มีอยู่ → ตีสถานะ "มาสาย / ออกก่อนเวลา" ให้ HR เห็นชัด (informational, ไม่ block)

**สิ่งที่ทำ:**
- `modules/time_clock.js` — pure helpers ใหม่ (exported):
  - `classifyPunctuality(row, shift, opts)` → `{status, lateMinutes, earlyLeaveMinutes}` · status = `on_time`|`late`|`early_leave`|`late_and_early_leave`|`missing_clock_out`|`none` · เทียบ clock_in/out กับเวลาเริ่ม/เลิกกะ บน Asia/Bangkok (ใช้ `_bangkokDateAtHour` เดิม ไม่ใช่ UTC toISOString) · lateMinutes/earlyLeaveMinutes คืนค่าดิบเสมอ, grace ตัดสินแค่ status
  - `attendanceRulesFromState(state)` → `{lateGraceMinutes, earlyLeaveGraceMinutes}` default 15/15 จาก `storeInfo` (pattern เดียวกับ `shiftHoursFromState`/geofence)
  - `punctualityChipMeta(punc)` → label ภาษาไทย + สี (null ถ้า none)
  - manager report row เพิ่ม chip (ใต้ชื่อ user) — ไม่เพิ่มคอลัมน์ (colspan เดิม)
- `modules/hr_overview.js` — import 3 helper ข้างบน · rows มี field `punc` · `_renderTbody` chip ใต้ status chip · drill-down modal header แสดง chip (`buildEmployeeModalSummary.punctuality`) · `detectExceptions` รับ `shiftOpts`+`attendanceRules` → push alert รวม `late_arrivals`/`early_leaves` (นับเป็นจำนวนคน, dedupe ตาม user; late นับจาก `lateMinutes > grace` รวม missing_clock_out) · `alertActionFor` map 2 kind ใหม่ → route `time_clock`
- `modules/settings/store.js` — เพิ่มช่อง "ผ่อนผันเข้าสาย/ออกก่อน (นาที)" ใน section กะ · validate >= 0 (clamp 0–240, default 15) · save เข้า storeInfo

**Behavior preserved:** `detectExceptions` ถ้าไม่ส่ง `shiftOpts`+`attendanceRules` → ไม่มี late/early (test เดิมไม่พัง) · ไม่แตะ payroll/OT/leave/accounting/JE RLS · clock-in/out flow เดิมไม่เปลี่ยน

**Gate:** lint 0 errors · unit 809 ผ่าน (+18 time_clock, +7 hr_overview) · e2e 11 ผ่าน (build-sync smoke เขียว) · build 318→319 (index.html ×4 ?v + data-app-build, sw.js cache-v319 + marker)

---

## 🛠️ Phase 92.48 — Accounting Integrity Status Panel (this session)

**บริบท:**
Audit (dry-run `backfill_orphan_journals.js`) ยืนยัน orphan ที่เหลือ = test data ทั้งหมด → **actionable จริง = 0**:
- Sales 85 = 84 เม.ย. (ก่อน 2026-05-01) + 1 พ.ค. (฿0) · Expenses 1 = เม.ย. ฿1,000 · Payroll 0

แต่ `accounting_integrity_summary()` RPC คืน **raw count = 85** → ถ้าโชว์ดิบ ๆ admin จะตกใจทั้งที่ไม่มีรายการจริงค้าง

**สิ่งที่ทำ:**
- `modules/accounting/backfill.js` — เพิ่มการ์ด integrity ด้านบน (host เดิม ไม่เพิ่ม route/menu): RPC summary → ดึง `vw_*_without_journal` ids → fetch row (date+amount) → `_classifyOrphan` แยก actionable/skipped → 🟢/🔴/🟡
- `_classifyOrphan(cat, row)` (exported) — **mirror auto_post เป๊ะ**: `import { _isAfterEffective }` + `dateBkk`; pre-effective หรือ amount<=0 = skipped, else actionable (ไม่ duplicate logic = กัน drift)
- field ต่อ source ตรง auto_post: sales=`created_at`/`total_amount??grand_total` · expenses=`expense_date`/`amount` · payroll=`paid_at`/`total_amount`

**Approach:** client-side bucketing (option B) — **ไม่แตะ SQL** (ใช้ RPC/views ของ 92.46) → ไม่ต้อง apply อะไรใน Supabase

**Gate:** +8 `tests/accounting_integrity_panel.test.js` (node --test ผ่าน) · eslint clean (0/0) · build 316→317 (backfill.js = lazy module)

**Hotfix (build 318):** orphan fetch เปลี่ยนเป็น `select=*` — เดิม sales select ระบุ `grand_total` (sales ไม่มีคอลัมน์นี้ มีแต่ quotations/receipts) → PostgREST 400 → การ์ดขึ้น 🟡 "85 classify ไม่ได้". เจอจาก **user eyeball** (unit test mock row ตรง ๆ เลยไม่จับ select-column bug = integration gap). `select=*` พิสูจน์แล้วใช้ได้ (dry-run backfill ใช้ pattern เดียวกันสำเร็จ)

**ยังไม่ทำ (ถ้าต่อ):** ปุ่ม backfill ในตัวการ์ด (ตอนนี้ชี้ไปเครื่องมือเดิมด้านล่าง) · Phase 92.49 Month Close checklist

---

## 🛠️ Phase 92.47 — Orphan Journal Backfill Tool (previous session)

**บริบท:**
หลัง Phase 92.46 apply (RLS re-apply + integrity views), audit พบ orphans สะสม:
- 107 sales ไม่มี JV (เม.ย. 84, พ.ค. 23)
- 3 expenses ไม่มี JV (เม.ย. 1, พ.ค. 2)
- 0 payroll orphans (Phase 92.44 wire ใหม่ ครอบทัน)

→ Root cause: RLS bug ที่ Phase 92.46 เพิ่งปิด — sales role ถูก deny insert journal_entries
→ 92.46 ปิด root cause แล้ว แต่ orphan ในอดีตยังต้อง backfill

**ขอบเขตจริง (หลัง pre-effective filter):**
- เม.ย. 2026 (84+1 = 85 rows) → **intentional skip** (ก่อน `ACCOUNTING_EFFECTIVE_DATE=2026-05-01` = test data)
- พ.ค. 2026 (23+2 = 25 rows) → **real backfill targets**

### สิ่งที่ทำ

**1) `scripts/backfill_orphan_journals.js` — Node script**

Strategy: **window shim + reuse `auto_post.js` logic** (ไม่ replicate กัน drift)

```js
// Set up before import — auto_post.js ใช้ window globals ตอนรัน
globalThis.window = {
  SUPABASE_CONFIG: { url, anonKey },
  _sbAccessToken: admin.token,
  showToast: (m) => console.log("  [toast]", m),
};

// Dynamic import (ต้องหลัง shim)
const { postJournalForSale, postJournalForExpense, resetMappingCache } =
  await import(pathToFileURL(autoPostPath).href);
resetMappingCache(); // ใช้ admin token fetch mappings ใหม่
```

Flow:
1. Auth admin (ใช้ `.env` เดียวกับ verify scripts — ADMIN_EMAIL/ADMIN_PASSWORD)
2. Before snapshot: `SELECT public.accounting_integrity_summary()`
3. Sales loop: `vw_sales_without_journal` → fetch full row → `postJournalForSale(row)`
4. Expenses loop: เช่นเดียวกัน
5. After snapshot + diff print
6. Summary: posted / skipped (pre-effective + duplicate) / failed counts

Flags:
- `--dry-run` → preview (ไม่ insert) — print "WOULD post" + date/amount
- `--sales-only` / `--expenses-only` → scope filter

Exit codes:
- 0 = success (รวมกรณี 0 orphans ตอนเริ่ม)
- 1 = some rows failed
- 2 = fatal (auth/network/import/env error)

**2) npm script entry**

```json
"backfill:orphans": "node scripts/backfill_orphan_journals.js"
```

**3) Test +19** (`tests/backfill_orphan_journals.test.js`)

Pure helpers:
- `summarizeResults` (empty / mixed / dry-run / unknown status) ×4
- `formatSummaryLine` (all counts / zero counts) ×2

Source-level guards:
- `pathToFileURL` ใช้ (Windows-safe import URL)
- Window shim มา BEFORE `auto_post` import (order critical)
- Shim has `SUPABASE_CONFIG` + `_sbAccessToken` (used by `_authFetch` fallback)
- `resetMappingCache()` ถูกเรียก (กัน stale anon mappings)
- `--dry-run` / `--sales-only` / `--expenses-only` flags supported
- Imports `postJournalForSale` + `postJournalForExpense` (ไม่ replicate)
- View names ตรงกับ Phase 92.46 SQL (`vw_sales_without_journal` etc.)
- `getIntegritySummary` เรียก ≥2 ครั้ง (before + after snapshot)
- Exit codes 0/1/2 ครบ
- `main()` guarded ด้วย `import.meta.url === pathToFileURL(process.argv[1])` (test import ไม่ trigger network)
- README mentions `ACCOUNTING_EFFECTIVE_DATE` / pre-effective skip (anti-surprise)
- `package.json` register `backfill:orphans` correctly

Unit total: **758 → 777** (+19)

### ไม่แตะ
- `auto_post.js` (zero risk to existing browser flow)
- SQL schema (ใช้ views + RPC ของ 92.46)
- Client UI (script-only — Phase 92.48 จะทำ dashboard UI ถ้า user อยาก permanent tool)
- Effective date logic (ยอมรับ April skip — เป็น intentional design)

### Action required (user)
1. ตรวจ `.env` มี `ADMIN_EMAIL` + `ADMIN_PASSWORD` (role='admin')
2. **DRY-RUN ก่อน:** `npm run backfill:orphans -- --dry-run`
   - ดู list orphans + date + amount — verify scope ตามคาด
   - Expected: ~25 "WOULD post" + ~85 "skipped pre-effective" (auto_post จะ filter)
3. **LIVE:** `npm run backfill:orphans`
   - ใช้เวลา ~30-60 วินาที (110 HTTP calls)
   - Expected: 23-25 posted + 85 skipped pre-effective + 0 failed
4. Verify: `SELECT public.accounting_integrity_summary();` — ควรเห็น sales/expenses orphans ลดลงเหลือ 85+1=86 (พ.ค. เคลียร์, เม.ย. คงไว้เพราะ pre-effective)
5. หน้า "บัญชี > สมุดรายวัน" filter `doc_type=SV` — เห็น JV ของ sale พ.ค. 2026 ครบ

### Gates ✅
- `npm run lint:errors` exit 0
- `npm test` = **777/777** (was 758 + 19 new = correct)
- `npm run test:e2e` ไม่กระทบ (script ไม่เกี่ยว e2e)
- `npm audit --audit-level=moderate` = 0 vulnerabilities

**Build:** 315 (no bump — script-only, no client/SW change)

---

## 🔒 Phase 92.45 — Leave SQL/RLS Hardening + Audit Enforcement

**บริบท / S3 ที่ปิด:**
audit เดิมพบช่องโหว่ "non-admin spoof reviewer fields" — RLS Phase 92.32 เช็คแค่ `status='pending'` + `user_id=auth.uid()` แต่ไม่ได้ lock column `reviewed_by/_at/_note` → non-admin POST/PATCH `{user_id:self, status:'pending', reviewed_by:'<spoofed-admin-uuid>', reviewed_at:'now'}` ผ่าน RLS เดิมได้

นอกจากนั้น `_doReview` เดิม set `reviewed_by: currentUserId` + `reviewed_at: new Date().toISOString()` ฝั่ง client → spoofable + clock-skew prone

### สิ่งที่ทำ

**1) SQL trigger + RPC ([`supabase-phase92-45-leave-hardening.sql`](supabase-phase92-45-leave-hardening.sql))**

- **BEFORE INSERT trigger `_guard_staff_leaves_insert`** — non-admin: force `user_id=auth.uid()`, `status='pending'`, `reviewed_by/_at/_note=NULL`, `created_by=auth.uid()` (silent strip — ไม่ throw เพื่อ UX ไม่พัง)
- **BEFORE UPDATE trigger `_guard_staff_leaves_update`**:
  - non-admin: preserve OLD `user_id/leave_type/created_by/reviewed_by/_at/_note` + RAISE EXCEPTION ถ้า `NEW.status NOT IN ('pending','cancelled')` หรือ `OLD.status IN ('approved','rejected','cancelled')` (ห้ามแก้ row terminal)
  - admin: ตอน `status` เปลี่ยนเป็น approved/rejected → auto `NEW.reviewed_by=auth.uid()` + `NEW.reviewed_at=now()`; ตอน revert ไป pending/cancelled → ล้าง reviewer trail
- **RPC `public.review_staff_leave(p_leave_id, p_status, p_note)`** — SECURITY INVOKER + admin guard (`is_accountant()`) + status whitelist (`approved/rejected/cancelled`) + คืน updated `jsonb` row → trigger จัดการ reviewer ให้เอง
- **GRANT EXECUTE TO authenticated** + `NOTIFY pgrst 'reload schema'` + 5 VERIFY queries
- Rerun-safe: `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` / `DROP FUNCTION IF EXISTS`

**2) Client hardening ([`modules/leave_management.js`](modules/leave_management.js))**

- เพิ่ม helper `_callReviewRpc(leaveId, status, note)` → POST `/rest/v1/rpc/review_staff_leave` body `{p_leave_id, p_status, p_note}`
- `_doReview` switch: เลิกส่ง `reviewed_by/_at` จาก client → เรียก `_callReviewRpc` → audit metadata `after.reviewed_*` อ่านจาก RPC response (server-trusted)
- Form submit branches:
  - `existing && existing.id != null` → **EDIT path**: `_patchLeave(existing.id, {leave_type, start_date, end_date, days_count, reason})` (safe fields whitelist — ไม่ส่ง status/reviewed_*/user_id/created_by) + `leave_update` audit (before/after diff)
  - ไม่มี existing → **CREATE path**: `_insertLeave(body)` + `leave_create` audit (key fields)
- เดิม edit submit ก็เรียก `_insertLeave` (สร้าง row ใหม่แทน update) → bug แอบฟ้องไม่เคยเจอ — แก้ในเฟสนี้

**3) Audit log (utils.js `logActivity`)**

ครอบ leave actions ครบ 6 ตัว:
- `leave_create` (ใหม่ — เฟสนี้)
- `leave_update` (ใหม่ — เฟสนี้)
- `leave_approve` / `leave_reject` (เดิม Phase 92.43 B4)
- `leave_cancel` / `leave_delete` (เดิม Phase 92.43 B4)

Metadata: `before/after`, `leave_type`, `days_count`, `reviewed_by/_at` (จาก RPC response)

### Re-uses (ไม่สร้างใหม่)

- RLS policies เดิม Phase 92.32 ทั้ง 4 ตัว (`leaves_select_admin_or_self` / `leaves_insert_admin_or_self_pending` / `leaves_update_admin_or_self_pending` / `leaves_delete_admin`) — trigger เป็น defense-in-depth ทับ
- `is_accountant()` helper (Phase 88) สำหรับ guard ทั้ง trigger + RPC
- `logActivity` (Phase 57) สำหรับ audit log
- `_patchLeave` / `_insertLeave` helper เดิม
- `_runPopoverAction` wrapper สำหรับ error UX (popover stays open on RPC fail)
- Form modal layout + quota warning (Phase 92.35)

### Tests +8 source-level

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `_callReviewRpc` signature + endpoint `/rpc/review_staff_leave` + payload shape
- `_doReview` ใช้ `_callReviewRpc` แทน `_patchLeave` + ไม่ส่ง `reviewed_by: currentUserId` / `reviewed_at: new Date()...` (regression guard)
- audit metadata `after.reviewed_*` อ่านจาก `updatedRow?.reviewed_*` (RPC response)
- Form submit branch on `existing.id` → `_patchLeave` vs `_insertLeave`
- Edit PATCH body safe-fields whitelist (ห้ามมี `status/reviewed_*/user_id/created_by`)
- `leave_create` audit ใน insert path success + metadata keys ครบ
- `leave_update` audit ใน edit path success + before/after diff
- SQL file `supabase-phase92-45-leave-hardening.sql` มี trigger functions + bindings + RPC + GRANT + NOTIFY

Unit **752 → 760** (+8)

### Gates ✅

- `npm run lint:errors` exit 0
- `npm test` = **760/760**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items ครบ)

- `package.json`: 5.63.1 → **5.64.0** (security minor)
- `index.html`: `?v=314→315` × 4 src (style.css/selfheal.js/main.js/boot.js) + `data-app-build="315"` + `data-app-version="5.64.0"`
- `sw.js`: `cache-v314→v315` + comment v315

### Manual smoke (โปรดทำหลัง deploy)

**1. รัน SQL ก่อน** — Supabase Dashboard → SQL Editor → paste `supabase-phase92-45-leave-hardening.sql` → Run → ตรวจ VERIFY queries ที่ท้ายไฟล์
- (a) Triggers — Expected: 3 ตัว (`trg_staff_leaves_updated_at` + `trg_staff_leaves_guard_insert` + `trg_staff_leaves_guard_update`)
- (b) Functions — Expected: `_bump_staff_leaves_updated_at` + `_guard_staff_leaves_insert` + `_guard_staff_leaves_update` + `review_staff_leave`
- (c) RPC grant — Expected: `review_staff_leave` มี EXECUTE สำหรับ `authenticated`
- (d) RLS policies เดิม — Expected: 4 ตัว (ไม่ถูกแตะ)

**2. Production Ctrl+Shift+R → APP_BUILD=315**

**3. Login admin:**
- สร้าง leave ให้พนักงาน → approve/reject/cancel ได้ผ่าน RPC (network tab: POST `/rest/v1/rpc/review_staff_leave`)
- ตรวจ `audit_log` table — มี action `leave_create/leave_update/leave_approve/leave_reject/leave_cancel/leave_delete` ครบ
- หลัง approve → `reviewed_by` = admin uuid, `reviewed_at` = server timestamp (ไม่ใช่ client clock)

**4. Login sales/technician:**
- สร้าง leave ของตัวเอง → status='pending' (trigger บังคับ)
- ไม่เห็นปุ่ม approve/reject ของคนอื่น (UI guard)
- **เทส spoof:** เปิด DevTools console → ลอง:
  ```js
  // pretend non-admin POST + spoof reviewer
  fetch(window.SUPABASE_CONFIG.url + "/rest/v1/staff_leaves", {
    method: "POST",
    headers: { apikey: window.SUPABASE_CONFIG.anonKey,
               Authorization: "Bearer " + window._sbAccessToken,
               "Content-Type":"application/json",
               Prefer:"return=representation" },
    body: JSON.stringify({
      user_id: "OTHER_USER_UUID",  // not self
      leave_type: "vacation",
      start_date: "2026-06-01", end_date: "2026-06-01", days_count: 1,
      status: "approved",           // spoof
      reviewed_by: "FAKE_ADMIN_UUID", reviewed_at: "2026-06-01T00:00:00Z"
    })
  }).then(r=>r.json()).then(console.log);
  ```
  - **ผลที่คาด:** row ถูกสร้าง แต่ DB silently strip → ได้ `user_id=auth.uid()`, `status='pending'`, `reviewed_by=null`, `reviewed_at=null` (RLS เดิม + trigger ทำงานพร้อมกัน — RLS อาจ block ถ้า user_id !== auth.uid())
- ลอง PATCH spoof reviewed_by ของ row ตัวเอง → trigger preserve OLD value (ลอง SELECT แล้ว reviewed_by ยังเป็น NULL)
- ลอง PATCH status='approved' ของ row ตัวเอง → trigger RAISE EXCEPTION 42501

**5. กลับ admin:**
- เห็น pending leave → approve → KPI/Balance/Calendar update ถูก
- approve ผ่าน RPC: ตรวจ network tab POST `/rest/v1/rpc/review_staff_leave` body `{p_leave_id, p_status, p_note}`

**6. Regression:**
- Leave Calendar / Page click-through (92.42) ยังใช้ได้
- Balance/Quota (92.35) ยังนับถูก
- Payroll paid/journal/reverse (92.43–92.44) ไม่กระทบ
- HR Overview pending leave alert ยังขึ้นถูก
- Form edit (existing) → update row จริง (ไม่สร้าง duplicate แล้ว)

> ⚠️ **หมายเหตุ:** sections ด้านล่างนี้สำหรับเฟส 92.41 และก่อนหน้า — เฟส 92.42 (Leave page click-through cards), 92.43 (Payroll/Accounting audit hardening B1-B4), 92.44 (Payroll payment journal visibility) ไม่ได้อัปเดต HANDOFF section แยก ดูรายละเอียดที่ commit message + CHANGELOG.md

---

## ✨ Phase 92.41 — HR Overview Click-through Navigation (older session)

**บริบท:** หน้า HR Overview มี infrastructure click-through อยู่แล้ว (`hr-kpi-card` + `data-hr-action` + delegation + keyboard handler) แต่ใช้กับเฉพาะ Payroll (conditional `unpaid > 0`) + Offline Queue. KPI cards 4 ใบหลัก (พนักงานทั้งหมด/เข้างานวันนี้/ยังไม่ลงเวลาออก/OT) ยังเป็น static — user ไม่มีทาง drill-down ต่อ. งานเฟสนี้ขยายให้ครบทุกใบ + ปรับ a11y/affordance + เพิ่ม "ไป Payroll" ใน employee modal.

### สิ่งที่ทำ

**1) Pure helper ใหม่ `kpiClickRouteFor(kind)`** ([`modules/hr_overview.js`](modules/hr_overview.js))
- คืน route id ตาม kind (testable, no DOM/state):
  - `total_staff` → `departments` (ดูพนักงานรวมตามแผนก)
  - `present_today` → `time_clock` (default = วันนี้)
  - `open_sessions` → `time_clock` (จัดการ session ค้าง)
  - `ot_month` → `payroll_overview` (OT รายเดือน รวมที่นี่)
  - `payroll` → `payroll` (จัดการ row ต่อ)
  - `offline_pending` → `time_clock` (sync queue)
  - unknown → `null`
- Destination pages default = วันนี้/เดือนปัจจุบันอยู่แล้ว → **ไม่ต้องส่ง filter ข้ามหน้า** (lean)

**2) KPI cards 5 ใบหลัก + Offline Queue ใช้ helper**
- เดิม: `clickRoute: payrollClickable` (= `unpaid > 0 ? "payroll" : null`) → unpaid=0 disable เงียบ
- ใหม่: `clickRoute: kpiClickRouteFor(kind)` ทุกใบ → Payroll 0/0 ก็คลิกได้ (drill-down ดีกว่า disable)
- ลบตัวแปร `payrollClickable` ออก (ไม่ใช้แล้ว)

**3) `_kpiCard` a11y + affordance redesign**
- เพิ่ม `aria-label="label — value — sub (เปิดเพื่อจัดการ)"` dynamic เมื่อ clickable
- ใช้ chevron icon `›` (small, color #0284c7) ใน header row แทน text ลอย "คลิกเพื่อจัดการ →" ที่อยู่ท้าย card
- **เหตุผล UX:** เดิม 1 card มี text นั้น 1 ครั้ง — พอ 5 ใบคลิกได้ก็เห็น 5 ครั้ง = noisy. Affordance (cursor + hover + chevron + aria) ก็พอแล้ว
- `role="button"` + `tabindex="0"` ยังคงเดิม → keyboard นาวิเกตได้

**4) Container scope `<style>` ใหม่**
```css
.hr-kpi-card { transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
.hr-kpi-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,.08); border-color: #cbd5e1; }
.hr-kpi-card:focus-visible { outline: 2px solid #0284c7; outline-offset: 2px; }
.hr-row-employee:hover { background-color: #f8fafc; }
.hr-row-employee:focus-within { outline: 2px solid #0284c7; outline-offset: -2px; }
```

**5) Employee drill-down modal footer เพิ่มปุ่ม Payroll**
- เดิม: ปุ่ม "🕒 ไป Time Clock" + "ปิด"
- ใหม่: + "💰 ไป Payroll" (`class="hr-modal-route-btn"` + `data-hr-action="payroll"`)
- ใช้ delegation เดิม (`hr-modal-route-btn` → close modal + `showRoute(route)`)

### Re-uses (ไม่สร้างใหม่)

- `_kpiCard` infrastructure (`data-hr-action`, `hr-kpi-card` class, role/tabindex)
- Container-level event delegation (line 1322 — `closest("[data-hr-action]")` → `showRoute(route)`)
- Keyboard handler สำหรับ KPI cards (line 1359 — Enter/Space)
- Row click delegation (line 1574 — `closest("[data-hr-action]")` early return → กัน row click ชน button)
- Modal route button delegation (line 1550 — close + navigate)
- `alertActionFor` (5 kinds: stale_session/geofence_out/unpaid_payroll/offline_pending/pending_leaves) — ไม่แตะ (ทำงานครบแล้ว)

### Tests +11 source

[`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- `kpiClickRouteFor` 6 tests (total_staff, present_today/open_sessions/offline_pending, ot_month, payroll, unknown→null)
- valid-route sanity (cross-check kpi + alert routes กับ allowlist `time_clock/payroll/payroll_overview/leave_management/departments/audit_log/hr_overview/settings`)
- Source-level 4:
  - KPI 5 ใบหลักทุกใบส่ง `kpiClickRouteFor("kind")` (+ offline_pending conditional)
  - `_kpiCard` มี aria-label dynamic + role=button + tabindex=0 + ไม่มี text "คลิกเพื่อจัดการ →" แล้ว
  - container `<style>` มี `.hr-kpi-card:hover` + `:focus-visible` outline + `.hr-row-employee:hover`
  - modal มีปุ่ม `data-hr-action="payroll"` คู่กับ time_clock (regression guard)
  - row click delegation ยัง skip data-hr-action + button targets

Unit **680 → 691** (+11)

### Gates ✅

- `npm run lint:errors` exit 0
- `npm test` = **691/691**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.5 → **5.62.6** (minor — feature)
- `index.html`: ?v=308→309 ทุก src + `data-app-build="309"` + `data-app-version="5.62.6"`
- `sw.js`: cache v308→v309 + comment v309

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=309
2. เข้าหน้า HR Overview (admin)
3. KPI 5 ใบหลัก — เห็น chevron `›` มุมขวา + cursor pointer + hover lift
4. คลิก "พนักงานทั้งหมด" → ไป `departments`
5. คลิก "เข้างานวันนี้" / "ยังไม่ลงเวลาออก" → ไป `time_clock`
6. คลิก "OT เดือนนี้" → ไป `payroll_overview`
7. คลิก "Payroll เดือนนี้" → ไป `payroll` (แม้ paid=0/0 ก็คลิกได้)
8. Keyboard Tab ไป KPI card → เห็น focus ring ฟ้า → Enter/Space → navigate
9. คลิก row พนักงาน → modal เปิด → footer มี "🕒 ไป Time Clock" + **"💰 ไป Payroll"** + "ปิด"
10. กด "ไป Payroll" → modal ปิด + ไปหน้า payroll
11. Row hover → bg #f8fafc (subtle)
12. Alerts ยังคลิกได้ตามเดิม (unpaid_payroll/pending_leaves/stale_session/geofence_out/offline_pending)

### Regression check ✅

- HR Overview filters (status/dept/role) + cascade rerender เดิม
- Employee modal tabs (วันนี้/7 วันล่าสุด/เงินเดือน) + close (Esc/backdrop/bottom) เดิม
- Row click → modal เดิม (skip button + data-hr-action target)
- Alerts → route mapping เดิม (5 kinds)
- Time Clock responsive ไม่กระทบ
- Leave Calendar / Payroll leave deduction ไม่กระทบ

---

## ✨ Phase 92.40 — Leave Calendar Event Detail Actions Polish

**บริบท:** หลัง 92.39d (build 306) day-list popover visible แล้ว · calendar event detail popover ทำงาน แต่:
- detail ขาด — ไม่มี email, ไม่มีผู้อนุมัติ (name + เวลา)
- ไม่มีทางออกจาก popover ไปดู row เต็มในตาราง
- error UX ไม่ปลอดภัย — `_doReview/_doCancel/_doDelete` close popover **ก่อน** await action → ถ้า fail user เห็นแค่ toast แล้วต้องเปิดใหม่
- action logic ซ้ำใน 3 จุด (table row, popover template, future) — เสี่ยง drift / hard to test

### สิ่งที่ทำ

**1) Pure helper ใหม่ `calendarDetailActionsFor(leave, currentUserId, role)`** ([`modules/leave_management.js`](modules/leave_management.js))
- คืน descriptor array `{kind, label, style}` — single source of truth สำหรับ popover actions
- Reuse `canEditLeave` + `canReviewLeave` (ไม่สร้าง rule ใหม่)
- Matrix:
  - admin + pending → `approve`/`reject`/`edit`/`delete`/`viewInTable`
  - admin + approved|rejected|cancelled → `edit`/`delete`/`viewInTable`
  - non-admin own + pending → `cancel`/`viewInTable`
  - non-admin own + non-pending → `viewInTable` only
  - non-admin OTHER (currentUserId ≠ leave.user_id) → `viewInTable` only

**2) `_renderLeavePopover` เสริม detail copy + driver จาก helper**
- Header: `<div>` email + role ใต้ name (`p?.email` · `p?.role`) ใช้ truncate ellipsis
- Body: บรรทัด "ผู้พิจารณา: ชื่อ · 27 พ.ค. 14:30" (helper ใหม่ `formatReviewedAt(iso)` th-TH short Asia/Bangkok)
- Body: inline error banner `<div id="lmPopError" role="alert">` (hidden by default)
- Actions: loop จาก `calendarDetailActionsFor(...)` → button class `lm-pop-{kind}` (kind viewInTable → `lm-pop-view-in-table`)
- Style mapping: `primary` (green filled) / `danger-outline` (red outline) / `secondary` (slate outline)

**3) Error-stays-open refactor**
- `_doReview`/`_doCancel`/`_doDelete` คืน `{ok:true}` หรือ `{ok:false, error}` แทน void
- `_runPopoverAction(actionFn)` wrapper: busy-guard กัน double-click + await action ก่อน → `_closePopover()` เฉพาะตอน `result.ok`; ถ้า fail (`error` ≠ "ยกเลิก") → `_setPopoverError(msg)` แสดง banner
- showToast ยังเรียกทั้ง flow เดิม (table row delegation ไม่เปลี่ยน) + flow ใหม่ (popover เพิ่ม inline banner)
- **Regression guard test:** ห้ามมี pattern เดิม `_closePopover(); await _doReview` (ปิดก่อน await = bug ที่ phase นี้แก้)

**4) "ดูในตาราง" navigation**
- `_jumpToTableRow(id)`:
  - เช็คว่า row อยู่ใน `filterLeaves(leaves, {month, status, leaveType})` ปัจจุบันหรือไม่
  - ถ้าตก filter → `window.confirm("รายการนี้อยู่นอก filter ปัจจุบัน — ล้าง filter เพื่อแสดง?")` → ตกลง = reset `activeStatus="all"; activeType="all"; activeMonth=row.start_date.slice(0,7)` (re-scope ให้ครอบคลุม row)
  - ถ้า `activeView !== "table"` → set `"table"`
  - `_closePopover()` + `_rerender()` + `setTimeout(scrollAndHighlight, 0)`
- `_scrollAndHighlightRow(id)`:
  - `tbody.querySelector('tr[data-lm-id="..."]')` ใช้ `CSS.escape` กัน injection
  - `scrollIntoView({behavior: "smooth", block: "center"})` + `classList.add("lm-row-highlight")` + setTimeout remove 2.5s
- `_renderTbody`: เพิ่ม `data-lm-id="${escHtml(String(r.id))}"` บน `<tr>` (anchor)
- CSS ใน container scope: `@keyframes lmRowHighlight { 0%/70% bg #fef3c7 → 100% transparent }` + `#lmTbody tr.lm-row-highlight { animation: lmRowHighlight 2.5s ease-out }`

### Re-uses (ไม่สร้างใหม่)

- `canEditLeave` (modules/leave_management.js:151), `canReviewLeave` (:165) — business rule กลาง
- `_rerender()` — central rerender ที่ sync KPI + balance + table + calendar (action handler ไม่ต้องเพิ่ม sync logic)
- `filterLeaves`, `_findLeave`, `_patchLeave`, `_openPopover`, `_closePopover` — pipeline เดิม
- `escHtml`, `profileDisplayName`, `leaveTypeLabel`, `leaveStatusMeta`, `_formatDateRange` — utils

### Tests +21 source

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `calendarDetailActionsFor` 8 tests (null leave, admin pending/approved/rejected/cancelled, non-admin own pending/approved, non-admin OTHER, role variants sales/technician/customer, descriptor shape + uniqueness + viewInTable last)
- `formatReviewedAt` 3 tests (null/empty/undefined, invalid ISO, valid → th-TH short with พ.ค. + 14:30)
- Source-level 10 (popover ใช้ helper + formatReviewedAt + error banner; openLeavePopover bind viewInTable + ใช้ `_runPopoverAction` + ไม่ pre-close ก่อน await; `_runPopoverAction` ปิดเฉพาะ ok + แสดง error fail; `_do*` คืน `{ok, error}`; `_renderTbody` มี data-lm-id; container scope CSS มี keyframes + .lm-row-highlight; `_jumpToTableRow` + `_scrollAndHighlightRow` flow; header แสดง email+role)

Unit **655 → 676** (+21)

### Gates ✅

- `npm run lint:errors` exit 0
- `npm test` = **676/676**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.3 → **5.62.4** (minor — user-facing feature)
- `index.html`: ?v=306→307 ทุก src + `data-app-build="307"` + `data-app-version="5.62.4"`
- `sw.js`: cache v306→v307 + comment v307

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=307
2. Calendar view → คลิก event pending → admin เห็น approve/reject/edit/delete/viewInTable
3. กด approve → prompt note → confirm → popover ปิด + table/KPI/balance refresh
4. คลิก event approved → เห็น email/role ใต้ชื่อ + "ผู้พิจารณา: ชื่อ · เวลา" + ปุ่ม edit/delete/viewInTable
5. กด "📋 ดูในตาราง" → switch view + scroll/highlight row 2.5s
6. ตั้ง filter status=cancelled → คลิก approved event → กด "ดูในตาราง" → confirm prompt → reset filter + jump
7. Non-admin → คลิก own pending → cancel + viewInTable
8. Non-admin → คลิก own approved → viewInTable only (no admin actions)
9. Force fail (offline/RLS deny) → popover ค้าง + error banner ขึ้น + กดใหม่ได้
10. Mobile ≤768px → bottom sheet ไม่ล้น + scroll detail ได้ + email row truncate

### Regression check ✅

- +N day-list popover (build 306) ยังเปิดได้ + chained leave detail
- Esc / backdrop click ปิดได้
- Mobile agenda render เหมือนเดิม
- Edit quota warning exclude current (build 302) ยังถูก
- Payroll leave deduction flow ไม่กระทบ
- Table row approve/reject/cancel/delete flow เดิมยังใช้ได้

---

## 🧯 Phase 92.39d — HOTFIX dense day popover invisible (CSS scope bug)

**บริบท:** หลัง 92.39c (build 305) user smoke test production พบ:
- About = 5.62.2 / build 305 (SW + cache ตรง — ไม่ใช่ stale)
- คลิก "+1 รายการ" ใน Calendar dense day → backdrop/blur เปิดจริง
- **แต่ day-list dialog content invisible** — ดูเหมือนเปิดแค่ overlay เปล่า

92.39c แก้ container layout (flex centered + overflow-y:auto + max-height) — แต่ไม่ใช่ root cause.

### Root cause

```js
// _renderLeavePopover template literal:
return `
  <style>
    .lm-pop-dialog { max-height: ...; flex column; background:#fff; ... }
    .lm-pop-body { flex:1; overflow-y:auto; }
  </style>
  <div id="lmPopBackdrop"></div>
  <div class="lm-pop-dialog">...</div>
`;

// _renderDayListPopover template literal:
return `
  <div id="lmPopBackdrop"></div>
  <div class="lm-pop-dialog">...</div>   // ← ใช้ class แต่ <style> ไม่ inject!
`;
```

- `<style>` block อยู่ใน `_renderLeavePopover` template เท่านั้น
- คลิก chip event → `_openLeavePopover` → render template + inject `<style>` → dialog visible ✓
- คลิก "+N รายการ" → `_openDayListPopover` → render template โดย**ไม่มี `<style>`** → dialog ใช้ browser default → ไม่มี width/background/max-height → **invisible**

### สิ่งที่แก้

**1) ย้าย CSS rules ไปอยู่ใน container scope (shared, render once)**

[`modules/leave_management.js`](modules/leave_management.js) ใน `_rerender`:
```html
<div id="lmPopover" ... ></div>
<style>
  /* Container layout (92.39c) */
  #lmPopover[style*="display:block"] { display: flex !important; ... }

  /* Phase 92.39d: dialog rules ย้ายมาที่นี่ — ใช้ทั้ง 2 popover types */
  .lm-pop-dialog { max-height: calc(100vh - 96px); display:flex; flex-direction:column; ... }
  .lm-pop-dialog > .lm-pop-body { flex:1 1 auto; overflow-y:auto; }
  @media (max-width: 768px) {
    .lm-pop-dialog { position:fixed; bottom:0; ... bottom sheet }
  }
</style>
```

- ลบ `<style>` block ออกจาก `_renderLeavePopover` (CSS ย้ายไป shared scope แล้ว)
- `_renderDayListPopover` ไม่ต้องเพิ่มอะไร — รับ CSS จาก container scope ทันที

**2) DRY refactor: `_openPopover(html, kind, bindActions)`**

```js
function _openPopover(html, kind, bindActions) {
  const pop = document.getElementById("lmPopover");
  if (!pop) return false;
  const content = String(html || "").trim();
  if (!content) {
    console.warn(`[leave_management] _openPopover(${kind}): empty content — refusing to open`);
    return false;
  }
  // sanity: ห้าม inject html ที่ขาด dialog markup (กัน scope bug ซ้ำ)
  if (!content.includes("lm-pop-dialog")) {
    console.warn(`[leave_management] _openPopover(${kind}): missing .lm-pop-dialog markup`);
    return false;
  }
  pop.innerHTML = content;
  pop.style.display = "block";
  document.body.style.overflow = "hidden";
  _registerPopoverEsc();
  pop.querySelector("#lmPopClose")?.addEventListener("click", _closePopover);
  pop.querySelector("#lmPopBackdrop")?.addEventListener("click", _closePopover);
  if (typeof bindActions === "function") {
    try { bindActions(pop); } catch (_e) {}
  }
  setTimeout(() => pop.querySelector("#lmPopClose")?.focus(), 0);
  return true;
}
```

- Guard: empty content → console.warn + return false (ไม่เปิด backdrop ถ้าไม่มี dialog)
- Sanity: html ต้องมี `.lm-pop-dialog` substring → กันคนเพิ่ม popover ใหม่แต่ลืม class
- Shared: display, focus, Esc, backdrop click → ลด duplicate code
- kind-specific bind actions ผ่าน callback parameter

`_openLeavePopover` + `_openDayListPopover` ตอนนี้สั้นมาก — แค่ render html + เรียก `_openPopover` พร้อม bind callback.

### Regression check ✅

- Calendar event chip click → leave details popover ใช้ `_openPopover("leave", ...)` — bind approve/reject/cancel/edit/delete actions ตาม role
- Dense day "+N รายการ" → day-list popover ใช้ `_openPopover("dayList", ...)` — bind event chip click (chained leave details)
- Esc + backdrop close — logic เดียวกันใน `_openPopover` (shared)
- Mobile bottom sheet (≤768px) — CSS rules ใน container scope ทำงานเหมือนเดิม
- Payroll/Balance/Quota/edit-modal — ไม่กระทบ

### Tests +6 source-level

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `_renderLeavePopover` template ไม่มี `<style>` block (CSS ย้ายไป container scope)
- `_renderDayListPopover` ไม่มี `<style>` block (เคย/ยังเป็นเช่นนั้น)
- Container scope `<style>` มี `.lm-pop-dialog` rules + `max-height: calc(100vh - ...)` + inner body scroll + mobile bottom sheet override
- `_openPopover` shared function: guard empty content + sanity check `.lm-pop-dialog` + `innerHTML` + `display:block`
- `_openLeavePopover` + `_openDayListPopover` ใช้ `_openPopover("leave"|"dayList", ...)` (DRY)
- `_renderDayListPopover` output มี `#lmPopBackdrop` + `class="lm-pop-dialog"` + `class="lm-pop-body"` + `id="lmPopClose"` + `events.map(_calendarEventChip)`

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **655/655** (651 + 4 net หลังตัด focus duplicate)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.2 → **5.62.3** (patch hotfix — root cause fix)
- `index.html`: ?v=305→306, data-app-build="306", data-app-version="5.62.3"
- `sw.js`: cache v305→v306 + v306 comment line

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=306
2. Calendar dense day → คลิก "+N รายการ"
3. **day-list dialog ต้องเห็นเต็มที่** — width 420px, background ขาว, header สีฟ้า "📅 วันXX D เดือน YYYY"
4. คลิก event ใน list → ปิด day-list → เปิด leave details popover (chained)
5. กด Esc / คลิก backdrop → ปิด
6. เปิด DevTools บีบ viewport → popover ยังเห็นได้ (max-height + inner scroll)
7. Mobile ≤768px → bottom sheet slide-up + grabber
8. F12 → Console → ถ้า `_openPopover` ถูกเรียกด้วย empty content จะเห็น `console.warn` (debug aid)

### Lessons learned

> Template literal ที่มี `<style>` tag จะ inject CSS เฉพาะตอน template นั้น render — ถ้ามีหลาย entry points (functions) ใช้ class เดียวกัน ต้อง share CSS scope (container) หรือ duplicate inline ใน ทุก entry point. ถ้า inject ใน entry เดียวจะเจอ bug แบบ 92.39c → 92.39d.

---

## 🧯 Phase 92.39c — HOTFIX popover visibility/position

**บริบท:** หลัง 92.39b verify pipeline ผ่าน source-level test แล้ว user ทดสอบจริง — คลิก "+N รายการ" → backdrop เปิด แต่ day-list popover **ไม่อยู่ใน viewport** โดยเฉพาะตอน DevTools เปิด/viewport เตี้ย.

### Root cause

```
#lmPopover (display:none → block, position:fixed inset:0, z-index:9998)
  ├── #lmPopBackdrop (position:absolute inset:0)         ← ไม่มี z-index
  └── .lm-pop-dialog (position:relative, margin:60px auto, overflow:hidden)
                     ← max-width:420px width:calc(100%-32px)
                     ← ไม่มี max-height, ไม่มี flex center
```

ปัญหา:
- Container `display:block` → ใช้ document flow → dialog ตามหลัง backdrop ใน DOM order
- Dialog `margin:60px auto` center horizontal เฉพาะ — vertical 60px from top
- **ไม่มี max-height** → content สูงเกิน `100vh - 60px` ทะลุล่างจอ
- Container `overflow:visible` (default) → ไม่ scroll
- DevTools เปิด viewport เตี้ย/แคบ → ตกขอบเห็นชัด

### สิ่งที่แก้ ([`modules/leave_management.js`](modules/leave_management.js))

**1) Container `#lmPopover` flex layout (CSS attribute selector):**

```css
#lmPopover[style*="display:block"] {
  display: flex !important;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 48px 16px;
}
@media (max-width: 768px) {
  #lmPopover[style*="display:block"] {
    align-items: stretch;
    padding: 0;
    overflow: hidden;
  }
}
```

- ใช้ attribute selector `[style*="display:block"]` (กับ/ไม่มี space) → flex layout เมื่อ JS toggle เปิด popover
- Desktop: padding 48px 16px ให้ breathing room + scroll ถ้า dialog สูง
- Mobile: stretch + zero padding → bottom sheet เต็มจอ

**2) `.lm-pop-dialog` desktop:**

```css
.lm-pop-dialog {
  position: relative;
  max-width: 420px;
  width: 100%;
  margin: 0;                       /* flex center แล้ว ไม่ต้อง margin */
  max-height: calc(100vh - 96px);  /* กัน dialog ขยายเกินจอ */
  background: #fff;
  border-radius: 14px;
  box-shadow: ...;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1;
}
.lm-pop-dialog > .lm-pop-body { flex: 1 1 auto; overflow-y: auto; }
```

- Dialog เป็น `display:flex flex-direction:column` → header pinned + body scroll
- `max-height: calc(100vh - 96px)` → ไม่ทะลุจอ
- Inner `.lm-pop-body` ใช้ `flex:1 1 auto; overflow-y:auto` → scroll content เฉพาะ body
- Mobile (≤768px): `max-height: 85vh` (เพิ่มจาก 80vh — ใช้พื้นที่มากขึ้น)

**3) z-index hierarchy:**

- Backdrop: `z-index: 0` (inline style)
- Dialog: `z-index: 1` (ใน class rule)
- Container: `z-index: 9998` (เดิม)

**4) `.lm-pop-body` class:**

- เพิ่มใน inner content div ของ `_renderLeavePopover` + `_renderDayListPopover`
- รับ flex+scroll rule จาก dialog selector → content scroll ภายใน, header pinned

**5) Focus management:**

- `setTimeout(() => pop.querySelector("#lmPopClose")?.focus(), 0)` หลัง open
- ใช้ทั้ง 2 popover types
- Benefits: a11y (keyboard nav) + visual confirmation ว่า popover visible + Esc key ทำงานทันที

### Regression check ✅

- Calendar event chip click → leave details popover ทำงานเหมือนเดิม (logic ไม่แตะ — เฉพาะ layout)
- Dense day "+N รายการ" → day-list popover ทำงานเหมือนเดิม (logic ไม่แตะ)
- Esc + backdrop close ยังทำงาน (handlers เดิม)
- Mobile bottom sheet (≤768px) — slide-up animation + grabber bar ยังทำงาน
- Edit quota warning (92.38c) ไม่แตะ
- Calendar mobile agenda (92.39) ไม่แตะ

### Tests +5 source-level

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `#lmPopover` container ใช้ flex layout via attribute selector + mobile override
- `.lm-pop-dialog` desktop มี `max-height: calc(100vh - ...)` + `flex-direction: column` + inner scroll
- z-index hierarchy: backdrop z-index:0 + dialog z-index:1 explicit
- ทั้ง 2 popover types ใช้ `class="lm-pop-body"` ใน inner content
- Focus close button หลัง open (a11y + visibility confirm) ทั้ง 2 popover types

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **651/651** (646 + 5)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.1 → **5.62.2** (patch hotfix)
- `index.html`: ?v=304→305, data-app-build="305", data-app-version="5.62.2"
- `sw.js`: cache v304→v305 + v305 comment line

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=305
2. หน้าวันลา → ปฏิทิน → คลิก "+N รายการ" บน cell ที่มี events ≥ 4
3. day-list popover ต้องเปิดที่ **กลางจอ desktop** หรือ **ตรงจาก bottom mobile** — มองเห็นชัด
4. กด Esc → ปิด (focus อยู่ที่ close button → keyboard ได้ทันที)
5. คลิก backdrop → ปิด
6. **เปิด DevTools บีบ viewport** ให้สูง ~400px → popover ยังเห็นได้ (scroll ภายใน body ได้)
7. Mobile (≤768px) → bottom sheet slide-up จากด้านล่าง + grabber bar + ไม่มี horizontal overflow
8. ทดสอบ event click chip ปกติ → leave details popover ก็ทำงานเหมือนกัน (same .lm-pop-dialog rules)

---

## 🧪 Phase 92.39b — Calendar Dense Day "+N รายการ" verification

**บริบท:** Production scenario เดิม (sompong 2 events/day) ไม่เคย trigger overflow branch — cap=3 ไม่เกิน. User ขอ verify ว่าเมื่อมี dense day (4+ events วันเดียว) flow ทำงานครบ:
1. Desktop cell แสดง 3 events + "+N รายการ"
2. Click "+N รายการ" → day-list popover แสดง events ทั้งหมด
3. Click event ใน popover → chained leave details popover
4. Esc / backdrop close
5. Mobile agenda ไม่ล้น

**ผลลัพธ์:** ทั้ง pipeline verified ไม่มี bug → **test-only release** (ไม่แตะ behavior).

### Verification approach

แทนที่จะ mock dense data ใน DB → ใช้ 2 levels of testing:

**1) Unit edge tests** (`limitCalendarDayEvents` 7 cases):
- `[], cap=3` → visible=[] overflow=0 (no chip)
- `events.length === cap` → boundary, no overflow
- `events.length === cap+1` → off-by-one (cap visible, 1 overflow)
- `5 events, cap=3` → 3 visible + 2 overflow + ลำดับ preserve
- `5 events, cap=2` → tighter scenario (2 visible + 3 overflow)
- immutability: `visible.push()` ไม่กระทบ events เดิม
- existing: ≤ cap, > cap, invalid cap, non-array

**2) Source-level integration tests** (6 tests) — อ่าน leave_management.js raw → assert wiring:

| Assert | Pattern |
|---|---|
| Overflow chip template | `+ ${overflowCount} รายการ` |
| Chip class | `class="lm-cal-more"` |
| Chip data attr | `data-lm-date="${escHtml(cell.dateStr)}"` |
| Cap constant | `_CAL_DESKTOP_MAX_VISIBLE = 3` |
| Helper call | `limitCalendarDayEvents(events, _CAL_DESKTOP_MAX_VISIBLE)` |
| Click delegation | `ev.target.closest(".lm-cal-more")` → `_openDayListPopover(dateStr, filtered)` |
| Popover read | `groupLeavesByDate(filtered, activeMonth)` → `byDate.get(dateStr)` |
| Popover render | `events.map(ev => _calendarEventChip(ev, profileMap, dateStr))` |
| Chained click | `_openLeavePopover` ใน popover event click handler |
| Esc + backdrop | `_registerPopoverEsc` + `#lmPopBackdrop` addEventListener `click` |

### Regression check ✅

- ไม่แตะ render code (เฉพาะเพิ่ม tests) — production behavior identical กับ build 303
- ไม่มี SQL / RLS ใหม่
- Edit quota warning build 302 ✓
- Filters / table view ✓
- Mobile agenda ✓

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **646/646** (633 + 13)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.0 → **5.62.1** (patch — test-only release)
- `index.html`: ?v=303→304, data-app-build="304", data-app-version="5.62.1"
- `sw.js`: cache v303→v304 + v304 comment line

### Smoke test (manual)

★ ต้องมี dense data ก่อน — ผู้ใช้สร้าง 4+ leave events ในวันเดียวกัน (วันที่ 26 พ.ค. ตัวอย่าง)

1. Production (Ctrl+Shift+R) → APP_BUILD=304
2. หน้าวันลา → ปฏิทิน → วันที่ 26 พ.ค.
3. ต้องเห็น chip 3 ตัว (cap=3) + ปุ่ม "+N รายการ" สีเทาดำ dashed border
4. คลิก "+N รายการ" → popover เปิด (desktop = centered modal / mobile = bottom sheet)
5. ต้องเห็น events ครบทั้งหมดของวันนั้น (รวม visible + overflow)
6. คลิก event ใด event หนึ่งใน popover → ปิด popover เก่า → เปิด leave details popover (chained)
7. กด Esc → ปิด popover ทันที (ทั้ง 2 types)
8. คลิก backdrop → ปิด popover
9. Mobile (resize ≤768px) → agenda list แสดง events ทั้งหมดในวันนั้น แบบ list ลงล่าง ไม่จำกัด cap

---

## 📱 Phase 92.39 — Leave Calendar Mobile Agenda + Dense Day Polish

**บริบท:** ต่อจาก 92.38c. Calendar Leave View ใช้งานได้แล้วบน desktop แต่ user feedback:
- บนมือถือ grid 7-col แน่นเกิน อ่านยาก / horizontal overflow
- วันที่มี leave หลายคน cell ขยายสูง ทำ grid แตก
- popover detail บนมือถือไม่ฟิตจอ + ไม่มี Esc

### Pure helpers ใหม่ ([`modules/leave_management.js`](modules/leave_management.js))

- `groupCalendarAgendaDays(leaves, month)` → array of `{dateStr, dayNum, dowIndex, dowLabel, monthShort, events}` (เฉพาะวันที่มี events, sorted ascending) — wrap `groupLeavesByDate` + เติม dow info ครบ พร้อม render
- `limitCalendarDayEvents(events, maxVisible)` → `{visible, overflowCount}` — split events เป็น visible (default cap 3) + count ส่วนเกิน
- `formatAgendaDateLabel(dateStr)` → "วันพุธ 14 พ.ค." (Asia/Bangkok, pure epoch math จาก 92.38b)

### UI changes

**Desktop month grid (`_renderCalendarMonthGrid`):**
- ใช้ `limitCalendarDayEvents(events, _CAL_DESKTOP_MAX_VISIBLE = 3)` แทน `events.slice(0, 3)` inline
- Overflow → ปุ่ม `"+N รายการ"` (เปลี่ยนจาก "+N เพิ่มเติม") → day-list popover
- Cell `max-height: 140px` (เดิมไม่มี max) — กัน grid แตก
- `min-height` ปรับเป็น 96px (เดิม 88px) อ่านง่ายขึ้น

**Mobile agenda (`_renderCalendarAgenda`):**
- ใช้ `groupCalendarAgendaDays` + `formatAgendaDateLabel` แทน inline `toLocaleDateString`/`Date.getDay()`
- Empty state ปรับ: icon ใหญ่ขึ้น + sub-hint "ลองเปลี่ยนเดือน · สถานะ · หรือประเภทใน filter ด้านบน"
- Header padding + font-size ใหญ่ขึ้นเล็กน้อย อ่านง่ายบนมือถือ

**Responsive section (`_renderCalendarSection`):**
- Breakpoint `max-width: 720px` → `768px` (สอดคล้อง tablet portrait)
- Mobile chip override: `font-size: 12px; padding: 5px 8px` (ใหญ่กว่า desktop chip 10px)

**Popover (`_renderLeavePopover` / `_renderDayListPopover`):**
- Desktop: centered modal เดิม (`max-width: 420px`, `margin: 60px auto`)
- Mobile (≤768px) bottom sheet:
  - `position: fixed; left: 0; right: 0; bottom: 0`
  - `border-radius: 16px 16px 0 0` (มุมโค้งบน)
  - `max-height: 80vh; overflow-y: auto`
  - Slide-up animation 200ms ease-out
  - Grabber bar (`.lm-pop-grabber`) แสดงด้านบนเฉพาะ mobile
- ปุ่ม action + font ใหญ่ขึ้น (8px→10px padding, 12px→13px font) — tap target ผ่าน Apple 44pt guideline

**Esc key:**
- `_registerPopoverEsc` register on open (`_openLeavePopover` / `_openDayListPopover`)
- `_closePopover` unregister — กัน listener leak ตอน rerender

### Regression check ✅

- Leave Balance / Quota Phase 92.35 — ไม่กระทบ (ไม่แตะ `calcBalancesForUser` หรือ `_renderBalanceSection`)
- Paid Leave Policy 92.36 + payroll save 92.37 + edit quota warning 92.38c — ไม่กระทบ
- Calendar desktop chip rendering — ใช้ `_calendarEventChip` เดิม
- Edit leave modal — ไม่แตะ form layout / submit / `_refreshQuotaWarn`
- Time Clock build 295 — ไม่แตะ
- Helpers pure epoch math จาก 92.38b — ยังใช้ `_bkkMidnightMs`/`_bkkDateStr`/`_bkkDow` เดิม
- ไม่มี SQL / RLS ใหม่

### Tests +11

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `groupCalendarAgendaDays`: sorted ascending + dow info / หลายคนวันเดียวกัน stack / leave หลายวัน expand / empty/null safe (4 tests)
- `limitCalendarDayEvents`: events ≤ cap full / events > cap split + count / invalid cap fallback 3 / non-array safe (4 tests)
- `formatAgendaDateLabel`: format ปกติ "วัน{dow} D {month-short}" / invalid → "" / ครอบ 12 เดือนไทย (3 tests)

### Gates

- `npm run lint:errors` exit 0 (clean)
- `npm test` = **633/633** (622 + 11)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.61.2 → **5.62.0** (minor — UX polish + new helpers)
- `index.html`: ?v=302→303, data-app-build="303", data-app-version="5.62.0"
- `sw.js`: cache v302→v303 + v303 comment line

### Smoke test (manual)

**Desktop:**
1. Production (Ctrl+Shift+R) → APP_BUILD=303
2. หน้าวันลา → ปฏิทิน → พ.ค. 2026
3. วันที่ 14–25 มี chips ของ sompong "(ต่อ)" — แสดง 3 อันแรก + "+N รายการ" (ถ้ามี leave คนอื่นซ้อน) → คลิกเปิด day list popover (centered modal, max-width 420px)
4. Click chip → leave popover (centered) — ปุ่ม edit/delete ตาม role
5. กด Esc → ปิด popover

**Mobile (DevTools → 390×844 iPhone 12 Pro หรือเล็กกว่า 768px):**
1. หน้าวันลา → ปฏิทิน → agenda list (ไม่ใช่ grid 7-col)
2. ไม่มี horizontal overflow — chips แสดงในกล่องวันต่อวัน
3. Header แต่ละวัน: "วันXX D เดือน · วันนี้?" + count "N รายการ"
4. แตะ chip → bottom sheet เปิด slide-up จากด้านล่าง + มี grabber bar
5. แตะ backdrop หรือ Esc (ถ้ามีคีย์บอร์ดต่อ) → ปิด
6. ลอง filter status = "ปฏิเสธ" + ไม่มี record → empty state ใหญ่ "ไม่มีรายการลาในเดือนนี้" + hint

---

## 🧯 Phase 92.38c — HOTFIX leave edit quota warning double-count

**บริบท:** Production smoke หลัง build 301 — sompong มี vacation approved รวม 12 วัน (เกิน quota 10 = 2 วัน). เปิด edit modal ของ record 2 วัน → quota warning แสดง **"เกิน quota 4 วัน"** ทั้งที่ควรเป็น 2; เปิด edit record 10 วัน → **"เกิน quota 12 วัน"** ทั้งที่ควรเป็น 2 → record เดิมถูกนับซ้ำ.

### สาเหตุ ([`modules/leave_management.js`](modules/leave_management.js) line ~1835)

```js
const existingDays = existing && existing.status === "pending" && ... ? Number(existing.days_count || 0) : 0;
const projectedPending = (b.pending - existingDays) + newDays;
const projectedTotal = b.used + projectedPending;
```

- ลบเฉพาะ `existing.days_count` เมื่อ `status === "pending"` → **approved record ไม่ถูก exclude**
- `b.used` มาจาก `calcBalancesForUser` ที่นับทุก approved row (รวม record ที่กำลัง edit)
- ผลลัพธ์: ผู้ใช้กรอก `newDays = 2` แล้วถูกบวกเข้า `b.used = 12` → projected = 14 → overBy = 4
- ที่แย่กว่า: ถ้าเปลี่ยน leave_type → bucket ใหม่นับ record เดิมในประเภทเก่าอยู่ดี

### สิ่งที่แก้

**1) `calcBalancesForUser` — เพิ่ม optional `excludeLeaveId` param**

- filter `leaves.filter(r => String(r.id) !== String(excludeId))` ก่อนนับ
- ทำงาน ทั้ง approved + pending (ไม่จำกัด status)
- compare loose แบบ string (ป้องกัน mismatch ระหว่าง `bigint` ใน DB กับ string จาก DOM)
- `excludeLeaveId === undefined/null/""` → no-op (create mode behavior คงเดิม)

**2) `_refreshQuotaWarn` ใน form modal**

- ส่ง `excludeLeaveId: existing?.id` ตอนเรียก `calcBalancesForUser`
- ลบ logic `existingDays`-pending-only ออก
- `projectedPending = b.pending + newDays` (b ที่ exclude record นี้แล้ว)
- `projectedTotal = b.used + projectedPending`
- `overBy = projectedTotal - b.quota`

### Expected behavior หลังแก้

- edit record approved 2 วัน → `b.used` (หลัง exclude) = 10, `+ newDays = 2` → projected 12 → overBy 2 (ถูกต้อง)
- edit record approved 10 วัน → `b.used` (หลัง exclude) = 2, `+ newDays = 10` → projected 12 → overBy 2 (ถูกต้อง)
- เปลี่ยน days 2 → 5: `b.used = 10` + `newDays = 5` → projected 15 → overBy 5 (delta +3 ถูก)
- เปลี่ยน days 10 → 8: `b.used = 2` + `newDays = 8` → projected 10 → overBy 0 (ถูกต้อง ลดลง)
- เปลี่ยน leave_type vacation → sick: bucket ใหม่ filter exclude id เดียวกัน → sick bucket ไม่ได้รับผลกระทบ
- เปลี่ยน employee: balance ของ user คนใหม่ filter exclude id เดียวกัน — ไม่มี match ก็ no-op

### Regression check ✅

- Balance / Quota cards (หน้า Leave) ยังนับ DB จริงเหมือนเดิม (`calcBalancesForUser` เรียกจาก `_rerender` ไม่ส่ง `excludeLeaveId`)
- Payroll decision Phase 92.36 — `decidePayrollLeaveImpact` ไม่ใช้ `excludeLeaveId` → ไม่กระทบ
- Calendar view Phase 92.38 — ไม่แตะ
- Time Clock build 295 — ไม่แตะ
- ไม่มี SQL/RLS ใหม่

### Tests +7

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `edit approved 2 วัน` — exclude id แล้ว used ลดลง 2 (overQuota=false)
- `edit approved 10 วัน` — exclude id แล้ว used ลดลง 10
- `edit pending` — exclude id ลด pending (used คงเดิม)
- `เปลี่ยน leave_type bucket` — exclude vacation → sick bucket ไม่กระทบ
- `excludeLeaveId ที่ไม่มีจริง` → no-op
- `create mode (undefined/null/empty)` → behavior เดิม
- `number id vs string id` cross-type compare safety

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **622/622** (615 + 7)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.61.1 → **5.61.2** (patch hotfix)
- `index.html`: ?v=301→302, data-app-build="302", data-app-version="5.61.2"
- `sw.js`: cache v301→v302 + v302 comment line

### Smoke test (manual)

1. Production (Ctrl+Shift+R) → APP_BUILD=302
2. เปิด หน้า "วันลา" → Calendar
3. คลิก event sompong 2 วัน → กด "✏️ แก้ไข" → modal เปิดด้วยค่าเดิม
4. quota warning ต้องบอกว่า "เกิน quota 2 วัน" (ไม่ใช่ 4) — เพราะ record นี้ถูก exclude ก่อนคำนวณ
5. เปลี่ยน days = 5 → warning เปลี่ยนเป็น "เกิน quota 5 วัน" (delta +3 จาก baseline 10/10)
6. เปลี่ยน days = 8 → warning หาย หรือเป็น "เกิน 0" (baseline 10/10 + 8 - 10 = 8 → wait)

   _แก้ exposition: หลัง exclude 2 record (ที่กำลัง edit) → baseline used = 10 (record อื่น) → + days 8 → projected 18 → over 8._

   ★ **Correction:** หลัง exclude record 2 วัน → baseline used = 10 (จาก record 10 วันที่ยังคงอยู่). กรอก newDays = 8 → projected = 10 + 8 = 18 → over 8 วัน.

   _ตัวอย่างจริงๆ ในข้อ 6:_ ถ้า user มี record อื่นใน vacation ที่ approved 10 + กำลัง edit record 2 → exclude 2 → baseline 10. ใส่ days = 0 ไม่ได้ (validation), days = 1 → over 1. ถ้าต้องการ over=0 → days = 0 หรือ ลบ record อีกอันก่อน
7. กดยกเลิก หรือ บันทึก — submit insert ใหม่ (ไม่ใช่ update — ดู existing form submit logic)

---

## 🧯 Phase 92.38b — HOTFIX TZ-dependent calendar helpers (this session)

**บริบท:** push 92.38 → Cloudflare Pages deploy success (live build 300) แต่ GitHub Actions Tests workflow **fail** ที่ 2 tests:
- `expandLeaveRangeToMonthDays — leave ข้ามเดือน → clip เฉพาะวันใน month ที่ดู`
- `getCalendarMonthGrid — first cell คือ Sunday ของสัปดาห์ที่มี 1 ของเดือน`

Local Windows (TZ=Bangkok) ผ่าน 615/615; CI Linux (TZ=UTC) fail 2 → CI parity issue ที่ผมพลาด

### สาเหตุ

- `getCalendarMonthGrid`: ใช้ `first.getDay()` → method `Date.getDay()` อ่าน DOW ตาม **local TZ ของ environment** ไม่ใช่ Bangkok
  - UTC env: `2026-05-01T00:00:00+07:00` ⇄ `2026-04-30T17:00:00Z` → `getDay()` = 4 (Thu) ใน UTC, ควรเป็น 5 (Fri) ใน Bangkok
- `expandLeaveRangeToMonthDays`: ใช้ `nextMonth.setMonth(getMonth()+1)` + `toLocaleDateString` — เสี่ยง parity ในเงื่อนไข specific

### สิ่งที่แก้ ([`modules/leave_management.js`](modules/leave_management.js))

เพิ่ม 3 internal helpers pure epoch math:
- `_bkkMidnightMs(yyyyMmDd)` = `Date.parse(s + "T00:00:00+07:00")` — UTC ms ของ Bangkok midnight
- `_bkkDateStr(ms)` = shift `ms + 7*3600*1000` แล้ว format `getUTCFullYear/Month/Date` → YYYY-MM-DD
- `_bkkDow(ms)` = `((floor((ms + 7h)/86400000) % 7) + 4) % 7` — 1970-01-01 = Thu reference

แทนที่ใน 2 helpers:
- `expandLeaveRangeToMonthDays`: month end exclusive คำนวณจาก year+month next (ไม่ใช้ `setMonth`); loop ใช้ `_bkkDateStr` แทน `toLocaleDateString`
- `getCalendarMonthGrid`: `firstDow` ใช้ `_bkkDow`; loop 42 cells ใช้ index math + `_bkkDateStr` แทน `cursor.setDate()`; dayNum extract จาก dateStr.slice(8,10) แทน `Date.getDate()`

### ตรวจสอบ

- Local Windows Bangkok TZ: unit **615/615**
- Simulated CI: `$env:TZ='UTC'; node --test tests/leave_management.test.js` → **108/108**
- Lint clean, audit 0

### Version sync

- `package.json`: 5.61.0 → **5.61.1** (patch hotfix)
- `index.html`: ?v=300→301, data-app-build="301", data-app-version="5.61.1"
- `sw.js`: cache v300→v301 + v301 comment line

---

## 📅 Phase 92.38 — Calendar Leave View (this session)

**บริบท:** ต่อจาก 92.37. หน้า "วันลา" ใน production มีตารางอย่างเดียว — admin/พนักงานไม่เห็น overview ของวันลา/บรรยากาศเดือนนั้น ๆ ในแบบ visual. เฟสนี้เพิ่ม **Calendar view** เป็นมุมมองทางเลือก (table ยังเป็น default คงเดิม) — ดูภาพรวมเดือนได้, click event เปิด popover พร้อม action ตาม role.

### Pure helpers (test-friendly, Asia/Bangkok)

[`modules/leave_management.js`](modules/leave_management.js):
- `expandLeaveRangeToMonthDays(leave, month)` — return array YYYY-MM-DD ที่ overlap month นั้น; clip ที่ขอบเดือน (leave ข้ามเดือนแสดงเฉพาะวัน in-month); empty month → ใช้ทั้งช่วง
- `groupLeavesByDate(leaves, month)` — Map<YYYY-MM-DD, Array<leave>> เรียง key ascending; leave หลายวันกระจายอยู่หลาย key; หลายคนวันเดียวกัน stack ใน key เดียว
- `getCalendarMonthGrid(month, todayStr?)` — { weeks: [6 × 7 cells], monthLabel, year, monthNum }; first cell = Sunday ของแถวที่มีวันที่ 1; cell มี `{ dateStr, dayNum, inMonth, isWeekend, isToday }`; รองรับ leap year; invalid month → weeks=[]

### UI changes — `renderLeaveManagementPage`

- เพิ่ม state `activeView = "table"` (default คงเดิม)
- Filter bar เพิ่มปุ่ม toggle 2 ตัว: 📋 ตาราง / 📅 ปฏิทิน — active state = พื้นน้ำเงิน, inactive = ขาว
- เมื่อ `activeView === "calendar"` → render `_renderCalendarSection(filtered, activeMonth, profileMap, today)`
- เมื่อ `activeView === "table"` → render table เดิม (ไม่เปลี่ยน)

### Desktop month grid (`_renderCalendarMonthGrid`)

- 7-col grid (อา–เสาร์, Sun-first ตาม Thai POS convention)
- 6 rows × 7 cells (เริ่ม Sunday ของสัปดาห์ที่มี 1 ของเดือน)
- Cell ละ row แสดง:
  - dayNum + "วันนี้" chip (ถ้า isToday)
  - Event chips ≤ 3 ตัว (ใช้ `_calendarEventChip`): icon ประเภท + ชื่อพนักงาน + suffix "(ต่อ)" ถ้าวันที่ไม่ใช่ start_date
  - Overflow > 3 → ปุ่ม "+ N เพิ่มเติม" → day-list popover
- Visual cues:
  - Today = bg เหลือง + border ส้ม
  - In-month = white, out-month = grey
  - Weekend (Sun/Sat) = day color แดง
  - Status pending = dashed border, rejected/cancelled = opacity 0.55, approved = solid

### Mobile agenda (`_renderCalendarAgenda`, ≤720px)

- CSS-driven responsive (`@media (max-width: 720px)`)
- Group เฉพาะวันที่มี event (ไม่แสดงวันว่าง)
- แต่ละ block: dow label ไทย (วันพุธ/วันศุกร์/...) + count + chips ของวันนั้น
- ถ้าไม่มี event ในเดือน → empty state 📭 "ไม่มีรายการลาในเดือนนี้"

### Click interaction (popover)

[`#lmPopover`] container ใหม่ใน DOM:
- Click chip → `_openLeavePopover(leave)`:
  - แสดง: icon ประเภท + ชื่อพนักงาน + label ประเภท + date range + จำนวนวัน + status chip + reason + review_note
  - ปุ่ม action ตาม role (ใช้ `canEditLeave`/`canReviewLeave` guard เดิม):
    - admin: ✓ อนุมัติ / ✕ ปฏิเสธ (ถ้า pending) · ✏️ แก้ไข / 🗑️ ลบ
    - non-admin: ยกเลิก (เฉพาะ row ของตัวเอง + pending)
- Click "+N เพิ่มเติม" → `_openDayListPopover(dateStr)` — list ทุก leave ในวันนั้น → click row → chained popover (leave details)
- Backdrop click / ปุ่ม ✕ → close

### Integration กับ filters เดิม

- View toggle ใช้ `month`/`status`/`type` filter เดียวกัน (state ใน `_rerender` scope)
- เปลี่ยน month → calendar re-render with new grid
- เปลี่ยน status/type → events ที่ผ่าน filter เท่านั้นแสดงใน calendar
- Export, KPI cards, Balance section, Create form — ใช้ flow เดิม ไม่กระทบ

### Regression check ✅

- Leave Balance / Quota Phase 92.35 — ไม่กระทบ (`_renderBalanceSection` แยกจาก calendar)
- Paid Leave Policy decision Phase 92.36 (payroll modal) — ไม่กระทบ (คนละ module flow)
- Payroll save audit Phase 92.37 — ไม่กระทบ (ไม่แตะ payroll.js)
- Time Clock responsive build 295 — ไม่กระทบ (แตะเฉพาะ leave_management.js)
- ไม่แตะ DB schema / RLS / SQL / payroll math / time_clock
- Non-admin ยังเห็นเฉพาะของตัวเอง (client filter line 1040 + RLS server-side)

### Gates

- `npm run lint:errors` exit 0 (clean)
- `npm test` = **615/615** (595 + 20 ใหม่)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items)

- `package.json`: 5.60.0 → **5.61.0** (minor — UI addition)
- `index.html`: `style.css?v=299→300`, `selfheal.js?v=299→300` + `data-app-build="300"` + `data-app-version="5.61.0"`, `main.js?v=299→300`, `boot.js?v=299→300`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v300'` + v300 + v299 comment lines

### Smoke test (manual)

1. **ไม่ต้องรัน SQL ใหม่** — ใช้ตาราง 92.32 + 92.35
2. Production (Ctrl+Shift+R) → APP_BUILD=300
3. **Admin → 🌴 วันลา → เลือกเดือน พฤษภาคม 2026**
4. Default = ตาราง — ตรวจปุ่ม toggle อยู่บน filter bar (📋 ตาราง / 📅 ปฏิทิน)
5. กด **📅 ปฏิทิน** → ควรเห็น 7-col grid:
   - sompong พักร้อน 14–25 พ.ค. (12 วัน) → chips สีฟ้า 🌴 บนวันที่ 14 + วันที่ 15–25 มี chip "(ต่อ)"
   - วันนี้ (26 พ.ค.) cell มี border ส้ม + chip "วันนี้"
6. **filter ประเภท = "พักร้อน"** → ยังเห็น chips ของ sompong (ประเภทอื่นหาย)
7. **filter สถานะ = "อนุมัติแล้ว"** → ถ้า sompong approved → solid border; rejected/cancelled หาย
8. **click chip** → popover แสดง: 🌴 sompong, "พักร้อน · 2026-05-14 → 2026-05-25 (12 วัน)", สถานะ ✅ อนุมัติแล้ว, reason ถ้ามี, ปุ่ม ✏️ แก้ไข / 🗑️ ลบ (admin)
9. ปิด popover (✕ หรือ click backdrop)
10. **mobile view** (resize browser ≤720px หรือเปิดบนมือถือ) → calendar เป็น agenda list — group เฉพาะวันที่มี event, dow label ไทย ("วันพุธ 14 พ.ค.")
11. กด **📋 ตาราง** → กลับมา table view เดิม — filters ยังคง state เดิม

---

## 🧮 Phase 92.37 — Payroll Save + Leave Deduction Finalization Audit

**บริบท:** ต่อจาก 92.36b (idempotency hotfix) — production smoke เคส sompong พักร้อน 12 วัน, quota 10, เกิน 2 วัน, daily rate 400 → แนะนำหัก ฿800 → ช่อง `หัก (-)` = `฿800` → สุทธิ = `฿400`. ปุ่ม "เติมลงช่องหัก" กดซ้ำไม่บวกซ้ำแล้ว (จาก 92.36b) แต่ยังเหลือ gap UX:
1. กด "ดึงสรุปวันลา" ซ้ำหลังเปิดรายการเดิม → ปุ่ม apply ยังโผล่ทุกครั้ง → admin ไม่รู้ว่า "เคยเติมไปแล้ว"
2. หลังกด apply แล้ว row ถูก hide → admin ตรวจไม่ทันว่าเติมไปจริง
3. ไม่มี warning info ที่ชัดเจนว่ามีรายการหักวันลาแล้ว

### Audit (Goal 1) — save flow ผ่านครบ ✅

- `_savePayroll` ใน [`modules/payroll.js`](modules/payroll.js) อ่าน `deductions`/`note` ตรงจาก DOM inputs → ส่ง PATCH/POST ไป staff_payroll ตรง ๆ — **ไม่มี mutation/override**
- `total_amount` คำนวณฝั่ง DB (generated/trigger) — payload ไม่ส่ง field นี้, ให้ DB ตัดสินจาก base+ot+welfare+bonus+commission − deductions
- เปิด modal edit รายการเดิม → `value="${Number(payroll?.deductions || 0)}"` + `escHtml(payroll?.note || '')` ตรงๆ — ค่าเดิม survive ครบ
- กด "ดึงสรุปวันลา" ซ้ำ + apply ซ้ำ → `hasLeaveDeductionNoteMarker(curNote, marker)` จับ marker เดิมใน note → ปฏิเสธการบวกซ้ำ (จาก 92.36b)

### UX hardening (Goal 2-3) — guards + visual state

[`modules/payroll.js`](modules/payroll.js):
- เพิ่ม `prLeaveApplyInfo` element (yellow box) ใต้ปุ่ม apply
- เพิ่ม `_setLeaveApplyButtonState(applied, suggestedAmount)`:
  - `applied=true` → ปุ่ม disabled, label `✓ เติมแล้ว`, สีเทา (#94a3b8), cursor not-allowed + info แสดง `ⓘ ตรวจพบรายการหักวันลาแล้ว (เติม ฿X ไว้แล้ว — แก้ช่องหัก/หมายเหตุก่อนบันทึก)`
  - `applied=false` → ปุ่ม active, label `→ เติมลงช่องหัก`, สีแดง + ซ่อน info
- `_refreshLeaveDecision`: หลังคำนวณ decision + render breakdown → ตรวจ `hasLeaveDeductionNoteMarker(curNote, marker)` แล้วเรียก `_setLeaveApplyButtonState(already, suggestedDeduction)` — guard ทำงานทันทีตอน reopen + กด "ดึงสรุปวันลา"
- `prFillLeaveBtn` click handler: หลัง apply สำเร็จ → เรียก `_setLeaveApplyButtonState(true, ...)` แทน `_hideLeaveApplyRow()` — apply row ไม่ซ่อน, admin เห็น breakdown + state ปุ่มชัด
- Live recompute: เพิ่ม `prNote` ใน listener list (`prBase`/`prDailyRate`/`prDailyToggle`/`prNote`) → admin ลบ marker จาก note → ปุ่ม apply กลับมา active ทันที (ไม่ต้อง re-fetch)

### Tests (Goal 4)

[`tests/leave_management.test.js`](tests/leave_management.test.js) — เพิ่ม 5 test:
- `hasLeaveDeductionNoteMarker — เคส smoke จริง: หัก 2 วันเกิน quota, reopen รายการเดิม` (round-trip note → reopen guard)
- `hasLeaveDeductionNoteMarker — เคส decimal และตัวเลขมีเศษ` (`0.5`, `1.50`, `10` วัน)
- `hasLeaveDeductionNoteMarker — manual note ที่ไม่มี marker pattern → allow apply` (`ลาป่วย 5 วัน` ไม่ match, `หักลา 2 ครั้ง` ไม่ match)
- `hasLeaveDeductionNoteMarker — null/undefined/whitespace-only safety`
- `hasLeaveDeductionNoteMarker — exact marker priority over regex fallback`

### Regression check ✅

- ไม่แตะ payroll save payload shape / money math / DB / RLS / SQL / auto-deduction
- Leave Balance Phase 92.35 + Paid Leave Policy 92.36 + Time Clock responsive build 295 ไม่ regression — แตะเฉพาะ UI guard ใน payroll modal

### Gates

- `npm run lint:errors` exit 0 (clean)
- `npm test` = **595/595** (590 + 5 ใหม่)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items)

- `package.json`: 5.59.1 → **5.60.0** (minor — UX behavior change)
- `index.html`: `style.css?v=298→299`, `selfheal.js?v=298→299` + `data-app-build="299"` + `data-app-version="5.60.0"`, `main.js?v=298→299`, `boot.js?v=298→299`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v299'` + v299 + v298 comment lines

### Smoke test (manual)

1. **ไม่ต้องรัน SQL ใหม่** — ใช้ตาราง 92.32 + 92.35
2. Production (Ctrl+Shift+R) → APP_BUILD=299
3. Admin → 💰 รายการเงินเดือน → เปิดรายการ sompong พฤษภาคม 2026
4. ช่อง `หัก (-)` = `800`, note มี marker `หักลา 2 วัน (เกิน quota 2)` ✓
5. กด "📥 ดึงสรุปวันลา" อีกครั้ง → policy breakdown แสดง: ✅ Paid 10 · ⚠️ Over 2 · → แนะนำหักรวม ฿800
6. ตรวจปุ่ม `→ เติมลงช่องหัก` → ควร **disabled** + label `✓ เติมแล้ว` + info แสดง `ⓘ ตรวจพบรายการหักวันลาแล้ว ...`
7. ลบ marker `· หักลา 2 วัน (เกิน quota 2)` ออกจาก note → ปุ่มกลับมา active
8. กดปุ่ม apply → ช่อง `หัก (-)` คงเป็น `800` (ไม่บวกเป็น `1600`) + ปุ่ม disabled + info แสดงอีกครั้ง
9. กด `+ บันทึก` → success
10. เปิดรายการเดิมอีกครั้ง → `deductions=800`, สุทธิยังถูก, note marker ยังอยู่ ✓

---

## 🧯 Phase 92.36b — Payroll leave apply idempotency hotfix

**บริบท:** Production smoke หลัง Phase 92.36 เจอว่าเคสพักร้อนเกิน quota 2 วัน คำนวณแนะนำหัก `฿800` ถูกต้อง แต่ถ้ากดปุ่ม "→ เติมลงช่องหัก" ซ้ำ ช่อง `หัก (-)` ถูกบวกซ้ำเป็น `฿1600` และสุทธิกลายเป็นติดลบ ทั้งที่ note มี marker `หักลา 2 วัน (เกิน quota 2)` แล้ว.

### สาเหตุ

- Guard เดิมใน [`modules/payroll.js`](modules/payroll.js) ใช้ exact `curNote.includes(marker)`
- ถ้า marker format drift เช่น `2` vs `2.00` หรือ note ถูก normalize ต่างกันเล็กน้อย guard อาจไม่ match แล้วบวกยอดซ้ำ

### สิ่งที่แก้

- [`modules/leave_management.js`](modules/leave_management.js)
  - เพิ่ม pure helper `hasLeaveDeductionNoteMarker(note, marker)`
  - เช็ค exact marker ก่อน แล้ว fallback regex `/หักลา\s+\d+(?:\.\d+)?\s*วัน/`
  - หลักการ: ถ้า note มี marker "หักลา ... วัน" อยู่แล้ว ถือว่า leave deduction applied แล้ว ห้ามบวกซ้ำ
- [`modules/payroll.js`](modules/payroll.js)
  - ปุ่ม "→ เติมลงช่องหัก" เปลี่ยนจาก `curNote.includes(marker)` เป็น `hasLeaveDeductionNoteMarker(curNote, marker)`
- [`tests/leave_management.test.js`](tests/leave_management.test.js)
  - เพิ่ม test เคส marker drift (`หักลา 2 วัน` vs `หักลา 2.00 วัน`) ต้อง detect เป็น applied
- Version/cache sync:
  - `package.json`: 5.59.0 → **5.59.1**
  - `index.html`: `?v=297→298`, `data-app-build="298"`, `data-app-version="5.59.1"`
  - `sw.js`: cache `v297→v298` + comment

### Smoke หลัง deploy

- เปิด Payroll modal เคสเดิมที่มี note `หักลา 2 วัน (เกิน quota 2)` และช่องหัก `800`
- กด "ดึงสรุปวันลา" แล้วกด "→ เติมลงช่องหัก" ซ้ำ
- Expected: ช่อง `หัก (-)` ยังเป็น `800`, ไม่กลายเป็น `1600`, และขึ้นข้อความเติมแล้วก่อนหน้านี้

### Gates

- `npm run lint:errors` = 0/0
- `npm test` = **590/590**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

---

## 🧮 Phase 92.36 — Paid Leave Policy → Payroll Decision (this session)

**บริบท:** ต่อจาก Phase 92.35 (Leave Policy + Balance foundation) — ระบบรู้ quota รายปีแล้ว แต่ยังไม่ตัดสินใจว่าวันลา vacation/sick/personal ที่เกิน quota ควรหักหรือไม่. เฟสนี้เพิ่ม **policy decision helper** + **Payroll modal breakdown** + **Apply ที่รวม unpaid + over-quota** เป็นปุ่มเดียว (idempotent).

**Policy rule (advisory only — admin ต้องกดยืนยันเอง):**
- vacation/sick/personal **ภายใน quota → paid** (ไม่หัก)
- ส่วนที่เกิน quota → **แนะนำ** หักเฉพาะวันที่เกิน (advisory)
- unpaid → แนะนำหักทั้งหมด
- other → info only (ไม่หัก)

### สิ่งที่เพิ่ม

**1) Pure helpers** [`modules/leave_management.js`](modules/leave_management.js) (test-friendly):
- `decidePayrollLeaveImpact({monthSummary, balances, dailyRate, baseSalary})` → returns `{paidWithinQuotaDays, overQuotaDays, unpaidDays, otherDays, deductibleDays, suggestedDeduction, perType, hasBalanceData}`
  - หลักการคำนวณ "over": `usedBefore = balance.used - monthDays` (balance.used รวมเดือนนี้แล้ว) → `headroom = quota - usedBefore` → `paid = min(monthDays, headroom)` · `over = monthDays - paid`
  - ถ้า `balances=null` หรือ `tracksBalance=false` หรือ `quota=null` → tracked types treat เป็น paid ทั้งหมด (graceful)
- `leaveDeductionNoteMarker(decision)` → string marker `หักลา <D> วัน (ไม่รับค่าจ้าง U, เกิน quota O)` สำหรับ idempotent check ใน note

**2) Payroll modal** [`modules/payroll.js`](modules/payroll.js)
- ปุ่ม "📥 ดึงสรุปวันลา" ตอนนี้ **await ทั้ง period leaves + year balance ขนาน** แล้วคำนวณ decision
- เพิ่ม section "🧮 Policy breakdown (advisory)" — 5 cards: ✅ Paid · ⚠️ เกิน quota · 💸 ไม่รับค่าจ้าง · 📌 อื่น ๆ · → แนะนำหักรวม
- ปุ่ม "→ เติมลงช่องหัก" รวม unpaid + over-quota เป็นยอดเดียว · idempotent ผ่าน combined marker ใน note (ถ้า marker เดิมอยู่ใน note → toast แจ้ง + ไม่บวกซ้ำ)
- ข้อความ italic ใต้ปุ่ม apply: "★ ปุ่มนี้เป็นการ 'แนะนำ' ไม่หักเงินอัตโนมัติ — admin ตรวจช่องหัก/หมายเหตุก่อนบันทึก"
- recompute decision ทันทีเมื่อ admin แก้ base/dailyRate/dailyToggle (event listeners เดิม) → suggestedDeduction อัปเดต real-time

**3) Safety / non-regression**
- ★ Leave Balance UI (build 296) **ไม่ regression** — `_loadYearBalance` + `_renderBalanceSection` แยกออกจาก decision logic
- ★ Time Clock self responsive (build 295) **ไม่ regression** — แตะแค่ leave_management.js + payroll.js
- ไม่แตะ money math / staff_leaves write / payroll save / RLS / dep ใหม่
- ลบ unused import `calcUnpaidLeaveDeduction` ใน payroll.js (decidePayrollLeaveImpact เรียกภายในแล้ว)

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **589/589** (เพิ่ม 13 จาก 576: decide 8 + marker 5)
- `npm run test:e2e` = **11/11** (รอบแรก fail style.css?v=296 มิตรงกับ data-app-build 297 — แก้แล้วผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.58.0 → **5.59.0**
- `index.html`: `style.css?v=296→297`, `selfheal.js?v=296→297` + `data-app-build="297"` + `data-app-version="5.59.0"`, `main.js?v=296→297`, `boot.js?v=296→297`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v297'` + v297 + v296 comment lines

### Smoke test (manual)
1. **ไม่ต้องรัน SQL ใหม่** — ใช้ตารางจาก 92.32 + 92.35
2. เปิด `https://boonsook-pos-v5.pages.dev/` (Ctrl+Shift+R) → ตรวจ APP_BUILD=297
3. **Admin → "💰 รายการเงินเดือน":**
   - เพิ่ม/แก้ → เลือกพนักงานที่มีวันลา approved ในเดือนนั้น → กด "📥 ดึงสรุปวันลา"
   - ต้องเห็น **🧮 Policy breakdown** (5 cards) ใต้ summary และ **📊 ทั้งปี** balance (5 cards)
   - **เคส A** (ภายใน quota): พนักงานใช้ vacation 3 วันในเดือน ปียังเหลือ 7 → Paid=3, เกิน=0, แนะนำหัก=0 → apply row ซ่อน
   - **เคส B** (เกิน quota): พนักงานใช้ vacation 12 วันสะสมทั้งปี เดือนนี้ 5 วัน → Paid=3, เกิน=2, แนะนำหัก = 2 × dailyRate
   - **เคส C** (unpaid อย่างเดียว): unpaid 4 วัน → แนะนำหัก = 4 × dailyRate
   - **เคส D** (mixed): vacation 2 + personal 2 + unpaid 2 + other 1.5 (สมมติ personal เกิน 1 วัน) → Paid=3, เกิน=1, ไม่รับ=2, อื่นๆ=1.5, deductible=3
   - กด "→ เติมลงช่องหัก" → ช่อง "หัก (-)" บวกตามที่แนะนำ + note ได้ marker · กดซ้ำ → toast "เติมแล้วก่อนหน้านี้ (idempotent)"
4. **Graceful** (ก่อนรัน Phase 92.35 SQL): balance map = default policies → ทำงานเหมือน Phase 92.35 (UI label "ใช้ค่า default")
5. **Regression check:**
   - หน้า "🌴 วันลา" (Phase 92.35) → balance section ยังแสดงปกติ
   - หน้า "🕒 ลงเวลาทำงาน" mobile/desktop (build 295) — ไม่แตะ

### Follow-ups (ค้างจงใจ — ลำดับแนะนำ)
| ลำดับ | ค้าง | บริบท |
|---|---|---|
| 1 | Admin manage policies UI | "ตั้งค่า → Leave Policy" ให้ admin แก้ quota default ผ่าน UI |
| 2 | Per-user override UI | สร้าง `staff_leave_overrides` ผ่าน UI |
| 3 | Calendar leave view | ใช้ `modules/calendar.js` |
| 4 | Payslip รายละเอียดวันลา | section ในใบจ่ายเงินเดือน — เอา perType จาก decision มาแสดง |
| 5 | เชื่อม Time Clock → leave | approved leave → chip ใน HR Overview status table |
| - | Audit tab modal (ค้างจาก 92.30) · Late rule (ค้างจาก 92.29) · Edit attendance modal 7-วัน (ค้างจาก 92.30) | |

---

## 💼 Phase 92.35 — Leave Policy + Balance/Quota Foundation

**บริบท:** ต่อจาก Phase 92.33 (Leave→Payroll advisory) — user ขอ quota/balance พื้นฐาน: ทำเฟส foundation ก่อน (ตาราง + helpers + UI balance + form warning + payroll advisory display). **เฟสนี้ยังไม่เปลี่ยน money math** — vacation/sick/personal ยังแสดงเฉย ๆ ไม่หักเงิน. unpaid logic เดิม (Phase 92.33) ยังใช้.

### สิ่งที่เพิ่ม

**1) SQL migration** [`supabase-phase92-35-leave-policies-balances.sql`](supabase-phase92-35-leave-policies-balances.sql) — additive only:
- `leave_policies` (PK=`leave_type`, `annual_quota` numeric(6,2), `tracks_balance` bool, ...)
  - Seed 5 rows: vacation 10, sick 30, personal 3, unpaid null, other null · `ON CONFLICT DO NOTHING` re-run safe
- `staff_leave_overrides` (id, user_id uuid, leave_type, annual_quota, effective_year, ...) + `UNIQUE(user_id,leave_type,effective_year)`
- 4 CHECK + 2 indexes + 2 updated_at triggers
- 8 RLS policies (4 per table):
  - **leave_policies**: ทุก authenticated SELECT (UI ของ user ต้องอ่าน quota ของตัวเองได้) · admin write
  - **staff_leave_overrides**: admin all · user SELECT own
- `NOTIFY pgrst` + 6 verify queries

**2) Pure helpers** [`modules/leave_management.js`](modules/leave_management.js) (test-friendly):
- `defaultLeavePolicies()` — in-code fallback
- `effectiveQuotaForUser({userId, leaveType, year, policies, overrides})` → priority **override > policy > default**
- `calcLeaveBalance({quota, approvedDays, pendingDays})` → `{quota, used, pending, remaining, overQuota, willExceed}`
- `calcBalancesForUser({...})` → `Map<leave_type, balance>` — filter ปี ด้วย overlap, skip rejected/cancelled, ปัด 2 ตำแหน่ง
- `isOverQuotaWarning` · `formatBalanceLabel`
- `fetchLeavePolicies` / `fetchLeaveOverridesForUser` — graceful return shape

**3) UI หน้าวันลา**
- Section "💼 Balance / Quota (year)" ใต้ KPI — admin มี dropdown เลือกพนักงาน, non-admin ของตัวเอง
- 5 cards พร้อม chip สี + source label
- Form modal `#lmFormQuotaWarn` advisory (recompute on user/type/days change · ไม่ block submit)

**4) Payroll modal integration**
- ปุ่ม "ดึงสรุปวันลา" → render advisory balance ทั้งปีของ user (5 cards) ใน `#prLeaveBalance`
- vacation/sick/personal ยังไม่หักเงิน · unpaid logic เดิม

**5) Safety**
- ไม่แตะ money math / staff_leaves write / payroll save / RLS เก่า
- ★ Time Clock self responsive (build 295) **ไม่ regression** — แตะแค่ leave_management.js + payroll.js + SQL
- ไม่เพิ่ม dep · escape HTML · event delegation · graceful HTTP/NO_TABLE
- form warning เป็น advisory ไม่ block

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **576/576** (เพิ่ม 28 จาก 548)
- `npm run test:e2e` = **11/11** (รอบแรก fail 1 ก่อน sync index.html — แก้แล้วผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.57.1 → **5.58.0**
- `index.html`: `style.css?v=295→296`, `selfheal.js?v=295→296` + `data-app-build="296"` + `data-app-version="5.58.0"`, `main.js?v=295→296`, `boot.js?v=295→296`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v296'` + v296 + v295 comment lines

### Smoke test (manual)
1. **รัน SQL ก่อน:** Phase 92.32 (ถ้ายัง) + Phase 92.35 → ตรวจ 6 verify queries
2. เปิด `https://boonsook-pos-v5.pages.dev/` (Ctrl+Shift+R)
3. **Admin:** เข้า "🌴 วันลา" → เห็น "💼 Balance / Quota (2026)" + dropdown · ลองสร้างคำขอที่จะเกิน quota → เห็นป้ายส้ม advisory · อนุมัติแล้ว balance update · "💰 รายการเงินเดือน" → กด "ดึงสรุปวันลา" เห็น 5 cards balance ทั้งปี
4. **Non-admin:** เห็น balance ของตัวเอง · ขอลาเกิน quota → ป้าย advisory · ส่งได้
5. **Graceful** (ก่อนรัน SQL): UI แสดง 5 cards + ป้าย "ใช้ค่า default" สีส้ม (ไม่ crash)
6. **Regression check:** Time Clock self responsive (build 295) — mobile 390px ไม่ล้น · desktop 1440px shell ~1120px

### Follow-ups (ค้างจงใจ — ลำดับแนะนำ)
| ลำดับ | ค้าง | บริบท |
|---|---|---|
| 1 | Admin manage policies UI | "ตั้งค่า → Leave Policy" ให้ admin แก้ quota default ผ่าน UI |
| 2 | Per-user override UI | สร้าง `staff_leave_overrides` ผ่าน UI |
| 3 | Paid leave policy ต่อ leave_type | ตัดสินใจ vacation/sick/personal เกิน quota → หักเงิน |
| 4 | Calendar leave view | ใช้ `modules/calendar.js` |
| 5 | Payslip รายละเอียดวันลา | section ในใบจ่ายเงินเดือน |
| 6 | เชื่อม Time Clock → leave | approved leave → chip ใน HR Overview status table |
| - | Audit tab modal (ค้างจาก 92.30) · Late rule (ค้างจาก 92.29) · Edit attendance modal 7-วัน (ค้างจาก 92.30) | |

---

> ⚠️ **SQL ที่ต้องรัน** (จาก 92.32, ยังจำเป็น): [`supabase-phase92-32-leave-management.sql`](supabase-phase92-32-leave-management.sql) — ก่อนเริ่มใช้ปุ่ม "ดึงสรุปวันลา" ใน Payroll modal. ก่อนรัน → ปุ่มยังกดได้แต่แสดง warning + ไม่ crash. **เฟส 92.33 ไม่มี SQL ใหม่** (additive code only).

---

## 🕒 Phase 92.34 — Time Clock self-service responsive fix (this session)

**บริบท:** user แจ้งว่า mobile หน้า “ลงเวลาทำงาน” ล้นขวาหนัก แต่ desktop กลับเล็กเกินไปกลางจอ. สาเหตุหลักคือ `_renderSelfView()` ใน `modules/time_clock.js` ใช้ inline `max-width:680px` และ table/card sizing ที่เหมาะกับ desktop card เดียว ไม่ใช่ responsive layout.

### สิ่งที่แก้

- `modules/time_clock.js`
  - เปลี่ยน self view markup เป็น class-based: `tc-self-shell`, `tc-self-profile`, `tc-self-action-card`, `tc-self-summary`, `tc-self-history`
  - คง ID ปุ่มเดิม `tcSelfClockIn` / `tcSelfClockOut` เพื่อไม่กระทบ event handlers
  - ไม่แตะ flow ลงเวลา, offline queue, GPS/geofence, OT calculation
- `style.css`
  - Desktop: shell กว้าง `min(1120px, 100%)`, top area เป็น profile + action card, summary/history เต็มความกว้าง
  - Mobile: single column, จำกัด `max-width:100%`, ปุ่มเต็มความกว้าง, table history scroll เฉพาะใน wrapper
  - เลี่ยง global `.panel table { min-width:760px }` เพราะ self view ไม่ใช้ `.panel` outer แล้ว
- Version/cache sync:
  - `package.json`: 5.57.0 → **5.57.1**
  - `index.html`: `?v=294→295`, `data-app-build="295"`, `data-app-version="5.57.1"`
  - `sw.js`: cache `v294→v295` + comment

### Smoke checklist

- Mobile Time Clock: content no longer overflows page; only history table can scroll horizontally inside its block. Playwright check: viewport/body/page = 390px, table wrapper = 344px client / 520px scroll.
- Desktop Time Clock: no longer tiny 680px card in the middle of large screen. Playwright check: shell width = 1120px at 1440px viewport.
- Attendance behavior unchanged. Gates: lint:errors 0/0, unit 548/548, e2e 11/11, audit moderate 0 vulnerabilities.

---

## 💸 Phase 92.33 — Leave → Payroll Integration (this session)

**บริบท:** ต่อจาก Phase 92.32 (Leave foundation) — user ขอเชื่อม leave เข้า payroll **แบบ advisory + optional apply** — ดึงสรุปได้, คำนวณ suggested deduction ของ `unpaid` leave ได้, แต่ admin ต้องกด apply เอง. vacation/sick/personal **แสดงข้อมูลเฉย ๆ** ไม่หักเงินในเฟสนี้.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ใน [`modules/leave_management.js`](modules/leave_management.js) (export ครบ)**
- `summarizeApprovedLeavesForPayroll(leaves)` → `{totalApprovedDays, unpaidDays, sickDays, personalDays, vacationDays, otherDays, records}`
  - skip non-approved status / invalid days_count (≤0, NaN)
  - leave_type unknown → `otherDays` bucket
  - ปัด 2 ตำแหน่งทุก field (กัน float drift 0.1+0.2)
- `calcUnpaidLeaveDeduction({unpaidDays, dailyRate, baseSalary})` → number (ปัด 2 ตำแหน่ง)
  - priority 1: `unpaidDays × dailyRate` (ต้อง dailyRate > 0)
  - priority 2: `(baseSalary / 30) × unpaidDays` (ต้อง baseSalary > 0)
  - invalid (days≤0, NaN, ไม่มี rate/base) → 0
- `fetchApprovedLeavesForUser(userId, fromDate, toDate)` — **graceful** REST helper:
  - URL: `staff_leaves?status=eq.approved&user_id=eq.X&start_date=lte.Y&end_date=gte.Z&order=start_date.asc&limit=200`
  - return shape: `{ok:true, rows}` หรือ `{ok:false, code, message}` — code: `BAD_INPUT` / `NO_CONFIG` / `NO_TABLE` (HTTP 400/404) / `HTTP`
  - ★ **ไม่ throw** — caller branch ได้ตาม code

**2) Payroll modal UX** [`modules/payroll.js`](modules/payroll.js)
- import 3 helpers จาก `./leave_management.js`
- เพิ่ม HTML block ใหม่ใน modal **ก่อน Time Clock section** (ที่ Phase 92.26 เพิ่ม):
  - ขอบสีส้ม + title "🌴 วันลาในรอบเดือน"
  - ปุ่ม **📥 ดึงสรุปวันลา**
  - `#prLeaveSummary` placeholder
  - `#prLeaveApplyRow` (hidden by default): แสดง suggested deduction + source description + ปุ่ม "→ เติมลงช่องหัก"
- Handlers (5 new):
  - `prFetchLeaveBtn` click → calc from/to ของเดือนนั้น → `fetchApprovedLeavesForUser` → branch on `ok`/`code`
  - `_setLeaveSummary(html, isError)` — text/HTML in summary box
  - `_hideLeaveApplyRow()` — reset apply state
  - `_refreshLeaveSuggestion()` — recompute amount + source label
  - `prFillLeaveBtn` click → **additive** (`current + amount`) + ต่อ note "หักลาไม่รับค่าจ้าง N วัน" (idempotent — skip ถ้ามี marker อยู่แล้ว) + trigger recalc total + hide apply row + show success
  - Listen `prBase` / `prDailyRate` / `prDailyToggle` changes → re-call `_refreshLeaveSuggestion` (ถ้า admin แก้ฐานเงินเดือนหลังดึงสรุป)
- Summary breakdown แสดงเฉพาะ bucket ที่ > 0 + `unpaidDays` ตัวหนาสีแดง

**3) Safety**
- ★ ไม่ auto-mutate — admin ต้องกด "เติม" เอง
- ★ vacation/sick/personal/other แสดงข้อมูลแต่ไม่หักเงิน (เฟสถัดไป)
- additive ที่ `deductions` — ไม่ทับค่าเดิม, ป้องกัน double-apply ด้วยการ hide apply row หลังเติม
- graceful NO_TABLE → warning message (ไม่ crash modal)
- `escHtml` ทุก output ที่มี user data
- ไม่แตะ DB schema / RLS / money math เดิม / payroll save logic / dep ใหม่
- ไม่มี inline `onclick` — bind ผ่าน `addEventListener`

**4) Tests (+12)** [`tests/leave_management.test.js`](tests/leave_management.test.js):
- `summarizeApprovedLeavesForPayroll`: empty/null → zero / breakdown by 5 types / skip non-approved+invalid / unknown→other / float drift round
- `calcUnpaidLeaveDeduction`: dailyRate priority / baseSalary÷30 fallback / invalid→0 (5 cases) / round 2 decimals / negative dailyRate → fallback
- `fetchApprovedLeavesForUser`: missing args → `BAD_INPUT` / no config → `NO_CONFIG` (node test env)

### ขอบเขต (จงใจ — ตามข้อห้าม)
- ★ Advisory only — admin ต้องกด apply เอง · ไม่ auto-mutate · ไม่ auto-save
- ไม่หัก vacation/sick/personal — ต้องตัดสินใจ paid leave policy ในเฟสถัดไป
- ไม่แก้ DB schema (ไม่เพิ่ม `note_metadata` หรือ JSON detail) — เก็บ note เป็น text เดิม
- ไม่แตะ Payroll save / paid logic
- ไม่ refetch HR Overview / Leave Management — fetch แค่ตอนกดปุ่มใน modal

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **548/548** (เพิ่ม 12 จาก 536)
- `npm run test:e2e` = **11/11** (ครั้งแรก 10/11 flaky `APP_BUILD is set` — เคลียร์ใน rerun)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.56.0 → **5.57.0** (minor)
- `index.html`: `style.css?v=293→294`, `selfheal.js?v=293→294` + `data-app-build="294"` + `data-app-version="5.57.0"`, `main.js?v=293→294`, `boot.js?v=293→294`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v294'` + comment line

### วิธี smoke test
1. ตรวจว่ารัน SQL จาก Phase 92.32 แล้ว (`supabase-phase92-32-leave-management.sql`) — ถ้ายัง: ปุ่ม "ดึงสรุปวันลา" จะแสดง warning แทน crash
2. **สร้าง approved unpaid leave** สำหรับพนักงาน 1 คน:
   - ไปที่ **🌴 วันลา** → กด "+ ขอลา" → เลือกพนักงาน · ประเภท `ลาไม่รับเงิน` · ช่วงวันที่ในเดือนปัจจุบัน (เช่น 2 วัน) → ส่งคำขอ
   - กด **✓ อนุมัติ** ที่ row pending → status = "อนุมัติแล้ว"
3. ไปที่ **💰 รายการเงินเดือน** → กด "+ เพิ่มรายการเงินเดือน" หรือเปิดของพนักงานคนนั้น
4. **Test checklist:**
   - [ ] เห็น section สีส้ม "🌴 วันลาในรอบเดือน" ก่อน Time Clock section
   - [ ] กด "📥 ดึงสรุปวันลา" → แสดง breakdown รวมถึง "💸 ไม่รับค่าจ้าง 2" ตัวหนาแดง
   - [ ] แถวล่างแสดง "แนะนำหัก: ฿X" + source ("(2 วัน × ฿Y/วัน)" หรือ "(2 วัน × เงินเดือน÷30)")
   - [ ] กรอก base_salary 30,000 → "แนะนำหัก" คำนวณใหม่ทันที (`30000/30 × 2 = 2000`)
   - [ ] กด "→ เติมลงช่องหัก" → ช่อง "หัก (-)" เพิ่ม 2,000 (ถ้าเดิม 0 → 2000.00) + ช่องหมายเหตุได้ "หักลาไม่รับค่าจ้าง 2 วัน" + รวมสุทธิ recalc ทันที
   - [ ] apply row หาย → กดปุ่มซ้ำไม่ทำให้ deductions เพิ่มซ้ำ
   - [ ] กด save payroll → บันทึกสำเร็จ
5. **Graceful test** (ถ้ายังไม่รัน SQL Phase 92.32):
   - [ ] กด "ดึงสรุปวันลา" → แสดง "⚠️ ยังไม่ได้ติดตั้งตารางวันลา" สีแดง · modal ยังใช้งานได้

### Follow-ups (ค้างจงใจ — ลำดับแนะนำ)
- **Paid leave policy ต่อ leave_type** — กฎหัก/ไม่หัก vacation/sick/personal (เช่น vacation 10 วัน/ปีฟรี, เกิน → หัก; sick 30 วัน/ปีฟรี) — ต้องเพิ่ม `leave_quotas` ตารางหรือ Settings
- **Leave balance/quota ต่อปี** — quota per user + check ตอนสร้าง pending request
- **Calendar leave view** — มุมมองปฏิทินรวม leave ของทีม (ใช้ `modules/calendar.js`)
- **Payslip แสดงรายละเอียดวันลา** — section ในใบจ่ายเงินเดือนที่ list approved leaves ในรอบนั้น
- **เชื่อม Time Clock → leave** (ค้างจาก 92.32) — approved leave → chip ใน HR Overview "สถานะวันนี้"
- **Audit tab ใน employee modal** (ค้างจาก 92.30) — schema query `activity_log`
- **Late rule** (ค้างจาก 92.29) — กฎเวลามาสาย
- **Edit attendance ใน modal 7-วัน tab** (ค้างจาก 92.30)

---

---

## 🌴 Phase 92.32 — Leave Management Foundation (this session)

**บริบท:** ต่อจาก Phase 92.31 (HR dept/role filters) — user ขอ Leave Management foundation: SQL ใหม่ + UI หน้าใหม่ + HR Overview integration แบบเบา ๆ. **เฟสนี้ไม่หัก payroll ตาม leave** (follow-up).

### สิ่งที่เพิ่ม

**1) SQL migration** [`supabase-phase92-32-leave-management.sql`](supabase-phase92-32-leave-management.sql) (~160 บรรทัด):
- `CREATE TABLE staff_leaves` พร้อม 4 CHECK constraints (leave_type, status, end>=start, days>0)
- 5 indexes (user_id, status, start_date, end_date, created_at DESC)
- `_bump_staff_leaves_updated_at()` trigger
- 4 RLS policies:
  - `leaves_select_admin_or_self` — admin all / user own
  - `leaves_insert_admin_or_self_pending` — non-admin insert ได้เฉพาะ `status='pending'` ของตัวเอง
  - `leaves_update_admin_or_self_pending` — non-admin update ได้เฉพาะของตัวเอง **ที่ยัง pending** → กลายเป็น pending หรือ cancelled (ไม่สามารถ approve/reject ตัวเอง)
  - `leaves_delete_admin` — admin only
- `NOTIFY pgrst, 'reload schema'`
- 6 verify queries (table+columns / constraints / indexes / policies / trigger / row count)
- **Re-run safe** (CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE OR REPLACE FUNCTION)
- ★ Additive only — ไม่แตะ staff_attendance / staff_payroll / profiles / departments / RLS เก่า

**2) modules/leave_management.js** ใหม่ (~620 บรรทัด):
- **Pure helpers (export ครบ):**
  - `calcLeaveDays(start, end)` — inclusive (วันเดียว = 1)
  - `leaveTypeLabel(type)` → `{label, icon, bg, fg, border}` — sick/personal/vacation/unpaid/other + fallback
  - `leaveStatusMeta(status)` → `{label, bg, fg, border}` — pending/approved/rejected/cancelled + fallback
  - `filterLeaves(rows, {month, status, leaveType, userId})` — month overlap (start<=monthEnd AND end>=monthStart)
  - `summarizeLeaves(rows, month?)` → `{pending, approved, rejected, cancelled, total, approvedDays}`
  - `canEditLeave(row, currentUserId, role)` — admin all · non-admin own pending only
  - `canReviewLeave(row, role)` — admin + pending only (กัน double-review)
  - `fetchPendingLeaveCount()` — graceful 0 ถ้าตารางยังไม่มี (สำหรับ HR Overview)
- **UI:**
  - Header (Admin view / ของฉัน) + ปุ่ม ⟳ รีเฟรช + + ขอลา
  - KPI 4 cards (responsive)
  - Filter bar: เดือน (input type=month + ปุ่ม "ทุกเดือน") + status select + type select + Export
  - Table 8 columns (พนักงาน, ประเภท chip, ช่วงวันที่, วัน, เหตุผล, status chip, ผู้พิจารณา + note, action buttons)
  - Row action: approve/reject (admin+pending) · cancel (non-admin own pending) · delete (admin)
  - Form modal: dropdown พนักงาน (admin) · type · start/end + auto-calc days · reason · validation
  - Review flow: prompt() เก็บ `review_note` + confirm ก่อน PATCH
- **REST helpers:** `_fetchLeaves`, `_insertLeave`, `_patchLeave`, `_ensureProfilesLoaded` — graceful HTTP error
- **Defense-in-depth:** non-admin client filter ทับ RLS แม้ RLS เป็นด่านจริง

**3) Routing + sidebar**
- `index.html` sidebar HR group: ปุ่ม `🌴 วันลา` หลัง `🕒 ลงเวลาทำงาน` + `<section id="page-leave_management">`
- `main.js`:
  - `ALL_ROUTES` เพิ่ม `leave_management`
  - `ROLE_PAGES.technician` + `ROLE_PAGES.sales` เพิ่ม `leave_management` (admin ได้ผ่าน ALL_ROUTES)
  - `LAZY_ROUTES.leave_management = ["./modules/leave_management.js", "renderLeaveManagementPage"]`
  - page title `"วันลา"`

**4) HR Overview integration** (additive)
- `detectExceptions` รับ field ใหม่ `pendingLeaves` → push alert `kind: "pending_leaves"` (medium severity) เมื่อ > 0
- `alertActionFor("pending_leaves")` → `{label: "ไปอนุมัติ", route: "leave_management"}`
- `renderHrOverviewPage`: dynamic-import `leave_management.js` แล้วเรียก `fetchPendingLeaveCount()` (silent fail ถ้าตารางยังไม่มี → 0 → ไม่ขึ้น alert)
- **ไม่เปลี่ยน:** attendance/payroll calculation, KPI cards, filter bar เดิม

### ขอบเขต (จงใจ — ตามข้อห้าม)
- **เฟสนี้ leave ไม่ลด attendance/payroll** — admin ดูได้ในหน้าใหม่ + เห็น alert ใน HR Overview · การหัก/ไม่หักจะตัดสินใจในเฟสถัดไป
- ไม่ mark พนักงาน leave เป็นสถานะใน HR Overview status table (follow-up)
- Confirm ใช้ `window.confirm()` แทน custom modal เพื่อ minimal + เชื่อถือได้ (เปลี่ยนเป็น custom modal ในเฟสถัดไปได้)
- ไม่แตะ payroll/time_clock write behavior, money math, RLS เก่า
- ไม่เพิ่ม dependency
- escape HTML ทุก output จาก DB (display name, email, reason, review_note)
- ใช้ event delegation (tbody listener) ไม่มี inline onclick

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **536/536** (เพิ่ม 32 จาก 504)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.55.1 → **5.56.0** (minor — feature + SQL)
- `index.html`: `style.css?v=292→293`, `selfheal.js?v=292→293` + `data-app-build="293"` + `data-app-version="5.56.0"`, `main.js?v=292→293`, `boot.js?v=292→293`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v293'` + comment line

### วิธี smoke test (หลัง deploy + รัน SQL)
1. เปิด Supabase Dashboard → SQL Editor → รัน `supabase-phase92-32-leave-management.sql`
2. ตรวจ verify queries: table+columns (15) / constraints (4) / indexes (5+PK) / policies (4) / trigger (1) / row count (0)
3. เปิด `https://boonsook-pos-v5.pages.dev/` (Ctrl+Shift+R)
4. **Admin checklist:**
   - [ ] เห็นเมนู **🌴 วันลา** ใน HR group
   - [ ] KPI 4 cards โหลด (รออนุมัติ/อนุมัติแล้ว/ปฏิเสธ/รวมวัน)
   - [ ] กด **+ ขอลา** → form modal เปิด → เลือกพนักงาน → ส่งคำขอ → row ปรากฏใน table
   - [ ] กด **✓ อนุมัติ** ที่ row pending → prompt note → confirm → status chip เปลี่ยนเป็น "อนุมัติแล้ว"
   - [ ] กด **✕ ปฏิเสธ** → flow เดียวกัน, status = "ปฏิเสธ"
   - [ ] เปลี่ยน filter เดือน/status/type → table+KPI update
   - [ ] Export Excel → ไฟล์ดาวน์โหลด
   - [ ] กลับไป **📊 ภาพรวม HR** → ใน "🛎️ สิ่งที่ต้องจัดการวันนี้" เห็น alert "คำขอลารออนุมัติ N รายการ" + ปุ่ม "ไปอนุมัติ →" นำทางกลับ "วันลา"
5. **Non-admin checklist (sales/technician):**
   - [ ] เห็นเมนู **🌴 วันลา** เหมือนกัน
   - [ ] หน้าแสดง "ของฉัน" — เห็นเฉพาะของตัวเอง (RLS server-side)
   - [ ] กด **+ ขอลา** → form ไม่มี dropdown พนักงาน (user_id auto-set)
   - [ ] กด **ยกเลิก** ที่ row pending ของตัวเอง → status = "ยกเลิก"
   - [ ] ไม่เห็นปุ่ม ✓/✕ approve/reject (admin only)
   - [ ] ไม่เห็นปุ่ม 🗑️ delete

### Follow-ups (ค้างจงใจ — รออนุมัติเฟสถัดไป)
- **หัก/ไม่หัก payroll ตาม leave type** — ต้องตัดสินใจกฎ (เช่น unpaid → หักจาก daily_rate × days_count, vacation → ไม่หัก) → ค่อยทำเฟส 92.33
- **Calendar leave view** — มุมมองปฏิทินรวม leave ของทั้งทีม (อาจใช้ `modules/calendar.js` ที่มีอยู่แล้ว)
- **Leave balance ต่อปี** — quota per user (vacation 10 วัน/ปี, sick 30 วัน/ปี) + ตรวจตอนสร้างคำขอ
- **เชื่อม Time Clock** — วันลา approved → แสดงในตาราง HR Overview "สถานะวันนี้" เป็น chip "ลาป่วย/ลากิจ/พักร้อน" แทน "ยังไม่เข้า"
- **Audit tab ใน employee modal** (ค้างจาก 92.30) — schema query `activity_log` decision
- **Late rule** (ค้างจาก 92.29) — กฎเวลามาสายใน Settings
- **Edit attendance ใน modal 7-วัน tab** (ค้างจาก 92.30) — inline edit ใน drill-down

---

---

## 🔎 Phase 92.31 — HR Overview Department/Role Filters (this session)

**บริบท:** ต่อจาก Phase 92.30 (Employee modal) — user ขอ filter แผนก + role เพิ่ม เพื่อให้ admin ตัดมุมมองให้แคบลงได้เร็ว (เช่น "เฉพาะแผนกช่าง role technician สถานะกำลังทำงาน"). Filter ทำงาน **in-memory** ไม่ refetch DB, KPI ด้านบนยังเป็นทั้งองค์กร (option A), ตารางและ summary สะท้อน filter.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ (export ครบ, test-friendly)**
- `filterHrRows(rows, {status, departmentId, role})` — รวม 3 filter พร้อมกัน · safe cast `String(did ?? "")` · `__none__` = unassigned, `__all__` = ทั้งหมด · `role:"other"` = ไม่ใช่ admin/sales/technician
- `countDepartmentBuckets(rows)` → `Map<deptId|"__none__", number>` · key เก็บเป็น string เสมอ
- `countRoleBuckets(rows)` → `{all, admin, sales, technician, other}`
- `isDefaultHrFilters(filters)` → boolean (สำหรับซ่อน/แสดงปุ่ม "ล้างตัวกรอง")
- `filterSummaryLabel(filters, total, filtered, departments)` → "แสดง 1 จาก 5 คน · แผนก: ช่าง · Role: Technician · สถานะ: กำลังทำงาน"
- `buildHrExportFilename(today, filters)` → "hr_overview_2026-05-26_dept-12_role-technician_working.xlsx" · sanitize: `[\\/:*?"<>|\x00-\x1f]` + whitespace + collapse `_+` + length cap 200 ก่อน `.xlsx`

**2) UI / interaction**
- เพิ่ม section secondary filter bar ระหว่าง status bar กับ tbody:
  - `_renderDeptDropdown(activeDept, departments, deptCounts)` — `<select>` มี options ทุกแผนก (count ในวงเล็บ) + "ไม่ระบุแผนก" ท้ายสุด
  - `_renderRoleChips(activeRole, roleCounts)` — segmented buttons + count badges · ซ่อน bucket ที่ว่างยกเว้น "all" และ active
  - ปุ่ม `#hrClearFiltersBtn` ขวาสุด (เฉพาะเมื่อ filter ไม่ default)
- เพิ่ม summary bar (`#hrSummaryBar`) เหนือตาราง
- **Cascade re-render** (`_rerenderFilters()` ภายใน scope):
  - dept counts = ใช้ rows ทั้งหมด (ไม่ขึ้นกับ filter อื่น)
  - role counts = filter rows ตาม dept ก่อน (ไม่รวม role+status)
  - status counts = filter rows ตาม dept+role ก่อน
  - visible rows = filter ครบทั้ง 3 axes
- Trigger re-render:
  - status chip click
  - dept select change
  - role chip click
  - "ล้างตัวกรอง" → reset ทั้ง 3 axes
- Event delegation อยู่ที่ `secondaryBarEl` — listen `change` (dropdown) + `click` (chips/clear) แยกกัน

**3) Export Excel** — ใช้ `filterHrRows` ดึง visible rows + `buildHrExportFilename` เพื่อสร้าง filename suffix ตาม filter

**4) Empty state** — เปลี่ยนข้อความใน `_renderTbody` จาก "ไม่มีพนักงานในสถานะที่เลือก" → **"ไม่พบพนักงานตามตัวกรองนี้"** เพราะตอนนี้ filter เป็น multi-axis

**5) Modal** — ทำงานเหมือนเดิม · row click delegation ตรวจ `closest("[data-hr-action]")` + `closest("button")` ก่อน → ปุ่ม clear / dropdown / role chip ไม่ trigger modal เพราะเป็น `<button>` หรือ `<select>`

### ขอบเขต (จงใจตามข้อห้าม)
- **ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior**
- ไม่ refetch DB เมื่อเปลี่ยน filter — ใช้ rows ที่โหลดแล้วใน memory
- ไม่เพิ่ม dependency ใหม่ (`dependencies: {}` คงเดิม)
- ไม่มี inline `onclick` — event delegation ทั้งหมด
- `escHtml` ทุก output จาก DB (dept name, dept id, role label)
- ถ้า `departments` โหลดไม่ได้ → dropdown ยังมี "ทุกแผนก" + "ไม่ระบุแผนก" ใช้งานได้

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **504/504** (เพิ่ม 26 จาก 478)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.55.0 → **5.55.1** (patch)
- `index.html`: `style.css?v=291→292`, `selfheal.js?v=291→292` + `data-app-build="292"` + `data-app-version="5.55.1"`, `main.js?v=291→292`, `boot.js?v=291→292`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v292'` + comment line

### Follow-ups (ค้างจงใจจาก phase ก่อนหน้า + ใหม่)
- **Audit tab ใน employee modal** — ต้องตัดสินใจ schema query ของ `activity_log` ก่อน (user_id อาจอยู่ใน `metadata` JSON ไม่ใช่ column ตรง)
- **Leave management** — ต้องเลือก schema (ตาราง `staff_leaves` vs flag `staff_attendance.leave_type`)
- **Late rule** — ตั้งกฎใน Settings (เช่น `clock_in_at > shiftStartHour + 15 min = late`) → ขึ้นเป็น exception ใน HR Overview + chip ใน modal
- **Edit attendance ใน modal 7-วัน tab** — ตอนนี้ admin edit ต้องไปหน้า Time Clock (มี modal แก้อยู่แล้ว Phase 92.25)
- **KPI ที่ตอบ filter (Option B)** — ถ้า user เปลี่ยนใจอยากให้ KPI ปรับตาม filter ค่อย flag

---

---

## 👤 Phase 92.30 — HR Employee Drill-down Modal (this session)

**บริบท:** ต่อจาก Phase 92.29 (HR Overview polish) — user ขอ modal รายละเอียดพนักงานเมื่อคลิกแถว เพื่อให้ admin ดูประวัติได้ในที่เดียวโดยไม่ต้องออกจากหน้า. 3 tabs: วันนี้ / 7 วันล่าสุด / เงินเดือน. Read-only ทั้งหมด.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ใน [`modules/hr_overview.js`](modules/hr_overview.js)** (export ครบ, test-friendly):
- `formatDistanceLabel(distance_m, radiusM)` → "—" / "120 ม." / "350 ม. (นอกพื้นที่)" — radius-aware
- `groupAttendanceLast7Days(rows, todayDate)` → `[{date, attendance[]}]` × 7 (วันนี้ + 6 ก่อนหน้า, เรียงใหม่→เก่า, fill empty days)
- `employeePayrollSummary(payrolls, profile)` → object หรือ `null` — match `String(p.employee_id) === String(profile.id)`, รวม base+ot+wel+bon+com-ded ถ้า `total_amount` หาย
- `buildEmployeeModalSummary(input)` → header object (name/role/dept/status/clockIn-Out/regular/ot/total/distances/notes/radius)
- `modalTabFor(key, validKeys, fallback)` → string (validate ป้องกัน injection)

**2) REST helper ใหม่ (lazy, modal-only)**
- `_fetchUserAttendanceRange(userId, fromDate, toDate)` — `staff_attendance?user_id=eq.X&work_date=gte.Y&lte.Z` (limit 200)

**3) UI / interaction**
- Modal HTML container: `<div id="hrEmployeeModal" style="display:none;position:fixed;inset:0;z-index:9999">` ใน `container.innerHTML` (hidden by default)
- **Row คลิกได้:** `<tr class="hr-row-employee" data-hr-employee="${userId}" cursor:pointer>` + title tooltip
- **Event delegation row click:** skip ถ้า `ev.target.closest("[data-hr-action]")` หรือ `closest("button")` → ปุ่ม action ในแถวไม่ถูก row click ทับ
- **Modal lifecycle:**
  - `_openModal(userId)` → set `activeUserId` + `activeTab="today"` + display:block + lock body scroll + bind Esc
  - `_closeModal()` → null state + display:none + restore scroll + unbind Esc
  - `_renderModal()` → header + tab bar + body + footer (re-render on tab switch)
- **Tabs:**
  - `today` → reuse data จาก HR Overview rows (instant)
  - `week` → lazy fetch (cache per userId) → `groupAttendanceLast7Days` → table 7 วัน + open session highlight + summary footer
  - `payroll` → `employeePayrollSummary` (reuse data.payrolls) → table 6 หมวด + total + paid chip + payment date/method + note + ปุ่มไป Payroll
- **Closes:** `#hrModalClose` (✕ มุมขวาบน), `#hrModalCloseBottom` (ปุ่มล่าง), `#hrModalBackdrop` (คลิกพื้นหลัง), Esc key

**4) Safety**
- Admin only (inherit จาก `requireAdmin()` ของ HR Overview)
- `escHtml` ทุก output (name, email, dept, notes, payment_method, date strings, error message)
- Read-only — ไม่มี mutation ที่ใด
- Graceful error: week tab fetch fail → ไม่ crash, แสดง error banner ในตาราง
- ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior
- ไม่เพิ่ม dependency ใหม่

**5) Tests (+19)** [`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- `formatDistanceLabel`: null/empty/invalid / no-radius (round) / radius in-out / radius invalid skip
- `groupAttendanceLast7Days`: empty todayDate / always 7 entries / group by work_date / outside-window excluded / non-array rows
- `employeePayrollSummary`: empty/no-id null / no-match null / computed total fallback / use total_amount from DB / string-uuid cast
- `buildEmployeeModalSummary`: full fields / empty input fallback / display name email-prefix fallback
- `modalTabFor`: valid keys passthrough / invalid → 'today' / custom validKeys + fallback

### ขอบเขต (จงใจตามข้อห้าม)
- **Audit tab ยังไม่ทำ** (per user instruction: "optional, ใส่ follow-up ถ้าไม่ชัวร์") — ค้างเป็น follow-up เพราะ `activity_log` ใช้ entity_id แบบ generic ต้องตัดสินใจ schema query ก่อน (user_id อาจอยู่ใน metadata JSON ไม่ใช่ column ตรง)
- ไม่มี inline `onclick` — event delegation ทั้งหมด
- ไม่ refactor logic เดิม (filter bar / KPI / alerts) — additive ทั้งหมด

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **478/478** (เพิ่ม 19 จาก 459)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.54.1 → **5.55.0** (minor)
- `index.html`: `style.css?v=290→291`, `selfheal.js?v=290→291` + `data-app-build="291"` + `data-app-version="5.55.0"`, `main.js?v=290→291`, `boot.js?v=290→291`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v291'` + comment line

### Follow-ups (ถ้าผู้ใช้เลือกทำต่อ)
- **Audit tab** — ตัดสินใจ schema query ของ `activity_log` ก่อน (user_id อาจอยู่ใน `metadata` JSON column → ต้อง JSONB query) แล้วเพิ่ม tab + helper `buildEmployeeAuditQuery`
- **Department / role filter** ที่หน้า HR Overview — เพิ่ม second-row filter (dept dropdown + role toggle)
- **Leave management** — ตัดสินใจ schema (`staff_leaves` ตารางใหม่ vs `staff_attendance.leave_type` flag) ก่อนทำ UI
- **Late rule** — ตั้งกฎใน Settings (เช่น `clock_in_at > shiftStartHour + 15 min = late`) → ขึ้นเป็น exception ใน HR Overview + chip ใน modal วันนี้
- **Edit attendance ใน modal** — ตอนนี้ปุ่มในตาราง 7 วันยังไม่มี edit; admin edit ต้องไปหน้า Time Clock (มี modal แก้อยู่แล้วใน Phase 92.25)

---

---

## ✨ Phase 92.29 — HR Overview polish + filters + actionable alerts (this session)

**บริบท:** ต่อจาก Phase 92.28 (HR Overview MVP) — user ขอ polish ให้ใช้งานจริงระดับมืออาชีพ: filter ตาราง, action จาก alert, visual polish (role chip / status wording), row action dynamic ตาม status, payroll shortcut, quick actions reorder. **Additive only** — ไม่รื้อ behavior เดิม.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ใน [`modules/hr_overview.js`](modules/hr_overview.js)** (test-friendly, export ครบ):
- `countStatusBuckets(rows)` → `{all, not_in, working, out, abnormal}` — สำหรับ count บนปุ่ม filter
- `filterRowsByStatus(rows, status)` → rows ที่ filter แล้ว (graceful: "all"/unknown → คืนทั้งหมด)
- `rowActionLabel(status)` → `{label, icon, color}` — dynamic ตาม status
- `roleChipMeta(role)` → `{label, bg, fg, border}` — admin ม่วง / sales ฟ้า / technician เขียว
- `alertActionFor(kind)` → `{label, route} | null` — mapping kind → route ที่จะนำทาง

**2) UI changes**
- **Filter bar** (segmented buttons) เหนือตาราง — แสดง count ในแต่ละปุ่ม, default "all", click → re-render `tbody` เท่านั้น (ไม่ refetch)
- **Role chip** ในคอลัมน์ "แผนก / role" — แทน text เปล่า
- **Status wording:** `abnormal` "ผิดปกติ" → **"ต้องตรวจสอบ"** (ทั้ง chip, filter button, Export sheet)
- **Row action button** — label/icon/สี dynamic:
  - `not_in` → "▶️ ลงเวลา" (ฟ้า)
  - `working` → "⏱️ จัดการเวลา" (ส้ม)
  - `abnormal` → "⚠️ จัดการเวลา" (แดง)
  - `out` → "👁️ ดูเวลา" (เทา)
  - ทุกปุ่มไป `time_clock` route เหมือนเดิม
- **Alert action buttons** — ปุ่มขวาสุดของแต่ละ alert: stale/geofence/offline → Time Clock, unpaid_payroll → Payroll
- **KPI clickable** — Payroll card คลิกได้เมื่อ `payrollUnpaid > 0`, Offline Queue card คลิกได้เมื่อมี pending (keyboard: Enter/Space)
- **Quick actions reorder + label สั้น:** ลงเวลา / เงินเดือน / ภาพรวมเงินเดือน / แผนก / ประวัติ / Export (Export ยังเป็น primary green)

**3) Event delegation pattern**
- `container.addEventListener("click", ...)` — จับ `[data-hr-action]` ทุกตัว (KPI card, alert button, row button, quick action) → `showRoute(route)`
- `hrFilterBar` มี listener แยกสำหรับ `.hr-filter-btn` — ไม่ navigate, แค่ update local state + re-render `hrTbody`
- `hrExportBtn` ใช้ filter ปัจจุบัน + filename suffix (`_working`, `_not_in`, ฯลฯ)
- **ไม่มี inline `onclick`** ที่ไหนเลย — ตามข้อห้าม

**4) Tests (+21)** [`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- `countStatusBuckets`: empty / non-array / mixed counts / weird status counted in `all` only
- `filterRowsByStatus`: "all"/empty/undefined → copy / filter exact / unknown → all / non-array → `[]`
- `rowActionLabel`: not_in / working+abnormal / out / unknown+null+undefined fallback
- `roleChipMeta`: 4 known roles TH labels / distinct colors / unknown role label = string passthrough / null/undefined → "—"
- `alertActionFor`: 4 known kinds → correct route / unknown+null → null

### ขอบเขต (จงใจตามข้อห้าม)
- **ไม่แตะ DB / RLS / money math / payroll / time_clock behavior** — pure UI polish + additive helpers
- ไม่เพิ่ม dependency ใหม่ (`dependencies: {}` คงเดิม)
- ไม่มี inline `onclick` — event delegation ทั้งหมด
- `escHtml` ทุก output จาก DB (profile name, email, dept name)
- ถ้า fetch บางตาราง fail → ยังแสดง warning banner เดิม + ตัวเลขที่โหลดได้ (ไม่ crash)

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **459/459** (เพิ่ม 21 จาก 438)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.54.0 → **5.54.1** (patch)
- `index.html`: `style.css?v=289→290`, `selfheal.js?v=289→290` + `data-app-build="290"` + `data-app-version="5.54.1"`, `main.js?v=289→290`, `boot.js?v=289→290`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v290'` + comment line

### Follow-ups (ถ้าผู้ใช้เลือกทำต่อ)
- **Drill-down modal รายพนักงาน** — คลิกชื่อ/แถว → modal แสดง history 7 วัน + payroll history (ปัจจุบันคลิก row action ไปหน้า Time Clock เลย)
- **Filter ตามแผนก/role** — เพิ่มอีกแถว filter (department dropdown + role chip toggle)
- **Leave / วันลา** — ต้องตัดสินใจ schema (ตาราง `staff_leaves` หรือ `staff_attendance.leave_type`) ก่อน
- **KPI "มาสาย"** — ต้องตั้งกฎเวลามาสายใน Settings ก่อน (เช่น clock_in_at > shiftStartHour + 15 min = late)

---

---

## 📊 Phase 92.28 — HR Center / ภาพรวม HR (this session)

**บริบท:** user ขอ HR Overview เพื่อรวมข้อมูล Time Clock + Payroll + Departments + Profiles เป็นศูนย์กลางให้ admin เห็นสถานะพนักงาน/การลงเวลา/เงินเดือน/exceptions ในหน้าเดียว ต่อยอดจากระบบที่ทำเสร็จแล้ว (ไม่สร้าง SQL ใหม่ ไม่แตะ behavior เดิม).

### สิ่งที่เพิ่ม

**1) modules/hr_overview.js** (ใหม่, ~440 บรรทัด) — read-only dashboard
- **Pure helpers (test-friendly):**
  - `classifyAttendanceStatus(row, {now, staleHours=14})` → `"not_in" | "working" | "out" | "abnormal"`
  - `aggregateHrKpi({profiles, attendanceToday, attendanceMonth, payrollsThisMonth, shiftOpts, offlinePending})` → KPI object
  - `detectExceptions({attendanceToday, payrollsThisMonth, offlinePending, geofence, opts})` → list of `{kind, severity, message, userId, refId}` — kinds: `stale_session`/`geofence_out`/`unpaid_payroll`/`offline_pending`
  - `indexAttendanceByUser(rows)` → `Map<user_id, latest row>` (priority: open > closed > newest clock_in)
- **UI structure:**
  - Header (วันที่ TH + กะปัจจุบัน) + ปุ่ม ⟳ รีเฟรช
  - KPI grid responsive `auto-fit minmax(180px,1fr)` — 5–6 cards
  - Section "🛎️ สิ่งที่ต้องจัดการวันนี้" — empty state ✅ ถ้าไม่มี
  - Table "🧑‍💼 สถานะพนักงานวันนี้" — sort `working → abnormal → out → not_in` แล้วตามชื่อ TH
  - Section "⚡ Quick actions" — 5 ปุ่มเปลี่ยน route + Export Excel
- **Reuse จาก time_clock.js:** `workDateBangkok`, `timeBangkok`, `computeRegularOT`, `sumRegularOT`, `shiftHoursFromState`, `profileDisplayName`, `offlinePendingCount`
- **REST queries (5 ขนาน):**
  - `profiles_with_email` (fallback `profiles`) — filter role≠customer
  - `departments?is_active=eq.true`
  - `staff_attendance?work_date=eq.${today}` (today)
  - `staff_attendance?work_date=gte.${monthStart}&lt.${monthEnd}` (เดือน, limit 2000)
  - `staff_payroll?period_month` ของเดือนปัจจุบัน

**2) Routing + sidebar**
- `index.html`: sidebar HR group เพิ่มปุ่ม **📊 ภาพรวม HR** ก่อน "ตั้งค่าแผนก" + `<section id="page-hr_overview">`
- `main.js`:
  - `ALL_ROUTES` เพิ่ม `hr_overview` → admin เข้าได้ (ROLE_PAGES.admin = ALL_ROUTES); sales/technician/customer ไม่มีใน ROLE_PAGES → sidebar auto-hide
  - `LAZY_ROUTES.hr_overview = ["./modules/hr_overview.js", "renderHrOverviewPage"]`
  - page title `"ภาพรวม HR"`

**3) Tests (+22)** [`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- classifyAttendanceStatus: null/working/out/abnormal/staleHours custom/clock_out-without-in
- aggregateHrKpi: empty/presentToday distinct/OT calc closed-only/payroll counts+amounts/offlinePending normalize
- detectExceptions: empty/stale_session/geofence in+out/no-geofence-skip/unpaid count/offline_pending/multi-issue order
- indexAttendanceByUser: open prio/newest clock_in/skip no-user_id/non-array

### ขอบเขต (จงใจ)
- **No DB change** — schema reserve จาก phase 92.22+92.22e+92.24 ใช้ได้ทันที
- **No money/time_clock/payroll/RLS change** — pure additive read-only dashboard
- **Admin only** — guard ฝั่ง client (UX) + RLS เป็นด่านความปลอดภัยจริง
- ไม่แตะ utils_formatters, ui_states — ใช้ของเดิม
- ไม่ขอ GPS ในหน้านี้ — แค่อ่าน `distance_m` ที่ time_clock บันทึกไว้

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **438/438** (เดิม 416 + 22 ใหม่)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.53.1 → **5.54.0**
- `index.html`: `style.css?v=288→289`, `selfheal.js?v=288→289` + `data-app-build="289"` + `data-app-version="5.54.0"`, `main.js?v=288→289`, `boot.js?v=288→289`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v289'` + บรรทัดเปลี่ยนแปลงเพิ่ม

### Follow-ups (ถ้าผู้ใช้เลือกทำ)
- เพิ่ม drill-down: คลิกพนักงาน → modal แสดง history 7 วัน + payroll history
- เพิ่ม filter: เลือกแผนก / role
- KPI "ขาด/มาสาย" (ต้องตั้งกฎเวลามาสายใน Settings ก่อน)
- "วันหยุด/ลา" (ยังไม่มีตารางในระบบ — ต้องตัดสินใจ schema)

---

> 🟢 **Time Clock feature ครบทุก aspect ตามที่ user ขอตั้งแต่ Phase 92.22:**
> - ✅ Manager + Self-service flow (92.22 / 92.22e pivot)
> - ✅ OT auto-detect (>17:00 + Settings shift hours) (92.25 / 92.25b)
> - ✅ Admin edit + audit log (92.25)
> - ✅ Payroll integration (auto-fill OT) (92.26)
> - ✅ GPS geo-fence (92.24)
> - ✅ Offline queue + auto-sync (92.27)

> 🟢 **สถานะ ณ ปัจจุบัน:** Phase 92.25 พร้อม push (lint 0/0, unit 393). **ไม่ต้องรัน SQL migration** — ใช้ schema เดิมจาก Phase 92.22e
> 🔵 **ค้าง (อิสระจาก deploy):**
> 1. **Phase 92.24** — GPS geo-fence (schema cols พร้อม)
> 2. **Phase 92.26** — Payroll integration (auto-fill `payroll.ot_hours/ot_amount` จาก `staff_attendance`)
> 3. **Phase 92.27** — Offline queue (IndexedDB + idempotency via `client_uuid` ที่ schema มีให้)
> 4. **Settings page (ถ้าจะทำ):** เปลี่ยนชั่วโมงกะมาตรฐาน (รอบนี้ hardcode 08-17 ใน computeRegularOT — ถ้าต้องการให้กำหนดเองค่อยเพิ่ม settings เฟสหลัง)

---

## 🏷️ Phase 92.22b — Fix About page version display drift (this session)

**ปัญหา:** หน้า "เกี่ยวกับระบบ" (Settings → About) แสดง `Version: 5.47.8` + `Release: May 2026 (build 274)` ทั้งที่ live = 5.48.1/278. ปุ่ม "ตรวจหาอัปเดต" บอก build 278 ถูก — แต่ header ของ About card แสดงเลขเก่า → user งง.

**Root cause:** [modules/settings/pages.js:25-26](modules/settings/pages.js:25) hardcode `<div>Version: 5.47.8</div>` + `<div>Release: May 2026 (build 274)</div>` — ค้างมาตั้งแต่ Phase 92.18 ผ่าน 5 phases (92.19/92.20/92.21/92.22/92.22-hotfix) ที่ผม **ลืม bump 5th sub-item**. Memory `feedback_version_display_sync.md` เคยเตือนเรื่องนี้แล้ว — บทเรียนที่ลืม.

### สิ่งที่แก้ (3 ไฟล์, +12/-6)
- **`selfheal.js`:** เพิ่ม `window.APP_VERSION` (mirror pattern ของ `window.APP_BUILD` ที่มีอยู่แล้ว) — read จาก `data-app-version` attribute ของ script tag
- **`index.html`:** `<script src="./selfheal.js?v=279" data-app-build="279" data-app-version="5.48.2">` — 2 attrs (build + version)
- **`modules/settings/pages.js`:** render `${window.APP_VERSION}` + `${window.APP_BUILD}` ผ่าน `escHtml` — fallback "-" ถ้า global ไม่ set

### ขอบเขต (จงใจ)
- **No behavior change** อื่น — แค่ render text ให้ตรงกับ build จริง
- **ไม่แตะ** money / DB / RLS / time_clock (ของก่อน) — pure UI display
- **Version-sync checklist กลับมา 4 จุด** (ไม่ใช่ 5) — pages.js auto-pickup จาก global, ไม่ต้องแก้ทุก phase อีก

### Lesson logged
4-sub-item checklist (APP_BUILD + main.js?v= + sw.js + pages.js) ที่ memory เตือน — pages.js เป็นจุดที่ลืมง่ายสุดเพราะอยู่ใน sub-module. แก้ refactor ให้ dynamic = ปิดถาวร. ถ้ามี version text hardcoded ที่อื่นในอนาคต ใช้ `window.APP_VERSION` / `window.APP_BUILD` ทันที.

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **380/380** (ไม่เปลี่ยน — UI text เปลี่ยน)
- e2e ผ่าน CI

---

## 🐛 Phase 92.22 HOTFIX — uuid type mismatch (last session)

**Root cause:** ผมเขียน SQL migration โดย assume `staff.id` เป็น bigint (เพราะ `customers.id`, `sales.id`, products tables ใน repo ทุกตัวเป็น bigserial) — **แต่ `staff.id` ใน prod เป็น uuid** (table ถูกสร้างผ่าน Supabase Dashboard ก่อนหน้านี้ ไม่ผ่าน migration script ใน repo). Postgres reject ตอน CREATE TABLE ด้วย error 42804.

### สิ่งที่แก้
- **`supabase-phase92-22-time-clock.sql`:** `staff_id bigint` → `staff_id uuid` (1 บรรทัด) + comment เตือน
- **`modules/time_clock.js:425`:** `Number(tcStaffSelect.value)` → `value?.trim() || ""` (uuid string passthrough; Number() เปลี่ยน uuid → NaN)

### ที่ตรวจแล้วไม่เปลี่ยน
- `_findMyStaff` query by `auth.uid()` — uuid match uuid อยู่แล้ว
- `_fetchAttendance` URL `staff_id=eq.${encodeURIComponent(staffId)}` — รับ uuid string
- `staffMap[s.staff_id]` — string key OK
- `data-clock-out-id` + `Number(btn.dataset.clockOutId)` — attendance.id = bigserial → Number() ยังถูก
- compare `String(_mgrFilterStaff) === String(s.id)` — string compare อยู่แล้ว

### Re-run instructions
- SQL migration เดิมที่รันไปครึ่งทาง (ALTER staff สำเร็จ + CREATE TABLE fail) → **safe to re-run**
  - ALTER จะเป็น no-op (column มีแล้ว — IF NOT EXISTS)
  - CREATE TABLE staff_attendance รอบนี้จะสำเร็จ (uuid match)
  - Indexes + policies + verify queries จะรันต่อจากจุดที่ค้าง

### บทเรียน — บันทึกเป็น memory
- ก่อนเขียน FK ต่อ table ที่ไม่ได้สร้างใน repo migration → **ตรวจ type ใน Supabase Dashboard / `information_schema.columns` ก่อน**
- อย่า assume type จากดู JS module ที่ใช้ sb client (type-agnostic)
- `feedback_id_type_mismatch` memory เตือนเรื่อง customers.id แล้ว — บทเรียนนี้ต่อยอด: ตรวจทุก FK target

---

## 🕒 Phase 92.22+92.23 — Time Clock Foundation + Self-service (last session)

**บริบท:** user ขอระบบลงเวลาเข้า-ออกงาน (clock-in/clock-out) เลือกแบบ "ครบเครื่อง" 4 มิติ (mixed manager+self / GPS / full scope / offline queue) → แตกเป็น 6 phases (92.22-92.27). เฟสนี้ครอบ **Foundation + Self-service** (92.22+92.23) — manager flow ใช้งานได้ทันทีหลัง SQL apply + self-service เปิดให้ staff ที่ผูกบัญชี Supabase Auth.

### สิ่งที่เพิ่ม

**1) DB migration** [`supabase-phase92-22-time-clock.sql`](supabase-phase92-22-time-clock.sql) (~170 lines):
- `ALTER TABLE staff`: เพิ่ม `user_id uuid REFERENCES auth.users(id)` + `email text` (case-insensitive UNIQUE)
- `CREATE TABLE staff_attendance` — fields ครบสำหรับ phases ต่อ:
  - `id, staff_id, work_date, clock_in_at, clock_out_at`
  - GPS reserve (Phase 92.24): `clock_in_lat/lng/distance_m`, `clock_out_lat/lng/distance_m`
  - Idempotency (Phase 92.27): `client_uuid` (partial UNIQUE)
  - Source tracker: `source CHECK IN ('admin','self','queued')`
  - Audit: `notes`, `created_by`, `created_at`, `updated_at` (trigger auto-bump)
- **Indexes:**
  - `idx_attendance_staff_date` (staff_id, work_date DESC) — query history
  - `idx_attendance_one_open_session` UNIQUE WHERE `clock_out_at IS NULL` — ★ กัน 2 open sessions/staff
  - `idx_attendance_client_uuid` UNIQUE WHERE NOT NULL — idempotency
- **RLS:** 4 policies (admin all / staff self ผ่าน user_id link)
- `NOTIFY pgrst, 'reload schema'` + verify queries ที่ท้ายไฟล์ (5 จุด)

**2) `modules/time_clock.js`** (~480 lines):
- Pure helpers (testable): `workDateBangkok` (Asia/Bangkok), `timeBangkok`, `workHours`, `clockState`, `sumWorkHours`, `canAutoClaim` (case-insensitive + null-safe)
- `renderTimeClockPage(ctx)` → fork by role:
  - **Manager view** (admin): active sessions card + clock-in form (dropdown staff) + report tab (date range filter + staff filter + Export CSV)
  - **Self-service view** (sales/technician + linked): clock in/out ของตัวเอง + week summary + 7-day history
- **Auto-claim flow:** user ที่ยังไม่มี staff link → query `staff WHERE email=auth.email() AND user_id IS NULL` → PATCH `user_id=auth.uid()` (one-shot)
- **Graceful errors:** HTTP 404/400 (table ไม่มี) → `NO_TABLE` error → UI โชว์ "ยังไม่ได้ติดตั้ง schema" + ปุ่ม retry
- **Race guards:** `if (btn.isConnected)` หลัง await ทุก mutation (เรียนรู้จาก Phase 92.21)
- REST fetch ตรง (ไม่ใช่ supabase-js client) — เป็น pattern เดียวกับ `payroll.js` / `sale_trace.js`

**3) Wire 4 ที่:**
- `main.js` `LAZY_ROUTES.time_clock` + `ROLE_PAGES.sales/technician` (admin มี ALL_ROUTES อยู่แล้ว)
- `index.html` sidebar button (ใต้ HR group) + `<section id="page-time_clock">`
- `modules/staff.js` add/edit modal: เพิ่มช่อง **อีเมล** + format validation + payload `email`

**4) Tests** [`tests/sale_trace.test.js`](tests/sale_trace.test.js) ใหม่ +24 ตัว:
- `workDateBangkok` — TZ correctness (UTC midnight crossover → Bangkok next day)
- `timeBangkok` — null/invalid date → "-" (no Invalid Date string leak)
- `workHours` — both/null/reversed/missing → 0 ปลอดภัย
- `clockState` — open/closed/none
- `sumWorkHours` — sum + ignore open sessions
- `canAutoClaim` — happy/case-insensitive/already-claimed/mismatch/null-inputs (7 ตัว — กัน auth bypass)

### ขอบเขต (จงใจ — เก็บไว้ Phase ต่อ)
- ❌ **ไม่แตะ** posting / payroll math / accounting / RLS อื่นใด
- ❌ **ไม่บังคับ GPS** — schema reserve cols ไว้ Phase 92.24 จะมาเปิดใช้
- ❌ **ไม่ทำ offline queue** — schema มี `client_uuid` ให้แล้ว Phase 92.27 จะใช้
- ❌ **ไม่ทำ OT calc** — Phase 92.25
- ❌ **ไม่ link payroll** — Phase 92.26

### Decision log
- **Manager + Self รวมใน module เดียว** (ไม่แยก 2 ไฟล์) — render fork ตาม role; deps + utils ใช้ร่วมกัน, DRY
- **Auto-claim เลือก email match แทน admin invite** — ไม่ต้อง backend extra (Cloudflare Function) + ทำงานในขอบเขต Supabase RLS
- **REST fetch ไม่ใช้ sb client** — pattern ใหม่ใน accounting/* / sale_trace.js (consistent)
- **Email UNIQUE บน `lower(email)`** — กัน confusing "JOHN@ex.com" ≠ "john@ex.com"

### ⚠️ SQL Apply Instructions (admin ต้องทำหลัง deploy)
1. Supabase Dashboard → SQL Editor → New query
2. Copy ทั้งไฟล์ [`supabase-phase92-22-time-clock.sql`](supabase-phase92-22-time-clock.sql) → Paste → **Run**
3. ตรวจ result panels ของ verify queries ท้ายไฟล์ (5 ตาราง):
   - (a) staff: 2 columns ใหม่ (email, user_id)
   - (b) staff_attendance: 16 columns
   - (c) Indexes: 5 ตัว (idx_attendance_*, idx_staff_email_unique, idx_staff_user_id_unique)
   - (d) Policies: 4 ตัว (att_select_admin_or_self, att_insert_..., att_update_..., att_delete_admin)
   - (e) RLS enabled: true
4. **Re-run safe** — ใช้ `IF EXISTS`/`IF NOT EXISTS`/`DROP IF EXISTS` ทุกตัว
5. หลังรัน → กลับมาที่หน้า "ลงเวลาทำงาน" → กดปุ่ม retry (ถ้า error card ขึ้น) หรือรีโหลด

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **380/380** (เดิม 356 + 24 ใหม่)
- e2e จะรันใน CI

---

## 🛡️ Phase 92.21 — Guard race on async badge handlers (last session)

---

## 🛡️ Phase 92.21 — Guard race on async badge handlers (this session)

**บริบท:** GH scanner (CodeQL) เตือนทุก PR build = "Possible race condition: `btn.disabled`/`btn.textContent` might be assigned based on an outdated state of `btn`" ที่ async badge click handlers ใน sales.js + audit_log.js (code จากเฟส 92.17/92.18). ผลกระทบจริงต่ำมาก (one-shot click + replaceWith) แต่ scanner รบกวน PR review ทุกรอบ + ถ้า list re-render ตอน `await findJournalForSale` pending = mutate orphan node (no-op) หรือ `btn.replaceWith()` throw silently.

### สิ่งที่เพิ่ม (2 ไฟล์, +12/-2)
- **`modules/sales.js`** (~line 167): ใส่ `if (!btn.isConnected) return;` หลัง try/catch ของ `await findJournalForSale(saleId)` — ก่อน `wrap.innerHTML = renderSaleTraceBadge(...)` + ก่อน `btn.replaceWith(badgeEl)`
- **`modules/audit_log.js`** (~line 163): pattern เดียวกัน

### ขอบเขต (จงใจ)
- **No behavior change** สำหรับ flow ปกติ (non-racy) — guard ทำงานเฉพาะเคส list re-render ระหว่าง async lookup
- **ไม่แตะ** logic ของ `findJournalForSale` / `renderSaleTraceBadge` / `navigateToJv`
- pattern เดียวกับ "เปิดบิล" handler ที่ [modules/sales.js:147](modules/sales.js:147) (`if (btn.isConnected) btn.disabled = false;`) มีอยู่แล้ว = consistent

### Tests
ไม่เพิ่ม test ใหม่ — เป็น defensive guard ที่ test ยากใน jsdom (ต้อง simulate list re-render mid-await). Pattern verified แล้วใน production code [modules/sales.js:147](modules/sales.js:147)

### Version sync (4 จุด)
- `index.html`: `data-app-build="276"`, `main/boot/selfheal/style.css?v=276`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v276'` + comment v276
- `package.json`: `5.47.9 → 5.47.10`

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **356/356** (ไม่เพิ่ม test ใหม่ — defensive guard)
- e2e จะรันใน CI

---

## 🔗 Phase 92.20 — JV drawer deep-link from 3 trace surfaces (last session)

**ปัญหาเดิม:** Phase 92.17/92.18 เพิ่มปุ่ม 📒 trace ใน 3 surface (sales list / receipt drawer / audit log) — กดแล้วไปหน้าสมุดรายวันเฉย ๆ ผู้ใช้ต้องเลื่อนหา JV เอง. มี `data-jv-id` พร้อมใน badge อยู่แล้วแต่ยังไม่ใช้.

### สิ่งที่เพิ่ม (4 ไฟล์ core + 1 test)
- **`modules/accounting/journals.js`:**
  - export ใหม่ `setPendingJvId(id)` — 1-shot module-level state สำหรับ deep-link target
  - หลัง `renderJournalsPage` fetch entries สำเร็จ → consume pending → `queueMicrotask(_openJvDrawer)`; ถ้า id ไม่อยู่ใน 200 entries ล่าสุด → `console.info` แล้วผ่าน (ไม่ crash)
  - error path เพิ่ม clear `_pendingOpenJvId = null` → กัน stale consume ถ้า user navigate ออก/กลับมาทีหลัง
- **`modules/accounting/sale_trace.js`:** export ใหม่ `navigateToJv(jvId, opts)` async — dynamic import `journals.js` (lazy, ไม่ดึง 167KB accounting bundle เข้า eager path) → `setPendingJvId` → `showRoute("accounting_journals")`. inject `showRoute`/`importModule` ได้สำหรับ test. fallback ถ้า import ล้ม = navigate ปกติ
- **Wire 3 surfaces:**
  - `modules/sales.js` — badge click `goto` ใช้ `navigateToJv(badgeEl.dataset.jvId)`
  - `main.js` `_fillReceiptAcctTrace` — `goto` = `closeAllDrawers(); navigateToJv(...)` (ปิด receipt drawer ก่อน)
  - `modules/audit_log.js` — `goto` = `navigateToJv(badgeEl.dataset.jvId)`

### ขอบเขต (จงใจ)
- **ไม่แตะ** posting / `auto_post` / money / stock / loyalty / RLS / SQL — เพิ่มเฉพาะ navigation glue + 1 read-only consume hook
- **No URL state** (ไม่ใช่ `#accounting_journals?jv=42`) — เพราะ pending เป็น 1-shot click intent, ไม่ใช่ shareable link
- **`badgeEl.dataset.jvId` มีอยู่แล้ว** (Phase 92.17 ตั้งไว้ใน `renderSaleTraceBadge`) — diff ไม่แตะ badge HTML
- guard ใน `_openJvDrawer` มีอยู่แล้ว (`document.getElementById("jvDrawer")?.remove()`) — ไม่ open ซ้อน

### Tests (`tests/sale_trace.test.js`, +6 = 24 ตัว)
`navigateToJv`: happy path (set pending + showRoute) / string id pass-through / null+empty+undefined → false / no router → false / import fail → ยัง navigate / setPendingJvId missing → ไม่ throw. inject mock — ไม่แตะ DOM/network จริง.

### Version sync (4 จุด)
- `index.html`: `data-app-build="275"`, `main.js?v=275`, `boot.js?v=275`, `selfheal.js?v=275`, `style.css?v=275`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v275'` + comment v275
- `package.json`: `5.47.8 → 5.47.9`
- `modules/settings/pages.js:195`: dynamic (`window.APP_BUILD`) → auto pickup

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **356/356** (เดิม 350 + 6 ใหม่)
- e2e จะรันใน CI

---

## 🔧 Phase 92.19 — Bump GH Actions to Node 24-ready majors (this session)

**บริบท:** HANDOFF 92.18 ระบุ "CI deprecation (low)" — GH Actions เตือนว่า `actions/checkout@v4` + `wrangler-action@v3` รัน Node 20 → จะถูกบังคับเป็น Node 24 หลัง **2 มิ.ย. 2026** (เหลือ ~9 วัน) ปล่อยไว้ = CI พังหลัง deadline → block merge/deploy

### สิ่งที่เปลี่ยน (2 ไฟล์, 6 บรรทัด)
- `.github/workflows/test.yml`: `actions/checkout@v4 → @v5`, `actions/setup-node@v4 → @v5`
- `.github/workflows/main.yml`: `actions/checkout@v4 → @v5` (x2), `cloudflare/wrangler-action@v3 → @v4`, `docker/setup-buildx-action@v3 → @v4`

### Risk / scope (จงใจ)
- **CI-only** — ไม่แตะ runtime/app code, ไม่ bump APP_BUILD/version/SW cache (live ยัง build 274 ตามเดิม)
- **Minimum bump** = เลือก major แรกของแต่ละ action ที่ใช้ Node 24 (ไม่ jump ไป v6/v4.1) เพื่อจำกัด blast radius + rollback ง่าย
- `wrangler-action@v4` inputs `apiToken`/`accountId`/`command` = identical, `pages deploy` = unchanged (verified จาก official README)
- **wrangler binary default เป็น v4** (จากเดิม v3) — `pages deploy` รองรับเต็มในทั้งสอง major. ถ้าพบ regression สามารถ pin `wranglerVersion: "3"` กลับได้
- ไม่แตะ `actions/setup-node` version input (`node-version: "20"` ยังเดิม — `setup-node@v5` action ใช้ Node 24 ภายใน, แต่ runtime project ยัง pin Node 20 ตาม `package.json.engines`)

### Gates
- `npm run lint:errors` = clean (0 errors) บน local
- `npm test` = **350/350 pass** บน local
- CI `Tests` workflow บน PR branch = ✅ success (verify job + e2e 11)
- CI `Tests` + `Deploy to Cloudflare Pages` บน main หลัง merge = ✅ success ทั้งคู่ (Deploy in 30s, Docker build in 14s — wrangler v4 deploy สำเร็จ first try)
- Live smoke: `data-app-build="274"`, `main.js?v=274`, `style.css?v=274`, SW `cache-v274` = ตรงตามก่อน merge (ไม่เปลี่ยน — ตามที่ตั้งใจ)

---

## 📒 Phase 92.18 — Audit Log accounting trace (deleted POS sales) (this session)

**Task A finding (สำคัญ):** mission เดิมสมมติว่ามี row `delete_sale` ใน Audit Log ให้ติด trace — **แต่ trace ทั้ง repo + git history แล้ว `sales.js` soft-delete ไม่เคยเรียก `logActivity` เลย** → ไม่มี row นั้นจริง. deletion logs ที่มี (delete_receipt/invoice/quotation) ล้วน key คนละ entity (receipts/delivery_invoices) ไม่ใช่ `source_table='sales'`. รายงาน user → เลือก **"เพิ่ม delete_sale log ก่อน แล้ว trace"**.

### สิ่งที่เพิ่ม (read-only trace + 1 best-effort log write)
- **`modules/sales.js`** (soft-delete commit, หลัง toast): เขียน `logActivity("delete_sale", { entityType:"sale", entityId:saleId, summary, metadata:{bill_no,customer_id,customer_name,total_amount} })` — **best-effort**: ห่อ `try{}` + logActivity กลืน error เอง → log fail **ไม่ทำให้การลบ fail**. ไม่ await-block flow สำคัญ
- **`modules/accounting/sale_trace.js`**: เพิ่ม `saleIdFromAuditLog(row)` — คืน sale id เฉพาะเมื่อ `entity_type==='sale' && entity_id` (string); อย่างอื่น → null. **ห้ามเดา** จาก summary/doc_no/customer/amount
- **`modules/audit_log.js`**: row ที่ `saleIdFromAuditLog()` คืนค่า → ปุ่ม **📒 ดูบัญชี** → on-demand `findJournalForSale` (reuse 92.17) → แทนปุ่มด้วย badge; found = กด/Enter ไป `showRoute("accounting_journals")`; missing/error = ข้อความชัด ไม่เงียบ

### ขอบเขต (จงใจ)
- **ไม่แตะ** posting / `auto_post` / stock / loyalty / money math / RLS / SQL — JV lookup เป็น read-only; key = `source_table='sales' + source_id`
- delete_sale log เป็น **additive write** ที่ mirror pattern ของ `delete_receipt` ที่มีอยู่แล้ว (utils.js `logActivity`)

### Tests (`tests/sale_trace.test.js`, +8 = 18 ตัว)
`saleIdFromAuditLog`: sale-row→id / receipt-row→null / missing-id→null / summary-only(no entity_type)→null / garbage→null. trace flow: log→found / missing→"ยังไม่ลงบัญชี" / error→"ตรวจบัญชีไม่ได้" (no throw).

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit **350** (342→+8), e2e 11)

### หมายเหตุ smoke
delete_sale log **เริ่มเขียนตั้งแต่ build 274** → บิลที่ลบ**ก่อน** deploy 274 จะไม่มี row ใน Audit Log (เป็นปกติ). ต้องลบบิลใหม่หลัง deploy ถึงจะเห็นปุ่ม 📒 ดูบัญชี

---

## 🔗 Phase 92.17 — Accounting trace links (POS sale → JV) (this session)

**ปัญหาเดิม:** ระบบ auto_post สร้าง JV (`SV — ขาย`) ให้ทุก POS sale อยู่แล้ว แต่ฝั่ง user-facing **ไม่เห็น linkage** — หน้ารายการขายเห็นแค่เลขบิล BSK-..., ใบเสร็จไม่มี "เอกสารบัญชี" → user เข้าใจว่า "ไม่ลิงก์กับบัญชี" ทั้งที่ลิงก์อยู่ใน DB.

### Reliable key (Task A — audit ก่อนลงมือ)
- **Canonical 1:1:** `journal_entries.source_table='sales'` + `source_id=sale.id` (บังคับ unique ด้วย partial index `idx_je_source_unique`, ดู `auto_post.js:13`)
- `doc_no` (`SV{YYYY}{MM}{####}`) / `description` (`ขาย POS {order_no} — {customer}`) = **label เท่านั้น ห้ามใช้เป็น key**
- **Reverse link มีอยู่แล้ว:** หน้าสมุดรายวัน `journals.js` มี JV drawer → source row (`SOURCE_LABELS`, `_fetchSourceRow`) — เฟสนี้เพิ่ม **forward** (sale → JV) ที่ขาด
- **ข้อจำกัด:** journal entries **ไม่ได้อยู่ใน `state`** (loadAllData ไม่ดึง) → helper ต้อง fetch REST on-demand

### สิ่งที่เพิ่ม (read-only, additive)
- **helper ใหม่ `modules/accounting/sale_trace.js`:**
  - `findJournalForSale(sale, {fetch,cfg,token})` → `{ok, found, status:'found'|'missing'|'error'|'invalid', entry, error}` — fetch JV ด้วย key หลัก (inject fetch ได้สำหรับ test); ไม่ throw ทุก path
  - `renderSaleTraceBadge(result, {compact})` → HTML string (escaped); found = `.sale-acct-trace` + `data-acct-route="accounting_journals"` + `data-jv-id` (click target), missing = "ยังไม่ลงบัญชี", error = "ตรวจบัญชีไม่ได้" — **ทุกสถานะมีข้อความ ไม่เงียบ**
- **Surface 1 — sales list (`modules/sales.js`):** ปุ่ม **📒 บัญชี** ต่อแถว → on-demand lookup → แทนปุ่มด้วย badge; found = กด/Enter ไป `showRoute("accounting_journals")`
- **Surface 2 — receipt drawer (`main.js` `renderReceiptDrawer` + `_fillReceiptAcctTrace`):** section "เอกสารบัญชี" + placeholder "⏳ กำลังตรวจสอบ..." → async fill; found click = `closeAllDrawers()` + นำทาง

### ขอบเขต (จงใจ)
- **ไม่แตะ** posting / `auto_post` / money / stock / loyalty / RLS / SQL — เพิ่มแค่ read-only lookup + UI
- on-demand fetch (ไม่ดึง 200 JV ตอน render list) — online-only view, offline = badge "ตรวจบัญชีไม่ได้" (ไม่ crash)

### Tests (`tests/sale_trace.test.js`, 10 ตัว)
found / missing / error(403+throw) / invalid(no id, no fetch) + badge click-target (route+jv-id) + missing-not-silent + XSS escape doc_no. Inject fetch mock — ไม่แตะ network จริง.

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit **342** (332→+10), e2e 11 รวม build-version-sync)

---

## 🔍 Phase 92.16 — Console noise audit (this session)

**เป้าหมาย:** audit สิ่งที่ขึ้นใน DevTools Console จาก smoke flows หลัก แล้วแยก SAFE_NOISE / ACTIONABLE_LOW / BUG — **สรุป: ไม่เจอ bug จริง** ในเส้นทางที่ตรวจ.

### ตาราง classification (Task A)

| Console text | Source file:line | Level (เดิม → ใหม่) | Classification | Action |
|---|---|---|---|---|
| `Could not find window.__TAURI_METADATA__` | external lib (ไม่มีใน source เรา) | warn (lib) | **SAFE_NOISE** | document only — เป็น Tauri-env detection ของ lib ภายนอก, browser-only, แก้ที่โค้ดเราไม่ได้ |
| `Service Worker was updated because "Update on reload" was checked` | Chrome DevTools | info (browser) | **SAFE_NOISE** | document only — DevTools setting ของผู้ใช้ ไม่ใช่โค้ดเรา |
| `Deleting old cache: boonsook-pos-v5-cache-v<N>` | `sw.js:64` | `console.log` | **SAFE_NOISE** | keep — SW cache cleanup ปกติตอน activate (เห็นทุก build bump) |
| `[auto_post] ✅ created <doc> ...` | `accounting/auto_post.js:316` | `console.info` ✅ | **SAFE_NOISE** | already info — ไม่แตะ |
| `[auto_post] voided N JV(s) for ...` | `accounting/auto_post.js:129` | `console.info` ✅ | **SAFE_NOISE** | already info — ไม่แตะ |
| `[sales delete] loyalty reverse attempt: {...}` | `sales.js:263` | `console.log` → `console.info` | **ACTIONABLE_LOW** | demote — trace ที่คาดไว้ทุกครั้งที่ลบ ไม่ใช่ปัญหา |
| `[sales delete] loyalty reverse skipped: <reason>` | `sales.js:279` | `console.log` → `console.info` | **ACTIONABLE_LOW** | demote — expected no-op (no earn / already reversed / remaining=0) |
| `[refunds] loyalty reverse skipped: <reason>` | `refunds.js:442` | `console.log` → `console.info` | **ACTIONABLE_LOW** | demote — เหมือน sales path เพื่อ consistency |
| `[sales delete] loadAllData timeout after committed delete: ...` | `sales.js:301` | `console.warn` ✅ | **SAFE_NOISE** | keep warn — Phase 92.15 ระบุชัดว่า delete commit สำเร็จแล้ว, แถวไม่เด้งกลับ; warn เหมาะแล้ว |
| `[sales delete] loyalty reverse failed/exception` | `sales.js:281,285` | `console.warn` | (correct) | keep — real failure path ต้องเห็น |

**Real failure logs ที่ "คงไว้เป็น warn/error โดยตั้งใจ"** (ห้าม demote): `[auto_post] unbalanced/entry insert failed/rollback FAILED/voidJV silent fail` (`auto_post.js`), `[refunds] loyalty reverse failed/threw` (`refunds.js:444,447`), `[sales delete] error` (`sales.js:306`). พวกนี้คือสัญญาณบั๊กจริง — ต้องดังไว้.

### สิ่งที่แก้ (Task B — logging only)
- `sales.js:263` loyalty reverse **attempt** diagnostic: `console.log` → `console.info`
- `sales.js:279` loyalty reverse **skipped**: `console.log` → `console.info`
- `refunds.js:442` loyalty reverse **skipped**: `console.log` → `console.info`

### ขอบเขต (จงใจ)
- **ไม่แตะ** money / POS checkout / stock CAS / JV / loyalty side-effect — เปลี่ยนแค่ระดับ log ของ 3 บรรทัดที่เป็น expected no-op
- **ไม่** blanket-monkeypatch console, **ไม่** ลบ diagnostic ที่มีประโยชน์, **ไม่** กลบ error จริง
- ไม่มี SQL / ไม่ install package / ไม่ refactor กว้าง

### Known browser-only warnings (document — ไม่ต้องแก้)
- `Could not find window.__TAURI_METADATA__` — จาก lib ภายนอก, ปกติบนเว็บ (ดู `CLAUDE_SESSION_HANDOFF.md:158`)
- `Service Worker was updated because "Update on reload" was checked` — DevTools setting ของผู้ใช้
- `Deleting old cache: ...v<N>` — SW activate cleanup ปกติ (เห็นทุกครั้งที่ build เลื่อน)

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit 332, e2e 11 — รวม build-version-sync checks)

### Test note (Task C)
ไม่เพิ่ม test — เป็น log-level change ล้วน ไม่กระทบ return shape / behavior; ไม่มี test เดิม assert ข้อความ log เหล่านี้ (ตรวจแล้ว).

---

## 🗑️ Phase 92.15 — Sale delete refresh resilience (this session)

อาการเดิม: ลบบิลในหน้า "รายการขาย" (admin) เป็น **soft-delete** — PATCH `sales.note = "[ลบแล้ว] ..."`. List ซ่อนแถวที่ลบผ่าน `visibleSalesForRole()` (`utils.js:111` filter `note.includes("[ลบแล้ว]")`). แต่ handler เดิม (`modules/sales.js`) **ไม่แตะ `state.sales` ในเครื่องเลย** — พึ่ง `await loadAllData()` ดึงใหม่จาก server เพื่อให้แถวหาย. ถ้า `loadAllData()` timeout (เน็ตช้า) → `state.sales` ไม่ refresh → **แถวที่ลบยังค้างจอ ทั้งที่ toast ขึ้น "ลบรายการขายเรียบร้อย ✅"** (งง).

### สิ่งที่แก้ (`modules/sales.js`, หลัง side-effects เสร็จ ก่อน background reload)
- เติม optimistic update — `localSale.note = newNote` (mirror สิ่งที่ server PATCH ทำเป๊ะ) → `_renderSalesView(...)` ซ้ำทันที → แถวหายเลยเพราะ `visibleSalesForRole()` กรอง `[ลบแล้ว]`
- เลือก **set-note** ไม่ใช่ splice ทิ้ง — เพื่อให้ consumer อื่นที่ filter `[ลบแล้ว]` (P&L/report `main.js:2040, 3826`) consistent ไม่ว่า reload จะสำเร็จหรือไม่
- `loadAllData()` หลัง committed delete = best-effort จริง — log warn `"loadAllData timeout after committed delete"` แทน, แถวไม่เด้งกลับ
- `finally` reset ปุ่ม safe อยู่แล้ว: หลัง re-render ปุ่มเก่าหลุด DOM → `btn.isConnected === false` → ไม่ไป reset node เก่า

### ขอบเขต (จงใจ)
- **ไม่แตะ** money/stock/JV/loyalty side-effect (void JV / revert stock / reverse loyalty คงเดิมทุกบรรทัด) — แก้เฉพาะ local state mirror + re-render ของ list view
- delete fail จริง (0 rows / RLS) ยัง throw → outer catch → toast error เหมือนเดิม (แยกจาก refresh timeout ชัดเจน)

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit 332, e2e 11)

---

## 💰 Phase 92.14 — Money/accounting closure (this session)

ปิด should-fix ที่เหลือจาก money audit 4.1 แบบแคบ + TDD. **✅ MERGED PR #39 + deploy build 270 + smoke PASSED (21 พ.ค. 2026).** ไม่แตะ SQL/RLS, ไม่แตะ proven paths (loyalty CAS, atomicDecrementStock, credit CAS, receipt open, SW).

### 1. round2 — cart total (pos.js) + refund total (refunds.js)
- **pos.js:** มี 5 จุด inline `cart.reduce((s,i)=>s+i.qty*i.price,0)` ดิบ (display, quickPay default, checkout amount) → extract `export function cartSum(cart)` = `round2(Σ)` แทนทั้ง 5. checkout **write path** (total_amount/line_total/...) round2 อยู่แล้ว (Phase 89.2) — นี่คุม in-memory + เงินทอนที่โชว์ ไม่ให้ค้าง 0.30000000000000004
- **refunds.js:** ยอดคืน reduce ดิบ → ลง DB `refund_amount` + JV (postJournalForRefund) ไม่ตรงสตางค์. extract `export function refundTotal(items)` = `round2(Σ)` ใช้ที่ preview (333) + actual write (355)
- Tests: `tests/money_round2_helpers.test.js` (+7)

### 2. verify-slip mismatch confirm (functions/api/verify-slip.js)
- แยก verification block (เดิม inline ใน onRequestPost) → `export function buildSlipVerification(parsed, expectedAmount, expectedRecipient)` (pure → unit-test ได้)
- **Hardening:** เดิมถ้ามี `expected_amount > 0` แต่ OCR อ่านยอดสลิปไม่ได้ (`amount ≤ 0`) → ไม่มี warning → `is_safe` อาจ true → 3 ฟอร์มโชว์ "✅ ผ่านการตรวจสอบ" **หลอก** ทั้งที่ไม่เคยเทียบยอด. แก้: กรณีนี้ `amount_match=false` + warning "อ่านยอดในสลิปไม่ได้ — ยืนยันยอด X เองก่อนรับชำระ" → `is_safe=false`
- ผู้ใช้ร่วม: `ac_install.js` / `service_form.js` / `solar.js` ล้วน gate display ด้วย `v.is_safe === true` → fix เดียวคุมทั้ง 3 (ไม่ต้องแตะ 3 ไฟล์)
- **ขอบเขต (จงใจ):** ยังเป็น advisory display — ไม่ได้ใส่ hard `confirm()` dialog บน save handler ของแต่ละฟอร์ม (จะกระจาย 3 ไฟล์ = เกิน scope/risk). is_safe ที่แม่นขึ้นทำให้ "⚠️ ต้องตรวจเพิ่มเติม" โชว์เชื่อถือได้ — ถ้าต้องการ dialog gate เป็น follow-up แคบ ๆ
- Tests: `tests/verify_slip_verification.test.js` (+8)

### 3. Audit — journal_entries RLS: closed หรือยัง?
**✅ CLOSED — verified on prod 24 พ.ค. 2026** (3 read-only queries, user รันใน Supabase SQL Editor)
- auto_post.js insert `journal_entries` ตรงจาก client (PostgREST). Policy `je_insert_auto` (phase89-25) อนุญาต non-accountant insert เมื่อ `source_table`+`source_id` ไม่ null. `postJournalForSale` ส่งครบ → ถ้า policy active = staff insert ผ่าน
- Phase 92.13 เพิ่ม graceful handling: 403/42501 → warn "JV deferred" (ไม่ crash, sale ผ่าน). User รายงานเห็น `[auto_post] created...` ในรอบหลัง → policy active confirmed
- **Verify evidence (24 พ.ค. 2026, prod Supabase):**
  - **Q1** `pg_policies` บน 3 tables → **10 rows ครบ:** `je_select/update/delete/insert_auto`, `jl_select/update/delete/insert_auto`, `am_select/write` (ทั้ง 2 `*_insert_auto` มี `has CHECK` clause ตามที่ Phase 89.25 ตั้งใจ)
  - **Q2** `is_accountant()` function → 1 row, `returns=boolean` (function ที่ policy USING/CHECK เรียกใช้ มีจริง)
  - **Q3** `pg_class.relrowsecurity` บน 3 tables → 3 rows, `rls_enabled=true` ทุกตัว (`rls_forced=false` ปกติ — owner bypass ได้)
- **สรุป:** non-accountant role (cashier/sales/technician) สามารถ auto-post JV ได้ตราบใดที่ส่ง `source_table` + `source_id` ครบ; HTTP 403 ที่เคยเห็นตอนรอบ Phase 92.13 น่าจะเป็น session test ที่ role ไม่ตรงเงื่อนไข — ไม่ใช่ DB state issue

### Gates
- lint 0/0 · unit 317 → 332 · e2e 11 · verify exit 0 (clean run)

### Manual smoke after deploy (build 270) — ✅ PASSED (21 พ.ค. 2026)
1. ✅ Ctrl+Shift+R → 5.47.4 (build 270)
2. ✅ **Cash recon refund (ของจริง):** คืนเงินสด 1 รายการ → cash recon วันนั้น → "ควรมีในลิ้นชัก" ลดตามยอด refund (ไม่ false "ขาด") — ยืนยัน Phase 92.12 fix ทำงาน live
3. ✅ Refund บิลที่มีราคาทศนิยม → `refund_amount` ตรงสตางค์ (ไม่มี ...0001)
4. ✅ POS cart หลายชิ้นราคาทศนิยม → ยอด/เงินทอนสะอาด
5. ✅ Verify slip ที่อ่านยอดไม่ได้ (รูปมัว) ในฟอร์มบริการ → ไม่ขึ้น "✅ ผ่าน" หลอก, ขึ้น "⚠️ ต้องตรวจ + ยืนยันยอดเอง"

---

## 🐛 Phase 92.13 — Production smoke bugs (previous session)

Build 268 live, user smoke tested. เจอ console errors จริง 2 จุด → fix. **No push yet (awaiting user confirm — production deploy).**

### Task A — journal_entries RLS 403 (auto-post JV)
- **อาการ:** `[auto_post] entry insert failed: HTTP 403 code 42501 ... row-level security policy for table "journal_entries"`
- **วินิจฉัย:** auto_post.js POST `journal_entries` ตรงจาก client (PostgREST). RLS policy `je_insert_auto` (อนุญาต non-accountant insert เมื่อ source_table+source_id ไม่ null) **ไม่มีใน prod** ทั้งที่ `postJournalForSale` ส่ง source ครบ → 403. นี่คือ **DB state issue แก้ JS-only ไม่ได้** (bypass RLS = fake success → ห้าม)
- **POS sale ไม่เคยถูก block:** `postJournalForSale({...}).catch(...)` ใน pos.js เป็น fire-and-forget; `_postJournal` catch แล้ว return null. sale บันทึกสำเร็จเสมอ
- **JS hardening (build นี้):** แยกเคส 403/42501 ออกจาก error ทั่วไป → `console.warn` ข้อความชัด "JV deferred (RLS) — source saved OK; verify je_insert_auto policy" แทน `console.error "entry insert failed"` ที่ดูเหมือน crash. ไม่เปลี่ยน return (ยัง null = ไม่ fake)
- **🔴 DB ACTION (ต้องทำฝั่ง Supabase, ไม่ใช่ deploy นี้):** รัน/verify `supabase-phase89-25-fix-je-rls-pos.sql` ใน prod SQL editor. **discrepancy:** SESSION_LOG line 139 ระบุ `✅ DONE (10 policies created)` แต่ live ยัง 403 → policy อาจถูก revert/หายจาก prod หรือ apply ผิด project. ไฟล์มี verify query (SELECT pg_policies) ท้ายไฟล์ — รันแล้วต้องเห็น 10 rows (je_*×4, jl_*×4, am_*×2). เช็ค `public.is_accountant()` ว่ายังมีอยู่ด้วย

### Task B — stock_movements type constraint บน sale delete (Blocking, fixed)
- **อาการ:** `[xhrPost] stock_movements ERROR: code 23514 ... check constraint "stock_movements_type_check"` ตอนลบบิล
- **สาเหตุ:** `_revertStockForSale` (main.js ~2920) insert `type: "return_sale"` — ไม่อยู่ใน allowed set ของ constraint. allowed types (จาก flow ที่ทำงานได้): `in/out/adjust/transfer/sale/return` (constraint ไม่อยู่ใน tracked SQL — มาจาก migration เก่า)
- **แก้:** `return_sale` → `return` (semantic เดียวกัน = สต็อกคืนกลับคลัง; refund restock ก็ใช้ `return` อยู่แล้ว) — main.js เท่านั้น, ไม่แตะ checkout decrement (`sale`) / transfer (`transfer`)
- **Regression test:** `tests/stock_movement_type_guard.test.js` (+3) — สแกน main.js: ทุก `xhrPost("stock_movements", {type})` ต้องอยู่ใน allowed set + ห้ามมี `return_sale` + reverse block ต้องใช้ `return`

### Task C — role/menu audit (credit payment page)
- **ข้อสรุป: ไม่ใช่ admin-only / ไม่ได้ hidden.** `credit_tracker`:
  - อยู่ใน `ROLE_PAGES.sales` (main.js:596) → sales role เข้าถึงได้
  - มี sidebar nav button: `index.html:275` กลุ่ม "💰 การเงิน" (data-group="finance") → "💳 ลูกค้าค้างชำระ" (sub-item)
  - main.js:786 แสดง/ซ่อน nav-btn ตาม ROLE_PAGES → sales เห็นปุ่มนี้
- **ทำไม user ไม่เห็น:** เป็น sub-item ใน group "การเงิน" ที่ยุบอยู่ (ต้องกดขยายกลุ่มก่อน) — เป็น UX discoverability ไม่ใช่ bug/permission
- **วิธี test Phase 92.12 credit flow (staff):** login sales → sidebar → ขยาย "💰 การเงิน" → "💳 ลูกค้าค้างชำระ" → เลือกบิลเชื่อที่ยังค้าง → "💰 รับชำระ"

### Gates
- lint 0/0 · unit 314 → 317 · e2e 11 · verify exit 0 (clean run)

### Manual smoke after deploy (build 269)
1. Staff POS cash sale → ไม่มี console error ใหม่ (JV 403 ถ้ายังไม่รัน SQL จะขึ้น warn "JV deferred" — ไม่ใช่ error/crash, sale ผ่าน)
2. ลบ/refund บิล → ไม่มี stock_movements 23514, สต็อกคืนกลับ
3. Journal: ถ้ารัน phase89-25 SQL แล้ว → JV ลงจริง (console.info "✅ created"); ถ้ายังไม่รัน → warn "JV deferred" ชัดเจน ไม่มี success หลอก

### Recommend next
- รัน `supabase-phase89-25-fix-je-rls-pos.sql` ใน prod (Task A real fix) → JV auto-post กลับมาทำงานสำหรับ staff
- ถ้า JV เคยพลาดช่วง 403 → ใช้ accounting backfill UI re-post

---

## 💰 Phase 92.12 — Money audit fixes (previous session)

จาก money audit (CLAUDE.md 4.1): money handling แข็งแรง (round2 centralized, VAT correct, double-entry balance, loyalty idempotent — verified) แต่เจอ **1 Blocking + 1 Should-fix**. แก้แบบ **JS-only ไม่มี SQL migration** (column NUMERIC → client CAS พอ), TDD ทั้งคู่. **No push yet (awaiting user confirm — money path, production deploy).**

### 1. 🔴 [Blocking] credit_tracker: รับชำระหนี้ non-atomic
- **ปัญหา:** `credit_tracker.js:278` เดิม `const newPaid = sale._paid + amount; PATCH credit_paid_amount = newPaid` — read-modify-write เขียนค่า absolute จาก `sale._paid` (state อาจ stale). 2 staff รับชำระบิลเดียวกันพร้อมกัน → เขียนทับกัน → **payment หาย + A/R เกินจริง**. `credit_payments` ledger (source of truth) ครบ แต่ `sales.credit_paid_amount` (denormalized cache) drift
- **แก้:** เพิ่ม generic CAS `atomicAddToField({...delta})` ใน `stock_cas.js` (โครงเดียวกับ `atomicDecrementStock` แต่ delta บวก/ลบได้, require `Number.isFinite`, after = before + delta, null field → fail fast). credit_tracker เรียก CAS แทน: refetch DB → PATCH `?credit_paid_amount=eq.{before}` → 0 rows = stale = retry (max 3). `newPaid = round2(inc.after)` = ค่าจริงหลัง increment. ถ้า fully paid → PATCH `credit_paid_at` แยก (idempotent timestamp, ไม่ critical race)
- **ไม่แตะ:** `atomicDecrementStock` (stock checkout ใช้), `credit_payments` insert (ledger), `postJournalForCreditPayment` JV (double-entry, fire-and-forget)
- **column verified NUMERIC** → eq precondition match เป๊ะ (ไม่ใช่ float8 ที่ precision เพี้ยน)

### 2. 🟡 [Should-fix] cash_recon: cash refund ไม่ถูกหักจากลิ้นชัก
- **ปัญหา:** `computeCashRecon` เดิม expected = opening + cashIn − cashOut แต่**ไม่หัก cash refund** → คืนเงินสดทำให้ลิ้นชักขาดโดยไม่มีบันทึก = false "ขาด" ทุกรอบ. `refunds` ไม่อยู่ใน state กลาง
- **แก้:** `computeCashRecon` เพิ่ม `refunds = []` param + คืน `cashRefunds`/`cashRefundOut` (filter เฉพาะ refund_method=cash + วันที่เลือก, โอนคืนไม่กระทบเงินสด). `renderCashReconPage` fetch refunds ของวัน (REST, cache ต่อวันกัน refetch ทุก keystroke, async re-render) แล้ว pass เข้า + expected = opening + cashIn − cashOut − **cashRefundOut** + แสดง refund line ใน Step 2
- **ไม่เปลี่ยน** existing recon math (cashIn/cashOut/transferIn) — แค่เพิ่มหัก cashRefundOut

### 3. 🔧 [Review hardening] partial-failure safety (รับชำระหนี้)
หลัง review: CAS แก้ lost-update แล้ว แต่ยังมี UX risk — ถ้า `credit_payments` insert สำเร็จ แล้ว CAS หรือ `credit_paid_at` PATCH fail → handler throw → user กดซ้ำ → **duplicate ledger row**. แก้:
- แยก logic เป็น `processCreditPayment({...})` (exported, DI fetcher → unit-testable) คืน result object **ไม่ throw หลัง ledger insert**
- **หลัง ledger insert สำเร็จ = committed** → `ok:true, retrySafe:false` เสมอ → handler **ไม่เปิดปุ่มให้กดซ้ำ** (กัน duplicate). เฉพาะ insert fail (`retrySafe:true`) เท่านั้นที่เปิดปุ่มใหม่
- **CAS fail → reconcile จาก ledger SUM** (`reconcileCreditPaidFromLedger`): GET `credit_payments?sale_id&select=amount` → set `credit_paid_amount = SUM` (absolute, authoritative, self-healing — JS-only ไม่แตะ schema). ถ้า reconcile ก็ fail → `syncWarning` non-retry message + reload
- **`credit_paid_at` = best-effort metadata** — ไม่ throw; fail แค่ตั้ง `syncWarning` ("สถานะครบชำระอาจต้องรีโหลด") + success path เดินต่อ + reload
- handler แสดง `syncWarning` (warn toast) แทน success toast เมื่อ cache/status sync degraded

### Tests (TDD red→green)
- `tests/atomic_add_field.test.js` (ใหม่, +5): increment / stale-retry / null-fail / contention-exhaust / non-finite-delta
- `tests/cash_recon.test.js` (+1): cash refund หักจากลิ้นชัก (transfer refund + คนละวัน ไม่นับ)
- `tests/credit_payment_partial_failure.test.js` (ใหม่, +6): happy / insert-fail-retrySafe / credit_paid_at-fail-after-CAS / CAS-fail+reconcile-ok / CAS-fail+reconcile-fail-nonretry / sync-throws-nonretry
- Gates: lint 0/0 · unit 302 → 314 · e2e 11 (verify exit 0 end-to-end, no zombie 4173)

### Remaining non-transaction risk (acknowledged)
ระบบไม่มี DB transaction ข้าม ledger+cache (client REST + RLS, ไม่มี RPC). หลัง hardening:
- **เงินไม่หาย:** `credit_payments` (source of truth) insert ครบ + ไม่ duplicate (no retry หลัง commit)
- **cache (`sales.credit_paid_amount`) อาจ transient stale** ถ้า CAS+reconcile fail ทั้งคู่ (network ตายช่วงนั้น) → self-heal เมื่อรับชำระครั้งถัดไป (CAS อ่านค่าจริง) หรือ manual reload; user เห็น non-retry warning ชัดเจน
- ไม่มี atomic rollback: ถ้าอยากปิด gap 100% ต้องทำ Postgres RPC (`receive_credit_payment` function) ที่ insert+update ใน transaction เดียว — นอก scope JS-only ของ phase นี้ (แนะนำพิจารณาถ้าต้องการ strict guarantee)

### Manual smoke (REQUIRED post-deploy — MONEY)
1. Ctrl+Shift+R → 5.47.2 (build 268)
2. รับชำระหนี้บางส่วน → credit_paid ถูก + JV ลง + (ถ้าครบ) ขึ้น "ครบแล้ว"
3. **Concurrent (proof CAS):** เปิดบิลเชื่อเดียวกัน 2 แท็บ → รับชำระพร้อมกัน → credit_payments 2 rows + credit_paid_amount = SUM (ไม่หาย)
4. คืนเงินสด → cash recon วันนั้น → expected ลดตาม refund (ไม่ false "ขาด")
5. Console ไม่มี ReferenceError

### Next: Phase 92.13 (audit 4.1 should-fix ที่เหลือ)
- 🟡 refunds round2 + pos.js cart round2 + verify-slip mismatch confirm

---

## 🐛 Phase 92.11 — Fix silent "เปิดบิล" + verify health + version sync (previous session)

งาน health/cleanup หลัง build 266. **No push yet (awaiting user confirm — production deploy).**

### 1. ปุ่ม "เปิดบิล" กดแล้วเงียบ (รากของปัญหา = `loadReceipt`)
- `loadReceipt(saleId)` เดิมใช้ `state.supabase.from(...).single()` — Supabase JS client **ค้างบนมือถือ** (pos.js receipt-load เลี่ยงไปแล้วด้วยเหตุนี้) + ถ้า `state.supabase` ยังไม่พร้อม → **throw** → ใน sales.js `await loadReceipt(); openReceiptDrawer();` เมื่อ throw แล้ว drawer ไม่เปิด = ปุ่มเงียบ. กรณี query error → `return` เงียบ ๆ ไม่มี toast
- **แก้:** เขียน `loadReceipt` ใหม่เป็น `fetch` + `AbortController` timeout 8s (mirror pos.js:1176-1198) คืน `{ok, error}` (ตาม convention async-refactor-return-shape) — ไม่ throw, ไม่ hang
- caller (sales.js "เปิดบิล" + customer drawer ใน main.js): เช็ค `r.ok === false` → `showToast` เตือน + เปิด drawer เฉพาะตอนสำเร็จ; ปุ่ม sales.js กัน double-click ด้วย `disabled` ใน finally
- legacy checkout caller (main.js ~3308) ไม่แตะ — ignore return value, ไม่ regress
- **ยังไม่ได้ verify บน device จริง** — โครงสร้างเหมือน pos.js receipt fetch ที่ใช้งานจริงบน prod แล้ว (RLS ผ่าน user token เดิม)

### 2. Lint 2 → 0 warnings
- `pos.js:1193` `state.lastReceipt` — ขยาย `eslint-disable require-atomic-updates` ครอบ assignment (อยู่ใน `_posCheckoutGuard.run()` single-flight อยู่แล้ว เหมือนบล็อกถัดไป)
- `loyalty.js:340` `requireAdmin` — **false positive**: renderLoyaltyPage forward `ctx` ทั้งก้อนเข้า `renderSettingsTab(settings, ctx)` (admin gate อยู่ที่ save handler line ~634). local binding ไม่ถูกอ้างตรง ๆ แต่ guard test `loyalty_settings_admin_guard` ล็อกชื่อ `requireAdmin` ห้าม alias → ใช้ justified `eslint-disable-next-line no-unused-vars` (ไม่ revert เป็น `_` เพราะจะ fail guard test)

### 3. e2e/verify health
- รัน `npm run verify` จบครบ **17-20s** (ไม่ค้าง). อาการค้าง ~180s จาก audit = **zombie `static-server.js` ค้าง port 4173** จาก run ที่ถูก interrupt — ไม่ใช่ bug ของ config. ถ้าเจออีก: kill node ที่ถือ port 4173 แล้วรันใหม่ (`reuseExistingServer:true` local จะ reuse zombie ที่อาจค้าง)

### 4. Version drift fix
- `package.json` 5.43.42 → **5.47.1** (เดิม drift ห่างจาก UI/docs). bump build 266 → 267 ครบ 4 จุด: index.html (selfheal+data-app-build / main.js / boot.js / style.css `?v=267`) · sw.js `cache-v267` · pages.js (5.47.1 / build 267) · package.json

### Verify (เขียวครบ)
- lint **0 errors / 0 warnings** · unit **302 pass** · e2e **11 pass**

### ไม่แตะ (product decision)
- manual tab role gate ใน Loyalty (admin-only settings) — คงเดิม

---

## ♻️ Phase 92.10 CAPSTONE — Extract boot orchestration → `modules/boot.js` (this session)

ปิด **decomposition series 92.1-92.10**. ย้าย boot IIFE (self-invoking async ที่รันตอน main.js โหลด) → `modules/boot.js`. ผลลัพธ์เชิงสถาปัตยกรรม: main.js เป็น **side-effect-free module** แล้ว — ไม่มี IIFE รันเองตอน import → boot orchestration testable + module boundary สะอาด. Refactor-only, byte-identical. **No push (awaiting user).**

### What moved (main.js boot IIFE → modules/boot.js)
- `(async function boot(){...})()` ท้าย main.js → `export async function runBoot({...7 deps})` ใน boot.js
- main.js เรียก `runBoot({...})` (fire-and-forget, ไม่ await) ที่ตำแหน่งเดิม (หลัง updateAppLogos wrapper + window.App) — deps ทั้งหมด hoisted/defined แล้วตอนเรียก

### Why dependency injection (ไม่ใช่ direct import)
boot เรียก initSupabase/afterLogin/bindStaticEvents ที่อยู่ใน main.js. ถ้า boot.js import จาก main.js → **circular** (main.js import boot.js เพื่อ trigger ↔ boot.js import main.js เพื่อเรียก functions). Inject deps ผ่าน params → boot.js ไม่ต้อง import main.js เลย → ตัด circular + ลำดับ testable.

### 7 injected deps (verified main.js scope)
| dep | ที่มา | mapping |
|-----|-------|---------|
| `initDarkMode` / `bindStaticEvents` / `updateAppLogos` / `initSupabase` / `afterLogin` | function decls (hoisted) | ส่งชื่อตรงๆ |
| `syncLogo` | `window._appSyncLogo` | `() => window._appSyncLogo()` |
| `getCurrentUser` | `state.currentUser` | `() => state.currentUser` |

### Byte-identical (ลำดับ + early-return เป๊ะเดิม)
darkMode → static events → logo paint → `await initSupabase()` → `if(!ok) return` → `if(!getCurrentUser()) return` → `await afterLogin()` → background `syncLogo().then(repaint)`. แก้แค่ `state.currentUser`→`getCurrentUser()`, `window._appSyncLogo()`→`syncLogo()`.

### ไม่แตะ (verified)
- `updateAppLogos` wrapper (branding._updateAppLogosImpl) + `window.updateAppLogos` — เก็บใน main.js, ส่งเข้า runBoot ผ่าน param
- dependencies เดิม (initDarkMode/bindStaticEvents/initSupabase/afterLogin) ใน main.js ไม่แตะ

### Tests (+9)
- Behavioral (5): happy-path order / bail-after-supabase-false (no afterLogin) / bail-no-current-user / pre-supabase-steps-always-run / logo-repaint-after-syncLogo
- Source pins (4): boot.js exports runBoot · main.js imports+calls runBoot · main.js side-effect-free (no boot IIFE) · boot.js does NOT import main.js
- หมายเหตุ: ปรับ test helper `makeDeps` ใช้ scenario knobs (`supabaseOk`/`currentUser`) แทน override ตรงๆ — กัน override ลบ `calls.push` (ที่ทำให้ bail-test assert ผิด); เจตนา test เดิมคงไว้

### Decomposition series 92.1-92.10 — COMPLETE
main.js: 4690 → 4247 บรรทัด (-443). Modules แยกออก: `branding.js` (logo) · `lazy_libs.js` (html2canvas) · `share_doc.js` (PDF/share) · `utils.js` (formatters) · `api.js` (XHR/auth data layer) · `boot.js` (orchestration). main.js = pure module definitions + window.App contract + thin wrappers, **side-effect-free**.

### Manual smoke (REQUIRED post-deploy — boot = app entry point)
1. Ctrl+Shift+R → version 5.47.0 (build 266)
2. แอป boot ขึ้นปกติ — dark mode apply, sidebar/logo, login screen หรือ dashboard (ตาม session)
3. Login flow — ถ้ายังไม่ login → login → afterLogin → dashboard โหลด (พิสูจน์ boot ordering)
4. Logo sync background (ถ้ามี Supabase logo) → repaint
5. DevTools Console → ไม่มี ReferenceError / boot ไม่ crash

---

## ♻️ Phase 92.9 — Extract XHR/API data layer → `modules/api.js`

ต่อยอด decomposition 92.1-92.8. ย้าย **data-access layer** (auth-critical) ที่ทุก data operation พึ่งพา. Refactor-only, byte-identical. **No push (awaiting user).**

### What moved (main.js L178-395 → modules/api.js)
- `_refreshInflight` (module-level guard) + `refreshAccessToken` (single-flight token rotation, 3s herd-absorb)
- `appAuthFetch` (401-retry-with-refresh fetch wrapper) + `xhrPost` / `xhrPatch` / `xhrDelete` (XHR REST + 401 recursive retry)

### Why factory `createApi({ windowRef })` (ไม่ใช่ plain exports)
1. **Shared mutable** `_refreshInflight` — 5 functions ต้องเห็น guard เดียวกัน
2. **Internal recursion** — appAuthFetch→refreshAccessToken; xhrPost/Patch/Delete→refreshAccessToken→recursive self with `_isRetry=true`
3. **Positional `_isRetry` param** — เพิ่ม windowRef ต่อ function จะชน positional args ของ 13 callers + recursive retry
→ factory inject `windowRef` ครั้งเดียวผ่าน closure แก้ทั้ง 3 ข้อ; 5 functions + `_refreshInflight` อยู่ closure เดียว

### Caller compatibility (ห้ามแตะ — verified)
- main.js destructure `{ refreshAccessToken, appAuthFetch, xhrPost, xhrPatch, xhrDelete } = createApi({ windowRef: window })` → bindings อยู่ใน module scope
- ผูก `window._appRefreshAccessToken/_appAuthFetch/_appXhrPost/_appXhrPatch/_appXhrDelete` เดิม → 13 module callers (quotations/delivery_invoices/ฯลฯ) ไม่แตะ
- main.js local callers (~30 จุด L1816+: products/customers/sales/stock/profiles) ใช้ destructured bindings ตรงๆ

### Byte-identical — แก้แค่ global → windowRef.*
| เดิม | ใหม่ |
|------|------|
| `window.SUPABASE_CONFIG` / `window._sbAccessToken` / `window.App` | `windowRef.*` |
| `fetch(` | `windowRef.fetch(` |
| `new XMLHttpRequest()` | `new windowRef.XMLHttpRequest()` |
| `state.supabase` fallback (L183) | ตัดออก — `windowRef.App?.state?.supabase` พอ (window.App.state === state, verified L4422) |

retry/refresh/single-flight setTimeout(3s)/headers/timeout(15000)/status-handling/JSON-guards/console logging — ไม่แตะ

### Global-leak guard (auth-critical, A.5) — PASS
`node --check` api.js+main.js OK; ทุก `window.`/`fetch(`/`new XMLHttpRequest`/`state.` ใน api.js เป็น comment หรือ `windowRef.*` (ไม่มี bareword leak)

### Tests (+18 → 293 total)
14 behavioral (appAuthFetch header inject + anonKey fallback + 401 retry single/double; refreshAccessToken false/rotate/single-flight; xhrPost 2xx/empty/4xx; xhrPatch RLS-blocked/2xx; xhrDelete 2xx/4xx) + 4 source pins (factory export, main.js wiring 5 wrappers, no inline defs, windowRef routing)

### Manual smoke (REQUIRED post-merge+deploy — blast radius ใหญ่สุดในซีรีส์)
หลัง build 265 live: Ctrl+Shift+R → 5.46.0 → **login** → **load** data (Dashboard/POS/สินค้า/ลูกค้า) → **create** (ขาย/ใบเสนอราคา) → **edit** (สินค้า/ลูกค้า) → **delete** → **token refresh** (ทิ้งจน token หมดอายุ/ลบ session ใน DevTools → ทำ action → refresh+retry เงียบ หรือ toast "Session หมดอายุ") → Console ไม่มี ReferenceError

---

## ♻️ Phase 92.8 — Extract Thai-locale formatters → `modules/utils.js`

ต่อยอด decomposition 92.1-92.7. ย้าย 5 pure formatters ที่ยัง inline ใน main.js ไปรวมกับ shared utils.js (ที่มี escHtml/round2/todayBkk/dateBkk อยู่แล้ว). Refactor-only, byte-identical. **No push (awaiting user).**

### What moved (main.js → modules/utils.js)
- `money` (const arrow), `formatNumber`, `formatCurrency`, `formatDate`, `formatDateTime` — body byte-identical, แค่เติม `export`; วางไว้หลัง date helpers (todaySuffix) เพื่อ cohesion
- main.js เพิ่ม `import { money, formatNumber, formatCurrency, formatDate, formatDateTime } from "./modules/utils.js";` (บรรทัดถัดจาก escHtml import)

### Why utils.js (ไม่สร้าง module ใหม่)
- มี date helpers (todayBkk/dateBkk) อยู่แล้ว → formatDate/formatDateTime ไปอยู่ด้วยกัน = cohesion
- ตรงกับ pattern Phase 51 (escHtml dedup → utils.js); modules หลายตัว import จาก utils.js ตรงๆ อยู่แล้ว
- `formatCurrency` เรียก `money` → ทั้งคู่ต้องอยู่ module เดียวกันเพื่อให้ internal call ทำงาน

### Caller compatibility (ห้ามแตะ — verified)
- `window.App` exports object (escapeHtml/formatNumber/formatCurrency/formatDate/formatDateTime) ไม่แตะ — ES import live binding ทำให้ object shorthand ทำงานเหมือนเดิม
- 6 จุดที่เรียก `money(...)` ใน main.js ไม่แตะ call site
- ไม่มี name collision ใน utils.js (ตรวจแล้ว) + ไม่มี module อื่น define formatNumber/formatDate ทับ

### Build bump 263 → 264 (จำเป็น)
- utils.js เป็น static import → browser/SW cache ตาม CACHE_NAME; ถ้าไม่ bump client เก่าอาจโหลด utils.js เก่า (ไม่มี formatters) คู่ main.js ใหม่ (ไม่มี inline) → ReferenceError
- Files: index.html (style.css/selfheal/main.js/boot.js ?v=264 + data-app-build=264), sw.js CACHE_NAME v264, pages.js version 5.45.1 + build 264

### Stats
- main.js: 4467 → 4454 บรรทัด (−13); Tests: 263 → 275 (+12: 8 behavioral + 4 source-level pins)
- Verify: lint 0 + 275 unit + 11 e2e green

### Recommend ต่อ (Phase 92.9+)
- DOM/form utils (fadeIn/fadeOut, showLoading/hideLoading, getFormData/validateForm/clearForm) → modules/dom_utils.js
- XHR/API layer (xhrPost/Patch/Delete + appAuthFetch + refreshAccessToken) → modules/api.js
- boot IIFE → modules/boot.js (capstone — main.js side-effect-free)

---

## ♻️ Phase 92.7 — Extract `_appShareDoc` → `modules/share_doc.js`

ต่อยอด decomposition 92.1-92.6. ย้าย Share/PDF overlay (chunk ใหญ่สุดที่เหลือเป็นก้อนเดียวใน main.js, L426-644 ~223 บรรทัด) ออกเป็น module ใหม่. Behavior byte-identical, refactor-only. **No push (awaiting user).**

### What moved
- `window._appShareDoc` body → `export async function shareDoc({ docElementId, docName, documentRef, windowRef, loadHtml2Canvas, showToast, logger })` ใน `modules/share_doc.js` (239 บรรทัด)
- main.js เก็บ thin `window._appShareDoc(docElementId, docName)` wrapper → delegate ไป `_shareDocImpl({...})` bind live `document`/`window`/`_loadHtml2Canvas`/`showToast`
- HTML modal template + `forceA4Style` CSS + closure (`_canvas`/`_pdfBlob`/`_pdfUrl`) + jsPDF multi-page math + 8 share handlers (line/fb/email/native/pdf/save/copy/print) ย้ายมาทั้งก้อน byte-identical

### Why DI (injected refs)
- main.js เป็น ES module ที่รันใน browser เท่านั้น; แยก module ออกมาแล้ว inject `documentRef`/`windowRef` → unit-testable ใน Node + กัน global-leak (Lesson 89.35: bareword `document.` ใน module = ReferenceError ใน prod แต่ unit test ไม่ catch). Global-leak guard (grep) PASS — ทุก DOM/window/navigator/console + html2canvas loader route ผ่าน param.
- `console.warn` → `logger?.warn?.()` (optional-chained, null-safe เมื่อไม่มี console)

### Caller compatibility (ห้ามแตะ — verified)
- delivery_invoices.js:649 / doc-utils.js:262 / quotations.js:1029 / receipts.js:900 — ทุกตัวเรียก `window._appShareDoc(string, string)`; wrapper signature คงเดิมเป๊ะ

### Tests (+10 → 263 total)
- Behavioral (stub doc/window): null-guard returns silently; overlay built + appended w/ 8 share-opt; Phase 92.5 fail-fallback fires on `loadHtml2Canvas()===false`; missing docEl no-throw
- Source pins: export/import/wrapper shape; modal markup gone from main.js; no bareword `document.`/`navigator.`; 92.5 fallback string present
- ⚠️ Phase 92.5 source pin ใน `tests/lazy_libs_load_html2canvas.test.js` ย้าย target จาก mainSrc → shareSrc (code ย้าย module — ไม่ใช่ behavior change)
- **ไม่ unit test** native share / clipboard.write / window.open handlers (mock ROI ต่ำ) → ครอบด้วย source pin + manual smoke

### Net
- main.js: 4690 → 4467 บรรทัด (−223)
- Build: 262 → 263; version 5.44.9 → 5.45.0 (minor — โครงสร้างเพิ่ม module)
- main.js decomposition state: branding.js + lazy_libs.js + share_doc.js เป็นเจ้าของสิ่งที่เคย inline; เหลือ boot IIFE + sidebar/nav + state ใน main.js

### ⚠️ Manual smoke REQUIRED post-deploy (share handlers ไม่มี unit test)
หลัง build 263 live → Ctrl+Shift+R เช็ค 5.45.0; เปิด Quotation/Receipt/Delivery Invoice → แชร์ → modal + thumbnail + "✓ PDF A4 พร้อมแชร์"; ทดสอบ บันทึก PDF / บันทึกรูป / คัดลอกรูป / พิมพ์ / LINE-Messenger-Email / native share (มือถือ) / offline fallback; PDF layout = A4 ตรง logo+ตาราง+ยอดรวม+ลายเซ็นครบ

### Recommend Phase 92.8+
- boot IIFE → modules/boot.js (เล็กแต่ stateful)
- doc-print.css / forceA4Style consolidation (CSS A4 ซ้ำซ้อน?)
- sw.js:147 anomaly (?_t= ERR_CACHE_MISS) — สืบ + fix

---

## 🛡️ Phase 92.6 — Share/PDF + logo-sync hardening

Defensive hardening from a post-92.5 code review — 3 small fixes in 2 modules, TDD (red→green) each. **No push (awaiting user).**

### Fixes
- **Issue 1** (`modules/lazy_libs.js`) — `loadHtml2Canvas` now dedupes concurrent callers (double-clicked Share) via a module-level `_pendingH2c` in-flight promise → one `<script>` injection. Cleared on settle (success → next call short-circuits on `window.html2canvas`; failure → retries).
  - ⚠️ Deviated from the prompt's "don't reset on success": keeping the promise leaked module state across unit tests (broke `onerror`/`custom scriptUrl`). Confirmed by running it, then **user approved clear-on-success** (production-equivalent — see [[feedback_cdn_url_vs_csp]] sibling). +2 tests.
- **Issue 2** (`modules/branding.js`) — `syncAppLogo` early-exits when `bsk_store_logo_url === publicUrl`. Was repainting + re-`setItem` every boot for http-URL logos because the old condition keyed off `!startsWith("data:")`. +1 test.
- **Issue 3** (`modules/branding.js`) — `syncAppLogo` strips CR/LF from `accessToken` before the Authorization header (defense-in-depth; Supabase JWTs are safe but cost is 1 line). +1 test.

### Build
- 261 → 262; version 5.44.8 → **5.44.9** (patch — hardening)
- `npm run verify`: lint 0 errors (2 pre-existing warnings) + **253 unit** (249 → 253, +4) + 11 e2e
- Commits: 3 test (red) + 3 fix + 1 build + 1 docs = 8, on branch `claude/phase-92-6-share-sync-hardening`

### Pending
- **NOT pushed** — awaiting user review/approval before merge to main + deploy. Manual smoke checklist in [`CHANGELOG.md`](CHANGELOG.md) 5.44.9 section.

---

## 📦 สรุปรวบยอด build 256 → 261 (Phase 91.4 → 92.5)

> Roll-up เปิดดูทีเดียวจบ — รายละเอียดเต็มของแต่ละ build อยู่ในส่วนถัดลงไป + [`CHANGELOG.md`](CHANGELOG.md)

| Build | Version | Phase | สรุป | ประเภท |
|------:|---------|-------|------|--------|
| 256 | 5.44.3 | 91.4 | Loyalty audit CLOSED — refund/cancel reverse-loyalty wiring (baseline ก่อนเริ่ม decomposition) | hotfix/feat |
| 257 | 5.44.4 | 92.1 | extract `updateAppLogos()` (DOM painter) → `modules/branding.js` | refactor |
| 258 | 5.44.5 | 92.2 | extract `getAppLogo()` (logo resolver: storeInfo>localStorage>default) → `modules/branding.js` | refactor |
| 259 | 5.44.6 | 92.3 | extract + **harden** `syncAppLogo()` (Supabase Storage pull) → `modules/branding.js` — เพิ่ม AbortController timeout + logged failure | refactor+harden |
| 260 | 5.44.7 | 92.4 | extract `loadHtml2Canvas()` lazy loader → **new** `modules/lazy_libs.js` | refactor |
| 261 | 5.44.8 | 92.5 | **HOTFIX** — html2canvas CDN `cdnjs.cloudflare.com` ถูก CSP บล็อก → Share/PDF ค้าง. เปลี่ยนเป็น `cdn.jsdelivr.net` + กัน modal ค้าง | hotfix |

### ภาพรวม (build 257 → 261 = "Phase 92 main.js decomposition")
- **เป้าหมาย:** แยก `main.js` (4,600+ บรรทัด) ออกเป็น module ทีละชิ้นแบบปลอดภัย — refactor-only, revert ง่าย, ทดสอบทุกชิ้น
- **ผลลัพธ์:** logo logic + html2canvas loader ที่เคย inline ใน `main.js` ย้ายออกหมดแล้ว
  - `modules/branding.js` — `updateAppLogos` (paint) + `getAppLogo` (resolve) + `syncAppLogo` (Supabase pull)
  - `modules/lazy_libs.js` (ใหม่) — `loadHtml2Canvas` + `HTML2CANVAS_CDN_URL`
  - `main.js` เหลือเพียง thin wrapper (`window._appGetLogo` / `window._appSyncLogo` / `_loadHtml2Canvas`) ที่ bind live globals → call sites ทุกที่ทำงานเหมือนเดิม
- **Pattern ที่ใช้ทุก build:** extract → inject globals (state/config/storage/fetch/document) ให้ pure+testable → keep wrapper เดิมไว้ → test 2 layer (behavioral stub + source-level guard) → bump 4 touchpoints (index.html ?v=/data-app-build, sw.js CACHE_NAME, pages.js version) → verify (lint+unit+e2e) → push main → poll live build → manual smoke
- **Test เพิ่มสุทธิ:** 204 → 249 unit (+45 ใน 5 builds), e2e คงที่ 11
- **บทเรียน 2 ข้อ (บันทึก memory แล้ว):**
  1. [[feedback_smoke_log_wrong_function]] — console error ตอน smoke (92.2/92.3) มาจาก `saveStoreInfo` คนละ path กับ `_appSyncLogo` ที่กำลังแก้ — grep หา source จริงก่อน
  2. [[feedback_cdn_url_vs_csp]] — byte-identical extract เก็บ latent bug ไว้ (cdnjs URL ไม่ตรง CSP มาตั้งแต่ก่อน refactor); external-resource path ต้อง smoke จริง + เทียบ `_headers`

### สถานะ ณ build 261 — ✅ Phase 92 arc (256→261) ปิดครบ
- Production live build **261**, version **5.44.8**, `npm run verify` ผ่านครบ (lint 0 errors / 2 pre-existing warnings, 249 unit, 11 e2e)
- Manual smoke Share/PDF: **✅ user ยืนยันผ่านแล้ว** (20 พ.ค. 2026) — html2canvas โหลดจาก jsdelivr, สร้าง/แชร์ไฟล์ได้, ไม่ค้าง
- งานที่ทำบน branch `claude/phase-89-45-final-warnings` แต่ push ตรง `origin/main` ทุก build (Cloudflare deploy จาก main)

### Phase 92 ถัดไป (ยังไม่เริ่ม)
- 92.6+ — `_appShareDoc` (Share/PDF overlay ~130 บรรทัด), boot IIFE → `modules/boot.js`, sidebar/nav, auth/profile boot

---

## 🚑 Phase 92.5 — HOTFIX: html2canvas blocked by CSP, Share/PDF stuck (this session)

### Symptom
Open a document → Share/LINE/PDF → modal stuck on "กำลังสร้าง PDF..." forever, no file. Console: html2canvas script from `cdnjs.cloudflare.com` violates CSP `script-src-elem`.

### Root cause
`HTML2CANVAS_CDN_URL` pointed at `cdnjs.cloudflare.com`, which the production CSP (`_headers`) does NOT allow (only jsdelivr / unpkg / sheetjs / esm.sh). This URL was the **original pre-92.4 value** — the extract was byte-identical, so it preserved a latent bug that surfaced during 92.4 smoke. Compounded by `_appShareDoc` ignoring the loader's boolean: when html2canvas didn't load, the PDF-build `if` was skipped with no else → infinite "กำลังสร้าง PDF...".

### Fix
- `modules/lazy_libs.js` — `HTML2CANVAS_CDN_URL` → `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js`
- `main.js` `_appShareDoc` — capture `_h2cReady = await _loadHtml2Canvas()`; on failure show red thumbnail message + `showToast("โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่")`, wire close + click-outside, and `return` (no stuck modal). Success path unchanged.
- Tests (+3): URL pinned to jsdelivr, host must be CSP-allowed (never cdnjs), **cross-check against `_headers` CSP**, and source-level pin that `_appShareDoc` handles a failed load.

### Build
- 260 → 261; version 5.44.7 → **5.44.8** (patch — hotfix)
- `npm run verify`: lint + **249 unit** (246 → 249) + 11 e2e

### Lesson
A byte-identical extract still carries the original's latent bugs. When smoke-testing an external-resource path (CDN/script inject), verify the URL host against the CSP `_headers` allowlist — not just the function contract.

---

## 🧱 Phase 92.4 — extract html2canvas lazy loader

Continues the `main.js` decomposition. Behavior-preserving extraction (one tiny diagnostic log added).

### Change
- New `modules/lazy_libs.js` — home for lazy third-party script loaders. Exports `loadHtml2Canvas({ windowRef, documentRef, scriptUrl, logger })` + `HTML2CANVAS_CDN_URL` constant.
- Contract identical to the inline original: resolves `true` if `window.html2canvas` already present (idempotent, no duplicate inject); else appends `<script>`, resolves `true` on load / `false` on error; never rejects.
- Only addition: a `logger.warn` on the error path (was silent) — doesn't change the resolve contract or control flow.
- `main.js` — `_loadHtml2Canvas()` is now a 1-line wrapper calling `_loadHtml2CanvasImpl({ windowRef: window, documentRef: document })`. Sole caller (`window._appShareDoc`) unchanged. `_loadHtml2Canvas` was main.js-private (not on window), single call site.
- `tests/lazy_libs_load_html2canvas.test.js` — 10 tests (6 behavioral, 4 source-level), no browser.

### Build
- 259 → 260; version 5.44.6 → **5.44.7** (patch — refactor)
- `npm run verify`: lint + **246 unit** (236 → 246, +10) + 11 e2e

### main.js decomposition progress
`modules/branding.js` (logo: updateAppLogos/getAppLogo/syncAppLogo) + `modules/lazy_libs.js` (loadHtml2Canvas) now own what used to be inline. Remaining big chunks in main.js: the Share/PDF overlay (`_appShareDoc`), boot IIFE, sidebar/nav, auth/profile boot.

---

## 🧱 Phase 92.3 — extract + harden logo Supabase sync

Continues Phase 92.1/92.2. **Behavior-preserving extraction + a small intentional hardening** (network timeout).

### Change
- `modules/branding.js` gains `syncAppLogo({ config, accessToken, storageRef, fetchImpl, timeoutMs, onUpdated, logger })` — pulls the logo from the Supabase Storage `store-assets` bucket (raw REST list), builds the cache-busted public URL, and caches it to localStorage only when stale (no overwrite of a matching user data: URI). All I/O injected → pure & testable.
- **Hardening** (the inline original had neither): the list `fetch` now runs under an `AbortController` timeout (default 8s) so a stalled network can't hang it, and failures are logged via the injected `logger.warn` instead of being silently swallowed. localStorage cache still serves the logo on failure → UI never breaks.
- `main.js` — `window._appSyncLogo` is now a wrapper calling `_syncAppLogoImpl({ config: window.SUPABASE_CONFIG, accessToken: window._sbAccessToken, onUpdated: () => updateAppLogos() })`. Boot caller unchanged.
- `tests/branding_sync_app_logo.test.js` — 14 tests (9 behavioral, 2 hardening, 3 source-level), no network/window.

### Smoke-log clarification
The console line `Supabase save failed (using localStorage): supabase timeout` seen during 92.2 smoke is from **`saveStoreInfo()`** (a *save* path that already has a 3s `Promise.race` timeout) — working as designed. It is NOT `_appSyncLogo`. 92.3 hardens the separate *pull* path, which previously had no timeout at all.

### Logo decomposition — COMPLETE
All three logo concerns now live in `modules/branding.js`: `updateAppLogos` (92.1, DOM paint), `getAppLogo` (92.2, resolver), `syncAppLogo` (92.3, Supabase pull). `main.js` keeps only thin wrappers binding live globals.

### Build
- 258 → 259; version 5.44.5 → **5.44.6** (patch — refactor + harden)
- `npm run verify`: lint + **236 unit** (222 → 236, +14) + 11 e2e

---

## 🧱 Phase 92.2 — extract logo source resolver

Pure refactor — **zero behavior change**. Second extraction from `main.js`, continues Phase 92.1.

### Change
- `modules/branding.js` gains a second export `getAppLogo({ stateRef, storageRef, defaultLogo })` — the priority chain `state.storeInfo?.logoUrl || localStorage["bsk_store_logo"] || "./icons/logo.svg"`, byte-identical to the old inline `_appGetLogo`. `state` + storage are injected → pure & testable.
- `main.js`:
  - Imports `getAppLogo as _getAppLogoImpl` alongside `updateAppLogos`
  - `window._appGetLogo` is now a 1-line wrapper `return _getAppLogoImpl({ stateRef: state })` that binds the live `state`
  - All `window._appGetLogo()` callers (pos, dashboard, payroll, receipts, quotations, delivery_invoices) unchanged
- `tests/branding_update_app_logos.test.js` — +8 (10 → 18): 5 behavioral (priority order, fall-through, custom default, null storage), 3 source-level (export present, no inline chain in main.js, wrapper preserved)

### Intentionally NOT extracted (flagged for 92.3)
- `window._appSyncLogo` — async, fetches from Supabase Storage using `SUPABASE_CONFIG` + `_sbAccessToken`. Needs config + token injected

### Build
- 257 → 258; version 5.44.4 → **5.44.5** (patch — refactor)
- `npm run verify`: lint + **222 unit** (214 → 222, +8) + 11 e2e

---

## 🧱 Phase 92.1 — main.js decomposition first cut

Pure refactor — **zero behavior change**. First extraction from the 4,600+ line `main.js` boot file.

### Change
- New `modules/branding.js` exports `updateAppLogos({ documentRef, getLogo })` — paints store logo into sidebar / auth / profile / spinner / favicon slots. Pure DOM, injectable seam.
- `main.js`:
  - Imports the extracted helper at the top with other module imports
  - Replaces the 16-line inline body (was L4658-4673) with a 3-line wrapper that calls `_updateAppLogosImpl({ documentRef: document, getLogo: () => window._appGetLogo?.() })`
  - Wrapper keeps the SAME closure identity → `window.updateAppLogos`, `window.App.updateAppLogos`, and the 4 internal call sites at L421/L975/L4687 all work unchanged
- `tests/branding_update_app_logos.test.js` — 10 assertions:
  - Behavioral with a hand-rolled minimal Document stub: paints every slot, http URL skips favicon, data: URI overrides favicon, no-op on null doc / empty logo, all `.auth-logo-img` nodes painted (not just first)
  - Source-level: main.js imports from `./modules/branding.js`, branding.js exports the helper, main.js no longer inlines any branding selector (`.sidebar-logo-img`, `.auth-logo-img`, etc.), wrapper function preserved

### Intentionally NOT extracted in 92.1
Couple to globals — flagged for 92.2 / 92.3:
- `window._appGetLogo` — reads `state.storeInfo.logoUrl` + `localStorage`. Needs `state` injected
- `window._appSyncLogo` — async, fetches from Supabase Storage using `SUPABASE_CONFIG` + `_sbAccessToken`. Needs config + token injected

### Out-of-scope finds (flagged, not touched per Phase 92.1 scope guard)
- `loadAppSettings` (L965+) calls `updateAppLogos()` via `typeof` check — could simplify to direct call now, but that's behavior-adjacent. Phase 92.x candidate
- `boot` IIFE (L4678+) at the very bottom — natural candidate for `modules/boot.js` once dependencies decouple

### Build
- 256 → 257; version 5.44.3 → **5.44.4** (patch — refactor)
- `npm run verify`: lint + **214 unit** (204 → 214, +10) + 11 e2e all green

---

## 🏁 Loyalty audit & feature work — CLOSED

> **Canonical prod URL:** [boonsook-pos-v5.pages.dev](https://boonsook-pos-v5.pages.dev) (per [[reference-canonical-prod-url]]) — www.boonsook.com is a parked placeholder, do not use it for build verification.
>
> **Status snapshot (19 พ.ค. 2026):** build **256** live, version **5.44.3**, `npm run verify` clean (lint + 204 unit + 11 e2e), production manual smoke passed.

### Loyalty flow — verified end-to-end on production
| Capability | Status | Closed in |
|------------|--------|-----------|
| Settings save (admin) | ✅ works | 90.4 + 90.6 |
| Settings save runtime requireAdmin guard (defense-in-depth) | ✅ added | 90.12 |
| Manual earn (admin form) | ✅ works | 90.8 + 90.9 |
| Manual redeem (admin form) | ✅ works | 90.8 + 90.9 |
| Customer lookup with bigint vs `<select>.value` string | ✅ fixed via `String()` both sides | 90.10 |
| History modal click-outside listener leak | ✅ bound once, not per open | 90.13 |
| Service-worker periodic + visibilitychange update polling | ✅ added (no auto-reload) | 90.11 |
| **POS auto-earn on sale checkout** | ✅ works (500 + rate 100 → +5; no customer → no points) | 91.1 |
| **Earn formula** | ✅ `floor(amount / bahtPerPoint)`; the 50,000-point bug from inverted multiplication is fixed and locked by unit tests | 91.2 |
| **Refund + sale-delete/cancel reverse loyalty** | ✅ insert `type='redeem' + ref_type='sale_reverse' + ref_id=saleId`; idempotent (`hasReversedLoyaltyForSale`); caps at remaining; helper failure never blocks main flow | 91.3 + 91.4 |
| Smoke verified | ✅ sale #143 earn 5 + sale_reverse 5; sale #144 earn 5 + sale_reverse 5; summary stays consistent | — |

### Audit closure summary
**Closed in Phase 90.x → 91.4:**
- A1 settings save runtime admin guard (90.12)
- B1 history modal click-outside listener leak (90.13)
- POS checkout auto-earn loyalty (91.1)
- Earn formula direction bug — `floor(amount / bahtPerPoint)` (91.2)
- Sale delete / cancel reverse loyalty (91.3 wiring + 91.4 hotfix)
- SW update polling for long sessions (90.11)

**Deferred (intentionally, not blocking):**
- **Manual tab role gate** — product decision (sales granting/redeeming points = store value). Awaiting user direction on whether non-admin should be able to use the manual tab at all
- **`main.js` decomposition** — 6,000+ LOC monolith. Roll to **Phase 92** (no behavior change, structure-only)
- **DB hardening: unique constraint for sale earn/reverse idempotency** — currently idempotent via client-side check (`hasReversedLoyaltyForSale` scans `state.loyaltyPoints`). A DB-level UNIQUE on `(customer_id, ref_type, ref_id)` for `ref_type IN ('sale','sale_reverse')` would be a defense-in-depth. Roll to **Phase 93** (RLS + constraints hardening for `loyalty_points`)
- **Refund partial-quantity reverse** — current implementation reverses the FULL earn on refund regardless of how many items the user chose to refund. If business needs partial refunds → partial point claw-back, roll to **Phase 94**

### Suggested next phases
| Phase | Focus | Risk | Notes |
|-------|-------|------|-------|
| **92** | `main.js` decomposition (structure-only) | Low (behavior unchanged) | Pull lazy-router, XHR helpers, role helpers, state setup into separate files. Tests guard the surface |
| **93** | DB constraints + RLS hardening for `loyalty_points` | Medium (touches SQL + RLS) | UNIQUE `(customer_id, ref_type, ref_id)` for `ref_type IN ('sale','sale_reverse','redemption')`; review RLS rules for non-admin insert |
| **94** | Refund partial-quantity loyalty reverse | Medium (business policy) | Only if business needs partial refunds → partial point claw-back. Helper would compute `reverseAmount = round(earned * refundedQty/totalQty)` |

---

## 🔥 Phase 91.4 HOTFIX — Reverse-loyalty wiring gate (detail)

Build 255 (Phase 91.3) shipped a working helper but ineffective wiring. Real prod data hit a guard that silently no-op'd the reverse.

**Symptom:** sale #143 → POS auto-earn worked (jeerasuk +5). User deletes sale → `[auto_post] voided 1 JV(s) for sales#143` logged but loyalty summary unchanged.

**Root cause:** both `modules/refunds.js` (L419) and `modules/sales.js` (L244) pre-gated the helper on the SALE-row's `customer_id`:
```js
if (targetSale?.customer_id) {   // ← blocked when column null/missing
  await mod.reverseEarnedPointsForSale(...);
}
```
`sales.customer_id` is an opt-in column (pos.js comment line 1119: "ถ้ามี customer_id field ในตาราง — ใส่ด้วย"). When absent or null, the gate skipped silently — no log, no toast, no record. But the helper itself is designed to fall back to `earn_record.customer_id` (loyalty_points always has it since Phase 91.1).

**Fix:**
- Remove the customer_id pre-check from both wiring sites; pass `customerId: ... || null` and let the helper decide
- Add diagnostic `console.log("[sales delete] loyalty reverse attempt:", { saleId, saleCustomerId, earnCount })` to sales.js so the next smoke can self-diagnose without source dive
- 4 new tests in `tests/loyalty_reverse_sale.test.js`:
  - Helper resolves customer_id from earn record when `customerId: null` (real call shape from post-91.4 wiring)
  - Same with `customerId` key omitted
  - Source-level: `refunds.js` must not gate on `_selectedSale?.customer_id`
  - Source-level: `sales.js` must not gate on `targetSale?.customer_id` (strips comments first — earlier false positive caught my own explainer)

`npm run verify` clean: lint + **204 unit** (200 → 204, +4) + 11 e2e

### Lesson recorded
**Wiring guards must not be stricter than the helper's own contract.** The helper said "customer_id optional, I'll resolve from earn record." The wiring said "no customer_id, refuse." Result: helper logic intended to handle the edge case was unreachable. Rule: at the call site, gate only on the inputs the helper *requires* (here: saleId), and let the helper decide on the optional ones.

---

## ↩️ Phase 91.3 — Refund/cancel reverse loyalty earn (previous push)

Phase 91.1 wired auto-earn but didn't claw back when a sale was refunded or soft-deleted → over-credit risk. Phase 91.3 closes that gap with an idempotent helper called from both reverse paths.

### Helper (`modules/loyalty.js`)
- `getSaleEarnedPoints(state, saleId, customerId?)` — sum earn for a sale
- `hasReversedLoyaltyForSale(state, saleId, customerId?)` — idempotency probe
- `reverseEarnedPointsForSale(saleId, { state, customerId?, refundId? })` — main entry. Returns `{ ok, skipped?, reason?, reversed?, totalEarned?, capped? }`. Never throws.

Record shape (stays within existing schema — no `type` enum change, no migration):
```
type     = 'redeem'
ref_type = 'sale_reverse'
ref_id   = <saleId>
```
`getCustomerPoints` already subtracts every `type='redeem'` row → balance updates automatically. `ref_type` distinguishes auto-reverse from manual redemption in history.

### Wiring
1. **`modules/refunds.js`** — fire-and-forget call right after `postJournalForRefund` (line ~412). Skip silently when sale has no `customer_id`. Toast `คืนแต้ม N แต้ม` on success, `(จาก N)` suffix when capped.
2. **`modules/sales.js`** soft-delete — runs as side-effect (c) alongside void JV + revert stock (line ~237). Adds `คืนแต้ม N/T` to the existing summary toast. Errors logged but never fail the delete.

### Guarantees
- **Idempotent:** second refund of the same sale (or refund + soft-delete) skips on `reason: 'already reversed'` — never claws back twice
- **Never negative:** caps reverse at `customer.remaining`. If customer already spent points elsewhere, only the available balance is clawed back; the cap is recorded in `note` (`คืน 2/5 (3 แต้มถูก redeem ไปแล้ว)`)
- **Silent skips** for: no `customer_id` on sale, no earn record for the sale, remaining=0
- **Main flow safe:** helper failures (RLS, network, missing XHR) log but never throw — refund/cancel itself completes

### Tests (`tests/loyalty_reverse_sale.test.js` — 18 unit tests with mocked `window._appXhrPost`)
- Happy path: earn 5 → reverse 5, record shape verified end-to-end
- Idempotency: existing reverse row → skip, 0 POSTs
- Skips: no earn, no customer_id, remaining=0
- Cap: earn 5 + manual redeem 3 → reverse 2, `capped=true`, note shows `2/5`
- Failure modes: missing XHR / RLS / network error → returns `{ ok:false, skipped:false }` without throwing
- `getSaleEarnedPoints` / `hasReversedLoyaltyForSale` defensive coverage (Phase 90.10 bigint vs string)

`npm run verify` clean: lint + **200 unit** (182 → 200, +18) + 11 e2e

### Audit closures (Phase 90.x + 91.x)
| Item | Status | Phase |
|------|--------|-------|
| A1 settings save runtime guard | ✅ | 90.12 |
| B1 history modal listener leak | ✅ | 90.13 |
| Refund/cancel loyalty reverse | ✅ | **91.3** |
| Manual tab role gate | ⏳ deferred — product decision | — |

---

## 🔥 Phase 91.2 HOTFIX — Earn formula

Production build 253 ส่ง point ผิด x10,000 — user สมาชิก `jeerasuk` กระโดดจาก 600 → 50,600 หลัง sale 500 บาท

**Root cause:** column DB ชื่อ `points_per_baht` แต่ UI label คือ "ทุกกี่บาทได้ 1 แต้ม" = ค่าเป็น **BAHT-per-point** (ตัวหาร) — แต่ `loyalty.js:79` คูณ (`floor(amount * rate)`) แทนหาร. ชื่อ var `pointsPerBaht` หลอกตามชื่อ column → คูณ 500 × 100 = 50,000

**Fix:** centralize formula ใน exported helper:
```js
export function calcEarnPoints(amount, settings) {
  const bahtPerPoint = Number(settings?.points_per_baht || 0);
  const spendAmount = Number(amount || 0);
  if (!settings?.is_active || bahtPerPoint <= 0 || spendAmount <= 0) return 0;
  return Math.floor(spendAmount / bahtPerPoint);
}
```
`earnPoints()` เรียก helper นี้แทน inline math — manual + auto-earn paths drift จากกันไม่ได้อีก

**Cleanup:** user อาจอยากลบ row เกินใน loyalty_points table:
```sql
-- ดู records ที่ผิดก่อนลบ (build 253 era, 19 พ.ค.)
SELECT * FROM loyalty_points
WHERE type='earn' AND points > 1000 AND created_at >= '2026-05-19';
-- ถ้าตรงตามที่คาด:
DELETE FROM loyalty_points
WHERE type='earn' AND points > 1000 AND created_at >= '2026-05-19';
```
แล้ว NOTIFY pgrst, 'reload schema'; ไม่จำเป็น (ไม่ใช่ ALTER TABLE)

**Tests (14 unit, `tests/loyalty_calc_earn_points.test.js`):**
- The bug: 500 + rate 100 = 5 (NEVER 50000) — explicit anti-regression
- Boundary: 99 → 0, 100 → 1, 1000 → 10
- Floor semantics: 549.99 → 5
- Null/undefined/empty settings → 0
- is_active false / rate 0 / negative amount → 0
- String coercion (DB returns strings sometimes)
- Rate 1 → 1:1, rate 50 → double rate
- Integration: earnPoints mock posts records.points = 5 (NEVER 50000)
- Integration: below-threshold = 0 POST calls (no DB write)

Real behavior tests (not source-level grep) — formula cannot silently drift back

---

## ⭐ Phase 91.1 — POS checkout auto-earn loyalty points [NEW FEATURE]

`earnPoints()` ใน `modules/loyalty.js` มีอยู่แต่ไม่มี caller ตั้งแต่ Phase 90.8 — feature gap ที่ flag ไว้. ตอนนี้ pos.js checkout success path เรียก earnPoints อัตโนมัติเมื่อมีลูกค้าใน `_posCustomer` + ระบบแต้มเปิด + อัตราตั้งค่าแล้ว

### Change (`modules/pos.js`)
1. **Capture site** หลัง `saleId` validate (L1135-): `const _earnCustomerId = _posCustomer?.id || null; const _earnAmount = actualTotal;` — ก่อน state-reset block ที่ null `_posCustomer`
2. **Fire-and-forget call site** หลัง `postJournalForSale` (L1218-): dynamic `import('./loyalty.js?v=' + APP_BUILD)` (Phase 90.7 cache-bust pattern) แล้วเรียก `earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx)`
3. **Guard** ที่ call site: เรียกเฉพาะเมื่อ `_earnCustomerId && state.loyaltySettings?.is_active && Number(state.loyaltySettings?.points_per_baht || 0) > 0` — silent skip ทุกกรณีที่ไม่ตรงเงื่อนไข (กัน toast "ระบบแต้มไม่เปิดใช้งาน" รั่วออกมาทุกบิล)
4. Amount basis = `actualTotal` (post-discount + VAT — ยอดที่ลูกค้าจ่ายจริง). refType = `'sale'`, refId = `saleId`
5. ctx ให้ `loadAllData: window.App?.loadAllData` — earnPoints success path จะ refresh state เพื่อให้ summary tab อัปเดตทันที (POS เองเรียก loadAllData ไปก่อนแล้ว 1 ครั้ง = duplicate refresh ยอมรับได้)

### Out of scope
- **Refund/cancel reversal** — ยังไม่ wire. ถ้า user refund / soft-delete sale หลังบ้าน → earn record ยังคา (over-credit ลูกค้า). Backlog: ใส่ `redeemPoints` call ใน refund/cancel flow ด้วย refType `'refund_reverse'` + negative points หรือ DELETE row
- **Manual tab role gate** — ยังเป็น product decision

### Tests (8 source-level assertions, `tests/pos_loyalty_auto_earn.test.js`)
1. Capture: `_earnCustomerId = _posCustomer?.id` + `_earnAmount = actualTotal`
2. Capture is AFTER `xhrPostPOS("sales", ...)`
3. Capture is BEFORE post-checkout reset (`_posCustomer = null; // เคลียร์ลูกค้าหลังจบบิล`)
4. Guard checks all 3: `_earnCustomerId` + `is_active` + `points_per_baht`
5. Call signature `.earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx)`
6. Dynamic import URL has `?v=APP_BUILD` cache-bust
7. No `await` on the import chain (fire-and-forget)
8. `.catch` with `console.warn` (no silent swallow)

### Build
- 252 → 253; version 5.43.48 → **5.44.0** (minor bump — new feature)
- `npm run verify`: lint + 168 unit + 11 e2e all green

---

## 🧹 Phase 90.13 — Loyalty history modal click-outside listener leak

`showPointHistory()` ใน `modules/loyalty.js` เคย `modal?.addEventListener('click', ...)` ทุกครั้งที่เปิด modal → เปิด N ครั้ง = N stacked listeners บน element เดียว. Action เป็น idempotent (`display = 'none'`) — UX ไม่พัง — แต่เป็น DOM listener leak จริงที่โตตามการใช้งาน. ถ้า future refactor เพิ่ม logic ใน handler นี้ จะยิง N ครั้ง

### Fix
- ย้าย listener ไปผูกครั้งเดียวใน `renderLoyaltyPage` (ข้างๆ Phase 89.23 close-button binding ที่ L253-257)
- `showPointHistory` แค่ toggle `display:block` — ไม่ผูก listener อีกแล้ว
- `tests/loyalty_history_modal_listener.test.js` — 4 source-level assertions (showPointHistory ไม่ผูก listener, renderLoyaltyPage ผูกครั้งเดียว, gate ด้วย `e.target === this`, ยังคงปิด modal ด้วย `display:none`, close-button binding ยังอยู่)

### Audit ที่เหลือ
- Manual tab role gate — product decision, ยังรอ user direction

---

## 🔐 Phase 90.12 — Loyalty settings save runtime admin guard

`modules/loyalty.js` save handler now starts with `if (!requireAdmin?.()) { showToast('สิทธิ์ไม่พอ — เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }`. UI gating at render time (L230) still hides the tab content from non-admins, but a runtime check inside the handler closes the gap when:
- A role is downgraded mid-session (stale DOM still holds the wired-up button)
- DevTools / extension injects a click directly
- Future refactor accidentally drops the render-time gate

Supabase RLS is the real gate. This is defense-in-depth + a clean user-visible refusal instead of a server-side error toast.

- `renderLoyaltyPage` destructure: `requireAdmin: _requireAdmin` → `requireAdmin` (dropped unused-prefix)
- `renderSettingsTab` now receives + uses `requireAdmin` from ctx
- `tests/loyalty_settings_admin_guard.test.js` — 5 source-level assertions (destructure clean, guard called with parens, guard before write, early-return, toast on refusal)
- `npm run verify` clean
- Build 250 → 251

### Audit findings still deferred
- B1 history modal click-outside listener leak — low risk
- Manual tab role gate — product decision, awaiting user

---

## 🔄 Phase 90.11 — Update UX hardening

`boot.js` now triggers `reg.update()` on a 10-min interval and on tab `visibilitychange` → visible. Existing watch-for-update / SKIP_WAITING / controllerchange flow is unchanged — the banner UX still owns reload. No auto-reload was added. Long-lived sessions (cashier leaves app open all day) now have multiple chances to see the update banner without manual reload.

- `boot.js` — new `startPeriodicUpdate(reg)` called from SW register `.then()`
- `tests/boot_periodic_sw_update.test.js` — 6 source-level assertions (interval scheduled, visibility gated, no reload, errors swallowed, wired in)
- `npm run verify` clean: lint + 151 unit + 11 e2e
- Build 249 → 250

### Audit findings deferred (out of scope per user spec)
- A1: settings save runtime `requireAdmin?.()` guard — defense-in-depth only (UI already gates content render). Save for later phase
- B1: history modal click-outside listener leak in `showPointHistory` (L631) — fires harmlessly N times but accumulates. Low risk
- Manual tab role gate — product decision (sales granting/redeeming points = store value). User has not asked

---

## 🔥 Phase 90.4 – 90.10 — Loyalty bug onion (6 layers) **CLOSED**

> ปุ่ม "บันทึกการตั้งค่า" + "เพิ่ม/แลกแต้ม" ใน Loyalty page เงียบสนิทมานาน — fix 6 ชั้น 7 phases, build 243 → 249.

| Phase | PR | Build | Layer | Root cause |
|-------|----|-------|-------|------------|
| 90.4 | #28+#29 | 243→244 | 1: dead code | `renderSettingsTab` มี `setTimeout(...).addEventListener` **หลัง** `return html` → handler ไม่ถูก attach |
| 90.5 | #30 (chore) | (no bump) | — | E2E/lint cleanup |
| 90.6 | #31 | 244→245 | 2: signature | settings save เรียก `_appXhrPatch(restUrl, payload, callback)` — ผิดสัญญา (จริงคือ `(table, payload, eqCol, eqVal) → Promise`) |
| 90.7 | #32 | 245→246 | 3: ESM cache | `main.js _lazyImport()` ไม่ใส่ `?v=APP_BUILD` ใน `import()` → browser ESM registry serve module 244-era ต่อ ถึงแม้ network คืนไฟล์ใหม่ |
| 90.8 | (prev) | 246→247 | 4: same signature bug 3 จุดอื่น | `earnPoints` / `redeemPoints` / manual-earn handler เรียก `_appXhrPost('/api/loyalty-points', rec, cb)` — REST path ผิด + callback ถูกทิ้ง |
| 90.9 | (prev) | 247→248 | 5: silent regression จาก 90.8 | `redeemPoints` async แต่คืน `void` — manual handler clear form มั่วๆ ทั้งกรณีสำเร็จ/ล้มเหลว |
| **90.10** | (this) | **248→249** | **6: ID type mismatch** | `customers.id` คือ `bigint` (number ใน JS) แต่ `<select>.value` คืน string เสมอ — `t.customer_id === customerId` = `1 === "1"` = false → `getCustomerPoints` คืน 0 เสมอ → "แต้มไม่พอแลก" ทั้งที่ลูกค้ามีแต้ม |

### Phase 90.10 fixes (this session)
- `modules/loyalty.js:41` `getCustomerPoints` — เปรียบเทียบด้วย `String(t.customer_id) === String(customerId)`
- `modules/loyalty.js:302` summary tab `customers.find(c => c.id === customerId)` — เคยมีปัญหาเดียวกัน (Object.entries key เป็น string, c.id เป็น number) → fallback แสดง `ลูกค้า #N` แทนชื่อจริง
- `modules/loyalty.js:561-566` `showPointHistory` — 2 จุดเดียวกัน, cast `String()` ทั้งคู่
- **ไม่แตะ insert side** (line 81/128/526) — PostgREST coerce string → bigint อัตโนมัติ ตอน INSERT/PATCH; แค่ comparison side ที่ JS strict equality bite

### Lessons (เพิ่ม)
- **DOM `<select>.value` คืน string เสมอ** — แม้ `<option value="${c.id}">` ส่ง number ก็ตาม. ถ้า column DB เป็น bigint → `===` จะ false ตลอด
- **`Object.entries(obj)` คืน key เป็น string เสมอ** — แม้ original key เป็น number key (e.g. when JS coerces) ก็ผ่าน `String(...)`. Trap เดียวกัน
- **Cast ที่จุด compare ดีกว่า cast ที่ boundary** — เพราะ boundary มีหลายจุด (DOM, JSON parse, Object.entries) แต่ compare มีน้อยกว่า + อ่านเข้าใจง่ายว่าทำไม
- **PostgREST insert ใจกว้างกว่า JS compare** — `bigint` column รับ `"2"` แล้ว coerce. JS `===` ไม่. นี่คือเหตุที่ insert side ไม่ต้องแก้ — แต่ read side ต้อง

### Phase 90.9 fixes (previous session — context)
- `modules/loyalty.js` — `earnPoints` + `redeemPoints` ทุก exit path คืน `{ok, error}` (mirror xhrPost shape) — early-return paths (`!is_active`, `< minRedeem`, `< remaining`, etc.) เคยคืน `void` → callers แยกผลไม่ได้
- `modules/loyalty.js` — manual tab redeem branch ใช้ `const r = await redeemPoints(...); if (r?.ok) { clear form }` — เคย clear ไม่มีเงื่อนไข
- earn branch ใน manual tab ใช้ `r?.ok` ของ xhrPost อยู่แล้วตั้งแต่ 90.8 — pattern consistent ทั้ง 2 branch

### Lessons (เพิ่ม)
- **Async refactor ต้อง revisit ทุก caller** — Phase 90.8 ทำ `redeemPoints` เป็น `async` แล้วใส่ `await` ที่ caller. แต่ caller ยังตั้งสมมติฐานเดิม (clear form unconditional) เพราะ return value type ไม่เปลี่ยน (ยังเป็น `void`/`Promise<void>`). Lesson: เปลี่ยน sync→async แล้วถ้า caller ใช้ผลลัพธ์ในเชิง UX ต้องเปลี่ยน return signature ด้วย ไม่ใช่แค่เพิ่ม `await`
- **Form clear belongs to caller, not callee** — `redeemPoints` ไม่รู้ว่า caller จาก manual tab หรือ POS auto-redeem. คนเรียกเท่านั้นที่รู้ว่า input อยู่ใน DOM ไหน + ควร clear เมื่อไหร่. Pattern ถูก: callee คืน status, caller decide

### Phase 90.8 fixes (previous session — context)
- `modules/loyalty.js:60` `earnPoints` → `async`, ใช้ `await _appXhrPost('loyalty_points', rec)` (เคยเป็น dead code — ไม่มี caller, แต่ fix ไว้กัน feature gap ในอนาคต)
- `modules/loyalty.js:102` `redeemPoints` → `async`, แก้ signature (เรียกจาก Manual tab line 540 — LIVE bug)
- `modules/loyalty.js:501` manual-earn click listener → `async`, แก้ signature (LIVE bug)
- ทั้ง 3 จุดใช้ pattern เดียวกับ Phase 90.6 settings save: `if (r?.ok) { ... } else { showToast('...: ' + r?.error?.message) }`

### Lessons (เพิ่มเติมจาก existing "Bug Onion" memory rule)
- **Audit ทุก call site ของ helper ที่ผิด signature** — ไม่ใช่แค่จุดที่ user report. Phase 90.6 fix settings save, แต่ใน file เดียวกันมี 3 จุดอื่นใช้ pattern เดิม (สังเกตเพราะ comment Phase 90.6 ที่ line 420 บอก signature ที่ถูกต้อง → grep `_appXhr*` ใน loyalty.js เจอ mismatch)
- **Dead exports = future trap** — `earnPoints` export แล้วไม่มี caller. ถ้า future session wire POS auto-earn จะหยิบโค้ดเสียไปใช้
- **REST URL vs table name** — `_appXhrPost(table, payload, opts)` ไม่ใช่ Express fetch wrapper. arg 1 ต้องเป็นชื่อตาราง Supabase ตรงๆ. ใส่ `/api/...` = ได้ URL `/rest/v1//api/...` = 404

### Feature gap (out-of-scope but flagged)
- `earnPoints()` export แต่ไม่มี caller. POS checkout ไม่ auto-earn loyalty points. ถ้าจะเปิด feature นี้: เรียก `earnPoints(customerId, totalAfterTax, 'sale', saleId, ctx)` หลัง sale insert success ใน `modules/pos.js` checkout flow (และอย่าลืม refund path เรียก reverse-record `type:'redeem'` หรือ negative `points`).

---

## ✅ Phase 89.41-89.44 — Race-condition resolution 4/4 COMPLETE (ของเดิม)

> 🏆 **Milestone reached (19 พ.ค.):** `require-atomic-updates` rule fully resolved across all 138 sites from Phase 89.40 audit. Lint warnings 361 → **9** (-97%) cumulative since 89.31.

---

## 🏆 Sprint Plan — Phase 89.36-89.44 COMPLETE + Phase 90.x Roadmap

> **Status:** Race-condition resolution **4/4 buckets RESOLVED** (138/138 sites). Sprint window 17-19 พ.ค. closed คลีน — **0 user intervention ระหว่าง autonomous batches**.
> **Methodology proven:** audit → bucket by risk → execute per bucket (TDD for HIGH/MED, silence for FALSE/LOW)
> **Reference prompts (production-ready templates):** `CLAUDE_CODE_PROMPT_89_{32,33,34,35,35b,36-39,40_AUDIT,41,42,43,44}.md`

---

### ✅ Phase 89.36-89.44 — Completed (17-19 พ.ค. 2026)

| Phase | PR | Build | Type | Impact |
|-------|----|----|------|--------|
| 89.36-89.39 | #20 | 241→242 | Mega-batch | Smoke + CF deploy + CI + executor-return cleanup |
| **89.40** | #21 | (audit only) | Audit | 138 warnings categorize: 6 HIGH / 6 MED / 83 FALSE / 43 LOW |
| **89.41** | #23 | 242 | Logic fix + TDD | HIGH_RISK race — `_inflight_guard.js` helper + POS/customer checkout |
| **89.44** | #24 | (no bump) | Silence batch | 83 FALSE_POSITIVE silenced (G/A/E/F/C/B categories) |
| **89.42** | #25 | 243 | Logic fix + TDD | MEDIUM_RISK — receipts multi-pay + POS quickPay + OTP verify guards |
| **89.43** | #26 | (no bump) | Silence batch | 43 LOW_RISK silenced (L1-L6 categories) — **milestone close** |

**Cumulative Phase 89.31 → 89.44:**
- Lint errors: 51,227 → **0** (-100%)
- Lint warnings: 361 → **9** (-97%)
- Unit tests: 33 → **126** (+93)
- E2E smoke: 0 → **11**
- Real bugs fixed: **3** (`dec` hoist + `filtered` scope + `showToast` undeclared)
- Race conditions guarded: **12 sites** (single-flight guards) + **126 sites** documented (silence + reason)

---

### 🎯 Immediate next — Phase 90.x Roadmap (optional)

**ที่เหลือ 9 warnings = different rules (NOT race-condition):**

| Phase | Rule | Count | Files | Type | Estimated |
|-------|------|------:|-------|------|----------|
| **90.1** | `no-misleading-character-class` | 5 | products.js | Audit Thai regex — emoji/charclass patterns | 30 min |
| **90.2** | `no-control-regex` | 2 | bt_printer.js | ESC/POS control bytes — likely intentional, silence + comment | 10 min |
| **90.3** | `no-irregular-whitespace` | 1 | accounting/coa.js | Thai whitespace in comment — fix or silence | 5 min |
| **90.4** | `no-unreachable` | 1 | loyalty.js:417 | **Possibly real bug** — dead code branch, audit ก่อน | 15-30 min |

**Recommended order:** 90.4 ก่อน (potential real bug) → 90.1 (audit) → 90.2 + 90.3 (silence batch)

**Or accept as acceptable noise** — ทั้ง 9 ตัวเป็น style/syntax-level, ไม่กระทบ correctness. Decision ขึ้นกับ aesthetics vs. effort.

---

### 🔧 Tech debt — Higher risk (เก็บไว้ Phase 91+)

1. **Re-enable `no-async-promise-executor`** — refactor `modules/auth.js` `showStaffLogin` Promise pattern (PIN login flow เปราะ — ต้อง regression test ก่อน)
2. **C8 coverage report** — target ≥ 30% (ใช้ตรวจว่าเขียน test ครอบคลุมไหม)
3. **E2E login flow test** — ต้อง Supabase test project (out-of-scope ของ current sandbox)
4. **Promote `no-promise-executor-return` warn → error** — pattern เสร็จแล้ว Phase 89.36-89.39

---

### 🛡️ Long-term — CSP hardening continued (Phase 92+)

1. **M4 part 2** — drop `style-src 'unsafe-inline'` (refactor 121 inline styles → CSS classes)
   - Prerequisite: ครบ Phase 89.23+ inline handler sweep iter
2. **Inline handler sweep iter #2 + #3** — continue from Phase 89.23 iter #1 (13 handlers → addEventListener)
3. **Re-attempt drop script-src `'unsafe-inline'`** — หลัง inline handlers ล้างหมด (จาก Phase 89.15b rollback lesson)

---

### 📝 Backlog (low priority — เก็บไว้)

- **Hot-path unit tests:** เพิ่ม coverage ของ auto_post.js + pos.js checkout + receipts cancel + cash_recon (126 → 160+)
- **HANDOFF.md refactor:** archive Phase 1-80 (currently ~260KB) + CI auto-bump build
- **Audit Panasonic error codes** — `modules/error_codes.js` H33/H58/H98/H99 commented dupe keys (จาก Phase 89.31 cleanup) — ต้อง user verify service manual ก่อน

---

### 🏁 Definition of Done — Sprint 89.x **CLOSED** (Phase 89.50 target exceeded)

หลัง Phase 89.43 merged เข้า main:
- ✅ Lint warnings ≤ 50 — **achieved 9** (original target 50, exceeded by 41)
- ✅ Unit tests ≥ 120 — **achieved 126**
- ✅ Race-condition resolution 138/138 — **achieved**
- ✅ Re-enable `no-undef` rule — **achieved Phase 89.35**
- ✅ CI: lint + test + e2e ทุก PR — **achieved Phase 89.36-89.39**
- ⏳ E2E coverage: login + checkout + JV post (real flows) — **needs Supabase test project**
- ⏳ CSP: drop unsafe-inline — **Phase 92+**
- ⏳ Re-enable `no-async-promise-executor` — **Phase 91+**

**Next milestone:** Phase 90 audit ของ 9 warnings ที่เหลือ, OR jump to Phase 91/92 ถ้า user prioritize tech debt/CSP มากกว่า aesthetic cleanup.

---

## 📚 Phase 89.30-89.44 — Session Summary (16-19 พ.ค.)

สรุปสิ่งที่ทำใน 4 วัน sprint (16, 17, 18, 19 พ.ค. 2026):

| Phase | PR | Build | Impact |
|-------|----|----|--------|
| 89.30 | (previous session) | 240 | XSS hardening batch H1+H2+H3+S6+S7 |
| **89.31** | #14 | (no bump — tooling) | ESLint flat config + Playwright + 3-gate verify, errors **51,227→0** |
| **89.32** | #15 | (no bump — cleanup) | prefer-const + unused vars, warnings 361→207 |
| **89.33** | #16 | (no bump — cleanup) | no-useless-escape + eslint-disable, warnings 207→193 |
| **89.34** | #17 | (no bump — config) | no-undef sweep + 2 bugs discovered, warnings 193→164 |
| **89.35** | #18 | 240 | **Fix 2 real bugs** (dec hoist + Excel export filter) + no-undef → error |
| **89.35b** | #19 | **240→241** | Hotfix showToast undeclared + bump 240→241 (full ?v= sync) + empty commit retrigger |
| **89.36-89.39** | #20 | **241→242** | Mega-batch: smoke ?v= scan + CF deploy commit-message override + CI lint/e2e + no-promise-executor-return |
| **89.40** | #21 | (audit only) | 138 require-atomic-updates categorized — 6 HIGH / 6 MED / 83 FALSE / 43 LOW |
| **89.41** | #23 | 242 | **HIGH_RISK fix** — `_inflight_guard.js` helper + POS checkout + customer dashboard checkout (TDD, 7 helper tests) |
| **89.44** | #24 | (no bump) | **FALSE_POSITIVE silence batch** — 83 entries with G/A/E/F/C/B reason categories |
| **89.42** | #25 | **242→243** | **MEDIUM_RISK fix** — receipts multi-pay + POS quickPay (replace window._checkoutRunning) + OTP verify/request guards (TDD, 23 new tests) |
| **89.43** | #26 | (no bump) | **LOW_RISK silence batch** — 43 entries with L1-L6 reason categories. **Closes race-condition 4/4 🏆** |

**Cumulative Phase 89.30 → 89.44 (4 days):**
- Errors: 51,227 → **0** (-100%)
- Warnings: 361 → **9** (-97%) ✨
- Unit tests: 33 → **126** (+93)
- E2E smoke: 0 → **11**
- Real bugs fixed: 3 + 12 race-protection sites guarded
- Race conditions resolved: **138/138** (100%)
- Autonomous batches: **11** (89.32-89.44 ทุกตัว), 0 user intervention ระหว่าง batch
- Production builds: **240 → 243** (4 builds across 4 days)

**Documentation files (production-ready prompt templates):**
> ⚠️ *(historical snapshot 2026-05-16)* — ปัจจุบัน 2 ไฟล์ล่างนี้ **superseded** แล้ว: entrypoint จริง = `IMPLEMENT_TEAM_PROTOCOL.md` (ทั้งคู่เหลือเป็น redirect)
- `CLAUDE_SESSION_HANDOFF.md` — ~~Claude session continuity (อ่านก่อนเริ่ม)~~ → superseded
- `CLAUDE_CODE_WORKFLOW.md` — ~~autonomous loop guide~~ → superseded
- `SETUP_TOOLING.md` — ESLint + Playwright setup steps (done)
- `AUDIT_REPORT_89_40.md` — race-condition categorization (138 entries, 4 buckets)
- 10+ phase prompt templates: `CLAUDE_CODE_PROMPT_89_{32,33,34,35,35b,36-39_BATCH,40_AUDIT,41,42,43,44}.md`
- `SESSION_SUMMARY_2026-05-16.md` — daily recap

**Memory rules บันทึก (ใน CLAUDE_SESSION_HANDOFF.md):**
- `Cloudflare deploy pattern` — ไม่มีปุ่ม Retry deployment, ใช้ empty commit ASCII-only retrigger (Phase 89.35b verified)
- `Phase 89.13a regression x3` — bump ALL `?v=N` refs (selfheal + main + boot + style.css)
- `Optional chaining ?.() ≠ undeclared protection` — root identifier ต้องอยู่ใน lexical scope
- `Bug Onion` — fix แรกอาจเปิดเผย bug ชั้นที่ 2 → manual smoke test ทุกครั้งหลัง logic fix
- `Audit-driven 4-bucket workflow` (Phase 89.40-89.44 proven) — categorize once, execute per bucket: TDD for HIGH/MED, silence+reason for FALSE/LOW. Helper modules (e.g. `_inflight_guard.js`) ที่สร้างใน HIGH phase reuse ได้ใน MED phase.

---

## 🗂️ Sprint Production Plan — สรุปสถานะ (15 พ.ค. 2026)

Last session: full audit 3-agent → 4 Critical + 7 High + 8 Medium. User เลือก fix batch แรก (C1+H4 — Phase 89.24 ต่อ).

### Production state ปัจจุบัน
- **Build live:** 239 (`window.APP_BUILD === 239`)
- **Tests:** 87/87 pass
- **SQL pending (user run):** `supabase-phase89-29-jv-gaps.sql` — ก่อน deploy build 239 จะทำให้ refund JV ทำงาน
- **Migration SQL ที่รันไป:**
  - `supabase-phase89-13b-fix-invoiced-status.sql` ✅
  - `supabase-phase89-14-error-log-rate-limit.sql` ✅
- **SQL pending (user action required):**
  - `supabase-phase89-25-fix-je-rls-pos.sql` — fix RLS for POS auto-post JV
  - `supabase-phase89-26-audit-missing-jvs.sql` — read-only audit (run after 25)

### Audit batch outstanding (Phase 89.27 batch แรก เสร็จ — 9 รายการเหลือ)
| ID | Description | Severity | Status |
|----|-------------|----------|--------|
| ~~**C1**~~ | Phase 89.24 filter ค้ำเพดาน .limit(50) | Critical | ✅ Phase 89.27 |
| ~~**H4**~~ | 4 หน้า report เห็นยอดคนอื่น | High | ✅ Phase 89.27 |
| ~~**C2**~~ | credit_tracker.js:248 รับชำระเครดิตไม่ post JV | Critical | ✅ Phase 89.29 |
| ~~**C3**~~ | refunds.js:343 ไม่ post JV (Sales Returns) | Critical | ✅ Phase 89.29 |
| ~~**C4**~~ | expenses.js:522 PATCH ไม่ void+repost JV | Critical | ✅ Phase 89.29 |
| **H1 XSS** | service_jobs.js:191 slip URL attribute breakout | High | ⏳ |
| **H2 XSS** | customer_dashboard.js:291 product image_url CSS injection | High | ⏳ |
| **H3 XSS** | quotations.js:651/684 search dropdown ไม่ escHtml | High | ⏳ |
| **H5** | auto_post.js:202 doc_no UNIQUE race → JV ใบที่ 2 หาย | High | ⏳ |
| **H6** | main.js:46 _lazyImport cache rejected promise → sticky fail | High | ⏳ |
| **H7** | customer_dashboard.js:692 ลูกค้ายืนยันปิดงาน ไม่ post JV | High | ⏳ |

### Phase 89.27 + 89.28 sprint progress (เสร็จ session นี้)
| Issue | Phase | Status | File |
|-------|-------|--------|------|
| **C1** Phase 89.24 filter ค้ำเพดาน .limit(50) | 89.27 | ✅ live | main.js:1450 + utils.js |
| **H4** 4 หน้า report ไม่ filter ตาม 89.24 | 89.27 | ✅ live | dashboard.js + profit_report.js + top_customers.js + sales_heatmap.js |
| **Daily LINE summary leak** | 89.27 | ✅ admin-only gate | dashboard.js:1101 |
| **8 unit tests** sales filter | 89.27 | ✅ 79/79 pass | tests/sales_filter.test.js |
| **M4** Dashboard TZ bug — slice(0,10) UTC vs todayKey BKK | 89.28 | ✅ live | dashboard.js (12 จุด) |
| **8 unit tests** TZ today filter regression | 89.28 | ✅ 87/87 pass | tests/tz_today_filter.test.js |
| **C2** Credit payment ไม่ post JV → A/R ค้าง | 89.29 | ✅ live | credit_tracker.js + auto_post.js |
| **C3** Refund ไม่ post JV → P&L รายได้เกิน | 89.29 | ✅ live | refunds.js + auto_post.js |
| **C4** Edit expense ไม่ void+repost JV → P&L stale | 89.29 | ✅ live | expenses.js |
| **M1** credit_payments step 1 ไม่ check r.ok | 89.29 (bundle) | ✅ live | credit_tracker.js |
| **SQL migration** seed 4110 + refund mappings | 89.29 | ⏳ user run | supabase-phase89-29-jv-gaps.sql |

### Sprint progress
| Issue | Phase | Status | File |
|-------|-------|--------|------|
| **C1** receipts.js `.catch` dead | 89.13 | ✅ verified | receipts.js |
| **C2** sw.js CACHE_NAME stuck v206 | 89.13 | ✅ verified | sw.js |
| **C3** error_reporter dedup race | 89.13 | ✅ | error_reporter.js |
| **H1** JWT refresh single-flight | 89.13 | ✅ | main.js |
| **H3** beforeSend throw loop | 89.13 | ✅ (covered by C3) | error_reporter.js |
| **?v=** main.js cache buster stuck 218 | 89.13a hotfix | ✅ verified | index.html |
| **enum typo** "invoiced" not in delivery_invoices.status | 89.13b hotfix | ✅ verified | receipts.js + SQL migration |
| **M6** Auth-gate Gemini/SlipOK APIs | 89.14 | ✅ live | functions/_middleware.js |
| **L4** Redact URL PII in error_log | 89.14 | ✅ live | error_reporter.js |
| **M7** error_log spam protection | 89.14 | ✅ live + SQL ran | functions/api/log-error.js + SQL |
| **M4 part 1** drop script-src unsafe-inline | 89.15 → rollback 89.15b | ⚠️ **PARTIAL** — selfheal/boot externalized but unsafe-inline restored | _headers + selfheal.js + boot.js |
| **APP_BUILD global** (bonus bug from M4 work) | 89.15 + 89.15a hotfix | ✅ verified | selfheal.js (sync setter + querySelector fallback) |
| **CSP regression** + **UI refresh after status change** | 89.15b hotfix | ✅ verified | _headers (rollback) + receipts.js (await loadAllData) |
| **M1** voidJvForSource silent fail (double-revenue) | 89.16 | ✅ verified | auto_post.js (pre-check + toast) |
| **M2** products.stock CAS divergence | 89.17 | ✅ live (just deployed) | main.js:3200 |
| **M3** cash_recon.js TZ filter | 89.17 | ✅ live | cash_recon.js:42,51 |
| **L2** stock_cas null === 0 retry forever | 89.17 | ✅ live | stock_cas.js:52 |

### ⏳ Backlog ที่เหลือ
| ID | Description | Severity | Estimate |
|----|-------------|----------|----------|
| **Phase 1.5** | Inventory + refactor inline `on*=` HTML event handlers in modules → addEventListener (pre-req to re-attempt M4 unsafe-inline drop) | Medium effort | ~1-2 days |
| **M5** | `products.js:100` inline `onerror` XSS surface (escape pattern เปราะ) | Low–Med | ~30 min |
| **Phase 4** | Unit tests for auto_post.js + pos.js checkout + receipts cancel + cash_recon | Medium | ~3-5 days |
| **Phase 5** | Refactor HANDOFF.md (261KB → archive Phase 1-80) + CI auto-bump build | Low | ~1 day |
| **M4 part 2** | Drop `style-src 'unsafe-inline'` (refactor 121 inline styles) | High effort | ~4-6 hours |

### Memory rules อัพเดทใหม่ในรอบนี้ (สำหรับ session ใหม่)
- `feedback_version_display_sync.md` — **4 sub-items** ที่ต้อง bump ทุก build (เดิมบอก 3, เพิ่ม `main.js?v=`)
- `feedback_cross_check_schema.md` (ขยาย):
  - **Verify enum VALUE** ก่อน PATCH (grep STATUS_LABELS) — ไม่ trust comment
  - **Inventory ALL patterns ก่อน drop CSP keyword** — inline script + inline event handlers + javascript: URLs + inline styles
- `feedback_autonomous_edits.md` (ขยาย) — **Anti-rapid-fire push:** ห้าม push commit ที่ 2 ติดกันถ้า commit ที่ 1 ยังไม่ verify (ยกเว้น hotfix regression)

### บันทึกบทเรียนจาก session นี้ (ผมพลาดเอง)
1. Phase 89.13 audit — เจอ pattern bug (.catch dead) แต่ไม่ verify enum value → propagate "invoiced" typo (Phase 89.6 ของเดิม) → ต้อง 89.13b hotfix
2. Phase 89.13a — ลืม bump `main.js?v=` แม้ memory rule บอกชัด — ผม "อ่านผ่าน" → user แจ้ง regression
3. Phase 89.15 — drop CSP `unsafe-inline` โดยไม่ inventory inline event handlers → 16 CSP violations + ปุ่มพัง → 89.15b emergency rollback
4. Pattern: **rapid-fire push 5 builds ใน 1 ชม** → user เหนื่อย verify → memory rule "anti-rapid-fire" + WIP commit pattern

---

## 🚑 Phase 89.13 — Critical regression fix batch (build 222) — 12 พ.ค.

### Context
หลัง full audit (3-agent parallel review) เจอ **2 Critical + 3 High + 5 Med/Low** บัค โดยเฉพาะ 2 regression เก่า + 1 race condition ของ Phase 89.12 ที่เพิ่งคลอด → batch fix ทันที

### Findings & fixes

| ID | Severity | จุด | Root cause | Fix |
|----|----------|-----|------------|-----|
| C1 | Critical | [receipts.js](modules/receipts.js) 3 จุด | `_appXhrPatch.catch(...)` dead code — xhrPatch return resolved `{ok,error}` ไม่เคย reject → restore invoice fail เงียบ (Phase 89.6 regression) | `await` + check `res.ok` + showToast warn |
| C2 | Critical | [sw.js:3](sw.js:3) | CACHE_NAME ค้างที่ `v206` (จริง 222 = ห่าง 15 builds) → user offline เสิร์ฟ build เก่า | bump เป็น `v222` |
| C3 | Critical | [error_reporter.js:62-98](modules/error_reporter.js:62) | `sent.add(fp)` + `stats.sent++` อยู่หลัง `await beforeSend` → 2 errors เดียวกัน fire พร้อมกัน burst POST | ย้าย `sent.add` + `sent++` ขึ้น ก่อน beforeSend |
| H1 | High | [main.js:124-155](main.js:124) | `_refreshInflight = null` sync ใน finally → concurrent 401 trigger refresh พร้อมกัน → Supabase rate-limit | `setTimeout(...,3000)` clear (absorb herd) |
| H3 | High | [error_reporter.js:84-95](modules/error_reporter.js:84) | beforeSend throw → `payload=null` + return ก่อน `sent.add()` → error เดิม trigger send() ซ้ำๆ ไม่หยุด | sent.add ขึ้นก่อน beforeSend (C3 fix ครอบด้วย) |
| L1 | Low | [error_reporter.js POST](modules/error_reporter.js:102) | fetch 4xx ไม่ throw → RLS/PGRST204 ไม่ log | เช็ค `r.ok` + warn |
| L2 (related) | — | error_reporter `build` | snapshot ตอน init → null forever ถ้า APP_BUILD set ทีหลัง | รับ `build` เป็น function ได้ (lazy) |

### Files touched (5)
1. `sw.js` — CACHE_NAME v206 → v222 + comment
2. `index.html` — APP_BUILD 221 → 222
3. `modules/settings/pages.js` — version 5.43.17/build 221 → 5.43.18/build 222
4. `modules/error_reporter.js` — race fix + lazy build + refund slot + r.ok check
5. `modules/receipts.js` — 3 จุด restore invoice (bulk cancel + single primary + single fallback)
6. `main.js` — refresh inflight setTimeout 3s

### Verify after deploy
1. **Ctrl+Shift+R** ครั้งเดียวบนทุกเครื่อง → DevTools → Application → Cache Storage เหลือแค่ `boonsook-pos-v5-cache-v222` (v206 หาย)
2. **Footer/Settings** เห็น "build 222"
3. **Smoke test C1:** ออกใบเสร็จจากใบส่งสินค้า → ยกเลิกใบเสร็จ → เปิด tab ใบส่งสินค้า → status = "รอดำเนินการ" ✅ (ก่อน fix จะค้างเป็น "รับเงินแล้ว")
4. **Smoke test H1:** ทิ้ง POS เปิด >1 ชม. → กด refresh dashboard → ไม่มี toast "Session หมดอายุ" หลายครั้ง (refresh ครั้งเดียวพอ)

### Known bugs ยังไม่แก้รอบนี้ (สำหรับ batch ถัดไป)
- **M1** `voidJvForSource` silent fail (RLS DELETE = 0 rows) → double-revenue risk
- **M3** `cash_recon.js:51` filter expense ใช้ `.slice(0,10)` raw → TZ bug รอบเก่ายังครอบไม่หมด
- **M4** CSP `script-src 'unsafe-inline'` ยังอยู่
- **M5** `products.js:100` inline `onerror` pattern เปราะ (escape gated by .charAt(0))
- **M6** `/api/parse-receipt` + `/api/verify-slip` เปิด anon → cost-abuse risk
- **M7** error_log RLS anon INSERT spam risk (ผ่าน publishable key)
- **L4** error_log payload เก็บ full URL → share token PII leak risk
- **L2** stock_cas.js null → 0 → infinite CAS retry
- **M2** products.stock CAS divergence เมื่อ warehouse_stock fail

→ Critical/High clear, Med/Low ค้าง 9 รายการ — แนะนำเรียงตาม priority: M6 → M1 → M2 → M5 → M3

---

## 📚 Phase 89 series summary (11-12 พ.ค. 2026 — 2 วัน)

| Phase | Build | สิ่งที่แก้ | Verified |
|-------|-------|----------|----------|
| 89.1 | 207 | Security headers + XSS share.html + Timezone BKK + JV-void + POS auto-post payload | ✅ user |
| 89.2 | 208 | JV rollback + BANK_COA validate + Float round + Backfill UI + dbl-click | ✅ user |
| 89.2b | 209 | Chart.js pin UMD + CSP script-src-elem + cloudflareinsights | ✅ user |
| 89.2c | 210 | CSP connect-src for SW CDN fetch | ✅ user (dashboard render OK) |
| 89.2d | 211 | Auto-refresh JWT on 401 (single-flight + _appAuthFetch) | ✅ user |
| 89.3 | 212 | Delete POS sale ครบวงจร (void JV + revert stock) | ✅ user (฿214 → 4100 ลด ฿200) |
| 89.3a/89.4 | 213 | Hot-path 401 coverage + 4 dbl-click guards + round2 export + log polish | ✅ |
| 89.5 | 214 | CDN SRI (5 scripts, SHA-384) — supply-chain protection | ✅ |
| 89.6 | 215 | Cancel receipt → restore invoice status (BUT regression — see 89.13) | ⚠️ regression |
| 89.7 | 216 | Filter chip UX clarity | ✅ |
| 89.9 | 218 | Stabilization batch 2 (H10 stock race + H11 cash_recon TZ) | ✅ partial (M3 ยังครอบไม่หมด) |
| 89.10 | 219 | Drop CSP 'unsafe-eval' | ✅ |
| 89.11 | 220 | Extract CAS module + first unit tests | ✅ |
| 89.12 | 221 | Error tracking via Supabase error_log | ⚠️ race fixed in 89.13 |
| **89.13** | **222** | **Critical regression batch — sw cache + .catch dead + reporter race + refresh single-flight** | **⏳ pending** |

**8 builds + 1 day** — ครอบ Critical + High + defensive papercuts จาก audit เดิม

---

## 🛡️ Phase 89.4 — Hot-path 401 + dbl-click + round2 (build 213) — 11 พ.ค.

### Context
หลัง Phase 89.3 ผ่าน → ทำ defensive batch ตอน user ไปทำงาน (autonomous, low-risk only)

### What shipped
1. **Log polish:** `voided N JV(s) ... (will re-post)` → `voided N JV(s)` ([auto_post.js:93](modules/accounting/auto_post.js:93))
2. **Migrate raw fetch → _appAuthFetch** ที่ critical writes:
   - auto_post.js: 4 sites (void/post entry/post lines/rollback)
   - delivery_invoices.js: bulk + single delete
   - receipts.js: bulk delete
3. **Double-click guard** เพิ่ม 4 ปุ่ม: diBulkCancel, diBulkDelete, rcBulkCancel, rcBulkDelete
4. **round2()** export กลางใน utils.js + ใช้ใน quotations form line_total

### Result
- ทุก critical write path ครอบ 401 retry — JWT expire ตอน accounting/cancel ก็ refresh เอง
- Bulk delete/cancel กดรัวๆ = 1 PATCH (ปุ่มเทาทันที)
- quotation line_total ไม่มี `0.30000000000000004` อีก

---

## 🔐 Phase 89.5 — CDN SRI (build 214) — 11 พ.ค.

### Context
จาก audit Phase 89.1: HIGH risk #C2 — CDN scripts ไม่มี SRI → CDN compromise = full DOM/token access

### What shipped
- เพิ่ม `integrity="sha384-..."` + `crossorigin="anonymous"` ให้ 5 CDN scripts
- Hashes computed: `curl URL | openssl dgst -sha384 -binary | openssl base64`
- Auto-verified against live HTML + CDN content ปัจจุบัน

### Hashes (สำหรับ reference เผื่อ upgrade version)
| Library | Version | Hash (SHA-384) |
|---------|---------|----------------|
| chart.js | 4.4.7 UMD | vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC |
| jspdf | 2.5.1 UMD | JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk |
| html5-qrcode | 2.3.8 | c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+ |
| xlsx (SheetJS) | 0.20.1 | QCIdq2UMVEoSRhR3ZWZwdz2/pivLowr+eokFMdYyukq7qI26VYRxFa4Nl6FKetmL |
| jsbarcode | 3.11.6 | Kk5SjBOKprEnGfyBWfD2zROFd1Cu8kwOXxG2GIhYPcoDL2rBJS9P8Ud1ZMy4412a |

### Risk note
- Upgrade version ของ library ต้อง regenerate hash (ไม่งั้น script ไม่โหลด → Chart undefined)
- Workflow upgrade: 
  ```bash
  curl -sL "<NEW URL>" | openssl dgst -sha384 -binary | openssl base64 -A
  # → paste เข้า integrity attribute + bump build
  ```

---

---

## 🛡️ Phase 89.2 — Defensive Fixes Batch 1 (build 208) — 11 พ.ค.

### Context
หลัง Phase 89.1 (build 207) เสร็จ + user เลือก "เน้นไม่ให้แอปพัง" → ทำ defensive fixes ที่ความเสี่ยง break ต่ำ 5 ข้อก่อน

### What shipped (build 208)

**1. 💾 JV orphan rollback**
- `modules/accounting/auto_post.js:223-243` — ถ้า lines insert fail → DELETE entry รถอลแบ็ค
- เดิม: entry ค้าง trial balance พังเงียบ + admin ต้องมาลบเอง
- ตอนนี้: rollback อัตโนมัติ + ถ้า rollback ล้มเหลว (network/RLS) → showToast เตือน admin

**2. 🏦 BANK_COA regex tighten + validate**
- `modules/accounting/auto_post.js:286` — regex จาก `/BANK_COA:(\d{4,5})/` → `/(?:^|[\s•])BANK_COA:(\d{4,5})(?=$|[\s•])/` (anchor + word boundary)
- เพิ่ม `_getValidCoaCodes()` cache + validate กับ `chart_of_accounts` ก่อน override Dr account
- ถ้า COA invalid → fall back ไป default mapping + showToast
- เดิม: typo `BANK_COA:9999` → FK error เงียบ ไม่มี JV เลย

**3. 🔢 Float math rounding**
- `modules/pos.js`:
  - เพิ่ม `round2()` helper
  - Numpad sum (บรรทัด 476): `round2(Number(numpadValue) + Number(v))`
  - line_total (บรรทัด 1127): `round2(qty * price)`
  - salePayload money fields ทั้งหมด: subtotal, total_amount, paid_amount, change_amount, vat_amount, subtotal_before_vat → ใช้ `round2()` 
- เดิม: `0.1+0.2 = 0.30000000000000004` เข้า DB → balance check fail บางครั้ง

**4. 📅 Backfill UI effective date**
- `modules/accounting/backfill.js:62` UI warning + `:131` cutoff logic — `2026-01-01` → `2026-05-01`
- เดิม: user เห็น UI บอก "rows ก่อน 2026-01-01 จะ skip" แต่ logic ใน auto_post.js (Phase 88.18b) ใช้ `2026-05-01` แล้ว → confused

**5. 🛑 Double-click guard ใน receipt preview**
- `modules/receipts.js:698-720` — "เก็บเงิน" + "ยกเลิก" buttons
- เพิ่ม `btn.disabled = true` + opacity + text "⏳ กำลัง..." → restore เฉพาะตอน error
- กัน user double-tap = duplicate PATCH + JV post ซ้ำ (DB มี unique index จับได้แต่ UX สับสน)

### Test plan
1. **POS float math:** ขายของ ฿0.10 + ฿0.20 → ตรวจ DB sale_items.line_total = `0.30` (ไม่ใช่ `0.30000000000000004`)
2. **JV rollback:** ดู console log ตอน checkout — ถ้าเห็น `[auto_post] rollback OK` หรือ `lines insert failed (entry NN), rolling back` แสดงว่าทำงาน
3. **BANK_COA validate:** ตั้งค่า bank ด้วย COA code ผิด (เช่น 9999) → ขายแบบโอน → คอนโซลต้องเห็น "BANK_COA invalid: 9999 — falling back to default 1130" + toast
4. **Backfill UI:** เปิดหน้า Backfill → ต้องเห็น "Effective date: 2026-05-01"
5. **Double-click guard:** เปิดใบเสร็จ pending → กดเก็บเงินรัวๆ → patch + JV ต้องเกิดครั้งเดียว (ดู Network tab)

### Files changed
- `modules/accounting/auto_post.js` — rollback + BANK_COA validate (+~50 บรรทัด)
- `modules/accounting/backfill.js` — effective date 2 จุด
- `modules/pos.js` — round2 helper + ใช้ใน 5 จุด
- `modules/receipts.js` — double-click guard 2 ปุ่ม
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 208
- `CHANGELOG.md`, `HANDOFF.md`

### Batch 2 ที่รออยู่ (Phase 89.3 — high-risk)
- Tighten RLS sales/customers/profiles_with_email — ลูกค้าเห็นเฉพาะของตัวเอง
- Admin-only RLS บน permissions table
- SRI hash + version pin ทุก CDN script
- ⚠️ ต้องทดสอบรอบคอบ — RLS ผิดอาจทำให้ user ทั้งหมด access ไม่ได้

---

## 🛡️ Phase 89.1 — Phase A Security & Critical Bug Sweep (build 207) — 11 พ.ค.

### Context
หลัง full-codebase audit (security / code quality / bugs / performance) — เจอปัญหา critical 5 ตัวที่อาจทำให้บัญชีและภาษีผิดเงียบ + ช่องโหว่ security ระดับ takeover account ได้ — ทำ "Phase A" หยุดเลือดออกก่อน

### What shipped (build 207)

**1. 💸 POS auto-post — pass full salePayload**
- `modules/pos.js:1187-1196` — เดิม pass `{id, order_no, customer_name, payment_method, total_amount, created_at}` เท่านั้น
- ขาด `note` (BANK_COA) + `vat_amount` + `vat_rate` + `subtotal_before_vat`
- ผลกระทบ: Phase 88.20 bank picker + Phase 88.21 VAT split พังเงียบ → JV ขาดบรรทัด Cr 2170 + override bank ไม่ทำงาน
- Fix: `postJournalForSale({ ...salePayload, id, created_at })`

**2. 📑 JV void on cancel — 5 จุด**
- `delivery_invoices.js`: bulk cancel + dropdown cancel
- `receipts.js`: bulk cancel + dropdown cancel + preview cancel
- ทุกจุดเรียก `voidJvForSource("delivery_invoices"|"receipts", id)` หลัง PATCH สำเร็จ
- ผลกระทบเดิม: ยกเลิกใบเสร็จ → JV เก่าค้าง → รายได้นับซ้ำใน P&L

**3. 🌏 Bangkok timezone helpers**
- `modules/utils.js`: เพิ่ม `todayBkk()`, `dateBkk(date)`, `addDaysBkk(n)` — ใช้ `Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Bangkok"})`
- Replace `new Date().toISOString().slice(0,10)` (UTC) ใน 7 accounting files
  - `auto_post.js` (5 จุด — sale/expense/job/receipt/invoice doc_date)
  - `backfill.js` (todayStr + defaultFrom)
  - `profit_loss.js` (date range default + prev period)
  - `trial_balance.js` (date range default)
  - `balance_sheet.js` (defaultAsOf)
  - `export_bundle.js` (date range default)
  - `journal_form.js` (today default)
- ผลกระทบเดิม: ตี 1-6 โมงเช้าไทย doc_date กลายเป็นเมื่อวาน → ถ้าเมื่อวานปิดงวด → JV ถูก reject

**4. 🛡️ XSS fix ใน share.html (public page)**
- เปลี่ยน photo `onclick="window.open('${esc(url)}')"` → `data-photo-url` + delegated listener
- เพิ่ม `safeUrl()` (allow http/https only) + `safeTel()` (digit-only)
- `window.open(u, "_blank", "noopener,noreferrer")`
- ผลกระทบเดิม: photo URL ที่มี apostrophe → escape เป็น `&#039;` → browser decode ก่อน JS eval → XSS ในหน้า public no-auth

**5. 🔒 Security headers**
- `_headers` — เพิ่ม block `/*` (Cloudflare Pages merge):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(self), bluetooth=(self), serial=(self)`
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdn.sheetjs.com https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https://esm.sh; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`
- หมายเหตุ: ใช้ `unsafe-inline`+`unsafe-eval` เพราะ codebase มี onclick="" + jsPDF — Phase B จะ refactor

### ⚠️ User actions ที่ต้องทำเอง (ก่อน/หลัง deploy)

**ก่อน deploy:**
1. **ปิด `OTP_WEB_FALLBACK` ใน Cloudflare Pages env** (CRITICAL)
   - ไปที่ Cloudflare Dashboard → Pages → boonsook-pos → **Settings** → **Environment variables**
   - หา `OTP_WEB_FALLBACK` → ลบ หรือเปลี่ยนเป็น `false`
   - ทั้ง **Production** และ **Preview**
   - เหตุผล: endpoint `/api/send-otp` คืน `devCode` ใน HTTP response → ใครรู้เบอร์ลูกค้าก็เข้าบัญชีได้ทันที (ไม่ต้องมือถือลูกค้า)
   - ผลกระทบหลังปิด: ลูกค้าจะใช้ login OTP ไม่ได้ถ้ายังไม่ได้ตั้ง Twilio — ถ้าตอนนี้ระบบ SMS ยังไม่พร้อม → leave fallback ไว้แต่ตั้ง `OTP_REQUIRE_ADMIN_FOR_DEV_CODE=true` (ยังต้อง implement)

**หลัง deploy — ทดสอบ:**
1. **POS VAT + Bank picker:** ขายของจริงเปิด VAT 7% → checkout → ดู journal entries ต้องมี **3 บรรทัด** (Dr bank/cash + Cr revenue + Cr 2170 VAT) + Dr account ตรง bank ที่เลือก
2. **Cancel ใบเสร็จ:** เปิด P&L ก่อน → ยกเลิกใบเสร็จ 1 ใบ → reload P&L → รายได้ต้องลดลงตามใบที่ยกเลิก
3. **Timezone:** ลองตั้งนาฬิกาคอมเป็น 02:00 ไทย (จริงๆ ทดสอบยาก) — หรือเช็ค `localStorage` → `new Date()` ของ JV ที่ลงตอนเช้ามืด ต้องเป็นวันเดียวกับวันที่ขาย
4. **Security headers:** เปิด DevTools → Network → ดู Response Headers ของ index.html ต้องเห็น CSP/HSTS/X-Frame-Options
5. **XSS share.html:** เปิด link share สดๆ → คลิกรูป → ต้องเปิด tab ใหม่ปกติ (regression check)

---

## 🛒 Phase 88.20 — POS Cash Breakdown + Bank Picker (build 203) ✅ VERIFIED

### User feedback
> "เงินสด ควรเพิ่มรายละเอียดยอดเงินที่ได้ จากลูกค้า อะไร ยอดอะไร ได้ด้วย"
> "โอนบัญชีธนาคาร ควรให้เราเลือกเปลี่ยนบัญชีได้เอง"

### What shipped (build 203)

**1. POS Cash UI:**
- Confirm-proof view: 2-column breakdown (รับเงิน / เงินทอน) เด่นชัด
- Sales note: `💵 รับ ฿X ทอน ฿Y`

**2. POS Transfer UI:**
- Dropdown picker (ถ้ามี ≥ 2 banks) — เลือกบัญชีรับเงิน
- QR + ข้อมูลบัญชีเปลี่ยนตามที่เลือก
- แสดง COA Code

**3. Settings → ข้อมูลการเงิน:**
- เพิ่ม field "📊 รหัสบัญชี COA" per bank
- บัญชีแรก default = 1130 (suggestion)

**4. auto_post.js logic:**
- `postJournalForSale` parse `BANK_COA:XXXX` จาก note
- Override Dr account จาก default 1130 → COA ที่เลือก

### Verified by user
- ✅ ตั้งค่า 2 banks: KBANK (1130) + SCB (1131) ครบ
- ✅ POS Transfer dropdown: 2 ตัวเลือก แสดง COA
- ✅ เลือก KBANK → QR เขียว, COA 1130
- ✅ เลือก SCB → QR ม่วง, COA 1131
- ✅ Checkout → JV (SV2026050005): Dr 1130 / Cr 4100 ตรงกับ KBANK ที่เลือก

### Files changed
- `modules/pos.js` — bank dropdown + cash breakdown + note format
- `modules/settings/payment.js` — coaCode field
- `modules/accounting/auto_post.js` — parse BANK_COA from note
- `index.html` + `sw.js` + `pages.js` — bump 203
- `CHANGELOG.md`

---

---

## 🆕 Pending — User Requests ปลาย Session (9 พ.ค.)

### 1. 💰 POS แคชเชียร์ — เพิ่ม "เงินที่ลูกค้าให้มา" (cash)
> "เงินสด ควรเพิ่มรายละเอียดยอดเงินที่ได้ จากลูกค้า อะไร ยอดอะไร ได้ด้วย"

**Plan:**
- เพิ่ม input "เงินที่ได้รับ" ในหน้า checkout (ตอน payment_method='cash')
- Auto-calc เงินทอน = received - grand_total
- บันทึกในใบเสร็จ POS / sales table

### 2. 🏦 POS แคชเชียร์ — เลือกบัญชีธนาคาร (transfer)
> "โอนบัญชีธนาคาร ควรให้เราเลือกเปลี่ยนบัญชีได้เอง"

**Plan:**
- เพิ่ม dropdown เลือกบัญชีปลายทาง (1130, 1131, 1132...)
- ตอน checkout → user เลือก → JV ลงบัญชีนั้นแทน 1130 default
- หรือเพิ่ม column `bank_account_code` ใน sales

---

## 🔒 Phase 88.19 — Period Close + Lock Periods (build 200-202) ✅ VERIFIED

### What shipped
- **DB:** ตาราง `accounting_periods` + `is_period_locked()` function + trigger `check_period_not_locked`
- **UI:** หน้า "🔒 ปิดงวดบัญชี" — grid 12 เดือน + summary + Lock/Unlock
- **Validation:** Defense in depth (UI + DB)
  - Front-end: `auto_post.js` ตรวจ period ก่อน insert
  - Back-end: DB trigger ป้องกัน insert + update doc_date เข้า/ใน locked period
- **Relaxed trigger (88.19b):** อนุญาต void/unvoid ใน locked period (เพื่อ correction หลังปิดงวด)

### SQL ที่รัน
- `supabase-phase88-19-period-close.sql` — สร้าง table + function + trigger
- `supabase-phase88-19b-relax-void.sql` — relax allow void/unvoid

### Files
- `modules/accounting/periods.js` (NEW)
- `main.js` — wire route + ALL_ROUTES + title + parent group
- `modules/accounting/auto_post.js` — period check ใน `_postJournal`
- `index.html` — page section + sidebar menu

### Verified by user
- ✅ Lock งวด → 🔒 ล็อก + locked_at + locked_by
- ✅ Unlock งวด → กรอก reason → audit trail
- ✅ Insert JV ใน locked period → reject (PERIOD_LOCKED)
- ✅ Void JV ใน locked period → ผ่าน (relaxed trigger)
- ✅ Cleanup 5 mock JVs (เม.ย. + test JVs)

---

## ก่อนหน้า: Phase 88.18b (build 198) — Production start 1 พ.ค.

---

## 🚀 Phase 88.18b — Production Start (1 พ.ค. 2026)

### Context
> "ผมจะเริ่ม production จริง ก็ตั้งแต่เริ่มเดือน พฤษภาคม ครับ"
> "ส่วนของกุดขาคีม ยังไม่ได้รับเงินนะครับ ลบรายได้ออกก่อน"

### What changed (build 198)
- `ACCOUNTING_EFFECTIVE_DATE`: `2026-01-01` → `2026-05-01` (4 ไฟล์)
- ระบบจะปฏิเสธ post JV ของ docDate < 1 พ.ค. โดยอัตโนมัติ

### User actions ทำแล้ว
1. ✅ Run SQL void JV กุดขาคีม (id=103, ฿93,456) — ยังไม่ได้รับเงินจริง
2. ⏳ Run SQL void JV เม.ย. 2026 (mock data) — รอ user รัน

### Workflow ที่ปลอดภัย (หลัง build 198)
- POS sale วันที่ 30 เม.ย. → ระบบ reject post JV (เพราะก่อน effective date)
- Invoice วันที่ 1 พ.ค. → JV ปกติ
- Backfill เก่าก่อน 1 พ.ค. → ระบบ skip อัตโนมัติ

---

## 🚨 Phase 88.17 + 88.18 — Receipt Approval + B2B Revenue Fix (9 พ.ค.)

---

## 🚨 Phase 88.17 + 88.18 — Receipt Approval + B2B Revenue Fix (9 พ.ค.)

### User feedback (2 ประเด็นใหญ่)
1. **"ใบเสร็จขึ้น 'ชำระแล้ว' ทั้งที่ยังไม่รับเงิน → ควรเป็นรออนุมัติ"**
2. **"แยกรายได้: หน้าร้าน vs งานราชการ/บริษัท เพื่อเข้าระบบสรรพากร"**

### Audit เจอบั๊กบัญชีสำคัญ
ก่อน fix, P&L แสดงรายได้แค่ **฿5,600** ทั้งที่มีใบเสร็จจริง **฿153,153**
- 4100 = ฿600 (POS เล็กๆ)
- 4210 = ฿3,000 (ซ่อมแอร์)
- 4240 = ฿2,000 (อื่นๆ)
- **gap = ฿147,553** ← B2B chain (Quote→Invoice→Receipt) revenue ไม่เคยถูก post!

**Root cause:** เดิม
- ออกใบเสนอราคา → ❌ ไม่ลง JV (ถูก)
- ออกใบส่งสินค้า/แจ้งหนี้ → ❌ **ไม่ลง JV** (ผิด!)
- ออกใบเสร็จ → ✅ ลง JV: Dr 1110 / Cr 1200 (แต่ Dr 1200 ไม่เคยมี → balance ติดลบ)

---

### What shipped (build 197)

#### Phase 88.17 — Receipt Approval Workflow

**1. delivery_invoices.js** — receipt default status="pending" (เดิม "paid")
```js
status: "pending",  // เดิม "paid" → user ต้องกดยืนยันใน list
```

**2. auto_post.js** — `postJournalForReceipt` ตรวจ status="paid" ก่อน post
```js
if (String(receipt.status || "").toLowerCase() !== "paid") return null;
```

**3. receipts.js** — UI ใหม่
- Default filter chip = "🟡 รออนุมัติ" (สีม่วง #a855f7)
- STATUS_LABELS: paid="✅ ชำระแล้ว" / pending="🟡 รออนุมัติ"

#### Phase 88.18 — B2B Revenue Split + Fix JV Chain

**SQL migration** (`supabase-phase88-17-revenue-split.sql`)
```sql
-- Rename 4100 → "หน้าร้าน (POS)"
UPDATE chart_of_accounts SET name='รายได้ขายสินค้า — หน้าร้าน (POS)' WHERE code='4100';

-- เพิ่ม 4150 → "ราชการ/บริษัท"
INSERT INTO chart_of_accounts ... ('4150', 'รายได้ขายสินค้า — งานราชการ/บริษัท', ...);

-- mapping invoice_credit
INSERT INTO account_mapping ... ('invoice_credit', '...', '1200', '4150');
```

**JS code:**
- `auto_post.js`: เพิ่ม `postJournalForDeliveryInvoice(invoice)` — Dr 1200 / Cr 4150
- `quotations.js`: import + fire หลัง insert delivery_invoices
- `backfill.js`: เพิ่ม source "🧾 ใบส่งสินค้า (B2B)"

### Workflow ที่แก้แล้ว

```
ก่อน fix:
  Quote → Invoice (no JV) → Receipt (paid auto, JV: Dr 1110/Cr 1200)
  ผล: revenue ไม่ขึ้น P&L + ลูกหนี้ติดลบ

หลัง fix (Phase 88.17 + 88.18):
  Quote → Invoice (✅ JV: Dr 1200/Cr 4150) → Receipt (pending — รออนุมัติ)
                                              ↓
                             user กดยืนยัน → status=paid → JV: Dr 1110/Cr 1200
  ผล: revenue ขึ้น P&L (4150 แยกจาก 4100) + ลูกหนี้ balance ถูก
```

### ⚠️ User actions required (2 ขั้นตอน)
1. **Run SQL** ใน Supabase Editor — `supabase-phase88-17-revenue-split.sql`
2. **Backfill ย้อนหลัง** ใบส่งสินค้าเก่า:
   - เมนู → บัญชี → Backfill ย้อนหลัง
   - ☑ ติ๊ก "🧾 ใบส่งสินค้า (B2B)"
   - เลือก date range (เช่น 1 เม.ย. — 9 พ.ค.)
   - กด "⚡ เริ่ม Backfill"
   - ผลลัพธ์: P&L revenue 4150 จะเพิ่ม ฿147,553

### Files changed (build 197)
- `supabase-phase88-17-revenue-split.sql` (NEW)
- `modules/accounting/auto_post.js` — เพิ่ม `postJournalForDeliveryInvoice` + ตรวจ status
- `modules/quotations.js` — import + fire JV หลัง insert invoice
- `modules/delivery_invoices.js` — receipt default status=pending
- `modules/receipts.js` — UI default filter pending + STATUS_LABELS ใหม่
- `modules/accounting/backfill.js` — เพิ่ม source delivery_invoices
- `index.html` — bump 197
- `sw.js` — v182
- `modules/settings/pages.js` — build 197 + version 5.40.0
- `CHANGELOG.md` — entry 5.40.0

### Test plan
1. ✅ Run SQL — ตรวจมี COA 4150 + mapping invoice_credit
2. ✅ Backfill ใบส่งสินค้าเก่า → ดู progress + ผล "✅ created"
3. ✅ เปิด P&L → ควรเห็นบรรทัด "รายได้ขายสินค้า — งานราชการ/บริษัท" ฿147,553
4. ✅ ออกใบเสร็จใหม่ → status=pending → ใบรับงานเห็น "🟡 รออนุมัติ" → ยังไม่มี JV
5. ✅ คลิก dropdown → "✓ เก็บเงิน" → status=paid → JV: Dr 1110 / Cr 1200

### Pending Phase 88+
- 🔒 **Period close + Lock periods** (เดิม Step 1 — ทำหลังจากนี้)
- ✏️ Mapping editor UI
- 📜 VAT support (XL — Phase ใหม่)

---

## ☀️ Phase 88.16 — Solar Revenue Mapping → 4300 (9 พ.ค.)

### Why
- เดิม: งาน solar fallback → `service_other` mapping → Cr **4240** (รายได้บริการอื่นๆ)
- ปัญหา: P&L มองไม่เห็นว่ารายได้โซล่าเป็นเท่าไหร่ — ผสมกับงานเล็กๆ น้อยๆ
- ใหม่: solar มี mapping เฉพาะ → Cr **4300** (รายได้บริการ — โซล่าเซลล์)

### What shipped (build 196)

**1. SQL migration** — `supabase-phase88-16-solar-mapping.sql`
```sql
-- COA 4300
INSERT INTO chart_of_accounts (code, name, type, parent_code, sort_order)
  VALUES ('4300', 'รายได้บริการ — โซล่าเซลล์', 'income', '4000', 300)
  ON CONFLICT (code) DO UPDATE...;

-- mapping service_solar
INSERT INTO account_mapping (mapping_key, debit_account_code, credit_account_code)
  VALUES ('service_solar', '1110', '4300')
  ON CONFLICT (mapping_key) DO UPDATE...;

NOTIFY pgrst, 'reload schema';
```

**2. JS code** — `modules/accounting/auto_post.js`
```js
const keyMap = {
  ...
  solar: "service_solar",  // ★ Phase 88.16
  other: "service_other"
};
```

**3. solar.js comment** — อัปเดตหลัง mapping เปลี่ยน (ไม่ใช่ fallback อีก)

### ⚠️ User action required
ต้อง run SQL ใน **Supabase SQL Editor** ก่อนถึงจะมี COA 4300 + mapping
- File: `supabase-phase88-16-solar-mapping.sql` (อยู่ root project)
- รัน 1 ครั้งเดียว → cache invalidate อัตโนมัติด้วย `NOTIFY pgrst`

### Files changed
- `supabase-phase88-16-solar-mapping.sql` (NEW)
- `modules/accounting/auto_post.js` — เพิ่ม solar key
- `modules/solar.js` — comment update
- `index.html` — bump 196
- `sw.js` — v181
- `modules/settings/pages.js` — build 196
- `CHANGELOG.md` — entry 5.39.5

### Test plan
1. **Run SQL** ใน Supabase Editor → ตรวจ result query (ต้องเห็น `service_solar` mapping)
2. **Refresh app** (Ctrl+Shift+R) — clear `_mappingCache`
3. **เปิดงานโซล่าเก่าที่ยัง pending** → admin approve → JV เกิด
4. **ตรวจ JV row** → Cr account ต้องเป็น **4300** (ไม่ใช่ 4240)
5. **เปิด P&L** → ควรเห็นบรรทัดแยก "รายได้บริการ — โซล่าเซลล์"

### Pending Phase 88+ (priority order)
- 🔒 **Period close + Lock periods** (ถัดไป — Step 1 ในแผน)
- ✏️ Mapping editor UI (Step 2)
- 📜 VAT support (XL — Phase ใหม่)

---

## 🔐 Phase 88.15 — แยกสิทธิ์ ช่าง vs Admin (9 พ.ค.)

### User feedback
> "ในหน้าช่าง ทุกหน้า ไม่ควรมี 2 ช้อยนี้นะครับ"
> (📦 ส่งมอบแล้ว / 🎉 ปิดงาน + รับเงิน — ลง JV ทันที)

### Root cause / Design
- ก่อน fix: ทุก dropdown ในฟอร์มช่างมี 6 options รวม `delivered` + `closed`
- ช่างเลือก → JV เกิดทันที (`COMPLETION_STATUSES = ["done","delivered","closed"]`)
- ผู้ใช้ต้องการ: **ช่างห้ามทำให้ JV เกิดเอง** — ต้องผ่าน admin approve เสมอ

### What shipped (build 195)

**1. ฟอร์มช่าง dropdown — เหลือ 4 options:**
```
⏳ รอดำเนินการ      (pending)
🔄 กำลังดำเนินการ    (in_progress)
✅ เสร็จแล้ว         (done)
📨 รออนุมัติ         (pending_review)  ← ส่งให้ admin ตรวจ
```

ลบออก:
- ❌ 📦 ส่งมอบแล้ว (ลง JV ทันที) — admin only
- ❌ 🎉 ปิดงาน + รับเงิน (ลง JV ทันที) — admin only

**2. ปิด JV trigger ในฟอร์มช่าง:**
```js
// เดิม:    const COMPLETION_STATUSES = ["done","delivered","closed"];
// ใหม่:    const COMPLETION_STATUSES = [];
```

**3. Admin drawer (index.html `#serviceStatus`) ยังมี 7 options ครบ**
- ใช้ approve banner (ม่วง) → กดอนุมัติ → set status=delivered → save → JV เกิด

### Workflow ที่ชัดเจน
```
ช่าง (mobile):
  เปิดฟอร์ม → กรอก → status="📨 รออนุมัติ" + แนบสลิป → ส่ง

Admin (desktop):
  ใบรับงาน → filter "📨 รออนุมัติ" → คลิก row → drawer
  → banner ม่วง "✅ อนุมัติ + ลงรายได้" → กด → JV เกิด

JV ไม่มีทางเกิดจากฟอร์มช่าง (ปลอดภัย กัน duplicate)
```

### Files changed (build 195)
- `modules/solar.js` — ลบ 2 options + `COMPLETION_STATUSES = []`
- `modules/ac_install.js` — เหมือนกัน
- `modules/service_form.js` — เหมือนกัน (ครอบคลุม 9 service types)
- `index.html` — bump `?v=195` + APP_BUILD
- `sw.js` — bump v180
- `modules/settings/pages.js` — bump build 195
- `CHANGELOG.md` — entry 5.39.4

### Test plan
1. **เปิดหน้าช่าง** (โซล่า, ติดตั้งแอร์, ซ่อมแอร์ ฯลฯ)
2. **เปิด dropdown สถานะงาน** → ควรเห็นแค่ 4 ตัวเลือก (ไม่มี ส่งมอบแล้ว / ปิดงาน)
3. **เลือก "📨 รออนุมัติ"** → กรอก + แนบสลิป → save → ✅ ใบรับงานเห็นใน filter "รออนุมัติ"
4. **Admin เปิด drawer** → ดู dropdown → ✅ ยังมี 7 options ครบ + banner approve

---

## 🔧 Phase 88.14 — Fix New Service Jobs ไม่โผล่ในใบรับงาน (9 พ.ค.)

### User feedback
> "ผมบันทึกงานเฉยๆ ไม่แนบสลิป งานผมต้องไปอยู่หน้าไหนครับ
> หน้า 'ใบรับงาน' ไม่เจองาน"

### Root cause
- `main.js` `saveServiceJob` มี optimistic update — push job ใหม่เข้า `state.serviceJobs` ทันทีหลัง insert
- แต่ `solar.js`, `ac_install.js`, `service_form.js` (9 routes) **ไม่มี** pattern นี้
- → บันทึก DB สำเร็จ แต่ `state.serviceJobs` ใน RAM ยังเก่า → ใบรับงาน render จาก state → ไม่เห็น

### What shipped (build 194)

**1. modules/solar.js** — เพิ่ม optimistic update หลัง insert
```js
if (inserted?.[0]) {
  state.serviceJobs = [inserted[0], ...(state.serviceJobs || [])];
}
```

**2. modules/ac_install.js** — เพิ่ม pattern เดียวกัน

**3. modules/service_form.js** — เพิ่มที่ครอบคลุม 9 service types
- repair_ac / clean_ac / move_ac / satellite / fridge / washer / cctv / tv / other

### Workflow ที่แก้แล้ว
```
ก่อน fix:
  ช่างเข้าหน้าโซล่า → กรอก → save → DB success → ไปดูใบรับงาน → ❌ ไม่เห็น job
  (ต้อง Ctrl+Shift+R เพื่อ reload state)

หลัง fix:
  ช่างเข้าหน้าโซล่า → กรอก → save → DB success + state push → ไปดูใบรับงาน → ✅ เห็นทันที
```

### Files changed
- `modules/solar.js`
- `modules/ac_install.js`
- `modules/service_form.js`
- `index.html` — bump `?v=194` + APP_BUILD
- `sw.js` — bump CACHE_NAME → `v179`
- `modules/settings/pages.js` — bump build 194
- `CHANGELOG.md` — entry 5.39.3

### Test plan
1. ปิดงานปกติ (เลือก status "รอดำเนินการ" — ไม่แนบสลิป)
2. กดบันทึก → success
3. คลิก "ใบรับงาน" → ✅ เห็น job ทันที (filter "🟡 ค้าง")
4. ทดสอบกับทุกประเภท: solar / ติดตั้งแอร์ / ซ่อมแอร์ / ล้างแอร์ / etc

---

## 🔗 Phase 88.13 — Solar Equipment ↔ Stock Link (9 พ.ค.)

### User feedback
> "หน้าเพิ่ม อุปกรณ์ ควรลิ้งกับ สินค้า คงคลัง ครับ จะได้ทำสต็อกไปด้วย"

### What shipped (build 193)

**1. modules/solar.js — rewrite ครั้งใหญ่ (359 → 801 บรรทัด)**
- ลบ free-text equipment rows ออก → ใช้ modal picker เลือกจาก `state.products`
- Module-private state: `let _solItems = []` (prefix `_sol*` กัน collision กับ ac_install)
- ปุ่ม "+ เพิ่มอุปกรณ์" เปิด modal picker จาก state.products
- แสดงตาราง: ชื่ออุปกรณ์ / คลัง (รถ/บ้าน) / qty stepper / ราคา / รวม / ลบ
- บันทึก `items_json` ลง service_jobs

**2. Helper functions (private)**
- `_solGetMobileWarehouses()` → list คลังในรถ
- `_solGetHomeWarehouse()` → คลังบ้าน
- `_solGetMobileStocks(productId)` → stock ในรถทั้งหมด
- `_solGetHomeStock(productId)` → stock ในบ้าน
- `_solPickMobileWarehouse()` → ถามคลังปลายทาง (ถ้ามีหลายคัน)
- `_solRenderItemsList()` / `_solBindItemListEvents()` — UI render
- `_solOpenItemPicker()` — modal picker UI

**3. Save logic — auto stock movement**
- ถ้าเลือกของจาก "บ้าน" → prompt confirm → call `window._appTransferWarehouseStock(home, mobile, productId, qty)` ก่อน
- ตอน save → call `window._appApplyStockMovement(productId, mobile_warehouse, -qty, ...)` ตัดสต็อก
- Optimistic update `state.warehouseStock` ทันที (ไม่ต้องรอ refresh)

**4. ไม่กระทบ Phase 88.12**
- Section "💰 ปิดงาน + แนบสลิป + AI verify" ยังคงเดิม
- JV trigger (postJournalForServiceJob) ยังเรียกตอน isClosure=true
- Status flow: pending → in_progress → pending_review → delivered/closed

### Files changed
- `modules/solar.js` — rewrite ครั้งใหญ่ (359→801)
- `index.html` — bump `?v=193` (main.js + style.css)
- `sw.js` — bump CACHE_NAME → `v178`
- `modules/settings/pages.js` — bump APP_BUILD → 193
- `CHANGELOG.md` — entry 5.39.2

### Test plan
- เปิด POS → เมนู โซล่าเซลล์ → กด "+ เพิ่มอุปกรณ์"
- ✅ Modal picker เปิด → เห็นรายการ products ที่มีสต็อก
- ✅ เลือกจากบ้าน → confirm transfer → save → stock บ้านลด + รถเพิ่ม + ของในงานหัก
- ✅ JV ยังเกิดถูกต้องตอนปิดงาน

### Pending Phase 88+ (priority order)
- 🔒 Period close + Lock periods
- ✏️ Mapping editor UI
- ☀️ Solar revenue mapping (4300 — currently fallback to 4240)
- 📜 VAT support (XL — Phase ใหม่)

---

## 📨 Phase 88.12 — Approval Workflow + Slip ทุกหน้างานช่าง (9 พ.ค.)

### User feedback
> "ในหน้างานช่างควรมีเมนูเพิ่มสลิ๊ปปิดงาน ทุกหน้าด้วยครับ บางครั้งไปหน้างาน
> ก็สามารถส่งงานได้เลย รอแอดมินยืนยัน อีกที ค่อยลงเป็นรายได้"

### What shipped (build 191-192)

**1. New status: `pending_review`** (📨 รออนุมัติ)
- ช่างเลือก → JV ไม่เกิด (รอ admin)
- ใส่ใน `STATUS_LABELS` + `STATUS_COLOR` (สีม่วง #a855f7)

**2. service_jobs.js list — filter chip ใหม่**
- "📨 รออนุมัติ" + counter
- `REVIEW_STATUSES = ["pending_review"]`
- ระหว่าง chip "ค้าง" และ "ปิดแล้ว"

**3. Drawer admin approve (main.js + index.html):**
- Banner สีม่วงโผล่เมื่อ status=pending_review
- ✅ อนุมัติ + ลงรายได้ → set status=delivered → save → JV
- ↩️ ส่งกลับให้แก้ → set status=in_progress

**4. ครบ 13 หน้างานช่าง** (port closure section + slip + AI verify):
- `service_form.js` → 9 routes (repair_ac/clean/move/satellite/fridge/washer/cctv/tv/other)
- `ac_install.js` → ติดตั้งแอร์
- `solar.js` → โซล่าเซลล์ (refactor: `address` → `customer_address`, ใช้ token cache, return=representation)

**5. ทุกไฟล์มี:**
- 📷 ถ่ายรูป + 🖼️ แกลลอรี่ (capture + no-capture inputs)
- Status dropdown 6 options (รอดำเนินการ → รออนุมัติ → ส่งมอบ → ปิดงาน)
- Payment method (cash → Dr 1110 / transfer → Dr 1130)
- Auto AI verify หลัง upload ถ้า payment=transfer/qr
- ปุ่ม 🤖 ตรวจ AI manual
- Verify result card (ผ่าน/ตรวจเพิ่ม)
- Wire `postJournalForServiceJob` หลัง save ถ้า isClosure=true

### Workflow ที่รองรับแล้ว
```
ช่าง (มือถือ — หน้างาน):
  เปิดหน้างานใดๆ → กรอก + แนบสลิป → status='📨 รออนุมัติ' → ส่ง

Admin (เดสก์ท็อป):
  ใบรับงาน → filter 'รออนุมัติ' → คลิกแก้ไข → drawer → กด 'อนุมัติ + ลงรายได้'

ระบบ:
  status='delivered' → JV เกิด Cr 4200-4290 ตามประเภทงาน
```

หรือ workflow เก่า (ช่างปิดเอง) ยังใช้ได้:
```
ช่าง: เลือก status='ส่งมอบแล้ว' → save → JV เกิดทันที
```

### Files changed (Phase 88.12 + 88.12b)
- `index.html` — เพิ่ม `pending_review` option + admin approve banner
- `main.js` — wire approve/reject buttons + show banner ใน openServiceJobDrawer
- `modules/service_form.js` — closure section + AI verify (port from drawer)
- `modules/service_jobs.js` — filter chip "รออนุมัติ" + REVIEW_STATUSES
- `modules/ac_install.js` — เพิ่ม closure section + AI verify
- `modules/solar.js` — เพิ่ม closure + refactor (token cache + customer_address)

### Pending Phase 88+
- Period close + Lock periods
- Mapping editor UI
- Service mapping for `solar` (ตอนนี้ fallback service_other → 4240)
- VAT support (XL — Phase ใหม่)

---

---

## 🎯 Phase 88.7-88.11 (9 พ.ค.)

### Phase 88.7 — JV Drill-down (build 181)
คลิก row สมุดรายวัน → drawer overlay แสดง:
- Lines table (Dr/Cr ทุกบรรทัด + balance check)
- Source preview ตาม `source_table` (sales/expenses/receipts/service_jobs)
- ปุ่ม "เปิดหน้า [source]" → navigate
- Audit info (created/approved/voided timestamps)

### Phase 88.8 — Drawer service cost input (build 181)
แก้ pain point เดิม: drawer แก้ไขงานช่างไม่มีช่อง total_cost
- HTML: section "💰 ค่าแรง / ปิดงาน" ใน serviceJobDrawer
- Inputs: ค่าแรง + ส่วนลด (auto-recalc ยอดสุทธิ) + payment_method
- payload: `total_cost` + `payment_method` ใส่ตอน save
- ส่ง payment_method ให้ postJournalForServiceJob → override Dr account (transfer→1130)

### Phase 88.9 — Comparative P&L (build 181)
- Toggle "📊 เทียบกับงวดก่อน"
- Auto-compute previous period (m/q/y/custom)
- Side-by-side 5 columns + Net Income compare card

### Phase 88.10 / 88.10b — Re-post JV on edit (build 182-183)
- ปัญหา: edit งานเก่า + เปลี่ยน total_cost → JV ค้าง (idempotent unique block POST ใหม่)
- Fix: เพิ่ม `voidJvForSource()` ใน auto_post.js — DELETE JV เดิม (lines cascade)
- Wire ใน saveServiceJob: void ก่อน post ใหม่ ถ้า edit (!isNewJob)
- 88.10b: trigger logic ขยาย — `editCompleteWithChange` (status เป็น completion อยู่แล้ว + total/method เปลี่ยน)
- เก็บ `state.editingServiceJobOrigTotalCost` + `OrigPaymentMethod` ตอน open drawer เพื่อตรวจ change

### Phase 88.11 — Slip Upload + AI Verify (build 184-190)
ฟีเจอร์ใหญ่ — user ขอ "แนบสลิป + ตรวจจริง/ปลอม"
- **`functions/api/verify-slip.js`** (NEW) — Gemini Vision API:
  - Compact prompt → ดึง 14 fields (sender/recipient/amount/datetime/ref/tampering)
  - Fallback chain 4 models: 2.5-flash → 2.0-flash-lite → flash-latest → 2.0-flash
  - 3-layer JSON extraction (parse ตรง → strip code fence → regex {})
  - maxOutputTokens 4000 (1500 ไม่พอสำหรับ Thai)
- **Drawer section "📷 สลิปการโอน + ตรวจ AI"** สีม่วง — แสดงเมื่อ payment=transfer/qr
  - 2 ปุ่ม (📷 ถ่ายรูป + 🖼️ แกลลอรี่) — แยกตาม Service Photos pattern
  - Auto-verify หลัง upload สำเร็จ
  - Card สีเขียว/เหลือง: ผู้โอน/ผู้รับ/ยอด/Ref/datetime + confidence + tampering_score
- **Smart name match** — normalize ชื่อก่อนเทียบ:
  - Strip คำนำหน้า: ร้าน/บริษัท/หจก./บจ./บมจ./จำกัด/มณี shop/mn shop
  - Unwrap ปีกกา ( ) [ ]
  - Strip bank names: scb/kbank/krungthai/bbl/ttb/kkp/gsb/baac/...
- **Tampering threshold** — สอน AI:
  - ถ่ายจากจอมือถือ ≠ tampering (workflow ปกติร้านค้าไทย)
  - "จริง" tampering = digital editing (ฟ้อนต์ผิด/crop unnatural/pixel artifact)

### Bug debug journey ของ Phase 88.11 (สำหรับ session ใหม่)
1. **build 184**: ปุ่มเดียว — ปัญหา UX มือถือเด้งกล้องเสมอ
2. **185**: แยก 2 ปุ่ม
3. **186-187**: "Gemini ส่ง JSON ไม่ valid" — ลอง fallback chain + cleanup
4. **188**: เห็น raw response ตัดกลาง → MAX_TOKENS issue → 1500→4000
5. **189**: false positive ชื่อร้านไม่ตรง → smart normalize
6. **190**: false positive tampering 40 → สอน AI

### Pre-req
- `GEMINI_API_KEY` ใน Cloudflare env (มีอยู่แล้วจาก Phase 74 AutoKey)
- Storage bucket `proofs/` (มีอยู่แล้ว)

### ✅ Verified (build 190 final)
```
✅ ผ่านการตรวจสอบ
ผู้โอน: น.ส.ปณิชยา W***
ผู้รับ: SCB มณี SHOP (บุญสุขอิเล็กทรอนิกส์)
ยอด: 2,000 · วันที่: 2026-05-08T17:07
Ref: C20260508612817830614
Confidence: 90/100 · Tampering: 10/100
```

---

---

## 🔧 Phase 88.6 + Hotfixes (8 พ.ค. ตอนเย็น)

### Builds 176-180 (5 hotfixes ระหว่าง 88.5 → 88.6)

**Build 176 (5.34.9):** service_form fetch timeout 15s
- ปัญหา: มือถือกดบันทึกแล้วค้าง "กำลังบันทึก..." ตลอด
- แก้: AbortController + timeout — error message แทน hang

**Build 177 (5.35.0):** service_form mobile token + wire auto-post JV
- ปัญหา 1: `state.supabase.auth.getSession()` hang บน slow mobile network
  → แก้: ใช้ `window._sbAccessToken` cache ตรงๆ (pattern xhrPost)
- ปัญหา 2: ผม wire `postJournalForServiceJob` ผิดที่ — main.js drawer แทนที่จะเป็น
  service_form.js (create flow) → JV ไม่เกิดตอนสร้าง
  → แก้: เพิ่ม import + wire ใน service_form.js หลัง POST สำเร็จ

**Build 178 (5.35.1):** Backfill date range bug
- ปัญหา: `created_at=lte.YYYY-MM-DD` = midnight 00:00 → row created 12:56:24 ของ
  วันสุดท้ายในช่วงถูก exclude (Postgres timestamp comparison)
- แก้: ตรวจ field type — timestamptz ใช้ `lt.<nextDay>`, DATE ใช้ `lte.<to>`
- ผลกระทบ: sales + service_jobs (ใช้ `created_at`) — เก่าเสียเอง

**Build 179 (5.35.2):** service_jobs.total_cost
- ปัญหา: service_form.js record ไม่ใส่ `total_cost` field → DB เก็บ NULL →
  postJournalForServiceJob skip silent
- แก้: เพิ่ม `total_cost: net` ใน record (net = itemsTotal+labor-discount)
- Workaround งานเก่า: SQL UPDATE service_jobs SET total_cost=...

**Build 180 (5.36.0) + SQL hotfix — Phase 88.6 FULL:**
- SQL `supabase-phase88-service-mappings.sql`:
  - ALTER service_jobs ADD: total_cost, payment_method, payment_slip_url, closed_at
  - 5 COA ใหม่ (4250-4290): จานดาวเทียม/ตู้เย็น/เครื่องซักผ้า/CCTV/ทีวี
  - 5 account_mappings: service_satellite/repair_fridge/repair_washer/cctv/repair_tv
  - `NOTIFY pgrst, 'reload schema'` — บังคับ PostgREST reload (กัน PGRST204)
- auto_post.js:
  - keyMap ขยาย 9 ประเภทครบ
  - รองรับ `payment_method` — transfer/QR → Dr 1130 แทน 1110
- service_form.js — section "🔚 ปิดงาน" สีเหลือง:
  - Status selector: pending / in_progress / done / delivered / closed
  - Payment method: cash / transfer
  - 📷 Slip upload → Storage `proofs/service-slips/`
  - หลัง save status=closure → fire JV ทันที + payment_method override

### Verified by user
- Mobile บันทึกใบงานเครื่องซักผ้า → JV `SV2026050002` ฿2,000 (Backfill)
- Desktop ลองสร้างงานใหม่ JOB-1778247978973 ดาหมอก → JV `SV2026050003` ฿3,000
- สมุดรายวัน: 9 รายการ (4 SV + 4 PV + 1 OB) — ทุกประเภทครบ
- Trial Balance / P&L / BS — sync ตามจริง

### Lesson Learned (สำคัญสำหรับ session ใหม่)
1. **อย่าแก้ main.js แล้วคิดว่าครอบคลุม** — Phase 86 refactor → ทุก source flow ใน modules/
   - `pos.js doCheckout` (POS sale) — wire ที่นี่
   - `service_form.js` (create) + `main.js saveServiceJob` (drawer edit) — wire **ทั้งคู่**
   - `expenses.js expFormSaveBtn` + `akSaveBtn` — wire **ทั้งคู่**

2. **PostgREST schema cache** — หลัง ALTER TABLE → run `NOTIFY pgrst, 'reload schema'`
   ไม่งั้นเจอ PGRST204 "Could not find column"

3. **Postgres lte กับ timestamptz** — `lte.YYYY-MM-DD` = midnight ของวันนั้นเท่านั้น
   ใช้ `lt.<nextDay>` แทน หรือ append `T23:59:59.999Z`

4. **Mobile/Slow network** — supabase JS lib (`auth.getSession()`) อาจ hang ตลอด
   ใช้ `window._sbAccessToken` cache + AbortController timeout 15s

5. **4-point route checklist** — เพิ่ม route ใหม่ต้องแก้ 4 จุด:
   - index.html (button + section)
   - main.js ALL_ROUTES list
   - main.js ROUTE_GROUP map
   - main.js routeTitles + showRoute handler

---

---

## 📦 Phase 88.5 — FINAL (Opening Balance + Export Bundle) (8 พ.ค.)

### 🎉 จบ Phase 88!
ระบบบัญชีครบสมบูรณ์ — รองรับทุก use case ตั้งแต่บันทึกรายการจน export ส่งสำนักงานบัญชี

### What shipped (5.34.8 build 175)

**1. `modules/accounting/opening_balance.js` (~250 lines — NEW):**
- หน้า wizard ลง JV ประเภท OB (Opening Balance) — ลงวันที่ effective date 2026-01-01
- 3 sections (สีตามมาตรฐาน):
  - 🟦 **Asset (Dr):** 1110/1120/1130/1140/1200/1300 — เงินสด/เงินฝาก/ลูกหนี้/สินค้าคงเหลือ
  - 🟥 **Liability (Cr):** 2100/2120/2200 — เจ้าหนี้/บัตรเครดิต/เงินกู้
  - 🟪 **Equity (Cr):** 3100/3200 — ทุนจดทะเบียน/ทุนของเจ้าของ
- **Live balance check** — แสดง Dr / Cr / ผลต่าง realtime ขณะกรอก
- ปุ่มบันทึกใช้ได้ก็ต่อเมื่อ Dr = Cr (validate ก่อน confirm)
- หลัง save → POST entry + lines → JV `OB2026010001` doc_type=OB
- หลังลง OB → Balance Sheet จะแสดงตัวเลขเป็นบวก (สมจริง)

**2. `modules/accounting/export_bundle.js` (~280 lines — NEW):**
- หน้า "Export ชุดรายงาน" — สร้าง Excel 1 ไฟล์ มี **4 sheets:**
  1. **Trial Balance** — Dr/Cr ทุกบัญชีในงวด
  2. **P&L** — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุน + section breaks
  3. **Balance Sheet** — Assets = L + E (cumulative since effective)
  4. **Journal** — ทุก JV พร้อม lines (วันที่/เลขที่/ประเภท/คำอธิบาย/Dr/Cr)
- ใช้ `window.XLSX` (SheetJS) ที่ load ใน index.html
- Single `fetchAll()` query → reuse data across 4 sheets (efficient)
- Period picker (month/quarter/year/custom) เหมือน TB / P&L
- Filename: `accounting_bundle_<period>_<date>.xlsx`
- ส่งสำนักงานบัญชีทาง email/Line ได้ทันที — รูปแบบ standard

### Files changed (Phase 88.5)
- `modules/accounting/opening_balance.js` — NEW
- `modules/accounting/export_bundle.js` — NEW
- `main.js` — import + 8 wire points (4 per module)
- `index.html` — 2 nav buttons + 2 sections
- `sw.js`, `modules/settings/pages.js` — bump 5.34.7→5.34.8 build 175, SW v160

### ⚠️ Cloudflare deploy pattern (จดเป็น insight final)
- Pattern ตลอด Phase 88.2-88.4: file commits → fail, empty commits → success
- Phase 88.5 อาจจะเป็นเหมือนกัน → preemptive empty commit ส่งทันทีหลัง main commit
- Root cause: ไม่ทราบ — น่าจะเป็น Cloudflare Pages API rate limit / network hiccup

### ✅ Smoke tests Phase 88.5

**Opening Balance:**
1. เมนู "บัญชี" → "📥 ลงยอดยกมา"
2. กรอกตัวอย่าง:
   - 1110 เงินสดในมือ: 50,000
   - 1130 เงินฝากธนาคาร: 100,000
   - 3100 ทุนจดทะเบียน: 150,000
3. Live balance: Dr 150,000 = Cr 150,000 ✓
4. กดบันทึก → confirm → "ยืนยันบันทึกยอดยกมา?"
5. → JV `OB2026010001` ลงวันที่ 2026-01-01
6. ไป **🏦 งบดุล** → ดูตัวเลขเป็นบวก

**Export Bundle:**
1. เมนู "บัญชี" → "📦 Export ชุดรายงาน"
2. เลือก period: เดือน 05/2026
3. กดปุ่มดาวน์โหลด → progress steps (ดึง → aggregate → สร้าง)
4. ได้ไฟล์ `accounting_bundle_05_2026_<date>.xlsx`
5. เปิดดู — มี 4 sheets ครบ (TB, PL, BS, Journal)

---

## 🎯 Phase 88 — สถานะสุดท้าย (FINAL)

| Sub-Phase | สถานะ | สิ่งที่ลง |
|---|---|---|
| 88.0 | ✅ | Foundation — 51 accounts + JV + lines + manual form |
| 88.1a | ✅ | Auto-post sales + expenses |
| 88.1b | ✅ | Auto-post receipts + service jobs + Backfill UI |
| 88.2 | ✅ | Trial Balance report |
| 88.3 | ✅ | P&L report |
| 88.4 | ✅ | Balance Sheet report |
| **88.5** | **✅** | **Opening Balance wizard + Export bundle** |

**สมบูรณ์ครบทุก spec ที่ user ขอตอนเปิด Phase 88:**
- ✅ "ใกล้เคียง FlowAccount" — TB / PL / BS ครบ + auto-post + Backfill
- ✅ "ทำได้ดีกว่า" — auto-post จาก source (FlowAccount ต้องลง JV manual)
- ✅ "ส่งสำนักงานบัญชีได้จริง" — Export bundle 4 sheets standard format

### Pending ที่อาจทำในอนาคต (ไม่อยู่ใน Phase 88)
- 88.6: Drill-down (click JV → drawer with source link)
- 88.7: Mapping editor UI (admin แก้ EXPENSE_CATEGORY_MAP)
- 88.8: Period close + Lock periods
- 88.9: Comparative reports (เทียบกับงวดก่อน + กราฟ trend)
- 89.x: VAT support (ถ้า user จด VAT ในอนาคต)

---

---

## 🏦 Phase 88.4 — งบดุล Balance Sheet (8 พ.ค.)

### Why
หลัง P&L แล้ว → user ต้องการ Balance Sheet (งบดุล) ที่แสดงสถานะ ณ จุดเวลา
ใดเวลาหนึ่ง — สมการ Assets = Liabilities + Equity

### What shipped (5.34.7 build 174)

**`modules/accounting/balance_sheet.js`** (~310 lines — NEW):

**Logic — closing balance (cumulative):**
- BS ใช้ closing balance ตั้งแต่ effective date (2026-01-01) ถึง "as of date"
- ไม่ใช่ movement ในงวด → query JV ทั้งหมด since effective date

**Per-account balance:**
- Asset (1xxx)     → Dr - Cr (normal Dr balance)
- Liability (2xxx) → Cr - Dr (normal Cr balance)
- Equity (3xxx)    → Cr - Dr (normal Cr balance)
- Filter accounts ที่ balance ≈ 0 ออก (ไม่แสดง)

**Retained Earnings (กำไรสะสม):**
- คำนวณ Σ(income amount) - Σ(expense amount) จาก JV ในช่วง effective→asOf
- เพิ่มเป็น row พิเศษใน Equity section (รหัส 3900)
- ถ้าเป็นลบ → label "ขาดทุนสะสม" + สีแดง

**Equation card:**
- แสดง สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- สีเขียว ถ้า balance / สีแดง + ผลต่าง ถ้าไม่
- Visual: 2 ตัวเลขใหญ่ + เครื่องหมาย =

**Negative number warning:**
- ถ้า total assets < 0 หรือ total equity < 0 → แสดง info card สีส้ม
- บอก user ว่า "ระบบยังไม่มี opening balance" + แนะนำให้ลง JV ประเภท OB
- (Phase 88.5 จะมี OB wizard UI)

**UI inputs:**
- Single date picker "ณ วันที่" (default = today, min = 2026-01-01)
- Export Excel + พิมพ์ — เหมือน TB / P&L

### Files changed (Phase 88.4)
- `modules/accounting/balance_sheet.js` — NEW (~310 lines)
- `main.js` — import + 4 wire points
- `index.html` — nav button "🏦 งบดุล" + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.6→5.34.7 build 174, SW v159

### ⚠️ Cloudflare deploy pattern (จดเป็น insight)
ตั้งแต่ Phase 88.2 deploys เริ่ม fail สำหรับ commits ที่มีไฟล์ใหม่ใน
`modules/accounting/*` — empty commit re-trigger แก้ได้ทุกครั้ง
- 0e25d04 (88.2): fail → cbea042 (empty): success
- 51ebd39 (88.3): fail → 08fbe1f (empty): success
- 088aaaa? (88.4): expect fail → empty re-trigger

อาจเป็น Cloudflare API rate limit หรือ wrangler-action transient — ไม่กระทบ
production (เพราะ Cloudflare Pages เก็บ deploy ก่อนหน้าไว้)

**Not investigated yet:** ลอง batch 2 commits → empty re-trigger as standard
practice หรือเปลี่ยน workflow ใช้ `--keep-cache` หรือลด file count ใน upload

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "🏦 งบดุล"
2. As-of date default = วันนี้ → load ทันที
3. **คาดผลปัจจุบัน (data ของ user หลังลบ JV):**
   - 🟦 Assets:
     - 1110 เงินสดในมือ: -115,388 (สีแดง — เพราะ Cr มากกว่า Dr)
     - 1130 เงินฝากธนาคาร: -13,870
     - รวม: -129,258
   - 🟥 Liabilities: ไม่มี → 0.00
   - 🟪 Equity:
     - 3900 ขาดทุนสะสม: -129,258 (จาก P&L)
     - รวม: -129,258
   - **Equation: -129,258 = 0 + (-129,258) ✓** สีเขียว balance
   - ⚠️ Info card สีส้ม: "ตัวเลขลบ — ยังไม่มี opening balance"
4. Export Excel — section breaks + 4 columns + total rows
5. พิมพ์ → popup window

### Pending Phase 88.5
- Export bundle — ดาวน์โหลด PDF + multi-sheet Excel ของ TB + PL + BS รวมกัน
- (Optional) Opening Balance wizard — admin เซต ทุน/เงินสดเริ่มต้น

---

---

## 📈 Phase 88.3 — P&L (งบกำไรขาดทุน) (8 พ.ค.)

### Why
หลัง Trial Balance แล้ว → user ต้องการรู้ผลประกอบการ — **กำไร/ขาดทุนสุทธิ**
รายเดือน เพื่อตัดสินใจธุรกิจ + ส่งสำนักงานบัญชี

### What shipped (5.34.6 build 173)

**`modules/accounting/profit_loss.js`** (~280 บรรทัด — NEW):

**Logic ที่ตรงตามมาตรฐานบัญชี:**
- รายได้ (4xxx) — normal Cr balance → `amount = credit - debit`
- ค่าใช้จ่าย (5xxx) — normal Dr balance → `amount = debit - credit`
- **กำไรสุทธิ = รวมรายได้ - รวมค่าใช้จ่าย**

**Layout:**
- Section 1: 🟢 รายได้ (เขียว) — แสดงทุก 4xxx ที่มียอด
- "หัก" separator
- Section 2: 🟠 ค่าใช้จ่าย (ส้ม) — แสดงทุก 5xxx ที่มียอด
- **Net Income card** — สีเขียวถ้ากำไร / สีแดงถ้าขาดทุน
  - ขาดทุนแสดงในวงเล็บ `(฿XXX)` ตามมาตรฐาน
  - **Margin %** = net / revenue (ถ้ามีรายได้)

**Period picker + Export Excel + พิมพ์** เหมือน Trial Balance

### Files changed (Phase 88.3)
- `modules/accounting/profit_loss.js` — NEW (~280 lines)
- `main.js` — import + 4 wire points (ALL_ROUTES, ROUTE_GROUP, routeTitles, showRoute)
- `index.html` — nav button "📈 งบกำไรขาดทุน" + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.5→5.34.6 build 173, SW v158

### Architecture note
Reuse `fetchData` + `aggregate` pattern จาก trial_balance.js (ไม่ shared utility ทันที — wait until 88.4 มี balance sheet เพราะต้อง logic แตกต่าง)

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "📈 งบกำไรขาดทุน"
2. Default = พ.ค. 2026 → load ทันที
3. **คาดผลปัจจุบัน (data ของ user หลังลบ JV):**
   - รายได้: ไม่มีรายการ (ยังไม่ได้ขายจริง)
   - ค่าใช้จ่าย: 5210 (988) + 5260 (125,270) + 5900 (3,000) = **129,258**
   - **ขาดทุนสุทธิ: (129,258.00)** — สีแดง
   - Margin: -∞ % (เพราะ revenue = 0) → จะไม่แสดง
4. Export Excel — header "หมวด/รหัส/ชื่อบัญชี/จำนวนเงิน" + section breaks + total + net
5. พิมพ์ → popup window พิมพ์ได้

### Pending Phase 88.4-88.5
- 88.4: Balance Sheet (งบดุล) — สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
  - ต้อง opening balance → จุดต่อ Phase ที่ซับซ้อนกว่า TB/PL (ต้อง running balance)
- 88.5: Export bundle — PDF (TB + PL + BS) ในไฟล์เดียว + multi-sheet Excel

---

---

## 📊 Phase 88.2 — Trial Balance Report (8 พ.ค.)

### Why
หลัง Backfill เสร็จ + ลบ JV ทดสอบ → user มีข้อมูลจริง 5 PV ใน พ.ค. → ต้องการ
รายงานยอดทดลอง (trial balance) เพื่อส่งสำนักงานบัญชี + ตรวจ Dr = Cr

### What shipped (5.34.5 build 172)

**`modules/accounting/trial_balance.js`** (~290 บรรทัด — NEW):

**Period picker:**
- 4 modes: month / quarter / year / custom range
- Auto-default = เดือนปัจจุบัน
- Reactive UI — เปลี่ยน tab → re-render input controls

**Data fetch (3 queries):**
1. journal_entries — list ids ที่ doc_date ใน range + status='approved'
2. journal_lines — bulk fetch ผ่าน `entry_id=in.(...)` (chunked 200/batch)
3. chart_of_accounts — full COA สำหรับ map name + type

**Aggregate:**
- Group lines by `account_code` → sum debit + credit ทุก line
- Group accounts by `type` (asset/liability/equity/income/expense)
- Sort by code

**Render:**
- 5 sections (asset/liability/equity/income/expense) — เฉพาะ section ที่มี data
- แต่ละ section มี subtotal Dr/Cr
- Grand total card สีเขียวถ้า balanced (Dr=Cr) / สีแดงถ้าไม่
- Header card: ชื่องวด + range + จำนวนบัญชีที่เคลื่อนไหว

**Actions:**
- 📤 **Export Excel** — sheet "TB_YYYY-MM_YYYY-MM" + 5 columns
  (รหัส | ชื่อบัญชี | ประเภท | เดบิต | เครดิต) + total row
- 🖨 **พิมพ์** — popup window with `<style>` + auto window.print()

### Files changed (Phase 88.2)
- `modules/accounting/trial_balance.js` — NEW (290 lines)
- `main.js` — import + 4 wire points (ALL_ROUTES, ROUTE_GROUP, routeTitles, showRoute)
- `index.html` — nav button (ใต้ "ผังบัญชี" — ก่อน Backfill) + `<section id="page-accounting_trial_balance">`
- `sw.js`, `modules/settings/pages.js` — bump 5.34.4→5.34.5 build 172, SW v157

### ⭐ ใช้ "4-point checklist" ที่จดในบทเรียน Phase 88.1b
- [✓] index.html — button + section
- [✓] ALL_ROUTES (line 863)
- [✓] ROUTE_GROUP (line 899)
- [✓] routeTitles + showRoute handler

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "📊 รายงานยอดทดลอง" (อยู่ระหว่าง "ผังบัญชี" และ "Backfill")
2. Default mode = เดือนปัจจุบัน → auto-load TB ของ พ.ค. 2026
3. แสดง:
   - Section "ค่าใช้จ่าย": 4-5 บัญชี (5210/5220/5260/5900?) รวม Dr ~129K
   - Section "สินทรัพย์": 1110 (เงินสด) Cr ~129K
   - Grand total: Dr 129,258 / Cr 129,258 / ผลต่าง 0 → ✅ balance สีเขียว
4. เปลี่ยนเป็น "ปี 2026" → ดูทุก JV (รวมเดือนหน้าๆ ที่จะมี)
5. Export Excel → ไฟล์ `trial_balance_2026-05-01_2026-05-31_<date>.xlsx`
6. พิมพ์ → popup window พิมพ์ได้

### ⚠️ Known caveats
- Trial Balance ตอนนี้เป็น **Movement-based** (ผลรวม Dr/Cr ในงวด) — ไม่ใช่
  closing balance — เพราะระบบยังไม่มี opening balance (Phase 88.5 จะทำ)
- ถ้า user manual delete JV เฉพาะ entry → CASCADE จะลบ lines อัตโนมัติ
  (foreign key ON DELETE CASCADE) — ดังนั้นไม่มี orphan lines

### Pending Phase 88.3-88.5
- 88.3: P&L (กำไรขาดทุน) report — รายได้ - ค่าใช้จ่าย = กำไรสุทธิ
- 88.4: Balance Sheet — สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- 88.5: Export bundle ส่งสำนักงานบัญชี (PDF + CSV หลายชีท)

---

## ✅ Phase 88.1b — Verified end-to-end (8 พ.ค. ตอนเย็น)

**Backfill stress-test:** user ติ๊ก sales + expenses + receipts + service_jobs,
range 01/04/2026 → 08/05/2026 → preview แสดง 91 rows (84 sales + 7 expenses,
receipts/service_jobs = 0) → run → สำเร็จ 90/91 (1 อันเก่ามี JV แล้ว)

→ สมุดรายวันก่อน 3 รายการ → หลัง **93 รายการ** (Phase 88.1a 3 + Backfill 90)

JV ที่ Backfill สร้างย้อนหลังถึง:
- PV2026040001 (เติมน้ำมัน 12/04 ฿1,000)
- SV2026040071 (ขาย 16/04 ฿11,900)
- PV2026050004 (แอร์ 30,000btu 2 ตัว ฿60,000) ฯลฯ

→ trial balance ของเดือน เม.ย.-พ.ค. 2026 **ครบจริง 100%** — สำนักงานบัญชีพร้อมใช้

### Hotfix 5.34.4 (build 171)
ปัญหา: `ALL_ROUTES` ใน main.js line 863 ไม่ได้รวม `accounting_backfill`
→ `canAccessPage("accounting_backfill")` return false → showRoute redirect → กดปุ่มไม่เข้า

แก้: เพิ่ม `"accounting_backfill"` ใน ALL_ROUTES list (1 บรรทัด)

### Lesson learned สำหรับเพิ่ม route ในอนาคต
**4 จุดต้องแก้พร้อมกัน** เวลาเพิ่ม route:
1. `index.html` — `<button data-route="X">` + `<section id="page-X">`
2. `main.js ALL_ROUTES` — list (สำหรับ canAccessPage)
3. `main.js ROUTE_GROUP` — group สำหรับ auto-open sidebar
4. `main.js routeTitles` + `showRoute` — title + render handler

(ลืม #2 ใน Phase 88.1b initial → ต้อง hotfix 171)

---

---

## ⏪ Phase 88.1b — Receipts/Service Jobs auto-post + Backfill UI (8 พ.ค.)

### Why
หลัง Phase 88.1a ทำ sales + expenses เสร็จ — ยังเหลือ source อีก 3 ตัว
(receipts, service_jobs, payroll) + ต้องมี backfill UI เพื่อ post JV ย้อนหลัง
ให้ rows เก่าก่อน Phase 88.1a deploy (ไม่งั้น trial balance ไม่ครบ)

### What shipped (5.34.3)

**1. `modules/accounting/auto_post.js` updates:**
- ขยาย `EXPENSE_CATEGORY_MAP` รวม `salary` / `labor_hire` / `payroll` / `materials` / `utilities`
  - ⭐ **สำคัญ:** Payroll ไม่ต้อง wire ตรง — เพราะ Phase 76 (`payroll.js _markPaid`)
    auto-create expense category=salary ตอนกดจ่าย → expense.js wire (Phase 88.1a)
    จะ trigger postJournalForExpense → ใช้ mapping `payroll_salary` (Dr 5200 / Cr 1110)
- เพิ่ม **`postJournalForReceipt(receipt)`** — RV doc_type
  - default `receipt_payment` (Dr 1110 / Cr 1200)
  - ถ้า `payment_method` มี transfer/โอน/qr/bank → `receipt_transfer` (Dr 1130 / Cr 1200)

**2. Wire 3 จุด:**
- `modules/receipts.js`:
  - dropdown action "เก็บเงิน" (line 442) + button "rcPreviewCollect" (line 671) →
    หลัง PATCH status=paid สำเร็จ → fire `postJournalForReceipt({ ...r, paid_at: now })`
- `main.js saveServiceJob`:
  - import `postJournalForServiceJob`
  - เพิ่ม `{ returnData: true }` ใน xhrPost — ขอ id กลับมา
  - ตรวจ `transitionedToDone || newJobAlreadyComplete` → fire postJournalForServiceJob
  - ใช้ `state.serviceJobs[idx]` (มี total_cost) เป็น input — ไม่ใช่ payload (อาจไม่มี total_cost)
- ⭐ **Payroll:** ผ่าน expense flow auto (จาก Phase 76 + Phase 88.1a) — verified design

**3. `modules/accounting/backfill.js` (NEW — 305 บรรทัด):**
- Page `accounting_backfill` — UI ติ๊ก source (sales/expenses/receipts/service_jobs)
  + date range → Preview / Run
- **Preview mode:** query existing JV → สรุป "รวม / มีอยู่แล้ว / จะสร้างใหม่" ต่อ source
- **Run mode:** loop ทุก row → call postJournalForX — ผ่าน idempotency (HTTP 409 →
  return null = "skipped"); progress bar live update; collected error log (collapsible)
- Effective date check: 2026-01-01 — clamps `from < cutoff` → use cutoff
- Receipts/service_jobs filter pre-loop: `status=eq.paid` / `status=in.(done,delivered,closed)`

**4. Navigation:**
- `index.html`: nav button "⏪ Backfill ย้อนหลัง" + section `page-accounting_backfill`
- `main.js`: route `accounting_backfill` (group "accounting" + label "Backfill JV ย้อนหลัง" +
  call `renderBackfillPage(ctx)` ใน showRoute)

### Files changed (Phase 88.1b)
- `modules/accounting/auto_post.js` — 23 → 24 mappings + postJournalForReceipt function
- `modules/accounting/backfill.js` — NEW (Backfill UI page)
- `modules/receipts.js` — wire 2 จุด (dropdown + preview button)
- `main.js` — import postJournalForServiceJob + wire saveServiceJob + route accounting_backfill
- `index.html` — nav button + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.2→5.34.3 build 170, SW v155

### Architecture decision: ทำไม Payroll ไม่ wire ตรง
| Approach | ข้อดี | ข้อเสีย |
|---|---|---|
| Wire ตรงที่ `payroll.js _markPaid` | ชัดเจน — JV เกิดจาก source ตรงๆ | ❌ Duplicate — Phase 76 auto-create expense ก็ trigger postJournalForExpense → JV เกิด 2 ครั้ง (PV จาก payroll + PV จาก expense) เพราะ source_table ต่างกัน → ผ่าน idempotency unique → ผิด |
| ⭐ ใช้ expense flow (Phase 76) | JV เกิดครั้งเดียว — สอดคล้อง principle "1 transaction = 1 JV" | ต้องเพิ่ม mapping `salary` ใน EXPENSE_CATEGORY_MAP (ทำแล้ว) |

→ Decision: **expense flow only** — เพิ่ม mapping `salary` → `payroll_salary` (Dr 5200 / Cr 1110)

### ✅ Smoke tests ที่ควรผ่าน
1. ทำ POS sale (เงินสด) → SV เกิด ✅ (verified ใน 88.1a)
2. เพิ่ม expense (fuel) → PV เกิด ✅ (verified ใน 88.1a)
3. **เก็บเงินใบเสร็จ (status pending → paid)** → RV เกิด Dr 1110/1130 / Cr 1200
4. **บันทึกงานช่างใหม่ status=done** → SV เกิด (ถ้ามี total_cost)
5. **เปลี่ยน status งานเก่า → done/delivered/closed** → SV เกิด
6. **จ่ายเงินเดือน** (markPaid) → expense salary เกิด → PV เกิด Dr 5200 / Cr 1110/1130
7. **Backfill UI:** เลือก source + date range → Preview แสดงจำนวน → Run → progress bar → summary

### ⚠️ Known caveats
- Service jobs ที่ **ไม่มี total_cost** → postJournalForServiceJob return null silent
  → user ต้องกรอกยอดก่อน หรือ JV จะไม่เกิด (admin ต้องสร้าง manual JV แทน)
- Backfill ใช้ idempotency unique index — ถ้า admin เคย create manual JV ที่
  source_table+source_id ซ้ำ → backfill skip (ดี — กัน duplicate)

### Pending Phase 88.2-88.5
- 88.1c: Drill-down (click JV row → drawer with source link) + mapping editor UI
- 88.2: Trial Balance report (filter ตาม fiscal period)
- 88.3: P&L (กำไรขาดทุน) report
- 88.4: Balance Sheet (งบดุล) report
- 88.5: Export bundle ส่งสำนักงานบัญชี (PDF + CSV ของทุก JV + รายงาน)

---

## 🛠️ Phase 88.1a-fix — Wire auto-post ที่ pos.js + RLS hotfix (8 พ.ค.)

### ปัญหาที่เจอตอน user test build 168
1. **ตาราง `journal_entries` ว่างเปล่า** ทุกครั้งที่ขายจริง
2. แต่ test ผ่าน console import ตรง → `postJournalForSale` insert ได้สำเร็จ

### 2 root causes (สำคัญสำหรับ session ต่อ)

**Root cause #1 — RLS ของ Phase 88.0 block INSERT:**
- `is_accountant()` ตรวจ `role = 'admin'` เท่านั้น
- RLS `je_admin` / `jl_admin` ใช้ `FOR ALL` → block INSERT จาก non-admin users
- Cashier/owner ขาย → POST JV ตก HTTP 403 → fire-and-forget เก็บ console.warn

→ **Fix:** `supabase-phase88-hotfix-rls.sql` (ไฟล์ใหม่)
- Split `je_admin` / `jl_admin` เป็น 4 policy แยก (SELECT/UPDATE/DELETE = accountant, INSERT = accountant OR source-linked)
- เปิด `account_mapping` SELECT ให้ทุก authenticated (client ต้องอ่าน mapping)
- Total: 10 policies (4+4+2)

**Root cause #2 — Wire auto-post ผิดไฟล์ใน build 168:**
- main.js มี `async function checkout()` (line 3077) — **legacy ที่ไม่ถูกเรียกแล้ว**
- POS จริงใช้ `doCheckout()` ใน `modules/pos.js` line 919
- Build 168 wire ที่ main.js → ขายจริงไม่ trigger

→ **Fix (build 169):** ย้าย wire ไปที่ `modules/pos.js` หลัง `showToast("บันทึกการขายเรียบร้อย ✅")`
- เก็บ wire เก่าใน main.js ไว้ — ไม่ทำงานแต่ idempotent กัน duplicate

### Verification (build 169)
Console ตอนขายจริง:
```
[auto_post] ✅ created SV2026050001 from sales #119 amount 50
```
สมุดรายวัน → SV2026050001 ขาย POS BSK-1778227814186 ฿50 status "อนุมัติแล้ว"

### Files changed (Phase 88.1a-fix)
- `supabase-phase88-hotfix-rls.sql` — NEW (RLS split policies, 10 policies)
- `modules/pos.js` — import + wire postJournalForSale ใน doCheckout
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.34.1→5.34.2 build 169, SW v154

### ⚠️ Lesson learned (สำคัญสำหรับ Phase 88.1b)
**ก่อน wire auto-post — ตรวจ source module ที่ใช้จริง:**
- `pos.js doCheckout()` (sales) — ✅ wired
- `expenses.js expFormSaveBtn` (manual expense) — ✅ wired
- `expenses.js akSaveBtn` (AutoKey OCR) — ✅ wired
- `receipts.js` — TBD (ตรวจไฟล์จริง — อาจอยู่ใน main.js หรือ module แยก)
- `service_jobs` — TBD (เคยอยู่ใน main.js — ต้อง grep)
- `payroll.js` — TBD (มี module แยกอยู่)

**ห้ามแก้ `main.js` แล้วคิดว่าครอบคลุม** — โครงสร้างหลัง refactor 86 → ทุก source flow อยู่ใน `modules/*.js`

---

## 🧾 Phase 88.1a — Auto-post JV (sales + expenses) (8 พ.ค.)

### Why
User ขอ "หน้าบัญชีให้ใกล้เคียง FlowAccount และทำได้ดีกว่า — ส่งสำนักงานบัญชีใช้ได้
จริง" + ตอบ scope: VAT B (ไม่จด), COA B (ส่ง CSV), period month/quarter/year,
start 2026-01-01, path A (sequential 88.0 → 88.5)

Phase 88.0 (build 167) วาง foundation (chart_of_accounts + journal_entries
+ lines + manual JV form) เสร็จแล้ว → 88.1a เริ่ม auto-posting จาก source
transactions แทนการกรอก JV ด้วยมือทุกครั้ง

### What shipped (5.34.1)

**SQL migration** (`supabase-phase88-auto-post.sql`):
1. **Idempotency** — partial unique index บน `journal_entries (source_table,
   source_id) WHERE NOT NULL` → POST ซ้ำได้ HTTP 409 → return null (manual
   JV ที่ source = NULL ใส่ได้หลายอันตามปกติ)
2. **`account_mapping` table** — config ผูก `mapping_key` →
   `debit_account_code` / `credit_account_code` + RLS admin only
3. **22 seed mappings:**
   - Sales: 4 (sale_cash 1110/4100, sale_transfer 1130/4100, sale_credit
     1130/4100, sale_credit_term 1200/4100)
   - Expenses: 10 (fuel/utility/phone/rent/repair/supplies/ads/bank_fee/
     travel/misc — Dr 5xxx / Cr 1110)
   - Service jobs: 5 (install/repair/clean/move/other AC — Dr 1110 / Cr 4xxx)
   - Receipts: 2 (cash 1110/1200, transfer 1130/1200)
   - Payroll: 2 (salary 5200/1110, wht 5200/2140)

**JS module** (`modules/accounting/auto_post.js` — 330 บรรทัด):
- `postJournalForSale(sale)` — POS sale → SV (ดู `payment_method` →
  ระบุ mapping_key: cash/transfer/credit/credit_term)
- `postJournalForExpense(expense)` — expense → PV (ดู `category` →
  EXPENSE_CATEGORY_MAP → mapping; override credit account ถ้า
  `payment_method = transfer/credit`)
- `postJournalForServiceJob(job)` — service → SV (เฉพาะ status
  delivered/closed/done)
- `resetMappingCache()` — เรียกหลัง admin แก้ mapping
- Effective date: skip ถ้า docDate < `2026-01-01`
- Mapping cache: lazy-loaded once per session

**Wiring:**
- `main.js → checkout()` — หลัง `showToast("บันทึกการขายเรียบร้อย")`
  → `postJournalForSale({...}).catch(...)` (fire-and-forget)
- `modules/expenses.js → expFormSaveBtn click` — เปลี่ยน
  `_appXhrPost(...)` ให้ใช้ `{returnData:true}` เพื่อเอา id กลับมา →
  `postJournalForExpense(inserted).catch(...)`
- `modules/expenses.js → akSaveBtn click (AutoKey)` — เปลี่ยน
  `Prefer: return=minimal` → `return=representation` → parse first row →
  `postJournalForExpense(inserted).catch(...)`

### Why fire-and-forget + idempotent
ถ้า auto-post ล้มเหลว (network/RLS/missing mapping) — ไม่ block UX checkout/
expense save (user ทำงานต่อได้) แต่ console.warn เก็บไว้ debug

ถ้า user reload + retry → unique partial index จะ reject (HTTP 409) →
auto_post.js detect 409 → return null (ไม่ duplicate)

### Files changed (Phase 88.1a)
- `supabase-phase88-auto-post.sql` — NEW (idempotency + mapping + seed)
- `modules/accounting/auto_post.js` — NEW (helper เรียกจาก source modules)
- `main.js` — import + wire `postJournalForSale` ใน checkout()
- `modules/expenses.js` — import + wire 2 จุด (manual save + AutoKey)
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.34.0 → 5.34.1

### ⚠️ Manual step required (post-deploy)
**Run `supabase-phase88-auto-post.sql` ใน Supabase SQL Editor** ก่อน user
ทดสอบ — ไม่งั้น auto-post จะ fail (mapping table ไม่มี + ไม่มี idempotency
index → ขายซ้ำเดิม → JV ซ้ำ)

### ✅ Smoke test ที่ควรผ่าน
1. หลังรัน SQL: `SELECT count(*) FROM account_mapping` → 22
2. ทำ POS sale 1 ครั้ง (cash) → เปิดสมุดรายวัน → JV เลข `SV202605####`
   ปรากฏ Dr 1110 / Cr 4100
3. เพิ่ม expense category=fuel 200 บาท (cash) → เปิดสมุดรายวัน → JV
   `PV202605####` Dr 5210 / Cr 1110
4. AutoKey OCR สลิป → save → JV เกิดเหมือนกัน
5. ทำขายซ้ำ id เดิม (manual SQL test) → console "[auto_post] already
   posted" + ไม่ duplicate

### Pending Phase 88.1b/c (next session)
- 88.1b: receipts.js + service_jobs (in main.js) + payroll.js wires +
  backfill UI (post existing pre-2026-05 sales/expenses retroactively)
- 88.1c: Drill-down (click JV row → drawer with source link) + mapping
  editor UI (admin แก้ mapping_key → account ใน Settings)
- 88.2-88.5: Trial Balance + P&L + BS reports + WHT + Export bundle

---

## 🏛️ Phase 88.0 — Accounting Foundation (8 พ.ค.)

### What shipped (5.34.0 build 167 — already pushed)
- `supabase-phase88-accounting-foundation.sql` — chart_of_accounts (51
  Thai accounts), journal_entries (with je_balanced CHECK Dr=Cr),
  journal_lines (line_one_side CHECK), fiscal_periods, is_accountant()
  helper, 4 RLS policies admin-only
- `modules/accounting/journals.js` — JV list (status chip + filter)
- `modules/accounting/journal_form.js` — manual JV form (auto doc_no
  `JV2026MM####`, balance validator)
- `modules/accounting/coa.js` — COA management (stats + collapsible +
  CSV/Excel import/export with Thai aliases)

---

## 🌱 Phase 87.5 — Full Catalog Spec Seed (7 พ.ค.)

### Why
User: "211 SKUs ที่ยังต้องกรอก specs (admin task) ช่วยผมหาข้อมูลจริง มากรอก
ช่วยผมหน่อย" → กรอกเองด้วย UI editor ใช้เวลา ~28 ชั่วโมง — ขอ Claude
generate ตาม brand/BTU patterns แล้ว user ค่อยตรวจ/ปรับเฉพาะรุ่นที่ต้องการ

### What shipped (5.33.5)
- **211 SKUs** ได้ specs เพิ่ม (จาก 12/223 → 223/223 = **100% coverage**)
- ใช้ Python script `scripts/seed_specs.py` (~640 บรรทัด) — generate ตาม
  per-section template (45+ section templates) + per-BTU class scaling
- Cache logic เปลี่ยน: เดิมเช็ค "มี features ไหม" (ผ่านแม้ 12/223) →
  ใหม่เช็ค **ratio ≥90% ของ entries** ถึงไม่ refetch (force refresh user เก่า)

### Strategy / Honest caveats
**Top brands (TCL/Carrier/LG/Samsung/Daikin/Mitsubishi/Haier/Hisense/Gree/
Midea/Toshiba):** Description, features, badges อ้างอิงตาม spec จริง
ของ brand line (Dual Inverter ของ LG, WindFree ของ Samsung, Mr.SLIM
ของ Mitsubishi Electric, Streamer Discharge ของ Daikin ฯลฯ)

**Smaller TH brands (FRIO, MAVELL, STAR AIR, AUFIT, AIR COOL, CANDY,
AUX, CENTRAL AIR, SAIJO DENKI):** Defaults ตาม Inverter/Fix-Speed type +
BTU class — sensible แต่ไม่ใช่ official spec sheet

**Physical specs (dim, weight, current, power, noise, SEER):** ค่าโดย
ประมาณตาม BTU class (industry typical ranges สำหรับตลาดไทย)

**Refrigerant:** R32 สำหรับรุ่นใหม่, R410A สำหรับ DAIKIN SMASH 2018
(รุ่นเก่า)

### Files changed
- `data/ac_catalog.json` — 64KB → 280KB (211 entries gained 16 spec fields)
- `main.js` — cache refresh threshold ratio-based (Phase 87.5)
- `scripts/seed_specs.py` — NEW (generator + 45+ section templates)
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.33.4→5.33.5

### Refinement workflow
- **UI editor** (Phase 87.2) ปรับทีละรุ่น — แก้ description ให้ตรงสเปกจริง
- **Excel bulk** (Phase 87.3) — export → แก้ใน Excel → import กลับ
- **Copy spec** (Phase 87.4) — ใช้รุ่น A เป็น template ของ B รุ่นใกล้เคียง

### ✅ Smoke test ที่ควรผ่าน
- Customer คลิก card สุ่มจาก section ใดก็ได้ → modal เปิด + spec table ครบ
- Admin export Excel → ตรวจ 24 columns × 223 rows + non-empty cells
- Console log: `[ac_catalog] refreshed: 223 entries, 223 with specs`

---

## 🛍️ Phase 87 — Product Detail Modal & Spec Management (7 พ.ค.)

### Why
User: "หาข้อมูลสินค้ามาใส่ สเปกเครื่อง BTU แต่ละรุ่น ให้ลูกค้าคลิกดูรายละเอียดข้างในได้
เหมือนร้านมืออาชีพ หรือห้างเขาขายสินค้า"

### What shipped
**4 commits**, 2 ไฟล์ใหม่ใน `modules/`, 1 ไฟล์ใหม่ใน `modules/settings/`,
schema v2 ของ `data/ac_catalog.json` (24 fields ต่อ entry), 12 SKUs seeded
ครอบคลุม 6 แบรนด์ (TCL/Carrier/LG/Daikin/Mitsubishi).

### 🎨 Phase 87.1 — Product Detail Modal foundation
**ไฟล์ใหม่:** `modules/product_detail_modal.js` (212 lines)

**Schema v2 — 16 extended fields** (optional):
```
description, features (array), badge_tags (array), image_url,
seer, refrigerant, voltage, current_a, power_w,
indoor_dim, outdoor_dim, indoor_weight_kg, outdoor_weight_kg,
noise_indoor_db, noise_outdoor_db, color
```

**Modal layout (เหมือนหน้าสินค้าห้างใหญ่):**
- Hero image (placeholder ❄️ ถ้าไม่มี image_url)
- Badge tags (ขายดี / Inverter / WiFi) มุมซ้ายบน + BTU pill มุมขวาล่าง
- Title + price + "รวมติดตั้ง" + Description paragraph
- Warranty bar (ติดตั้ง/อะไหล่/คอม)
- Features list (pill style)
- Spec table — render เฉพาะ field ที่มีค่า; placeholder "ยังไม่มีข้อมูลสเปก" ถ้าว่าง
- Sticky footer: ปิด + CTA (เพิ่มลงตะกร้า / สั่งจอง)
- ESC + click-outside dismiss + mobile-friendly (full-screen <640px)

**Wired ใน customer_dashboard.js:**
- `import { openProductDetail }`
- Spread `...c` ใน `products = catalog.map(...)` เพื่อ keep extended fields
- Click `[data-view-product]` card → openProductDetail
- Card "+ ลงตะกร้า" button: stopPropagation กัน double-trigger

**Seed 2 SKUs:** id=1 MFS10, id=5 T-PROWD10

### 🔧 Phase 87.1.1 — Schema auto-refresh hotfix
**Bug:** localStorage cache v1 → JSON v2 ไม่ถูก load → modal เห็นแค่ BTU
**Fix in main.js:** หลัง parse cache ตรวจว่ามี entry ใดมี `features|seer|description`
ถ้าไม่มี (= v1) → fetch JSON v2 + overwrite + log "upgraded to v2"

### ✏️ Phase 87.2 — Admin Spec Editor + Seed
**ไฟล์ใหม่:** `modules/settings/ac-spec-editor.js` (233 lines)

`openSpecEditor(product, onSave)` — Modal form:
- Description (textarea), Features + Badges (comma input → string[])
- Image URL, SEER, refrigerant, voltage, current, power, color
- Dim: indoor/outdoor W×H×D, weights
- Noise: indoor/outdoor dB

Number fields fall back to string when range (e.g. `"0.4-4.5"`)
Empty values stripped from save diff

**Wired ใน ac-catalog.js:**
- Each row: ✏️ button — `+ สเปก` (เทา) ถ้าว่าง, `แก้` + 📋 (เขียว) ถ้ามี
- Click → openSpecEditor → save merge → localStorage + rerender + toast

**Seed 8 SKUs เพิ่ม** (รวม 12/223):
- TCL Wall standard: MFS13/19/25
- TCL Inverter WIFI: T-PROWD13/19/25
- Carrier COPPER SEAL: 38TVDB010/42TVDB010
- LG Inverter: ISC10E (Dual Inverter, 19dB whisper)
- Daikin SMASH: FTM 09 PV2S
- Mitsubishi Mr.SLIM: MSY-JZ 09 VF (SEER 18)

### 📊 Phase 87.3 — CSV/Excel Round-trip 24 columns
**Updated ac-catalog.js:**
- Helpers: `_arrToPipe`, `_pipeToArr`, `_tryNum`, `_toExportRow`,
  `_fromImportRow`, `_EXPORT_HEADERS` (24 names)
- Excel export: catalog.map(_toExportRow) + per-column widths
- CSV export: header from _EXPORT_HEADERS, body via _toExportRow
- Import: parse via _fromImportRow (column-name-tolerant English+Thai)

**Smart serialization:**
- Array fields → `"item1 | item2 | item3"` ใน cell
- Import accepts `|` or `,` as separator
- Number-or-range fields → try Number() → fallback string
- Empty fields → ไม่เก็บใน catalog (clean schema)
- **Backwards-compat:** old 8-column CSV/Excel still imports

**UI hint** ใต้ file picker — แสดงรายการ 24 fields แบ่ง 4 กลุ่ม +
ตัวอย่าง pipe separator `Inverter | WiFi | Self-Cleaning`

### ⚡ Phase 87.4 — Copy spec from another SKU (Hybrid workflow boost)
**Updated `modules/settings/ac-spec-editor.js`** — เพิ่ม `sourceList` 3rd arg

**Use case:** Admin กรอก T-PROWD10 ครบ → ต้องกรอก T-PROWD13/19/25
(BTU/dim/power ต่างกัน แต่ description/features/SEER/refrig/voltage
เหมือนกันทั้ง series) → กดปุ่ม "📥 ดูด" → form fill ทันที → แก้แค่
fields ที่ต่าง (current_a, power_w, indoor_dim, weight, noise) → save
→ เร็วกว่ากรอกเองทั้งหมด ~5x

**UI:**
- Green panel ด้านบน body (ใต้ header) — แสดงเฉพาะเมื่อ `sourceList`
  มีอย่างน้อย 1 รุ่น
- `<select>` ที่ optgroup ตาม section + แสดง model + BTU per option
- ปุ่ม "📥 ดูด" disabled จนกว่าเลือก dropdown
- Self-filter: ไม่แสดงรุ่นปัจจุบันใน dropdown
- บน click: fill 16 spec inputs (ไม่แตะ id/section/model/btu/price/stock)
- Feedback: ปุ่ม → "✅ คัดลอกแล้ว" 1.5 วินาที → กลับเป็น "📥 ดูด"

**Wired ใน `ac-catalog.js`:**
```js
const sourceList = catalog.filter(c => c.features || c.seer || c.description);
openSpecEditor(catalog[idx], onSave, sourceList);
```

**Backwards-compat:** ถ้า sourceList ว่าง (ครั้งแรกที่ใช้ — ยังไม่มี
SKU มี specs) → ไม่ render panel — back to plain editor.

### 📊 Status: 12/223 SKUs มี specs
**Remaining 211 SKUs** — admin กรอกเอง 4 วิธี (Hybrid workflow ครบ):
1. **UI editor ทีละรุ่น** (ละเอียด — Phase 87.2)
2. **Copy spec จาก SKU อื่น** (เร็ว — สำหรับ series รุ่น — Phase 87.4)
3. **Excel bulk** (เร็วสุด — 50+ รุ่นต่อรอบ — Phase 87.3)
4. **Hybrid** (รวมทุกข้อข้างต้น)

**Time-saving estimate:**
- กรอกเอง 16 fields × 30s = **8 นาที/รุ่น** → 28 ชม. สำหรับ 211 รุ่น
- Copy + tweak = **1.5 นาที/รุ่น** → ~5 ชม. (5x faster)

### Files
- `modules/product_detail_modal.js`
- `modules/settings/ac-spec-editor.js`
- `modules/settings/ac-catalog.js` (extended)
- `modules/customer_dashboard.js` (catalog spread fix)
- `main.js` (schema upgrade check)
- `data/ac_catalog.json` (12 SKUs with full specs)

### ✅ Smoke test ที่ผ่านใน production
- Customer คลิก card MFS10/13, T-PROWD10, MSY-JZ → modal สวย + spec table
- Customer คลิก card ที่ยังไม่ seed → modal เปิด + "ยังไม่มีข้อมูลสเปก"
- Admin ✏️ + สเปก → modal editor → save → ✅ 📋 ทันที
- Admin export Excel → ตรวจ 24 columns + features pipe-separated +
  range strings (`0.4-4.5`) ถูกต้อง
- Admin upload back → import 223 รุ่นสำเร็จ
- Old 8-column CSV → ยัง import ได้ (backwards-compat)
- ✅ **Phase 87.4 verified:** เปิด T-PROWD13 → dropdown "T-PROWD10 (9,000 BTU)"
  → กด "📥 ดูด" → form fill 16 fields ทันที → user แก้ description
  + dim + weight + noise → save → ✅

---

## 🚀 Phase 85-86 ที่เสร็จในรอบนี้ (7 พ.ค.)

### 📊 สถิติ Session
- **13 commits** in main.js + 4 modules ใหม่ (api_utils, otp_cooldown, auth_email, auth_otp)
- **main.js: 4,415 → 4,032 บรรทัด (-383 lines, -8.7%)**
- ปิด Phase 84 debt (confirm migration) + แก้ login race + UX dashboard + OTP cooldown
- ทุก phase ทดสอบใน production https://boonsukair.com/ แล้ว

### 🔧 Phase 85.x — Bug fix + UX

#### Phase 85.1 — login() race-condition fix
**Symptom:** Phase 84 ทำให้ "ล็อกอินไม่ได้" → revert Phase 84 ทั้งก้อน
**Root cause:** `login()` ใน main.js ขาด 3 defenses ที่ฟังก์ชันคู่ขนาน (requestStaffPasswordReset, requestOtp, verifyOtp) มีครบ:
- ❌ ไม่มี `state.supabase` guard → ถ้า boot ช้า → throw `Cannot read property 'auth' of undefined`
- ❌ ไม่มี try/catch → unhandled rejection → button stuck "กำลังเข้าสู่ระบบ..."
- ❌ ไม่มี button lock → double-click race

**Fix:** Apply pattern เดียวกับ requestStaffPasswordReset:
1. Guard `state.supabase + state.supabase.auth` → toast + return
2. `try/catch` ครอบ `signInWithPassword` + log + toast on throw
3. Button disable + restore ใน `finally`

#### Phase 85.2 + 85.2.1 — confirm() migration (Phase 84 debt)
**Why:** Phase 84 ตั้งใจ migrate native `confirm()` → `App.confirm` (Promise) แต่โดน revert ตามไป
**Migrate 6 จุด:**
- products.js (5 callsites: export filter, clear category, bulk delete x2, delete category)
- main.js:_revokeShareToken (cancel link)
- ใช้ `_appConfirm` wrapper ใน products.js (fallback `window.confirm` ถ้า App ยังไม่พร้อม)
- ใช้ `confirmAsync` (already in scope) ใน main.js

**🐛 85.2.1 hotfix:** Phase 85.2 ใส่ `await _appConfirm()` ใน arrow function ปกติของ `#prodExportBtn` click → SyntaxError → ทั้ง products.js parse fail → import chain แตก → login dead. แก้: async callback

#### Phase 85.3 — OTP cooldown UX
**Why:** User ทดสอบ OTP กดซ้ำ 6 ครั้ง → ติด Phase 17 KV rate limit (HTTP 429) → เข้าระบบไม่ได้
**Fix:** Module-scoped state + 5 helpers ใน main.js:
- `_setOtpCooldown(seconds)` — start countdown + tick ทุกวินาที
- 60s cooldown หลัง send สำเร็จ
- 5-min cooldown ถ้าได้ HTTP 429 + special toast
- `requestOtp` guard cooldown ก่อน fetch
- Button disable "⏳ กำลังส่ง..." → "รอ NN วิ" → restore

#### Phase 85.4 + 85.5 — Dashboard KPI cards (white-on-white bug)
**85.4 attempt:** เปลี่ยน 4 cards (ผู้ใช้งาน/สิทธิ์/สินค้าทั้งหมด/งานช่างค้าง) เป็น defensive IIFE — เพิ่ม fallback chain + min-height + emoji label + Thai role labels
**85.5 actual fix:** DOM inspector ยืนยัน text render OK แต่ `color: rgb(255, 255, 255)` (white) บน card สีขาว → invisible! Parent `<div class="hero">` set `color:#fff` สำหรับ headline → cards inside inherit white. แก้: explicit `color:#0f172a` ใน inline style ทุก stat-label + stat-value

### 🏗️ Phase 86.x — main.js refactor (extract auth modules)

**เป้าหมาย:** main.js 4,300+ บรรทัด ใหญ่เกินไป → แตกเป็น modules ที่ test/reuse ได้

| Phase | Module | main.js Δ | Total Δ |
|---|---|---|---|
| 86.1 | `api_utils.js` (formatPhone, getApiBase, readApiJson) | -62 | 4,287 |
| 86.2 | `otp_cooldown.js` (state + 5 public APIs) | -38 | 4,315 |
| 86.3 | `auth_email.js` (login + setPassword + reset) | -101 | 4,214 |
| 86.4 | `auth_otp.js` (requestOtp + verifyOtp + _pendingOtp) | -182 | **4,032** |

**Pattern:**
- Pure utils (api_utils) → import ตรง
- State-encapsulated (otp_cooldown) → module-private state, public API
- Stateful flow (auth_email, auth_otp) → factory pattern: `createXxxAuth({state, $, setText, showToast, ...})`
- afterLogin pass เป็น `() => afterLogin()` (lazy resolve hoisted function)

**Module dependency tree:**
```
main.js
  ├─ imports auth_email, auth_otp
  └─ const { login } = createEmailAuth({state, $, setText, showToast, afterLogin: () => afterLogin()})
     const { requestOtp, verifyOtp } = createOtpAuth({state, $, setText, showToast})

modules/
  ├─ api_utils.js       (pure - no deps)
  │    ↓ used by
  ├─ auth_otp.js        ← imports api_utils + otp_cooldown directly
  ├─ auth_email.js      (factory pattern, deps via DI)
  └─ otp_cooldown.js    (uses document.getElementById directly)
```

**Phase 85.1 race-condition guards** ยังคงครบใน auth_email.js (ไม่ regress)
**Phase 85.3 OTP cooldown UX** ยังคงครบใน otp_cooldown.js + auth_otp.js (ไม่ regress)

### ✅ Smoke test ที่ผ่านใน production
- Email login (ผิด/ถูก/forgot password) → working ✅
- Customer OTP signup ใหม่ → working (Bug F trigger fix ยังทำงาน)
- Customer OTP signin ลูกค้าเดิม → working
- OTP cooldown countdown 60s/5min → visible
- Dashboard KPI cards 4 ใบ → readable (color:#0f172a)
- confirm modals 6 จุด → ARIA dialog (App.confirm)
- ui_states empty/skeleton ใน 25+ modules → ยังทำงาน

---

## 🔧 Phase 85.1 — login() race-condition fix (7 พ.ค. รอบบ่าย)

### Why
User รายงาน Phase 84 ทำให้ "ล็อกอินไม่ได้" — revert Phase 84 ทั้งก้อน

Audit `main.js login()` function (line 1205) พบ:
- ❌ ไม่มี `state.supabase` guard — ถ้า boot ช้าจน user click ก่อน init เสร็จ → throw `Cannot read property 'auth' of undefined`
- ❌ ไม่มี try/catch — error throw → unhandled promise rejection → UI freeze (button stuck "กำลังเข้าสู่ระบบ...")
- ❌ ไม่มี button lock — double-click → race condition

ในขณะที่ `requestStaffPasswordReset` (line 1218), `requestOtp`, `verifyOtp` มี guard + try/catch ครบ

→ **Phase 84 น่าจะ slow boot นิดเดียว** (ai-chat-widget.js?v=4 → v=5 cache miss / มี code ใหม่ใน boot path) — make race condition window กว้างขึ้น → user เจอ "login เงียบ" บ่อยพอ revert

### Fix ([main.js login()](main.js))
1. **Guard `state.supabase`** — ถ้ายัง init ไม่เสร็จ → toast "ระบบยังเชื่อมต่อไม่เสร็จ — รอ 2-3 วินาทีแล้วลองใหม่"
2. **Wrap `signInWithPassword` ใน try/catch** — surface error ทันที + log
3. **Button lock + restore** — disable + แสดง "⏳ กำลังเข้าสู่ระบบ..." → restore ใน `finally`
4. **Pattern เดียวกับ `requestStaffPasswordReset`** ที่มีอยู่แล้ว — proven safe

### ❌ ไม่ retry Phase 84 ทั้งก้อน
- Phase 84 modify `showStaffLogin` Promise wrapper — uncertain root cause
- 6 จุด `confirm()` migration ยังค้าง (debt) — รอ confirmed safe

### Bump
- main.js v=150 → v=151
- SW v135 → v136
- Version 5.32.10 (build 150) → **5.32.11 (build 151)**

### Test
1. Hard refresh **Ctrl+Shift+R**
2. หน้า login → กรอก email + password ปลอม → กดเข้าสู่ระบบ
3. ✅ ต้องเห็น button disable + "⏳ กำลังเข้าสู่ระบบ..." → toast error → button restore (ไม่ค้าง)
4. ทดสอบในเบราว์เซอร์ **fresh tab** (ที่ supabase ยังไม่ init) → กดเข้าระบบ **ทันทีก่อน 2 วินาที** → ต้องเห็น "ระบบยังเชื่อมต่อไม่เสร็จ" toast (ไม่ throw silent)
5. Login ปกติ → ต้องเข้าได้เหมือนเดิม



## 🆕 Phase 83-84 ที่เสร็จในรอบนี้

### Phase 83 series (6-7 พ.ค.) — AC install + mobile UX hardening
- **Phase 83**: AC install items table mobile scroll — wrap ใน scroll container `min-width:560px` กัน column compress บนมือถือ
- **Phase 83.1**: Qty stepper +/− mobile-friendly (ปุ่มใหญ่กว่า input, no spinner)
- **Phase 83.2**: DOM surgery แทน re-render — กัน keyboard เด้งออกขณะพิมพ์ field qty/price
- **Phase 83.3**: AC install save timeout 25 วินาที + step progress UI ("กำลังตัดสต็อก", "กำลังบันทึกใบงาน") — debug ค้างหน้าบันทึก
- **Phase 83.4**: Confirm dialog mobile fix — blur active input + scrollIntoView + body scroll lock — กัน keyboard บัง modal

### Phase 84 series (6-7 พ.ค.) — Full-app audit (rolled back)
- **Phase 84 (cfc122c)**: feat — full-app audit fixes 5 batches:
  1. Mobile font overlap (stat-value clamp, customer grid auto-fill, ac_install/btu_calc grid stack, modal max-height/overflow)
  2. native `confirm()` → `App.confirm` migration (9 จุด)
  3. Promise antipattern fix ใน showStaffLogin
  4. Form input attrs (inputmode/enterkeyhint/autocomplete)
  5. Defensive base64 parsing
- **Phase 84.1 (379fd3f)**: hide AI FAB ตอน login/setPassword/confirm-modal — live test pinpoint
- **🔴 ทั้ง 84 + 84.1 ถูก REVERT** (24a4f5c, 47a53ae) — สาเหตุที่ revert ไม่อยู่ใน commit message
- **Phase 84-CSS only (c0a5fd8)**: เก็บแค่ส่วน CSS mobile fixes — ทิ้ง confirm migration + a11y JS
- **Phase 84-CSS.2 (47bef49)**: product list mobile — price/stock/wh/actions stack column บน narrow screens (CSS only)

### ⚠️ ที่ค้างจาก Phase 84 revert (debt)
- **6 จุด `confirm()` native ยังค้างอยู่** (Phase 84 ตั้งใจ migrate แต่โดน revert):
  - `modules/products.js:644` (export filter choice)
  - `modules/products.js:1949` (clear category)
  - `modules/products.js:1972, 1973` (bulk delete + reconfirm)
  - `modules/products.js:2210` (delete category)
  - `main.js:2750` (cancel link)
- **Memory rule** บอก "alert() forbidden ใช้ showToast" — confirm() ก็ควรใช้ App.confirm เหมือนกัน
- **App.confirm พร้อมใช้** — `window.App.confirm(message)` returns Promise<boolean>
- **ก่อน migrate ใหม่** — ต้องเข้าใจว่าทำไม Phase 84 revert (อาจมี bug ที่ไม่บันทึก)

## 🆕 Phase 80-82.5 ที่เสร็จในรอบนี้

- **Phase 80**: Sticker print 50×30mm — auto-print + auto-close window + strict @page
- **Phase 81**: Bluetooth printer module (`modules/bt_printer.js`) — Web Bluetooth → XP-420B + TSPL command
  - ⚠️ **ยังไม่ work บน XP-420B จริง** — เครื่องน่าจะเป็น Bluetooth Classic (passcode 0000) ไม่ใช่ BLE
  - Web Bluetooth ใช้ได้แค่ BLE → ขั้นถัดไปต้องลอง WebUSB API ผ่าน USB OTG
- **Phase 82-82.5**: Scan-loop bug fix series (รับเข้าสินค้า + นับสต็อก ลูปเพิ่มเอง)
  - **Root cause: html5-qrcode callback fires ทุก frame ตราบใดที่บาร์โค้ดอยู่หน้ากล้อง** + scanner ไม่ stop หลัง navigate
  - **Final solution (Phase 82.5)**: stop scanner ทันทีหลัง scan สำเร็จ + mutex flags (`_swAddInProgress`, `_swSaving`, `_swScannerActive`) + `isConfirmOpen()` guard + `blurStockInInputs()` + session ID invalidation

---

## 🛠️ User Configuration State (snapshot ปัจจุบัน)

**🚨 อ่านก่อนเสนอฟีเจอร์ใด ๆ — รายการนี้สรุปสิ่งที่ user setup เสร็จแล้ว**
อย่าบอกว่า "ต้อง setup X" ที่ user ทำเรียบร้อยแล้ว

### LINE Notify (Messaging API)
- **Status**: ✅ Active (verified 3 พ.ค. 2026 จาก screenshot Settings)
- **API**: ใช้ LINE Messaging API (LINE Notify เดิมถูกปิด 2025-03-31)
- **Token storage**: Cloudflare Pages → Settings → Environment variables
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_USER_ID`
- **Notif categories** (ทั้งหมด ON):
  - แจ้งเตือนสต็อกต่ำ
  - แจ้งเตือนออเดอร์ใหม่
  - แจ้งเตือนงานช่างเสร็จ
  - สรุปยอดประจำวัน
- **Server status**: เซิร์ฟเวอร์พร้อมส่ง LINE
- **Code**: [modules/line_notify.js](modules/line_notify.js) + [functions/api/line-notify.js](functions/api/line-notify.js)

### Payment (SlipOK)
- **Status**: มีระบบใน Settings → Payment Gateway
- **Token storage**: localStorage `bsk_slipok_key` + `bsk_slipok_branch`
- **ไม่รวมใน config backup/restore** (security)

### AI providers
- **Cloudflare Workers AI** (binding `AI`) — ใช้กับ ai-chat-widget สำหรับ chat ลูกค้าแจ้งซ่อม. ฟรี 10K neuron/วัน
- **Google Gemini Vision** (env `GEMINI_API_KEY`) — Phase 74 AutoKey OCR สลิป ✅ **PRODUCTION READY**
  - **Model: `gemini-2.5-flash`** (current 2026 free tier vision) — ⚠️ `gemini-1.5-flash` family ลบหมดแล้ว, `gemini-2.0-flash` มี limit:0 (paid only)
  - Fallback chain: gemini-2.5-flash → gemini-2.0-flash-lite → gemini-flash-latest → gemini-2.0-flash
  - User key ต้องสร้างจาก [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (ไม่ใช่ Google Cloud Console เพราะ billing project = limit:0)
  - Cloudflare Function: `functions/api/parse-receipt.js` — ทุก error response status 200 (กัน CF intercept 5xx ด้วย HTML)
  - User Setup: ✅ key อยู่ใน Cloudflare Pages → Settings → Variables and Secrets → Production (Secret type)
  - Tested 3 พ.ค. 2569 22:50 — อ่านบิล "บริษัท แมกซ์ การ์ด จำกัด" 988 บาท หมวด "น้ำมันรถ" ครบทุก field

### Database migrations applied (รายการ)
- ✅ supabase-rls-policies.sql (Phase 19)
- ✅ supabase-phase45-* (RLS hardening + bug fixes A/B/C/D/E/F)
- ✅ supabase-phase46-rls-tighten-reads.sql
- ✅ supabase-phase57-activity-log.sql (audit log table)
- ✅ supabase-phase63-service-share.sql (service_jobs.share_token)
- ✅ supabase-phase68-tags-extend.sql (products.tags + service_jobs.tags) ← 3 พ.ค.
- ✅ supabase-phase69-multi-payment.sql (receipts.payments jsonb) ← 3 พ.ค.
- ⚠️ **supabase-phase71-departments.sql** (Phase 71 — ตาราง departments) — ต้องรัน
- ⚠️ **supabase-phase72-payroll.sql** (Phase 72 — ตาราง staff_payroll + RLS) — ต้องรัน
  - ถ้ายังไม่รัน 2 SQL ข้างบน → 2 เมนู "🏢 ตั้งค่าแผนก" + "💰 รายการเงินเดือน" + "📊 ภาพรวมเงินเดือน" จะขึ้น error "ตาราง X ยังไม่มีในฐานข้อมูล"
- ⚠️ **supabase-phase75-profile-view-update.sql** — update view profiles_with_email เพิ่ม column department_id
  - ถ้ายังไม่รัน → Settings/Users dropdown แผนก ดูเหมือนไม่เซฟ (เซฟจริง แต่ view อ่านกลับไม่ได้)

### Customer accounts (test)
- babang / 0874536754 (ลูกค้า role) — สมัครผ่าน OTP เมื่อ 1 พ.ค. (Bug E verify)

### OTP / SMS (Customer login)
- **Mode**: 🟡 **On-screen fallback** (ไม่ใช่ SMS จริง) ตั้งแต่ 6 พ.ค. 2026
- **Cloudflare env**: `OTP_WEB_FALLBACK=true` (Plaintext) + `OTP_SECRET` (Secret)
- **Twilio**: ไม่ active หรือ trial หมด — server return 503 ถ้า fallback ปิด
- **Code**: [functions/api/send-otp.js](functions/api/send-otp.js) — เห็น `otpDelivery: "web_fallback"` → frontend แสดง prefix "[OTP หน้าเว็บชั่วคราว]"
- **⚠️ Security trade-off accepted**: ใครพิมพ์เบอร์ลูกค้าคนใดก็ login เป็นคนนั้นได้
  - `authPassword` ใน [verify-otp.js:47-49](functions/api/verify-otp.js) เป็น HMAC deterministic — login สำเร็จ 1 ครั้ง = จำ password ใช้ได้ตลอด
  - ถ้าเปลี่ยนกลับมาใช้ SMS ถาวร → ต้อง **หมุน `OTP_SECRET`** เพื่อ invalidate password ที่ attacker อาจคำนวณไว้
- **TODO ระยะยาว**: ตั้ง Twilio (เติม credit) หรือใช้ ThaiBulkSMS / SMS Master ราคาถูกกว่า

---

## 📚 Archived: Phase 1 → 75 (24 เม.ย. – 3 พ.ค. 2026)

Phase 75 ลงมา (~123 KB, 2,045 บรรทัด) ย้ายไปที่ **[HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)** เพื่อ slim ไฟล์นี้

- หา phase เก่า → เปิด archive แล้ว Ctrl+F หาด้วยเลข phase
- ดู short summary ทุก phase → [CHANGELOG.md](CHANGELOG.md)

---

## 📦 Deferred (ยังไม่ได้ทำ — ต้องคุยกับ user ก่อน)
- **Bundle/Set** (ขายแอร์พร้อมติดตั้งเป็น 1 SKU) — ต้อง design table schema
- **Serial Number tracking** — ต้องคุยว่าเก็บที่ไหน/format
- **Auto Reorder PO** — ต้องสร้าง suppliers + workflow ใหญ่

---

## 🧑 เกี่ยวกับเจ้าของ

- **ชื่อ:** gangboo
- **Email:** gangboo@gmail.com
- **ภาษา:** ไทย (ตอบภาษาไทย ยกเว้น code/terminology)
- **สไตล์:** craftsman — ทำให้ถูกต้องครั้งเดียว ไม่ชอบ revise ซ้ำ
- **บริบท:** เทรดหุ้นอเมริกัน ชอบ design ชอบเรียนของใหม่
- **ธุรกิจ:** ร้านแอร์/โซลา (บุญสุข) — POS V5 ใช้ production จริง

**สิทธิ์ที่ user ให้ Claude (ตามที่คุยใน session 22-23 เม.ย.):**
- ✅ แก้ไฟล์ได้ไม่ต้องขอทุกรอบ
- ✅ Commit ได้เอง
- ✅ **Push ได้เอง** (user ไม่อยาก manual push ทุกครั้งแล้ว)
- ❌ ห้าม force push, reset --hard บน remote, skip hooks, รื้อ auth/RLS

---

## 🏗️ โครงสร้างโปรเจกต์

### Tech Stack
- **Frontend:** Vanilla JS (no framework), HTML5, CSS3, Service Worker, ESM modules
- **Hosting:** Cloudflare Pages (Git integration กับ GitHub — auto-deploy)
- **Backend:** Cloudflare Pages Functions (serverless) + Supabase (PostgreSQL + Auth + RLS + Storage)
- **Realtime:** LINE Messaging API — 2 groups (queue=ออเดอร์ใหม่, done=งานเสร็จ)
- **SMS OTP:** Twilio + dev fallback แสดง OTP บนจอถ้า Twilio fail
- **AI:** Cloudflare Workers AI binding `AI` สำหรับ AI Sales chat
- **Excel:** SheetJS XLSX (CDN — โหลดใน index.html)
- **QR:** html5-qrcode scanner, JsBarcode printer
- **Charts:** chart.js
- **PDF:** jspdf (lazy load)

### URLs
- **Production:** https://boonsukair.com
- **Preview:** https://boonsook-pos-v5.pages.dev
- **GitHub:** https://github.com/boonsook/boonsook-pos-v5
- **Cloudflare:** Pages project `boonsook-pos`

### Local paths (Windows)
```
Main repo:  C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github
Worktree:   C:\...\boonsook-pos-v5-github\.claude\worktrees\gifted-fermi-fe5141
```

---

## 📁 Repo Layout

```
boonsook-pos-v5-github/
├── index.html                    # Entry page
├── main.js                       # ~2200 lines — app shell, xhr helpers, routing
├── ai-chat-widget.js             # AI chat widget
├── sw.js                         # Service Worker (cache v12 — ต้อง bump เวอร์ชัน)
├── style.css, phase4-*.css       # Styles
├── supabase-config.js            # Supabase URL/anon key (public, in-browser)
├── manifest.json                 # PWA manifest
├── offline.html                  # Offline fallback
├── supabase-rls-policies.sql     # ★ SQL setup script (copy-paste to SQL Editor)
│
├── modules/                      # ~38 feature modules (ESM)
│   ├── doc-utils.js              # ★ Shared print CSS + bahtText helper
│   ├── pos.js                    # POS checkout flow
│   ├── ai_sales.js               # AI recommender + order form
│   ├── customer_dashboard.js     # Customer-facing ordering
│   ├── sales.js / products.js / customers.js
│   ├── service_jobs.js / service_request.js
│   ├── staff.js / auth.js
│   ├── dashboard.js / expenses.js / loyalty.js
│   ├── quotations.js / delivery_invoices.js / receipts.js   # เอกสาร 3 ตัว
│   ├── ac_shop.js / ac_install.js / solar.js / btu_calculator.js
│   ├── line_notify.js / thermal_printer.js / payment_gateway.js
│   ├── error_codes.js / stock_movements.js
│   └── settings/                 # Sub-pages ของตั้งค่า
│       ├── ac-catalog.js         # จัดการแคตตาล็อกแอร์ (Excel import/export)
│       ├── payment.js / pages.js / store.js / users.js
│       └── menu.js / index.js / utils.js / permissions.js / settings.js
│
├── functions/api/                # Cloudflare Pages Functions
│   ├── send-otp.js               # POST /api/send-otp (Twilio)
│   ├── verify-otp.js             # POST /api/verify-otp (HMAC)
│   ├── line-notify.js            # POST /api/line-notify (LINE push)
│   └── ai-assistant.js           # POST /api/ai-assistant (Workers AI)
│
├── data/                         # Seed data (ac_catalog.json etc.)
├── icons/                        # PWA icons + logo.svg
│
├── .gitattributes                # CRLF/LF rules
├── .gitignore                    # *.new, *.bak, *.bat, .env, commands.txt, .claude/
└── HANDOFF.md                    # ไฟล์นี้
```

**⚠️ ไฟล์ขาด (ถ้าใครถาม):**
- `OVERNIGHT_REPORT.md`, `OVERNIGHT-NOTES.md` — User ลบไปใน commit `6fc4422` (เคยมี)
- `commands.txt`, `commit.bat` — Local helper ของ user (อยู่ใน .gitignore)

---

## 🔐 Environment Variables (Cloudflare Pages → Settings)

### Required
| Variable | Value | Type |
|----------|-------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | (LINE bot token) | **Secret** แนะนำ (เดิมเป็น Plaintext) |
| `LINE_USER_ID` | (default recipient fallback) | Plaintext |
| `LINE_GROUP_QUEUE` | (groupId สำหรับออเดอร์ใหม่) | Plaintext |
| `LINE_GROUP_DONE` | (groupId สำหรับงานเสร็จ) | Plaintext |
| `OTP_SECRET` | สุ่ม 32+ chars | **Secret** (เข้ารหัส) |
| `TWILIO_ACCOUNT_SID` | (Twilio SID) | Plaintext |
| `TWILIO_AUTH_TOKEN` | (Twilio token) | **Secret** แนะนำ |
| `TWILIO_FROM_NUMBER` | +66... | Plaintext |

### AI binding
Pages → Settings → Functions → AI bindings:
- Variable name: `AI`
- Catalog: Workers AI

### Supabase
ใส่ใน `supabase-config.js` (public anon key — ไม่ใช่ secret)

---

## 🧠 Architecture Patterns

### 1. xhr helpers — หลักของทุก HTTP call ไป Supabase
อยู่ใน `main.js` (root):
```js
window._appXhrPost(table, payload, options)   // INSERT
window._appXhrPatch(table, payload, column, value)    // UPDATE
window._appXhrDelete(table, column, value)    // DELETE
window.App.xhrGet(url)                        // SELECT (raw URL)
```
**คืนค่า:** `{ ok: boolean, data?: any, error?: { message: string } }`
**Never throws** — always resolves. Check `result.ok`

**XHR logging (commits `32e8033`, `a02c7e7`):**
- Log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]` + response body 200-300 chars
- ไม่ warn ถ้า response body ว่าง (กรณี `Prefer: return=minimal`)

### 2. Toast notification
```js
window.App?.showToast?.("ข้อความ")    // ใช้ optional chain เสมอ
```
**อย่าใช้** `alert()` / `confirm()` / `prompt()` — ใช้ modal asยนค:
```js
if (await window.App?.confirm?.("ข้อความยืนยัน?")) { ... }
```

### 3. LINE notify — 2 groups routing
```js
ctx.sendLineNotify(message, { state, showToast }, "queue")   // ออเดอร์ใหม่
ctx.sendLineNotify(message, { state, showToast }, "done")    // เสร็จ
ctx.sendLineNotify(message)                                  // default (LINE_USER_ID)
```

### 4. API response shape
ทุก `/api/*` endpoint:
- Success: `{ ok: true, ...data }`
- Error: `{ ok: false, error: "ข้อความไทย" }` (ไม่ leak `err.message` ฝั่ง client)
- Server-side: `console.error("[endpoint-name] server error:", err)` → ดูได้ใน Cloudflare Functions Logs

### 5. Supabase RLS
- RLS เปิดทุกตารางหลัก — ใช้ `supabase-rls-policies.sql` ที่ root repo
- Policy: `FOR ALL TO authenticated USING (true)` — แม้เปิดกว้างแต่ต้อง auth
- Staff login ผ่าน Supabase Auth (email/password)
- Customer login ผ่าน OTP → verify → `authPassword` deterministic (HMAC) → `signInWithPassword`

### 6. `app_settings` table (new — 23 เม.ย.)
Key-value store สำหรับ setting ที่ sync ข้าม device:
- `store_info` — ชื่อร้าน, ที่อยู่, เบอร์, TaxID
- `payment_info` — banks[], promptPay, qrImage

โหลด/บันทึก:
```js
await loadAppSettings();      // ดึงจาก Supabase → merge localStorage
await saveStoreInfo(data);    // localStorage + upsert Supabase
await savePaymentInfo();      // localStorage + upsert Supabase
```

### 7. Service Worker update banner (new — commit `548208b`)
- `sw.js`: ไม่ auto-skipWaiting
- `index.html`: detect `updatefound` → banner "🔄 มีเวอร์ชันใหม่ — คลิกเพื่อใช้งาน"
- Click "อัปเดตเลย" → SKIP_WAITING → controllerchange → reload
- ต้อง bump `CACHE_NAME` ใน sw.js ทุก deploy ที่อยากให้ user เห็น banner

### 8. Document preview pattern (quotations / delivery_invoices / receipts)
3 module นี้มี pattern เดียวกัน:
- List view (table layout แบบ FlowAccount): `_viewMode = "list"`
- Preview view: `_viewMode = "preview", _viewingId = id`
- Status dropdown → PATCH status
- Bulk checkbox + bulk cancel/delete bar
- "อ้างอิง" link cross-navigate (RC → INV → QT)
- Cross-nav: `window._pendingInvoicePreviewId / _pendingQuotationPreviewId`

### 9. Bulk actions
- Checkbox per row (`data-xx-sel="${id}"`)
- Header "select all"
- `_selectedIds = new Set()`
- Bulk bar shown conditionally
- 2 ปุ่ม: "ยกเลิก (เก็บประวัติ)" + "🗑️ ลบถาวร"
- ลบถาวร: cascade restore parent status

---

## ⚠️ Gotchas (เคยเจอจริง)

### 1. Edit tool truncate ไฟล์ที่มี emoji/Thai chars
**อาการ:** Claude's Edit tool เคยตัด EOF ของ `ai_sales.js`, `customer_dashboard.js` (หาย 5-10 บรรทัด)

**วิธีแก้:**
- Small edits: ใช้ Edit tool ปกติ
- Large edits: เขียน Python patch script ใน `outputs/`
- ตรวจเสมอหลังแก้:
  ```bash
  node --check path/to/file.js
  tail -5 path/to/file.js
  ```

### 2. Python f-string backslash ห้าม
```python
f"EOL: {'CRLF' if eol == b'\\r\\n' else 'LF'}"   # ❌ SyntaxError
```
ใช้แทน:
```python
eol_name = "CRLF" if eol == b"\r\n" else "LF"
print("EOL:", eol_name)
```

### 3. Bash heredoc mangles `!`
ใน heredoc `<< 'EOF'` เมื่อเขียน `c != 1` bash อาจแทรก backslash
→ `c \!= 1` → SyntaxError
ใช้ `not c == 1` หรือ `if c == 0 or c > 1:` แทน

### 4. CRLF vs LF per file
- **Root files** (main.js, index.html, ai-chat-widget.js): LF
- **modules/\*.js:** CRLF (ส่วนใหญ่)
- **functions/api/\*.js:** CRLF (ยกเว้น ai-assistant.js = LF)
- **อย่าบังคับเปลี่ยน** — `.gitattributes` จัดการให้แล้ว

### 5. Deploy ผ่าน GitHub Actions (ไม่ใช่ Cloudflare GitHub integration!)

**สำคัญ:** Repo นี้ **ไม่ใช้** Cloudflare Pages Git integration —
ใช้ `.github/workflows/main.yml` ที่ run `wrangler pages deploy` upload โดยตรงแทน

**Workflow มี 2 jobs:**
1. `deploy` — wrangler upload ไป Cloudflare Pages (~30-60s)
2. `docker` — build + test Docker image (~2-3 min) — needs deploy

**เวลาเห็น "deploy ไม่ขึ้น":**
1. ไป **GitHub → Actions tab** ดู workflow runs
2. ถ้า `deploy` job ✓ green = Cloudflare ได้ของใหม่แล้ว → refresh dashboard
3. ถ้า `deploy` job ❌ fail = ดู logs (Cloudflare token หมดอายุ? quota เกิน?)
4. `docker` job fail ไม่กระทบ deployment — แค่ workflow status overall = fail

**ถ้า deploy job ไม่ trigger เลย (rare):**
```bash
git commit --allow-empty -m "chore: trigger workflow"
git push origin main
```

**อย่า** คลิก "Save and deploy" ใน Cloudflare upload mode — จะ disconnect ทุกอย่าง

### 6. Windows bash cd ไม่ข้าม worktree
```bash
cd "C:/path/to/repo" && command...  # อาจไม่ทำงานจาก worktree
```
ใช้:
```bash
cd "/c/Users/.../boonsook-pos-v5-github" && command...
```
หรือแก้ใน worktree แล้ว merge ที่ main repo

### 7. Supabase REST DELETE with `return=minimal` returns 204 even if RLS blocked
**ต้องใช้** `Prefer: return=representation` + check `deleted.length > 0`
ดูตัวอย่างใน `modules/receipts.js` `rcDeleteBtn` handler

### 8. Button stuck pattern
ทุก async handler ที่ disable button ต้องมี `finally` block reset:
```js
try { ... } catch(e) { ... } finally {
  if (btn.isConnected) { btn.disabled = false; btn.textContent = origText; }
}
```

### 9. Double-click race condition
ปุ่ม save/submit ต้องมี guard:
```js
if (btn.disabled) return; // กัน double-click
btn.disabled = true;
```

---

## 📊 Supabase Schema (ตารางหลัก)

ตารางที่ code เรียกถึง (จาก xhrPost/xhrPatch):
- `products`, `warehouse_stock`
- `customers`, `staff`, `staff_permissions`, `profiles`
- `sales`, `sale_items`
- `quotations`, `quotation_items`
- `delivery_invoices`, `delivery_invoice_items`
- `receipts`, `receipt_items`
- `service_jobs` (ทุกประเภทงาน — job_type: pos, ac, solar, ai_sales, other)
- `expenses`, `stock_movements`, `loyalty_points`
- `line_notify_settings`
- `app_settings` (new — key/value/updated_at)
- `warehouses`

**RLS ทุกตาราง:** run `supabase-rls-policies.sql` ที่ SQL Editor

---

## 📝 ประวัติการแก้ใน session นี้ (22-23 เม.ย. 2026)

### Critical / Security
- `52e0ac2` — fix(security): remove OTP_SECRET hardcoded fallback (CRITICAL)
- `b4f5b68` — fix(docs): verify DELETE returns rows (กัน RLS silent fail)
- `dafb4bc` — XSS escape + confirm() migration + silent catch logging + console.log cleanup
- `52e2cbc` — ป้องกัน double-click (service_request, ac_install, solar, expenses)
- `5139d31` — stuck-button fix (staff, products)
- `17f74dd` — customer checkout validation + finally
- `aff48d8` — sales/service_jobs/receipts delete stuck + safety timeout
- `d5971e8` — POS checkout stuck fix
- `b258d82` — ป้องกันสร้างเอกสารซ้อน (qt→inv, inv→rc)

### UX — FlowAccount-style redesign
- `2ecf56b` — list → table layout (ใบเสร็จ/ใบส่งสินค้า/ใบเสนอราคา)
- `7688468` — ต้นฉบับ/สำเนา pill badge + ระบุผู้ใช้
- `a5f2ff1` — จำนวนเงินเป็นสีดำ (ไม่ใช่สีธีม)
- `81afc13` — เอาคอลัมน์ # ออก + baht text + signature compact
- `5922944` — เอา page badge (1/2) มุมขวาบนออก
- `9d0291c` — tabs + status dropdown + bulk select + วันครบกำหนด
- `44efd65` — "อ้างอิง: INV/QT" คลิกเปิดเอกสารต้นทาง
- `07e688d` — bulk "ลบถาวร" hard delete + cascade
- `69fbe2c` — คลิกเลขที่เอกสารเปิด preview ได้เลย

### Features ใหม่
- `b32d86c` — แก้วันที่เอกสารใน preview + cascading lock
- `64b0da4` — receipt: payment method picker → ✓ ในช่อง checkbox
- `548208b` — SW update banner + empty states
- `9c4a625` — AI chat เพิ่มหมวด "🆕 แอร์ใหม่พร้อมติดตั้ง"
- `9e92511` — product category autocomplete (datalist)
- `090d85a` — product category chip filter
- `c1443f9` — product save validation + auto-gen SKU
- `998825e` — barcode print 50×30mm label printer
- `046003c` — ค่าไฟคำนวณถูกต้อง (inverter EER + duty cycle)
- `2bc0fd4` — ac-catalog: Excel import/export + bulk stock 5
- `f991030` — savePaymentInfo + loadAppSettings sync Supabase

### Infrastructure
- `6973165` — supabase-rls-policies.sql (SQL script)
- `75791d1` — silence false-positive warnings
- `a02c7e7` — xhr ไม่ warn ถ้า body ว่าง
- `64c4a1e` — ignore .claude/ worktrees
- `410e000` — copy label pill
- `6cc9377` — amount color black

---

## 🛣️ TODO — งานที่เหลือ (พิจารณาก่อนทำ)

### ยังไม่ได้แก้ (เสี่ยง — ต้องวางแผน)

#### Server-side security (functions/api/*)
- 🔴 **Rate limiting** — OTP/LINE API spam ได้ (costs escalation risk)
- 🟡 **CORS กว้างเกิน** (`Allow-Origin: *`) — CSRF risk
- 🟡 **/api/ai-assistant ไม่มี auth** — ใครก็เรียก Workers AI ได้

#### Accessibility (scope ใหญ่)
- `<div onclick>` → `<button>`
- Focus outline
- Alt text บนรูป
- ARIA labels

#### Performance
- Pagination สำหรับ list > 500 items
- Dashboard RPC — ย้าย aggregation ไป Supabase server-side
- Lazy load modules

#### Minor
- Input length limits (description, address) — กัน DB truncate
- Offline queue + retry สำหรับ checkout / LINE notify

### Cleanup ที่ทำไปแล้วครบ
- ✅ XSS (16 จุด)
- ✅ confirm() migration (30 จุด → 0)
- ✅ Silent catch critical logging (10 จุด)
- ✅ Production console.log (6 จุด)

---

## 🧪 Test Accounts

### Staff (Admin)
- ถาม gangboo — ใช้ Supabase Auth dashboard

### Customer (OTP)
- ใช้เบอร์จริง → Twilio ส่ง SMS
- **Dev fallback:** ถ้า Twilio trial limit → endpoint return `devCode` ใน response → แสดงในจอ + console

---

## 🧭 Cheat Sheet

### Deploy flow
```bash
# Claude session ทำใน worktree
cd "/c/Users/Lenovo E14 Gen4/Documents/boonsuk v5/boonsook-pos-v5-github/.claude/worktrees/gifted-fermi-fe5141"
# edit → commit
git add <files>
git commit -m "feat/fix(module): ..."

# Merge ไปที่ main repo + push
cd "/c/Users/Lenovo E14 Gen4/Documents/boonsuk v5/boonsook-pos-v5-github"
git merge claude/gifted-fermi-fe5141 --no-edit
git push origin main

# Cloudflare auto-deploy 1-2 นาที
```

### Trigger Cloudflare stuck webhook
```bash
git commit --allow-empty -m "chore: trigger cloudflare pages deploy"
git push origin main
```

### Syntax check ไฟล์
```bash
node --check modules/pos.js
```

### Hard refresh (clear SW cache)
Ctrl + Shift + R ใน browser

### ดู Cloudflare Functions Logs
Dashboard → Pages → boonsook-pos → Functions → Realtime Logs

### Supabase SQL Editor
Dashboard → SQL Editor → paste `supabase-rls-policies.sql` → Run

### Rollback commit ล่าสุด (ยังไม่ push)
```bash
git reset --hard HEAD~1
```

---

## 📋 หน้าทั้งหมดในแอป

### Staff side (dashboard route — auth required)
- `dashboard` — สรุปยอดขาย, กราฟ, KPIs
- `pos` — ขายหน้าร้าน (checkout, QR, attach slip)
- `products` — สินค้า (CRUD + barcode print + category chip filter)
- `sales` — ประวัติการขาย
- `customers` — ลูกค้า + loyalty
- `service_jobs` — งานซ่อม/ติดตั้ง/ออเดอร์ใหม่
- `service_request` — ฟอร์มรับแจ้ง
- `ai_sales` — AI ช่วยแนะนำสินค้า + รับออเดอร์
- `ac_shop`, `ac_install`, `solar`, `btu_calculator` — เฉพาะธุรกิจ
- `quotations`, `delivery_invoices`, `receipts` — เอกสาร 3 ตัว
- `expenses`, `profit_report` — การเงิน
- `calendar`, `stock_movements`, `loyalty` — อื่นๆ
- `staff`, `settings`, `line_notify`, `payment_gateway`, `permission_matrix` — ตั้งค่า
- `error_codes` — คู่มือรหัสข้อผิดพลาดแอร์

### Customer side
- `customer_dashboard` — OTP login → browse → cart → checkout
- `ai-chat-widget` — Chat bot overlay (3 หมวด: งานแอร์/โซลา/แอร์ใหม่)

---

## 🎯 บริบทล่าสุด (23 เม.ย.)

**สิ่งที่เพิ่งทำ:**
1. Sync paymentInfo ข้าม device (+ Supabase app_settings table)
2. AC catalog รองรับ Excel (.xlsx) + ตั้งสต็อก 5 ทุกรุ่น
3. ค่าไฟ AC คำนวณถูกต้อง (เดิม 2,631 → ตอนนี้ ~487 บาท/เดือน สำหรับ 9000 BTU)
4. Barcode print 50×30mm label printer

**รอ user ทดสอบ:**
- Cross-device sync บัญชีธนาคาร
- หน้าผู้ใช้ (profiles) หลังรัน SQL ใหม่
- AC catalog Excel workflow

**ถ้า user เจอปัญหา:**
- ขอ screenshot + console log (F12)
- มองหา log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]`, `[savePaymentInfo]`, `[loadAppSettings]`

---

## 📞 Next session checklist

เมื่อ Claude session ใหม่เริ่ม:
1. **อ่าน HANDOFF.md นี้ก่อน** (คุณกำลังอ่านอยู่)
2. `git log --oneline -20` — ดู commits ล่าสุด
3. `git status` — ดู unstaged/uncommitted
4. ตรวจว่า worktree branch sync กับ main มั้ย
5. ถาม user ว่าอยากทำอะไรต่อ อย่าเดา

### Do's
- ใช้ Python script ใน `outputs/` สำหรับ patch ไฟล์ใหญ่ (เลี่ยง Edit tool truncate)
- `node --check` ทุกครั้งหลังแก้ JS
- Preserve CRLF/LF ของไฟล์เดิม
- Commit message conventional: `fix(module)`, `feat(module)`, `refactor(ux)`, `style(docs)`, `chore`
- **Push ได้เองแล้ว** (user อนุญาตแล้วใน session นี้)
- Safety net ในทุก async handler: `try { ... } catch { ... } finally { if (btn.isConnected) reset }`

### Don'ts
- ❌ `alert()`, `confirm()`, `prompt()` — ใช้ showToast, App.confirm
- ❌ Leak `err.message` ฝั่ง client ที่ API endpoints
- ❌ Bulk rewrite ไฟล์ใหญ่ด้วย Write tool — ใช้ Edit/Python
- ❌ Create `.bak`, `.new`, `.old` files — ใช้ git history
- ❌ Force push, reset --hard remote, skip hooks
- ❌ คลิก "Save and deploy" ใน Cloudflare upload mode
- ❌ `innerHTML = user_input` — escape ด้วย escHtml/escapeHtml

---

## 🗂️ รายงานอื่นๆ

- **`supabase-rls-policies.sql`** (root) — script SQL setup RLS + create app_settings
- **`.claude/plans/`** — Plan files ของ Claude (ถ้ามี)
- **User's local** — `commands.txt`, `commit.bat` (ignored — ไม่อยู่ใน git)

---

**ขอบคุณที่อ่านถึงตรงนี้ — ช่วย gangboo ดูแลแอปต่อเลยครับ** 🙏

_อัปเดต: Claude (Opus 4.7) — session 22-23 เม.ย. 2026_
_Total commits this session: 30+_
# 2026-05-29 Correction - Phase 92.46b Not Fully Closed

Phase 92.46b accounting auto-journal should not be treated as fully closed yet.

Latest state:

- DB direct SQL Editor simulation as sales/authenticated can insert `journal_entries` successfully.
- `npm run verify:accounting` still fails A2 with REST JE HTTP 403.
- A2b orphan count still drifts, so production REST path is not verified.

Next owner should restart Supabase API/PostgREST, wait 1-2 minutes, then rerun `npm run verify:accounting`.

If A2 still returns 403 after restart, investigate REST project/JWT/env mismatch before changing DB policy again.
# 2026-05-29 Correction - Phase 92.46 Is Not Fully Closed

Build 315 / v5.64.0 remains the latest known live app. No UI/client change is required for this correction.

Important correction:
- Phase 92.46/92.46b should remain OPEN for accounting REST smoke.
- Direct DB sales/authenticated insert into `public.journal_entries` passes.
- REST/PostgREST smoke still fails: `npm run verify:accounting` A2 returns HTTP 403 / code `42501`.
- A2b still fails because the smoke-created sale becomes an orphan when journal creation is blocked.

Handoff instruction:
- Next operator should restart Supabase API/PostgREST, wait 1-2 minutes, then run `npm run verify:accounting`.
- If A2/A2b pass after restart, complete final orphan backfill and update `INCIDENT_NOTES.md`.
- If A2/A2b still fail, treat this as REST/runtime mismatch, not a generic SQL policy rewrite. Verify `.env` Supabase URL, anon key, JWT freshness, and payload parity with the direct DB insert test.

Do not mark accounting root cause closed until A1-A6 all pass.

# 2026-06-01 - CLOSED - Phase 92.46c JE REST RLS fixed and verified

Accounting auto-journal REST path is now CLOSED. A1-A6 all pass. Full detail in `INCIDENT_NOTES.md` (2026-06-01 entry).

Root cause (empirical, via `scripts/diag_je_rest.js`): the INSERT always worked (non-admin `return=minimal` = 201). The 403 came from the **SELECT-back** that `return=representation`/`headers-only` triggers — `je_select` was admin-only, so non-admin could not read its own just-inserted row, and the same policy blocked `jl_insert_auto`'s `EXISTS` subquery for lines.

Fix: `supabase-phase92-46c-je-rls-final.sql` (applied in Supabase SQL Editor 2026-06-01) adds PERMISSIVE `je_select_auto` for `authenticated`, scoped to auto-post sources (sales/expenses/service_jobs/receipts/delivery_invoices/credit_payments/refunds), `staff_payroll` excluded, line detail still admin-only. Additive — does not touch `auto_post.js`, insert whitelist, or period-close. Includes `NOTIFY pgrst, 'reload schema'`.

Verified 2026-06-01:
- `node scripts/diag_je_rest.js`: non-admin representation + headers-only now 201 (was 403).
- `npm run verify:accounting`: ALL PASS, A2=201, A2b 85->85 no drift, A3/A4 still 403.
- `npm run verify:je`: entry+lines 201/201, exit 0.

Backfill NOT run — dry-run + `auto_post.js` confirm 0 actionable rows. Remaining orphans (`sales_without_journal=85`, `expenses=1`, `payroll=0`) are all intentional skips: pre-effective April test data (`< 2026-05-01`) and one zero-amount May sale. Real May orphans were backfilled in a prior session. Live backfill would be a no-op.

No client/UI change. APP_BUILD stays 315 / v5.64.0.
# Phase 536 handoff

**build 536 (Phase 536 / S2+S3 - error_log hardening):** Baseline main `5edc416` (build 535). Fixes `/api/log-error` trusting client `body.user_id` by deriving `user_id` from Authorization JWT `sub` only after UUID validation. Adds owner-run SQL `supabase-phase536-error-log-hardening.sql`: insert policy `user_id IS NULL OR user_id = auth.uid()`, admin-only select via `public.is_admin()`, grouped view `security_invoker=true`, and PostgREST schema reload. Not touched: LINE, parse/verify sanitizer, POS/stock/accounting flows. Verify with `node --test tests/error_log_hardening_guard.test.js`, full unit/lint/e2e. Owner must run SQL before merge/live smoke.
