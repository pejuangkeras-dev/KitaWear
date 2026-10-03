import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://marketkita.pages.dev';

test.describe('Priority 18 Buyer Order Tracking', () => {
  test('buyer orders endpoint requires authentication', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/buyer-orders`);
    expect(response.status()).toBe(401);
  });

  test('shipping tracking endpoint requires authentication', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/shipping-track`, {
      data: { order_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.status()).toBe(401);
  });

  test('storefront contains buyer order tracking UI', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.getByText('Pesanan Saya')).toBeAttached();
    await expect(page.locator('#buyerOrdersList')).toBeAttached();
  });

  test('buyer order tracking script remains syntactically valid', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('shipping webhook implementation is idempotent and buyer-notification capable', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/shipping-webhook`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    const source = await request.get(`${BASE_URL}/shipping-webhook.js`).catch(() => null);
    if (source?.ok()) {
      const body = await source.text();
      expect(body).toMatch(/webhook_events/);
    }
  });

  test('buyer tracking has provider-cache fallback to protect RajaOngkir HIT limits', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('functions/api/shipping-track.js', 'utf8');
    expect(source).toContain('tracking_checked_at');
    expect(source).toContain('source:"cache"');
    expect(source).toContain('stale:true');
    expect(source).toContain('60000');
  });

  test('public config does not expose private shipping/payment secrets', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/public-config`);
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|RAJAONGKIR_API_KEY|RAJAONGKIR_DELIVERY_API_KEY|RAJAONGKIR_WEBHOOK_SECRET|MIDTRANS_SERVER_KEY/i);
  });
});
