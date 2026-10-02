import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P32 — voucher concurrency and flash-sale safety", () => {
  test("voucher consumption locks the voucher row before checking quota", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003062000_priority32_voucher_concurrency.sql");
    expect(text).toContain("from public.vouchers where id=p_voucher_id for update");
    expect(text).toContain("used_count=used_count+1");
  });

  test("voucher claims are single-use per buyer", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003062000_priority32_voucher_concurrency.sql");
    expect(text).toContain("from public.user_vouchers where voucher_id=p_voucher_id and user_id=p_user_id for update");
    expect(text).toContain("v_claim.used_at is not null");
  });

  test("voucher counters cannot become negative", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003062000_priority32_voucher_concurrency.sql");
    expect(text).toContain("vouchers_used_count_nonnegative");
    expect(text).toContain("vouchers_usage_limit_valid");
  });

  test("voucher RPCs remain backend-only", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003062000_priority32_voucher_concurrency.sql");
    expect(text).toContain("revoke execute on function public.consume_user_voucher(uuid,uuid) from public,anon,authenticated");
    expect(text).toContain("revoke execute on function public.release_user_voucher(uuid,uuid) from public,anon,authenticated");
  });

  test("production marketplace remains reachable", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
  });
});
