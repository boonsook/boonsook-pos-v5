// Phase 558/560 — งานช่าง: โชว์ QR + เลขบัญชีเมื่อเลือก "โอน/QR" ในใบงานช่าง (UI additive, read-only)
// Run: node --test tests/service_form_qr_guard.test.js
//
// Why this exists:
//   drawer ใบงานช่าง (service_form.js) เมื่อช่างเลือก "🏦 โอน/QR" ควรโชว์ QR + ชื่อ/เลขบัญชีร้าน
//   (จาก state.paymentInfo) ให้ลูกค้าสแกนหน้างานได้ทันที.
//   ★ Phase 560: โชว์ "เฉพาะบัญชีที่งานประเภทนี้ผูก" (targetCoa = transfer_debit_code) ไม่ dump ทุกบัญชี.
//   ต้องเป็น read-only (ไม่ fetch/write/แตะ save/JV/stock/slip-verify) และ escape ทุก field กัน XSS.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { _svPayQrHtml } from "../modules/service_form.js";

const src = fs.readFileSync(path.resolve("modules/service_form.js"), "utf8");

// ── pure helper behavior ──────────────────────────────────────────────────────
const paymentInfo = {
  qrImage: "data:image/png;base64,QRMAIN",
  promptPay: "0812345678",
  banks: [
    { bankName: "กสิกรไทย", bankAccount: "123-4-56789-0", bankHolder: "ร้านบุญสุข", bankBranch: "สาขาทดสอบ", coaCode: "1134", qrImage: "data:image/png;base64,QRBANK" },
    { bankName: "", bankAccount: "" },  // ว่าง
  ],
};

test("transfer + targetCoa ตรงบัญชี → แสดง QR + เลขบัญชีของบัญชีนั้น", () => {
  const html = _svPayQrHtml(paymentInfo, "transfer", "1134");
  assert.match(html, /<img[^>]+QRBANK/, "มี QR ของบัญชีที่ผูก");
  assert.match(html, /123-4-56789-0/, "มีเลขบัญชี");
  assert.match(html, /กสิกรไทย/, "มีชื่อธนาคาร");
});

test("transfer + targetCoa ว่าง → QR หลักเท่านั้น (ไม่ dump ทุกบัญชี)", () => {
  const html = _svPayQrHtml(paymentInfo, "transfer", null);
  assert.match(html, /<img[^>]+QRMAIN/, "มี QR หลัก");
  assert.match(html, /0812345678/, "มีพร้อมเพย์");
  assert.ok(!html.includes("123-4-56789-0"), "targetCoa ว่าง = ไม่ dump บัญชี");
});

test("method ที่ไม่ใช่ transfer → คืน '' (เคลียร์กล่อง)", () => {
  assert.equal(_svPayQrHtml(paymentInfo, "cash", "1134"), "");
  assert.equal(_svPayQrHtml(paymentInfo, "", "1134"), "");
  assert.equal(_svPayQrHtml(paymentInfo, undefined, "1134"), "");
});

test("ไม่มี QR/บัญชี → ข้อความชวนไปตั้งใน Settings (ไม่ error)", () => {
  const html = _svPayQrHtml({ banks: [] }, "transfer", null);
  assert.match(html, /ตั้งค่า.*ข้อมูลการชำระเงิน/, "ชวนไป settings");
  assert.doesNotThrow(() => _svPayQrHtml(null, "transfer", "1134"), "paymentInfo null ไม่ throw");
  assert.doesNotThrow(() => _svPayQrHtml(undefined, "transfer", null), "paymentInfo undefined ไม่ throw");
});

test("targetCoa ไม่มีบัญชีตรง → ข้อความชวนตั้ง (ไม่ dump บัญชีอื่น)", () => {
  const html = _svPayQrHtml(paymentInfo, "transfer", "9999");
  assert.match(html, /COA 9999/, "บอกบัญชีเป้าหมาย");
  assert.ok(!html.includes("123-4-56789-0"), "ไม่ dump บัญชีอื่น");
});

test("XSS: ค่าจาก DB ถูก escape (ไม่มี < ดิบจาก field)", () => {
  const evil = { banks: [{ bankName: '<script>x</script>', bankAccount: '">bad', bankHolder: "<b>h", coaCode: "1134" }] };
  const html = _svPayQrHtml(evil, "transfer", "1134");
  assert.ok(!html.includes("<script>x</script>"), "bankName ต้องถูก escape");
  assert.match(html, /&lt;script&gt;/, "escape เป็น entity");
  assert.ok(!html.includes('">bad'), "bankAccount quote ถูก escape");
});

test("qrImage src ถูก escape (targetCoa ว่าง → QR หลัก)", () => {
  const html = _svPayQrHtml({ qrImage: 'data:image/png;"x' }, "transfer", null);
  assert.ok(!html.includes('"x"'), "qr src ที่มี quote ต้องถูก escape ก่อนใส่ attribute");
  assert.match(html, /&quot;/, "quote → &quot;");
});

// ── source guards ─────────────────────────────────────────────────────────────
test("template: มี container #svPayQrBox ใต้ช่องวิธีรับเงิน", () => {
  assert.match(src, /id="svPayQrBox"/, "มี div#svPayQrBox ใน template");
});

test("wire: handler #svPaymentMethod change → render (async resolve targetCoa)", () => {
  assert.match(src, /querySelector\("#svPaymentMethod"\)/, "อ้าง select วิธีรับเงิน");
  assert.match(src, /addEventListener\("change",\s*_renderPayQr\)/, "ผูก change event");
  assert.match(src, /_renderPayQr\(\);/, "render ครั้งแรก (งาน/ร่างที่ transfer โชว์ทันที)");
  assert.match(src, /getServiceTransferCoa\(cfg\.job_type\)/, "resolve targetCoa ตาม job_type");
  assert.match(src, /method !== "transfer"\)\s*return ""/, "helper เงื่อนไข transfer เท่านั้น");
});

test("source: อ่าน state.paymentInfo/banks/qrImage (ไม่ hardcode บัญชี)", () => {
  assert.match(src, /_svPayQrHtml\(state\?\.paymentInfo/, "wire อ่านจาก state.paymentInfo");
  assert.match(src, /pi\.banks/, "อ่าน banks");
  assert.match(src, /pi\.qrImage/, "อ่าน qrImage");
  assert.match(src, /pi\.promptPay/, "อ่าน promptPay");
});

test("source: ทุก field ห่อ escHtml (กัน XSS)", () => {
  const m = src.match(/export function _svPayQrHtml[\s\S]+?\n}/);
  assert.ok(m, "หา _svPayQrHtml เจอ");
  const body = m[0];
  for (const f of ["src", "pi.promptPay", "bank.bankName", "bank.bankAccount", "bank.bankHolder", "bank.bankBranch", "bank.qrImage", "targetCoa"]) {
    assert.ok(body.includes(`escHtml(${f}`), `${f} ต้องห่อ escHtml`);
  }
});

test("read-only: helper ไม่มี fetch/xhr/PATCH/POST/write ใด ๆ", () => {
  const m = src.match(/export function _svPayQrHtml[\s\S]+?\n}/);
  const body = m[0];
  assert.doesNotMatch(body, /fetch\(|xhrPost|xhrPatch|\.upsert\(|\.insert\(|\.update\(|method:\s*["'](POST|PATCH|PUT|DELETE)/i, "helper ต้อง read-only");
});

test("ไม่แตะ POS/save/JV: helper ไม่อ้าง saleId/postJournal/deductStock", () => {
  const m = src.match(/export function _svPayQrHtml[\s\S]+?\n}/);
  const body = m[0];
  assert.doesNotMatch(body, /postJournal|deductStock|saveBtn|svSaveBtn|status/i, "helper คุมแค่ display");
});
