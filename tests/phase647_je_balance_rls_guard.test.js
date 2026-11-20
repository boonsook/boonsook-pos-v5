import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const migration = fs.readFileSync("supabase-phase647-je-balance-trigger-rls.sql", "utf8");
const preflight = fs.readFileSync("phase647-je-balance-preflight-readonly.sql", "utf8");
const incident = fs.readFileSync("phase647-orphan-663-readonly.sql", "utf8");
const original = fs.readFileSync("supabase-phase498-je-lines-balance.sql", "utf8");
const rls = fs.readFileSync("supabase-phase92-46b-force-reset.sql", "utf8");
const rehearsal = fs.readFileSync("tests/phase647_je_balance_rls_rehearsal.sql", "utf8");

function isPrivilegeSafeFix(sql) {
  return /ALTER FUNCTION public\.enforce_je_lines_balance\(\) SECURITY DEFINER/.test(sql)
    && /ALTER FUNCTION public\.enforce_je_lines_balance\(\)\s+SET search_path = pg_catalog, pg_temp/.test(sql)
    && /p\.proowner = 'postgres'::pg_catalog\.regrole/.test(sql)
    && /c\.relowner = 'postgres'::pg_catalog\.regrole/.test(sql)
    && /c\.relrowsecurity AND NOT c\.relforcerowsecurity/.test(sql);
}

test("existing invoker trigger and accountant-only lines SELECT reproduce the zero-sum risk", () => {
  assert.match(original, /FROM public\.journal_lines\s+WHERE entry_id = v_entry/);
  assert.doesNotMatch(original, /SECURITY DEFINER/);
  assert.match(rls, /CREATE POLICY "jl_select" ON public\.journal_lines\s+AS PERMISSIVE FOR SELECT TO authenticated\s+USING \(public\.is_accountant\(\)\)/);
});

test("candidate fixes trigger visibility only with pinned owner and search path", () => {
  assert.equal(isPrivilegeSafeFix(migration), true);
  const body = original.match(/CREATE OR REPLACE FUNCTION public\.enforce_je_lines_balance\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];
  assert.ok(body, "reviewed original function body exists");
  // Production prosrc read by C2/C2-S on 2026-11-20 = this reviewed body with SQL line comments
  // removed and CRLF line endings; the statements are otherwise byte-identical.
  const liveBody = body.split("\n").filter((l) => !/^[ \t]*--/.test(l))
    .map((l) => l.replace(/[ \t]+--.*$/, "")).join("\r\n");
  const liveMd5 = createHash("md5").update(liveBody).digest("hex");
  const lfMd5 = createHash("md5").update(body).digest("hex");
  assert.equal(liveMd5, "cd812932adf24bc9887a432c084db477");
  assert.equal(lfMd5, "77709a3f7271068a44cce7307f68dd14");
  assert.match(migration, new RegExp(`pg_catalog\\.md5\\(p\\.prosrc\\) = '${liveMd5}'\\n`));
  assert.doesNotMatch(migration, new RegExp(lfMd5), "LF fixture body must not be accepted on production");
  assert.match(rehearsal, new RegExp("\\\\i supabase-phase498-je-lines-balance\\.sql\\n[\\s\\S]*?"
    + `pg_catalog\\.md5\\(v_src\\) <> '${liveMd5}'[\\s\\S]*?EXECUTE pg_catalog\\.format\\('CREATE OR REPLACE FUNCTION`
    + "[\\s\\S]*?\\\\i supabase-phase647-je-balance-trigger-rls\\.sql"),
    "rehearsal must install the production-shaped body before the migration");
  assert.equal(isPrivilegeSafeFix(migration.replace(" SECURITY DEFINER", " SECURITY INVOKER")), false,
    "test must catch an invoker mutant");
  assert.match(migration, /BEGIN;[\s\S]*?SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /t\.tgdeferrable AND t\.tginitdeferred/);
  assert.match(migration, /t\.tgenabled = 'O'/);
  assert.match(migration, /COMMIT;\s*$/);
});

test("candidate leaves policies, grants, data, trigger definition and amounts unchanged", () => {
  assert.doesNotMatch(migration, /(?:CREATE|DROP|ALTER) POLICY|(?:CREATE|DROP|ALTER) TRIGGER/i);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:FROM\s+|INTO\s+)?public\./i);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION|GRANT |REVOKE /i);
  assert.doesNotMatch(migration, /ALTER TABLE/i);
});

test("preflight and incident triage are read-only and identify the exact orphan", () => {
  for (const sql of [preflight, incident]) {
    assert.match(sql, /BEGIN READ ONLY;/);
    assert.match(sql, /SET LOCAL statement_timeout = '30s'/);
    assert.match(sql, /ROLLBACK;\s*$/);
    assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\s+(?:FROM\s+|INTO\s+)?public\./i);
  }
  assert.match(incident, /WHERE je\.id = 663/);
  assert.match(incident, /count\(jl\.id\) AS line_count/);
});

test("PostgreSQL fixture tests both privacy and still-rejected unbalanced lines", () => {
  assert.match(rehearsal, /staff gained line SELECT/);
  assert.match(rehearsal, /staff gained header DELETE/);
  assert.match(rehearsal, /invoker unexpectedly accepted lines/);
  assert.match(rehearsal, /unbalanced lines unexpectedly accepted/);
  assert.match(rehearsal, /DELETE FROM public\.journal_entries WHERE id = 665/);
  assert.match(rehearsal, /SELECT 1 FROM public\.journal_entries WHERE id = 666/);
});
