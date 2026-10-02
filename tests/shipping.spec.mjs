import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.MARKETKITA_BASE_URL ||
  "https://marketkita.pages.dev";

test.describe("MarketKita Priority 9 Shipping", () => {
  test("shipping UI and tracking routes are deployed", async ({ page }) => {
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));

    const response = await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    expect(response?.ok()).toBeTruthy();

    const ui = await page.request.get(BASE_URL + "/shipping-ui.js");
    expect(ui.ok()).toBeTruthy();
    expect(await ui.text()).toContain("RajaOngkir");

    const track = await page.request.get(BASE_URL + "/api/shipping-track");
    expect(track.status()).toBe(200);
    expect(await track.json()).toMatchObject({
      ok: true,
      service: "MarketKita RajaOngkir Tracking"
    });

    expect(errors).toEqual([]);
  });

  test("shipping quote requires authenticated buyer session", async ({ request }) => {
    const response = await request.post(BASE_URL + "/api/shipping-quote", {
      data: { address_id: "invalid", items: [] }
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toContain("login");
  });

  test("shipping tracking requires authenticated buyer or seller session", async ({ request }) => {
    const response = await request.post(BASE_URL + "/api/shipping-track", {
      data: { order_id: "invalid" }
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toContain("login");
  });

  test("automatic delivery creation requires authenticated seller", async ({ request }) => {
    const response = await request.post(BASE_URL + "/api/shipping-create", {
      data: { order_id: "invalid", order_seller_id: "invalid" }
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toContain("login");
  });
});
