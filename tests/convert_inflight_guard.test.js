// Phase 412 — Convert-doc inflight guard + เช็คผล item/status writes
// invariant: ระหว่าง convert ครั้งหนึ่งยังไม่จบ trigger ซ้ำจากทุกทางเข้า → no-op + toast
//            → เอกสารถูกสร้าง "ใบเดียว"; ทุก write รู้ผล — fail มีเสียงเสมอ
//   - _qtConvertInflight / _diConvertInflight: เช็คก่อน duplicate-check + finally reset
//   - items loop: failedItems + !ir?.ok + toast partial (ห้าม rollback header)
//   - PATCH status ทุกจุด: assign ตัวแปร + fail-branch (เตือน ไม่ rollback)
//
// Source-regex (iron rule #5: extract body ของฟังก์ชันเป้าหมายก่อน — ห้าม grep ทั้งไฟล์)
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

// ดึง source ของ 1 ฟังก์ชัน (จาก decl ถึง decl ของฟังก์ชันถัดไป)
function fnSource(src, decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const after = src.indexOf("\nasync function ", start + decl.length);
  const end = after === -1 ? src.indexOf("\nfunction ", start + decl.length) : after;
  return src.slice(start, end === -1 ? undefined : end);
}

const CASES = [
  {
    file: "modules/quotations.js",
    decl: "async function convertToDeliveryInvoice(q) {",
    flag: "_qtConvertInflight",
    table: "delivery_invoice_items",
    label: "convertToDeliveryInvoice",
  },
  {
    file: "modules/delivery_invoices.js",
    decl: "async function convertToReceipt(inv) {",
    flag: "_diConvertInflight",
    table: "receipt_items",
    label: "convertToReceipt",
  },
];

for (const c of CASES) {
  const src = read(c.file);
  const fn = fnSource(src, c.decl);

  test(`${c.label}: flag ${c.flag} ประกาศ module-level`, () => {
    assert.match(src, new RegExp(`^let ${c.flag} = false;`, "m"),
      `${c.flag} ต้องประกาศ module-level (let ... = false)`);
  });

  test(`${c.label}: inflight check + toast + early-return อยู่ "ก่อน" duplicate-check fetch · set true · finally reset`, () => {
    const guardIdx = fn.indexOf(`if (${c.flag}) return window.App?.showToast?.(`);
    const setIdx = fn.indexOf(`${c.flag} = true;`);
    const dupIdx = fn.indexOf("/rest/v1/");   // duplicate-check fetch แรกในฟังก์ชัน
    assert.notEqual(guardIdx, -1, "ต้องมี inflight early-return + toast");
    assert.notEqual(setIdx, -1, "ต้อง set flag = true");
    assert.notEqual(dupIdx, -1, "ต้องยังมี duplicate-check fetch");
    assert.ok(guardIdx < setIdx && setIdx < dupIdx, "ลำดับต้องเป็น guard → set true → duplicate-check");
    const fin = fn.match(/\} finally \{([\s\S]*?)\}/);
    assert.ok(fin, "ต้องมี finally block");
    assert.match(fin[1], new RegExp(`${c.flag} = false;`), "finally ต้อง reset flag (early return ทุกจุดผ่าน)");
  });

  test(`${c.label}: items loop เช็คผล insert (${c.table}) + toast partial หลัง loop`, () => {
    assert.match(fn, /const failedItems = \[\];/, "ต้องมี failedItems");
    assert.match(fn, new RegExp(`const ir = await xhrPost\\("${c.table}"`), "ผล insert ต้องถูก capture");
    assert.match(fn, /if \(!ir\?\.ok\) failedItems\.push/, "insert fail ต้อง push failedItems");
    assert.match(fn, /failedItems\.length > 0/, "ต้องมี branch แจ้ง partial fail หลัง loop");
    assert.match(fn, /แต่บันทึกรายการไม่สำเร็จ/, "toast partial ต้องบอกว่าใบสร้างแล้วแต่รายการขาด");
  });

  test(`${c.label}: PATCH status ถูก assign + มี fail-branch (เตือน ไม่ rollback)`, () => {
    assert.match(fn, /=\s*await xhrPatch\("(quotations|delivery_invoices)",\s*\{\s*status/,
      "ทุก xhrPatch status ต้อง assign ตัวแปร");
    assert.ok(!/^\s*await xhrPatch\(/m.test(fn), "ห้ามมี xhrPatch แบบ fire-and-forget (ไม่เช็คผล) เหลือ");
    assert.match(fn, /อัปเดตสถานะเอกสารต้นทางไม่สำเร็จ/, "fail-branch ต้อง toast เตือน");
  });

  test(`${c.label}: branch 409 ยังอยู่ครบ + ไม่มี alert()`, () => {
    assert.match(fn, /if \(active\.length > 0\) \{[\s\S]*?showToast[\s\S]*?return;/,
      "branch active → showToast + return (Phase 409) ต้องไม่ถูกแตะ");
    assert.match(fn, /status !== "cancelled"/, "filter cancelled ต้องคงเดิม");
    assert.ok(!/\balert\(/.test(fn), "ห้ามมี alert()");
  });
}

// convertToReceipt: PATCH quotations (sp2) ต้องถูกเช็คด้วย (มี 2 จุด — เตือนครั้งเดียว)
test("convertToReceipt: PATCH ทั้ง delivery_invoices และ quotations ถูกเช็คผลรวมกัน", () => {
  const fn = fnSource(read("modules/delivery_invoices.js"), "async function convertToReceipt(inv) {");
  assert.match(fn, /const sp1 = await xhrPatch\("delivery_invoices",\s*\{\s*status/, "sp1 = patch DI status");
  assert.match(fn, /sp2 = await xhrPatch\("quotations",\s*\{\s*status/, "sp2 = patch quotation status");
  assert.match(fn, /!sp1\?\.ok \|\| \(inv\.quotation_id && !sp2\?\.ok\)/, "เช็ครวม sp1/sp2 → toast เดียว");
});
