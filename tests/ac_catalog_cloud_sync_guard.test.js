// Phase 574 / build 574 — ac-catalog cloud sync (ac_catalog_doc) guard
// Run: node --test tests/ac_catalog_cloud_sync_guard.test.js
//
// เป้าหมาย: แคตตาล็อกแอร์ sync ทุกเครื่อง "รวมหน้าลูกค้า" ผ่านตาราง ac_catalog_doc (single-row jsonb):
//   อ่านได้ทุก role ที่ login (ราคาโชว์ลูกค้าโดยดีไซน์) / เขียนเฉพาะ non-customer. localStorage = cache.
//   ★ ห้ามใช้ app_settings (GROUP A Phase 505 = customer deny).
//   source-structure guard (ตรงแนว *_guard.test.js — slice ด้วย anchor + assert).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const acCat = fs.readFileSync(path.resolve("modules/settings/ac-catalog.js"), "utf8");
const sql = fs.readFileSync(path.resolve("supabase-phase574-ac-catalog-doc.sql"), "utf8");

function slice(src, startNeedle, endNeedle) {
  const s = src.indexOf(startNeedle);
  assert.ok(s >= 0, `anchor not found: ${startNeedle}`);
  const e = src.indexOf(endNeedle, s + startNeedle.length);
  return src.slice(s, e > s ? e : s + 2000);
}

// ── load: cloud → localStorage + from_cloud flag ─────────────────────────────
const loadFn = slice(main, "async function loadAcCatalogCloud()", "async function saveAcCatalogCloud(");
test("loadAcCatalogCloud — cloud array>0 → setItem bsk_ac_catalog + from_cloud flag", () => {
  assert.match(loadFn, /from\('ac_catalog_doc'\)/, "ต้องอ่านจากตาราง ac_catalog_doc");
  assert.match(loadFn, /Array\.isArray\(value\) && value\.length > 0/, "เจอ array>0 เท่านั้นถึงทับ local");
  assert.match(loadFn, /localStorage\.setItem\("bsk_ac_catalog",/, "cloud → เขียน bsk_ac_catalog");
  assert.match(loadFn, /localStorage\.setItem\("bsk_ac_catalog_from_cloud", "1"\)/, "ต้อง mark from_cloud");
});

test("loadAcCatalogCloud — seed: ไม่มีแถว + userEdited + non-customer → push local ขึ้น cloud; fail = เงียบ", () => {
  assert.match(loadFn, /else if \(!data\)/, "ไม่มีแถว (row ยังไม่ถูกสร้าง)");
  assert.match(loadFn, /bsk_ac_catalog_user_edited"\) === "1"/, "seed เฉพาะเครื่องที่ user เคยแก้");
  assert.match(loadFn, /currentRole\(\) !== "customer"/, "seed เฉพาะ non-customer");
  assert.match(loadFn, /await saveAcCatalogCloud\(localList\)/, "seed = push local ขึ้น cloud");
  assert.match(loadFn, /catch[\s\S]*console\.warn\('\[loadAcCatalogCloud\] failed/, "fetch fail → เงียบ (ใช้ localStorage เดิม)");
});

// ── save: gate customer + upsert single-row ──────────────────────────────────
const saveFn = slice(main, "async function saveAcCatalogCloud(", "window._appSaveAcCatalog");
test("saveAcCatalogCloud — gate customer (no-op) + upsert id=1 ก่อนถึง .from()", () => {
  const gateIdx = saveFn.indexOf('currentRole() === "customer"');
  const upsertIdx = saveFn.indexOf(".upsert(");
  assert.ok(gateIdx >= 0, "ต้องมี gate customer");
  assert.ok(upsertIdx > gateIdx, "gate customer ต้องมาก่อน upsert (ลูกค้า = no-op ไม่ยิง DB)");
  assert.match(saveFn, /return \{ ok: false, denied: true \}/, "customer → คืน denied (ไม่ใช่ error sync)");
  assert.match(saveFn, /\.upsert\(\{ id: 1, value:/, "upsert single-row id=1");
});
test("main.js — expose window._appSaveAcCatalog + เรียก loadAcCatalogCloud ใน afterLogin ก่อน loadAllData", () => {
  assert.match(main, /window\._appSaveAcCatalog = saveAcCatalogCloud;/, "ต้อง expose ให้ settings เรียก");
  const aloadIdx = main.indexOf("await loadAcCatalogCloud();");
  const allDataIdx = main.indexOf("await loadAllData();");
  assert.ok(aloadIdx >= 0, "afterLogin ต้องเรียก loadAcCatalogCloud");
  assert.ok(aloadIdx < allDataIdx, "loadAcCatalogCloud ต้องมาก่อน loadAllData (set from_cloud ก่อน auto-refresh check)");
});
test("★ ห้ามใช้ app_settings สำหรับ catalog (customer deny) — ใช้ ac_catalog_doc", () => {
  assert.ok(!/from\('app_settings'\)[\s\S]{0,200}ac_catalog/i.test(main), "catalog ต้องไม่ผ่าน app_settings");
  assert.match(loadFn, /from\('ac_catalog_doc'\)/);
  assert.match(saveFn, /from\('ac_catalog_doc'\)/);
});

// ── auto-refresh: needRefresh เพิ่ม !fromCloud ───────────────────────────────
test("main.js loadAllData — needRefresh เพิ่ม !fromCloud (cloud = source of truth)", () => {
  assert.match(main, /const fromCloud = localStorage\.getItem\("bsk_ac_catalog_from_cloud"\) === "1"/, "อ่าน from_cloud flag");
  assert.match(main, /const needRefresh = !cacheUsable \|\| \(lowSpec && !userEdited && !fromCloud\)/, "lowSpec branch เพิ่ม !fromCloud");
});

// ── ac-catalog.js: _writeCatalog local-ก่อน-cloud + toast fail ───────────────
const writeFn = slice(acCat, "function _writeCatalog(list)", "\n}\n");
test("_writeCatalog — local setItem 'ก่อน' cloud sync + toast เมื่อ sync fail", () => {
  const localIdx = writeFn.indexOf('localStorage.setItem("bsk_ac_catalog"');
  const cloudIdx = writeFn.indexOf("window._appSaveAcCatalog");
  assert.ok(localIdx >= 0 && cloudIdx > localIdx, "local เขียนก่อน cloud (offline-safe + last-write-wins)");
  assert.match(writeFn, /res\.ok === false && !res\.denied/, "fail (ไม่ใช่ customer-deny) → เตือน");
  assert.match(writeFn, /sync ข้ามเครื่องไม่สำเร็จ/, "toast บอก local สำเร็จแต่ sync ล้ม");
});

// ── ac-catalog.js: reload-JSON + clear-all push ขึ้น cloud (mutation ที่ไม่ผ่าน _writeCatalog) ─
test("reload-JSON + clear-all → push ขึ้น cloud (ปิดช่อง mutation ที่ไม่ผ่าน _writeCatalog)", () => {
  // reload from JSON: push ชุดใหม่ + set from_cloud
  const reloadIdx = acCat.indexOf("data/ac_catalog.json");
  const reloadBlock = acCat.slice(reloadIdx, reloadIdx + 900);
  assert.match(reloadBlock, /await window\._appSaveAcCatalog\?\.\(data\)/, "reload-JSON ต้อง push data ขึ้น cloud");
  assert.match(reloadBlock, /bsk_ac_catalog_from_cloud", "1"/, "reload สำเร็จ → mark from_cloud");
  // clear all: push [] (ไม่มี DELETE policy = UPDATE เป็น [])
  const clearIdx = acCat.indexOf("ล้างแคตตาล็อกแอร์ทั้งหมด");
  const clearBlock = acCat.slice(clearIdx, clearIdx + 700);
  assert.match(clearBlock, /await window\._appSaveAcCatalog\?\.\(\[\]\)/, "clear-all ต้อง push [] ขึ้น cloud (หน้าลูกค้าหายตาม)");
});

// ── SQL: table + RLS 3 policies (no DELETE) + is_customer_role gate + NOTIFY ──
test("SQL phase574 — ac_catalog_doc + RLS: select(true) / insert+update(NOT is_customer_role) / ไม่มี DELETE + NOTIFY", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ac_catalog_doc/, "สร้างตาราง");
  assert.match(sql, /id\s+int PRIMARY KEY DEFAULT 1 CHECK \(id = 1\)/, "single-row id=1");
  assert.match(sql, /value\s+jsonb NOT NULL/, "value jsonb");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/, "เปิด RLS");
  assert.match(sql, /FOR SELECT TO authenticated\s*\n\s*USING \(true\)/, "อ่านได้ทุก authenticated (รวมลูกค้า)");
  assert.match(sql, /FOR INSERT TO authenticated\s*\n\s*WITH CHECK \(NOT COALESCE\(public\.is_customer_role\(\), false\)\)/, "insert เฉพาะ non-customer");
  assert.match(sql, /FOR UPDATE TO authenticated[\s\S]*USING \(NOT COALESCE\(public\.is_customer_role\(\), false\)\)[\s\S]*WITH CHECK \(NOT COALESCE\(public\.is_customer_role\(\), false\)\)/, "update เฉพาะ non-customer");
  assert.ok(!/FOR DELETE/i.test(sql), "ต้องไม่มี DELETE policy (ลบแถวไม่ได้เลย = ปลอดภัยสุด)");
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/, "reload schema cache");
});
