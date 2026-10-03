import { test, expect } from "@playwright/test";
import fs from "node:fs";
const read=p=>fs.readFileSync(p,"utf8");
test("G10 Marketplace BI API is admin-only and wired",async()=>{
 const api=read("functions/api/marketplace-bi.js");
 expect(api).toContain('ADMIN_REQUIRED'); expect(api).toContain('marketplace_bi_dashboard');
 expect(api).toContain('p_from'); expect(api).toContain('p_to');
 const sql=read("supabase/migrations/20261003210000_g10_marketplace_bi.sql");
 expect(sql).toContain("create or replace function public.marketplace_bi_dashboard");
 expect(sql).toContain("revoke all on function public.marketplace_bi_dashboard");
 expect(sql).toContain("grant execute on function public.marketplace_bi_dashboard");
});
test("G10 BI page exposes KPI and operational dimensions",async()=>{
 const page=read("admin-bi-g10.html");
 expect(page).toContain("G10 Marketplace BI");
 expect(page).toContain("/api/marketplace-bi");
 expect(page).toContain("GMV"); expect(page).toContain("Seller"); expect(page).toContain("Produk"); expect(page).toContain("Kategori");
});
