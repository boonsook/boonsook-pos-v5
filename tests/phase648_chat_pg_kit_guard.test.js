// Phase 648A r3 — guard for the PostgreSQL test kit (prepared, NOT RUN).
// Run: node --test tests/phase648_chat_pg_kit_guard.test.js
// Locks: kit files are bound by SHA-256 to tests/phase648_chat_pg_manifest.json (edit the migration
// → this fails until the manifest is regenerated), status stays NOT_RUN until real evidence exists,
// the runner is local-only (no DSN/host), applies the migration twice, and the checks cover every
// role Codex listed plus duplicate ingest, unsend before/after, and two-session races.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const manifest = JSON.parse(fs.readFileSync("tests/phase648_chat_pg_manifest.json", "utf8"));
const runner = fs.readFileSync("scripts/phase648-chat-pg-local.mjs", "utf8");
const checks = fs.readFileSync("tests/phase648_chat_pg_checks.sql", "utf8");
const fixture = fs.readFileSync("tests/phase648_chat_pg_fixture.sql", "utf8");

test("kit files match the manifest SHA-256 (kit bound to these exact sources)", () => {
  assert.deepEqual(Object.keys(manifest.files).sort(), [
    "scripts/phase648-chat-pg-local.mjs",
    "supabase-phase648-customer-chat-inbox.sql",
    "tests/phase648_chat_pg_checks.sql",
    "tests/phase648_chat_pg_fixture.sql",
  ]);
  for (const [file, hash] of Object.entries(manifest.files)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(actual, hash, `${file} changed — regenerate tests/phase648_chat_pg_manifest.json`);
  }
});

test("status is NOT_RUN and expected output lines match what the runner prints", () => {
  assert.equal(manifest.status, "NOT_RUN");
  for (const line of manifest.expected_stdout) {
    assert.ok(runner.includes(`console.log("${line}")`), `runner prints ${line}`);
  }
  assert.deepEqual(manifest.expected_stdout, [
    "PHASE648 PG CHECKS PASS",
    "PHASE648 RACE INGEST-BEFORE-DONE PASS",
    "PHASE648 RACE DONE-BEFORE-INGEST PASS",
    "PHASE648 RACE PARALLEL-INGEST PASS",
  ]);
});

test("runner is local-only: fixed argv, loopback cluster, PG* env stripped, refuses existing cluster", () => {
  assert.match(runner, /assert\.deepEqual\(Object\.keys\(args\)\.sort\(\), \["--bin-dir", "--cluster-root", "--port"\]\)/);
  assert.match(runner, /listen_addresses='127\.0\.0\.1'/);
  assert.match(runner, /!key\.toUpperCase\(\)\.startsWith\("PG"\)/);
  assert.match(runner, /refuse pre-existing test cluster/);
  assert.ok(!/postgres(ql)?:\/\//i.test(runner), "no connection URI");
  assert.ok(!/supabase\.co/i.test(runner), "never targets Supabase hosts");
  const applies = runner.match(/sql\("phase648", file\("supabase-phase648-customer-chat-inbox\.sql"\)\)/g) || [];
  assert.equal(applies.length, 2, "migration applied twice (re-run safety)");
  assert.match(runner, /kit files differ from tests\/phase648_chat_pg_manifest\.json/);
});

test("checks cover every role, duplicate ingest, unsend before/after, ok boolean, pending filter", () => {
  for (const sub of ["a1", "a2", "a3", "a4", "a5"]) assert.ok(checks.includes(`0000000000${sub}`), `user ${sub}`);
  for (const role of ["SET ROLE anon", "SET ROLE service_role", "SET ROLE authenticated"]) assert.ok(checks.includes(role), role);
  assert.match(fixture, /CREATE ROLE service_role NOLOGIN BYPASSRLS/);
  assert.match(fixture, /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role/);
  for (const label of ["K1", "K2", "K3 duplicate", "K4", "K5", "K6", "K6b", "K7", "K8", "K9"]) assert.ok(checks.includes(label), label);
  assert.match(checks, /jsonb_typeof\(j->'ok'\) <> 'boolean'/);
  assert.match(checks, /unsend arrives first → tombstone/);
  assert.match(runner, /wait_event_type='Lock'/);
});
