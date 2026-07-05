// Phase 563 — edit-drawer status dropdown shows "รออนุมัติ" for pending_review jobs
//
// Bug: openServiceJobDrawer restored the dropdown with `job.status` raw. A "รออนุมัติ" job is
// stored in the DB as status="pending" + note marker [รออนุมัติแอดมิน] (pending_review is a
// UI-pseudo status normalized away in Phase 383/545). So the dropdown showed "รอดำเนินการ"
// instead of "📨 รออนุมัติ". Fix: restore via isServiceJobPendingReview(job) → "pending_review".
// Display-only: save still normalizes pending_review → pending + keeps the marker (round-trip).
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isServiceJobPendingReview, normalizeServiceJobStatus, serviceJobNoteWithReviewMarker, REVIEW_NOTE_MARKER } from "../modules/service_status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const main = readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// ── behavioral: which jobs count as "รออนุมัติ" ──────────────────────────────
test('status="pending_review" (legacy row) → pending review', () => {
  assert.equal(isServiceJobPendingReview({ status: "pending_review" }), true);
});

test('status="pending" + note marker → pending review (post-normalize row)', () => {
  assert.equal(isServiceJobPendingReview({ status: "pending", note: `ลูกค้าโทร ${REVIEW_NOTE_MARKER}` }), true);
});

test('status="pending" without marker → NOT pending review', () => {
  assert.equal(isServiceJobPendingReview({ status: "pending", note: "งานปกติ" }), false);
});

test('status="progress" → NOT pending review (unchanged status guard)', () => {
  assert.equal(isServiceJobPendingReview({ status: "progress" }), false);
});

// ── round-trip: showing pending_review must NOT change what is saved ──────────
test("save normalizes pending_review → pending and preserves the marker (no DB status change)", () => {
  assert.equal(normalizeServiceJobStatus("pending_review"), "pending");
  const note = serviceJobNoteWithReviewMarker("ลูกค้าโทร", "pending_review");
  assert.ok(note.includes(REVIEW_NOTE_MARKER), "marker kept so the job stays 'รออนุมัติ'");
  // idempotent: re-saving does not duplicate the marker
  assert.equal(serviceJobNoteWithReviewMarker(note, "pending_review"), note);
});

// ── source: the drawer restore uses the helper, not the raw status ───────────
test("openServiceJobDrawer restores #serviceStatus via isServiceJobPendingReview(job)", () => {
  assert.match(
    main,
    /\$\("serviceStatus"\)\.value\s*=\s*isServiceJobPendingReview\(job\)\s*\?\s*"pending_review"\s*:\s*\(job\?\.status\s*\|\|\s*"pending"\)/,
    "restore must map a pending-review job to the 'pending_review' option",
  );
});

test("save still uses normalizeServiceJobStatus + serviceJobNoteWithReviewMarker (round-trip intact)", () => {
  assert.match(main, /status:\s*normalizeServiceJobStatus\(\$\("serviceStatus"\)\.value\)/, "save normalizes the dropdown value");
  assert.match(main, /note:\s*serviceJobNoteWithReviewMarker\(\$\("serviceNote"\)\.value\.trim\(\),\s*\$\("serviceStatus"\)\.value\)/, "save keeps the review marker");
});
