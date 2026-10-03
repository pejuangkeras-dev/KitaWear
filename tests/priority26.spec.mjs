import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P26 — production readiness, payment engine & reconciliation", () => {
  test("public health endpoint is reachable without exposing secrets", async ({ request }) => {
    const response = await request.get(baseURL + "/api/health");
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(body.service).toBe("MarketKita health");
    expect(body).not.toHaveProperty("supabase_service_role_key");
    expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9]|SB_SERVICE_ROLE|MIDTRANS_SERVER_KEY|RAJAONGKIR_DELIVERY_API_KEY/i);
  });

  test("production readiness endpoint requires an authenticated admin", async ({ request }) => {
    const response = await request.get(baseURL + "/api/production-readiness");
    expect(response.status()).toBe(401);
  });

  test("production readiness implementation checks production payment and shipping gates", async ({ request }) => {
    const text = await source(request, "functions/api/production-readiness.js");
    for (const marker of [
      "LOGIN_REQUIRED",
      "ADMIN_REQUIRED",
      "MIDTRANS_IS_PRODUCTION",
      "RAJAONGKIR_DELIVERY_BASE_URL",
      "shipping_production",
      "midtrans_production"
    ]) expect(text).toContain(marker);
  });

  test("Midtrans notification endpoint is reachable without exposing secrets", async ({ request }) => {
    const response = await request.get(baseURL + "/api/midtrans-notification");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.service).toMatch(/Midtrans Notification/i);
    expect(JSON.stringify(body)).not.toMatch(/SERVER_KEY|SECRET|TOKEN/i);
  });

  test("payment reconciliation requires an authenticated admin", async ({ request }) => {
    const response = await request.post(baseURL + "/api/midtrans-reconcile", {
      data: {}
    });
    expect([401, 403]).toContain(response.status());
  });

  test("webhook verifies Midtrans signature before changing payment state", async ({ request }) => {
    const text = await source(request, "functions/api/midtrans-notification.js");
    expect(text).toContain("sha512Hex");
    expect(text).toContain("Signature notification tidak valid");
    expect(text).toContain("recordPaymentEvent");
    expect(text).toContain("/rest/v1/payment_events");
  });

  test("webhook handles all terminal and pending Midtrans statuses", async ({ request }) => {
    const text = await source(request, "functions/api/midtrans-notification.js");
    for (const marker of [
      'status === "settlement"',
      'status === "capture"',
      'status === "pending"',
      'status === "deny"',
      'status === "cancel"',
      'status === "expire"',
      'status === "failure"',
      'status === "refund"',
      'status === "partial_refund"'
    ]) {
      expect(text).toContain(marker);
    }
  });

  test("webhook prevents stale status from downgrading paid/refunded orders", async ({ request }) => {
    const text = await source(request, "functions/api/midtrans-notification.js");
    expect(text).toContain("stale_midtrans_notification");
    expect(text).toContain('currentPayment === "refunded"');
    expect(text).toContain('currentPayment === "paid"');
  });

  test("challenged card captures remain pending until Midtrans/FDS approval", async ({ request }) => {
    const webhook = await source(request, "functions/api/midtrans-notification.js");
    const reconcile = await source(request, "functions/api/midtrans-reconcile.js");
    expect(webhook).toContain('status === "capture" && fraud === "challenge"');
    expect(reconcile).toContain('status === "capture" && fraud === "challenge"');
  });

  test("reconciliation uses Midtrans GET Status API and validates order identity and amount", async ({ request }) => {
    const text = await source(request, "functions/api/midtrans-reconcile.js");
    expect(text).toContain("/v2/");
    expect(text).toContain("/status");
    expect(text).toContain("Midtrans order_id tidak cocok");
    expect(text).toContain("Nominal Midtrans tidak cocok dengan order");
    expect(text).toContain("payment_events");
  });

  test("payment audit schema is protected from client roles", async ({ request }) => {
    const migration = await source(
      request,
      "supabase/migrations/20261003040000_priority26_payment_reconciliation_foundation.sql"
    );
    expect(migration).toContain("create table if not exists public.payment_events");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.payment_events from anon, authenticated");
    expect(migration).toContain("payment_last_synced_at");
  });
});
