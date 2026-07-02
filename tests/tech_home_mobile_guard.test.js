// Phase 550-mobile — tech_home responsive guard
// Run: node --test tests/tech_home_mobile_guard.test.js
//
// ยืนยันว่าหน้าหลักช่างมี breakpoint ≤640px ที่บังคับ single-column บนมือถือ (กันคำแตกทีละบรรทัด)
// และ layout grid ย้ายมาอยู่ใน CSS class (ไม่ใช่ inline 2-col ที่ไม่มี responsive).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve("style.css"), "utf8");
const js = fs.readFileSync(path.resolve("modules/tech_home.js"), "utf8");

test("style.css: มี breakpoint ≤640px บังคับ .tech-home-grid เป็น single-column", () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)/, "ต้องมี @media (max-width: 640px)");
  assert.match(css, /\.tech-home-grid\s*\{\s*grid-template-columns:\s*1fr\s*;?\s*\}/,
    "mobile ต้อง override .tech-home-grid → grid-template-columns: 1fr (single-column)");
});

test("style.css: .tech-home-grid มี base rule (desktop 2-col) เป็น class ไม่ใช่ inline", () => {
  assert.match(css, /\.tech-home-grid\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1\.5fr\s+1fr/,
    "desktop 2-col ต้องอยู่ใน CSS class .tech-home-grid");
});

test("tech_home.js: grid ใช้ class .tech-home-grid ไม่ hardcode 2-col inline (ไม่งั้นมือถือ override ไม่ได้)", () => {
  assert.match(js, /class="tech-home-grid"/, "ต้องใช้ class .tech-home-grid");
  assert.ok(!/grid-template-columns:\s*1\.5fr\s+1fr/.test(js),
    "ต้องไม่มี inline grid-template-columns:1.5fr 1fr ใน JS (ย้ายไป CSS แล้ว)");
});

test("mobile font tweaks ถูก scope ใต้ #page-tech_home (ไม่รั่วไปหน้าอื่นที่ใช้ .panel/.muted)", () => {
  // ทุก rule ที่แตะ .panel/.muted/.dash-today-amount ในบล็อก 640 ต้องนำด้วย #page-tech_home
  assert.match(css, /#page-tech_home\s+\.panel h3\s*\{[^}]*font-size/,
    ".panel h3 mobile tweak ต้อง scope #page-tech_home");
  assert.ok(!/\n\s*\.panel h3\s*\{\s*font-size:\s*16px/.test(css),
    "ห้ามมี .panel h3 mobile tweak แบบ global (ไม่ scope)");
});
