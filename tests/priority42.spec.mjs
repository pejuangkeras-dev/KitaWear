import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P42 — manual checkout address shipping", () => {
  test("checkout exposes manual address fields and shipping mode", async ({ request }) => {
    const html = await source(request, "index.html");
    for (const marker of [
      'id="buyerAddressMode"',
      'value="manual"',
      'id="buyerManualAddressLine"',
      'id="buyerManualCity"',
      'id="buyerManualProvince"',
      'id="buyerManualPostalCode"',
      "manual_address:manualAddress",
      "calculateCheckoutShipping()"
    ]) expect(html).toContain(marker);
  });

  test("shipping quote accepts manual address snapshots", async ({ request }) => {
    const src = await source(request, "functions/api/shipping-quote.js");
    for (const marker of [
      "manual_address",
      "hasManual",
      "Kode pos 5 digit",
      "request_snapshot:snapshot"
    ]) expect(src).toContain(marker);
  });

  test("transaction API binds manual address to the shipping quote", async ({ request }) => {
    const src = await source(request, "functions/api/create-transaction.js");
    for (const marker of [
      "manual_address",
      "hasManualAddress",
      "manualMatches",
      "shippingAddress = { ...manualAddress, id: null }"
    ]) expect(src).toContain(marker);
  });

  test("shipping quote endpoint remains protected", async ({ request }) => {
    const response = await request.post(baseURL + "/api/shipping-quote", {
      data: { manual_address: { postal_code: "29444" }, items: [] }
    });
    expect(response.status()).toBe(401);
  });
});
