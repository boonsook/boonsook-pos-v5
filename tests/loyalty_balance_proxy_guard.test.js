// Phase 580 — customer-loyalty-balance-proxy (ลูกค้าเห็นแต้มจริง · RLS-safe)
//
// Why: loyalty_points มี RESTRICTIVE deny สำหรับ customer role (Phase 505 GROUP A) →
// state.loyaltyPoints ว่างสำหรับลูกค้า → customer_dashboard โชว์ "0 แต้ม" เสมอ. proxy อ่านด้วย
// service-role (bypass RLS) แต่ derive customer identity จาก JWT ฝั่ง server เท่านั้น —
// ★ ห้ามรับ phone/customer_id จาก request (กันลูกค้า A อ่านแต้ม B).
// Run: node --test tests/loyalty_balance_proxy_guard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { phoneFromEmail, getServiceAuth } from "../functions/api/v1/loyalty-balance.js";

const fn = fs.readFileSync(path.resolve("functions/api/v1/loyalty-balance.js"), "utf8");
const mw = fs.readFileSync(path.resolve("functions/_middleware.js"), "utf8");
const cd = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");

// ═══ (1) identity derive จาก JWT เท่านั้น — ห้ามอ่าน body/query ═══
test("identity: phoneFromEmail รับเฉพาะ <phone>@phone.boonsook.local (behavioral)", () => {
  assert.equal(phoneFromEmail("0812345678@phone.boonsook.local"), "0812345678", "customer format → phone");
  assert.equal(phoneFromEmail("admin@boonsook.com"), null, "staff email → null (403)");
  assert.equal(phoneFromEmail("abc@phone.boonsook.local"), null, "non-digit → null");
  assert.equal(phoneFromEmail(""), null, "empty → null");
  assert.equal(phoneFromEmail(null), null, "null → null");
});

test("★ isolation: handler ต้องไม่อ่าน phone/customer_id จาก request (body/query)", () => {
  // identity มาจาก data.user.email เท่านั้น
  assert.match(fn, /phoneFromEmail\(data\?\.user\?\.email\)/, "phone ต้อง derive จาก data.user.email (JWT)");
  // ห้ามอ่านจาก request: ไม่มี searchParams.get / request.json / body สำหรับ phone|customer_id
  assert.ok(!/searchParams\.get/.test(fn), "ห้ามอ่านค่าใด ๆ จาก query string (identity มาจาก JWT เท่านั้น)");
  assert.ok(!/request\.json\(\)|await request\.text|request\.formData/.test(fn), "GET ไม่อ่าน request body (identity ไม่มาจาก body)");
  // ไม่ใช่ customer format → 403
  assert.match(fn, /Forbidden: not a customer account.*403|not a customer account/, "email non-customer → 403");
});

// ═══ (2) balance = Σ earn − Σ redeem + paginate ═══
test("balance = Σ earn − Σ redeem (server-side) + paginate loyalty rows", () => {
  assert.match(fn, /if \(t\.type === "earn"\) earned \+= pts;/, "sum earn");
  assert.match(fn, /else if \(t\.type === "redeem"\) redeemed \+= pts;/, "sum redeem");
  assert.match(fn, /balance: earned - redeemed/, "balance = earned − redeemed");
  // paginate: offset loop + break เมื่อ page < PAGE
  assert.match(fn, /for \(let offset = 0; ; offset \+= PAGE\)/, "ต้อง paginate ด้วย offset loop");
  assert.match(fn, /if \(lr\.rows\.length < PAGE\) break;/, "break หน้าสุดท้าย");
  assert.match(fn, /loyalty_points\?customer_id=eq\.\$\{encodeURIComponent\(customerId\)\}/, "filter ด้วย customer_id ที่ derive server-side");
});

// ═══ (3) service-role required (ไม่ fallback anon) ═══
test("service-role required — ไม่มี key → 500, ไม่ fallback anon", () => {
  const auth = getServiceAuth({});
  assert.equal(auth.ok, false);
  assert.equal(auth.status, 500, "ไม่มี SERVICE_ROLE_KEY → 500");
  const ok = getServiceAuth({ SUPABASE_SERVICE_ROLE_KEY: "svc-key-123" });
  assert.equal(ok.ok, true);
  assert.equal(ok.apiKey, "svc-key-123", "ใช้ service-role key");
  assert.ok(!/SUPABASE_ANON_KEY|PUBLISHABLE/.test(fn), "ห้าม fallback anon/publishable key ใน proxy");
});

// ═══ (4) middleware: REQUIRE_AUTH + RATE_LIMITS + ไม่ STAFF_ONLY/NING_AGENT ═══
test("middleware: loyalty-balance ใน REQUIRE_AUTH + RATE_LIMITS แต่ไม่ STAFF_ONLY/NING_AGENT/REPORT", () => {
  // helper: ตัด block ของ array แต่ละตัวมาเช็ค
  const block = (name) => {
    const i = mw.indexOf(name);
    assert.notEqual(i, -1, `ต้องมี ${name}`);
    return mw.slice(i, mw.indexOf("]", i));
  };
  assert.match(block("REQUIRE_AUTH_ENDPOINTS"), /\/api\/v1\/loyalty-balance/, "ต้องอยู่ใน REQUIRE_AUTH (customer JWT ผ่าน)");
  assert.match(mw, /"\/api\/v1\/loyalty-balance":\s*\{\s*limit:\s*\d+/, "ต้องมี RATE_LIMITS");
  assert.ok(!block("STAFF_ONLY_ENDPOINTS").includes("/api/v1/loyalty-balance"), "ห้ามอยู่ STAFF_ONLY (ลูกค้าไม่ใช่ staff)");
  assert.ok(!block("NING_AGENT_ENDPOINTS").includes("/api/v1/loyalty-balance"), "ห้ามอยู่ NING_AGENT (customer identity)");
  assert.ok(!block("REPORT_ONLY_ENDPOINTS").includes("/api/v1/loyalty-balance"), "ห้ามอยู่ REPORT_ONLY");
});

test("handler: Ning agent (ไม่มี customer identity) → 403", () => {
  assert.match(fn, /authMode === "ning_agent"[\s\S]{0,120}Forbidden: customer auth required/, "ning_agent → 403");
});

// ═══ (5) customer_dashboard เรียก proxy + error fallback (ไม่ 0 หลอก) ═══
test("customer_dashboard: points เรียก /api/v1/loyalty-balance ด้วย JWT + ไม่พึ่ง state.loyaltyPoints", () => {
  assert.match(cd, /fetch\("\/api\/v1\/loyalty-balance"/, "ต้องเรียก proxy endpoint");
  assert.match(cd, /"Authorization": "Bearer " \+ token/, "แนบ JWT ลูกค้า");
  // ไม่อ่าน state.loyaltyPoints ในโค้ดจริง (เหลือเฉพาะ comment)
  const codeOnly = cd.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/state\.loyaltyPoints/.test(codeOnly), "จุดแต้มต้องไม่พึ่ง state.loyaltyPoints (ว่างเสมอ = 0 หลอก)");
});

test("customer_dashboard: error → ปุ่ม retry (ไม่โชว์ 0 หลอก); cache keyed phone", () => {
  assert.match(cd, /_loyaltyState === "error"/, "มี error branch");
  assert.match(cd, /custLoyaltyRetry/, "มีปุ่ม retry");
  assert.match(cd, /_loyaltyState = "idle";[\s\S]{0,80}renderCustomerDashboard/, "retry reset idle → refetch");
  assert.match(cd, /_loyaltyKey !== userPhone/, "cache keyed ด้วย phone (สลับ account → โหลดใหม่)");
  // logout เคลียร์ cache (กัน A→B เห็นแต้มข้ามคน)
  assert.match(cd, /_loyalty = null;[\s\S]{0,60}_loyaltyState = "idle";[\s\S]{0,40}_loyaltyKey = null;/, "logout ต้องเคลียร์แต้ม cache");
});

// ═══ (6) error sanitize ═══
test("error sanitize: ใช้ logServerError/clientError ไม่ leak raw (mirror ning-memory)", () => {
  assert.match(fn, /import \{ logServerError, clientError \} from "\.\.\/_error_sanitizer\.js"/, "import sanitizer");
  assert.match(fn, /logServerError\("\[loyalty-balance\]/, "log ฝั่ง server");
  assert.match(fn, /clientError\(/, "client ได้ code/message sanitized");
  assert.ok(!/JSON\.stringify\(.*respText|error:\s*e\.message/.test(fn), "ห้ามส่ง raw error/detail กลับ client");
});
