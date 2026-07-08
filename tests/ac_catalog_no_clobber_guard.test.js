// Phase 570 — Guard: แคตตาล็อกแอร์ไม่ถูก auto-refresh ทับ + export/import คง ac_type
//   (1) loadAllData refresh จาก ac_catalog.json = MERGE-skip: user เคยแก้ (flag) → ไม่ทับทั้งก้อน
//       (เดิม specs coverage <90% → ทับ → รุ่น/การแก้ไข user หาย). refresh เฉพาะ cache ว่าง/พัง.
//   (2) export/import round-trip คง ac_type (owner จัดประเภท 223 รุ่น bulk ผ่าน Excel).
// Run: node --test tests/ac_catalog_no_clobber_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _toExportRow, _fromImportRow, _acTypeFromImport, _EXPORT_HEADERS } from "../modules/settings/ac-catalog.js";

const MAIN = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const CAT = readFileSync(new URL("../modules/settings/ac-catalog.js", import.meta.url), "utf8");

// pick — จำลอง helper จริงใน import handler (case-insensitive + strip whitespace)
const pick = (obj, keys) => {
  for (const k of keys) {
    const found = Object.keys(obj).find(ok => ok.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, ""));
    if (found && obj[found] !== "" && obj[found] != null) return obj[found];
  }
  return "";
};

// ── (1) flag/refresh decision — จำลองสูตร loadAllData ─────────────────────────
// ★ Phase 574: เพิ่ม fromCloud (default false = backward-compat). มาจาก cloud แล้ว = source of truth
//   → ห้าม auto-refresh ทับด้วย static ac_catalog.json (แม้ specs coverage ต่ำ).
function needRefresh(cached, userEdited, fromCloud = false) {
  let cacheUsable = false, lowSpec = false;
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cacheUsable = true;
        const specced = parsed.filter(p => p && (p.features || p.seer || p.description)).length;
        lowSpec = specced < parsed.length * 0.9;
      }
    } catch (e) { /* corrupt */ }
  }
  return !cacheUsable || (lowSpec && !userEdited && !fromCloud);
}
const lowSpecCache = JSON.stringify([{ model: "A", features: ["x"] }, { model: "B" }, { model: "C" }]); // 1/3 spec < 90%
const highSpecCache = JSON.stringify([{ model: "A", seer: 20 }, { model: "B", features: ["y"] }]);

test("cache ว่าง → refresh (ไม่มีอะไรเสีย)", () => {
  assert.equal(needRefresh(null, false), true);
  assert.equal(needRefresh(null, true), true);   // แม้ user เคยแก้ ถ้า cache หาย = กู้
});
test("cache พัง (corrupt/empty array) → refresh", () => {
  assert.equal(needRefresh("{not json", false), true);
  assert.equal(needRefresh("[]", false), true);
  assert.equal(needRefresh("{not json", true), true);  // corrupt + edited = กู้
});
test("★ specs ไม่ครบ + user เคยแก้ → NO refresh (กันทับรุ่น/แก้ไข user)", () => {
  assert.equal(needRefresh(lowSpecCache, true), false);   // หัวใจของ fix
});
test("specs ไม่ครบ + user ยังไม่แก้ → refresh (ได้ spec ใหม่จาก JSON)", () => {
  assert.equal(needRefresh(lowSpecCache, false), true);
});
test("★ Phase 574: specs ไม่ครบ + มาจาก cloud → NO refresh (cloud = source of truth, ห้าม static ทับ)", () => {
  assert.equal(needRefresh(lowSpecCache, false, true), false);   // fromCloud ระงับ refresh แม้ user ยังไม่แก้
  assert.equal(needRefresh(lowSpecCache, true, true), false);    // เคยแก้ + cloud = ยิ่งไม่ refresh
  assert.equal(needRefresh(null, false, true), true);            // cache หาย = ยังกู้ (fromCloud ไม่ override recovery)
});
test("specs ครบ → ไม่ refresh (ทั้งเคย/ไม่เคยแก้)", () => {
  assert.equal(needRefresh(highSpecCache, false), false);
  assert.equal(needRefresh(highSpecCache, true), false);
});

// ── (2) ac_type mapping (อังกฤษ + ไทย) ────────────────────────────────────────
test("_acTypeFromImport: อังกฤษ key ตรง", () => {
  assert.equal(_acTypeFromImport("wall"), "wall");
  assert.equal(_acTypeFromImport("ceiling"), "ceiling");
  assert.equal(_acTypeFromImport("cassette"), "cassette");
});
test("_acTypeFromImport: label ไทย (มี/ไม่มี 'แอร์' นำหน้า)", () => {
  assert.equal(_acTypeFromImport("ติดผนัง"), "wall");
  assert.equal(_acTypeFromImport("แอร์ติดผนัง"), "wall");
  assert.equal(_acTypeFromImport("แขวน"), "ceiling");
  assert.equal(_acTypeFromImport("แอร์แขวน"), "ceiling");
  assert.equal(_acTypeFromImport("สี่ทิศทาง"), "cassette");
});
test("_acTypeFromImport: ไม่รู้จัก/ว่าง → undefined (acTypeOf fallback wall เอง)", () => {
  assert.equal(_acTypeFromImport("garbage"), undefined);
  assert.equal(_acTypeFromImport(""), undefined);
  assert.equal(_acTypeFromImport(null), undefined);
});

// ── (2) export/import round-trip คง ac_type ───────────────────────────────────
test("_EXPORT_HEADERS มี ac_type + cost/sku/note", () => {
  for (const h of ["ac_type", "cost", "sku", "note"]) assert.ok(_EXPORT_HEADERS.includes(h), `header ${h} ต้องมี`);
});
test("_toExportRow ส่ง ac_type (derive) + cost/sku/note", () => {
  const row = _toExportRow({ section: "Daikin", model: "X1", ac_type: "cassette", cost: 5000, sku: "SKU1", note: "โปร" });
  assert.equal(row.ac_type, "cassette");
  assert.equal(row.cost, 5000);
  assert.equal(row.sku, "SKU1");
  assert.equal(row.note, "โปร");
});
test("_toExportRow: ไม่มี ac_type → derive 'wall' (acTypeOf fallback)", () => {
  assert.equal(_toExportRow({ section: "A", model: "B" }).ac_type, "wall");
});
test("round-trip: export ceiling → import (หัวไทย 'ประเภท') → ac_type คง ceiling", () => {
  const row = _toExportRow({ section: "Mitsu", model: "Y1", ac_type: "ceiling" });
  // owner ส่งออกแล้วกรอกหัวไทย
  const imported = _fromImportRow({ ...row, "ประเภท": "แขวน" }, 0, pick);
  assert.equal(imported.ac_type, "ceiling");
});
test("import: ac_type อังกฤษ ('cassette') → เก็บถูก + cost/sku/note", () => {
  const e = _fromImportRow({ section: "S", model: "M", ac_type: "cassette", cost: "3200", sku: "K9", note: "n" }, 0, pick);
  assert.equal(e.ac_type, "cassette");
  assert.equal(e.cost, 3200);
  assert.equal(e.sku, "K9");
  assert.equal(e.note, "n");
});
test("import: ไม่มี ประเภท → ac_type ไม่ถูก set (acTypeOf → wall ตอน render)", () => {
  const e = _fromImportRow({ section: "S", model: "M" }, 0, pick);
  assert.equal(e.ac_type, undefined);
});

// ── source-regex: ผูก flag logic กับ source จริง ──────────────────────────────
test("main.js loadAllData ใช้ flag bsk_ac_catalog_user_edited (+ !fromCloud Phase 574)", () => {
  assert.match(MAIN, /bsk_ac_catalog_user_edited/);
  // Phase 574: เพิ่ม !fromCloud (cloud = source of truth) — ยังคง !userEdited (ไม่ weaken การกันทับของ Phase 570)
  assert.match(MAIN, /const needRefresh = !cacheUsable \|\| \(lowSpec && !userEdited && !fromCloud\)/);
});
test("ac-catalog.js: _writeCatalog ตั้ง flag + manual refresh เคลียร์ flag", () => {
  assert.match(CAT, /localStorage\.setItem\("bsk_ac_catalog_user_edited", "1"\)/);
  assert.match(CAT, /localStorage\.removeItem\("bsk_ac_catalog_user_edited"\)/);
});
