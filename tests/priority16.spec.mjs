import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://marketkita.pages.dev';

test.describe('Seller Center smoke', () => {
  test('Seller Center loads without JavaScript parse/runtime errors', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const response = await page.goto(`${BASE_URL}/seller.html`, {
      waitUntil: 'domcontentloaded',
    });

    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Seller Center');
    await expect(page.getByText('Mulai berjualan di MarketKita')).toBeVisible();

    await page.waitForTimeout(1500);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('Seller Center contains buyer onboarding controls', async ({ page }) => {
    await page.goto(`${BASE_URL}/seller.html`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.getByText('Mulai berjualan di MarketKita')).toBeVisible();
    await expect(page.locator('#storeForm')).toBeVisible();
    await expect(page.locator('#storeName')).toBeVisible();
    await expect(page.locator('#storeSlug')).toBeVisible();
    await expect(page.locator('#storeDescription')).toBeVisible();
  });
});
