import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";

test.describe("P24 — Chat & Social Marketplace",()=>{
  test("buyer storefront exposes chat, wishlist and social follow",async({request})=>{
    const r=await request.get(baseURL+"/");expect(r.ok()).toBeTruthy();
    const html=await r.text();
    expect(html).toContain('id="wishlistButton"');
    expect(html).toContain('onclick="openSellerChat()"');
    expect(html).toContain('market-social.js');
    expect(html).toContain('id="chatModal"');
    expect(html).toContain('marketKitaGetSupabase');
  });
  test("seller center exposes buyer chat realtime",async({request})=>{
    const r=await request.get(baseURL+"/seller.html");expect(r.ok()).toBeTruthy();
    const html=await r.text();
    expect(html).toContain("loadSellerChats");
    expect(html).toContain("seller-chat-");
    expect(html).toContain("chat_messages");
  });
  test("social script provides authenticated store follow",async({request})=>{
    const r=await request.get(baseURL+"/market-social.js");expect(r.ok()).toBeTruthy();
    const s=await r.text();
    for(const marker of ["store_follows","toggleStoreFollow","onConflict","Ikuti Toko"])expect(s).toContain(marker);
  });
  test("P24 migration hardens chat and adds RLS-protected store follows",async({request})=>{
    const r=await request.get("https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/supabase/migrations/20261003100000_priority24_chat_social_marketplace.sql");expect(r.ok()).toBeTruthy();
    const s=await r.text();
    for(const marker of ["chat_threads_buyer_store_unique","revoke execute on function public.open_chat_thread(uuid) from anon","alter function public.open_chat_thread(uuid) set search_path = ''","create table if not exists public.store_follows","alter table public.store_follows enable row level security","store_follows_insert_own","store_follows_delete_own"])expect(s).toContain(marker);
  });
});
