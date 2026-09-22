// Phase 625 — shared fixture for the document attribute-XSS regression
// (used by tests/phase625_document_attribute_xss.test.js — node unit — and
//  tests/e2e/phase625_document_attribute_xss.spec.js — real Chromium parser).
//
// Bug class: modules/quotations.js, modules/delivery_invoices.js and
// modules/receipts.js each carried a local `escHtml()` built as
// `div.textContent = s; return div.innerHTML`. A browser serialises text nodes
// escaping only & < > (and nbsp) — never `"` or `'`. Those modules then wrote
// the result into quoted attributes such as `value="${escHtml(item.item_name)}"`,
// so a stored value containing `"` closed the attribute early and the rest of the
// payload became new attributes (autofocus + onfocus=… → script execution).
//
// Fix: the modules import the canonical `escHtml` from modules/utils.js
// (escapes & < > " ') and the local helper is deleted. This file resolves, from
// the module SOURCE, which helper each module actually binds — so a mutation
// that restores the local helper, drops the shared import, or leaves both is
// caught by behaviour, not by grepping for an import line.
//
// No globals are used here on purpose: this file sits outside the eslint
// test/e2e blocks and is linted with the bare recommended rule set.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Attack fixtures ─────────────────────────────────────────────────────────
// Minimum fixture from the Phase 625 brief. When the closing `"` is not
// escaped, the HTML parser yields:  value="" autofocus onfocus="window.__phase625Pwned=1"
export const PAYLOAD_DQ = '" autofocus onfocus="window.__phase625Pwned=1';
// Same attack through a single-quoted attribute value.
export const PAYLOAD_SQ = "' autofocus onfocus='window.__phase625Pwned=1";
// Element injection (text context and attribute context alike).
export const PAYLOAD_IMG = '<img src=x onerror="window.__phase625Pwned=1">';
// All five characters the canonical helper must encode, in one string.
export const PAYLOAD_ALL5 = "&<>\"'";
export const PAYLOAD_ALL5_ESCAPED = "&amp;&lt;&gt;&quot;&#039;";
// Ordinary Thai text must pass through untouched.
export const PAYLOAD_THAI = "บริษัท บุญสุข อิเล็กทรอนิกส์ จำกัด (สำนักงานใหญ่)";

export const ATTACK_PAYLOADS = [
  { name: "double-quote breakout", payload: PAYLOAD_DQ },
  { name: "single-quote breakout", payload: PAYLOAD_SQ },
  { name: "img onerror injection", payload: PAYLOAD_IMG },
];

// ── Modules under test + one representative quoted attribute each ──────────
// `anchor` must match exactly one `<input … />` tag on a single source line.
export const MODULES = [
  {
    file: "modules/quotations.js",
    attrs: [
      { label: "quotation line item name (qt-li-name)", anchor: /<input class="qt-li-name"[^\n]*?\/>/ },
      { label: "quotation customer search (qt_customerSearch)", anchor: /<input id="qt_customerSearch"[^\n]*?\/>/ },
    ],
  },
  {
    file: "modules/delivery_invoices.js",
    attrs: [
      { label: "delivery invoice edit customer name (diEdName)", anchor: /<input id="diEdName"[^\n]*?\/>/ },
    ],
  },
  {
    file: "modules/receipts.js",
    attrs: [
      { label: "receipt edit customer name (rcEdName)", anchor: /<input id="rcEdName"[^\n]*?\/>/ },
      { label: "receipt multi-payment ref (rc-mp-ref)", anchor: /<input class="rc-mp-ref"[^\n]*?\/>/ },
    ],
  },
  {
    // Rev2 (owner addendum): AutoKey OCR result (Gemini via /api/parse-receipt) is
    // untrusted input rendered straight into value="…" by _showParsedResult().
    file: "modules/expenses.js",
    attrs: [
      { label: "expense OCR vendor (akEdVendor)", anchor: /<input id="akEdVendor"[^\n]*?\/>/ },
      { label: "expense OCR document no (akEdDocNo)", anchor: /<input id="akEdDocNo"[^\n]*?\/>/ },
    ],
  },
];

export function readModuleSource(file) {
  return readFileSync(path.join(ROOT, file), "utf8");
}

// ── Which escHtml does the module bind? ─────────────────────────────────────
// Returns { kind: "shared" | "local" | "none" | "ambiguous", importLine, localSource }.
//   shared    – `import { …, escHtml, … } from "./utils.js"` and no local declaration
//   local     – a local `function escHtml(` / `const|let|var escHtml` and no import
//   ambiguous – both (which is also a SyntaxError in a real module graph)
//   none      – neither (every escHtml(...) call would throw ReferenceError)
const RE_UTILS_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*["']\.\/utils\.js["'];?/gm;
// Body is either a one-liner `{ … }` closed on the same line (expenses.js shape)
// or a multi-line block closed by a `}` at the start of a later line.
const RE_LOCAL_FN = /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+escHtml\s*\([^)]*\)\s*\{(?:[^\n]*\}[ \t]*$|[\s\S]*?\n\})/m;
const RE_LOCAL_VAR = /^[ \t]*(?:export\s+)?(?:const|let|var)\s+escHtml\b/m;

export function resolveEscHtmlBinding(src) {
  let importLine = null;
  let importCount = 0;
  for (const m of src.matchAll(RE_UTILS_IMPORT)) {
    importCount++;
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop());
    if (names.includes("escHtml")) importLine = m[0];
  }
  const fn = src.match(RE_LOCAL_FN);
  const v = src.match(RE_LOCAL_VAR);
  const localSource = fn ? fn[0] : null;
  const hasLocal = !!(fn || v);
  let kind = "none";
  if (importLine && !hasLocal) kind = "shared";
  else if (!importLine && hasLocal) kind = "local";
  else if (importLine && hasLocal) kind = "ambiguous";
  return { kind, importLine, importCount, localSource, hasLocalVar: !!v };
}

// ── Representative attribute snippet → rendered HTML ────────────────────────
export function extractAttrSnippet(src, anchor) {
  const all = src.match(new RegExp(anchor.source, "g")) || [];
  if (all.length !== 1) {
    throw new Error(`anchor ${anchor} must match exactly one tag, matched ${all.length}`);
  }
  return all[0];
}

// Substitute the template placeholders the way the module would at runtime:
// every `${escHtml(<expr>)}` becomes esc(payload); any other `${…}` (e.g. the
// numeric data-idx) becomes "0". Only the helper under test touches the payload.
export function renderAttrSnippet(snippet, esc, payload) {
  const escCalls = (snippet.match(/\$\{escHtml\([^{}]*\)\}/g) || []).length;
  if (escCalls < 1) throw new Error("snippet has no ${escHtml(...)} interpolation — fixture is hollow");
  return snippet
    .replace(/\$\{escHtml\([^{}]*\)\}/g, () => esc(payload))
    .replace(/\$\{[^{}]*\}/g, "0");
}

// ── Minimal HTML start-tag attribute tokenizer (node side) ──────────────────
// Follows the WHATWG start-tag rules closely enough for `<input …>` tags:
//   name="v" | name='v' | name=v | name   — attribute names are ASCII-lowercased.
// Returns an ordered array of { name, value } (value decoded for the 5 entities).
export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseStartTagAttributes(tagHtml) {
  const m = tagHtml.match(/^<([a-zA-Z][^\s/>]*)([\s\S]*?)\/?>$/);
  if (!m) throw new Error("not a single start tag: " + tagHtml.slice(0, 80));
  let rest = m[2];
  const attrs = [];
  const RE_ATTR = /^\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/;
  while (rest.trim().length) {
    const a = rest.match(RE_ATTR);
    if (!a) {
      // stray `/` or unparsable junk — skip one char like the parser does
      rest = rest.replace(/^\s*\S/, "");
      continue;
    }
    const name = a[1].toLowerCase();
    const raw = a[2] ?? a[3] ?? a[4] ?? "";
    attrs.push({ name, value: decodeEntities(raw) });
    rest = rest.slice(a[0].length);
  }
  return attrs;
}

// The unsafe baseline helper, reproduced for node via a document shim whose
// innerHTML serialiser escapes exactly what browsers escape in text nodes.
// Used ONLY as a positive control (prove the harness detects the breakout).
export function baselineTextContentEscHtml(str) {
  const text = str || "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
