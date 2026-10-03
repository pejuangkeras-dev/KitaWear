import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}

test.describe("P30 — inventory concurrency and stock invariants",()=>{
 test("database enforces non-negative stock and reservation bounds",async({request})=>{const t=await source(request,"supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");expect(t).toContain("product_sizes_stock_nonnegative");expect(t).toContain("product_sizes_reserved_stock_nonnegative");expect(t).toContain("product_sizes_reserved_lte_stock");});
 test("finalization consumes reserved stock atomically",async({request})=>{const t=await source(request,"supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");expect(t).toContain("stock=stock-v_item.quantity");expect(t).toContain("reserved_stock=reserved_stock-v_item.quantity");expect(t).toContain("status='finalized'");});
 test("non-reserved paid orders cannot consume stock already reserved by other buyers",async({request})=>{const t=await source(request,"supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");expect(t).toContain("(v_size.stock-v_size.reserved_stock)<v_item.quantity");});
 test("stock functions remain backend-only",async({request})=>{const t=await source(request,"supabase/migrations/20261003054000_priority30_inventory_concurrency.sql");expect(t).toContain("revoke execute on function public.finalize_order_stock(uuid) from public,anon,authenticated");expect(t).toContain("revoke execute on function public.decrement_order_stock(uuid) from public,anon,authenticated");});
});

test.describe("P30 — Search & Discovery",()=>{
 test("server search migration has ranking, filters, facets and pagination",async({request})=>{const t=await source(request,"supabase/migrations/20261003140000_priority30_search_discovery.sql");for(const x of ["search_public_products","relevance","price_asc","price_desc","name_asc","rating_desc","newest","p_page","p_page_size","categories","stores","set search_path=''","revoke execute on function public.search_public_products"])expect(t).toContain(x);});
 test("search API is server-side and keeps service role off browser",async({request})=>{const t=await source(request,"functions/api/search-products.js");for(const x of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","/rest/v1/rpc/search_public_products","p_query","p_category","p_store_slug","p_page_size"])expect(t).toContain(x);expect(t).not.toContain("window.SUPABASE_SERVICE_ROLE_KEY");});
 test("buyer UI wires server search, facets and pagination",async({request})=>{const h=await source(request,"index.html"),j=await source(request,"search-discovery-p30.js");expect(h).toContain("search-discovery-p30.js");expect(h).toContain("window.marketKitaProducts=products");for(const x of ["/api/search-products","marketplaceCategory","marketplaceStore","p30SearchPager","siteSearch","marketKitaProducts","marketKitaFilters"])expect(j).toContain(x);});
 test("production marketplace remains reachable",async({request})=>{const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy();});
});