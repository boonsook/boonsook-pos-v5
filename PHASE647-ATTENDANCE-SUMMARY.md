# Phase 647 — Attendance summary (local candidate)

Baseline: main `254f09213697ad7366a19a05eb3976ad7fe5e603`, build 642.
Branch: `codex/phase-647-attendance-summary`. Candidate: build 643 / v5.69.110.
Owner approved a summary directly on the time-clock page on 2026-10-07.

## Contract

- Admin manager view only, alongside existing clock controls. Existing self-service unchanged.
- Default current Bangkok month; this week means Monday through Sunday, including month/year boundaries. Custom inclusive work-date range.
- One distinct stored `work_date` with a valid clock-in per employee counts as one day, even with multiple sessions or a missing clock-out. Cross-midnight sessions count under the recorded work date, not every calendar day touched.
- Show zero for known staff without a matching row; explicitly not an absence determination. Retain rows for IDs absent from current profile list under an unknown-name label.
- Show open-session and cross-day/invalid-exit counts separately for manual review. No earned OT, payable days, attendance approval, leave, payroll or historical-data correction is introduced.
- Dedicated GET-only paginated reader asks for exact count, checks page boundaries, duplicate IDs and stable count. A server page cap below 500 is supported. Missing count, inconsistent pages, HTTP failure, invalid rows or more than 20,000 rows fail visibly; no partial total or false zero. Timeout 15 seconds and latest-request guard.
- Counts are the rows visible to current credentials at load time. Multiple HTTP pages are not a database transaction/snapshot; concurrent edits with unchanged counts may not be detectable. Refresh after attendance changes.
- Existing history, export, open-session display, clock-in/out/edit, offline sync and all hour/OT calculations are unchanged. The summary range is separate from the existing detailed-history range.

## Scope / overlap

New `modules/attendance_summary.js`, small manager-view integration in `modules/time_clock.js`, focused unit/browser tests, build/cache pins and these shared records only. No credit/refund, SQL/RLS, auth, payroll or production data edits. Separate worktree; no checkout/reset/stash in another team's tree.

## Verification and release boundary

Unit cases cover duplicate days, open and overnight sessions, zero/unknown staff, invalid ranges/rows, leap dates, month/year boundaries, capped pagination, count drift, denial, missing metadata, duplicate pages and aborts.
Browser fixture imports the real manager renderer on localhost, blocks external networking, mocks attendance reads and checks desktop/mobile, presets, custom range errors, XSS escaping, HTTP failure/recovery and stale requests. No production session is used for tests.

Local gates: lint 0 errors; full unit 3,911/3,911; full browser 439/439 (no retry). The full browser run began before the final post-load abort check; the focused HR suite is rerun on final source and its result recorded in delivery evidence. Commit and logs belong in the delivery report. No push, PR, CI, deployment or production smoke is claimed by this local note. Before release reconcile latest main/build pins and independently review this exact change. No SQL is needed. Do not rerun Phase 645/646 SQL.

Known separate findings: production had unusually long closed sessions and different open-session counts between HR Overview and time-clock. This feature surfaces review counts; it does not resolve those historical records or rewrite the other dashboard.

STOP: READY-FOR-INDEPENDENT-PHASE647-REVIEW.
