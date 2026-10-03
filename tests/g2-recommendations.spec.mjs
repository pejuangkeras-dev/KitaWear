import { test, expect } from "@playwright/test";
test.describe("G2 personalized recommendations",()=>{
  test("homepage contains recommendation section",async({page})=>{
    await page.goto("/",{waitUntil:"domcontentloaded"});
    await expect(page.locator("#rekomendasi")).toBeVisible();
    await expect(page.locator("#recommendationProducts")).toBeVisible();
  });
  test("recommendation endpoint is wired",async({request})=>{
    const r=await request.get("/api/recommendations?limit=4");
    expect(r.status()).toBe(200);
    const d=await r.json();
    expect(Array.isArray(d.products)).toBeTruthy();
    expect(["personalized","trending"]).toContain(d.mode);
    expect(d.products.length).toBeLessThanOrEqual(4);
  });
});