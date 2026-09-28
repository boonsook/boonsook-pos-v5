# Phase 639 — document presentation snapshot (review candidate)

**Status: LOCAL ONLY · staging NOT RUN · production NOT RUN.** Owner authorized preparing SQL/code/tests locally, not applying this migration, pushing, merging or deploying.

Baseline: `ee173922fdd00bd3753be36c5294ea0114d1d0b3` (PR #235 / Phase 638 API merged). This is the renamed/corrected document candidate formerly reviewed as `6fc21dd`; that old SQL must not be used. Runtime candidate: build **635 / v5.69.102**.
Migration: `supabase-phase639-document-template-snapshot.sql`.
SHA-256: `e7d921bb635126f5a48bad1f7aeee48668784094546d7e023519cf4cdafad4b4`.

## Contract and limits

- Add `document_template_snapshot` JSONB NOT NULL to quotations, delivery_invoices and receipts. Fields: version=1, document_type, title, header, footer, note, show_note.
- Existing rows receive a constant legacy snapshot using the **cloud store_info at cutover**, not an UPDATE/backfill. This freezes the previously displayed cloud defaults from that point onward; it cannot recover unknown text from each historical issuance date. If a device has unsynced local defaults, they may differ: reconcile/read them before approval, never guess.
- New QT/DI/RC INSERT includes an explicit snapshot from current device settings. New DI uses DI defaults, new RC uses RC defaults; neither inherits the source document's title/terms. This is presentation metadata only.
- Editing an existing document never replaces its snapshot. A BEFORE UPDATE trigger rejects a changed snapshot (23514); identical values remain allowed. No change to numbering helpers, money, tax, payment, stock, journal entries, existing RLS/policies/table grants.
- Snapshot covers only selected title/header/footer/default terms/visibility. Company identity/logo/address, customer data, dates, per-document note and layout CSS are **not** archived by this feature. This is not an immutable PDF archive.
- Allowed titles: QT ใบเสนอราคา/ใบประเมินราคา; DI ใบส่งสินค้า/ใบแจ้งหนี้, ใบส่งสินค้า, ใบแจ้งหนี้; RC ใบเสร็จรับเงิน. No free HTML or tax-invoice title. Text limits 4,000 per field. No new tax/legal meaning.
- Current choices and DB CHECK restrict new snapshots. The reader accepts historical title strings (nonblank, <=200 characters) independently of today's choices, with escaping in all renderers. Retiring an option must not break old documents. Other snapshot fields/version/type remain validated.
- Settings preview uses synthetic content and shared text renderers, not a real document or number. Production Preview/print/PDF use the saved snapshot. Bluetooth slips are out of scope; existing public-share links are not claimed tested here.

## Release order — separate approvals required

1. Independent code + SQL review of the exact local commit and pins; no production approval implied.
2. With separate owner authorization: collect fresh read-only preflight below on the intended database. Record project/ref, tool, DB timestamp, operator, source SHA. Compare cloud legacy text/visibility with owner-approved old display. STOP on unknown/unsynced settings.
3. Pause document creation/editing and document-settings changes on **all** clients during cutover. The schema requires ACCESS EXCLUSIVE locks, and CHECK validation scans existing rows. The DO sets lock_timeout=5s; a nonzero statement_timeout <=30s must already be effective BEFORE submission. Timeout means STOP, not permission to bypass checks.
4. Apply only after explicit owner approval of the exact SQL SHA and execution route. Submit the **entire file once** with autocommit, not inside an external BEGIN. Every mutation (preflight lock, function, ACL, columns, constraints, triggers and schema notification) is inside one DO; failure rolls back that statement, even if the client splits top-level statements. Do not split the DO body itself. The locally tested route is psql with UTF8 and startup timeout (below). Web SQL Editor is **NOT VERIFIED/NOT APPROVED by this rehearsal**: it must prove UTF8, a pre-existing <=30s timeout, whole-DO submission and raw result capture separately; a previous SET on another pooled submission is not proof.
5. Collect raw execution/error output and POST-CHECK A/B/C from the file; all three tables must pass. C checks exact per-type Thai UTF8 bytes of the initial fast defaults, not a shared character count. Missing C/fast-default metadata is not evidenced, not PASS. Schema reload must be visible before runtime rollout. The UI's GET limit=0 gate checks column readability only, **not** full constraints/trigger correctness.
6. Only after catalog review + separate push/merge/deploy authorization may build 635 be released. Never deploy this runtime first: its new INSERT payload needs the column.
7. Refresh **every** device to build 635 before changing template defaults or resuming new document work. Old clients omit the field and receive the frozen legacy DEFAULT (safe compatibility, not new settings); old clients can overwrite shared settings with stale copies. Do not allow mixed clients for template changes.
8. Read-only smoke with existing documents first. Creating real test documents, collecting money or cleanup needs separate approval. **Never collect RC20260927001.**

## Fresh preflight read-only

Run and export both result sets separately. No helper/RPC is invoked.

```sql
SELECT now() AS measured_at, version(), current_setting('server_version_num') AS server_version_num,
       current_user, session_user, current_database(),
       current_setting('client_encoding') AS client_encoding,
       current_setting('server_encoding') AS server_encoding,
       current_setting('statement_timeout') AS statement_timeout;
```

```sql
SELECT jsonb_build_object(
  'store_info_rows',(SELECT count(*) FROM public.app_settings WHERE key='store_info'),
  'legacy_template',(SELECT jsonb_build_object(
     'docHeader',value->'docHeader','docFooter',value->'docFooter','docNote',value->'docNote',
     'docShowNoteQuotation',value->'docShowNoteQuotation',
     'docShowNoteDelivery',value->'docShowNoteDelivery','docShowNoteReceipt',value->'docShowNoteReceipt',
     'has_new_defaults',value ? 'docTemplatesV1')
     FROM public.app_settings WHERE key='store_info'),
  'tables',(SELECT jsonb_agg(jsonb_build_object(
     'table',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
     'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
     'has_snapshot',EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='document_template_snapshot' AND NOT a.attisdropped),
     'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))
     ORDER BY c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('quotations','delivery_invoices','receipts')),
  'existing_function',to_regprocedure('public.phase639_preserve_document_template()')::text,
  'roles',(SELECT jsonb_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))
) AS phase639_preflight;
```

Expected BEFORE: PG 17+, exact environment authorized; UTF8 client/server, preconfigured statement_timeout >0 and <=30s; one store_info object with legacy text/null and boolean/null fields; has_new_defaults=false; 3 ordinary tables owned/alterable by the operator; has_snapshot=false all three; existing_function=null; all three roles present. Assess other triggers for interactions. Missing row/unknown shape/long legacy text/name collision → STOP. The DO repeats these checks and holds the store_info lock until its atomic completion.

Expected AFTER (raw A/B/C from migration): 3 JSONB columns, not_null=true, validated CHECKs, constant per-type legacy defaults matching approved cloud text; three enabled BEFORE UPDATE row triggers (tgtype=19), SECURITY INVOKER, search_path="", owner-only EXECUTE ACL. C must return three title_utf8_ok=true rows: QT ใบเสนอราคา (10 code points), DI ใบส่งสินค้า/ใบแจ้งหนี้ (22), RC ใบเสร็จรับเงิน (14); exact hex equality is authoritative, length only diagnostic. Capture immediately: later table rewrites may clear atthasmissing without losing values; absent metadata must not be reported as a successful C.

## Encoding and timeout transport

- For psql on Windows, set `PGCLIENTENCODING=UTF8` and `PGOPTIONS=-c statement_timeout=30000` in the **process environment before opening the connection**; use `psql -X -v ON_ERROR_STOP=1 -f <reviewed-file.sql>`. The database target/credentials are separately owner-approved, never copied into logs. Keep the original UTF8/LF file and verify its SHA; do not pipe it through a lossy console encoding.
- Record SHOW client_encoding/server_encoding/statement_timeout from that configured connection before apply. The migration checks effective settings again before DDL and checks all six Thai title literals against ASCII UTF8 hex pins, so a UTF8 connection alone cannot hide already-damaged text.
- Do NOT substitute `set_config('statement_timeout',...,true)` inside DO: the local counterexample completes a 400ms sleep despite setting 100ms inside that running statement. A startup timeout interrupts a deliberately delayed DO and rolls back its prior DDL. lock_timeout inside DO was separately tested using a competing connection.
- This is a tested preparation method, **not a decision that production will use psql**. Owner still approves the target, route, fresh preflight and exact SHA independently.

## Failure / recovery

- No automatic retry. In the prescribed autocommit route, a server-reported DO failure rolls back all its mutations. The same-connection fixture verifies subsequent SELECTs succeed and no added objects remain. Do not turn a transport timeout/disconnect into a claim that the server has stopped.
- An external transaction is not the prescribed route. If one was opened accidentally, only its actual connection can ROLLBACK it. If disconnected, remeasure catalog/activity with the operator; a ROLLBACK on a different pooled connection cannot close the original.
- Do not rerun after ambiguous completion. This migration intentionally STOPs if any column/function already exists. Collect preflight + A/B/C and have the reviewer determine whether fully applied, absent, or inconsistent.
- Post-check SELECTs run AFTER the atomic DO has completed. A post-check error, missing output or lost response does not undo an already committed DO. Do not infer rollback from a nonzero client exit alone; identify whether the error came from DO or later evidence collection.
- Native tests cover mid-apply constraint collision, a preconfigured statement timeout after function creation, and a conflicting table lock: no orphan function/columns remain. This proves the tested local psql route, not Web SQL Editor or network-interruption recovery on Supabase.
- If only some objects exist, STOP and investigate provenance/version; that is not an expected result of this atomic DO. There is **no automatic DROP function/cleanup** procedure. Any recovery SQL requires fresh evidence, review and separate owner authorization.
- Once committed, do not drop columns/constraints/triggers or overwrite frozen defaults as “rollback.” Data-bearing snapshots are historical records. Any corrective SQL needs a new review and owner approval.
- Runtime rollback to build 634 leaves columns/defaults intact and old inserts compatible, but old renderers ignore snapshots. Stop customization and review display impact before choosing it; do not claim historical-format preservation on old runtime.

## Local evidence and residuals

- Native PostgreSQL 17.6: `scripts/phase639_pg176_verify.mjs`, fresh loopback-only cluster, direct login `phase639_owner` with rolsuper=false / rolbypassrls=false, synthetic rows only. Function ACL owner is phase639_owner in fixture; production owner must match the approved operator.
- 54 checks: previous 45 cases plus exact post-C UTF8, missing/excessive timeout, wrong client encoding, corrupted Thai literals, same-connection rollback, actual statement/lock timeouts and the inside-DO timeout counterexample.
- The fixture is not Supabase RLS/auth/PostgREST or business concurrency/load testing. The two-connection test covers only DDL lock contention. Session names and schema are synthetic. Native test output is not production evidence.
- Browser: actual renderers with synthetic fetch/writer adapters; settings success, local-only warning, reject/quota/schema errors, duplicate-click lock, old snapshots, new QT INSERT/edit PATCH, DI/RC conversion, XSS, draft preservation, 390/1280px, print/PDF popup DOM.
- Settings saving retains the existing local-first writer. A cloud timeout may later complete; “local only / not synced” is not proof of server rollback. No cross-device CAS/version conflict resolution added. Operationally use one editor and refresh other clients.
- CI/deploy/live/mobile hardware/printer/actual Supabase apply: **NOT RUN**. This runbook is not an execution approval.

STOP: `READY-FOR-INDEPENDENT-PHASE-639-REVIEW`.
