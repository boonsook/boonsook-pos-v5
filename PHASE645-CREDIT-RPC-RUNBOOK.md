# Phase 645 — B1 RPC-only local review candidate

**HISTORICAL RUNBOOK STATUS (2026-10-05), superseded by the Phase 645 closeout in `DB_MIGRATIONS_APPLIED.md`.** The following `LOCAL ONLY`/not-approved instructions describe the draft at that date and are not current release status. Do not execute or rerun B1 from this runbook. Baseline: `bb9f66cd4f62645819400e2b087a446a92078269`; branch `codex/phase-645-credit-rpc-authz`. Build remains 641 / v5.69.108 because this draft changes no browser assets. Final source commit, migration SHA-256 and actual test results are recorded in the separate evidence report after validation.

## Scope and behavior

This revision reuses the original B1 design/test cases at `7cb897b` but only changes the two credit RPC definitions and their EXECUTE ACLs. It does not include the old candidate's three direct-ledger RLS policies. No table, ledger row, trigger, UI, API or sale-lifecycle change is included.

Both functions require the effective database impersonation setting `role=authenticated`, plus an `auth.uid()` whose trusted `public.profiles.role` is admin, sales or technician. This check is the first executable statement, before input validation, lock, lookup, idempotent return, balance read or insert. Missing/unknown/null profiles fail closed. JWT business-role/user_metadata/app_metadata claims do not authorize staff. `current_user` is not used to identify the caller inside SECURITY DEFINER.

`PUBLIC`, `anon` and `service_role` EXECUTE are explicitly revoked from both RPCs; only postgres owner and authenticated EXECUTE remain. The guard still rejects other database roles if privilege is subsequently inherited/granted. SECURITY DEFINER owner stays postgres. Search path becomes `pg_catalog, pg_temp`; public relations/types and auth.uid are qualified, as are the lock/hash builtins. Existing amount checks, 0.01 tolerance, return types/default argument, locking and idempotency/compensation statements are preserved. The 0.01 behavior is existing money logic, not endorsed or changed by this phase.

## Evidence / initial pins

Coordinator's catalog measurement was 2026-10-05 06:36:26 UTC on project `rwmmjljelpcpwohwiplu`, PostgreSQL 17.6. Report SHA-256 `3d920221e6e8bbd85b2812ab256b4c963e1c1e4fac41d03bd5ea1778067cd8d2` contains display-copy bodies and raw production MD5s:

- redeem(bigint,text,numeric,text): `8ba3d01fe1a13ffbd2f9edb6d9e8c577`
- release(text): `cc859ecb943a4df8c0f0a65171ff1f62`
- Owner postgres, SECURITY DEFINER, exact initial config `search_path=public`.
- Initial ACL exactly `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, no grant options.

Display bodies matched source statement tokens and the old candidate without its guard; they are not byte-identical production exports. The preflight checks **raw** md5(prosrc), never normalized text. It also checks signatures, argument names/default, return type, language and execution attributes. Some header prerequisites are source-derived conservative expectations, not separately measured live; any difference fails closed and requires review, never an automatic re-pin. The full preflight must pass in the separately authorized read-only step before considering execution.

Auth v4/profile self-elevation prevention is a dependency and is not reapplied here. The profiles table must be owned by postgres without FORCE RLS so the function owner can read the trusted role; production profile write protection must remain independently verified.

## Caller impact

- POS redeem and failure compensation: `modules/pos.js:1272-1320,1482,1509,1602`; preserve admin/sales/technician use.
- Admin sale void: `modules/sales.js:70,196,348`; release helper contract preserved.
- Accountant has no POS route and no admin void button. No supported accountant or service_role RPC caller was found in repository modules/functions/scripts. Their existing database capability is intentionally removed. External automation/manual callers are not discoverable from repo; disclose any such legitimate dependency before approval.
- Anon token fallback now receives denial. A staff member demoted between redeem and compensation also receives denial; resulting manual recovery remains an operational risk, not silently bypassed by this change.
- Refunds write directly to ledger (`modules/refunds.js:575-600`), not via these RPCs. Their grants/policies and data are untouched.

## Open gates — do not claim full credit containment

1. `phase645-ledger-footprint-readonly.sql` is a proposed narrow catalog query, **not run**. Direct-ledger grants/RLS/helper state remains unreviewed for this revision. If it denies outsiders already, leave the three old policies out. If a direct outsider path remains, STOP and obtain an explicit scope decision; do not claim RPC-only closes it.
2. B2 is separate: authorized staff can still release credit associated with an active sale. Local checks must demonstrate this residual, not fix it. B1 does not prove credit integrity or refund provenance.
3. No live REST/JWT behavior, concurrency/lock contention, refund end-to-end flow or production rollback is proved by the synthetic fixture. The local fixture substitutes source-derived original-body pins only in a copy and records that mapping; it must never be used for production.

## Local rehearsal

Run `node scripts/phase645-credit-rpc-local.mjs --bin-dir <absolute-PG17.6-bin> --cluster-root <NEW-short-absolute-directory> --port <unused-loopback-high-port>`.

The runner creates a new owned loopback-only cluster, clears inherited PG connection settings, pins server version/data-directory/port, and keeps original logs. It refuses existing directories/occupied ports, stops only its owned cluster, and retains files after confirmed shutdown. Do not delete an unknown cluster or reuse another team's server. No external credentials/DSN are accepted.

Run focused source tests with `node --test tests/phase645_credit_rpc_authz.test.js`, lint and the full unit suite. Browser E2E is not a database-auth proof; no browser runtime change is in this SQL-only diff. Any skipped broader gate must be recorded in final evidence.

## Future owner execution procedure — not authorized now

1. Independently review exact commit, SQL SHA-256, test evidence, caller impact and open gates. Confirm the project via the trusted connection/client; `current_database()=postgres` is not project identity. Do not use the LOCAL-migration copy from fixture evidence.
2. Separately authorize/run `phase645-credit-rpc-preflight-readonly.sql` on that target and retain the full result. Review direct-ledger findings and Auth v4 dependency separately. STOP on any missing object, differing pin/owner/config/ACL, unsupported header or role/profile-read prerequisite. Do not weaken checks to force a pass.
3. Obtain explicit apply approval for the final exact artifact. Schedule without concurrent RPC/schema administration; the migration uses REPEATABLE READ and contains its own preflight so a stale standalone check is insufficient. One operator/session submits the **whole** migration with `psql -X -v ON_ERROR_STOP=1 -f <approved-file>` using approved session transport. Do not split it into editor selections. It sets statement timeout 30s and lock timeout 5s.
4. Every error aborts the transaction. Stop; issue ROLLBACK if the session remains open, retain errors and reread catalog before a reviewed retry. Lost connection/unknown commit outcome means inspect first, never rerun blindly. Post-commit recovery is a separately reviewed forward migration; do not restore the vulnerability as rollback.
5. Run `phase645-credit-rpc-postcheck-readonly.sql` under separately authorized read-only scope. It validates the new bodies, ownership/metadata, search_path and exact/effective ACLs. It does not invoke RPCs or touch business rows. Authorized/denied behavior is established locally; do not substitute production data-changing probes.
6. Stop for independent post-apply review. No deployment/build bump is implied by this local package.

STOP — READY-FOR-INDEPENDENT-B1-REVIEW only after actual local gates and final evidence are complete; not approval to apply.
