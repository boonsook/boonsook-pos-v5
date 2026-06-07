// Phase 393 — service-request-total-cost-notnull-hotfix (HIGH · service blocked)
// Run: node --test tests/service_request_total_cost_guard.test.js
//
// Why this exists:
//   service_jobs.total_cost is NOT NULL. service_request.js POSTed a record WITHOUT
//   total_cost (→ null → "null value in column total_cost violates not-null") so the
//   job never entered the DB/queue — the real cause behind "งานช่างหลุดคิว" surfaced by
//   Phase 391's save-signal. The audit also found ac_shop omitted total_cost, and
//   main.saveServiceJob sent `null` when the cost was 0. These guards lock that every
//   service_jobs POST path provides a numeric total_cost.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sreq = fs.readFileSync(path.resolve("modules/service_request.js"), "utf8");
const acshop = fs.readFileSync(path.resolve("modules/ac_shop.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");

test("service_request POST record sends total_cost: 0 (number, never null/omitted)", () => {
  const rec = (sreq.match(/const record = \{[\s\S]*?\n\s*\};/) || [""])[0];
  assert.ok(rec.length > 0, "found the record literal");
  assert.match(rec, /total_cost:\s*0\b/, "record sends total_cost: 0");
  assert.doesNotMatch(rec, /total_cost:\s*(null|""|undefined)/, "never null/empty/undefined");
});

test("ac_shop order POST sends a numeric total_cost (the order price prod.p)", () => {
  const od = (acshop.match(/const orderData = \{[\s\S]*?\n\s*\};/) || [""])[0];
  assert.ok(od.length > 0, "found orderData literal");
  assert.match(od, /total_cost:\s*prod\.p\b/, "ac_shop sends total_cost: prod.p");
});

test("main.saveServiceJob sends total_cost 0 (not null) when no cost is entered", () => {
  assert.match(mainJs, /total_cost:\s*totalCostVal > 0 \? totalCostVal : 0\b/, "0, not null");
  assert.doesNotMatch(mainJs, /total_cost:\s*totalCostVal > 0 \? totalCostVal : null/, "old null branch gone");
});

test("the other service_jobs POST paths already provide total_cost (regression guard)", () => {
  for (const f of ["modules/ai_sales.js", "modules/ac_install.js", "modules/solar.js", "modules/service_form.js", "modules/customer_dashboard.js"]) {
    const src = fs.readFileSync(path.resolve(f), "utf8");
    assert.match(src, /total_cost:/, `${f} must still send total_cost`);
  }
});
