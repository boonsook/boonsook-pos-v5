// Phase 414 — ob-form-coa-labels-and-confirm (build 414)
// Phase 415 — ob-form-dynamic-bank-fields (build 415): ช่องธนาคาร dynamic จาก COA
// Run: node --test tests/opening_balance_guard.test.js
//
// Why this exists:
//   ฟอร์ม "ลงยอดยกมา" (modules/accounting/opening_balance.js) คือทางเข้า OB จริง
//   วันที่ 1 ก.ค. 2569 — label ทุกช่องต้องตรง chart_of_accounts จริง (โดยเฉพาะ
//   equity: เดิม 3200 ถูก label ว่า "ทุนของเจ้าของ" ทั้งที่ COA จริงคือ "กำไรสะสม"
//   → owner ลงทุนเข้าผิดบัญชี) และ confirm ต้องผ่าน modal กลางของแอป
//   (window.App.confirm) ไม่ใช่ native confirm()/alert() ตามกติกาโปรเจกต์.
//   guard นี้ล็อกทั้ง label, การไม่มี native dialog, และ save semantics เดิม
//   (import effective_date ของ Phase 413 + doc_type OB) ไม่ให้หลุดเงียบ ๆ.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/accounting/opening_balance.js"), "utf8");

// helper: extract a const array block by name (source-regex on the block, not whole file)
function extractBlock(name) {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} block must exist`);
  return m[1];
}

// ── 1. equity labels ตรง chart_of_accounts จริง ──────────────────────────────
test("EQUITY_FIELDS: 3100 = ทุนเจ้าของ, 3200 = กำไรสะสม (ตรง COA จริง)", () => {
  const eq = extractBlock("EQUITY_FIELDS");
  assert.match(eq, /\{ code: "3100", label: "ทุนเจ้าของ"/, '3100 must be labeled "ทุนเจ้าของ"');
  assert.match(eq, /\{ code: "3200", label: "กำไรสะสม"/, '3200 must be labeled "กำไรสะสม"');
  assert.ok(!eq.includes("ทุนจดทะเบียน"), 'old wrong label "ทุนจดทะเบียน" must be gone');
  assert.ok(!eq.includes("ทุนของเจ้าของ"), 'old wrong label "ทุนของเจ้าของ" must be gone');
});

// ── 1b. liability labels ตรง COA จริง (2100/2200 เป็น header account — code คงเดิมตาม scope) ──
test("LIABILITY_FIELDS: labels ตรง chart_of_accounts จริง", () => {
  const li = extractBlock("LIABILITY_FIELDS");
  assert.match(li, /\{ code: "2100", label: "หนี้สินหมุนเวียน"/, '2100 must be labeled "หนี้สินหมุนเวียน"');
  assert.match(li, /\{ code: "2120", label: "เจ้าหนี้อื่น"/, '2120 must be labeled "เจ้าหนี้อื่น"');
  assert.match(li, /\{ code: "2200", label: "หนี้สินไม่หมุนเวียน"/, '2200 must be labeled "หนี้สินไม่หมุนเวียน"');
});

// ── 2. ไม่มี native confirm()/alert() — ทุก confirm ต้องเป็น window.App?.confirm?.( ──
test("no native confirm()/alert() — only window.App?.confirm?.(", () => {
  // ตัดการอ้างถึง App.confirm ที่ถูกต้องออกก่อน แล้วเช็คว่าไม่เหลือ confirm(/alert( อื่น
  const stripped = src.replace(/window\.App\?\.confirm(\?\.)?/g, "");
  assert.ok(!/\bconfirm\s*\(/.test(stripped), "native confirm() must not remain");
  assert.ok(!/\balert\s*\(/.test(stripped), "alert() must not be used");
  // และต้องมีการเรียก modal กลางจริง ทั้ง reset + submit (อย่างน้อย 2 จุด)
  const calls = src.match(/await window\.App\?\.confirm\?\.\(/g) || [];
  assert.ok(calls.length >= 2, "reset + submit must both await window.App?.confirm?.(");
});

// ── 2b. boot ผิดลำดับ (App.confirm ยังไม่มี) → ห้ามบันทึก + เตือน ──────────────
test("submit guards missing App.confirm: no save + showToast (no native fallback)", () => {
  assert.match(src, /typeof window\.App\?\.confirm !== "function"/, "must type-check App.confirm before submit");
  assert.match(src, /ระบบยืนยันยังไม่พร้อม/, "must warn user when confirm modal unavailable");
});

// ── 3. effective date ของ Phase 413 ไม่หลุด ──────────────────────────────────
test("still imports ACCOUNTING_EFFECTIVE_DATE from effective_date.js (Phase 413)", () => {
  assert.match(src, /import \{ ACCOUNTING_EFFECTIVE_DATE \} from "\.\/effective_date\.js"/,
    "single-source effective date import must remain");
});

// ── 4. save semantics ไม่ถูกแตะ: doc_type OB + docNoPrefix OB ────────────────
test("save semantics intact: doc_type OB + OB doc_no prefix", () => {
  assert.match(src, /doc_type: "OB"/, 'journal entry must keep doc_type "OB"');
  assert.match(src, /const docNoPrefix = `OB\$\{yyyy\}\$\{mm\}`/, "OB doc_no prefix generation must remain");
});

// ═══ Phase 415 — dynamic bank fields ═══════════════════════════════════════

// behavioral: stub window/fetch แล้วเรียก fetchBankAssetAccounts จริง
const COA_ROWS = [
  { code: "1000", name: "สินทรัพย์",            parent_code: null,   is_active: true, sort_order: 1000 },
  { code: "1100", name: "สินทรัพย์หมุนเวียน",   parent_code: "1000", is_active: true, sort_order: 1100 },
  { code: "1110", name: "เงินสดในมือ",          parent_code: "1100", is_active: true, sort_order: 1110 },
  { code: "1140", name: "ออมทรัพย์",            parent_code: "1100", is_active: true, sort_order: 1140 },
  { code: "1130", name: "กระแสรายวัน",          parent_code: "1100", is_active: true, sort_order: 1130 },
  { code: "1131", name: "กรุงไทย ร้านบุญสุข",   parent_code: "1100", is_active: true, sort_order: 1131 },
  { code: "1150", name: "บัญชีปิดแล้ว",         parent_code: "1100", is_active: false, sort_order: 1150 },
  { code: "1160", name: "กลุ่มเงินฝากพิเศษ",    parent_code: "1100", is_active: true, sort_order: 1160 },
  { code: "1161", name: "ฝากประจำ 12 เดือน",    parent_code: "1160", is_active: true, sort_order: 1161 },
  { code: "1170", name: "ภาษีซื้อ (Input VAT)",  parent_code: "1100", is_active: true, sort_order: 1170 },
  { code: "1200", name: "ลูกหนี้การค้า",         parent_code: "1100", is_active: true, sort_order: 1200 },
  { code: "11x0", name: "code แปลก",            parent_code: "1100", is_active: true, sort_order: 1190 }
];

async function callFetchBanks(rows, ok = true) {
  globalThis.window = { SUPABASE_CONFIG: { url: "https://stub.local", anonKey: "k" } };
  globalThis.fetch = async () => ({ ok, status: ok ? 200 : 500, json: async () => rows });
  const mod = await import("../modules/accounting/opening_balance.js");
  try {
    return await mod.fetchBankAssetAccounts();
  } finally {
    delete globalThis.fetch;
  }
}

test("fetchBankAssetAccounts: leaf 1130–1169 active เท่านั้น เรียง sort_order (header/inactive/นอกช่วง/code แปลก ถูกตัด)", async () => {
  const banks = await callFetchBanks(COA_ROWS);
  assert.deepEqual(banks.map(b => b.code), ["1130", "1131", "1140", "1161"],
    "ต้องได้ leaf ในช่วง 1130–1169 เรียงตาม sort_order — 1110/1200 นอกช่วง, 1150 inactive, 1160 header (มี 1161 ชี้), 11x0 ไม่ใช่ 4 หลัก, 1170 ภาษีซื้อ");
  assert.equal(banks[1].label, "กรุงไทย ร้านบุญสุข", "label ต้องมาจาก name ใน COA");
  assert.ok(banks.every(b => b.emoji === "🏦"), "ทุกช่องธนาคารใช้ emoji 🏦");
});

// ★ Phase 415-fix: 1170 ภาษีซื้อ (Input VAT) อยู่ใน 1130–1199 เดิม — ต้องไม่ติดเข้ากลุ่มธนาคาร
test("fetchBankAssetAccounts: 1170 ภาษีซื้อ (และ 117x+) ต้องไม่ติดเข้ากลุ่มธนาคาร", async () => {
  const banks = await callFetchBanks(COA_ROWS);
  assert.ok(!banks.some(b => b.code === "1170"), "1170 ภาษีซื้อ must be excluded (ขอบบนช่วง = 1169)");
  const srcRange = src.match(/String\(a\.code\) <= "(\d{4})"/);
  assert.equal(srcRange?.[1], "1169", 'upper bound ใน source ต้องเป็น "1169"');
});

test("fetchBankAssetAccounts: HTTP fail → throw (ให้ caller ใช้ fallback)", async () => {
  await assert.rejects(() => callFetchBanks([], false), /HTTP 500/);
});

test("fetchBankAssetAccounts: ผังบัญชีว่าง → throw", async () => {
  await assert.rejects(() => callFetchBanks([]), /ผังบัญชีว่าง/);
});

// source-regex: fallback + ไม่ hardcode บัญชีใหม่
test("render fallback: โหลด COA ล้ม → DEFAULT_BANK_FIELDS + แถบเตือน (ห้ามฟอร์มว่าง)", () => {
  assert.match(src, /const DEFAULT_BANK_FIELDS = \[/, "DEFAULT_BANK_FIELDS fallback block must exist");
  assert.match(src, /bankFields = DEFAULT_BANK_FIELDS/, "catch branch must fall back to DEFAULT_BANK_FIELDS");
  assert.match(src, /โหลดผังบัญชีไม่สำเร็จ — แสดงช่องพื้นฐาน/, "must warn user when COA fetch fails");
});

test("ไม่ hardcode บัญชีธนาคารใหม่ 1131–1136 ใน source (ต้องมาจาก fetch)", () => {
  for (const code of ["1131", "1132", "1133", "1134", "1135", "1136"]) {
    assert.ok(!src.includes(`"${code}"`), `code ${code} must not be hardcoded`);
  }
});

test("regression 414/เดิม: 1110/1200/1300 ยังอยู่ + submit loop ใช้ _assetFields ที่ render จริง", () => {
  for (const code of ["1110", "1120", "1200", "1300"]) {
    assert.ok(src.includes(`{ code: "${code}"`), `field ${code} must remain`);
  }
  assert.ok(!/\bASSET_FIELDS\b/.test(src), "old ASSET_FIELDS const must be fully replaced by _assetFields");
  assert.match(src, /_assetFields\.forEach\(f => \{/, "_onSubmit must collect debit lines from _assetFields");
  assert.match(src, /const totalDebit = _assetFields\.reduce/, "live Dr calc must use _assetFields");
});
