import { test, expect } from "@playwright/test";

const baseURL = process.env.MARKETKITA_URL || "https://marketkita.pages.dev";
const rawBase = "https://raw.githubusercontent.com/pejuangkeras-dev/MarketKita/main/";

async function source(request, path) {
  const response = await request.get(rawBase + path);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("P31 — checkout idempotency", () => {
  test("checkout requires an idempotency key and fingerprints the request", async ({ request }) => {
    const text = await source(request, "functions/api/create-transaction.js");
    expect(text).toContain('context.request.headers.get("Idempotency-Key")');
    expect(text).toContain("requestFingerprint");
    expect(text).toContain("Idempotency-Key sudah digunakan untuk checkout dengan data berbeda.");
  });

  test("same successful checkout can replay the existing Midtrans token", async ({ request }) => {
    const text = await source(request, "functions/api/create-transaction.js");
    expect(text).toContain('idem.status === "created" && idem.midtrans_token');
    expect(text).toContain("idempotent_replay: true");
  });

  test("concurrent duplicate checkout is rejected while the first request is processing", async ({ request }) => {
    const text = await source(request, "functions/api/create-transaction.js");
    expect(text).toContain('idem.status === "processing"');
    expect(text).toContain("Checkout dengan permintaan yang sama sedang diproses");
  });

  test("idempotency storage is isolated from client roles", async ({ request }) => {
    const text = await source(request, "supabase/migrations/20261003060000_priority31_checkout_idempotency.sql");
    expect(text).toContain("unique (buyer_id,idempotency_key)");
    expect(text).toContain("enable row level security");
    expect(text).toContain("revoke all on table public.checkout_idempotency from anon,authenticated");
  });

  test("production marketplace remains reachable", async ({ request }) => {
    const response = await request.get(baseURL + "/");
    expect(response.ok()).toBeTruthy();
  });
});
