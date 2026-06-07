// Phase 391 — ai-service-job-queue-line-hotfix (HIGH · service operation)
// Run: node --test tests/ai_service_queue_line_guard.test.js
//
// Why this exists:
//   AI/service-request flows created service_jobs but: (RC1) the AI chat widget showed
//   "งานเข้าคิวแล้ว 🎉" the instant it clicked save — before the real save resolved — so a
//   failed save looked successful ("ไม่เข้าคิว"); (RC3) service_request sent LINE without the
//   "queue" target (→ LINE_USER_ID, not the queue group); (RC4/RC5) ai_sales + saveServiceJob
//   fired the queue LINE notify fire-and-forget and swallowed the result, so a LINE failure
//   was silent. These guards lock the fixes:
//     - the widget waits for a real service-job:saved / service-job:save-failed signal,
//     - every AI/service path sends target "queue" and surfaces the result (disabled /
//       not-configured / send-error / fell-back-to-user) WITHOUT failing the job,
//     - the server reports usedFallback as a boolean (no secret leaked).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describeLineResult } from "../modules/line_notify.js";

const widget = fs.readFileSync(path.resolve("ai-chat-widget.js"), "utf8");
const sreq = fs.readFileSync(path.resolve("modules/service_request.js"), "utf8");
const aisales = fs.readFileSync(path.resolve("modules/ai_sales.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const lineFn = fs.readFileSync(path.resolve("functions/api/line-notify.js"), "utf8");
const lineMod = fs.readFileSync(path.resolve("modules/line_notify.js"), "utf8");

// ── describeLineResult (pure: distinguishes the failure modes, never fails the job) ──
test("describeLineResult: clean group send → null (no toast)", () => {
  assert.equal(describeLineResult({ ok: true }), null);
  assert.equal(describeLineResult({ ok: true, usedFallback: false }), null);
});

test("describeLineResult: ok but usedFallback → warns it went to the personal user", () => {
  const d = describeLineResult({ ok: true, usedFallback: true });
  assert.equal(d.type, "warning");
  assert.match(d.msg, /ผู้ใช้ส่วนตัว|LINE_GROUP_QUEUE/);
});

test("describeLineResult: disabled / not-configured / send-error are distinct, job still saved", () => {
  assert.match(describeLineResult({ ok: false, skipped: true, reason: "disabled" }).msg, /ปิดการแจ้งเตือน/);
  assert.match(describeLineResult({ ok: false, configured: false }).msg, /ยังไม่ตั้งค่า/);
  assert.match(describeLineResult({ ok: false, error: "HTTP 502" }).msg, /HTTP 502/);
  for (const r of [{ ok: false, skipped: true, reason: "disabled" }, { ok: false, configured: false }, { ok: false, error: "x" }]) {
    assert.match(describeLineResult(r).msg, /บันทึกงานแล้ว/, "must affirm the job was saved (LINE fail ≠ job fail)");
  }
});

test("describeLineResult: null-safe", () => {
  assert.equal(describeLineResult(null), null);
  assert.equal(describeLineResult(undefined), null);
});

// ── RC1: ai-chat-widget waits for a REAL save signal (no instant fake success) ──
test("ai-chat-widget waits for service-job save signal; no instant success after click", () => {
  assert.doesNotMatch(widget, /const ok = autoSubmit\(\);\s*if \(ok\) \{\s*pushMsg\("ai", "✅ บันทึกงานเรียบร้อย/,
    "old instant-success branch must be gone");
  assert.match(widget, /function waitForSaveResult\(/, "has a wait-for-result step");
  assert.match(widget, /addEventListener\("service-job:saved"/, "listens for saved");
  assert.match(widget, /addEventListener\("service-job:save-failed"/, "listens for save-failed");
  assert.match(widget, /ยังบันทึกงานไม่สำเร็จ/, "save-failed → fail message (not success)");
  assert.match(widget, /กรุณากดปุ่ม "บันทึก"[\s\S]*?\}, 8000\)/, "timeout → neutral verify message (not fake success)");
});

// ── RC3: service_request → target "queue" + result handled + dispatches save signals ──
test("service_request sends LINE target 'queue', handles result, signals saved/failed", () => {
  assert.match(sreq, /sendLineNotify\([\s\S]{0,220}"queue"/, "uses target queue");
  assert.match(sreq, /describeLineResult\(lr/, "handles LINE result");
  assert.match(sreq, /dispatchEvent\(new CustomEvent\("service-job:saved"/, "signals saved on POST ok");
  assert.match(sreq, /dispatchEvent\(new CustomEvent\("service-job:save-failed"/, "signals failed on error");
});

// ── RC4: ai_sales awaits + handles queue result (no silent swallow) ──
test("ai_sales awaits + handles LINE queue result (drops the .catch swallow)", () => {
  assert.match(aisales, /import \{ describeLineResult \} from "\.\/line_notify\.js"/, "imports the result helper");
  assert.match(aisales, /await ctx\.sendLineNotify\([\s\S]*?"queue"\)/, "awaits the queue send");
  assert.match(aisales, /describeLineResult\(lr/, "handles the result");
  assert.doesNotMatch(aisales, /sendLineNotify\([\s\S]*?"queue"\)\)\.catch\(\(\) => \{\}\)/, "old fire-and-forget swallow gone");
});

// ── RC5: main.saveServiceJob awaits queue + reports failure + signals save result ──
test("main.saveServiceJob awaits queue LINE, reports failure, signals save result both ways", () => {
  assert.match(mainJs, /const lr = await sendLineNotify\(msg, \{ state, showToast \}, "queue"\)/, "awaits queue send");
  assert.match(mainJs, /describeLineResult\(lr, \{ context: "LINE คิวงาน" \}\)/, "handles result");
  assert.match(mainJs, /CustomEvent\(ok \? "service-job:saved" : "service-job:save-failed"/, "central save signal");
  assert.match(mainJs, /_signalSave\(false, \{ reason:/, "signals failure (validation / !res.ok)");
  assert.match(mainJs, /_signalSave\(true, \{/, "signals success with detail");
});

// ── #5: server reports usedFallback as a boolean only (no secret leaked) ──
test("line-notify function exposes usedFallback boolean for queue/done; client surfaces it", () => {
  assert.match(lineFn, /usedFallback = !grp && !!userId/, "server computes fallback");
  assert.match(lineFn, /usedFallback,\s*\n\s*results/, "server returns usedFallback in response");
  assert.doesNotMatch(lineFn, /console\.[a-z]+\([^)]*LINE_CHANNEL_ACCESS_TOKEN/, "never logs the token");
  assert.match(lineMod, /usedFallback: !!\(result && result\.usedFallback\)/, "client surfaces usedFallback");
});

// ── scope guard: the touched AI/service/LINE files don't reach into money/stock/accounting/schema ──
test("touched AI/service/LINE files do not touch money/stock/accounting tables or DDL", () => {
  for (const [name, src] of [["service_request", sreq], ["ai_sales", aisales], ["line_notify", lineMod]]) {
    assert.doesNotMatch(src, /ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE/i, `${name}: no DDL`);
    assert.doesNotMatch(src, /journal_entries|journal_lines|warehouse_stock|staff_payroll/i, `${name}: no money/stock/accounting tables`);
  }
});
