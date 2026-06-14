// Phase 439 (B1) — bank ↔ customer-group mapping + resolver guard
// Run: node --test tests/customer_group_bank_map_guard.test.js
//
// Why this exists:
//   Phase B auto-fills the correct receiving bank on a receipt from the customer's
//   group (Phase 438). B1 lets the owner tag each bank with a customer group (stored
//   in settings → paymentInfo.banks[].customerGroup — JSON, no DB schema) and provides
//   a shared resolver. These guards lock: the 5 groups live in ONE module, the settings
//   form wires the tag (render + sync + save), and the resolver returns a FULL bank
//   snapshot on a match and NULL on a miss — never a silent 1130 fallback (reviewer
//   note #4), and with enough data to freeze the bank label on a receipt (note #1).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CUSTOMER_GROUPS, resolveBankForCustomerGroup } from "../modules/customer_groups.js";

const GROUPS = ["ราชการ", "ขาย POS", "งานช่าง", "หน้าร้าน", "ขายพร้อมติดตั้ง"];
const payment   = fs.readFileSync(path.resolve("modules/settings/payment.js"), "utf8");
const customers = fs.readFileSync(path.resolve("modules/customers.js"), "utf8");

// ── 1. single source for the 5 groups ───────────────────────────────────────
test("CUSTOMER_GROUPS is the single source of the 5 agreed groups (in order)", () => {
  assert.deepEqual(CUSTOMER_GROUPS, GROUPS);
});

test("customers.js imports CUSTOMER_GROUPS from the shared module (no local duplicate)", () => {
  assert.match(customers, /import\s*\{[^}]*\bCUSTOMER_GROUPS\b[^}]*\}\s*from\s*["']\.\/customer_groups\.js["']/,
    "customers.js must import CUSTOMER_GROUPS from ./customer_groups.js");
  assert.ok(!/const\s+CUSTOMER_GROUPS\s*=/.test(customers),
    "customers.js must not redefine CUSTOMER_GROUPS locally");
});

// ── 2. settings form wires the per-bank group tag (render + sync + save) ─────
test("payment.js renders a per-bank customerGroup select built from CUSTOMER_GROUPS", () => {
  assert.match(payment, /import\s*\{[^}]*\bCUSTOMER_GROUPS\b[^}]*\}\s*from\s*["']\.\.\/customer_groups\.js["']/,
    "payment.js must import CUSTOMER_GROUPS");
  assert.match(payment, /data-bank-field="customerGroup"/, "must render the customerGroup select");
  assert.match(payment, /CUSTOMER_GROUPS\.map\(/, "options must be built from CUSTOMER_GROUPS (single source)");
});

test("payment.js persists customerGroup in both the sync helper and the save handler", () => {
  const reads = payment.match(/customerGroup"\][^\n]*\.value/g) || [];
  assert.ok(reads.length >= 2,
    "customerGroup must be read from the DOM in BOTH _syncBanksFromDom and the save handler");
  assert.match(payment, /customerGroup:\s*card\.querySelector/, "save handler must include customerGroup in the bank object");
});

// ── 3. resolver: snapshot on match, NULL on miss (never a silent 1130) ───────
const PI = { banks: [
  { customerGroup: "ราชการ", coaCode: "1131", bankName: "กรุงไทย",  bankAccount: "x5145", bankHolder: "ร้าน" },
  { customerGroup: "ขาย POS", coaCode: "1133", bankName: "กสิกร",    bankAccount: "x1872" },
  { customerGroup: "ราชการ", coaCode: "1132", bankName: "กรุงไทย2", bankAccount: "x2125" }
] };

test("resolveBankForCustomerGroup returns a full snapshot; first match wins", () => {
  const r = resolveBankForCustomerGroup("ราชการ", PI);
  assert.ok(r, "must resolve a tagged group");
  assert.equal(r.coaCode, "1131", "first matching bank wins (deterministic)");
  assert.equal(r.bankName, "กรุงไทย");
  assert.ok(r.label.includes("x5145"), "label must snapshot the account number (note #1)");
});

test("resolveBankForCustomerGroup returns NULL on any miss — no 1130 fallback (note #4)", () => {
  const misses = [
    resolveBankForCustomerGroup("หน้าร้าน", PI), // group not tagged on any bank
    resolveBankForCustomerGroup("", PI),          // empty group
    resolveBankForCustomerGroup(null, PI),        // null group
    resolveBankForCustomerGroup("ราชการ", {}),    // no banks array
    resolveBankForCustomerGroup("ราชการ", null)   // no paymentInfo
  ];
  for (const m of misses) {
    assert.equal(m, null, "a miss must be null — not an object, not a '1130' default");
  }
});
