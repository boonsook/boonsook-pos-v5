# Phase 639 — local review handoff

Owner scope: prepare SQL, code and tests locally, preserving existing documents' chosen text. **No authorization to apply on staging/production, push, open PR, merge or deploy.**

Baseline: `ee173922fdd00bd3753be36c5294ea0114d1d0b3` (PR #235, API Phase 638).
Branch: `codex/phase-639-document-templates`.
Candidate build: **635 / v5.69.102 / cache-v635** (local markers only).
Independent reviewer should inspect the committed blobs, not infer approval from this author report.

The previous document candidate `6fc21ddefa70bab4d9d25db0cb13155252264c2d` remains on its original local branch for audit. Owner approved moving this work to the new baseline/Phase 639 and correcting review findings, locally only. Fresh fetch succeeded at start; Phase 639 had no local/remote branch collision. Shared-doc conflicts retained the API team's entries byte-for-byte below the new document entry. No API file or API test is changed relative to this baseline. Re-fetch before any future push/PR decision.

## Review corrections

- B1: all SQL mutations plus schema notification are inside one atomic DO. No reliance on BEGIN/COMMIT spanning client submissions. A preconfigured nonzero <=30s statement timeout is mandatory before entry; set_config inside DO is used only for lock_timeout. Native counterexample proves that setting statement_timeout inside the running DO is insufficient.
- S1: enforce UTF8 client/server and ASCII hex pins for all six Thai title literals; add raw POST-CHECK C with exact per-type UTF8 equality. Fixed length=11 was rejected: actual defaults have 10/22/14 code points. psql startup encoding/timeout and file transport are explicit in the runbook.
- S2: old DI fixture uses ใบแจ้งหนี้, distinct from the default. Assertions use exact title equality in Preview/print/PDF, not substring matching (the alternate title is a substring of the default). Explicit mutation mode serves a hardcoded DI renderer response locally; test fails at the title assertion. No runtime file is changed by mutation mode.
- S3: historical snapshot titles are nonblank strings <=200, independent of current title choices, with type/version/other-field validation preserved. New writer and DB CHECK keep their allowlists. The new historical-title unit failed before the reader correction. All three renderer types have malicious historical-title Preview/print/PDF escaping tests.
- Renumbered only the previous document candidate's symbols/files/references to 639; existing API Phase 638 remains intact. Build remains 635 because neither document candidate has shipped. Financial pins are not recalculated.

## What changed

1. `modules/document_presentation.js`: detached per-type JSON snapshots, validation, presentation resolver, GET-only schema readiness gate.
2. `modules/settings/document.js` and the existing settings-page entry: allowed title choices, per-type terms/visibility, shared header/footer, synthetic preview. Draft/back writes nothing. Save locks duplicate clicks; schema failure/rejected save/quota and local-only/cloud outcomes are explicit.
3. QT/DI/RC renderers resolve saved snapshots; new writers append one presentation field at the header INSERT. Existing edit PATCH does not include it. Invalid saved snapshots do not silently adopt current settings; invalid unsaved QT snapshots preserve the draft form.
4. SQL candidate adds a JSONB column/default/CHECK and an immutable UPDATE trigger to each document table. Existing rows read a constant cloud-template snapshot without UPDATE/backfill. Function EXECUTE is owner-only, SECURITY INVOKER with empty search_path.
5. Build/cache markers advance together; no cache-strategy change, no npm dependency.

## Financial and historical boundaries

- Money formulas, numbering helpers, receipt collection, stock, journal posting, existing RLS/policies and table grants are untouched. Only snapshot metadata is added to the three existing header writers.
- Existing exact-body hash guards still compare the complete historical save/conversion code after removing **one exact, count-checked metadata insertion**. No arbitrary hunk stripping or recalculated money pins.
- VM fixtures use the real new helper and explicitly expect the added field; original fail-closed, duplicate, partial-failure and mutation expectations remain active.
- Old document text is frozen from cloud defaults **at migration cutover**, not reconstructed from issuance time. Unsynced device defaults need reconciliation before approval. Company/logo/customer/date/manual note/CSS are not archived by this snapshot.
- QT→DI and DI→RC are new documents: their own current defaults are used. Default changes never rewrite source snapshots.
- Existing public-share links and Bluetooth slips are outside this proof. Print/PDF browser tests validate the actual popup route and content, not physical paper or a real mobile print dialog.

## Verification

- Unit **3,790/3,790**, lint **0 errors**, full e2e **392/392** (11.8 minutes), all exit 0. The full run includes all **21** Phase 639 cases with mutation mode off. Old Phase 638 document counts are not reused for this candidate.
- Focused Phase 639 browser: old text/title in all three Preview/print/PDF routes, new QT snapshot, edit preservation, new DI/RC own defaults, invalid snapshot rejection, draft preservation, XSS, settings save outcomes and inflight lock. 390px and 1280px are emulated browser viewports, not physical-phone tests.
- Full e2e uses the unchanged one-worker project configuration, CI=1, port 4173 verified free on IPv4/IPv6, reuseExistingServer=false. Focused/mutation runs use a local-only 4183 override. No process from another session was stopped or reused.
- Author inspected current 390px/1280px settings screenshots: no text overlap or horizontal overflow; mobile stacks settings and preview, desktop uses two columns. These are emulated local UI, not physical mobile evidence.
- Native PostgreSQL 17.6: **54/54**, direct login `phase639_owner`, NOSUPERUSER/NOBYPASSRLS; all writes confined to new synthetic fixture databases in a fresh `phase639-pg176/data` loopback cluster on port 56339. Exact candidate migration file is executed with `psql -f`, SHA logged. No shared staging/production connections.
- Native results cover existing money/note/count footprint, zero UPDATE audit events at apply, constant legacy defaults, authenticated INSERT/edit, snapshot immutability, bad JSON rejection, old snapshots after settings changes, rerun STOP, preflight drift and rollback after a deliberate mid-apply constraint collision.
- Added native cases cover missing/excessive timeout, wrong client encoding, damaged Thai text, exact post-C UTF8 defaults, mid-failure rollback in the same still-usable autocommit connection, statement timeout after function creation and two-connection DDL lock timeout. This is not business concurrency/load proof.
- Initial new post-C parser failed on Windows CRLF output; corrected the harness split, then reran all 54 cases. Initial mutation with substring assertion incorrectly passed; exact title assertion now kills it. Lint identified missing timer imports in the harness; fixed explicitly. Only final completed gates are counted.
- CI/deploy/live checks, Supabase RLS/PostgREST/concurrency, physical mobile/printer: **NOT RUN**.
- Exact 26-file staged scope, strict UTF8/LF/no BOM, build 635 markers, and all 10 API code/test files introduced by PR #235 were checked. QT/DI/RC runtime files, the settings entry and index.html are byte-identical to the previous reviewed document candidate. The service-worker delta versus that candidate is only its phase-number comment.

Evidence is retained outside the repo in the task's visualization workspace:
`phase639-local-review-20260928/` (raw logs, current UI screenshots, mutation trace, committed-blob hashes and verification script).
The separate `phase639-pg176/data` cluster is stopped; its synthetic data is retained, not deleted.

## Release gate

See `PHASE-639-OWNER-SQL-RUNBOOK.md` for the exact migration pin, read-only preflight, post-check expectations, failure handling and ordered approvals. **Do not deploy build 635 before approved SQL apply and schema readiness.** Pause document/settings edits at cutover; refresh all clients before changing defaults. No automatic retries or destructive rollback.

Settings persistence intentionally retains the existing local-first behavior. A cloud timeout may complete later and is not a server rollback; no multi-editor CAS is introduced. Existing documents remain protected by their saved snapshots.

No production test documents were created, edited or removed. **RC20260927001 must not be collected.**

Deferred nonblocking nits: the settings component's scoped inline style and footer placeholder are unchanged. This correction does not redesign CSS or add settings options. Public-share/physical-device proof and the production execution route remain separate review/owner decisions.

STOP: `READY-FOR-INDEPENDENT-PHASE-639-REVIEW`.
