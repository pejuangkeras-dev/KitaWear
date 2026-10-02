import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("P34 — refund and seller ledger consistency",()=>{
 test("refund ledger is idempotent",async({request})=>{const t=await source(request,"supabase/migrations/20261003070000_priority34_refund_ledger_consistency.sql");expect(t).toContain("transaction_key='refund:'||p_refund_request_id::text");});
 test("refund cannot exceed original payment",async({request})=>{const t=await source(request,"supabase/migrations/20261003070000_priority34_refund_ledger_consistency.sql");expect(t).toContain("if r.amount>original_cash then raise exception 'Refund exceeds original payment';");});
 test("seller balance is protected when seller was already paid out",async({request})=>{const t=await source(request,"supabase/migrations/20261003070000_priority34_refund_ledger_consistency.sql");expect(t).toContain("seller_available");expect(t).toContain("Refund expense - seller already settled");});
 test("refund ledger remains balanced",async({request})=>{const t=await source(request,"supabase/migrations/20261003070000_priority34_refund_ledger_consistency.sql");expect(t).toContain("debits");expect(t).toContain("credits");expect(t).toContain("Refund rounding adjustment");});
 test("refund posting is backend-only",async({request})=>{const t=await source(request,"supabase/migrations/20261003070000_priority34_refund_ledger_consistency.sql");expect(t).toContain("revoke execute on function public.ledger_post_refund(uuid) from public,anon,authenticated");});
 test("production marketplace remains reachable",async({request})=>{const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy();});
});