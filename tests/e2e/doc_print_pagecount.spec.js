// Phase 617 — "พิมพ์แล้วได้กี่แผ่น" วัดจาก PDF จริงที่ Chromium สร้าง
//
// ทำไมต้องเป็น e2e ไม่ใช่ unit: บั๊กนี้เสียไป 4 รอบเพราะ guard เดิมอ่าน CSS เป็น "ข้อความ"
// แล้วบอกว่าผ่าน ทั้งที่ CSS ไฟล์นั้นไม่ได้ถูกใช้ตอนพิมพ์เลย (doc-override.js ดักปุ่มไปใช้
// doc-utils.PRINT_CSS แทน). test ที่เชื่อถือได้ต้องพิมพ์ออกมาจริงแล้วนับแผ่น
//
// อาการที่เจ้าของเจอ: ใบเสร็จ/ใบส่งสินค้าที่มีรายการเยอะ ออกมา 4 แผ่น (ควรเป็น 2 = ต้นฉบับ+สำเนา)

import { test, expect } from "@playwright/test";

// นับ /Type /Page (ไม่เอา /Pages) จาก PDF ดิบ — ไม่ต้องเพิ่ม dependency
function countPdfPages(buf) {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

const CASES = [
  { kind: "receipt", rows: 3, note: "สั้น — ต้องไม่ถูกย่อ" },
  { kind: "receipt", rows: 15, note: "ยาว — เคสที่เจ้าของเจอ" },
  { kind: "receipt", rows: 30, note: "ยาวมาก" },
  { kind: "delivery", rows: 3, note: "สั้น — ต้องไม่ถูกย่อ" },
  { kind: "delivery", rows: 15, note: "ยาว — เคสที่เจ้าของเจอ" },
  { kind: "delivery", rows: 30, note: "ยาวมาก" },
];

for (const c of CASES) {
  test(`พิมพ์ ${c.kind} ${c.rows} รายการ = 2 แผ่น (${c.note})`, async ({ page }) => {
    // ตัดฟอนต์ CDN ออกให้ผลคงที่ใน CI (ตัวย่อปรับตามฟอนต์ที่เรนเดอร์จริงอยู่แล้ว)
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

    await page.goto(`/tests/e2e/fixtures/doc-print.html?kind=${c.kind}&rows=${c.rows}`);
    await page.waitForFunction(() => window.__ready === true);

    let pdf;
    try {
      pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } catch {
      test.skip(true, "page.pdf() ต้องใช้ chromium แบบ headless");
      return;
    }

    const heights = await page.evaluate(() => window.__pageHeightsMm);
    const scales = await page.evaluate(() => window.__printScales);

    expect(countPdfPages(pdf), `สูง ${heights.join("/")}mm · zoom ${scales.join("/")}`).toBe(2);
    // ทุกหน้าต้องไม่เกิน A4 หลังย่อแล้ว
    for (const h of heights) expect(h).toBeLessThanOrEqual(297.5);
    // เอกสารสั้นห้ามถูกย่อ (ย่อทั้งที่ไม่จำเป็น = ตัวหนังสือเล็กลงโดยไม่มีเหตุผล)
    if (c.rows === 3) for (const s of scales) expect(s).toBe(1);
  });
}
