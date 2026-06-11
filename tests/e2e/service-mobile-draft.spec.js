import { expect, test } from "@playwright/test";

test.describe("Technician mobile drafts", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("service job drawer draft survives mobile app switching / remount", async ({ page }) => {
    await page.goto("/tests/e2e/fixtures/service-draft-fixture.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("bsk_service_draft:service_job_drawer"));

    await page.evaluate(async () => {
      const { bindServiceDraft } = await import("/modules/service_drafts.js");
      document.body.innerHTML = `
        <form id="serviceJobDrawer">
          <input id="serviceCustomer" />
          <input id="servicePhone" />
          <textarea id="serviceAddress"></textarea>
          <input id="serviceTitle" />
          <select id="serviceType"><option value="ac">ac</option><option value="cctv">cctv</option></select>
          <select id="serviceStatus"><option value="pending">pending</option><option value="progress">progress</option></select>
          <textarea id="serviceNote"></textarea>
          <input id="serviceLabor" />
          <input id="serviceDiscount" />
          <input id="serviceTotalCost" />
          <select id="servicePaymentMethod"><option value=""></option><option value="transfer">transfer</option></select>
        </form>
      `;

      const fields = [
        ["#serviceCustomer", "customer"],
        ["#servicePhone", "phone"],
        ["#serviceAddress", "address"],
        ["#serviceTitle", "title"],
        ["#serviceType", "type"],
        ["#serviceStatus", "status"],
        ["#serviceNote", "note"],
        ["#serviceLabor", "labor"],
        ["#serviceDiscount", "discount"],
        ["#serviceTotalCost", "totalCost"],
        ["#servicePaymentMethod", "paymentMethod"],
      ];
      bindServiceDraft(document.getElementById("serviceJobDrawer"), "service_job_drawer", fields, () => ({
        items: [{ product_id: 101, warehouse_id: 2, qty: 1, name: "compressor" }],
      }));
    });

    await page.locator("#serviceCustomer").fill("Somchai Mobile");
    await page.locator("#servicePhone").fill("0812345678");
    await page.locator("#serviceAddress").fill("99/1 mobile field address");
    await page.locator("#serviceTitle").fill("AC repair draft");
    await page.locator("#serviceType").selectOption("cctv");
    await page.locator("#serviceStatus").selectOption("progress");
    await page.locator("#serviceNote").fill("copy phone number from another app");
    await page.locator("#serviceLabor").fill("500");
    await page.locator("#serviceDiscount").fill("50");
    await page.locator("#serviceTotalCost").fill("450");
    await page.locator("#servicePaymentMethod").selectOption("transfer");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("bsk_service_draft:service_job_drawer")));
    expect(stored.fields).toMatchObject({
      customer: "Somchai Mobile",
      phone: "0812345678",
      address: "99/1 mobile field address",
      title: "AC repair draft",
      type: "cctv",
      status: "progress",
      note: "copy phone number from another app",
      labor: "500",
      discount: "50",
      totalCost: "450",
      paymentMethod: "transfer",
    });
    expect(stored.items).toEqual([{ product_id: 101, warehouse_id: 2, qty: 1, name: "compressor" }]);
    expect(stored.savedAt).toBeTruthy();

    await page.evaluate(async () => {
      const { applyDraftFields, loadServiceDraft } = await import("/modules/service_drafts.js");
      document.body.innerHTML = `
        <form id="serviceJobDrawer">
          <input id="serviceCustomer" />
          <input id="servicePhone" />
          <textarea id="serviceAddress"></textarea>
          <input id="serviceTitle" />
          <select id="serviceType"><option value="ac">ac</option><option value="cctv">cctv</option></select>
          <select id="serviceStatus"><option value="pending">pending</option><option value="progress">progress</option></select>
          <textarea id="serviceNote"></textarea>
          <input id="serviceLabor" />
          <input id="serviceDiscount" />
          <input id="serviceTotalCost" />
          <select id="servicePaymentMethod"><option value=""></option><option value="transfer">transfer</option></select>
        </form>
      `;
      const fields = [
        ["#serviceCustomer", "customer"],
        ["#servicePhone", "phone"],
        ["#serviceAddress", "address"],
        ["#serviceTitle", "title"],
        ["#serviceType", "type"],
        ["#serviceStatus", "status"],
        ["#serviceNote", "note"],
        ["#serviceLabor", "labor"],
        ["#serviceDiscount", "discount"],
        ["#serviceTotalCost", "totalCost"],
        ["#servicePaymentMethod", "paymentMethod"],
      ];
      applyDraftFields(document, loadServiceDraft("service_job_drawer"), fields);
    });

    await expect(page.locator("#serviceCustomer")).toHaveValue("Somchai Mobile");
    await expect(page.locator("#servicePhone")).toHaveValue("0812345678");
    await expect(page.locator("#serviceAddress")).toHaveValue("99/1 mobile field address");
    await expect(page.locator("#serviceTitle")).toHaveValue("AC repair draft");
    await expect(page.locator("#serviceType")).toHaveValue("cctv");
    await expect(page.locator("#serviceStatus")).toHaveValue("progress");
    await expect(page.locator("#serviceNote")).toHaveValue("copy phone number from another app");
    await expect(page.locator("#serviceLabor")).toHaveValue("500");
    await expect(page.locator("#serviceDiscount")).toHaveValue("50");
    await expect(page.locator("#serviceTotalCost")).toHaveValue("450");
    await expect(page.locator("#servicePaymentMethod")).toHaveValue("transfer");
  });

  test("edit-mode autosave guard does not overwrite a new-job mobile draft", async ({ page }) => {
    await page.goto("/tests/e2e/fixtures/service-draft-fixture.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("bsk_service_draft:service_job_drawer", JSON.stringify({
        fields: { customer: "Existing new job draft" },
        savedAt: "2026-06-11T00:00:00.000Z",
      }));
    });

    await page.evaluate(async () => {
      const { bindServiceDraft } = await import("/modules/service_drafts.js");
      document.body.innerHTML = `
        <form id="serviceJobDrawer">
          <input id="serviceCustomer" value="Edit job customer" />
        </form>
      `;
      bindServiceDraft(
        document.getElementById("serviceJobDrawer"),
        "service_job_drawer",
        [["#serviceCustomer", "customer"]],
        () => false
      );
    });

    await page.locator("#serviceCustomer").fill("Should not replace new draft");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("bsk_service_draft:service_job_drawer")));
    expect(stored.fields.customer).toBe("Existing new job draft");
  });
});
