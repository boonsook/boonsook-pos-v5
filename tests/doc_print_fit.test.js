// Phase 617-621 — ตัวย่อเอกสารให้พอดีหน้าพิมพ์ + กันแก้ผิดจุดซ้ำรอย
//
// บทเรียนราคาแพง #1 (613-616): ปุ่มพิมพ์ของใบเสนอราคา/ใบส่งสินค้า/ใบเสร็จ ไม่ได้ใช้ handler ในโมดูลตัวเอง
// doc-override.js ดัก click ตั้งแต่ capturing phase แล้ว stopImmediatePropagation()
// → เส้นทางจริงคือ doc-utils.printDoc() + PRINT_CSS เท่านั้น
//
// บทเรียนราคาแพง #2 (617-618): zoom ย่อทั้งกว้างและสูง — ถ้าไม่ขยาย width/min-height ชดเชย
// เอกสารจะหดไปกองมุมซ้ายบนเหลือครึ่งแผ่น
//
// บทเรียนราคาแพง #3 (620) — ตัวชี้ขาด วัดจากเครื่องเจ้าของเอง:
// `zoom` ย่อแต่ "ภาพที่เห็น" ไม่ย่อ "layout box" ที่เบราว์เซอร์ใช้แบ่งหน้า
//   .doc-page zoom 0.955 → getBoundingClientRect() 296mm แต่ offsetHeight 309.8mm → ล้น A4 12.8mm
//   ส่วนที่ล้นคือ padding ล่างเปล่า ๆ จึงได้ "แผ่นเปล่าสนิท" ต่อท้ายทุกใบ
// ⇒ ต้องห่อด้วย .doc-fit ที่มีขนาด layout เท่ากระดาษจริง แล้ว transform:scale ข้างใน
// ⚠️ Chromium ของ Playwright ยอมใช้ค่า zoom ตอนพิมพ์ → นับจำนวนแผ่นอย่างเดียวจับบั๊กนี้ไม่ได้
//    ต้องมี assertion บน layout box ตรง ๆ (ดู tests/e2e/doc_print_pagecount.spec.js)

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
const BOX_W = PRINT_PAGE_WIDTH_MM - PRINT_SAFE_MM;
const BOX_H = PRINT_PAGE_HEIGHT_MM - PRINT_SAFE_MM;

function makeNode(className = "") {
  const node = {
    className,
    style: {},
    childNodes: [],
    parentElement: null,
    parentNode: null,
    classList: { contains: (c) => String(node.className).split(/\s+/).includes(c) },
    appendChild(c) { node.childNodes.push(c); c.parentElement = node; c.parentNode = node; return c; },
    insertBefore(nw) { node.childNodes.push(nw); nw.parentElement = node; nw.parentNode = node; return nw; },
  };
  return node;
}

// จำลอง layout: กล่องยิ่งกว้าง ข้อความยิ่งตัดบรรทัดน้อย เนื้อหาจึงยิ่งเตี้ย
// และ transform:scale ย่อเฉพาะภาพ (rect) — layout ยังเท่าเดิม เหมือนของจริง
function fakePage(contentMm) {
  const el = makeNode("doc-page");
  makeNode("doc-preview").appendChild(el);
  const measuredMinHeights = [];
  el.getBoundingClientRect = () => {
    const z = Number((String(el.style.transform || "").match(/scale\(([\d.]+)\)/) || [])[1]) || 1;
    const widthMm = parseFloat(el.style.width) || BOX_W;
    const minMm = parseFloat(el.style.minHeight) || 0;
    measuredMinHeights.push(el.style.minHeight);
    const layoutMm = Math.max(contentMm * (BOX_W / widthMm), minMm);
    return { height: layoutMm * z * PX_PER_MM, width: widthMm * z * PX_PER_MM };
  };
  const doc = { createElement: () => makeNode(""), querySelectorAll: () => [el] };
  return { el, doc, style: el.style, measuredMinHeights, box: () => el.parentElement };
}

const scaleOf = (f) => Number((String(f.style.transform || "").match(/scale\(([\d.]+)\)/) || [])[1]) || 1;

test("fit: เอกสารที่พอดีหน้าอยู่แล้ว ต้องไม่ถูกย่อ", () => {
  const f = fakePage(250);
  assert.deepEqual(fitPrintedPages(f.doc), [1]);
  assert.equal(f.style.width, BOX_W + "mm");
  assert.equal(f.style.minHeight, BOX_H + "mm");
});

test("fit: เอกสารที่สูงเท่ากล่องพอดี ห้ามย่อ", () => {
  assert.deepEqual(fitPrintedPages(fakePage(BOX_H).doc), [1]);
});

test("fit: เอกสารสูงเท่ากระดาษเป๊ะ ต้องถูกย่อ — ห้ามปล่อยให้กล่องแตะขอบกระดาษ", () => {
  // วัดหน้าผาไว้แล้ว: กล่อง 297.0mm = 2 แผ่น แต่ 297.2mm = 4 แผ่น ห่างกันแค่ 0.2mm
  const [z] = fitPrintedPages(fakePage(PRINT_PAGE_HEIGHT_MM).doc);
  assert.ok(z < 1, "297mm ต้องถูกย่อ เพราะกล่องต้องเล็กกว่ากระดาษเสมอ");
});

// ★★ ข้อที่สำคัญที่สุดของไฟล์นี้
test("fit: ต้องห่อด้วย .doc-fit ที่ layout เท่าขนาดบนกระดาษ — เบราว์เซอร์แบ่งหน้าจาก layout ไม่ใช่ภาพ", () => {
  const f = fakePage(520);
  fitPrintedPages(f.doc);
  const box = f.box();
  assert.ok(box?.classList.contains("doc-fit"), "ต้องมี .doc-fit ห่อ .doc-page");
  assert.equal(box.style.width, BOX_W + "mm", "layout box ต้องกว้างเท่าขนาดจริงบนกระดาษ");
  assert.equal(box.style.height, BOX_H + "mm", "layout box ต้องสูงเท่าขนาดจริงบนกระดาษ");
  assert.equal(box.style.overflow, "hidden", "กันเศษที่เกินไม่ให้งอกแผ่นใหม่");
});

test("fit: ห้ามใช้ zoom — zoom ย่อแต่ภาพ ไม่ย่อ layout box ที่ใช้แบ่งหน้า", () => {
  const f = fakePage(520);
  fitPrintedPages(f.doc);
  assert.equal(f.style.zoom, "", "zoom ต้องถูกล้างทิ้งเสมอ (เคยทำให้ได้แผ่นเปล่าบน Chrome จริง)");
  assert.ok(/scale\(/.test(String(f.style.transform)), "ต้องย่อด้วย transform:scale");
  assert.equal(f.style.transformOrigin, "top left", "ไม่งั้นย่อจากกึ่งกลางแล้วเนื้อหาลอย");
});

test("fit: เรียกซ้ำได้ ห้ามห่อซ้อนกัน (fit ทำงานหลายรอบ: ตอนแรก/ฟอนต์มา/beforeprint)", () => {
  const f = fakePage(520);
  const a = fitPrintedPages(f.doc);
  const box1 = f.box();
  const b = fitPrintedPages(f.doc);
  assert.equal(f.box(), box1, "ต้องใช้ wrapper เดิม ไม่สร้างใหม่ซ้อน");
  assert.deepEqual(b, a, "ผลลัพธ์ต้องคงที่");
});

test("fit: เอกสารล้นต้องย่อลงจนพอดี แต่ยังเกือบเต็มแผ่น (และไม่แตะขอบกระดาษ)", () => {
  const f = fakePage(520);
  const [z] = fitPrintedPages(f.doc);
  assert.ok(z < 1, "ต้องย่อ");
  const visW = parseFloat(f.style.width) * z;
  const visH = parseFloat(f.style.minHeight) * z;
  assert.ok(Math.abs(visW - BOX_W) < 0.5, `ต้องกว้าง ${BOX_W}mm ได้ ${visW.toFixed(1)}mm — ย่อแล้วหดไปครึ่งแผ่นคือบั๊ก`);
  assert.ok(Math.abs(visH - BOX_H) < 0.5, `กล่องต้องสูง ${BOX_H}mm ได้ ${visH.toFixed(1)}mm`);
  assert.ok(visW < PRINT_PAGE_WIDTH_MM && visH < PRINT_PAGE_HEIGHT_MM, "ต้องเล็กกว่ากระดาษเสมอ");
  assert.ok(f.el.getBoundingClientRect().height / PX_PER_MM <= BOX_H + 0.5, "ต้องไม่ล้น");
});

test("fit: ต้องได้ตัวย่อที่ใหญ่ที่สุดเท่าที่ยังพอดี (ห้ามย่อเกินจำเป็น)", () => {
  const f = fakePage(340);
  const [z] = fitPrintedPages(f.doc);
  assert.ok(z > 0.85, `ย่อเกินจำเป็น (${z})`);
  assert.equal(scaleOf(f).toFixed(3), z.toFixed(3));
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
  assert.ok(!/%/.test(f.style.width), "ห้ามใช้ % ของหน้าต่าง");
});

test("fit: หลายหน้าในเอกสารเดียว ต้องคิดแยกใบ", () => {
  const a = fakePage(250), b = fakePage(520);
  const scales = fitPrintedPages({ createElement: () => makeNode(""), querySelectorAll: () => [a.el, b.el] });
  assert.equal(scales.length, 2);
  assert.equal(scales[0], 1, "ใบที่พอดีต้องไม่ถูกย่อตามใบที่ล้น");
  assert.ok(scales[1] < 1);
});

// ── PRINT_CSS = สไตล์ที่ใช้ตอนพิมพ์จริง ────────────────────
const cssNoComments = PRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const docPageRule = (cssNoComments.match(/\.doc-page \{[^}]*\}/) || [""])[0];

test("PRINT_CSS: .doc-page ห้ามล็อกความกว้างตายตัว", () => {
  assert.ok(docPageRule, "ต้องมีกฎ .doc-page");
  assert.ok(!/(^|[^-])width: ?210mm/.test(docPageRule), "width ตายตัวล้นแนวนอน");
  assert.ok(/max-width: ?210mm/.test(docPageRule), "ใช้ max-width แทน");
});

test("PRINT_CSS: .doc-fit ต้องเป็นตัวที่ขึ้นแผ่นใหม่ และ .doc-page ข้างในต้องไม่สั่งเอง", () => {
  assert.ok(/\.doc-fit \{[^}]*page-break-after: always/.test(cssNoComments), ".doc-fit ต้องขึ้นแผ่นใหม่");
  assert.ok(/\.doc-fit:last-child \{[^}]*page-break-after: avoid/.test(cssNoComments),
    "ใบสุดท้ายห้ามบังคับขึ้นแผ่นใหม่ ไม่งั้นได้แผ่นเปล่าท้ายไฟล์");
  assert.ok(/\.doc-fit > \.doc-page \{[^}]*page-break-after: avoid/.test(cssNoComments),
    ".doc-page ที่ถูกห่อแล้วห้ามสั่งขึ้นแผ่นใหม่ซ้ำอีก");
});

test("PRINT_CSS: บล็อกที่ห้ามผ่ากลางต้องครบ", () => {
  const avoid = cssNoComments.slice(0, cssNoComments.indexOf("page-break-inside: avoid") + 1);
  for (const sel of [".doc-table tr", ".doc-totals", ".doc-signatures", ".doc-payment-check", ".doc-bank-line"]) {
    assert.ok(avoid.includes(sel), `${sel} ต้องอยู่ในรายการ page-break-inside: avoid`);
  }
  assert.ok(/\.doc-table thead \{[^}]*table-header-group/.test(cssNoComments), "ตารางข้ามแผ่นต้องพิมพ์หัวตารางซ้ำ");
});

// ── wiring: ปุ่มพิมพ์ต้องเดินผ่านตัวย่อจริง ─────────────────
const duSrc = readFileSync(path.join(__dirname2, "..", "modules", "doc-utils.js"), "utf8");

test("wiring: printDoc/pdfDoc ต้องเรียก printWhenReady ไม่ใช่ setTimeout แล้วพิมพ์เลย", () => {
  const printDocBody = duSrc.slice(duSrc.indexOf("export function printDoc"), duSrc.indexOf("export function pdfDoc"));
  assert.ok(/printWhenReady\(w\)/.test(printDocBody), "printDoc ต้องเรียก printWhenReady");
  assert.ok(!/setTimeout\([^)]*w\.print/.test(printDocBody), "ห้ามพิมพ์ด้วย setTimeout ดิบ");
  const pdfDocBody = duSrc.slice(duSrc.indexOf("export function pdfDoc"), duSrc.indexOf("export async function shareDoc"));
  assert.ok(/printWhenReady\(w, \{ print: false \}\)/.test(pdfDocBody), "หน้าบันทึก PDF ต้องย่อให้พอดีเหมือนกัน");
});

test("wiring: ต้องวัดใหม่ตอน beforeprint และตอนฟอนต์มาทีหลัง ไม่ใช่วัดครั้งเดียวจบ", () => {
  const body = duSrc.slice(duSrc.indexOf("export function printWhenReady"), duSrc.indexOf("export function printDoc"));
  assert.ok(/addEventListener\("beforeprint", fit\)/.test(body), "ต้องวัดซ้ำตอน beforeprint");
  assert.ok(/fonts\?\.addEventListener\?\.\("loadingdone", fit\)/.test(body), "ฟอนต์มาทีหลังต้องวัดใหม่");
  // build 620 เคยต่อท้าย document.title ด้วยตัวเลขวินิจฉัยชั่วคราว — title คือชื่อไฟล์ตั้งต้นตอน
  // "บันทึกเป็น PDF" ของผู้ใช้ ห้ามหลุดกลับมาอีก (ค่าที่ต้องการดูอยู่ใน win.__printFit แล้ว)
  assert.ok(!/document\.title\s*=/.test(body), "ห้ามเขียนอะไรลง document.title ของหน้าต่างพิมพ์");
});

test("wiring: doc-override.js ยังดักปุ่มพิมพ์ทั้งสามใบอยู่ (สมมติฐานของ test ชุดนี้)", () => {
  const ov = readFileSync(path.join(__dirname2, "..", "modules", "doc-override.js"), "utf8");
  for (const id of ["qtPrintBtn", "diPrintBtn", "rcPrintBtn"]) {
    assert.ok(ov.includes(id), `${id} ต้องยังถูก map ใน doc-override.js`);
  }
  assert.ok(/stopImmediatePropagation/.test(ov) && /printDoc\(/.test(ov),
    "ถ้าเลิกดักแล้ว เส้นทางพิมพ์จะย้ายไป handler ในโมดูล — test ชุดนี้ต้องถูกรื้อใหม่");
});
