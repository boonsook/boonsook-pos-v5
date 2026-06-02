// Phase 346 — air-catalog-to-quotation-draft guard
// Run: node --test tests/air_catalog_quotation_draft.test.js
//
// Contract: "นำไปเสนอราคา" stages a TEMPORARY draft in sessionStorage and the quotation
// page consumes it ONCE into the create-form (prefilled, NOT saved). It must never:
//   - create a real quotation automatically (no auto-save / no xhrPost on consume)
//   - add to / cut real stock, touch cart/POS/products, or write Supabase
//   - re-consume on reload (consume = read-then-clear)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── in-memory sessionStorage shim (node has none) ────────────────────────────
function makeShim() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
globalThis.sessionStorage = makeShim();

const { pushAirQuoteDraft, consumeAirQuoteDrafts, peekAirQuoteDraftCount } =
  await import("../modules/ac_quotation_draft.js");

const SAMPLE = {
  source: "air_catalog", catalogId: 7, airType: "แอร์ติดผนัง",
  brand: "TCL วอลไทป์", model: "MFS10", btu: 9000, offerPrice: 12900,
  estimatedCost: 9000, sku: "AC-001", note: "โปรเดือนนี้",
};

// ── behavioural: push / consume / consume-once ───────────────────────────────
test("pushAirQuoteDraft stores a draft in sessionStorage", () => {
  sessionStorage.clear();
  assert.equal(peekAirQuoteDraftCount(), 0);
  pushAirQuoteDraft(SAMPLE);
  assert.equal(peekAirQuoteDraftCount(), 1);
  assert.ok(sessionStorage.getItem("bsk_air_quote_draft"), "must persist under bsk_air_quote_draft");
});

test("consumeAirQuoteDrafts returns the drafts and clears them (no re-consume on reload)", () => {
  sessionStorage.clear();
  pushAirQuoteDraft(SAMPLE);
  const first = consumeAirQuoteDrafts();
  assert.equal(first.length, 1);
  const d = first[0];
  assert.equal(d.source, "air_catalog");
  assert.equal(d.catalogId, 7);
  assert.equal(d.airType, "แอร์ติดผนัง");
  assert.equal(d.model, "MFS10");
  assert.equal(d.offerPrice, 12900);
  assert.equal(d.estimatedCost, 9000);
  // second consume (simulating a page reload) yields NOTHING — no duplicate fill
  assert.deepEqual(consumeAirQuoteDrafts(), []);
  assert.equal(peekAirQuoteDraftCount(), 0);
});

test("multiple pushes accumulate then consume together", () => {
  sessionStorage.clear();
  pushAirQuoteDraft(SAMPLE);
  pushAirQuoteDraft({ ...SAMPLE, model: "MFS18", offerPrice: 19900 });
  assert.equal(consumeAirQuoteDrafts().length, 2);
});

test("estimatedCost normalises to null when absent", () => {
  sessionStorage.clear();
  pushAirQuoteDraft({ ...SAMPLE, estimatedCost: undefined });
  assert.equal(consumeAirQuoteDrafts()[0].estimatedCost, null);
});

// ── helper safety: sessionStorage only, no network / no real stock ───────────
test("draft helper uses sessionStorage only — no Supabase/localStorage/network", () => {
  const helper = fs.readFileSync(path.resolve("modules/ac_quotation_draft.js"), "utf8");
  assert.match(helper, /sessionStorage/);
  // match real USAGE (property access / config), not comment mentions of the words
  for (const banned of [/localStorage\./, /SUPABASE_CONFIG/, /rest\/v1\//, /\/api\//, /fetch\(/, /_appXhr/]) {
    assert.ok(!banned.test(helper), `draft helper must not reference ${banned}`);
  }
});

// ── quotations page: consume → prefill form, never auto-save ─────────────────
const quotations = fs.readFileSync(path.resolve("modules/quotations.js"), "utf8");

test("quotations page consumes the air draft into a fresh form (no auto-saved document)", () => {
  assert.match(quotations, /import \{ consumeAirQuoteDrafts \} from "\.\/ac_quotation_draft\.js"/);
  // consume block opens the create-form, never saves
  const block = quotations.slice(quotations.indexOf("Phase 346: ถ้ามีรายการร่าง"), quotations.indexOf("Phase 45.10 (B5-3)"));
  assert.match(block, /consumeAirQuoteDrafts\(\)/);
  assert.match(block, /_viewMode = "form"/);
  assert.match(block, /_lineItems = _airDrafts\.map\(airDraftToLineItem\)/);
  assert.ok(!/saveQuotationFull|xhrPost|_appXhr/.test(block), "consuming a draft must NOT auto-save a quotation");
});

test("air draft maps to a custom (product_id:null) line item — not a real product/stock link", () => {
  const fn = quotations.slice(quotations.indexOf("function airDraftToLineItem"), quotations.indexOf("function airDraftToLineItem") + 700);
  assert.match(fn, /product_id:\s*null/);
  assert.match(fn, /unit_price:\s*price/);
  assert.match(fn, /_source:\s*"air_catalog"/);
});

test("a clear notice tells the user the draft is NOT yet saved", () => {
  assert.match(quotations, /มีรายการร่างจากแคตตาล็อกแอร์/);
  assert.match(quotations, /ยังไม่ได้บันทึกเอกสาร/);
  assert.match(quotations, /_airDraftNotice/);
});

// ── existing quotation flow still intact ─────────────────────────────────────
test("existing quotation save flow is untouched (manual save button still wired)", () => {
  assert.match(quotations, /id="qtSaveBtn"/);
  assert.match(quotations, /getElementById\("qtSaveBtn"\)\?\.addEventListener\("click",\s*saveQuotationFull\)/);
  assert.match(quotations, /async function saveQuotationFull|function saveQuotationFull/);
});
