// Phase 612 — ลายน้ำบนเอกสารต้องมีไว้เตือน "เอกสารใช้ไม่ได้" เท่านั้น
//
// owner ใช้เอกสารพวกนี้ส่งราชการ: ใบเสร็จปกติเคยขึ้น "ชำระแล้ว" ทับกลางใบทุกใบ
// ทำให้ส่งงานไม่ได้ ส่วนใบส่งสินค้า/ใบเสนอราคาทำถูกอยู่แล้ว (โชว์เฉพาะ cancelled/expired)
//
// guard นี้ล็อกกติกาเดียวกันให้ทั้งสามเทมเพลต: **สถานะปกติ = ไม่มีลายน้ำ**
// และยังต้องเก็บลายน้ำเตือนไว้ครบ (ยกเลิก/หมดอายุ) เพราะมีคุณค่ากันเอกสารที่ใช้ไม่ได้ถูกนำไปใช้

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(__dirname2, "..", "modules", f), "utf8");
const receiptsSrc = read("receipts.js");
const invoicesSrc = read("delivery_invoices.js");
const quotationsSrc = read("quotations.js");

// ตัดคอมเมนต์ก่อนสแกน — คอมเมนต์ที่อธิบายว่า "เดิมเคยขึ้นชำระแล้ว" ไม่ใช่การขึ้นจริง
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("ใบเสร็จสถานะปกติต้องไม่มีลายน้ำ (ห้ามกลับมาขึ้น 'ชำระแล้ว' ทับกลางใบ)", () => {
  const code = strip(receiptsSrc);
  assert.ok(!/doc-watermark\s+paid/.test(code), "ห้ามมี watermark class 'paid'");
  // ★ ต้องผูกกับบริบทลายน้ำเท่านั้น — "ชำระแล้ว" เป็น label ของการ์ดสถิติในหน้ารายการด้วย
  //   (receipts.js:301 <div class="stat-label">ชำระแล้ว</div>) การ assert กว้าง ๆ จะจับผิดตัว
  assert.ok(!/doc-watermark[^>]*>\s*ชำระแล้ว/.test(code), "ห้ามเรนเดอร์ 'ชำระแล้ว' เป็นลายน้ำ");
});

test("ใบเสร็จที่ถูกยกเลิกต้องยังมีลายน้ำ 'ยกเลิก' (กันเอกสารที่ใช้ไม่ได้ถูกนำไปใช้)", () => {
  const code = strip(receiptsSrc);
  assert.ok(/status === "cancelled"[^\n]*doc-watermark cancelled[^\n]*ยกเลิก/.test(code),
    "cancelled ต้องยังขึ้นลายน้ำ ยกเลิก");
});

test("ทั้งสามเทมเพลตใช้กติกาเดียวกัน: ลายน้ำผูกกับสถานะที่ใช้ไม่ได้เท่านั้น", () => {
  for (const [name, src] of [["receipts", receiptsSrc], ["delivery_invoices", invoicesSrc], ["quotations", quotationsSrc]]) {
    const code = strip(src);
    for (const m of code.match(/doc-watermark[^"']*/g) || []) {
      // อนุญาตเฉพาะ wrapper และคลาสของสถานะที่ใช้ไม่ได้
      assert.ok(/doc-watermark(-wrap)?(\s+(cancelled|expired))?$/.test(m.trim()),
        `${name}: ลายน้ำ "${m.trim()}" ไม่ใช่สถานะที่ใช้ไม่ได้ — ห้ามขึ้นบนเอกสารปกติ`);
    }
  }
});

test("ใบส่งสินค้า/ใบเสนอราคา ต้องคงลายน้ำเตือนเดิมไว้ครบ (ไม่ใช่ถอดทิ้งทั้งหมด)", () => {
  assert.ok(/doc-watermark cancelled[^\n]*ยกเลิก/.test(strip(invoicesSrc)), "delivery: ต้องมี ยกเลิก");
  assert.ok(/doc-watermark cancelled[^\n]*ยกเลิก/.test(strip(quotationsSrc)), "quotation: ต้องมี ยกเลิก");
  assert.ok(/doc-watermark expired[^\n]*หมดอายุ/.test(strip(quotationsSrc)), "quotation: ต้องมี หมดอายุ");
});
