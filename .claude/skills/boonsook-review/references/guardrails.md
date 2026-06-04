# Boonsook POS V5 — Project guardrails (with reasoning)

Paste the relevant items into a prompt's **ห้ามแตะ** / **Tests** / **Verification** sections.
Each rule has a *why* — keep the why in prompts so the implement team understands intent
rather than following blind MUSTs. This system handles real money, real stock, real customers.

## EOL / formatting

- **EOL = LF for all text files** (`.gitattributes` = `* text=auto eol=lf`). Only `*.bat/*.cmd/*.ps1` = CRLF. *Why:* flipping EOL makes the whole diff noise + merge conflicts. Verify with `git ls-files --eol <file>`. Do NOT claim modules/*.js is CRLF (a stale memory once said so — it's wrong).
- **CSS lives in the shared inject block** (e.g. `injectTeamCenterStyles`), not in a per-template `<style>`. *Why:* a `<style>` inside a template literal only applies when that template renders; shared classes need shared scope.
- **No `alert()` — use `ctx.showToast`.** *Why:* owner preference; alert blocks the PWA UX.
- Don't reformat/reindent code outside the diff. No vw units / no 4-digit px in new CSS; controls must wrap (no horizontal overflow).

## Versioning / deploy

- **Bump every marker together:** `data-app-build` + `?v=` on selfheal/main/boot/style.css + sw `CACHE_NAME` (+ version comment). `grep '\?v=[0-9]+'` to catch all — the build-sync e2e smoke enforces this. package.json version only changes on a real semver bump. *Why:* lazy modules have no own `?v=`; if sw cache isn't bumped, PWA users never get the new code.
- **Commit message:** subject <72 chars, subject+body <500 chars, avoid emoji (multi-byte). *Why:* the Cloudflare deploy API rejects long commit messages (error 8000111). Put detail in HANDOFF.
- After push: confirm GitHub Actions Tests **and** Deploy conclusion, **and** live `data-app-build` — not just one.

## Testing gates

- `npm run verify` = `lint:errors && test && test:e2e`. **`npm run test:e2e` is a required gate**, not optional. *Why:* it was silently skipped once; CI runs it but the prompt must require + report it.
- The e2e suite is a single `tests/e2e/smoke.spec.js` that does NOT log in → it does NOT exercise authenticated pages (team_center, POS, etc.). So **a manual smoke is still required** for those; say so in the prompt.
- Guard tests are **source-regex** (read file as text). When asserting "uses X not Y", **extract the specific function body first**, don't grep the whole file (false positives from the same call elsewhere). Bug fix ⇒ add a regression test that fails before / passes after. Don't weaken or delete existing guards.
- New code on money/accounting/permission paths must ship with tests.

## Money / stock / accounting (highest risk — CLAUDE.md §4)

- **Stock decrement uses CAS + a zero floor.** `atomicDecrementStock` refetches then PATCHes `?id=eq.X&field=eq.{before}` (atomic vs races) — and must refuse if `before < qty` (no negative writes). *Why:* CAS alone stops concurrent double-decrement but not selling more than available; a real `-1` row resulted from the missing floor (fixed build 367 + DB CHECK constraint optional).
- **Warehouse transfer** = source `atomicDecrementStock` (floored) + target `atomicAddToField`; if target fails after source succeeded, **roll back the source**; if only the movement-log insert fails, **do NOT roll back** (the stock already moved correctly — return ok + warn). Normalize `qty` to `Number()` once. *Why:* transfer crosses two rows; partial application or a log-driven rollback causes divergence.
- **Dual stock model:** `warehouse_stock` (per location) is the source of truth; `products.stock` (legacy) should equal the sum (derived). Any write path that touches one must keep them consistent. Find drift with: `select p.id, p.stock, coalesce(sum(w.stock),0) from products p left join warehouse_stock w on w.product_id=p.id group by p.id, p.stock having p.stock <> coalesce(sum(w.stock),0)`.
- **loadAllData contract:** products/customers/warehouse_stock load **all rows via `.range()` pagination** (`fetchAllPaginated`) — PostgREST caps `select(*)` at 1000 silently. sales/quotations/serviceJobs/receipts/deliveryInvoices intentionally `.limit(50)` (latest only) — **do not** switch these to fetch-all (team_center depends on "latest 50").
- VAT 7% inclusive/exclusive split must round so Dr = Cr. Refund cannot exceed (original − already-refunded). Period-close locks posting (DB trigger). Don't swallow errors on money paths — log via `error_reporter` + audit_log.
- **Aggregates over loaded data must be labelled** "จากที่โหลด ล่าสุด ≤50 · ไม่ใช่ยอดทั้งระบบ", and never sum across incompatible types (a quote offer ≠ a receipt's realized revenue). *Why:* an unlabelled total reads as a real system figure and misleads the owner.

## Security / data

- **Supabase RLS is the real security boundary** — client-side permission checks are UX only. Every table must have a tenant/shop-scoped RLS policy. `service_role` key must never reach the client (anon/publishable key is fine to expose). New `supabase-*.sql` RLS must scope by shop and not leak cross-shop.
- **RLS WITH CHECK is row-level, not column-level** — to lock privileged columns for non-admins, use a BEFORE INSERT/UPDATE trigger.
- **XSS:** vanilla JS builds HTML by hand → escape every user/DB value with `escHtml`/`textContent` before `innerHTML`. Clipboard `writeText` is plain text (safe).
- **Timezone:** filter "today/date-range" on **Asia/Bangkok**, not UTC. Format money/date through the central util.
- **Never enter passwords/credentials yourself** to authenticate (browser login, auth API). Hand that to the owner. Don't put personal data in URLs.
- **No new npm runtime dependency** without flagging + a reason (current `dependencies` is empty).

## read-only surfaces (e.g. team_center "ศูนย์ทีม AI")

- No `fetch`/POST/PATCH/PUT/DELETE/XMLHttpRequest/supabase insert·update·delete·upsert.
- No `ctx.state` mutation — clone (`[...arr]`) before sort/filter; don't write properties onto objects inside state. (Array-method guards won't catch object-property mutation — assert both.)
- Routes stay admin-only; don't open to sales/customer. Fields that don't exist → show "—"/"ยังไม่มีข้อมูล", never hardcode `0`.
- Integrations that aren't wired = honest placeholder "ยังไม่เชื่อมต่อ"; don't fake "Connected/Owner verified/Production".

## Domain facts that surprise people

- **AC catalog ≠ real stock:** "จัดการแคตตาล็อกแอร์" is pricing/quotation data in `localStorage bsk_ac_catalog`; `stock` there = "offer status", not inventory. Never link it to `products`/POS/stock value.
- **Warehouses are already configured** (Phase 43 mobile model): `warehouses.is_mobile` flag; HOME (บ้าน, is_mobile=false) = main; TRUCK_WHITE/RED (is_mobile=true) = trucks; SIKHORN = unused branch. `_transferWarehouseStock` + `_getHomeWarehouse`/`_getMobileWarehouses` exist. Code does NOT filter `is_active` for warehouses (setting it false won't hide one without a code change).
- **Effective date:** data before 2026-05-01 is test data; orphan JE counts (~85) are benign/non-actionable — don't propose deleting.
- **OTP web-fallback is intentional** — don't recommend disabling it in audits.
