import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://marketkita.pages.dev';

test.describe('Priority 17 Order Lifecycle & Fulfillment', () => {
  test('automatic shipping creation rejects unauthenticated access', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/shipping-create`, {
      data: { order_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.status()).toBe(401);
  });

  test('shipping-create route is deployed and seller workflow is wired', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/seller.html`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);
    await expect(page.locator('#trackingSubmit')).toContainText('Buat Pengiriman');
    await expect(page.locator('#trackingInput')).toHaveAttribute('placeholder', 'Resi manual (opsional)');
  });

  test('seller page has buyer confirmation lifecycle wording', async ({ page }) => {
    await page.goto(`${BASE_URL}/seller.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Menunggu konfirmasi pembeli')).toBeAttached();
  });

  test('public config does not expose server shipping secrets', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/public-config`);
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|RAJAONGKIR_DELIVERY_API_KEY|RAJAONGKIR_WEBHOOK_SECRET|MIDTRANS_SERVER_KEY/i);
  });
});
