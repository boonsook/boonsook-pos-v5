// VAT readiness guard.
// VAT is available for future use, but must stay inactive until explicitly enabled
// and the configured vatEffectiveDate has arrived.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("main paymentInfo defaults VAT off and carries vatEffectiveDate", () => {
  const src = read("main.js");
  assert.match(src, /import \{ ACCOUNTING_EFFECTIVE_DATE \} from "\.\/modules\/accounting\/effective_date\.js"/);
  assert.match(src, /raw\.vatEnabled\s*=\s*raw\.vatEnabled === true/);
  assert.match(src, /raw\.vatRate\s*=\s*Number\(raw\.vatRate \|\| 7\)/);
  assert.match(src, /raw\.vatPriceMode\s*=\s*raw\.vatPriceMode \|\| ["']exclusive["']/);
  assert.match(src, /raw\.vatEffectiveDate\s*=\s*raw\.vatEffectiveDate \|\| ACCOUNTING_EFFECTIVE_DATE/);
});

test("payment settings exposes and persists VAT effective date", () => {
  const src = read("modules/settings/payment.js");
  assert.match(src, /id=["']setVatEffectiveDate["']/);
  assert.match(src, /ACCOUNTING_EFFECTIVE_DATE/);
  assert.match(src, /const vatEffectiveDate\s*=/);
  assert.match(src, /vatEffectiveDate/);
  assert.match(src, /ตอนนี้ร้านยังไม่เปิด VAT/);
});

test("POS calcVAT requires vatEffectiveDate to be reached", () => {
  const src = read("modules/pos.js");
  assert.match(src, /currentDate = todayBkk\(\)/);
  assert.match(src, /paymentInfo\?\.vatEffectiveDate/);
  assert.match(src, /effectiveReached/);
  assert.match(src, /!!paymentInfo\?\.vatEnabled && rate > 0 && effectiveReached/);
});
