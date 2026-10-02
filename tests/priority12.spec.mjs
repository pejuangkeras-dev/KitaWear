import { test, expect } from "@playwright/test";

const BASE_URL = process.env.MARKETKITA_BASE_URL || "https://marketkita.pages.dev";

test.describe("MarketKita Priority 12 Financial Ledger", () => {
  test("ledger tables are not publicly writable/readable", async ({ request }) => {
    const config = await request.get(BASE_URL + "/api/public-config");
    expect(config.ok()).toBeTruthy();
    const cfg = await config.json();
    expect(cfg.supabaseUrl).toContain("supabase.co");
    expect(cfg.supabaseAnonKey).toBeTruthy();

    for (const table of ["ledger_accounts", "ledger_transactions", "ledger_entries"]) {
      const response = await request.get(
        cfg.supabaseUrl +
          "/rest/v1/" +
          table +
          "?select=id&limit=1",
        { headers: { apikey: cfg.supabaseAnonKey } }
      );
      expect([401, 403]).toContain(response.status());
    }
  });

  test("financial ledger service is deployed without exposing balances", async ({ request }) => {
    const response = await request.get(BASE_URL + "/api/public-config");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(body).not.toHaveProperty("RAJAONGKIR_WEBHOOK_SECRET");
  });
});
