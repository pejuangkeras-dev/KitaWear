import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request,path){
  const r=await request.get(rawBase+path);
  expect(r.ok()).toBeTruthy();
  return r.text();
}

test.describe("P28 — Buyer Experience",()=>{
  test("buyer experience module is wired into storefront",async({request})=>{
    const html=await source(request,"index.html");
    expect(html).toContain('buyer-experience-p28.js');
    expect(html).toContain('marketKitaGetSupabase');
  });
  test("core buyer surfaces and safe data access exist",async({request})=>{
    const js=await source(request,"buyer-experience-p28.js");
    for(const marker of ["Akun Saya","Pesanan","Alamat","Favorit","Ulasan","Notifikasi","buyer_addresses","wishlists","product_reviews","notifications","shipping_shipments","set_default_buyer_address","buyer_create_product_review"]) expect(js).toContain(marker);
    for(const marker of ['.eq("buyer_id",u.id)','.eq("user_id",u.id)','.eq("user_id",u.id).is("read_at",null)']) expect(js).toContain(marker);
    for(const secret of ["service_role","SUPABASE_SERVICE_ROLE_KEY","MIDTRANS_SERVER_KEY","RAJAONGKIR_DELIVERY_API_KEY"]) expect(js).not.toContain(secret);
  });
  test("existing P28 order state machine remains protected",async({request})=>{
    const text=await source(request,"supabase/migrations/20261003050000_priority28_order_state_machine.sql");
    expect(text).toContain("validate_order_state_transition");
    expect(text).toContain("trg_validate_order_state_transition");
    expect(text).toContain("revoke execute on function public.validate_order_state_transition() from public, anon, authenticated");
    for(const marker of ["pending_payment","paid","processing","shipped","delivered","completed","cancelled","disputed","refunded"]) expect(text).toContain(marker);
  });
  test("production storefront remains reachable",async({request})=>{
    const r=await request.get(baseURL+"/"); expect(r.ok()).toBeTruthy();
  });
});
