// Phase 629 — shared fixture for the document line-item `unit` stored-XSS regression
// (used by tests/phase629_document_unit_xss.test.js — node unit — and
//  tests/e2e/phase629_document_unit_xss.spec.js — real Chromium parser).
//
// Bug class: `unit` is free text typed in the quotation form, stored in
// quotation_items.unit and copied to delivery_invoice_items / receipt_items on
// conversion. Four row templates wrote it into HTML raw:
//   - quotations.js form row      value="${item.unit||'ชิ้น'}"         (attribute context)
//   - quotations / delivery_invoices / receipts preview rows
//       '<td …>'+(item.unit||'ชิ้น')+'</td>'                            (text context;
//       the same preview DOM is reused by print / PDF / share)
// Phase 625's harness replaced every non-escHtml `${…}` with "0", so the raw
// `unit` sink was invisible to it. This harness does not substitute anything:
// it extracts the REAL row callback passed to `_lineItems.map(` inside each
// render function and executes it with the module's own `num` helper and the
// canonical escHtml (modules/utils.js). A reverted wrapper therefore shows up
// as rendered markup / injected attributes, not as a missing string.
//
// No free globals here on purpose: this file sits outside the eslint test/e2e
// blocks and is linted with the bare recommended rule set.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Read-only redirect used ONLY for the baseline / mutation campaign (points at a
// scratch mirror that holds modules/{quotations,delivery_invoices,receipts}.js).
// Unset in CI and normal runs → the repo sources are read.
export const SOURCE_ROOT = process.env.PHASE629_SOURCE_ROOT || ROOT;

export function readModuleSource(file) {
  return readFileSync(path.join(SOURCE_ROOT, file), "utf8");
}

// ── Attack fixtures ─────────────────────────────────────────────────────────
export const PAYLOAD_DQ = '" autofocus onfocus="window.__phase629Pwned=1';
export const PAYLOAD_SQ = "' autofocus onfocus='window.__phase629Pwned=1";
export const PAYLOAD_IMG = '<img src=x onerror="window.__phase629Pwned=1">';
export const PAYLOAD_ALL5 = "&<>\"'";
export const PAYLOAD_ALL5_ESCAPED = "&amp;&lt;&gt;&quot;&#039;";
export const PAYLOAD_THAI = "ชุด (2 เครื่อง)";

export const ATTACK_PAYLOADS = [
  { name: "double-quote breakout", payload: PAYLOAD_DQ },
  { name: "single-quote breakout", payload: PAYLOAD_SQ },
  { name: "img onerror injection", payload: PAYLOAD_IMG },
];

// Fallback the templates use when unit is empty (must stay unchanged).
export const UNIT_FALLBACK = "ชิ้น";

// ── Sites under test ────────────────────────────────────────────────────────
// fnDecl is function-scoped: the row callback is looked up only between this
// declaration and the next top-level function, and must be the one and only
// `_lineItems.map(` there.
export const SITES = [
  {
    id: "QT-FORM",
    file: "modules/quotations.js",
    fnDecl: "function renderQuotationForm(container) {",
    context: "attribute",
    cells: 8,
  },
  {
    id: "QT-PREVIEW",
    file: "modules/quotations.js",
    fnDecl: "function renderQuotationPreview(container) {",
    context: "text",
    cells: 5,
  },
  {
    id: "DI-PREVIEW",
    file: "modules/delivery_invoices.js",
    fnDecl: "function renderInvoicePreview(container) {",
    context: "text",
    cells: 5,
  },
  {
    id: "RC-PREVIEW",
    file: "modules/receipts.js",
    fnDecl: "function renderReceiptPreview(container) {",
    context: "text",
    cells: 5,
  },
];

export function fixtureItem(unit) {
  return { product_id: null, item_name: "สินค้าทดสอบ", qty: 2, unit, unit_price: 150, discount_pct: 0, line_total: 300 };
}

// ── Source extraction ───────────────────────────────────────────────────────
function countOf(hay, needle) {
  return hay.split(needle).length - 1;
}

export function extractFunctionRegion(src, fnDecl) {
  const hits = countOf(src, fnDecl);
  if (hits !== 1) throw new Error(`"${fnDecl}" must appear exactly once, found ${hits}`);
  const start = src.indexOf(fnDecl);
  const after = start + fnDecl.length;
  const ends = ["\nfunction ", "\nasync function ", "\nexport function ", "\nexport async function "]
    .map((m) => src.indexOf(m, after))
    .filter((i) => i !== -1);
  return src.slice(start, ends.length ? Math.min(...ends) : src.length);
}

// Scan forward from the "(" of `.map(` to its matching ")". Understands
// '…' / "…" strings, `…` templates with nested ${…}, and // or /* */ comments.
function matchingParen(src, openIdx) {
  const stack = ["("];
  let i = openIdx + 1;
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const n = src[i + 1];
    if (top === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i++; continue; }
      if (c === "$" && n === "{") { stack.push("{"); i += 2; continue; }
      i++;
      continue;
    }
    if (c === "/" && n === "/") { const nl = src.indexOf("\n", i); i = nl === -1 ? src.length : nl; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (c === "`") { stack.push("tpl"); i++; continue; }
    if (c === "(" || c === "{" || c === "[") { stack.push(c); i++; continue; }
    if (c === ")" || c === "}" || c === "]") {
      const want = { ")": "(", "}": "{", "]": "[" }[c];
      if (top !== want) throw new Error(`unbalanced "${c}" at offset ${i}`);
      stack.pop();
      if (stack.length === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  throw new Error("no matching ) for _lineItems.map(");
}

export function extractRowCallback(src, site) {
  const region = extractFunctionRegion(src, site.fnDecl);
  const marker = "_lineItems.map(";
  const hits = countOf(region, marker);
  if (hits !== 1) throw new Error(`${site.id}: "${marker}" must appear exactly once in ${site.fnDecl}, found ${hits}`);
  const open = region.indexOf(marker) + marker.length - 1;
  const close = matchingParen(region, open);
  return region.slice(open + 1, close).trim();
}

export function extractNumHelper(src) {
  const all = src.match(/^function num\(n\)\s*\{[^\n]*\}\s*$/gm) || [];
  if (all.length !== 1) throw new Error(`module must declare exactly one one-line function num(n), found ${all.length}`);
  return all[0].trim();
}

// The unescaped shape every site had before Phase 629. Positive controls and the
// "no other output changed" check render through this variant.
export function unsafeUnitVariant(callbackSrc) {
  const wrapped = "escHtml(item.unit||'" + UNIT_FALLBACK + "')";
  const n = countOf(callbackSrc, wrapped);
  if (n > 1) throw new Error("more than one escaped unit expression — ambiguous");
  return n === 1 ? callbackSrc.split(wrapped).join("(item.unit||'" + UNIT_FALLBACK + "')") : callbackSrc;
}

// ── Minimal HTML tokenizer (node side) ──────────────────────────────────────
export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttributes(rest) {
  const attrs = [];
  const RE_ATTR = /^\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/;
  while (rest.trim().length) {
    const a = rest.match(RE_ATTR);
    if (!a) { rest = rest.replace(/^\s*\S/, ""); continue; }
    attrs.push({ name: a[1].toLowerCase(), value: decodeEntities(a[2] ?? a[3] ?? a[4] ?? "") });
    rest = rest.slice(a[0].length);
  }
  return attrs;
}

// Every start tag in `html` (quote-aware, so a `>` inside a quoted value does not
// end the tag). Returns [{ tag, attrs: [{ name, value }] }].
export function startTags(html) {
  const out = [];
  const RE_TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = RE_TAG.exec(html))) {
    out.push({ tag: m[1].toLowerCase(), attrs: parseAttributes(m[2].replace(/\/\s*$/, "")) });
  }
  return out;
}

// <td …>inner</td> cells of a single rendered row, inner kept raw (not decoded).
export function rawCells(rowHtml) {
  return [...rowHtml.matchAll(/<td\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
}
