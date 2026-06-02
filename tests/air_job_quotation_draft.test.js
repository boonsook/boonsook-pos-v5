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
  // source-aware notice (Phase 354: via isJob flag)
  assert.match(quo, /isJob = _airDraftSource === "air_job"/);
  assert.match(quo, /isJob \? "งานแอร์" : "แคตตาล็อกแอร์"/);
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

// ── Phase 354: richer air_job banner / back-to-job / price warning / customer hint ──
test("serviceJobNo round-trips through the draft", () => {
  sessionStorage.clear();
  pushAirQuoteDraft({ source: "air_job", serviceJobId: 11, serviceJobNo: "JOB-AIR1", offerPrice: 0 });
  const d = consumeAirQuoteDrafts()[0];
  assert.equal(d.serviceJobNo, "JOB-AIR1");
  assert.equal(d.serviceJobId, 11);
});

test("air_job banner shows a source summary (job no / intent / summary / appointment)", () => {
  assert.match(quo, /let _airDraftMeta = null/);
  assert.match(quo, /_airDraftMeta = first/);
  assert.match(quo, /รายการร่างจาก\$\{isJob \? "งานแอร์" : "แคตตาล็อกแอร์"\}/);
  assert.match(quo, /งานเลขที่ \$\{m\.serviceJobNo\}/);
  assert.match(quo, /m\.intent === "ask" \? "สอบถามราคา"/);
  assert.match(quo, /m\.appointment \? `📅/);
});

test("back-to-source-job button shows only when serviceJobId exists, and only navigates", () => {
  assert.match(quo, /isJob && \(m\.serviceJobId != null\) \? `<button id="qtBackToJob"/);
  assert.match(quo, /getElementById\("qtBackToJob"\)\?\.addEventListener\("click"[\s\S]*?showRoute\("service_jobs"\)/);
  // navigation only — must not mutate job status
  const h = quo.slice(quo.indexOf('"qtBackToJob"'), quo.indexOf('"qtBackToJob"') + 300);
  assert.ok(!/status|xhrPost|_appXhr|saveQuotationFull/.test(h), "back-to-job must not change status/save");
});

test("price-missing warning shows for air_job drafts without an offer price", () => {
  assert.match(quo, /priceMissing = isJob && !\(Number\(m\.offerPrice\) > 0\)/);
  assert.match(quo, /ยังไม่มีราคา \(ต้องเช็คราคา\) — กรุณากรอกราคา/);
});

test("customer prefill shows the 'เติมจากงานแจ้งบริการ' hint and does not auto-create a customer", () => {
  assert.match(quo, /เติมจากงานแจ้งบริการ/);
  // hint only on a NEW doc from an air_job draft
  assert.match(quo, /!isEdit && _airDraftSource === "air_job" && _airDraftCustomer\.name/);
  // no auto customer insert anywhere near the air-draft consume/form
  const block = quo.slice(quo.indexOf("Phase 346: ถ้ามีรายการร่าง"), quo.indexOf("Phase 45.10 (B5-3)"));
  assert.ok(!/from\(["']customers["']\)|insert.*customer/i.test(block), "must not auto-create a customer");
});

test("air_catalog (build 346) banner still says 'แคตตาล็อกแอร์' (not งานแอร์)", () => {
  sessionStorage.clear();
  pushAirQuoteDraft({ brand: "TCL", model: "MFS10", btu: 9000, offerPrice: 12900 });
  const d = consumeAirQuoteDrafts()[0];
  assert.equal(d.source, "air_catalog");
  // banner branch keeps the catalog label for non-job source
  assert.match(quo, /isJob \? "งานแอร์" : "แคตตาล็อกแอร์"/);
});
