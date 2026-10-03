import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase=`https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/${process.env.GITHUB_SHA||"main"}/`;
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("P34 — analytics",()=>{
 test("analytics migration creates event tracking and dashboard functions",async({request})=>{
  const t=await source(request,"supabase/migrations/20261003170000_priority34_analytics.sql");
  expect(t).toContain("create table if not exists public.analytics_events");
  expect(t).toContain("create or replace function public.analytics_track_event");
  expect(t).toContain("create or replace function public.analytics_dashboard");
  expect(t).toContain("retention_pct");expect(t).toContain("visitor_to_purchase_pct");expect(t).toContain("campaigns");
 });
 test("analytics event API validates event names and exposes POST",async({request})=>{
  const t=await source(request,"functions/api/analytics.js");
  expect(t).toContain('export async function onRequestPost');
  expect(t).toContain('event_name');
  expect(t).toContain('purchase_success');
  expect(t).toContain('Payload terlalu besar');
 });
 test("analytics dashboard API is admin/seller scoped",async({request})=>{
  const t=await source(request,"functions/api/analytics.js");
  expect(t).toContain('ADMIN_OR_SELLER_REQUIRED');
  expect(t).toContain('role==="seller"');
  expect(t).toContain('analytics_dashboard');
 });
 test("buyer funnel tracker records page, product, cart, checkout and purchase events",async({request})=>{
  const t=await source(request,"analytics-p34.js");
  for(const e of ["page_view","product_view","add_to_cart","checkout_started","purchase_success"]) expect(t).toContain(e);
  expect(t).toContain("marketkita_analytics_session_v1");
 });
 test("search discovery records query analytics",async({request})=>{
  const t=await source(request,"search-discovery-p30.js");
  expect(t).toContain('marketKitaTrack("search"');
 });
 test("admin exposes P34 analytics dashboard",async({request})=>{
  const t=await source(request,"admin.html");
  for(const x of ["p34AnalyticsPanel","p34Gmv","p34VisitorPurchase","p34Retention","p34Campaigns","loadP34Analytics"]) expect(t).toContain(x);
 });
 test("analytics endpoint is rate limited",async({request})=>{
  const t=await source(request,"functions/api/_middleware.js");
  expect(t).toContain('"/api/analytics"');
  expect(t).toContain('label:"analytics"');
 });
 test("production analytics endpoint rejects unauthenticated dashboard access",async({request})=>{
  const r=await request.get(baseURL+"/api/analytics?from=2026-09-01&to=2026-10-03");
  expect(r.status()).toBe(401);
 });
 test("production marketplace remains reachable",async({request})=>{
  const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy();
 });
});