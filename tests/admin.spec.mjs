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
