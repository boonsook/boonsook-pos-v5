// Phase 350 — service-request air-form polish guard
// Run: node --test tests/service_request_air_form_polish.test.js
//
// Polish (only when an air_catalog draft is present): clearer date field, AI button moved out
// of the main flow, less duplicated text, non-clipping note, and a clear post-submit confirmation.
// Must NOT affect the normal (non-draft) service_request, nor touch stock/POS/cart/quotation.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sreq = fs.readFileSync(path.resolve("modules/service_request.js"), "utf8");

// 1. date field — clear placeholder/hint, not an empty error-looking box
test("date/timeslot fields have clear placeholder + hint (no empty error look)", () => {
  assert.match(sreq, /id="srPrefDate"[^>]*aria-label="เลือกวันที่สะดวก"/);
  assert.match(sreq, /<option value="">เลือกช่วงเวลา \(ไม่ระบุก็ได้\)<\/option>/);
  assert.match(sreq, /ยังไม่ระบุก็ได้ — เจ้าหน้าที่จะติดต่อยืนยันเวลานัดหมาย/);
});

// 2. AI button behaviour — top button ONLY when no draft; secondary when draft
test("AI button is gated: prominent at top only without a draft; secondary when a draft exists", () => {
  // top button is wrapped in a !_isBooking guard
  assert.match(sreq, /\$\{!_isBooking \? `<button id="srAiBtn"[\s\S]*?ลงคิวงาน[\s\S]*?<\/button>` : ''\}/);
  // a secondary AI button exists only in the _isBooking branch (after the submit button)
  assert.match(sreq, /\$\{_isBooking \? `<button id="srAiBtn"[\s\S]*?ช่วยกรอกรายละเอียดแทน[\s\S]*?<\/button>` : ''\}/);
  // handler still binds whichever #srAiBtn renders
  assert.match(sreq, /querySelector\("#srAiBtn"\)\?\.addEventListener\("click",\s*\(\)\s*=>\s*window\.BoonsookAI\?\.open\(\)\)/);
});

// 3. reduced duplication — short description; full info (incl. source marker) goes to note
test("description prefill is SHORT; full model info + source marker live in the note", () => {
  // short symptom: "จองติดตั้ง/สอบถามราคาแอร์ <brand> <model> <btu>"
  assert.match(sreq, /\$\{_isAsk \? 'สอบถามราคา' : 'จองติดตั้ง'\}แอร์ \$\{_booking\.brand\} \$\{_booking\.model\}\$\{btuStr\}/);
  // note keeps the trace marker + price + spec/warranty for staff
  assert.match(sreq, /source=air_catalog/);
  assert.match(sreq, /'ประกัน ' \+ _booking\.warranty/);
  // booking label changes the description field to "รายละเอียดเพิ่มเติม"
  assert.match(sreq, /_isBooking \? 'รายละเอียดเพิ่มเติม \(ถ้ามี\)' : 'อาการเสีย \/ รายละเอียด'/);
});

// 4. note field is a textarea (auto-grow / min-height) — no clipping
test("note field is a textarea with min-height (does not clip long text)", () => {
  assert.match(sreq, /<textarea id="srNote"[^>]*min-height:56px/);
  assert.ok(!/<input type="text" id="srNote"/.test(sreq), "note must no longer be a single-line input");
});

// 5. confirmation after submit
test("post-submit confirmation is clear and offers 'ดูงานของฉัน'", () => {
  assert.match(sreq, /ส่งคำขอแล้ว!/);
  assert.match(sreq, /เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันราคาและเวลานัดหมาย/);
  assert.match(sreq, /id="srViewJobs"/);
  assert.match(sreq, /srViewJobs"\)\?\.addEventListener\("click"[\s\S]*?showRoute\("customer_dashboard"\)/);
});

// 6. submit endpoint unchanged + no stock/cart/POS/quotation mutation
test("submit endpoint + flow unchanged; no stock/cart/POS/quotation", () => {
  assert.match(sreq, /\/rest\/v1\/service_jobs/);
  assert.match(sreq, /status:\s*"pending"/);
  for (const banned of [/addToCart/, /saveCustCart/, /_custCart/, /\.stock\s*=/, /quotation/i, /from\(["']products["']\)/]) {
    assert.ok(!banned.test(sreq), `service_request must not reference ${banned}`);
  }
});

// 7. normal (non-draft) service_request keeps the prominent AI button + original labels
test("normal service_request (no draft) is unaffected", () => {
  // default heading + submit label still present for the no-draft branch
  assert.match(sreq, /"🛠️ แจ้งซ่อม \/ บริการ"/);
  assert.match(sreq, /"📨 ส่งคำแจ้งซ่อม"/);
  // top AI button text is the original full label (rendered when !_isBooking)
  assert.match(sreq, /🤖 AI ช่วยแจ้งงาน \/ ลงคิวงาน/);
});
