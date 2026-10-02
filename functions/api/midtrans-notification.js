function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function timingSafeEqualHex(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();

  if (left.length !== right.length) return false;

  let diff = 0;

  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}

async function sha512Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-512", bytes);

  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

async function supabaseRequest(url, key, path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(key),
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.hint ||
      data?.details ||
      data?.error ||
      `Supabase HTTP ${response.status}`;

    throw new Error(String(message));
  }

  return data;
}


async function recordWebhookEvent(url, key, eventKey, orderId, payload) {
  if (!eventKey) return;
  try {
    await supabaseRequest(url, key, "/rest/v1/webhook_events", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        provider: "midtrans",
        event_key: eventKey,
        order_id: orderId || null,
        payload: payload || {}
      })
    });
  } catch (e) {
    console.warn("Midtrans webhook event audit skipped:", e?.message || e);
  }
}

function mapMidtransStatus(transactionStatus, fraudStatus) {
  const status = String(transactionStatus || "").toLowerCase();
  const fraud = String(fraudStatus || "").toLowerCase();

  // Midtrans statuses are mapped to the MarketKita enums.
  // order_status has no "failed"/"pending", while payment_status
  // distinguishes failed vs expired.
  if (fraud === "deny" || status === "deny" || status === "failure") {
    return {
      orderStatus: "cancelled",
      paymentStatus: "failed"
    };
  }

  if (status === "settlement" || status === "capture") {
    return {
      orderStatus: "paid",
      paymentStatus: "paid"
    };
  }

  if (status === "authorize") {
    return {
      orderStatus: "pending_payment",
      paymentStatus: "pending"
    };
  }

  if (status === "pending") {
    return {
      orderStatus: "pending_payment",
      paymentStatus: "pending"
    };
  }

  if (status === "expire") {
    return {
      orderStatus: "cancelled",
      paymentStatus: "expired"
    };
  }

  if (status === "cancel") {
    return {
      orderStatus: "cancelled",
      paymentStatus: "failed"
    };
  }

  if (status === "refund" || status === "chargeback") {
    return {
      orderStatus: "refunded",
      paymentStatus: "refunded"
    };
  }

  // A partial refund does not mean the marketplace order is fully refunded.
  // Keep the order paid and let the dispute/refund workflow track the partial amount.
  if (status === "partial_refund" || status === "partial_chargeback") {
    return {
      orderStatus: "paid",
      paymentStatus: "paid"
    };
  }

  return {
    orderStatus: "pending_payment",
    paymentStatus: "pending"
  };
}

export async function onRequestPost(context) {
  try {
    const env = context.env;

    const supabaseUrl = normalizeUrl(env.SUPABASE_URL);

    const serviceRoleKey = String(
      env.SUPABASE_SERVICE_ROLE_KEY || ""
    ).trim();

    const serverKey = String(
      env.MIDTRANS_SERVER_KEY || ""
    ).trim();

    if (!supabaseUrl || !serviceRoleKey || !serverKey) {
      return json(
        {
          error: "Konfigurasi server KitaWear belum lengkap."
        },
        500
      );
    }

    const body = await context.request.json();

    const orderId = String(body?.order_id || "").trim();
    const statusCode = String(body?.status_code || "").trim();
    const grossAmount = String(body?.gross_amount || "").trim();
    const signatureKey = String(body?.signature_key || "").trim();

    if (
      !orderId ||
      !statusCode ||
      !grossAmount ||
      !signatureKey
    ) {
      return json(
        {
          error: "Notification Midtrans tidak lengkap."
        },
        400
      );
    }

    const expectedSignature = await sha512Hex(
      orderId +
      statusCode +
      grossAmount +
      serverKey
    );

    if (
      !timingSafeEqualHex(
        expectedSignature,
        signatureKey
      )
    ) {
      return json(
        {
          error: "Signature notification tidak valid."
        },
        401
      );
    }

    const orders = await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/orders?select=id,order_number,total,status,payment_status,midtrans_order_id,midtrans_transaction_id,paid_at,buyer_id,voucher_id&order_number=eq.${encodeURIComponent(orderId)}&limit=1`,
      {
        method: "GET"
      }
    );

    if (!Array.isArray(orders) || !orders.length) {
      return json(
        {
          error: "Order KitaWear tidak ditemukan."
        },
        404
      );
    }

    const order = orders[0];

    const notifiedAmount = Number(grossAmount);
    const orderAmount = Number(order.total);

    if (
      !Number.isFinite(notifiedAmount) ||
      !Number.isFinite(orderAmount) ||
      Math.abs(notifiedAmount - orderAmount) > 0.001
    ) {
      return json(
        {
          error: "Nominal transaksi tidak cocok dengan order."
        },
        400
      );
    }

    const incomingRefundStatus=String(body?.transaction_status||"").toLowerCase();
    const incomingRefundKey=String(body?.refund_key||"").trim();
    if(["refund","partial_refund"].includes(incomingRefundStatus) && incomingRefundKey.startsWith("MK-REFUND-")){
      // Midtrans sends bank_confirmed_at inside the matching item of the \`refunds\` array
      // on the confirmed refund notification, not necessarily at the top level.
      const refundRows=Array.isArray(body?.refunds)?body.refunds:[];
      const matchingRefund=refundRows.find(item =>
        String(item?.refund_key||"").trim()===incomingRefundKey
      ) || refundRows[0] || null;
      const rawConfirmedAt=body?.bank_confirmed_at || matchingRefund?.bank_confirmed_at || null;
      const confirmedAt=rawConfirmedAt ? new Date(rawConfirmedAt).toISOString() : null;
      const refundAmount=Number(
        body?.refund_amount ??
        matchingRefund?.refund_amount ??
        0
      );
      const updateStatus=incomingRefundStatus==="refund" && confirmedAt
        ? "succeeded"
        : "pending_confirmation";

      const refundResult=await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/service_update_refund_request",
        {
          method:"POST",
          body:JSON.stringify({
            p_refund_key:incomingRefundKey,
            p_status:updateStatus,
            p_status_code:statusCode,
            p_status_message:String(body?.status_message||"Midtrans refund notification"),
            p_refund_chargeback_id:body?.refund_chargeback_id!=null?String(body.refund_chargeback_id):null,
            p_refund_amount:Number.isFinite(refundAmount)?refundAmount:null,
            p_midtrans_transaction_id:body?.transaction_id||null,
            p_bank_confirmed_at:confirmedAt,
            p_raw_response:body,
            p_error_message:null
          })
        }
      );

      await recordWebhookEvent(supabaseUrl, serviceRoleKey, signatureKey, order.id, body);
      return json({
        ok:true,
        order_id:orderId,
        refund_key:incomingRefundKey,
        refund_status:incomingRefundStatus,
        confirmation_status:updateStatus,
        refund:refundResult
      });
    }

    const mapped = mapMidtransStatus(
      body?.transaction_status,
      body?.fraud_status
    );

    // Midtrans may deliver notifications out of order. Never let a
    // stale pending/failed/expired notification downgrade a paid/refunded
    // order, and never let a late payment resurrect a cancelled order.
    const currentPayment = String(order.payment_status || "").toLowerCase();
    const incomingPayment = String(mapped.paymentStatus || "").toLowerCase();
    const shouldIgnore =
      currentPayment === "refunded" ||
      (currentPayment === "paid" && ["pending", "failed", "expired"].includes(incomingPayment)) ||
      (["failed", "expired"].includes(currentPayment) && ["pending", "paid"].includes(incomingPayment)) ||
      (String(order.status || "").toLowerCase() === "cancelled" && incomingPayment === "paid");

    if (shouldIgnore) {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        `/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            midtrans_order_id: orderId,
            midtrans_transaction_id: body?.transaction_id || order.midtrans_transaction_id || null
          })
        }
      );

      return json({
        ok: true,
        order_id: orderId,
        ignored: true,
        reason: "stale_midtrans_notification",
        current_payment_status: currentPayment,
        incoming_payment_status: incomingPayment
      });
    }

    const orderPatch = {
      status: mapped.orderStatus,
      payment_status: mapped.paymentStatus,
      midtrans_order_id: orderId,
      midtrans_transaction_id: body?.transaction_id || order.midtrans_transaction_id || null
    };

    if (mapped.paymentStatus === "paid" && !order.paid_at) {
      orderPatch.paid_at = new Date().toISOString();
    }

    await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify(orderPatch)
      }
    );

    // Voucher yang sudah dikonsumsi saat membuat transaksi dikembalikan
    // hanya jika Midtrans benar-benar menyatakan pembayaran gagal/kedaluwarsa/batal.
    // release_user_voucher aman dipanggil ulang (idempotent).
    if (
      order.voucher_id &&
      order.buyer_id &&
      ["failed", "expired"].includes(String(mapped.paymentStatus || "").toLowerCase())
    ) {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/release_user_voucher",
        {
          method: "POST",
          body: JSON.stringify({
            p_voucher_id: order.voucher_id,
            p_user_id: order.buyer_id
          })
        }
      );
    }

    // Sinkronkan status pembayaran ke semua seller
    // yang berada di dalam order yang sama.
await supabaseRequest(
  supabaseUrl,
  serviceRoleKey,
  `/rest/v1/order_sellers?order_id=eq.${encodeURIComponent(order.id)}`,
  {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      seller_status: mapped.orderStatus
    })
  }
);

    // Kurangi stok hanya setelah pembayaran benar-benar paid.
    // Fungsi database memiliki guard idempotensi agar notification
    // Midtrans yang sama tidak mengurangi stok dua kali.
    if (mapped.paymentStatus === "paid") {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/decrement_order_stock",
        {
          method: "POST",
          body: JSON.stringify({
            p_order_id: order.id
          })
        }
      );
    }

      // If a paid order is fully refunded, restore its stock exactly once.
    // restore_order_stock is idempotent via orders.stock_restored_at.
    const refundStatus = String(body?.transaction_status || "").toLowerCase();
    const refundAmount = Number(body?.refund_amount);
    const isFullRefund = refundStatus === "refund" && Number.isFinite(refundAmount) && refundAmount >= orderAmount;

    if (mapped.paymentStatus === "refunded" && isFullRefund) {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/restore_order_stock",
        {
          method: "POST",
          body: JSON.stringify({ p_order_id: order.id })
        }
      );
    }

    // Shipping is handled by the seller's manual AWB entry + RajaOngkir tracking.
    // Do not call the legacy Biteship endpoint after payment.
    
    // Create seller payout records only after payment is confirmed.
    // The payout stays pending until the buyer confirms receipt.
    if (mapped.paymentStatus === "paid") {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/create_order_payouts",
        {
          method: "POST",
          body: JSON.stringify({
            p_order_id: order.id
          })
        }
      );
    }
    await recordWebhookEvent(supabaseUrl, serviceRoleKey, signatureKey, order.id, body);
    return json({
      ok: true,
      order_id: orderId,
      transaction_status:
        body?.transaction_status || null,
      status: mapped.orderStatus,
      payment_status: mapped.paymentStatus
    });
  } catch (error) {
    console.error(
      "KitaWear Midtrans notification error:",
      error?.message || error
    );

    return json(
      {
        error:
          error?.message ||
          "Terjadi kesalahan saat memproses notification Midtrans."
      },
      500
    );
  }
}

export async function onRequestGet() {
  return json({
    ok: true,
    service: "KitaWear Midtrans Notification",
    message:
      "Endpoint aktif. Midtrans harus mengirim POST ke endpoint ini."
  });
}
