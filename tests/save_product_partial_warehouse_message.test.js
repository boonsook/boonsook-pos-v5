// Phase 623: execute the real saveProduct with stub I/O; never contact a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const matches = [...main.matchAll(/^async function saveProduct\(\)\{[\s\S]*?^\}/gm)];
assert.equal(matches.length, 1, "extract exactly one complete saveProduct");
const source = matches[0][0];
const PLAIN = "บันทึกสินค้าแล้ว";
const PARTIAL = "⚠️ บันทึกสินค้าแล้ว แต่สต็อกบางคลังไม่สำเร็จ";
const copy = value => JSON.parse(JSON.stringify(value));

async function runSave({ mode, failures = [], noWarehouses = false, productFailure = false,
  refreshOk = true, currentRoute = "products" }, code = source) {
  const editing = mode === "edit";
  const oldProduct = { id: 42, name: "เดิม", stock: 9, retained: "keep" };
  const otherProduct = { id: 99, name: "other", stock: 1 };
  const state = {
    editingProductId: editing ? 42 : null,
    currentRoute,
    products: editing ? [oldProduct, otherProduct] : [otherProduct],
    warehouses: noWarehouses ? [] : [{ id: 1, name: "คลังหนึ่ง" }, { id: 2, name: "คลังสอง" }],
    warehouseStock: editing && !noWarehouses
      ? [{ id: 101, product_id: 42, warehouse_id: 1, stock: 9, min_stock: 1 }] : []
  };
  const initial = copy(state);
  const values = {
    newProductName: " สินค้าใหม่ ", newProductSku: " SKU-TEST ", newProductCategory: " หมวด ",
    newProductType: "stock", newProductPrice: "20", newProductCost: "10",
    newProductBarcode: " CODE ", newProductStock: "7", newProductMinStock: "3"
  };
  const events = [], writes = [], toasts = [], timers = [], errors = [];
  let resetSnapshot;
  let writing = false;
  const write = async (method, args) => {
    assert.equal(writing, false, "writes remain sequential");
    writing = true;
    events.push(`write:${method}:${args[0]}`);
    writes.push(copy([method, ...args]));
    await Promise.resolve();
    writing = false;
    if (args[0] === "products") {
      return productFailure ? { ok: false, error: { message: "product rejected" } }
        : { ok: true, data: { id: 42, stock: 0, serverField: "returned" } };
    }
    assert.equal(args[0], "warehouse_stock");
    const whId = method === "PATCH" ? 1 : args[1].warehouse_id;
    return { ok: !failures.includes(whId) };
  };
  const context = vm.createContext({
    state,
    $: id => Object.hasOwn(values, id) ? { value: values[id] } : undefined,
    document: {
      querySelectorAll: selector => {
        assert.equal(selector, ".wh-stock-input");
        return state.warehouses.map(w => ({ dataset: { whId: String(w.id) }, value: w.id === 1 ? "4" : "3" }));
      },
      querySelector: selector => {
        assert.match(selector, /^\.wh-min-stock-input\[data-wh-min-id="[12]"\]$/);
        return { value: selector.includes('"1"') ? "1" : "2" };
      }
    },
    requireAdminOrSales: () => true,
    round2: n => Math.round(n * 100) / 100,
    findDuplicateProduct: () => null,
    _productTagWidget: null,
    window: { SUPABASE_CONFIG: { url: "https://fixture.invalid", anonKey: "fixture" } },
    xhrPatch: (...args) => write("PATCH", args),
    xhrPost: (...args) => write("POST", args),
    fetch: async (...args) => {
      events.push("bundle:DELETE");
      writes.push(copy(["fetch", ...args]));
      return { ok: true };
    },
    showToast: message => { toasts.push(message); events.push(`toast:${message}`); },
    resetProductForm: () => {
      resetSnapshot = copy(state.products);
      events.push("reset");
      state.editingProductId = null;
    },
    closeAllDrawers: () => events.push("close"),
    refreshProductsPage: () => { events.push("refresh"); return refreshOk; },
    showRoute: route => events.push(`route:${route}`),
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); events.push(`schedule:${delay}`); },
    loadAllData: async () => { events.push("reload"); },
    console: { error: (...args) => errors.push(copy(args)), warn: (...args) => errors.push(copy(args)) }
  });
  await vm.runInContext(`${code}\nsaveProduct()`, context);
  return { state, initial, events, writes, toasts, timers, errors, resetSnapshot };
}

function expectedPayload(mode, noWarehouses) {
  return {
    name: "สินค้าใหม่", sku: "SKU-TEST", category: "หมวด", product_type: "stock",
    price: 20, cost: 10, barcode: "CODE", is_active: true, min_stock: 3,
    ...(noWarehouses ? { stock: 7 } : {}),
    ...(mode === "edit" ? { image_url: null } : {}),
    is_featured: false, promo_price: null, promo_start: null, promo_end: null, is_bundle: false
  };
}

function assertMessage(result, failures) {
  assert.equal(result.toasts.at(-1), failures.length ? PARTIAL : PLAIN, "final save message");
  if (failures.length) {
    const warning = result.toasts.findIndex(t => t.startsWith("⚠️ บันทึกสต็อกบางคลังไม่สำเร็จ:"));
    assert.ok(warning >= 0, "original named-warehouse warning remains");
    assert.equal(result.toasts.slice(warning).includes(PLAIN), false, "no plain success after warning");
  }
}

async function assertFlow(options, code = source) {
  const { mode, noWarehouses = false, productFailure = false, failures = [],
    refreshOk = true, currentRoute = "products" } = options;
  const r = await runSave(options, code);
  const payload = expectedPayload(mode, noWarehouses);
  const productWrite = mode === "edit" ? ["PATCH", "products", payload, "id", 42]
    : ["POST", "products", { ...payload, stock: noWarehouses ? 7 : 0 }, { returnData: true }];
  const expectedWrites = [productWrite];
  const expectedEvents = ["toast:กำลังบันทึก...", `write:${mode === "edit" ? "PATCH" : "POST"}:products`];
  if (productFailure) {
    assert.deepEqual(r.writes, expectedWrites);
    assert.deepEqual(r.events, [...expectedEvents, "toast:product rejected"]);
    assert.deepEqual(r.state, r.initial, "primary failure leaves state/form intact");
    assert.equal(r.resetSnapshot, undefined);
    assert.equal(r.timers.length, 0);
    assert.equal(r.errors.length, 0);
    return;
  }
  if (!noWarehouses) {
    expectedWrites.push(mode === "edit"
      ? ["PATCH", "warehouse_stock", { stock: 4, min_stock: 1 }, "id", 101]
      : ["POST", "warehouse_stock", { product_id: 42, warehouse_id: 1, stock: 4, min_stock: 1 }]);
    expectedWrites.push(["POST", "warehouse_stock", { product_id: 42, warehouse_id: 2, stock: 3, min_stock: 2 }]);
    expectedEvents.push(`write:${mode === "edit" ? "PATCH" : "POST"}:warehouse_stock`, "write:POST:warehouse_stock");
  }
  const names = failures.map(id => id === 1 ? "คลังหนึ่ง" : "คลังสอง");
  if (names.length) expectedEvents.push(`toast:⚠️ บันทึกสต็อกบางคลังไม่สำเร็จ: ${names.join(", ")} — โปรดตรวจ/ลองใหม่`);
  expectedWrites.push(["fetch", "https://fixture.invalid/rest/v1/product_bundles?bundle_id=eq.42", {
    method: "DELETE", headers: { apikey: "fixture", Authorization: "Bearer fixture", Prefer: "return=minimal" }
  }]);
  expectedEvents.push("bundle:DELETE", "reset", "close", `toast:${failures.length ? PARTIAL : PLAIN}`);
  if (currentRoute === "products") {
    expectedEvents.push("refresh");
    if (!refreshOk) expectedEvents.push("route:products");
  }
  expectedEvents.push("schedule:100");
  assertMessage(r, failures);
  assert.deepEqual(r.writes, expectedWrites, "exact write count/type/order/payload");
  assert.deepEqual(r.events, expectedEvents, "warning/reset/close/refresh/scheduling order");
  assert.deepEqual(r.errors, names.length ? [["[saveProduct] warehouse_stock write failed:", names]] : []);
  const optimistic = mode === "edit" ? { ...r.initial.products[0], ...payload }
    : { ...payload, id: 42, stock: 0, serverField: "returned" };
  const expectedProducts = [optimistic, { id: 99, name: "other", stock: 1 }];
  assert.deepEqual(copy(r.state.products), expectedProducts);
  assert.deepEqual(r.resetSnapshot, expectedProducts, "optimistic update precedes reset");
  assert.deepEqual(r.state.warehouseStock, r.initial.warehouseStock, "no optimistic warehouse mutation");
  assert.equal(r.state.editingProductId, null);
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].delay, 100);
  await r.timers[0].fn();
  assert.deepEqual(r.events, [...expectedEvents, "reload"], "reload runs only after scheduled callback");
}

for (const mode of ["edit", "create"]) {
  for (const [name, options] of [
    ["all warehouses succeed", {}],
    ["first warehouse fails", { failures: [1] }],
    ["last warehouse fails", { failures: [2] }],
    ["all warehouses fail", { failures: [1, 2] }],
    ["primary product fails", { productFailure: true }],
    ["no warehouses", { noWarehouses: true }]
  ]) test(`${mode}: ${name}`, () => assertFlow({ mode, ...options }));
}

test("refresh fallback remains after the partial warning", () =>
  assertFlow({ mode: "edit", failures: [2], refreshOk: false }));
test("another route still schedules reload without refreshing products", () =>
  assertFlow({ mode: "create", failures: [1], currentRoute: "dashboard" }));

test("mutation tooth: unconditional plain success is rejected by partial cases", async () => {
  const finalBranch = /showToast\(_whFails\.length > 0\s*\? "[^"]+"\s*:\s*"บันทึกสินค้าแล้ว"\);/g;
  assert.equal([...source.matchAll(finalBranch)].length, 1, "mutate exactly the final branch");
  const mutant = source.replace(finalBranch, 'showToast("บันทึกสินค้าแล้ว");');
  for (const mode of ["edit", "create"]) {
    for (const failures of [[1], [2], [1, 2]]) {
      await assert.rejects(() => assertFlow({ mode, failures }, mutant), {
        code: "ERR_ASSERTION", message: /final save message/
      });
    }
  }
});
