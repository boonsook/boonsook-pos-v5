// Phase 606-0 — S4.1c recovery paused + finance-flow legacy taxonomy
//
// (A) HARD-BLOCK: `--apply` ของ recovery runner ต้องตายก่อนเขียนอะไรทั้งสิ้น ทุก combination
//     (มี --plan/--confirm ครบก็ยังบล็อก) — เหตุผล: แผน S4.1c ตั้งบนสมมติฐาน "ส่งมอบ = ได้เงินสด"
//     ซึ่งผิดโมเดลบัญชี (ส่งมอบ = ลูกหนี้ 1200; รับเงินเป็นอีกเหตุการณ์). ปลดล็อกได้หลัง Phase 606/607
// (B) TAXONOMY: งานเก่า (flow v1) ต้องแยก POSTED (informational, ห้ามแตะ) ออกจาก NO_JV (ยังเป็นปัญหา)
//     และแยกจาก FLOW_V2_* — ห้ามยุบรวมจนปัญหาหาย
//
// ★ ห้าม hardcode จำนวนงาน production เป็น business rule ในเทสต์
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  RECOVERY_APPLY_DISABLED, RECOVERY_PAUSED_REASON, RECOVERY_PAUSED_MESSAGE, CONFIRM_TOKEN,
} from "../scripts/service_no_jv_recover_lib.js";
import {
  SERVICE_FLOW_STATES, financeFlowVersionOf, classifyServiceFlowState, summarizeServiceFlow,
} from "../scripts/service_no_jv_classify_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "")).join("\n");
const RUNNER = read("scripts/service_no_jv_recover.js");
const RUNNER_CODE = stripComments(RUNNER);

const job = (o = {}) => ({
  id: 1, job_no: "TEST-1", job_type: "repair_ac", status: "delivered",
  created_at: "2026-07-08T03:00:00Z", closed_at: "2026-07-09T03:00:00Z",
  total_cost: 1000, payment_method: "cash", note: "", sub_service: "", ...o
});
const je = (o = {}) => ({ id: 900, source_table: "service_jobs", source_id: 1, status: "approved", ...o });

// ═══ A. hard-block ═══════════════════════════════════════
test("A1. runner: --apply ตายก่อน login/fetch/CAS/JV ทุกกรณี (zero writes โดยลำดับโค้ด)", () => {
  assert.equal(RECOVERY_APPLY_DISABLED, true);
  assert.equal(RECOVERY_PAUSED_REASON, "SERVICE_RECOVERY_PAUSED_PAYMENT_TRUTH");
  const blockIdx = RUNNER_CODE.indexOf("if (APPLY_FLAG && R.RECOVERY_APPLY_DISABLED)");
  assert.ok(blockIdx > 0, "ต้องมี hard-block gate");
  const gate = RUNNER_CODE.slice(blockIdx, blockIdx + 400);
  assert.match(gate, /process\.exit\(1\)/, "hard-block ต้อง exit 1");
  // ★ ต้องอยู่ "ก่อน" การโหลด .env ด้วย → บล็อกได้แม้เครื่องไม่มี credential (และ CI ก็รันเทสต์นี้ได้)
  for (const marker of ["function loadEnv", "const env = loadEnv", "assertPublishableKey(ANON)"]) {
    const at = RUNNER_CODE.indexOf(marker);
    assert.ok(at > blockIdx, `hard-block ต้องมาก่อน ${marker}`);
  }
  // และก่อนทุกจุดที่เขียน/ยิงเน็ต
  for (const marker of ["async function signIn", "async function casSetClosedAt", "postJournalForServiceJob", "async function main"]) {
    const at = RUNNER_CODE.indexOf(marker);
    assert.ok(at > blockIdx, `hard-block ต้องมาก่อน ${marker} (พบที่ ${at} vs gate ${blockIdx})`);
  }
  // APPLY ต้องถูกบังคับ false แม้ธงครบ
  assert.match(RUNNER_CODE, /const APPLY = APPLY_FLAG && CONFIRM === R\.CONFIRM_TOKEN && !R\.RECOVERY_APPLY_DISABLED/);
});

test("A2. behavioral: ทุก combination ของ --apply → exit 1 + zero writes (แม้ในเครื่องที่ไม่มี .env เลย)", () => {
  const combos = [
    ["2026-07", "--apply"],
    ["2026-07", "--apply", `--confirm=${CONFIRM_TOKEN}`],
    ["2026-07", "--apply", `--confirm=${CONFIRM_TOKEN}`, "--plan=/tmp/whatever.json"],
    ["2026-07", "--apply", `--confirm=${CONFIRM_TOKEN}`, "--plan=/tmp/whatever.json", "--strict"],
  ];
  for (const args of combos) {
    let code = 0;
    let out;
    try {
      // ★ รันจาก temp cwd ที่ "ไม่มี .env" → พิสูจน์ว่า hard-block เกิดก่อนโหลด credential
      //   (ถ้า gate อยู่หลัง env จะได้ exit 2 ".env not found" แทน = เทสต์นี้จับได้)
      out = execFileSync(process.execPath, [path.join(ROOT, "scripts/service_no_jv_recover.js"), ...args], { cwd: os.tmpdir(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = e.status;
      out = String(e.stdout || "") + String(e.stderr || "");
    }
    assert.equal(code, 1, `combo ${args.join(" ")} ต้อง exit 1 (ได้ ${code})`);
    assert.match(out, /SERVICE_RECOVERY_PAUSED_PAYMENT_TRUTH/, "ต้องบอกเหตุผลที่พัก");
    assert.doesNotMatch(out, /\.env not found/, "ต้องบล็อกก่อนถึงขั้นโหลด env");
    // ต้องไม่ทันไปแตะเครือข่าย/DB เลย (ไม่มี output ของขั้นตอน fetch/preflight)
    assert.doesNotMatch(out, /Preflight|candidate ตอนนี้|CAS PATCH/, "ต้องตายก่อนถึงขั้น fetch/preflight");
  }
});

test("A3. preview (ไม่มี --apply) ยัง read-only ตามเดิม — hard-block ไม่ไปโดน", () => {
  // ไม่รันจริง (ต้องมี .env/production) — ตรวจว่า gate ผูกกับ APPLY_FLAG เท่านั้น
  assert.match(RUNNER_CODE, /if \(APPLY_FLAG && R\.RECOVERY_APPLY_DISABLED\)/);
  assert.ok(!/if \(R\.RECOVERY_APPLY_DISABLED\)\s*\{[\s\S]{0,80}process\.exit/.test(RUNNER_CODE),
    "ห้ามบล็อก preview (ต้องเช็ค APPLY_FLAG ด้วย)");
  assert.match(RUNNER, /ใช้ preview ได้/, "runner ต้องบอกทางออกว่า preview ยังใช้ได้");
  assert.ok(RECOVERY_PAUSED_MESSAGE.includes("Dr 1200"), "ข้อความต้องอธิบายโมเดลบัญชีที่ถูกต้อง");
  assert.ok(RECOVERY_PAUSED_MESSAGE.includes("preview"), "ข้อความต้องบอกว่า preview ยังใช้ได้");
});

// ═══ B. finance-flow taxonomy ════════════════════════════
test("B1. flow version: ไม่มีคอลัมน์/null/ค่าเพี้ยน = v1 (legacy) · >=2 = v2", () => {
  assert.equal(financeFlowVersionOf(job()), 1);                                  // ยังไม่มีคอลัมน์
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: null })), 1);
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: "ขยะ" })), 1);
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: 1 })), 1);
  assert.equal(financeFlowVersionOf(job({ finance_flow_version: 2 })), 2);
});

test("B2. 4 สถานะแยกกันจริง: legacy posted ≠ legacy no-jv ≠ v2 posted ≠ v2 no-jv", () => {
  assert.equal(classifyServiceFlowState(job(), [je()]), SERVICE_FLOW_STATES.LEGACY_FLOW_V1_POSTED);
  assert.equal(classifyServiceFlowState(job(), []), SERVICE_FLOW_STATES.LEGACY_FLOW_V1_NO_JV);
  assert.equal(classifyServiceFlowState(job({ finance_flow_version: 2 }), [je()]), SERVICE_FLOW_STATES.FLOW_V2_POSTED);
  assert.equal(classifyServiceFlowState(job({ finance_flow_version: 2 }), []), SERVICE_FLOW_STATES.FLOW_V2_NO_JV);
  // JE ที่ไม่ approved / คนละ source ไม่นับเป็น posted
  assert.equal(classifyServiceFlowState(job(), [je({ status: "draft" })]), SERVICE_FLOW_STATES.LEGACY_FLOW_V1_NO_JV);
  assert.equal(classifyServiceFlowState(job(), [je({ source_table: "sales" })]), SERVICE_FLOW_STATES.LEGACY_FLOW_V1_NO_JV);
  assert.equal(classifyServiceFlowState(job(), [je({ source_id: 999 })]), SERVICE_FLOW_STATES.LEGACY_FLOW_V1_NO_JV);
});

test("B3. summarize: legacy posted = informational · legacy NO_JV = ปัญหา · pre-effective ไม่ใช่ปัญหา", () => {
  const jobs = [
    job({ id: 1, job_no: "A", total_cost: 1000 }),                              // legacy posted
    job({ id: 2, job_no: "B", total_cost: 500 }),                               // legacy no-jv (ปัญหา)
    job({ id: 3, job_no: "C", total_cost: 700, finance_flow_version: 2 }),      // v2 posted
    job({ id: 4, job_no: "D", total_cost: 300, finance_flow_version: 2 }),      // v2 no-jv (ปัญหา)
    job({ id: 5, job_no: "E", status: "pending" }),                             // ไม่ใช่ income → ไม่นับ
    job({ id: 6, job_no: "F", status: "cancelled" }),                           // ยกเลิก → ไม่นับ
    job({ id: 7, job_no: "G", note: "[ลบแล้ว]" }),                              // ลบ → ไม่นับ
    job({ id: 8, job_no: "H", sub_service: "สั่งซื้อสินค้า" }),                    // web order → ไม่นับ
    // ★ ปิดงานก่อน effective (1 ก.ค.) + ไม่มี JV = ตั้งใจไม่ลง → ห้ามนับเป็นปัญหา
    job({ id: 9, job_no: "I", total_cost: 9000, closed_at: "2026-06-20T04:00:00Z" }),
  ];
  const entries = new Map([
    ["1", [je({ source_id: 1 })]],
    ["3", [je({ id: 901, source_id: 3 })]],
  ]);
  const s = summarizeServiceFlow(jobs, entries);
  assert.equal(s.scanned, 5, "นับเฉพาะ income + non-web + ไม่ลบ/ไม่ยกเลิก");
  assert.equal(s.states.LEGACY_FLOW_V1_POSTED.count, 1);
  assert.equal(s.states.LEGACY_FLOW_V1_POSTED.amount, 1000);
  assert.equal(s.states.LEGACY_FLOW_V1_NO_JV.count, 1);
  assert.equal(s.states.LEGACY_FLOW_V1_NO_JV.amount, 500);
  assert.equal(s.states.FLOW_V2_POSTED.count, 1);
  assert.equal(s.states.FLOW_V2_NO_JV.count, 1);
  assert.equal(s.states.PRE_EFFECTIVE_EXPECTED_UNPOSTED.count, 1);
  assert.equal(s.states.PRE_EFFECTIVE_EXPECTED_UNPOSTED.amount, 9000);
  // ★ ปัญหา = NO_JV หลัง effective เท่านั้น (legacy posted และ pre-effective ต้องไม่ถูกนับ)
  assert.equal(s.problemCount, 2);
  assert.equal(s.problemAmount, 800);
  assert.equal(s.partitionOk, true, "ทุกงานที่ scan ต้องอยู่ใน state ใด state หนึ่ง ครั้งเดียว");
  // pre-effective ที่ "มี JV" กลับต้องเป็น posted ตามจริง (ไม่กลบ anomaly)
  const withJv = summarizeServiceFlow(
    [job({ id: 9, job_no: "I", total_cost: 9000, closed_at: "2026-06-20T04:00:00Z" })],
    new Map([["9", [je({ id: 902, source_id: 9 })]]])
  );
  assert.equal(withJv.states.LEGACY_FLOW_V1_POSTED.count, 1);
  assert.equal(withJv.states.PRE_EFFECTIVE_EXPECTED_UNPOSTED.count, 0);
});

test("B3b. web order ทั้ง 3 writer ต้องไม่ถูกนับเป็นงานบริการ (AI-/SH-/customer_dashboard) — งาน JOB-* ยังเป็น service", () => {
  // marker จริงจาก writer (ตรวจกับ source เพื่อกัน drift)
  const aiSrc = read("modules/ai_sales.js");
  const shopSrc = read("modules/ac_shop.js");
  assert.match(aiSrc, /const jobNo = "AI-" \+ Date\.now\(\)/, "ai_sales ต้องยังใช้ job_no AI-*");
  assert.match(aiSrc, /note: `AI Sales: /, "ai_sales ต้องยังใช้ note 'AI Sales:'");
  assert.match(shopSrc, /const jobNo = "SH-" \+ Date\.now\(\)/, "ac_shop ต้องยังใช้ job_no SH-*");
  assert.match(shopSrc, /note: `AC Shop: /, "ac_shop ต้องยังใช้ note 'AC Shop:'");

  const web = [
    job({ id: 11, job_no: "AI-MABC12", note: "AI Sales: แอร์ 12000 BTU | ราคา 15,900 บาท", total_cost: 15900 }),   // ai_sales
    job({ id: 12, job_no: "SH-MXYZ99", note: "AC Shop: แอร์ 18000 BTU | ราคา 22,900 บาท", total_cost: 22900 }),    // ac_shop
    job({ id: 13, job_no: "JOB-9", note: "SH-transfer|slip.jpg", total_cost: 5000 }),                              // customer_dashboard (เดิม)
    job({ id: 14, job_no: "JOB-10", sub_service: "สั่งซื้อสินค้า", total_cost: 3000 }),                              // เดิม
  ];
  const svc = [
    job({ id: 15, job_no: "JOB-11", note: "ล้างแอร์ 2 เครื่อง", total_cost: 1000 }),                                 // งานบริการปกติ
    job({ id: 16, job_no: "JOB-12", note: "งานช่าง: เปลี่ยนคอมเพรสเซอร์", total_cost: 2000 }),
  ];
  const s = summarizeServiceFlow([...web, ...svc], new Map());
  assert.equal(s.scanned, svc.length, "web order ทั้ง 4 รูปแบบต้องถูกกันออกจาก taxonomy งานบริการ");
  assert.equal(s.states.LEGACY_FLOW_V1_NO_JV.count, 2);
  assert.equal(s.states.LEGACY_FLOW_V1_NO_JV.amount, 3000, "ยอดต้องมีแต่งานบริการจริง (ไม่ปนออเดอร์เว็บ)");
  // งานบริการที่ note บังเอิญมีคำว่า AI/SH อยู่ตรงกลาง ต้องไม่ถูกจับผิดเป็น web order
  const tricky = summarizeServiceFlow([job({ id: 17, job_no: "JOB-13", note: "ลูกค้าถามผ่าน AI Sales: แต่เป็นงานซ่อม", total_cost: 900 })], new Map());
  assert.equal(tricky.scanned, 1, "marker ต้อง match แบบ 'ขึ้นต้น' เท่านั้น ไม่ใช่ substring");
});

test("B4. classify runner รายงาน taxonomy ทั้ง 4 สถานะ และไม่ hardcode จำนวนงาน production", () => {
  const src = read("scripts/service_no_jv_classify.js");
  const block = src.slice(src.indexOf("Finance-flow taxonomy"), src.indexOf("## สรุป"));
  for (const st of Object.values(SERVICE_FLOW_STATES)) {
    assert.ok(block.includes(st), `รายงานต้องมีบรรทัด ${st}`);
  }
  assert.match(block, /ที่ยังเป็นปัญหา/, "ต้องสรุปยอดที่ยังเป็นปัญหาแยกจาก legacy posted");
  const lib = read("scripts/service_no_jv_classify_lib.js");
  assert.ok(!/\b75\b|\b6950\b/.test(lib), "ห้าม hardcode ตัวเลขงาน/ยอด production ใน lib");
});
