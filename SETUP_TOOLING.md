# SETUP_TOOLING — ESLint + Playwright สำหรับ Phase 89.14

> เป้าหมาย: ติดตั้ง 2 เครื่องมือกันก่อน Claude Code เริ่ม loop เพื่อให้ "AI โกง test" ไม่ได้
> ใช้เวลาทำครั้งเดียว ~15 นาที

---

## ทำไมต้องมี 2 ตัวนี้

| เครื่องมือ | ทำหน้าที่ | จับอะไร |
|-----------|-----------|---------|
| **ESLint** | static analysis (ไม่รัน code) | typo, no-undef, unused var, no-eval, syntax error, dead code |
| **Playwright** | run app ใน Chrome จริง | JS ไม่โหลด, app shell หาย, SW cache version mismatch, CSP block |

ทั้งคู่รวมกับ `npm test` (unit tests เดิม) = **3 gate** ที่ Claude Code ต้องผ่านก่อน commit
ถ้า AI แก้แล้ว app เปิดไม่ได้ Playwright จับทันทีตั้งแต่ CI

---

## ส่วนที่ 1 — ติดตั้ง ESLint (5 นาที)

### 1.1 ติดตั้ง dev dependencies

เปิด terminal ที่ root ของ repo:

```bash
cd "C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github"
npm install --save-dev eslint @eslint/js
```

ถ้าเป็นครั้งแรกที่มี node_modules จะใช้เวลาประมาณ 30 วินาที จะได้ `node_modules/` + `package-lock.json` ใหม่

### 1.2 ตรวจว่าไฟล์ config มีแล้ว

```bash
ls eslint.config.js
```

ต้องเจอ → ถ้าไม่เจอ บอกผม ผมจะสร้างให้ใหม่ (ผมสร้างไว้ตอน paste นี้แล้ว)

### 1.3 เพิ่ม script ใน package.json

เปิด `package.json` แล้วเปลี่ยน scripts section ให้เป็น:

```json
"scripts": {
  "test": "node --test tests/*.test.js",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "test:e2e": "playwright test",
  "verify": "npm run lint && npm test && npm run test:e2e"
}
```

`verify` คือ "gate รวม" ที่ Claude Code ต้องผ่าน 100% ก่อน commit

### 1.4 รัน lint ครั้งแรก

```bash
npm run lint
```

**สิ่งที่จะเกิด:** ครั้งแรกอาจมี warning หลายร้อยตัว (มันยังไม่เคย lint มาก่อน) นี่ไม่ใช่ปัญหา

วิธีอ่าน output:
- `error` = ต้องแก้ (จะทำให้ CI fail)
- `warning` = ปล่อยได้ก่อน (ค่อยทยอยแก้)

### 1.5 จัดการ error (ไม่ใช่ warning)

ถ้ามี error เยอะ ให้ลอง auto-fix:

```bash
npm run lint:fix
```

จะแก้พวก formatting + simple bugs ให้ ที่เหลือ "error" ที่ลึกกว่า fix เองไม่ได้ → ผม recommend วิธีนี้:

**ทางเลือก A — ปิด rule ที่จะเจอ error เยอะที่สุดก่อน**

ถ้าเจอ error ประเภท `no-unused-vars` เยอะมาก ใน eslint.config.js เปลี่ยนจาก `"warn"` เป็น `"off"` ชั่วคราว — ค่อย enable กลับใน batch ถัดไป

**ทางเลือก B — ยอมรับ error แล้วบอก CI ให้ผ่านถ้า warning เท่านั้น**

แก้ script เป็น:
```json
"lint": "eslint . --max-warnings 9999"
```

แต่ Claude Code จะรู้ว่าใส่ flag นี้ ดังนั้นต้องดูใน loop ด้วย — recommend: ปิด rule แทน

### 1.6 commit

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "build(89.14): add eslint flat config + scripts"
```

> หมายเหตุ: `.gitignore` มี `node_modules/` อยู่แล้ว ไม่ต้อง add

---

## ส่วนที่ 2 — ติดตั้ง Playwright (8 นาที)

### 2.1 ติดตั้ง package + browser

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

`playwright install chromium` จะ download Chromium ~150MB ใช้เวลา 1-2 นาที (ครั้งเดียว) เก็บใน `~/.cache/ms-playwright/` ไม่อยู่ใน repo

### 2.2 ตรวจไฟล์ config

```bash
ls playwright.config.js tests/e2e/smoke.spec.js
```

ต้องเจอทั้งคู่ (ผมสร้างไว้แล้ว)

### 2.3 ตรวจว่า python3 พร้อม

Playwright ใช้ `python3 -m http.server` เป็น local server (zero npm dep):

```bash
python3 --version
```

ถ้าไม่มี:
- **Windows:** ติดตั้งจาก https://www.python.org/downloads/ หรือ Microsoft Store พิมพ์ "python"
- **macOS:** `brew install python3` หรือมาพร้อม Xcode
- **Linux:** `sudo apt install python3` ส่วนใหญ่มีอยู่แล้ว

ถ้าไม่อยากลง python ใช้ npm package แทน (เปลือง dep แต่ทำงานได้):
```bash
npm install --save-dev http-server
```
แล้วใน `playwright.config.js` เปลี่ยน `command` เป็น `npx http-server -p 4173 -s`

### 2.4 รัน smoke test ครั้งแรก

```bash
npm run test:e2e
```

**สิ่งที่จะเกิดถ้าทุกอย่างถูก:** ขึ้น ~8 tests pass ใช้เวลา 10-20 วินาที

**ถ้า fail:** อ่าน error — ที่พบบ่อย:
- `CACHE_NAME version mismatch` = sw.js มี v222 แต่ index.html มี APP_BUILD 224 → ไป sync ให้เท่ากัน (อันนี้ดี — เพิ่งเจอบั๊กจริง)
- `unexpected console errors` = มี script เรียก URL ที่ block → ดู `CONSOLE_ALLOW` ใน smoke.spec.js ถ้า msg legit ให้เพิ่ม regex
- `python3: command not found` = ดู 2.3 ข้างบน

### 2.5 ดู report ถ้า fail

```bash
npx playwright show-report
```

จะเปิด browser หน้า report แสดง screenshot + trace ของ test ที่ fail (debug ง่ายมาก)

### 2.6 commit

```bash
echo "node_modules/" >> .gitignore         # ถ้ายังไม่มี (ของคุณมีแล้ว ข้ามได้)
echo "playwright-report/" >> .gitignore
echo "test-results/" >> .gitignore

git add playwright.config.js tests/e2e/ package.json package-lock.json .gitignore
git commit -m "test(89.14): add playwright smoke test + config"
```

---

## ส่วนที่ 3 — เพิ่ม CI gate (3 นาที)

แก้ `.github/workflows/test.yml` ให้เป็น:

```yaml
name: Tests

on:
  push:
    branches: [main, "claude/**"]
  pull_request:
    branches: [main]

jobs:
  lint-and-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    needs: lint-and-unit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

แล้ว commit:

```bash
git add .github/workflows/test.yml
git commit -m "ci(89.14): add lint + e2e gates"
```

---

## ส่วนที่ 4 — Push setup commits ก่อน Claude Code loop

```bash
git checkout -b claude/phase-89-14-tooling-setup
git push -u origin claude/phase-89-14-tooling-setup
```

เปิด PR (manual) เพื่อให้ CI run + ตรวจ green ก่อน merge:

```bash
gh pr create --fill --base main --title "Phase 89.14 prep: tooling (eslint + playwright)"
```

ถ้า CI เขียวทั้ง 2 jobs → merge เลย
ถ้า CI แดง → ดู log แล้วแก้ ส่วนใหญ่จะเป็น lint error ใน existing code → ปิด rule ที่ noise มากตามวิธีใน 1.5

**สำคัญ:** อย่าให้ Claude Code เริ่ม Phase 89.14 batch (B1-B9) **จนกว่า** branch tooling-setup merge เข้า main แล้ว ไม่งั้น loop จะ inherit baseline ที่ lint แดง

---

## ส่วนที่ 5 — Update Claude Code prompt

หลัง tooling merge เข้า main แล้ว เปลี่ยน step "loop" ใน `CLAUDE_CODE_PROMPT.md`:

ใน loop ของแต่ละบั๊ก เดิม:
```
6. `npm test` → all green
```

เปลี่ยนเป็น:
```
6. `npm run verify` → all green (lint + test + e2e)
```

นี่คือสิ่งที่ผมอัปเดตให้แล้วในไฟล์ `CLAUDE_CODE_PROMPT.md` ใหม่ (ดูข้างล่าง)

---

## ทดสอบจบ — Checklist ก่อนเริ่ม Phase 89.14

```bash
npm run lint        # ✅ exit 0
npm test            # ✅ 33 tests pass
npm run test:e2e    # ✅ smoke tests pass
npm run verify      # ✅ ทั้ง 3 ผ่าน
```

ทั้ง 4 คำสั่ง exit code = 0 → พร้อมเริ่ม Claude Code loop

---

## Troubleshooting

### `eslint: command not found`
รัน `npm install` ใหม่ ดู `node_modules/.bin/eslint` มีไหม

### Playwright `browser-not-installed`
รัน `npx playwright install chromium` อีกที

### `python3: command not found` (Windows)
ติดตั้ง Python จาก Microsoft Store หรือใช้ http-server แทน (ดู 2.3)

### Smoke test fail ที่ `cache-v{N} must match APP_BUILD {M}`
นี่คือ bug ของจริง — `sw.js` กับ `index.html` build version ไม่ตรง ต้องไป sync ก่อน (test เพิ่งช่วยจับ bug จริง 🎯)

### lint error ใน existing code เยอะมาก (>100)
ปิด rule ที่ noise:
```js
// eslint.config.js
rules: {
  "no-unused-vars": "off",
  "no-undef": "off",        // เปิดกลับหลัง Phase 89.14
  ...
}
```
แล้ว enable ทีละตัวใน batch ถัดไป (เป็น "tech debt" ติดตามใน HANDOFF)

### CI e2e fail ที่ `Failed to load resource: cdn...`
CDN ถูก block ใน sandbox — เพิ่ม regex ใน `CONSOLE_ALLOW` ของ smoke.spec.js หรือ stub ออกในไฟล์ index แบบ conditional (เกินสโคป — ปล่อยผ่านได้ใน `CONSOLE_ALLOW`)

---

## สรุปไฟล์ที่เกี่ยวข้อง

| ไฟล์ | ใคร create | หน้าที่ |
|-----|-----------|--------|
| `eslint.config.js` | ผม (สร้างให้แล้ว) | flat config + browser globals + bug rules |
| `playwright.config.js` | ผม (สร้างให้แล้ว) | config + python3 webServer |
| `tests/e2e/smoke.spec.js` | ผม (สร้างให้แล้ว) | 9 smoke tests |
| `package.json` scripts | คุณ (ตาม 1.3) | npm run lint / test:e2e / verify |
| `.github/workflows/test.yml` | คุณ (ตาม ส่วนที่ 3) | CI 2 jobs |
| `package-lock.json` | npm สร้างให้ (commit ด้วย) | lock dep versions |
