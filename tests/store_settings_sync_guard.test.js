// Phase 378 — store-settings cloud-sync feedback (HR GPS hardening A / #2)
//
// Bug: saveStoreInfo (main.js) always wrote localStorage, then on Supabase
// upsert error/timeout/throw it just console.warn + `return` (void). The
// store.js save handler swallowed and showed "บันทึกสำเร็จ ✅" UNCONDITIONALLY
// → cloud-sync failed silently. Since geofence is operational (build 377),
// a silent sync failure means staff devices keep stale GPS/geofence config
// and enforcement drifts without anyone knowing.
//
// Fix:
//   - saveStoreInfo returns { ok:true, cloudSynced:boolean, error:string|null }
//     (still saves localStorage ALWAYS, before Supabase; never throws).
//   - store.js handler reads the result and shows a clear warning when
//     cloudSynced === false (no fake green success). Local save is preserved;
//     offline is not blocked.
//
// main.js is the app entry and cannot be imported without boot side-effects,
// so saveStoreInfo is tested behaviorally by running its REAL extracted source
// in a node:vm sandbox (genuine behavior, no eval/new Function). The store.js
// handler is an inline event listener → asserted at source level.
//
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const storeSrc = readFileSync(path.join(__dirname, "..", "modules", "settings", "store.js"), "utf8");

// ── Extract an `async function NAME(...) { ... }` by brace-matching ──────────
function extractAsyncFn(src, name) {
  const sig = `async function ${name}(`;
  const start = src.indexOf(sig);
  if (start < 0) return null;
  let depth = 0;
  let i = src.indexOf("{", start);
  if (i < 0) return null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i);
}

const saveStoreInfoSrc = extractAsyncFn(mainSrc, "saveStoreInfo");

// Build a callable copy of the REAL saveStoreInfo source in an isolated context.
function loadSaveStoreInfo(state, storageRef) {
  const sandbox = {
    state,
    localStorage: storageRef,
    console: { warn() {}, error() {}, log() {} },
    setTimeout, // real timer (only the 3s race path uses it; happy paths resolve first)
  };
  vm.createContext(sandbox);
  // Expose the function on the sandbox global so we can grab a reference out.
  vm.runInContext(`${saveStoreInfoSrc}\nglobalThis.__saveStoreInfo = saveStoreInfo;`, sandbox);
  return sandbox.__saveStoreInfo;
}

function makeStorage() {
  const map = {};
  return {
    map,
    setItem: (k, v) => { map[k] = String(v); },
    getItem: (k) => (k in map ? map[k] : null),
    removeItem: (k) => { delete map[k]; },
  };
}

// A minimal supabase double: from().upsert() resolves/rejects as configured.
function makeSupabase(resultOrThrow) {
  const calls = { from: [], upsert: [] };
  return {
    calls,
    from(table) {
      calls.from.push(table);
      return {
        upsert(payload, opts) {
          calls.upsert.push({ payload, opts });
          if (resultOrThrow instanceof Error) return Promise.reject(resultOrThrow);
          return Promise.resolve(resultOrThrow);
        },
      };
    },
  };
}

// ── Behavioral: saveStoreInfo return contract ───────────────────────────────
test("saveStoreInfo source could be extracted from main.js", () => {
  assert.ok(saveStoreInfoSrc, "could not extract async function saveStoreInfo from main.js");
});

test("saveStoreInfo: no supabase → ok:true, cloudSynced:false, error set; still saves localStorage", async () => {
  const storage = makeStorage();
  const state = { storeInfo: { name: "old" }, supabase: null };
  const fn = loadSaveStoreInfo(state, storage);

  const res = await fn({ name: "new", shopLat: 1.23 });

  assert.equal(res.ok, true);
  assert.equal(res.cloudSynced, false, "no supabase connection → not synced to cloud");
  assert.ok(res.error, "must explain why it did not sync");
  // local save always happens (offline fallback)
  assert.ok(storage.getItem("bsk_store_info"), "localStorage must be written even with no supabase");
  assert.match(storage.getItem("bsk_store_info"), /"shopLat":1\.23/);
});

test("saveStoreInfo: upsert success → cloudSynced:true, error:null", async () => {
  const storage = makeStorage();
  const state = { storeInfo: {}, supabase: makeSupabase({ error: null }) };
  const fn = loadSaveStoreInfo(state, storage);

  const res = await fn({ name: "store" });

  assert.equal(res.ok, true);
  assert.equal(res.cloudSynced, true, "successful upsert → cloud synced");
  assert.equal(res.error, null);
  // wrote to the correct app_settings key/payload (must not change)
  assert.deepEqual(state.supabase.calls.from, ["app_settings"]);
  assert.equal(state.supabase.calls.upsert[0].payload.key, "store_info");
  assert.equal(state.supabase.calls.upsert[0].opts.onConflict, "key");
});

test("saveStoreInfo: upsert returns error → cloudSynced:false (no throw), local still saved", async () => {
  const storage = makeStorage();
  const state = { storeInfo: {}, supabase: makeSupabase({ error: { message: "RLS denied" } }) };
  const fn = loadSaveStoreInfo(state, storage);

  const res = await fn({ name: "x" }); // must not reject
  assert.equal(res.ok, true);
  assert.equal(res.cloudSynced, false, "upsert error → not synced");
  assert.match(res.error, /RLS denied/, "error message surfaced to caller");
  assert.ok(storage.getItem("bsk_store_info"), "localStorage saved despite cloud error");
});

test("saveStoreInfo: upsert throws → cloudSynced:false (caught, no throw), local saved before supabase", async () => {
  const storage = makeStorage();
  const state = { storeInfo: {}, supabase: makeSupabase(new Error("network down")) };
  const fn = loadSaveStoreInfo(state, storage);

  const res = await fn({ name: "y" });
  assert.equal(res.ok, true);
  assert.equal(res.cloudSynced, false);
  assert.match(res.error, /network down/);
  // localStorage was written even though supabase blew up → set BEFORE supabase
  assert.ok(storage.getItem("bsk_store_info"), "local write must happen before/independent of supabase failure");
});

test("saveStoreInfo: never returns void / undefined (every path returns a status object)", async () => {
  // Source guard: no bare `return;` inside the function (would be a void leak).
  assert.ok(saveStoreInfoSrc, "saveStoreInfo source required");
  assert.ok(
    !/\n\s*return\s*;/.test(saveStoreInfoSrc),
    "saveStoreInfo must not contain a bare `return;` — every branch returns { ok, cloudSynced, error }"
  );
  assert.ok(/cloudSynced:\s*true/.test(saveStoreInfoSrc), "must have a cloudSynced:true success path");
  assert.ok(
    (saveStoreInfoSrc.match(/cloudSynced:\s*false/g) || []).length >= 2,
    "must have at least two cloudSynced:false paths (no-supabase + error/catch)"
  );
  // must not rethrow (offline must never crash the save)
  assert.ok(!/\n\s*throw\b/.test(saveStoreInfoSrc), "saveStoreInfo must not throw");
});

// ── Source-level: store.js save handler must surface cloud-sync failure ──────
test("store.js: save handler captures saveStoreInfo result (no longer fire-and-forget)", () => {
  assert.ok(
    /const\s+result\s*=\s*await\s+saveStoreInfo\(\s*data\s*\)/.test(storeSrc),
    "handler must capture `const result = await saveStoreInfo(data)`"
  );
});

test("store.js: success toast is GATED on cloudSynced === true (not unconditional)", () => {
  assert.ok(
    /result\?\.cloudSynced\s*===\s*true/.test(storeSrc),
    "handler must branch on result?.cloudSynced === true before showing success"
  );
  const gateIdx = storeSrc.indexOf("cloudSynced === true");
  const successIdx = storeSrc.indexOf("บันทึกข้อมูลร้านค้าสำเร็จ");
  assert.ok(gateIdx > -1 && successIdx > -1, "both the gate and the success toast must exist");
  assert.ok(
    successIdx > gateIdx,
    "success toast must appear AFTER the cloudSynced===true gate (not before/unconditional)"
  );
});

test("store.js: there is an error/warning branch when cloud-sync fails", () => {
  // an else branch with a showToast that is NOT the success toast
  assert.ok(
    /\}\s*else\s*\{[\s\S]*?showToast/.test(storeSrc),
    "handler must have an else branch that toasts a warning when !cloudSynced"
  );
  assert.ok(
    /sync[\s\S]{0,40}เซิร์ฟเวอร์/.test(storeSrc),
    "warning text must tell the user the cloud sync did not succeed"
  );
});

test("store.js: button is re-enabled in a finally block (no stuck disabled button)", () => {
  assert.ok(
    /finally\s*\{[\s\S]*?btn\.disabled\s*=\s*false/.test(storeSrc),
    "handler must re-enable the save button in a finally block"
  );
});

test("store.js: still preserves local save call to saveStoreInfo", () => {
  assert.ok(
    /saveStoreInfo\(\s*data\s*\)/.test(storeSrc),
    "handler must still call saveStoreInfo(data) (localStorage fallback preserved)"
  );
});

// ── Scope guard: must not have touched the sibling savePaymentInfo contract ──
test("main.js: savePaymentInfo untouched this phase (still returns nothing / no cloudSynced)", () => {
  const payFn = extractAsyncFn(mainSrc, "savePaymentInfo");
  assert.ok(payFn, "savePaymentInfo must still exist");
  assert.ok(
    !/cloudSynced/.test(payFn),
    "Phase 378 scope: savePaymentInfo must NOT be changed (no cloudSynced added)"
  );
});
