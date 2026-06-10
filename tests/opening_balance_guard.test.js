// Phase 414 — ob-form-coa-labels-and-confirm (build 414)
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
