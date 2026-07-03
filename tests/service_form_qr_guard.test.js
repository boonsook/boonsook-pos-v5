// Phase 558 — งานช่าง: โชว์ QR + เลขบัญชีเมื่อเลือก "โอน/QR" ในใบงานช่าง (UI additive, read-only)
// Run: node --test tests/service_form_qr_guard.test.js
//
// Why this exists:
//   drawer ใบงานช่าง (service_form.js) เมื่อช่างเลือก "🏦 โอน/QR → Dr 1130" ควรโชว์ QR พร้อมเพย์ +
//   ชื่อ/เลขบัญชีร้าน (จาก state.paymentInfo ที่ตั้งใน Settings) ให้ลูกค้าสแกนหน้างานได้ทันที.
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
    { bankName: "กสิกรไทย", bankAccount: "123-4-56789-0", bankHolder: "ร้านบุญสุข", bankBranch: "สาขาทดสอบ", qrImage: "data:image/png;base64,QRBANK" },
    { bankName: "", bankAccount: "" },  // ว่าง → ต้องถูกข้าม
  ],
};

test("transfer → แสดง QR + เลขบัญชี + พร้อมเพย์", () => {
  const html = _svPayQrHtml(paymentInfo, "transfer");
  assert.match(html, /<img[^>]+QRMAIN/, "มี QR หลัก");
  assert.match(html, /123-4-56789-0/, "มีเลขบัญชี");
  assert.match(html, /กสิกรไทย/, "มีชื่อธนาคาร");
  assert.match(html, /0812345678/, "มีพร้อมเพย์");
});

test("method ที่ไม่ใช่ transfer → คืน '' (เคลียร์กล่อง)", () => {
  assert.equal(_svPayQrHtml(paymentInfo, "cash"), "");
  assert.equal(_svPayQrHtml(paymentInfo, ""), "");
  assert.equal(_svPayQrHtml(paymentInfo, undefined), "");
});

test("ไม่มี QR/บัญชี → ข้อความชวนไปตั้งใน Settings (ไม่ error)", () => {
  const html = _svPayQrHtml({ banks: [] }, "transfer");
  assert.match(html, /ตั้งค่า.*ข้อมูลการชำระเงิน/, "ชวนไป settings");
  assert.doesNotThrow(() => _svPayQrHtml(null, "transfer"), "paymentInfo null ไม่ throw");
  assert.doesNotThrow(() => _svPayQrHtml(undefined, "transfer"), "paymentInfo undefined ไม่ throw");
});

test("บัญชีที่ไม่มีชื่อ/เลข ถูกข้าม (ไม่ render การ์ดว่าง)", () => {
  const html = _svPayQrHtml({ banks: [{ bankName: "", bankAccount: "" }] }, "transfer");
  // ไม่มี bank card + ไม่มี qr/promptPay → fallback settings hint
  assert.match(html, /ตั้งค่า/, "การ์ดว่างถูกข้าม → เหลือ hint");
});

test("XSS: ค่าจาก DB ถูก escape (ไม่มี < ดิบจาก field)", () => {
  const evil = { banks: [{ bankName: '<script>x</script>', bankAccount: '">bad', bankHolder: "<b>h" }] };
  const html = _svPayQrHtml(evil, "transfer");
  assert.ok(!html.includes("<script>x</script>"), "bankName ต้องถูก escape");
  assert.match(html, /&lt;script&gt;/, "escape เป็น entity");
  assert.ok(!html.includes('">bad'), "bankAccount quote ถูก escape");
});

test("qrImage src ถูก escape (ตามต้นแบบ customer_dashboard)", () => {
  const html = _svPayQrHtml({ qrImage: 'data:image/png;"x' }, "transfer");
  assert.ok(!html.includes('"x"'), "qr src ที่มี quote ต้องถูก escape ก่อนใส่ attribute");
  assert.match(html, /&quot;/, "quote → &quot;");
});

// ── source guards ─────────────────────────────────────────────────────────────
test("template: มี container #svPayQrBox ใต้ช่องวิธีรับเงิน", () => {
  assert.match(src, /id="svPayQrBox"/, "มี div#svPayQrBox ใน template");
});

test("wire: handler #svPaymentMethod change → render + เงื่อนไข transfer", () => {
  assert.match(src, /querySelector\("#svPaymentMethod"\)/, "อ้าง select วิธีรับเงิน");
  assert.match(src, /addEventListener\("change",\s*_renderPayQr\)/, "ผูก change event");
  assert.match(src, /_renderPayQr\(\);/, "render ครั้งแรก (งาน/ร่างที่ transfer โชว์ทันที)");
  assert.match(src, /method !== "transfer"\)\s*return ""/, "helper เงื่อนไข transfer เท่านั้น");
});

test("source: อ่าน state.paymentInfo/banks/qrImage (ไม่ hardcode บัญชี)", () => {
  assert.match(src, /_svPayQrHtml\(state\?\.paymentInfo/, "wire อ่านจาก state.paymentInfo");
  assert.match(src, /pi\.banks/, "อ่าน banks");
  assert.match(src, /pi\.qrImage/, "อ่าน qrImage");
  assert.match(src, /pi\.promptPay/, "อ่าน promptPay");
});

test("source: ทุก field ห่อ escHtml (กัน XSS)", () => {
  // ดึงเฉพาะ body ของ _svPayQrHtml มาตรวจว่าไม่มีการต่อ field ดิบเข้า HTML โดยไม่ escHtml
  const m = src.match(/export function _svPayQrHtml[\s\S]+?\n}/);
  assert.ok(m, "หา _svPayQrHtml เจอ");
  const body = m[0];
  // match escHtml( ตามด้วย field-start (รองรับทั้ง escHtml(x) และ escHtml(x || "default"))
  for (const f of ["qrSrc", "promptPay", "bank.bankName", "bank.bankAccount", "bank.bankHolder", "bank.bankBranch", "bank.qrImage"]) {
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
