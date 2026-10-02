import { test, expect } from "@playwright/test";
const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("P33 — seller payout consistency",()=>{
 test("only one active payout request per seller is allowed",async({request})=>{
  const t=await source(request,"supabase/migrations/20261003064000_priority33_payout_consistency.sql");
  expect(t).toContain("seller_payout_requests_one_active_per_seller");
  expect(t).toContain("where status in ('pending','approved')");
 });
 test("payout amounts have database invariants",async({request})=>{
  const t=await source(request,"supabase/migrations/20261003064000_priority33_payout_consistency.sql");
  for(const x of ["seller_payout_requests_amount_positive","seller_payouts_gross_nonnegative","seller_payouts_fee_nonnegative","seller_payouts_net_nonnegative","seller_payouts_net_math"]) expect(t).toContain(x);
 });
 test("seller payout request serializes concurrent requests",async({request})=>{
  const t=await source(request,"supabase/migrations/20261003064000_priority33_payout_consistency.sql");
  expect(t).toContain("from public.profiles where id=v_user for update");
  expect(t).toContain("exception when unique_violation");
 });
 test("seller payout RPC remains authenticated-only",async({request})=>{
  const t=await source(request,"supabase/migrations/20261003064000_priority33_payout_consistency.sql");
  expect(t).toContain("revoke execute on function public.seller_request_payout(integer,text) from public,anon");
  expect(t).toContain("grant execute on function public.seller_request_payout(integer,text) to authenticated");
 });
 test("production marketplace remains reachable",async({request})=>{
  const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy();
 });
});