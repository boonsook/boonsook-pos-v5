// Phase 614 — กติกาของหน้ากระดาษตอน "พิมพ์" (native print) ต้องไม่ล็อกขนาดตายตัว
//
// บทเรียนที่เสียรอบไปแล้ว 2 ครั้ง:
//   `@page { margin: 0 }` มีผลเฉพาะเมื่อผู้ใช้ตั้ง "ระยะขอบ = ไม่มี" ในไดอะล็อกพิมพ์
//   ค่าเริ่มต้นของ Chrome ใส่ขอบเอง ⇒ พื้นที่พิมพ์จริงเหลือราว 277×190mm
//   ถ้า .doc-page ล็อก 210×296/297mm ไว้ จะล้นทั้งแนวตั้งและแนวนอน
//   ⇒ ได้ "หน้าเปล่า" ต่อท้ายทุกฉบับ (ต้นฉบับ+สำเนา = 4 แผ่นแทนที่จะเป็น 2)
//
// การแยกฉบับต้องพึ่ง page-break-after เท่านั้น ห้ามพึ่งความสูงของกล่อง

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
// ★ ต้องตัดคอมเมนต์ทิ้งก่อนสแกนเสมอ — คอมเมนต์อธิบายกฎมักมีตัวอย่างโค้ดที่มี { } อยู่ข้างใน
//   ถ้าไม่ตัด การหาขอบเขตของกฎด้วย indexOf("}") จะไปหยุดที่ปีกกาในคอมเมนต์ แล้วอ่านกฎไม่ครบ
//   (ผมโดนกับดักนี้ตอนเขียน guard ตัวนี้เอง — guard เลยแดงทั้งที่ CSS ถูกแล้ว)
const css = readFileSync(path.join(__dirname2, "..", "doc-print.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

// เอาเฉพาะบล็อก @media print — กฎของหน้าจอมี min-height 297mm ได้ตามปกติ
const printBlock = css.slice(css.indexOf("@media print"));
const docPageRule = (() => {
  const i = printBlock.indexOf(".doc-page {");
  return i < 0 ? "" : printBlock.slice(i, printBlock.indexOf("}", i));
})();

test("print: .doc-page ต้องไม่ล็อกความสูงตายตัว (ห้าม min-height 29xmm)", () => {
  assert.ok(docPageRule, "ต้องมีกฎ .doc-page ใน @media print");
  assert.ok(!/min-height:\s*29\d(\.\d+)?mm/.test(docPageRule),
    "ห้ามล็อก min-height ระดับความสูงกระดาษ — พื้นที่พิมพ์จริงเล็กกว่านั้นเมื่อผู้ใช้ใช้ระยะขอบค่าเริ่มต้น");
  assert.ok(/min-height:\s*(0|auto)\s*;/.test(docPageRule), "ต้องปล่อยให้สูงตามเนื้อหา");
});

test("print: .doc-page ต้องไม่ล็อกความกว้างตายตัว (กันล้นแนวนอน)", () => {
  assert.ok(!/(^|[^-])width:\s*210mm/.test(docPageRule),
    "width ตายตัว 210mm ล้นพื้นที่พิมพ์เมื่อมีขอบของเบราว์เซอร์");
  assert.ok(/max-width:\s*210mm/.test(docPageRule), "ใช้ max-width แทน เพื่อไม่ให้กว้างเกินกระดาษ");
});

test("print: การแยกฉบับต้องมาจาก page-break-after ไม่ใช่ความสูงของกล่อง", () => {
  assert.ok(/page-break-after:\s*always/.test(docPageRule), ".doc-page ต้องขึ้นแผ่นใหม่เสมอ");
  assert.ok(/\.doc-page:last-child\s*\{[^}]*page-break-after:\s*avoid/.test(printBlock),
    "ฉบับสุดท้ายต้องไม่บังคับขึ้นแผ่นใหม่ (ไม่งั้นได้หน้าเปล่าท้ายไฟล์)");
});

test("print: บล็อกที่ห้ามผ่ากลางต้องครบ รวมบล็อกรับชำระของใบเสร็จ", () => {
  const need = [".doc-table tr", ".doc-totals", ".doc-note-section", ".doc-signatures",
    ".doc-sig-col", ".doc-payment-check", ".doc-bank-line"];
  const i = printBlock.indexOf("page-break-inside: avoid");
  const rule = printBlock.slice(Math.max(0, i - 700), i);
  for (const sel of need) {
    assert.ok(rule.includes(sel), `${sel} ต้องอยู่ในรายการ page-break-inside: avoid ของฝั่งพิมพ์`);
  }
});
