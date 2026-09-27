/* KitaWear shared public configuration endpoint.
   Server-side environment variables are read here and returned only
   as values that are safe for browser use.

   NEVER return:
   SUPABASE_SERVICE_ROLE_KEY
   MIDTRANS_SERVER_KEY
*/

export default async function handler() {
  const isProduction =
    String(process.env.MIDTRANS_IS_PRODUCTION || "false").toLowerCase() === "true";

  const clientKey =
    process.env.MIDTRANS_CLIENT_KEY || "";

  const supabaseUrl =
    process.env.SUPABASE_URL || "";

  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || "";

  const body = {
    clientKey,

    snapUrl: isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js",

    supabaseUrl,
    supabaseAnonKey
  };

  if (
    !clientKey ||
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    return new Response(
      JSON.stringify({
        error:
          "Konfigurasi KitaWear belum lengkap di Netlify Environment Variables."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  return new Response(
    JSON.stringify(body),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
