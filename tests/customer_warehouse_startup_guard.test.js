import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const main = fs.readFileSync(path.resolve("main.js"), "utf8");
const start = main.indexOf("// ★ Auto-seed warehouses");
const end = main.indexOf("// ★ Phase 2: โมดูลเสริม", start);
assert.ok(start >= 0 && end > start, "warehouse seed block must be present inside loadAllData");
const seedBlock = main.slice(start, end);

async function runSeed({ role, result, warehouses = [] }) {
  const inserts = [];
  const warnings = [];
  const state = { profile: role == null ? null : { role }, warehouses };
  const sb = {
    from(table) {
      assert.equal(table, "warehouses");
      return {
        insert(rows) {
          inserts.push(rows);
          return { select: async () => ({ data: rows, error: null }) };
        }
      };
    }
  };
  await vm.runInNewContext(`(async () => { ${seedBlock} })()`, {
    state, sb, rWarehouses: result,
    console: { info() {}, warn(...args) { warnings.push(args); } }
  });
  return { inserts, warnings, warehouses: state.warehouses };
}

const okEmpty = { status: "fulfilled", value: { data: [], error: null } };
const deniedRead = { status: "fulfilled", value: { data: null, error: { message: "RLS denied" } } };

for (const role of ["customer", "technician", "sales", "accountant", null]) {
  test(`${role ?? "missing profile"}: startup never inserts warehouses`, async () => {
    const result = await runSeed({ role, result: okEmpty });
    assert.equal(result.inserts.length, 0);
  });
}

test("customer: denied warehouse SELECT never turns into a seed INSERT", async () => {
  const result = await runSeed({ role: "customer", result: deniedRead });
  assert.equal(result.inserts.length, 0);
});

test("admin: successful confirmed empty read preserves existing seed behavior", async () => {
  const result = await runSeed({ role: "admin", result: okEmpty });
  assert.equal(result.inserts.length, 1);
  assert.deepEqual(Array.from(result.inserts[0], row => row.sort_order), [1, 2, 3]);
  assert.equal(result.warehouses.length, 3);
});

for (const [caseName, result] of [
  ["denied", deniedRead],
  ["rejected", { status: "rejected", reason: new Error("network") }],
  ["missing data", { status: "fulfilled", value: { data: null, error: null } }]
]) {
  test(`admin: ${caseName} read never inserts warehouses`, async () => {
    const outcome = await runSeed({ role: "admin", result });
    assert.equal(outcome.inserts.length, 0);
  });
}

test("admin: existing warehouse rows are not seeded again", async () => {
  const existing = [{ id: 9, name: "existing" }];
  const result = await runSeed({
    role: "admin", warehouses: existing,
    result: { status: "fulfilled", value: { data: existing, error: null } }
  });
  assert.equal(result.inserts.length, 0);
  assert.equal(result.warehouses, existing);
});
