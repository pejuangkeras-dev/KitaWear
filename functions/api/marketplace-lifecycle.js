function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

const clean = (value) => String(value == null ? "" : value).trim();
const MARKETPLACE_ROLES = new Set(["buyer", "seller", "admin"]);

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

async function profile(context, userId) {
  const rows = await supabase(
    context,
    "/rest/v1/profiles?select=id,role,full_name&id=eq." + encodeURIComponent(userId) + "&limit=1"
  );
  return rows?.[0] || null;
}

const ACTIONS = new Set([
  "request_return",
  "seller_update_return",
  "admin_resolve_return",
  "buyer_create_dispute",
  "admin_begin_dispute_refund",
  "admin_resolve_dispute",
  "seller_request_payout",
  "admin_review_payout_request"
]);

const RPC = {
  request_return: "request_return",
  seller_update_return: "seller_update_return",
  admin_resolve_return: "admin_resolve_return",
  buyer_create_dispute: "buyer_create_dispute",
  admin_begin_dispute_refund: "admin_begin_dispute_refund",
  admin_resolve_dispute: "admin_resolve_dispute",
  seller_request_payout: "seller_request_payout",
  admin_review_payout_request: "admin_review_payout_request"
};

const adminActions = new Set([
  "admin_resolve_return",
  "admin_begin_dispute_refund",
  "admin_resolve_dispute",
  "admin_review_payout_request"
]);

async function callRpc(context, name, body) {
  return supabase(context, "/rest/v1/rpc/" + name, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function onRequestGet(context) {
  try {
    const user = await authUser(context);
    if (!user) return json({ error: "LOGIN_REQUIRED" }, 401);
    const p = await profile(context, user.id);
    if (!p) return json({ error: "Profil pengguna tidak ditemukan." }, 403);

    const role = clean(p.role).toLowerCase();
    if (!MARKETPLACE_ROLES.has(role)) {
      return json({ error: "Akun belum memiliki role marketplace yang valid." }, 403);
    }

    const filter = role === "admin"
      ? ""
      : role === "seller"
        ? "&seller_id=eq." + encodeURIComponent(user.id)
        : "&buyer_id=eq." + encodeURIComponent(user.id);

    const [returns, disputes, payouts, refunds] = await Promise.all([
      supabase(context, "/rest/v1/return_requests?select=*&order=created_at.desc&limit=50" + filter),
      supabase(context, "/rest/v1/disputes?select=*&order=created_at.desc&limit=50" + (role === "admin" ? "" : "&buyer_id=eq." + encodeURIComponent(user.id))),
      supabase(context, "/rest/v1/seller_payout_requests?select=*&order=requested_at.desc&limit=50" + (role === "admin" ? "" : "&seller_id=eq." + encodeURIComponent(user.id))),
      supabase(context, "/rest/v1/refund_requests?select=id,dispute_id,return_request_id,order_id,buyer_id,admin_id,refund_key,amount,reason,status,midtrans_status_code,midtrans_status_message,midtrans_refund_chargeback_id,midtrans_refund_amount,midtrans_transaction_id,bank_confirmed_at,requested_at,confirmed_at,created_at,updated_at,error_message&order=created_at.desc&limit=50" + (role === "admin" ? "" : "&buyer_id=eq." + encodeURIComponent(user.id)))
    ]);

    return json({
      ok: true,
      role,
      returns: Array.isArray(returns) ? returns : [],
      disputes: Array.isArray(disputes) ? disputes : [],
      payout_requests: Array.isArray(payouts) ? payouts : [],
      refund_requests: Array.isArray(refunds) ? refunds : []
    });
  } catch (error) {
    console.error("MarketKita lifecycle GET:", error);
    return json({ error: error?.message || "Gagal mengambil status lifecycle." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const user = await authUser(context);
    if (!user) return json({ error: "LOGIN_REQUIRED" }, 401);

    const p = await profile(context, user.id);
    if (!p) return json({ error: "Profil pengguna tidak ditemukan." }, 403);

    const contentLength = Number(context.request.headers.get("Content-Length") || 0);
    if (contentLength > 32768) return json({ error: "Payload lifecycle terlalu besar." }, 413);

    const body = await context.request.json().catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Payload lifecycle tidak valid." }, 400);
    }

    const action = clean(body.action).toLowerCase();
    if (!ACTIONS.has(action)) return json({ error: "Action lifecycle tidak valid." }, 400);

    const role = clean(p.role).toLowerCase();
    if (!MARKETPLACE_ROLES.has(role)) {
      return json({ error: "Akun belum memiliki role marketplace yang valid." }, 403);
    }

    if (adminActions.has(action) && role !== "admin") {
      return json({ error: "Akses ditolak. Hanya admin." }, 403);
    }
    if (action === "seller_request_payout" && role !== "seller") {
      return json({ error: "Akses ditolak. Akun harus seller." }, 403);
    }
    if (action === "request_return" && role !== "buyer") {
      return json({ error: "Akses ditolak. Pengajuan retur hanya untuk buyer." }, 403);
    }
    if (action === "buyer_create_dispute" && role !== "buyer") {
      return json({ error: "Akses ditolak. Pengajuan sengketa hanya untuk buyer." }, 403);
    }
    if (action === "seller_update_return" && !["seller", "admin"].includes(role)) {
      return json({ error: "Akses ditolak. Hanya seller/admin." }, 403);
    }

    const maps = {
      request_return: { p_order_item_id: body.order_item_id, p_type: body.type, p_reason: body.reason, p_description: body.description || null, p_evidence_urls: Array.isArray(body.evidence_urls) ? body.evidence_urls : [] },
      seller_update_return: { p_return_id: body.return_id, p_status: body.status, p_tracking_number: body.tracking_number || null, p_note: body.note || null },
      admin_resolve_return: { p_request_id: body.return_id || body.request_id, p_status: body.status, p_approved_amount: body.approved_amount ?? null, p_note: body.note || null },
      buyer_create_dispute: { p_order_id: body.order_id, p_reason: body.reason, p_description: body.description || null },
      admin_begin_dispute_refund: { p_dispute_id: body.dispute_id, p_reason: body.reason || "Refund sengketa MarketKita" },
      admin_resolve_dispute: { p_dispute_id: body.dispute_id, p_resolution: body.resolution, p_admin_note: body.admin_note || body.note || null },
      seller_request_payout: { p_amount: body.amount, p_note: body.note || null },
      admin_review_payout_request: { p_request_id: body.request_id, p_decision: body.decision, p_admin_note: body.admin_note || body.note || null }
    };

    const rpcArgs = maps[action];
    if (!rpcArgs || Object.values(rpcArgs).some(v => v === undefined)) {
      return json({ error: "Parameter action lifecycle belum lengkap." }, 400);
    }

    const result = await callRpc(context, RPC[action], rpcArgs);
    return json({ ok: true, action, result });
  } catch (error) {
    console.error("MarketKita lifecycle POST:", error);
    const message = error?.message || "Gagal memproses lifecycle.";
    const status = /Akses ditolak|Login diperlukan|Silakan login|Anda harus login|bukan seller/i.test(message) ? 403 : 409;
    return json({ error: message }, status);
  }
}
