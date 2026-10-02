import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const r = await request.get(rawBase + path);
  expect(r.ok()).toBeTruthy();
  return r.text();
}

test.describe("P44 — automatic Indonesia location picker", () => {
  test("checkout exposes automatic location picker", async ({ request }) => {
    const html = await source(request, "index.html");
    for (const marker of [
      "buyerLocationPickerButton",
      "locationPickerModal",
      "locationPickerTab",
      "selectLocationPickerRow",
      "filterLocationPicker",
      "/api/location-provinces",
      "/api/location-cities/",
      "/api/location-districts/",
      "/api/location-subdistricts/",
      "/api/location-search"
    ]) expect(html).toContain(marker);
  });

  test("location APIs keep RajaOngkir key server-side", async ({ request }) => {
    for (const path of [
      "functions/api/location-districts/[city_id].js",
      "functions/api/location-subdistricts/[district_id].js",
      "functions/api/location-search.js"
    ]) {
      const text = await source(request, path);
      expect(text).toContain("RAJAONGKIR_API_KEY");
      expect(text).toContain("rajaongkir.komerce.id");
    }
  });

  test("shipping quote accepts exact selected destination", async ({ request }) => {
    const text = await source(request, "functions/api/shipping-quote.js");
    expect(text).toContain("destination_id");
    expect(text).toContain("rajaDestination");
    expect(text).toContain("calculate/domestic-cost");
    expect(text).toContain("address.destination_id");
    expect(text).toContain("/calculate/domestic-cost");
  });

  test("checkout binds district/subdistrict changes to the shipping quote", async ({ request }) => {
    const html = await source(request, "index.html");
    const tx = await source(request, "functions/api/create-transaction.js");
    expect(html).toContain("district:document.getElementById");
    expect(html).toContain("subdistrict:document.getElementById");
    expect(html).toContain("destination_id:String(kwLocationPicker.subdistrict?.id||\"\").trim()");
    expect(tx).toContain("quotedManual.district");
    expect(tx).toContain("quotedManual.subdistrict");
  });

  test("public homepage remains reachable", async ({ request }) => {
    const r = await request.get(baseURL + "/");
    expect(r.ok()).toBeTruthy();
  });
});
