export async function onRequestPost(context) {
  try {
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

    const supabaseUrl = context.env.SUPABASE_URL;
    const serviceRoleKey =
      context.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          error: "Konfigurasi server Supabase belum tersedia."
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
      `${supabaseUrl}/auth/v1/admin/users/${userId}`,
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

    const resultText = await response.text();

    let result;

    try {
      result = JSON.parse(resultText);
    } catch {
      result = {
        raw: resultText
      };
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
