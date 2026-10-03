import { test, expect } from "@playwright/test";
test.describe("G3 social commerce",()=>{
 test("account contains wishlist and followed stores sections",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await expect(page.locator('[data-account-section="wishlist"]')).toHaveCount(1);
  await expect(page.locator('[data-account-section="follows"]')).toHaveCount(1);
  await expect(page.locator("#accountSection-wishlist")).toHaveCount(1);
  await expect(page.locator("#accountSection-follows")).toHaveCount(1);
 });
 test("social client is loaded",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});
  expect(await page.locator('script[src*="social-g3.js"]').count()).toBe(1);
 });
});