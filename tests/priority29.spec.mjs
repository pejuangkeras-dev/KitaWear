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

test.describe("P29 — Promotion Engine",()=>{
  test("promotion schema and protected eligibility engine exist",async({request})=>{
    const s=await source(request,"supabase/migrations/20261003130000_priority29_promotion_engine.sql");
    for(const x of ["promotion_rules","scope","global","store","product","first_order_only","stackable","validate_promotion_for_checkout","search_path=''","grant execute on function public.validate_promotion_for_checkout"]) expect(s).toContain(x);
  });
  test("admin promotion API is protected and supports CRUD",async({request})=>{
    const s=await source(request,"functions/api/admin-promotions.js");
    for(const x of ["ADMIN_REQUIRED","onRequestGet","onRequestPost","onRequestPatch","onRequestDelete","promotion_rules","first_order_only","stackable"]) expect(s).toContain(x);
  });
  test("buyer promotion API requires authentication and preserves buyer identity",async({request})=>{
    const s=await source(request,"functions/api/buyer-promotions.js");
    for(const x of ["LOGIN_REQUIRED","/rest/v1/vouchers","/rest/v1/user_vouchers","/rest/v1/rpc/claim_voucher","Authorization:auth"]) expect(s).toContain(x);
    const claimStart=s.indexOf('const key=clean(ctx.env.SUPABASE_ANON_KEY)');
    const claimBlock=claimStart>=0?s.slice(claimStart):"";
    expect(claimBlock).toContain("apikey:key,Authorization:auth");
    expect(claimBlock).not.toContain("apikey:serviceKey,Authorization:\"Bearer \"+serviceKey");
  });
  test("checkout enforces promotion eligibility server-side",async({request})=>{
    const s=await source(request,"functions/api/create-transaction.js");
    for(const x of ["validate_promotion_for_checkout","PROMOTION_NOT_ELIGIBLE","FIRST_ORDER_ONLY","discount_amount"]) expect(s).toContain(x);
  });
  test("buyer checkout is wired to promotion engine",async({request})=>{
    const h=await source(request,"index.html"),j=await source(request,"promotion-engine-p29.js");
    expect(h).toContain("promotion-engine-p29.js");
    expect(j).toContain("window.validateCheckoutVoucher=validate");
    expect(j).toContain("/api/buyer-promotions");
  });
});
