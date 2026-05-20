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

import { shareDoc } from "../modules/share_doc.js";

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
