export async function onRequestGet(context) {
  const supabaseUrl = context.env.SUPABASE_URL;
  const supabaseAnonKey = context.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        error: "Konfigurasi Supabase belum tersedia."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  return new Response(
    JSON.stringify({
      supabaseUrl,
      supabaseAnonKey
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
