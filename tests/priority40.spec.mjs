import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
test.describe("P40 — shipping tracking and delivery proof",()=>{
 test("delivery proof migration exists",async({request})=>{
  const r=await request.get(rawBase+"supabase/migrations/20261003083000_priority40_shipping_delivery_proof.sql"); expect(r.ok()).toBeTruthy();
  const t=await r.text(); for(const x of ["delivery_proof_url","delivery_recipient","delivered_at","validate_shipping_delivery_proof"])expect(t).toContain(x);
 });
 test("webhook captures delivery proof fields",async({request})=>{
  const r=await request.get(rawBase+"functions/api/shipping-webhook.js");expect(r.ok()).toBeTruthy();
  const t=await r.text();for(const x of ["patch.delivered_at","patch.delivery_proof_at","delivery_proof_url","delivery_recipient"])expect(t).toContain(x);
 });
 test("tracking endpoint remains protected",async({request})=>{
  const r=await request.post(baseURL+"/api/shipping-track",{data:{order_id:"00000000-0000-0000-0000-000000000000"}});expect([401,403]).toContain(r.status());
 });
});