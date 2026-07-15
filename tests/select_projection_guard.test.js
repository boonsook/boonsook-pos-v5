// Phase 606-b1.1 — test ของ projection helper เอง (acceptance: helper ต้องมี test ของตัวเอง)
import test from "node:test";
import assert from "node:assert/strict";
import { selectFieldsOf, projectRow, projectRows } from "./_select_projection.js";

const ROW = { id: 7, job_no: "JOB-7", job_type: "ac", customer_name: "ก", total_cost: 1000, finance_flow_version: 2, note: "x" };

test("selectFieldsOf: ไม่มี select= / select=* / select ว่าง → null (คืนแถวเต็ม)", () => {
  assert.equal(selectFieldsOf("https://x/rest/v1/service_jobs?id=eq.7"), null);
  assert.equal(selectFieldsOf("https://x/rest/v1/service_jobs?select=*&id=eq.7"), null);
  assert.equal(selectFieldsOf("https://x/rest/v1/service_jobs?select=&id=eq.7"), null);
});

test("selectFieldsOf: อ่าน field list ได้ทั้งแบบตรงและ URL-encoded", () => {
  assert.deepEqual(selectFieldsOf("https://x/rest/v1/service_jobs?select=id,total_cost&id=eq.7"),
    ["id", "total_cost"]);
  assert.deepEqual(selectFieldsOf("https://x/rest/v1/service_jobs?select=id%2Ctotal_cost"),
    ["id", "total_cost"]);
  // select= อยู่กลาง query string ก็ต้องเจอ (ไม่ใช่เฉพาะ param แรก)
  assert.deepEqual(selectFieldsOf("https://x/rest/v1/service_jobs?id=eq.7&select=id,job_no"),
    ["id", "job_no"]);
});

test("projectRows: ตัดเฉพาะ field ที่ select — field ที่ไม่ได้ขอ ต้องไม่โผล่", () => {
  const out = projectRows([ROW], "https://x/rest/v1/service_jobs?select=id,job_no,total_cost&id=eq.7");
  assert.deepEqual(out, [{ id: 7, job_no: "JOB-7", total_cost: 1000 }]);
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], "finance_flow_version"), false);
});

test("projectRows: select field ที่ fixture ไม่มี → field นั้นหายไป (ไม่ใช่ undefined/0)", () => {
  const out = projectRows([{ id: 1 }], "https://x/r?select=id,total_cost");
  assert.deepEqual(out, [{ id: 1 }]);
  assert.equal("total_cost" in out[0], false);
});

test("projectRows: select=* คืนแถวเต็ม + ไม่ mutate fixture เดิม", () => {
  const before = JSON.stringify(ROW);
  const full = projectRows([ROW], "https://x/r?select=*");
  assert.deepEqual(full[0], ROW);
  const cut = projectRows([ROW], "https://x/r?select=id");
  assert.deepEqual(cut, [{ id: 7 }]);
  assert.equal(JSON.stringify(ROW), before, "fixture ต้องไม่ถูกแก้");
});

test("projectRow: fields=null คืน row เดิมตรง ๆ (reference เดิม — ไม่ project)", () => {
  assert.equal(projectRow(ROW, null), ROW);
  assert.equal(projectRow(null, ["id"]), null);
});
