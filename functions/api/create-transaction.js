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

    const buyerUser = await getAuthenticatedUser(
      context,
      supabaseUrl,
      anonKey
    );

    const body = await context.request.json();

    const customer = body?.customer || {};

    const rawItems =
      Array.isArray(body?.items)
        ? body.items
        : [];

    const name =
      String(customer.name || "").trim();

    const email =
      String(customer.email || "").trim();

    const phone =
      String(customer.phone || "").trim();

    const address =
      String(customer.address || "").trim();

    if (!name || !email || !phone || !address) {
      return json({
        error: "Data pelanggan belum lengkap."
      }, 400);
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

    /*
     * Untuk tahap awal marketplace:
     * ongkir dan platform fee tetap 0.
     * Nanti akan kita kembangkan menjadi
     * per-seller shipping + commission.
     */

    const shippingFee = 0;
    const platformFee = 0;
    const total =
      subtotal + shippingFee;

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
              buyerUser?.id || null,

            customer_name:
              name,

            customer_email:
              email,

            customer_phone:
              phone,

            shipping_address:
              address,

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

            total:
              total
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
          0,

        total:
          group.subtotal,

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
                String(createdOrderId)
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
