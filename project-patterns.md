# Boonsook POS Project Patterns

Project-specific reference for agents working on Boonsook POS V5 — a Thai POS PWA written in vanilla JS (ES modules, no build step), backed by Supabase (Postgres + RLS) and Cloudflare Pages Functions. Load this when a task touches one of the areas below. [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) is the canonical session protocol (read it first); `CLAUDE.md` is the authoritative guardrail spec; this file is the practical companion.

## Highest-Risk Areas (verify hard, treat as blocking)

### Money and transactions
Files: `modules/pos.js`, `payment_gateway.js`, `cash_recon.js`, `credit_tracker.js`, `functions/api/verify-slip.js`.
- Totals, change, discount, and VAT must be exact. Watch floating point — money is handled in the smallest unit (satang) or rounded by an explicit rule; never ship a raw `0.1 + 0.2`.
- VAT is 7%. Keep inclusive vs exclusive correct and round the way the accounting side expects.
- Multi-payment / quick-pay / void / refund: payments must sum to the bill exactly; void/refund must reverse every linked record, including loyalty points (`tests/loyalty_reverse_sale.test.js`).
- Payment-flow guards exist (`multi_payment_guard`, `quick_pay_guard`, `checkout_inflight`). If you touch a payment flow, keep or add the matching guard test.

### Concurrency and idempotency
Files: `modules/_inflight_guard.js`, `pos.js` checkout, stock logic.
- Stock uses compare-and-swap (`tests/stock_cas.test.js`) to prevent oversell under concurrent requests. Do not downgrade to read-modify-write.
- Checkout is guarded against double-submit (inflight guard / idempotency key). Never remove or bypass a guard.
- Watch races between the offline queue and online sync — reconcile without duplicating or losing writes.

### Double-entry accounting
Files: `modules/accounting/*` (`journals.js`, `journal_form.js`, `auto_post.js`, `trial_balance.js`, `balance_sheet.js`, `profit_loss.js`, `periods.js`), `coa.js`.
- Every journal entry must balance: debit total = credit total. No unbalanced JE may escape.
- `auto_post.js` maps accounts per the chart of accounts (`coa.js`); see `tests/auto_post.test.js`. Posting is idempotent by `source_table` + `source_id`.
- Period close locks the period — no editing or back-posting into a closed period (guarded by `trg_check_period_locked`).
- Changing trial-balance / P&L / balance-sheet math requires a matching test.
- Verify accounting/RLS changes with `npm run verify:accounting` (A1-A6) and `npm run verify:je` against live Supabase before declaring done.

### Security and multi-tenant isolation
Files: `modules/auth*.js`, `permission_matrix.js`, `functions/_middleware.js`, `functions/api/*`, `supabase-*.sql`.
- Supabase RLS is the real security boundary. Client-side checks (`permission_matrix.js`) are UX only — never rely on them for security.
- `anonKey` in `supabase-config.js` is a publishable key and may be exposed. The `service_role` key must NEVER appear in the client bundle — only in Cloudflare Function env. Flag any service/secret key found client-side immediately.
- New RLS policies (`supabase-*.sql`) must be scoped by tenant/shop id and must not leak across shops.
- RLS `WITH CHECK` is row-level, not column-level. To lock privileged columns (reviewer/approver/audit fields) against non-admins, use a BEFORE INSERT/UPDATE trigger, not just a policy.
- OTP/auth (`auth_otp.js`, `send-otp`, `verify-otp`, `otp_cooldown.js`): keep rate-limit/cooldown, never log OTP, don't leak enumeration via differing responses. (Note: customer OTP intentionally uses an on-screen web fallback, not SMS — do not flag this as a bug.)
- Cross-check SQL <-> JS column names before pushing (avoid PGRST204), and run `NOTIFY pgrst, 'reload schema';` after any `ALTER TABLE`. Verify FK target column types before adding a FK (e.g. `staff.id` is uuid, `customers.id` is bigint).

### XSS / DOM injection
- HTML is built by hand in vanilla JS, so `innerHTML` + user/DB data is the top risk. Escape, or use `textContent` / DOM API.
- `tests/xss_regression.test.js` exists; add a regression test for any new render point that interpolates user/DB data.
- ESLint blocks `eval` / `new Function`; don't reintroduce string-eval paths.

## Search Targets

- UI behavior: search visible Thai/English text, button IDs/classes, event handler names, and module imports.
- State bugs: search localStorage keys, IndexedDB/table names, object property names, and save/load functions.
- Settings/users: search both the settings modules and the call sites that consume the settings at runtime.
- Deployment/cache: inspect `sw.js`, cache/version constants, app-shell files, and registration/update logic before editing.

## POS UI Changes

- Keep POS screens dense, practical, and stable for repeated cashier use.
- Prefer small layout fixes over visual redesigns; reuse existing component and CSS naming.
- Check desktop and mobile widths. When text breaks vertically, fix the flex parent (column stack) rather than squeezing the child with CSS.
- Never use `alert()` / `confirm()` for user feedback; use the project's `showToast` helper.
- A `<style>` block inside a template literal only applies when that template renders — shared classes need a shared scope or duplication.
- When changing CSS that affects render, bump `style.css?v=` in `index.html` to avoid stale cache.

## Data and Flow Changes

- Trace both write path and read path; many bugs come from saving one shape and rendering another.
- Check default values, migration/backfill behavior, and empty-state behavior.
- Preserve existing persisted data when changing schemas or object shapes.
- Treat totals, payment, discount, tax, and inventory as high-risk; verify with concrete examples.
- Date/"today" filtering uses Asia/Bangkok, not UTC (`tests/tz_today_filter.test.js`). Money/number/date formatting goes through the shared formatters util (`tests/utils_formatters.test.js`) — don't hardcode formats.
- Never fall back to master data (e.g. `emp.daily_rate`, profile defaults) inside a financial calculation; use the actual transaction value.
- When a sync function becomes async, revisit its callers — if a caller makes a UX decision from the result, return `{ ok, error }`, not void.
- IDs from `select.value` are always strings; DB bigint IDs are numbers — `String(...)` both sides at the compare point.

## Service Worker, Cache, and Versioning
Files: `sw.js`, `boot.js`, `lazy_libs.js`, `manifest.json`, `index.html`, `selfheal.js`.
- SW edits can make old bugs look fixed locally while users stay on stale assets. Change cache strategy only when the task requires it, and explain the cache risk.
- A build/cache bump means updating all of these together, or the in-app update check is misleading:
  - `data-app-build` and `selfheal.js?v=` in `index.html`
  - `main.js?v=` in `index.html`
  - `CACHE_NAME` in `sw.js`
  - (`pages.js` reads the build number from `window.APP_BUILD`, which `selfheal.js` sets from `data-app-build` — no hardcoded number there.)
- After touching cache behavior, verify first load, reload, and updated-asset behavior (`tests/lazy_import_cache_bust.test.js`, `tests/boot_periodic_sw_update.test.js`).
- The in-app "ตรวจหาอัปเดต / force update" button does not reliably work; tell users to `Ctrl+Shift+R` instead.
- Do not cache sensitive data (receipts, customer info) where it isn't intended.

## Git and Deploy Workflow

- `git fetch` + read `SESSION_START_SHARED.md` / `HANDOFF.md` before editing — the user runs parallel sessions; check for collisions both before starting and right before pushing.
- Run `git status --short` before staging. Stage only files relevant to the request; don't revert unrelated dirty files. Use non-interactive git.
- Push to `main` (or `claude/**`) triggers GitHub Actions -> Cloudflare Pages deploy. After a push, verify BOTH the Actions conclusion AND the live build markers on the canonical URL `boonsook-pos-v5.pages.dev`.
- Keep commit messages under ~500 chars (the Cloudflare API rejects very long messages, error 8000111); put depth in `HANDOFF.md`.
- User-facing changes: update `CHANGELOG.md` (short) and `HANDOFF.md` (deep).
- Files are LF; do not force a CRLF/LF change. Thai/emoji characters can make some editors truncate at EOF — edit carefully near non-ASCII content.

## Verification Gate

- Merge gate: `npm run verify` (= lint + unit + e2e). On Windows PowerShell use `npm.cmd` (plain `npm` may be blocked by execution policy).
- `npm run lint:errors` is the CI-blocking subset; 0 errors required, style warnings are tolerated and fixed gradually.
- Bug fix = add a regression test that fails before and passes after. Don't disable tests to make CI green.
- Accounting/RLS: also run `npm run verify:accounting` (A1-A6) and `npm run verify:je` against live Supabase.
- This project has zero runtime dependencies (only devDeps). Don't add an npm dependency without flagging it and asking why. ES modules only — no `require()`.
