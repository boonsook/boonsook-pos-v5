// tests/rls_periods_anon_guard.test.js
// Phase 532 (BUG_AUDIT 2026-06-25 · B2) — accounting_periods anon write-hole guard
// Run: node --test tests/rls_periods_anon_guard.test.js
//
// Bug: supabase-phase88-19-period-close.sql granted accounting_periods
//   select/insert/update TO authenticated, ANON -> anyone with the public anon key
//   could reopen a closed accounting period over REST and back-date journal entries
//   (bypassing the section 4.3 period lock). Confirmed live via pg_policy 2026-06-27.
//
// Fix migration: supabase-phase532-periods-anon-fix.sql — drop anon from every
//   policy, gate writes to public.is_accountant(), keep SELECT for all authenticated
//   (auto_post reads period status during checkout as the cashier).
//
// This guard locks the migration's intent so a future edit cannot silently re-grant
// anon or loosen the write gate. It checks the tracked SQL file (source-of-truth for
// what must be applied); the live DB state is verified out-of-band via pg_policy.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SQL = fs.readFileSync(path.resolve("supabase-phase532-periods-anon-fix.sql"), "utf8");

// every CREATE POLICY in the fix must target authenticated only — never anon
test("no accounting_periods policy grants the anon role", () => {
  const creates = SQL.match(/CREATE POLICY[\s\S]*?;/g) || [];
  assert.ok(creates.length >= 3, "fix must recreate the 3 period policies (select/insert/update)");
  for (const stmt of creates) {
    assert.ok(/\bTO authenticated\b/.test(stmt), `policy must be TO authenticated: ${stmt.slice(0, 70)}`);
    assert.ok(!/\banon\b/.test(stmt), `policy must NOT grant anon: ${stmt.slice(0, 70)}`);
  }
});

// old anon-granting policies must be dropped first (idempotent replace)
test("fix drops the old policies before recreating", () => {
  for (const p of ["periods_select", "periods_insert", "periods_update"]) {
    assert.ok(SQL.includes(`DROP POLICY IF EXISTS "${p}"`), `must drop ${p}`);
  }
});

// writes gated to is_accountant() (admin/accountant only) — closes the reopen hole
test("INSERT and UPDATE are gated to public.is_accountant()", () => {
  assert.match(
    SQL,
    /periods_insert"[\s\S]*?FOR INSERT TO authenticated[\s\S]*?WITH CHECK \(public\.is_accountant\(\)\)/,
    "periods_insert must WITH CHECK is_accountant()",
  );
  assert.match(
    SQL,
    /periods_update"[\s\S]*?FOR UPDATE TO authenticated[\s\S]*?USING \(public\.is_accountant\(\)\)[\s\S]*?WITH CHECK \(public\.is_accountant\(\)\)/,
    "periods_update must USING + WITH CHECK is_accountant()",
  );
});

// SELECT must stay open to all authenticated — checkout auto_post reads period status
test("SELECT stays readable by all authenticated (checkout must not break)", () => {
  assert.match(
    SQL,
    /periods_select"[\s\S]*?FOR SELECT TO authenticated[\s\S]*?USING \(true\)/,
    "periods_select must remain TO authenticated USING (true) so auto_post checkout read works",
  );
  const selBlock = SQL.match(/CREATE POLICY "periods_select"[\s\S]*?;/)?.[0] || "";
  assert.ok(!/is_accountant/.test(selBlock), "periods_select must NOT require is_accountant() (cashier needs read)");
});
