# CLAUDE_CODE_WORKFLOW — คู่มือใช้ Claude Code แบบ autonomous

> **เป้าหมาย:** ให้ Claude Code แก้บั๊กตัวเองโดยคุณไม่ต้องเฝ้า
> **ใช้กับ:** Boonsook POS V5 ทุก phase ต่อจากนี้ (89.32+)
> **เวลาเตรียม:** 10-15 นาทีต่อรอบ
> **เวลา Claude Code ทำงาน:** 30 นาที - หลายชั่วโมง (ขึ้นกับ scope)

---

## ภาพรวม Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Pre-flight (5 min)        → ตรวจ baseline เขียวหมด           │
│ 2. เลือก scope (10 min)      → ตัดสินใจว่ารอบนี้แก้อะไร         │
│ 3. Create branch (1 min)     → claude/phase-89-NN-xxx           │
│ 4. เขียน batch prompt (5 min)→ ทำสำเนา CLAUDE_CODE_PROMPT.md     │
│ 5. เปิด Claude Code (1 min)  → claude --dangerously-skip-perms  │
│ 6. Paste prompt → ไปทำธุระอื่น                                  │
│ 7. Claude Code หยุด          → review + verify                  │
│ 8. Push + เปิด PR (5 min)    → รอ CI                            │
│ 9. Merge (1 min)             → เสร็จรอบ                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Pre-flight (ทำทุกครั้ง อย่าข้าม)

เปิด terminal ใน folder repo:

```bash
cd "C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github"
```

### 1.1 ตรวจ git ว่าสะอาด

```bash
git status
```

ต้องเห็น:
```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

ถ้ายังมี modified/untracked → ต้องเก็บกวาดก่อน
- `git stash` (เก็บไว้ก่อน)
- หรือ `git checkout .` (ทิ้ง — ระวัง)

### 1.2 Sync กับ origin (ตรวจว่า main ใหม่สุด)

```bash
git fetch origin
git log --oneline HEAD..origin/main
```

ถ้า output ว่าง = ตรงกัน ดี
ถ้ามี commits = origin ใหม่กว่า → `git pull --ff-only origin main`

### 1.3 รัน 3 gate ครบ

```bash
npm run verify
```

ใช้เวลา ~30 วินาที ต้องเขียวหมด 3 ตัว:
- ✅ Lint: 0 errors
- ✅ Test: 94/94 (หรือมากกว่า)
- ✅ E2E: 10/10

ถ้า fail → **หยุด** + ตรวจว่าอะไรเสีย ก่อนทำต่อ (อย่าให้ Claude Code เริ่มจาก baseline แดง)

---

## Step 2 — เลือก scope ของรอบนี้

นี่คือ **ขั้นสำคัญที่สุด** ของทั้ง workflow ถ้าเลือก scope ผิด Claude Code จะหลงทาง

### กฎ 3 ข้อสำหรับเลือก scope

1. **เล็กกว่าที่คิด 2 เท่า** — รอบแรกควรเป็น 30 นาที ไม่ใช่ 4 ชั่วโมง
2. **เป้าหมายชัดเจน** — "เคลียร์ no-unused-vars" ดีกว่า "ทำให้ codebase สะอาด"
3. **มี test เป็น gate ได้** — ถ้าวัดผลด้วย test ไม่ได้ Claude Code จะรู้ไม่ได้ว่า "เสร็จ"

### ตัวอย่าง scope ของแต่ละ phase

| Phase | Scope | Risk | Time | เหมาะกับ |
|-------|-------|------|------|----------|
| **89.32** | Warnings cleanup — prefer-const + no-unused-vars (~80 จุด) | Low | 30 min | รอบแรก (build trust) |
| 89.33 | M4 part 2 — drop style-src unsafe-inline (refactor 121 inline styles) | High | 4-6h | หลัง 89.32 ผ่าน |
| 89.34 | Phase 1.5 iter #2 — inline event handler sweep (40-60 handlers) | Med | 1-2 วัน | overnight |
| 89.35 | Tech debt sweep — disable rules ที่ปิดไว้กลับเป็น error ทีละตัว | Low | 1h ต่อ rule | continuous |
| 89.NN | Audit batch — Claude Code หา bug ใหม่จาก codebase | Variable | Variable | ทุกๆ 2 สัปดาห์ |

### แนะนำ — Phase 89.32 (รอบแรก autonomous)

**Scope:** เคลียร์ warnings 2 ประเภท
- `prefer-const` (~30 จุด) — แก้ง่าย, low risk, มองเห็นชัดเจน
- `no-unused-vars` (~50 จุด) — ต้องดู context นิดหน่อย แต่ตรงไปตรงมา

**ทำไมรอบแรกควรเป็นแบบนี้:**
- ความเสี่ยงต่ำมาก (no logic change)
- Claude Code ทำผิดยาก
- ผ่าน gates ได้แน่ๆ
- คุณได้เห็น workflow ทำงานจริง ก่อนปล่อยให้ทำงานใหญ่

---

## Step 3 — Create branch

```bash
git checkout main
git pull --ff-only origin main
git checkout -b claude/phase-89-32-warnings-cleanup
```

ขั้นนี้สำคัญ — branch ใหม่จาก main ที่ sync แล้ว ถ้า branch base ผิด commits จะ merge ไม่ได้

---

## Step 4 — เขียน batch prompt

ใน `CLAUDE_CODE_PROMPT.md` ที่มีอยู่ — ใช้เป็น template แต่ **ทำสำเนาแก้ให้ตรงกับ batch ปัจจุบัน**

### 4.1 Copy template

```bash
copy CLAUDE_CODE_PROMPT.md CLAUDE_CODE_PROMPT_89_32.md
```

(หรือใช้ explorer copy/paste ใน editor — Windows command `copy`)

### 4.2 แก้ส่วนสำคัญใน prompt

เปิด `CLAUDE_CODE_PROMPT_89_32.md` ใน editor (VS Code, Notepad++) แก้:

**1. Mission section** — เขียน task ของรอบนี้ให้ชัดเจน

```markdown
## Mission

คุณคือ engineer ที่ได้รับมอบหมายให้ปิด **warnings cleanup batch แรก (Phase 89.32)**

**เป้าหมาย:** ลด lint warnings ลงโดยเฉพาะ 2 ประเภท:
1. `prefer-const` — เปลี่ยน `let` ที่ไม่ reassign เป็น `const`
2. `no-unused-vars` — ลบ variable/parameter ที่ไม่ใช้ (หรือ prefix ด้วย `_`)

**Out of scope:** อย่าแตะ rule อื่น (no-undef, no-async-promise-executor, etc.)
**Don't touch:** test files (เพราะ rule นี้ disabled ใน tests/**)
```

**2. Workflow section** — ปรับ loop ให้ตรงงาน

```markdown
## Workflow

1. รัน `npm run lint -- --rule '{"prefer-const": "error", "no-unused-vars": "error"}' --max-warnings 0` 
   → ดูรายการ warnings ที่ต้องแก้ทั้งหมด
2. แก้ทีละ 5-10 จุด → commit เป็นกลุ่ม
3. รัน `npm run verify` ก่อน commit ทุกครั้ง
4. ใช้ commit message: `cleanup(89.32): <category> in <module>`
   เช่น: `cleanup(89.32): prefer-const in modules/pos.js`
5. ทำซ้ำจน warnings หมด 2 ประเภท
```

**3. Hard rules** — เพิ่ม rule เฉพาะรอบนี้

```markdown
## Hard rules (เพิ่มเติม)

- **ห้ามแก้ test file** (tests/**) — rule นี้ disabled ที่นั่นอยู่แล้ว
- **ห้ามแก้ rule อื่นใน eslint.config.js** — focus เฉพาะ source
- **ห้ามแก้ logic** — ถ้า `let x = ...` ถูก reassign จริงๆ ใน function ห้ามเปลี่ยนเป็น const
- **Max 10 commits** — ถ้าทำเกิน 10 commits = scope ใหญ่เกินไป → หยุด + report
```

ส่วนอื่น (guardrails, stop conditions, reporting) — เก็บไว้เหมือนเดิม

### 4.3 บันทึกไฟล์

ปิด editor — ไฟล์อยู่ใน folder repo แล้ว แต่อย่าเพิ่ง commit (Claude Code ใช้อ่าน)

---

## Step 5 — เปิด Claude Code

ใน terminal เดิม (ที่ folder repo):

```bash
claude --dangerously-skip-permissions
```

จะขึ้น Claude Code session ใหม่ มี `>` prompt ให้พิมพ์

**Flag `--dangerously-skip-permissions`** ทำให้ Claude Code ไม่ถามอนุญาตทุกการเขียนไฟล์/รัน command ปล่อยให้ทำงานต่อเนื่อง ใช้เฉพาะเมื่อคุณมั่นใจในงาน (ของเรามี gates กั้นอยู่ทั้ง 3 ชั้น = ปลอดภัย)

---

## Step 6 — Paste prompt + ปล่อยให้ทำงาน

ใน Claude Code session — paste **ทั้งบล็อก** ของ `CLAUDE_CODE_PROMPT_89_32.md` (เปิดไฟล์ Ctrl+A → Ctrl+C → Ctrl+V ใน terminal)

กด Enter ส่ง

### สิ่งที่จะเกิดขึ้น

Claude Code จะ:
1. **Pre-flight check** — รัน `git status`, `npm run verify`
2. **อ่าน eslint.config.js + lint output** เพื่อเข้าใจ rules
3. **เริ่ม loop** — อ่านไฟล์, แก้ warnings, รัน verify, commit, ทำต่อ
4. **Update คุณเป็นระยะ** — ทุก 5-10 commits จะ summary

### ขณะที่ Claude Code ทำงาน

**คุณไม่ต้องทำอะไร** ไปทำธุระอื่นได้ — terminal จะ show progress

**ถ้าอยากเช็ค** — terminal จะ scroll output:
- `Reading file: modules/xxx.js` → กำลังอ่าน
- `npm run verify` → กำลังตรวจ
- `git commit` → กำลัง commit

**ถ้าหยุดเอง** = Claude Code เจอ checkpoint (ตามที่ guardrail ตั้งไว้):
- ต้อง SQL migration
- เจอ scope creep
- Gates fail ติดต่อกัน 3 ครั้ง
- Max 30 iterations ต่อบั๊ก

ดู message ที่ Claude Code show → ตัดสินใจว่าจะให้ทำต่อ หรือ stop session

---

## Step 7 — เมื่อ Claude Code รายงานเสร็จ

Claude Code จะ output message สรุปแบบนี้:

```
## Phase 89.32 status — DONE

### Done
- [x] prefer-const: 28 fixes across 12 files
- [x] no-unused-vars: 47 fixes across 18 files
- [x] All 3 gates green

### Stats
- 16 commits
- Branch: claude/phase-89-32-warnings-cleanup
- Verify time: 32s (was 31s baseline)
```

### 7.1 Verify ผลด้วยตัวเอง

**สำคัญ — อย่า trust report blindly:**

```bash
git log --oneline main..HEAD
```

ดูจำนวน commits + commit messages — ตรงตามที่บอกไหม

```bash
git diff main --stat
```

ดูจำนวนไฟล์ + บรรทัด — สมเหตุสมผลไหม (75 fixes ≈ 75-150 บรรทัด ไม่ใช่ 1,500)

```bash
npm run verify
```

รัน gates อีกครั้งบนเครื่องคุณเอง — ต้องเขียวสะอาด

### 7.2 Spot check 2-3 commits

```bash
git log --oneline main..HEAD
```

เลือก 2-3 commits สุ่ม:

```bash
git show <commit-hash>
```

อ่าน diff — ดูว่า:
- ✅ Change ตรงกับ commit message
- ✅ ไม่มี logic change (เฉพาะ `let` → `const` หรือ rename)
- ✅ ไม่มีไฟล์ที่ไม่ควรแตะ

ถ้าเจออะไรน่าสงสัย → **อย่า merge** + ถามผม (หรือ Claude อีกตัว)

---

## Step 8 — Push + เปิด PR

```bash
git push -u origin claude/phase-89-32-warnings-cleanup
```

ใน output มี URL — copy เปิดในเบราว์เซอร์:
```
https://github.com/boonsook/boonsook-pos-v5/pull/new/claude/phase-89-32-warnings-cleanup
```

### 8.1 PR Title

```
Phase 89.32 — Warnings cleanup batch 1 (prefer-const + no-unused-vars)
```

### 8.2 PR Description

ขอ Claude (ผม) เขียน description ให้ — paste output ของ:

```bash
git log main..HEAD --oneline
git diff main --stat
```

มาให้ผมใน chat แล้วบอก "ขอ PR body" — ผมจะ generate ให้ครอบคลุม:
- สรุป
- Files changed
- Risk assessment
- Verification steps

### 8.3 รอ CI

GitHub Actions รัน `test.yml` workflow (~2 นาที) ผ่าน = ปุ่ม "Merge pull request" เขียว

---

## Step 9 — Merge + cleanup

### 9.1 Squash and merge

บน GitHub UI:
1. กดลูกศรข้างปุ่ม "Merge pull request"
2. เลือก **"Squash and merge"** (รวม commits)
3. แก้ commit message ให้สวย: `Phase 89.32 — Warnings cleanup batch 1 (#NN)`
4. กด "Confirm squash and merge"

### 9.2 Delete branch

หลัง merge มีปุ่ม **"Delete branch"** สีเทาๆ — กดเพื่อลบ branch บน GitHub

### 9.3 Local cleanup

กลับมา terminal:

```bash
git checkout main
git pull
git branch -D claude/phase-89-32-warnings-cleanup
```

เสร็จรอบ 🎉

---

## Tips จากประสบการณ์

### ทำรอบแรกแบบเล็กก่อน
รอบแรกเลือก scope **30 นาที** ไม่ใช่ **4 ชั่วโมง** — เพื่อให้คุณเห็น workflow ทำงานจริง รู้ว่า Claude Code report แบบไหน รู้ว่า PR ออกมาแบบไหน หลังจากนั้นค่อย scale ขึ้น

### Schedule ใหญ่ๆ ตอนนอน
Phase ที่ใช้เวลา 4-6 ชั่วโมง (เช่น M4 part 2) — เริ่มก่อนนอน Claude Code ทำงานข้าม session ได้ ตื่นมาตรวจ PR

### อ่าน commit message แบบ skim
Claude Code commit message format ปกติ: `<type>(<phase>): <short summary>` ถ้า skim 16 commits เห็น pattern ผิด (เช่น type ไม่ตรง phase ผิด) = สัญญาณว่า Claude Code หลงไปทำอย่างอื่น

### อย่ารัน 2 Claude Code session บน branch เดียว
จะ overwrite กันเอง ถ้าอยาก parallel — branch แยก scope แยก

### เก็บ batch prompt ทุกตัว
ไฟล์ `CLAUDE_CODE_PROMPT_89_32.md` เก็บไว้ใน repo (commit ด้วย) — เป็น history ของวิธีคิดในแต่ละรอบ

---

## เมื่อเจอปัญหา

### Claude Code วน loop ไม่หยุด
แสดงว่า gates fail ซ้ำๆ แล้ว Claude Code ไม่ยอมแพ้ — กด Ctrl+C หยุด → check `git log` ดูว่าหยุดที่ commit ไหน → ถามผมว่าทำต่อยังไง

### Gate fail ที่ npm run test:e2e
มักเป็น Playwright ที่ python3 server เปิดไม่ติด — รัน `npm run test:e2e` แยกเอง บน terminal อื่นเพื่อ debug

### PR conflict ตอน push
Origin/main มี commits ใหม่ → กลับมา local:
```
git fetch origin
git rebase origin/main
```
แก้ conflict (ถ้ามี) → push ใหม่: `git push --force-with-lease`

### Claude Code แก้ test ให้ผ่าน
ตรวจจาก `git log --stat tests/` ถ้าเห็นไฟล์ test มี deletions เยอะ = สัญญาณว่าโกง → revert commit นั้น: `git reset --hard <commit-ก่อนหน้า>` แล้ว push --force-with-lease (เฉพาะถ้ายังไม่ merge)

---

## Phase 89.32 — Quick start

ถ้าพร้อมเริ่มเลย ทำตามนี้ทันที:

```bash
cd "C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github"
git checkout main
git pull --ff-only origin main
npm run verify             # baseline ต้องเขียว
git checkout -b claude/phase-89-32-warnings-cleanup
copy CLAUDE_CODE_PROMPT.md CLAUDE_CODE_PROMPT_89_32.md
notepad CLAUDE_CODE_PROMPT_89_32.md
# (แก้ Mission + Workflow + Hard rules ตามที่ Step 4 บอก)
# Save + ปิด
claude --dangerously-skip-permissions
# (paste เนื้อหา CLAUDE_CODE_PROMPT_89_32.md ทั้งบล็อก)
# (กด Enter)
# (ไปทำธุระอื่น)
```

หรือ ขอผมเขียน `CLAUDE_CODE_PROMPT_89_32.md` ให้พร้อม paste ไม่ต้องแก้เอง — บอกผมว่า "เขียน prompt 89.32 ให้" ผมจะสร้างให้ใน 1 นาที
