// ═════════════════════════════════════════════════
//  Phase 606-b2 — guard: UI รับชำระงานบริการ flow v2 (drawer)
// ═════════════════════════════════════════════════
//  Invariants:
//  I3  ผลรับชำระอ่าน accountingPosted — ห้ามใช้ res.ok เดี่ยวตัดสิน "ลงบัญชีแล้ว" (คู่ guard D8)
//  I4  ห้าม INSERT service_payments ตรง — เขียนผ่าน recordServicePayment (RPC) เท่านั้น
//  ★  intent snapshot ทั้งก้อน (key + paid_at + bank) — retry ส่งค่าเดิมทุก field (RPC เทียบครบ → 23505)
//  ★  summary fail-closed: RPC null/fail = DATA_INCOMPLETE + disable submit — ห้ามเดา paid=0
//  ★  stale-response guard: seq token + jobId closure — ผลงาน A ห้ามทับ drawer งาน B
//  ★  section render เฉพาะ admin + flow v2 + delivered/closed — งาน v1 ไม่มี DOM ข้างใน
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAIN = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");

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

const SUMMARY_SRC = extractFn(MAIN, "function svcPaySummaryView(");
const INTENT_SRC  = extractFn(MAIN, "function svcPayIntentFor(");
const RESULT_SRC  = extractFn(MAIN, "function svcPayResultPlan(");
const RENDER_SRC  = extractFn(MAIN, "function _renderServicePaymentSection(");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  `${SUMMARY_SRC}\n${INTENT_SRC}\n${RESULT_SRC}\n` +
  `globalThis.__sum = svcPaySummaryView; globalThis.__intent = svcPayIntentFor; globalThis.__res = svcPayResultPlan;`,
  sandbox);
const sum = sandbox.__sum, intentFor = sandbox.__intent, resultPlan = sandbox.__res;

// ─── behavioral: summary fail-closed ───
test("B1. RPC null/undefined/fail/non-finite → DATA_INCOMPLETE + disable submit (ห้ามเดา 0)", () => {
  for (const raw of [null, undefined, "", NaN, "abc", -1, Infinity]) {
    const v = sum(raw);
    assert.equal(v.ok, false, `raw=${String(raw)} ต้อง fail-closed`);
    assert.equal(v.disableSubmit, true, `raw=${String(raw)} ต้องปิดปุ่ม`);
    assert.equal(v.paid, null, "ห้ามคืนตัวเลขเดา");
    assert.equal(v.label, "—", "ต้องแสดง — ไม่ใช่ 0");
  }
});
test("B2. ค่า finite ถูกต้อง (รวม 0 = ยังไม่รับเงินจริง) → เปิดปุ่ม", () => {
  // เทียบรายฟิลด์ — object มาจาก vm realm (deepEqual เทียบ prototype ข้าม realm ไม่ผ่าน)
  const z = sum(0);
  assert.equal(z.ok, true); assert.equal(z.paid, 0); assert.equal(z.disableSubmit, false);
  const f = sum("1500.50");
  assert.equal(f.ok, true); assert.equal(f.paid, 1500.5); assert.equal(f.disableSubmit, false);
});

// ─── behavioral: intent snapshot ทั้งก้อน ───
test("B3. retry field เดิมทุกตัว → reuse intent เดิมทั้งก้อน (key + paid_at ไม่เปลี่ยน)", () => {
  let n = 0;
  const uuid = () => "uuid-" + (++n);
  const first = intentFor({ amount: 500, paymentMethod: "transfer", bankCoaCode: "1134" }, null, uuid, "T1");
  assert.equal(first.key, "uuid-1");
  assert.equal(first.paidAt, "T1");
  const retry = intentFor({ amount: 500, paymentMethod: "transfer", bankCoaCode: "1134" }, first, uuid, "T2");
  assert.equal(retry, first, "retry ต้องได้ intent อ้างอิงเดิม (รวม paid_at เดิม — RPC เทียบ payload ครบ)");
  assert.equal(n, 1, "ห้าม gen key ใหม่ตอน retry");
});
test("B4. แก้ยอด/วิธี/บัญชี = รายการใหม่ → key ใหม่ + paid_at ใหม่", () => {
  let n = 0;
  const uuid = () => "uuid-" + (++n);
  const first = intentFor({ amount: 500, paymentMethod: "cash", bankCoaCode: null }, null, uuid, "T1");
  const amt = intentFor({ amount: 700, paymentMethod: "cash", bankCoaCode: null }, first, uuid, "T2");
  assert.notEqual(amt.key, first.key, "แก้ยอด = key ใหม่");
  assert.equal(amt.paidAt, "T2");
  const bank = intentFor({ amount: 700, paymentMethod: "transfer", bankCoaCode: "1134" }, amt, uuid, "T3");
  assert.notEqual(bank.key, amt.key, "แก้วิธี/บัญชี = key ใหม่");
});

// ─── behavioral: mapping ผลลัพธ์ 3 ชั้น (I3) ───
test("B5. !ok → error · ok+!accountingPosted → ledger-only เตือน · ok+posted → posted", () => {
  const e = resultPlan({ ok: false, error: "23514: เกินยอดคงค้าง" });
  assert.equal(e.kind, "error");
  assert.match(e.message, /23514/);
  const half = resultPlan({ ok: true, ledgerRecorded: true, accountingPosted: false });
  assert.equal(half.kind, "ledger-only");
  assert.match(half.message, /ยังไม่ลงบัญชี/, "ต้องบอกชัดว่าเงินบันทึกแล้วแต่บัญชียังไม่ลง");
  assert.match(half.message, /Service Reconcile/, "ต้องชี้ทางซ่อม");
  const full = resultPlan({ ok: true, accountingPosted: true, jv: {} });
  assert.equal(full.kind, "posted");
  assert.equal(resultPlan(null).kind, "error", "res หาย = error ไม่ใช่เงียบ");
});
test("B6. ok:true อย่างเดียว (ไม่มี accountingPosted) ต้องไม่ถูกฉลองเป็นสำเร็จเต็ม", () => {
  const p = resultPlan({ ok: true });
  assert.equal(p.kind, "ledger-only", "ok เดี่ยว ๆ = ledger รับแล้วเท่านั้น (guard D8)");
});

// ─── structural: handler / render ───
test("S1. handler ตัดสินผลผ่าน svcPayResultPlan (อ่าน accountingPosted) — ไม่มีเส้น success จาก res.ok เดี่ยว", () => {
  assert.match(RENDER_SRC, /svcPayResultPlan\(res\)/, "ต้อง map ผลผ่าน planner");
  assert.match(RESULT_SRC, /res\.accountingPosted/, "planner ต้องอ่าน accountingPosted");
  assert.doesNotMatch(RENDER_SRC, /if\s*\(\s*res\.ok\s*\)[^]{0,80}showToast/,
    "ห้ามมี success-toast ที่ตัดสินจาก res.ok เดี่ยว ๆ");
});
test("S2. inflight guard + intent snapshot ใช้จริงใน handler", () => {
  assert.match(RENDER_SRC, /_svcPayGuard\.run\(/, "submit ต้องครอบ inflight guard");
  assert.match(MAIN, /const _svcPayGuard = createInflightGuard\(\)/);
  assert.match(RENDER_SRC, /svcPayIntentFor\(/, "ต้องสร้าง/reuse intent ผ่าน helper");
  assert.match(RENDER_SRC, /idempotencyKey: _svcPayIntent\.key/, "key จาก snapshot");
  assert.match(RENDER_SRC, /paidAt: _svcPayIntent\.paidAt/, "paid_at จาก snapshot (ห้ามคำนวณใหม่ตอน retry)");
  assert.match(RENDER_SRC, /amount: _svcPayIntent\.amount/, "amount จาก snapshot");
});
test("S3. I4: ไม่มีการเขียน service_payments ตรงใน main.js — ต้องผ่าน recordServicePayment", () => {
  assert.doesNotMatch(MAIN, /xhrPost\(\s*"service_payments"/);
  assert.doesNotMatch(MAIN, /from\(\s*"service_payments"\s*\)\s*\.\s*(insert|upsert|update|delete)/);
  assert.doesNotMatch(MAIN, /rest\/v1\/service_payments/);
  assert.match(RENDER_SRC, /await recordServicePayment\(\{/, "เขียนผ่าน canonical helper เท่านั้น");
});
test("S4. section render เฉพาะ admin + flow v2 + delivered/closed + ไม่ [ลบแล้ว] — เคลียร์ DOM ก่อนเสมอ", () => {
  const posClear = RENDER_SRC.indexOf("host.innerHTML = \"\"");
  assert.ok(posClear > 0, "ต้องล้าง container ก่อน (งาน v1 = ว่างจริง ไม่ใช่ซ่อน CSS)");
  const posAdmin = RENDER_SRC.indexOf("requireAdmin()");
  const posFlow = RENDER_SRC.indexOf("serviceFinanceFlowOf(job) !== 2");
  const posStatus = RENDER_SRC.indexOf('["delivered", "closed"].includes');
  const posDeleted = RENDER_SRC.indexOf("[ลบแล้ว]");
  for (const [name, pos] of [["admin", posAdmin], ["flow", posFlow], ["status", posStatus], ["deleted", posDeleted]]) {
    assert.ok(pos > posClear, `เงื่อนไข ${name} ต้องอยู่หลังการล้าง DOM (return = container ว่าง)`);
  }
});
test("S5. ค่า dynamic ทุกตัว render ผ่าน textContent (ไม่มี template-literal innerHTML)", () => {
  assert.doesNotMatch(RENDER_SRC, /innerHTML\s*=\s*`/, "ห้ามสร้าง HTML จาก template literal ใน section นี้");
  assert.doesNotMatch(RENDER_SRC, /innerHTML\s*\+=/, "ห้าม append HTML string");
  assert.match(RENDER_SRC, /o\.textContent = \[b\.bankName, b\.bankAccount\]/, "ชื่อบัญชีธนาคารต้องลงผ่าน textContent");
});
test("S6. summary fail-closed + stale guard ต่อสายจริง", () => {
  assert.match(RENDER_SRC, /svcPaySummaryView\(raw\)/, "summary ต้องผ่าน fail-closed view");
  assert.match(RENDER_SRC, /DATA_INCOMPLETE/, "แจ้ง user ชัดว่าอ่านไม่ได้");
  const failBranch = RENDER_SRC.slice(RENDER_SRC.indexOf("if (!view.ok)"), RENDER_SRC.indexOf("elPaid.textContent = money"));
  assert.match(failBranch, /btn\.disabled = true/, "อ่านไม่ได้ = ปิดปุ่มรับชำระ");
  assert.match(failBranch, /return/, "fail branch ต้องจบ ไม่ไหลไปแสดงตัวเลข");
  assert.match(RENDER_SRC, /mySeq !== _svcPayReqSeq\) return/, "stale response ต้องถูกทิ้ง (generation token)");
  assert.match(RENDER_SRC, /const jobId = job\.id/, "ผล async ผูกกับ jobId ผ่าน closure");
});
test("S7. รับชำระห้ามแตะ job.status และใช้ jvResultToToast สำหรับ success", () => {
  const submitIdx = RENDER_SRC.indexOf("_svcPayGuard.run(");
  const submit = RENDER_SRC.slice(submitIdx);
  assert.doesNotMatch(submit, /status\s*[:=]/, "handler รับชำระห้ามเขียน/ส่ง status ใด ๆ");
  assert.match(submit, /jvResultToToast\(res\.jv\)/, "success ต้องใช้ toast mapper กลาง");
  assert.doesNotMatch(RENDER_SRC, /\balert\(/, "ห้าม alert()");
});
