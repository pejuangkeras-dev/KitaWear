import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'https://marketkita.pages.dev';

test.describe('Priority 20 Shipment Transaction', () => {
  test('shipping create endpoint exposes safe delivery mode metadata', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/shipping-create`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      service: 'MarketKita RajaOngkir Delivery Create',
    });
    expect(['sandbox', 'production']).toContain(body.mode);
    expect(typeof body.configured).toBe('boolean');
    expect(typeof body.safe_to_create).toBe('boolean');

    // A sandbox provider must never be treated as production-safe.
    if (body.mode === 'sandbox') {
      expect(body.safe_to_create).toBe(false);
    }
  });

  test('shipping create endpoint does not create an unauthenticated shipment', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/shipping-create`, {
      data: {
        order_id: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('shipping webhook and tracking services are reachable before E2E transaction', async ({ request }) => {
    const webhook = await request.get(`${BASE_URL}/api/shipping-webhook`);
    expect(webhook.status()).toBe(200);
    expect(await webhook.json()).toMatchObject({ ok: true });

    const tracking = await request.get(`${BASE_URL}/api/shipping-track`);
    expect(tracking.status()).toBe(200);
    expect(await tracking.json()).toMatchObject({ ok: true });
  });

  test('public config keeps shipping credentials private', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/public-config`);
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|RAJAONGKIR_DELIVERY_API_KEY|RAJAONGKIR_WEBHOOK_SECRET|MIDTRANS_SERVER_KEY/i);
  });
});


test('checkout idempotency accepts the first request and rejects only a concurrent replay', async () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'functions/api/create-transaction.js'), 'utf8');
  expect(source).toContain('const idempotencyRecordCreated = Boolean(idem);');
  expect(source).toContain('if (!idempotencyRecordCreated && idem.status === "processing")');
  expect(source).not.toContain('if (idem.status === "processing") {');
});
