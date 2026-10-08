import { createClient } from "@supabase/supabase-js";

export async function POST(request) {
  try {
    const { password } = await request.json();

    if (!password || password.length < 8) {
      return Response.json(
        { error: "La contraseña debe tener mínimo 8 caracteres." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const userId = "a6b423cc-5067-4737-a8d1-e12abbab5d91";

    const { data, error } =
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: password,
      });

    if (error) {
      console.error("Error actualizando contraseña:", error);

      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      message: "Contraseña de 1903 actualizada correctamente.",
      user: data.user?.email,
    });
  } catch (error) {
    console.error("Error reset-password:", error);

    return Response.json(
      { error: "Error interno." },
      { status: 500 }
    );
  }
}
