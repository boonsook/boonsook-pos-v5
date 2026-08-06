import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  getDocumentTemplate,
  isDocumentNoteVisible,
  renderDocumentTemplateHeader,
  renderDocumentTemplateNote,
  renderDocumentTemplateFooter,
} from "../modules/doc-utils.js";

const quotations = readFileSync(path.resolve("modules/quotations.js"), "utf8");
const deliveryInvoices = readFileSync(path.resolve("modules/delivery_invoices.js"), "utf8");
const receipts = readFileSync(path.resolve("modules/receipts.js"), "utf8");
const settingsPages = readFileSync(path.resolve("modules/settings/pages.js"), "utf8");

test("document template helpers trim and render saved storeInfo fields", () => {
  const storeInfo = {
    docHeader: "  Header line\nSecond line  ",
    docNote: "Global note",
    docFooter: "Footer <script>",
  };

  assert.deepEqual(getDocumentTemplate(storeInfo), {
    header: "Header line\nSecond line",
    note: "Global note",
    footer: "Footer <script>",
  });

  assert.match(renderDocumentTemplateHeader(storeInfo), /Header line<br>Second line/);
  assert.match(
    renderDocumentTemplateNote(storeInfo, { accent: "qt", documentNote: "Doc note" }),
    /Doc note<br>Global note/
  );
  assert.match(renderDocumentTemplateFooter(storeInfo), /Footer &lt;script&gt;/);
});

test("document template settings persist the same storeInfo keys used by document previews", () => {
  for (const key of [
    "docHeader",
    "docFooter",
    "docNote",
    "docShowNoteQuotation",
    "docShowNoteDelivery",
    "docShowNoteReceipt",
  ]) {
    assert.ok(settingsPages.includes(key), `settings page must persist ${key}`);
  }
});

test("document note visibility defaults on and can be disabled per document type", () => {
  assert.equal(isDocumentNoteVisible({}, "quotation"), true);
  assert.equal(isDocumentNoteVisible({}, "delivery"), true);
  assert.equal(isDocumentNoteVisible({}, "receipt"), true);

  const storeInfo = {
    docNote: "Global note",
    docShowNoteQuotation: false,
    docShowNoteDelivery: true,
    docShowNoteReceipt: false,
  };
  assert.equal(renderDocumentTemplateNote(storeInfo, {
    documentType: "quotation",
    documentNote: "Quotation note",
  }), "");
  assert.match(renderDocumentTemplateNote(storeInfo, {
    documentType: "delivery",
    documentNote: "Delivery note",
  }), /Delivery note<br>Global note/);
  assert.equal(renderDocumentTemplateNote(storeInfo, {
    documentType: "receipt",
    documentNote: "Receipt note",
  }), "");
});

test("quotation, delivery invoice, and receipt previews render document template parts", () => {
  for (const [name, src, documentType] of [
    ["quotations", quotations, "quotation"],
    ["delivery_invoices", deliveryInvoices, "delivery"],
    ["receipts", receipts, "receipt"],
  ]) {
    assert.match(src, /from\s+["']\.\/doc-utils\.js["']/, `${name} must import shared doc template helpers`);
    assert.ok(src.includes("renderDocumentTemplateHeader(si)"), `${name} must render the configured document header`);
    assert.ok(src.includes("renderDocumentTemplateNote(si"), `${name} must render the configured document note`);
    assert.ok(src.includes(`documentType: "${documentType}"`), `${name} must use its own note visibility setting`);
    assert.ok(src.includes("renderDocumentTemplateFooter(si)"), `${name} must render the configured document footer`);
  }
});

test("delivery invoice keeps its default payment note while allowing the global template note", () => {
  assert.ok(
    deliveryInvoices.includes('fallbackNote: "วิธีการชำระเงิน-ชำระเงินสด/เช็คเงินสด โอนผ่านธนาคาร"'),
    "delivery invoice must keep the existing payment-note fallback"
  );
  assert.equal(
    renderDocumentTemplateNote(
      { docShowNoteDelivery: false },
      { documentType: "delivery", fallbackNote: "Default payment note" }
    ),
    "",
    "turning off delivery notes must hide the whole note section, including its fallback"
  );
});
