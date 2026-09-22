// Phase 625 — document attribute XSS, parsed by a real browser (Chromium).
//
// Why e2e as well as the node unit: the unit test tokenises the start tag with
// its own parser. This spec hands the SAME rendered snippet to Chromium's HTML
// parser and then focuses the element, so a breakout is observed the way an
// attacker would use it — `autofocus`/`onfocus` attributes materialise and the
// inline handler sets window.__phase625Pwned.
//
// The helper under test is whichever escHtml the module source actually binds
// (shared import from modules/utils.js, or a local declaration executed as a
// real ES module via a blob: URL). Mutations that restore the local helper,
// drop the shared import, or strip `"` from the shared escape map all turn RED.

import { test, expect } from "@playwright/test";
import {
  MODULES, ATTACK_PAYLOADS, PAYLOAD_DQ, PAYLOAD_THAI,
  readModuleSource, resolveEscHtmlBinding, extractAttrSnippet,
} from "../phase625_document_attribute_xss.shared.js";

const FIXTURE_URL = "/__phase625__/fixture.html";
// Served via page.route — no CSP header, so an injected inline handler WOULD run.
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Phase 625 fixture</title></head><body><div id="host"></div></body></html>';

// The unsafe baseline helper, byte-for-byte the shape the three modules carried
// before Phase 625. Positive control only.
const UNSAFE_HELPER_MODULE = 'export function escHtml(str) { const div = document.createElement("div"); div.textContent = str || ""; return div.innerHTML; }';

function helperModuleSource(binding, file) {
  if (binding.kind === "shared") return 'export { escHtml } from "__UTILS__";';
  if (binding.kind === "local") return `${binding.localSource}\nexport { escHtml };`;
  throw new Error(`${file}: escHtml binding is "${binding.kind}" — nothing safe to render with`);
}

async function openFixture(page) {
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.goto(FIXTURE_URL);
}

// Render `snippet` in the page using the helper exported by `moduleSrc`, then
// probe the resulting DOM. Placeholder substitution mirrors
// renderAttrSnippet() in the shared fixture (must stay identical).
async function renderInBrowser(page, { moduleSrc, snippet, payload }) {
  return page.evaluate(async ({ moduleSrc, snippet, payload }) => {
    const src = moduleSrc.replace("__UTILS__", new URL("/modules/utils.js", location.origin).href);
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const mod = await import(url);
    if (typeof mod.escHtml !== "function") throw new Error("helper module did not export escHtml");
    delete window.__phase625Pwned;
    const rendered = snippet
      .replace(/\$\{escHtml\([^{}]*\)\}/g, () => mod.escHtml(payload))
      .replace(/\$\{[^{}]*\}/g, "0");
    const host = document.getElementById("host");
    host.innerHTML = rendered;
    const el = host.firstElementChild;
    if (el && typeof el.focus === "function") el.focus();
    await new Promise((r) => setTimeout(r, 50));
    return {
      rendered,
      childCount: host.childElementCount,
      tag: el ? el.tagName : null,
      attrNames: el ? Array.from(el.attributes).map((a) => a.name) : [],
      hasAutofocus: !!(el && el.hasAttribute("autofocus")),
      hasOnfocus: !!(el && el.hasAttribute("onfocus")),
      hasOnerror: !!(el && el.hasAttribute("onerror")),
      value: el ? el.value : null,
      pwned: window.__phase625Pwned,
      hasImg: !!host.querySelector("img"),
    };
  }, { moduleSrc, snippet, payload });
}

for (const mod of MODULES) {
  test.describe(`Phase 625 · ${mod.file}`, () => {
    const src = readModuleSource(mod.file);
    const binding = resolveEscHtmlBinding(src);

    test("binds escHtml from the shared ./utils.js helper (no local copy)", () => {
      expect(binding.kind, `binding kind is "${binding.kind}"`).toBe("shared");
    });

    for (const attr of mod.attrs) {
      const snippet = extractAttrSnippet(src, attr.anchor);

      for (const { name, payload } of ATTACK_PAYLOADS) {
        test(`${attr.label} · ${name}: browser sees one intact element, no injected attributes, no script`, async ({ page }) => {
          await openFixture(page);
          const moduleSrc = helperModuleSource(binding, mod.file);
          const r = await renderInBrowser(page, { moduleSrc, snippet, payload });
          expect(r.childCount, `rendered: ${r.rendered}`).toBe(1);
          expect(r.tag).toBe("INPUT");
          expect(r.hasAutofocus, `autofocus injected — rendered: ${r.rendered}`).toBe(false);
          expect(r.hasOnfocus, `onfocus injected — rendered: ${r.rendered}`).toBe(false);
          expect(r.hasOnerror, `onerror injected — rendered: ${r.rendered}`).toBe(false);
          expect(r.attrNames.filter((n) => n.startsWith("on"))).toEqual([]);
          expect(r.hasImg).toBe(false);
          expect(r.pwned, "window.__phase625Pwned must stay unset").toBeUndefined();
          expect(r.value, "input value must round-trip the payload verbatim").toBe(payload);
        });
      }

      test(`${attr.label}: Thai text and null render as plain values`, async ({ page }) => {
        await openFixture(page);
        const moduleSrc = helperModuleSource(binding, mod.file);
        const thai = await renderInBrowser(page, { moduleSrc, snippet, payload: PAYLOAD_THAI });
        expect(thai.childCount).toBe(1);
        expect(thai.value).toBe(PAYLOAD_THAI);
        const nul = await renderInBrowser(page, { moduleSrc, snippet, payload: null });
        expect(nul.childCount).toBe(1);
        expect(nul.value).toBe("");
      });
    }
  });
}

test.describe("Phase 625 · positive control", () => {
  test("the baseline textContent→innerHTML helper lets the fixture inject autofocus + onfocus and run script", async ({ page }) => {
    await openFixture(page);
    const src = readModuleSource(MODULES[0].file);
    const snippet = extractAttrSnippet(src, MODULES[0].attrs[0].anchor);
    const r = await renderInBrowser(page, { moduleSrc: UNSAFE_HELPER_MODULE, snippet, payload: PAYLOAD_DQ });
    expect(r.hasAutofocus, `control failed — browser did not see autofocus in: ${r.rendered}`).toBe(true);
    expect(r.hasOnfocus, `control failed — browser did not see onfocus in: ${r.rendered}`).toBe(true);
    expect(r.pwned, "control failed — inline handler did not run on focus").toBe(1);
    expect(r.value).not.toBe(PAYLOAD_DQ);
  });
});
