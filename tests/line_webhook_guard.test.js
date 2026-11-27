// Phase 648 (เฟส A) — กล่องแชทลูกค้า LINE: guard test
// Run: node --test tests/line_webhook_guard.test.js
//
// ล็อก invariant ด้านความปลอดภัยของ:
//   - functions/api/line-webhook.js : ตรวจ X-Line-Signature ก่อนแตะ DB, fail closed, เก็บเฉพาะแชทส่วนตัว,
//     เขียนผ่าน RPC customer_chat_ingest_line เท่านั้น, ไม่เรียก reply/push API (ไม่กินโควตา)
//   - functions/_middleware.js      : webhook ไม่อยู่ในรายการ JWT (LINE ไม่มี JWT) แต่มี rate limit
//   - supabase-phase648-customer-chat-inbox.sql : RLS/สิทธิ์ (อ่าน admin+sales, เขียนเฉพาะ service_role)
//   - modules/customer_chat.js      : escape ข้อมูลลูกค้า, route เฉพาะ admin+sales, ไม่ส่งข้อความหาลูกค้า

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  verifyLineSignature,
  extractInboundMessages,
  extractChatEvents,
  describeLineMessage,
  onRequestPost,
} from "../functions/api/line-webhook.js";
import {
  renderThreadItem,
  renderMessageBubble,
  filterThreads,
  sortMessagesAsc,
  maxInboundSeq,
} from "../modules/customer_chat.js";

const SECRET = "test-channel-secret-not-real";
const webhookSrc = fs.readFileSync(path.resolve("functions/api/line-webhook.js"), "utf8");
const middlewareSrc = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");
const sqlSrc = fs.readFileSync(path.resolve("supabase-phase648-customer-chat-inbox.sql"), "utf8");
const chatSrc = fs.readFileSync(path.resolve("modules/customer_chat.js"), "utf8");
const mainJs = fs.readFileSync(path.resolve("main.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");

function sign(body, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

function userTextEvent(overrides = {}) {
  return {
    type: "message",
    mode: "active",
    timestamp: 1764200000000,
    source: { type: "user", userId: "U1234567890abcdef" },
    replyToken: "reply-token-x",
    message: { id: "4680001", type: "text", text: "สวัสดีครับ แอร์ 12000 BTU ราคาเท่าไหร่" },
    ...overrides,
  };
}

function makeRequest(bodyObj, { signature, rawBody } = {}) {
  const body = rawBody ?? JSON.stringify(bodyObj);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signature !== null) headers.set("X-Line-Signature", signature ?? sign(body));
  return new Request("https://example.test/api/line-webhook", { method: "POST", headers, body });
}

function withMockFetch(handler, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = original; });
}

const okJson = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const ENV = {
  LINE_CHANNEL_SECRET: SECRET,
  LINE_CHANNEL_ACCESS_TOKEN: "test-access-token",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  SUPABASE_URL: "https://db.example.test",
};

// ── signature ────────────────────────────────────────────────────────────────
test("verifyLineSignature: ลายเซ็นถูกต้องผ่าน, body ถูกแก้/secret ผิด/ไม่มีค่า ไม่ผ่าน", async () => {
  const body = JSON.stringify({ events: [] });
  assert.equal(await verifyLineSignature(body, sign(body), SECRET), true);
  assert.equal(await verifyLineSignature(body + " ", sign(body), SECRET), false, "tampered body");
  assert.equal(await verifyLineSignature(body, sign(body, "other-secret"), SECRET), false, "wrong secret");
  assert.equal(await verifyLineSignature(body, "", SECRET), false, "empty signature");
  assert.equal(await verifyLineSignature(body, null, SECRET), false, "missing signature");
  assert.equal(await verifyLineSignature(body, sign(body), ""), false, "missing secret = fail closed");
  assert.equal(await verifyLineSignature(body, "!!!not-base64!!!", SECRET), false, "garbage signature");
});

// ── event filtering ──────────────────────────────────────────────────────────
test("extractInboundMessages: เก็บเฉพาะ message จากแชทส่วนตัว — ทิ้ง group/room/standby/follow", () => {
  const payload = {
    events: [
      userTextEvent(),
      userTextEvent({ source: { type: "group", groupId: "Cgroup", userId: "Ustaff" }, message: { id: "g1", type: "text", text: "งานปิดแล้ว" } }),
      userTextEvent({ source: { type: "room", roomId: "Rroom", userId: "Ustaff" }, message: { id: "r1", type: "text", text: "x" } }),
      userTextEvent({ mode: "standby", message: { id: "s1", type: "text", text: "x" } }),
      { type: "follow", source: { type: "user", userId: "Unew" }, timestamp: 1 },
      userTextEvent({ message: { id: "", type: "text", text: "no id" } }),
      userTextEvent({ source: { type: "user", userId: "" }, message: { id: "nouser", type: "text", text: "x" } }),
    ],
  };
  const out = extractInboundMessages(payload);
  assert.equal(out.length, 1);
  assert.equal(out[0].userId, "U1234567890abcdef");
  assert.equal(out[0].messageId, "4680001");
  assert.equal(out[0].type, "text");
  assert.equal(out[0].sentAt, new Date(1764200000000).toISOString());
  assert.deepEqual(extractInboundMessages({}), []);
  assert.deepEqual(extractInboundMessages(null), []);
});

test("describeLineMessage: ชนิดที่ไม่ใช่ text แสดงเป็นป้ายสั้น ไม่ดาวน์โหลดเนื้อหา", () => {
  assert.equal(describeLineMessage({ type: "image", id: "1" }).body, "[รูปภาพ]");
  assert.equal(describeLineMessage({ type: "sticker" }).body, "[สติกเกอร์]");
  assert.match(describeLineMessage({ type: "location", title: "ร้าน", address: "ถนน 1" }).body, /^\[ตำแหน่ง\] ร้าน ถนน 1$/);
  assert.equal(describeLineMessage({ type: "weird" }).body, "[ข้อความประเภทที่ยังไม่รองรับ]");
  assert.equal(describeLineMessage({ type: "text", text: "x".repeat(6000) }).body.length, 5000);
});

// ── handler behaviour ────────────────────────────────────────────────────────
test("handler: ไม่มี LINE_CHANNEL_SECRET → 503 และไม่เรียก network", async () => {
  await withMockFetch(() => okJson({}), async (calls) => {
    const res = await onRequestPost({ request: makeRequest({ events: [userTextEvent()] }), env: { ...ENV, LINE_CHANNEL_SECRET: "" } });
    assert.equal(res.status, 503);
    assert.equal(calls.length, 0);
  });
});

test("handler: ลายเซ็นผิด/ไม่มีลายเซ็น → 401 และไม่แตะ DB", async () => {
  await withMockFetch(() => okJson({}), async (calls) => {
    const bad = await onRequestPost({ request: makeRequest({ events: [userTextEvent()] }, { signature: "AAAA" }), env: ENV });
    assert.equal(bad.status, 401);
    const missing = await onRequestPost({ request: makeRequest({ events: [userTextEvent()] }, { signature: null }), env: ENV });
    assert.equal(missing.status, 401);
    assert.equal(calls.length, 0);
  });
});

test("handler: Verify จาก LINE console (events ว่าง) และข้อความกลุ่มร้าน → 200 ไม่แตะ DB", async () => {
  await withMockFetch(() => okJson({}), async (calls) => {
    const empty = await onRequestPost({ request: makeRequest({ destination: "U", events: [] }), env: ENV });
    assert.equal(empty.status, 200);
    const groupOnly = await onRequestPost({
      request: makeRequest({ events: [userTextEvent({ source: { type: "group", groupId: "C1", userId: "U9" } })] }),
      env: ENV,
    });
    assert.equal(groupOnly.status, 200);
    assert.equal(calls.length, 0);
  });
});

test("handler: ข้อความลูกค้า → เรียก RPC ingest ด้วย service role + GET profile เท่านั้น (ไม่ reply/push)", async () => {
  await withMockFetch((url) => {
    if (url.startsWith("https://api.line.me/v2/bot/profile/")) return okJson({ displayName: "คุณเอ" });
    return okJson({ inserted: true });
  }, async (calls) => {
    const res = await onRequestPost({ request: makeRequest({ events: [userTextEvent()] }), env: ENV });
    assert.equal(res.status, 200);
    const rpc = calls.filter((c) => c.url === "https://db.example.test/rest/v1/rpc/customer_chat_ingest_line");
    assert.equal(rpc.length, 1);
    assert.equal(rpc[0].opts.method, "POST");
    assert.equal(rpc[0].opts.headers.Authorization, "Bearer test-service-role");
    const sent = JSON.parse(rpc[0].opts.body);
    assert.equal(sent.p_external_user_id, "U1234567890abcdef");
    assert.equal(sent.p_external_message_id, "4680001");
    assert.equal(sent.p_display_name, "คุณเอ");
    assert.ok(!("reply_token" in sent) && !("p_reply_token" in sent), "reply token ไม่ถูกส่งเก็บในเฟสนี้");
    for (const c of calls) {
      assert.ok(!/\/v2\/bot\/message\//.test(c.url), "ห้ามเรียก reply/push/broadcast API: " + c.url);
      if (c.url.startsWith("https://api.line.me/")) assert.ok(!c.opts.method || c.opts.method === "GET");
    }
  });
});

test("handler: DB ล้มเหลว → 500 (ให้ LINE ส่งซ้ำ) และไม่ส่ง error ดิบกลับ", async () => {
  await withMockFetch((url) => {
    if (url.startsWith("https://api.line.me/")) return okJson({ displayName: "x" });
    return new Response("secret internal detail from postgres", { status: 500 });
  }, async () => {
    const res = await onRequestPost({ request: makeRequest({ events: [userTextEvent()] }), env: ENV });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes("secret internal detail"));
  });
});

test("webhook source: ตรวจลายเซ็นก่อน JSON.parse และไม่มีการเรียก message API / log เนื้อหาข้อความ", () => {
  const body = webhookSrc.slice(webhookSrc.indexOf("export async function onRequestPost"));
  assert.ok(body.indexOf("verifyLineSignature(") > 0);
  assert.ok(body.indexOf("verifyLineSignature(") < body.indexOf("JSON.parse("), "signature must be checked before parsing");
  assert.ok(!/v2\/bot\/message/.test(webhookSrc), "no reply/push/broadcast endpoint in phase A");
  assert.ok(!/console\.(log|info)\(/.test(webhookSrc), "no console.log of payload");
  assert.ok(!/logServerError\([^)]*msg\.body/.test(webhookSrc), "never log customer message body");
});

// ── middleware ───────────────────────────────────────────────────────────────
test("middleware: /api/line-webhook มี rate limit และไม่อยู่ใน REQUIRE_AUTH_ENDPOINTS (LINE ไม่มี JWT)", () => {
  assert.match(middlewareSrc, /"\/api\/line-webhook":\s*\{\s*limit:\s*\d+/);
  const authBlock = middlewareSrc.slice(
    middlewareSrc.indexOf("const REQUIRE_AUTH_ENDPOINTS"),
    middlewareSrc.indexOf("const STAFF_ONLY_ENDPOINTS")
  );
  assert.ok(authBlock.length > 0);
  assert.ok(!authBlock.includes("/api/line-webhook"));
});

// ── SQL / RLS ────────────────────────────────────────────────────────────────
test("SQL: RLS เปิด, อ่านได้เฉพาะ admin+sales, ไม่มี policy เขียนตรงจาก client", () => {
  assert.match(sqlSrc, /ALTER TABLE public\.customer_chat_threads\s+ENABLE ROW LEVEL SECURITY/);
  assert.match(sqlSrc, /ALTER TABLE public\.customer_chat_messages ENABLE ROW LEVEL SECURITY/);
  assert.match(sqlSrc, /p\.role IN \('admin','sales'\)/);
  const policies = sqlSrc.match(/CREATE POLICY[\s\S]*?;/g) || [];
  assert.equal(policies.length, 4);
  for (const p of policies) {
    assert.ok(!/FOR (INSERT|UPDATE|DELETE)/.test(p), "no write policy: " + p.slice(0, 80));
    assert.ok(!/USING\s*\(\s*true\s*\)/i.test(p), "no USING(true): " + p.slice(0, 80));
  }
  assert.match(sqlSrc, /REVOKE ALL ON public\.customer_chat_threads\s+FROM anon, authenticated/);
  assert.match(sqlSrc, /REVOKE ALL ON public\.customer_chat_messages FROM anon, authenticated/);
  assert.ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*customer_chat_(threads|messages)[^;]*TO (anon|authenticated)/i.test(sqlSrc));
});

test("SQL: ingest/unsend RPC รันได้เฉพาะ service_role; set_thread_state ตรวจสิทธิ์และแก้ได้แค่ read_seq/status", () => {
  for (const fn of ["customer_chat_ingest_line", "customer_chat_unsend_line"]) {
    assert.match(sqlSrc, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon, authenticated;`), fn + " revoked");
    assert.match(sqlSrc, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*TO service_role;`), fn + " service_role only");
    assert.ok(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*TO (anon|authenticated)`).test(sqlSrc), fn + " not granted to clients");
  }
  const fnStart = sqlSrc.indexOf("CREATE OR REPLACE FUNCTION public.customer_chat_set_thread_state");
  assert.ok(fnStart > 0);
  const stateFn = sqlSrc.slice(fnStart, sqlSrc.indexOf("NOTIFY pgrst"));
  assert.match(stateFn, /IF NOT public\.customer_chat_is_inbox_staff\(\) OR COALESCE\(public\.is_customer_role\(\), false\)/);
  const setStart = stateFn.indexOf("SET read_seq");
  const setEnd = stateFn.indexOf("WHERE id = p_thread_id");
  assert.ok(setStart > 0 && setEnd > setStart, "SET clause located");
  const setClause = stateFn.slice(setStart, setEnd);
  const assigned = [...setClause.matchAll(/(?:SET|,)\s*([a-z_]+)\s*=/g)].map((m) => m[1]).sort();
  assert.deepEqual(assigned, ["read_seq", "status", "updated_at"], "state RPC assigns only read_seq/status/updated_at");
  assert.match(sqlSrc, /customer_chat_messages_channel_ext_uniq UNIQUE \(channel, external_message_id\)/);
  assert.match(sqlSrc, /ON CONFLICT \(channel, external_message_id\) DO NOTHING/);
  assert.match(sqlSrc, /NOTIFY pgrst, 'reload schema';/);
});

test("SQL: race guard — อ่านถึง seq ที่เห็นเท่านั้น, 'done' ด้วย seq เก่าไม่ปิดห้อง, unread = GENERATED", () => {
  assert.match(sqlSrc, /unread_count\s+bigint GENERATED ALWAYS AS \(inbound_seq - read_seq\) STORED/);
  assert.match(sqlSrc, /CHECK \(read_seq BETWEEN 0 AND inbound_seq\)/);
  const stateFn = sqlSrc.slice(sqlSrc.indexOf("CREATE OR REPLACE FUNCTION public.customer_chat_set_thread_state"), sqlSrc.indexOf("NOTIFY pgrst"));
  assert.match(stateFn, /p_read_through_seq\s+bigint/);
  assert.match(stateFn, /read_seq\s*=\s*GREATEST\(read_seq, LEAST\(p_read_through_seq, inbound_seq\)\)/);
  assert.match(stateFn, /WHEN p_status = 'done' AND p_read_through_seq < inbound_seq THEN status/);
  assert.match(stateFn, /'reason',\s*CASE WHEN v_stale THEN 'new_messages'/);
  assert.ok(!/p_mark_read/.test(sqlSrc.replace(/--.*$/gm, "")), "old boolean mark-read API removed");
  assert.match(sqlSrc, /DROP FUNCTION IF EXISTS public\.customer_chat_set_thread_state\(uuid, boolean, text\);/);
  // ingest ออก seq หลังล็อกแถวห้อง (upsert RETURNING) แล้วจึง insert ข้อความ
  const ingest = sqlSrc.slice(sqlSrc.indexOf("CREATE OR REPLACE FUNCTION public.customer_chat_ingest_line"), sqlSrc.indexOf("CREATE OR REPLACE FUNCTION public.customer_chat_unsend_line"));
  const iLock = ingest.indexOf("RETURNING id, inbound_seq INTO v_thread, v_cur");
  const iSeq = ingest.indexOf("v_seq := v_cur + 1");
  const iIns = ingest.indexOf("INSERT INTO public.customer_chat_messages");
  assert.ok(iLock > 0 && iSeq > iLock && iIns > iSeq, "lock → seq → insert order");
  assert.match(ingest, /SET inbound_seq\s*=\s*v_seq,\s*status\s*=\s*'open'/);
});

test("SQL: unsend ลบเนื้อหา (body NULL) เฉพาะห้องของลูกค้าคนนั้น + tombstone กันเนื้อหาที่มาทีหลัง", () => {
  assert.match(sqlSrc, /CONSTRAINT customer_chat_messages_unsent_no_body CHECK \(unsent_at IS NULL OR body IS NULL\)/);
  const unsend = sqlSrc.slice(sqlSrc.indexOf("CREATE OR REPLACE FUNCTION public.customer_chat_unsend_line"), sqlSrc.indexOf("DROP FUNCTION IF EXISTS public.customer_chat_set_thread_state"));
  assert.match(unsend, /SET body = NULL,/);
  assert.match(unsend, /AND thread_id = v_thread/);
  assert.match(unsend, /'unsent', NULL, NULL, v_when, v_when\)\s*ON CONFLICT \(channel, external_message_id\) DO NOTHING/);
  assert.match(unsend, /VALUES \('line', p_external_user_id, 'done'\)/, "tombstone-only thread does not enter the pending queue");
});

test("webhook: unsend จากแชทส่วนตัวถูกส่ง RPC unsend ตามลำดับ; unsend จากกลุ่มถูกทิ้ง", async () => {
  const unsend = (src, id = "4680001") => ({ type: "unsend", mode: "active", timestamp: 1764200001000, source: src, unsend: { messageId: id } });
  const evs = extractChatEvents({ events: [
    userTextEvent(),
    unsend({ type: "user", userId: "U1234567890abcdef" }),
    unsend({ type: "group", groupId: "C1", userId: "Ustaff" }, "g9"),
    unsend({ type: "user", userId: "U1" }, ""),
  ] });
  assert.deepEqual(evs.map((e) => e.kind), ["message", "unsend"]);
  assert.equal(evs[1].messageId, "4680001");
  assert.equal(extractInboundMessages({ events: [unsend({ type: "user", userId: "U1" })] }).length, 0);

  await withMockFetch((url) => (url.startsWith("https://api.line.me/") ? okJson({ displayName: "x" }) : okJson({})), async (calls) => {
    const res = await onRequestPost({ request: makeRequest({ events: [userTextEvent(), unsend({ type: "user", userId: "U1234567890abcdef" })] }), env: ENV });
    assert.equal(res.status, 200);
    const rpc = calls.filter((c) => c.url.includes("/rest/v1/rpc/")).map((c) => c.url.split("/rpc/")[1]);
    assert.deepEqual(rpc, ["customer_chat_ingest_line", "customer_chat_unsend_line"]);
    const body = JSON.parse(calls.find((c) => c.url.endsWith("customer_chat_unsend_line")).opts.body);
    assert.deepEqual(body, { p_external_user_id: "U1234567890abcdef", p_external_message_id: "4680001", p_unsent_at: new Date(1764200001000).toISOString() });
  });
});

test("หน้าแชท: seq ที่ใช้ mark read = ข้อความขาเข้าที่แสดงจริง; เรียงข้อความเก่า→ใหม่", () => {
  const msgs = [
    { id: "b", direction: "in", inbound_seq: 3, sent_at: "2026-11-27T03:00:02Z" },
    { id: "o", direction: "out", inbound_seq: null, sent_at: "2026-11-27T03:00:03Z" },
    { id: "t", direction: "in", inbound_seq: null, unsent_at: "2026-11-27T03:00:04Z", sent_at: "2026-11-27T03:00:04Z" },
    { id: "a", direction: "in", inbound_seq: 2, sent_at: "2026-11-27T03:00:02Z" },
  ];
  assert.equal(maxInboundSeq(msgs), 3);
  assert.equal(maxInboundSeq([]), 0);
  assert.deepEqual(sortMessagesAsc(msgs).map((m) => m.id), ["a", "b", "o", "t"]);
});

test("lifecycle: main.js ล้างกล่องแชทตอน logout / sign-out / afterLogin; หน้าแชทตรวจ session หลังทุก await", () => {
  const body = (name) => {
    const i = mainJs.indexOf(`async function ${name}(`);
    assert.ok(i > 0, name + " found");
    return mainJs.slice(i, mainJs.indexOf("\n}\n", i));
  };
  assert.match(body("_clearCustomerChat"), /clearCustomerChatState\(\)/);
  assert.match(body("logout"), /await _clearCustomerChat\(\);/);
  assert.match(body("afterLogin"), /await _clearCustomerChat\(\);/);
  const anchor = mainJs.indexOf("_appSessionUserId = null; // ★ Phase 572");
  assert.ok(anchor > 0);
  assert.match(mainJs.slice(anchor, anchor + 400), /_clearCustomerChat\(\);/);
  const rest = chatSrc.slice(chatSrc.indexOf("async function _rest("), chatSrc.indexOf("function _isStale"));
  assert.equal((rest.match(/if \(!_alive\(sess\)\) throw new StaleSessionError/g) || []).length, 3, "alive check before fetch, after fetch, after body");
  assert.match(rest, /signal: sess\.controller\.signal/);
  const alive = chatSrc.slice(chatSrc.indexOf("function _alive("), chatSrc.indexOf("function _stopPolling"));
  assert.match(alive, /_uid\(\) === sess\.uid/);
  assert.match(alive, /sess\.gen === _gen/);
  const clear = chatSrc.slice(chatSrc.indexOf("export function clearCustomerChatState"), chatSrc.indexOf("async function _rest("));
  assert.match(clear, /_gen\+\+/);
  assert.match(clear, /controller\?\.abort\(\)/);
  assert.match(clear, /c\.innerHTML = ""/);
});

// ── client page ──────────────────────────────────────────────────────────────
test("หน้าแชท: ชื่อและข้อความลูกค้าถูก escape (กัน XSS)", () => {
  const evil = `<img src=x onerror="alert(1)">`;
  const item = renderThreadItem({ id: `1" onclick="x`, display_name: evil, last_message_preview: evil, unread_count: 2, status: "open" }, null);
  assert.ok(!item.includes("<img"), "thread name/preview must be escaped");
  assert.ok(!item.includes(`1" onclick`), "thread id attribute must be escaped");
  const bubble = renderMessageBubble({ direction: "in", body: evil, sent_at: "2026-11-27T03:00:00Z" });
  assert.ok(!bubble.includes("<img"));
  assert.ok(bubble.includes("&lt;img"));
});

test("หน้าแชท: filter ค้างตอบ = unread > 0 หรือยังเปิดอยู่", () => {
  const rows = [
    { id: 1, unread_count: 0, status: "done" },
    { id: 2, unread_count: 3, status: "done" },
    { id: 3, unread_count: 0, status: "open" },
  ];
  assert.deepEqual(filterThreads(rows, "pending").map((r) => r.id), [2, 3]);
  assert.equal(filterThreads(rows, "all").length, 3);
});

test("หน้าแชท: เฟส A ไม่ส่งข้อความหาลูกค้า — เขียนได้แค่ RPC customer_chat_set_thread_state", () => {
  assert.ok(!/api\.line\.me|\/api\/line-notify|sendLineNotify/.test(chatSrc), "no LINE send from page");
  const rpcCalls = chatSrc.match(/\/rest\/v1\/rpc\/[a-z_]+/g) || [];
  assert.deepEqual([...new Set(rpcCalls)], ["/rest/v1/rpc/customer_chat_set_thread_state"]);
  assert.ok(!/"(PATCH|DELETE|PUT)"/.test(chatSrc));
  assert.ok(!/rest\/v1\/customer_chat_(threads|messages)[^`"]*`,\s*\{\s*method/.test(chatSrc), "no direct table writes");
  assert.ok(!/\balert\s*\(/.test(chatSrc), "use showToast, not alert()");
});

test("route customer_chat: lazy route + เมนู + เฉพาะ admin/sales", () => {
  assert.match(mainJs, /customer_chat:\s*\["\.\/modules\/customer_chat\.js",\s*"renderCustomerChatPage"\]/);
  const roleBlock = mainJs.slice(mainJs.indexOf("const ROLE_PAGES = {"), mainJs.indexOf("const ROLE_LABELS"));
  assert.ok(roleBlock.length > 0, "ROLE_PAGES block found");
  const roleLine = (name) => (roleBlock.match(new RegExp(`^\\s*${name}:\\s*\\[.*$`, "m")) || [""])[0];
  assert.ok(/^const ALL_ROUTES = \[.*"customer_chat"/m.test(mainJs), "admin (ALL_ROUTES) has route");
  assert.ok(roleLine("sales").includes('"customer_chat"'), "sales has route");
  for (const r of ["technician", "accountant", "customer"]) {
    assert.ok(roleLine(r).length > 0, `${r} role line found`);
    assert.ok(!roleLine(r).includes('"customer_chat"'), `${r} must not have route`);
  }
  assert.match(indexHtml, /data-route="customer_chat"/);
  assert.match(indexHtml, /<section id="page-customer_chat" class="page hidden"><\/section>/);
});
