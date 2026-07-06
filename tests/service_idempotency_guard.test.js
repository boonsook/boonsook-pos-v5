// Phase 567 — Guard: idempotency กัน service_jobs ซ้ำจาก timeout/retry (3 ฟอร์มช่าง)
//   helper insertServiceJobWithReplay (behavioral, fetchFn mock) + source-regex ว่า 3 ฟอร์ม
//   POST ผ่าน helper (ไม่เหลือ raw fetch /rest/v1/service_jobs) + gen/reset intent key.
// Run: node --test tests/service_idempotency_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInsertIntent, insertServiceJobWithReplay } from "../modules/_insert_idempotency.js";

const CFG = { url: "https://x.supabase.co", anonKey: "anon-key" };
const TOKEN = "tok-123";

// ── mock fetch: route POST vs replay-lookup GET; เก็บ body ทุก POST ─────────────
function mkResp(status, jsonBody, textBody) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => (textBody != null ? textBody : JSON.stringify(jsonBody))
  };
}
function abortErr() { const e = new Error("aborted"); e.name = "AbortError"; return e; }
function mockFetch({ post, lookup }) {
  const calls = { post: [], lookup: [] };
  const fetchFn = async (url, opts = {}) => {
    if (opts.method === "POST") {
      const body = JSON.parse(opts.body);
      calls.post.push(body);
      const r = post(calls.post.length - 1, body);
      if (r instanceof Error) throw r;
      return r;
    }
    calls.lookup.push(url);
    return lookup ? lookup() : mkResp(200, []);
  };
  return { fetchFn, calls };
}

const REC = { job_no: "JOB-1", customer_name: "ทดสอบ", total_cost: 100 };

// ═══════════════════════════════════════════════════════════
//  1. behavioral — insertServiceJobWithReplay
// ═══════════════════════════════════════════════════════════
test("createInsertIntent — คืน key ไม่ซ้ำ + ไม่ว่าง", () => {
  const a = createInsertIntent(), b = createInsertIntent();
  assert.ok(a && typeof a === "string" && a.length >= 8);
  assert.notEqual(a, b);
});

test("ปกติ: POST ok → {row, replayed:false} + แนบ client_uuid", async () => {
  const { fetchFn, calls } = mockFetch({ post: () => mkResp(201, [{ id: 1, job_no: "JOB-1" }]) });
  const res = await insertServiceJobWithReplay({ cfg: CFG, token: TOKEN, record: REC, key: "K1", fetchFn });
  assert.equal(res.replayed, false);
  assert.equal(res.row.id, 1);
  assert.equal(calls.post[0].client_uuid, "K1");   // ★ key ถูกแนบไปกับ record
});

test("409 unique-violation → replay-lookup คืน row เดิม (ไม่ insert ซ้ำ)", async () => {
  const { fetchFn, calls } = mockFetch({
    post: () => mkResp(409, {}, "duplicate key value violates unique constraint idx_service_jobs_client_uuid_unique (23505)"),
    lookup: () => mkResp(200, [{ id: 7, job_no: "JOB-7" }])
  });
  const res = await insertServiceJobWithReplay({ cfg: CFG, token: TOKEN, record: REC, key: "K1", fetchFn });
  assert.equal(res.replayed, true);
  assert.equal(res.row.id, 7);
  assert.equal(calls.post.length, 1);      // POST ครั้งเดียว
  assert.equal(calls.lookup.length, 1);    // replay-lookup 1 ครั้ง
});

test("AbortError(timeout) หลัง commit → replay-lookup เจอ row → replayed:true", async () => {
  const { fetchFn } = mockFetch({
    post: () => abortErr(),
    lookup: () => mkResp(200, [{ id: 9, job_no: "JOB-9" }])
  });
  const res = await insertServiceJobWithReplay({ cfg: CFG, token: TOKEN, record: REC, key: "K1", fetchFn });
  assert.equal(res.replayed, true);
  assert.equal(res.row.id, 9);
});

test("AbortError + replay ไม่เจอ row → throw (ไม่ fake success)", async () => {
  const { fetchFn } = mockFetch({ post: () => abortErr(), lookup: () => mkResp(200, []) });
  await assert.rejects(
    () => insertServiceJobWithReplay({ cfg: CFG, token: TOKEN, record: REC, key: "K1", fetchFn }),
    /บันทึกล้มเหลว|ตอบช้า/
  );
});

test("column ยังไม่มี (400 PGRST204) → retry POST โดยไม่มี client_uuid (degrade-safe)", async () => {
  const { fetchFn, calls } = mockFetch({
    post: (i) => i === 0
      ? mkResp(400, {}, "Could not find the 'client_uuid' column of 'service_jobs' in the schema cache (PGRST204)")
      : mkResp(201, [{ id: 3, job_no: "JOB-3" }])
  });
  const res = await insertServiceJobWithReplay({ cfg: CFG, token: TOKEN, record: REC, key: "K1", fetchFn });
  assert.equal(res.replayed, false);
  assert.equal(res.row.id, 3);
  assert.equal(calls.post.length, 2);
  assert.equal(calls.post[0].client_uuid, "K1");        // รอบแรกมี key
  assert.equal(calls.post[1].client_uuid, undefined);   // ★ retry ไม่มี client_uuid
});

test("HTTP error อื่น (RLS 401/500) → throw ไม่ retry/ไม่ replay", async () => {
  const { fetchFn, calls } = mockFetch({ post: () => mkResp(401, {}, "permission denied") });
  await assert.rejects(
    () => insertServiceJobWithReplay({ cfg: CFG, token: TOKEN, record: REC, key: "K1", fetchFn }),
    /HTTP 401/
  );
  assert.equal(calls.post.length, 1);
  assert.equal(calls.lookup.length, 0);
});

// ═══════════════════════════════════════════════════════════
//  2. source-regex — 3 ฟอร์มเรียก helper, ไม่เหลือ raw POST
// ═══════════════════════════════════════════════════════════
const FORMS = [
  { file: "modules/service_form.js", keyVar: "_svInsertKey" },
  { file: "modules/ac_install.js", keyVar: "_acInsertKey" },
  { file: "modules/solar.js", keyVar: "_solInsertKey" }
];

for (const { file, keyVar } of FORMS) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  test(`${file}: POST ผ่าน helper + ไม่เหลือ raw fetch /service_jobs`, () => {
    assert.match(src, /from "\.\/_insert_idempotency\.js"/, "ต้อง import helper");
    assert.match(src, /insertServiceJobWithReplay\(\{/, "ต้องเรียก insertServiceJobWithReplay");
    assert.doesNotMatch(src, /rest\/v1\/service_jobs/, "ต้องไม่เหลือ raw POST /rest/v1/service_jobs");
  });
  test(`${file}: gen intent key ที่ render + reset หลังสำเร็จ`, () => {
    assert.match(src, new RegExp(`${keyVar} = createInsertIntent\\(\\)`), "gen key ที่ render");
    assert.match(src, new RegExp(`${keyVar} = null`), "reset key หลังสำเร็จ");
    assert.match(src, new RegExp(`key: ${keyVar}`), "ส่ง key เข้า helper");
  });
  test(`${file}: กัน optimistic push ซ้ำตอน replay (เช็ค id ก่อน push)`, () => {
    assert.match(src, /!\(state\.serviceJobs \|\| \[\]\)\.some\(j => String\(j\.id\) === String\(insertedRow\.id\)\)/,
      "push เข้า state ต่อเมื่อ id ยังไม่มี (กัน dup ตอน replay)");
  });
}
