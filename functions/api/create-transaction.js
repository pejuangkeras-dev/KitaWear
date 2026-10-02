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

    const error = new Error(String(message));
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function makeOrderNumber() {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `KW-${stamp}-${random}`;
}

function safeInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function getAuthenticatedUser(context, supabaseUrl, anonKey) {
  const authHeader = context.request.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken || !anonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

async function getProduct(supabaseUrl, serviceRoleKey, raw) {
  const productId = String(raw?.product_id || "").trim();
  const productName = String(raw?.name || "").trim();
  const storeId = String(raw?.store_id || "").trim();

  if (!productId && !productName) {
    throw new Error("Produk tidak valid.");
  }

  let path;

  if (productId) {
    path =
      `/rest/v1/products?select=id,store_id,name,price,status` +
      `&id=eq.${encodeURIComponent(productId)}` +
      `&status=eq.active&limit=1`;
  } else {
    path =
      `/rest/v1/products?select=id,store_id,name,price,status` +
      `&name=eq.${encodeURIComponent(productName)}` +
      `&status=eq.active&limit=100`;
  }

  const rows = await supabaseRequest(
    supabaseUrl,
    serviceRoleKey,
    path,
    { method: "GET" }
  );

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(
      `Produk tidak ditemukan atau sudah tidak aktif: ${productName || productId}`
    );
  }

  if (productId) {
    return rows[0];
  }

  if (storeId) {
    const storeMatches = rows.filter(
      row => String(row.store_id) === storeId
    );

    if (storeMatches.length === 1) {
      return storeMatches[0];
    }

    if (!storeMatches.length) {
      throw new Error(
        `Produk "${productName}" tidak ditemukan pada toko yang dipilih.`
      );
    }

    throw new Error(
      `Produk "${productName}" memiliki data aktif ganda pada toko tersebut.`
    );
  }

  if (rows.length > 1) {
    throw new Error(
      `Produk "${productName}" digunakan oleh beberapa seller. ` +
      `Checkout harus mengirim product_id dan store_id.`
    );
  }

  return rows[0];
}

async function getStore(supabaseUrl, serviceRoleKey, storeId) {
  const rows = await supabaseRequest(
    supabaseUrl,
    serviceRoleKey,
    `/rest/v1/stores?select=id,name,owner_id,status` +
      `&id=eq.${encodeURIComponent(storeId)}` +
      `&status=eq.active&limit=1`,
    { method: "GET" }
  );

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("Toko produk tidak ditemukan atau tidak aktif.");
  }

  if (!rows[0].owner_id) {
    throw new Error(
      `Toko ${rows[0].name || "ini"} belum memiliki pemilik.`
    );
  }

  return rows[0];
}

async function getProductSize(
  supabaseUrl,
  serviceRoleKey,
  productId,
  size
) {
  const normalizedSize = String(size || "").trim().toUpperCase();

  if (!normalizedSize) {
    throw new Error("Ukuran produk belum dipilih.");
  }

  const rows = await supabaseRequest(
    supabaseUrl,
    serviceRoleKey,
    `/rest/v1/product_sizes?select=product_id,size,stock` +
      `&product_id=eq.${encodeURIComponent(productId)}` +
      `&size=eq.${encodeURIComponent(normalizedSize)}` +
      `&limit=1`,
    { method: "GET" }
  );

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(
      `Ukuran ${normalizedSize} tidak tersedia untuk produk tersebut.`
    );
  }

  return rows[0];
}

function groupByStore(items) {
  const map = new Map();

  for (const item of items) {
    if (!map.has(item.store_id)) {
      map.set(item.store_id, {
        store_id: item.store_id,
        seller_id: item.seller_id,
        store_name: item.store_name,
        items: [],
        subtotal: 0
      });
    }

    const group = map.get(item.store_id);

    group.items.push(item);
    group.subtotal += item.line_total;
  }

  return [...map.values()];
}

export async function onRequestPost(context) {
  let createdOrderId = null;
  let voucherConsumed = false;
  let voucherId = "";
  let buyerUser = null;

  try {
    const env = context.env;

    const supabaseUrl = normalizeUrl(env.SUPABASE_URL);

    const serviceRoleKey = String(
      env.SUPABASE_SERVICE_ROLE_KEY || ""
    ).trim();

    const anonKey = String(
      env.SUPABASE_ANON_KEY || ""
    ).trim();

    const clientKey = String(
      env.MIDTRANS_CLIENT_KEY || ""
    ).trim();

    const serverKey = String(
      env.MIDTRANS_SERVER_KEY || ""
    ).trim();

    const production =
      String(
        env.MIDTRANS_IS_PRODUCTION || "false"
      ).toLowerCase() === "true";

    if (!supabaseUrl || !serviceRoleKey) {
      return json({
        error: "Konfigurasi Supabase server belum tersedia."
      }, 500);
    }

    if (!clientKey || !serverKey) {
      return json({
        error: "Konfigurasi Midtrans belum lengkap di Cloudflare."
      }, 500);
    }

    buyerUser = await getAuthenticatedUser(
      context,
      supabaseUrl,
      anonKey
    );

    const body = await context.request.json();

    const customer = body?.customer || {};
    const addressId = String(body?.address_id || "").trim();

    const rawItems =
      Array.isArray(body?.items)
        ? body.items
        : [];

    let name =
      String(customer.name || "").trim();

    let email =
      String(customer.email || "").trim();

    let phone =
      String(customer.phone || "").trim();

    let address =
      String(customer.address || "").trim();

    voucherId = String(body?.voucher_id || "").trim();
    const shippingQuoteId = String(body?.shipping_quote_id || "").trim();
    const shippingSelections = Array.isArray(body?.shipping_selections) ? body.shipping_selections : [];

    if (!buyerUser?.id) {
      return json({ error: "Login diperlukan untuk checkout." }, 401);
    }
    if (!addressId) {
      return json({ error: "Pilih alamat tersimpan sebelum checkout." }, 400);
    }

    const addressRows = await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/buyer_addresses?select=id,label,recipient_name,phone,address_line,city,province,postal_code" +
        "&id=eq." + encodeURIComponent(addressId) +
        "&user_id=eq." + encodeURIComponent(buyerUser.id) +
        "&limit=1",
      { method: "GET" }
    );
    const shippingAddress = Array.isArray(addressRows) ? addressRows[0] : null;
    if (!shippingAddress) {
      return json({ error: "Alamat pengiriman tidak ditemukan atau bukan milik akun ini." }, 400);
    }
    if (!/^\d{5}$/.test(String(shippingAddress.postal_code || ""))) {
      return json({ error: "Kode pos alamat pengiriman harus 5 digit." }, 400);
    }
    if (!/^[0-9+][0-9 ()-]{7,19}$/.test(String(shippingAddress.phone || ""))) {
      return json({ error: "Nomor WhatsApp pada alamat pengiriman tidak valid." }, 400);
    }

    // The saved address is the source of truth. Client-entered checkout fields cannot
    // silently replace the address snapshot stored with the order.
    name = String(shippingAddress.recipient_name || "").trim();
    phone = String(shippingAddress.phone || "").trim();
    address = [shippingAddress.address_line, shippingAddress.city, shippingAddress.province, shippingAddress.postal_code].filter(Boolean).join(", ");
    email = String(buyerUser.email || email || "").trim();

    if (!name || !email || !phone || !address) {
      return json({ error: "Data alamat pengiriman belum lengkap." }, 400);
    }

    if (!rawItems.length) {
      return json({
        error: "Keranjang masih kosong."
      }, 400);
    }

    const items = [];

    let subtotal = 0;

    for (const raw of rawItems) {
      const quantity = Number(raw?.quantity);

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 99
      ) {
        return json({
          error:
            `Jumlah untuk ${String(
              raw?.name || "produk"
            )} tidak valid.`
        }, 400);
      }

      const product =
        await getProduct(
          supabaseUrl,
          serviceRoleKey,
          raw
        );

      const store =
        await getStore(
          supabaseUrl,
          serviceRoleKey,
          product.store_id
        );

      const size =
        String(raw?.size || "")
          .trim()
          .toUpperCase();

      const sizeRow =
        await getProductSize(
          supabaseUrl,
          serviceRoleKey,
          product.id,
          size
        );

      const stock =
        safeInteger(
          sizeRow.stock,
          0
        );

      if (stock < quantity) {
        return json({
          error:
            `Stok ${product.name} ukuran ${size} tidak cukup. ` +
            `Tersedia ${stock}.`
        }, 400);
      }

      const unitPrice =
        safeInteger(
          product.price,
          0
        );

      if (unitPrice <= 0) {
        return json({
          error:
            `Harga produk ${product.name} tidak valid.`
        }, 400);
      }

      const lineTotal =
        unitPrice * quantity;

      subtotal += lineTotal;

      items.push({
        product_id: product.id,
        store_id: store.id,
        seller_id: store.owner_id,
        store_name:
          store.name || "KitaWear Store",

        product_name: product.name,

        size,
        quantity,

        unit_price: unitPrice,
        line_total: lineTotal
      });
    }

    const groups =
      groupByStore(items);

    if (!groups.length) {
      return json({
        error:
          "Tidak ada seller yang valid di keranjang."
      }, 400);
    }

    if (!buyerUser?.id) {
      return json({ error: "Login diperlukan untuk checkout dengan pengiriman otomatis." }, 401);
    }
    if (!shippingQuoteId || !shippingSelections.length) {
      return json({ error: "Pilih layanan kurir untuk setiap toko sebelum melanjutkan pembayaran." }, 400);
    }

    const quoteRows = await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/shipping_quotes?select=id,buyer_id,status,expires_at,selections,request_snapshot&buyer_id=eq.${encodeURIComponent(buyerUser.id)}&id=eq.${encodeURIComponent(shippingQuoteId)}&limit=1`,
      { method: "GET" }
    );
    const shippingQuote = Array.isArray(quoteRows) ? quoteRows[0] : null;
    const shippingPostalCode = String(shippingAddress.postal_code || "").trim();
    if (!/^\d{5}$/.test(shippingPostalCode)) return json({ error: "Kode pos alamat pengiriman tidak valid. Silakan pilih alamat tersimpan yang lengkap." }, 400);
    const quotedAddressId = String(shippingQuote?.request_snapshot?.address_id || "").trim();
    if (quotedAddressId && quotedAddressId !== addressId) {
      return json({ error: "Alamat checkout berubah. Silakan hitung ulang ongkir." }, 409);
    }
    if (!shippingQuote || shippingQuote.status !== "active") {
      return json({ error: "Quote ongkir sudah tidak tersedia. Silakan hitung ulang." }, 400);
    }
    if (new Date(shippingQuote.expires_at).getTime() <= Date.now()) {
      return json({ error: "Quote ongkir sudah kedaluwarsa. Silakan hitung ulang." }, 400);
    }

    const quoteGroups = Array.isArray(shippingQuote.selections) ? shippingQuote.selections : [];
    const quoteStoreIds = new Set(quoteGroups.map(g => String(g?.store_id || "").trim()).filter(Boolean));
    const currentStoreIds = new Set(groups.map(g => String(g.store_id)));
    if (quoteStoreIds.size !== currentStoreIds.size || [...quoteStoreIds].some(id => !currentStoreIds.has(id))) {
      return json({ error: "Keranjang berubah setelah ongkir dihitung. Silakan hitung ulang ongkir." }, 409);
    }

    // Bind the quote to the exact cart snapshot used to calculate shipping.
    // This prevents reusing a valid quote for a different cart with the same seller set.
    const quoteItems = Array.isArray(shippingQuote?.request_snapshot?.items)
      ? shippingQuote.request_snapshot.items
      : [];
    const canonicalItem = item => [
      String(item?.product_id || ""),
      String(item?.size || "").trim().toUpperCase(),
      Number(item?.quantity || 0)
    ].join("|");
    const currentItemKeys = items
      .map(item => canonicalItem(item))
      .sort();
    const quotedItemKeys = quoteItems
      .map(item => canonicalItem(item))
      .sort();
    if (
      currentItemKeys.length !== quotedItemKeys.length ||
      currentItemKeys.some((key, index) => key !== quotedItemKeys[index])
    ) {
      return json({ error: "Isi keranjang berubah setelah ongkir dihitung. Silakan hitung ulang ongkir." }, 409);
    }

    const selectedByStore = new Map();
    for (const selected of shippingSelections) {
      const storeId = String(selected?.store_id || "").trim();
      const company = String(selected?.courier_company || "").trim().toLowerCase();
      const type = String(selected?.courier_type || "").trim().toLowerCase();
      if (!storeId || !company || !type || selectedByStore.has(storeId)) {
        return json({ error: "Pilihan kurir tidak valid." }, 400);
      }
      const group = quoteGroups.find(g => String(g.store_id) === storeId);
      const option = group?.options?.find(o =>
        String(o.courier_company).toLowerCase() === company &&
        String(o.courier_type).toLowerCase() === type
      );
      if (!option) return json({ error: "Pilihan kurir sudah berubah. Silakan hitung ongkir ulang." }, 409);
      selectedByStore.set(storeId, { ...option, store_id: storeId, store_name: group.store_name });
    }

    for (const group of groups) {
      if (!selectedByStore.has(String(group.store_id))) {
        return json({ error: `Pilih layanan kurir untuk toko ${group.store_name}.` }, 400);
      }
    }
    if (selectedByStore.size !== groups.length || [...selectedByStore.keys()].some(id => !currentStoreIds.has(String(id)))) {
      return json({ error: "Pilihan kurir tidak sesuai dengan seller di keranjang." }, 400);
    }

    const shippingFee = [...selectedByStore.values()].reduce((sum, x) => sum + safeInteger(x.price, 0), 0);
    const platformFee = 0;

    let discountAmount = 0;
    let voucherRow = null;

    if (voucherId) {
      if (!buyerUser?.id) {
        return json({ error: "Voucher hanya dapat digunakan setelah login." }, 401);
      }

      const voucherRows = await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/vouchers?select=id,code,title,discount_type,discount_value,min_order_amount,max_discount,usage_limit,used_count,starts_at,expires_at,active" +
          "&id=eq." + encodeURIComponent(voucherId) + "&active=eq.true&limit=1",
        { method: "GET" }
      );

      voucherRow = Array.isArray(voucherRows) ? voucherRows[0] : null;
      if (!voucherRow) return json({ error: "Voucher tidak tersedia." }, 400);

      const now = Date.now();
      if (voucherRow.starts_at && new Date(voucherRow.starts_at).getTime() > now) {
        return json({ error: "Voucher belum dapat digunakan." }, 400);
      }
      if (voucherRow.expires_at && new Date(voucherRow.expires_at).getTime() <= now) {
        return json({ error: "Voucher sudah kedaluwarsa." }, 400);
      }
      if (voucherRow.usage_limit != null && Number(voucherRow.used_count || 0) >= Number(voucherRow.usage_limit)) {
        return json({ error: "Kuota voucher sudah habis." }, 400);
      }

      const claimedRows = await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/user_vouchers?select=id,used_at&voucher_id=eq." + encodeURIComponent(voucherId) +
          "&user_id=eq." + encodeURIComponent(buyerUser.id) + "&limit=1",
        { method: "GET" }
      );
      const claim = Array.isArray(claimedRows) ? claimedRows[0] : null;
      if (!claim) return json({ error: "Klaim voucher terlebih dahulu dari Voucher Saya." }, 400);
      if (claim.used_at) return json({ error: "Voucher ini sudah digunakan." }, 400);

      if (subtotal < Number(voucherRow.min_order_amount || 0)) {
        return json({ error: "Minimum transaksi voucher belum terpenuhi." }, 400);
      }

      if (voucherRow.discount_type === "percent") {
        discountAmount = Math.floor(subtotal * Number(voucherRow.discount_value || 0) / 100);
      } else {
        discountAmount = Number(voucherRow.discount_value || 0);
      }

      if (voucherRow.max_discount != null) {
        discountAmount = Math.min(discountAmount, Number(voucherRow.max_discount));
      }
      discountAmount = Math.max(0, Math.min(discountAmount, subtotal));
    }

    const total = subtotal - discountAmount + shippingFee;

    const orderNumber =
      makeOrderNumber();

    const orderRows =
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/orders" +
          "?select=id,order_number,status,payment_status,total",
        {
          method: "POST",

          headers: {
            Prefer:
              "return=representation"
          },

          body: JSON.stringify({
            order_number:
              orderNumber,

            buyer_id:
              buyerUser.id,

            customer_name:
              name,

            customer_email:
              email,

            customer_phone:
              phone,

            shipping_address:
              address,

            shipping_address_id:
              shippingAddress.id,

            shipping_recipient_name:
              shippingAddress.recipient_name,

            shipping_phone:
              shippingAddress.phone,

            shipping_address_line:
              shippingAddress.address_line,

            shipping_city:
              shippingAddress.city,

            shipping_province:
              shippingAddress.province,

            shipping_postal_code:
              shippingPostalCode,

            status:
              "pending_payment",

            payment_status:
              "pending",

            subtotal:
              subtotal,

            platform_fee:
              platformFee,

            shipping_fee:
              shippingFee,

            shipping_quote_id:
              shippingQuoteId,

            shipping_selections:
              [...selectedByStore.values()].map(x => ({
                store_id: x.store_id,
                store_name: x.store_name,
                courier_company: x.courier_company,
                courier_type: x.courier_type,
                service_code: x.service_code,
                service_name: x.service_name,
                price: x.price,
                duration: x.duration
              })),

            total:
              total,

            voucher_id:
              voucherId || null,

            discount_amount:
              discountAmount
          })
        }
      );

    if (
      !Array.isArray(orderRows) ||
      !orderRows.length
    ) {
      throw new Error(
        "Pesanan gagal dibuat di database."
      );
    }

    createdOrderId =
      orderRows[0].id;

    const itemRows =
      items.map(item => ({
        order_id:
          createdOrderId,

        product_id:
          item.product_id,

        product_name:
          item.product_name,

        size:
          item.size,

        quantity:
          item.quantity,

        unit_price:
          item.unit_price,

        line_total:
          item.line_total,

        store_id:
          item.store_id
      }));

    try {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/order_items",
        {
          method: "POST",

          headers: {
            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify(itemRows)
        }
      );
    } catch (itemError) {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/release_order_stock_reservation",
        {
          method: "POST",
          body: JSON.stringify({
            p_order_id: createdOrderId,
            p_reason: "released"
          })
        }
      ).catch(() => {});

      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          createdOrderId
        )}`,
        {
          method: "DELETE"
        }
      ).catch(() => {});

      createdOrderId = null;

      throw itemError;
    }

    const orderSellerRows =
      groups.map(group => ({
        order_id:
          createdOrderId,

        store_id:
          group.store_id,

        seller_id:
          group.seller_id,

        subtotal:
          group.subtotal,

        platform_fee:
          0,

        shipping_fee:
          safeInteger(selectedByStore.get(String(group.store_id))?.price, 0),

        total:
          group.subtotal + safeInteger(selectedByStore.get(String(group.store_id))?.price, 0),

        seller_status:
          "pending",

        shipping_status:
          "pending",

        tracking_number:
          null,

        seller_note:
          null,

        admin_note:
          null
      }));

    try {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/order_sellers",
        {
          method: "POST",

          headers: {
            Prefer:
              "return=minimal"
          },

          body:
            JSON.stringify(
              orderSellerRows
            )
        }
      );
    } catch (sellerError) {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          createdOrderId
        )}`,
        {
          method: "DELETE"
        }
      ).catch(() => {});

      createdOrderId = null;

      throw sellerError;
    }

    // Reserve stock atomically before creating the Midtrans payment session.
    // The reservation lasts 24 hours, aligned with the default Snap token lifetime.
    await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/rpc/reserve_order_stock",
      {
        method: "POST",
        body: JSON.stringify({
          p_order_id: createdOrderId,
          p_minutes: 1440
        })
      }
    );

    // Consume the voucher atomically before creating the Midtrans transaction.
    // This prevents a race where Midtrans succeeds but voucher consumption fails.
    if (voucherId && buyerUser?.id && discountAmount > 0) {
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/rpc/consume_user_voucher",
        {
          method: "POST",
          body: JSON.stringify({
            p_voucher_id: voucherId,
            p_user_id: buyerUser.id
          })
        }
      );
      voucherConsumed = true;
    }

    const endpoint =
      production
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    const snapUrl =
      production
        ? "https://app.midtrans.com/snap/snap.js"
        : "https://app.sandbox.midtrans.com/snap/snap.js";

    const auth =
      btoa(`${serverKey}:`);

    const itemDetails =
      items.map(item => ({
        id:
          String(item.product_id),

        price:
          item.unit_price,

        quantity:
          item.quantity,

        name:
          `${item.product_name} - ${item.store_name} - Size ${item.size}`
      }));

    // Midtrans requires gross_amount to equal the exact sum of item_details.
    // Shipping is part of the order total, so represent each seller's
    // selected shipping charge as its own line item.
    for (const selected of selectedByStore.values()) {
      const price = safeInteger(selected?.price, 0);
      if (price > 0) {
        itemDetails.push({
          id: `SHIPPING-${selected.store_id}`,
          price,
          quantity: 1,
          name: `Ongkir ${selected.store_name} - ${selected.service_name || selected.courier_type || "Pengiriman"}`
        });
      }
    }

    if (discountAmount > 0) {
      itemDetails.push({
        id: "VOUCHER-" + (voucherRow?.code || "DISCOUNT"),
        price: -discountAmount,
        quantity: 1,
        name: "Voucher " + (voucherRow?.code || "MarketKita")
      });
    }

    const midtransResponse =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Basic ${auth}`
          },

          body:
            JSON.stringify({
              transaction_details: {
                order_id:
                  orderNumber,

                gross_amount:
                  total
              },

              item_details:
                itemDetails,

              customer_details: {
                first_name:
                  name,

                email:
                  email,

                phone:
                  phone,

                billing_address: {
                  first_name:
                    name,

                  email:
                    email,

                  phone:
                    phone,

                  address:
                    address
                },

                shipping_address: {
                  first_name:
                    name,

                  email:
                    email,

                  phone:
                    phone,

                  address:
                    address
                }
              },

              custom_field1:
                groups
                  .map(
                    group =>
                      `${group.store_name}: ${group.subtotal}`
                  )
                  .join(" | "),

              custom_field2:
                String(createdOrderId),

              // Keep the stock reservation aligned with the Snap payment lifetime.
              expiry: {
                start_time: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).replace("T", " ") + " +0700",
                unit: "hour",
                duration: 24
              }
            })
        }
      );

    const midtransText =
      await midtransResponse.text();

    let midtransResult = {};

    try {
      midtransResult =
        midtransText
          ? JSON.parse(midtransText)
          : {};
    } catch {
      midtransResult = {};
    }

    if (
      !midtransResponse.ok ||
      !midtransResult.token
    ) {
      if (voucherConsumed) {
        await supabaseRequest(
          supabaseUrl,
          serviceRoleKey,
          "/rest/v1/rpc/release_user_voucher",
          {
            method: "POST",
            body: JSON.stringify({
              p_voucher_id: voucherId,
              p_user_id: buyerUser.id
            })
          }
        ).catch(() => {});
        voucherConsumed = false;
      }

      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          createdOrderId
        )}`,
        {
          method: "DELETE"
        }
      ).catch(() => {});

      createdOrderId = null;

      return json({
        error:
          midtransResult?.error_messages?.join(", ") ||
          "Gagal membuat transaksi Midtrans."
      }, midtransResponse.status || 502);
    }

    return json({
      token:
        midtransResult.token,

      redirect_url:
        midtransResult.redirect_url ||
        null,

      order_id:
        orderNumber,

      clientKey,

      snapUrl,

      seller_count:
        groups.length
    });

  } catch (error) {
    console.error(
      "KitaWear marketplace create transaction error:",
      error?.message ||
        error
    );

    if (createdOrderId) {
      const env =
        context.env;

      const supabaseUrl =
        normalizeUrl(
          env.SUPABASE_URL
        );

      const serviceRoleKey =
        String(
          env.SUPABASE_SERVICE_ROLE_KEY ||
            ""
        ).trim();

      if (
        supabaseUrl &&
        serviceRoleKey
      ) {
        if (voucherConsumed && voucherId && buyerUser?.id) {
          await supabaseRequest(
            supabaseUrl,
            serviceRoleKey,
            "/rest/v1/rpc/release_user_voucher",
            {
              method: "POST",
              body: JSON.stringify({
                p_voucher_id: voucherId,
                p_user_id: buyerUser.id
              })
            }
          ).catch(() => {});
          voucherConsumed = false;
        }

        await supabaseRequest(
          supabaseUrl,
          serviceRoleKey,
          "/rest/v1/rpc/release_order_stock_reservation",
          {
            method: "POST",
            body: JSON.stringify({
              p_order_id: createdOrderId,
              p_reason: "released"
            })
          }
        ).catch(() => {});

        await supabaseRequest(
          supabaseUrl,
          serviceRoleKey,
          `/rest/v1/orders?id=eq.${encodeURIComponent(
            createdOrderId
          )}`,
          {
            method: "DELETE"
          }
        ).catch(() => {});
      }
    }

    return json({
      error:
        error?.message ||
        "Terjadi kesalahan pada server KitaWear."
    }, 500);
  }
}
