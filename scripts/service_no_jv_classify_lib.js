// ═══════════════════════════════════════════════════════════
//  service_no_jv_classify_lib.js — Phase 604 (S4.1b) PURE helpers
//  จำแนก "หลักฐาน" ของงานบริการที่ยังไม่มี JV (service NO_JV) ก่อนออกแบบ recovery ใน S4.1c
//
//  ★ PURE: ไม่มี env / fetch / side-effect ตอน import → unit-test ได้ด้วย fixture
//  ★ READ-ONLY: ไฟล์นี้ "จำแนก" เท่านั้น — ไม่โพสต์ JV, ไม่แตะสต็อก, ไม่แก้ข้อมูลใด ๆ
//  ★ accounting verdict กับ stock verdict แยกอิสระจากกัน (มีหลักฐานพอลง JV ≠ สต็อกพร้อมซ่อม)
//
//  หลักการที่ห้ามละเมิด (จาก audit ของ source จริง):
//  - closed_at = null → ห้าม auto-fallback created_at เป็นวันรับรู้รายได้ (auto_post.js:872 fallback
//    เป็นพฤติกรรมของ writer เดิม ไม่ใช่วันที่ owner อนุมัติ) → ต้อง block OWNER_RECOGNITION_DATE_REQUIRED
//  - stock_deducted_at เป็น claim ระดับ "ทั้งงาน" ที่เซ็ตก่อนตัดทีละ item (service_equipment.js:156)
//    → marker ไม่พิสูจน์ว่าตัดครบ; movement log ก็ best-effort → "ไม่พบหลักฐาน movement" ≠ "ไม่ได้ตัด"
//  - stock_movements ไม่มี warehouse_id → แม้ qty ตรงครบ ก็ประกาศว่าคลังถูกไม่ได้ (WAREHOUSE_UNVERIFIABLE)
//  - null ≠ 0 ทั้งเงินและ qty (ห้ามใช้ truthy/falsy รวมสองอย่างนี้)
// ═══════════════════════════════════════════════════════════
import { ACCOUNTING_EFFECTIVE_DATE, bkkDate, round2, isServiceIncomeJob, isWebOrderJob, entryRevenue } from "./finance_reconcile_lib.js";

export { ACCOUNTING_EFFECTIVE_DATE, bkkDate, round2, entryRevenue };

/** soft-delete truth ของ service_jobs (production ไม่มีคอลัมน์ deleted_at) — status=cancelled หรือ note มี [ลบแล้ว] */
export function isServiceJobDeletedOrCancelled(job) {
  const st = String(job?.status || "").trim().toLowerCase();
  return st === "cancelled" || String(job?.note || "").includes("[ลบแล้ว]");
}

// ── mapping key: คัดลอก SERVICE_JOB_TYPE_KEY_MAP (auto_post.js:820-838) — guard test เทียบกัน drift ──
export const SERVICE_JOB_TYPE_KEY_MAP_AUDIT = {
  ac: "service_install_ac",
  install_ac: "service_install_ac",
  repair_ac: "service_repair_ac",
  clean_ac: "service_clean_ac",
  move_ac: "service_move_ac",
  satellite: "service_satellite",
  repair_fridge: "service_repair_fridge",
  repair_washer: "service_repair_washer",
  cctv: "service_cctv",
  repair_tv: "service_repair_tv",
  solar: "service_solar",
  other: "service_other"
};
export function serviceMappingKeyForJobTypeAudit(jobType) {
  return SERVICE_JOB_TYPE_KEY_MAP_AUDIT[String(jobType || "").toLowerCase()] || "service_other";
}

// ── items_json ─────────────────────────────────────────────
/**
 * parse items_json ได้ทั้ง array (jsonb) และ JSON string; แยก "ว่างจริง" ออกจาก "พังจน parse ไม่ได้"
 * @returns {{state:"EMPTY"|"PARSED"|"MALFORMED", items:Array}}
 */
export function parseItemsJson(raw) {
  if (raw === null || raw === undefined || raw === "") return { state: "EMPTY", items: [] };
  if (Array.isArray(raw)) return { state: "PARSED", items: raw };
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return { state: "PARSED", items: v };
      return { state: "MALFORMED", items: [] };   // JSON ถูกต้องแต่ไม่ใช่ array = ผิดรูป
    } catch (_) {
      return { state: "MALFORMED", items: [] };
    }
  }
  return { state: "MALFORMED", items: [] };
}

/** qty ที่ใช้ได้ต้องเป็นตัวเลข finite > 0 (null/0/NaN/ติดลบ = ใช้ไม่ได้ — ห้ามกลืนเป็น 0 เงียบ) */
function validQty(q) {
  if (q === null || q === undefined || q === "") return null;
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * แยก items เป็น stockable / non-stock / unusable ตาม product metadata
 * @param {Array} items - items_json ที่ parse แล้ว
 * @param {Map<string,{product_type?:string}>} productMap - id → product row (product_type: stock|service|non_stock|null)
 */
export function partitionStockItems(items, productMap = new Map()) {
  const stockable = [];      // มี product_id + warehouse_id + qty ใช้ได้ + product_type ไม่ใช่ service/non_stock
  const nonStock = [];       // product_type = service / non_stock → ไม่คาดหวังการตัดสต็อก
  const unusable = [];       // ขาด product_id / warehouse_id / qty ใช้ไม่ได้ → พิสูจน์ไม่ได้
  const missingMeta = [];    // มี product_id แต่หา product row ไม่เจอ → ไม่รู้ว่า stockable ไหม
  for (const it of (items || [])) {
    const pid = it?.product_id;
    const qty = validQty(it?.qty);
    const wid = it?.warehouse_id;
    if (pid === null || pid === undefined || pid === "" || qty === null) { unusable.push({ product_id: pid ?? null, qty: it?.qty ?? null, warehouse_id: wid ?? null, reason: "MISSING_PRODUCT_OR_QTY" }); continue; }
    const p = productMap.get(String(pid));
    if (!p) { missingMeta.push({ product_id: pid, qty, warehouse_id: wid ?? null, reason: "PRODUCT_METADATA_MISSING" }); continue; }
    const t = String(p.product_type || "").toLowerCase();
    if (t === "service" || t === "non_stock") { nonStock.push({ product_id: pid, qty, product_type: t }); continue; }
    if (wid === null || wid === undefined || wid === "") { unusable.push({ product_id: pid, qty, warehouse_id: null, reason: "MISSING_WAREHOUSE" }); continue; }
    stockable.push({ product_id: pid, qty, warehouse_id: wid });
  }
  const expectedQtyByProduct = new Map();
  for (const it of stockable) {
    const k = String(it.product_id);
    expectedQtyByProduct.set(k, round2((expectedQtyByProduct.get(k) || 0) + it.qty));
  }
  return { stockable, nonStock, unusable, missingMeta, expectedQtyByProduct };
}

// ── movement matching ──────────────────────────────────────
//  out note ที่ writer สร้างจริง: `งานช่าง: {job_no} — {customer} | {before}→{after}` (service_equipment.js:83
//    → main.js _applyStockMovement:auditNote). exact marker = prefix รวม " —" → "JOB-1" ไม่ชน "JOB-12"
//  return note: `คืนอุปกรณ์งานช่าง {job_no} (ยกเลิก) | ...` (service_equipment.js:226)
//  ★ ห้าม print note ดิบออกรายงาน — มีชื่อลูกค้าอยู่ใน note
export function outNoteMarker(jobNo) { return `งานช่าง: ${jobNo} —`; }
export function returnNoteMarker(jobNo) { return `คืนอุปกรณ์งานช่าง ${jobNo} (ยกเลิก)`; }

/**
 * จับคู่ movement กับงาน — exact marker เท่านั้นที่ถือเป็นหลักฐาน; ชน job_no แบบ substring = fuzzy (ไม่นับ)
 * @param {Array} movements - stock_movements rows {id, product_id, type, qty, note, created_at}
 * @param {string} jobNo
 */
export function matchJobMovements(movements, jobNo) {
  const outMark = outNoteMarker(jobNo);
  const retMark = returnNoteMarker(jobNo);
  const outs = [], returns = [], fuzzy = [];
  for (const m of (movements || [])) {
    const note = String(m?.note || "");
    const type = String(m?.type || "").toLowerCase();
    if (note.includes(outMark)) {
      if (type === "out") outs.push(m);
      else fuzzy.push({ id: m?.id, type, reason: "OUT_MARKER_WITH_UNEXPECTED_TYPE" });
      continue;
    }
    if (note.includes(retMark)) {
      if (type === "return") returns.push(m);
      else fuzzy.push({ id: m?.id, type, reason: "RETURN_MARKER_WITH_UNEXPECTED_TYPE" });
      continue;
    }
    // ชนเลขงานแบบ substring แต่ไม่ตรง marker (เช่น JOB-1 อยู่ใน JOB-12, หรือ note รูปแบบอื่น) = ไม่ใช่หลักฐาน
    if (jobNo && note.includes(String(jobNo))) fuzzy.push({ id: m?.id, type, reason: "FUZZY_JOB_NO_ONLY" });
  }
  const sumByProduct = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r?.product_id ?? "");
      const q = Number(r?.qty);
      if (!Number.isFinite(q)) continue;
      m.set(k, round2((m.get(k) || 0) + q));   // ★ รวม qty ไม่ใช่นับจำนวน rows
    }
    return m;
  };
  return { outs, returns, fuzzy, outQtyByProduct: sumByProduct(outs), returnQtyByProduct: sumByProduct(returns) };
}

// ── stock verdict ──────────────────────────────────────────
/**
 * จำแนกหลักฐานสต็อกของงาน (อิสระจากฝั่งบัญชี)
 * @returns {{verdict:string, flags:string[], expected:Object, evidence:Object}}
 */
export function classifyStockEvidence({ job, productMap = new Map(), movements = [], dataIncomplete = false } = {}) {
  const flags = [];
  const parsed = parseItemsJson(job?.items_json);
  const jobNo = String(job?.job_no || "");
  const deductedAt = job?.stock_deducted_at ?? null;
  const revertedAt = job?.stock_reverted_at ?? null;
  const noteHasDeductMarker = String(job?.note || "").includes("[ตัดสต็อกแล้ว]");
  const noteHasReturnMarker = String(job?.note || "").includes("[คืนสต็อกแล้ว]");

  const base = {
    itemsState: parsed.state, jobNo,
    stockDeductedAt: deductedAt, stockRevertedAt: revertedAt,
    noteHasDeductMarker, noteHasReturnMarker
  };

  if (dataIncomplete) {
    return { verdict: "STOCK_DATA_INCOMPLETE", flags: ["MOVEMENT_FETCH_INCOMPLETE"], expected: {}, evidence: base };
  }
  if (parsed.state === "MALFORMED") {
    return { verdict: "STOCK_UNVERIFIABLE", flags: ["ITEMS_JSON_MALFORMED"], expected: {}, evidence: base };
  }
  if (!jobNo) {
    // ไม่มี job_no → จับคู่ movement ด้วย marker ไม่ได้เลย
    return { verdict: "STOCK_UNVERIFIABLE", flags: ["JOB_NO_MISSING"], expected: {}, evidence: base };
  }

  const part = partitionStockItems(parsed.items, productMap);
  const match = matchJobMovements(movements, jobNo);
  const outTotal = [...match.outQtyByProduct.values()].reduce((a, b) => round2(a + b), 0);
  const returnTotal = [...match.returnQtyByProduct.values()].reduce((a, b) => round2(a + b), 0);
  const expectedTotal = [...part.expectedQtyByProduct.values()].reduce((a, b) => round2(a + b), 0);
  const unusableItemCount = part.unusable.length;
  const missingMetaItemCount = part.missingMeta.length;
  const expected = {
    stockableItemCount: part.stockable.length,
    nonStockItemCount: part.nonStock.length,
    unusableItemCount,
    missingMetaItemCount,
    expectedQty: expectedTotal
  };
  const evidence = {
    ...base,
    outMovementCount: match.outs.length, outQty: outTotal,
    returnMovementCount: match.returns.length, returnQty: returnTotal,
    fuzzyMovementCount: match.fuzzy.length
  };

  if (match.fuzzy.length > 0) flags.push("FUZZY_MOVEMENT_IGNORED");
  if (unusableItemCount > 0) flags.push("ITEM_MISSING_PRODUCT_WAREHOUSE_OR_QTY");
  if (missingMetaItemCount > 0) flags.push("PRODUCT_METADATA_MISSING");

  // reverted บนงานที่ควรเป็นรายได้ = ขัดกัน (คืนของแล้วแต่ยังนับเป็นงานปิด/มีรายได้)
  if (revertedAt !== null && revertedAt !== undefined) {
    flags.push("STOCK_REVERTED_ON_INCOME_JOB");
    return { verdict: "STOCK_REVERTED_CONFLICT", flags, expected, evidence };
  }
  if (returnTotal > 0) {
    flags.push("RETURN_MOVEMENT_ON_INCOME_JOB");
    return { verdict: "STOCK_REVERTED_CONFLICT", flags, expected, evidence };
  }

  const hasDeductClaim = (deductedAt !== null && deductedAt !== undefined) || noteHasDeductMarker;

  // ไม่มี item ที่ต้องตัดสต็อกเลย
  if (part.stockable.length === 0) {
    if (unusableItemCount > 0 || missingMetaItemCount > 0) {
      return { verdict: "STOCK_UNVERIFIABLE", flags, expected, evidence };   // มี item แต่พิสูจน์ไม่ได้ว่าต้องตัดไหม
    }
    // ★ review fix: ไม่คาดว่าจะตัดอะไรเลย แต่มี claim/marker ระดับงาน = ข้อมูลขัดกัน (ห้ามบอกว่า "ไม่ต้องตัด")
    if (hasDeductClaim) {
      flags.push("DEDUCT_CLAIM_WITHOUT_EXPECTED_ITEMS");
      return { verdict: "STOCK_MARKER_MOVEMENT_CONFLICT", flags, expected, evidence };
    }
    if (outTotal > 0) {   // ไม่คาดว่าจะตัด แต่มี movement = ต้องดู
      flags.push("MOVEMENT_WITHOUT_EXPECTED_ITEMS");
      return { verdict: "STOCK_MOVEMENT_WITHOUT_MARKER", flags, expected, evidence };
    }
    return { verdict: "STOCK_NOT_REQUIRED", flags, expected, evidence };
  }

  // ★ review fix (Blocking #2): มี stockable บางส่วน + item ที่พิสูจน์ไม่ได้ (ขาด warehouse/product/qty
  //   หรือไม่มี product metadata) → "ของที่คาดว่าต้องตัด" ยังไม่ครบ → ห้ามประกาศว่า qty evidence ครบ
  //   แม้ movement ของ item ที่ valid จะตรงทุกตัว (item B อาจต้องตัดแต่เราไม่รู้ว่าต้องตัดเท่าไร/คลังไหน)
  if (unusableItemCount > 0 || missingMetaItemCount > 0) {
    flags.push("PARTIAL_EXPECTATION_UNVERIFIABLE");
    return { verdict: "STOCK_PARTIAL_EXPECTATION_UNVERIFIABLE", flags, expected, evidence };
  }

  // มี stockable items → เทียบ qty ต่อ product (ไม่ใช่นับ rows)
  let matchedProducts = 0, shortProducts = 0, overProducts = 0;
  const perProduct = [];
  for (const [pid, expQty] of part.expectedQtyByProduct) {
    const gotQty = match.outQtyByProduct.get(pid) || 0;
    perProduct.push({ product_id: pid, expectedQty: expQty, outQty: gotQty });
    if (gotQty === expQty) matchedProducts += 1;
    else if (gotQty < expQty) shortProducts += 1;
    else overProducts += 1;
  }
  // product ที่มี out movement แต่ไม่อยู่ใน items_json
  for (const [pid, gotQty] of match.outQtyByProduct) {
    if (!part.expectedQtyByProduct.has(pid)) { overProducts += 1; perProduct.push({ product_id: pid, expectedQty: 0, outQty: gotQty }); }
  }
  evidence.perProduct = perProduct;
  const qtyFullyMatched = shortProducts === 0 && overProducts === 0 && matchedProducts === part.expectedQtyByProduct.size;
  const hasMarker = hasDeductClaim;   // claim ระดับงาน = คอลัมน์ stock_deducted_at หรือ note marker [ตัดสต็อกแล้ว]

  // marker ไม่มี + ไม่พบ movement ที่ตรง marker (≠ พิสูจน์ว่าไม่ได้ตัด — movement log เป็น best-effort)
  if (!hasMarker && outTotal === 0) {
    flags.push("NO_DEDUCT_CLAIM_AND_NO_MOVEMENT_EVIDENCE");
    return { verdict: "STOCK_NO_CLAIM_NO_MOVEMENT_EVIDENCE", flags, expected, evidence };
  }
  // มี movement แต่ marker ว่าง = legacy / marker drift
  if (!hasMarker && outTotal > 0) {
    flags.push("MOVEMENT_PRESENT_WITHOUT_DEDUCT_CLAIM");
    return { verdict: "STOCK_MOVEMENT_WITHOUT_MARKER", flags, expected, evidence };
  }
  // marker มี แต่ไม่พบ movement เลย = conflict (อาจตัดจริงแต่ log ล้ม / อาจ claim แล้วล้มกลางทาง)
  if (hasMarker && outTotal === 0) {
    flags.push("DEDUCT_CLAIM_WITHOUT_MOVEMENT_EVIDENCE");
    return { verdict: "STOCK_MARKER_MOVEMENT_CONFLICT", flags, expected, evidence };
  }
  // marker + movement ครบทุก product ตาม qty → ยัง "ยืนยันคลังไม่ได้" (movement ไม่มี warehouse_id)
  if (hasMarker && qtyFullyMatched) {
    flags.push("WAREHOUSE_UNVERIFIABLE");
    return { verdict: "STOCK_QTY_EVIDENCE_PRESENT_WAREHOUSE_UNVERIFIABLE", flags, expected, evidence };
  }
  // marker + movement บางส่วน / เกิน → partial หรือ log ไม่ครบ (ห้ามสรุปว่า "ตัดไม่ครบแน่นอน")
  flags.push("WAREHOUSE_UNVERIFIABLE");
  flags.push("QTY_EVIDENCE_INCOMPLETE_OR_LOG_GAP");
  return { verdict: "STOCK_PARTIAL_OR_LOG_INCOMPLETE", flags, expected, evidence };
}

// ── recognition date ───────────────────────────────────────
/**
 * วันรับรู้รายได้ — closed_at เป็น "หลักฐานจากระบบ" เท่านั้น; ไม่มี closed_at = owner ต้องตัดสิน
 * ★ ห้าม fallback created_at (auto_post.js:872 fallback = พฤติกรรม writer ไม่ใช่การอนุมัติของ owner)
 */
export function classifyRecognitionDate(job) {
  const createdBkk = bkkDate(job?.created_at) || null;
  const closedBkk = bkkDate(job?.closed_at) || null;
  if (closedBkk) {
    return {
      createdBkk, closedBkk,
      recognitionDateSource: "SYSTEM_CLOSED_AT",
      recognitionDecision: "SYSTEM_CLOSED_AT_EVIDENCE_OWNER_TO_CONFIRM",   // ยังต้องให้ owner ยืนยัน ไม่ auto-approve
      ownerRecognitionDate: "PENDING_OWNER",
      blocked: false
    };
  }
  return {
    createdBkk, closedBkk: null,
    recognitionDateSource: "NONE",
    recognitionDecision: "OWNER_RECOGNITION_DATE_REQUIRED",
    ownerRecognitionDate: "PENDING_OWNER",
    blocked: true
  };
}

// ── journal evidence ───────────────────────────────────────
const _isApproved = (s) => String(s || "").trim().toLowerCase() === "approved";
const _lt = (a, b) => String(a || "") < String(b || "");

/**
 * จำแนกหลักฐานฝั่ง GL ของงาน (source_table='service_jobs' + source_id=job.id เท่านั้น)
 * @param {object} p
 * @param {object} p.job
 * @param {Array}  p.entries - journal_entries ทุก status ที่ source ตรงงานนี้ (ห้ามกลืน duplicate)
 * @param {Map}    p.linesByEntry - entry_id → lines[]
 * @param {Set|null} p.validMappingKeys - mapping_key ที่ active + มี debit/credit ครบ (null = ข้ามเช็ค)
 */
export function classifyJournalEvidence({ job, entries = [], linesByEntry = new Map(), validMappingKeys = null, effective = ACCOUNTING_EFFECTIVE_DATE } = {}) {
  const blockers = [];
  const mappingKey = serviceMappingKeyForJobTypeAudit(job?.job_type);
  const mappingStatus = validMappingKeys ? (validMappingKeys.has(mappingKey) ? "ACTIVE" : "MISSING_OR_INCOMPLETE") : "UNCHECKED";

  // source binding — ห้ามจับ JE ที่ source_table อื่น แม้ source_id ตรง; manual JV (source null) ไม่ใช่ของงานนี้
  const bound = (entries || []).filter(e =>
    e && e.source_table === "service_jobs" && e.source_id !== null && e.source_id !== undefined && String(e.source_id) === String(job?.id)
  );
  const approved = bound.filter(e => _isApproved(e.status));
  const nonApproved = bound.filter(e => !_isApproved(e.status));

  const rawAmount = job?.total_cost;
  const num = Number(rawAmount);
  const opAmount = round2(rawAmount);
  const recog = classifyRecognitionDate(job);
  const basisDateEvidence = recog.closedBkk;   // ★ ไม่ fallback created_at

  const detail = {
    mappingKey, mappingStatus,
    approvedCount: approved.length,
    nonApprovedCount: nonApproved.length,
    nonApproved: nonApproved.map(e => ({ id: e.id, status: e.status, docDate: e.doc_date })),
    entryIds: bound.map(e => e.id),
    opAmount,
    glRevenue: null, glDocDate: null, delta: null
  };

  // 1) งานที่ยกเลิก/ลบ = ห้าม recover (auto_post.js:859 ก็ skip)
  if (isServiceJobDeletedOrCancelled(job)) {
    if (approved.length > 0) blockers.push("APPROVED_JV_ON_DELETED_JOB");
    return { verdict: "DELETED_OR_CANCELLED", blockers, detail };
  }
  // 2) จำนวนเงิน — null ≠ 0 (null = row เพี้ยน; 0 = ไม่ใช่ candidate)
  if (rawAmount === null || rawAmount === undefined || !Number.isFinite(num) || num < 0) {
    blockers.push("INVALID_AMOUNT");
    return { verdict: "INVALID_AMOUNT", blockers, detail };
  }
  if (num === 0) {
    return { verdict: "ZERO_AMOUNT_NOT_CANDIDATE", blockers, detail };
  }
  // 3) mapping ที่ใช้ได้ ณ วัน audit (ไม่ครบ = โพสต์ไม่ได้จนกว่าจะตั้ง mapping)
  if (mappingStatus === "MISSING_OR_INCOMPLETE") blockers.push("CURRENT_MAPPING_MISSING");
  // 4) recognition date (closed_at null = owner ต้องเลือกวัน — ห้ามใช้ created_at แทน)
  if (recog.blocked) blockers.push("OWNER_RECOGNITION_DATE_REQUIRED");
  // 5) pre-effective (ตาม closed_at ที่เป็นหลักฐาน) → ต้องให้ owner ทบทวน ไม่ auto-post
  if (basisDateEvidence && _lt(basisDateEvidence, effective)) blockers.push("PRE_EFFECTIVE_REVIEW");

  // 6) JE ที่ผูก source
  if (approved.length > 1) {
    blockers.push("DUPLICATE_SOURCE_JV");
    return { verdict: "DUPLICATE_SOURCE_JV", blockers, detail };
  }
  if (approved.length === 1) {
    const je = approved[0];
    const lines = linesByEntry.get(String(je.id)) || linesByEntry.get(je.id) || [];
    detail.glDocDate = je.doc_date || null;
    if (lines.length === 0) {
      blockers.push("JE_LINES_MISSING");
      return { verdict: "DATA_INCOMPLETE", blockers, detail };
    }
    const gl = entryRevenue(lines);
    detail.glRevenue = gl;
    detail.delta = round2(opAmount - gl);
    if (nonApproved.length > 0) blockers.push("APPROVED_AND_NON_APPROVED_JV_COEXIST");
    if (detail.delta !== 0) {
      blockers.push("JV_AMOUNT_MISMATCH");
      return { verdict: "JV_AMOUNT_MISMATCH", blockers, detail };
    }
    if (basisDateEvidence && String(je.doc_date || "") !== basisDateEvidence) {
      blockers.push("JV_DATE_MISMATCH");
      return { verdict: "JV_DATE_MISMATCH", blockers, detail };
    }
    return { verdict: "APPROVED_JV_PRESENT", blockers, detail };   // ไม่ใช่ NO_JV → ไม่ต้อง recover
  }
  // approved = 0
  if (nonApproved.length > 0) {
    blockers.push("SOURCE_BOUND_NON_APPROVED_JV");
    return { verdict: "SOURCE_BOUND_NON_APPROVED", blockers, detail };   // มี JE ค้าง draft/void — ห้ามโพสต์ทับมั่ว
  }
  return { verdict: "NO_APPROVED_JV", blockers, detail };
}

// ═══════════════════════════════════════════════════════════
//  Phase 606-0: finance-flow taxonomy — แยกงานเก่า (flow v1) ออกจากกติกาใหม่ (flow v2)
//
//  ทำไม: Phase 606 (S4.1d) เปลี่ยนโมเดล — ส่งมอบ = Dr 1200 ลูกหนี้ / Cr รายได้ · รับเงิน = Dr เงินสด
//  /ธนาคาร / Cr 1200. งานที่โพสต์ JV ไปแล้วด้วยกติกาเดิม (Dr เงินสด/ธนาคารตอนส่งมอบ) ต้อง **ไม่ถูก
//  ตัดสินว่าผิด** ด้วยกติกาใหม่ แต่ก็ **ห้ามกลบให้หายไป** — จึงแยกเป็น 4 สถานะ:
//    LEGACY_FLOW_V1_POSTED  — งานเก่า มี approved JV แล้ว (informational; ห้ามแตะ/ห้าม re-post)
//    LEGACY_FLOW_V1_NO_JV   — งานเก่า ยังไม่มี JV = **ยังเป็นปัญหา** (รายได้หาย → recovery ต้องจัดการ)
//    FLOW_V2_POSTED         — งานใหม่ตามกติกา 606 ที่ลง JV แล้ว
//    FLOW_V2_NO_JV          — งานใหม่ตามกติกา 606 ที่ยังไม่ลง JV = ปัญหา
//  ★ finance_flow_version ยังไม่มีในสคีมาตอนนี้ (มาใน Phase 606-a) → row ที่ไม่มีคอลัมน์/เป็น null = v1
//  ★ ห้าม hardcode จำนวนงานเก่าไว้ในโค้ด — จำนวนเป็นผลจากการรันจริงเท่านั้น
// ═══════════════════════════════════════════════════════════
//  ★ งานที่ปิด/ส่งมอบ "ก่อน effective date" (ก่อนเริ่มบัญชีจริง) ตั้งใจไม่ลง JV อยู่แล้ว →
//    แยกเป็น PRE_EFFECTIVE_EXPECTED_UNPOSTED (informational) ห้ามนับเป็นปัญหา ไม่งั้นตัวเลข "รายได้หาย"
//    จะพองด้วยงานที่ถูกต้องอยู่แล้ว (ฐานเดียวกับ S4.0/S4.1b — preliminaryBasisDateForScoping)
export const SERVICE_FLOW_STATES = {
  PRE_EFFECTIVE_EXPECTED_UNPOSTED: "PRE_EFFECTIVE_EXPECTED_UNPOSTED",
  LEGACY_FLOW_V1_POSTED: "LEGACY_FLOW_V1_POSTED",
  LEGACY_FLOW_V1_NO_JV: "LEGACY_FLOW_V1_NO_JV",
  FLOW_V2_POSTED: "FLOW_V2_POSTED",
  FLOW_V2_NO_JV: "FLOW_V2_NO_JV"
};

/** finance_flow_version ของงาน — ไม่มีคอลัมน์/null/ค่าที่อ่านไม่ได้ = 1 (legacy) */
export function financeFlowVersionOf(job) {
  const v = Number(job?.finance_flow_version);
  return Number.isFinite(v) && v >= 2 ? v : 1;
}

/**
 * งานบริการ (income status) นี้อยู่สถานะไหนของ finance flow
 * @param {object} job
 * @param {Array} entries - journal_entries ที่ผูก source (ทุก status) ของงานนี้
 */
export function classifyServiceFlowState(job, entries = [], effective = ACCOUNTING_EFFECTIVE_DATE) {
  const approved = (entries || []).filter(e =>
    e && e.source_table === "service_jobs" && String(e.source_id) === String(job?.id)
    && String(e.status || "").toLowerCase() === "approved"
  );
  const v2 = financeFlowVersionOf(job) >= 2;
  const posted = approved.length > 0;
  // pre-effective + ยังไม่มี JV = ตั้งใจไม่ลง (ไม่ใช่ปัญหา). ถ้ามี JV กลับถือว่า posted ตามจริง
  const basis = preliminaryBasisDateForScoping(job);
  if (!posted && basis && _lt(basis, effective)) return SERVICE_FLOW_STATES.PRE_EFFECTIVE_EXPECTED_UNPOSTED;
  if (v2) return posted ? SERVICE_FLOW_STATES.FLOW_V2_POSTED : SERVICE_FLOW_STATES.FLOW_V2_NO_JV;
  return posted ? SERVICE_FLOW_STATES.LEGACY_FLOW_V1_POSTED : SERVICE_FLOW_STATES.LEGACY_FLOW_V1_NO_JV;
}

/**
 * สรุป taxonomy ของงานบริการทั้งชุด (นับ + ยอด ต่อสถานะ) — ใช้รายงาน ไม่ใช้ตัดสินใจซ่อม
 * @param {Array} jobs - service_jobs rows (จะกรองเฉพาะ income status ที่ไม่ใช่ web/ไม่ลบ)
 * @param {Map<string,Array>} entriesByJob - id → journal_entries[]
 */
export function summarizeServiceFlow(jobs, entriesByJob = new Map()) {
  const out = {};
  for (const k of Object.values(SERVICE_FLOW_STATES)) out[k] = { count: 0, amount: 0, jobNos: [] };
  let scanned = 0;
  for (const j of (jobs || [])) {
    if (!isServiceIncomeJob(j) || isWebOrderJob(j) || isServiceJobDeletedOrCancelled(j)) continue;
    scanned += 1;
    const st = classifyServiceFlowState(j, entriesByJob.get(String(j.id)) || []);
    out[st].count += 1;
    out[st].amount = round2(out[st].amount + round2(j.total_cost));
    if (out[st].jobNos.length < 200) out[st].jobNos.push(j.job_no || String(j.id));   // ไม่ตัดเงียบเกิน 200
  }
  // LEGACY_FLOW_V1_NO_JV + FLOW_V2_NO_JV = ยังเป็นปัญหา (รายได้ยังไม่ลงบัญชี)
  const problemCount = out.LEGACY_FLOW_V1_NO_JV.count + out.FLOW_V2_NO_JV.count;
  const problemAmount = round2(out.LEGACY_FLOW_V1_NO_JV.amount + out.FLOW_V2_NO_JV.amount);
  return { states: out, scanned, problemCount, problemAmount, partitionOk: Object.values(out).reduce((a, s) => a + s.count, 0) === scanned };
}

// ── candidate: งานที่ S4.0 นับเป็น service NO_JV (ต้องตรงนิยามเดียวกัน) ──
/**
 * ★★ SCOPING ONLY — ห้ามใช้เป็นวันรับรู้รายได้ ★★
 * "preliminary basis" = closed_at || created_at — ฐานเดียวกับที่ S4.0 (classifyServiceJob/summarizeMonth)
 * และ writer (auto_post.js:872) ใช้ *คัดว่างานอยู่ก่อน/หลัง effective date* เท่านั้น
 * การ "เลือกวันลงบัญชีจริง" ยังต้องผ่าน classifyRecognitionDate → owner เป็นคนตัดสิน (closed_at null = blocker)
 */
export function preliminaryBasisDateForScoping(job) {
  return bkkDate(job?.closed_at || job?.created_at) || "";
}

/**
 * งานนี้เข้าข่าย "service income candidate" ที่ S4.0 คาดหวัง JV ไหม
 * (income status + total_cost>0 + ไม่ลบ + ไม่ใช่ web order — ตรง summarizeMonth: svcIncomeInMonth)
 * pre-effective (basis < effective) = ตั้งใจไม่ลง JV → ไม่ใช่ NO_JV (S4.0 นับเป็น expected-unposted)
 */
export function isServiceIncomeCandidate(job, effective = ACCOUNTING_EFFECTIVE_DATE) {
  if (!(isServiceIncomeJob(job) && !isWebOrderJob(job) && !isServiceJobDeletedOrCancelled(job))) return false;
  const basis = preliminaryBasisDateForScoping(job);
  if (basis && _lt(basis, effective)) return false;   // pre-effective = expected-unposted (ตรง S4.0)
  return true;
}

// ── รวมทุกมิติต่อ 1 งาน ────────────────────────────────────
/**
 * @returns {{jobId, jobNo, journal, stock, recognition, readiness:{journalRecoveryEligible:boolean, stockReviewRequired:boolean, ownerConfirmationPending:boolean, overallS41cReady:boolean, reason:string}, blockers:string[]}}
 */
export function classifyServiceNoJvCandidate({ job, entries = [], linesByEntry = new Map(), validMappingKeys = null, productMap = new Map(), movements = [], stockDataIncomplete = false, effective = ACCOUNTING_EFFECTIVE_DATE } = {}) {
  const journal = classifyJournalEvidence({ job, entries, linesByEntry, validMappingKeys, effective });
  const stock = classifyStockEvidence({ job, productMap, movements, dataIncomplete: stockDataIncomplete });
  const recognition = classifyRecognitionDate(job);

  // ── readiness 3 ระดับ (review fix — ห้ามให้ journal readiness พูดแทนทั้งงาน) ────────────────
  //  journalRecoveryEligible : หลักฐานฝั่ง GL พร้อมโพสต์ (ไม่มี JV ผูก source + ไม่มี blocker บัญชี)
  //  stockReviewRequired     : ฝั่งสต็อกยังต้องตรวจ/ตัดสินใจ (รวม WAREHOUSE_UNVERIFIABLE — qty ตรงก็ยังยืนยันคลังไม่ได้)
  //  ownerConfirmationPending: owner ยังไม่ยืนยันวันรับรู้รายได้ (closed_at เป็นแค่หลักฐานของระบบ)
  //  overallS41cReady        : พร้อมจริงทั้งงาน = ครบทั้งสามอย่าง (สคริปต์ประกาศเองไม่ได้ตราบใดที่ owner ยังไม่ยืนยัน)
  const blockers = [...journal.blockers];
  const journalRecoveryEligible = journal.verdict === "NO_APPROVED_JV" && blockers.length === 0;
  const stockReviewRequired = !(stock.verdict === "STOCK_NOT_REQUIRED" && stock.flags.length === 0);
  const ownerConfirmationPending = recognition.ownerRecognitionDate === "PENDING_OWNER";
  const overallS41cReady = journalRecoveryEligible && !stockReviewRequired && !ownerConfirmationPending;

  const notReady = [];
  if (!journalRecoveryEligible) {
    notReady.push(journal.verdict === "NO_APPROVED_JV"
      ? `journal blocker: ${blockers.join(", ")}`
      : `journal verdict ${journal.verdict} (ไม่ใช่เคส post-JV ตรง ๆ)`);
  }
  if (stockReviewRequired) notReady.push(`stock ต้องตรวจ: ${stock.verdict}`);
  if (ownerConfirmationPending) notReady.push("owner ยังไม่ยืนยันวันรับรู้รายได้");
  const readinessReason = overallS41cReady ? "พร้อมทุกมิติ (บัญชี + สต็อก + owner ยืนยันวันแล้ว)" : notReady.join(" · ");

  return {
    jobId: job?.id, jobNo: job?.job_no || null, jobType: job?.job_type || null, status: job?.status || null,
    paymentMethod: job?.payment_method || null,
    journal, stock, recognition,
    readiness: { journalRecoveryEligible, stockReviewRequired, ownerConfirmationPending, overallS41cReady, reason: readinessReason },
    blockers,
    // VAT: writer ไม่แยก VAT ของงานบริการ และ service_jobs ไม่มี field VAT → ห้ามคำนวณเอง
    vatNote: "VAT_BASIS_NOT_SEPARATELY_EVIDENCED"
  };
}

/** partition self-check — ทุก candidate ต้องถูกนับใน journal taxonomy และ stock taxonomy อย่างละครั้งเดียว */
export function summarizeClassification(rows) {
  const journalCounts = {}, stockCounts = {}, blockerCounts = {};
  let amount = 0;
  for (const r of (rows || [])) {
    journalCounts[r.journal.verdict] = (journalCounts[r.journal.verdict] || 0) + 1;
    stockCounts[r.stock.verdict] = (stockCounts[r.stock.verdict] || 0) + 1;
    for (const b of r.blockers) blockerCounts[b] = (blockerCounts[b] || 0) + 1;
    amount = round2(amount + round2(r.journal.detail.opAmount));
  }
  const total = (rows || []).length;
  const journalSum = Object.values(journalCounts).reduce((a, b) => a + b, 0);
  const stockSum = Object.values(stockCounts).reduce((a, b) => a + b, 0);
  const list = rows || [];
  return {
    candidateCount: total, candidateAmount: amount,
    journalCounts, stockCounts, blockerCounts,
    // readiness แยก 3 ระดับ — ห้ามสรุปรวมเป็นตัวเดียว (journal พร้อม ≠ ทั้งงานพร้อม)
    journalEligibleCount: list.filter(r => r.readiness.journalRecoveryEligible).length,
    stockReviewRequiredCount: list.filter(r => r.readiness.stockReviewRequired).length,
    ownerConfirmationPendingCount: list.filter(r => r.readiness.ownerConfirmationPending).length,
    overallReadyCount: list.filter(r => r.readiness.overallS41cReady).length,
    partitionOk: journalSum === total && stockSum === total,
    journalSum, stockSum
  };
}
