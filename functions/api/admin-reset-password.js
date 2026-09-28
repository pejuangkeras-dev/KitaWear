function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function onRequestPost(context) {
  try {
    // =========================================================
    // 1. AMBIL KONFIGURASI SERVER
    // =========================================================

    const resetToken = context.env.ADMIN_RESET_TOKEN;
    const supabaseUrl = context.env.SUPABASE_URL;
    const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!resetToken) {
      return json(
        {
          error: "ADMIN_RESET_TOKEN belum dikonfigurasi."
        },
        500
      );
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        {
          error: "Konfigurasi Supabase server belum tersedia."
        },
        500
      );
    }

    // =========================================================
    // 2. CEK RESET TOKEN
    // =========================================================

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

    // =========================================================
    // 3. BACA DATA REQUEST
    // =========================================================

    let body;

    try {
      body = await context.request.json();
    } catch {
      return json(
        {
          error: "Body request bukan JSON yang valid."
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

    // =========================================================
    // 4. VALIDASI USER ID
    // =========================================================

    if (!isValidUuid(userId)) {
      return json(
        {
          error: "Admin User ID tidak valid."
        },
        400
      );
    }

    // =========================================================
    // 5. VALIDASI PASSWORD
    // =========================================================

    if (newPassword.length < 6) {
      return json(
        {
          error: "Password minimal 6 karakter."
        },
        400
      );
    }

    if (newPassword.length > 72) {
      return json(
        {
          error: "Password terlalu panjang."
        },
        400
      );
    }

    // =========================================================
    // 6. NORMALISASI SUPABASE URL
    // =========================================================

    const baseUrl = supabaseUrl.replace(/\/+$/, "");

    // =========================================================
    // 7. UPDATE PASSWORD MELALUI SUPABASE ADMIN API
    // =========================================================

    const response = await fetch(
      `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          password: newPassword
        })
      }
    );

    // =========================================================
    // 8. BACA RESPONSE SUPABASE
    // =========================================================

    const responseText = await response.text();

    let result = {};

    try {
      result = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      result = {};
    }

    // =========================================================
    // 9. JIKA SUPABASE MENOLAK REQUEST
    // =========================================================

    if (!response.ok) {
      console.error(
        "Supabase admin password update failed:",
        {
          status: response.status,
          response: responseText.slice(0, 1000)
        }
      );

      return json(
        {
          error:
            result?.msg ||
            result?.message ||
            result?.error_description ||
            result?.error ||
            `Supabase menolak request (HTTP ${response.status}).`
        },
        response.status >= 400 && response.status <= 599
          ? response.status
          : 502
      );
    }

    // =========================================================
    // 10. BERHASIL
    // =========================================================

    console.log(
      "Password admin berhasil diperbarui:",
      userId
    );

    return json(
      {
        success: true,
        message: "Password admin berhasil diubah."
      },
      200
    );

  } catch (error) {
    console.error(
      "Unexpected admin reset error:",
      error?.message || error
    );

    return json(
      {
        error: "Terjadi kesalahan pada server saat reset password."
      },
      500
    );
  }
}
