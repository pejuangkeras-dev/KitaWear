import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("G1 — Search 2.0",()=>{
 test("hardening migration has token relevance, stable requested sorting and suggestions",async({request})=>{
  const t=await source(request,"supabase/migrations/20261003190000_g1_search_2_hardening.sql");
  for(const x of ["normalized_q","regexp_split_to_array","tokens","relevance","price_asc","price_desc","rating_desc","search_public_suggestions"])expect(t).toContain(x);
 });
 test("search API stays server-side",async({request})=>{
  const t=await source(request,"functions/api/search-products.js");
  expect(t).toContain("SUPABASE_SERVICE_ROLE_KEY");expect(t).not.toContain("window.SUPABASE_SERVICE_ROLE_KEY");
 });
 test("suggestion API never exposes service role key",async({request})=>{
  const t=await source(request,"functions/api/search-suggestions.js");
  expect(t).toContain("SUPABASE_SERVICE_ROLE_KEY");expect(t).not.toContain("window.SUPABASE_SERVICE_ROLE_KEY");
 });
 test("buyer search UI exposes filters and rating sort",async({request})=>{
  const h=await source(request,"index.html");
  expect(h).toContain('id="marketplaceSearch"');expect(h).toContain('value="rating_desc"');
 });
 test("production search endpoint responds",async({request})=>{
  const r=await request.get(baseURL+"/api/search-products?q=kaos&page=1&page_size=4");
  expect(r.ok()).toBeTruthy();const d=await r.json();expect(Array.isArray(d.products)).toBeTruthy();
 });
 test("production suggestion endpoint responds",async({request})=>{
  const r=await request.get(baseURL+"/api/search-suggestions?q=ka&page=1");
  expect(r.ok()).toBeTruthy();const d=await r.json();expect(Array.isArray(d.suggestions)).toBeTruthy();
 });
});
