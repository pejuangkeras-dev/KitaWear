import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";

test.describe("P22 lifecycle", () => {
  test("GET requires login", async ({ request }) => {
    const response = await request.get(baseURL + "/api/marketplace-lifecycle");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("LOGIN_REQUIRED");
  });

  test("POST requires login", async ({ request }) => {
    const response = await request.post(baseURL + "/api/marketplace-lifecycle", {
      data: { action: "request_return" }
    });
    expect(response.status()).toBe(401);
  });

  test("lifecycle endpoint is deployed", async ({ request }) => {
    const response = await request.get(baseURL + "/api/marketplace-lifecycle");
    expect([401, 500]).toContain(response.status());
  });
});
