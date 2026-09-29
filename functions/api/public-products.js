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

function headers(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

async function supabaseGet(url, key, path) {
  const response = await fetch(`${url}${path}`, {
    method: "GET",
    headers: headers(key)
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      data?.error ||
      `Supabase HTTP ${response.status}`
    );
  }

  return data;
}

export async function onRequestGet(context) {
  try {
    const supabaseUrl = normalizeUrl(
      context.env.SUPABASE_URL
    );

    const serviceRoleKey = String(
      context.env.SUPABASE_SERVICE_ROLE_KEY || ""
    ).trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        {
          error: "Konfigurasi Supabase server belum lengkap."
        },
        500
      );
    }

    /* =========================
       AMBIL TOKO AKTIF
    ========================= */

    const stores = await supabaseGet(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/stores?select=id,name,slug,status&status=eq.active&limit=100"
    );

    const storeIds = Array.isArray(stores)
      ? stores
          .map(store => store.id)
          .filter(Boolean)
      : [];

    if (!storeIds.length) {
      return json({
        products: []
      });
    }

    /* =========================
       AMBIL PRODUK AKTIF
    ========================= */

    const storeIdFilter = storeIds.join(",");

    const products = await supabaseGet(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/products?select=id,store_id,name,price,description,category,image_url,gallery,colors,status,created_at&status=eq.active&store_id=in.(${encodeURIComponent(storeIdFilter)})&order=created_at.desc`
    );

    const rows = Array.isArray(products)
      ? products
      : [];

    if (!rows.length) {
      return json({
        products: []
      });
    }

    /* =========================
       AMBIL UKURAN PRODUK
    ========================= */

    const productIds = rows
      .map(product => product.id)
      .filter(Boolean);

    const productIdFilter = productIds.join(",");

    const sizes = await supabaseGet(
      supabaseUrl,
      serviceRoleKey,
      `/rest/v1/product_sizes?select=product_id,size,stock&product_id=in.(${encodeURIComponent(productIdFilter)})&order=size.asc`
    );

    const sizesByProduct = new Map();

    for (
      const size of Array.isArray(sizes)
        ? sizes
        : []
    ) {
      if (!sizesByProduct.has(size.product_id)) {
        sizesByProduct.set(
          size.product_id,
          []
        );
      }

      sizesByProduct
        .get(size.product_id)
        .push({
          size: size.size,
          stock: Number(size.stock || 0)
        });
    }

    /* =========================
       FORMAT DATA UNTUK TOKO
    ========================= */

    const publicProducts = rows.map(
      product => ({
        id: product.id,

        store_id: product.store_id,

        name: product.name,

        price: Number(
          product.price || 0
        ),

        description:
          product.description || "",

        category:
          product.category || "",

        image_url:
          product.image_url || "",

        gallery:
          Array.isArray(product.gallery)
            ? product.gallery
            : [],

        colors:
          Array.isArray(product.colors)
            ? product.colors
            : [],

        status:
          product.status,

        product_sizes:
          sizesByProduct.get(
            product.id
          ) || []
      })
    );

    return json({
      products:
        publicProducts
    });

  } catch (error) {

    console.error(
      "KitaWear public products error:",
      error
    );

    return json(
      {
        error:
          error?.message ||
          "Gagal mengambil produk KitaWear."
      },
      500
    );
  }
}
