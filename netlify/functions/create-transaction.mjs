const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" }
});

async function supabaseRequest(path, options = {}) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Konfigurasi Supabase server belum lengkap di Netlify.");

  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function getAuthenticatedUser(request) {
  const token = request.headers.get("authorization") || "";
  if (!token.toLowerCase().startsWith("bearer ")) return null;

  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!base || !anon) throw new Error("Konfigurasi Supabase public belum lengkap di Netlify.");

  const res = await fetch(`${base}/auth/v1/user`, {
    headers: {
      apikey: anon,
      Authorization: token
    }
  });

  if (!res.ok) return null;
  return res.json();
}

const STATIC_PRODUCTS = {
  "Kita Basic Tee": 69000,
  "Kita Oversize Tee": 89000,
  "Kita Casual Shirt": 119000,
  "Kita Cargo Pants": 129000,
  "Kita Hoodie": 149000,
  "Kita Women's Top": 79000,
  "Kita Wide Pants": 119000,
  "Kita Denim Jacket": 179000
};

const STATIC_SIZES = {
  "Kita Basic Tee": ["M", "L", "XL", "XXL"],
  "Kita Oversize Tee": ["M", "L", "XL", "XXL"],
  "Kita Casual Shirt": ["M", "L", "XL", "XXL"],
  "Kita Cargo Pants": ["M", "L", "XL", "XXL"],
  "Kita Hoodie": ["M", "L", "XL", "XXL"],
  "Kita Women's Top": ["S", "M", "L", "XL"],
  "Kita Wide Pants": ["S", "M", "L", "XL"],
  "Kita Denim Jacket": ["M", "L", "XL", "XXL"]
};

export default async (request) => {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const production = process.env.MIDTRANS_IS_PRODUCTION === "true";
    if (!serverKey) return json({ error: "MIDTRANS_SERVER_KEY belum diset di Netlify." }, 500);

    const user = await getAuthenticatedUser(request);
    if (!user?.id) return json({ error: "Silakan masuk ke akun KitaWear sebelum checkout." }, 401);

    const body = await request.json();
    const { customer, items } = body;
    if (!customer?.name || !customer?.email || !customer?.phone || !customer?.address) {
      return json({ error: "Data pelanggan belum lengkap." }, 400);
    }
    if (!Array.isArray(items) || items.length === 0) return json({ error: "Keranjang kosong." }, 400);

    const productIds = [...new Set(items.map(x => x.productId).filter(Boolean))];
    let dbProducts = [];
    if (productIds.length) {
      const filter = productIds.join(",");
      const res = await supabaseRequest(`products?select=id,name,price,store_id,status,stores(id,owner_id,name),product_sizes(size,stock)&id=in.(${filter})`);
      if (!res.ok) return json({ error: "Gagal membaca produk dari database KitaWear." }, 500);
      dbProducts = await res.json();
    }

    const itemDetails = [];
    const orderItems = [];
    let grossAmount = 0;
    let usingDatabase = productIds.length > 0;

    for (const item of items) {
      const size = String(item.size || "").toUpperCase();
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
      let price;
      let productId = item.productId || null;
      let storeId = item.storeId || null;
      let productName = item.name;
      let storeName = "";

      if (productId) {
        const product = dbProducts.find(p => p.id === productId);
        if (!product || product.status !== "active") return json({ error: `Produk ${item.name} tidak tersedia.` }, 400);
        price = Number(product.price);
        productName = product.name;
        storeId = product.store_id;
        storeName = product.stores?.name || "";
        const sizeRow = (product.product_sizes || []).find(s => String(s.size).toUpperCase() === size);
        if (!sizeRow) return json({ error: `Ukuran ${size} tidak tersedia untuk ${productName}.` }, 400);
        if (Number(sizeRow.stock) < quantity) return json({ error: `Stok ${productName} ukuran ${size} tidak mencukupi.` }, 400);
      } else {
        price = STATIC_PRODUCTS[item.name];
        const allowed = STATIC_SIZES[item.name];
        if (!price || !allowed?.includes(size)) return json({ error: `Produk atau ukuran tidak valid: ${item.name}.` }, 400);
        usingDatabase = false;
      }

      if (productId && !size) return json({ error: `Ukuran ${productName} belum dipilih.` }, 400);
      grossAmount += price * quantity;
      itemDetails.push({
        id: productId ? productId.slice(0, 50) : `${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${size.toLowerCase()}`,
        price,
        quantity,
        name: `${productName} - Size ${size}`
      });
      orderItems.push({
        product_id: productId,
        store_id: storeId,
        product_name: productName,
        size,
        quantity,
        unit_price: price,
        line_total: price * quantity,
        store_name: storeName
      });
    }

    const orderId = `KW-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    let dbOrderId = null;

    if (usingDatabase && orderItems.every(x => x.product_id && x.store_id)) {
      const orderRes = await supabaseRequest("orders", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          order_number: orderId,
          buyer_id: user.id,
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone,
          shipping_address: customer.address,
          subtotal: grossAmount,
          platform_fee: 0,
          shipping_fee: 0,
          total: grossAmount,
          status: "pending_payment",
          payment_status: "pending",
          midtrans_order_id: orderId
        })
      });
      if (!orderRes.ok) {
        const detail = await orderRes.text();
        return json({ error: "Gagal membuat order KitaWear.", detail }, 500);
      }
      const [createdOrder] = await orderRes.json();
      dbOrderId = createdOrder?.id || null;

      const rows = orderItems.map(x => ({
        order_id: dbOrderId,
        product_id: x.product_id,
        store_id: x.store_id,
        product_name: x.product_name,
        size: x.size,
        quantity: x.quantity,
        unit_price: x.unit_price,
        line_total: x.line_total
      }));
      const itemsRes = await supabaseRequest("order_items", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(rows)
      });
      if (!itemsRes.ok) return json({ error: "Order dibuat tetapi detail order gagal disimpan." }, 500);
    }

    const endpoint = production
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";
    const auth = Buffer.from(`${serverKey}:`).toString("base64");

    const midtransRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        item_details: itemDetails,
        custom_field1: orderItems.map(x => `${x.product_name}: ${x.size} x${x.quantity}`).join(" | "),
        custom_field2: "KitaWear marketplace",
        customer_details: {
          first_name: customer.name,
          email: customer.email,
          phone: customer.phone,
          billing_address: { first_name: customer.name, email: customer.email, phone: customer.phone, address: customer.address },
          shipping_address: { first_name: customer.name, email: customer.email, phone: customer.phone, address: customer.address }
        }
      })
    });

    const result = await midtransRes.json();
    if (!midtransRes.ok) return json({ error: result?.error_messages?.join(", ") || "Gagal membuat transaksi Midtrans.", detail: result }, midtransRes.status);

    return json({ token: result.token, redirect_url: result.redirect_url, order_id: orderId, database_order_id: dbOrderId });
  } catch (error) {
    return json({ error: error.message || "Terjadi kesalahan server." }, 500);
  }
};
