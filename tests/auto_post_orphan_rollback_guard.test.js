// Phase 522 (audit #1) — auto_post JV orphan rollback hardening
// Run: node --test tests/auto_post_orphan_rollback_guard.test.js
//
// Why: auto_post._postJournal rolls back the JV header when lines-insert fails. The old code
// checked only `delResp.ok` — but a DELETE blocked by RLS returns 2xx + 0 rows = false-positive
// "rollback OK" while the orphan header persists. unique(source_table,source_id) then blocks any
// repost → that sale's JV is lost (revenue undercount; if credit used → 2180 ledger≠GL mismatch).
// Fix mirrors journal_form (Phase 509): Prefer return=representation + count deleted rows (===1),
// and never swallow an incomplete rollback (accounting §4.8).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve("modules/accounting/auto_post.js"), "utf8");

// extract the lines-insert catch (rollback) block of _postJournal
function rollbackBlock() {
  const i = src.indexOf("[auto_post] lines insert failed");
  assert.ok(i >= 0, "rollback block must exist");
  const j = src.indexOf("reason: \"lines-insert-failed\"", i);
  assert.ok(j > i, "rollback block end (return) must exist");
  return src.slice(i, j + 60);
}
const rb = rollbackBlock();

test("rollback DELETE requests the deleted rows (Prefer: return=representation)", () => {
  assert.match(rb, /method:\s*"DELETE"[\s\S]*?Prefer["']?\s*:\s*["']return=representation/, "DELETE must ask for representation to count real deletes");
});

test("rollback counts deleted rows — success only when exactly 1 row deleted (not just .ok)", () => {
  assert.match(rb, /const rollbackCount = Array\.isArray\(deleted\) \? deleted\.length : 0/, "must count deleted rows");
  assert.match(rb, /if \(delResp\.ok && rollbackCount === 1\)/, "rollback OK only when ok AND exactly 1 row deleted");
  // must NOT treat bare delResp.ok as success
  assert.ok(!/if \(delResp\.ok\)\s*\{\s*\n?\s*console\.info\("\[auto_post\] rollback OK/.test(rb), "must not accept bare delResp.ok as rollback success");
});

test("incomplete rollback (orphan) is reported, never swallowed (§4.8)", () => {
  assert.match(rb, /rollback INCOMPLETE — orphan JV/, "orphan must be logged");
  assert.match(rb, /_errorReporter\?\.captureMessage\?\.\("auto_post orphan JV \(rollback failed\)"/, "orphan must be reported to the error reporter");
  // exception path also reports
  assert.match(rb, /auto_post orphan JV \(rollback exception\)/, "rollback exception must also be reported");
});

test("orphan message is credit-aware (Dr 2180 in lines → flag ledger↔GL reconcile)", () => {
  assert.match(rb, /_usedCredit = Array\.isArray\(lines\) && lines\.some\(l => l\.account_code === "2180" && Number\(l\.debit \|\| 0\) > 0\)/, "detect credit via Dr 2180 line");
  assert.match(rb, /ใช้เครดิต 2180 \(ledger −cu แต่งบไม่ลง\)/, "credit sale orphan → reconcile warning");
});

test("return shape of postJournalForSale path unchanged (caller pos.js depends on it)", () => {
  assert.match(rb, /status:\s*"failed",\s*reason:\s*"lines-insert-failed"/, "must still return failed/lines-insert-failed (no shape change)");
});
