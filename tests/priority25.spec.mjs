import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P25 — final production audit", () => {
  test("protected marketplace lifecycle API rejects anonymous access", async ({ request }) => {
    const response = await request.get(baseURL + "/api/marketplace-lifecycle");
    expect(response.status()).toBe(401);
  });

  test("lifecycle handlers retain server-side authorization gates", async ({ request }) => {
    const text = await source(request, "functions/api/marketplace-lifecycle.js");
    for (const marker of [
      "authUser(context)",
      "request_return",
      "seller_update_return",
      "buyer_create_dispute",
      "seller_request_payout",
      "admin_review_payout_request",
      "admin_resolve_return",
      "admin_resolve_dispute"
    ]) {
      expect(text).toContain(marker);
    }
  });

  test("shipping, payment and buyer-order APIs remain protected", async ({ request }) => {
    const checks = [
      ["/api/create-transaction", "post", { items: [] }],
      ["/api/shipping-create", "post", { order_id: "00000000-0000-0000-0000-000000000000" }],
      ["/api/shipping-track", "post", { order_id: "00000000-0000-0000-0000-000000000000" }],
      ["/api/buyer-orders", "get"],
      ["/api/buyer-cancel-order", "post", { order_id: "00000000-0000-0000-0000-000000000000" }]
    ];

    for (const [path, method, body] of checks) {
      const response = method === "get"
        ? await request.get(baseURL + path)
        : await request.post(baseURL + path, { data: body });
      expect([401, 403]).toContain(response.status());
    }
  });

  test("public pages do not expose service-role or payment/shipping secrets", async ({ request }) => {
    for (const path of ["/", "/seller.html", "/admin.html"]) {
      const response = await request.get(baseURL + path);
      expect(response.ok()).toBeTruthy();
      const text = await response.text();
      expect(text).not.toMatch(/(?:SUPABASE_SERVICE_ROLE_KEY|MIDTRANS_SERVER_KEY|RAJAONGKIR_DELIVERY_API_KEY)\\s*[:=]\\s*\"[^\"\\s]+\"/i);
    }
  });

  test("P25 migrations harden SECURITY DEFINER access and address helpers", async ({ request }) => {
    const hardening = await source(request, "supabase/migrations/20261003110000_priority25_security_access_hardening.sql");
    for (const marker of ["set search_path = ''''", "from anon", "address_street_import_batches_no_client_access"]) {
      expect(hardening).toContain(marker);
    }
    const address = await source(request, "supabase/migrations/20261003111000_priority25_address_security_cleanup.sql");
    for (const marker of ["normalize_address_text(text) set search_path=''", "address_street_set_normalized() set search_path=''", "address_alias_set_normalized() set search_path=''", "revoke execute on function public.search_address_streets"]) {
      expect(address).toContain(marker);
    }
  });


  test("P25 final audit migration removes only verified duplicate indexes", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003112000_priority25_final_production_audit_index_cleanup.sql");
    for (const marker of [
      "DROP INDEX IF EXISTS public.buyer_addresses_one_default_idx",
      "DROP INDEX IF EXISTS public.chat_threads_buyer_store_unique_idx",
      "DROP INDEX IF EXISTS public.shipping_shipments_order_seller_unique_idx"
    ]) expect(text).toContain(marker);
    expect(text).toContain("Constraint-backed unique indexes are intentionally retained");
  });
});
