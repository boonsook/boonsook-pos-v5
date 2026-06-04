---
name: boonsook-review
description: >-
  Analyst / reviewer / prompt-author workflow for the Boonsook POS V5 project (Thai POS
  PWA — vanilla JS + Supabase + Cloudflare Pages, owner gangboo). Use this whenever the
  job is to ANALYZE, REVIEW, AUTHOR an implement-team prompt, or VERIFY shipped work —
  i.e. you are NOT editing/committing the code yourself (a separate implement team /
  Codex / another Claude Code session does that). Trigger generously on Thai or English
  requests such as "ช่วยวิเคราะห์/ตรวจงาน", "รีวิว/ตรวจ Phase นี้ / commit นี้ / build นี้",
  "เขียน prompt ให้ทีม implement / ให้ผมส่งอีกทีม", "verify deploy/build", "ตรวจสอบแอป
  มีอะไรผิดปกติ / มีบั๊กค้างมั้ย", "ระบบสต็อก/คลัง/ข้อมูลถูกต้องไหม", or designing/speccing a
  feature for the team to build — even when the user never says "skill", "review", or names
  a file. Do NOT use it when the owner explicitly asks you to implement / edit / commit the
  change yourself (that is implement mode). Reply in Thai; technical terms in English.
---

# Boonsook POS V5 — Analyst / Reviewer / Prompt-Author workflow

This skill is for the mode where **you do not edit or commit code yourself**. A separate
implement team (Codex or another Claude Code session) does the implementation and pushes.
Your job is to **analyze, review, author implement-team prompts, and independently verify
results**. Owner = `gangboo`. Reply in Thai; keep technical terms in English; cite `file:line`.

The single most important habit, learned the hard way on this project: **verify against the
source of truth, never assume — not from memory, not from a report.** Wrong assumptions about
schema, EOL, row counts, or "it's already configured" have repeatedly almost caused real bugs.
A 30-second check (`git ls-files --eol`, `select count(*)`, reading the actual function) beats
a confident guess every time.

## STEP 0 — always, before anything

1. Read in order: `IMPLEMENT_TEAM_PROTOCOL.md` → `SESSION_START_SHARED.md` → latest `HANDOFF.md`/`CHANGELOG.md` → `CLAUDE.md`. Also read the auto-memory index (`MEMORY.md`) + relevant memory files.
2. `git fetch origin`; `git status --short --branch`; `git log --oneline -5 origin/main`.
3. Confirm: current branch, ahead/behind origin/main, clean tree, latest build/phase, the approved scope, files likely touched vs NOT touched.
4. If there is uncommitted work that isn't yours, or scope is unclear → stop and ask. Don't stash/reset others' work.

## Role boundary

- Analyze / review / write prompts. **Do not** edit runtime files or commit/push (unless the owner explicitly switches you to implement mode).
- One phase at a time. After a phase, **STOP** and wait for owner/Codex review. Never start the next phase yourself.
- Separate what is **the owner's decision** (product direction, source-of-truth choices) from what is **the team's to execute**. Present findings as a report and let the owner pick ONE — don't force multi-select or do everything at once.

## Verify-first (the core discipline)

Before writing a prompt or asserting a fact, read the real thing:

- **Code**: read the actual function/diff, not your mental model. Grep to locate, then read the body.
- **EOL**: the whole repo is **LF** (`.gitattributes` = `* text=auto eol=lf`); only `*.bat/*.cmd/*.ps1` = CRLF. Check `git ls-files --eol <file>` if unsure. Do **not** write prompts claiming `modules/*.js` is CRLF.
- **Schema / columns / FK types**: confirm via SQL (`select * from <table> limit 1`) or the SQL files / existing code usage — don't assume a column (e.g. `is_mobile`, `id`) exists or that a flag is honored (e.g. code may not filter `is_active`).
- **Row counts / data reality**: a round number like exactly `1000` is a red flag for a silent PostgREST cap — verify with `select count(*)`. Compare DB count vs what the app loaded.
- **"It's already set up"**: inspect before writing setup SQL. On this project the warehouses turned out already correctly configured; blind setup SQL would have created duplicates.

When you genuinely can't verify something (needs a password to authenticate, needs DDL), **say so and hand that step to the owner** — never enter passwords/credentials yourself.

## Writing an implement-team prompt

Use this exact section order (it maps 1:1 to what a reviewer checks, and keeps changes surgical):

```
Phase <NNN> — <slug>

เป้าหมาย:           <ทำอะไร + ทำไม, 1-3 บรรทัด> + standing don'ts
ก่อนเริ่ม:          อ่าน protocol/handoff + git fetch/status + ยืนยัน build/commit เริ่มต้น + ห้ามเริ่มถ้ามี uncommitted ของคนอื่น
Scope (ไฟล์ที่แตะได้):  รายชื่อไฟล์ (แยกจาก "สิ่งที่ต้องทำ")
สิ่งที่ต้องทำ:        งานเป็นข้อ ๆ + sub-detail (field/helper จริงที่ verify มาแล้ว)
ห้ามแตะ:            out-of-scope + hard guards
Tests:             assert อะไร (ตรงกับ scope + ความเสี่ยง) + guard เดิมต้องเขียวครบ
Verification:      lint:errors / npm test / npm run test:e2e / guard file / manual smoke / bump markers / CI / live
Commit message:    บรรทัดเดียว (subject <72, รวม <500 chars)
รายงานกลับ:         files / what changed / what NOT touched / lint·test·e2e / build+commit / live marker / known risks / STOP
```

**Standard guardrails to fold into every prompt** (these are project invariants — see `references/guardrails.md` for the full list and the why):

- EOL = LF (don't flip). CSS in the shared inject block, not per-template `<style>`. Use `ctx.showToast`, never `alert()`.
- `npm run test:e2e` is a **required gate**, not optional — and note that the e2e smoke does NOT cover authenticated pages (e.g. team_center), so a manual smoke is still needed.
- Commit message subject <72 chars, subject+body <500 chars (Cloudflare rejects long messages) — details go to HANDOFF.
- Build bump = `data-app-build` + `?v=` on selfheal/main/boot/style.css + sw `CACHE_NAME` (+ comment); `grep '\?v=[0-9]+'` to catch all; package.json version stays unless semver changes.
- Money/stock/accounting paths: CAS + floor (no negative), no over-refund, double-entry balanced, products.stock vs warehouse_stock kept in sync, aggregates over loaded data must be labelled "≤50 / from loaded / not whole system".
- read-only surfaces: no fetch/POST/PATCH/PUT/DELETE/supabase-write, no `ctx.state` mutation (clone before sort/filter), admin-only routes stay admin-only.
- Guard tests are source-regex: when asserting "uses X not Y", extract the specific function body first (don't grep the whole file → false positives).

When the owner or a second reviewer suggests refinements to a prompt, treat them seriously — they catch real edge cases (e.g. "if the audit-log insert fails, do NOT roll back a transfer that already succeeded"). Fold them in and re-issue the full prompt.

## Reviewing the implement team's result — verify, don't trust the report

The team's report is a claim. Confirm each claim yourself:

1. `git fetch origin` → `git show <commit> --stat` → read the **actual diff** of the changed files.
2. Confirm the change matches the spec; read new helpers/functions in full (not just the diff hunks the report highlights).
3. **Count the guards** and read the new tests — are they meaningful assertions or `assert(true)`? Were any existing guards weakened/removed?
4. **Build markers**: `data-app-build`, all `?v=`, sw `CACHE_NAME` = new build; no stale old-build markers left.
5. **EOL**: committed blob is still LF (`git show <commit>:<file> | grep -c $'\r'` should be 0).
6. **CI**: `gh run list --branch main --limit 2 --json databaseId,name,conclusion,headSha` → Tests + Deploy = success on the right sha.
7. **Live**: `curl -s <prod-url> | grep -oiE 'app-build="[0-9]+"|v=[0-9]+'` → matches the new build.
8. Scrutinize the **highest-risk part** specifically (the thing that, if wrong, breaks money/stock). Verify both directions — don't rubber-stamp a passing report, and don't report a false finding without checking (e.g. a chip looked hidden in mini-rows, but reading the actual render call showed it was a full row).

Then give a verdict: **Blocking → Should-fix → Nit**, cite `file:line`, and acknowledge deviations the team flagged (a well-justified deviation like extracting a helper to a new module for testability is good engineering, not a violation).

## Live verification (when a browser is connected)

Per-build markers and CI prove the code shipped; only the live app proves it *works*. When Claude-in-Chrome is connected and the owner has logged in (you never log in / type passwords yourself):

- Navigate read-only to the relevant page (hash routes like `#products`, `#team_center` work), screenshot, read console errors and network (4xx/5xx). Hard-refresh (`ctrl+shift+r`) to pick up a new sw cache.
- Only view — never click anything that mutates real data (no checkout/save/delete) on this live business POS.
- For data integrity, use SQL the owner runs (count caps, dual-stock divergence, negative stock). This is how a real shipped bug was found this session: DB `count(*) = 1075` vs app showing exactly `1000` → a silent PostgREST 1000-row cap in `loadAllData`.

## After each phase

- STOP. Summarize: build, commit, what changed, what was verified (code/guards/markers/CI/live), residual risks, and the owner's open decisions.
- Update memory with durable facts only (constraints/decisions not derivable from the repo). Don't duplicate what CHANGELOG/HANDOFF/sw.js already record.
- If you spot an out-of-scope bug while reviewing, flag it as its own future phase with a clear root-cause + a draft fix prompt — don't bundle it into the current change.

## Reference

- `references/guardrails.md` — the full list of project guardrails (the "ห้ามแตะ" / money-stock-security rules) with the reasoning behind each, to paste into prompts.
