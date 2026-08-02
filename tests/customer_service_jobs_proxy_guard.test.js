// Phase 606-b2c — guard: customer service-jobs proxy (server side).
//
// ทำไมต้องมี: customer role ถูก RLS deny SELECT/UPDATE บน service_jobs (Phase 505 GROUP B) →
// การอ่าน/ปิดงานของลูกค้าต้องผ่าน service-role proxy ที่ derive identity จาก verified JWT เท่านั้น.
// ถ้า identity หลุดไปรับจาก request, ownership filter หาย, หรือ CAS ผูกไม่ครบ → ลูกค้า A ปิดงาน/
// เห็นงานของ B ได้. guard นี้ล็อก contract ที่ source (regex บน block จริง ไม่ grep ทั้งไฟล์ลอย ๆ).
//
// ครอบ: identity/auth · service-role required (ไม่ fallback anon) · response allowlist ·
//       ownership exact-match (ห้าม loose normalization) · visibility filters ·
//       flow/status allowlist (v2 done ต้องถูกปฏิเสธ) · CAS 4 predicate + affected rows = 1 ·
//       note byte-exact (PATCH status อย่างเดียว) · middleware wiring + rate limit ·
//       SW /api/* network-only privacy fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isVisibleJob as isVisibleJobFn, isValidJobId, ownsJob as ownsJobFn, onRequestPost }
  from "../functions/api/v1/customer-service-jobs.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const FN = rd("functions/api/v1/customer-service-jobs.js");
const MW = rd("functions/_middleware.js");
const SW = rd("sw.js");

const ENDPOINT = "/api/v1/customer-service-jobs";

// ── block extractors (ห้าม assert บนไฟล์ทั้งก้อน = false positive ง่าย) ─────────────
// body เริ่มที่ "{" หลังปิดวงเล็บ parameter list — ไม่ใช่ "{" ตัวแรก (destructuring param
// เช่น onRequestGet({ env, data }) จะทำให้ตัดได้แค่ "{ env, data }" = guard หลอกตา)
function fnBody(name) {
  const start = FN.indexOf(`function ${name}(`);
  assert.ok(start > 0, `ไม่พบ function ${name} ใน customer-service-jobs.js`);
  const parenAt = FN.indexOf("(", start);
  let pDepth = 0, afterParams = -1;
  for (let i = parenAt; i < FN.length; i++) {
    if (FN[i] === "(") pDepth++;
    else if (FN[i] === ")") { pDepth--; if (pDepth === 0) { afterParams = i + 1; break; } }
  }
  assert.ok(afterParams > 0, `ปิด parameter list ของ ${name} ไม่เจอ`);
  const from = FN.indexOf("{", afterParams);
  let depth = 0;
  for (let i = from; i < FN.length; i++) {
    if (FN[i] === "{") depth++;
    else if (FN[i] === "}") { depth--; if (depth === 0) return FN.slice(from, i + 1); }
  }
  assert.fail(`ปิด block ของ ${name} ไม่เจอ`);
}

// absence-check ต้องดูเฉพาะ "โค้ดจริง" — คอมเมนต์อธิบายเหตุผลไม่ใช่การละเมิด contract.
// ตัดเฉพาะ // (ไม่แตะ /* */ เพื่อไม่ให้ pattern แบบ "image/*" ในสตริงกลืนโค้ดจริงหาย)
function stripComments(src) {
  return src.replace(/([^:"'`\\])\/\/.*$/gm, "$1").replace(/^[ \t]*\/\/.*$/gm, "");
}
const FN_CODE = stripComments(FN);
const GET = fnBody("onRequestGet");
const POST = fnBody("onRequestPost");
const GET_CODE = stripComments(GET);
const POST_CODE = stripComments(POST);
const IDENT = fnBody("customerIdentity");
const OWNS = fnBody("ownsJob");
const VISIBLE = fnBody("isVisibleJob");
const SVC_AUTH = fnBody("getServiceAuth");

// sw.js fetch handler เท่านั้น (ไม่รวม comment/version log ด้านบนไฟล์)
const SW_FETCH = (() => {
  const start = SW.indexOf("self.addEventListener('fetch'");
  assert.ok(start > 0, "ไม่พบ fetch handler ใน sw.js");
  return SW.slice(start);
})();

// ═══ G1–G8 · identity & auth ═══════════════════════════════════════════════════════

test("G1: identity มาจาก middleware (data.user) เท่านั้น — ไม่อ่านจาก body/query", () => {
  assert.match(IDENT, /data\?\.user\?\.email/, "ต้อง derive email จาก data.user");
  assert.match(IDENT, /data\?\.user\?\.id/, "ต้อง derive user id จาก data.user");
  // ห้ามอ่าน identity fields จาก request/url ที่ client คุมได้
  for (const field of ["phone", "customer_id", "created_by", "user_id", "finance_flow_version", "role"]) {
    const bad = new RegExp(`(body|searchParams|query|headers)[^\\n]{0,40}${field}`, "i");
    assert.doesNotMatch(GET_CODE, bad, `GET ห้ามอ่าน ${field} จาก client`);
    assert.doesNotMatch(POST_CODE, bad, `POST ห้ามอ่าน ${field} จาก client`);
  }
});

test("G2: POST อ่านจาก body เฉพาะ job_id", () => {
  const reads = [...POST.matchAll(/body\?\.([a-zA-Z_][\w]*)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(reads)], ["job_id"], `POST อ่าน body field เกิน job_id: ${reads.join(",")}`);
});

test("G3: ning agent + non-customer email + user id เพี้ยน = fail closed 403", () => {
  assert.match(IDENT, /authMode === "ning_agent"[\s\S]{0,120}403/, "ning agent ต้อง 403");
  assert.match(IDENT, /phoneFromEmail[\s\S]{0,160}403/, "email ที่ไม่ใช่ customer format ต้อง 403");
  assert.match(IDENT, /UUID_RE\.test\(userId\)[\s\S]{0,120}403/, "user id ที่ไม่ใช่ UUID ต้อง 403");
  assert.match(FN, /const UUID_RE = \/\^\[0-9a-f\]\{8\}-/, "ต้อง validate UUID format จริง");
});

test("G4: customer email format = <digits>@phone.boonsook.local เท่านั้น", () => {
  const body = fnBody("phoneFromEmail");
  assert.match(body, /endsWith\(CUSTOMER_EMAIL_SUFFIX\)/);
  assert.match(body, /\/\^\[0-9\]\{6,15\}\$\/\.test\(phone\)/, "phone ต้องเป็นตัวเลขล้วน");
  assert.match(FN, /CUSTOMER_EMAIL_SUFFIX = "@phone\.boonsook\.local"/);
});

test("G5: SUPABASE_SERVICE_ROLE_KEY required — ห้าม fallback anon/publishable", () => {
  assert.match(SVC_AUTH, /if \(!serviceRoleKey\)[\s\S]{0,200}status: 500/, "ไม่มี service key ต้อง fail closed");
  assert.doesNotMatch(FN, /anonKey|ANON_KEY|publishable/i, "ห้ามมี anon/publishable key fallback");
});

test("G6: ทั้ง GET และ POST เช็ค identity ก่อนแตะ service role", () => {
  for (const [name, block] of [["GET", GET], ["POST", POST]]) {
    const identAt = block.indexOf("customerIdentity(data)");
    const authAt = block.indexOf("getServiceAuth(env)");
    assert.ok(identAt > 0 && authAt > identAt, `${name}: ต้องเช็ค identity ก่อน getServiceAuth`);
  }
});

test("G7: error ที่ตอบ client ถูก sanitize — ไม่มี raw DB response", () => {
  assert.match(FN, /import \{ logServerError, clientError \} from "\.\.\/_error_sanitizer\.js"/);
  const rawLeak = /return jsonResponse\([^)]*\b(text|rr\.text|pr\.text|e\?\.stack|e\.message)\b/;
  assert.doesNotMatch(FN, rawLeak, "ห้ามส่ง raw error/stack กลับ client");
  // ทุก error path ที่มาจาก Supabase ต้อง log ฝั่ง server
  assert.ok((FN.match(/logServerError\(/g) || []).length >= 5, "ต้อง log ฝั่ง server ทุก failure path");
});

test("G8: response มี Cache-Control private,no-store + Vary Authorization (defense-in-depth)", () => {
  const jr = fnBody("jsonResponse");
  assert.match(jr, /"Cache-Control": "private, no-store"/);
  assert.match(jr, /"Vary": "Authorization"/);
});

// ═══ G9–G15 · visibility (GET) ════════════════════════════════════════════════════

test("G9: ownership = exact equality (phone หรือ created_by) — ห้าม loose normalization", () => {
  assert.match(OWNS, /row\?\.customer_phone === ident\.phone/, "phone ต้อง exact equality");
  assert.match(OWNS, /String\(row\?\.created_by \|\| ""\) === ident\.userId/, "created_by ต้อง exact equality");
  // ห้ามทำ normalization ที่อาจผูกงานผิดคน (ตรวจเฉพาะโค้ดจริง ไม่นับคอมเมนต์อธิบายเหตุผล)
  assert.doesNotMatch(FN_CODE, /replace\([^)]*\\D/, "ห้ามลบ non-digit เพื่อเทียบ phone");
  assert.doesNotMatch(FN_CODE, /["'`]\+?66["'`]|66["'`]\s*,\s*["'`]0/, "ห้ามแปลง +66 → 0");
  assert.doesNotMatch(OWNS, /includes\(|endsWith\(|startsWith\(|slice\(/, "ห้าม contains/suffix matching");
});

test("G10: GET query ผูก ownership filter ทั้งสองทาง", () => {
  const of = fnBody("ownershipFilter");
  assert.match(of, /customer_phone\.eq\.\$\{encodeURIComponent\(ident\.phone\)\}/);
  assert.match(of, /created_by\.eq\.\$\{encodeURIComponent\(ident\.userId\)\}/);
  assert.match(of, /return `or=\(/, "ต้องเป็น PostgREST or-filter");
  assert.match(GET, /ownershipFilter\(ident\)/, "GET ต้องใช้ ownership filter");
});

test("G11: GET re-check ownership ทุก row หลัง response (ไม่เชื่อ filter ชั้นเดียว)", () => {
  assert.match(GET, /r\.rows\.filter\(\(row\) => ownsJob\(row, ident\)\)/, "ต้อง post-fetch ownership recheck");
  const filterAt = GET.indexOf("ownsJob(row, ident)");
  const mapAt = GET.indexOf("map(toClientJob)");
  assert.ok(filterAt > 0 && mapAt > filterAt, "recheck ต้องเกิดก่อน map ออก response");
});

test("G12: visibility filters ย้ายมา server แบบ exact (mirror ของเดิมใน customer_dashboard)", () => {
  assert.match(VISIBLE, /\(row\?\.sub_service \|\| ""\)\.includes\("สั่งซื้อ"\)/, "ต้องกรองรายการสั่งซื้อ");
  assert.match(VISIBLE, /\/\^SH-\(transfer\|cod_cash\|cod_transfer\)\\\|\/\.test\(note\)/, "ต้องกรอง SH transfer/COD pseudo-job");
  assert.match(VISIBLE, /note\.includes\("\[ลบแล้ว\]"\)/, "ต้องกรอง [ลบแล้ว]");
  assert.match(VISIBLE, /String\(row\?\.status \|\| ""\)\.toLowerCase\(\) === "cancelled"/, "ต้องกรอง cancelled");
});

test("G13: response allowlist — ไม่มี note / customer identity / created_by", () => {
  const list = FN.slice(FN.indexOf("const JOB_FIELDS = ["), FN.indexOf("];", FN.indexOf("const JOB_FIELDS = [")));
  for (const f of ["id", "job_no", "job_type", "sub_service", "description", "status", "total_cost", "created_at", "finance_flow_version"]) {
    assert.ok(list.includes(`"${f}"`), `allowlist ต้องมี ${f}`);
  }
  for (const bad of ["note", "customer_phone", "customer_name", "customer_address", "created_by"]) {
    assert.ok(!list.includes(`"${bad}"`), `allowlist ห้ามมี ${bad}`);
  }
  const tc = fnBody("toClientJob");
  assert.match(tc, /for \(const k of JOB_FIELDS\)/, "ต้อง project ผ่าน allowlist เท่านั้น");
  assert.doesNotMatch(tc, /\.\.\.row|Object\.assign\(/, "ห้าม spread ทั้ง row ออก client");
});

test("G14: server อ่าน note ได้เพื่อ filter แต่ไม่คืนออก client", () => {
  assert.match(FN, /SELECT_COLS = \[\.\.\.JOB_FIELDS, "note", "customer_phone", "created_by"\]/);
  assert.doesNotMatch(GET, /note:/, "GET ห้ามใส่ note ลง response object");
});

test("G15: GET มี bounded limit + แจ้ง truncation ชัด", () => {
  assert.match(FN, /JOB_LIMIT = 100/, "ต้องมี limit ที่ระบุชัด");
  assert.match(GET, /limit=\$\{JOB_LIMIT \+ 1\}/, "ต้องขอเกิน 1 แถวเพื่อรู้ว่ามี truncation");
  assert.match(GET, /has_more: hasMore, truncated: hasMore/, "ต้องแจ้ง client เมื่อข้อมูลไม่ครบ");
});

// ═══ G16–G23 · confirmation (POST CAS) ════════════════════════════════════════════

test("G16: transition allowlist — v1 done/delivered, v2 delivered เท่านั้น", () => {
  assert.match(FN, /CONFIRM_ALLOWLIST = \{ 1: \["done", "delivered"\], 2: \["delivered"\] \}/,
    "allowlist ต้องเป็น v1=[done,delivered] v2=[delivered] เป๊ะ");
  assert.match(FN, /TARGET_STATUS = "closed"/);
});

test("G17: v2 done ถูกปฏิเสธ (allowlist ไม่มี done ภายใต้ flow 2)", () => {
  const m = FN.match(/CONFIRM_ALLOWLIST = \{([^}]*)\}/);
  assert.ok(m, "อ่าน allowlist ไม่ได้");
  const v2 = m[1].match(/2:\s*\[([^\]]*)\]/);
  assert.ok(v2, "ไม่พบ flow 2 ใน allowlist");
  assert.ok(!v2[1].includes("done"), "flow 2 ห้ามอนุญาต done → closed (ข้าม recognition event)");
});

test("G18: flow/status อ่านจาก DB row ที่ fresh-read ไม่ใช่จาก client", () => {
  assert.match(POST, /const flowRaw = row\.finance_flow_version/, "flow ต้องมาจาก row");
  assert.match(POST, /const status = String\(row\.status \|\| ""\)/, "status ต้องมาจาก row");
  const readAt = POST.indexOf("sbFetch(readUrl");
  const flowAt = POST.indexOf("row.finance_flow_version");
  assert.ok(readAt > 0 && flowAt > readAt, "ต้อง fresh-read ก่อนตัดสิน");
});

test("G19: flow parser fail-closed — null/0/3/junk = block", () => {
  assert.match(POST, /\(flowRaw === 1 \|\| flowRaw === 2\) \? flowRaw/, "รับเฉพาะ number 1/2");
  assert.match(POST, /\/\^\[12\]\$\/\.test\(flowRaw\.trim\(\)\)/, "รับ trimmed string 1/2");
  assert.match(POST, /: null;/, "อย่างอื่น = null");
  assert.match(POST, /flow != null && \(CONFIRM_ALLOWLIST\[flow\] \|\| \[\]\)\.includes\(status\)/,
    "unknown flow ต้องไม่ผ่าน allowlist");
});

test("G20: CAS ผูกครบ 4 — id + status เดิม + flow เดิม + ownership", () => {
  const cas = POST.slice(POST.indexOf("const casUrl"), POST.indexOf("const pr = await sbFetch"));
  assert.match(cas, /id=eq\.\$\{encodeURIComponent\(jobId\)\}/, "CAS ต้องผูก id");
  assert.match(cas, /status=eq\.\$\{encodeURIComponent\(status\)\}/, "CAS ต้องผูก status เดิม");
  assert.match(cas, /finance_flow_version=eq\.\$\{encodeURIComponent\(String\(flow\)\)\}/, "CAS ต้องผูก flow เดิม");
  assert.match(cas, /ownershipFilter\(ident\)/, "CAS ต้องผูก ownership predicate");
});

test("G21: PATCH payload = status อย่างเดียว — note ต้อง byte-exact", () => {
  assert.match(FN, /PATCH_FIELDS = \["status"\]/, "PATCH_FIELDS ต้องมีแค่ status");
  const patch = POST.match(/body: JSON\.stringify\(\{([^}]*)\}\)/);
  assert.ok(patch, "ไม่พบ PATCH body");
  assert.doesNotMatch(patch[1], /note/, "PATCH ห้ามส่ง note (ทับ STOCK_DEDUCTED_MARKER/SH marker/staff note)");
  assert.doesNotMatch(FN_CODE, /ลูกค้ายืนยันปิดงาน/, "ห้ามมี note stamp ในเฟสนี้");
  assert.doesNotMatch(POST_CODE, /note:/, "POST ห้าม mutate note");
});

test("G22: affected rows ต้องเท่ากับ 1 — 0 rows = 409 (stale/duplicate)", () => {
  assert.match(POST, /if \(pr\.rows\.length !== 1\)[\s\S]{0,200}409/, "rows != 1 ต้องตอบ 409");
  assert.match(POST, /Prefer: "return=representation"/, "ต้องขอ representation เพื่อวัด affected rows");
});

test("G23: ownership mismatch, row หาย และ hidden row ตอบ 404 เหมือนกัน (กัน existence probe)", () => {
  assert.match(POST, /if \(!row \|\| !ownsJob\(row, ident\) \|\| !isVisibleJob\(row\)\)[\s\S]{0,200}404/,
    "row missing / cross-customer / hidden ต้องตอบเหมือนกันหมด");
  assert.match(POST, /not_confirmable[\s\S]{0,120}409/, "flow/status ที่ยืนยันไม่ได้ = 409 (client refetch)");
});

// ═══ G33–G36 · POST visibility contract (blocking fix จาก cross-team audit) ═══════

test("G33: POST ตรวจ isVisibleJob เหมือน GET — ไม่ให้ปิดแถวที่ UI ซ่อนไว้", () => {
  assert.match(POST, /!isVisibleJob\(row\)/,
    "POST ต้องกรอง visibility ด้วย (ownership อย่างเดียวไม่พอ: แถวสั่งซื้อ/SH/[ลบแล้ว]/cancelled เป็นของลูกค้าคนนั้นจริง)");
  // ต้องเป็น helper ตัวเดียวกับ GET (ห้าม fork logic) — เช็คบนบรรทัด gate จริง
  const gateLine = POST.split("\n").find((l) => l.includes("!row") && l.includes("isVisibleJob"));
  assert.ok(gateLine, "gate เดียวกันต้องรวม !row + ownership + visibility ไว้บรรทัดเดียว");
  assert.ok(gateLine.includes("ownsJob(row, ident)") && gateLine.includes("isVisibleJob(row)"),
    "ต้อง reuse ownsJob/isVisibleJob ตัวเดียวกับ GET");
  assert.ok(GET.includes("isVisibleJob"), "GET ต้องใช้ helper ตัวเดียวกัน");
});

test("G34: visibility gate อยู่ก่อน flow/status และก่อน PATCH เสมอ", () => {
  const visAt = POST.indexOf("!isVisibleJob(row)");
  const flowAt = POST.indexOf("const flowRaw");
  const casAt = POST.indexOf("const casUrl");
  const patchAt = POST.indexOf('method: "PATCH"');
  assert.ok(visAt > 0, "ไม่พบ visibility gate");
  for (const [name, at] of [["flow/status", flowAt], ["CAS url", casAt], ["PATCH", patchAt]]) {
    assert.ok(at > visAt, `visibility gate ต้องอยู่ก่อน ${name} (ห้ามยิง PATCH ก่อนกรอง)`);
  }
  // ระหว่าง gate กับ PATCH ต้องมี return 404 จริง (ไม่ใช่ log เฉย ๆ)
  const gateBlock = POST.slice(visAt, visAt + 220);
  assert.match(gateBlock, /return jsonResponse\(clientError\("not_found"[\s\S]{0,80}404\)/,
    "hidden row ต้อง return 404 ทันที ไม่มี PATCH ถูกส่ง");
});

test("G35: isVisibleJob ปฏิเสธครบทั้ง 4 กรณี (behavior จริง ไม่ใช่ regex)", () => {
  const base = { sub_service: "ล้างแอร์", note: "", status: "delivered" };
  assert.equal(isVisibleJobFn(base), true, "งานบริการปกติต้องมองเห็น");
  assert.equal(isVisibleJobFn({ ...base, sub_service: "สั่งซื้อสินค้า" }), false, "รายการสั่งซื้อต้องถูกซ่อน");
  for (const m of ["SH-transfer|x", "SH-cod_cash|x", "SH-cod_transfer|x"]) {
    assert.equal(isVisibleJobFn({ ...base, note: m }), false, `SH pseudo-job (${m}) ต้องถูกซ่อน`);
  }
  assert.equal(isVisibleJobFn({ ...base, note: "งานเสร็จ [ลบแล้ว]" }), false, "[ลบแล้ว] ต้องถูกซ่อน");
  assert.equal(isVisibleJobFn({ ...base, status: "cancelled" }), false, "cancelled ต้องถูกซ่อน");
  assert.equal(isVisibleJobFn({ ...base, status: "CANCELLED" }), false, "cancelled ต้องเทียบแบบ case-insensitive");
});

test("G36: hidden row ที่ ownership ผ่าน ยังต้องถูกปฏิเสธ (ownership ≠ ใบอนุญาตปิดงาน)", () => {
  const ident = { phone: "0812345678", userId: "11111111-1111-1111-1111-111111111111" };
  const hidden = [
    { customer_phone: "0812345678", sub_service: "สั่งซื้อสินค้า", note: "", status: "delivered" },
    { customer_phone: "0812345678", sub_service: "ล้างแอร์", note: "SH-cod_cash|abc", status: "done" },
    { created_by: ident.userId, sub_service: "ล้างแอร์", note: "[ลบแล้ว]", status: "delivered" },
    { created_by: ident.userId, sub_service: "ล้างแอร์", note: "", status: "cancelled" },
  ];
  for (const row of hidden) {
    assert.equal(ownsJobFn(row, ident), true, "fixture ต้องเป็นของลูกค้าคนนี้จริง (ไม่งั้นไม่ได้ทดสอบช่องนี้)");
    assert.equal(isVisibleJobFn(row), false, "แต่ต้องถูก visibility gate ปฏิเสธ");
  }
});

// ═══ G37 · job_id BIGINT contract ═════════════════════════════════════════════════

test("G37: job_id = canonical positive BIGINT (string) — ไม่มี coercion ใด ๆ", () => {
  assert.match(FN, /const BIGINT_MAX = 9223372036854775807n/, "ต้องมีขอบบน signed BIGINT");
  assert.match(FN, /\/\^\[1-9\]\[0-9\]\*\$\//, "ต้องกัน leading zero + 0");
  // ★ ต้องรับเฉพาะ JSON string — ห้าม coerce ทุกรูปแบบ
  assert.match(POST, /const jobId = body\?\.job_id;/, "ต้องอ่าน job_id ดิบ ไม่ coerce");
  assert.match(POST, /if \(typeof jobId !== "string" \|\| !isValidJobId\(jobId\)\)[\s\S]{0,140}400/,
    "non-string หรือไม่ canonical = 400");
  for (const bad of [/String\(\s*body\?\.job_id/, /jobId\s*=\s*String\(/, /jobId[^\n]*\.trim\(\)/,
    /Number\(\s*body\?\.job_id/, /parseInt\(\s*body\?\.job_id/, /Number\(jobId\)/, /parseInt\(jobId/, /\+jobId/]) {
    assert.doesNotMatch(POST.replace(/^[ \t]*\/\/.*$/gm, ""), bad, `ห้าม coerce job_id (${bad})`);
  }

  for (const ok of ["1", "42", "9223372036854775807", "999999999999999999"]) {
    assert.equal(isValidJobId(ok), true, `ต้องรับ ${ok}`);
  }
  for (const bad of ["0", "00", "01", "007", "-1", "+1", "1.0", "1e3", " 1", "1 ", "",
    "9223372036854775808", "99999999999999999999", "abc", "1abc", "٣", "1_000"]) {
    assert.equal(isValidJobId(bad), false, `ต้องปฏิเสธ ${JSON.stringify(bad)}`);
  }
});

// ★ G38: พิสูจน์ที่ handler จริง ไม่ใช่เรียก isValidJobId ตรง ๆ — รอบก่อน G37 เขียวหลอกกรณี " 1"
//   เพราะ handler ทำ .trim() ก่อนถึง helper. ทดสอบนี้เดินเส้น onRequestPost เต็ม (identity +
//   service auth ผ่าน, stub fetch) → วัดทั้ง status และ "มี HTTP call ออกไปหรือไม่".
test("G38: handler ปฏิเสธ job_id ที่ไม่ใช่ canonical string ก่อนยิง HTTP ใด ๆ", async () => {
  const ENV = { SUPABASE_SERVICE_ROLE_KEY: "test-service-key", SUPABASE_URL: "https://example.test" };
  const DATA = { user: { id: "11111111-1111-1111-1111-111111111111", email: "0812345678@phone.boonsook.local", role: "customer" } };
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const post = async (rawBody) => {
      calls = 0;
      const request = { json: async () => rawBody };
      const resp = await onRequestPost({ request, env: ENV, data: DATA });
      return { status: resp.status, calls, body: await resp.json() };
    };

    // ปฏิเสธ + ต้องไม่มี HTTP call ออกไปเลย
    const rejects = [
      ["number 1", { job_id: 1 }],
      ["number เกิน 2^53", { job_id: 9007199254740993 }],
      ["number เกิน BIGINT", { job_id: 92233720368547758070 }],
      ['" 1" (นำหน้าเว้นวรรค)', { job_id: " 1" }],
      ['"1 " (ตามหลังเว้นวรรค)', { job_id: "1 " }],
      ['"0"', { job_id: "0" }],
      ['"01"', { job_id: "01" }],
      ["number 0", { job_id: 0 }],
      ["null", { job_id: null }],
      ["boolean", { job_id: true }],
      ["object", { job_id: { id: "1" } }],
      ["array", { job_id: ["1"] }],
      ["ไม่มี job_id", {}],
      ["body ไม่ใช่ JSON", null],
    ];
    for (const [label, raw] of rejects) {
      const r = await post(raw);
      assert.equal(r.status, 400, `${label} ต้องได้ 400`);
      assert.equal(r.calls, 0, `${label} ต้องไม่ยิง HTTP ออกไปเลย`);
      assert.equal(r.body.ok, false);
    }

    // ผ่าน validation → เดินต่อจริง (ไม่ใช่ 400) และมี HTTP call ออกไป
    for (const [label, id] of [["string 1", "1"], ["max BIGINT", "9223372036854775807"]]) {
      const r = await post({ job_id: id });
      assert.notEqual(r.status, 400, `${label} ต้องผ่าน validation`);
      assert.ok(r.calls >= 1, `${label} ต้องเดินต่อไปอ่าน row จริง`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ═══ G24–G26 · middleware wiring ══════════════════════════════════════════════════

test("G24: endpoint อยู่ใน REQUIRE_AUTH_ENDPOINTS", () => {
  const list = MW.slice(MW.indexOf("const REQUIRE_AUTH_ENDPOINTS = ["), MW.indexOf("];", MW.indexOf("const REQUIRE_AUTH_ENDPOINTS = [")));
  assert.ok(list.includes(`"${ENDPOINT}"`), "endpoint ต้องต้อง require JWT");
});

test("G25: endpoint ไม่อยู่ใน STAFF_ONLY / REPORT_ONLY / NING_AGENT", () => {
  for (const name of ["STAFF_ONLY_ENDPOINTS", "REPORT_ONLY_ENDPOINTS", "NING_AGENT_ENDPOINTS"]) {
    const start = MW.indexOf(`const ${name} = [`);
    assert.ok(start > 0, `ไม่พบ ${name}`);
    const list = MW.slice(start, MW.indexOf("];", start));
    assert.ok(!list.includes(`"${ENDPOINT}"`), `endpoint ห้ามอยู่ใน ${name} (customer JWT ต้องผ่าน)`);
  }
});

test("G26: rate limit explicit 30/60s", () => {
  const rl = MW.slice(MW.indexOf("const RATE_LIMITS = {"), MW.indexOf("};", MW.indexOf("const RATE_LIMITS = {")));
  assert.match(rl, new RegExp(`"${ENDPOINT}": \\{ limit: 30, windowSec: 60 \\}`),
    "ต้องกำหนด rate limit 30/60s ชัดเจน (ไม่ใช้ default)");
});

// ═══ G27–G30 · SW /api/* privacy (Blocking fix A) ═════════════════════════════════

test("G27: same-origin /api/* เข้า network-only branch", () => {
  assert.match(SW_FETCH, /url\.origin === self\.location\.origin && url\.pathname\.startsWith\('\/api\/'\)/,
    "ต้องมี bypass สำหรับ same-origin /api/*");
});

test("G28: /api/* bypass อยู่ก่อน modules/CDN/local-assets branch", () => {
  const apiAt = SW_FETCH.indexOf("url.pathname.startsWith('/api/')");
  const restAt = SW_FETCH.indexOf("'/rest/v1/'");
  const modAt = SW_FETCH.indexOf("url.pathname.startsWith('/modules/')");
  const cdnAt = SW_FETCH.indexOf("isCdnResource(url.hostname)");
  const localAt = SW_FETCH.indexOf("// Local assets: Network first");
  assert.ok(apiAt > 0, "ไม่พบ /api/ bypass");
  for (const [name, at] of [["rest/v1", restAt], ["modules", modAt], ["cdn", cdnAt], ["local-assets", localAt]]) {
    assert.ok(at > apiAt, `/api/ bypass ต้องอยู่ก่อน branch ${name}`);
  }
});

test("G29: /api/* branch ไม่ cache.put และไม่ fallback จาก Cache Storage", () => {
  const start = SW_FETCH.indexOf("url.pathname.startsWith('/api/')");
  const end = SW_FETCH.indexOf("// API requests: Network only", start);
  assert.ok(end > start, "หาขอบเขต /api/ branch ไม่เจอ");
  const branch = SW_FETCH.slice(start, end);
  assert.doesNotMatch(branch, /cache\.put|caches\.open/, "/api/* ห้ามเขียนลง cache");
  assert.doesNotMatch(branch, /caches\.match/, "/api/* ห้าม fallback จาก cache (cross-customer leak)");
  assert.match(branch, /status: 503/, "offline ต้องคืน 503");
  assert.match(branch, /return;/, "ต้อง return ออกก่อนถึง branch อื่น");
});

test("G30: bypass ครอบ endpoint เดิมทั้ง prefix (loyalty-balance ด้วย)", () => {
  const start = SW_FETCH.indexOf("url.pathname.startsWith('/api/')");
  const branch = SW_FETCH.slice(start, start + 900);
  assert.doesNotMatch(branch, /customer-service-jobs|loyalty-balance/,
    "ต้อง match ทั้ง prefix /api/ ไม่ใช่ hardcode endpoint เดียว");
  assert.ok("/api/v1/loyalty-balance".startsWith("/api/"), "prefix ต้องครอบ loyalty-balance");
  assert.ok(`${ENDPOINT}`.startsWith("/api/"), "prefix ต้องครอบ endpoint ใหม่");
});

// ═══ G31–G32 · scope invariants ═══════════════════════════════════════════════════

test("G31: proxy ไม่แตะ payment/JV/accounting/stock", () => {
  for (const bad of ["journal_entries", "journal_lines", "service_payments", "stock_movements",
    "warehouse_stock", "postJournal", "record_service_payment", "closed_at"]) {
    assert.ok(!FN_CODE.includes(bad), `proxy ห้ามอ้าง ${bad}`);
  }
});

test("G32: proxy เขียนได้เฉพาะ service_jobs และเฉพาะ method PATCH", () => {
  const methods = [...FN.matchAll(/method: "([A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(methods)], ["PATCH"], `เขียนด้วย method อื่น: ${methods.join(",")}`);
  const tables = [...FN.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ["service_jobs"], `แตะตารางอื่น: ${tables.join(",")}`);
});
