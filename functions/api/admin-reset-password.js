export async function onRequestPost(context) {
  try {
    // Token khusus sementara untuk proses reset admin.
    const resetToken = context.env.ADMIN_RESET_TOKEN;

    if (!resetToken) {
      return new Response(
        JSON.stringify({
          error: "ADMIN_RESET_TOKEN belum dikonfigurasi."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Wajib menggunakan header Authorization.
    const authorization =
      context.request.headers.get("Authorization");

    if (
      !authorization ||
      authorization !== `Bearer ${resetToken}`
    ) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized."
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const body = await context.request.json();

    const userId = body.userId;
    const newPassword = body.newPassword;

    if (!userId || !newPassword) {
      return new Response(
        JSON.stringify({
          error: "userId dan newPassword wajib diisi."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({
          error: "Password minimal 6 karakter."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const supabaseUrl =
      context.env.SUPABASE_URL;

    const secretKey =
      context.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !secretKey) {
      return new Response(
        JSON.stringify({
          error:
            "Konfigurasi Supabase server belum tersedia."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": secretKey,
          "Authorization": `Bearer ${secretKey}`
        },
        body: JSON.stringify({
          password: newPassword
        })
      }
    );

    const resultText =
      await response.text();

    let result;

    try {
      result = JSON.parse(resultText);
    } catch {
      result = {};
    }

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error:
            result?.msg ||
            result?.message ||
            result?.error_description ||
            "Gagal mengubah password."
        }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Password admin berhasil diubah."
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Terjadi kesalahan pada server."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
