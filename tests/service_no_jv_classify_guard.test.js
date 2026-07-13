// Phase 604 (S4.1b) — service NO_JV classification guard
//
// classifier เป็น read-only "หลักฐาน" ที่ owner จะใช้ตัดสินใจสร้าง JV/แก้สต็อกย้อนหลังใน S4.1c
// → จำแนกผิด = ลงรายได้ซ้ำ/ผิดงวด หรือแก้สต็อกผิด. guard นี้ล็อก 3 อย่าง:
//   (a) pure taxonomy ถูกต้องต่อ fixture (accounting / recognition-date / stock แยกอิสระกัน)
//   (b) source-regex: runner ต้อง read-only จริง (POST เฉพาะ auth), ไม่ select deleted_at, paginate,
//       ไม่ print PII/credential, ไม่มี recovery code
//   (c) mapping key ไม่ drift จาก auto_post.js (writer จริง)
//
// ★ ห้าม hardcode "6 งาน / 6,950" เป็น business rule ในเทสต์ — baseline production เปลี่ยนได้
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  parseItemsJson,
  partitionStockItems,
  matchJobMovements,
  outNoteMarker,
  returnNoteMarker,
  serviceMappingKeyForJobTypeAudit,
  SERVICE_JOB_TYPE_KEY_MAP_AUDIT,
  classifyJournalEvidence,
  classifyStockEvidence,
  classifyRecognitionDate,
  classifyServiceNoJvCandidate,
  isServiceIncomeCandidate,
  preliminaryBasisDateForScoping,
  isServiceJobDeletedOrCancelled,
  summarizeClassification,
} from "../scripts/service_no_jv_classify_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, "..", p), "utf8");
const RUNNER = read("scripts/service_no_jv_classify.js");
// negative source-check ต้องดู "โค้ดจริง" ไม่ใช่คอมเมนต์ (คอมเมนต์อธิบายข้อห้ามไว้ เช่น "ห้าม Prefer:resolution")
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "")).join("\n");
const RUNNER_CODE = stripComments(RUNNER);
const LIB = read("scripts/service_no_jv_classify_lib.js");
const AUTO_POST = read("modules/accounting/auto_post.js");
const SERVICE_EQUIP = read("modules/service_equipment.js");
const PKG = JSON.parse(read("package.json"));

const MAPPING_OK = new Set(["service_repair_ac", "service_install_ac", "service_solar", "service_other", "service_cctv"]);
const job = (o = {}) => ({
  id: 1, job_no: "JOB-100", job_type: "repair_ac", status: "closed",
  created_at: "2026-07-02T03:00:00Z", closed_at: "2026-07-05T04:00:00Z",
  total_cost: 1000, payment_method: "cash", note: "", items_json: [],
  stock_deducted_at: null, stock_reverted_at: null, ...o
});
const je = (o = {}) => ({ id: 900, source_table: "service_jobs", source_id: 1, status: "approved", doc_date: "2026-07-05", total_debit: 1000, ...o });
const linesFor = (id, rev) => new Map([[String(id), [{ account_code: "4210", debit: 0, credit: rev }, { account_code: "1110", debit: rev, credit: 0 }]]]);

// ═══ 1. recognition date ═══════════════════════════════════
test("1. closed_at null → OWNER_RECOGNITION_DATE_REQUIRED (ห้าม fallback created_at)", () => {
  const r = classifyRecognitionDate(job({ closed_at: null }));
  assert.equal(r.recognitionDecision, "OWNER_RECOGNITION_DATE_REQUIRED");
  assert.equal(r.closedBkk, null);
  assert.equal(r.ownerRecognitionDate, "PENDING_OWNER");
  assert.equal(r.blocked, true);
  // created_at ต้องไม่ถูกยกเป็นวันรับรู้
  assert.notEqual(r.recognitionDateSource, "SYSTEM_CREATED_AT");

  const c = classifyServiceNoJvCandidate({ job: job({ closed_at: null }), entries: [], validMappingKeys: MAPPING_OK });
  assert.ok(c.blockers.includes("OWNER_RECOGNITION_DATE_REQUIRED"));
  assert.equal(c.readiness.journalRecoveryEligible, false);
  assert.equal(c.readiness.overallS41cReady, false);
});

test("1b. closed_at มีค่า → เป็น evidence แต่ยังต้องให้ owner ยืนยัน (ไม่ auto-approve)", () => {
  const r = classifyRecognitionDate(job());
  assert.equal(r.recognitionDateSource, "SYSTEM_CLOSED_AT");
  assert.equal(r.recognitionDecision, "SYSTEM_CLOSED_AT_EVIDENCE_OWNER_TO_CONFIRM");
  assert.equal(r.ownerRecognitionDate, "PENDING_OWNER");
  assert.equal(r.blocked, false);
});

// ═══ 2-6. journal taxonomy ═════════════════════════════════
test("2. ไม่มี JE ผูก source → NO_APPROVED_JV (journal track พร้อม แต่ overall ยังไม่พร้อม)", () => {
  const c = classifyServiceNoJvCandidate({ job: job(), entries: [], validMappingKeys: MAPPING_OK });
  assert.equal(c.journal.verdict, "NO_APPROVED_JV");
  assert.deepEqual(c.blockers, []);
  assert.equal(c.readiness.journalRecoveryEligible, true);
  // ★ review fix: closed_at เป็นหลักฐานของระบบ — owner ยังไม่ยืนยัน → overall ยังไม่พร้อม
  assert.equal(c.readiness.ownerConfirmationPending, true);
  assert.equal(c.readiness.overallS41cReady, false);
});

test("3. approved JV ตรงยอด/ตรงวัน → APPROVED_JV_PRESENT (ไม่ใช่เคส recovery)", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je()], linesByEntry: linesFor(900, 1000), validMappingKeys: MAPPING_OK });
  assert.equal(r.verdict, "APPROVED_JV_PRESENT");
  assert.equal(r.detail.glRevenue, 1000);
  assert.equal(r.detail.delta, 0);
});

test("4. approved JV ยอดไม่ตรง → JV_AMOUNT_MISMATCH (+delta)", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je()], linesByEntry: linesFor(900, 400), validMappingKeys: MAPPING_OK });
  assert.equal(r.verdict, "JV_AMOUNT_MISMATCH");
  assert.equal(r.detail.delta, 600);
  assert.ok(r.blockers.includes("JV_AMOUNT_MISMATCH"));
});

test("4b. approved JV วันไม่ตรง closed_at → JV_DATE_MISMATCH", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je({ doc_date: "2026-07-09" })], linesByEntry: linesFor(900, 1000), validMappingKeys: MAPPING_OK });
  assert.equal(r.verdict, "JV_DATE_MISMATCH");
});

test("5. มีแต่ JE non-approved ผูก source → SOURCE_BOUND_NON_APPROVED (ห้ามโพสต์ทับ)", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je({ status: "draft" })], validMappingKeys: MAPPING_OK });
  assert.equal(r.verdict, "SOURCE_BOUND_NON_APPROVED");
  assert.equal(r.detail.nonApprovedCount, 1);
  assert.ok(r.blockers.includes("SOURCE_BOUND_NON_APPROVED_JV"));
});

test("6. approved JV > 1 ใบ → DUPLICATE_SOURCE_JV (ไม่กลืน duplicate)", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je(), je({ id: 901 })], linesByEntry: linesFor(900, 1000), validMappingKeys: MAPPING_OK });
  assert.equal(r.verdict, "DUPLICATE_SOURCE_JV");
  assert.equal(r.detail.approvedCount, 2);
  assert.deepEqual(r.detail.entryIds, [900, 901]);
});

test("6b. approved + non-approved อยู่ด้วยกัน → conflict blocker", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je(), je({ id: 902, status: "void" })], linesByEntry: linesFor(900, 1000), validMappingKeys: MAPPING_OK });
  assert.ok(r.blockers.includes("APPROVED_AND_NON_APPROVED_JV_COEXIST"));
});

test("7. JE header มีแต่ไม่มี lines → DATA_INCOMPLETE (ห้ามอ่านเป็นรายได้ 0)", () => {
  const r = classifyJournalEvidence({ job: job(), entries: [je()], linesByEntry: new Map(), validMappingKeys: MAPPING_OK });
  assert.equal(r.verdict, "DATA_INCOMPLETE");
  assert.ok(r.blockers.includes("JE_LINES_MISSING"));
});

test("8. mapping ไม่ active/ไม่ครบ → CURRENT_MAPPING_MISSING blocker (ยังโพสต์ไม่ได้)", () => {
  const c = classifyServiceNoJvCandidate({ job: job({ job_type: "cctv" }), entries: [], validMappingKeys: new Set(["service_repair_ac"]) });
  assert.equal(c.journal.detail.mappingKey, "service_cctv");
  assert.equal(c.journal.detail.mappingStatus, "MISSING_OR_INCOMPLETE");
  assert.ok(c.blockers.includes("CURRENT_MAPPING_MISSING"));
  assert.equal(c.readiness.journalRecoveryEligible, false);
  // ไม่ส่ง validMappingKeys → UNCHECKED (ไม่กล่าวหาว่า mapping หาย)
  assert.equal(classifyJournalEvidence({ job: job(), entries: [] }).detail.mappingStatus, "UNCHECKED");
});

test("9. cancelled / [ลบแล้ว] → DELETED_OR_CANCELLED (ห้าม recover) + ไม่ใช่ candidate", () => {
  for (const j of [job({ status: "cancelled" }), job({ note: "งานนี้ [ลบแล้ว]" })]) {
    assert.equal(isServiceJobDeletedOrCancelled(j), true);
    assert.equal(isServiceIncomeCandidate(j), false);
    assert.equal(classifyJournalEvidence({ job: j, entries: [], validMappingKeys: MAPPING_OK }).verdict, "DELETED_OR_CANCELLED");
  }
});

test("10. total_cost null ≠ 0 (INVALID_AMOUNT vs ZERO_AMOUNT_NOT_CANDIDATE)", () => {
  const nul = classifyJournalEvidence({ job: job({ total_cost: null }), entries: [], validMappingKeys: MAPPING_OK });
  assert.equal(nul.verdict, "INVALID_AMOUNT");
  assert.ok(nul.blockers.includes("INVALID_AMOUNT"));
  const zero = classifyJournalEvidence({ job: job({ total_cost: 0 }), entries: [], validMappingKeys: MAPPING_OK });
  assert.equal(zero.verdict, "ZERO_AMOUNT_NOT_CANDIDATE");
  assert.equal(isServiceIncomeCandidate(job({ total_cost: 0 })), false);
});

test("10c. candidate scoping ต้องตรง S4.0: pre-effective (basis closed_at||created_at) = expected-unposted ไม่ใช่ NO_JV", () => {
  const eff = "2026-07-01";
  // ปิดงานก่อน effective → S4.0 ไม่นับเป็น NO_JV → ไม่ใช่ candidate
  assert.equal(isServiceIncomeCandidate(job({ closed_at: "2026-06-20T04:00:00Z" }), eff), false);
  // ไม่มี closed_at + สร้างก่อน effective → basis = created_at (scoping เท่านั้น) → ไม่ใช่ candidate
  assert.equal(isServiceIncomeCandidate(job({ created_at: "2026-06-17T04:00:00Z", closed_at: null }), eff), false);
  // post-effective → เป็น candidate
  assert.equal(isServiceIncomeCandidate(job({ created_at: "2026-07-08T04:00:00Z", closed_at: null }), eff), true);
  assert.equal(preliminaryBasisDateForScoping(job({ closed_at: null, created_at: "2026-07-08T04:00:00Z" })), "2026-07-08");
  // ★ แต่ basis ที่ใช้ scoping ต้องไม่รั่วไปเป็นวันรับรู้รายได้
  const c = classifyServiceNoJvCandidate({ job: job({ created_at: "2026-07-08T04:00:00Z", closed_at: null }), entries: [], validMappingKeys: MAPPING_OK });
  assert.equal(c.recognition.recognitionDecision, "OWNER_RECOGNITION_DATE_REQUIRED");
  assert.equal(c.recognition.ownerRecognitionDate, "PENDING_OWNER");
  assert.equal(c.readiness.journalRecoveryEligible, false);
});

test("10b. pre-effective (ตาม closed_at) → PRE_EFFECTIVE_REVIEW blocker", () => {
  const r = classifyJournalEvidence({ job: job({ closed_at: "2026-06-20T04:00:00Z" }), entries: [], validMappingKeys: MAPPING_OK, effective: "2026-07-01" });
  assert.ok(r.blockers.includes("PRE_EFFECTIVE_REVIEW"));
});

// ═══ 11-20. stock ═════════════════════════════════════════
test("11. items_json: array / JSON string / malformed", () => {
  assert.deepEqual(parseItemsJson([{ product_id: 1 }]), { state: "PARSED", items: [{ product_id: 1 }] });
  assert.equal(parseItemsJson('[{"product_id":1,"qty":2}]').state, "PARSED");
  assert.equal(parseItemsJson('[{"product_id"').state, "MALFORMED");
  assert.equal(parseItemsJson('{"not":"array"}').state, "MALFORMED");
  assert.equal(parseItemsJson(null).state, "EMPTY");
  assert.equal(parseItemsJson("").state, "EMPTY");
});

test("11b. items_json พัง → STOCK_UNVERIFIABLE (ไม่เดาว่าไม่ต้องตัด)", () => {
  const s = classifyStockEvidence({ job: job({ items_json: "{{bad" }) });
  assert.equal(s.verdict, "STOCK_UNVERIFIABLE");
  assert.ok(s.flags.includes("ITEMS_JSON_MALFORMED"));
});

test("12. ไม่มี stockable item (ว่าง / service / non_stock) → STOCK_NOT_REQUIRED", () => {
  const empty = classifyStockEvidence({ job: job({ items_json: [] }) });
  assert.equal(empty.verdict, "STOCK_NOT_REQUIRED");
  const pm = new Map([["7", { id: 7, product_type: "service" }], ["8", { id: 8, product_type: "non_stock" }]]);
  const svc = classifyStockEvidence({
    job: job({ items_json: [{ product_id: 7, qty: 1, warehouse_id: 2 }, { product_id: 8, qty: 3, warehouse_id: 2 }] }),
    productMap: pm
  });
  assert.equal(svc.verdict, "STOCK_NOT_REQUIRED");
  assert.equal(svc.expected.nonStockItemCount, 2);
  assert.equal(svc.expected.stockableItemCount, 0);
});

const PM = new Map([["5", { id: 5, product_type: "stock" }], ["6", { id: 6, product_type: null }]]);
const ITEMS = [{ product_id: 5, qty: 2, warehouse_id: 1 }, { product_id: 6, qty: 1, warehouse_id: 1 }];
const mv = (o = {}) => ({ id: 1, product_id: 5, type: "out", qty: 2, note: `${outNoteMarker("JOB-100")} ลูกค้า | 10→8`, created_at: "2026-07-05T05:00:00Z", ...o });

test("13. marker null + ไม่พบ movement ที่ตรง → STOCK_NO_CLAIM_NO_MOVEMENT_EVIDENCE (ไม่ใช่ 'ไม่ได้ตัด')", () => {
  const s = classifyStockEvidence({ job: job({ items_json: ITEMS }), productMap: PM, movements: [] });
  assert.equal(s.verdict, "STOCK_NO_CLAIM_NO_MOVEMENT_EVIDENCE");
  assert.ok(s.flags.includes("NO_DEDUCT_CLAIM_AND_NO_MOVEMENT_EVIDENCE"));
  // ห้ามมีคำที่ประกาศว่าไม่ได้ตัดแน่นอน
  assert.ok(!/NOT_DEDUCTED|NO_DEDUCT_CONFIRMED/.test(s.verdict));
});

test("14. marker + qty ครบทุก product → QTY_EVIDENCE_PRESENT + ยังต้อง WAREHOUSE_UNVERIFIABLE (ห้าม FULLY_VERIFIED)", () => {
  const s = classifyStockEvidence({
    job: job({ items_json: ITEMS, stock_deducted_at: "2026-07-05T05:00:00Z" }),
    productMap: PM,
    movements: [mv(), mv({ id: 2, product_id: 6, qty: 1, note: `${outNoteMarker("JOB-100")} ลูกค้า | 4→3` })]
  });
  assert.equal(s.verdict, "STOCK_QTY_EVIDENCE_PRESENT_WAREHOUSE_UNVERIFIABLE");
  assert.ok(s.flags.includes("WAREHOUSE_UNVERIFIABLE"));
  assert.ok(!/STOCK_FULLY_VERIFIED/.test(JSON.stringify(s)));
  assert.ok(!/STOCK_FULLY_VERIFIED/.test(LIB), "lib ต้องไม่มี verdict STOCK_FULLY_VERIFIED (movement ไม่มี warehouse_id)");
});

test("15. marker + qty ไม่ครบ → STOCK_PARTIAL_OR_LOG_INCOMPLETE (ห้ามสรุปว่าตัดไม่ครบแน่นอน)", () => {
  const s = classifyStockEvidence({
    job: job({ items_json: ITEMS, stock_deducted_at: "2026-07-05T05:00:00Z" }),
    productMap: PM,
    movements: [mv({ qty: 1 })]   // ควร 2 แต่มี 1 + product 6 ไม่มี movement
  });
  assert.equal(s.verdict, "STOCK_PARTIAL_OR_LOG_INCOMPLETE");
  assert.ok(s.flags.includes("QTY_EVIDENCE_INCOMPLETE_OR_LOG_GAP"));
});

test("15b. marker มี แต่ไม่มี movement เลย → STOCK_MARKER_MOVEMENT_CONFLICT", () => {
  const s = classifyStockEvidence({ job: job({ items_json: ITEMS, stock_deducted_at: "2026-07-05T05:00:00Z" }), productMap: PM, movements: [] });
  assert.equal(s.verdict, "STOCK_MARKER_MOVEMENT_CONFLICT");
  assert.ok(s.flags.includes("DEDUCT_CLAIM_WITHOUT_MOVEMENT_EVIDENCE"));
});

test("16. movement มี แต่ marker null → STOCK_MOVEMENT_WITHOUT_MARKER (marker drift/legacy)", () => {
  const s = classifyStockEvidence({ job: job({ items_json: ITEMS }), productMap: PM, movements: [mv()] });
  assert.equal(s.verdict, "STOCK_MOVEMENT_WITHOUT_MARKER");
  assert.ok(s.flags.includes("MOVEMENT_PRESENT_WITHOUT_DEDUCT_CLAIM"));
});

test("17. stock_reverted_at / return movement บนงานรายได้ → STOCK_REVERTED_CONFLICT", () => {
  const a = classifyStockEvidence({ job: job({ items_json: ITEMS, stock_deducted_at: "x", stock_reverted_at: "2026-07-06T00:00:00Z" }), productMap: PM, movements: [mv()] });
  assert.equal(a.verdict, "STOCK_REVERTED_CONFLICT");
  const b = classifyStockEvidence({
    job: job({ items_json: ITEMS, stock_deducted_at: "x" }), productMap: PM,
    movements: [mv(), { id: 9, product_id: 5, type: "return", qty: 2, note: `${returnNoteMarker("JOB-100")} | 8→10` }]
  });
  assert.equal(b.verdict, "STOCK_REVERTED_CONFLICT");
});

test("18. item ขาด product_id/warehouse_id/qty หรือไม่มี product metadata → STOCK_UNVERIFIABLE", () => {
  const s = classifyStockEvidence({ job: job({ items_json: [{ name: "x", qty: 1 }] }), productMap: PM });
  assert.equal(s.verdict, "STOCK_UNVERIFIABLE");
  assert.ok(s.flags.includes("ITEM_MISSING_PRODUCT_WAREHOUSE_OR_QTY"));
  const noMeta = classifyStockEvidence({ job: job({ items_json: [{ product_id: 999, qty: 1, warehouse_id: 1 }] }), productMap: PM });
  assert.equal(noMeta.verdict, "STOCK_UNVERIFIABLE");
  assert.ok(noMeta.flags.includes("PRODUCT_METADATA_MISSING"));
  // qty ใช้ไม่ได้ (0 / null / ติดลบ) ต้องไม่ถูกกลืนเป็นตัดครบ
  const badQty = partitionStockItems([{ product_id: 5, qty: 0, warehouse_id: 1 }, { product_id: 5, qty: null, warehouse_id: 1 }], PM);
  assert.equal(badQty.stockable.length, 0);
  assert.equal(badQty.unusable.length, 2);
});

test("19. fuzzy job_no collision ต้องไม่ match (JOB-1 ไม่ใช่หลักฐานของ JOB-10)", () => {
  const movements = [
    { id: 1, product_id: 5, type: "out", qty: 2, note: `งานช่าง: JOB-1000 — ลูกค้า | 10→8` },   // งานอื่น (prefix ชน)
    { id: 2, product_id: 5, type: "out", qty: 9, note: "อ้างถึง JOB-100 ในข้อความอื่น" }         // substring เฉย ๆ
  ];
  const m = matchJobMovements(movements, "JOB-100");
  assert.equal(m.outs.length, 0, "ห้ามจับ movement ของงานอื่นที่ job_no เป็น prefix");
  assert.equal(m.outQtyByProduct.size, 0, "qty ของงานอื่นต้องไม่รั่วเข้ามา");
  assert.equal(m.fuzzy.length, 2, "note ที่มีเลขงานแต่ไม่ตรง marker (รวม prefix ชน) = fuzzy ทั้งคู่ ไม่ใช่หลักฐาน");
  const s = classifyStockEvidence({ job: job({ items_json: ITEMS }), productMap: PM, movements });
  assert.equal(s.verdict, "STOCK_NO_CLAIM_NO_MOVEMENT_EVIDENCE");
  assert.ok(s.flags.includes("FUZZY_MOVEMENT_IGNORED"));
});

test("20. movement ต้องรวม qty ไม่ใช่นับจำนวน rows", () => {
  const movements = [mv({ id: 1, qty: 1 }), mv({ id: 2, qty: 1 })];   // 2 rows = qty 2
  const m = matchJobMovements(movements, "JOB-100");
  assert.equal(m.outs.length, 2);
  assert.equal(m.outQtyByProduct.get("5"), 2);
  const s = classifyStockEvidence({
    job: job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }], stock_deducted_at: "x" }),
    productMap: PM, movements
  });
  assert.equal(s.verdict, "STOCK_QTY_EVIDENCE_PRESENT_WAREHOUSE_UNVERIFIABLE");
  // 2 rows แต่ qty รวม 1 = ยังไม่ครบ (พิสูจน์ว่านับ rows ไม่ได้)
  const short = classifyStockEvidence({
    job: job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }], stock_deducted_at: "x" }),
    productMap: PM, movements: [mv({ id: 1, qty: 0.5 }), mv({ id: 2, qty: 0.5 })]
  });
  assert.equal(short.verdict, "STOCK_PARTIAL_OR_LOG_INCOMPLETE");
});

test("20b. movements fetch ถูกตัด → STOCK_DATA_INCOMPLETE (ห้าม fallback เป็นศูนย์)", () => {
  const s = classifyStockEvidence({ job: job({ items_json: ITEMS }), productMap: PM, movements: [], dataIncomplete: true });
  assert.equal(s.verdict, "STOCK_DATA_INCOMPLETE");
});

// ═══ 21. partition ═════════════════════════════════════════
test("21. partition: ทุก candidate ถูกนับใน journal + stock taxonomy อย่างละครั้ง (ไม่ตกหล่น/ซ้ำ)", () => {
  const rows = [
    classifyServiceNoJvCandidate({ job: job({ id: 1, job_no: "JOB-1" }), entries: [], validMappingKeys: MAPPING_OK }),
    classifyServiceNoJvCandidate({ job: job({ id: 2, job_no: "JOB-2", closed_at: null }), entries: [], validMappingKeys: MAPPING_OK }),
    classifyServiceNoJvCandidate({ job: job({ id: 3, job_no: "JOB-3", items_json: ITEMS, stock_deducted_at: "x" }), entries: [], validMappingKeys: MAPPING_OK, productMap: PM, movements: [] }),
  ];
  const s = summarizeClassification(rows);
  assert.equal(s.candidateCount, 3);
  assert.equal(s.candidateAmount, 3000);
  assert.equal(s.journalSum, 3);
  assert.equal(s.stockSum, 3);
  assert.equal(s.partitionOk, true);
  // JOB-1 + JOB-3 journal-eligible (JOB-3 สต็อกยัง conflict แต่ไม่ gate ฝั่งบัญชี) · JOB-2 ติดวันรับรู้รายได้
  assert.equal(s.journalEligibleCount, 2);
  assert.equal(s.overallReadyCount, 0, "ไม่มีงานไหน overall-ready (owner ยังไม่ยืนยันวัน + stock ค้าง)");
  assert.equal(s.blockerCounts.OWNER_RECOGNITION_DATE_REQUIRED, 1);
  assert.equal(s.stockCounts.STOCK_MARKER_MOVEMENT_CONFLICT, 1);
});

test("21b. readiness แยก 3 ระดับ: journal พร้อม ≠ overall พร้อม (stock ยังต้องตรวจ)", () => {
  const c = classifyServiceNoJvCandidate({
    job: job({ items_json: "{{bad" }), entries: [], validMappingKeys: MAPPING_OK
  });
  assert.equal(c.journal.verdict, "NO_APPROVED_JV");
  assert.equal(c.stock.verdict, "STOCK_UNVERIFIABLE");
  assert.equal(c.readiness.journalRecoveryEligible, true, "สต็อกไม่ gate การตัดสินใจฝั่งบัญชี (แยก track)");
  assert.equal(c.readiness.stockReviewRequired, true);
  assert.equal(c.readiness.overallS41cReady, false, "stock ยัง unresolved → overall ต้องไม่พร้อม");
  assert.match(c.readiness.reason, /stock ต้องตรวจ/);
});

// ═══ review follow-up fixtures (PR #189 — 5 กรณีที่ reviewer สั่ง) ═══════════
test("R1. Blocking#1: overall/strict ต้องแดงเมื่อ stock ยัง unresolved แม้ journal พร้อม", () => {
  // qty ตรงครบ + marker ครบ → ยัง WAREHOUSE_UNVERIFIABLE (movement ไม่มี warehouse_id) = stock review required
  const c = classifyServiceNoJvCandidate({
    job: job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }], stock_deducted_at: "2026-07-05T05:00:00Z" }),
    entries: [], validMappingKeys: MAPPING_OK, productMap: PM, movements: [mv({ qty: 2 })]
  });
  assert.equal(c.stock.verdict, "STOCK_QTY_EVIDENCE_PRESENT_WAREHOUSE_UNVERIFIABLE");
  assert.equal(c.readiness.journalRecoveryEligible, true);
  assert.equal(c.readiness.stockReviewRequired, true, "WAREHOUSE_UNVERIFIABLE ต้องยังนับเป็น stock review");
  assert.equal(c.readiness.overallS41cReady, false);
  // สต็อกที่ 'clear' จริงมีแค่ STOCK_NOT_REQUIRED ที่ไม่มี flag
  const clean = classifyServiceNoJvCandidate({ job: job({ items_json: [] }), entries: [], validMappingKeys: MAPPING_OK });
  assert.equal(clean.readiness.stockReviewRequired, false);
  assert.equal(clean.readiness.overallS41cReady, false, "แต่ owner ยังไม่ยืนยันวัน → overall ยังไม่พร้อม");
});

test("R2. Blocking#2: mixed valid + unusable/missing-meta items ห้ามประกาศว่า qty evidence ครบ", () => {
  // item A ถูกต้อง + movement ตรง · item B ขาด warehouse_id
  const mixedWarehouse = classifyStockEvidence({
    job: job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }, { product_id: 6, qty: 1 }], stock_deducted_at: "x" }),
    productMap: PM, movements: [mv({ qty: 2 })]
  });
  assert.equal(mixedWarehouse.verdict, "STOCK_PARTIAL_EXPECTATION_UNVERIFIABLE");
  assert.ok(mixedWarehouse.flags.includes("ITEM_MISSING_PRODUCT_WAREHOUSE_OR_QTY"));
  assert.ok(mixedWarehouse.flags.includes("PARTIAL_EXPECTATION_UNVERIFIABLE"));
  assert.notEqual(mixedWarehouse.verdict, "STOCK_QTY_EVIDENCE_PRESENT_WAREHOUSE_UNVERIFIABLE");
  // item B ไม่มี product metadata → เหมือนกัน
  const mixedMeta = classifyStockEvidence({
    job: job({ items_json: [{ product_id: 5, qty: 2, warehouse_id: 1 }, { product_id: 999, qty: 1, warehouse_id: 1 }], stock_deducted_at: "x" }),
    productMap: PM, movements: [mv({ qty: 2 })]
  });
  assert.equal(mixedMeta.verdict, "STOCK_PARTIAL_EXPECTATION_UNVERIFIABLE");
  assert.ok(mixedMeta.flags.includes("PRODUCT_METADATA_MISSING"));
});

test("R3. Should-fix: closed_at มีค่า แต่ owner ยังไม่ยืนยัน → PENDING_OWNER = overall ไม่พร้อม", () => {
  const c = classifyServiceNoJvCandidate({ job: job(), entries: [], validMappingKeys: MAPPING_OK });
  assert.equal(c.recognition.ownerRecognitionDate, "PENDING_OWNER");
  assert.equal(c.readiness.ownerConfirmationPending, true);
  assert.equal(c.readiness.overallS41cReady, false);
  assert.match(c.readiness.reason, /owner ยังไม่ยืนยันวันรับรู้รายได้/);
});

test("R4. Should-fix: ไม่มี stockable item แต่มี deduct claim/marker → conflict (ไม่ใช่ NOT_REQUIRED)", () => {
  const byColumn = classifyStockEvidence({ job: job({ items_json: [], stock_deducted_at: "2026-07-05T05:00:00Z" }), productMap: PM });
  assert.equal(byColumn.verdict, "STOCK_MARKER_MOVEMENT_CONFLICT");
  assert.ok(byColumn.flags.includes("DEDUCT_CLAIM_WITHOUT_EXPECTED_ITEMS"));
  const byNote = classifyStockEvidence({ job: job({ items_json: [], note: "งานเสร็จ [ตัดสต็อกแล้ว]" }), productMap: PM });
  assert.equal(byNote.verdict, "STOCK_MARKER_MOVEMENT_CONFLICT");
  const reverted = classifyStockEvidence({ job: job({ items_json: [], stock_reverted_at: "2026-07-06T00:00:00Z" }), productMap: PM });
  assert.equal(reverted.verdict, "STOCK_REVERTED_CONFLICT");
});

test("R5. summarize นับ readiness แยกกัน (journal / stock / owner / overall)", () => {
  const rows = [
    classifyServiceNoJvCandidate({ job: job({ id: 1, job_no: "JOB-1" }), entries: [], validMappingKeys: MAPPING_OK }),
    classifyServiceNoJvCandidate({ job: job({ id: 2, job_no: "JOB-2", closed_at: null }), entries: [], validMappingKeys: MAPPING_OK }),
    classifyServiceNoJvCandidate({ job: job({ id: 3, job_no: "JOB-3", items_json: ITEMS, stock_deducted_at: "x" }), entries: [], validMappingKeys: MAPPING_OK, productMap: PM, movements: [] }),
  ];
  const s = summarizeClassification(rows);
  assert.equal(s.journalEligibleCount, 2);
  assert.equal(s.stockReviewRequiredCount, 1);
  assert.equal(s.ownerConfirmationPendingCount, 3);
  assert.equal(s.overallReadyCount, 0);
});

test("R6. strict gate ใน runner ต้อง gate ด้วย overall/stock/owner ไม่ใช่ journal อย่างเดียว", () => {
  const strict = RUNNER_CODE.slice(RUNNER_CODE.indexOf("const notOverallReady"), RUNNER_CODE.indexOf("main().then"));
  assert.match(strict, /readiness\.overallS41cReady/, "strict ต้อง gate ด้วย overallS41cReady");
  assert.match(strict, /readiness\.stockReviewRequired/, "strict ต้องนับ stock review");
  assert.match(strict, /readiness\.ownerConfirmationPending/, "strict ต้องนับ owner confirmation");
  assert.ok(!/eligibleForS41c/.test(RUNNER_CODE), "ต้องไม่เหลือ gate เดิมที่ดูแค่ฝั่ง journal");
  assert.ok(!/eligibleForS41c/.test(LIB), "lib ต้องเลิก export flag รวมที่กำกวม (ใช้ readiness แทน)");
});

// ═══ 22. mapping drift vs auto_post (writer จริง) ═══════════
test("22. service mapping map ต้องตรงกับ SERVICE_JOB_TYPE_KEY_MAP ใน auto_post.js", () => {
  const block = AUTO_POST.slice(AUTO_POST.indexOf("const SERVICE_JOB_TYPE_KEY_MAP"), AUTO_POST.indexOf("export function serviceMappingKeyForJobType"));
  assert.ok(block.length > 0, "ต้องหา SERVICE_JOB_TYPE_KEY_MAP ใน auto_post.js ได้");
  const pairs = [...block.matchAll(/(\w+)\s*:\s*"([\w_]+)"/g)].map(m => [m[1], m[2]]);
  assert.ok(pairs.length >= 12, "ต้อง parse mapping จาก auto_post ได้ครบ");
  for (const [k, v] of pairs) {
    assert.equal(SERVICE_JOB_TYPE_KEY_MAP_AUDIT[k], v, `mapping drift: auto_post ${k} → ${v}`);
  }
  assert.equal(Object.keys(SERVICE_JOB_TYPE_KEY_MAP_AUDIT).length, pairs.length, "จำนวน key ต้องเท่า auto_post (ไม่ขาด/ไม่เกิน)");
  // fallback เดียวกับ writer
  assert.equal(serviceMappingKeyForJobTypeAudit("ไม่รู้จัก"), "service_other");
  assert.equal(serviceMappingKeyForJobTypeAudit(null), "service_other");
  assert.ok(/\|\|\s*"service_other"/.test(AUTO_POST.slice(AUTO_POST.indexOf("export function serviceMappingKeyForJobType"), AUTO_POST.indexOf("export function serviceMappingKeyForJobType") + 300)));
});

test("22b. movement note marker ต้องตรงกับที่ writer เขียนจริง (service_equipment.js)", () => {
  assert.ok(SERVICE_EQUIP.includes("note: `งานช่าง: ${jobNo || \"-\"} — ${customerName || \"\"}`"),
    "out note format ใน service_equipment.js เปลี่ยน → ต้องอัปเดต outNoteMarker");
  assert.ok(SERVICE_EQUIP.includes("note: `คืนอุปกรณ์งานช่าง ${job.job_no || \"\"} (ยกเลิก)`"),
    "return note format เปลี่ยน → ต้องอัปเดต returnNoteMarker");
  assert.equal(outNoteMarker("JOB-9"), "งานช่าง: JOB-9 —");
  assert.equal(returnNoteMarker("JOB-9"), "คืนอุปกรณ์งานช่าง JOB-9 (ยกเลิก)");
  // marker ระดับงาน (claim) ที่ writer ใช้ — lib ต้องอ่านคอลัมน์เดียวกัน
  assert.ok(SERVICE_EQUIP.includes("stock_deducted_at") && SERVICE_EQUIP.includes("stock_reverted_at"));
});

// ═══ 23-27. runner source guards (extract block — ไม่ grep กว้าง) ═══
test("23. runner ต้องไม่ select service_jobs.deleted_at (production ไม่มีคอลัมน์นี้)", () => {
  const sel = RUNNER.match(/const SJ_SELECT = "([^"]+)"/);
  assert.ok(sel, "ต้องมี SJ_SELECT");
  const cols = sel[1].split(",");
  assert.ok(!cols.includes("deleted_at"), "ห้าม select deleted_at");
  for (const need of ["id", "job_no", "job_type", "status", "created_at", "closed_at", "total_cost", "payment_method", "sub_service", "note", "items_json", "stock_deducted_at", "stock_reverted_at"]) {
    assert.ok(cols.includes(need), `SJ_SELECT ต้องมี ${need}`);
  }
  // PII ที่ไม่จำเป็น ห้าม select
  for (const pii of ["customer_name", "customer_phone", "customer_address", "payment_slip_url"]) {
    assert.ok(!cols.includes(pii), `ห้าม select ${pii} (PII เกินจำเป็น)`);
  }
});

test("24. runner ดึง stock_movements แบบ paginate + ยอมรับสถานะ incomplete (ไม่ fallback ศูนย์)", () => {
  const fn = RUNNER.slice(RUNNER.indexOf("async function getAllChecked"), RUNNER.indexOf("async function getAll(token"));
  assert.match(fn, /offset\s*\+=\s*PAGE/, "ต้อง loop offset (paginate)");
  assert.match(fn, /if \(rows\.length < PAGE\) break/, "ต้องหยุดเมื่อหน้าสุดท้าย");
  assert.match(fn, /pages >= MAX_PAGES.*incomplete = true/s, "ชนเพดาน → incomplete=true (ไม่เงียบ)");
  const mvBlock = RUNNER.slice(RUNNER.indexOf("let movements = []"), RUNNER.indexOf("// 7) classify"));
  assert.match(mvBlock, /getAllChecked\(token, `stock_movements\?select=/, "movements ต้องผ่าน getAllChecked");
  assert.match(mvBlock, /stockDataIncomplete = res\.incomplete/, "ต้อง propagate incomplete เข้า classifier");
  assert.match(mvBlock, /type=in\.\(out,return\)/, "ต้องดึงทั้ง out และ return");
});

test("25. read-only guard: POST เฉพาะ /auth/v1/token · REST เป็น GET เท่านั้น · ไม่มี mutation", () => {
  const posts = [...RUNNER.matchAll(/method:\s*"(\w+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(posts)].sort(), ["GET", "POST"], "runner ต้องมีแค่ GET กับ POST");
  // POST ต้องอยู่ในฟังก์ชัน signIn เท่านั้น และยิงไป /auth/v1/token
  const signIn = RUNNER.slice(RUNNER.indexOf("async function signIn"), RUNNER.indexOf("const authH"));
  assert.match(signIn, /\/auth\/v1\/token\?grant_type=password/);
  assert.match(signIn, /method:\s*"POST"/);
  const outsideSignIn = RUNNER_CODE.replace(stripComments(signIn), "");
  assert.ok(!/method:\s*"POST"/.test(outsideSignIn), "POST ต้องมีจุดเดียว = login");
  assert.ok(!/method:\s*"(PATCH|PUT|DELETE)"/.test(RUNNER_CODE), "ห้าม PATCH/PUT/DELETE");
  assert.ok(!/Prefer["']?\s*:\s*["']?\s*resolution/.test(RUNNER_CODE), "ห้ามใช้ Prefer: resolution=");
  assert.ok(!/\/rest\/v1\/rpc\//.test(RUNNER_CODE), "ห้ามเรียก RPC");
  // REST endpoint มีจุดเดียว = getAllChecked และต้องยิงด้วย GET
  const restFetches = [...RUNNER_CODE.matchAll(/\/rest\/v1\//g)];
  assert.equal(restFetches.length, 1, "REST URL ต้องถูกประกอบที่เดียว (getAllChecked) — ทุก query ผ่านทางนี้");
  const getAllFn = RUNNER_CODE.slice(RUNNER_CODE.indexOf("async function getAllChecked"), RUNNER_CODE.indexOf("async function getAll(token"));
  assert.match(getAllFn, /\$\{URL_BASE\}\/rest\/v1\/\$\{pathAndQuery\}/, "getAllChecked ต้องเป็นตัวประกอบ REST URL");
  assert.match(getAllFn, /await fetch\(url, \{ method: "GET"/, "REST fetch ต้องเป็น GET");
  assert.ok(!/body:/.test(getAllFn), "REST GET ต้องไม่มี body");
  // ไม่มี recovery code
  assert.ok(!/postJournalForServiceJob|backfill|deductServiceJobStock|restoreServiceJobStock/.test(RUNNER_CODE),
    "Phase 604 ห้ามมี recovery/repair code");
});

test("26. runner ไม่ print credential/token/PII", () => {
  assert.ok(!/console\.(log|error)\([^)]*(token|ANON|AD_PASS|password|ACCESS_TOKEN)/i.test(RUNNER_CODE),
    "ห้าม log token/password/anon key");
  // ห้าม print note ดิบ (movement note มีชื่อลูกค้า) / slip / เบอร์ / ที่อยู่
  assert.ok(!/console\.log\([^)]*\.note\b/.test(RUNNER_CODE), "ห้าม print note ดิบ (มี PII)");
  assert.ok(!/customer_name|customer_phone|customer_address|payment_slip_url/.test(RUNNER_CODE),
    "runner code ต้องไม่อ้างถึง field PII เลย (คอมเมนต์อธิบายข้อห้ามได้)");
  assert.match(RUNNER, /fatal\(`login ไม่สำเร็จ \(\$\{r\.status\}\)/, "login fail ต้องรายงานแค่ status ไม่ใช่ credential");
});

test("27. exit semantics: default report-only 0 · strict 1 (blocker/incomplete/drift) · fatal 2", () => {
  assert.match(RUNNER, /function fatal\(msg\) \{ console\.error\("\[fatal\] " \+ msg\); process\.exit\(2\); \}/, "fatal = exit 2");
  const strict = RUNNER.slice(RUNNER.indexOf("// ── strict gate ──"), RUNNER.indexOf("main().then"));
  assert.match(strict, /overall ยังไม่พร้อม/, "strict ต้องรายงานว่า overall ยังไม่พร้อม (ไม่ใช่แค่ journal)");
  assert.match(strict, /stock review required/);
  assert.match(strict, /owner recognition-date confirmation pending/);
  assert.match(strict, /stockDataIncomplete/);
  assert.match(strict, /BASELINE_DRIFT/);
  assert.match(strict, /return 1/, "strict + blocker → exit 1");
  assert.match(strict, /return 0/, "strict สะอาด → exit 0");
  assert.match(RUNNER, /main\(\)\.then\(\(code\) => process\.exit\(code \|\| 0\)\)\.catch\(\(e\) => fatal\(/);
  // การพบ candidate เฉย ๆ (ไม่ strict) ต้องไม่ทำให้ exit ≠ 0
  const strictFlag = RUNNER.match(/const STRICT = argv\.includes\("--strict"\)/);
  assert.ok(strictFlag, "ต้องมี --strict flag");
});

test("27b. npm script verify:service-no-jv ชี้ runner ตัวนี้ และไม่มี dependency ใหม่", () => {
  assert.equal(PKG.scripts["verify:service-no-jv"], "node scripts/service_no_jv_classify.js");
  assert.ok(!PKG.dependencies || Object.keys(PKG.dependencies).length === 0, "ห้ามเพิ่ม runtime dependency");
  assert.deepEqual(Object.keys(PKG.devDependencies).sort(), ["@eslint/js", "@playwright/test", "eslint"], "devDependencies ต้องไม่เปลี่ยน");
});

test("27c. lib เป็น pure — ไม่มี fetch/env/process/fs ตอน import", () => {
  assert.ok(!/\bfetch\(|process\.env|process\.exit|require\(|from "node:fs"|from "node:process"/.test(LIB),
    "service_no_jv_classify_lib.js ต้อง pure (ไม่มี network/env/fs)");
});
