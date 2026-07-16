// ═════════════════════════════════════════════════
//  Phase 606-b2 — guard: v2 status semantics ใน saveServiceJob
// ═════════════════════════════════════════════════
//  Invariants:
//  I1  v1 (ทุกงานบน production ตอนนี้) พฤติกรรมเดิม 100% — stamp/JV/stock/LINE เงื่อนไขเดิม
//  I2  v2: closed_at + JV เฉพาะ "เพิ่งเข้า delivered" (runtime); เข้า done ห้าม stamp/JV;
//      closed = recovery ผ่าน Service Reconcile เท่านั้น (ดู incomeStatuses ใน auto_post.js)
//  ★  operational bucket (stock/LINE) = ["done","delivered","closed"] ทุก flow — ห้ามเปลี่ยน
//  ★  flow อ่านไม่ได้ (null) = block ก่อน PATCH — ห้าม fallback v1
//  ★  v2 ห้ามกระโดดเข้า closed โดยไม่ผ่าน delivered
//  mutation proof: สลับให้ v2 stamp ที่ done / ให้ stock ใช้ recognition vars / ลบ null-block
//  → test แดง (รายงานผลรันจริงใน PR)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAIN = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");

// ─── extraction (function body ก่อน — ห้าม grep ทั้งไฟล์) ───
function extractFn(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, "ไม่พบ " + header);
  // body brace = ตัวแรก "หลัง" วงเล็บปิดของ parameter list (กัน destructuring {..} ใน params)
  const paren = src.indexOf(")", start);
  let i = src.indexOf("{", paren);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("วงเล็บปีกกาไม่บาลานซ์: " + header);
}
function extractBlock(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, "ไม่พบ " + startMarker);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, "ไม่พบ " + endMarker + " หลัง " + startMarker);
  return src.slice(start, end);
}

const PLAN_SRC = extractFn(MAIN, "function serviceSavePlan(");
const SAVE_SRC = extractBlock(MAIN, "async function saveServiceJob()", "\nfunction _allowNegStock(");

// planner เป็น pure function — รันจริงใน sandbox (behavioral ไม่ใช่แค่ regex)
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${PLAN_SRC}\nglobalThis.__plan = serviceSavePlan;`, sandbox);
const plan = sandbox.__plan;
const P = (o) => plan({ totalChanged: false, methodChanged: false, isNewJob: false, ...o });

// ─── behavioral: v1 = พฤติกรรมเดิม 100% (I1) ───
test("B1. v1 stampSet/recognition = done/delivered/closed เดิมครบ", () => {
  for (const st of ["done", "delivered", "closed"]) {
    const p = P({ flow: 1, origStatus: "pending", newStatus: st });
    assert.equal(JSON.stringify(p.stampSet), JSON.stringify(["done", "delivered", "closed"]),
      "v1 stampSet ต้องเป็น bucket เดิม");  // JSON เทียบ — array มาจาก vm realm
    assert.equal(p.transitionedToRecognized, true, `v1 pending→${st} ต้อง trigger JV เหมือนเดิม`);
    assert.equal(p.blockClosedJump, false, "v1 ห้ามโดน jump-guard");
  }
});
test("B2. v1 edit งานปิดแล้ว + แก้เงิน → re-post เหมือนเดิม (88.10b)", () => {
  const p = P({ flow: 1, origStatus: "done", newStatus: "done", totalChanged: true });
  assert.equal(p.editRecognizedWithChange, true);
  assert.equal(p.wasRecognized, true, "needsVoid path เดิมต้องยังทำงาน");
});
test("B3. v1 งานใหม่ + ปิดทันที → JV เหมือนเดิม", () => {
  const p = P({ flow: 1, isNewJob: true, origStatus: "", newStatus: "delivered" });
  assert.equal(p.newJobRecognized, true);
});

// ─── behavioral: v2 semantics (I2) ───
test("B4. v2 เข้า done: ไม่ stamp / ไม่ JV (done = งานเสร็จรอส่งมอบ)", () => {
  const p = P({ flow: 2, origStatus: "progress", newStatus: "done" });
  assert.equal(p.stampSet.includes("done"), false, "v2 stampSet ห้ามมี done");
  assert.equal(p.transitionedToRecognized, false);
  assert.equal(p.newJobRecognized, false);
});
test("B5. v2 เข้า delivered (จาก done หรือ pending) = recognition: stamp + JV", () => {
  for (const orig of ["done", "pending", "progress"]) {
    const p = P({ flow: 2, origStatus: orig, newStatus: "delivered" });
    assert.equal(p.transitionedToRecognized, true, `v2 ${orig}→delivered ต้องยิง JV`);
    assert.equal(p.stampSet.includes("delivered"), true);
  }
});
test("B6. v2 delivered→closed: ไม่ stamp ใหม่ / ไม่ยิง JV ใหม่ (idempotent)", () => {
  const p = P({ flow: 2, origStatus: "delivered", newStatus: "closed" });
  assert.equal(p.transitionedToRecognized, false, "recognition เกิดที่ delivered ไปแล้ว");
  assert.equal(p.wasRecognized, true, "ไม่ restamp (first-time-only เดิมคุม)");
  assert.equal(p.blockClosedJump, false, "ผ่าน delivered แล้ว → closed ได้");
});
test("B7. v2 กระโดดเข้า closed โดยไม่ผ่าน delivered = block", () => {
  for (const orig of ["pending", "progress", "done", "pending_review"]) {
    const p = P({ flow: 2, origStatus: orig, newStatus: "closed" });
    assert.equal(p.blockClosedJump, true, `v2 ${orig}→closed ต้องถูก block`);
  }
});
test("B8. v2 งานอยู่ done + แก้เงิน: ไม่ void/ไม่ post (ยังไม่มี JV ให้แตะ)", () => {
  const p = P({ flow: 2, origStatus: "done", newStatus: "done", totalChanged: true });
  assert.equal(p.editRecognizedWithChange, false);
  assert.equal(p.wasRecognized, false, "needsVoid ต้อง false — ไม่มี JV");
});

// ─── structural: saveServiceJob ต่อสายถูกจุด ───
test("S1. stamp block ใช้ _svcPlan.stampSet (ไม่ hardcode bucket เดียวทุก flow)", () => {
  const stamp = extractBlock(SAVE_SRC, "const _CLOSE_ST", "xhrPatch(\"service_jobs\"");
  assert.match(stamp, /const _CLOSE_ST = _svcPlan\.stampSet/);
});
test("S2. operational bucket เดิมยังอยู่ครบ และ stock/LINE ใช้ operational vars (ห้ามใช้ recognition)", () => {
  assert.match(SAVE_SRC, /const COMPLETION_STATUSES = \["done", "delivered", "closed"\]/,
    "operational bucket ต้องเป็น literal เดิม");
  const stockBlock = extractBlock(SAVE_SRC, "ตัดสต็อกอุปกรณ์ \"ตอนปิดงาน\" ครั้งเดียว",
    'sendLineNotify(msg, { state, showToast }, "done")');
  assert.match(stockBlock, /if \(transitionedToDone \|\| newJobAlreadyComplete\)/,
    "stock ต้อง trigger ด้วย operational vars เดิม");
  assert.doesNotMatch(stockBlock, /_svcPlan\.(transitionedToRecognized|newJobRecognized)/,
    "stock ห้ามผูกกับ recognition vars — v2 เข้า done ต้องยังตัดสต็อก");
  const lineIdx = SAVE_SRC.lastIndexOf("if (transitionedToDone) {");
  assert.ok(lineIdx > 0, "LINE notify ต้องยัง trigger ด้วย transitionedToDone");
});
test("S3. JV wiring ใช้ recognition vars จาก planner (ทั้ง trigger และ needsVoid)", () => {
  assert.match(SAVE_SRC,
    /if \(_svcPlan\.transitionedToRecognized \|\| _svcPlan\.newJobRecognized \|\| _svcPlan\.editRecognizedWithChange\)/);
  assert.match(SAVE_SRC, /const needsVoid = !isNewJob && \(_svcPlan\.wasRecognized \|\| _svcPlan\.transitionedToRecognized\)/);
  assert.doesNotMatch(SAVE_SRC, /const editCompleteWithChange/, "ตัวแปรเก่าต้องถูกแทนด้วย planner แล้ว");
});
test("S4. flow null = block ก่อน PATCH (ห้าม fallback v1) และ jump-guard อยู่ก่อน PATCH", () => {
  const posFlowNull = SAVE_SRC.indexOf("_svcFlow === null");
  const posJump = SAVE_SRC.indexOf("_svcPlan.blockClosedJump");
  const posPatch = SAVE_SRC.indexOf("xhrPatch(\"service_jobs\"");
  assert.ok(posFlowNull > 0, "ต้องเช็ค serviceFinanceFlowOf คืน null");
  assert.ok(posJump > 0, "ต้องมี jump-guard");
  assert.ok(posPatch > 0);
  assert.ok(posFlowNull < posPatch, "null-block ต้องมาก่อน PATCH");
  assert.ok(posJump < posPatch, "jump-guard ต้องมาก่อน PATCH");
  const nullBlock = SAVE_SRC.slice(posFlowNull, posFlowNull + 400);
  assert.match(nullBlock, /return showToast/, "null-block ต้อง return (ไม่ใช่แค่เตือนแล้วไปต่อ)");
  assert.match(SAVE_SRC, /serviceFinanceFlowOf\(_stRow\)/, "flow ต้องอ่านจาก state row ไม่ใช่ฟอร์ม");
  // กัน mutation "null → เดาเป็น v1": ระหว่าง readback กับ planner ห้ามมี reassignment _svcFlow ใด ๆ
  const between = extractBlock(SAVE_SRC, "serviceFinanceFlowOf(_stRow)", "_svcPlan = serviceSavePlan");
  assert.equal((between.match(/_svcFlow\s*=(?!=)/g) || []).length, 0,
    "ห้าม reassign _svcFlow หลัง readback (fallback v1 = ผิด policy)");
  assert.match(between, /if \(_svcFlow === null\) \{\s*\n\s*_signalSave/,
    "เช็ค null ต้องตามด้วย _signalSave ทันที (ห้ามมีสาขาแทรก)");
});
test("S5. planner: v2 stampSet = delivered/closed และ operational เต็ม bucket อยู่ในไฟล์เดียวกัน", () => {
  assert.match(PLAN_SRC, /flow === 2 \? \["delivered", "closed"\] : OPERATIONAL/);
  assert.match(PLAN_SRC, /const OPERATIONAL = \["done", "delivered", "closed"\]/);
  assert.match(PLAN_SRC, /flow !== 2 \|\| next === "delivered"/,
    "v2 runtime recognition ต้องล็อกที่ delivered เท่านั้น");
});
