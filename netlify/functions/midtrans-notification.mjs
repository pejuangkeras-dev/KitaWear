import crypto from "crypto";

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const serverKey = process.env.MIDTRANS_SERVER_KEY;

    if (!serverKey) {
      return new Response(
        JSON.stringify({
          error: "MIDTRANS_SERVER_KEY belum diset di Netlify."
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const notification = await request.json();

    const orderId = notification.order_id || "";
    const statusCode = notification.status_code || "";
    const grossAmount = notification.gross_amount || "";
    const signatureKey = notification.signature_key || "";

    const expectedSignature = crypto
      .createHash("sha512")
      .update(orderId + statusCode + grossAmount + serverKey)
      .digest("hex");

    if (signatureKey !== expectedSignature) {
      return new Response(
        JSON.stringify({
          error: "Signature tidak valid."
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    console.log("Midtrans notification:", {
      orderId,
      transactionStatus: notification.transaction_status,
      fraudStatus: notification.fraud_status
    });

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message || "Notification error."
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
