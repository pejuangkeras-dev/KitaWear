import { test, expect } from "@playwright/test";

const BASE_URL = process.env.MARKETKITA_BASE_URL || "https://91c96265.marketkita.pages.dev";

test.describe("MarketKita Admin Center", () => {
  test("admin page loads and login control is usable", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/MarketKita.*Admin Center/i);

    const loginScreen = page.locator("#loginScreen");
    const adminApp = page.locator("#adminApp");
    await expect(loginScreen.or(adminApp)).toBeVisible({ timeout: 15000 });

    if (await loginScreen.isVisible()) {
      await expect(page.locator("#loginEmail")).toBeVisible();
      await expect(page.locator("#loginPassword")).toBeVisible();
      const loginButton = page.locator("#loginBtn");
      await expect(loginButton).toBeVisible();
      await expect(loginButton).toBeEnabled();
      await loginButton.click();
      await expect(loginButton).toBeVisible();
    } else {
      await expect(adminApp).toBeVisible();
      await expect(page.locator("#logoutBtn")).toBeVisible();
    }

    expect(errors, `Browser page errors: ${errors.join(" | ")}`).toEqual([]);
  });



  test("Admin Center contains all Priority 8 panels and no failed static requests", async ({ page }) => {
    const errors = [];
    const failedResponses = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (response.status() >= 400 && response.request().resourceType() !== "image") {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });

    const requiredPanels = [
      "#adminCatalogPanel",
      "#adminReviewsPanel",
      "#adminShippingPanel",
      "#adminRefundsPanel",
      "#adminAuditPanel",
      "#adminSettingsPanel",
      "#phase3BusinessPanel",
      "#phase3VoucherPanel",
      "#disputesContainer"
    ];

    for (const selector of requiredPanels) {
      await expect(page.locator(selector)).toBeAttached();
    }

    const requiredControls = [
      "#adminCatalogRefresh",
      "#adminCatalogSearch",
      "#adminCatalogStatus",
      "#adminReviewsRefresh",
      "#adminShippingRefresh",
      "#adminRefundsRefresh",
      "#adminAuditRefresh",
      "#adminHealthRefresh",
      "#p3AdminRefresh",
      "#p3VoucherRefresh",
      "#refreshDisputesBtn"
    ];

    for (const selector of requiredControls) {
      await expect(page.locator(selector)).toBeAttached();
    }

    expect(errors, `Browser page errors: ${errors.join(" | ")}`).toEqual([]);
    expect(failedResponses, `Failed requests: ${failedResponses.join(" | ")}`).toEqual([]);
  });

  test("admin login works when local credentials are supplied", async ({ page }) => {
    const emailValue = process.env.MARKETKITA_ADMIN_EMAIL;
    const passwordValue = process.env.MARKETKITA_ADMIN_PASSWORD;

    test.skip(!emailValue || !passwordValue, "Set MARKETKITA_ADMIN_EMAIL and MARKETKITA_ADMIN_PASSWORD to run authenticated login.");

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });

    if (await page.locator("#adminApp").isVisible()) return;

    await page.locator("#loginEmail").fill(emailValue);
    await page.locator("#loginPassword").fill(passwordValue);
    await page.locator("#loginBtn").click();

    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#logoutBtn")).toBeVisible();
    await expect(page.locator("text=Admin Center")).toBeVisible();
  });
});
