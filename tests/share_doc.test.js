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

import { shareDoc, computePageSlices, collectBreakBoundaries } from "../modules/share_doc.js";

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

test("regression: share_doc.js ต้องไม่กลับไปหั่นหน้าแบบเลื่อนทีละความสูงกระดาษ", () => {
  const code = shareSrc.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/y\s*\+=\s*pageH\b/.test(code), "ห้ามใช้ y += pageH (ตัดกลางแถว)");
  assert.ok(code.includes("computePageSlices({"), "ต้องหั่นหน้าผ่าน computePageSlices");
  assert.ok(/fillStyle\s*=\s*"#ffffff"/.test(code), "ต้องถมพื้นขาวก่อนแปลง JPEG (กันพื้นดำ)");
});
