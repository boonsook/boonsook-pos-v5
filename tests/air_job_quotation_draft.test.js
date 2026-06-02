// Phase 353 — air-job-to-quotation-draft-action guard
// Run: node --test tests/air_job_quotation_draft.test.js
//
// Contract: a "สร้างใบเสนอราคา" button on air_catalog service-jobs stages a quotation DRAFT
// (reusing build 346 sessionStorage bridge) and navigates to quotations — it must NEVER
// auto-save a quotation / create a doc number / touch stock/POS/cart, and general jobs get no button.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function makeShim() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; }
globalThis.sessionStorage = makeShim();
const { pushAirQuoteDraft, consumeAirQuoteDrafts } = await import("../modules/ac_quotation_draft.js");

const sj = fs.readFileSync(path.resolve("modules/service_jobs.js"), "utf8");
const quo = fs.readFileSync(path.resolve("modules/quotations.js"), "utf8");

// ── draft carries air_job fields; consume-once ───────────────────────────────
test("pushAirQuoteDraft stores an air_job draft with job/customer meta", () => {
  sessionStorage.clear();
  pushAirQuoteDraft({
    source: "air_job", originalSource: "air_catalog", serviceJobId: 11,
    customerName: "ลูกค้า A", customerPhone: "0810000000",
    summary: "แอร์ติดผนัง TCL MFS10 9,000 BTU · ราคาเสนอ 12,900 บาท",
    btu: 9000, offerPrice: 12900, intent: "booking", appointment: "2026-06-10 ช่วงเช้า"
  });
  const d = consumeAirQuoteDrafts();
  assert.equal(d.length, 1);
  assert.equal(d[0].source, "air_job");
  assert.equal(d[0].originalSource, "air_catalog");
  assert.equal(d[0].serviceJobId, 11);
  assert.equal(d[0].customerName, "ลูกค้า A");
  assert.equal(d[0].offerPrice, 12900);
  assert.match(d[0].summary, /MFS10/);
  assert.deepEqual(consumeAirQuoteDrafts(), []); // reload → no duplicate
});

test("build 346 catalog draft still defaults source=air_catalog (backward-compatible)", () => {
  sessionStorage.clear();
  pushAirQuoteDraft({ brand: "TCL", model: "MFS10", btu: 9000, offerPrice: 12900 });
  assert.equal(consumeAirQuoteDrafts()[0].source, "air_catalog");
});

// ── service_jobs: button on air jobs only; pushes draft + navigates; no save ─
test("service_jobs shows 'สร้างใบเสนอราคา' only for air jobs (general jobs get none)", () => {
  assert.match(sj, /import \{ pushAirQuoteDraft \} from "\.\/ac_quotation_draft\.js"/);
  // button is gated behind airMeta.isAir
  assert.match(sj, /airMeta\.isAir \? `<button class="btn" data-air-quote="\$\{j\.id\}"/);
  // it is NOT rendered unconditionally (must sit inside the airMeta.isAir ternary)
  assert.ok(!/^\s*<button class="btn" data-air-quote=/m.test(sj), "air-quote button must be conditional on airMeta.isAir");
});

test("the button stages an air_job draft + navigates — no auto-save / no doc number / no stock/POS/cart", () => {
  const h = sj.slice(sj.indexOf('[data-air-quote]'), sj.indexOf('[data-air-quote]') + 900);
  assert.match(h, /pushAirQuoteDraft\(\{[\s\S]*?source: "air_job"/);
  assert.match(h, /showRoute\("quotations"\)|location\.hash\s*=\s*"quotations"/);
  // never auto-creates a real quotation / doc number / touches stock-cart-pos from this handler
  for (const banned of [/saveQuotationFull/, /xhrPost/, /_appXhr/, /qt_no/, /addToCart/, /\.stock\s*=/, /rest\/v1/]) {
    assert.ok(!banned.test(h), `air-quote handler must not reference ${banned}`);
  }
});

// ── quotations consume: air_job summary line item + notice + customer prefill ─
test("quotations maps an air_job draft (summary) to a line item, shows 'งานแอร์' notice", () => {
  // airDraftToLineItem uses d.summary for air_job
  assert.match(quo, /if \(d\.summary\) \{[\s\S]*?item_name = String\(d\.summary\)\.split\("·"\)\[0\]/);
  assert.match(quo, /_serviceJobId: d\.serviceJobId/);
  // source-aware notice
  assert.match(quo, /_airDraftSource === "air_job" \? "งานแอร์" : "แคตตาล็อกแอร์"/);
  // customer prefill from the air-job draft (new doc only)
  assert.match(quo, /!isEdit && _airDraftCustomer\.name/);
  assert.match(quo, /first\.source === "air_job" \? "air_job" : "air_catalog"/);
});

test("quotations does NOT auto-save on consuming the draft (manual save only)", () => {
  const block = quo.slice(quo.indexOf("Phase 346: ถ้ามีรายการร่าง"), quo.indexOf("Phase 45.10 (B5-3)"));
  assert.ok(!/saveQuotationFull|xhrPost|_appXhr/.test(block), "consuming a draft must not auto-save");
  // manual save button still wired
  assert.match(quo, /getElementById\("qtSaveBtn"\)\?\.addEventListener\("click",\s*saveQuotationFull\)/);
});
