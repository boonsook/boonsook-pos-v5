// Phase 568 — Guard: drawer สร้างงานช่างใหม่ (saveServiceJob) ใช้ client_uuid + replay
//   ปิด insert gap ตัวสุดท้าย (reuse helper Phase 567). source-regex slice ด้วย anchor
//   (main.js monolith — เจาะ insert branch/openServiceJobDrawer/JV block; ระวังอย่าติด xhrPatch/edit path).
// Run: node --test tests/service_drawer_idempotency_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../main.js", import.meta.url), "utf8");

function slice(from, to) {
  const i = SRC.indexOf(from);
  assert.ok(i >= 0, `anchor เริ่มไม่พบ: ${from}`);
  const j = SRC.indexOf(to, i + from.length);
  assert.ok(j > i, `anchor จบไม่พบหลัง: ${from}`);
  return SRC.slice(i, j);
}

const drawerBody = slice("function openServiceJobDrawer(job=null){", "// ★ Phase 545 (SECURITY)");
const insertBranch = slice('payload.job_no = "JOB-" + Date.now();', "if (!res.ok) {");
const jvBlock = slice("if (_svcPlan.transitionedToRecognized || _svcPlan.newJobRecognized || _svcPlan.editRecognizedWithChange) {", "prepareAndPost().catch");

// ── import helper (reuse Phase 567) ──────────────────────────────────────────
test("import createInsertIntent + insertServiceJobWithReplay จาก _insert_idempotency.js", () => {
  assert.match(SRC, /import \{ createInsertIntent, insertServiceJobWithReplay \} from "\.\/modules\/_insert_idempotency\.js"/);
});

// ── 1. openServiceJobDrawer: gen key เฉพาะ job == null ────────────────────────
test("openServiceJobDrawer gen intent key เฉพาะเมื่อ job == null (สร้างงานใหม่)", () => {
  assert.match(drawerBody, /if \(!job\) _serviceDrawerInsertKey = createInsertIntent\(\)/);
});

// ── 2. insert branch: ผ่าน helper + fetchFn appAuthFetch + ไม่เหลือ xhrPost ────
test("saveServiceJob insert branch เรียก insertServiceJobWithReplay + fetchFn: appAuthFetch", () => {
  assert.match(insertBranch, /insertServiceJobWithReplay\(\{/);
  assert.match(insertBranch, /fetchFn: appAuthFetch/);
  assert.match(insertBranch, /key: _serviceDrawerInsertKey/);
  assert.match(insertBranch, /record: payload/);
});

test("insert branch: ไม่เหลือ raw xhrPost(\"service_jobs\") (edit path xhrPatch ไม่แตะ)", () => {
  assert.doesNotMatch(insertBranch, /xhrPost\("service_jobs"/);
  // adapter คงรูป res เดิม (downstream res.ok / res.data?.id)
  assert.match(insertBranch, /res = \{ ok: !!row, data: row, error:/);
  // edit path ยังใช้ xhrPatch (ทั้งไฟล์ต้องยังมี)
  assert.match(SRC, /xhrPatch\("service_jobs", payload, "id", state\.editingServiceJobId\)/);
});

// ── 3. reset key หลังสำเร็จ + replay toast ────────────────────────────────────
test("reset _serviceDrawerInsertKey = null หลัง insert สำเร็จ (จริง/replay)", () => {
  assert.match(insertBranch, /if \(res\.ok\) _serviceDrawerInsertKey = null/);
});

test("replayed → showToast กันบันทึกซ้ำ", () => {
  assert.match(insertBranch, /if \(replayed\) showToast\("ใบงานนี้บันทึกแล้ว \(กันบันทึกซ้ำ\)/);
});

// ── 4. JV block: ห้าม skip เมื่อ replay (คง invariant) ─────────────────────────
test("JV block ไม่ถูก gate ด้วยตัวแปร replayed (postJournalForServiceJob ยิงปกติ — idempotent by source_id)", () => {
  // trigger เดิม 3-way OR ต้องไม่มี replayed แทรก (replayed ปรากฏได้เฉพาะใน comment invariant)
  assert.ok(jvBlock.startsWith("if (_svcPlan.transitionedToRecognized || _svcPlan.newJobRecognized || _svcPlan.editRecognizedWithChange) {"),
    "JV trigger condition (recognition plan, Phase 606-b2) ต้องไม่เพิ่ม replayed gate");
  assert.doesNotMatch(jvBlock, /if\s*\(\s*!?\s*replayed/, "JV ต้องไม่ถูก gate ด้วย if(replayed)/if(!replayed)");
  assert.doesNotMatch(jvBlock, /replayed\s*[&|?]/, "JV ต้องไม่ใช้ replayed ใน boolean expression");
  assert.match(jvBlock, /const jobId = isNewJob \? res\.data\?\.id : state\.editingServiceJobId/);
  assert.match(jvBlock, /postJournalForServiceJob\(fullJob\)/);
  // invariant comment อธิบายว่าห้าม skip
  assert.match(jvBlock, /ห้าม skip JV เมื่อ replayed/);
});
