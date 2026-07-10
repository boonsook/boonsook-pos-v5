// Phase 399 — topbar notification bell + profile menu (display + navigation, read-only)
// Run: node --test tests/topbar_notif_profile.test.js
//
// Why this exists:
//   The topbar gained a 🔔 bell (badge = low-stock count) and a 👤 profile chip/menu
//   (settings / logout). It must: share ONE low-stock counter with the sidebar badge (no
//   number drift), escape the profile name (XSS), and stay read-only (no fetch / no write).
//   The existing search / refresh / page-title must remain.
//   ★ Phase 595: logout ต้องเรียก logout() หลักโดยตรง + App.confirm — เดิมเรียก
//     window.__authLogout?.() ที่ assign ใน initAuth() ของ auth.js (dead module ไม่เคยถูกเรียก)
//     = undefined เสมอ → ปุ่มตาย.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.resolve("index.html"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");

test("topbar-right has the bell + profile menu, and keeps search/refresh", () => {
  for (const id of ["notifBell", "notifBadge", "profileChip", "profileMenu", "profileName", "profileAvatar"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} present`);
  }
  assert.match(html, /data-act="settings"/, "settings menu item");
  assert.match(html, /data-act="logout"/, "logout menu item");
  assert.match(html, /id="refreshBtn"/, "refresh button kept");
  assert.match(html, /id="globalSearch"/, "global search kept");
});

test("low-stock count is a SINGLE source shared by sidebar badge + topbar bell", () => {
  assert.match(mainJs, /function _countLowStockItems\(/, "shared counter helper exists");
  const lowBadge = (mainJs.match(/function _updateLowStockBadge\([\s\S]*?\n\}/) || [""])[0];
  const bell = (mainJs.match(/function _updateNotifBell\([\s\S]*?\n\}/) || [""])[0];
  assert.match(lowBadge, /_countLowStockItems\(state\.products\)/, "sidebar badge uses the helper");
  assert.match(bell, /_countLowStockItems\(state\.products\)/, "topbar bell uses the SAME helper");
});

test("profile name escaped (XSS); logout calls main logout() (Phase 595); settings + bell navigate", () => {
  const chip = (mainJs.match(/function _updateProfileChip\([\s\S]*?\n\}/) || [""])[0];
  assert.match(chip, /escapeHtml\(name\)/, "profile name is escaped");
  // ★ Phase 595: logout เรียก logout() หลัก + App.confirm — เลิกพึ่ง __authLogout (dead module)
  const mStart = mainJs.indexOf('$("profileMenu")?.addEventListener("click"');
  assert.ok(mStart >= 0, "หา profileMenu click handler เจอ");
  const menu = mainJs.slice(mStart, mStart + 600);
  assert.ok(!/window\.__authLogout/.test(menu), "logout ต้องไม่เรียก window.__authLogout (dead module) แล้ว");
  assert.match(menu, /act === "logout"[\s\S]{0,300}App\.confirm[\s\S]{0,80}logout\(\)/, "logout → App.confirm แล้วเรียก logout()");
  assert.match(mainJs, /act === "settings"\) showRoute\("settings"\)/, "settings → showRoute('settings')");
  assert.match(mainJs, /notifBell"\)\?\.addEventListener\([\s\S]{0,70}showRoute\("products"\)/, "bell → showRoute('products')");
});

test("the new topbar helpers are read-only (no fetch / no supabase write)", () => {
  for (const name of ["_updateNotifBell", "_updateProfileChip", "_countLowStockItems"]) {
    const fn = (mainJs.match(new RegExp("function " + name + "\\([\\s\\S]*?\\n\\}")) || [""])[0];
    assert.ok(fn.length > 0, `${name} found`);
    assert.ok(!/\bfetch\s*\(/.test(fn), `${name}: no fetch`);
    assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(fn), `${name}: no supabase write`);
  }
});
