// Phase 617 — "พิมพ์แล้วได้กี่แผ่น + หน้าตายังเต็มแผ่นไหม" วัดจาก PDF จริงที่ Chromium สร้าง
//
// ทำไมต้องเป็น e2e ไม่ใช่ unit: บั๊กนี้เสียไป 4 รอบเพราะ guard เดิมอ่าน CSS เป็น "ข้อความ"
// แล้วบอกว่าผ่าน ทั้งที่ CSS ไฟล์นั้นไม่ได้ถูกใช้ตอนพิมพ์เลย (doc-override.js ดักปุ่มไปใช้
// doc-utils.PRINT_CSS แทน). test ที่เชื่อถือได้ต้องพิมพ์ออกมาจริงแล้วนับแผ่น
//
// รอบแก้ที่ 5 พลาดอีกแบบ: ได้ 2 แผ่นก็จริง แต่ zoom ย่อทั้งกว้างและสูง เอกสารเลยหดไปกอง
// มุมซ้ายบนเหลือครึ่งแผ่น → test จึงต้องคุม "ความกว้างที่เรนเดอร์" และ "ย่อเท่ากันทุกขนาดหน้าต่าง" ด้วย

import { test, expect } from "@playwright/test";

// นับ /Type /Page (ไม่เอา /Pages) จาก PDF ดิบ — ไม่ต้องเพิ่ม dependency
function countPdfPages(buf) {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

async function render(page, kind, rows, viewport) {
  // ตัดฟอนต์ CDN ออกให้ผลคงที่ใน CI (ตัวย่อปรับตามฟอนต์ที่เรนเดอร์จริงอยู่แล้ว)
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`/tests/e2e/fixtures/doc-print.html?kind=${kind}&rows=${rows}`);
  await page.waitForFunction(() => window.__ready === true);
  return page.evaluate(() => ({
    scales: window.__printScales,
    heights: window.__pageHeightsMm,
    widths: window.__pageWidthsMm,
  }));
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
  test(`พิมพ์ ${c.kind} ${c.rows} รายการ = 2 แผ่นเต็มหน้า (${c.note})`, async ({ page }) => {
    const m = await render(page, c.kind, c.rows);

    let pdf;
    try {
      pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } catch {
      test.skip(true, "page.pdf() ต้องใช้ chromium แบบ headless");
      return;
    }
    const info = `สูง ${m.heights.join("/")}mm · กว้าง ${m.widths.join("/")}mm · zoom ${m.scales.join("/")}`;

    expect(countPdfPages(pdf), info).toBe(2);
    for (const h of m.heights) expect(h, info).toBeLessThanOrEqual(297.5);
    // ★ ต้องเต็มความกว้างกระดาษเสมอ — ย่อแล้วหดไปครึ่งแผ่นคือบั๊ก ไม่ใช่ "พอดีหน้า"
    for (const w of m.widths) expect(Math.abs(w - 210), info).toBeLessThanOrEqual(1);
    // ★ และต้องเต็มความสูงด้วย (min-height ชดเชยแล้ว) ไม่ใช่เนื้อหาลอยอยู่ครึ่งบน
    for (const h of m.heights) expect(h, info).toBeGreaterThanOrEqual(290);
    // เอกสารสั้นห้ามถูกย่อ (ย่อทั้งที่ไม่จำเป็น = ตัวหนังสือเล็กลงโดยไม่มีเหตุผล)
    if (c.rows === 3) for (const s of m.scales) expect(s, info).toBe(1);
  });
}

// หน้าต่างพิมพ์ของจริงเปิดด้วย window.open(...,"width=900,height=700") และจอผู้ใช้ scale 125-150%
// → viewport แคบกว่ากระดาษ ถ้าวัดตามความกว้างหน้าต่างจะย่อเกินจำเป็นมาก
test("ตัวย่อต้องไม่ขึ้นกับขนาดหน้าต่าง (จอ scale 125-150% ต้องได้ผลเดียวกัน)", async ({ page }) => {
  const wide = await render(page, "receipt", 15, { width: 1280, height: 900 });
  const narrow = await render(page, "receipt", 15, { width: 520, height: 700 });
  expect(narrow.scales, `กว้าง ${JSON.stringify(wide.scales)} · แคบ ${JSON.stringify(narrow.scales)}`)
    .toEqual(wide.scales);
  for (const w of narrow.widths) expect(Math.abs(w - 210)).toBeLessThanOrEqual(1);
});
