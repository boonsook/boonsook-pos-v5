# 🔄 SESSION LOG — Boonsook POS V5

**ไฟล์นี้คือ "session continuity"** — ใช้เปิด session ใหม่แล้วลุยต่อได้เลย
เปิดอ่านไฟล์นี้ก่อน HANDOFF.md / CHANGELOG.md เสมอ

**Last update:** 15 พฤษภาคม 2026 (Session: Phase 89.27-89.29 audit batches)

---

## 🎯 Current state (snapshot ตอนปิด session)

| Item | Value |
|------|-------|
| **main HEAD** | `65f291e` Merge PR #11 — Phase 89.28 recovered + 89.29 (build 239) |
| **Branch ของ session** | `claude/review-app-Ae6bG` — sync กับ main + 1 hotfix commit (`ed202b2`) |
| **Build live (เมื่อ deploy)** | 239 |
| **Tests** | **87/87 pass** (`npm test`) |
| **Version** | 5.43.35 |

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
| 6 | (no bump) | `ed202b2` | **89.26 hotfix** SQL column names | supabase-phase89-26 (receipt_date → paid_at, total_charge → total_cost) | pending — not yet PR'd |

---

## 🗄️ SQL migration tracker

**User ต้องรันที่ Supabase Dashboard → SQL Editor**

| ลำดับ | ไฟล์ | Run? | ผล / notes |
|------|------|------|--------|
| 1 | `supabase-phase89-25-fix-je-rls-pos.sql` | ✅ DONE | 10 policies created (je_* × 4, jl_* × 4, am_* × 2) — verified screenshot |
| 2 | `supabase-phase89-26-audit-missing-jvs.sql` | 🐛 **RERUN** | เดิม error `42703 column r.receipt_date does not exist` — ผม commit `ed202b2` แก้แล้ว → user **ต้อง git pull แล้ว rerun** หรือ copy ฉบับใหม่จาก repo |
| 3 | `supabase-phase89-29-jv-gaps.sql` | ⏳ pending | seed account 4110 + refund_cash + refund_transfer mappings. **ต้องรันก่อนใช้ refund** ไม่งั้น refund JV จะ fail silent |

### ⚠️ Important — hotfix `ed202b2` ยังไม่ merged เข้า main

Branch `claude/review-app-Ae6bG` มี `ed202b2` (SQL hotfix) แต่ main ยังเป็น `65f291e` (มี SQL ที่บัค).

Action: เมื่อ session ใหม่เปิด → ถ้า user ยังไม่ได้รัน SQL #26 → เปิด PR เล็กๆ merge `ed202b2` เข้า main (1 ไฟล์, ไม่ต้อง build bump)

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

### ⏳ TODO — 9 findings ที่เหลือ

| ID | Severity | File:Line | Notes |
|----|----------|-----------|-------|
| **H1** | High | `service_jobs.js:191` | XSS slip URL — `sanitizeUrl()` คืน raw string → quote escape attribute. Fix: `escHtml(slipUrl)` ใน `href=` + `src=` |
| **H2** | High | `customer_dashboard.js:291, 735` | XSS CSS `url('${imgUrl}')` — DB image_url breakout. Fix: `escHtml(imgUrl)` + strip `'` `)` |
| **H3** | High | `quotations.js:651, 684` | XSS search dropdowns — `p.sku`, `c.phone`, `c.company` ไม่ escape. Fix: wrap ทุก field ด้วย `escHtml()` |
| **H5** | High | `auto_post.js:202-244` | doc_no UNIQUE race → JV ใบที่ 2 หาย. Fix: ก่อน return null บน 409 → re-fetch ดู source_id มี JV ไหม → ไม่มี → retry seq+1 (max 3) |
| **H6** | High | `main.js:46-50` | `_lazyImport` cache rejected promise ถาวร → user ติดหน้าจน reload. Fix: `_lazyMod.delete(path)` ใน `.catch` |
| **H7** | High | `customer_dashboard.js:692` | ลูกค้ายืนยันปิดงาน → ไม่ post JV. Fix: เรียก `postJournalForServiceJob(currentJob)` หลัง PATCH สำเร็จ |
| **M2** | Medium | `birthdays.js:180` | `today.toISOString().slice(0,10)` UTC → 00:00-06:59 BKK ส่ง LINE ซ้ำ. Fix: ใช้ `dateBkk(today)` |
| **M3** | Medium | `main.js:3279-3293` | `_revertStockForSale` non-CAS → lost update ขณะ admin ลบ sale + concurrent decrement. Fix: ใช้ `atomicDecrementStock` กับ qty ติดลบ |
| **M4 (dead_stock)** | Medium | `dead_stock.js:30,41,56,199` | Similar to dashboard — `slice(0,10)` UTC. Fix: `dateBkk()` แทน |
| **S5** | Medium | `functions/api/log-error.js:84` | รับ spoofed `user_id` → audit log ปลอม. Fix: drop client `user_id`, derive จาก JWT |
| **S6** | Medium | `customer_dashboard.js:300, 744` | XSS warranty fields. Fix: `escHtml(p.w_install)` etc. |
| **S7** | Medium | `quote_templates.js:37` | XSS `e.message` ใน innerHTML. Fix: `escHtml(e.message)` |
| **S8** | Medium | `modules/settings/payment.js:163` | SlipOK key in localStorage plaintext — exfiltrable via XSS. Fix: server-side storage, treat as compromised on XSS |
| **Style cache** | Low | `index.html:12` | `style.css?v=21` ค้าง — Phase 89.19 เพิ่ม rules ไม่ bump → returning users cache เก่า. Fix: bump `?v=239` |

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
