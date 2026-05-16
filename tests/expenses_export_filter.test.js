// Phase 89.35 — Regression test for Bug 2:
// Export Excel button's click handler referenced `filtered` which was
// declared inside renderExpensesPage() — out of scope inside bindFilterEvents().
// Result: ReferenceError silently swallowed by browser → no toast, no download.
//
// This test sets up a minimal DOM mock, renders the expenses page, and
// triggers the export click handler. Before the fix it throws
// ReferenceError; after the fix it computes its own filtered set and
// invokes exportToExcel with the expected rows.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── Minimal DOM mock ──────────────────────────────────────────────────────
function setupDom() {
  const handlers = new Map();   // `${id}:${type}` → fn
  const elements = new Map();   // id → mockEl

  function makeEl(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id,
      innerHTML: "",
      value: "",
      textContent: "",
      dataset: {},
      style: {},
      isConnected: true,
      disabled: false,
      files: [],
      addEventListener(type, fn) { handlers.set(`${id}:${type}`, fn); },
      removeEventListener() {},
      click(extra) {
        const fn = handlers.get(`${id}:click`);
        if (fn) fn({ currentTarget: el, ...(extra || {}) });
      },
      appendChild() {},
      remove() {},
      querySelectorAll() { return []; },
    };
    elements.set(id, el);
    return el;
  }

  globalThis.document = {
    getElementById: (id) => makeEl(id),
    querySelectorAll: () => [],
    createElement: () => ({
      textContent: "",
      innerHTML: "",
      style: { cssText: "" },
      appendChild() {},
      addEventListener() {},
    }),
    body: { appendChild() {} },
  };

  return { handlers, elements, getEl: (id) => elements.get(id) };
}

// Capture exportToExcel calls via window.XLSX mock (the real exportToExcel
// in modules/utils.js checks window.XLSX and pipes rows through json_to_sheet).
function setupXlsxCapture() {
  const calls = [];
  globalThis.window = globalThis.window || {};
  globalThis.window.XLSX = {
    utils: {
      json_to_sheet: (rows) => { calls.push({ rows }); return { rows }; },
      book_new: () => ({ sheets: {} }),
      book_append_sheet: (wb, ws, name) => { wb.sheets[name] = ws; },
    },
    writeFile: () => { /* no-op: don't touch fs */ },
  };
  globalThis.showToast = () => {};
  return calls;
}

function makeCtx(expenses) {
  return {
    state: { expenses, warehouses: [], sales: [] },
    showToast: () => {},
    loadAllData: async () => {},
  };
}

// Sample data — all dated in May 2026 so default filter (current month) keeps them.
const today = new Date("2026-05-16T12:00:00+07:00");
const sampleExpenses = [
  { id: 1, expense_date: "2026-05-01", category: "fuel",      amount: 100, description: "A", payment_method: "cash" },
  { id: 2, expense_date: "2026-05-02", category: "materials", amount: 200, description: "B", payment_method: "transfer" },
  { id: 3, expense_date: "2026-05-03", category: "fuel",      amount: 300, description: "C", payment_method: "cash" },
  { id: 4, expense_date: "2026-05-04", category: "salary",    amount: 400, description: "D", payment_method: "transfer" },
];

// Re-import expenses module fresh in each test to reset module-level filter state.
async function freshImport() {
  const ts = Date.now() + Math.random();
  return await import(`../modules/expenses.js?cachebust=${ts}`);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test("Bug 2: clicking Export button does not throw ReferenceError", async () => {
  const dom = setupDom();
  setupXlsxCapture();
  const { renderExpensesPage } = await freshImport();

  renderExpensesPage(makeCtx(sampleExpenses));
  const btn = dom.getEl("expExportBtn");
  assert.ok(btn, "expExportBtn element should exist after render");

  // Before fix: this throws "ReferenceError: filtered is not defined"
  // After fix: completes without throwing
  assert.doesNotThrow(() => btn.click(), /filtered is not defined|ReferenceError/);
});

test("Bug 2: Export with no category filter includes all current-month rows", async () => {
  const dom = setupDom();
  const calls = setupXlsxCapture();
  const { renderExpensesPage } = await freshImport();

  renderExpensesPage(makeCtx(sampleExpenses));
  dom.getEl("expExportBtn").click();

  assert.equal(calls.length, 1, "exportToExcel should be invoked exactly once");
  assert.equal(calls[0].rows.length, sampleExpenses.length,
    "with no category filter, all 4 May-2026 expenses should export");
});

test("Bug 2: Export with category filter exports only matching rows", async () => {
  const dom = setupDom();
  const calls = setupXlsxCapture();
  const { renderExpensesPage } = await freshImport();

  renderExpensesPage(makeCtx(sampleExpenses));

  // Simulate user changing the category dropdown to "fuel"
  const catSel = dom.getEl("expFilterCategory");
  catSel.value = "fuel";
  const onChange = dom.handlers.get("expFilterCategory:change");
  assert.ok(onChange, "expFilterCategory change handler must be registered");
  onChange({ target: catSel });
  // renderExpensesPage was called recursively; handlers re-registered.

  // Trigger export
  dom.getEl("expExportBtn").click();

  assert.equal(calls.length, 1, "exportToExcel should be invoked once");
  assert.equal(calls[0].rows.length, 2,
    "with category=fuel filter, only the 2 fuel expenses should export");
  // sanity: every exported row's "หมวด" is fuel
  for (const r of calls[0].rows) {
    assert.equal(r["หมวด"], "fuel", "every exported row should be category=fuel");
  }
});
