import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { money, formatNumber, formatCurrency, formatDate, formatDateTime } from "../modules/utils.js";

// ── Behavioral (pure I/O) ──
test("money: formats THB currency with 2 decimals", () => {
  assert.match(money(1234.5), /1,234\.50/);
  assert.match(money(0), /0\.00/);
  assert.match(money(null), /0\.00/);   // Number(null||0) = 0
});
test("formatNumber: th-TH grouping, no currency", () => {
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(null), "0");
  assert.equal(formatNumber(undefined), "0");
});
test("formatCurrency: delegates to money", () => {
  assert.equal(formatCurrency(99), money(99));
});
test("formatDate: empty/invalid → '-'", () => {
  assert.equal(formatDate(null), "-");
  assert.equal(formatDate(""), "-");
  assert.equal(formatDate("not-a-date"), "-");
});
test("formatDate: valid date → th-TH localized string (non-empty, not '-')", () => {
  const out = formatDate("2026-05-20");
  assert.notEqual(out, "-");
  assert.ok(out.length > 0);
});
test("formatDate: honors custom opts", () => {
  const out = formatDate("2026-05-20", { year: "numeric" });
  assert.notEqual(out, "-");
});
test("formatDateTime: empty/invalid → '-', valid → non-empty", () => {
  assert.equal(formatDateTime(null), "-");
  assert.equal(formatDateTime("bad"), "-");
  assert.notEqual(formatDateTime("2026-05-20T10:30:00"), "-");
});
test("formatDate/formatDateTime: accept Date instance directly", () => {
  assert.notEqual(formatDate(new Date("2026-05-20")), "-");
  assert.notEqual(formatDateTime(new Date("2026-05-20")), "-");
});

// ── Source-level pins ──
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const mainSrc  = readFileSync(path.join(__dirname2, "..", "main.js"), "utf8");
const utilsSrc = readFileSync(path.join(__dirname2, "..", "modules", "utils.js"), "utf8");

test("Phase 92.8: utils.js exports all 5 formatters", () => {
  assert.ok(/export\s+const\s+money\s*=/.test(utilsSrc));
  assert.ok(/export\s+function\s+formatNumber\s*\(/.test(utilsSrc));
  assert.ok(/export\s+function\s+formatCurrency\s*\(/.test(utilsSrc));
  assert.ok(/export\s+function\s+formatDate\s*\(/.test(utilsSrc));
  assert.ok(/export\s+function\s+formatDateTime\s*\(/.test(utilsSrc));
});
test("Phase 92.8: main.js imports formatters from ./modules/utils.js", () => {
  assert.ok(/import\s*\{[^}]*\bmoney\b[^}]*\bformatNumber\b/.test(mainSrc) ||
            /import\s*\{[^}]*formatNumber[^}]*\}\s*from\s*["']\.\/modules\/utils\.js["']/.test(mainSrc));
});
test("Phase 92.8: main.js no longer inlines the formatter definitions", () => {
  assert.ok(!/const\s+money\s*=\s*\(n\)\s*=>/.test(mainSrc), "money must not be defined inline in main.js");
  assert.ok(!/function\s+formatNumber\s*\(/.test(mainSrc), "formatNumber must not be defined inline in main.js");
  assert.ok(!/function\s+formatDateTime\s*\(/.test(mainSrc), "formatDateTime must not be defined inline in main.js");
});
test("Phase 92.8: window.App still exposes the formatters (caller contract preserved)", () => {
  assert.ok(/window\.App\s*=\s*\{[\s\S]*formatNumber[\s\S]*formatCurrency[\s\S]*formatDate[\s\S]*\}/.test(mainSrc));
});
