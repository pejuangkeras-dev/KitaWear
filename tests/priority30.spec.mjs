import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P30 — inventory concurrency and stock invariants", () => {
  test("database enforces non-negative stock and reservation bounds", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");
    expect(text).toContain("product_sizes_stock_nonnegative");
    expect(text).toContain("product_sizes_reserved_stock_nonnegative");
    expect(text).toContain("product_sizes_reserved_lte_stock");
  });

  test("finalization consumes reserved stock atomically", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");
    expect(text).toContain("stock=stock-v_item.quantity");
    expect(text).toContain("reserved_stock=reserved_stock-v_item.quantity");
    expect(text).toContain("status='finalized'");
  });

  test("non-reserved paid orders cannot consume stock already reserved by other buyers", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");
    expect(text).toContain("(v_size.stock-v_size.reserved_stock)<v_item.quantity");
  });

  test("stock functions remain backend-only", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");
    expect(text).toContain("revoke execute on function public.finalize_order_stock(uuid) from public,anon,authenticated");
    expect(text).toContain("revoke execute on function public.decrement_order_stock(uuid) from public,anon,authenticated");
  });

  test("production marketplace remains reachable", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
  });
});
