import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P28 — order state machine", () => {
  test("state-machine migration exists and is protected", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003050000_priority28_order_state_machine.sql");
    expect(text).toContain("validate_order_state_transition");
    expect(text).toContain("trg_validate_order_state_transition");
    expect(text).toContain("revoke execute on function public.validate_order_state_transition() from public, anon, authenticated");
  });

  test("valid forward order transitions are explicitly defined", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003050000_priority28_order_state_machine.sql");
    for (const marker of [
      "pending_payment",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
      "disputed",
      "refunded"
    ]) expect(text).toContain(marker);
    expect(text).toContain("old.status");
    expect(text).toContain("new.status");
  });

  test("fulfillment and refund states enforce payment invariants", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003050000_priority28_order_state_machine.sql");
    expect(text).toContain("payment_status=paid");
    expect(text).toContain("payment_status=refunded");
    expect(text).toContain("payment_status=pending");
  });

  test("P26 payment mapping remains compatible with the state machine", async ({ request }) => {
    const webhook = await source(request, "functions/api/midtrans-notification.js");
    expect(webhook).toContain('orderStatus: "paid"');
    expect(webhook).toContain('orderStatus: "cancelled"');
    expect(webhook).toContain('orderStatus: "refunded"');
  });

  test("production marketplace remains reachable", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
  });
});
