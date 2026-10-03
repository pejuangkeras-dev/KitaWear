import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("P35 — Mobile / PWA",()=>{
 test("manifest is installable and scoped to root",async({request})=>{
  const r=await request.get(baseURL+"/manifest.webmanifest");expect(r.ok()).toBeTruthy();
  const m=await r.json();expect(m.name).toBe("MarketKita");expect(m.short_name).toBe("MarketKita");expect(m.display).toBe("standalone");expect(m.start_url).toContain("source=pwa");expect(m.scope).toBe("/");
  expect(m.icons?.length).toBeGreaterThan(0);
 });
 test("service worker has offline fallback and push notification handlers",async({request})=>{
  const t=await source(request,"sw.js");expect(t).toContain("self.addEventListener("install"");expect(t).toContain("/offline.html");expect(t).toContain("self.addEventListener("push"");expect(t).toContain("showNotification");expect(t).toContain("notificationclick");
 });
 test("PWA client registers service worker and install prompt",async({request})=>{
  const t=await source(request,"pwa-p35.js");expect(t).toContain('navigator.serviceWorker.register(SW');expect(t).toContain("beforeinstallprompt");expect(t).toContain("appinstalled");expect(t).toContain("display-mode: standalone");
 });
 test("PWA client supports notification permission",async({request})=>{
  const t=await source(request,"pwa-p35.js");expect(t).toContain("Notification.requestPermission");expect(t).toContain("showNotification");expect(t).toContain("marketKitaEnableNotifications");
 });
 test("index exposes PWA metadata and client",async({request})=>{
  const t=await source(request,"index.html");expect(t).toContain('rel="manifest"');expect(t).toContain('apple-mobile-web-app-capable');expect(t).toContain("/pwa-p35.js?v=20261003-p35");
 });
 test("PWA assets have explicit cache policy",async({request})=>{
  const t=await source(request,"_headers");expect(t).toContain("/sw.js");expect(t).toContain("/manifest.webmanifest");expect(t).toContain("/icons/*");
 });
 test("production homepage remains reachable on mobile viewport",async({page})=>{
  await page.setViewportSize({width:390,height:844});const r=await page.goto(baseURL+"/",{waitUntil:"domcontentloaded"});expect(r?.ok()).toBeTruthy();expect(await page.locator("body").isVisible()).toBeTruthy();
 });
 test("offline fallback asset is deployed",async({request})=>{
  const r=await request.get(baseURL+"/offline.html");expect(r.ok()).toBeTruthy();expect(await r.text()).toContain("Anda sedang offline");
 });
});
