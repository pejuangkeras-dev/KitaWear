function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function normalizeUrl(value) { return String(value || "").trim().replace(/\/+$/, ""); }
async function getUser(context, supabaseUrl, anonKey) {
  const auth = context.request.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token || !anonKey) return null;
  const response = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: anonKey, Authorization: "Bearer " + token } });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}
async function supabaseGet(url, key, path) {
  const response = await fetch(url + path, { headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" } });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.message || data?.details || data?.hint || data?.error || ("Supabase HTTP " + response.status));
  return data;
}
export async function onRequestGet(context) {
  try {
    const supabaseUrl = normalizeUrl(context.env.SUPABASE_URL);
    const serviceRoleKey = String(context.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const anonKey = String(context.env.SUPABASE_ANON_KEY || "").trim();
    if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Konfigurasi akun MarketKita belum lengkap." }, 500);
    const user = await getUser(context, supabaseUrl, anonKey);
    if (!user) return json({ error: "LOGIN_REQUIRED" }, 401);
    const orderRows = await supabaseGet(supabaseUrl, serviceRoleKey, "/rest/v1/orders?select=id,order_number,status,payment_status,customer_name,customer_email,customer_phone,shipping_address,subtotal,shipping_fee,platform_fee,total,paid_at,processing_at,shipped_at,delivered_at,completed_at,created_at,updated_at&buyer_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc");
    const orders = Array.isArray(orderRows) ? orderRows : [];
    if (!orders.length) return json({ orders: [] });
    const orderIds = orders.map(x => x.id).filter(Boolean).join(",");
    const itemRows = await supabaseGet(supabaseUrl, serviceRoleKey, "/rest/v1/order_items?select=id,order_id,product_id,store_id,product_name,size,quantity,unit_price,line_total,created_at&order_id=in.(" + encodeURIComponent(orderIds) + ")&order=created_at.asc");
    const sellerRows = await supabaseGet(supabaseUrl, serviceRoleKey, "/rest/v1/order_sellers?select=id,order_id,store_id,seller_id,subtotal,platform_fee,shipping_fee,total,seller_status,shipping_status,tracking_number,seller_note,admin_note,created_at,updated_at&order_id=in.(" + encodeURIComponent(orderIds) + ")");
    const refundRows = await supabaseGet(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/refund_requests?select=order_id,amount,status,midtrans_refund_amount,bank_confirmed_at,confirmed_at,reason&buyer_id=eq." +
      encodeURIComponent(user.id) +
      "&order_id=in.(" + encodeURIComponent(orderIds) + ")&order=created_at.desc"
    );
    const items = Array.isArray(itemRows) ? itemRows : [];
    const sellers = Array.isArray(sellerRows) ? sellerRows : [];
    const refunds = Array.isArray(refundRows) ? refundRows : [];
    return json({
      orders: orders.map(order => ({
        ...order,
        items: items.filter(item => item.order_id === order.id),
        sellers: sellers.filter(seller => seller.order_id === order.id),
        refund: refunds.find(refund => refund.order_id === order.id) || null
      }))
    });
  } catch (error) {
    console.error("MarketKita buyer orders:", error);
    return json({ error: error?.message || "Gagal mengambil pesanan." }, 500);
  }
}