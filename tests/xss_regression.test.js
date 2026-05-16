// Phase 89.30 — XSS regression tests (H1+H2+H3+S6+S7 hardening batch)
// Run: npm test
//
// What this covers:
//   - escHtml (canonical, from utils.js) — drops every char that could escape
//     out of HTML text content or a "..."-quoted attribute value.
//   - CSS url() strip pattern used in modules/customer_dashboard.js (H2):
//     image_url from DB has `'` `)` `\` removed before being interpolated
//     into `style="background: url('${imgUrl}')"`. The strip + escHtml
//     combo prevents both CSS rule injection and HTML attribute breakout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { escHtml } from "../modules/utils.js";

// ───────────────────────────────────────────────
// escHtml: canonical 5-char escape (& < > " ')
// ───────────────────────────────────────────────

test("escHtml: null/undefined → empty string (null-safe)", () => {
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
});

test("escHtml: payload <img onerror=alert(1)> — < > escaped, browser sees text not tag", () => {
  const payload = `<img src=x onerror="alert(1)">`;
  const out = escHtml(payload);
  // The < > are gone — browser cannot start an element. The `onerror=` text
  // may still appear as inert text content but never as an attribute.
  assert.ok(!out.includes("<img"), "raw <img must not survive");
  assert.ok(!out.includes("<"),    "no unescaped < anywhere");
  assert.ok(!out.includes(">"),    "no unescaped > anywhere");
  assert.ok(out.includes("&lt;"),  "< must become &lt;");
  assert.ok(out.includes("&gt;"),  "> must become &gt;");
});

test("escHtml: attribute-breakout payload — both \" and ' escaped", () => {
  // Single + double quote breakout
  const payload = `" onmouseover="alert(1)" '`;
  const out = escHtml(payload);
  assert.ok(!out.includes('"'),  "raw double-quote must not survive");
  assert.ok(!out.includes("'"),  "raw single-quote must not survive (canonical 5-char)");
  assert.ok(out.includes("&quot;"));
  assert.ok(out.includes("&#039;"));
});

test("escHtml: ampersand escaped first (prevents &-double-encoding bypass)", () => {
  // If & was escaped LAST, `&amp;lt;` would turn into `&lt;` then `&amp;lt;` —
  // but if & is escaped FIRST then `&lt;` payload stays literal as `&amp;lt;`.
  assert.equal(escHtml("&lt;"), "&amp;lt;");
});

// ───────────────────────────────────────────────
// H2: CSS url() strip pattern
// ───────────────────────────────────────────────

// Mirrors the inline expression in modules/customer_dashboard.js:
//   const imgUrl = String(p.image_url || p.img || "").replace(/['\)\\]/g, '');
function stripForCssUrl(s) {
  return String(s || "").replace(/['\)\\]/g, "");
}

test("stripForCssUrl: removes ' ) \\ which could break out of url('...')", () => {
  // Attacker stored: https://x.com/a.png'); background:url(javascript:alert(1));//
  // Strip drops every ' and ) and \  →  browser sees inert URL-ish text, never
  // a closed url() rule that could inject a second CSS declaration.
  const out = stripForCssUrl(`https://x.com/a.png'); background:url(javascript:alert(1));//`);
  assert.ok(!out.includes("'"), "no single-quote — can't close url('...')");
  assert.ok(!out.includes(")"), "no close-paren — can't close url()");
  assert.ok(!out.includes("\\"), "no backslash — can't CSS-escape past the strip");
  // Sanity — what survives is the path + escaped fragments concatenated,
  // proving the attacker payload is structurally broken.
  assert.equal(out, "https://x.com/a.png; background:url(javascript:alert(1;//");
});

test("stripForCssUrl + escHtml: full pipeline for url('${imgUrl}') context", () => {
  // Attacker stores: ' ); }body{background:red
  // Goal: payload renders as inert text, never as CSS or HTML.
  const dbValue = `'); }body{background:red`;
  const safeImg = stripForCssUrl(dbValue);
  const rendered = escHtml(safeImg);
  // After strip: `; }body{background:red`
  // After escHtml: same (no special HTML chars left)
  assert.ok(!rendered.includes("'"),      "no single-quote — can't break out of url('...')");
  assert.ok(!rendered.includes(")"),      "no close-paren — can't terminate url()");
  assert.ok(!rendered.includes("\\"),     "no backslash — can't CSS-escape");
});

test("stripForCssUrl: preserves normal http(s) URLs intact", () => {
  const ok = "https://cdn.example.com/path/to/image.jpg?v=42&size=large";
  assert.equal(stripForCssUrl(ok), ok);
});
