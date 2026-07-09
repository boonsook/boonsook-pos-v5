// Phase 584 — settings navigate-settings listener bind-once
//
// Why: setupEventListeners() เพิ่ม document.addEventListener('navigate-settings', ...) ใหม่ทุกครั้ง
// ถูกเรียกทั้ง renderSettingsPage (:36) และ renderCurrentView (:105 — ทุก navigateToView/goBack) →
// listener ซ้อนสะสม ไม่เคยถอด → 1 event ยิง N handler → navigate ทวีคูณ. แก้: bind ครั้งเดียว (_navBound).
// Run: node --test tests/settings_nav_listener_once_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/settings/index.js"), "utf8");
function fnBody(decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const ends = ["\nfunction ", "\nexport ", "\nasync function "].map(s => src.indexOf(s, start + decl.length)).filter(i => i !== -1);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}
const body = fnBody("function setupEventListeners");

test("setupEventListeners: bind-once guard (_navBound) ครอบ addEventListener('navigate-settings')", () => {
  assert.match(src, /let _navBound = false;/, "ต้องมี flag _navBound module-level");
  assert.match(body, /if \(_navBound\) return;/, "guard: bound แล้ว → return (call ซ้ำ = no-op)");
  assert.match(body, /_navBound = true;/, "set true ก่อน addEventListener");
  assert.match(body, /addEventListener\('navigate-settings'/, "ยัง bind navigate-settings เดิม");
  // guard (return) ต้องอยู่ก่อน addEventListener (ไม่งั้น bind ซ้ำก่อน return)
  assert.ok(body.indexOf("if (_navBound) return;") < body.indexOf("addEventListener('navigate-settings'"),
    "guard ต้องมาก่อน addEventListener");
});

test("handler เดิมคงพฤติกรรม (goBack / navigateToView ตาม target)", () => {
  assert.match(body, /const target = e\.detail;/, "อ่าน target จาก e.detail เดิม");
  assert.match(body, /if \(target === 'main'\)\s*\{\s*goBack\(\);/, "main → goBack");
  assert.match(body, /navigateToView\(target\)/, "อื่น → navigateToView");
});
