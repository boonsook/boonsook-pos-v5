import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../modules/api.js";

function makeWin(overrides = {}) {
  return {
    SUPABASE_CONFIG: { url: "https://proj.supabase.co", anonKey: "anon-1" },
    _sbAccessToken: "tok-1",
    App: { showToast: () => {}, state: { supabase: null } },
    fetch: async () => ({ status: 200 }),
    ...overrides,
  };
}

// ── appAuthFetch ──
test("appAuthFetch: injects apikey + Bearer headers", async () => {
  let captured;
  const win = makeWin({ fetch: async (url, opts) => { captured = opts; return { status: 200 }; } });
  const { appAuthFetch } = createApi({ windowRef: win });
  await appAuthFetch("https://x/y");
  assert.equal(captured.headers.apikey, "anon-1");
  assert.equal(captured.headers.Authorization, "Bearer tok-1");
});

test("appAuthFetch: falls back to anonKey when no _sbAccessToken", async () => {
  let captured;
  const win = makeWin({ _sbAccessToken: null, fetch: async (url, opts) => { captured = opts; return { status: 200 }; } });
  const { appAuthFetch } = createApi({ windowRef: win });
  await appAuthFetch("https://x/y");
  assert.equal(captured.headers.Authorization, "Bearer anon-1");
});

test("appAuthFetch: 401 → refresh fails → toast + return 401, no infinite retry", async () => {
  let calls = 0;
  const win = makeWin({
    fetch: async () => { calls++; return { status: 401 }; },
    App: { showToast: () => {}, state: { supabase: { auth: { refreshSession: async () => ({ data: null, error: { message: "no" } }) } } } },
  });
  const { appAuthFetch } = createApi({ windowRef: win });
  const r = await appAuthFetch("https://x/y");
  assert.equal(r.status, 401);
  assert.equal(calls, 1); // refresh false → no retry
});

test("appAuthFetch: 401 → refresh ok → retry once with _isRetry (calls=2)", async () => {
  let calls = 0;
  const win = makeWin({
    fetch: async () => { calls++; return { status: 401 }; },
    App: { showToast: () => {}, state: { supabase: { auth: { refreshSession: async () => ({ data: { session: { access_token: "tok-2" } }, error: null }) } } } },
  });
  const { appAuthFetch } = createApi({ windowRef: win });
  const r = await appAuthFetch("https://x/y");
  assert.equal(r.status, 401);
  assert.equal(calls, 2); // original + one retry (retry passes _isRetry=true → stops)
  assert.equal(win._sbAccessToken, "tok-2"); // token rotated by refresh
});

// ── refreshAccessToken (single-flight) ──
test("refreshAccessToken: returns false when no supabase client", async () => {
  const win = makeWin({ App: { state: { supabase: null } } });
  const { refreshAccessToken } = createApi({ windowRef: win });
  assert.equal(await refreshAccessToken(), false);
});

test("refreshAccessToken: success rotates windowRef._sbAccessToken", async () => {
  const win = makeWin({ App: { state: { supabase: { auth: { refreshSession: async () => ({ data: { session: { access_token: "tok-2" } }, error: null }) } } } } });
  const { refreshAccessToken } = createApi({ windowRef: win });
  assert.equal(await refreshAccessToken(), true);
  assert.equal(win._sbAccessToken, "tok-2");
});

test("refreshAccessToken: single-flight — concurrent calls share one promise", async () => {
  let refreshCount = 0;
  const win = makeWin({ App: { state: { supabase: { auth: { refreshSession: async () => { refreshCount++; return { data: { session: { access_token: "tok-2" } }, error: null }; } } } } } });
  const { refreshAccessToken } = createApi({ windowRef: win });
  const [a, b, c] = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);
  assert.equal(a, true); assert.equal(b, true); assert.equal(c, true);
  assert.equal(refreshCount, 1); // only ONE actual refreshSession call
});

// ── xhrPost/Patch/Delete: mock XMLHttpRequest ──
function makeXHRClass(scriptedResponse) {
  return class {
    open() {} setRequestHeader() {}
    send() { setTimeout(() => { this.status = scriptedResponse.status; this.responseText = scriptedResponse.body || ""; this.onload && this.onload(); }, 0); }
    set timeout(_v) {}
  };
}

test("xhrPost: 2xx with body → { ok:true, data } (first row of array)", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 201, body: JSON.stringify([{ id: 7 }]) }) });
  const { xhrPost } = createApi({ windowRef: win });
  const r = await xhrPost("products", { name: "x" }, { returnData: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { id: 7 });
});

test("xhrPost: 2xx empty body (return=minimal) → { ok:true, data:null }", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 204, body: "" }) });
  const { xhrPost } = createApi({ windowRef: win });
  const r = await xhrPost("products", { name: "x" });
  assert.equal(r.ok, true);
  assert.equal(r.data, null);
});

test("xhrPost: 4xx → { ok:false, error.message }", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 400, body: JSON.stringify({ message: "bad" }) }) });
  const { xhrPost } = createApi({ windowRef: win });
  const r = await xhrPost("products", {});
  assert.equal(r.ok, false);
  assert.equal(r.error.message, "bad");
});

test("xhrPatch: empty array response → RLS-blocked error (0 rows affected)", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 200, body: JSON.stringify([]) }) });
  const { xhrPatch } = createApi({ windowRef: win });
  const r = await xhrPatch("products", { stock: 1 }, "id", 9);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /RLS blocked/);
});

test("xhrPatch: 2xx with row → { ok:true, data }", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 200, body: JSON.stringify([{ id: 9, stock: 1 }]) }) });
  const { xhrPatch } = createApi({ windowRef: win });
  const r = await xhrPatch("products", { stock: 1 }, "id", 9);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { id: 9, stock: 1 });
});

test("xhrDelete: 2xx → { ok:true }", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 204, body: "" }) });
  const { xhrDelete } = createApi({ windowRef: win });
  const r = await xhrDelete("profiles", "id", 3);
  assert.equal(r.ok, true);
});

test("xhrDelete: 4xx → { ok:false, error.message }", async () => {
  const win = makeWin({ XMLHttpRequest: makeXHRClass({ status: 403, body: JSON.stringify({ message: "forbidden" }) }) });
  const { xhrDelete } = createApi({ windowRef: win });
  const r = await xhrDelete("profiles", "id", 3);
  assert.equal(r.ok, false);
  assert.equal(r.error.message, "forbidden");
});

// ── Source-level pins ──
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __d = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__d, "..", "main.js"), "utf8");
const apiSrc  = readFileSync(path.join(__d, "..", "modules", "api.js"), "utf8");

test("Phase 92.9: api.js exports createApi factory", () => {
  assert.ok(/export\s+function\s+createApi\s*\(/.test(apiSrc));
});

test("Phase 92.9: main.js imports createApi + binds 5 window._app* wrappers", () => {
  assert.ok(/import\s*\{\s*createApi\s*\}\s*from\s*["']\.\/modules\/api\.js["']/.test(mainSrc));
  for (const w of ["_appRefreshAccessToken", "_appAuthFetch", "_appXhrPost", "_appXhrPatch", "_appXhrDelete"])
    assert.ok(new RegExp(`window\\.${w}\\s*=`).test(mainSrc), `main.js must keep window.${w}`);
});

test("Phase 92.9: main.js no longer inlines the XHR/auth definitions", () => {
  assert.ok(!/function\s+xhrPost\s*\(/.test(mainSrc), "xhrPost must not be inline in main.js");
  assert.ok(!/async\s+function\s+refreshAccessToken\s*\(/.test(mainSrc));
  assert.ok(!/async\s+function\s+appAuthFetch\s*\(/.test(mainSrc));
});

test("Phase 92.9: api.js routes all globals through windowRef (no bareword window./new XMLHttpRequest)", () => {
  const code = apiSrc.replace(/`[\s\S]*?`/g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/[^a-zA-Z.]window\.(SUPABASE_CONFIG|_sbAccessToken|App)\b/.test(code), "no bareword window.* in code");
  assert.ok(!/new\s+XMLHttpRequest\s*\(/.test(code), "must use new windowRef.XMLHttpRequest()");
});
