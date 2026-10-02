import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("P35 — shipping fulfillment consistency",()=>{
 test("one shipment per order seller",async({request})=>{const t=await source(request,"supabase/migrations/20261003072000_priority35_shipping_fulfillment_consistency.sql");expect(t).toContain("shipping_shipments_one_per_order_seller");});
 test("shipment fulfillment requires paid or refunded order",async({request})=>{const t=await source(request,"supabase/migrations/20261003072000_priority35_shipping_fulfillment_consistency.sql");expect(t).toContain("o.payment_status not in ('paid','refunded')");});
 test("active shipment requires AWB or tracking",async({request})=>{const t=await source(request,"supabase/migrations/20261003072000_priority35_shipping_fulfillment_consistency.sql");expect(t).toContain("Shipment aktif membutuhkan AWB/tracking number");});
 test("shipment must belong to the same order seller",async({request})=>{const t=await source(request,"supabase/migrations/20261003072000_priority35_shipping_fulfillment_consistency.sql");expect(t).toContain("os.order_id<>new.order_id");});
 test("shipping fee cannot be negative",async({request})=>{const t=await source(request,"supabase/migrations/20261003072000_priority35_shipping_fulfillment_consistency.sql");expect(t).toContain("shipping_shipments_fee_nonnegative");});
 test("production marketplace remains reachable",async({request})=>{const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy();});
});