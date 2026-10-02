function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

const clean = value => String(value == null ? "" : value).trim();

function mapMidtransStatus(transactionStatus, fraudStatus) {
  const status = clean(transactionStatus).toLowerCase();
  const fraud = clean(fraudStatus).toLowerCase();

  if (fraud === "deny" || status === "deny" || status === "failure") {
    return { orderStatus: "cancelled", paymentStatus: "failed" };
  }
  // Do not fulfill a challenged card capture until Midtrans/FDS approves it.
  if (status === "capture" && fraud === "challenge") {
    return { orderStatus: "pending_payment", paymentStatus: "pending" };
  }
  if (status === "settlement" || status === "capture") {
    return { orderStatus: "paid", paymentStatus: "paid" };
  }
  if (status === "authorize" || status === "pending") {
    return { orderStatus: "pending_payment", paymentStatus: "pending" };
  }
  if (status === "expire") {
    return { orderStatus: "cancelled", paymentStatus: "expired" };
  }
  if (status === "cancel") {
    return { orderStatus: "cancelled", paymentStatus: "failed" };
  }
  if (status === "refund" || status === "chargeback") {
    return { orderStatus: "refunded", paymentStatus: "refunded" };
  }
  if (status === "partial_refund" || status === "partial_chargeback") {
    return { orderStatus: "paid", paymentStatus: "paid" };
  }
  return { orderStatus: "pending_payment", paymentStatus: "pending" };
}

async function supabase(context, path, options = {}) {
  const base = clean(context.env.SUPABASE_URL).replace(/\/+$/, "");
  const key = clean(context.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!base || !key) throw new Error("Konfigurasi Supabase server belum lengkap.");

  const response = await fetch(base + path, {
    ...options,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(data?.message || data?.details || data?.hint || data?.error || ("Supabase HTTP " + response.status));
  }
  return data;
}

async function authUser(context) {
  const base = clean(context.env.SUPABASE_URL).replace(/\/+$/, "");
  const anon = clean(context.env.SUPABASE_ANON_KEY);
  const header = context.request.headers.get("Authorization") || "";
  if (!base || !anon || !/^Bearer\s+/i.test(header)) return null;
  const response = await fetch(base + "/auth/v1/user", {
    headers: { apikey: anon, Authorization: header }
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

async function assertAdmin(context, userId) {
  const rows = await supabase(
    context,
    "/rest/v1/profiles?select=id,role&id=eq." + encodeURIComponent(userId) + "&limit=1"
  );
  if (clean(rows?.[0]?.role).toLowerCase() !== "admin") {
    throw Object.assign(new Error("Akses ditolak. Hanya admin."), { status: 403 });
  }
}

async function getMidtransStatus(context, lookupId) {
  const serverKey = clean(context.env.MIDTRANS_SERVER_KEY);
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum tersedia di Cloudflare.");

  const production = clean(context.env.MIDTRANS_IS_PRODUCTION || "false").toLowerCase() === "true";
  const base = production
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";

  const auth = btoa(serverKey + ":");
  const response = await fetch(
    base + "/v2/" + encodeURIComponent(lookupId) + "/status",
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Basic " + auth
      }
    }
  );

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}

  if (!response.ok) {
    const error = new Error(data?.status_message || "Midtrans GET Status gagal.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function recordEvent(context, eventKey, order, payload) {
  const rows = await supabase(context, "/rest/v1/payment_events", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      provider: "midtrans",
      event_key: eventKey,
      event_type: "reconciliation",
      order_id: order.id,
      transaction_id: payload?.transaction_id || null,
      transaction_status: payload?.transaction_status || null,
      status_code: payload?.status_code || null,
      status_message: payload?.status_message || null,
      payment_type: payload?.payment_type || null,
      fraud_status: payload?.fraud_status || null,
      gross_amount: Number.isFinite(Number(payload?.gross_amount)) ? Math.round(Number(payload.gross_amount)) : null,
      source: "reconciliation",
      payload: payload || {}
    })
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function applyStatus(context, order, payload) {
  const mapped = mapMidtransStatus(payload?.transaction_status, payload?.fraud_status);
  const currentPayment = clean(order.payment_status).toLowerCase();
  const incomingPayment = clean(mapped.paymentStatus).toLowerCase();

  const stale =
    currentPayment === "refunded" ||
    (currentPayment === "paid" && ["pending", "failed", "expired"].includes(incomingPayment)) ||
    (["failed", "expired"].includes(currentPayment) && ["pending", "paid"].includes(incomingPayment)) ||
    (clean(order.status).toLowerCase() === "cancelled" && incomingPayment === "paid");

  if (stale) {
    return { mapped, ignored: true, reason: "stale_provider_status" };
  }

  const patch = {
    status: mapped.orderStatus,
    payment_status: mapped.paymentStatus,
    midtrans_order_id: clean(payload?.order_id) || order.midtrans_order_id || order.order_number,
    midtrans_transaction_id: clean(payload?.transaction_id) || order.midtrans_transaction_id || null,
    payment_last_synced_at: new Date().toISOString(),
    payment_status_code: clean(payload?.status_code) || null,
    payment_status_message: clean(payload?.status_message) || null,
    payment_type: clean(payload?.payment_type) || null,
    payment_fraud_status: clean(payload?.fraud_status) || null
  };

  if (mapped.paymentStatus === "paid" && !order.paid_at) {
    patch.paid_at = new Date().toISOString();
  }

  await supabase(
    context,
    "/rest/v1/orders?id=eq." + encodeURIComponent(order.id),
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch)
    }
  );

  if (mapped.paymentStatus === "paid") {
    await supabase(context, "/rest/v1/rpc/decrement_order_stock", {
      method: "POST",
      body: JSON.stringify({ p_order_id: order.id })
    }).catch(() => {});

    await supabase(context, "/rest/v1/rpc/create_order_payouts", {
      method: "POST",
      body: JSON.stringify({ p_order_id: order.id })
    }).catch(() => {});
  }

  if (order.voucher_id && order.buyer_id && ["failed", "expired"].includes(mapped.paymentStatus)) {
    await supabase(context, "/rest/v1/rpc/release_user_voucher", {
      method: "POST",
      body: JSON.stringify({
        p_voucher_id: order.voucher_id,
        p_user_id: order.buyer_id
      })
    }).catch(() => {});
  }

  if (order.buyer_id && currentPayment !== incomingPayment) {
    await supabase(context, "/rest/v1/notifications", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: order.buyer_id,
        type: "payment",
        title: mapped.paymentStatus === "paid"
          ? "Pembayaran berhasil"
          : "Status pembayaran diperbarui",
        message: "Status pembayaran pesanan " + order.order_number + " sekarang " + mapped.paymentStatus + ".",
        link: "/?order=" + encodeURIComponent(order.id)
      })
    }).catch(() => {});
  }

  return { mapped, ignored: false };
}

export async function onRequestPost(context) {
  try {
    const user = await authUser(context);
    if (!user) return json({ error: "LOGIN_REQUIRED" }, 401);
    await assertAdmin(context, user.id);

    const body = await context.request.json().catch(() => ({}));
    const requestedOrderId = clean(body?.order_id);

    const filters = requestedOrderId
      ? "id=eq." + encodeURIComponent(requestedOrderId)
      : "payment_status=eq.pending&created_at=lt." + encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString());

    const orders = await supabase(
      context,
      "/rest/v1/orders?select=id,order_number,total,status,payment_status,midtrans_order_id,midtrans_transaction_id,paid_at,buyer_id,voucher_id,created_at&" +
      filters +
      "&order=created_at.asc&limit=20"
    );

    if (requestedOrderId && (!Array.isArray(orders) || !orders.length)) {
      return json({ error: "Order tidak ditemukan." }, 404);
    }

    const results = [];
    for (const order of Array.isArray(orders) ? orders : []) {
      const lookupId = clean(order.midtrans_transaction_id) || clean(order.midtrans_order_id) || clean(order.order_number);
      if (!lookupId) {
        results.push({ order_id: order.id, order_number: order.order_number, error: "Midtrans order/transaction ID belum tersedia." });
        continue;
      }

      try {
        const provider = await getMidtransStatus(context, lookupId);
        if (clean(provider.order_id) && clean(provider.order_id) !== clean(order.order_number)) {
          results.push({ order_id: order.id, order_number: order.order_number, error: "Midtrans order_id tidak cocok." });
          continue;
        }

        const amount = Number(provider.gross_amount);
        if (Number.isFinite(amount) && Math.abs(amount - Number(order.total)) > 0.001) {
          results.push({ order_id: order.id, order_number: order.order_number, error: "Nominal Midtrans tidak cocok dengan order." });
          continue;
        }

        const eventKey = [
          "reconcile",
          order.id,
          clean(provider.transaction_id),
          clean(provider.transaction_status).toLowerCase(),
          clean(provider.status_code)
        ].join(":");

        const isNew = await recordEvent(context, eventKey, order, provider);
        if (!isNew) {
          results.push({ order_id: order.id, order_number: order.order_number, duplicate: true, transaction_status: provider.transaction_status });
          continue;
        }

        const applied = await applyStatus(context, order, provider);
        results.push({
          order_id: order.id,
          order_number: order.order_number,
          transaction_status: provider.transaction_status || null,
          payment_status: applied.mapped.paymentStatus,
          order_status: applied.mapped.orderStatus,
          ignored: applied.ignored || false
        });
      } catch (error) {
        results.push({
          order_id: order.id,
          order_number: order.order_number,
          error: error?.message || "Gagal membaca status Midtrans.",
          provider_status: error?.status || null
        });
      }
    }

    return json({
      ok: true,
      checked: results.length,
      results
    });
  } catch (error) {
    const status = Number(error?.status) || (/LOGIN_REQUIRED/i.test(error?.message || "") ? 401 : 500);
    return json({ error: error?.message || "Gagal menjalankan rekonsiliasi pembayaran." }, status);
  }
}

export async function onRequestGet(context) {
  return json({
    ok: true,
    service: "MarketKita Midtrans Payment Reconciliation",
    mode: clean(context.env.MIDTRANS_IS_PRODUCTION || "false").toLowerCase() === "true" ? "production" : "sandbox",
    configured: Boolean(clean(context.env.MIDTRANS_SERVER_KEY))
  });
}
