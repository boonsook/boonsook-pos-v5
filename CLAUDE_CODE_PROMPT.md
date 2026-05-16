# Claude Code — Phase 89.14 Autonomous Stabilization Prompt

> **วิธีใช้:** เปิด terminal ที่ repo root แล้วรัน Claude Code โหมด autonomous:
> ```bash
> claude --dangerously-skip-permissions
> ```
> แล้ว paste ทั้งบล็อกข้างล่างนี้เข้าไป

---

## Mission

คุณคือ engineer ที่ได้รับมอบหมายให้ปิด stabilization batch 3 (Phase 89.14) ของ Boonsook POS V5
อ่าน `AUTOFIX_PLAN.md` ก่อน — เป็น source of truth ของงานทั้งหมด คุณห้าม deviate จากมัน
เป้าหมาย: เคลียร์บั๊ก B1–B9 ทั้งหมด, push branch, เปิด PR, รอ user รีวิว

## Pre-flight (รันก่อน อย่าข้าม)

```bash
git status
git fetch origin
git log --oneline -3 origin/main
node --version
npm ci                # install deps (eslint, playwright) ถ้ายัง
npm run verify        # = lint + unit test + e2e smoke — baseline ต้องเขียวทั้งหมด
```

ถ้า `npm run verify` ไม่เขียว = **หยุด** + ขอ user แก้ก่อน อย่าทำต่อ
**ถ้า `npm run verify` ไม่มี script นี้** = tooling setup ยังไม่ merge → **หยุด** + ขอ user merge `claude/phase-89-14-tooling-setup` ก่อน

## Branch setup

```bash
git checkout -b claude/phase-89-14-stab-batch-3 origin/main
```

ถ้า branch มีอยู่แล้ว → `git checkout claude/phase-89-14-stab-batch-3 && git rebase origin/main`

## Loop (B1 → B2 → B3 → ... → B9 ตามลำดับห้ามข้าม)

สำหรับแต่ละบั๊ก:

1. **อ่าน section ของบั๊กใน AUTOFIX_PLAN.md** — note "Files:", "Test:", "Acceptance:"
2. **เขียน test ก่อน (TDD red phase)**
   - สร้างไฟล์ใน `tests/<bug_name>.test.js`
   - ใช้ pattern เดียวกับ `tests/error_reporter.test.js` (node:test + assert/strict + mocked fetch)
   - test ต้อง fail ตอน run แรก (เพราะยังไม่ได้ fix)
3. **`npm test`** → confirm ว่า test ใหม่ fail แต่ test เก่า 33 ตัวยังเขียว
   - ถ้า test เก่าแดง = test ใหม่ทำ side-effect → fix test ก่อน
   - lint อาจ warn เรื่อง mock helpers — ปล่อยได้ใน `tests/`
4. **`git add tests/ && git commit -m "test(89.14): add failing test for B{i} — {short}"`**
5. **Implement fix** — แก้เฉพาะไฟล์ใน "Files:" ของบั๊กนั้น
   - ถ้าต้องแก้ไฟล์อื่น → **หยุด** + เขียน note ใน HANDOFF.md + ขอ user
6. **`npm run verify`** → ต้องเขียวทั้งหมด (lint + unit + e2e smoke)
   - ถ้าไม่เขียวหลังพยายาม 3 ครั้ง → **หยุด** + paste error + ขอ user
   - ถ้า e2e fail ที่ `cache-vN must match APP_BUILD M` = ต้อง bump sw.js + index.html cohert (ทำใน final wrap-up อยู่แล้ว — ก่อนนั้น ใส่ใน test allow list ชั่วคราว **ห้าม**)
7. **Self-review checklist** (ทำใจเอง ห้ามข้าม):
   - [ ] ไม่ได้แก้ test ที่เพิ่งเขียนให้ "เบาลง" (compare `git diff HEAD~1 tests/`)
   - [ ] ไม่ได้ touch file นอก "Files:"
   - [ ] ไม่มี `console.log` ที่ลืม
   - [ ] ไม่มี TODO/FIXME ใหม่
   - [ ] commit message format = `fix(89.14): B{i} — {root cause สั้น ≤60 ตัวอักษร}`
8. **`git commit -am "fix(89.14): B{i} — ..."`**
9. ไปต่อบั๊กถัดไป

## บั๊กที่ต้องหยุดให้ user verify

- **B2 (M1 — voidJvForSource)**: หลังเขียน test + fix + commit เสร็จ → หยุด + แสดง diff สรุป + ขอ user smoke test ก่อนทำ B3 เพราะกระทบบัญชี
- **B3 (M2 — stock atomic)**: ต้องเขียน SQL migration → หลังเขียนไฟล์ `supabase-phase89-14-stock-atomic.sql` เสร็จ → หยุด + ขอ user รันใน Supabase Studio ก่อน proceed B4
- **B7 (M7 — error_log RLS)**: เหมือน B3 ต้อง SQL migration → หยุดให้ user รัน

## Final wrap-up (หลัง B9 ผ่าน + user verify B2/B3/B7)

```bash
# 1. Bump version
# แก้ index.html: <meta name="app-build" content="222"> → "223"
# แก้ sw.js: const CACHE_NAME = "boonsook-pos-v5-cache-v222" → "v223"
# แก้ modules/settings/pages.js: build 222 → 223 + version 5.43.18 → 5.43.19

# 2. Append HANDOFF.md
# ใส่ section "## 🔧 Phase 89.14 — Stabilization Batch 3 (build 223) — <today>"
# format เลียนแบบ Phase 89.13 ที่มีอยู่
# - Context
# - Findings & fixes table (B1..B9 + severity + file + fix)
# - Files touched (list)
# - Verify after deploy (smoke list ต่อบั๊ก)
# - Known bugs ยังไม่แก้รอบนี้: ESLint/Prettier, Playwright, c8 coverage

# 3. Commit + push + PR
git commit -am "chore(89.14): bump build 222→223 + HANDOFF Phase 89.14 summary"
git push -u origin claude/phase-89-14-stab-batch-3
gh pr create --fill --base main --title "Phase 89.14 — Stabilization batch 3 (build 223)"
```

## Hard rules (ฝ่าฝืน = stop ทันที)

1. **ห้าม commit เข้า main ตรงๆ**
2. **ห้าม `git push --force`** เด็ดขาด ใช้ `--force-with-lease` ถ้าจำเป็นเท่านั้น + บอก user ก่อน
3. **ห้ามแก้ test ให้ fix ผ่าน** — ถ้า logic ผิด, test ถูก = แก้ logic
4. **ห้าม disable test / skip CI** ด้วย `.skip` / `xit` / env hack
5. **ห้าม install npm package ใหม่** — ถ้าจำเป็น = stop + ขอ user (โครงการนี้ตั้งใจ zero-dep)
6. **ห้ามรัน SQL migration เอง** — เขียน `.sql` file แล้วให้ user รันใน Supabase Studio
7. **Max 30 iterations ต่อบั๊ก** ถ้าเกิน = stop
8. **Budget เวลารวม: 2 ชั่วโมง wall-clock** เกินแล้ว stop + summarize ที่ทำได้

## Reporting (เมื่อ stop หรือเสร็จ)

ทุกครั้งที่หยุด (ทั้ง planned stop และ error) — output 1 message รวม:

```
## Phase 89.14 status — <timestamp>

### Done
- [x] B1 — M6 anon API guard (commits abc123, def456)
- [x] B2 — M1 voidJvForSource (commits ...)
- ...

### Blocked / Stopped
- B3 — รอ user รัน supabase-phase89-14-stock-atomic.sql ใน Supabase Studio

### Next action user
1. ...
2. ...

### CI status
- Branch: claude/phase-89-14-stab-batch-3
- npm test: <pass/fail>
- GH Actions: <url ถ้ามี>
```

---

ทำได้แล้ว เริ่มจาก pre-flight แล้วลุยต่อ ไม่ต้องถามอนุญาตทีละสเต็ป ใช้ judgment ของตัวเองภายใต้ guardrails ข้างบน
