import { test, expect } from "@playwright/test";
const BASE_URL=process.env.MARKETKITA_BASE_URL||"https://marketkita.pages.dev";
test.describe("MarketKita Priority 14 — Returns & Replacement",()=>{
  test("returns API rejects unauthenticated reads",async({request})=>{
    const r=await request.get(BASE_URL+"/api/returns");
    expect(r.status()).toBe(401);
  });
  test("returns API rejects unauthenticated writes",async({request})=>{
    const r=await request.post(BASE_URL+"/api/returns",{data:{order_item_id:"00000000-0000-0000-0000-000000000000",type:"return_refund",reason:"test"}});
    expect(r.status()).toBe(401);
  });
  test("admin returns API rejects unauthenticated access",async({request})=>{
    const r=await request.get(BASE_URL+"/api/admin-return");
    expect(r.status()).toBe(401);
  });
  test("buyer return modal is deployed",async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(BASE_URL,{waitUntil:"domcontentloaded"});
    await expect(page.locator("#p14ReturnModal")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
  test("seller return panel is deployed",async({page})=>{
    await page.goto(BASE_URL+"/seller.html",{waitUntil:"domcontentloaded"});
    await expect(page.locator("#p14SellerReturnsPanel")).toHaveCount(1);
  });
  test("admin return panel is deployed",async({page})=>{
    await page.goto(BASE_URL+"/admin.html",{waitUntil:"domcontentloaded"});
    await expect(page.locator("#adminReturnsPanel")).toHaveCount(1);
  });
  test("public storefront remains healthy",async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(BASE_URL,{waitUntil:"domcontentloaded"});
    await expect(page.locator("body")).toBeVisible();
    expect(errors).toEqual([]);
  });
  test("public config does not expose server secrets",async({request})=>{
    const r=await request.get(BASE_URL+"/api/public-config");expect(r.ok()).toBeTruthy();
    const s=JSON.stringify(await r.json()).toLowerCase();
    expect(s).not.toContain("service_role");expect(s).not.toContain("server_key");expect(s).not.toContain("webhook_secret");
  });
});