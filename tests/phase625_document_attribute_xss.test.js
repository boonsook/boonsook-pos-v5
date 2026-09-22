// Phase 625 — Stored/Attribute XSS regression for the document modules
// (quotations / delivery_invoices / receipts).
//
// Run: node --test tests/phase625_document_attribute_xss.test.js
//
// Teeth (not a grep-for-import test):
//   1. The canonical escHtml (modules/utils.js) neutralises every fixture and
//      encodes all of & < > " '.
//   2. Each module must bind escHtml from ./utils.js and carry NO local copy.
//   3. The helper each module ACTUALLY binds (resolved from source; a local
//      helper is executed through node:vm with a text-node serialiser shim) is
//      applied to the module's own `value="${escHtml(…)}"` snippet, and the
//      resulting start tag is tokenised: no autofocus / onfocus / onerror may
//      appear and the value attribute must decode to the original payload.
//   4. Positive control: the unsafe baseline helper run through the same
//      harness MUST produce the breakout — proves the tokenizer can see it.
//
// Baseline (build 623) → RED on #2 and #3 (autofocus + onfocus attributes appear).
// The real-browser counterpart is tests/e2e/phase625_document_attribute_xss.spec.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { escHtml as sharedEscHtml } from "../modules/utils.js";
import {
  MODULES, ATTACK_PAYLOADS,
  PAYLOAD_DQ, PAYLOAD_SQ, PAYLOAD_IMG, PAYLOAD_ALL5, PAYLOAD_ALL5_ESCAPED, PAYLOAD_THAI,
  readModuleSource, resolveEscHtmlBinding, extractAttrSnippet, renderAttrSnippet,
  parseStartTagAttributes, baselineTextContentEscHtml,
} from "./phase625_document_attribute_xss.shared.js";

const DANGEROUS_ATTRS = ["autofocus", "onfocus", "onerror", "onload", "onmouseover"];

// Materialise the helper a module binds. A local helper is executed for real
// (node:vm) against a document shim whose innerHTML getter serialises a text
// node exactly like browsers do (& < > only) — so the test measures the
// helper's behaviour, not a hand-written imitation of it.
function materializeHelper(binding, file) {
  if (binding.kind === "shared") return sharedEscHtml;
  if (binding.kind === "local") {
    const shimDocument = {
      createElement() {
        let text = "";
        return {
          set textContent(v) { text = v == null ? "" : String(v); },
          get textContent() { return text; },
          get innerHTML() {
            return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          },
        };
      },
    };
    return vm.runInNewContext(`${binding.localSource}\n;escHtml`, { document: shimDocument });
  }
  throw new Error(`${file}: escHtml binding is "${binding.kind}" — module cannot render safely`);
}

function assertTagIsIntact(tagHtml, payload, where) {
  const attrs = parseStartTagAttributes(tagHtml);
  const names = attrs.map((a) => a.name);
  for (const bad of DANGEROUS_ATTRS) {
    assert.ok(!names.includes(bad), `${where}: attribute "${bad}" was injected — rendered: ${tagHtml}`);
  }
  const values = attrs.filter((a) => a.name === "value");
  assert.equal(values.length, 1, `${where}: exactly one value attribute expected — rendered: ${tagHtml}`);
  assert.equal(values[0].value, payload, `${where}: value attribute must round-trip the payload verbatim`);
  assert.ok(!/<img/i.test(tagHtml), `${where}: raw <img must not survive — rendered: ${tagHtml}`);
  // The rendered string must still be a single start tag (no second `<` opened).
  assert.equal((tagHtml.match(/</g) || []).length, 1, `${where}: exactly one tag open expected`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Canonical helper behaviour
// ─────────────────────────────────────────────────────────────────────────────
test("shared escHtml: double-quote breakout payload — no raw \" survives", () => {
  const out = sharedEscHtml(PAYLOAD_DQ);
  assert.ok(!out.includes('"'), `raw " survived: ${out}`);
  assert.ok(out.includes("&quot;"));
  assert.equal(out, "&quot; autofocus onfocus=&quot;window.__phase625Pwned=1");
});

test("shared escHtml: single-quote breakout payload — no raw ' survives", () => {
  const out = sharedEscHtml(PAYLOAD_SQ);
  assert.ok(!out.includes("'"), `raw ' survived: ${out}`);
  assert.ok(out.includes("&#039;"));
});

test("shared escHtml: <img src=x onerror=…> — no raw < or > survives", () => {
  const out = sharedEscHtml(PAYLOAD_IMG);
  assert.ok(!out.includes("<") && !out.includes(">"), `raw angle bracket survived: ${out}`);
  assert.ok(out.startsWith("&lt;img"));
});

test("shared escHtml: all five of & < > \" ' are encoded (and & first)", () => {
  assert.equal(sharedEscHtml(PAYLOAD_ALL5), PAYLOAD_ALL5_ESCAPED);
  assert.equal(sharedEscHtml("&quot;"), "&amp;quot;", "& must be escaped before the others");
});

test("shared escHtml: ordinary Thai text passes through unchanged", () => {
  assert.equal(sharedEscHtml(PAYLOAD_THAI), PAYLOAD_THAI);
});

test("shared escHtml: null / undefined render as empty string (no crash, no 'null')", () => {
  assert.equal(sharedEscHtml(null), "");
  assert.equal(sharedEscHtml(undefined), "");
  assert.equal(sharedEscHtml(""), "");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Binding: each module imports the shared helper and has no local copy
// ─────────────────────────────────────────────────────────────────────────────
for (const mod of MODULES) {
  const src = readModuleSource(mod.file);
  const binding = resolveEscHtmlBinding(src);

  test(`${mod.file}: imports escHtml through its existing "./utils.js" import statement`, () => {
    assert.equal(binding.importCount, 1, "exactly one import from ./utils.js (reuse the existing statement)");
    assert.ok(binding.importLine, `no \`import { … escHtml … } from "./utils.js"\` found`);
  });

  test(`${mod.file}: has no local escHtml declaration`, () => {
    assert.equal(binding.localSource, null, `local function escHtml still present:\n${binding.localSource}`);
    assert.equal(binding.hasLocalVar, false, "local const/let/var escHtml still present");
    assert.equal((src.match(/^\s*function\s+escHtml\s*\(/gm) || []).length, 0);
  });

  test(`${mod.file}: escHtml binding resolves to the shared helper`, () => {
    assert.equal(binding.kind, "shared", `binding kind = ${binding.kind}`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Behaviour of the helper the module actually binds, on its own snippet
  // ───────────────────────────────────────────────────────────────────────────
  for (const attr of mod.attrs) {
    const snippet = extractAttrSnippet(src, attr.anchor);

    for (const { name, payload } of ATTACK_PAYLOADS) {
      test(`${mod.file} · ${attr.label} · ${name}: attribute cannot be broken out of`, () => {
        const esc = materializeHelper(binding, mod.file);
        const rendered = renderAttrSnippet(snippet, esc, payload);
        assertTagIsIntact(rendered, payload, `${mod.file} ${attr.label}`);
      });
    }

    test(`${mod.file} · ${attr.label}: Thai text and null render normally`, () => {
      const esc = materializeHelper(binding, mod.file);
      const thai = parseStartTagAttributes(renderAttrSnippet(snippet, esc, PAYLOAD_THAI));
      assert.equal(thai.find((a) => a.name === "value")?.value, PAYLOAD_THAI);
      const nul = parseStartTagAttributes(renderAttrSnippet(snippet, esc, null));
      assert.equal(nul.find((a) => a.name === "value")?.value, "");
      const und = parseStartTagAttributes(renderAttrSnippet(snippet, esc, undefined));
      assert.equal(und.find((a) => a.name === "value")?.value, "");
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Positive control — the harness must SEE the breakout with the unsafe helper
// ─────────────────────────────────────────────────────────────────────────────
test("positive control: baseline textContent→innerHTML helper lets the fixture inject autofocus + onfocus", () => {
  const src = readModuleSource(MODULES[0].file);
  const snippet = extractAttrSnippet(src, MODULES[0].attrs[0].anchor);
  const rendered = renderAttrSnippet(snippet, baselineTextContentEscHtml, PAYLOAD_DQ);
  const names = parseStartTagAttributes(rendered).map((a) => a.name);
  assert.ok(names.includes("autofocus"), `control failed — tokenizer did not see autofocus in: ${rendered}`);
  assert.ok(names.includes("onfocus"), `control failed — tokenizer did not see onfocus in: ${rendered}`);
  assert.throws(() => assertTagIsIntact(rendered, PAYLOAD_DQ, "control"), /autofocus/);
});

test("positive control: a helper that forgets \" (escapes only & < > ') is rejected", () => {
  const noDq = (s) => String(s ?? "").replace(/[&<>']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;" }[c]));
  const src = readModuleSource(MODULES[2].file);
  const snippet = extractAttrSnippet(src, MODULES[2].attrs[0].anchor);
  assert.throws(() => assertTagIsIntact(renderAttrSnippet(snippet, noDq, PAYLOAD_DQ), PAYLOAD_DQ, "control"), /autofocus/);
});
