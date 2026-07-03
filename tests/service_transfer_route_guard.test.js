// Phase 560 — guard: งานบริการรับเงินโอน route Dr ตามประเภทงาน + QR เฉพาะบัญชีที่ผูก
// บั๊กเดิม: postJournalForServiceJob รับโอน hardcode Dr="1130" แบน → ไม่เข้าบัญชีย่อยตาม Settings.
// แก้: Dr = account_mapping.transfer_debit_code ต่อประเภทงาน (validate ผ่าน _resolveReceiptDebitAccount).
// Run: node --test tests/service_transfer_route_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

globalThis.window = globalThis.window || {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  App: { showToast: () => {} },
};

const { serviceMappingKeyForJobType, _resolveReceiptDebitAccount } = await import("../modules/accounting/auto_post.js");
const { _svPayQrHtml } = await import("../modules/service_form.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(__dirname, "..", f), "utf8");

// ── job_type → mapping_key (single source) ──────────────────────────────
test("serviceMappingKeyForJobType: map ครบ + fallback service_other", () => {
  assert.equal(serviceMappingKeyForJobType("clean_ac"), "service_clean_ac");
  assert.equal(serviceMappingKeyForJobType("install_ac"), "service_install_ac");
  assert.equal(serviceMappingKeyForJobType("ac"), "service_install_ac");
  assert.equal(serviceMappingKeyForJobType("solar"), "service_solar");
  assert.equal(serviceMappingKeyForJobType("CCTV"), "service_cctv");        // case-insensitive
  assert.equal(serviceMappingKeyForJobType("unknown"), "service_other");    // fallback
  assert.equal(serviceMappingKeyForJobType(""), "service_other");
  assert.equal(serviceMappingKeyForJobType(null), "service_other");
});

// ── Dr routing = reuse _resolveReceiptDebitAccount (validate + fallback 1130) ─
test("Dr routing: transfer_debit_code valid → บัญชีนั้น; ยังไม่ตั้ง/invalid → 1130", () => {
  const valid = new Set(["1130", "1134", "1136"]);
  assert.equal(_resolveReceiptDebitAccount("1134", "1130", valid), "1134");   // ล้างแอร์ → KBANK งานช่าง
  assert.equal(_resolveReceiptDebitAccount("1136", "1130", valid), "1136");   // ติดตั้ง → SCB
  assert.equal(_resolveReceiptDebitAccount(null, "1130", valid), "1130");     // ยังไม่ตั้ง → fallback
  assert.equal(_resolveReceiptDebitAccount("", "1130", valid), "1130");
  assert.equal(_resolveReceiptDebitAccount("9999", "1130", valid), "1130");   // COA ไม่มีจริง → fallback
  assert.equal(_resolveReceiptDebitAccount("1134", "1130", new Set()), "1134"); // COA cache ว่าง → fail-open
});

test("source: postJournalForServiceJob รับโอนใช้ transfer_debit_code + _resolveReceiptDebitAccount (ไม่ hardcode 1130 แบน)", () => {
  const ap = read("modules/accounting/auto_post.js");
  const fn = ap.slice(ap.indexOf("export async function postJournalForServiceJob"), ap.indexOf("export async function postJournalForReceipt"));
  assert.match(fn, /_resolveReceiptDebitAccount\(\s*mapping\.transfer_debit_code\s*,\s*"1130"/, "รับโอน route ผ่าน transfer_debit_code");
  assert.doesNotMatch(fn, /debitAccount = "1130";/, "ต้องไม่มี hardcode Dr=1130 แบบเดิม");
});

// ── QR: โชว์เฉพาะบัญชีที่ผูก (ไม่ dump ทุกบัญชี) ──────────────────────────
const PI = {
  qrImage: "https://x/main.png",
  promptPay: "0812345678",
  banks: [
    { bankName: "KBANK", bankAccount: "111", coaCode: "1134", qrImage: "https://x/kbank.png", bankHolder: "A" },
    { bankName: "SCB", bankAccount: "222", coaCode: "1136", qrImage: "https://x/scb.png" },
    { bankName: "KTB", bankAccount: "333", coaCode: "1131" },
  ],
};
test("QR: targetCoa=1134 → โชว์เฉพาะ KBANK; ไม่โผล่ SCB/KTB", () => {
  const html = _svPayQrHtml(PI, "transfer", "1134");
  assert.match(html, /111/);                 // เลขบัญชี KBANK
  assert.match(html, /kbank\.png/);          // QR KBANK
  assert.ok(!html.includes("222"), "ต้องไม่โผล่ SCB");
  assert.ok(!html.includes("333"), "ต้องไม่โผล่ KTB");
});
test("QR: targetCoa=1136 → โชว์เฉพาะ SCB", () => {
  const html = _svPayQrHtml(PI, "transfer", "1136");
  assert.match(html, /222/);
  assert.ok(!html.includes("111"), "ต้องไม่โผล่ KBANK");
});
test("QR: targetCoa ไม่มี bank ตรง → ข้อความชวนตั้ง (ไม่ dump บัญชีอื่น)", () => {
  const html = _svPayQrHtml(PI, "transfer", "9999");
  assert.match(html, /COA 9999/);
  assert.ok(!html.includes("111") && !html.includes("222") && !html.includes("333"), "ห้าม dump บัญชีอื่น");
});
test("QR: targetCoa ว่าง → QR หลักเท่านั้น ไม่ dump ทุกบัญชี", () => {
  const html = _svPayQrHtml(PI, "transfer", null);
  assert.match(html, /main\.png/);
  assert.ok(!html.includes("111") && !html.includes("222") && !html.includes("333"), "targetCoa ว่างห้าม dump ทุกบัญชี");
});
test("QR: method≠transfer → \"\" (เคลียร์)", () => {
  assert.equal(_svPayQrHtml(PI, "cash", "1134"), "");
  assert.equal(_svPayQrHtml(PI, "", "1134"), "");
});
test("QR: escape XSS (ชื่อบัญชีมี < > )", () => {
  const evil = { banks: [{ bankName: "<img src=x onerror=alert(1)>", bankAccount: "1", coaCode: "1134" }] };
  const html = _svPayQrHtml(evil, "transfer", "1134");
  assert.ok(!html.includes("<img src=x"), "ต้อง escape");
  assert.match(html, /&lt;img/);
});

// ── Regression LOCK: path อื่นห้ามขยับ (owner กังวลของแถม) ──────────────────
test("regression: POS/receipt/expense debit logic ไม่ถูกแตะ", () => {
  const ap = read("modules/accounting/auto_post.js");
  // POS sale ยังใช้ BANK_COA จาก note
  assert.match(ap, /BANK_COA:\(\\d\{4,5\}\)/, "POS sale ยังใช้ BANK_COA note");
  // receipt ยังใช้ _resolveReceiptDebitAccount กับ bank_coa_code
  assert.match(ap, /mappingKey === "receipt_revenue_transfer" && receipt\.bank_coa_code/, "receipt routing เดิม");
  // expense ยัง Cr 1130/2120
  assert.match(ap, /creditAccount = "1130"/, "expense credit เดิม");
  assert.match(ap, /creditAccount = "2120"/, "expense credit บัตร เดิม");
});
