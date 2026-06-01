---
name: boonsook-pos-guardrails
description: Guardrail workflow for fixing, reviewing, or modifying the Boonsook POS codebase. Use when working in the boonsook-pos-v5 GitHub workspace, especially for bug fixes, UI changes, service worker/cache changes, settings/user modules, payment/cart/order flows, deployment checks, git staging/commits, or any task where Codex should avoid guessing, preserve existing behavior, and verify changes before reporting done.
---

# Boonsook POS Guardrails

## Operating Rule

Treat this POS codebase as a live business tool. Prefer narrow, verified changes over clever broad rewrites. Before editing, build enough local context to name the expected behavior, current behavior, likely cause, and files to touch.

## Highest-Risk Areas (treat as blocking)

This system handles real money, full double-entry accounting, and multi-tenant customer data. Be especially strict here (detail in `project-patterns.md`):

- Money & transactions (`modules/pos.js`, `payment_gateway.js`, `cash_recon.js`, `credit_tracker.js`): totals/change/discount/VAT must be exact. Watch floating point — money is satang-based or rounded by an explicit rule. VAT is 7%; keep inclusive vs exclusive correct. Multi-payment/void/refund: payments must sum to the bill, and void/refund must reverse every linked record (including loyalty points).
- Concurrency (`_inflight_guard.js`, stock logic): stock uses compare-and-swap to prevent oversell — do not downgrade to read-modify-write. Checkout is guarded against double-submit (inflight guard / idempotency key); never remove or bypass a guard.
- Double-entry accounting (`modules/accounting/*`): every journal entry must balance (debit total = credit total). `auto_post.js` maps accounts per `coa.js` and posts idempotently by `source_table`+`source_id`. A closed period is locked — no back-posting.
- Security & RLS (`functions/*`, `supabase-*.sql`): Supabase RLS is the real security boundary; client-side `permission_matrix.js` checks are UX only. `service_role` keys must never reach the client bundle (only `anonKey` may). New RLS policies must be tenant/shop scoped; lock privileged columns with a BEFORE-trigger, not just `WITH CHECK`.
- XSS: building HTML by hand means `innerHTML` + user/DB data is the top risk — escape or use `textContent`/DOM API, and add a regression test for new render points.

## First Pass

1. Identify the task type: bug fix, UI change, data/state change, deployment/cache, review, or git workflow.
2. Search before assuming. Use `rg`/`rg --files` for filenames, IDs, event handlers, labels, storage keys, route names, and function names.
3. Read the nearest implementation and at least one nearby caller or consumer.
4. Check existing patterns for DOM updates, state persistence, localStorage/IndexedDB usage, Thai UI copy, and module exports before adding a new pattern.
5. If the task touches behavior users can see, plan a manual browser verification path before editing.

## Edit Rules

- Keep edits scoped to the requested behavior and adjacent code required to make it work.
- Preserve Thai UI text unless the user explicitly asks to rewrite copy.
- Do not rename public IDs, storage keys, exported functions, cache names, or event names without tracing every usage.
- Do not change service worker caching, app versioning, or offline behavior unless the task is specifically about deployment/cache/offline issues.
- Do not introduce a framework, build step, or large abstraction for a local fix.
- Do not "clean up" unrelated code while fixing a narrow issue.
- Prefer existing utilities, modules, and naming style over new helpers.
- If the worktree already has unrelated changes, leave them alone and work around them.
- ES modules only: use `import`/`export`, never `require()`. This project has zero runtime dependencies (only devDeps) — do not add an npm dependency without flagging it and asking why.
- Do not use `alert()`/`confirm()` for UI feedback; use the project's `showToast` helper.
- A build/cache bump must update all of these together or the in-app update check is misleading: `data-app-build` + `selfheal.js?v=` in `index.html`, `main.js?v=` in `index.html`, and `CACHE_NAME` in `sw.js`. (`pages.js` reads `window.APP_BUILD` dynamically — no hardcoded number there.) For a CSS-only render change, bump `style.css?v=` in `index.html`.

## Verification

Run the smallest useful verification for the change:

- For static HTML/JS/CSS changes, run syntax checks where possible and inspect the touched path in browser when it affects UI.
- For service worker/cache changes, verify reload/offline/update behavior and explain cache risk.
- For payment, cart, order, user, or settings flows, verify the exact user path plus one nearby regression path.
- For code review, lead with concrete findings and file/line references.
- If a verification step cannot run, say exactly why and describe the residual risk.
- Merge gate is `npm run verify` (lint + unit + e2e); on Windows use `npm.cmd` (plain `npm` may be blocked by execution policy). For accounting/RLS changes also run `npm run verify:accounting` and `npm run verify:je` against live Supabase before declaring done.
- Date/"today" filtering must use Asia/Bangkok, not UTC. Money/number/date formatting goes through the shared formatters util — don't hardcode formats.
- After a push, verify BOTH the GitHub Actions conclusion AND the live build markers (`data-app-build`, `main.js?v=`, `sw.js` cache) on the canonical URL `boonsook-pos-v5.pages.dev` — not just that CI is green.

## Response Contract

Final responses must be short and concrete:

- State what changed.
- Name what was verified.
- Mention any remaining risk or skipped verification.
- For git actions, report successful staging/commit/push only after the command succeeds.

## Common Failure Patterns

Avoid these repeated mistakes:

- Guessing a file path or function name from memory.
- Editing a generated or cached copy instead of the source file.
- Fixing a symptom in UI code while ignoring the underlying state update.
- Saying "done" after only reading code.
- Broadly changing CSS that affects shared POS screens.
- Breaking mobile layout by adding text that cannot wrap inside controls.
- Overwriting user work in a dirty worktree.

## Project Notes

- Read `SESSION_START_SHARED.md` first for the current shared state (live build/version, open incidents, dirty-worktree notes) — it is the source of truth across Codex/Claude sessions.
- Read `project-patterns.md` (repo root) for project-specific detail when a task touches money/accounting, RLS/security, service workers, settings/users, POS layout, persistence, or git workflow.
- `WORK_CONTINUATION_RUNBOOK.md` holds historical incident detail and the phase roadmap; treat its older "current blocker" sections as history unless `SESSION_START_SHARED.md` says otherwise.
- `CLAUDE.md` is the authoritative review/guardrail spec for this repo; keep this skill aligned with it.
