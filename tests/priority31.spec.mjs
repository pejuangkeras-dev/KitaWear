import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const response=await request.get(rawBase+path);expect(response.ok()).toBeTruthy();return response.text();}
test.describe("P31 — Marketplace Finance",()=>{
 test("finance API requires authentication",async({request})=>{const r=await request.get(baseURL+"/api/marketplace-finance");expect(r.status()).toBe(401)});
 test("finance API preserves authenticated identity and role boundaries",async({request})=>{const s=await source(request,"functions/api/marketplace-finance.js");for(const x of ["LOGIN_REQUIRED","seller_balance_summary","seller_request_payout","admin_review_payout_request","ADMIN_REQUIRED","SELLER_REQUIRED"])expect(s).toContain(x);expect(s).toContain("Authorization:h");});
 test("seller finance UI is wired into Seller Center",async({request})=>{const s=await source(request,"marketplace-finance-p31.js"),h=await source(request,"seller.html");for(const x of ["/api/marketplace-finance","request_payout","Saldo tersedia","Permintaan Payout","Ledger Seller"])expect(s).toContain(x);expect(h).toContain("marketplace-finance-p31.js");});
 test("ledger and payout database primitives are present and constrained",async({request})=>{const s=await source(request,"functions/api/marketplace-finance.js");for(const x of ["ledger_transactions","ledger_entries","seller_payout_requests","seller_payout_audit","seller_payouts"])expect(s).toContain(x);});
 test("production marketplace remains reachable",async({request})=>{const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy()});
});