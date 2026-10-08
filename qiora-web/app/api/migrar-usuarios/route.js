import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const body = await request.json()

    if (body?.confirmar !== 'MIGRAR_USUARIOS_QIORA') {
      return Response.json(
        {
          ok: false,
          error: 'Confirmación incorrecta'
        },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl) {
      return Response.json(
        {
          ok: false,
          error: 'Falta NEXT_PUBLIC_SUPABASE_URL en Vercel'
        },
        { status: 500 }
      )
    }

    if (!serviceRoleKey) {
      return Response.json(
        {
          ok: false,
          error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel'
        },
        { status: 500 }
      )
    }

    // Cliente administrativo.
    // Esta clave SOLO se usa en el servidor.
    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Obtener usuarios activos que todavía no están vinculados con Auth
    const { data: usuarios, error: errorUsuarios } = await admin
      .from('almacen_usuarios')
      .select('usuario_almacen, nombre, activo, auth_user_id')
      .eq('activo', true)
      .is('auth_user_id', null)
      .order('usuario_almacen')

    if (errorUsuarios) {
      return Response.json(
        {
          ok: false,
          error: 'Error leyendo almacen_usuarios',
          detalle: errorUsuarios.message
        },
        { status: 500 }
      )
    }

    const resultados = []

    for (const usuario of usuarios || []) {
      const usuarioAlmacen = String(
        usuario.usuario_almacen || ''
      ).trim()

      if (!usuarioAlmacen) {
        resultados.push({
          usuario: usuarioAlmacen,
          ok: false,
          error: 'USUARIO/ALMACEN vacío'
        })

        continue
      }

      const email = `${usuarioAlmacen}@qiora.local`

      /*
       * IMPORTANTE:
       *
       * No vamos a copiar automáticamente la columna CLAVE
       * de almacen_usuarios hacia Supabase Auth.
       *
       * Se genera una contraseña temporal aleatoria.
       */
      const passwordTemporal =
        `Qi0ra-${crypto.randomUUID()}-A1!`

      const {
        data: authCreado,
        error: errorCrear
      } = await admin.auth.admin.createUser({
        email,
        password: passwordTemporal,
        email_confirm: true,
        user_metadata: {
          usuario_almacen: usuarioAlmacen,
          nombre: usuario.nombre || ''
        }
      })

      if (errorCrear) {
        resultados.push({
          usuario: usuarioAlmacen,
          email,
          ok: false,
          error: errorCrear.message
        })

        continue
      }

      const authUserId = authCreado?.user?.id

      if (!authUserId) {
        resultados.push({
          usuario: usuarioAlmacen,
          email,
          ok: false,
          error: 'Supabase no devolvió el ID del usuario'
        })

        continue
      }

      const { error: errorVincular } = await admin
        .from('almacen_usuarios')
        .update({
          auth_user_id: authUserId
        })
        .eq('usuario_almacen', usuarioAlmacen)
        .is('auth_user_id', null)

      if (errorVincular) {
        // Si no pudimos vincularlo, eliminamos el Auth recién creado
        // para no dejar registros huérfanos.
        await admin.auth.admin.deleteUser(authUserId)

        resultados.push({
          usuario: usuarioAlmacen,
          email,
          ok: false,
          error: `No se pudo vincular: ${errorVincular.message}`
        })

        continue
      }

      resultados.push({
        usuario: usuarioAlmacen,
        email,
        auth_user_id: authUserId,
        ok: true
      })
    }

    const creados = resultados.filter(
      (r) => r.ok
    ).length

    const errores = resultados.filter(
      (r) => !r.ok
    ).length

    return Response.json({
      ok: true,
      encontrados: usuarios?.length || 0,
      creados,
      errores,
      resultados
    })

  } catch (error) {
    console.error('MIGRACION QIORA:', error)

    return Response.json(
      {
        ok: false,
        error: error?.message || 'Error interno'
      },
      { status: 500 }
    )
  }
}
