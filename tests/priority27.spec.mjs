import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P27 — order and inventory audit foundation", () => {
  test("audit migration enables RLS and denies client roles", async ({ request }) => {
    const text = await source(
      request,
      "supabase/migrations/20261003043000_priority27_order_inventory_audit.sql"
    );
    expect(text).toContain("order_status_events");
    expect(text).toContain("inventory_events");
    expect(text).toContain("enable row level security");
    expect(text).toContain("revoke all on table public.order_status_events from anon, authenticated");
    expect(text).toContain("revoke all on table public.inventory_events from anon, authenticated");
  });

  test("order status changes are audited by a database trigger", async ({ request }) => {
    const text = await source(
      request,
      "supabase/migrations/20261003043000_priority27_order_inventory_audit.sql"
    );
    expect(text).toContain("audit_order_status_change");
    expect(text).toContain("trg_audit_order_status_change");
    expect(text).toContain("old.status is distinct from new.status");
    expect(text).toContain("old.payment_status is distinct from new.payment_status");
  });

  test("inventory stock changes are audited by a database trigger", async ({ request }) => {
    const text = await source(
      request,
      "supabase/migrations/20261003043000_priority27_order_inventory_audit.sql"
    );
    expect(text).toContain("audit_inventory_stock_change");
    expect(text).toContain("trg_audit_inventory_stock_change");
    expect(text).toContain("new.stock - old.stock");
  });

  test("new audit trigger functions are not executable by client roles", async ({ request }) => {
    const text = await source(
      request,
      "supabase/migrations/20261003043000_priority27_order_inventory_audit.sql"
    );
    expect(text).toContain(
      "revoke execute on function public.audit_order_status_change() from public, anon, authenticated"
    );
    expect(text).toContain(
      "revoke execute on function public.audit_inventory_stock_change() from public, anon, authenticated"
    );
  });

  test("production marketplace remains reachable", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
  });
});
