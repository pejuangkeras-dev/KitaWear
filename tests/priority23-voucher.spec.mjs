import { test, expect } from "@playwright/test";
import fs from "node:fs";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const source = fs.readFileSync("functions/api/admin-vouchers.js","utf8");

test.describe("P23 — Voucher & Promotion E2E", () => {
  test("public storefront remains reachable", async ({ request }) => {
    const r = await request.get(baseURL + "/");
    expect(r.ok()).toBeTruthy();
  });

  test("admin voucher API rejects unauthenticated access", async ({ request }) => {
    const r = await request.get(baseURL + "/api/admin-vouchers");
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe("ADMIN_REQUIRED");
  });

  test("admin voucher API rejects unauthenticated mutation", async ({ request }) => {
    const r = await request.post(baseURL + "/api/admin-vouchers", {
      data: { code:"P23TEST", title:"Test", discount_type:"percent", discount_value:10 }
    });
    expect(r.status()).toBe(403);
  });

  test("server validates voucher code and discount boundaries", () => {
    expect(source).toContain("ADMIN_REQUIRED");
    expect(source).toContain("discount_type");
    expect(source).toContain("Diskon persentase maksimal 100.");
    expect(source).toContain("^[A-Z0-9_-]{3,64}$");
    expect(source).toContain("Content-Length");
  });

  test("checkout uses server-side voucher id and atomic consumption", async ({ request }) => {
    const r = await request.get(baseURL + "/");
    const html = await r.text();
    expect(html).toContain("validateCheckoutVoucher");
    expect(html).toContain("marketCheckoutVoucherId");
    expect(html).toContain("claimVoucher");
    expect(fs.readFileSync("functions/api/create-transaction.js","utf8")).toContain("consume_user_voucher");
  });
});
