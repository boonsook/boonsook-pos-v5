import { test, expect } from "@playwright/test";

const FIXTURE = "/__attendance__/index.html";
async function boot(page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.route(`**${FIXTURE}`, route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/phase4-design-system.css"><link rel="stylesheet" href="/phase4-components.css"><div id="page-time_clock"></div>' }));
  await page.goto(FIXTURE);
  await page.evaluate(async () => {
    window.__calls = [];
    window.__fail = false;
    window.__hold = false;
    window.__toasts = [];
    window._tcSyncing = true; // synthetic fixture: never drains real offline data
    window.SUPABASE_CONFIG = { url: "https://fixture.invalid", anonKey: "fixture" };
    window.fetch = async (raw, init = {}) => {
      const url = new URL(raw);
      window.__calls.push({ method: init.method || "GET", url: String(raw) });
      if (init.method && init.method !== "GET") throw new Error("Unexpected write");
      const q = url.searchParams;
      if (q.get("select") === "*") return new Response("[]", { status: 200 });
      if (window.__hold) await new Promise(resolve => { window.__release = resolve; });
      if (window.__fail) return new Response("[]", { status: 403 });
      const from = q.getAll("work_date")[0].slice(4);
      const rows = [1, 2].map(id => ({ id, user_id: "a", work_date: from, clock_in_at: from + "T01:00:00Z", clock_out_at: id === 1 ? from + "T10:00:00Z" : null }));
      return new Response(JSON.stringify(rows), { headers: { "Content-Range": "0-1/2" } });
    };
    const { renderTimeClockPage } = await import("/modules/time_clock.js");
    await renderTimeClockPage({ state: { profile: { id: "owner", role: "admin" }, allProfiles: [{ id: "a", full_name: '<img src=x onerror="window.__xss=1">', role: "technician" }, { id: "b", full_name: "พนักงาน B", role: "sales" }] }, showToast: m => window.__toasts.push(m) });
  });
  await expect(page.locator("#tcAttendanceSummary")).toContainText("รวม 1 คน-วัน");
}

for (const width of [390, 1280]) {
  test(`manager summary ${width}px: unique days, presets, empty staff, escaped names, GET only`, async ({ page }) => {
    await boot(page, width);
    const panel = page.locator("#tcAttendanceSummary");
    await expect(panel.locator("tbody tr")).toHaveCount(2);
    await expect(panel.locator("img")).toHaveCount(0);
    await expect(panel).toContainText("พนักงาน B");
    await panel.getByRole("button", { name: "สัปดาห์นี้ (จ.–อา.)" }).click();
    await expect(panel).toContainText("รวม 1 คน-วัน");
    const from = await panel.getByLabel("สรุปจากวันที่").inputValue();
    expect(new Date(from + "T00:00:00Z").getUTCDay()).toBe(1);
    await panel.getByRole("button", { name: "เดือนนี้", exact: true }).click();
    await expect(panel).toContainText("รวม 1 คน-วัน");
    expect((await panel.getByLabel("สรุปจากวันที่").inputValue()).endsWith("-01")).toBe(true);
    await expect(page.locator("#tcClockInBtn")).toBeVisible();
    expect(await page.evaluate(() => window.__calls.every(c => c.method === "GET"))).toBe(true);
    expect(await panel.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/attendance-${width}.png`, fullPage: true });
  });
}
test("range validation, failure does not display zero, recovery and latest request wins", async ({ page }) => {
  await boot(page);
  const panel = page.locator("#tcAttendanceSummary");
  await panel.getByLabel("สรุปจากวันที่").fill("2026-10-07");
  await panel.getByLabel("สรุปถึงวันที่").fill("2026-10-01");
  await panel.getByRole("button", { name: "ดูสรุป", exact: true }).click();
  await expect(panel).toContainText("กรุณาระบุวันที่");
  await page.evaluate(() => { window.__fail = true; });
  await panel.getByRole("button", { name: "เดือนนี้", exact: true }).click();
  await expect(panel).toContainText("อ่านข้อมูลลงเวลาไม่สำเร็จ");
  await expect(panel.locator("tbody")).toHaveCount(0);
  await page.evaluate(() => { window.__fail = false; window.__hold = true; });
  await panel.getByRole("button", { name: "เดือนนี้", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__release)).toBe("function");
  await page.evaluate(() => { window.__hold = false; });
  await panel.getByRole("button", { name: "สัปดาห์นี้ (จ.–อา.)" }).click();
  await expect(panel).toContainText("รวม 1 คน-วัน");
  const before = await panel.locator("[data-summary-result]").innerText();
  await page.evaluate(() => window.__release());
  await expect(panel.locator("[data-summary-result]")).toHaveText(before, { useInnerText: true });
});
