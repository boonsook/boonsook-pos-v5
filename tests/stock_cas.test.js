// Phase 89.11 — Unit tests for atomicDecrementStock CAS logic
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { atomicDecrementStock } from "../modules/stock_cas.js";

// Helper: make a fake Response object
function makeRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// Helper: queue-based fetcher — pops one mock per call, asserts queue exhausted at end
function mockFetcher(queue) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (queue.length === 0) throw new Error("mockFetcher: queue exhausted, unexpected call to " + url);
    const next = queue.shift();
    if (typeof next === "function") return next(url, init);
    if (next instanceof Error) throw next;
    return next;
  };
  fetcher.calls = calls;
  fetcher.remaining = () => queue.length;
  return fetcher;
}

const baseCfg = {
  supabaseUrl: "https://example.supabase.co",
  anonKey: "anon-key-xxx",
  accessToken: "user-jwt-yyy",
};

// Silent logger for tests
const silent = { warn: () => {} };

test("happy path — succeeds on first attempt, returns ok+before+after", async () => {
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]),                          // refetch
    makeRes(200, [{ id: 1, stock: 7 }]),                    // patch (returns row)
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 3,
  });
  assert.equal(r.ok, true);
  assert.equal(r.before, 10);
  assert.equal(r.after, 7);
  assert.equal(r.attempts, 1);
  assert.equal(fetcher.remaining(), 0);
});

test("CAS retry — first PATCH loses (0 rows), second succeeds", async () => {
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]),                          // refetch #1
    makeRes(200, []),                                        // patch #1: 0 rows = CAS lost
    makeRes(200, [{ stock: 8 }]),                            // refetch #2: stock dropped to 8
    makeRes(200, [{ id: 5, stock: 5 }]),                     // patch #2: success
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 5, qty: 3,
  });
  assert.equal(r.ok, true);
  assert.equal(r.before, 8);
  assert.equal(r.after, 5);
  assert.equal(r.attempts, 2);
});

test("CAS contention — all maxRetries fail, returns error", async () => {
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]), makeRes(200, []),
    makeRes(200, [{ stock: 9  }]), makeRes(200, []),
    makeRes(200, [{ stock: 8  }]), makeRes(200, []),
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1, maxRetries: 3,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /CAS contention/);
});

test("row not found — refetch returns empty array → error, no PATCH", async () => {
  const fetcher = mockFetcher([
    makeRes(200, []),
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 999, qty: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /row not found/);
  assert.equal(fetcher.calls.length, 1, "should not attempt PATCH if refetch returned no row");
});

test("fetch HTTP error — refetch returns 500, no retry", async () => {
  const fetcher = mockFetcher([makeRes(500, null)]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /fetch HTTP 500/);
});

test("PATCH HTTP error — returns error without retry", async () => {
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]),
    makeRes(409, null),
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /PATCH HTTP 409/);
});

test("network throw on fetch — caught, returns error", async () => {
  const fetcher = mockFetcher([new Error("ECONNRESET")]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /fetch error.*ECONNRESET/);
});

test("network throw on PATCH — caught, returns error", async () => {
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]),
    new Error("socket hang up"),
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /PATCH error.*socket hang up/);
});

test("bad args — missing rowId / qty<=0 / missing table → no fetch", async () => {
  const fetcher = mockFetcher([]);
  for (const [args, label] of [
    [{ table: "warehouse_stock", rowId: null, qty: 1 }, "null rowId"],
    [{ table: "warehouse_stock", rowId: "",   qty: 1 }, "empty rowId"],
    [{ table: "warehouse_stock", rowId: 1,    qty: 0 }, "qty=0"],
    [{ table: "warehouse_stock", rowId: 1,    qty: -5 }, "negative qty"],
    [{ table: "",                rowId: 1,    qty: 1 }, "empty table"],
    [{ table: "warehouse_stock", rowId: 1,    qty: "abc" }, "non-numeric qty"],
  ]) {
    const r = await atomicDecrementStock({ ...baseCfg, fetcher, logger: silent, ...args });
    assert.equal(r.ok, false, `${label} should fail`);
    assert.equal(r.error, "bad args", `${label}: expected "bad args" got "${r.error}"`);
  }
  assert.equal(fetcher.calls.length, 0, "no fetch should happen for bad args");
});

test("bad args — missing supabaseUrl / anonKey", async () => {
  const fetcher = mockFetcher([]);
  const r1 = await atomicDecrementStock({
    supabaseUrl: "", anonKey: "k", fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(r1.ok, false);
  const r2 = await atomicDecrementStock({
    supabaseUrl: "https://x.co", anonKey: "", fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(r2.ok, false);
  assert.equal(fetcher.calls.length, 0);
});

test("URL encoding — rowId with special chars (UUID, spaces, quotes)", async () => {
  let capturedRefetchUrl, capturedPatchUrl;
  const fetcher = mockFetcher([
    (url) => { capturedRefetchUrl = url; return makeRes(200, [{ stock: 5 }]); },
    (url) => { capturedPatchUrl = url; return makeRes(200, [{ stock: 4 }]); },
  ]);
  const tricky = "a b'c&d=e/f";
  await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: tricky, qty: 1,
  });
  assert.match(capturedRefetchUrl, /id=eq\.a%20b'c%26d%3De%2Ff/);
  assert.match(capturedPatchUrl,   /id=eq\.a%20b'c%26d%3De%2Ff/);
});

test("custom field — supports 'stock' on products table same way", async () => {
  let capturedRefetch;
  const fetcher = mockFetcher([
    (url) => { capturedRefetch = url; return makeRes(200, [{ stock: 20 }]); },
    makeRes(200, [{ stock: 18 }]),
  ]);
  const r = await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "products", rowId: 42, qty: 2, field: "stock",
  });
  assert.equal(r.ok, true);
  assert.equal(r.before, 20);
  assert.equal(r.after, 18);
  assert.match(capturedRefetch, /\/rest\/v1\/products\?id=eq\.42&select=stock/);
});

test("accessToken fallback to anonKey when omitted", async () => {
  let capturedAuth;
  const fetcher = mockFetcher([
    (_url, init) => { capturedAuth = init.headers.Authorization; return makeRes(200, [{ stock: 10 }]); },
    makeRes(200, [{ stock: 9 }]),
  ]);
  await atomicDecrementStock({
    supabaseUrl: "https://x.co", anonKey: "anon-fallback-key", fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(capturedAuth, "Bearer anon-fallback-key");
});

test("PATCH request body uses correct {field: after} shape", async () => {
  let capturedBody;
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]),
    (_url, init) => { capturedBody = init.body; return makeRes(200, [{ stock: 7 }]); },
  ]);
  await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 1, qty: 3,
  });
  const parsed = JSON.parse(capturedBody);
  assert.deepEqual(parsed, { stock: 7 });
});

test("PATCH WHERE clause includes &{field}=eq.{before} for atomic CAS", async () => {
  let capturedPatchUrl;
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 15 }]),
    (url) => { capturedPatchUrl = url; return makeRes(200, [{ stock: 14 }]); },
  ]);
  await atomicDecrementStock({
    ...baseCfg, fetcher, logger: silent,
    table: "warehouse_stock", rowId: 7, qty: 1,
  });
  // Must contain both id filter AND stock=eq.15 filter — this is what makes it atomic
  assert.match(capturedPatchUrl, /id=eq\.7/);
  assert.match(capturedPatchUrl, /&stock=eq\.15/);
});

test("logger.warn called on CAS retry, not on success", async () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };
  const fetcher = mockFetcher([
    makeRes(200, [{ stock: 10 }]), makeRes(200, []),         // retry 1
    makeRes(200, [{ stock: 9  }]), makeRes(200, [{ stock: 8 }]), // success
  ]);
  await atomicDecrementStock({
    ...baseCfg, fetcher, logger,
    table: "warehouse_stock", rowId: 1, qty: 1,
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CAS retry 1\/3/);
});
