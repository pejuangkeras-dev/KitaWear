const CATALOG = {
  "Kita Basic Tee": 69000,
  "Kita Oversize Tee": 89000,
  "Kita Casual Shirt": 119000,
  "Kita Cargo Pants": 129000,
  "Kita Hoodie": 149000,
  "Kita Women's Top": 79000,
  "Kita Wide Pants": 119000,
  "Kita Denim Jacket": 179000
};

const ALLOWED_SIZES = {
  "Kita Basic Tee": ["M", "L", "XL", "XXL"],
  "Kita Oversize Tee": ["M", "L", "XL", "XXL"],
  "Kita Casual Shirt": ["M", "L", "XL", "XXL"],
  "Kita Cargo Pants": ["M", "L", "XL", "XXL"],
  "Kita Hoodie": ["M", "L", "XL", "XXL"],
  "Kita Women's Top": ["S", "M", "L", "XL"],
  "Kita Wide Pants": ["S", "M", "L", "XL"],
  "Kita Denim Jacket": ["M", "L", "XL", "XXL"]
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function supabaseHeaders(serviceRoleKey) {
  return {
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function makeOrderNumber() {
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();

  return `KW-${stamp}-${random}`;
}

async function supabaseRequest(
  url,
  key,
  path,
  options = {}
) {
  const response = await fetch(
    `${url}${path}`,
    {
      ...options,

      headers: {
        ...supabaseHeaders(key),
        ...(options.headers || {})
      }
    }
  );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {

    const message =
      data?.message ||
      data?.error_description ||
      data?.hint ||
      data?.details ||
      data?.error ||
      `Supabase HTTP ${response.status}`;

    const error =
      new Error(
        String(message)
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}

async function getOrCreateOfficialStore(
  supabaseUrl,
  serviceRoleKey
) {

  const existing =
    await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/stores?select=id,owner_id,name,status&order=created_at.asc&limit=1",
      {
        method: "GET"
      }
    );

  if (
    Array.isArray(existing) &&
    existing.length
  ) {
    return existing[0];
  }

  const admins =
    await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/profiles?select=id&role=eq.admin&order=created_at.asc&limit=1",
      {
        method: "GET"
      }
    );

  if (
    !Array.isArray(admins) ||
    !admins.length
  ) {
    throw new Error(
      "Belum ada profil admin untuk membuat Toko Resmi KitaWear."
    );
  }

  const created =
    await supabaseRequest(
      supabaseUrl,
      serviceRoleKey,
      "/rest/v1/stores?select=id,owner_id,name,status",
      {
        method: "POST",

        headers: {
          "Prefer":
            "return=representation"
        },

        body: JSON.stringify({

          owner_id:
            admins[0].id,

          name:
            "KitaWear Official",

          slug:
            "kitawear-official",

          description:
            "Toko resmi KitaWear.",

          status:
            "active"

        })
      }
    );

  if (
    !Array.isArray(created) ||
    !created.length
  ) {
    throw new Error(
      "Toko Resmi KitaWear gagal dibuat."
    );
  }

  return created[0];
}

export async function onRequestPost(
  context
) {

  let createdOrderId =
    null;

  try {

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

    const clientKey =
      String(
        env.MIDTRANS_CLIENT_KEY ||
        ""
      ).trim();

    const serverKey =
      String(
        env.MIDTRANS_SERVER_KEY ||
        ""
      ).trim();

    const production =
      String(
        env.MIDTRANS_IS_PRODUCTION ||
        "false"
      ).toLowerCase() === "true";


    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {

      return json(
        {
          error:
            "Konfigurasi Supabase server belum tersedia."
        },
        500
      );

    }


    if (
      !clientKey ||
      !serverKey
    ) {

      return json(
        {
          error:
            "Konfigurasi Midtrans belum lengkap di Cloudflare."
        },
        500
      );

    }


    const body =
      await context.request.json();

    const customer =
      body?.customer || {};

    const rawItems =
      Array.isArray(body?.items)
        ? body.items
        : [];


    const name =
      String(
        customer.name || ""
      ).trim();

    const email =
      String(
        customer.email || ""
      ).trim();

    const phone =
      String(
        customer.phone || ""
      ).trim();

    const address =
      String(
        customer.address || ""
      ).trim();


    if (
      !name ||
      !email ||
      !phone ||
      !address
    ) {

      return json(
        {
          error:
            "Data pelanggan belum lengkap."
        },
        400
      );

    }


    if (!rawItems.length) {

      return json(
        {
          error:
            "Keranjang masih kosong."
        },
        400
      );

    }


    const items = [];

    let subtotal = 0;


    for (
      const raw of rawItems
    ) {

      const productName =
        String(
          raw?.name || ""
        ).trim();

      const size =
        String(
          raw?.size || ""
        ).trim()
        .toUpperCase();

      const quantity =
        Number(
          raw?.quantity
        );

      const price =
        CATALOG[
          productName
        ];


      if (!price) {

        return json(
          {
            error:
              `Produk tidak dikenali: ${productName || "-"}`
          },
          400
        );

      }


      if (
        !ALLOWED_SIZES[
          productName
        ]?.includes(size)
      ) {

        return json(
          {
            error:
              `Ukuran ${size || "-"} tidak valid untuk ${productName}.`
          },
          400
        );

      }


      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity < 1 ||
        quantity > 99
      ) {

        return json(
          {
            error:
              `Jumlah untuk ${productName} tidak valid.`
          },
          400
        );

      }


      const lineTotal =
        price * quantity;

      subtotal +=
        lineTotal;


      items.push({

        product_name:
          productName,

        size,

        quantity,

        unit_price:
          price,

        line_total:
          lineTotal

      });

    }


    const shippingFee =
      0;

    const total =
      subtotal +
      shippingFee;

    const orderNumber =
      makeOrderNumber();


    const store =
      await getOrCreateOfficialStore(
        supabaseUrl,
        serviceRoleKey
      );


    const orderRows =
      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/orders?select=id,order_number,status,payment_status,total",
        {
          method:
            "POST",

          headers: {
            "Prefer":
              "return=representation"
          },

          body:
            JSON.stringify({

              order_number:
                orderNumber,

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

              subtotal,

              shipping_fee:
                shippingFee,

              total

            })
        }
      );


    if (
      !Array.isArray(
        orderRows
      ) ||
      !orderRows.length
    ) {

      throw new Error(
        "Pesanan gagal dibuat di database."
      );

    }


    createdOrderId =
      orderRows[0].id;


    const itemRows =
      items.map(
        item => ({

          order_id:
            createdOrderId,

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
            store.id

        })
      );


    try {

      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        "/rest/v1/order_items",
        {
          method:
            "POST",

          headers: {
            "Prefer":
              "return=minimal"
          },

          body:
            JSON.stringify(
              itemRows
            )
        }
      );

    } catch (
      itemError
    ) {

      await supabaseRequest(
        supabaseUrl,
        serviceRoleKey,
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          createdOrderId
        )}`,
        {
          method:
            "DELETE"
        }
      ).catch(
        () => {}
      );

      createdOrderId =
        null;

      throw itemError;
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
      btoa(
        `${serverKey}:`
      );


    const itemDetails =
      items.map(
        item => ({

          id:
            `${item.product_name}-${item.size}`
              .replace(
                /[^a-zA-Z0-9_-]/g,
                "-"
              ),

          price:
            item.unit_price,

          quantity:
            item.quantity,

          name:
            `${item.product_name} - Size ${item.size}`

        })
      );


    const midtransResponse =
      await fetch(
        endpoint,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Authorization":
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

                email,

                phone,

                billing_address: {

                  first_name:
                    name,

                  email,

                  phone,

                  address

                },

                shipping_address: {

                  first_name:
                    name,

                  email,

                  phone,

                  address

                }

              },

              custom_field1:
                items
                  .map(
                    x =>
                      `${x.product_name}: ${x.size} x${x.quantity}`
                  )
                  .join(" | "),

              custom_field2:
                String(
                  createdOrderId
                )

            })

        }
      );


    const midtransText =
      await midtransResponse.text();

    let midtransResult =
      {};


    try {

      midtransResult =
        midtransText
          ? JSON.parse(
              midtransText
            )
          : {};

    } catch {

      midtransResult =
        {};

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
          method:
            "DELETE"
        }
      ).catch(
        () => {}
      );

      createdOrderId =
        null;


      return json(
        {
          error:
            midtransResult
              ?.error_messages
              ?.join(", ") ||
            "Gagal membuat transaksi Midtrans."
        },
        midtransResponse.status ||
          502
      );

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

      snapUrl

    });


  } catch (
    error
  ) {

    console.error(
      "KitaWear create transaction error:",
      error?.message ||
      error
    );


    return json(
      {
        error:
          error?.message ||
          "Terjadi kesalahan pada server KitaWear."
      },
      500
    );

  }

}
