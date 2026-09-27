const PRODUCTS = {
  "Kita Basic Tee": 69000,
  "Kita Oversize Tee": 89000,
  "Kita Casual Shirt": 119000,
  "Kita Cargo Pants": 129000,
  "Kita Hoodie": 149000,
  "Kita Women's Top": 79000,
  "Kita Wide Pants": 119000,
  "Kita Denim Jacket": 179000
};

const SIZES = {
  "Kita Basic Tee": ["M","L","XL","XXL"],
  "Kita Oversize Tee": ["M","L","XL","XXL"],
  "Kita Casual Shirt": ["M","L","XL","XXL"],
  "Kita Cargo Pants": ["M","L","XL","XXL"],
  "Kita Hoodie": ["M","L","XL","XXL"],
  "Kita Women's Top": ["S","M","L","XL"],
  "Kita Wide Pants": ["S","M","L","XL"],
  "Kita Denim Jacket": ["M","L","XL","XXL"]
};

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const production = process.env.MIDTRANS_IS_PRODUCTION === "true";

    if (!serverKey) {
      return new Response(JSON.stringify({
        error: "MIDTRANS_SERVER_KEY belum diset di Netlify."
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await request.json();
    const { customer, items } = body;

    if (!customer?.name || !customer?.email || !customer?.phone || !customer?.address) {
      return new Response(JSON.stringify({ error: "Data pelanggan belum lengkap." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: "Keranjang kosong." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    let grossAmount = 0;
    const itemDetails = [];
    const selectedSizes = [];

    for (const item of items) {
      const price = PRODUCTS[item.name];
      const size = String(item.size || "").toUpperCase();
      const allowedSizes = SIZES[item.name];

      if (!price || !allowedSizes) {
        return new Response(JSON.stringify({ error: `Produk tidak dikenal: ${item.name}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (!allowedSizes.includes(size)) {
        return new Response(JSON.stringify({
          error: `Ukuran tidak valid untuk ${item.name}.`
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
      grossAmount += price * quantity;

      itemDetails.push({
        id: `${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${size.toLowerCase()}`,
        price,
        quantity,
        name: `${item.name} - Size ${size}`
      });

      selectedSizes.push(`${item.name}: ${size} x${quantity}`);
    }

    const orderId =
      "KW-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    const endpoint = production
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    const auth = Buffer.from(`${serverKey}:`).toString("base64");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: orderId,
          gross_amount: grossAmount
        },
        item_details: itemDetails,
        custom_field1: selectedSizes.join(" | "),
        custom_field2: "KitaWear website checkout",
        customer_details: {
          first_name: customer.name,
          email: customer.email,
          phone: customer.phone,
          billing_address: {
            first_name: customer.name,
            email: customer.email,
            phone: customer.phone,
            address: customer.address
          },
          shipping_address: {
            first_name: customer.name,
            email: customer.email,
            phone: customer.phone,
            address: customer.address
          }
        }
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: result?.error_messages?.join(", ") || "Gagal membuat transaksi Midtrans.",
        detail: result
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      token: result.token,
      redirect_url: result.redirect_url,
      order_id: orderId
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message || "Terjadi kesalahan server."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
