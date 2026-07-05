// Phase 563 — admin lands on dashboard (not tech_home) + "หน้าหลักช่าง" menu moved to "งานหลัก"
//
// Root cause: fresh-login default route was `allowed[0]`. admin's ROLE_PAGES = ALL_ROUTES and
// ALL_ROUTES[0] === "tech_home" (added first in Phase 549) → admin opened straight into the
// technician home. Fix: role-aware default (technician→tech_home, customer→customer_dashboard,
// everyone else→dashboard) + move the sidebar button out of the top "งานประจำวัน" group into
// "งานหลัก". Technician still lands on tech_home (owner: that is correct).
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const main = readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const html = readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// ── main.js: role-aware landing (not allowed[0]) ─────────────────────────────
test("fresh-login default is role-aware: technician→tech_home, customer→customer_dashboard, else dashboard", () => {
  assert.match(
    main,
    /_roleHome\s*=\s*\(currentRole\(\)\s*===\s*"technician"\)\s*\?\s*"tech_home"[\s\S]{0,120}"customer_dashboard"[\s\S]{0,40}:\s*"dashboard"/,
    "must map roles to their home page explicitly",
  );
});

test("restorePage prefers savedRoute, else the role home (NOT a raw allowed[0] for fresh login)", () => {
  assert.match(
    main,
    /restorePage\s*=\s*[\s\S]{0,80}\?\s*savedRoute\s*:\s*_defaultHome/,
    "restorePage must fall back to _defaultHome (role home), not allowed[0] directly",
  );
  assert.match(main, /_defaultHome\s*=\s*allowed\.includes\(_roleHome\)\s*\?\s*_roleHome\s*:/, "_defaultHome guards that the role home is actually allowed");
});

test("technician landing on tech_home is preserved (owner: correct)", () => {
  // ROLE_PAGES.technician still starts with tech_home AND _roleHome maps technician → tech_home
  assert.match(main, /technician:\s*\["tech_home"/, "technician ROLE_PAGES still starts with tech_home");
});

// ── index.html: menu button moved from "งานประจำวัน" (top) into "งานหลัก" ──────
test('the "หน้าหลักช่าง" (tech_home) button lives under "งานหลัก", not at the top of "งานประจำวัน"', () => {
  const posDaily = html.indexOf(">งานประจำวัน<");
  const posMain = html.indexOf(">งานหลัก<");
  const posTech = html.indexOf('data-route="tech_home"');
  const posDash = html.indexOf('data-route="dashboard"');
  assert.ok(posDaily > 0 && posMain > posDaily, "sidebar has งานประจำวัน then งานหลัก");
  assert.ok(posTech > posMain, "tech_home button must sit AFTER the งานหลัก label (moved out of the top)");
  assert.ok(posDash > posDaily && posDash < posMain, "dashboard stays the first item under งานประจำวัน");
  assert.ok(posDash < posTech, "admin sees ภาพรวมบริษัท before หน้าหลักช่าง in the sidebar");
});

test("tech_home nav button still exists (moved, not deleted)", () => {
  assert.match(html, /data-route="tech_home">🧰 หน้าหลักช่าง<\/button>/, "the button must still be present");
});
