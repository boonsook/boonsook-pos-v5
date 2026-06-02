// Phase 351 — service-job-air-source-visibility guard
// Run: node --test tests/air_job_meta.test.js
//
// Contract: detect "งานจากแคตตาล็อกแอร์" by parsing the EXISTING note marker (source=air_catalog)
// that build 350 writes — read-only, no DB column, no stock/POS/cart. Normal jobs get no badge.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { parseAirJobMeta, airBadgeHtml, airJobInfoHtml, airPriority, airPriorityBadgeHtml } = await import("../modules/air_job_meta.js");

// note exactly as build 350 writes it (prefill + appointment appended at submit)
const AIR_NOTE = "[source=air_catalog] แอร์ติดผนัง TCL วอลไทป์ MFS10 9,000 BTU · ราคาเสนอ 12,900 บาท | สเปก น้ำยา R32 | ประกัน ติดตั้ง 1 ปี | นัดหมาย 2026-06-10 ช่วงเช้า (09:00–12:00)";
const AIR_DESC = "จองติดตั้งแอร์ TCL วอลไทป์ MFS10 9,000 BTU";

test("parses a booking air job (intent/summary/btu/price/appointment)", () => {
  const m = parseAirJobMeta({ note: AIR_NOTE, description: AIR_DESC });
  assert.equal(m.isAir, true);
  assert.equal(m.intent, "booking");
  assert.equal(m.intentLabel, "สั่งจอง");
  assert.match(m.summary, /แอร์ติดผนัง TCL วอลไทป์ MFS10 9,000 BTU · ราคาเสนอ 12,900 บาท/);
  assert.ok(!m.summary.includes("|"), "summary must stop at first segment");
  assert.equal(m.btu, "9,000");
  assert.equal(m.price, "฿12,900");
  assert.match(m.appointment, /2026-06-10/);
});

test("ask_price intent detected (price=ต้องเช็คราคา)", () => {
  const m = parseAirJobMeta({ note: "[source=air_catalog] แอร์ติดผนัง Mitsu ASK 12,000 BTU · ต้องเช็คราคา", description: "สอบถามราคาแอร์ Mitsu ASK 12,000 BTU" });
  assert.equal(m.isAir, true);
  assert.equal(m.intent, "ask");
  assert.equal(m.intentLabel, "สอบถามราคา");
  assert.equal(m.price, "ต้องเช็คราคา");
});

test("normal jobs get no air badge", () => {
  assert.equal(parseAirJobMeta({ note: "งานซ่อมแอร์ทั่วไป ลูกค้าโทรแจ้ง", description: "แอร์ไม่เย็น" }).isAir, false);
  assert.equal(parseAirJobMeta({ note: "SH-transfer|...", description: "📱 สั่งซื้อผ่านเว็บ" }).isAir, false);
});

test("malformed / missing data does not crash", () => {
  for (const j of [null, undefined, {}, { note: null }, { note: "source=air_catalog" }, { description: "source=air_catalog" }]) {
    const m = parseAirJobMeta(j);
    assert.equal(typeof m.isAir, "boolean");
  }
  // marker only in note (not description) per build 350
  assert.equal(parseAirJobMeta({ note: "source=air_catalog" }).isAir, true);
  assert.equal(parseAirJobMeta({ description: "source=air_catalog" }).isAir, false);
});

test("badge + info html render for air jobs only, and escape content", () => {
  const m = parseAirJobMeta({ note: AIR_NOTE, description: AIR_DESC });
  assert.match(airBadgeHtml(m), /จากแคตตาล็อกแอร์/);
  assert.match(airBadgeHtml(m), /สั่งจอง/);
  assert.match(airJobInfoHtml(m), /รายการจากแคตตาล็อกแอร์/);
  assert.match(airJobInfoHtml(m), /นัดหมายที่ลูกค้าเลือก/);
  // non-air → empty info
  assert.equal(airJobInfoHtml({ isAir: false }), "");
  // XSS-safe
  const evil = parseAirJobMeta({ note: '[source=air_catalog] <img onerror=alert(1)> BTU', description: "" });
  assert.ok(!airJobInfoHtml(evil).includes("<img"), "must escape angle brackets in summary");
});

// ── source guards: read-only, wired into both job lists, no stock/POS/cart/schema ──
test("air_job_meta is read-only (no network / storage / stock)", () => {
  const src = fs.readFileSync(path.resolve("modules/air_job_meta.js"), "utf8");
  for (const banned of [/fetch\(/, /localStorage/, /sessionStorage/, /SUPABASE_CONFIG/, /addToCart/, /\.stock\s*=/, /rest\/v1/]) {
    assert.ok(!banned.test(src), `air_job_meta must not reference ${banned}`);
  }
});

test("service_jobs list shows the air badge (read-only) without stock/POS/quotation changes", () => {
  const sj = fs.readFileSync(path.resolve("modules/service_jobs.js"), "utf8");
  assert.match(sj, /import \{[^}]*\bparseAirJobMeta\b[^}]*\bairBadgeHtml\b[^}]*\bairJobInfoHtml\b[^}]*\} from "\.\/air_job_meta\.js"/);
  assert.match(sj, /airMeta\.isAir \? airBadgeHtml\(airMeta\)/);
  assert.match(sj, /airMeta\.isAir \? airJobInfoHtml\(airMeta\)/);
  for (const banned of [/addToCart/, /\.stock\s*=/, /saveQuotationFull/, /from\(["']products["']\)/, /alter table/i]) {
    assert.ok(!banned.test(sj), `service_jobs must not add ${banned}`);
  }
});

test("customer dashboard 'งานของฉัน' shows the air badge", () => {
  const cd = fs.readFileSync(path.resolve("modules/customer_dashboard.js"), "utf8");
  assert.match(cd, /import \{ parseAirJobMeta, airBadgeHtml, airJobInfoHtml \} from "\.\/air_job_meta\.js"/);
  assert.match(cd, /airMeta\.isAir \? `<div[^`]*airBadgeHtml\(airMeta\)/);
});

// ── Phase 352: priority derive ───────────────────────────────────────────────
test("priority: appointment → มีวันนัดหมาย (highest)", () => {
  const m = parseAirJobMeta({ note: AIR_NOTE, description: AIR_DESC });
  assert.equal(airPriority(m).key, "scheduled");
  assert.equal(airPriority(m).label, "มีวันนัดหมาย");
});

test("priority: booking w/o appointment → รอนัดหมาย; ask → รอยืนยันราคา", () => {
  const booking = parseAirJobMeta({ note: "[source=air_catalog] แอร์ติดผนัง TCL MFS10 9,000 BTU · ราคาเสนอ 12,900 บาท", description: "จองติดตั้งแอร์ TCL MFS10" });
  assert.equal(airPriority(booking).key, "await_schedule");
  assert.equal(airPriority(booking).label, "รอนัดหมาย");
  const ask = parseAirJobMeta({ note: "[source=air_catalog] แอร์ติดผนัง Mitsu ASK 12,000 BTU · ต้องเช็คราคา", description: "สอบถามราคาแอร์ Mitsu ASK" });
  assert.equal(airPriority(ask).key, "await_price");
  assert.equal(airPriority(ask).label, "รอยืนยันราคา");
});

test("priority: marker only / incomplete → รอตรวจสอบ ; non-air → null", () => {
  assert.equal(airPriority(parseAirJobMeta({ note: "source=air_catalog" })).key, "review");
  assert.equal(airPriority({ isAir: false }), null);
  assert.equal(airPriorityBadgeHtml({ isAir: false }), "");
  assert.match(airPriorityBadgeHtml(parseAirJobMeta({ note: AIR_NOTE })), /มีวันนัดหมาย/);
});

// ── Phase 352: service_jobs source filter ────────────────────────────────────
test("service_jobs has an air/general source filter (read-only, no schema/stock/POS)", () => {
  const sj = fs.readFileSync(path.resolve("modules/service_jobs.js"), "utf8");
  assert.match(sj, /let _sjSourceFilter = "all"/);
  // chips for all / air / general
  assert.match(sj, /data-sj-source="\$\{key\}"/);
  assert.match(sj, /srcChip\("air",[^)]*cAir\)/);
  assert.match(sj, /srcChip\("general",[^)]*cGeneral\)/);
  // filter applies via parseAirJobMeta
  assert.match(sj, /_sjSourceFilter === "air"\)\s*jobs = jobs\.filter\(j => parseAirJobMeta\(j\)\.isAir\)/);
  assert.match(sj, /_sjSourceFilter === "general"\)\s*jobs = jobs\.filter\(j => !parseAirJobMeta\(j\)\.isAir\)/);
  // handler re-renders
  assert.match(sj, /data-sj-source\]"\)\.forEach\(btn => btn\.addEventListener\("click"[\s\S]*?_sjSourceFilter = btn\.dataset\.sjSource/);
  // priority badge rendered for air jobs
  assert.match(sj, /airMeta\.isAir \? airPriorityBadgeHtml\(airMeta\)/);
  // no stock/POS/cart/quotation/schema introduced
  for (const banned of [/addToCart/, /\.stock\s*=/, /saveQuotationFull/, /from\(["']products["']\)/, /alter table/i]) {
    assert.ok(!banned.test(sj), `service_jobs must not add ${banned}`);
  }
});
