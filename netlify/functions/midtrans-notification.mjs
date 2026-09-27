import crypto from "node:crypto";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" }
});

async function supabaseUpdate(orderId, payload) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return;
  await fetch(`${base}/rest/v1/orders?midtrans_order_id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(payload)
  });
}

export default async (request) => {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!serverKey) return json({ error: "MIDTRANS_SERVER_KEY belum diset." }, 500);

    const body = await request.json();
    const orderId = String(body.order_id || "");
    const statusCode = String(body.status_code || "");
    const grossAmount = String(body.gross_amount || "");
    const signature = String(body.signature_key || "");

    const expected = crypto
      .createHash("sha512")
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest("hex");

    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return json({ error: "Invalid signature" }, 403);
    }

    const tx = body.transaction_status;
    const fraud = body.fraud_status;
    let orderStatus = "pending_payment";
    let paymentStatus = "pending";
    let extra = {};

    if (tx === "capture") {
      paymentStatus = "paid";
      orderStatus = fraud === "challenge" ? "pending_payment" : "paid";
    } else if (tx === "settlement") {
      paymentStatus = "paid";
      orderStatus = "paid";
    } else if (tx === "pending") {
      paymentStatus = "pending";
      orderStatus = "pending_payment";
    } else if (["deny", "cancel", "expire"].includes(tx)) {
      paymentStatus = tx === "expire" ? "expired" : "failed";
      orderStatus = "cancelled";
    } else if (tx === "refund" || tx === "partial_refund") {
      paymentStatus = "refunded";
      orderStatus = "refunded";
    }

    if (paymentStatus === "paid") extra.paid_at = new Date().toISOString();

    await supabaseUpdate(orderId, { status: orderStatus, payment_status: paymentStatus, ...extra });
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || "Notification error" }, 500);
  }
};
