// Phase 583 — receipts-range-full-fetch (ปิดกลุ่ม money-display)
//
// Why: หน้าใบเสร็จ (renderReceiptsPage) summary "ยอดรวม" + ค้นหา + Excel + tab counts ทำบน
// ctx.state.receipts cap 50 (loadAllData) → ใบเสร็จสะสม >50 = ยอดรวมขาด/ค้นใบเก่าไม่เจอ/Excel ไม่ครบ
// (เอกสารการเงินอ้างอิงบัญชี/ภาษี). แก้: fetchReceiptsSince ดึงใบเสร็จทั้งช่วงที่เลือกเต็มจาก DB
// (paginated) → search/tab/summary/Excel ทำบน set เต็ม. fallback state + ป้าย. READ-ONLY.
// Run: node --test tests/receipts_range_fetch_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchReceiptsSince, bufferedSince } from "../modules/range_fetch.js";

// ═══ (1) behavioral: fetchReceiptsSince (mock global fetch + window) ═══
function withMockFetch(impl, fn) {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  const calls = [];
  globalThis.window = { SUPABASE_CONFIG: { url: "https://x.test", anonKey: "anon" }, _sbAccessToken: "tok" };
  globalThis.fetch = async (url) => { calls.push(url); return impl(url); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = prevFetch; globalThis.window = prevWindow; });
}
function pagedImpl(pagesByOffset) {
  return (url) => {
    const m = /offset=(\d+)/.exec(url);
    const off = m ? Number(m[1]) : 0;
    return { ok: true, json: async () => (pagesByOffset[off] || []) };
  };
}

test("fetchReceiptsSince: paginates past 1000-row cap (loops offset จน page < 1000)", () =>
  withMockFetch(pagedImpl({
    0: Array.from({ length: 1000 }, (_, i) => ({ id: i, grand_total: 1 })),
    1000: Array.from({ length: 7 }, (_, i) => ({ id: 1000 + i, grand_total: 1 })),
  }), async (calls) => {
    const r = await fetchReceiptsSince("2026-06-18");
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1007, "ต้องต่อ 2 หน้า (ไม่หยุดที่ 1000)");
    assert.match(calls[0], /receipts\?select=\*&created_at=gte\.2026-06-16/, "2-day-buffered lower bound");
    assert.match(calls[0], /order=created_at\.desc/, "order created_at.desc");
    assert.ok(calls.length >= 2, "ต้องยิงหน้า 2");
  }));

test("fetchReceiptsSince: HTTP fail → {ok:false} (ไม่เงียบ)", () =>
  withMockFetch(() => ({ ok: false, status: 500, json: async () => null }), async () => {
    const r = await fetchReceiptsSince("2026-06-01");
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }));

test("fetchReceiptsSince(''): ไม่มี lower bound (ดึงทั้งหมด)", () =>
  withMockFetch(() => ({ ok: true, json: async () => [] }), async (calls) => {
    const r = await fetchReceiptsSince("");
    assert.equal(r.ok, true);
    assert.ok(!/created_at=gte/.test(calls[0]), "range=all ไม่มี date filter");
  }));

test("bufferedSince -2 วัน (TZ-safe superset)", () => {
  assert.equal(bufferedSince("2026-06-18"), "2026-06-16");
  assert.equal(bufferedSince(""), "");
});

// ═══ (2)-(4) source-regex receipts ═══
const rc = fs.readFileSync(path.resolve("modules/receipts.js"), "utf8");
function fnBody(decl) {
  const start = rc.indexOf(decl);
  assert.notEqual(start, -1, `ไม่พบ ${decl}`);
  const cands = ["\nexport function ", "\nfunction ", "\nasync function "]
    .map(m => rc.indexOf(m, start + decl.length)).filter(i => i !== -1);
  return rc.slice(start, cands.length ? Math.min(...cands) : undefined);
}
const renderBody = fnBody("export function renderReceiptsPage");
const loadBody = fnBody("async function _loadReceiptsRange");

test("import fetchReceiptsSince + module state (_rcAllRows/_rcState/_rcSeq/_rcKey)", () => {
  assert.match(rc, /import \{ fetchReceiptsSince \} from "\.\/range_fetch\.js"/);
  for (const v of ["_rcAllRows", "_rcState", "_rcSeq", "_rcKey"]) {
    assert.match(rc, new RegExp(`let ${v}\\b`), `ต้องประกาศ ${v}`);
  }
});

test("renderReceiptsPage: receipts = loaded rows else state fallback (summary/search/tab/Excel บน set เต็ม)", () => {
  assert.match(renderBody, /const _rcLoaded = _rcState === "loaded" && _rcAllRows && _rcKey === _rcDateRange/, "loaded flag ผูก range key");
  assert.match(renderBody, /const receipts = _rcLoaded \? _rcAllRows : \(ctx\.state\.receipts \|\| \[\]\)/, "source = loaded rows else state fallback");
  // scopedReceipts/counts/summary/filtered ทั้งหมดไหลจากตัวแปร receipts (ไม่ aggregate ตรงจาก ctx.state.receipts)
  assert.match(renderBody, /receipts\.filter\(r => _receiptMatchesSearchDate/, "date/search filter บน receipts (set เต็ม)");
  assert.match(renderBody, /_receiptFinancialTotal\(scopedReceipts\)/, "ยอดรวมจาก scopedReceipts (← set เต็ม)");
  // ต้องไม่ aggregate ตรงจาก ctx.state.receipts cap ใน renderReceiptsPage (นอกจาก fallback expr)
  assert.ok(!/ctx\.state\.receipts\s*\.\s*(filter|reduce|map)\(/.test(renderBody), "ห้าม aggregate ตรงจาก ctx.state.receipts cap");
});

test("cache keyed _rcDateRange (range เปลี่ยน→refetch; search/tab→ไม่ refetch) + idle/seq-guard", () => {
  assert.match(renderBody, /if \(_rcState === "idle" \|\| _rcKey !== _rcDateRange\) _loadReceiptsRange\(ctx\)/, "kick load เมื่อ idle หรือ range เปลี่ยน");
  assert.match(loadBody, /if \(_rcState !== "idle" && _rcKey === rangeKey\) return;/, "guard: range เดิม+ไม่ idle → ไม่ refetch (search/tab ไม่โหลดซ้ำ)");
  assert.match(loadBody, /const seq = \+\+_rcSeq/, "seq bump");
  assert.match(loadBody, /if \(seq !== _rcSeq\) return;/, "stale-guard");
  assert.match(loadBody, /await fetchReceiptsSince\(_rcCutoffKey\(\)\)/, "fetch ตาม cutoff ของ range");
  assert.match(loadBody, /_rcState = "error"/, "fail → error state (fallback+ป้ายที่ render)");
});

test("error → ป้าย ~50 ล่าสุด + ปุ่ม retry (reset idle); loaded → เงียบ", () => {
  assert.match(renderBody, /_rcLoaded \? "" :/, "loaded → ไม่มีป้าย");
  assert.match(renderBody, /~50 ใบล่าสุด/, "ไม่ loaded → ป้ายบอก ~50 ล่าสุด (ไม่หลอกว่าครบ)");
  assert.match(renderBody, /rcRetryBtn/, "error → ปุ่ม retry");
  assert.match(renderBody, /_rcState = "idle"; _rcKey = null;[\s\S]{0,60}renderReceiptsPage/, "retry reset idle+key → refetch");
});

// ═══ (5) mutation handlers (multi-pay/void/repost — Phase 574/575) ไม่ถูกแตะ ═══
test("mutation handlers ยังอ้าง _appXhrPatch/_multiPayGuard/_repostReceiptJvIfChanged เดิม (ไม่แตะ)", () => {
  assert.match(rc, /const _multiPayGuard = createInflightGuard\(\)/, "_multiPayGuard คงเดิม");
  assert.match(rc, /async function _repostReceiptJvIfChanged\(/, "_repostReceiptJvIfChanged คงเดิม");
  assert.ok((rc.match(/window\._appXhrPatch\?\./g) || []).length >= 8, "mutation PATCH handlers ยังครบ (Phase 574/575)");
});
