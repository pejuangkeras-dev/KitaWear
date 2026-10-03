import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";

test.describe("P24 — end-to-end order lifecycle hardening", () => {
  test("checkout/payment/shipping protected endpoints reject unauthenticated requests", async ({ request }) => {
    const checks = [
      { path: "/api/create-transaction", method: "post", body: { items: [] } },
      { path: "/api/shipping-create", method: "post", body: { order_id: "00000000-0000-0000-0000-000000000000" } },
      { path: "/api/shipping-track", method: "post", body: { order_id: "00000000-0000-0000-0000-000000000000" } },
      { path: "/api/buyer-orders", method: "get" },
      { path: "/api/buyer-cancel-order", method: "post", body: { order_id: "00000000-0000-0000-0000-000000000000" } },
      { path: "/api/marketplace-lifecycle", method: "post", body: { action: "seller_request_payout", amount: 1 } }
    ];
    for (const check of checks) {
      const response = check.method === "get"
        ? await request.get(baseURL + check.path)
        : await request.post(baseURL + check.path, { data: check.body });
      expect([401, 403]).toContain(response.status());
    }
  });

  test("shipping preflight exposes only safe provider metadata", async ({ request }) => {
    const response = await request.get(baseURL + "/api/shipping-create");
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty("mode");
    expect(data).toHaveProperty("configured");
    expect(data).toHaveProperty("safe_to_create");
    expect(JSON.stringify(data)).not.toMatch(/RAJAONGKIR_DELIVERY_API_KEY|SUPABASE_SERVICE_ROLE_KEY|MIDTRANS_SERVER_KEY/i);
  });

  test("shipping create is gated on paid orders in source", async ({ request }) => {
    const response = await request.get(baseURL + "/api/shipping-create");
    expect(response.ok()).toBeTruthy();
    const source = await request.get("https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/functions/api/shipping-create.js");
    expect(source.ok()).toBeTruthy();
    const text = await source.text();
    expect(text).toContain('order.payment_status!=="paid"');
    expect(text).toContain("safe_to_create");
  });

  test("buyer confirmation is present and delegated to guarded database RPC", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain("confirmBuyerOrder");
    expect(html).toContain("buyer_confirm_order_received");
  });

  test("lifecycle source maps every P24 gate to a server-side RPC", async ({ request }) => {
    const source = await request.get("https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/functions/api/marketplace-lifecycle.js");
    expect(source.ok()).toBeTruthy();
    const text = await source.text();
    for (const marker of [
      "request_return",
      "buyer_create_dispute",
      "seller_request_payout",
      "admin_review_payout_request",
      "admin_resolve_return",
      "admin_resolve_dispute"
    ]) expect(text).toContain(marker);
    expect(text).toContain("authUser(context)");
  });

  test("P24 lifecycle writes are server-side only", async ({ request }) => {
    const migration = await request.get("https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/supabase/migrations/20261003095000_priority24_order_lifecycle_hardening.sql");
    expect(migration.ok()).toBeTruthy();
    const text = await migration.text();
    for (const marker of [
      "revoke insert, update, delete on public.orders from anon, authenticated",
      "revoke insert, update, delete on public.order_sellers from anon, authenticated",
      "revoke insert, update, delete on public.seller_payout_requests from anon, authenticated",
      "revoke insert, update, delete on public.seller_payouts from anon, authenticated",
      "revoke insert, update, delete on public.return_requests from anon, authenticated",
      "revoke insert, update, delete on public.disputes from anon, authenticated",
      "revoke insert, update, delete on public.refund_requests from anon, authenticated",
      "drop policy if exists disputes_buyer_insert",
      "alter function public.buyer_create_dispute(uuid,text,text) set search_path = ''"
    ]) expect(text).toContain(marker);
  });

  test("Midtrans notification endpoint is reachable as a webhook surface without exposing secrets", async ({ request }) => {
    const response = await request.get(baseURL + "/api/midtrans-notification");
    expect([200, 405]).toContain(response.status());
    const body = await response.text();
    expect(body).not.toMatch(/MIDTRANS_SERVER_KEY|SUPABASE_SERVICE_ROLE_KEY/i);
  });
});
