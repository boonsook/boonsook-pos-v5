# Claude Code — Phase 89.41 Autonomous Prompt (HIGH_RISK Race Fixes)

> **วิธีใช้:** เปิด terminal ที่ root ของ repo บน branch `claude/phase-89-41-high-risk-fixes`
> รัน `claude --dangerously-skip-permissions` แล้ว **paste ทั้งบล็อกข้างล่าง** (ตั้งแต่ `## Mission` จนถึงท้ายไฟล์)
> **Type:** Logic fix (race condition guard) + TDD + build bump
> **Source of truth:** `AUDIT_REPORT_89_40.md` Top 10 Priority Fixes section

---

## Mission

คุณคือ engineer ของ Boonsook POS V5 ในรอบ **Phase 89.41 — HIGH_RISK race condition fixes**

**Context:**
- Phase 89.40 audit จัด 138 `require-atomic-updates` warnings เป็น 4 buckets
- HIGH_RISK = 6 warnings ใน **2 real sites** (checkout cart-reset paths)
- ทั้ง 2 sites เป็น checkout double-click race — กดปุ่ม "ชำระเงิน" / "สั่งซื้อ" 2 ครั้งเร็วๆ → 2 handlers ทำงานทับกัน → cart state ไม่ตรง
- รอบนี้ **ใช้ pattern เดียวกัน** (`_checkoutInflight` flag) แก้ทั้ง 2 sites + TDD required ทุก fix

**เป้าหมาย:** Fix 6 HIGH_RISK warnings (2 real bug sites) + reduce warnings 147 → 141

---

## Scope — 2 real sites, 6 warnings resolved

### Site 1 — `main.js` POS checkout (1 warning)

**Function:** `async function checkout()` ที่ **main.js:3641**
**ESLint flag:** **main.js:3696** `state.cart = []` (หลัง `await loadReceipt(saleId)`)

**Issue:**
```js
async function checkout(){
  if (!state.cart.length) return showToast("ยังไม่มีสินค้าในบิล");  // line 3642
  // ... สร้าง sale + sale_items + ตัดสต็อก ... (await ทุกขั้น)
  await loadReceipt(saleId);                                          // line 3695
  state.cart = [];                                                    // line 3696 — race
  saveCart();
  // ...
}
```

**Race scenario:**
1. User กดปุ่ม "ชำระเงิน" ครั้งที่ 1 → handler A เข้า, ผ่าน `state.cart.length` check, await sale insert
2. User กดอีกครั้งระหว่างรอ (network slow) → handler B เข้า, `state.cart` ยังไม่ถูก reset → ผ่าน check, await sale insert ครั้งที่ 2
3. → **2 sales บันทึก, 2 ใบเสร็จ, ตัดสต็อก 2 รอบ**

**Recommended fix (Pattern A — module-level inflight flag):**
```js
// ที่ top ของ main.js (หรือใกล้ checkout function) — เพิ่มตัวแปร module-scope:
let _checkoutInflight = false;

async function checkout(){
  if (_checkoutInflight) return;                          // ★ entry guard
  if (!state.cart.length) return showToast("ยังไม่มีสินค้าในบิล");
  _checkoutInflight = true;                               // ★ set lock
  try {
    // ... existing logic (ยกเข้า try block) ...
    await loadReceipt(saleId);
    state.cart = [];
    saveCart();
    // ... rest ...
  } finally {
    _checkoutInflight = false;                            // ★ release lock
  }
}
```

**Defense in depth (optional, แนะนำ):**
- ที่ click handler ของปุ่ม "ชำระเงิน" → `btn.disabled = true` ตอนเข้า, `btn.disabled = false` ตอนจบ
- หา handler ที่เรียก `checkout()` (grep `onclick.*checkout` หรือ `addEventListener.*checkout`)

---

### Site 2 — `modules/customer_dashboard.js` Customer checkout (5 warnings)

**Handler entry:** ~line 985-1017 (มี btn disable ที่ line 1014-1015 + try block ที่ 1017)
**ESLint flags:**
- **customer_dashboard.js:1104** `_custCart = []`
- **customer_dashboard.js:1106 col 7** `_custSlipData = null`
- **customer_dashboard.js:1106 col 29** `_custSlipVerified = false`
- **customer_dashboard.js:1106 col 56** `_custSlipResult = null`
- **customer_dashboard.js:1106 col 80** `_custSlipUrl = null`

> หมายเหตุ: 4 vars ที่ line 1106 อยู่บรรทัดเดียวกัน → fix 1 ครั้ง resolve 4 warnings

**Issue:**
```js
// handler (customer checkout button click)
const btn = container.querySelector("#custCheckoutBtn");
if (btn) { btn.disabled = true; btn.textContent = "กำลังสั่งซื้อ..."; }   // line 1014-1015

try {
  // ... POST service_jobs + items + LINE notify (await ทุกขั้น) ...
  _custCart = [];                                                          // line 1104 — race
  saveCustCart();
  _custSlipData = null; _custSlipVerified = false;
  _custSlipResult = null; _custSlipUrl = null;                             // line 1106 — race (4 vars)
  // ... renderCustomerDashboard + loadAllData ...
} catch(e) { ... }
```

**Race scenario:** ลูกค้ากด "สั่งซื้อ" 2 ครั้งเร็วๆ → btn.disabled มาทีหลัง try block แต่ check ยังไม่ atomic → 2 handlers สามารถเข้าได้

**Recommended fix (เหมือน Site 1):**
```js
// ที่ top ของ customer_dashboard.js — module-scope flag:
let _custCheckoutInflight = false;

// ใน checkout handler:
async function _handleCustCheckout() {  // หรือชื่อจริงของ handler
  if (_custCheckoutInflight) return;                       // ★ entry guard (BEFORE btn check)
  // ... existing validation (chkName, chkPhone, etc.) ...
  _custCheckoutInflight = true;                            // ★ set lock
  const btn = container.querySelector("#custCheckoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังสั่งซื้อ..."; }

  try {
    // ... existing try logic ...
    _custCart = [];
    saveCustCart();
    _custSlipData = null; _custSlipVerified = false;
    _custSlipResult = null; _custSlipUrl = null;
    // ...
  } catch(e) { ... }
  finally {
    _custCheckoutInflight = false;                         // ★ release lock
    if (btn) { btn.disabled = false; }                     // re-enable btn if not navigated away
  }
}
```

**Note:** อ่าน context รอบ handler entry (~line 980-1017) เพื่อหา async function wrapper ที่ถูกต้อง (อาจเป็น arrow function ใน addEventListener)

---

## Pre-flight

```bash
git status
git log --oneline HEAD..origin/main 2>&1 | head -5
node --version
npm run verify
```

**Acceptance:**
- Branch: `claude/phase-89-41-high-risk-fixes`
- Working tree: clean (untracked docs OK)
- HEAD = origin/main + this prompt commit
- 3 gates เขียว (lint 0 errors, 97 unit, 10 e2e)

**ถ้าไม่ผ่าน → STOP + report**

---

## Workflow — TDD per site, max 10 commits

### Phase A: Site 1 — main.js POS checkout

#### A.1 Write regression test (TDD — red phase)

สร้างไฟล์ `tests/checkout_inflight.test.js` (POS checkout double-click guard):

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// Strategy: import เฉพาะ checkout function (ถ้า export ได้) หรือ mock state + spy
// ถ้า main.js ไม่ export checkout → ใช้ test pattern ที่:
//   1. เรียก checkout() พร้อมกัน 2 ครั้ง (Promise.all)
//   2. Assert: เห็น insert sale 1 ครั้ง (ไม่ใช่ 2)
//   3. Assert: ครั้งที่ 2 returns immediately (no-op)

// ถ้า main.js เขียน test ตรงไม่ได้ (DOM-heavy + global state) →
//   - แยก `_checkoutInflight` flag + guard logic เป็น helper function
//   - import helper + test helper isolation
//   - หรือ flag + ใช้ E2E test แทน (manual smoke)
```

**ถ้าเขียน test ยากเกิน 30 นาที สำหรับ Site 1** → flag + ใช้ smoke test manually แทน + report ทันที (อย่าฝืน)

#### A.2 Run test → confirm red

```bash
npm test 2>&1 | findstr "checkout_inflight"
```

ต้องเห็น test fail (เพราะ guard ยังไม่ implement)

#### A.3 Commit test (red)

```
test(89.41): Site 1 regression — POS checkout double-click guard
```

#### A.4 Implement fix

แก้ตาม **Recommended fix Pattern A** ใน Site 1:
- เพิ่ม `let _checkoutInflight = false;` ที่ module scope (top ของ main.js หรือใกล้ checkout function)
- เพิ่ม entry guard ที่ line 3641 (ก่อน `state.cart.length` check)
- Wrap existing body ใน `try { ... } finally { _checkoutInflight = false; }`

#### A.5 Verify green

```bash
npm run verify
```

ทุก gate เขียว + test ใหม่ pass + warning main.js:3696 หาย

#### A.6 Commit fix

```
fix(89.41): Site 1 — _checkoutInflight guard in POS checkout (main.js:3641,3696)
```

---

### Phase B: Site 2 — customer_dashboard.js customer checkout

#### B.1 Write regression test (TDD — red phase)

เพิ่ม test ใน `tests/checkout_inflight.test.js` (รวมกับ Phase A) หรือไฟล์ใหม่ `tests/cust_checkout_inflight.test.js`:

```js
// Test: customer checkout double-click → 1 service_job (ไม่ใช่ 2)
// Similar strategy ของ Phase A
```

**ถ้าเขียน test ยากเกิน 30 นาที** → flag + smoke test แทน + report

#### B.2 Confirm red, commit test

```
test(89.41): Site 2 regression — customer checkout double-click guard
```

#### B.3 Implement fix

แก้ตาม Pattern เดียวกับ Site 1:
- เพิ่ม `let _custCheckoutInflight = false;` ที่ module scope
- Entry guard ก่อน validation (line ~985)
- Wrap existing body ใน try/finally (อาจมี try block อยู่แล้วที่ line 1017 — extend หรือ wrap outer)

#### B.4 Verify green

```bash
npm run verify
```

ทุก gate เขียว + warnings line 1104, 1106 (×4) หาย

#### B.5 Commit fix

```
fix(89.41): Site 2 — _custCheckoutInflight guard in customer checkout (customer_dashboard.js:1104,1106)
```

---

### Phase C: Build bump 241 → 242 (REQUIRED — runtime change)

ทั้ง 2 fixes มี runtime behavior change (block 2nd checkout attempt) → **ต้อง bump build**

#### C.1 Update version refs (sync ทั้งหมด)

แก้ทุกจุดให้ build 241 → 242:

1. **`index.html`** — `data-app-build="241"` → `"242"`
2. **`index.html`** — `<script src="./selfheal.js?v=241">` → `?v=242`
3. **`index.html`** — `<script src="./main.js?v=241">` → `?v=242`
4. **`index.html`** — `<script src="./boot.js?v=241">` → `?v=242`
5. **`index.html`** — `<link href="./style.css?v=241">` → `?v=242`
6. **`sw.js`** — `CACHE_NAME = 'boonsook-pos-v5-cache-v241'` → `v242`
7. **`modules/settings/pages.js`** — version `"5.43.37"` → `"5.43.38"` + build `241` → `242`

**Verify ก่อน commit:**
```bash
findstr "241" index.html sw.js modules/settings/pages.js
```

ต้องเหลือแค่ comment/log entries ไม่ใช่ active version refs

#### C.2 Run e2e smoke test

```bash
npm run test:e2e
```

ต้อง pass — smoke test (Phase 89.36 hardening) จะตรวจ sync ของ `?v=` refs ทั้งหมด

#### C.3 Commit bump

```
chore(89.41): bump build 241 → 242 (runtime change — race guard added)
```

---

## Hard rules (เข้มกว่าเดิม — race fix เปราะ)

1. **TDD required ทั้ง 2 sites** — test ต้อง fail ก่อน fix (red→green)
2. **ห้ามแก้ test ให้ผ่าน** — ถ้า test fail หลัง fix = fix ผิด ไม่ใช่ test ผิด
3. **ห้ามแตะ source นอก 2 sites ที่ระบุ** — main.js `checkout()` function + customer_dashboard.js checkout handler เท่านั้น
4. **ห้าม "while I'm here" cleanup** — เห็น race warning อื่นๆ ระหว่างทาง → ข้าม (รอ Phase 89.42)
5. **ห้าม install npm package**
6. **ห้าม push** — รอ user review + push เอง
7. **Commit แยกตามไฟล์ + แยก test/fix** — pattern: test commit (red) → fix commit (green) ต่อ site
8. **Max 10 commits** — ถ้าเกิน → scope creep → STOP
9. **Max 2 hr wall clock** — ถ้าเกิน → finish current site + STOP + partial report
10. **ถ้า TDD test เขียนยากเกิน 30 นาที สำหรับ site ใด** → STOP site นั้น + flag + ขอ user decide (smoke-only path)
11. **Build bump = REQUIRED** — ห้ามข้าม Phase C (runtime change)

---

## Stop conditions

หยุดทันที + ขอ user เมื่อ:

- เขียน test สำหรับ site ใดเกิน 30 นาที (DOM coupling / global state ซับซ้อน)
- `npm run verify` fail หลังพยายาม 3 ครั้งต่อ fix เดียว
- เจอ side-effect ที่ไม่คาด (เช่น checkout test ทำให้ stock_cas tests แดง)
- เจอ checkout function เรียกซ้อนกัน (recursive call) → guard อาจ deadlock
- เจอ pattern ที่ทำให้สงสัยว่า fix ควรซับซ้อนกว่า (e.g., needs Promise queue ไม่ใช่ flag)
- e2e smoke test fail หลัง bump build (`?v=` sync mismatch)

---

## Reporting format

### เมื่อจบ batch

```
## Phase 89.41 — DONE

### Site 1 — main.js POS checkout
- Test commit (red): <hash>
- Fix commit (green): <hash>
- Lines changed: ~10 (module flag + entry guard + try/finally wrap)
- Behavior: **FIXED** — double-click checkout = 1 sale (was 2)

### Site 2 — customer_dashboard.js customer checkout
- Test commit (red): <hash>
- Fix commit (green): <hash>
- Lines changed: ~12 (module flag + entry guard + try/finally extend)
- Behavior: **FIXED** — double-click checkout = 1 service_job (was 2)

### Phase C — Build bump
- Commit: <hash>
- Build: 241 → 242
- Version: 5.43.37 → 5.43.38
- All ?v= refs synced (selfheal + main + boot + style.css + sw cache)

### Warnings count
- Before: 147
- After: 141 (-6)
- require-atomic-updates: 138 → 132

### Gates final
- All 3 green ✓
- New test count: 97 → 99+ (2 new regression tests minimum)

### Manual smoke test (REQUIRED post-merge by user)

User ต้องทำเอง หลัง merge เข้า main + Ctrl+Shift+R:

**Flow 1: POS double-click checkout**
1. Open app → POS page (admin/staff login)
2. เพิ่มสินค้าใน cart 1-2 รายการ
3. กดปุ่ม "ชำระเงิน" 2 ครั้งเร็วๆ (double-click ภายใน 100ms)
4. **Expected:** บันทึก 1 sale, 1 ใบเสร็จ, ตัดสต็อก 1 รอบ
5. **Expected:** Receipt drawer เปิด 1 ครั้ง
6. Verify: ดู Sales report → เห็น sale ใหม่แค่ 1 รายการ

**Flow 2: POS single-click (regression check)**
1. POS page → เพิ่มสินค้า → กดปุ่ม "ชำระเงิน" 1 ครั้ง
2. **Expected:** Normal checkout flow (toast "บันทึกการขายเรียบร้อย", receipt drawer)
3. **Expected:** สามารถ checkout บิลถัดไปได้ทันที (lock release ใน finally)

**Flow 3: Customer dashboard double-click order**
1. Open customer-facing page (`/customer/<token>`)
2. เพิ่มสินค้าใส่ตระกร้า + กรอกข้อมูล + แนบสลิป (ถ้า transfer)
3. กดปุ่ม "สั่งซื้อ" 2 ครั้งเร็วๆ
4. **Expected:** 1 service_job บันทึก
5. **Expected:** LINE notify ส่ง 1 ครั้ง
6. Verify: ดู Service Jobs page → เห็น order ใหม่แค่ 1 รายการ

**Flow 4: Customer dashboard single-click (regression check)**
1. Customer page → checkout normal 1 ครั้ง
2. **Expected:** Normal flow (toast "สั่งซื้อสำเร็จ!")
3. **Expected:** _custCart cleared, _custSlip* reset

**Flow 5: Build version verification**
1. Ctrl+Shift+R
2. DevTools → Console → run `window.APP_BUILD`
3. **Expected:** `242`
4. Footer/Settings → version "5.43.38 (build 242)"
5. Application → Cache Storage → เหลือแค่ `boonsook-pos-v5-cache-v242`

**Flow 6: Network throttle simulation (advanced — optional)**
1. DevTools → Network → Throttle "Slow 3G"
2. POS checkout → กดปุ่ม "ชำระเงิน" 1 ครั้ง
3. ระหว่างรอ network → ลองกดปุ่มอีกครั้ง
4. **Expected:** ครั้งที่ 2 ไม่ทำอะไร (silent return)
5. หลัง network เสร็จ → ครั้งแรก complete, lock release

### Recommend Phase 89.42 (next)
- MEDIUM_RISK batch (6 warnings, 3 sites):
  - receipts.js:1162,1163 — multi-payment save guard
  - pos.js:1194,1196 — quickPayAmount + _posCustomer state
  - auth_otp.js:158,219 — OTP verify _pendingOtp mutation
- Estimated effort: 3-4 hours
- Pattern: ใช้ template เดียวกับ 89.41 (entry guard + try/finally) ปรับตามสถานการณ์
```

### ถ้าหยุดกลางทาง

```
## Phase 89.41 — STOPPED

### Reason
<one of stop conditions>

### State
- Branch: claude/phase-89-41-high-risk-fixes
- Last commit: <hash> or "no commits"
- Site 1 status: <DONE/IN_PROGRESS/NOT_STARTED>
- Site 2 status: <DONE/IN_PROGRESS/NOT_STARTED>
- Build bump status: <DONE/SKIPPED>

### Blocker detail
<...>

### Next action user
1. ...
2. ...
```

---

## Reference

- **AUDIT_REPORT_89_40.md** — Top 10 Priority Fixes section (file:line + bucket + reason)
- **CLAUDE_CODE_PROMPT_89_35.md** — TDD pattern reference (logic fix with red→green)
- **CLAUDE_SESSION_HANDOFF.md** Lesson 1 — Build bump = 6+ places, sync ทุก `?v=` refs
- **CLAUDE_SESSION_HANDOFF.md** Lesson 3 — Bug Onion: หลัง logic fix → manual smoke test ทุกครั้ง

---

## ก่อนเริ่ม — Quick checklist

- [ ] Pre-flight ผ่าน (branch ถูก, 3 gates เขียว)
- [ ] อ่าน AUDIT_REPORT_89_40.md เข้าใจ Top 10 + Site 1/Site 2 context
- [ ] เข้าใจ scope: 2 sites เท่านั้น, ห้ามแตะ MED/LOW warnings
- [ ] เข้าใจ TDD: test ต้อง red ก่อน fix แต่ละ site
- [ ] เข้าใจ stop condition: TDD ยาก > 30 นาที = STOP + ขอ user
- [ ] เข้าใจ commit policy: 5 commits expected (test×2 + fix×2 + bump×1), max 10
- [ ] เข้าใจ build bump: REQUIRED, sync 7 จุด

OK เริ่มจาก Pre-flight → Phase A (Site 1 TDD) → Phase B (Site 2 TDD) → Phase C (build bump) → STOP รอ user push + smoke test
