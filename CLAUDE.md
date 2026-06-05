# CLAUDE.md — Boonsook POS V5 · Project & Code Review Guide

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

## 2. คำสั่งที่ใช้ตรวจ (gate ก่อน merge)

```bash
npm run verify        # = lint && test && test:e2e  ← gate ทอง ต้องเขียวก่อน merge
npm run lint          # eslint . --max-warnings=99999
npm run lint:errors   # เฉพาะ error (ตัวที่ block CI จริง)
npm test              # node --test tests/*.test.js
npm run test:e2e      # playwright test
```

CI (`.github/workflows/test.yml`) รันบน push เข้า `main` / `claude/**` และ PR เข้า `main`: install → lint → unit → playwright → e2e. **PR ที่ทำให้ขั้นใดขั้นหนึ่งแดง = ห้ามผ่าน**

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
