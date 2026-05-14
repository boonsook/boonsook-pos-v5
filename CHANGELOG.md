# 📜 CHANGELOG — Boonsook POS V5 PRO

รายการการแก้ไขแบบสั้น เรียงจากใหม่ → เก่า
รายละเอียดเชิงลึก (architecture / why) ดูใน [HANDOFF.md](HANDOFF.md)

รูปแบบ: `<commit> feat|fix|docs|refactor: <สรุปสั้น>` + bullet 1-2 ข้อถ้าจำเป็น

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
