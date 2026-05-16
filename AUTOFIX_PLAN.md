# AUTOFIX_PLAN — Phase 89.14 (Stabilization batch 3)

**Target build:** 223 (Phase 89.14)
**Baseline:** 5.43.18 / build 222 (Phase 89.13, main @ 6103ccf)
**Goal:** เคลียร์ Med/Low 9 รายการที่ค้างจาก Phase 89.13 audit ในรอบเดียว ผ่าน Claude Code autonomous loop
**Owner:** Claude Code (autonomous) — ผู้ใช้รีวิว PR ก่อน merge เท่านั้น

---

## 0. สถานะของแอป (ที่ผมเห็นตอนนี้)

| มิติ | สถานะ |
|------|-------|
| Tech | Vanilla JS PWA (ES modules), Supabase, Cloudflare Pages, Docker |
| ขนาด | ~70 modules, main.js 4,622 บรรทัด, index.html 978 บรรทัด |
| Tests | `npm test` (node:test) → 33/33 ผ่าน, ครอบ 2 modules (error_reporter, stock_cas) |
| CI | `.github/workflows/test.yml` รัน push ทุก branch `claude/**` + smoke `curl /` ใน docker job |
| Worktrees | `.claude/worktrees/` มี 10+ ใช้งานแล้ว — Claude Code พร้อมรัน parallel |
| Git | main behind origin/main 5 commits, มี untracked local backups ไม่กระทบ |
| Outstanding | 9 บั๊ก (M1–M7, L2, L4) บันทึกใน HANDOFF.md "Known bugs ยังไม่แก้รอบนี้" |

**Strengths สำหรับ autonomous loop:**
- มี test harness + CI พร้อม
- HANDOFF.md จดบั๊กไว้แบบ structured (severity + file:line + root cause)
- มี build version + APP_BUILD + SW CACHE_NAME → verify deploy ได้
- ใช้ phase-based commit pattern + worktree → rollback ง่าย

**Gaps ที่ต้องปิดก่อน loop เริ่มทำงาน:**
- Test coverage แค่ 2/70 modules — ต้องเขียน test ก่อนแก้ทุกบั๊กที่แก้ logic
- ไม่มี ESLint/Prettier gate
- CI smoke test แค่ `curl /` — ไม่ครอบ JS load error
- Service Worker cache name ต้อง bump ทุกครั้ง — ลืมง่าย

---

## 1. บั๊กที่จะเคลียร์ (เรียงตามที่ user แนะนำ M6 → M1 → M2 → M5 → M3 → ตามด้วย M4, M7, L4, L2)

### B1 — M6 (High) `/api/parse-receipt` + `/api/verify-slip` เปิด anon

**Root cause** (`functions/_middleware.js:35-45`): `REQUIRE_AUTH_ENDPOINTS` ครอบแค่ `ai-assistant` + `line-notify` ส่วน parse-receipt/verify-slip ที่เรียก Gemini Vision เสีย cost จริง เปิด anon → ใครก็ยิง burst ได้

**Fix**
1. เพิ่ม `/api/parse-receipt` + `/api/verify-slip` ใน `REQUIRE_AUTH_ENDPOINTS`
2. ลด rate limit เฉพาะ 2 endpoint นี้ใน `RATE_LIMITS` (เช่น 10/นาที/IP เหมือน verify-otp)
3. เพิ่ม STAFF_ONLY guard ถ้า business logic ต้องการ (ตรวจ caller usage ก่อน)

**Test (ก่อนแก้):** `tests/middleware_auth.test.js` — mock fetch → ยิง 2 endpoint แบบไม่มี Bearer → คาดหวัง 401

**Files:** `functions/_middleware.js`

**Acceptance:**
- npm test ผ่าน
- ทดสอบ curl: `curl -X POST $URL/api/parse-receipt -d '{"image":"data:..."}'` → 401 (ก่อน fix = 200)
- staff ที่ login + post รูปจริง → ยังใช้ได้

---

### B2 — M1 (High) `voidJvForSource` silent fail → double-revenue risk

**Root cause** (`modules/accounting/auto_post.js:84-105`): RLS DELETE ที่ไม่ match policy คืน 200 + `[]` (rows ที่ลบจริง 0) function คืน `0` แบบ "สำเร็จ"  caller รี-โพสต์ JV ใหม่ทับ → ซ้ำซ้อน

**Fix**
1. ตรวจ `count === 0` → caller รู้ว่าไม่ได้ลบจริง (return `{ deleted: 0, expectedAtLeast: true }`)
2. หรือดีกว่า: ก่อน DELETE ทำ SELECT count ของ entries ที่ตรง source — ถ้า > 0 แต่ DELETE คืน 0 → throw + log error_log
3. Caller (delete sale, delete receipt) ต้องอ่าน return shape ใหม่ → ถ้า expected > 0 แต่ deleted = 0 → block re-post + แสดง toast แดง

**Test:** `tests/auto_post_void.test.js` — mock fetch ที่ SELECT คืน 2 rows แต่ DELETE คืน `[]` → function ต้อง throw/return shape บอก mismatch

**Files:**
- `modules/accounting/auto_post.js`
- callsites: `modules/sales.js`, `modules/receipts.js`, `modules/delivery_invoices.js` (grep `voidJvForSource(`)

**Acceptance:** test new + existing tests ผ่าน, manual smoke = ลบ sale ที่ JV ถูก RLS block → toast แดง + ไม่มี duplicate JV

---

### B3 — M2 (Med) products.stock CAS divergence เมื่อ warehouse_stock fail

**Root cause:** ปัจจุบัน POS เขียน products.stock + warehouse_stock 2 ตาราง ถ้า warehouse_stock PATCH fail หลังจาก products.stock สำเร็จ → divergence

**Fix:** Atomic ผ่าน RPC function ใน Supabase (transactional) หรือ saga pattern (rollback products.stock ถ้า warehouse fail)
- ตัวเลือก A (เร็วกว่า): wrap เป็น `pos_sale_commit` Postgres function ใน SQL migration → atomic
- ตัวเลือก B (ไม่ต้อง migration): saga rollback ใน JS — เพิ่ม retry-rollback logic ใน `modules/stock_cas.js`

**Recommend:** A (มาตรฐานบัญชี ATM ใช้แบบนี้)

**Test:** `tests/stock_atomic.test.js` — mock 2 PATCH ที่ตัวที่ 2 fail → คาดหวัง state คืนเดิม

**Files:** `modules/pos.js`, `modules/stock_cas.js`, + new SQL `supabase-phase89-14-stock-atomic.sql`

**Acceptance:** test ใหม่ผ่าน, manual = simulate warehouse fail ผ่าน DevTools network → stock ไม่ลด

---

### B4 — M5 (Med) `products.js:100` inline `onerror` pattern เปราะ

**Root cause:** `getProductAvatar` ใช้ inline `onerror="..."` ใน template string → escape pattern พึ่ง `.charAt(0)` เฉยๆ ถ้า product.name มี `'` หรือ `"` → DOM injection

**Fix:** เปลี่ยนเป็น event delegation
- สร้าง `<img data-fallback-letter="X" data-fallback-bg="#XXX">` แล้ว attach `addEventListener('error', ...)` หลัง mount
- ลบ inline handler ทั้งหมด → CSP-friendly + ปลอดภัย XSS

**Test:** `tests/product_avatar.test.js` — render product ชื่อ `"O'Brien <script>"` → ไม่มี script tag ใน outerHTML

**Files:** `modules/products.js` (อย่างน้อย 2 จุด: avatar + image render)

**Acceptance:** test ใหม่ผ่าน, render ชื่อมี `'`/`"`/`<` ไม่ break, ถ้า image 404 → fallback letter ขึ้นถูก

---

### B5 — M3 (Med) `cash_recon.js:51` `.slice(0,10)` raw → TZ bug

**Root cause:** `String(s.created_at).slice(0,10)` ตัด ISO string ที่เป็น UTC โดยไม่ convert TZ → ลูกค้าขาย 23:30 BKK = UTC 16:30 (วันเดิม) แต่ถ้าลูกค้าขาย 00:30 BKK = UTC 17:30 ของ "วันก่อน" → ตกหล่นในรอบ recon

**Fix:** ใช้ helper `toBkkDate(iso)` ที่มีอยู่แล้วใน utils.js (จาก Phase 89.1 BKK fix) — grep ก่อน, ถ้ายังไม่มีให้สร้าง

```js
import { toBkkDate } from "./utils.js";
const expenses = state.expenses.filter(e => toBkkDate(e.expense_date) === _crDate);
```

**Test:** `tests/cash_recon_tz.test.js` — feed 5 expenses ที่ created_at คาบรอยต่อ 00:00 BKK → expect filter ตรง 5

**Files:** `modules/cash_recon.js` + `modules/utils.js` (ถ้าต้องเพิ่ม helper)

**Acceptance:** test ผ่าน, manual = สร้างใบเสร็จ 23:55 และ 00:05 BKK → cash_recon รวมถูกวัน

---

### B6 — M4 (Med) CSP `script-src 'unsafe-inline'` ยังอยู่

**Root cause:** ยังมี inline `<script>` ใน `index.html` (config init, theme bootstrap) + inline `on*` handlers ใน main.js + products.js

**Fix (2 phase):**
- Phase 1 (รอบนี้): ย้าย inline `<script>` ใน index.html → external file + nonce-based CSP
- Phase 2 (รอบหน้า): clean up `on*` inline handlers (จะถูก B4 จัดการบางส่วน)

**Test:** `tests/csp_compliance.test.js` — parse index.html → ไม่มี `<script>` ที่ไม่มี src และไม่มี `on\w+=` attributes (regex check)

**Files:** `index.html`, `_headers`

**Acceptance:** test ผ่าน, browser console ไม่มี CSP violation, app เปิดได้ปกติ

---

### B7 — M7 (Med) error_log RLS anon INSERT spam

**Root cause:** Publishable anon key ตอนนี้อนุญาต INSERT into `error_log` (เพื่อให้ unauth user แจ้ง error ได้) → bot ยิง spam ได้ไม่จำกัด

**Fix (SQL migration):**
- ใส่ rate-limit trigger: ถ้า IP/fingerprint INSERT เกิน N ครั้งใน M นาที → reject
- หรือใช้ `auth.uid() IS NOT NULL` แล้ว fallback ไป `/api/log-error` endpoint ผ่าน middleware rate limit แทน

**Recommend:** วิธี 2 — ย้าย error_reporter ให้ POST `/api/log-error` (รอ middleware rate limit) เฉพาะ anon, ส่วน auth user POST ตรง Supabase

**Test:** `tests/error_reporter_endpoint.test.js` — mock window.user → expect endpoint ที่ใช้เปลี่ยน

**Files:** `modules/error_reporter.js`, new `functions/api/log-error.js`, new SQL migration

**Acceptance:** test ผ่าน, manual = ยิง POST anon เกิน 10/min → 429

---

### B8 — L4 (Low) error_log payload เก็บ full URL → share token PII leak

**Root cause:** `modules/error_reporter.js` ส่ง `location.href` ดิบ → ถ้าเปิดหน้าที่มี `?share=TOKEN` ใน URL → token เข้า DB

**Fix:** strip query param `share`, `token`, `access_token` ออกก่อนเก็บ
```js
function sanitizeUrl(href) {
  const u = new URL(href);
  ["share","token","access_token","key"].forEach(k => u.searchParams.delete(k));
  return u.toString();
}
```

**Test:** `tests/error_reporter_sanitize.test.js` — input `https://x.com/?share=abc` → expect `https://x.com/`

**Files:** `modules/error_reporter.js`

**Acceptance:** test ผ่าน, payload ตัวอย่างใน console = URL สะอาด

---

### B9 — L2 (Low) `stock_cas.js` null → 0 → infinite CAS retry

**Root cause** (`modules/stock_cas.js:52`): `Number(rows[0][field] || 0)` ทำให้ field NULL กลายเป็น 0 → CAS condition `field=eq.0` PATCH ไม่เจอ row (database is NULL ไม่ใช่ 0) → retry loop จน max

**Fix:** แยก null กับ 0
```js
const raw = rows[0][field];
if (raw === null || raw === undefined) {
  return { ok:false, error: `${table}.${field} is NULL — initialize before CAS` };
}
before = Number(raw);
```

**Test:** `tests/stock_cas.test.js` — เพิ่ม case: row คืน `{stock: null}` → expect `ok:false, error contains "NULL"`

**Files:** `modules/stock_cas.js`

**Acceptance:** test ใหม่ + 33 เดิมผ่าน

---

## 2. Loop spec (Claude Code ทำเองทั้งหมด)

### Setup (รันครั้งเดียวก่อนเริ่ม)

```bash
git fetch origin
git checkout -b claude/phase-89-14-stab-batch-3 origin/main
npm test    # baseline ต้องเขียว
```

### วงรอบต่อบั๊ก (B1 → B9 ตามลำดับ ห้ามข้าม)

ทำทีละบั๊ก commit แยก:

```
loop bug_i in [B1..B9]:
  1. read AUTOFIX_PLAN.md section bug_i
  2. write failing test (red) — commit "test(89.14): add failing test for bug_i"
  3. run `npm test` → confirm new test fails, others ยังเขียว
  4. implement fix
  5. run `npm test` → all green
  6. self-review:
     - ไม่ได้แก้ test file ให้ลด assertion (diff vs HEAD~2)
     - ไม่ได้ touch file นอกขอบเขต (Files: section)
     - ไม่ได้เพิ่ม TODO/FIXME ใหม่
  7. commit "fix(89.14): bug_i — <root cause สั้นๆ>"
```

### Stop conditions

หยุดและขอ user เมื่อ:
- npm test fail หลัง retry 3 ครั้ง
- ต้อง modify file นอก "Files" section
- ต้องเพิ่ม SQL migration (user ต้องรันเองใน Supabase)
- เจอ bug ใหม่ที่ไม่ใช่ใน 9 รายการ → log ใน HANDOFF + create issue, ไม่แก้

### Final commit (หลัง B9 ผ่าน)

```bash
# bump version
# index.html: APP_BUILD 222 → 223
# sw.js: CACHE_NAME v222 → v223
# modules/settings/pages.js: build 222 → 223, version 5.43.18 → 5.43.19

# append HANDOFF.md เพิ่ม Phase 89.14 section
# (เลียนแบบ format ของ 89.13 section ที่มีอยู่)

git commit -am "chore(89.14): bump build 222→223 + HANDOFF Phase 89.14 summary"
git push -u origin claude/phase-89-14-stab-batch-3
gh pr create --fill --base main
```

---

## 3. Guardrails (สำคัญที่สุด)

1. **ห้ามแก้ test file เพื่อให้ผ่าน** — ถ้า test ใหม่ที่เพิ่ง write fail ต่อเนื่อง = สัญญาณว่า fix ผิด ไม่ใช่ test ผิด
2. **ห้าม touch file นอก "Files:" ของแต่ละบั๊ก** — ถ้าจำเป็น = stop + ขอ user
3. **ห้าม disable lint/test** หรือ skip CI
4. **Commit แยกตาม `test:` → `fix:`** ห้าม squash ระหว่างทาง — รีวิวง่าย rollback ง่าย
5. **บั๊กที่ต้อง SQL migration (B3, B7) → stop หลังเขียน .sql file + ขอ user รันเอง**
6. **ไม่แก้ branch main ตรงๆ** — ใช้ `claude/phase-89-14-*` เท่านั้น
7. **บั๊ก M1 (B2) มีผลทางบัญชี** — หลังเขียน test + fix ให้ stop + ขอ user verify smoke test ก่อน proceed B3

---

## 4. Verification หลัง merge

ผู้ใช้ทำเอง (ใน HANDOFF Phase 89.14 section ให้ Claude Code list ไว้ครบ):
1. Ctrl+Shift+R — confirm cache v223
2. Footer build = 223
3. Smoke ต่อบั๊กตามตาราง Acceptance ข้างบน
4. ตรวจ Supabase logs 30 นาทีหลัง deploy — error rate ต้องไม่กระโดด

---

## 5. Prerequisite — Tooling ที่ต้อง merge ก่อนเริ่ม B1

ต้องทำตาม `SETUP_TOOLING.md` แล้ว merge branch `claude/phase-89-14-tooling-setup` เข้า main ก่อน:

- ESLint flat config (`eslint.config.js`) + scripts `lint` / `lint:fix`
- Playwright + smoke tests (`tests/e2e/smoke.spec.js`, 9 checks)
- Script `verify` = lint + unit + e2e (Claude Code loop เรียกตัวนี้)
- CI workflow แยก 2 jobs: `lint-and-unit` → `e2e`

**Gate รวม:** Claude Code ต้องผ่าน `npm run verify` ก่อน commit ทุกบั๊ก

## 6. ถ้ามีเวลาเหลือ (out-of-scope batch นี้ — list ใน HANDOFF)

- เพิ่ม Prettier + format-on-save config
- ขยาย Playwright: login flow จริง (ต้อง Supabase test project)
- เพิ่ม test coverage report (c8) target ≥ 30%
- ลบ inline `on*=` handlers ที่เหลือทั่ว main.js (M4 phase 2)
- เปิด eslint rule ที่ปิดไว้ตอน setup ทีละตัว (`no-unused-vars`, etc.)
