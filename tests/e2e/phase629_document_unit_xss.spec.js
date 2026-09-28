// Phase 629 — stored XSS through the line-item `unit` field, parsed by a real
// browser (Chromium).
//
// Why e2e as well as the node unit: the unit test tokenises rows with its own
// parser. Here the REAL row callback of each site (extracted from the module
// source) runs inside Chromium as an ES module that imports the served
// /modules/utils.js escHtml, its output is parsed into a <tbody> by the browser,
// every input/button is focused and pending image loads are given time to fail —
// so an injected onfocus / onerror would actually run and set
// window.__phase629Pwned. The fixture page is served via page.route with no CSP
// header on purpose: a successful injection WOULD execute.

import { test, expect } from "@playwright/test";
import {
  SITES, ATTACK_PAYLOADS, PAYLOAD_DQ, PAYLOAD_IMG, PAYLOAD_THAI, UNIT_FALLBACK,
  fixtureItem, readModuleSource, extractRowCallback, extractNumHelper, unsafeUnitVariant,
} from "../phase629_document_unit_xss.shared.js";

const FIXTURE_URL = "/__phase629__/fixture.html";
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Phase 629 fixture</title></head>'
  + '<body><table><tbody id="host"></tbody></table></body></html>';
const ALLOWED_TAGS = { attribute: ["tr", "td", "input", "button"], text: ["tr", "td"] };

async function openFixture(page) {
  await page.route(`**${FIXTURE_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  await page.goto(FIXTURE_URL);
}

async function renderInBrowser(page, { numSrc, callbackSrc, item }) {
  return page.evaluate(async ({ numSrc, callbackSrc, item }) => {
    const utilsUrl = new URL("/modules/utils.js", location.origin).href;
    const src = `import { escHtml } from ${JSON.stringify(utilsUrl)};\n${numSrc}\nexport default (${callbackSrc});`;
    const mod = await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    delete window.__phase629Pwned;
    const host = document.getElementById("host");
    const rowHtml = mod.default(item, 0);
    host.innerHTML = rowHtml;
    for (const el of host.querySelectorAll("input, button")) el.focus();
    await new Promise((r) => setTimeout(r, 300)); // let <img src=x> fail → onerror
    const all = Array.from(host.querySelectorAll("*"));
    return {
      rowHtml,
      rows: host.rows.length,
      cells: host.rows[0] ? host.rows[0].cells.length : 0,
      tags: [...new Set(all.map((e) => e.tagName.toLowerCase()))],
      riskyAttrs: all.flatMap((e) => Array.from(e.attributes).map((a) => a.name)
        .filter((n) => n === "autofocus" || n.startsWith("on"))),
      unitText: host.rows[0] && host.rows[0].cells[2] ? host.rows[0].cells[2].textContent : null,
      unitValue: host.querySelector("input.qt-li-unit") ? host.querySelector("input.qt-li-unit").value : null,
      pwned: window.__phase629Pwned,
    };
  }, { numSrc, callbackSrc, item });
}

function expectSafe(site, r, expectedUnit) {
  expect(r.rows, `rendered: ${r.rowHtml}`).toBe(1);
  expect(r.cells, `rendered: ${r.rowHtml}`).toBe(site.cells);
  expect(r.tags.filter((t) => !ALLOWED_TAGS[site.context].includes(t)), `rendered: ${r.rowHtml}`).toEqual([]);
  expect(r.riskyAttrs, `rendered: ${r.rowHtml}`).toEqual([]);
  expect(r.pwned, "window.__phase629Pwned must stay unset").toBeUndefined();
  if (site.context === "attribute") expect(r.unitValue, "unit input value must round-trip").toBe(expectedUnit);
  else expect(r.unitText, "unit cell text must round-trip").toBe(expectedUnit);
}

for (const site of SITES) {
  test.describe(`Phase 629 · ${site.id} (${site.file})`, () => {
    const src = readModuleSource(site.file);
    const numSrc = extractNumHelper(src);
    const callbackSrc = extractRowCallback(src, site);

    for (const { name, payload } of ATTACK_PAYLOADS) {
      test(`${name}: browser renders the stored unit as data — no element, no handler, no script`, async ({ page }) => {
        await openFixture(page);
        const r = await renderInBrowser(page, { numSrc, callbackSrc, item: fixtureItem(payload) });
        expectSafe(site, r, payload);
      });
    }

    test(`Thai unit renders verbatim and an empty unit keeps "${UNIT_FALLBACK}"`, async ({ page }) => {
      await openFixture(page);
      expectSafe(site, await renderInBrowser(page, { numSrc, callbackSrc, item: fixtureItem(PAYLOAD_THAI) }), PAYLOAD_THAI);
      expectSafe(site, await renderInBrowser(page, { numSrc, callbackSrc, item: fixtureItem(null) }), UNIT_FALLBACK);
      expectSafe(site, await renderInBrowser(page, { numSrc, callbackSrc, item: fixtureItem("") }), UNIT_FALLBACK);
    });

    test("positive control: the pre-629 unescaped unit executes the payload in this fixture", async ({ page }) => {
      await openFixture(page);
      const payload = site.context === "attribute" ? PAYLOAD_DQ : PAYLOAD_IMG;
      const r = await renderInBrowser(page, { numSrc, callbackSrc: unsafeUnitVariant(callbackSrc), item: fixtureItem(payload) });
      expect(r.pwned, `control failed — payload did not run. rendered: ${r.rowHtml}`).toBe(1);
      expect(r.riskyAttrs.length, "control must show an injected handler attribute").toBeGreaterThan(0);
    });
  });
}
