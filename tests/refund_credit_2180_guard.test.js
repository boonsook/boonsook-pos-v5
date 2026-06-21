// Phase 512 - refund credit/exchange must post to customer-credit liability, not cash.
// Run: node --test tests/refund_credit_2180_guard.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

globalThis.window = {
  SUPABASE_CONFIG: { url: "https://example.supabase.co", anonKey: "anon-xxx" },
  _sbAccessToken: "user-jwt",
  App: { showToast: () => {} },
};

const { refundMappingKeyForMethod } = await import("../modules/accounting/auto_post.js");

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

function bodyOfFunction(src, startToken) {
  const start = src.indexOf(startToken);
  assert.ok(start >= 0, `missing ${startToken}`);
  const signatureEnd = src.indexOf(") {", start + startToken.length);
  assert.ok(signatureEnd > start, `missing function signature end for ${startToken}`);
  const open = src.indexOf("{", signatureEnd);
  assert.ok(open > start, `missing function body for ${startToken}`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return src.slice(start, i + 1);
  }
  assert.fail(`unterminated function body for ${startToken}`);
}

test("refundMappingKeyForMethod routes credit/exchange to 2180 mappings", () => {
  assert.equal(refundMappingKeyForMethod("cash"), "refund_cash");
  assert.equal(refundMappingKeyForMethod("เงินสด"), "refund_cash");
  assert.equal(refundMappingKeyForMethod("transfer"), "refund_transfer");
  assert.equal(refundMappingKeyForMethod("โอน"), "refund_transfer");
  assert.equal(refundMappingKeyForMethod("credit"), "refund_credit");
  assert.equal(refundMappingKeyForMethod("เครดิตในบัญชี"), "refund_credit");
  assert.equal(refundMappingKeyForMethod("exchange"), "refund_exchange");
  assert.equal(refundMappingKeyForMethod("เปลี่ยนสินค้า"), "refund_exchange");
  assert.equal(refundMappingKeyForMethod(""), null);
  assert.equal(refundMappingKeyForMethod("store_coupon"), null);
});

test("postJournalForRefund does not default unknown/credit/exchange to refund_cash", () => {
  const src = read("modules/accounting/auto_post.js");
  const body = bodyOfFunction(src, "export async function postJournalForRefund(");

  assert.match(body, /refundMappingKeyForMethod\(refund\.refund_method\)/);
  assert.doesNotMatch(body, /let\s+mappingKey\s*=\s*["']refund_cash["']/);
  assert.match(body, /unknown-refund-method/);
  assert.match(body, /status:\s*["']failed["']/);
});

test("Phase 512 SQL seeds 2180 and refund_credit/refund_exchange mappings", () => {
  const sql = read("supabase-phase512-refund-credit-2180.sql");

  assert.match(sql, /INSERT INTO public\.chart_of_accounts[\s\S]*'2180'/);
  assert.match(sql, /เครดิตคงเหลือลูกค้า\/เจ้าหนี้ลูกค้าจากใบลดหนี้/);
  assert.match(sql, /'refund_credit'[\s\S]*'4110'[\s\S]*'2180'/);
  assert.match(sql, /'refund_exchange'[\s\S]*'4110'[\s\S]*'2180'/);
  assert.doesNotMatch(sql, /'2110'/, "customer credit must not use trade payable 2110");
  assert.match(sql, /NOTIFY pgrst,\s*'reload schema'/);
});
