export default async () => {
  const clientKey = process.env.MIDTRANS_CLIENT_KEY || "";
  const production = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  return new Response(JSON.stringify({
    clientKey,
    production,
    snapUrl: production
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js",
    supabaseUrl,
    supabaseAnonKey
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
};
