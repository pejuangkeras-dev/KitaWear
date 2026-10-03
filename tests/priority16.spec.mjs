import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'https://marketkita.pages.dev';

test.describe('Priority 16 Location & Shipping Finalization', () => {
  test('location hierarchy endpoints are live without consuming RajaOngkir shipping HITs', async ({ request }) => {
    const provinces = await request.get(`${BASE_URL}/api/location-provinces`);
    expect(provinces.ok()).toBeTruthy();
    const provinceBody = await provinces.json();
    expect(provinceBody.ok).toBeTruthy();
    expect(Array.isArray(provinceBody.data)).toBeTruthy();
    expect(provinceBody.data.length).toBeGreaterThan(30);

    const search = await request.get(`${BASE_URL}/api/location-search?search=Jakarta`);
    expect(search.ok()).toBeTruthy();
    const searchBody = await search.json();
    expect(searchBody.ok).toBeTruthy();
    expect(Array.isArray(searchBody.data)).toBeTruthy();
    expect(searchBody.data.some(row =>
      /jakarta/i.test(String(row.province_name || row.city_name || row.label || ''))
    )).toBeTruthy();

    const source = fs.readFileSync('functions/api/location-search.js', 'utf8');
    expect(source).toContain('emsifa.com/api-wilayah-indonesia');
    expect(source).not.toContain('rajaongkir.komerce.id');
  });

  test('location picker preserves the administrative hierarchy and postal code', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    expect(response?.status()).toBe(200);

    await expect(page.locator('#buyerLocationPickerButton')).toBeAttached();
    await expect(page.locator('#locationPickerModal')).toBeAttached();
    await expect(page.locator('#locationPickerSearch')).toBeAttached();
    await expect(page.locator('#locationTabProvince')).toBeAttached();
    await expect(page.locator('#locationTabCity')).toBeAttached();
    await expect(page.locator('#locationTabDistrict')).toBeAttached();
    await expect(page.locator('#locationTabPostal')).toBeAttached();

    const html = await page.locator('body').innerHTML();
    expect(html).toContain('Pilih sampai kecamatan dan kode pos');
    expect(html).toContain('buyerManualDistrictId');
    expect(html).toContain('buyerManualSubdistrictId');

    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('shipping quote requires an authenticated buyer and never exposes the provider key', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/shipping-quote`, {
      data: {
        manual_address: {
          address_line: 'Jalan Contoh No. 1',
          city: 'Jakarta Selatan',
          province: 'DKI Jakarta',
          postal_code: '12510'
        },
        items: [{ product_id: 'invalid', size: 'M', quantity: 1 }]
      }
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toMatch(/login/i);

    const publicConfig = await request.get(`${BASE_URL}/api/public-config`);
    expect(publicConfig.ok()).toBeTruthy();
    const publicBody = await publicConfig.text();
    expect(publicBody).not.toMatch(/RAJAONGKIR_API_KEY|SUPABASE_SERVICE_ROLE_KEY/i);
  });

  test('P16 source contains persistent quote deduplication and checkout idempotency', async () => {
    const shipping = fs.readFileSync('functions/api/shipping-quote.js', 'utf8');
    const checkout = fs.readFileSync('functions/api/create-transaction.js', 'utf8');
    const storefront = fs.readFileSync('index.html', 'utf8');

    expect(shipping).toContain('requestHash');
    expect(shipping).toContain('shipping_quotes');
    expect(shipping).toContain('deduplicated:true');
    expect(checkout).toContain('Idempotency-Key');
    expect(storefront).toContain('marketCheckoutIdempotencyKey');
    expect(storefront).toContain('buyerLocationPickerButton');
  });

  test('P16 database migration defines a unique active quote fingerprint', async () => {
    const migration = fs.readFileSync(
      'supabase/migrations/20261003090000_priority16_shipping_quote_dedup.sql',
      'utf8'
    );
    expect(migration).toContain('request_hash');
    expect(migration).toContain('shipping_quotes_active_request_unique_idx');
    expect(migration).toContain("status = 'active'");
  });
});
