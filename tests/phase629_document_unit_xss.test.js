// Phase 629 — stored XSS through the line-item `unit` field in document rows
// (quotation form + quotation / delivery invoice / receipt previews).
//
// Run: node --test tests/phase629_document_unit_xss.test.js
//
// Teeth: the REAL row callback of each site (the function passed to
// `_lineItems.map(` inside its render function) is executed in node:vm with the
// module's own num() and the canonical escHtml from modules/utils.js, with the
// payload stored in `unit`. The rendered row is tokenised: no injected tag, no
// autofocus / on* attribute, and the unit must round-trip as text / as the input
// value. Positive controls render the same callback with the pre-629 unescaped
// unit expression and MUST be caught by the same assertions.
// The real-browser counterpart is tests/e2e/phase629_document_unit_xss.spec.js.
//
// Evidence classes: [behavioral] executes module code · [structural] reads source.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { escHtml as sharedEscHtml } from "../modules/utils.js";
import { resolveEscHtmlBinding } from "./phase625_document_attribute_xss.shared.js";
import {
  SITES, ATTACK_PAYLOADS, PAYLOAD_DQ, PAYLOAD_IMG, PAYLOAD_ALL5, PAYLOAD_ALL5_ESCAPED, PAYLOAD_THAI,
  UNIT_FALLBACK, fixtureItem, readModuleSource, extractRowCallback, extractNumHelper,
  unsafeUnitVariant, startTags, rawCells, decodeEntities,
} from "./phase629_document_unit_xss.shared.js";

const ALLOWED_TAGS = { attribute: ["tr", "td", "input", "button"], text: ["tr", "td"] };
const UNIT_CELL = 2; // preview rows: รายละเอียด · จำนวน · หน่วย · ราคาต่อหน่วย · ยอดรวม

function rowRenderer(src, callbackSrc) {
  return vm.runInNewContext(`${extractNumHelper(src)}\n;(${callbackSrc})`, { escHtml: sharedEscHtml });
}

function renderRow(src, callbackSrc, unit) {
  return rowRenderer(src, callbackSrc)(fixtureItem(unit), 0);
}

function unitInput(rowHtml) {
  const inputs = startTags(rowHtml).filter((t) => t.tag === "input"
    && t.attrs.some((a) => a.name === "class" && a.value === "qt-li-unit"));
  assert.equal(inputs.length, 1, `exactly one unit input expected — rendered: ${rowHtml}`);
  return inputs[0];
}

// Throws AssertionError when the row lets `payload` escape its slot.
function assertRowSafe(site, rowHtml, payload) {
  const tags = startTags(rowHtml);
  for (const t of tags) {
    assert.ok(ALLOWED_TAGS[site.context].includes(t.tag), `${site.id}: injected <${t.tag}> — rendered: ${rowHtml}`);
    for (const a of t.attrs) {
      assert.ok(a.name !== "autofocus" && !a.name.startsWith("on"),
        `${site.id}: injected attribute "${a.name}" on <${t.tag}> — rendered: ${rowHtml}`);
    }
  }
  if (site.context === "attribute") {
    const input = unitInput(rowHtml);
    const values = input.attrs.filter((a) => a.name === "value");
    assert.equal(values.length, 1, `${site.id}: exactly one value attribute on the unit input`);
    assert.equal(values[0].value, payload, `${site.id}: unit input value must round-trip the payload`);
    assert.equal(tags.filter((t) => t.tag === "input").length, 5, `${site.id}: row must keep its 5 inputs`);
  } else {
    const cells = rawCells(rowHtml);
    assert.equal(cells.length, site.cells, `${site.id}: row must keep ${site.cells} cells — rendered: ${rowHtml}`);
    assert.ok(!/[<>"']/.test(cells[UNIT_CELL]), `${site.id}: unit cell carries raw markup characters: ${cells[UNIT_CELL]}`);
    assert.equal(decodeEntities(cells[UNIT_CELL]), payload, `${site.id}: unit cell text must round-trip the payload`);
  }
}

for (const site of SITES) {
  const src = readModuleSource(site.file);
  const callbackSrc = extractRowCallback(src, site);

  test(`${site.id} [structural]: ${site.file} binds the shared escHtml from ./utils.js`, () => {
    assert.equal(resolveEscHtmlBinding(src).kind, "shared");
  });

  test(`${site.id} [structural]: the row callback has exactly one unit sink and it goes through escHtml`, () => {
    const refs = (callbackSrc.match(/\bitem\.unit\b/g) || []).length; // \b keeps item.unit_price out
    assert.equal(refs, 1, `item.unit referenced ${refs} times`);
    assert.ok(callbackSrc.includes(`escHtml(item.unit||'${UNIT_FALLBACK}')`),
      `unit is not wrapped by escHtml(item.unit||'${UNIT_FALLBACK}'):\n${callbackSrc}`);
  });

  for (const { name, payload } of ATTACK_PAYLOADS) {
    test(`${site.id} [behavioral] · ${name}: stored unit renders as data, not markup`, () => {
      assertRowSafe(site, renderRow(src, callbackSrc, payload), payload);
    });
  }

  test(`${site.id} [behavioral]: all five of & < > " ' are encoded in the unit slot`, () => {
    const row = renderRow(src, callbackSrc, PAYLOAD_ALL5);
    assertRowSafe(site, row, PAYLOAD_ALL5);
    if (site.context === "text") assert.equal(rawCells(row)[UNIT_CELL], PAYLOAD_ALL5_ESCAPED);
    else assert.ok(row.includes(`value="${PAYLOAD_ALL5_ESCAPED}"`), `raw row: ${row}`);
  });

  test(`${site.id} [behavioral]: Thai unit renders verbatim; empty unit keeps the "${UNIT_FALLBACK}" fallback`, () => {
    for (const [unit, expected] of [[PAYLOAD_THAI, PAYLOAD_THAI], ["ชิ้น", "ชิ้น"], [null, UNIT_FALLBACK], [undefined, UNIT_FALLBACK], ["", UNIT_FALLBACK]]) {
      const row = renderRow(src, callbackSrc, unit);
      assertRowSafe(site, row, expected);
    }
  });

  test(`${site.id} [behavioral]: for plain units the row is byte-identical to the pre-629 output`, () => {
    const before = unsafeUnitVariant(callbackSrc);
    for (const unit of [PAYLOAD_THAI, "ชิ้น", "เครื่อง", null, ""]) {
      assert.equal(renderRow(src, callbackSrc, unit), renderRow(src, before, unit), `unit=${JSON.stringify(unit)}`);
    }
  });

  // attribute context: `"` closes value= and autofocus/onfocus become attributes;
  // text context: <img onerror> becomes an element. Either way → "injected …".
  test(`${site.id} positive control: the pre-629 unescaped unit is caught by the same assertions`, () => {
    const before = unsafeUnitVariant(callbackSrc);
    const payload = site.context === "attribute" ? PAYLOAD_DQ : PAYLOAD_IMG;
    assert.throws(() => assertRowSafe(site, renderRow(src, before, payload), payload),
      (err) => err.code === "ERR_ASSERTION" && /injected (<img>|attribute "autofocus")/.test(err.message));
  });
}

test("inventory: exactly one quotation form row and three preview rows are covered", () => {
  assert.deepEqual(SITES.map((s) => s.id), ["QT-FORM", "QT-PREVIEW", "DI-PREVIEW", "RC-PREVIEW"]);
  for (const file of ["modules/quotations.js", "modules/delivery_invoices.js", "modules/receipts.js"]) {
    const src = readModuleSource(file);
    const sinks = src.split("\n").filter((l) => /item\.unit\b/.test(l) && /(<td|value=)/.test(l));
    const expected = SITES.filter((s) => s.file === file).length;
    assert.equal(sinks.length, expected, `${file}: HTML sinks of item.unit = ${sinks.length}, expected ${expected}`);
  }
});
