// ═════════════════════════════════════════════════
//  Phase 606-b2 — guard: UI รับชำระงานบริการ flow v2 (drawer)
// ═════════════════════════════════════════════════
//  Invariants:
//  I3  ผลรับชำระอ่าน accountingPosted — ห้ามใช้ res.ok เดี่ยวตัดสิน "ลงบัญชีแล้ว" (คู่ guard D8)
//  I4  ห้าม INSERT service_payments ตรง — เขียนผ่าน recordServicePayment (RPC) เท่านั้น
//  ★  intent snapshot ทั้งก้อน (key + paid_at + bank) — retry ส่งค่าเดิมทุก field (RPC เทียบครบ → 23505)
//  ★  summary fail-closed: RPC null/fail = DATA_INCOMPLETE + disable submit — ห้ามเดา paid=0
//  ★  ปุ่มเป็น state-driven: เปิดได้เฉพาะ summaryOk && outstanding>0 && ไม่มี request inflight
//     (review#196 Blocking#1 — ห้าม finally เปิดปุ่ม unconditional)
//  ★  render generation แยกจาก summary sequence: payment งาน A ที่จบหลังเปิดงาน B
//     ห้าม toast/แตะ DOM/แตะ sequence ของ B (review#196 Blocking#2)
//  ส่วน BEHAVIORAL (H*) รัน render + handler จริงบน fake DOM ผ่าน node:vm
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

// ─── pure helpers (vm realm — เทียบรายฟิลด์ ไม่ใช้ deepEqual ข้าม realm) ───
const pureBox = {};
vm.createContext(pureBox);
vm.runInContext(
  `${SUMMARY_SRC}\n${INTENT_SRC}\n${RESULT_SRC}\n` +
  `globalThis.__sum = svcPaySummaryView; globalThis.__intent = svcPayIntentFor; globalThis.__res = svcPayResultPlan;`,
  pureBox);
const sum = pureBox.__sum, intentFor = pureBox.__intent, resultPlan = pureBox.__res;

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
  const z = sum(0);
  assert.equal(z.ok, true); assert.equal(z.paid, 0); assert.equal(z.disableSubmit, false);
  const f = sum("1500.50");
  assert.equal(f.ok, true); assert.equal(f.paid, 1500.5); assert.equal(f.disableSubmit, false);
});
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
test("B5. !ok → error · ok+!accountingPosted → ledger-only เตือน · ok+posted → posted", () => {
  const e = resultPlan({ ok: false, error: "23514: เกินยอดคงค้าง" });
  assert.equal(e.kind, "error");
  assert.match(e.message, /23514/);
  const half = resultPlan({ ok: true, ledgerRecorded: true, accountingPosted: false });
  assert.equal(half.kind, "ledger-only");
  assert.match(half.message, /ยังไม่ลงบัญชี/);
  assert.match(half.message, /Service Reconcile/);
  const full = resultPlan({ ok: true, accountingPosted: true, jv: {} });
  assert.equal(full.kind, "posted");
  assert.equal(resultPlan(null).kind, "error", "res หาย = error ไม่ใช่เงียบ");
});
test("B6. ok:true อย่างเดียว (ไม่มี accountingPosted) ต้องไม่ถูกฉลองเป็นสำเร็จเต็ม", () => {
  const p = resultPlan({ ok: true });
  assert.equal(p.kind, "ledger-only", "ok เดี่ยว ๆ = ledger รับแล้วเท่านั้น (guard D8)");
});

// ═══════════════════════════════════════════════════════════
//  H. BEHAVIORAL — รัน _renderServicePaymentSection + handler จริงบน fake DOM (node:vm)
// ═══════════════════════════════════════════════════════════
const tick = () => new Promise((r) => setImmediate(r));
const ticks = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };

function makeHarness() {
  const toasts = [];
  const registry = {};
  function fakeEl(tag) {
    return {
      tag, id: "", children: [], listeners: {}, style: {}, disabled: false, value: "",
      textContent: "", _html: "",
      appendChild(c) { this.children.push(c); if (c.id) registry[c.id] = c; return c; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    };
  }
  const host = fakeEl("div"); host.id = "svcPaySection"; registry.svcPaySection = host;
  const rpcCalls = [];
  const sandbox = {
    document: {
      createElement: (t) => fakeEl(t),
      getElementById: (id) => registry[id] || null,
    },
    requireAdmin: () => true,
    serviceFinanceFlowOf: (j) => (j && (j.finance_flow_version === 1 || j.finance_flow_version === 2)) ? j.finance_flow_version : null,
    money: (n) => "฿" + Number(n).toFixed(2),
    showToast: (m) => toasts.push(String(m)),
    jvResultToToast: () => ({ message: "JV posted ✓" }),
    crypto: { randomUUID: (() => { let n = 0; return () => "uuid-" + (++n); })() },
    // ควบคุมจาก test: paidByJob[jobId] = ค่า rpc คืน (null = fail)
    state: {
      paymentInfo: { banks: [{ bankName: "KBANK", bankAccount: "140-8", coaCode: "1134" }] },
      supabase: { rpc: async (fn, args) => { rpcCalls.push(args.p_job_id); const v = sandbox.__paidByJob[args.p_job_id]; return (v === undefined || v === null) ? { data: null, error: { message: "boom" } } : { data: v, error: null }; } },
    },
    __paidByJob: {},
    // recordServicePayment ควบคุมได้: คิว resolver (FIFO ต่อการ click)
    __payQueue: [],
    recordServicePayment: (p) => new Promise((resolve) => { sandbox.__payQueue.push({ payload: p, resolve }); }),
    setImmediate,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `let _svcPayRenderGen = 0;\n${SUMMARY_SRC}\n${INTENT_SRC}\n${RESULT_SRC}\n${RENDER_SRC}\n` +
    `globalThis.__render = _renderServicePaymentSection;`,
    sandbox);
  const find = (el, id) => {
    if (el.id === id) return el;
    for (const c of el.children || []) { const r = find(c, id); if (r) return r; }
    return null;
  };
  return {
    sandbox, host, toasts, rpcCalls,
    render: (job) => sandbox.__render(job),
    btn: () => find(host, "svcPaySubmitBtn"),
    amt: () => find(host, "svcPayAmount"),
    text: () => JSON.stringify(host, (k, v) => (k === "listeners" ? undefined : v)),
  };
}

test("H1. payment สำเร็จ แต่ summary refresh หลังจ่าย fail → ปุ่มยังคง disabled จริง", async () => {
  const h = makeHarness();
  h.sandbox.__paidByJob[11] = 0;   // summary แรกอ่านได้: paid 0 / outstanding 1000
  h.render({ id: 11, status: "delivered", total_cost: 1000, finance_flow_version: 2, note: "" });
  await ticks();
  assert.equal(h.btn().disabled, false, "summary ok + outstanding>0 → ปุ่มเปิด");
  h.sandbox.__paidByJob[11] = null;  // refresh รอบหลังจ่าย = fail
  h.btn().listeners.click[0]();
  await ticks();
  h.sandbox.__payQueue.shift().resolve({ ok: true, accountingPosted: true, jv: {} });
  await ticks();
  assert.equal(h.btn().disabled, true, "summary หลังจ่ายอ่านไม่ได้ (DATA_INCOMPLETE) → ปุ่มต้อง disabled");
  assert.ok(h.toasts.some(t => t.includes("DATA_INCOMPLETE")), "ต้องแจ้ง DATA_INCOMPLETE");
});

test("H2+H3. A submit ค้าง → เปิด B → A resolve: ไม่มี toast/DOM/sequence กระทบ B; B เปิดปุ่มตามยอดของ B", async () => {
  const h = makeHarness();
  h.sandbox.__paidByJob[21] = 0;     // งาน A: total 1000, paid 0
  h.render({ id: 21, status: "delivered", total_cost: 1000, finance_flow_version: 2, note: "" });
  await ticks();
  h.btn().listeners.click[0]();      // A submit — payment promise ค้าง
  await ticks();
  const pendingA = h.sandbox.__payQueue.shift();
  assert.equal(pendingA.payload.serviceJobId, 21);
  h.sandbox.__paidByJob[22] = 500;   // งาน B: total 2000, paid 500 → outstanding 1500
  h.render({ id: 22, status: "delivered", total_cost: 2000, finance_flow_version: 2, note: "" });
  await ticks();
  assert.equal(h.btn().disabled, false, "H3: summary ของ B จบและเปิดปุ่มตามยอดของ B");
  assert.equal(h.amt().value, "1500", "จำนวนเงิน prefill = outstanding ของ B");
  const domBefore = h.text();
  const toastsBefore = h.toasts.length;
  const rpcBefore = h.rpcCalls.length;
  pendingA.resolve({ ok: true, accountingPosted: true, jv: {} });   // A จบหลังเปิด B
  await ticks(8);
  assert.equal(h.toasts.length, toastsBefore, "H2: A resolve ห้ามมี toast ใหม่");
  assert.equal(h.text(), domBefore, "H2: DOM ของ B ต้องไม่ถูกแตะ");
  assert.equal(h.rpcCalls.length, rpcBefore, "H2: A ห้ามยิง refresh summary ทับ sequence ของ B");
  assert.equal(h.btn().disabled, false, "ปุ่ม B ยังใช้ได้ตาม state ของ B");
});

test("H4. จ่ายครบ (outstanding=0) → ปุ่ม disabled และช่องจำนวนว่าง", async () => {
  const h = makeHarness();
  h.sandbox.__paidByJob[31] = 800;   // total 800 = paid ครบ
  h.render({ id: 31, status: "delivered", total_cost: 800, finance_flow_version: 2, note: "" });
  await ticks();
  assert.equal(h.btn().disabled, true, "outstanding=0 → ปุ่มต้อง disabled");
  assert.equal(h.amt().value, "", "จ่ายครบ → ช่องจำนวนต้องว่าง");
});

test("H5. summary แรกอ่านไม่ได้ → ปุ่มไม่เคยเปิด + งาน v1 ไม่มี DOM", async () => {
  const h = makeHarness();
  h.sandbox.__paidByJob[41] = null;
  h.render({ id: 41, status: "delivered", total_cost: 900, finance_flow_version: 2, note: "" });
  await ticks();
  assert.equal(h.btn().disabled, true, "DATA_INCOMPLETE ตั้งแต่แรก → ปุ่ม disabled");
  h.render({ id: 42, status: "delivered", total_cost: 900, finance_flow_version: 1, note: "" });
  await ticks();
  assert.equal(h.host.children.length, 0, "งาน v1 = container ว่างจริง");
});

// ═══════════════════════════════════════════════════════════
//  S. STRUCTURAL
// ═══════════════════════════════════════════════════════════
test("S1. handler ตัดสินผลผ่าน svcPayResultPlan (อ่าน accountingPosted) — ไม่มีเส้น success จาก res.ok เดี่ยว", () => {
  assert.match(RENDER_SRC, /svcPayResultPlan\(res\)/, "ต้อง map ผลผ่าน planner");
  assert.match(RESULT_SRC, /res\.accountingPosted/, "planner ต้องอ่าน accountingPosted");
  assert.doesNotMatch(RENDER_SRC, /if\s*\(\s*res\.ok\s*\)[^]{0,80}showToast/,
    "ห้ามมี success-toast ที่ตัดสินจาก res.ok เดี่ยว ๆ");
});
test("S2. ปุ่ม state-driven — ไม่มี finally เปิดปุ่ม unconditional; submit ครอบด้วย submitting flag", () => {
  assert.doesNotMatch(RENDER_SRC, /finally\s*\{[^}]*disabled\s*=\s*false/,
    "ห้าม finally { btn.disabled = false } unconditional (Blocking#1)");
  assert.match(RENDER_SRC, /S\.submitting = true; syncBtn\(\)/, "submit ต้องตั้ง flag + sync ก่อน await");
  assert.match(RENDER_SRC, /if \(S\.submitting \|\| S\.summaryInflight \|\| !S\.summaryOk\) return;/,
    "handler ต้องมี belt กัน re-enter ตาม state");
  assert.match(RENDER_SRC, /btn\.disabled = S\.submitting \|\| S\.summaryInflight \|\| !S\.summaryOk \|\| !\(S\.outstanding > 0\)/,
    "ปุ่มเปิดได้เฉพาะ summaryOk && outstanding>0 && ไม่มี inflight");
  assert.match(RENDER_SRC, /idempotencyKey: intent\.key/, "key จาก snapshot");
  assert.match(RENDER_SRC, /paidAt: intent\.paidAt/, "paid_at จาก snapshot (ห้ามคำนวณใหม่ตอน retry)");
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
test("S6. render generation แยกจาก summary sequence + gen check ก่อน UI-effect หลังจ่าย", () => {
  assert.match(RENDER_SRC, /const myGen = \+\+_svcPayRenderGen/, "render ต้อง bump generation");
  assert.match(RENDER_SRC, /myGen !== _svcPayRenderGen \|\| mySeq !== sumSeq\) return;/,
    "summary stale ต้องเช็คทั้ง generation และ sequence");
  const posGenCheck = RENDER_SRC.indexOf("if (myGen !== _svcPayRenderGen) return;");
  const posPlan = RENDER_SRC.indexOf("svcPayResultPlan(res)");
  const posAwaitPay = RENDER_SRC.indexOf("await recordServicePayment");
  assert.ok(posGenCheck > 0, "submit ต้องมี generation check หลัง await");
  assert.ok(posAwaitPay < posGenCheck && posGenCheck < posPlan,
    "gen check ต้องอยู่หลัง await payment และก่อน toast/intent-reset/refresh ทุกอย่าง (Blocking#2)");
  assert.match(RENDER_SRC, /svcPaySummaryView\(raw\)/);
  assert.match(RENDER_SRC, /DATA_INCOMPLETE/);
  assert.match(RENDER_SRC, /const jobId = job\.id/, "ผล async ผูกกับ jobId ผ่าน closure");
});
test("S7. รับชำระห้ามแตะ job.status และใช้ jvResultToToast สำหรับ success · ห้าม alert", () => {
  const submitIdx = RENDER_SRC.indexOf("btn.addEventListener(\"click\"");
  const submit = RENDER_SRC.slice(submitIdx);
  assert.doesNotMatch(submit, /\bstatus\s*[:=]/, "handler รับชำระห้ามเขียน/ส่ง status ใด ๆ");
  assert.match(submit, /jvResultToToast\(res\.jv\)/, "success ต้องใช้ toast mapper กลาง");
  assert.doesNotMatch(RENDER_SRC, /\balert\(/, "ห้าม alert()");
});
test("S8. state/intent เป็น per-render closure — ไม่มี global intent/guard ข้ามงาน", () => {
  assert.doesNotMatch(MAIN, /_svcPayIntent|_svcPayGuard|_svcPayReqSeq/,
    "global intent/guard เดิมถูกแทนด้วย per-render closure แล้ว (งาน A แชร์ key/state กับงาน B ไม่ได้)");
  assert.match(RENDER_SRC, /let intent = null;/, "intent ต้องอยู่ใน closure ของ section");
  assert.match(RENDER_SRC, /const S = \{ summaryOk: false/, "summary state ต้องอยู่ใน closure ของ section");
});
