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

  if (
    status === "settlement" ||
    status === "capture" ||
    status === "authorize"
  ) {
    return {
      orderStatus: "paid",
      paymentStatus: "paid"
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

  if (status === "refund" || status === "partial_refund" || status === "chargeback" || status === "partial_chargeback") {
    return {
      orderStatus: "refunded",
      paymentStatus: "refunded"
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
      `/rest/v1/orders?select=id,order_number,total,status,payment_status&order_number=eq.${encodeURIComponent(orderId)}&limit=1`,
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

   const mapped = mapMidtransStatus(
  body?.transaction_status,
  body?.fraud_status
);

await supabaseRequest(
  supabaseUrl,
  serviceRoleKey,
  `/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`,
  {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      status: mapped.orderStatus,
      payment_status: mapped.paymentStatus
    })
  }
);

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
    if (mapped.paymentStatus === "refunded") {
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
