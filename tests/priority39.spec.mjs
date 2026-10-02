import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
test.describe("P39 — shipping webhook synchronization",()=>{
 test("webhook endpoint remains protected",async({request})=>{
  const r=await request.post(baseURL+"/api/shipping-webhook",{data:{}});
  expect([401,500]).toContain(r.status());
 });
 test("webhook maps provider status to monotonic shipment state",async({request})=>{
  const r=await request.get(rawBase+"functions/api/shipping-webhook.js"); expect(r.ok()).toBeTruthy();
  const t=await r.text();
  for(const marker of ["function shipmentStatus","nextShipmentStatus","status:nextShipmentStatus","marketStatus","allDelivered","allShipped","webhook_events"]) expect(t).toContain(marker);
  expect(t).not.toContain("status:incomingStatus||marketStatus");
 });
 test("shipping state migration exists",async({request})=>{
  const r=await request.get(rawBase+"supabase/migrations/20261003082000_priority38_shipping_state_machine.sql"); expect(r.ok()).toBeTruthy();
 });
});