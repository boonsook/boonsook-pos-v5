// Phase 89.12 — Unit tests for installErrorReporter
import { test } from "node:test";
import assert from "node:assert/strict";
import { installErrorReporter } from "../modules/error_reporter.js";

// Build a fake window with addEventListener/removeEventListener + location + navigator
function makeWin() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, ev) {
      for (const fn of listeners.get(type) || []) fn(ev);
    },
    location: { href: "https://app.example.com/pos" },
    navigator: { userAgent: "TestAgent/1.0" },
  };
}

function makeFetcher() {
  const calls = [];
  let nextResponse = { ok: true, status: 201, json: async () => ({}) };
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    if (nextResponse instanceof Error) throw nextResponse;
    return nextResponse;
  };
  fetcher.calls = calls;
  fetcher.setNext = (r) => { nextResponse = r; };
  return fetcher;
}

const baseCfg = {
  supabaseUrl: "https://x.supabase.co",
  anonKey: "anon-key",
  getAccessToken: () => "user-token",
  build: 220,
};

const silent = { warn: () => {} };

test("installs window error + unhandledrejection listeners", () => {
  const win = makeWin();
  const reporter = installErrorReporter({
    ...baseCfg, fetcher: makeFetcher(), logger: silent, windowRef: win,
  });
  assert.equal(win.listeners.get("error")?.size, 1);
  assert.equal(win.listeners.get("unhandledrejection")?.size, 1);
  reporter.teardown();
  assert.equal(win.listeners.get("error")?.size, 0);
  assert.equal(win.listeners.get("unhandledrejection")?.size, 0);
});

test("captures synchronous error events with stack + source", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  win.dispatch("error", {
    message: "Cannot read property 'x' of undefined",
    filename: "https://app.example.com/main.js",
    lineno: 100, colno: 5,
    error: { message: "Cannot read property 'x' of undefined", stack: "TypeError: ..." },
  });

  // send is async — wait a microtask
  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 1);
  const body = fetcher.calls[0].body;
  assert.equal(body.message, "Cannot read property 'x' of undefined");
  assert.equal(body.source, "https://app.example.com/main.js:100:5");
  assert.equal(body.severity, "error");
  assert.equal(body.build, 220);
  assert.equal(body.url, "https://app.example.com/pos");
  assert.equal(body.user_agent, "TestAgent/1.0");
  assert.ok(body.fingerprint);
  assert.equal(fetcher.calls[0].init.method, "POST");
  // Phase 89.14: POST ผ่าน CF proxy /api/log-error (anti-spam) แทน Supabase REST direct
  assert.match(fetcher.calls[0].url, /\/api\/log-error$/);
});

test("captures unhandled promise rejections with reason.message + stack", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  win.dispatch("unhandledrejection", {
    reason: { message: "Supabase 401", stack: "Error: Supabase 401\n  at xhr..." },
  });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 1);
  const body = fetcher.calls[0].body;
  assert.match(body.message, /Unhandled promise rejection.*Supabase 401/);
  assert.match(body.stack, /Supabase 401/);
});

test("rejections with non-Error reasons (e.g. plain string) still capture", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  win.dispatch("unhandledrejection", { reason: "boom" });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 1);
  assert.match(fetcher.calls[0].body.message, /Unhandled promise rejection.*boom/);
  assert.equal(fetcher.calls[0].body.stack, null);
});

test("dedups identical errors within a session (same fingerprint sent once)", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  const reporter = installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  const sameEv = { message: "X", filename: "a.js", lineno: 1, colno: 1, error: { stack: "s" } };
  win.dispatch("error", sameEv);
  win.dispatch("error", sameEv);
  win.dispatch("error", sameEv);

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 1);
  assert.equal(reporter._stats().sent, 1);
  assert.equal(reporter._stats().dedupped, 2);
});

test("different errors are NOT dedupped together", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  win.dispatch("error", { message: "A", filename: "a.js", lineno: 1, colno: 1 });
  win.dispatch("error", { message: "B", filename: "a.js", lineno: 1, colno: 1 });
  win.dispatch("error", { message: "A", filename: "b.js", lineno: 1, colno: 1 });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 3);
});

test("respects maxPerSession cap (drops further events)", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  const reporter = installErrorReporter({
    ...baseCfg, fetcher, logger: silent, windowRef: win, maxPerSession: 2,
  });

  for (let i = 0; i < 10; i++) {
    win.dispatch("error", { message: `Err${i}`, filename: "a.js", lineno: i, colno: 1 });
  }

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 2);
  assert.equal(reporter._stats().sent, 2);
  assert.equal(reporter._stats().dropped, 8);
});

test("beforeSend filter — returning null drops event", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({
    ...baseCfg, fetcher, logger: silent, windowRef: win,
    beforeSend: (event) => /ResizeObserver/i.test(event.message) ? null : event,
  });

  win.dispatch("error", { message: "ResizeObserver loop completed", filename: "x", lineno: 1, colno: 1 });
  win.dispatch("error", { message: "Real error", filename: "x", lineno: 2, colno: 1 });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 1);
  assert.equal(fetcher.calls[0].body.message, "Real error");
});

test("beforeSend can mutate event before send", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({
    ...baseCfg, fetcher, logger: silent, windowRef: win,
    beforeSend: (event) => ({ ...event, message: "[redacted] " + event.message.slice(-10) }),
  });

  win.dispatch("error", { message: "secret-token-abc-xyz123", filename: "x", lineno: 1, colno: 1 });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls[0].body.message, "[redacted] abc-xyz123");
});

test("beforeSend throw — drops event, does not crash", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({
    ...baseCfg, fetcher, logger: silent, windowRef: win,
    beforeSend: () => { throw new Error("filter bug"); },
  });

  win.dispatch("error", { message: "x", filename: "a.js", lineno: 1, colno: 1 });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 0);
});

test("POST request shape — headers + body fields", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({
    ...baseCfg, fetcher, logger: silent, windowRef: win,
    getUserId: () => "user-uuid-xyz",
  });

  win.dispatch("error", { message: "X", filename: "a.js", lineno: 1, colno: 1, error: { stack: "trace" } });

  await Promise.resolve(); await Promise.resolve();

  const call = fetcher.calls[0];
  assert.equal(call.init.method, "POST");
  // Phase 89.14: proxy ตัดสินใจ apikey + Prefer เอง — client ส่งแค่ Authorization (ถ้ามี) + Content-Type
  assert.equal(call.init.headers["Authorization"], "Bearer user-token");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.equal(call.body.user_id, "user-uuid-xyz");
  assert.equal(call.body.stack, "trace");
});

test("captureMessage / captureException — manual API works", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  const reporter = installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  reporter.captureMessage("Manual log", { severity: "info" });
  reporter.captureException(new Error("Caught"));

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls.length, 2);
  assert.equal(fetcher.calls[0].body.severity, "info");
  assert.equal(fetcher.calls[0].body.message, "Manual log");
  assert.equal(fetcher.calls[1].body.severity, "error");
  assert.equal(fetcher.calls[1].body.message, "Caught");
});

test("network throw on POST — caught, does not propagate", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  fetcher.setNext(new Error("ECONNREFUSED"));
  const warnings = [];
  installErrorReporter({
    ...baseCfg, fetcher, windowRef: win,
    logger: { warn: (...args) => warnings.push(args) },
  });

  win.dispatch("error", { message: "X", filename: "a.js", lineno: 1, colno: 1 });

  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /POST failed/);
});

test("disabled config — returns no-op reporter, never fetches", async () => {
  const fetcher = makeFetcher();
  const r1 = installErrorReporter({ supabaseUrl: "", anonKey: "k", fetcher, windowRef: makeWin() });
  const r2 = installErrorReporter({ supabaseUrl: "x", anonKey: "",  fetcher, windowRef: makeWin() });
  r1.captureMessage("x");
  r2.captureException(new Error("y"));
  assert.equal(fetcher.calls.length, 0);
  assert.equal(r1._stats().disabled, true);
});

test("message / stack are truncated to safe lengths", async () => {
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({ ...baseCfg, fetcher, logger: silent, windowRef: win });

  const longMessage = "x".repeat(5000);
  const longStack = "y".repeat(20000);
  win.dispatch("error", {
    message: longMessage,
    filename: "a.js", lineno: 1, colno: 1,
    error: { stack: longStack },
  });

  await Promise.resolve(); await Promise.resolve();

  assert.equal(fetcher.calls[0].body.message.length, 2000);
  assert.equal(fetcher.calls[0].body.stack.length, 8000);
});

test("when getAccessToken returns null, no Authorization header sent (proxy will use anon key)", async () => {
  // Phase 89.14: proxy ตัดสินใจ auth เอง — client ส่ง Authorization เฉพาะตอนมี user JWT
  const win = makeWin();
  const fetcher = makeFetcher();
  installErrorReporter({
    supabaseUrl: "https://x.supabase.co", anonKey: "anon-only", getAccessToken: () => null,
    build: 1, fetcher, logger: silent, windowRef: win,
  });
  win.dispatch("error", { message: "x", filename: "a.js", lineno: 1, colno: 1 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(fetcher.calls[0].init.headers["Authorization"], undefined);
});

test("fingerprint is stable across calls for identical input", () => {
  const win = makeWin();
  const r = installErrorReporter({ ...baseCfg, fetcher: makeFetcher(), logger: silent, windowRef: win });
  assert.equal(r._fingerprint("msg", "src"), r._fingerprint("msg", "src"));
  assert.notEqual(r._fingerprint("msg", "src"), r._fingerprint("msg", "src2"));
});
