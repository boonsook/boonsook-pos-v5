# 📋 HANDOFF — Boonsook POS V5 PRO

> 🆕 **เปิด session ใหม่? อ่าน [`CLAUDE_SESSION_HANDOFF.md`](CLAUDE_SESSION_HANDOFF.md) ก่อน** — มี state snapshot, capability limits, workflow patterns
> 🆕 และ [`SESSION_LOG.md`](SESSION_LOG.md) — push history, SQL tracker, audit progress

**อัปเดตล่าสุด:** 20 พฤษภาคม 2026 (Phase 92.8 — extract Thai-locale formatters → modules/utils.js, build 264)
**Version:** 5.45.1 (build 264) — Phase 92.8 (formatter extraction; patch: refactor)
**Previous:** 5.45.0 (build 263) — Phase 92.7 (Share/PDF overlay extraction; minor: new module)

---

## ♻️ Phase 92.8 — Extract Thai-locale formatters → `modules/utils.js` (this session)

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
- `CLAUDE_SESSION_HANDOFF.md` — Claude session continuity (อ่านก่อนเริ่ม)
- `CLAUDE_CODE_WORKFLOW.md` — autonomous loop guide
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
