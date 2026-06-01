# Boonsook POS V5 - Shared Session Start

Last updated: 2026-06-01 07:35 ICT

Purpose: this is the common first-read note for Codex, Claude, or any next agent opening a fresh session on this project. Read this before changing files so both teams start from the same facts.

## Project Snapshot

- Project: Boonsook POS V5 PRO, Thai POS PWA.
- Workspace: `C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github`
- Main app version: `5.64.0`
- Latest pushed commits seen:
  - `cb6dbf0` `docs(92.46c): close JE REST RLS incident - verified + applied SQL`
  - `a11bc9a` `fix(92.47): expense export date filter - use Bangkok TZ not UTC`
  - `f858008` `diag(92.46b): DECISIVE INSERT test (DB vs REST/cache)`
- Git push range reported successful: `f858008..cb6dbf0`
- GitHub Actions reported successful:
  - Tests workflow: success
  - Deploy to Cloudflare Pages: success
- Production domain used in prior smoke work: `https://boonsukair.com/`
- Supabase project URL used by verification scripts: `https://rwmmjljelpcpwohwiplu.supabase.co`

## Current Truth As Of 2026-06-01

Phase 92.47 expense export date filter is fixed and committed.

- Root cause was UTC date usage in `modules/expenses.js`.
- The fix uses Bangkok-date behavior for default filters and form/OCR dates.
- Commit: `a11bc9a`
- Verified by the previous team:
  - `node --test tests/expenses_export_filter.test.js` passed `3/3`
  - `node --test tests/*.test.js` passed `777/777`
  - `npm run lint:errors` passed
- Deploy note: code is on the server after successful Cloudflare deploy, but this fix did not bump `APP_BUILD`, `sw.js` cache, or `main.js?v=...`. Users with an old PWA/service-worker cache may need `Ctrl+Shift+R` or the next build bump before they receive the changed `expenses.js`.

Phase 92.46c accounting JE REST RLS is fixed, SQL was applied in Supabase, and verification passed.

- Commit: `cb6dbf0`
- Root cause was not the INSERT whitelist. Non-admin INSERT worked with `return=minimal`.
- Real blocker was PostgREST SELECT-back after insert (`return=representation` / `headers-only`) being blocked by admin-only `je_select`.
- Applied DB fix: add permissive `je_select_auto` SELECT policy for non-admin auto-post source headers, excluding `staff_payroll`.
- Verified after SQL apply:
  - `node scripts/diag_je_rest.js`
    - non-admin representation: `201`
    - non-admin minimal: `201`
    - non-admin headers-only: `201`
  - `npm.cmd run verify:accounting`
    - A1-A6 all PASS
    - A2 sales journal entry: `201`
    - A2b orphan count stayed `85 -> 85`
  - `npm.cmd run verify:je`
    - entry insert: `201`
    - journal lines insert: `201`

Backfill decision:

- Live backfill was intentionally skipped after dry-run/analysis because remaining rows were non-actionable skips.
- Expected remaining summary is not an open incident:
  - pre-effective rows before `2026-05-01`
  - zero-amount sale row
  - remaining counts such as `sales_without_journal=85` are treated as stable intentional/non-actionable state unless new evidence appears.

## Dirty Worktree Notes

Do not assume every untracked/modified file is yours.

Known status seen after the latest commits:

- `package.json` modified locally because it contains the `verify:je` script line.
- Untracked helper/docs files may exist from previous sessions:
  - `SKILL.md`
  - `WORK_CONTINUATION_RUNBOOK.md`
  - `project-patterns.md`
  - `scripts/diag_je_rest.js`
  - `scripts/verify_je_fix.js`

Treat these as session artifacts unless the user asks to commit or clean them. Do not revert them without explicit permission.

## Start-Of-Session Checklist

Run these first when taking over:

```powershell
git status --short --branch
git log -3 --pretty=format:'%h %ad %s' --date=iso
npm.cmd run lint:errors
npm.cmd test
```

For accounting/RLS work only, also run:

```powershell
node scripts\diag_je_rest.js
npm.cmd run verify:accounting
npm.cmd run verify:je
```

Use `npm.cmd` on Windows PowerShell because plain `npm` may be blocked by script execution policy.

## Operating Rules For Both Teams

- This is a live business POS. Make narrow, verified changes.
- Search before guessing. Prefer `rg`.
- Preserve Thai UI copy unless the user explicitly asks to rewrite it.
- Do not rename public IDs, localStorage keys, exported functions, cache names, event names, or DB policy names without tracing every usage.
- Do not change service worker/cache behavior unless the request is specifically about deployment/cache/offline behavior.
- Do not mark an accounting incident closed unless `verify:accounting` and `verify:je` pass against live Supabase.
- If a SQL fix must be applied, the user may need to run it in Supabase SQL Editor. The local `.env` has anon/user credentials, not a postgres/service-role DDL path.
- When committing, stage only files relevant to the current task. Leave unrelated dirty files alone.

## Good Next Actions

If opening a new session with no new user request:

1. Confirm whether users need immediate PWA cache relief for the expense export fix. If yes, consider a proper build/cache bump touching the normal build/version files.
2. Confirm whether the local `package.json` / script helper files should be committed, left local, or cleaned.
3. If the user wants a project monitor automation, use this file as the source-of-truth prompt context.

## Short Human Summary

Expense export timezone bug is fixed, pushed, and CI/deploy passed, with a PWA cache caveat because no build/cache bump was included. JE REST RLS is fixed, pushed, and live-verified after SQL apply. Remaining accounting orphan counts are currently understood as intentional/non-actionable skips, not an active failure. Start new work from `git status`, avoid touching unrelated session artifacts, and verify with `npm.cmd` commands on Windows.
