# Implement Team Protocol - Boonsook POS V5

This is the canonical operating protocol for the implementation team, including Claude Code sessions.

Read this file before changing anything. Do one phase at a time. Stop after the phase and wait for owner/Codex review.

Last updated: 2026-06-05
Latest known app state: version 5.66.0, build 369.

## Role

You are the implement team for Boonsook POS V5, a live business POS/PWA.

Your job is to implement the explicitly approved phase only. Do not invent the next phase. Do not continue after the current phase without review.

## Read Order

At the start of every new session, read in this order:

1. `IMPLEMENT_TEAM_PROTOCOL.md`
2. `PROMPT_PHASE_BRIEF_SKILL.md` when drafting or implementing from a phase prompt
3. `SESSION_START_SHARED.md`
4. Latest relevant section of `HANDOFF.md`
5. Latest relevant section of `CHANGELOG.md`
6. `CLAUDE.md` for review/security guidance

Old Claude files such as `CLAUDE_CODE_PROMPT.md`, `CLAUDE_CODE_WORKFLOW.md`, and `CLAUDE_SESSION_HANDOFF.md` are historical only unless the owner explicitly says otherwise.

## Non-Negotiable Rules

- Work on one phase only.
- Stop after the phase. Do not begin the next phase yourself.
- Do not touch files outside scope.
- Do not overwrite or revert local work from another session.
- Do not change stock, POS, cart, schema, auth, API, accounting, or SQL unless the approved phase explicitly says so.
- Do not auto-save documents, change workflow status, or mutate stock unless explicitly approved.
- Do not call work done until lint, tests, CI/deploy, and live/build checks are reported.
- If scope is unclear, stop and ask.

## 🔴 Iron Rules — Money/Stock/Cross-cutting (มี 2026-06-08, learned the hard way)

มีกฎพวกนี้เพราะงานที่ "แก้จบ/ผ่านแล้ว" กลับมาพังซ้ำ — เสียเวลาวนแก้เป็นเดือน. **บังคับ** ทุกครั้งที่แตะเงิน, สต็อก, หรือ value/function ที่ใช้ร่วมหลายไฟล์ (เช่น `products.stock`, `warehouse_stock`, `total_cost`, `gross_profit`, การตัดสต็อก, checkout/save flow):

1. **Grep ทุก writer/reader ก่อน — ห้าม reason จากไฟล์เดียว.** ก่อน spec/แก้ field หรือ function ที่ใช้ร่วม → `grep` ทั้ง repo หาทุกจุดที่เขียน/อ่านมัน แล้ว **list ออกมา**. (เคย: fix แก้ `products.stock` แค่ 2 ใน 4 จุด → ลืม grep อีก 2 จุด (POS) → ทำ POS ตัดสต็อกซ้ำทุกบิล — reviewer จับได้ก่อนพอดี.)
2. **Derived value มี writer เดียว.** `products.stock = sum(warehouse_stock)` ฯลฯ ต้อง maintain ที่เดียว (DB trigger/RPC ดีสุด), ห้าม mirror แยกหลาย JS path. mirror แบบ best-effort = หลุด sync เงียบ ๆ.
3. **Verify runtime จริง ไม่ใช่อ่านโค้ดนิ่ง.** UI/layout/behavior → render ที่ขนาดจริง (~360px มือถือ) หรือ smoke ของจริง — **ห้าม** สรุป "ปลอดภัย" จากค่าใน CSS/โค้ด. (เคย: `min-width:200px` ถูกตัดสินว่า safe โดยไม่ render → 5 หน้า report แตกบนมือถือ.)
4. **Audit ของรอบ ๆ + ข้างใน helper ด้วย ไม่ใช่แค่ diff.** money/stock change → ตรวจ (ก) guard เดิมที่ป้องอยู่ (single-flight/inflight) (ข) internals ของ helper ที่เรียก. "shared/tested" ≠ ปลอดภัย. (เคย: saveServiceJob ไม่มี inflight guard → กดบันทึกรัว = double-submit → ตัดสต็อกซ้ำ.)
5. **ล็อก invariant ด้วย guard test (กัน regression).** fix ยังไม่จบจนกว่ามี test ที่ **fail ถ้า behavior พัง**. นี่คือกฎที่หยุดวงจร "ผ่านแล้ว → พังอีก". source-regex: extract function body ก่อน (อย่า grep ทั้งไฟล์).
6. **Money/stock = owner smoke ก่อน merge.** code review + unit test พิสูจน์ stock/เงินจริงไม่ได้. ใช้ preview deploy (`gh workflow run main.yml --ref <branch>` → preview URL, prod ไม่ขยับ) ให้ owner ลองข้อมูลจริงก่อน merge.

## Phase Start Checklist

Before editing files, report:

- Current branch and latest commit.
- Ahead/behind versus `origin/main`.
- Whether the working tree is clean.
- Latest build and phase from shared docs.
- Approved phase name.
- Files likely to be touched.
- Files and systems that will not be touched.
- Verification plan.

Required commands:

```bash
git fetch origin
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
git log --oneline -5 origin/main
```

If local changes exist and are not yours, stop and report. Do not stash, reset, revert, or commit them without approval.

### Parallel sessions — use a separate git worktree (required when another session may run against this clone)

A single clone shares one `.git` = one HEAD + index + working tree. If another Claude/Codex session runs against the SAME clone at the same time, its `git checkout` / `commit` changes YOUR state mid-work: your staged files can float onto the wrong branch and commits can land astray. This happened in **Phase 569** — a parallel Phase 568 session switched HEAD and the ning-memory staged files ended up on the drawer branch (recovered via branch surgery, but avoidable).

**Isolate with a worktree — do NOT share one working tree:**

```bash
# from the main clone; picks its OWN HEAD/index/tree — the other session is untouched
git worktree add ../bpos-wt-<slug> -b claude/phase-NN-<slug> origin/main
cd ../bpos-wt-<slug>
# ... edit, verify, commit, push, open PR ...
git worktree remove ../bpos-wt-<slug>     # after merge
```

- Before `git worktree remove`, delete any `node_modules` **junction** inside the worktree first — `--force` can follow the junction and wipe the main clone's `node_modules`. A fresh worktree with no `npm install` has none, so it is safe (run `npm ci` inside the worktree only if you need tests there).
- Claim your phase number first: `git branch -r | grep <NN>` (remote) + local branches — Phase 569 had to renumber off 568 because a parallel session already took it.

**If you truly must share one tree:** before every `git add` / `git commit`, re-run `git status --short --branch` to confirm you are still on your own branch; stage **explicit paths only** (never `git add -A`, or you sweep the other session's files); verify committed blobs with `git cat-file blob <sha>:<file>` (not `git show | grep`, which the local `core.autocrlf=true` smudge makes lie about CRLF).

## Implementation Rules

- Prefer existing local patterns over new abstractions.
- Keep UI-only work UI-only.
- Escape user/DB text before rendering with `innerHTML`.
- Preserve Thai UI wording unless the phase requests wording changes.
- For PWA/cache changes, bump every required build/cache marker together.
- For air catalog work, remember:
  - The air catalog is not real inventory.
  - Do not link it to `products`, POS cart, stock value, or stock mutation.
  - It is for pricing, quotation drafts, booking, and service-request context only.

## Verification Gates

Run the smallest complete verification for the phase. Default gates:

```bash
npm run lint:errors
npm test
npm run test:e2e
```

For UI/mobile work, also smoke test 390x844 and at least one desktop viewport.

Check for:

- No text overlap.
- No horizontal overflow.
- No floating button covering important content.
- Existing nearby flows still work.
- No forbidden stock/POS/cart/schema/API mutation.

If a test cannot run, report why and the residual risk.

## Commit / Push Rules

Before commit:

```bash
git diff --stat
git diff --name-only
git status --short
```

Commit only scoped files. Use a phase/build-aware message, for example:

```bash
git commit -m "feat(service_jobs,build 352): air job source filter"
```

After push:

- Wait for GitHub Actions Tests.
- Wait for Cloudflare Pages deploy if runtime files changed.
- Verify live build marker when relevant.

## Shared Docs Update

After a phase completes, update:

- `CHANGELOG.md`
- `HANDOFF.md`
- `SESSION_START_SHARED.md`

Keep entries short. Include:

- Phase and build.
- Commit hash.
- Files changed.
- What changed.
- What was not touched.
- Verification results.
- Known risk.
- Next recommended phase.
- STOP marker.

Do not paste a huge transcript. Summarize only the facts needed for the next session.

## Required Final Report Format

Use this format:

```text
Phase:
Build:
Commit:
Files changed:
What changed:
What was NOT touched:
Verification:
- lint:
- tests:
- e2e:
- mobile smoke:
- desktop smoke:
- CI:
- deploy:
Live marker:
Known risks:
Next recommended phase:
Stopped here: yes
```

If `Stopped here` is not `yes`, explain why.
