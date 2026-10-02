import { test, expect } from "@playwright/test";
const BASE_URL=process.env.MARKETKITA_BASE_URL||"https://marketkita.pages.dev";
test.describe("MarketKita Priority 15 — Chat & Communication",()=>{
  test("admin chat API rejects unauthenticated access",async({request})=>{
    const r=await request.get(BASE_URL+"/api/admin-chat"); expect(r.status()).toBe(401);
  });
  test("buyer chat UI is deployed",async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(BASE_URL,{waitUntil:"domcontentloaded"});
    await expect(page.locator("#accountSection-messages")).toHaveCount(1);
    await expect(page.locator("#buyerChatInbox")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
  test("seller chat UI is deployed",async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(BASE_URL+"/seller.html",{waitUntil:"domcontentloaded"});
    await expect(page.locator("#sellerChatThreads")).toHaveCount(1);
    await expect(page.locator("#sellerChatInput")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
  test("admin communication panel is deployed",async({page})=>{
    await page.goto(BASE_URL+"/admin.html",{waitUntil:"domcontentloaded"});
    await expect(page.locator("#adminChatPanel")).toHaveCount(1);
    await expect(page.locator("#adminChatRefresh")).toHaveCount(1);
  });
  test("public config does not expose server secrets",async({request})=>{
    const r=await request.get(BASE_URL+"/api/public-config");expect(r.ok()).toBeTruthy();
    const s=JSON.stringify(await r.json()).toLowerCase();
    expect(s).not.toContain("service_role");expect(s).not.toContain("server_key");expect(s).not.toContain("webhook_secret");
  });
});