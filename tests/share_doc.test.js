// Phase 92.7 — Tests for the extracted shareDoc() (modules/share_doc.js).
//
// shareDoc builds a share/PDF modal, lazy-loads html2canvas (injected loader),
// renders an A4 PDF + thumbnail, and wires 8 share buttons. DOM/window/navigator
// /console + the loader are all injected, so these run with no browser.
//
// Two layers:
//   1. Behavioral — stub document/window assert: null-guard returns silently,
//      the overlay is built + appended with the 7 share-opt buttons, and the
//      Phase 92.5 fail-fallback fires when the loader returns false.
//      (navigator.share / clipboard.write / window.open handlers are not unit
//      tested — mocking ROI is low; covered by source-level pins + manual smoke.)
//   2. Source-level — export/import/wrapper shape, markup moved out of main.js,
//      globals routed through injected refs, Phase 92.5 fallback preserved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { shareDoc, computePageSlices, collectBreakBoundaries, computeFitToPage, contentExtentPx, fitFloorForSlices, collectDocPageBounds, planCopyPages } from "../modules/share_doc.js";

// ── Stubs ──────────────────────────────────────────────────────────────────
function makeEl(tag) {
  return {
    tag, id: "", innerHTML: "", className: "",
    style: { cssText: "", display: "", color: "", background: "" },
    dataset: {}, classList: { add() {} },
    addEventListener() {}, appendChild(c) { return c; }, removeChild(c) { return c; },
    querySelectorAll() { return []; }, cloneNode() { return makeEl(tag); },
    remove() {}, getContext() { return { drawImage() {} }; }, toDataURL() { return "data:,"; },
  };
}
function makeStubDoc() {
  const appended = [];
  const byId = { shareThumbnail: makeEl("div"), shareCloseBtn: makeEl("button"), shareStatus: makeEl("div") };
  return {
    appended, byId,
    head: { appendChild() {}, removeChild() {} },
    body: { appendChild(el) { appended.push(el); return el; }, removeChild() {} },
    getElementById(id) { return byId[id] || null; },
    createElement(tag) { return makeEl(tag); },
  };
}
function makeStubWin(overrides = {}) {
  return {
    html2canvas: () => Promise.resolve(makeEl("canvas")),
    jspdf: { jsPDF: function () {} },
    open() {},
    innerWidth: 1280,
    navigator: { userAgent: "node", maxTouchPoints: 0 },
    URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} },
    File: function () {}, ClipboardItem: function () {},
    ...overrides,
  };
}

// ── Behavioral ───────────────────────────────────────────────────────────
test("shareDoc: returns silently when documentRef/windowRef missing", async () => {
  // both missing
  await shareDoc({ docElementId: "x", docName: "doc", documentRef: null, windowRef: null });
  // doc present, window missing — must still bail before touching window
  await shareDoc({ docElementId: "x", docName: "doc", documentRef: makeStubDoc(), windowRef: null });
});

test("shareDoc: builds the share overlay and appends it to body with all 8 share-opt buttons", async () => {
  const doc = makeStubDoc();
  await shareDoc({
    docElementId: "noSuchDoc",                 // null docEl → skips html2canvas render branch
    docName: "doc",
    documentRef: doc,
    windowRef: makeStubWin(),
    loadHtml2Canvas: async () => true,
    showToast: () => {},
  });
  assert.equal(doc.appended.length, 1, "exactly one node appended to body");
  const overlay = doc.appended[0];
  assert.equal(overlay.id, "shareOverlay", "appended node is the share overlay");
  const optCount = (overlay.innerHTML.match(/class="share-opt"/g) || []).length;
  assert.equal(optCount, 8, "modal must contain all 8 share options (line/fb/email/native/pdf/save/copy/print)");
});

test("shareDoc: when loadHtml2Canvas resolves false, shows error + modal stays closeable (Phase 92.5 fallback)", async () => {
  const doc = makeStubDoc();
  const toasts = [];
  await shareDoc({
    docElementId: "missing",
    docName: "doc",
    documentRef: doc,
    windowRef: makeStubWin({ html2canvas: undefined }),
    loadHtml2Canvas: async () => false,
    showToast: (m) => toasts.push(m),
  });
  assert.match(doc.byId.shareThumbnail.innerHTML, /โหลดตัวสร้าง PDF ไม่สำเร็จ/,
    "thumbnail must show the load-failure message (no stuck 'กำลังสร้าง PDF...')");
  assert.ok(toasts.includes("โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่"),
    "a toast must warn the user the PDF generator failed to load");
});

test("shareDoc: missing docEl does not throw (html2canvas render branch skipped)", async () => {
  const doc = makeStubDoc();
  await shareDoc({
    docElementId: "doesNotExist",
    docName: "doc",
    documentRef: doc,
    windowRef: makeStubWin(),
    loadHtml2Canvas: async () => true,
    showToast: () => {},
  });
  // reaching here without throwing is the assertion
  assert.ok(true);
});

// ── Source-level pins ──────────────────────────────────────────────────────
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname2, "..", "main.js"), "utf8");
const shareSrc = readFileSync(path.join(__dirname2, "..", "modules", "share_doc.js"), "utf8");

test("Phase 92.7: modules/share_doc.js exports shareDoc", () => {
  assert.ok(/export\s+async\s+function\s+shareDoc\s*\(/.test(shareSrc));
});

test("Phase 92.7: main.js imports shareDoc from ./modules/share_doc.js", () => {
  assert.ok(/from\s+["']\.\/modules\/share_doc\.js["']/.test(mainSrc));
});

test("Phase 92.7: main.js keeps the window._appShareDoc wrapper delegating to the module", () => {
  assert.ok(/window\._appShareDoc\s*=\s*function/.test(mainSrc));
  assert.ok(/_shareDocImpl\(\s*\{/.test(mainSrc));
});

test("Phase 92.7: main.js no longer inlines the share modal markup (overlay moved to module)", () => {
  // The "กำลังสร้าง PDF..." thumbnail marker is unique to the modal template.
  assert.ok(shareSrc.includes("กำลังสร้าง PDF..."), "marker must live in share_doc.js");
  assert.ok(!mainSrc.includes("กำลังสร้าง PDF..."), "marker must be gone from main.js");
});

test("Phase 92.7: share_doc.js routes globals through injected refs (no bareword document.)", () => {
  // strip template literals first (HTML/CSS templates legitimately contain no document.)
  const code = shareSrc.replace(/`[\s\S]*?`/g, "");
  assert.ok(
    !/[^a-zA-Z.]document\.(getElementById|createElement|body|head|querySelector)/.test(code),
    "all document.* access must go through documentRef.*"
  );
  assert.ok(
    !/[^a-zA-Z.]navigator\.(userAgent|maxTouchPoints|canShare|share|clipboard)/.test(code),
    "all navigator.* access must go through windowRef.navigator.*"
  );
});

test("Phase 92.5 preserved: share_doc.js still has the html2canvas-fail fallback (error msg)", () => {
  assert.ok(/โหลดตัวสร้าง PDF ไม่สำเร็จ/.test(shareSrc));
});

// ── หั่นหน้า PDF ต้องไม่ผ่ากลางแถว (bug: เอกสารล้นบรรทัดตอนแชร์) ─────────────
// A4: 210x297mm — สมมติภาพกว้าง 1588px (794 css px * scale 2) => pxPerMm ≈ 7.562
const A4 = { pxPerMm: 1588 / 210, pageHeightMm: 297 };

test("computePageSlices: ตัดที่รอยต่อของบล็อก ไม่ผ่ากลางแถว", () => {
  // แถวสูง 100px เรียงกัน 40 แถว -> ขอบล่างอยู่ที่ 100,200,...,4000
  const boundaries = Array.from({ length: 40 }, (_, i) => (i + 1) * 100);
  const pages = computePageSlices({ totalPx: 4000, ...A4, boundariesPx: boundaries });
  assert.ok(pages.length >= 2, "เอกสารยาวกว่า 1 หน้าต้องถูกแบ่งหลายหน้า");
  for (const p of pages.slice(0, -1)) {
    assert.ok(boundaries.includes(p.endPx), `จุดตัด ${p.endPx} ต้องเป็นขอบล่างของแถว ไม่ใช่กลางแถว`);
  }
  assert.equal(pages[pages.length - 1].endPx, 4000, "หน้าสุดท้ายต้องจบที่ท้ายเอกสารพอดี");
});

// ★ regression 608: build 607 หักขอบล่าง 8mm กับ "ทุกหน้า" รวมหน้าสุดท้าย
//   → เอกสารที่พอดีหนึ่งหน้า (canvas สูงเท่ากรอบ A4 = 1123px @794) ถูกดันเป็นสองหน้า
//   โดยหน้า 2 มีแค่บล็อกลายเซ็น (owner เจอจริงกับใบเสนอราคา อบต.หนองขวาว)
test("computePageSlices: เอกสารที่พอดีหนึ่งหน้า ต้องได้หน้าเดียว (regression 608)", () => {
  const canvasH = Math.round(A4.pageHeightMm * A4.pxPerMm);   // 1123px * 2 = ความสูงกรอบ A4 เป๊ะ
  // เนื้อหาจบที่ ~97% ของหน้า (ลายเซ็นอยู่ท้ายสุด) — ที่เหลือคือ padding ของเทมเพลต
  const boundaries = [400, 900, 1400, 1900, Math.round(canvasH * 0.97)];
  const pages = computePageSlices({ totalPx: canvasH, ...A4, boundariesPx: boundaries });
  assert.equal(pages.length, 1, `ต้องได้หน้าเดียว แต่ได้ ${pages.length} หน้า — ขอบล่างห้ามกินพื้นที่หน้าสุดท้าย`);
  assert.equal(pages[0].topMm, 0);
});

test("computePageSlices: เนื้อหาจบก่อนขอบล่าง canvas ต้องไม่เกิดหน้าว่างท้ายเล่ม", () => {
  const canvasH = 4000;
  // เนื้อหาจริงจบที่ 2100px ที่เหลือเป็นพื้นที่ว่างของกรอบเอกสาร
  const boundaries = [700, 1400, 2100];
  const pages = computePageSlices({ totalPx: canvasH, ...A4, boundariesPx: boundaries });
  assert.equal(pages.length, 1, "ส่วนที่ว่างเปล่าไม่ควรถูกนับเป็นหน้าเพิ่ม");
  assert.ok(pages[0].endPx <= 2100 + 3 * A4.pxPerMm, "ต้องตัดท้ายที่เนื้อหาจริง ไม่ลากไปถึงท้าย canvas");
});

test("computePageSlices: หน้าต่อกันสนิท ไม่ซ้ำ ไม่ขาดหาย", () => {
  const boundaries = Array.from({ length: 60 }, (_, i) => (i + 1) * 90);
  const pages = computePageSlices({ totalPx: 5400, ...A4, boundariesPx: boundaries });
  assert.equal(pages[0].startPx, 0, "หน้าแรกต้องเริ่มที่ 0");
  for (let i = 1; i < pages.length; i++) {
    assert.equal(pages[i].startPx, pages[i - 1].endPx, "หน้าถัดไปต้องเริ่มตรงที่หน้าก่อนจบ");
  }
  assert.equal(pages[pages.length - 1].endPx, 5400, "รวมทุกหน้าต้องครอบเอกสารครบ");
});

test("computePageSlices: หน้าแรกไม่เว้นขอบบน หน้าถัดไปเว้น (กันเนื้อหาชนขอบกระดาษ)", () => {
  const pages = computePageSlices({ totalPx: 6000, ...A4, boundariesPx: [], topMarginMm: 8 });
  assert.equal(pages[0].topMm, 0);
  assert.ok(pages.length > 1 && pages.slice(1).every(p => p.topMm === 8));
});

test("computePageSlices: ไม่มี boundary เลย ต้องยังแบ่งหน้าได้ (fallback ตัดตรงขอบ)", () => {
  const pages = computePageSlices({ totalPx: 6000, ...A4, boundariesPx: [] });
  assert.ok(pages.length >= 2, "ต้องไม่คืนค่าว่างจนได้ PDF หน้าเดียวที่เนื้อหาหาย");
  assert.equal(pages[pages.length - 1].endPx, 6000);
});

test("computePageSlices: บล็อกเดียวสูงกว่าหนึ่งหน้า ต้องไม่วนไม่รู้จบ", () => {
  const pages = computePageSlices({ totalPx: 9000, ...A4, boundariesPx: [9000] });
  assert.ok(pages.length >= 2 && pages.length < 200, "ต้อง hard cut แล้วจบ ไม่ค้างลูป");
  assert.equal(pages[pages.length - 1].endPx, 9000);
});

test("computePageSlices: ค่าขนาดไม่ถูกต้อง (canvas ว่าง) ต้องคืน [] ไม่ throw", () => {
  assert.deepEqual(computePageSlices({}), []);
  assert.deepEqual(computePageSlices({ totalPx: 0, ...A4 }), []);
  assert.deepEqual(computePageSlices({ totalPx: 100, pxPerMm: 0, pageHeightMm: 297 }), []);
});

test("collectBreakBoundaries: element ที่วัดไม่ได้ ต้องคืน [] ไม่ throw", () => {
  assert.deepEqual(collectBreakBoundaries(null), []);
  assert.deepEqual(collectBreakBoundaries({}), []);
  assert.deepEqual(collectBreakBoundaries({ querySelectorAll: () => [] }), []);
});

test("collectBreakBoundaries: คืนขอบล่างของแต่ละบล็อก (สเกลตาม canvas) เรียงจากน้อยไปมาก", () => {
  const mk = (top, height) => ({ getBoundingClientRect: () => ({ top, bottom: top + height, height }) });
  const root = {
    getBoundingClientRect: () => ({ top: 50, bottom: 500, height: 450 }),
    querySelectorAll: () => [mk(50, 100), mk(150, 100), mk(250, 0)], // ตัวสูง 0 ต้องถูกข้าม
  };
  assert.deepEqual(collectBreakBoundaries(root, 2), [200, 400]);
});

test("computePageSlices: ความสูงเนื้อหาต่อหน้า (แปลง px→mm) ต้องไม่เกินพื้นที่ใช้ได้ของ A4", () => {
  // ตรวจการแปลงพิกัด 3 ทอด: CSS px → canvas px (scale 2) → mm ที่ส่งเข้า pdf.addImage
  const boundaries = Array.from({ length: 80 }, (_, i) => (i + 1) * 77);
  const pages = computePageSlices({ totalPx: 6160, ...A4, boundariesPx: boundaries, topMarginMm: 8, bottomMarginMm: 8 });
  assert.ok(pages.length >= 3, "ต้องได้หลายหน้าเพื่อทดสอบทั้งหน้าแรกและหน้าถัดไป");
  pages.forEach((p, i) => {
    const heightMm = (p.endPx - p.startPx) / A4.pxPerMm;
    const isLast = i === pages.length - 1;
    // หน้าที่ถูกตัดกลาง = เว้นขอบล่าง 8mm กันเนื้อหาชนขอบ · หน้าสุดท้าย = ใช้ได้เต็มหน้า
    const usableMm = A4.pageHeightMm - p.topMm - (isLast ? 0 : 8);
    assert.ok(heightMm <= usableMm + 0.001,
      `หน้า ${i + 1} สูง ${heightMm.toFixed(2)}mm ต้องไม่เกินพื้นที่ใช้ได้ ${usableMm}mm`);
    assert.ok(p.topMm + heightMm <= A4.pageHeightMm + 0.001, "ขอบบน + เนื้อหา ต้องไม่เกินความสูงกระดาษ");
  });
});

test("share_doc.js: ถ้าวัดขอบเขตไม่ได้ ต้องไม่ fallback เงียบ (มีสัญญาณเตือน)", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/_breakPx\.length === 0 && slices\.length > 1/.test(code),
    "ต้องตรวจเคส 'วัดไม่ได้ + หลายหน้า' อย่างชัดเจน");
  assert.ok(/logger\?\.warn\?\.\(/.test(code) && /แบ่งหน้าแบบประมาณ/.test(shareSrc),
    "ต้องมีทั้ง log และข้อความแจ้ง user — ห้ามเงียบ");
});

// ★ 609: เอกสารที่เครื่องพิมพ์ออกมา 1 หน้า แต่ไฟล์แชร์ได้ 2 หน้า (owner เจอจริง 2 รอบ)
//   เหตุ: สไตล์ force-A4 ตอนสร้าง PDF ให้เมตริกต่างจาก CSS ตอนพิมพ์ → เนื้อหาสูงเกินหน้า ~1%
//   ทางแก้แบบเดียวกับเครื่องพิมพ์: ย่อให้พอดีหน้า (shrink to fit) แทนที่จะแตกหน้า
test("computeFitToPage: เนื้อหาพอดีหน้าอยู่แล้ว → scale 1", () => {
  const pagePx = A4.pageHeightMm * A4.pxPerMm;
  assert.deepEqual(computeFitToPage({ contentPx: pagePx - 10, ...A4 }), { scale: 1 });
  assert.deepEqual(computeFitToPage({ contentPx: pagePx, ...A4 }), { scale: 1 });
});

test("computeFitToPage: เกินหน้านิดเดียว (~1-10%) → ย่อให้พอดี ไม่แตกหน้า", () => {
  const pagePx = A4.pageHeightMm * A4.pxPerMm;
  for (const over of [1.01, 1.05, 1.1]) {
    const fit = computeFitToPage({ contentPx: pagePx * over, ...A4 });
    assert.ok(fit, `เกิน ${Math.round((over - 1) * 100)}% ต้องย่อให้พอดี ไม่ใช่แตกหน้า`);
    assert.ok(Math.abs(fit.scale - 1 / over) < 0.001, "scale ต้อง = พื้นที่หน้า / ความสูงเนื้อหา");
    assert.ok(fit.scale >= 0.85 && fit.scale < 1);
  }
});

test("computeFitToPage: ยาวจริง (เกิน ~18%+) ต้องคืน null แล้วไปแบ่งหน้าตามปกติ", () => {
  const pagePx = A4.pageHeightMm * A4.pxPerMm;
  assert.equal(computeFitToPage({ contentPx: pagePx * 1.5, ...A4 }), null);
  assert.equal(computeFitToPage({ contentPx: pagePx * 2.4, ...A4 }), null);
  assert.equal(computeFitToPage({}), null, "input ไม่ครบต้องไม่ throw");
});

test("contentExtentPx: ตัด padding ท้ายกรอบ A4 ออกจากความยาวที่ต้องแบ่งหน้า", () => {
  assert.equal(contentExtentPx(0, [100], A4.pxPerMm), 0);
  assert.equal(contentExtentPx(2246, [], A4.pxPerMm), 2246, "ไม่มี boundary = ใช้ความสูงเต็ม");
  const ext = contentExtentPx(2246, [400, 900, 1800], A4.pxPerMm);
  assert.ok(ext > 1800 && ext < 1850, "ต้องจบใกล้ ๆ เนื้อหาจริง ไม่ลากไปท้าย canvas");
});

test("share_doc.js: ต้องเรียก shrink-to-fit ก่อนตัดสินใจแบ่งหน้า (ไม่ใช่แบ่งทันที)", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/computeFitToPage\(\{/.test(code), "ต้องมีการเรียก computeFitToPage");
  assert.ok(/slices\.length > 1 \? computeFitToPage/.test(code),
    "ต้องพิจารณาย่อเฉพาะตอนที่จะแตกหน้าเท่านั้น");
});

test("regression: share_doc.js ต้องไม่กลับไปหั่นหน้าแบบเลื่อนทีละความสูงกระดาษ", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/y\s*\+=\s*pageH\b/.test(code), "ห้ามใช้ y += pageH (ตัดกลางแถว)");
  assert.ok(code.includes("computePageSlices({"), "ต้องหั่นหน้าผ่าน computePageSlices");
  assert.ok(/fillStyle\s*=\s*"#ffffff"/.test(code), "ต้องถมพื้นขาวก่อนแปลง JPEG (กันพื้นดำ)");
});

// ── Phase 610 — หน้าสุดท้ายกำพร้า (ใบส่งสินค้า/ใบเสร็จล้นหน้าจนเหลือแค่ลายเซ็นบนหน้า 2) ──
// เพดานย่อ 0.85 ของ 609 แคบไปสำหรับเอกสารที่รายการเยอะกว่าใบเสนอราคา
// ต้องย่อลึกขึ้นเฉพาะเคส "หน้าสุดท้ายแทบไม่มีอะไร" และห้ามแตะเอกสารที่ยาวจริง

const PPM = 1123 / 297;               // px ต่อ มม. ของกรอบ A4 ที่ใช้จริง
const PAGE_MM = 297;
const PAGE_PX = PAGE_MM * PPM;

test("Phase 610: หน้า 2 มีแค่ลายเซ็น = หน้ากำพร้า → ผ่อนเพดานย่อ", () => {
  // ลายเซ็น+ที่ว่างราว 25% ของหน้า → รวม 1.25 หน้า → ต้องย่อ 0.80 ซึ่ง "เพดานเดิม 0.85 ไม่ให้ผ่าน"
  // (ตั้งไว้ 12% ตอนแรกแล้ว test แดง เพราะ 0.89 เพดานเดิมก็ผ่านอยู่แล้ว = ไม่ใช่เคสที่ owner เจอ)
  const orphan = Math.round(PAGE_PX * 0.25);
  const slices = [{ startPx: 0, endPx: PAGE_PX }, { startPx: PAGE_PX, endPx: PAGE_PX + orphan }];
  const floor = fitFloorForSlices({ slices, pxPerMm: PPM, pageHeightMm: PAGE_MM });
  assert.equal(floor, 0.70, "หน้าสุดท้ายเกือบว่าง ต้องยอมย่อลึกกว่าปกติ");

  // และต้องแปลว่า "ได้หน้าเดียวจริง" ไม่ใช่แค่ตัวเลขเปลี่ยน
  const contentPx = PAGE_PX + orphan;
  assert.equal(computeFitToPage({ contentPx, pxPerMm: PPM, pageHeightMm: PAGE_MM }), null,
    "เพดานเดิม 0.85 ยังทำให้แตกสองหน้า (นี่คืออาการที่ owner เจอ)");
  const fit = computeFitToPage({ contentPx, pxPerMm: PPM, pageHeightMm: PAGE_MM, minScale: floor });
  assert.ok(fit && fit.scale > 0.70 && fit.scale < 1, "ต้องย่อลงหน้าเดียวได้");
});

test("Phase 610: หน้าสุดท้ายเต็ม (ใบเสร็จ ต้นฉบับ+สำเนา) ห้ามยุบรวมเป็นหน้าเดียว", () => {
  const slices = [{ startPx: 0, endPx: PAGE_PX }, { startPx: PAGE_PX, endPx: PAGE_PX * 2 }];
  const floor = fitFloorForSlices({ slices, pxPerMm: PPM, pageHeightMm: PAGE_MM });
  assert.equal(floor, 0.85, "สำเนาเต็มใบไม่ใช่หน้ากำพร้า ต้องใช้เพดานปกติ");
  assert.equal(computeFitToPage({ contentPx: PAGE_PX * 2, pxPerMm: PPM, pageHeightMm: PAGE_MM, minScale: floor }), null,
    "ต้องยังได้ 2 หน้า — ห้ามย่อต้นฉบับ+สำเนาให้ทับกันในหน้าเดียว");
});

test("Phase 610: เอกสารยาวจริง (3 หน้าขึ้นไป) ต้องใช้เพดานปกติเสมอ", () => {
  const three = [
    { startPx: 0, endPx: PAGE_PX },
    { startPx: PAGE_PX, endPx: PAGE_PX * 2 },
    { startPx: PAGE_PX * 2, endPx: PAGE_PX * 2 + Math.round(PAGE_PX * 0.05) },
  ];
  assert.equal(fitFloorForSlices({ slices: three, pxPerMm: PPM, pageHeightMm: PAGE_MM }), 0.85,
    "3 หน้าขึ้นไป = ยาวจริง ย่อลงหน้าเดียวไม่สมเหตุผล แม้หน้าสุดท้ายจะว่าง");
});

test("Phase 610: อินพุตไม่ครบ/ผิดรูป ต้องคืนเพดานปกติ (fail-safe ไม่ย่อมั่ว)", () => {
  assert.equal(fitFloorForSlices(), 0.85);
  assert.equal(fitFloorForSlices({ slices: [], pxPerMm: PPM, pageHeightMm: PAGE_MM }), 0.85);
  assert.equal(fitFloorForSlices({ slices: [{ startPx: 0, endPx: 10 }], pxPerMm: PPM, pageHeightMm: PAGE_MM }), 0.85);
  assert.equal(fitFloorForSlices({ slices: [{}, {}], pxPerMm: PPM, pageHeightMm: PAGE_MM }), 0.85,
    "slice ไม่มีตัวเลข = ตัดสินไม่ได้ ต้องไม่ผ่อนเพดาน");
  assert.equal(fitFloorForSlices({ slices: [{ startPx: 0, endPx: PAGE_PX }, { startPx: PAGE_PX, endPx: PAGE_PX + 10 }], pxPerMm: 0, pageHeightMm: PAGE_MM }), 0.85);
});

test("Phase 610: จุดเรียกจริงต้องส่งเพดานที่คำนวณแล้วเข้า computeFitToPage", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/fitFloorForSlices\(\{\s*slices/.test(code), "ต้องคำนวณเพดานจาก slices จริง");
  assert.ok(/computeFitToPage\(\{[^}]*minScale\s*\}\)/.test(code),
    "ต้องส่ง minScale ที่คำนวณได้เข้าไป ไม่ใช่ปล่อยให้ใช้ค่า default");
});

test("Phase 610: orphanFloor ต้องสอดคล้องกับ orphanMaxFill (ไม่งั้นกฎนี้จะไม่ทำอะไรเลย)", () => {
  // ถ้า orphanFloor > 1/(1+orphanMaxFill) จะมีช่วงที่ "ตัดสินว่ากำพร้า" แต่ computeFitToPage ยังคืน null
  // = ผ่อนเพดานแล้วก็ยังแตกสองหน้าเหมือนเดิม (bug เงียบ) — ล็อกด้วยเคสกำพร้าที่แย่ที่สุด
  const worst = Math.round(PAGE_PX * 0.40);
  const slices = [{ startPx: 0, endPx: PAGE_PX }, { startPx: PAGE_PX, endPx: PAGE_PX + worst }];
  const floor = fitFloorForSlices({ slices, pxPerMm: PPM, pageHeightMm: PAGE_MM });
  const fit = computeFitToPage({ contentPx: PAGE_PX + worst, pxPerMm: PPM, pageHeightMm: PAGE_MM, minScale: floor });
  assert.ok(fit, "เคสกำพร้าที่แย่ที่สุดต้องยังย่อลงหน้าเดียวได้จริง");
});

// ── Phase 610 (แก้รอบสอง) — "หนึ่ง .doc-page = หนึ่งหน้า PDF" ────────────────
// ใบส่งสินค้า/ใบเสร็จ เรนเดอร์ [1,2].map = ต้นฉบับ+สำเนา → .doc-page สองอัน
// force-a4 ตั้ง min-height:1123px ⇒ ฉบับที่รายการเยอะสูงเกิน A4 → เดิมถูกหั่นกลางฉบับ

function boundsFromHeights(heights) {
  let y = 0;
  return heights.map(h => { const b = { startPx: y, endPx: y + h }; y += h; return b; });
}

test("Phase 610: ต้นฉบับ+สำเนาที่สูงเกิน A4 ต้องได้ฉบับละหน้า และย่อแยกกัน", () => {
  const over = Math.round(PAGE_PX * 1.18);            // แต่ละฉบับสูงเกิน A4 ~18%
  const pages = planCopyPages({ bounds: boundsFromHeights([over, over]), pxPerMm: PPM, pageHeightMm: PAGE_MM });
  assert.equal(pages.length, 2, "สองฉบับ = สองหน้า PDF ห้ามยุบรวมและห้ามแตกเป็นสามหน้า");
  for (const p of pages) {
    assert.ok(p.scale > 0.55 && p.scale < 1, "ฉบับที่เกิน A4 ต้องถูกย่อให้พอดีหน้า");
    assert.equal(Math.round((p.endPx - p.startPx)), over, "ช่วงพิกเซลต้องครอบทั้งฉบับ ไม่ตัดกลาง");
  }
  assert.equal(pages[1].startPx, over, "ฉบับที่สองต้องเริ่มตรงขอบบนของสำเนา");
});

test("Phase 610: ฉบับที่พอดีหน้าอยู่แล้ว ต้องไม่ถูกย่อ (scale = 1)", () => {
  const fit = Math.round(PAGE_PX * 0.92);
  const pages = planCopyPages({ bounds: boundsFromHeights([fit, fit]), pxPerMm: PPM, pageHeightMm: PAGE_MM });
  assert.deepEqual(pages.map(p => p.scale), [1, 1], "ไม่เกินหน้า = ห้ามย่อ");
});

test("Phase 610: ใบเสนอราคา (.doc-page อันเดียว) ต้องได้หน้าเดียว", () => {
  const pages = planCopyPages({ bounds: boundsFromHeights([Math.round(PAGE_PX * 1.1)]), pxPerMm: PPM, pageHeightMm: PAGE_MM });
  assert.equal(pages.length, 1);
  assert.ok(pages[0].scale < 1 && pages[0].scale > 0.55);
});

test("Phase 610: ฉบับที่สูงเกินเพดาน หรือวัดขอบไม่ได้ → คืน null (กลับไปใช้ตัวหั่นหน้าเดิม)", () => {
  assert.equal(planCopyPages({ bounds: boundsFromHeights([PAGE_PX * 3]), pxPerMm: PPM, pageHeightMm: PAGE_MM }), null,
    "ฉบับเดียวสูง 3 หน้า = ย่อแล้วอ่านไม่ออก ต้อง fallback");
  assert.equal(planCopyPages({ bounds: [], pxPerMm: PPM, pageHeightMm: PAGE_MM }), null);
  assert.equal(planCopyPages({ bounds: [{ startPx: 0, endPx: 0 }], pxPerMm: PPM, pageHeightMm: PAGE_MM }), null);
  assert.equal(planCopyPages({ bounds: boundsFromHeights([PAGE_PX]), pxPerMm: 0, pageHeightMm: PAGE_MM }), null);
  assert.equal(planCopyPages(), null);
});

test("Phase 610: collectDocPageBounds วัดจาก .doc-page จริงและเรียงตามลำดับ", () => {
  const mk = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) });
  const root = {
    getBoundingClientRect: () => ({ top: 10, bottom: 2000, height: 1990 }),
    querySelectorAll: (sel) => (sel === ".doc-page" ? [mk(1210, 2410), mk(10, 1210)] : []),
  };
  const bounds = collectDocPageBounds(root, 2);        // scale 2 = html2canvas scale
  assert.deepEqual(bounds, [{ startPx: 0, endPx: 2400 }, { startPx: 2400, endPx: 4800 }],
    "ต้องคืนช่วงของแต่ละฉบับ เรียงจากบนลงล่าง และคูณ scale แล้ว");
  assert.deepEqual(collectDocPageBounds(null), []);
  assert.deepEqual(collectDocPageBounds({}), []);
});

test("Phase 610: จุดเรียกจริงต้องให้ .doc-page ชนะตัวหั่นหน้าเดิม", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/collectDocPageBounds\(clone/.test(code), "ต้องวัด .doc-page ตอน clone ยังอยู่ใน DOM");
  assert.ok(/planCopyPages\(\{\s*bounds/.test(code), "ต้องวางแผนหน้าจากขอบของแต่ละฉบับ");
  assert.ok(/if \(copyPages\) \{[\s\S]*?\} else if \(fit\)/.test(code),
    "copyPages ต้องถูกเช็คก่อน fit (หนึ่งฉบับ = หนึ่งหน้า มาก่อนการย่อทั้งม้วน)");
});

// ── Phase 613 — ทางสำรองของมือถือต้องไม่ใช่ window.open(blob:) ─────────────
// iOS Safari ปฏิเสธ blob: ในแท็บใหม่ · Android มักบล็อกเป็น popup ⇒ กดแล้วเงียบ
// (ปุ่ม PDF ทำถูกมาแต่เดิม แต่ LINE/FB/แชร์อื่น/อีเมล/พิมพ์ ยังใช้ window.open ทุกแพลตฟอร์ม)

test("Phase 613: ทุกเส้นทางที่เปิด PDF ต้องแยกมือถือ/เดสก์ท็อป ห้าม window.open ตรง ๆ", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/const openOrDownloadPdf = \(\) => \{/.test(code), "ต้องมี helper กลางสำหรับเปิด/ดาวน์โหลด PDF");
  assert.ok(/if \(isMobile\) return dlPdf\(\);/.test(code), "helper ต้องดาวน์โหลดเมื่อเป็นมือถือ");

  // ตรวจ "สัญญา" ไม่ใช่นับบรรทัด: ทุก handler ที่ต้องเปิด PDF ต้องผ่าน helper
  // หรือมีสาขา isMobile ของตัวเอง (ปุ่ม pdf/print) — helper เองมี window.open ได้ (สาขาเดสก์ท็อป)
  const helperStart = code.indexOf("const openOrDownloadPdf");
  const helperEnd = code.indexOf("};", helperStart);
  const outsideHelper = code.slice(0, helperStart) + code.slice(helperEnd);
  for (const seg of outsideHelper.split(/else if \(t===/)) {
    if (!/windowRef\.open\(_pdfUrl/.test(seg)) continue;
    assert.ok(/isMobile/.test(seg),
      `handler ที่เปิด PDF เองต้องมีสาขา isMobile: ${seg.trim().slice(0, 70)}`);
  }
  // และสองปุ่มที่ยังเปิดเองต้องเป็น pdf กับ print เท่านั้น
  assert.ok(/t==="pdf"[\s\S]{0,200}isMobile/.test(code), "ปุ่ม PDF ต้องแยกมือถือ");
  assert.ok(/t==="print"[\s\S]{0,300}isMobile/.test(code), "ปุ่มพิมพ์ต้องแยกมือถือ");
});

test("Phase 613: ปุ่มพิมพ์บนมือถือต้องดาวน์โหลด ไม่ใช่เปิดแท็บแล้วสั่ง print", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  const i = code.indexOf('t==="print"');
  assert.ok(i > 0, "ต้องมีปุ่มพิมพ์");
  const body = code.slice(i, i + 700);
  assert.ok(/if \(isMobile\) \{ if \(dlPdf\(\)\)/.test(body), "มือถือต้องดาวน์โหลด PDF");
  assert.ok(/else \{ setStatus\("เบราว์เซอร์บล็อกแท็บใหม่/.test(body),
    "เดสก์ท็อปที่ถูกบล็อก popup ต้องบอกผู้ใช้ ไม่ใช่เงียบ");
});

test("Phase 613: native share ที่ล้มแบบไม่ใช่ AbortError ต้องไม่ถูกกลืนเงียบ", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/AbortError["'] *\) *shared *= *true; *else *logger\?\.warn\?\./.test(code.replace(/\s+/g, " ")),
    "ผู้ใช้ยกเลิกเอง = ปกติ · ล้มด้วยเหตุอื่น = ต้อง log ไว้สืบได้");
});
