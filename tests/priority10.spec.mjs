import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.MARKETKITA_BASE_URL ||
  "https://marketkita.pages.dev";

test.describe("MarketKita Priority 10 Production Hardening", () => {
  test("production homepage is healthy and emits no browser errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));

    const response = await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    expect(response?.ok()).toBeTruthy();
    expect(await page.title()).not.toBe("");
    expect(errors).toEqual([]);
  });

  test("public config exposes only public runtime configuration", async ({ request }) => {
    const response = await request.get(BASE_URL + "/api/public-config");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.supabaseUrl).toMatch(/^https:\/\//);
    expect(data.supabaseAnonKey).toBeTruthy();
    expect(data.clientKey).toBeTruthy();
    expect(data).not.toHaveProperty("supabaseServiceRoleKey");
    expect(data).not.toHaveProperty("serverKey");
    expect(data).not.toHaveProperty("midtransServerKey");
  });

  test("security headers are present", async ({ request }) => {
    const response = await request.get(BASE_URL);
    expect(response.ok()).toBeTruthy();

    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
    expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  });

  test("protected payment endpoint rejects unauthenticated requests", async ({ request }) => {
    const response = await request.post(BASE_URL + "/api/create-transaction", {
      data: { address_id: "invalid", items: [] }
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toContain("login");
  });

  test("protected admin refund endpoint rejects unauthenticated requests", async ({ request }) => {
    const response = await request.post(BASE_URL + "/api/admin-refund", {
      data: { order_id: "invalid" }
    });
    expect([401, 403]).toContain(response.status());
  });
});
