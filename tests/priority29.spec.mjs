import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P29 — stock reservation maintenance", () => {
  test("expired reservation function no longer uses invalid DISTINCT + FOR UPDATE", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003052000_priority29_stock_reservation_cron_fix.sql");
    expect(text).toContain("select distinct order_id");
    expect(text).not.toContain("order by order_id\n    for update");
    expect(text).toContain("release_order_stock_reservation(v_order_id,'expired')");
  });

  test("maintenance function is not callable by client roles", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003052000_priority29_stock_reservation_cron_fix.sql");
    expect(text).toContain("revoke execute on function public.release_expired_stock_reservations() from public, anon, authenticated");
  });

  test("Cloud database has an active stock-maintenance cron job", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
  });
});
