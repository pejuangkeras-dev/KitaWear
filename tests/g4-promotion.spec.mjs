import { test, expect } from "@playwright/test";

const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}

test.describe("G4 — centralized promotion engine",()=>{
  test("database engine supports all planned promotion types and is client-protected",async({request})=>{
    const s=await source(request,"supabase/migrations/20261003200000_g4_promotion_engine.sql");
    for(const x of ["promotion_campaigns","promotion_redemptions","percent_discount","fixed_discount","free_shipping","cashback","buy_x_get_y","bundle_discount","flash_sale","evaluate_promotion_campaigns","redeem_promotion_campaigns","release_promotion_campaigns","revoke execute on function public.evaluate_promotion_campaigns(uuid,jsonb,bigint,bigint,uuid,uuid[]) from public,anon,authenticated"]) expect(s).toContain(x);
  });
  test("buyer promotion preview API requires login",async({request})=>{
    const s=await source(request,"functions/api/promotion-engine.js");
    expect(s).toContain("LOGIN_REQUIRED");
    expect(s).toContain("/rest/v1/rpc/evaluate_promotion_campaigns");
  });
  test("campaign management supports seller/admin access",async({request})=>{
    const s=await source(request,"functions/api/promotion-campaigns.js");
    for(const x of ["SELLER_OR_ADMIN_REQUIRED","promotion_campaigns","onRequestGet","onRequestPost","onRequestPatch","onRequestDelete","STORE_FORBIDDEN"]) expect(s).toContain(x);
  });
  test("checkout is wired to authoritative G4 server evaluation and redemption",async({request})=>{
    const s=await source(request,"functions/api/create-transaction.js");
    for(const x of ["evaluate_promotion_campaigns","redeem_promotion_campaigns","release_promotion_campaigns","promotion_campaign_ids","PROMO-SHIPPING","promotionRedeemed"]) expect(s).toContain(x);
    const h=await source(request,"index.html"),ui=await source(request,"promotion-g4.js");
    expect(h).toContain("promotion-g4.js");
    expect(h).toContain("promotion_campaign_ids");
    expect(ui).toContain("/api/promotion-engine");
  });
  test("admin and seller centers load G4 management",async({request})=>{
    for(const path of ["admin.html","seller.html"]){
      const s=await source(request,path);
      expect(s).toContain("promotion-management-g4.js");
    }
  });
});