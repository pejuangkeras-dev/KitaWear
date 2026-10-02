import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.MARKETKITA_BASE_URL ||
  "https://91c96265.marketkita.pages.dev";

async function loginAsAdmin(page) {
  const emailValue = process.env.MARKETKITA_ADMIN_EMAIL;
  const passwordValue = process.env.MARKETKITA_ADMIN_PASSWORD;

  test.skip(
    !emailValue || !passwordValue,
    "Set MARKETKITA_ADMIN_EMAIL and MARKETKITA_ADMIN_PASSWORD to run authenticated Admin Center tests."
  );

  await page.goto(`${BASE_URL}/admin`, {
    waitUntil: "domcontentloaded"
  });

  const loginScreen = page.locator("#loginScreen");
  const adminApp = page.locator("#adminApp");

  if (await loginScreen.isVisible()) {
    await page.locator("#loginEmail").fill(emailValue);
    await page.locator("#loginPassword").fill(passwordValue);
    await page.locator("#loginBtn").click();
  }

  await expect(adminApp).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#logoutBtn")).toBeVisible();

  return { emailValue, passwordValue };
}

test.describe("MarketKita Admin Center", () => {
  test("admin page loads and login control is usable", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.goto(`${BASE_URL}/admin`, {
      waitUntil: "domcontentloaded"
    });
    await expect(page).toHaveTitle(/MarketKita.*Admin Center/i);

    const loginScreen = page.locator("#loginScreen");
    const adminApp = page.locator("#adminApp");

    await expect
      .poll(
        async () =>
          (await loginScreen.isVisible()) ||
          (await adminApp.isVisible()),
        {
          timeout: 15000,
          message: "Login screen atau Admin App tidak tampil"
        }
      )
      .toBe(true);

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

    expect(
      errors,
      `Browser page errors: ${errors.join(" | ")}`
    ).toEqual([]);
  });

  test("admin login works when local credentials are supplied", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    await loginAsAdmin(page);

    await expect(page.locator("text=Admin Center")).toBeVisible();

    expect(
      errors,
      `Browser page errors: ${errors.join(" | ")}`
    ).toEqual([]);
  });

  test("Priority 8 Admin Center is complete after authentication", async ({ page }) => {
    const errors = [];
    const failedApiResponses = [];

    page.on("pageerror", error => errors.push(error.message));

    page.on("response", response => {
      const type = response.request().resourceType();
      const url = response.url();

      if (
        response.status() >= 400 &&
        (type === "xhr" || type === "fetch") &&
        (url.includes("/rest/v1/") ||
          url.includes("/auth/v1/") ||
          url.includes("/api/"))
      ) {
        failedApiResponses.push(
          `${response.status()} ${url}`
        );
      }
    });

    await loginAsAdmin(page);

    const requiredPanels = [
      "#adminUsersPanel",
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
      await expect(page.locator(selector)).toBeVisible();
    }

    const requiredControls = [
      "#adminUsersRefresh",
      "#adminUsersSearch",
      "#adminUsersRole",
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
      "#p3VoucherForm",
      "#refreshDisputesBtn"
    ];

    for (const selector of requiredControls) {
      await expect(page.locator(selector)).toBeAttached();
      await expect(page.locator(selector)).toBeVisible();
    }

    const refreshControls = [
      "#adminUsersRefresh",
      "#adminCatalogRefresh",
      "#adminReviewsRefresh",
      "#adminShippingRefresh",
      "#adminRefundsRefresh",
      "#adminAuditRefresh",
      "#adminHealthRefresh",
      "#p3AdminRefresh",
      "#p3VoucherRefresh",
      "#refreshDisputesBtn"
    ];

    for (const selector of refreshControls) {
      await expect(page.locator(selector)).toBeEnabled();
      await page.locator(selector).click();
    }

    await expect(page.locator("#adminCatalogContainer")).toBeAttached();
    await expect(page.locator("#adminReviewsContainer")).toBeAttached();
    await expect(page.locator("#adminShippingContainer")).toBeAttached();
    await expect(page.locator("#adminRefundsContainer")).toBeAttached();
    await expect(page.locator("#adminAuditContainer")).toBeAttached();
    await expect(page.locator("#adminHealthContainer")).toBeAttached();
    await expect(page.locator("#p3VoucherList")).toBeAttached();

    expect(
      errors,
      `Browser page errors: ${errors.join(" | ")}`
    ).toEqual([]);

    expect(
      failedApiResponses,
      `Failed Admin API requests: ${failedApiResponses.join(" | ")}`
    ).toEqual([]);
  });
});
