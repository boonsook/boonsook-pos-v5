// Phase 531 — LINE status-badge probe guard
// Run: node --test tests/line_notify_probe_guard.test.js
//
// Bug: the "สถานะเซิร์ฟเวอร์ LINE" badge showed 🟢 even when LINE env vars were
// missing. The page probed /api/line-notify with an EMPTY message, the endpoint
// returned 400 "ข้อความว่าง" (checked BEFORE env), and the page guessed
// "400 = env is configured" → fake green.
//
// Fix: a dedicated probe branch in the function (body.probe===true → early-return
// { configured: !!(token && userId) } WITHOUT sending to LINE) and the page reads
// data.configured directly. This guard locks both halves and proves probe never
// calls the LINE API.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { onRequestPost } from "../functions/api/line-notify.js";

const PAGE_SRC = fs.readFileSync(path.resolve("modules/line_notify.js"), "utf8");

// ───────────────────────────────────────────────
// 1. Behavioral — probe checks env, never sends LINE
// ───────────────────────────────────────────────

async function runProbe(env) {
  let fetchCalls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls++;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
  };
  try {
    const ctx = {
      request: { json: () => Promise.resolve({ probe: true }) },
      env,
    };
    const resp = await onRequestPost(ctx);
    const data = await resp.json();
    return { status: resp.status, data, fetchCalls };
  } finally {
    globalThis.fetch = origFetch;
  }
}

test("probe with LINE env set → 200, configured:true, ไม่ยิง LINE API (fetch 0 calls)", async () => {
  const { status, data, fetchCalls } = await runProbe({
    LINE_CHANNEL_ACCESS_TOKEN: "tok-x",
    LINE_USER_ID: "U1234567890",
  });
  assert.equal(status, 200, "probe ต้องตอบ 200 (ไม่ใช่ 400)");
  assert.equal(data.configured, true, "env ครบ → configured true");
  assert.equal(data.probe, true, "ต้องตอบ probe:true");
  assert.equal(fetchCalls, 0, "probe ต้องไม่ส่ง LINE (fetch ต้องไม่ถูกเรียก)");
});

test("probe ไม่มี LINE env → configured:false, ไม่ยิง LINE API", async () => {
  const { status, data, fetchCalls } = await runProbe({});
  assert.equal(status, 200, "probe ตอบ 200 เสมอ");
  assert.equal(data.configured, false, "ไม่มี env → configured false (ไม่โชว์เขียวหลอก)");
  assert.equal(fetchCalls, 0, "probe ต้องไม่ส่ง LINE");
});

test("probe มี token แต่ขาด userId → configured:false", async () => {
  const { data } = await runProbe({ LINE_CHANNEL_ACCESS_TOKEN: "tok-x" });
  assert.equal(data.configured, false, "ต้องมีทั้ง token + userId ถึงจะ configured");
});

// ───────────────────────────────────────────────
// 2. Source — page probes with { probe:true } and reads data.configured
//    (no longer guesses from HTTP 400)
// ───────────────────────────────────────────────

const probeStart = PAGE_SRC.indexOf("Probe server on mount");
const probeEnd = PAGE_SRC.indexOf("Test notification", probeStart);
const probeBlock = (probeStart !== -1 && probeEnd > probeStart) ? PAGE_SRC.slice(probeStart, probeEnd) : "";

test("page probe block sends { probe:true } and reads data.configured (not status 400)", () => {
  assert.notEqual(probeStart, -1, "probe block must exist");
  assert.ok(probeEnd > probeStart, "probe block boundary must be found");
  assert.match(probeBlock, /probe:\s*true/, "probe fetch must send { probe:true }");
  assert.match(probeBlock, /data\.configured\s*===\s*true/, "🟢 branch must read data.configured === true");
  assert.match(probeBlock, /data\.configured\s*===\s*false/, "🔴 branch must read data.configured === false");
  assert.ok(!/resp\.status\s*===\s*400/.test(probeBlock), "ต้องไม่เดาสถานะจาก HTTP 400 อีกต่อไป");
  assert.ok(!/message:\s*''/.test(probeBlock) && !/message:\s*""/.test(probeBlock),
    "probe ต้องไม่ส่ง body { message:'' } อีกแล้ว");
});

// ───────────────────────────────────────────────
// 3. Function — probe is an early-return that does not disturb the real send path
// ───────────────────────────────────────────────

const FN_SRC = fs.readFileSync(path.resolve("functions/api/line-notify.js"), "utf8");

test("function keeps the real send path intact (empty-message 400 + api.line.me push)", () => {
  assert.match(FN_SRC, /body\.probe\s*===\s*true/, "must have a probe branch");
  assert.match(FN_SRC, /configured:\s*!!\(token\s*&&\s*userId\)/, "probe reports env presence");
  // real send path untouched
  assert.match(FN_SRC, /ข้อความว่าง/, "empty-message 400 must remain");
  assert.match(FN_SRC, /api\.line\.me\/v2\/bot\/message\/push/, "real LINE push must remain");
  assert.match(FN_SRC, /messages:\s*\[\{\s*type:\s*"text"/, "real send body must remain");
});
