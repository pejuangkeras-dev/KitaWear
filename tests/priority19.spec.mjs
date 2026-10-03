import { test, expect } from "@playwright/test";
import fs from "node:fs";

test.describe("P19 shipping webhook E2E hardening", () => {
  test("webhook endpoint requires shared secret and accepts POST/PUT", async () => {
    const source=fs.readFileSync("functions/api/shipping-webhook.js","utf8");
    expect(source).toContain("RAJAONGKIR_WEBHOOK_SECRET");
    expect(source).toContain('context.request.method==="POST"');
    expect(source).toContain('context.request.method==="PUT"');
    expect(source).toContain('return json({error:"Unauthorized"},401)');
  });

  test("webhook events are idempotent with unique provider/event key", async () => {
    const source=fs.readFileSync("functions/api/shipping-webhook.js","utf8");
    expect(source).toContain("webhook_events");
    expect(source).toContain('provider:"rajaongkir_delivery"');
    expect(source).toContain("event_key");
    expect(source).toContain("duplicate:true");
  });

  test("stale webhook status cannot regress delivered/cancelled shipment", async () => {
    const source=fs.readFileSync("functions/api/shipping-webhook.js","utf8");
    expect(source).toContain("statusRank");
    expect(source).toContain("staleStatus");
    expect(source).toContain("current_status");
    expect(source).toContain("incoming_status");
  });

  test("legacy RajaOngkir webhook route uses the same hardened handler", async () => {
    const source=fs.readFileSync("functions/api/rajaongkir-webhook.js","utf8");
    expect(source).toContain('./shipping-webhook.js');
    expect(source).toContain('shippingWebhook(context)');
  });
});