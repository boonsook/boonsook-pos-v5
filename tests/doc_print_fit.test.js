// Phase 617 — ตัวย่อเอกสารให้พอดีหน้าพิมพ์ + กันแก้ผิดไฟล์ซ้ำรอย
//
// บทเรียนราคาแพง: ปุ่มพิมพ์ของใบเสนอราคา/ใบส่งสินค้า/ใบเสร็จ ไม่ได้ใช้ handler ในโมดูลตัวเอง
// doc-override.js ดัก click ตั้งแต่ capturing phase แล้ว stopImmediatePropagation()
// → เส้นทางจริงคือ doc-utils.printDoc() + PRINT_CSS เท่านั้น
// การแก้ doc-print.css หรือ CSS ที่ฝังใน receipts.js/delivery_invoices.js จึงไม่มีผลใด ๆ ต่อการพิมพ์
// (จำนวนแผ่นจริงวัดด้วย tests/e2e/doc_print_pagecount.spec.js — ไฟล์นี้คุมสัญญาของฟังก์ชัน)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  nextPrintFitScale, fitPrintedPages, PRINT_CSS, PRINT_MIN_SCALE, PRINT_PAGE_HEIGHT_MM,
} from "../modules/doc-utils.js";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const PX_PER_MM = 96 / 25.4;
const TRIGGER = (PRINT_PAGE_HEIGHT_MM + 0.5) * PX_PER_MM;
const TARGET = (PRINT_PAGE_HEIGHT_MM - 1) * PX_PER_MM;

// ── สัญญาของตัวคำนวณ zoom ──────────────────────────────────
test("fit: เอกสารที่พอดีหน้าอยู่แล้ว ต้องไม่ถูกย่อ", () => {
  assert.equal(nextPrintFitScale(1, 200 * PX_PER_MM, TRIGGER, TARGET), 1);
  // กล่องสูง 297mm เป๊ะ (min-height ของ .doc-page) = พอดีหน้า ห้ามย่อ
  assert.equal(nextPrintFitScale(1, PRINT_PAGE_HEIGHT_MM * PX_PER_MM, TRIGGER, TARGET), 1);
});

test("fit: เอกสารล้นต้องถูกย่อลง และไม่ต่ำกว่าเพดานล่าง", () => {
  const s = nextPrintFitScale(1, 349 * PX_PER_MM, TRIGGER, TARGET);
  assert.ok(s < 1 && s > 0.8, `349mm ควรย่อราว 0.85 ได้ ${s}`);
  // ล้นมโหฬาร → หยุดที่เพดานล่าง ไม่ย่อจนอ่านไม่ออก
  assert.equal(nextPrintFitScale(1, 2000 * PX_PER_MM, TRIGGER, TARGET), PRINT_MIN_SCALE);
});

test("fit: ห้ามคืนค่าที่ใหญ่ขึ้น (ตัวหยุดลูป — ไม่งั้นวนไม่จบตอนวัดซ้ำ)", () => {
  // ย่อไปแล้ว 0.55 แล้ววัดได้ว่ายังล้น → ต้องคืน 0.55 เท่าเดิม ไม่ใช่เด้งขึ้น
  assert.equal(nextPrintFitScale(PRINT_MIN_SCALE, 400 * PX_PER_MM, TRIGGER, TARGET, PRINT_MIN_SCALE), PRINT_MIN_SCALE);
  // ความสูงวัดไม่ได้ (0 / ยังไม่ layout) → คงค่าเดิม ไม่ใช่หารด้วยศูนย์
  assert.equal(nextPrintFitScale(0.9, 0, TRIGGER, TARGET), 0.9);
});

test("fit: วัดซ้ำจนพอดีจริง — zoom ย่อความสูงไม่เป็นเชิงเส้น", () => {
  // จำลอง DOM: zoom ย่อความสูงได้แค่ 99% ของที่คำนวณ (ปัดเศษ font-size/line-height)
  let zoom = 1;
  const natural = 349 * PX_PER_MM;
  const el = {
    style: { set zoom(v) { zoom = Number(v) || 1; }, get zoom() { return zoom === 1 ? "" : String(zoom); } },
    getBoundingClientRect: () => ({ height: natural * zoom * 1.01 }),
  };
  const [scale] = fitPrintedPages({ querySelectorAll: () => [el] });
  assert.ok(scale < 1, "ต้องย่อ");
  assert.ok(natural * scale * 1.01 <= TRIGGER,
    `หลังย่อยังล้น (${(natural * scale * 1.01 / PX_PER_MM).toFixed(1)}mm) — คำนวณรอบเดียวไม่พอ ต้องวัดซ้ำ`);
});

test("fit: หน้าที่ไม่ล้นต้องล้าง zoom ทิ้ง ไม่ค้างค่าจากรอบก่อน", () => {
  let assigned = "unset";
  const el = {
    style: { set zoom(v) { assigned = v; }, get zoom() { return assigned; } },
    getBoundingClientRect: () => ({ height: 100 * PX_PER_MM }),
  };
  const [scale] = fitPrintedPages({ querySelectorAll: () => [el] });
  assert.equal(scale, 1);
  assert.equal(assigned, "", "ต้องเซ็ต zoom เป็นค่าว่างก่อนวัดเสมอ");
});

// ── PRINT_CSS = สไตล์ที่ใช้ตอนพิมพ์จริง ────────────────────
const docPageRule = (PRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.doc-page \{[^}]*\}/) || [""])[0];

test("PRINT_CSS: .doc-page ห้ามล็อกความกว้างตายตัว", () => {
  assert.ok(docPageRule, "ต้องมีกฎ .doc-page");
  assert.ok(!/(^|[^-])width: ?210mm/.test(docPageRule),
    "width ตายตัวล้นแนวนอนถ้าผู้ใช้ตั้งระยะขอบในไดอะล็อกพิมพ์");
  assert.ok(/max-width: ?210mm/.test(docPageRule), "ใช้ max-width แทน");
});

test("PRINT_CSS: บล็อกที่ห้ามผ่ากลางต้องครบ", () => {
  const css = PRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const avoid = css.slice(0, css.indexOf("page-break-inside: avoid") + 1);
  for (const sel of [".doc-table tr", ".doc-totals", ".doc-signatures", ".doc-payment-check", ".doc-bank-line"]) {
    assert.ok(avoid.includes(sel), `${sel} ต้องอยู่ในรายการ page-break-inside: avoid`);
  }
  assert.ok(/\.doc-table thead \{[^}]*table-header-group/.test(css),
    "ตารางข้ามแผ่นต้องพิมพ์หัวตารางซ้ำ");
});

// ── wiring: ปุ่มพิมพ์ต้องเดินผ่านตัวย่อจริง ─────────────────
const duSrc = readFileSync(path.join(__dirname2, "..", "modules", "doc-utils.js"), "utf8");

test("wiring: printDoc/pdfDoc ต้องเรียก printWhenReady ไม่ใช่ setTimeout แล้วพิมพ์เลย", () => {
  const printDocBody = duSrc.slice(duSrc.indexOf("export function printDoc"), duSrc.indexOf("export function pdfDoc"));
  assert.ok(/printWhenReady\(w\)/.test(printDocBody), "printDoc ต้องเรียก printWhenReady");
  assert.ok(!/setTimeout\([^)]*w\.print/.test(printDocBody),
    "ห้ามพิมพ์ด้วย setTimeout ดิบ — วัดก่อนฟอนต์มา = ย่อไม่พอ");
  const pdfDocBody = duSrc.slice(duSrc.indexOf("export function pdfDoc"), duSrc.indexOf("export async function shareDoc"));
  assert.ok(/printWhenReady\(w, \{ print: false \}\)/.test(pdfDocBody),
    "หน้าบันทึก PDF ต้องย่อให้พอดีเหมือนกัน แต่ไม่สั่งพิมพ์เอง");
});

test("wiring: doc-override.js ยังดักปุ่มพิมพ์ทั้งสามใบอยู่ (สมมติฐานของ test ชุดนี้)", () => {
  const ov = readFileSync(path.join(__dirname2, "..", "modules", "doc-override.js"), "utf8");
  for (const id of ["qtPrintBtn", "diPrintBtn", "rcPrintBtn"]) {
    assert.ok(ov.includes(id), `${id} ต้องยังถูก map ใน doc-override.js`);
  }
  assert.ok(/stopImmediatePropagation/.test(ov) && /printDoc\(/.test(ov),
    "ถ้าเลิกดักแล้ว เส้นทางพิมพ์จะย้ายไป handler ในโมดูล — test ชุดนี้ต้องถูกรื้อใหม่");
});
