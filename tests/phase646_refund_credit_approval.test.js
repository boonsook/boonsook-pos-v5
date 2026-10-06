import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { callCreditRefundRpc, isCreditRefundMethod, readCreditRefundRequests } from "../modules/refund_credit_approval.js";

const config = { url: "https://example.invalid", anonKey: "public" };
const refundsSource = fs.readFileSync("modules/refunds.js", "utf8");

test("credit/exchange classification is exact", () => {
  assert.equal(isCreditRefundMethod("credit"), true);
  assert.equal(isCreditRefundMethod("exchange"), true);
  assert.equal(isCreditRefundMethod("cash"), false);
  assert.equal(isCreditRefundMethod("refund_credit"), false);
});

test("request uses only the approved RPC route and never writes a ledger row", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: 17, status: "pending" }) };
  };
  const result = await callCreditRefundRpc("phase646_submit_credit_refund", { p_sale_id: 3 }, { config, token: "jwt", fetchImpl });
  assert.deepEqual(result, { ok: true, data: { id: 17, status: "pending" } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rpc\/phase646_submit_credit_refund$/);
  assert.equal(calls[0].options.method, "POST");
  assert.doesNotMatch(calls[0].url, /customer_credit_ledger|\/refunds/);
});

test("unknown RPC and missing login fail closed without a network call", async () => {
  let called = 0;
  const fetchImpl = () => { called += 1; throw new Error("unreachable"); };
  assert.equal((await callCreditRefundRpc("redeem_customer_credit", {}, { config, token: "jwt", fetchImpl })).ok, false);
  assert.equal((await callCreditRefundRpc("phase646_submit_credit_refund", {}, { config, fetchImpl })).ok, false);
  assert.equal(called, 0);
});

test("HTTP denial, malformed success, and transport ambiguity are not success", async () => {
  const deps = { config, token: "jwt" };
  const denied = await callCreditRefundRpc("phase646_finalize_credit_refund", {}, { ...deps, fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(denied.ok, false);
  const malformed = await callCreditRefundRpc("phase646_finalize_credit_refund", {}, { ...deps, fetchImpl: async () => ({ ok: true, json: async () => null }) });
  assert.equal(malformed.ok, false);
  const unknown = await callCreditRefundRpc("phase646_admin_decide_credit_refund", {}, { ...deps, fetchImpl: async () => { throw new Error("timeout"); } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.uncertain, true);
});

test("request list is read-only and must return an array", async () => {
  const calls = [];
  const good = await readCreditRefundRequests({ config, token: "jwt", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => [{ id: 1, status: "pending" }] };
  } });
  assert.equal(good.ok, true);
  assert.equal(calls[0].options.method, undefined);
  assert.match(calls[0].url, /credit_refund_requests\?select=/);
  const bad = await readCreditRefundRequests({ config, token: "jwt", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(bad.ok, false);
});

test("approval UI is admin-only, escapes request text, and checks confirmed status", () => {
  const start = refundsSource.indexOf("let creditRequestPanel =");
  const end = refundsSource.indexOf("<!-- Summary -->", start);
  assert.ok(start >= 0 && end > start);
  const panel = refundsSource.slice(start, end);
  assert.match(panel, /_state\?\.profile\?\.role === "admin"/);
  assert.match(panel, /readCreditRefundRequests\(\)/);
  assert.match(panel, /escHtml\(q\.reason\)/);
  assert.match(panel, /q\.status === "pending"/);
  assert.match(panel, /q\.status === "approved"/);
  assert.match(panel, /q\.status === "manual_review"/);
  assert.match(panel, /พักตรวจมือ/);
  const events = refundsSource.slice(refundsSource.indexOf('for (const btn of container.querySelectorAll(".rf-approve-credit'));
  assert.match(events, /phase646_admin_decide_credit_refund/);
  assert.match(events, /phase646_finalize_credit_refund/);
  assert.match(events, /_state\?\.profile\?\.role !== "admin"/);
  assert.match(events, /result\.data\.status === "completed" && result\.data\.refund_id/);
  assert.match(events, /approve && result\.data\?\.status === "manual_review"/);
  assert.match(events, /result\.data\?\.status !== expectedStatus/);
  assert.match(events, /\["pending", "manual_review"\]\.includes\(submitted\.data\.status\)/);
  assert.doesNotMatch(events, /customer_credit_ledger/);
});
