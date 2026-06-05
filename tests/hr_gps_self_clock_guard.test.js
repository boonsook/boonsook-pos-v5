// Phase 377 hr-gps-self-clock-enforcement
// Run: node --test tests/hr_gps_self_clock_guard.test.js
//
// Why this exists:
//   "พนักงานกดลงเวลาเอง" (self clock) ต้องบังคับ GPS geofence: ถ้าร้านตั้ง geofence แล้ว
//   พนักงานต้องอนุญาต GPS และอยู่ในรัศมีจึงจะลงเวลาได้ (เดิม 92.24 แค่ warn ไม่ block).
//   Admin/manager path คงพฤติกรรม warn-only เดิม.
//   - Behavioral: _captureGpsForClock({enforce}) กับ navigator mock
//   - Source guard: self handlers ใช้ enforce:true (ก่อนเขียน), admin handlers ไม่ใช้

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { _captureGpsForClock, geofenceFromState } = await import("../modules/time_clock.js");
const SRC = fs.readFileSync(path.resolve("modules/time_clock.js"), "utf8");

// ── navigator.geolocation mock ──
//   mode "allow": success callback ด้วยพิกัดที่ให้; "deny": error callback → getCurrentPosition คืน null
function mockGeolocation(mode, coords) {
  global.navigator = {
    geolocation: {
      getCurrentPosition(success, error) {
        if (mode === "allow") success({ coords: { latitude: coords.lat, longitude: coords.lng, accuracy: 5 } });
        else error({ code: 1, message: "denied" });
      },
    },
  };
}
function clearGeolocation() { delete global.navigator; }

// ร้านพิกัดอ้างอิง + รัศมี 200m
const SHOP = { shopLat: 13.7563, shopLng: 100.5018, geofenceRadiusM: 200 };
function ctxWith(storeInfo) {
  const toasts = [];
  return { state: { storeInfo }, showToast: (m) => toasts.push(m), _toasts: toasts };
}
// พิกัดไกลออกไป ~1.5km (นอก 200m แน่นอน)
const FAR = { lat: 13.7700, lng: 100.5100 };

// ═══ Behavioral: enforce=true (self path) ═══

test("geofence NOT configured + enforce → returns {gps:null,geofence:null}, no GPS required", async () => {
  clearGeolocation(); // แม้ไม่มี navigator ก็ต้องไม่พัง/ไม่ throw
  const ctx = ctxWith({}); // ไม่มี shopLat/shopLng
  assert.equal(geofenceFromState(ctx.state), null, "precondition: geofence off");
  const r = await _captureGpsForClock(ctx, { enforce: true });
  assert.deepEqual(r, { gps: null, geofence: null });
});

test("geofence configured + GPS denied/null + enforce → throws GPS_REQUIRED", async () => {
  mockGeolocation("deny");
  const ctx = ctxWith({ ...SHOP });
  await assert.rejects(
    () => _captureGpsForClock(ctx, { enforce: true }),
    (e) => { assert.equal(e.code, "GPS_REQUIRED"); assert.match(e.message, /GPS/); return true; }
  );
  clearGeolocation();
});

test("geofence configured + outside radius + enforce → throws GEOFENCE_OUTSIDE with distance/radius", async () => {
  mockGeolocation("allow", FAR);
  const ctx = ctxWith({ ...SHOP });
  await assert.rejects(
    () => _captureGpsForClock(ctx, { enforce: true }),
    (e) => {
      assert.equal(e.code, "GEOFENCE_OUTSIDE");
      assert.ok(e.distance > 200, "distance beyond radius");
      assert.equal(e.radius, 200);
      assert.match(e.message, /นอกพื้นที่ร้าน/);
      return true;
    }
  );
  clearGeolocation();
});

test("geofence configured + inside radius + enforce → returns {gps,geofence}", async () => {
  mockGeolocation("allow", { lat: SHOP.shopLat, lng: SHOP.shopLng }); // distance 0
  const ctx = ctxWith({ ...SHOP });
  const r = await _captureGpsForClock(ctx, { enforce: true });
  assert.ok(r.gps && Number.isFinite(r.gps.lat) && Number.isFinite(r.gps.lng), "gps returned");
  assert.ok(r.geofence && r.geofence.radiusM === 200, "geofence returned");
  clearGeolocation();
});

// ═══ Behavioral: enforce=false (admin path = warn-only, never throws) ═══

test("admin (enforce=false) + GPS null → warn-only, returns {gps:null,geofence}, no throw", async () => {
  mockGeolocation("deny");
  const ctx = ctxWith({ ...SHOP });
  const r = await _captureGpsForClock(ctx, { enforce: false });
  assert.equal(r.gps, null);
  assert.ok(r.geofence, "geofence still returned");
  assert.ok(ctx._toasts.some(t => /ไม่มี GPS/.test(t)), "warn toast shown");
  clearGeolocation();
});

test("admin (enforce=false) + outside radius → warn-only, returns gps, no throw", async () => {
  mockGeolocation("allow", FAR);
  const ctx = ctxWith({ ...SHOP });
  const r = await _captureGpsForClock(ctx, { enforce: false });
  assert.ok(r.gps, "gps returned even though outside");
  assert.ok(ctx._toasts.some(t => /flag/.test(t)), "warn-but-saved toast shown");
  clearGeolocation();
});

// ═══ Source guard: self handlers enforce=true (before write); admin handlers warn-only ═══

const MARKERS = {
  adminIn:  'getElementById("tcClockInBtn")?.addEventListener',
  adminOut: 'querySelectorAll("[data-clock-out-id]")',
  selfIn:   'getElementById("tcSelfClockIn")?.addEventListener',
  selfOut:  'getElementById("tcSelfClockOut")?.addEventListener',
};
function handlerRegion(name) {
  const start = SRC.indexOf(MARKERS[name]);
  assert.ok(start > -1, `${name} handler must exist`);
  const laterStarts = Object.values(MARKERS).map(m => SRC.indexOf(m)).filter(i => i > start);
  const end = laterStarts.length ? Math.min(...laterStarts) : start + 1000;
  return SRC.slice(start, end);
}

test("self clock-in handler calls _captureGpsForClock with enforce:true", () => {
  assert.match(handlerRegion("selfIn"), /_captureGpsForClock\(ctx,\s*\{\s*enforce:\s*true\s*\}\)/);
});

test("self clock-out handler calls _captureGpsForClock with enforce:true", () => {
  assert.match(handlerRegion("selfOut"), /_captureGpsForClock\(ctx,\s*\{\s*enforce:\s*true\s*\}\)/);
});

test("self handlers enforce GPS BEFORE the write (block prevents insert/patch + enqueue)", () => {
  const inR = handlerRegion("selfIn");
  assert.ok(inR.indexOf("_captureGpsForClock") < inR.indexOf("_insertClockIn"), "capture before insert");
  const outR = handlerRegion("selfOut");
  assert.ok(outR.indexOf("_captureGpsForClock") < outR.indexOf("_patchClockOut"), "capture before patch");
});

test("self handlers surface GPS_REQUIRED / GEOFENCE_OUTSIDE via showToast (block message)", () => {
  for (const name of ["selfIn", "selfOut"]) {
    const r = handlerRegion(name);
    assert.match(r, /GPS_REQUIRED/, `${name} handles GPS_REQUIRED`);
    assert.match(r, /GEOFENCE_OUTSIDE/, `${name} handles GEOFENCE_OUTSIDE`);
    assert.match(r, /showToast/, `${name} uses showToast`);
  }
});

test("admin handlers stay warn-only (_captureGpsAndWarn, NOT enforce:true)", () => {
  for (const name of ["adminIn", "adminOut"]) {
    const r = handlerRegion(name);
    assert.match(r, /_captureGpsAndWarn\(ctx\)/, `${name} uses warn-only helper`);
    assert.doesNotMatch(r, /enforce:\s*true/, `${name} must NOT enforce`);
  }
});

test("no alert/confirm used (showToast only)", () => {
  assert.doesNotMatch(SRC, /\balert\s*\(/, "no alert()");
  assert.doesNotMatch(SRC, /\bconfirm\s*\(/, "no confirm()");
});
