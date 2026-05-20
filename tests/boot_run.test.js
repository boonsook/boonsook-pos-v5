import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runBoot } from "../modules/boot.js";

// supabaseOk / currentUser are scenario knobs so the recording wrappers stay
// intact (an override of initSupabase/getCurrentUser would otherwise erase the
// calls.push, hiding the very step the bail tests assert on). Any other dep can
// still be overridden directly via ...rest.
function makeDeps(overrides = {}) {
  const calls = [];
  const { supabaseOk = true, currentUser = { id: "u1" }, ...rest } = overrides;
  const deps = {
    initDarkMode:     () => calls.push("initDarkMode"),
    bindStaticEvents: () => calls.push("bindStaticEvents"),
    updateAppLogos:   () => calls.push("updateAppLogos"),
    initSupabase:     async () => { calls.push("initSupabase"); return supabaseOk; },
    afterLogin:       async () => { calls.push("afterLogin"); },
    syncLogo:         async () => { calls.push("syncLogo"); return null; },
    getCurrentUser:   () => currentUser,
    ...rest,
  };
  return { deps, calls };
}

test("runBoot: happy path runs all steps in order", async () => {
  const { deps, calls } = makeDeps();
  await runBoot(deps);
  await new Promise(r => setTimeout(r, 0)); // let syncLogo().then settle
  assert.deepEqual(calls.slice(0, 5), ["initDarkMode","bindStaticEvents","updateAppLogos","initSupabase","afterLogin"]);
  assert.ok(calls.includes("syncLogo"));
});

test("runBoot: bails after initSupabase returns false (no afterLogin)", async () => {
  const { deps, calls } = makeDeps({ supabaseOk: false });
  await runBoot(deps);
  assert.ok(calls.includes("initSupabase"));
  assert.ok(!calls.includes("afterLogin"), "afterLogin must NOT run when supabase init fails");
  assert.ok(!calls.includes("syncLogo"));
});

test("runBoot: bails when no current user (no afterLogin)", async () => {
  const { deps, calls } = makeDeps({ currentUser: null });
  await runBoot(deps);
  assert.ok(calls.includes("initSupabase"));
  assert.ok(!calls.includes("afterLogin"), "afterLogin must NOT run when no current user");
});

test("runBoot: pre-supabase steps always run (darkMode/events/logo) before init", async () => {
  const { deps, calls } = makeDeps({ supabaseOk: false });
  await runBoot(deps);
  assert.deepEqual(calls.slice(0, 3), ["initDarkMode","bindStaticEvents","updateAppLogos"]);
});

test("runBoot: repaints logo after background syncLogo resolves", async () => {
  let painted = 0;
  const { deps } = makeDeps({ updateAppLogos: () => { painted++; }, syncLogo: async () => "done" });
  await runBoot(deps);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(painted >= 2, "updateAppLogos ครั้งแรก (boot) + ครั้งสองหลัง syncLogo.then");
});

// ── Source-level pins ──
const __d = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__d, "..", "main.js"), "utf8");
const bootSrc = readFileSync(path.join(__d, "..", "modules", "boot.js"), "utf8");

test("Phase 92.10: boot.js exports runBoot", () => {
  assert.ok(/export\s+async\s+function\s+runBoot\s*\(/.test(bootSrc));
});
test("Phase 92.10: main.js imports runBoot + calls it", () => {
  assert.ok(/import\s*\{\s*runBoot\s*\}\s*from\s*["']\.\/modules\/boot\.js["']/.test(mainSrc));
  assert.ok(/runBoot\s*\(\s*\{/.test(mainSrc));
});
test("Phase 92.10: main.js is side-effect-free (no self-invoking boot IIFE)", () => {
  assert.ok(!/\(async\s+function\s+boot\s*\(\s*\)\s*\{/.test(mainSrc), "main.js must not contain the self-invoking boot IIFE");
});
test("Phase 92.10: boot.js does NOT import main.js (no circular)", () => {
  assert.ok(!/from\s+["']\.\.\/main\.js["']/.test(bootSrc) && !/from\s+["']\.\/main\.js["']/.test(bootSrc));
});
