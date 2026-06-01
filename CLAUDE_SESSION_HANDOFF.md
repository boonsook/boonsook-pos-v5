# Current Shared Start Note

This file is historical context from an older Claude workflow. For the current shared Codex/Claude project state, read `SESSION_START_SHARED.md` first.

# CLAUDE_SESSION_HANDOFF — อ่านที่นี่ก่อนเริ่ม session ใหม่

> **For Claude (next session / future-me):** อ่านไฟล์นี้ **ก่อน** ทำงาน — มี context ครบที่จำเป็น
> **For user (gangboo):** ส่งไฟล์นี้ให้ Claude ตอนเริ่ม session ใหม่ — ไม่ต้องอธิบายซ้ำ
> **Last updated:** 2026-05-21 (หลัง Phase 92.10 capstone — decomposition series COMPLETE)
> **Project:** Boonsook POS V5 PRO — Thai POS PWA (vanilla JS modules + Supabase + Cloudflare Pages)

---

## TL;DR (อ่าน 60 วินาที)

**Decomposition series 92.1–92.10 เสร็จสมบูรณ์ + live build 266** — แตก main.js (monolith) ออกเป็น 6 modules โดย behavior byte-identical ทุก phase

- **main.js: 4690 → 4247 บรรทัด (−443)** — เหลือเป็น pure module definitions + window.App contract + thin wrappers, **side-effect-free** (ไม่มี IIFE รันเองตอน import)
- **Build: 266 · Version: 5.47.0**
- ทุก phase ผ่าน: 3-gate verify (lint+unit+e2e) → byte-level review ใน Cowork → runtime smoke ของจริง บน production
- Unit tests: ~302 (จาก ~33 ตอน Phase 89) · E2E: 11 · Lint: 0 errors

**Workflow ที่พิสูจน์แล้ว:** Cowork (Claude ตัวนี้) เขียน prompt + review diff → user รัน Claude Code บน Windows terminal (มี git creds) → verify → PR/push → deploy → smoke

---

## State Snapshot (ปัจจุบัน — build 266)

### Git
- origin/main: Phase 92.10 (build 266, v5.47.0) merged + deployed
- Production: `boonsook-pos-v5.pages.dev` + `boonsukair.com` (custom domain)
- branches `claude/phase-92-*` เก่า merge แล้ว — ลบได้

### Repo metrics
| Item | Value |
|------|-------|
| Build version | 266 |
| Version string | 5.47.0 |
| main.js | 4247 บรรทัด (จาก 4690) |
| Lint errors | 0 (2 pre-existing warnings: requireAdmin unused, state.lastReceipt race — benign) |
| Unit tests | ~302 (node:test) |
| E2E smoke | 11 (Playwright) |

### Modules ที่แยกจาก main.js (Phase 92 series)
| Module | เนื้อหา | Phase |
|--------|---------|-------|
| `modules/branding.js` | logo: updateAppLogos / getAppLogo / syncAppLogo | 92.1-92.3 |
| `modules/lazy_libs.js` | loadHtml2Canvas (CDN loader + concurrent dedup) | 92.4, 92.6 |
| `modules/share_doc.js` | shareDoc — Share/PDF overlay (8 share handlers) | 92.7 |
| `modules/utils.js` | Thai formatters (money/formatNumber/Currency/Date/DateTime) + escHtml + date helpers | 92.8 (append) |
| `modules/api.js` | createApi factory — XHR/auth data layer (refresh/authFetch/xhrPost/Patch/Delete) | 92.9 |
| `modules/boot.js` | runBoot — boot orchestration (capstone) | 92.10 |

---

## Decomposition Series Summary (92.1–92.10)

| Phase | Build | สิ่งที่ทำ |
|-------|-------|-----------|
| 92.1-92.3 | 257-259 | branding.js (logo paint/resolve/sync + AbortController hardening) |
| 92.4 | 260 | lazy_libs.js (html2canvas loader) |
| 92.5 | 261 | hotfix: html2canvas CDN cdnjs→jsdelivr (CSP block) + Share fail-fallback |
| 92.6 | 262 | hardening: loadHtml2Canvas concurrent dedup + syncAppLogo URL early-exit + accessToken CRLF sanitize |
| 92.7 | 263 | share_doc.js (Share/PDF overlay 223 บรรทัด) |
| 92.8 | 264 | utils.js (Thai formatters) |
| 92.9 | 265 | api.js (XHR/auth layer via factory) |
| 92.10 | 266 | boot.js (boot orchestration — capstone, main.js side-effect-free) |

---

## Tooling (พร้อมใช้บน main)

```bash
npm run verify     # = lint + test + test:e2e  ← THE GATE (ต้องเขียวก่อน merge)
npm run lint       # ESLint (max-warnings=99999)
npm run lint:errors# errors only (block CI จริง)
npm test           # node --test (~302 unit)
npm run test:e2e   # Playwright (11 smoke)
```

CI: `.github/workflows/test.yml` (tests) + Cloudflare Pages deploy — รันบน PR + push main

---

## ⚠️ Capability Limits ของ Claude (Cowork mode) — สำคัญมาก

Claude ตัวนี้ (Cowork) ทำงานคู่กับ Claude Code (Windows terminal) — แบ่งหน้าที่ชัด:

### Cowork (Claude ตัวนี้) ทำได้
- ✅ **อ่าน/แก้/เขียนไฟล์** (Read/Write/Edit) ในโฟลเดอร์ repo
- ✅ **ลบไฟล์** — ต้องขอ permission ผ่าน `allow_cowork_file_delete` ก่อน (rm จะ fail "Operation not permitted" จนกว่าจะ approve)
- ✅ **อ่าน git history/diff** ผ่าน plumbing: `git log/show/diff origin/main`, `git rev-parse`, `git blame` — review PR diff แบบ byte-level ได้
- ✅ Bash sandbox (Linux) — รัน command, grep, node --check

### Cowork ทำไม่ได้ (ต้องให้ user / Claude Code Windows)
- ❌ **git push / PR / merge** — ไม่มี GitHub creds
- ❌ **git operations ที่แตะ index** — `git status`, `git reset`, `git add`, `git commit` มักเพี้ยน/fail เพราะ **index format incompat** (Windows git เขียน index ที่ Linux git อ่านไม่ตรง → git status แสดงทุกไฟล์เป็น `A`, HEAD unknown — **ไม่ใช่สถานะจริง** อย่าเชื่อ git status ใน sandbox, ใช้ `git show origin/main` / `git log` แทน)

**กฎ:** ทุก commit + push + PR + merge → user ทำเองบน Windows (หรือสั่ง Claude Code) Cowork ให้คำสั่ง copy/paste + review diff

### การ verify build ที่ถูกต้องใน Cowork
ใช้ `git show origin/main:<file>` หรือ `git show <branch>:<file>` — **อย่าใช้ working-tree ตรงๆ** เพราะ Cowork mount อาจ truncated/stale (เคยเจอ main.js ขาด ~900 bytes ใน mount แต่ origin ครบ)

---

## Workflow Pattern (proven ตลอด 92.x)

```
1. Cowork: analyze main.js (git show origin/main:main.js) → เลือก chunk + design extraction
2. Cowork: เขียน CLAUDE_CODE_PROMPT_XX.md (mission + design + guardrails + tests + build bump + smoke checklist)
3. User: รัน Claude Code บน Windows → paste prompt → autonomous execute
4. Cowork: review branch diff (git show <branch>:<file>) → byte-identical + global-leak + build-sync verify → verdict
5. User: PR → CI gate (tests + deploy) → merge → Cloudflare deploy
6. User: manual smoke ของจริง → ส่ง screenshot
7. Cowork: confirm smoke + ปิด phase
```

### Extraction design patterns (เลือกตาม chunk)
- **Plain export + wrapper** (branding/lazy_libs/share_doc/utils) — function ธรรมดา, inject documentRef/windowRef ผ่าน params, main.js เก็บ thin wrapper
- **Factory** (api.js) — เมื่อมี shared mutable state + internal recursion + positional params ที่ห้ามชน → `createApi({ windowRef })` closure
- **Dependency injection** (boot.js) — เมื่อ extract แล้วจะ circular → inject deps ผ่าน params, module ไม่ import main.js

---

## Lessons Learned (CRITICAL — อ่านก่อนทำ extraction ใหม่)

### L1: Global-leak guard บังคับ (กัน ReferenceError production)
Code ที่ extract ใช้ bareword `document.`/`window.`/`navigator.`/`fetch(`/`new XMLHttpRequest`/`console.` — ถ้าลืม route ผ่าน injected ref (`documentRef.`/`windowRef.`) → **ReferenceError ใน production แต่ unit test ไม่ catch** หลัง extract ต้อง grep หา bareword ที่หลงเหลือเสมอ ระวัง bareword ที่ไม่มี `window.` prefix ด้วย (เช่น `html2canvas(...)`, `URL.createObjectURL` ที่เป็น global)

### L2: Byte-identical verification (review ทุก PR)
เทียบ logic ของจริง: extract block จาก origin → normalize injected refs กลับ (`windowRef.`→`window.`) → diff กับ module ความต่างที่ acceptable = global-routing เท่านั้น ถ้าเจอ logic เปลี่ยน = STOP HTML/CSS template + retry/refresh logic + jsPDF math → ต้อง byte-identical เป๊ะ

### L3: Build bump จำเป็นทุก extraction
แม้เป็น refactor — static import ของ module ใหม่ cache ผ่าน SW CACHE_NAME ถ้าไม่ bump, client เก่าอาจโหลด module เก่า (ไม่มีของใหม่) คู่กับ main.js ใหม่ → ReferenceError Bump ครบ: index.html (style.css/selfheal/main.js/boot.js ?v=N + data-app-build=N), sw.js CACHE_NAME, pages.js (build N + version)

### L4: Commit body integrity (เจอใน 92.4)
ทุก commit ที่มี non-extraction change (เช่น เปลี่ยน CDN URL) ต้อง flag ใน commit body — ห้าม "silently fix ใต้ refactor" ถ้า autonomous loop เจอต้องแก้นอก scope = STOP + report ไม่ใช่เนียนแก้

### L5: Judgment calls — verify ก่อน approve
Phase 92.9 ตัด `state.supabase` fallback (defensive) — ต้อง verify invariant: `window.App.state === state` (object shorthand) + window.App set ก่อน boot/401 ใดๆ → ปลอดภัย behavior change เล็กๆ ใน auth-critical path → smoke ของจริงคือ proof

### L6: Prompt bugs ของ Cowork (เกิด 2 ครั้ง — ยอมรับ + แก้)
- 92.6: arithmetic ผิดใน reporting (เขียน 252 แต่จริง 253)
- 92.10: test helper makeDeps override ทับ call tracking → Claude Code แก้เป็น scenario knobs
→ Claude Code (Windows) catch + flag ได้ดี trust-but-verify ทำงาน

---

## Candidates ถัดไป (ถ้าจะ decompose ต่อ — optional)

main.js เหลือ 4247 บรรทัด + module boundary ชัดแล้ว — decompose ต่อเป็น optional ก้อนที่เหลือ **ไม่ cohesive** เท่า 92.x:

- **DOM/form utils** (grab bag — getFormData/validateForm/clearForm + fadeIn/fadeOut + showLoading/hideLoading + confirmAsync/showConfirmModal + throttle/debounce) — เป็น 4-5 concern ต่างกัน, touch DOM, มี `$()` helper + modal closure dependency → ถ้าทำควรแยก concern ทีละกลุ่ม ไม่ extract รวด
- **pure control-flow** (throttle L366 + debounce L3697) → utils.js — cheap pure win (zero DOM) แต่เล็ก

แนะนำ: หยุดได้แล้ว main.js อยู่ในสภาพดี ถ้าจะทำต่อ เริ่มจาก pure (throttle/debounce) ที่ zero risk

---

## Known benign items (ไม่ต้อง fix)
- **`sw.js` `?_t=` ERR_CACHE_MISS** ใน DevTools Network — มาจาก `boot.js` controllerchange hard-reload (Phase 28 cache-bust สำหรับ iOS Safari + PWA) navigation ถูก cancel ตอน page unload = artifact ปกติ ไม่ใช่ bug
- **`Could not find window.__TAURI_METADATA__`** ใน Console — Tauri note, expected เมื่อรันบน browser (ไม่ใช่ Tauri window)

---

## User Preferences (gangboo)
- **ภาษา:** ไทย (+ tech English) — ไม่เป็นทางการเกิน, ตรงประเด็น
- **Work style:** Craftsman — ทำให้ถูกครั้งเดียว, ไม่ชอบ revision เยอะ, ไม่ชอบถูกถามซ้ำ
- **Honesty:** "เอาตามจริง ไม่ชอบคนโกหก" — admit miss/prompt-bug openly + fix
- **Verification:** ชอบเห็น screenshot + verify ของจริง ไม่ใช่แค่ "AI claims done"
- **Background:** เทรด US stocks, ชอบ design + เรียนรู้สิ่งใหม่
- **Pace:** ไม่รีบ, ทำให้ถูก > เร็ว

---

## Hand-Off Statement
Decomposition series (Phase 92.1-92.10) สำเร็จตามเป้า — main.js จาก monolith 4690 บรรทัด เป็น orchestrator 4247 บรรทัด + 6 cohesive modules, side-effect-free, byte-identical ทุก step, verified ทั้ง static + runtime

Future sessions: build on this foundation — workflow Cowork↔Claude Code พิสูจน์แล้วว่า scale ได้ ถ้าจะ decompose ต่อ อ่าน "Candidates" + "Lessons" ก่อน reuse extraction patterns (plain/factory/injection) ตาม chunk

ขอให้สนุกกับงานต่อไปครับ 🛠️

— Claude (Cowork session 2026-05-20 → 2026-05-21)
