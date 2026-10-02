import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";

test.describe("P23 — lifecycle UI/API integration", () => {
  test("buyer page exposes return workflow", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain("Ajukan Retur / Penggantian");
    expect(html).toContain("/api/returns");
  });

  test("seller center exposes return and payout workflow", async ({ request }) => {
    const response = await request.get(baseURL + "/seller.html");
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain("p14SellerAction");
    expect(html).toContain("requestSellerPayout");
    expect(html).toContain("seller_payout_requests");
  });

  test("admin center exposes refund, dispute, return and payout workflow", async ({ request }) => {
    const response = await request.get(baseURL + "/admin.html");
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    for (const marker of [
      "loadAdminReturns",
      "loadAdminRefunds",
      "loadDisputes",
      "loadPayoutRequests",
      "admin-refund",
      "admin-refund-status"
    ]) {
      expect(html).toContain(marker);
    }
  });

  test("unified lifecycle endpoint requires authentication", async ({ request }) => {
    const response = await request.get(baseURL + "/api/marketplace-lifecycle");
    expect(response.status()).toBe(401);
  });
});
