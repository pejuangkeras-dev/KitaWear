export default async () => {
  const clientKey = process.env.MIDTRANS_CLIENT_KEY;
  const production = process.env.MIDTRANS_IS_PRODUCTION === "true";

  if (!clientKey) {
    return new Response(
      JSON.stringify({
        error: "MIDTRANS_CLIENT_KEY belum diset di Netlify."
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return new Response(
    JSON.stringify({
      clientKey,
      production,
      snapUrl: production
        ? "https://app.midtrans.com/snap/snap.js"
        : "https://app.sandbox.midtrans.com/snap/snap.js"
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
};
