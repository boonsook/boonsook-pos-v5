import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

const helper = read("modules/service_drafts.js");
const main = read("main.js");
const serviceForm = read("modules/service_form.js");
const acInstall = read("modules/ac_install.js");
const solar = read("modules/solar.js");
const serviceRequest = read("modules/service_request.js");

test("service draft helper stores form fields under a scoped localStorage key", () => {
  assert.match(helper, /const PREFIX = "bsk_service_draft:"/);
  assert.match(helper, /export function loadServiceDraft/);
  assert.match(helper, /export function applyDraftFields/);
  assert.match(helper, /export function bindServiceDraft/);
  assert.match(helper, /export function clearServiceDraft/);
  assert.match(helper, /if \(extra === false\) return/);
});

test("main service job drawer restores new-job drafts and skips edit-job autosave", () => {
  assert.match(main, /loadServiceDraft\(SERVICE_JOB_DRAWER_DRAFT_KEY\)/);
  assert.match(main, /applyDraftFields\(document,\s*drawerDraft,\s*SERVICE_JOB_DRAWER_DRAFT_FIELDS\)/);
  assert.match(main, /bindServiceDraft\(drawer,\s*SERVICE_JOB_DRAWER_DRAFT_KEY,\s*SERVICE_JOB_DRAWER_DRAFT_FIELDS/);
  assert.match(main, /state\.editingServiceJobId \? false : \{ items: _serviceDrawerItems \}/);
  assert.match(main, /clearServiceDraft\(SERVICE_JOB_DRAWER_DRAFT_KEY\)/);
});

test("all technician form pages persist and restore mobile drafts", () => {
  for (const [name, src, keyPattern] of [
    ["service_form", serviceForm, /const draftKey = `service_form:\$\{serviceType\}`/],
    ["ac_install", acInstall, /const AC_DRAFT_KEY = "ac_install"/],
    ["solar", solar, /const SOLAR_DRAFT_KEY = "solar"/],
    ["service_request", serviceRequest, /const SERVICE_REQUEST_DRAFT_KEY = "service_request"/]
  ]) {
    assert.match(src, /service_drafts\.js/, `${name}: imports service_drafts`);
    assert.match(src, keyPattern, `${name}: has scoped draft key`);
    assert.match(src, /loadServiceDraft\(/, `${name}: loads draft`);
    assert.match(src, /applyDraftFields\(/, `${name}: restores fields after render`);
    assert.match(src, /bindServiceDraft\(/, `${name}: binds autosave`);
    assert.match(src, /clearServiceDraft\(/, `${name}: clears draft after successful save`);
  }
});

test("Phase 602: completion status in an old draft is normalized before it is applied to the form", () => {
  for (const [name, src] of [["service_form", serviceForm], ["ac_install", acInstall], ["solar", solar]]) {
    const applyIdx = src.indexOf("applyDraftFields(");
    assert.ok(applyIdx > 0, `${name}: has applyDraftFields`);
    assert.match(src.slice(0, applyIdx),
      /draft\.fields\.status = normalizeServiceIntakeCreateStatus\(draft\.fields\.status\)/,
      `${name}: normalizes draft.fields.status (done → pending_review) before applyDraftFields`);
  }
});

test("equipment line-item changes are included in technician drafts", () => {
  assert.match(serviceForm, /bindServiceDraft\(container,\s*draftKey[\s\S]*?\(\) => \(\{ items: st\.items \}\)/);
  assert.match(acInstall, /bindServiceDraft\(container,\s*AC_DRAFT_KEY[\s\S]*?\(\) => \(\{ items: _items \}\)/);
  assert.match(solar, /bindServiceDraft\(container,\s*SOLAR_DRAFT_KEY[\s\S]*?\(\) => \(\{ items: _solItems \}\)/);
  assert.match(serviceForm, /saveDraftNow\?\.\(\)/);
  assert.match(acInstall, /saveDraftNow\?\.\(\)/);
  assert.match(solar, /saveDraftNow\?\.\(\)/);
});
