# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Boonsook POS V5 · Project & Code Review Guide.** This file is read on every run (including automated PR review). It is the authoritative guardrail spec; [`project-patterns.md`](project-patterns.md) is the practical companion and [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) is the canonical session protocol; [`EXTERNAL_TEAM_PROTOCOL.md`](EXTERNAL_TEAM_PROTOCOL.md) is the multi-team collaboration rulebook (ทีม/AI agent ภายนอกทุกทีมอ่านก่อนเริ่มงานแรก).

> Phase prompt quality: read [`PROMPT_PHASE_BRIEF_SKILL.md`](PROMPT_PHASE_BRIEF_SKILL.md) before drafting, reviewing, or implementing a phase prompt. It defines the baseline/scope/failure-semantics/test/report structure expected by the owner and Codex.

> ไฟล์นี้ถูกอ่านโดย Claude ทุกครั้งที่รัน (รวมถึงตอนรีวิว PR อัตโนมัติ)
> เป้าหมาย: ให้การรีวิวเข้มในจุดที่เสี่ยงเงิน/ข้อมูลจริง และปล่อยผ่านเรื่องจุกจิกที่ไม่ใช่บั๊ก
> ภาษา: ตอบรีวิวเป็น **ภาษาไทย** ได้ (ศัพท์เทคนิคใช้ภาษาอังกฤษ) ให้สั้น ตรงจุด อ้าง `file:line` เสมอ

> **ทีม implement (Claude Code) — อ่าน [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) ก่อนเริ่มงานทุก session**
> เป็น **implement workflow** (STEP 0–7) สำหรับการลงมือแก้โค้ด — *ไม่ใช่* review checklist ของไฟล์นี้ (ผู้รีวิว PR อัตโนมัติข้ามย่อหน้านี้ได้ ไม่ใช่เกณฑ์รีวิว)
> **ห้ามเริ่มแก้ไฟล์ก่อนทำ STEP 0–2 ให้ครบ** (อ่านบันทึกกลาง → sync repo → ยืนยัน scope) และต้อง **หยุดหลังจบ phase เพื่อรอ review**

---

## 1. โปรเจกต์นี้คืออะไร

Boonsook POS PRO V5 — ระบบขายหน้าร้าน (POS) สำหรับร้านในไทย เป็น **PWA** ที่ทำงาน offline ได้ มีโมดูลครบตั้งแต่ขายของ, สต๊อก, ลูกค้า/loyalty, จนถึง**ระบบบัญชีคู่ (double-entry) เต็มรูปแบบ** (VAT, journal entries, period close).

**Tech stack**
- Frontend: **Vanilla JS (ES modules)** — `"type": "module"`, ไม่มี build step / ไม่มี framework. โหลดโมดูลตรงจาก `modules/*.js`
- Backend: **Supabase** (Postgres + Row Level Security) + **Cloudflare Pages Functions** (`functions/api/*.js`)
- PWA: service worker `sw.js`, `manifest.json`, `offline.html`
- Test: `node --test` (unit ใน `tests/`) + **Playwright** (e2e ใน `tests/e2e/`)
- Lint: ESLint 10 (`eslint.config.js`)
- Runtime: Node >= 20

**ห้ามทึกทักว่ามี React/Vue/TypeScript/bundler** — โค้ดเป็น JS ล้วน รันตรงในเบราว์เซอร์ การรีวิวต้องตั้งอยู่บนข้อเท็จจริงนี้

---

## 1.5 สถาปัตยกรรมภาพรวม (อ่านก่อนแก้ของข้ามไฟล์)

จุดที่ต้องเข้าใจเพราะกระจายหลายไฟล์ — อ่านโค้ดไฟล์เดียวจะมองไม่เห็น:

- **Entry & app shell** — `index.html` โหลด `selfheal.js` → `boot.js` (loading overlay + ลงทะเบียน Service Worker + แบนเนอร์อัปเดต) → `main.js`. `main.js` เป็น **monolith ~280KB** เป็นทั้ง router + state + ตัวเชื่อม Supabase: มัน`import` ฟีเจอร์จาก `modules/*.js` แล้ว map เข้าหน้าจอ. โมดูลส่วนใหญ่ export ฟังก์ชัน `renderXxxPage(...)` ที่ `main.js` เรียกตาม nav. โมดูลหนักหลายตัวถูก **lazy-import** (โหลดตอนเปิดหน้านั้น) — ดูคอมเมนต์ `// Phase 89.20/89.21 ... lazy` ใน `main.js`.
- **ไม่มี build step จริง ๆ** — เบราว์เซอร์โหลด ES modules ตรงจาก path. dependency ภายนอกตัวเดียวคือ Supabase client ที่ `import` จาก CDN `https://esm.sh/@supabase/supabase-js@2`. `package.json` มีแต่ devDeps (eslint, playwright) — runtime deps ว่างเปล่า.
- **Backend = Supabase + Cloudflare Pages Functions** — ตรรกะข้อมูลเกือบทั้งหมดเป็น Supabase REST/RPC ตรงจาก client โดยมี **RLS เป็นด่านความปลอดภัยจริง**. `functions/api/*.js` เป็น serverless proxy เฉพาะงานที่ต้องซ่อน secret หรือเรียก 3rd-party (`send-otp`, `verify-otp`, `verify-slip` SlipOK, `parse-receipt` Gemini OCR, `ai-assistant`, `line-notify`, `v1/reports/daily-summary`). `functions/_middleware.js` ครอบ `/api/*` ทุกตัว: CORS + rate-limit (Cloudflare KV) + JWT/role check ก่อนถึง handler.
- **Schema & RLS อยู่ในไฟล์ `supabase-*.sql`** — เป็น migration เรียงตาม phase (เช่น `supabase-phase88-accounting-foundation.sql`, `supabase-rls-policies.sql`). **ต้องรันด้วยมือใน Supabase SQL editor** ไม่มี migration runner อัตโนมัติ — แก้ schema = เพิ่มไฟล์ SQL ใหม่ + บอก owner ให้รัน + `NOTIFY pgrst, 'reload schema';` หลัง `ALTER TABLE`.
- **Auto-posting accounting** — การขาย/บิลบริการ/ค่าใช้จ่าย โพสต์ JV อัตโนมัติผ่าน `modules/accounting/auto_post.js` (eager import ใน checkout flow) แมป account ตาม `coa.js`; โพสต์ซ้ำไม่ได้ (idempotent ด้วย `source_table` + `source_id`); void ผ่าน `voidJvForSource`. งบ (`trial_balance.js`/`profit_loss.js`/`balance_sheet.js`) อ่านจาก journal lines ที่โพสต์ไว้.
- **Offline/PWA** — `sw.js` (~210KB) cache app shell; `modules/_offline_queue.js` คิวการเขียนตอน offline แล้ว reconcile เมื่อ online. การ deploy ขึ้นกับ **build/cache markers ที่ต้อง bump พร้อมกัน** (ดู §4.6 + `project-patterns.md`): `data-app-build` & `selfheal.js?v=` & `main.js?v=` ใน `index.html` และ `CACHE_NAME` ใน `sw.js`.
- **Tests** — unit เป็น `node --test` ล้วน (no framework) ใน `tests/*.test.js`; pattern เด่นคือ `*_guard.test.js` ที่ extract function body แล้ว regex/assert invariant กันเงิน/สต็อก regression. e2e เป็น Playwright (`tests/e2e/*.spec.js`) เสิร์ฟด้วย `scripts/static-server.js` (Node built-in, zero dep). สคริปต์ verify เพิ่มเติม (`scripts/*.js`) ยิง Supabase จริงเพื่อตรวจ integrity บัญชี/JE/RLS.

**เลข build/version จริง = `data-app-build` + `data-app-version` ใน `index.html`** (source of truth — ไม่ระบุเลขตายตัวที่นี่ กันค้าง). `version` ใน `package.json` มักตามหลัง build marker — ยึด marker ใน `index.html` เป็นเลขจริงเสมอ.

---

## 2. คำสั่งที่ใช้ตรวจ (gate ก่อน merge)

```bash
npm run verify        # = lint && test && test:e2e  ← gate ทอง ต้องเขียวก่อน merge
npm run lint          # eslint . --max-warnings=99999
npm run lint:errors   # เฉพาะ error (ตัวที่ block CI จริง) — 0 errors required
npm test              # node --test tests/*.test.js  (unit ทั้งหมด)
npm run test:e2e      # playwright test  (e2e ผ่าน scripts/static-server.js เอง)

# รัน unit ทีละไฟล์ / ทีละ test
node --test tests/pos.test.js                         # ไฟล์เดียว
node --test --test-name-pattern="multi payment" tests/multi_payment_guard.test.js

# รัน e2e ทีละ spec / ดูแบบ headed
npx playwright test tests/e2e/smoke.spec.js
npx playwright test --headed

# เสิร์ฟแอป local (PWA, static, zero dep) — ใช้กับ playwright หรือเปิดเองที่ :4173
node scripts/static-server.js 4173
```

สคริปต์ verify เพิ่มเติม (ยิง **Supabase จริง** — ต้องมี env/key) สำหรับงานเสี่ยงสูง:

```bash
npm run verify:accounting   # node scripts/accounting_integrity_smoke.js  (A1–A6 ความถูกต้องบัญชี)
npm run verify:je           # node scripts/verify_je_fix.js  (journal entries บาลานซ์)
npm run verify:security     # node scripts/leave_spoof_test.js  (ทดสอบ RLS/spoof)
npm run backfill:orphans    # node scripts/backfill_orphan_journals.js  (ปะ JV ที่หลุดโพสต์)
```

CI (`.github/workflows/test.yml`) รันบน push เข้า `main` / `claude/**` และ PR เข้า `main`: install → lint → unit → playwright → e2e. **PR ที่ทำให้ขั้นใดขั้นหนึ่งแดง = ห้ามผ่าน**. Deploy (`.github/workflows/main.yml`) ยิงเฉพาะ push เข้า `main` (หรือ `workflow_dispatch` สำหรับ preview build) → Cloudflare Pages `boonsook-pos-v5.pages.dev` + build Docker image. หลัง push ต้องเช็คทั้ง Actions conclusion **และ** live build marker บน canonical URL.

---

## 3. คอนเวนชันที่ต้องเคารพ

- **Branch**: `claude/phase-NN-xx-<slug>` (เช่น `claude/phase-92-11-fix-void`)
- **ES modules เท่านั้น**: ใช้ `import`/`export` — ห้าม `require()`
- **ไม่มี runtime dependency**: ปัจจุบัน `dependencies` ว่าง มีแต่ devDeps (eslint, playwright) — **PR ที่เพิ่ม npm dependency ใหม่ต้อง flag และถามเหตุผลเสมอ** อย่าปล่อยผ่านเงียบ ๆ
- **ESLint policy** (สำคัญ — ยึดตาม `eslint.config.js`):
  - กลุ่ม **real-bug = `error`** (block CI): `no-eval`, `no-implied-eval`, `no-new-func`, `no-async-promise-executor`, `no-throw-literal`, `no-dupe-keys`, `no-unsafe-optional-chaining`, `no-loss-of-precision`, `use-isnan`, `valid-typeof`, `no-undef` ฯลฯ → **โค้ดใหม่ห้ามสร้าง error เหล่านี้เพิ่มเด็ดขาด**
  - กลุ่ม **style = `warn`** (เห็นได้แต่ไม่ fail): `prefer-const`, `no-unused-vars` (ignore prefix `_`), `no-empty` (allow empty catch) → ชี้แนะได้ แต่ไม่ใช่เหตุ block PR
  - หลักการรวม: **0 errors, warnings ทยอยแก้** — อย่าเรียกร้องให้แก้ warning ที่ไม่เกี่ยวกับ diff ของ PR

---

## 4. จุดที่ต้องรีวิว "เข้มเป็นพิเศษ" (เรียงตามความเสี่ยง)

นี่คือหัวใจของไฟล์นี้ ระบบนี้จัดการเงินจริงและข้อมูลลูกค้าจริง ให้ถือว่าทุกข้อด้านล่างเป็น **blocking** เว้นแต่พิสูจน์ได้ว่าปลอดภัย

### 4.1 ความถูกต้องของเงิน & ธุรกรรม (ระดับสูงสุด)
ไฟล์เกี่ยว: `modules/pos.js`, `payment_gateway.js`, `cash_recon.js`, `credit_tracker.js`, `functions/api/verify-slip.js`
- การคำนวณยอด/ทอน/ส่วนลด/VAT ต้องถูกต้องเป๊ะ — **ระวัง floating point**: เงินควรคิดเป็นหน่วยเล็กสุด (สตางค์) หรือปัดด้วยกฎที่ชัดเจน ห้ามปล่อย `0.1 + 0.2` ลอย ๆ
- **VAT 7%** — ตรวจว่าแยก inclusive/exclusive ถูก และปัดเศษตามที่ระบบบัญชีคาดหวัง
- **multi-payment / quick-pay / void / refund**: ผลรวมการชำระต้องเท่ายอดบิลเสมอ การ void/refund ต้อง reverse รายการที่เกี่ยวข้อง (รวม loyalty points — ดู `loyalty_reverse_sale.test.js`)
- มี test guard อยู่แล้ว: `multi_payment_guard`, `quick_pay_guard`, `checkout_inflight` — **ถ้า PR แตะ flow การชำระเงินแต่ไม่แตะ/ไม่เพิ่ม guard test → flag**

### 4.2 Concurrency & idempotency
ไฟล์เกี่ยว: `modules/_inflight_guard.js`, `pos.js` (checkout), stock logic
- **สต๊อกใช้ compare-and-swap (CAS)** — ดู `tests/stock_cas.test.js` การตัดสต๊อกต้องกันการขายเกิน (oversell) เมื่อมีหลาย request พร้อมกัน อย่าเปลี่ยนเป็น read-modify-write ธรรมดา
- การ checkout ต้องกันกดซ้ำ/ยิงซ้ำ (inflight guard, idempotency key) — flag ทุกจุดที่ลบหรือ bypass guard
- ระวัง race ระหว่าง offline queue กับ online sync

### 4.3 บัญชีคู่ (double-entry) ต้องบาลานซ์
ไฟล์เกี่ยว: `modules/accounting/*` (`journals.js`, `journal_form.js`, `auto_post.js`, `trial_balance.js`, `balance_sheet.js`, `profit_loss.js`, `periods.js`)
- ทุก journal entry: **ผลรวม debit = ผลรวม credit** ห้ามมี JE ที่ไม่บาลานซ์หลุดออกไป
- `auto_post` (โพสต์อัตโนมัติจากการขาย) ต้องแมป account ถูกตาม chart of accounts (`coa.js`) — ดู `tests/auto_post.test.js`
- **Period close** ต้องล็อก — ห้ามแก้/โพสต์ย้อนเข้า period ที่ปิดแล้ว ตรวจว่า PR ไม่เปิดช่องนี้
- การแก้สูตรงบ (trial balance / P&L / balance sheet) ต้องมาคู่กับ test

### 4.4 ความปลอดภัย & multi-tenant isolation
ไฟล์เกี่ยว: `modules/auth*.js`, `permission_matrix.js`, `functions/_middleware.js`, `functions/api/*`, ไฟล์ `supabase-*.sql`
- **Supabase RLS คือเส้นแบ่งความปลอดภัยจริง** การเช็คสิทธิ์ฝั่ง client (`permission_matrix.js`) เป็นแค่ UX — **ห้ามพึ่ง client-side check เป็นด่านความปลอดภัย** ข้อมูลทุก table ที่เข้าถึงได้ต้องมี RLS policy คุม
- **`anonKey` ใน `supabase-config.js` เปิดเผยได้ตามปกติ** (publishable key) — แต่ **`service_role` key ห้ามโผล่ฝั่ง client เด็ดขาด** ต้องอยู่ใน Cloudflare Function env เท่านั้น flag ทันทีถ้าเจอ secret/service key ใน bundle หน้าเว็บ
- ตรวจ RLS SQL ใหม่ทุกไฟล์ `supabase-*.sql`: policy ต้อง scope ด้วย tenant/shop id ไม่หลุดข้ามร้าน
- OTP/auth (`auth_otp.js`, `send-otp`, `verify-otp`, `otp_cooldown.js`): ต้องมี rate-limit/cooldown, ห้าม log OTP, ห้ามตอบต่างกันจน enumerate ได้ — ดู `otp_verify_guard.test.js`

### 4.5 XSS / DOM injection
- โค้ดสร้าง HTML ด้วยมือใน vanilla JS → **`innerHTML` กับข้อมูลผู้ใช้คือความเสี่ยงอันดับหนึ่ง** ทุกค่าที่มาจาก user/DB ต้อง escape หรือใช้ `textContent`/DOM API
- มี `tests/xss_regression.test.js` อยู่แล้ว — PR ที่เพิ่มจุด render ใหม่ด้วย `innerHTML`/template string ต้องถูกตรวจและถ้าเสี่ยงให้เพิ่ม regression test
- ระวัง `eval`/`new Function`/`setTimeout("string")` — ESLint บล็อกอยู่แล้ว แต่ให้ย้ำในรีวิว

### 4.6 PWA / Service Worker / offline
ไฟล์เกี่ยว: `sw.js`, `boot.js`, `lazy_libs.js`, `manifest.json`
- เปลี่ยน `sw.js` หรือ cache strategy ต้อง **bump cache version / cache-bust** มิฉะนั้น user ติด asset เก่า — ดู `lazy_import_cache_bust.test.js`, `boot_periodic_sw_update.test.js`
- ห้าม cache ข้อมูลอ่อนไหว (ใบเสร็จ/ข้อมูลลูกค้า) ในที่ที่ไม่ตั้งใจ
- offline write ต้อง reconcile กับ server เมื่อกลับมา online โดยไม่ทำข้อมูลซ้ำ/หาย

### 4.7 Timezone & locale (ไทย)
- ใช้เขต **Asia/Bangkok** การกรอง "วันนี้/ช่วงวันที่" ต้องคิดบน timezone ร้าน ไม่ใช่ UTC — ดู `tz_today_filter.test.js`
- การ format เงิน/ตัวเลข/วันที่แบบไทยต้องผ่าน util กลาง (`utils_formatters` — ดู `utils_formatters.test.js`) อย่า hardcode รูปแบบเอง

### 4.8 Error handling & audit
ไฟล์เกี่ยว: `modules/audit_log.js`, `error_reporter.js`, `error_codes*.js`, `functions/api/log-error.js`
- ห้ามกลืน error เงียบ ๆ (จับแล้วเฉย) ในเส้นทางการเงิน/บัญชี — ต้อง log ผ่าน `error_reporter` และมี error code
- การกระทำที่กระทบเงิน/สิทธิ์ (void, refund, แก้ราคา, เปลี่ยน permission) ควรลง `audit_log`
- ระวัง log ข้อมูลอ่อนไหว (PII, OTP, token) ลงไปในข้อความ error

---

## 5. ข้อกำหนดเรื่อง Test

- โค้ดใหม่ในเส้นทางการเงิน/บัญชี/สิทธิ์ **ต้องมาพร้อม test** (unit หรือ e2e) — pattern ของโปรเจกต์นี้คือไฟล์ `*_guard.test.js` สำหรับเงื่อนไขที่ต้องกันพลาด
- แก้บั๊ก = เพิ่ม regression test ที่ fail ก่อนแก้ และ pass หลังแก้
- อย่าลบ/ปิด test เพื่อให้ CI เขียว — ถ้า test เก่าผิดจริงให้ระบุเหตุผลชัดเจนใน PR

---

## 6. รูปแบบผลรีวิว PR ที่อยากได้

- จัดลำดับด้วยความรุนแรง: **Blocking** (เงิน/ความปลอดภัย/ข้อมูล) → **Should-fix** → **Nit/style**
- แต่ละข้อ: อ้าง `path:line`, อธิบายสั้น ๆ ว่าเสี่ยงอะไร, เสนอวิธีแก้ที่เป็นรูปธรรม
- ถ้า diff สะอาดและปลอดภัย → บอกชัดว่า "ผ่าน" ไม่ต้องหาเรื่องติแบบ style ที่ ESLint ตั้งเป็น warn อยู่แล้ว
- อย่าเรียกร้องให้ refactor โค้ดที่ไม่อยู่ใน diff ของ PR เว้นแต่มันคือต้นเหตุของบั๊กที่กำลังแก้

---

## 7. สิ่งที่ "ไม่ต้อง" ทำ

- ไม่ reformat / จัด indent โค้ดที่ไม่เกี่ยวกับ PR (ทำให้ diff อ่านยาก)
- ไม่เปลี่ยน vanilla JS เป็น framework / ไม่เสนอ TypeScript migration ในรีวิว PR ปกติ
- ไม่ลดความเข้มของ RLS หรือ ESLint error rules เพื่อให้ผ่าน
- ไม่เพิ่ม dependency โดยไม่มีเหตุผลรองรับ
