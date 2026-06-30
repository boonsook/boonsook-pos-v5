> ⚠️ **ARCHIVED / historical** — เก็บเป็นบันทึกประวัติเท่านั้น. สถานะปัจจุบันดู
> HANDOFF.md / CHANGELOG.md / IMPLEMENT_TEAM_PROTOCOL.md. อย่าใช้เป็น current status.
> (N3 audit 2026-06-25)

# Race Condition Audit Report — Phase 89.40

> Generated: 2026-05-17
> Branch: `claude/phase-89-40-race-condition-audit`
> Source: 138 `require-atomic-updates` warnings on `main` (after PR #20 merge, build 241)
> Auditor: Claude Code Opus 4.7 — analysis only, no source changes

## Executive Summary

| Bucket | Count | % | Recommended Phase |
|--------|------:|--:|-------------------|
| **HIGH_RISK** — real race + critical (payment/auth state) | 6 | 4.3% | 89.41 |
| **MEDIUM_RISK** — real race + non-critical financial | 6 | 4.3% | 89.42 |
| **LOW_RISK** — theoretical race, practical impact ต่ำ | 43 | 31.2% | 89.43+ ทยอย |
| **FALSE_POSITIVE** — ESLint conservative, ไม่มี race จริง | 83 | 60.1% | 89.44 silence batch |
| **Total** | 138 | 100% | |

**Key findings:**
- **60% เป็น false positive** — UI feedback (`btn.disabled`, `el.innerHTML`), local vars, guarded-with-entry-lock patterns. ปลอดภัยที่ silence เป็น batch เดียว
- **HIGH_RISK ส่วนใหญ่อยู่ที่ checkout cart-reset paths** (main.js + customer_dashboard.js) — concurrent double-click checkout เสี่ยงทำให้ cart state สับสน
- **Token refresh path (main.js:173) เป็น FALSE_POSITIVE** — มี single-flight pattern (`_refreshInflight`) ป้องกันอยู่แล้ว (Phase 89.13)
- **loadAllData state assignments (16 warnings)** — ทั้งหมด FALSE_POSITIVE เพราะมี `_isLoading` entry guard ที่ main.js:1442

## Top 10 Priority Fixes (HIGH_RISK)

| # | File:Line | Variable | Pattern | Why HIGH | Suggested fix |
|---|-----------|----------|---------|----------|---------------|
| 1 | main.js:3696 | `state.cart` | `cart=[]` after async checkout | Double-click checkout → second handler sees stale cart | Add `_checkoutInflight` guard ที่จุดเข้า checkout |
| 2 | modules/customer_dashboard.js:1104 | `_custCart` | `_custCart=[]` after async checkout | Customer-facing payment — ลูกค้ากด "สั่งซื้อ" 2 ครั้ง → 2 orders | Disable submit btn + early-return guard |
| 3 | modules/customer_dashboard.js:1106 col 7 | `_custSlipData` | Slip state reset after checkout | Slip state อาจถูก reset ระหว่าง 2nd handler ใช้งาน | รวมเป็น single reset call หลัง atomic guard |
| 4 | modules/customer_dashboard.js:1106 col 29 | `_custSlipVerified` | (same line, 4 vars on one statement) | (เหมือนข้อ 3) | (รวมแก้ในข้อ 3) |
| 5 | modules/customer_dashboard.js:1106 col 56 | `_custSlipResult` | (same line) | (เหมือนข้อ 3) | (รวมแก้ในข้อ 3) |
| 6 | modules/customer_dashboard.js:1106 col 80 | `_custSlipUrl` | (same line) | (เหมือนข้อ 3) | (รวมแก้ในข้อ 3) |

> หมายเหตุ: ทั้ง 6 HIGH_RISK อยู่ใน 2 จุดจริง (main.js checkout + customer_dashboard checkout) — fix แล้ว reduce warnings 6 ตัวพร้อมกัน

## Full Breakdown by File

> Format: `Line:Col | Variable | Bucket | Reason | Suggested action`

### main.js (38 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 173 | `_sbAccessToken` (token refresh) | FALSE | Inside `_refreshInflight` single-flight (Phase 89.13) — มี guard `if (_refreshInflight) return _refreshInflight` | Silence + comment "single-flight protected" |
| 1291 | `state.currentUser` | LOW | Init-time `getSession()` — runs ครั้งเดียวที่ boot | Silence acceptable, low priority |
| 1292 | `_sbAccessToken` | LOW | (same init path) | Silence acceptable |
| 1353 | `state.currentUser=null` (logout) | LOW | Logout sequential หลัง signOut() | Silence acceptable |
| 1354 | `state.profile=null` | LOW | (same logout path) | Silence acceptable |
| 1355 | `state.cart=[]` (logout) | LOW | (same logout path) | Silence acceptable |
| 1383 | `state.profile` (loadProfile) | LOW | Single profile load, called จาก afterLogin (awaited) | Silence acceptable |
| 1470-1478 | `state.products/sales/customers/...` | FALSE | ใน loadAllData — guarded by `_isLoading` lock (line 1442) | Silence batch + comment |
| 1490 | `state.warehouses=inserted` (auto-seed) | FALSE | (same `_isLoading` guard) | Silence batch |
| 1508-1513 | `state.expenses/stockMovements/...` | FALSE | (same `_isLoading` guard) | Silence batch |
| 1557 | `_isLoading=false` (finally) | FALSE | The guard itself — set false in finally is correct pattern | Silence + comment "lock release" |
| 1799 | `videoEl.innerHTML=""` | LOW | Scanner UI clear — single user, single scanner | Silence acceptable |
| 1803 | `videoEl.innerHTML='<div>...'` | LOW | (same scanner path) | Silence acceptable |
| 2013 | `productId=res.data?.id` | FALSE | Local `let` reassign in product save — sequential | Silence + comment "local var" |
| 2264 | `input.value=""` | FALSE | Input reset after note save — UI single instance | Silence + comment "UI reset" |
| 2701 | `job.share_token=token` | LOW | Share token assign after PATCH — single share button | Silence acceptable |
| 2722 | `job.share_token=null` | LOW | (revoke share — same single button) | Silence acceptable |
| 3186 | `ws.stock=after` | FALSE | Local cache sync หลัง atomic CAS (Phase 89.9 H10) — server เป็น source of truth | Silence + comment "CAS-protected cache" |
| 3221 | `product.stock=newStock` | FALSE | (same CAS pattern) | Silence + comment "CAS-protected cache" |
| **3696** | **`state.cart=[]` (checkout)** | **HIGH** | **Concurrent double-click checkout → cart state race** | **Add `_checkoutInflight` guard** |
| 3772 | `state.lastReceipt={...}` | LOW | loadReceipt called sequentially หลัง checkout — awaited | Silence acceptable |
| 3932 | `state.allProfiles=result.data` | LOW | Admin loadUsers — sequential | Silence acceptable |
| 4380 | `e.target.value=""` | FALSE | File input reset หลัง upload — UI single instance | Silence + comment |
| 4440 | `e.target.value=""` | FALSE | (same service photo upload) | Silence + comment |
| 4444 | `e.target.value=""` | FALSE | (same — gallery variant) | Silence + comment |

**main.js subtotal:** 1 HIGH / 12 LOW / 25 FALSE = **38**

### modules/customer_dashboard.js (9 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 681 | `btn.disabled=true` | FALSE | "ยืนยันปิดงาน" button — disabled set BEFORE try block | Silence + comment |
| 682 | `btn.textContent="กำลังยืนยัน..."` | FALSE | (same UI feedback) | Silence + comment |
| 700 | `btn.disabled=false` (error) | FALSE | Re-enable in error path — sequential rollback | Silence + comment |
| 701 | `btn.textContent="✓ ยืนยันปิดงาน"` | FALSE | (same error rollback) | Silence + comment |
| **1104** | **`_custCart=[]`** | **HIGH** | **Cart reset after async checkout — customer payment path** | **Add submit-btn disable + `_checkoutInflight` guard** |
| **1106 col 7** | **`_custSlipData=null`** | **HIGH** | **Slip state reset — concurrent checkout could leak prev slip** | **(combine with 1104 fix)** |
| **1106 col 29** | **`_custSlipVerified=false`** | **HIGH** | (same statement, 4 vars on one line) | (combine) |
| **1106 col 56** | **`_custSlipResult=null`** | **HIGH** | (same) | (combine) |
| **1106 col 80** | **`_custSlipUrl=null`** | **HIGH** | (same) | (combine) |

**customer_dashboard.js subtotal:** 5 HIGH / 0 LOW / 4 FALSE = **9**

### modules/ac_install.js (8 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 244 | `slipResult.innerHTML="🤖 AI กำลังตรวจ..."` | LOW | `slipVerifyBtn` ไม่ disable on click → user double-click → 2 verify ทับกัน (last-wins UI) | Add btn.disabled guard |
| 249 | `slipResult.innerHTML=<verdict>` | LOW | (same _verifyAcSlip flow) | (same fix) |
| 262 | `slipResult.innerHTML=<error>` | LOW | (same _verifyAcSlip flow) | (same fix) |
| 456 | `statusEl.textContent="🚐 รอ user..."` | FALSE | Inside save handler — saveBtn disabled at entry (line 627 finally re-enables) | Silence + comment "saveBtn guarded" |
| 466 | `statusEl.textContent="💾 กำลังบันทึก..."` | FALSE | (same save flow, btn-guarded) | Silence + comment |
| 532 | `statusEl.textContent="🔄 กำลังโอน..."` | FALSE | (same) | Silence + comment |
| 604 | `statusEl.innerHTML="✅ บันทึก..."` | FALSE | (same) | Silence + comment |
| 625 | `statusEl.textContent="เกิดข้อผิดพลาด..."` | FALSE | (same — catch path) | Silence + comment |

**ac_install.js subtotal:** 0 HIGH / 3 LOW / 5 FALSE = **8**

### modules/receipts.js (8 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 848 | `r.created_at=isoDate` | LOW | After PATCH date edit — single admin user, single drawer | Silence acceptable |
| 856 | `ev.target.value=(r.created_at||"").slice(0,10)` | FALSE | Rollback on error — sequential | Silence + comment "error rollback" |
| 868 | `r.payment_method=newMethod` | LOW | After PATCH pay-method edit — single admin | Silence acceptable |
| 876 | `r.payment_method=prevMethod` | LOW | Rollback on error — sequential | Silence acceptable |
| **1162** | **`r.payments=payments`** | **MEDIUM** | **Multi-payment save (Phase 69) — financial state; concurrent save = lost update** | **Add saveBtn-disable guard at entry (currently only sets in catch)** |
| **1163** | **`r.payment_method=main.method`** | **MEDIUM** | (same multi-pay save) | (combine fix) |
| 1170 | `saveBtn.disabled=false` (catch) | FALSE | UI rollback in error path | Silence + comment |
| 1171 | `saveBtn.textContent=orig` (catch) | FALSE | (same) | Silence + comment |

**receipts.js subtotal:** 0 HIGH / 2 MED / 3 LOW / 3 FALSE = **8**

### modules/quotations.js (7 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 804 col 23 | `_editingId=null` (after save) | LOW | Module state reset — single edit session | Silence acceptable |
| 804 col 42 | `_lineItems=[]` (after save) | LOW | (same reset) | Silence acceptable |
| 1014 | `q.created_at=isoDate` | LOW | PATCH date edit — single user | Silence acceptable |
| 1020 | `ev.target.value=...` (rollback) | FALSE | Error rollback — sequential | Silence + comment |
| 1139 | `_lineItems=((await resp.json())||[]).map(...)` | LOW | Load items inside invoice gen — single flow | Silence acceptable |
| 1145 | `_lineItems=[]` (catch) | LOW | (same load — catch path) | Silence acceptable |
| 1238 | `q.share_token=shareToken` | LOW | Share button assign — single click | Silence acceptable |

**quotations.js subtotal:** 0 HIGH / 6 LOW / 1 FALSE = **7**

### modules/accounting/periods.js (5 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 66 | `_summaryCache[cacheKey]=summary` | FALSE | Cache populate — idempotent (concurrent fetch = same data overwrites) | Silence + comment "idempotent cache" |
| 297 | `btn.disabled=...` | FALSE | UI feedback in period lock action | Silence + comment |
| 298 | `btn.textContent=...` | FALSE | (same) | Silence + comment |
| 321 | `btn.disabled=...` | FALSE | UI feedback in period unlock action | Silence + comment |
| 322 | `btn.textContent=...` | FALSE | (same) | Silence + comment |

**periods.js subtotal:** 0 HIGH / 5 FALSE = **5**

### modules/auth.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 321 | `pin=''` (success then clear) | LOW | Inside verifyPin scope — sequential after wrong PIN | Silence acceptable |
| 326 | `pin=''` (catch) | LOW | (same — error path) | Silence acceptable |
| 329 | `_verifying=false` (finally) | FALSE | Entry guard at line 346 `if (_verifying) return` — correct lock pattern | Silence + comment "lock release" |
| 371 | `window.__authLogout=async()=>{}` | FALSE | Init code — runs once in initAuth() | Silence + comment "init-time assign" |

**auth.js subtotal:** 0 HIGH / 2 LOW / 2 FALSE = **4**

### modules/delivery_invoices.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 636 | `inv.created_at=isoDate` | LOW | PATCH date edit (same pattern as receipts/quotations) | Silence acceptable |
| 642 | `ev.target.value=...` | FALSE | Error rollback | Silence + comment |
| 715 | `_lineItems=...` | LOW | Load items in invoice flow | Silence acceptable |
| 721 | `_lineItems=[]` (catch) | LOW | Catch path | Silence acceptable |

**delivery_invoices.js subtotal:** 0 HIGH / 3 LOW / 1 FALSE = **4**

### modules/line_notify.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 238 | `testButton.disabled=false` | FALSE | UI re-enable after test send | Silence + comment |
| 239 | `testButton.textContent=orig` | FALSE | (same) | Silence + comment |
| 292 | `saveButton.disabled=false` | FALSE | UI re-enable after save | Silence + comment |
| 293 | `saveButton.textContent=orig` | FALSE | (same) | Silence + comment |

**line_notify.js subtotal:** 0 HIGH / 4 FALSE = **4**

### modules/pos.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 728 | `file=compressed` (image compress) | FALSE | Local var reassign in upload flow | Silence + comment "local var" |
| **1194** | **`quickPayAmount=...`** | **MEDIUM** | **POS quick-pay state — concurrent edit during checkout = wrong amount** | **Audit caller; add guard if 2 paths write** |
| **1196** | **`_posCustomer=...`** | **MEDIUM** | **POS active customer — race between customer-select and checkout** | **Add guard at customer-select handler** |
| 1327 | `scanArea.innerHTML=...` | LOW | Scanner UI clear | Silence acceptable |

**pos.js subtotal:** 0 HIGH / 2 MED / 1 LOW / 1 FALSE = **4**

### modules/serials.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 42 | `container.innerHTML=skeleton` | FALSE | Render UI skeleton before load | Silence + comment "UI render" |
| 53 | `container.innerHTML=<list>` | FALSE | Render result | Silence + comment |
| 69 | `container.innerHTML=<empty>` | FALSE | Render empty state | Silence + comment |
| 434 | `detected=scanned` | LOW | Scanner detect var — single scanner instance | Silence acceptable |

**serials.js subtotal:** 0 HIGH / 1 LOW / 3 FALSE = **4**

### modules/service_form.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 235 | `slipVerifyResult.innerHTML=loading` | FALSE | Inside verify handler — single slip verify per click | Silence + comment |
| 243 | `slipVerifyResult.innerHTML=<verdict>` | FALSE | (same) | Silence + comment |
| 259 | `slipVerifyResult.innerHTML=<err>` | FALSE | (same — error path) | Silence + comment |
| 589 | `st.lastSavedJob={...}` | LOW | Save state — single save button | Silence acceptable |

**service_form.js subtotal:** 0 HIGH / 1 LOW / 3 FALSE = **4**

### modules/solar.js (4 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 515 | `slipResult.innerHTML=loading` | FALSE | Solar slip verify UI (same pattern as ac_install verify) | Silence + comment |
| 520 | `slipResult.innerHTML=<verdict>` | FALSE | (same) | Silence + comment |
| 532 | `slipResult.innerHTML=<err>` | FALSE | (same) | Silence + comment |
| 797 | `_solItems=[]` (after save) | LOW | Module state reset after save | Silence acceptable |

**solar.js subtotal:** 0 HIGH / 1 LOW / 3 FALSE = **4**

### modules/accounting/backfill.js (3 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 255 | `_running=true` | FALSE | No explicit `if (_running) return` guard but admin-only + idempotent (JV unique by source_id) | Silence + comment "admin idempotent" |
| 281 | `_running=false` (early exit) | FALSE | (same) | Silence + comment |
| 358 | `_running=false` (finally) | FALSE | (same) | Silence + comment |

**backfill.js subtotal:** 0 HIGH / 3 FALSE = **3**

### modules/expenses.js (3 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 431 | `file=compressed` | FALSE | Local var in image compress | Silence + comment "local var" |
| 560 | `_editingExpenseId=null` (after save) | LOW | Module state reset | Silence acceptable |
| 561 | `_pendingExpProofUrl=null` (after save) | LOW | (same reset) | Silence acceptable |

**expenses.js subtotal:** 0 HIGH / 2 LOW / 1 FALSE = **3**

### modules/settings/pages.js (3 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 230 | `e.target.value=...` | FALSE | Settings input reset | Silence + comment |
| 248 | `e.target.value=...` | FALSE | (same) | Silence + comment |
| 450 | `fileInput.value=...` | FALSE | (same) | Silence + comment |

**settings/pages.js subtotal:** 0 HIGH / 3 FALSE = **3**

### modules/accounting/auto_post.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 68 | `_coaCache=new Set(...)` | FALSE | COA codes cache — idempotent (every JV post would fetch same set) | Silence + comment "idempotent cache" |
| 147 | `_mappingCache=arr` | FALSE | (same — account mapping cache) | Silence + comment "idempotent cache" |

**auto_post.js subtotal:** 0 HIGH / 2 FALSE = **2**

### modules/accounting/journal_form.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 51 | `_coa=...` (load) | FALSE | COA load on form open — idempotent | Silence + comment |
| 303 | `_lines=[]` (after save) | LOW | Form reset — single user | Silence acceptable |

**journal_form.js subtotal:** 0 HIGH / 1 LOW / 1 FALSE = **2**

### modules/auth_otp.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| **158** | **`_pendingOtp.authPassword=verifyData.authPassword`** | **MEDIUM** | **OTP auth flow — concurrent verify (rare but auth-critical)** | **Add `_verifyInflight` guard** |
| **219** | **`_pendingOtp=null`** | **MEDIUM** | **(same flow — cleanup after success)** | **(same fix)** |

**auth_otp.js subtotal:** 0 HIGH / 2 MED = **2**

### modules/bt_printer.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 44 | `_device=await navigator.bluetooth.requestDevice(...)` | LOW | Module singleton — concurrent pair button click rare | Silence acceptable |
| 70 | `_writeChar=chars.find(...)` | LOW | (same connect flow) | Silence acceptable |

**bt_printer.js subtotal:** 0 HIGH / 2 LOW = **2**

### modules/sales.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 149 | `btn.disabled=false` (catch) | FALSE | UI rollback in error | Silence + comment |
| 150 | `btn.textContent=...` (catch) | FALSE | (same) | Silence + comment |

**sales.js subtotal:** 0 HIGH / 2 FALSE = **2**

### modules/service_jobs.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 286 | `btn.disabled=false` (catch) | FALSE | UI rollback | Silence + comment |
| 287 | `btn.textContent=...` (catch) | FALSE | (same) | Silence + comment |

**service_jobs.js subtotal:** 0 HIGH / 2 FALSE = **2**

### modules/stock_in_wizard.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 130 | `_swRows=...` | LOW | Wizard rows reassign — single wizard session | Silence acceptable |
| 474 | `_swSaving=false` (finally) | FALSE | Has entry guard `if (_swSaving) return` (typical pattern) | Silence + comment "lock release" |

**stock_in_wizard.js subtotal:** 0 HIGH / 1 LOW / 1 FALSE = **2**

### modules/thermal_printer.js (2 warnings)

| Line | Variable | Bucket | Reason | Action |
|------|----------|--------|--------|--------|
| 113 | `_printerDevice=...` | LOW | Module singleton — same pattern as bt_printer | Silence acceptable |
| 114 | `_printerType=...` | LOW | (same) | Silence acceptable |

**thermal_printer.js subtotal:** 0 HIGH / 2 LOW = **2**

### Single-warning files (10 warnings total)

| File:Line | Variable | Bucket | Reason | Action |
|-----------|----------|--------|--------|--------|
| ai-chat-widget.js:667 | `state.loading=false` | FALSE | Widget loading flag in finally — single-flight implicit | Silence + comment |
| modules/accounting/balance_sheet.js:182 | `_loading=false` | FALSE | Has entry guard pattern | Silence + comment |
| modules/accounting/coa.js:156 | `ev.target.value=...` (rollback) | FALSE | Error rollback | Silence + comment |
| modules/accounting/export_bundle.js:412 | `_generating=false` | FALSE | Entry guard pattern | Silence + comment |
| modules/accounting/profit_loss.js:331 | `_loading=false` | FALSE | (same balance_sheet pattern) | Silence + comment |
| modules/accounting/trial_balance.js:274 | `_loading=false` | FALSE | (same) | Silence + comment |
| modules/auth_email.js:61 | `state._recoveryMode=false` | LOW | After password set — single recovery flow | Silence acceptable |
| modules/products.js:1039 | `scanArea.innerHTML=...` | LOW | Scanner UI clear | Silence acceptable |
| modules/settings/ac-catalog.js:357 | `e.target.value=...` | FALSE | Input reset | Silence + comment |
| modules/stock_count.js:433 | `_scSaving=false` | FALSE | Entry guard pattern | Silence + comment |

**Singletons subtotal:** 0 HIGH / 2 LOW / 8 FALSE = **10**

---

## Bucket Verification

| Bucket | Per-file sum | Cross-check |
|--------|-------------:|------------:|
| HIGH | 1 (main) + 5 (cust_dashboard) | **6** ✓ |
| MEDIUM | 2 (receipts) + 2 (pos) + 2 (auth_otp) | **6** ✓ |
| LOW | 12 (main) + 3 (ac_install) + 3 (receipts) + 6 (quotations) + 2 (auth) + 3 (delivery_inv) + 1 (pos) + 1 (serials) + 1 (svc_form) + 1 (solar) + 2 (expenses) + 1 (journal_form) + 2 (bt_printer) + 1 (sw_wizard) + 2 (thermal) + 2 (singletons) | **43** ✓ |
| FALSE | 25 (main) + 4 (cust_dashboard) + 5 (ac_install) + 3 (receipts) + 1 (quotations) + 5 (periods) + 2 (auth) + 1 (delivery_inv) + 4 (line_notify) + 1 (pos) + 3 (serials) + 3 (svc_form) + 3 (solar) + 3 (backfill) + 1 (expenses) + 3 (settings/pages) + 2 (auto_post) + 1 (journal_form) + 2 (sales) + 2 (svc_jobs) + 1 (sw_wizard) + 8 (singletons) | **83** ✓ |
| **Total** | | **138** ✓ |

## Recommended Phase 89.41+ Sprint

### Phase 89.41 — HIGH_RISK batch (2 real fix sites, 6 warnings resolved)

**Focus:** Checkout cart-reset paths (POS + Customer-facing)

**Files:**
- `main.js:3696` — POS checkout `state.cart=[]`
- `modules/customer_dashboard.js:1104,1106` — Customer checkout `_custCart=[]` + slip state reset

**Approach:**
1. เพิ่ม `_checkoutInflight` module-level flag (main.js, customer_dashboard.js แต่ละไฟล์)
2. ที่จุดเข้า checkout function: `if (_checkoutInflight) return; _checkoutInflight = true;`
3. ใน `finally` set `_checkoutInflight = false`
4. Disable submit button at click handler entry — defense in depth
5. TDD: เพิ่ม test simulating double-click → expect ครั้งที่ 2 returns no-op

**Risk:** Medium — checkout เป็น critical path; ต้อง manual smoke test:
- กดปุ่ม "ชำระเงิน" 2 ครั้งเร็วๆ → ต้องเห็น 1 sale บันทึก
- Customer flow: กด "สั่งซื้อ" 2 ครั้ง → 1 service_job บันทึก
- Login → checkout → verify state.cart ถูก reset

**Estimated effort:** 2-3 hours fix + 1 hour smoke test

### Phase 89.42 — MEDIUM_RISK batch (3 real fix sites, 6 warnings resolved)

**Focus:** Multi-payment save + POS quick-pay state + OTP verify

**Files:**
- `modules/receipts.js:1162,1163` — multi-payment save needs entry guard
- `modules/pos.js:1194,1196` — `quickPayAmount`, `_posCustomer` (audit คาดว่ามี 2 paths เขียน)
- `modules/auth_otp.js:158,219` — `_pendingOtp` mutation in verify flow

**Approach:**
- receipts: เพิ่ม `saveBtn.disabled=true` at entry of multi-pay save handler (currently only in catch)
- pos: ต้อง audit caller — ถ้ามี 2 event handlers เขียน → add guard
- auth_otp: เพิ่ม `_verifyInflight` flag

**Risk:** Medium (accounting integrity for receipts; auth state for OTP)

**Required smoke test:**
- Receipts: เปิด multi-pay drawer → กด "บันทึก" 2 ครั้ง → 1 update
- POS: scan customer + click checkout เร็วๆ → state ตรง
- OTP: กด "ยืนยัน OTP" 2 ครั้ง → 1 verify

**Estimated effort:** 3-4 hours

### Phase 89.43 — LOW_RISK batch (43 warnings, ทยอย)

**Focus:** Silence + add comments ทั่วโครง — ส่วนใหญ่ low-traffic admin paths

แบ่งเป็น sub-batches:
- **89.43a** — main.js LOW (12 warnings, 1 file) — silence batch
- **89.43b** — Document/edit paths (receipts/quotations/delivery_invoices — 12 warnings) — silence batch
- **89.43c** — Module state resets after save (auth/expenses/journal_form/quotations/solar — 8 warnings) — silence
- **89.43d** — Scanner + printer + form misc (ac_install/products/serials/svc_form/bt_printer/thermal/sw_wizard — 11 warnings) — silence

**Risk:** Zero — silence only with explanatory comments
**Estimated effort:** 30 min per sub-batch × 4 = 2 hours total

### Phase 89.44 — FALSE_POSITIVE silence batch (83 warnings, 1-2 commits)

**Focus:** Bulk silence ด้วย `eslint-disable-next-line require-atomic-updates` + reason comment

**Approach:**
- Group by reason:
  1. `// eslint-disable-next-line require-atomic-updates -- _isLoading entry-guard pattern` (16 main.js + 1 stock_count + 1 stock_in_wizard + 3 accounting/_loading + 1 export_bundle = ~22 warnings)
  2. `// eslint-disable-next-line require-atomic-updates -- UI rollback in catch` (~30 warnings: btn.disabled/textContent in catch paths)
  3. `// eslint-disable-next-line require-atomic-updates -- single-flight via _refreshInflight` (1)
  4. `// eslint-disable-next-line require-atomic-updates -- idempotent cache` (5)
  5. `// eslint-disable-next-line require-atomic-updates -- local var sequential` (~5)
  6. `// eslint-disable-next-line require-atomic-updates -- CAS-protected cache sync` (2)
  7. `// eslint-disable-next-line require-atomic-updates -- UI render (single instance)` (~10)
  8. Other narrow reasons (~8)

**Risk:** Zero
**Estimated effort:** 2-3 hours (multi-file but mechanical)

**Result:** หลัง 89.44 จะเหลือ ~49 warnings (LOW + MED + HIGH ที่ยังไม่ฟิกซ์) → ค่อยทยอยเก็บ

---

## Methodology Notes

- **Audit duration:** ~60 นาที (Claude Code Opus 4.7, 2026-05-17)
- **Bias:** Conservative — เมื่อไม่แน่ใจ → bucket ที่ severe กว่า (HIGH > MED > LOW > FALSE)
- **Context window:** ±10-15 บรรทัดรอบแต่ละ warning + entry guards ที่ relevant
- **Cross-references:** ใช้ Phase 89.13 single-flight pattern (`_refreshInflight`), Phase 89.9 H10 (CAS), Phase 89.16 M1 (silent-fail detection) เป็น decision aids
- **No runtime testing** — pure static analysis

## Limitations

- ไม่ได้ trace concurrent execution paths runtime (race condition จริงต้อง simulate)
- ไม่ได้ unit test แต่ละ warning
- POS quick-pay (pos.js:1194,1196) ไม่ได้ verify ว่ามี 2 paths เขียนจริงๆ — กำหนดเป็น MEDIUM ตาม conservative bias
- บางไฟล์ที่ guarded-pattern (auth.js _verifying, accounting/*/loading flags) — assume guard pattern is correct ตาม Phase 89 history, ไม่ได้ verify entry-guard 100%
- **Recommend user spot-check 5-10 HIGH/MED entries ก่อน start Phase 89.41** เพื่อ confirm categorization

---

## Quick stats for reporting

```
Total warnings: 138
HIGH_RISK: 6 (4.3%) — 2 real sites (checkout flow)
MEDIUM_RISK: 6 (4.3%) — 3 real sites (multi-pay, POS state, OTP)
LOW_RISK: 43 (31.2%) — silence-ready, low priority
FALSE_POSITIVE: 83 (60.1%) — silence batch in 89.44

Files affected: 33
Top hotspots: main.js (38), customer_dashboard.js (9), ac_install.js (8), receipts.js (8), quotations.js (7)
```
