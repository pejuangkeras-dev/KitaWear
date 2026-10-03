import { test, expect } from "@playwright/test";
const raw="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function src(request,p){const r=await request.get(raw+p);expect(r.ok()).toBeTruthy();return r.text()}
test.describe("G5 Seller Growth Center",()=>{
 test("growth API uses authoritative seller RPCs",async({request})=>{const s=await src(request,"functions/api/seller-growth.js");for(const x of ["LOGIN_REQUIRED","seller_sales_report","seller_balance_summary","days"])expect(s).toContain(x)});
 test("seller growth UI is wired into Seller Center",async({request})=>{const h=await src(request,"seller.html"),s=await src(request,"seller-growth-g5.js");expect(h).toContain("seller-growth-g5.js");for(const x of ["Seller Growth Center","/api/seller-growth","Penjualan 30 hari","Saldo tersedia"])expect(s).toContain(x)});
 test("seller payout foundation exists",async({request})=>{const s=await src(request,"seller.html");expect(s).toContain("Payout");});
});