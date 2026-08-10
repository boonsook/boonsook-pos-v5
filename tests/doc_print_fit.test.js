// Phase 617 — ตัวย่อเอกสารให้พอดีหน้าพิมพ์ + กันแก้ผิดไฟล์ซ้ำรอย
//
// บทเรียนราคาแพง #1: ปุ่มพิมพ์ของใบเสนอราคา/ใบส่งสินค้า/ใบเสร็จ ไม่ได้ใช้ handler ในโมดูลตัวเอง
// doc-override.js ดัก click ตั้งแต่ capturing phase แล้ว stopImmediatePropagation()
// → เส้นทางจริงคือ doc-utils.printDoc() + PRINT_CSS เท่านั้น
// การแก้ doc-print.css หรือ CSS ที่ฝังใน receipts.js/delivery_invoices.js จึงไม่มีผลใด ๆ ต่อการพิมพ์
//
// บทเรียนราคาแพง #2: zoom ย่อทั้งกว้างและสูง — ถ้าไม่ขยาย width/min-height ชดเชย
// เอกสารจะหดไปกองมุมซ้ายบนเหลือครึ่งแผ่น (ได้ 2 แผ่นก็จริง แต่ใช้งานไม่ได้)
//
// จำนวนแผ่นจริงวัดด้วย tests/e2e/doc_print_pagecount.spec.js — ไฟล์นี้คุมสัญญาของฟังก์ชัน

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fitPrintedPages, PRINT_CSS, PRINT_MIN_SCALE, PRINT_PAGE_HEIGHT_MM, PRINT_PAGE_WIDTH_MM, PRINT_SAFE_MM,
} from "../modules/doc-utils.js";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const PX_PER_MM = 96 / 25.4;

// จำลอง layout: กล่องยิ่งกว้าง ข้อความยิ่งตัดบรรทัดน้อย เนื้อหาจึงยิ่งเตี้ย
// (ความสัมพันธ์นี้คือเหตุผลที่ต้องบังคับความกว้างตอนวัด ไม่ใช่ปล่อยตามหน้าต่าง)
const BOX_W = PRINT_PAGE_WIDTH_MM - PRINT_SAFE_MM; // contentMm = ความสูงเมื่อกล่องกว้างเท่านี้
function fakePage(contentMm) {
  const style = { zoom: "", width: "", maxWidth: "", minHeight: "" };
  const measuredMinHeights = [];
  const el = {
    style,
    getBoundingClientRect() {
      const z = style.zoom === "" ? 1 : Number(style.zoom);
      const widthMm = parseFloat(style.width) || BOX_W;
      const minMm = parseFloat(style.minHeight) || 0;
      measuredMinHeights.push(style.minHeight);
      const layoutMm = Math.max(contentMm * (BOX_W / widthMm), minMm);
      return { height: layoutMm * z * PX_PER_MM, width: widthMm * z * PX_PER_MM };
    },
  };
  return { el, style, measuredMinHeights, doc: { querySelectorAll: () => [el] } };
}

const visualMm = (f) => {
  const z = f.style.zoom === "" ? 1 : Number(f.style.zoom);
  return {
    w: parseFloat(f.style.width) * z,
    minH: parseFloat(f.style.minHeight) * z,
  };
};

test("fit: เอกสารที่พอดีหน้าอยู่แล้ว ต้องไม่ถูกย่อ", () => {
  const f = fakePage(250);
  assert.deepEqual(fitPrintedPages(f.doc), [1]);
  assert.equal(f.style.width, (PRINT_PAGE_WIDTH_MM - PRINT_SAFE_MM) + "mm");
  assert.equal(f.style.minHeight, (PRINT_PAGE_HEIGHT_MM - PRINT_SAFE_MM) + "mm");
});

test("fit: เอกสารที่สูงเท่ากล่องพอดี ห้ามย่อ", () => {
  assert.deepEqual(fitPrintedPages(fakePage(PRINT_PAGE_HEIGHT_MM - PRINT_SAFE_MM).doc), [1]);
});

test("fit: เอกสารสูงเท่ากระดาษเป๊ะ ต้องถูกย่อ — ห้ามปล่อยให้กล่องแตะขอบกระดาษ", () => {
  // วัดหน้าผาไว้แล้ว: กล่อง 297.0mm = 2 แผ่น แต่ 297.2mm = 4 แผ่น ห่างกันแค่ 0.2mm
  // ตั้งกล่อง = ขนาดกระดาษเป๊ะ คือยืนริมผา Chrome คนละรุ่นปัดเศษต่างนิดเดียวก็ได้หน้าเปล่า
  const [z] = fitPrintedPages(fakePage(PRINT_PAGE_HEIGHT_MM).doc);
  assert.ok(z < 1, "297mm ต้องถูกย่อ เพราะกล่องต้องเล็กกว่ากระดาษเสมอ");
});

test("fit: เอกสารล้นต้องย่อลงจนพอดี แต่ยังเกือบเต็มแผ่น (และไม่แตะขอบกระดาษ)", () => {
  const f = fakePage(520);
  const [z] = fitPrintedPages(f.doc);
  assert.ok(z < 1, "ต้องย่อ");
  const v = visualMm(f);
  const boxW = PRINT_PAGE_WIDTH_MM - PRINT_SAFE_MM, boxH = PRINT_PAGE_HEIGHT_MM - PRINT_SAFE_MM;
  assert.ok(Math.abs(v.w - boxW) < 0.5,
    `ต้องกว้าง ${boxW}mm ได้ ${v.w.toFixed(1)}mm — ย่อแล้วหดไปครึ่งแผ่นคือบั๊ก`);
  assert.ok(Math.abs(v.minH - boxH) < 0.5,
    `กล่องต้องสูง ${boxH}mm ได้ ${v.minH.toFixed(1)}mm — ไม่งั้นลายเซ็นลอยกลางหน้า`);
  assert.ok(v.w < PRINT_PAGE_WIDTH_MM && v.minH < PRINT_PAGE_HEIGHT_MM,
    "กล่องต้องเล็กกว่ากระดาษเสมอ ห้ามเท่ากันเป๊ะ");
  assert.ok(f.el.getBoundingClientRect().height / PX_PER_MM <= boxH + 0.5, "ต้องไม่ล้น");
});

test("fit: ต้องได้ตัวย่อที่ใหญ่ที่สุดเท่าที่ยังพอดี (ห้ามย่อเกินจำเป็น)", () => {
  const f = fakePage(340);
  const [z] = fitPrintedPages(f.doc);
  // เนื้อหา 340mm เกินแค่ ~15% — ย่อควรอยู่แถว 0.9 ไม่ใช่ดิ่งไปเพดานล่าง
  assert.ok(z > 0.85, `ย่อเกินจำเป็น (${z})`);
});

test("fit: ล้นเกินเพดาน → หยุดที่ PRINT_MIN_SCALE ไม่ย่อจนอ่านไม่ออก", () => {
  assert.deepEqual(fitPrintedPages(fakePage(5000).doc), [PRINT_MIN_SCALE]);
});

test("fit: ตอนวัดต้องปลด min-height ทิ้ง ไม่งั้นทุกหน้าสูงเท่ากันแยกไม่ออกว่าอันไหนล้น", () => {
  const f = fakePage(520);
  fitPrintedPages(f.doc);
  assert.ok(f.measuredMinHeights.length > 1, "ต้องวัดหลายรอบ");
  assert.ok(f.measuredMinHeights.every((v) => v === "0"),
    `ทุกครั้งที่วัดต้อง min-height:0 ได้ ${JSON.stringify([...new Set(f.measuredMinHeights)])}`);
});

test("fit: ความกว้างตอนวัดต้องเป็น mm ตายตัว ไม่ผูกกับขนาดหน้าต่าง", () => {
  const f = fakePage(520);
  fitPrintedPages(f.doc);
  assert.ok(/mm$/.test(f.style.width), `ต้องเป็นหน่วย mm ได้ "${f.style.width}"`);
  assert.equal(f.style.maxWidth, "none", "ต้องปลด max-width ไม่งั้นความกว้างชดเชยถูกตัด");
  // หน้าต่างพิมพ์จริงกว้างไม่เท่ากระดาษ (จอ scale 125-150% ยิ่งแคบ) — ถ้าใช้ % จะย่อเกินจำเป็น
  assert.ok(!/%/.test(f.style.width), "ห้ามใช้ % ของหน้าต่าง");
});

test("fit: หลายหน้าในเอกสารเดียว ต้องคิดแยกใบ", () => {
  const a = fakePage(250), b = fakePage(520);
  const scales = fitPrintedPages({ querySelectorAll: () => [a.el, b.el] });
  assert.equal(scales.length, 2);
  assert.equal(scales[0], 1, "ใบที่พอดีต้องไม่ถูกย่อตามใบที่ล้น");
  assert.ok(scales[1] < 1);
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
