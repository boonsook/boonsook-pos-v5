# Boonsook POS V5 - Shared Session Start

Last updated: 2026-06-01 (Phase 92.50 — HR executive dashboard detail view, build 320)

Purpose: this is the common first-read note for Codex, Claude, or any next agent opening a fresh session on this project. Read this before changing files so both teams start from the same facts.

## Project Snapshot

- Project: Boonsook POS V5 PRO, Thai POS PWA.
- Workspace: `C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github`
- Main app version: `5.64.0`
- Latest pushed commits seen:
  - `3b4072b` `fix(92.48): integrity panel orphan fetch uses select=* (build 318)`
  - `71ef2ba` `fix(92.48): bump boot.js + style.css ?v= to 317 (build-sync smoke)`
  - `50ec7dd` `feat(92.48): accounting integrity status panel on backfill page`
  - `6e33358` `docs(ops): align Codex guardrail docs with project`
  - `d0d2b2f` `chore(92.47b): bump PWA cache and add shared ops notes`
  - `cb6dbf0` `docs(92.46c): close JE REST RLS incident - verified + applied SQL`
  - `a11bc9a` `fix(92.47): expense export date filter - use Bangkok TZ not UTC`
- Git push range previously reported successful: `f858008..cb6dbf0`
- GitHub Actions reported successful:
  - Tests workflow: success
  - Deploy to Cloudflare Pages: success
- Production domain used in prior smoke work: `https://boonsukair.com/`
- Supabase project URL used by verification scripts: `https://rwmmjljelpcpwohwiplu.supabase.co`

## Current Truth As Of 2026-06-01

Phase 92.50 HR executive dashboard detail view is implemented locally (build 320).

- `modules/hr_overview.js` now renders a full dashboard-style section above the existing HR operational table: hero/benefits, context filters, KPI cards, department bars, role donut, attendance status, recent attendance trend, leave breakdown, contract/probation watchlist, and data-source notes.
- New pure helper: `buildHrDashboardMetrics()` aggregates read-only HR metrics from profiles, departments, attendance, payroll, and leave rows.
- `_fetchHrData()` adds a graceful `staff_leaves` read. If the table/RLS/network fails, the page shows the existing warning pattern and does not crash.
- No SQL/RLS/schema change; no payroll/accounting/JE mutation.
- Build/cache bumped 319 -> 320 across `index.html` and `sw.js`.

Phase 92.49 HR attendance exception rules is implemented (build 319).

- Adds late / early-leave classification using existing Time Clock + shift data. Informational only — does NOT block clock-in/out and does NOT touch payroll, OT, leave, accounting, or JE RLS.
- New pure helpers in `modules/time_clock.js` (exported, tested): `classifyPunctuality(row, shift, opts)` returning `{status, lateMinutes, earlyLeaveMinutes}` with statuses `on_time|late|early_leave|late_and_early_leave|missing_clock_out|none`; `attendanceRulesFromState(state)` reading `lateGraceMinutes`/`earlyLeaveGraceMinutes` (default 15/15) from `storeInfo`; `punctualityChipMeta(punc)`.
- `modules/hr_overview.js`: late/early chips in the today table + drill-down modal, plus aggregated `late_arrivals`/`early_leaves` alerts (gated on passing `shiftOpts`+`attendanceRules` so old behavior/tests are preserved).
- `modules/time_clock.js` manager report shows the chip per row.
- `modules/settings/store.js`: new grace-minute inputs (validate >= 0, clamp 0–240) stored in `storeInfo`. NO SQL/RLS/schema change.
- Verification: `npm.cmd run lint:errors` clean; `npm.cmd test` 809 pass (+25 new); `npm.cmd run verify` e2e 11 pass including build-sync smoke.
- Build/cache bumped 318 -> 319 across `index.html` (data-app-build + selfheal/main/boot/style.css `?v=`) and `sw.js` (`cache-v319` + version marker).

Phase 92.48 accounting integrity status panel is shipped.

- Commit: `50ec7dd`
- Adds an accounting integrity status panel on the backfill page (`modules/accounting/backfill.js`).
- Reuses `accounting_integrity_summary()` and the `vw_*_without_journal` views.
- Buckets orphan rows into actionable vs intentionally skipped so stable legacy/test rows are not treated as an active failure.
- Hotfix commit: `3b4072b`
  - Changed orphan-row fetch to `select=*`.
  - Reason: build 317 selected `grand_total` from `sales`, but `sales` has no `grand_total` column, causing PostgREST 400 and classifying 85 sales rows as unknown.
  - Build/cache bumped from 317 to 318.
- Verification recorded in repo history:
  - `tests/accounting_integrity_panel.test.js` added
  - lint clean
  - build bumped from 316 to 318 through the Phase 92.48 commits
- Commit `71ef2ba` completed build-sync by bumping `boot.js?v=` and `style.css?v=` to 317.

Phase 92.47 expense export date filter is fixed and shipped.

- Root cause was UTC date usage in `modules/expenses.js`.
- The fix uses Bangkok-date behavior for default filters and form/OCR dates.
- Commit: `a11bc9a`
- Verified by the previous team:
  - `node --test tests/expenses_export_filter.test.js` passed `3/3`
  - `node --test tests/*.test.js` passed `777/777`
  - `npm run lint:errors` passed
- Build/cache delivery note: Phase 92.47 initially shipped without a client bump, then Phase 92.47b/92.48 bumped PWA build/cache. Current local and live build markers are 318.

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

## Current Worktree Notes

As of 2026-06-01 13:45 ICT, `git status --short --branch` showed `main...origin/main` with only this `SESSION_START_SHARED.md` documentation update modified.

The previous local artifact files are now committed:

- `SKILL.md`
- `WORK_CONTINUATION_RUNBOOK.md`
- `project-patterns.md`
- `scripts/diag_je_rest.js`
- `scripts/verify_je_fix.js`

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

1. Verify the live app build markers on `boonsook-pos-v5.pages.dev` if deployment freshness matters: `data-app-build="319"`, `main.js?v=319`, `style.css?v=319`, `boot.js?v=319`, and `sw.js` cache `v319`.
2. If the user wants a project monitor automation, use this file as the source-of-truth prompt context.

## Short Human Summary

Latest app build is 319 on `main`. Phase 92.49 adds HR late/early-leave attendance exception rules (informational only — no payroll/leave/accounting/RLS/SQL impact). Phase 92.48 adds the accounting integrity status panel and hotfixes the orphan fetch to `select=*`. Expense export timezone bug is fixed and delivered through later PWA cache bumps. JE REST RLS is fixed and live-verified after SQL apply. Remaining accounting orphan counts are currently understood as intentional/non-actionable skips, not an active failure. Start new work from `git status`, avoid touching unrelated user work, and verify with `npm.cmd` commands on Windows.
