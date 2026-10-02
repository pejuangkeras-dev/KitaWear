import { test, expect } from "@playwright/test";
const baseURL=process.env.MARKETKITA_URL||"https://marketkita.pages.dev";
const rawBase="https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";
async function source(request,path){const r=await request.get(rawBase+path);expect(r.ok()).toBeTruthy();return r.text();}
test.describe("P43 — Indonesia province/city selectors",()=>{
  test("checkout has cascading province and city selectors",async({request})=>{
    const h=await source(request,"index.html");
    for(const m of ['id="buyerManualProvince"','id="buyerManualCity"','loadCheckoutProvinces()','loadCheckoutCities(']) expect(h).toContain(m);
  });
  test("province endpoint proxies RajaOngkir securely",async({request})=>{
    const s=await source(request,"functions/api/location-provinces.js");
    expect(s).toContain("RAJAONGKIR_API_KEY"); expect(s).toContain("/destination/province"); expect(s).not.toContain("context.env.RAJAONGKIR_API_KEY");
  });
  test("city endpoint validates province id and proxies RajaOngkir",async({request})=>{
    const s=await source(request,"functions/api/location-cities/[province_id].js");
    expect(s).toContain("province_id"); expect(s).toContain("/destination/city/"); expect(s).toContain("RAJAONGKIR_API_KEY");
  });
});
