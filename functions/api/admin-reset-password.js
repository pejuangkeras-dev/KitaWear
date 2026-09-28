export async function onRequestPost(context) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });

  try {
    // ==========================================
    // 1. CEK TOKEN RESET
    // ==========================================
    const resetToken = context.env.ADMIN_RESET_TOKEN;

    if (!resetToken) {
      console.error("ADMIN_RESET_TOKEN belum dikonfigurasi.");
      return json(
        {
          error: "Server reset belum dikonfigurasi."
        },
        500
      );
    }

    const authorization =
      context.request.headers.get("Authorization");

    if (
      !authorization ||
      authorization !== `Bearer ${resetToken}`
    ) {
      return json(
        {
          error: "Unauthorized."
        },
        401
      );
    }

    // ==========================================
    // 2. BACA DATA
    // ==========================================
    let body;

    try {
      body = await context.request.json();
    } catch {
      return json(
        {
          error: "Data request tidak valid."
        },
        400
      );
    }

    const userId = String(body?.userId || "").trim();
    const newPassword = String(body?.newPassword || "");

    if (!userId || !newPassword) {
      return json(
        {
          error: "userId dan newPassword wajib diisi."
        },
        400
      );
    }

    // Validasi UUID supaya request tidak diarahkan ke URL aneh.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(userId)) {
      return json(
        {
          error: "Admin User ID tidak valid."
        },
        400
      );
    }

    if (newPassword.length < 6) {
      return json(
        {
          error: "Password minimal 6 karakter."
        },
        400
      );
    }

    // ==========================================
    // 3. AMBIL ENV SUPABASE
    // ==========================================
    const supabaseUrl =
      String(context.env.SUPABASE_URL || "").trim();

    const serviceRoleKey =
      String(
        context.env.SUPABASE_SERVICE_ROLE_KEY || ""
      ).trim();

    if (!supabaseUrl) {
      console.error("SUPABASE_URL tidak tersedia.");
      return json(
        {
          error: "SUPABASE_URL belum dikonfigurasi di Cloudflare."
        },
        500
      );
    }

    if (!serviceRoleKey) {
      console.error(
        "SUPABASE_SERVICE_ROLE_KEY tidak tersedia."
      );

      return json(
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di Cloudflare."
        },
        500
      );
    }

    // ==========================================
    // 4. NORMALISASI URL SUPABASE
    // ==========================================
    const cleanSupabaseUrl =
      supabaseUrl.replace(/\/+$/, "");

    const adminUrl =
      `${cleanSupabaseUrl}/auth/v1/admin/users/${encodeURIComponent(
        userId
      )}`;

    // Jangan pernah log URL lengkap yang mengandung secret.
    console.log(
      "Memanggil Supabase Auth Admin API untuk user:",
      userId
    );

    // ==========================================
    // 5. UPDATE PASSWORD DI SUPABASE
    // ==========================================
    let response;

    try {
      response = await fetch(adminUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          password: newPassword
        })
      });
    } catch (fetchError) {
      console.error(
        "Gagal melakukan koneksi ke Supabase:",
        fetchError?.message || "fetch error"
      );

      return json(
        {
          error:
            "Cloudflare tidak dapat terhubung ke Supabase."
        },
        502
      );
    }

    // ==========================================
    // 6. BACA RESPONSE SUPABASE
    // ==========================================
    const responseText = await response.text();

    let result = null;

    try {
      result = responseText
        ? JSON.parse(responseText)
        : null;
    } catch {
      result = null;
    }

    console.log(
      "Supabase Auth response status:",
      response.status
    );

    // ==========================================
    // 7. JIKA SUPABASE MENOLAK REQUEST
    // ==========================================
   if (!response.ok) {
  console.error(
    "SUPABASE HTTP STATUS:",
    response.status
  );

  console.error(
    "SUPABASE RESPONSE:",
    responseText.slice(0, 2000)
  );

  return json(
    {
      error:
        result?.msg ||
        result?.message ||
        result?.error_description ||
        result?.error ||
        `Supabase HTTP ${response.status}`,
      status: response.status,
      details:
        responseText.slice(0, 1000)
    },
    response.status >= 400 && response.status <= 599
      ? response.status
      : 502
  );
}
        {
          error:
            result?.msg ||
            result?.message ||
            result?.error_description ||
            `Supabase menolak request (HTTP ${response.status}).`
        },
        response.status >= 400 && response.status <= 599
          ? response.status
          : 502
      );
    }

    // ==========================================
    // 8. BERHASIL
    // ==========================================
    console.log(
      "Password admin berhasil diperbarui:",
      userId
    );

    return json({
      success: true,
      message: "Password admin berhasil diubah."
    });
  } catch (error) {
    console.error(
      "Unexpected admin reset error:",
      error?.message || "unknown error"
    );

    return json(
      {
        error:
          "Terjadi kesalahan pada server saat reset password."
      },
      500
    );
  }
}
