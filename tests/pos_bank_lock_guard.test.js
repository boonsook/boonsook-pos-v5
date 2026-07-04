// Phase 561 — POS locks the receiving bank to the "หน้าร้าน" customer-group binding (build 560)
//
// Feature: owner binds one bank to customer group "หน้าร้าน" in Settings (Phase 439
// bank.customerGroup). POS transfer screen locks to that bank + hides the picker.
// No new setting — reuse the existing binding. Not bound → legacy dropdown behavior.
//
// ★ MONEY GUARD (the reason this test exists):
//   The JV note that decides the Dr account (pos.js checkout: `validBanks[selectedBankIdx]`)
//   re-resolves the bank from selectedBankIdx — INDEPENDENTLY of the render-scope activeBank.
//   So the render MUST set the module-level selectedBankIdx = the locked idx, or the cashier
//   sees the bound bank but the JV posts a DIFFERENT account. This test locks that contract.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { _resolvePosBankIdx } from "../modules/pos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const posSrc = readFileSync(path.join(__dirname, "..", "modules", "pos.js"), "utf8");

const GROUP = "หน้าร้าน";
const BANKS = [
  { coaCode: "1130", bankName: "KBank", bankAccount: "x111", customerGroup: "" },
  { coaCode: "1135", bankName: "SCB",   bankAccount: "x222", customerGroup: "หน้าร้าน" },
  { coaCode: "1131", bankName: "KTB",   bankAccount: "x333", customerGroup: "งานช่าง" },
];

// ── _resolvePosBankIdx behavior ──────────────────────────────────────────────
test('bank bound to "หน้าร้าน" → locks it, idx = its position', () => {
  const r = _resolvePosBankIdx(BANKS, GROUP, 0);
  assert.equal(r.locked, true, "must be locked");
  assert.equal(r.idx, 1, "idx must point to SCB (position 1) — what the JV reads");
});

test("★ money guard: locked idx makes render + JV resolve the SAME bank", () => {
  // JV does validBanks[selectedBankIdx]. render sets selectedBankIdx = r.idx.
  const r = _resolvePosBankIdx(BANKS, GROUP, 0);
  assert.equal(BANKS[r.idx].coaCode, "1135", "validBanks[idx] must equal the bound bank");
});

test("no bank bound to the group → fallback to fallbackIdx, not locked", () => {
  const noBind = BANKS.map(b => ({ ...b, customerGroup: "" }));
  const r = _resolvePosBankIdx(noBind, GROUP, 2);
  assert.equal(r.locked, false, "unbound must not lock");
  assert.equal(r.idx, 2, "idx falls back to fallbackIdx");
});

test("out-of-range fallbackIdx → normalizes to 0 (no crash)", () => {
  const noBind = BANKS.map(b => ({ ...b, customerGroup: "" }));
  const r = _resolvePosBankIdx(noBind, GROUP, 99);
  assert.equal(r.idx, 0);
  assert.equal(r.locked, false);
});

test("empty banks → idx 0, not locked", () => {
  const r = _resolvePosBankIdx([], GROUP, 0);
  assert.equal(r.idx, 0);
  assert.equal(r.locked, false);
});

test("first bound bank wins (deterministic) when two share the group", () => {
  const two = [
    { coaCode: "1130", bankName: "A", customerGroup: "หน้าร้าน" },
    { coaCode: "1135", bankName: "B", customerGroup: "หน้าร้าน" },
  ];
  const r = _resolvePosBankIdx(two, GROUP, 1);
  assert.equal(r.idx, 0, "findIndex returns the first match");
  assert.equal(r.locked, true);
});

// ── pos.js source contract ───────────────────────────────────────────────────
test('pos.js locks POS to the "หน้าร้าน" group (reuse Phase 439 binding)', () => {
  assert.match(posSrc, /POS_GROUP\s*=\s*["']หน้าร้าน["']/, 'must target the "หน้าร้าน" group');
});

test("pos.js render sets module-level selectedBankIdx = resolved idx (money guard)", () => {
  assert.match(
    posSrc,
    /selectedBankIdx\s*=\s*_posBankRes\.idx/,
    "render must set selectedBankIdx = _posBankRes.idx so the JV posts the locked bank",
  );
});

test("pos.js hides #posBankPicker when locked (dropdown only in the non-locked branch)", () => {
  assert.match(
    posSrc,
    /\$\{_bankLocked\s*\?\s*`[\s\S]*?`\s*:\s*\(validBanks\.length > 1/,
    "posBankPicker must render only in the else branch of _bankLocked",
  );
});

test("pos.js checkout JV still resolves from validBanks[selectedBankIdx] (NOT changed)", () => {
  assert.match(
    posSrc,
    /const activeBank = validBanks\[selectedBankIdx\];/,
    "the JV note bank resolution must stay selectedBankIdx-based (we only steer the idx)",
  );
});

test("pos.js still emits BANK_COA note from activeBank.coaCode (routing unchanged)", () => {
  assert.match(posSrc, /BANK_COA:\$\{activeBank\.coaCode\}/, "BANK_COA note format unchanged");
});
