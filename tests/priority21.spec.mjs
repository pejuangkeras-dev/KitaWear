import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://marketkita.pages.dev';

test('shipping production readiness reports provider mode without exposing credentials', async ({ request }) => {
  const response = await request.get(`${BASE_URL}/api/shipping-create`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe('MarketKita RajaOngkir Delivery Create');
  expect(['sandbox', 'production']).toContain(body.mode);
  expect(typeof body.configured).toBe('boolean');
  expect(typeof body.safe_to_create).toBe('boolean');
  expect(body).not.toHaveProperty('api_key');
  expect(body).not.toHaveProperty('base_url');
  if (body.mode === 'sandbox') expect(body.safe_to_create).toBe(false);
});


test('shipping create source enforces the production gate server-side', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const source = fs.readFileSync(path.resolve(process.cwd(), 'functions/api/shipping-create.js'), 'utf8');
  expect(source).toContain('if(providerMode !== "production")return json');
  expect(source).toContain('safe_to_create:false');
});
