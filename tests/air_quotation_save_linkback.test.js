// Phase 355 — air-quotation-save-linkback guard
// Run: node --test tests/air_quotation_save_linkback.test.js
//
// Contract: when a quotation comes from an air_job draft (source=air_job), pressing the
// manual "บันทึก" button appends a readable reference to the source job INTO the note field
// (an existing column — no schema change). It must:
//   - inject only on manual save (never auto-save / never before the user clicks)
//   - preserve the user's existing note and append below it
//   - never duplicate the reference on re-save / editing the same document
//   - leave air_catalog-direct drafts (build 346) unreferenced
//   - never mutate the service job (status / POST) or touch stock / POS / cart / schema

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { buildAirJobNoteRef, appendAirJobNoteRef } = await import("../modules/quotations.js");
const quo = fs.readFileSync(path.resolve("modules/quotations.js"), "utf8");

const META = {
  source: "air_job", serviceJobId: 11, serviceJobNo: "JOB-AIR1",
  intent: "booking", brand: "TCL", model: "MFS10", btu: 9000, offerPrice: 12900
};

// ── buildAirJobNoteRef: format ──────────────────────────────────────────────
test("buildAirJobNoteRef formats job no / intent / model·BTU / offer price", () => {
  const ref = buildAirJobNoteRef(META);
  assert.match(ref, /^สร้างจากงานแอร์: JOB-AIR1/);
  assert.match(ref, /สั่งจอง/);
  assert.match(ref, /TCL MFS10/);
  assert.match(ref, /9,000 BTU/);
  assert.match(ref, /ราคาเสนอ 12,900 บาท/);
});

test("buildAirJobNoteRef uses #id when there is no serviceJobNo, and maps ask→สอบถามราคา", () => {
  const ref = buildAirJobNoteRef({ ...META, serviceJobNo: "", intent: "ask" });
  assert.match(ref, /^สร้างจากงานแอร์: #11/);
  assert.match(ref, /สอบถามราคา/);
});

test("buildAirJobNoteRef falls back when there is no job id at all", () => {
  const ref = buildAirJobNoteRef({ source: "air_job", brand: "TCL", model: "MFS10" });
  assert.equal(ref, "สร้างจากงานแอร์จากแคตตาล็อก");
});

test("buildAirJobNoteRef returns '' for non-air_job sources (air_catalog / null / missing)", () => {
  assert.equal(buildAirJobNoteRef({ source: "air_catalog", brand: "TCL" }), "");
  assert.equal(buildAirJobNoteRef(null), "");
  assert.equal(buildAirJobNoteRef({}), "");
});

// ── appendAirJobNoteRef: preserve + dedup ───────────────────────────────────
test("append injects the reference into an empty note", () => {
  const out = appendAirJobNoteRef("", META);
  assert.match(out, /^สร้างจากงานแอร์: JOB-AIR1/);
});

test("append preserves the user's existing note and adds the reference below it", () => {
  const out = appendAirJobNoteRef("ลูกค้าขอติดตั้งวันเสาร์", META);
  assert.match(out, /^ลูกค้าขอติดตั้งวันเสาร์/);          // user note kept, first
  assert.match(out, /\nสร้างจากงานแอร์: JOB-AIR1/);       // reference appended after
});

test("re-saving (note already has the reference) does NOT duplicate it", () => {
  const once = appendAirJobNoteRef("โน้ตผู้ใช้", META);
  const twice = appendAirJobNoteRef(once, META);          // simulate save-again / edit existing doc
  assert.equal(once, twice);
  assert.equal((twice.match(/สร้างจากงานแอร์/g) || []).length, 1);
});

test("editing an existing air-sourced doc with no draft meta keeps the note as-is", () => {
  const stored = "โน้ตผู้ใช้\nสร้างจากงานแอร์: JOB-AIR1 | สั่งจอง | TCL MFS10 9,000 BTU | ราคาเสนอ 12,900 บาท";
  assert.equal(appendAirJobNoteRef(stored, null), stored);          // no meta on edit path → unchanged
  assert.equal(appendAirJobNoteRef(stored, { source: "air_catalog" }), stored);
});

test("air_catalog draft (build 346) leaves the note untouched (no air_job reference)", () => {
  const out = appendAirJobNoteRef("โน้ตของฉัน", { source: "air_catalog", brand: "TCL", model: "MFS10" });
  assert.equal(out, "โน้ตของฉัน");
  assert.ok(!/สร้างจากงานแอร์/.test(out));
});

// ── wiring: manual save only + reset after save ─────────────────────────────
test("saveQuotationFull builds note via appendAirJobNoteRef(qt_note, _airDraftMeta)", () => {
  assert.match(quo, /note:\s*appendAirJobNoteRef\(document\.getElementById\("qt_note"\)\?\.value\?\.trim\(\)\s*\|\|\s*"",\s*_airDraftMeta\)/);
  // and _airDraftMeta is cleared after a successful save so a second save can't re-append
  assert.match(quo, /_airDraftMeta = null;\s*\/\/ Phase 355/);
});

test("the linkback fires only on manual save — the draft-consume block never saves", () => {
  const block = quo.slice(quo.indexOf("Phase 346: ถ้ามีรายการร่าง"), quo.indexOf("Phase 45.10 (B5-3)"));
  assert.ok(!/saveQuotationFull|xhrPost|_appXhr|appendAirJobNoteRef/.test(block),
    "consuming a draft must not save or inject the reference");
  // manual save button still wired
  assert.match(quo, /getElementById\("qtSaveBtn"\)\?\.addEventListener\("click",\s*saveQuotationFull\)/);
});

// ── guards: no service-job mutation / no stock·POS·cart / no schema change ───
test("quotations.js never mutates the service job (no POST/PATCH to service_jobs, no status change)", () => {
  // service_jobs may only appear as a navigation route (showRoute), never as a write target
  for (const banned of [/xhrPost\(\s*["']service_jobs/, /xhrPatch\(\s*["']service_jobs/, /rest\/v1\/service_jobs/]) {
    assert.ok(!banned.test(quo), `quotation save must not write to service_jobs (${banned})`);
  }
  // back-to-job remains navigation-only (build 354 contract)
  const h = quo.slice(quo.indexOf('"qtBackToJob"'), quo.indexOf('"qtBackToJob"') + 300);
  assert.ok(!/status|xhrPost|_appXhr|saveQuotationFull/.test(h), "back-to-job must stay navigation-only");
});

test("the linkback touches no stock / POS / cart and adds no new column (note is an existing field)", () => {
  for (const banned of [/addToCart/, /saveCustCart/, /_custCart/, /\.stock\s*=/, /from\(["']products["']\)/]) {
    assert.ok(!banned.test(quo), `quotations.js must not reference ${banned}`);
  }
  // payload still writes the SAME note column the form already used — no schema/SQL change
  assert.match(quo, /note:\s*appendAirJobNoteRef/);
});
