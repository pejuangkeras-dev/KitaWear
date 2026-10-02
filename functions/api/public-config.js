function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  try {
    const env = context.env;

    const supabaseUrl =
      String(env.SUPABASE_URL || "").trim();

    const supabaseAnonKey =
      String(env.SUPABASE_ANON_KEY || "").trim();

    const clientKey =
      String(env.MIDTRANS_CLIENT_KEY || "").trim();

    const isProduction =
      String(
        env.MIDTRANS_IS_PRODUCTION || "false"
      ).toLowerCase() === "true";

    const snapUrl = isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js";

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !clientKey
    ) {
      return json({
        error:
          "Konfigurasi publik MarketKita belum lengkap."
      }, 500);
    }

    return json({
      supabaseUrl,
      supabaseAnonKey,

      clientKey,
      snapUrl,

      midtransProduction:
        isProduction
    });

  } catch (error) {
    console.error(
      "MarketKita public-config error:",
      error?.message || error
    );

    return json({
      error:
        error?.message ||
        "Gagal memuat konfigurasi MarketKita."
    }, 500);
  }
}
