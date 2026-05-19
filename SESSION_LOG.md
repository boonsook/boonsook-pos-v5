# 🔄 SESSION LOG — Boonsook POS V5

**ไฟล์นี้คือ "session continuity"** — ใช้เปิด session ใหม่แล้วลุยต่อได้เลย
เปิดอ่านไฟล์นี้ก่อน HANDOFF.md / CHANGELOG.md เสมอ

**Last update:** 19 พฤษภาคม 2026 (Session: Phase 90.4–91.1 loyalty bug onion + POS auto-earn)

---

## 🎯 Current state (snapshot ตอนปิด session)

| Item | Value |
|------|-------|
| **main HEAD** | `35b3408` Phase 91.1 POS checkout auto-earn loyalty points (build 253) |
| **Branch** | `main` (direct push — งานเล็ก ตามที่ user grant) |
| **Build live** | **253** ที่ `boonsook-pos-v5.pages.dev` (canonical — ไม่ใช่ www.boonsook.com) |
| **Tests** | **168/168 unit** + **11/11 e2e** pass (`npm run verify`) |
| **Version** | 5.44.0 (minor bump from 5.43.x — Phase 91.1 = new feature) |
| **Lint** | clean (warnings ≤ 9 ที่เหลือจาก Phase 89.x) |

### Phase 90.x audit closures
| Audit ID | Status | Phase | Build |
|----------|--------|-------|-------|
| A1 settings save runtime guard | ✅ closed | 90.12 | 251 |
| B1 history modal listener leak | ✅ closed | 90.13 | 252 |
| Manual tab role gate | ⏳ deferred — product decision | — | — |

### Phase 91 backlog (loyalty over-credit risk)
- **Refund reversal** — refund ตอนนี้ไม่ลบ earn record → ลูกค้าได้แต้มฟรีหลัง refund
- **Sale soft-delete reversal** — admin ลบ sale ก็ไม่ลบ earn record → over-credit เหมือนกัน

ต้อง wire reverse-record (`redeemPoints` หรือ DELETE row) ใน `modules/refunds.js` + sale void path

### วิธี verify state ใน session ใหม่

```bash
# 1. Sync + ตรวจ commits
git fetch origin && git log origin/main --oneline -5
# คาดหวัง HEAD = 65f291e หรือใหม่กว่า

# 2. Run tests
npm test
# คาดหวัง 87/87 pass

# 3. ตรวจ build version sync
grep -E "build [0-9]+" modules/settings/pages.js sw.js index.html
# ทุกที่ต้องเป็น 239 (หรือใหม่กว่าถ้ามี push เพิ่ม)
```

---

## 📜 Push history — session นี้

| # | Build | Commit | Phase | Files | PR |
|---|-------|--------|-------|-------|----|
| 1 | 237 | `845a9e5` | **89.27** sales filter completeness (C1+H4) | utils.js helper + main.js server-side filter + pos/sales/dashboard/profit_report/top_customers/sales_heatmap + tests/sales_filter.test.js (8 tests) + build bump | #10 |
| 2 | 238 | `8336b93` | **89.28** dashboard TZ fix (audit M4) | dashboard.js 12 จุด (dateBkk แทน slice(0,10)) + admin-only daily summary + hero badge + tests/tz_today_filter.test.js (8 tests) | #10 (หาย — recovered ใน #11) |
| 3 | — | merge | PR #10 merged into main | (merged only 89.27 due to head-SHA race) | merged `48a6d94` |
| 4 | 239 | `cbaeb14` | **89.29** JV gaps (C2+C3+C4+M1) | auto_post.js +2 functions + credit_tracker/refunds/expenses + SQL phase89-29 | #11 |
| 5 | — | merge | PR #11 merged | (recovered 89.28 + new 89.29) | merged `65f291e` |
| 6 | (no bump) | `ed202b2` | **89.26 hotfix #1** SQL column names | supabase-phase89-26 (receipt_date → paid_at, total_charge → total_cost) | PR #12 |
| 7 | (no bump) | `26c7b61` | **docs** SESSION_LOG.md + HANDOFF pointer | new SESSION_LOG.md (295 lines) | PR #12 |
| 8 | (no bump) | `3b71d2b` | **89.26 hotfix #2** receipts column ที่ถูกต้องคือ `paid_date` (ไม่ใช่ `paid_at`) | supabase-phase89-26 | PR #12 amend |
| 9 | (no bump) | `0ee94b6` | **89.26 hotfix #3** type cast `bigint = text` ใน Section 2/3/4 (`j.source_id::text = X.id::text`) | supabase-phase89-26 | PR #12 (merged `b90156c`) |
| 10 | 240 | (this push) | **89.30** XSS hardening batch (H1+H2+H3+S6+S7) | service_jobs (slip URL escape), customer_dashboard (CSS url() strip + warranty escape, both render sites), quotations (search dropdowns escape sku/phone/company), quote_templates (e.message escape), tests/xss_regression.test.js (7 tests), style.css cache buster | (new PR) |

---

## 📜 Push history — Session 19 พฤษภาคม 2026 (Phase 90.4 → 91.1)

> Loyalty bug onion 6 layers ปิดทีละชั้น (90.4→90.13) แล้วต่อด้วย Phase 91.1 feature add (POS auto-earn). ทุก push เป็น direct-to-main (งานเล็ก, user grant push permission). หลัง push ทุกครั้งมี: lint + 145–168 unit + 11 e2e pass + `boonsook-pos-v5.pages.dev` live-verify build number ก่อนรายงาน.

| # | Build | Commit | Phase | สรุปสั้น | Tests added |
|---|-------|--------|-------|----------|-------------|
| 1 | 244 | `89e8871` (PR #28) | **90.4** loyalty.js renderSettingsTab no-unreachable | setTimeout อยู่หลัง `return html` → click handler ไม่ถูก attach. ย้าย setTimeout มาก่อน return | (existing) |
| 2 | 244 | `7233e68` (PR #29) | **90.4** bundle: settings save + currentRole bug | currentRole เป็น function ต้องเรียก `()` (เคย compare function reference vs string = false ตลอด) | `loyalty_admin_check.test.js` |
| 3 | (no bump) | `cc80f90` (PR #30) | **90.4 + 90.5** chore | e2e/lint cleanup batch | — |
| 4 | 245 | `a919c00` (PR #31) | **90.6** loyalty settings save XHR signature | `_appXhrPatch(restUrl, payload, callback)` ผิด → ที่ถูกคือ `(table, payload, eqCol, eqVal)` Promise-based + POST fallback | `loyalty_settings_save.test.js` |
| 5 | 246 | `36a5b16` (PR #32) | **90.7** lazy import ESM cache bust | `import('./loyalty.js')` ไม่มี `?v=` → browser ESM registry serve module เก่าถึง build 244 + ปิดบิลต่อ. Fix: `_bustedUrl(path)` ใน main.js เพิ่ม `?v=APP_BUILD` | `lazy_import_cache_bust.test.js` |
| 6 | 247 | `11c5af0` | **90.8** loyalty XHR helper signatures (3 sites) | `earnPoints` / `redeemPoints` / manual-earn handler เรียก `_appXhrPost('/api/loyalty-points', rec, cb)` — REST path ผิด + callback ทิ้ง (xhrPost คืน Promise) | — (existing covers) |
| 7 | 248 | `208d797` | **90.9** redeem clear-form regression | 90.8 ทำ redeemPoints เป็น async แต่ยังคืน void → manual handler clear form มั่วๆ ทั้งสำเร็จ/ล้มเหลว. Fix: คืน `{ok, error}` ทุก exit, clear เฉพาะ r?.ok | — (existing) |
| 8 | 249 | `7340636` | **90.10** customer_id type mismatch | `customers.id` = bigint (number) แต่ `<select>.value` คืน string. `1 === "1"` = false → getCustomerPoints คืน 0 ตลอด → "แต้มไม่พอแลก" ผิดเสมอ. Fix: cast `String()` 4 จุดที่จุด compare | — (existing) |
| 9 | 250 | `cc6a542` | **90.11** boot.js periodic + visibilitychange SW update | Long session ติด build เก่าจน user reload เอง. Fix: `setInterval(reg.update, 10min)` + `visibilitychange` → `reg.update()`. ไม่ auto-reload — แค่ trigger เพื่อให้ banner เด้ง | `boot_periodic_sw_update.test.js` (6) |
| 10 | 251 | `4c22dd1` | **90.12** settings save runtime admin guard (A1) | Defense-in-depth: เพิ่ม `if (!requireAdmin?.()) { toast; return }` ก่อน xhrPatch/Post call จริง — กัน mid-session role downgrade / DevTools injection | `loyalty_settings_admin_guard.test.js` (5) |
| 11 | 252 | `d19655d` | **90.13** history modal listener leak (B1) | `showPointHistory` ผูก click listener ทุกครั้งที่เปิด → N stacked. Fix: ย้าย listener ไปผูกครั้งเดียวใน `renderLoyaltyPage` L262 | `loyalty_history_modal_listener.test.js` (4) |
| 12 | 253 | `35b3408` | **91.1 ⭐ NEW FEATURE** POS checkout auto-earn loyalty | `earnPoints()` มีอยู่ตั้งแต่ 90.8 แต่ไม่มี caller. Wire ใน pos.js: capture `_earnCustomerId` ก่อน state-reset, fire-and-forget dynamic import กับ ?v=APP_BUILD หลัง postJournalForSale, gate `_earnCustomerId && is_active && points_per_baht>0`. Version minor bump 5.43.48 → 5.44.0 | `pos_loyalty_auto_earn.test.js` (8) |

**Cumulative session (10 commits, 1 day):**
- Build: 243 → **253** (10 bumps across 6 phases)
- Unit tests: 145 → **168** (+23 จาก 6 ไฟล์ใหม่)
- Loyalty flow: settings save / manual earn / manual redeem / history modal / POS auto-earn = ทุกอย่างใช้งานได้แล้ว
- Bug onion: 6 ชั้น ปิดทุกชั้น (`renderSettingsTab dead code` → `currentRole function-ref bug` → `XHR signature wrong` → `ESM cache stale` → `signature wrong 3 จุดอื่น` → `async return shape ไม่ใช่ void` → `bigint vs string compare` → ฯลฯ)

### Memory rules บันทึกใหม่
- `feedback_async_refactor_return_shape.md` — sync→async ต้อง revisit caller; ถ้า caller ตัดสินใจ UX ต้องคืน `{ok,error}` ไม่ใช่ void
- `feedback_id_type_mismatch.md` — bigint vs select.value; cast String() ที่จุด compare
- `feedback_narrow_scope.md` — audit เจอหลาย issue ก็จริง แต่ user เลือกทำทีละข้อ
- `reference_canonical_prod_url.md` — `boonsook-pos-v5.pages.dev` = canonical; `www.boonsook.com` = parked placeholder

---

## 🗄️ SQL migration tracker

**User ต้องรันที่ Supabase Dashboard → SQL Editor**

| ลำดับ | ไฟล์ | Run? | ผล / notes |
|------|------|------|--------|
| 1 | `supabase-phase89-25-fix-je-rls-pos.sql` | ✅ DONE | 10 policies created (je_* × 4, jl_* × 4, am_* × 2) |
| 2 | `supabase-phase89-26-audit-missing-jvs.sql` | ✅ DONE | After 3 hotfixes (`ed202b2`+`3b71d2b`+`0ee94b6`). Audit แสดง 6 missing sales (14 พ.ค.) → backfilled via admin UI (6/7 created, 1 skip, 0 fail) |
| 3 | `supabase-phase89-29-jv-gaps.sql` | ✅ DONE | Verified: account_4110 + mapping_refund_cash + mapping_refund_transfer ทั้ง 3 row = 1 |

### ✅ PR #12 merged (`b90156c`)

SQL hotfix #1+#2+#3 + SESSION_LOG.md อยู่ใน main แล้ว. Audit SQL #26 รันผ่านทุก section หลัง backfill 6 missing JV (14 พ.ค. 2026) สำเร็จ + SQL #29 (refund mappings) รันแล้ว.

---

## 📊 Audit batch tracker — 10 high-priority findings

จาก audit 3 agents (15 พ.ค. session):

### ✅ DONE (4 critical + 1 high + 1 medium)

| ID | Severity | File:Line | Phase | Status |
|----|----------|-----------|-------|--------|
| **C1** | Critical | `main.js:1450` | 89.27 | ✅ Server `.or()` filter |
| **H4** | High | `dashboard.js`, `profit_report.js`, `top_customers.js`, `sales_heatmap.js` | 89.27 | ✅ ใช้ `visibleSalesForRole` |
| **M4** | Medium (escalated to P1 — user-visible bug) | `dashboard.js` 12 จุด | 89.28 | ✅ `dateBkk()` แทน `slice(0,10)` |
| **C2** | Critical | `credit_tracker.js:248-276` | 89.29 | ✅ `postJournalForCreditPayment` |
| **C3** | Critical | `refunds.js:343-410` | 89.29 | ✅ `postJournalForRefund` (ต้องรัน SQL #29) |
| **C4** | Critical | `expenses.js:522-526` | 89.29 | ✅ void+repost JV |
| **M1** | Medium (bundled) | `credit_tracker.js:250` step 1 r.ok | 89.29 | ✅ check r.ok ทั้ง 2 step |

### ✅ DONE — Phase 89.30 (XSS batch, build 240)

| ID | Severity | File | Fix |
|----|----------|------|-----|
| **H1** | High | `service_jobs.js:191` | ✅ `escHtml(slipUrl)` ใน `href=` + `src=` |
| **H2** | High | `customer_dashboard.js:285, 730` | ✅ strip `'` `)` `\` + `escHtml()` ใน CSS `url('...')` (apply ทั้ง 2 render sites) |
| **H3** | High | `quotations.js:651, 684` | ✅ `escHtml(p.sku)`, `escHtml(c.phone)`, `escHtml(c.company)` |
| **S6** | Medium | `customer_dashboard.js:300, 744` | ✅ `escHtml(p.w_install/w_parts/w_comp)` (ทั้ง 2 sites) |
| **S7** | Medium | `quote_templates.js:37` | ✅ `escHtml(e.message)` |
| **Style cache** | Low | `index.html:12` | ✅ `style.css?v=21` → `?v=240` |

Plus: `tests/xss_regression.test.js` — 7 tests (94/94 pass)

### ⏳ TODO — 8 findings ที่เหลือ

| ID | Severity | File:Line | Notes |
|----|----------|-----------|-------|
| **H5** | High | `auto_post.js:202-244` | doc_no UNIQUE race → JV ใบที่ 2 หาย. Fix: ก่อน return null บน 409 → re-fetch ดู source_id มี JV ไหม → ไม่มี → retry seq+1 (max 3) |
| **H6** | High | `main.js:46-50` | `_lazyImport` cache rejected promise ถาวร → user ติดหน้าจน reload. Fix: `_lazyMod.delete(path)` ใน `.catch` |
| **H7** | High | `customer_dashboard.js:692` | ลูกค้ายืนยันปิดงาน → ไม่ post JV. Fix: เรียก `postJournalForServiceJob(currentJob)` หลัง PATCH สำเร็จ |
| **M2** | Medium | `birthdays.js:180` | `today.toISOString().slice(0,10)` UTC → 00:00-06:59 BKK ส่ง LINE ซ้ำ. Fix: ใช้ `dateBkk(today)` |
| **M3** | Medium | `main.js:3279-3293` | `_revertStockForSale` non-CAS → lost update ขณะ admin ลบ sale + concurrent decrement. Fix: ใช้ `atomicDecrementStock` กับ qty ติดลบ |
| **M4 (dead_stock)** | Medium | `dead_stock.js:30,41,56,199` | Similar to dashboard — `slice(0,10)` UTC. Fix: `dateBkk()` แทน |
| **S5** | Medium | `functions/api/log-error.js:84` | รับ spoofed `user_id` → audit log ปลอม. Fix: drop client `user_id`, derive จาก JWT |
| **S8** | Medium | `modules/settings/payment.js:163` | SlipOK key in localStorage plaintext — exfiltrable via XSS. Fix: server-side storage, treat as compromised on XSS |
| **N1 (new)** | Medium | `modules/accounting/auto_post.js:544` | `receipt.paid_at` ไม่มีจริงใน DB (column = `paid_date`) → docDate fallback ไป `created_at` → JV ใช้วันสร้างใบเสร็จแทนวันรับเงินจริง. Fix: `receipt.paid_date \|\| receipt.created_at` + พิจารณา DB schema rename เพื่อ consistency |

---

## 🚀 NEXT STEP — เปิด session ใหม่แล้วลุยตามนี้

### Step 0 — Verify state (5 min)

```bash
cd /home/user/boonsook-pos-v5
git fetch origin && git status && git log origin/main --oneline -3
npm test    # ต้อง 87/87
```

ถ้า `ed202b2` ยัง pending PR — เปิด PR เล็กๆ merge:
```bash
# Branch มี ed202b2 อยู่แล้ว แค่เปิด PR
# หรือใช้ mcp__github__create_pull_request → main
```

### Step 1 (recommended) — XSS batch (H1+H2+H3+S6+S7) ~1-2 ชม

**Pattern:** ทุกจุดใช้ `escHtml()` จาก `modules/utils.js` (มีอยู่แล้ว) wrap interpolated values

1. **H1 `modules/service_jobs.js:191`** — slip URL ใน `<a href>`/`<img src>`:
   ```js
   // ก่อน: <a href="${slipUrl}"><img src="${slipUrl}" ...>
   // หลัง: <a href="${escHtml(slipUrl)}"><img src="${escHtml(slipUrl)}" ...>
   ```

2. **H2 `modules/customer_dashboard.js:291, 735`** — CSS `url()`:
   ```js
   // ก่อน: style="background:${imgUrl ? `url('${imgUrl}') center/cover` : ...}"
   // หลัง: เช็คให้ imgUrl ไม่มี `'` `)` — strip + escHtml
   //   const safeImg = String(imgUrl||"").replace(/['\)\\]/g, '');
   //   style="background:${safeImg ? `url('${escHtml(safeImg)}') center/cover` : ...}"
   ```

3. **H3 `modules/quotations.js:651, 684`** — search dropdowns:
   ```js
   // ก่อน: <span class="sku">${p.sku||''} ...</span>
   // หลัง: <span class="sku">${escHtml(p.sku||'')} ...</span>
   // และ ${c.phone||''} → ${escHtml(c.phone||'')}
   // และ ${c.company} → ${escHtml(c.company)}
   ```

4. **S6 `modules/customer_dashboard.js:300, 744`** — warranty fields:
   ```js
   // 'ติดตั้ง ' + p.w_install → 'ติดตั้ง ' + escHtml(p.w_install)
   // similar for p.w_parts, p.w_comp
   ```

5. **S7 `modules/quote_templates.js:37`**:
   ```js
   // container.innerHTML = `...${e.message}...`
   // → container.innerHTML = `...${escHtml(e.message)}...`
   ```

**Tests:** add `tests/xss_regression.test.js` — assert ใส่ payload `<img onerror=alert(1)>` ใน DB string แล้ว rendered HTML ไม่มี executable handler

**Build bump:** 239 → 240 (5 ไฟล์: index.html × 3, sw.js, settings/pages.js, package.json) ดู phase 89.27 commit เป็นตัวอย่าง

**Style cache buster:** bonus — bump `style.css?v=21` → `?v=239` (memory rule: 4 sub-items ต้อง bump ทุก build แต่ style.css ถูกลืม)

---

### Step 2 (alt) — Quick wins batch (M2+M3+M4 dead_stock + style.css) ~1 ชม

ง่ายและ user impact ชัด:

1. **M2 `modules/birthdays.js:180`** — ใช้ `dateBkk()` แทน `toISOString().slice(0,10)`:
   ```js
   import { dateBkk } from "./utils.js";
   const todayKey = dateBkk(today);  // เดิม today.toISOString().slice(0,10)
   ```

2. **M3 `main.js:3279-3293`** — `_revertStockForSale` ใช้ CAS:
   ```js
   // เดิม: xhrPatch warehouse_stock + xhrPatch products.stock (non-CAS)
   // ใหม่: call atomicDecrementStock(productId, warehouseId, -qty) — negative = increment
   //       มี retry loop เหมือน Phase 89.17 M2 fix
   ```
   ดู `modules/stock_cas.js` เป็น reference

3. **M4 (dead_stock) `modules/dead_stock.js:30,41,56,199`** — pattern เดียวกับ Phase 89.28 dashboard:
   ```js
   import { dateBkk } from "./utils.js";
   // ทุกที่ที่ใช้ created_at.slice(0,10) เทียบกับ today → ใช้ dateBkk(created_at)
   ```

4. **Style.css cache bust** — bump `index.html:12` `style.css?v=21` → `?v=239`

**Build bump:** 239 → 240

---

### Step 3 (alt) — H5+H6+H7 batch (race + lazy + service close) ~2-3 ชม

1. **H6 `main.js:46-50`** (ง่ายสุดในกลุ่ม — ทำก่อน):
   ```js
   function _lazyImport(path) {
     if (_lazyMod.has(path)) return _lazyMod.get(path);
     const p = import(path).catch(e => {
       _lazyMod.delete(path); // Phase 89.30: ลบ cache ถ้า reject — กัน sticky fail
       throw e;
     });
     _lazyMod.set(path, p);
     return p;
   }
   ```

2. **H7 `modules/customer_dashboard.js:692`** — เพิ่ม postJournalForServiceJob:
   ```js
   import { postJournalForServiceJob } from "./accounting/auto_post.js";
   // ที่ line ~692 หลัง PATCH service_jobs success:
   postJournalForServiceJob(updated_job).catch(e => console.warn("[customer_dashboard] auto-post JV:", e?.message));
   ```

3. **H5 `modules/accounting/auto_post.js:202-244`** (ยากสุด) — doc_no race:
   ```js
   // ที่ catch 409 (UNIQUE violation):
   // เดิม: console.info("idempotency hit"); return null;
   // ใหม่:
   //   1. re-fetch journal_entries WHERE source_table=X AND source_id=Y
   //   2. ถ้ามี → idempotency hit จริง → return existing
   //   3. ถ้าไม่มี → seq race → retry seq+1 (loop max 3 ครั้ง)
   ```

**Build bump:** 239 → 240

---

### Step 4 (alt) — Remaining medium/low ~1-2 ชม

- **S5** `functions/api/log-error.js:84` — drop client `user_id`
- **S8** SlipOK key migration — server-side storage. ต้องเพิ่ม SQL migration + UI flow
- **HANDOFF cleanup** — sprint table ค้างที่ Phase 89.17 → update

---

## 🧪 Smoke test checklist — หลัง deploy build 239

### Phase 89.27 (sales filter)
- [ ] Admin → ภาพรวมบริษัท → hero ไม่มี badge "เฉพาะของคุณ" → ยอด = ทุกคน
- [ ] ช่าง login → POS home → badge "เฉพาะของคุณ" + ยอดของตัวเอง
- [ ] Sales role → Profit report → ยอดเฉพาะ sales คนนั้น
- [ ] Network tab → non-admin query มี `?or=(created_by.eq...,is.null)`

### Phase 89.28 (dashboard TZ)
- [ ] Admin → ภาพรวมบริษัท → "วันนี้ขายได้" = ยอดเดียวกับ POS home
- [ ] ทดสอบ: ขาย 1 บิลตอน 06:30 BKK → refresh dashboard → ยอดวันนี้ +1
- [ ] (ถ้าเป็นไปได้) ทำขายตอน 23:30 BKK → ยังคงนับวันนั้น

### Phase 89.29 (JV gaps) — **ต้องรัน SQL #29 ก่อน**
- [ ] ขายเครดิต ฿1,000 → รับชำระ ฿400 → `Accounting > Journals` → JV RV: Dr 1110 ฿400 / Cr 1200 ฿400 ✓
- [ ] บันทึก refund ฿200 → `Journals` → JV: Dr 4110 ฿200 / Cr 1110 ฿200 ✓
- [ ] เพิ่มรายจ่าย ฿500 → แก้เป็น ฿700 → `Journals` → JV เดิม ฿500 หาย + ใหม่ ฿700 มา
- [ ] Trial Balance → Dr = Cr ทุกกรณี

---

## 🛡️ Process improvements (lessons learned this session)

1. **PR merge head-SHA race** — Phase 89.28 commit `8336b93` หายจาก PR #10 merge เพราะ push หลังเปิด PR. ครั้งหน้า:
   - Push ทุก commit ที่ตั้งใจให้รวมก่อน open PR
   - หลัง merge → verify main HEAD ทันที (ดู settings/pages.js ว่า build ตรง)

2. **SQL column verify** — ก่อน commit SQL ใหม่ → grep code (modules/*.js) เพื่อยืนยัน schema fields. `receipt_date` กับ `total_charge` ไม่มีจริง แต่ผมเขียนตามสมมติฐาน.

3. **Build version sync (memory rule)** — 4 ที่ต้อง bump ทุก build:
   - `index.html` `?v=X` (selfheal + main + boot) + `data-app-build="X"`
   - `sw.js` CACHE_NAME comment + const
   - `modules/settings/pages.js` "build X"
   - `package.json` version
   - **(เพิ่ม)** `style.css?v=X` ใน index.html — มักลืม

4. **fire-and-forget JV post** — pattern ของ Phase 89.29: post JV หลัง main op สำเร็จ, `.catch()` log แต่ไม่ block UX. ถ้า JV fail → admin backfill ใน UI ได้

---

## 📁 ไฟล์อ้างอิงสำคัญ

| Topic | ไฟล์ |
|-------|------|
| Audit findings เต็ม | (ดูข้อความ summary ใน session ของ user) |
| Sales filter helper | `modules/utils.js` (`visibleSalesForRole`, `isAdminProfile`) |
| BKK timezone helpers | `modules/utils.js` (`todayBkk`, `dateBkk`) |
| JV post functions | `modules/accounting/auto_post.js` (postJournalForSale/Expense/ServiceJob/Receipt/DeliveryInvoice/CreditPayment/Refund + voidJvForSource) |
| Role definitions | `main.js:1008` `ROLE_PAGES` |
| RLS policies | `supabase-phase89-25-fix-je-rls-pos.sql` (latest) |
| Test infrastructure | `tests/*.test.js` — node:test + mock fetch via `_appAuthFetch` |
| Build version refs | `index.html:816-819`, `sw.js:1-3`, `modules/settings/pages.js:25-26`, `package.json:3` |
