import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Usuarios autorizados para esta segunda prueba.
// NO agregar más hasta comprobar que estos funcionan.
const USUARIOS_PRUEBA = ['1949', '0054', 'ME13']

function passwordQiora(clave) {
  const c = String(clave ?? '')

  // El usuario sigue utilizando su clave original.
  // Supabase recibe internamente QIORA# + clave.
  return `QIORA#${c}`
}

export async function POST(request) {
  try {
    const body = await request.json()

    if (body?.confirmar !== 'MIGRAR_USUARIO_PRUEBA_QIORA') {
      return Response.json(
        {
          ok: false,
          error: 'Confirmación incorrecta',
        },
        { status: 400 }
      )
    }

    const usuarioSolicitado = String(
      body?.usuario ?? ''
    ).trim()

    if (!usuarioSolicitado) {
      return Response.json(
        {
          ok: false,
          error: 'Falta indicar el usuario.',
        },
        { status: 400 }
      )
    }

    // Seguridad: solamente estos usuarios pueden procesarse.
    if (!USUARIOS_PRUEBA.includes(usuarioSolicitado)) {
      return Response.json(
        {
          ok: false,
          error:
            'Usuario no autorizado para esta prueba.',
          usuarios_permitidos: USUARIOS_PRUEBA,
        },
        { status: 400 }
      )
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return Response.json(
        {
          ok: false,
          error:
            'Faltan variables de Supabase en Vercel.',
        },
        { status: 500 }
      )
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // ----------------------------------------------------
    // 1. BUSCAR PERFIL
    // ----------------------------------------------------

    const {
      data: perfil,
      error: perfilError,
    } = await admin
      .from('almacen_usuarios')
      .select(
        'usuario_almacen, nombre, clave, activo, auth_user_id'
      )
      .eq(
        'usuario_almacen',
        usuarioSolicitado
      )
      .maybeSingle()

    if (perfilError) {
      return Response.json(
        {
          ok: false,
          etapa: 'BUSCAR_PERFIL',
          error: perfilError.message,
        },
        { status: 500 }
      )
    }

    if (!perfil) {
      return Response.json(
        {
          ok: false,
          error:
            `No existe el usuario ${usuarioSolicitado} en almacen_usuarios.`,
        },
        { status: 404 }
      )
    }

    if (perfil.activo !== true) {
      return Response.json(
        {
          ok: false,
          error:
            `El usuario ${usuarioSolicitado} está inactivo.`,
        },
        { status: 400 }
      )
    }

    const claveOriginal =
      String(perfil.clave ?? '')

    if (!claveOriginal) {
      return Response.json(
        {
          ok: false,
          error:
            `El usuario ${usuarioSolicitado} no tiene clave.`,
        },
        { status: 400 }
      )
    }

    // ----------------------------------------------------
    // 2. PREPARAR AUTH
    // ----------------------------------------------------

    const email =
      `${usuarioSolicitado.toLowerCase()}@qiora.local`

    const password =
      passwordQiora(claveOriginal)

    let authUserId =
      perfil.auth_user_id || null

    let accion = ''

    // ----------------------------------------------------
    // 3. SI YA ESTÁ VINCULADO
    // ----------------------------------------------------

    if (authUserId) {
      const {
        data: authActualizado,
        error: updateError,
      } =
        await admin.auth.admin.updateUserById(
          authUserId,
          {
            email,
            password,
            email_confirm: true,
            user_metadata: {
              usuario_almacen:
                usuarioSolicitado,
              nombre:
                perfil.nombre || '',
            },
          }
        )

      if (updateError) {
        return Response.json(
          {
            ok: false,
            usuario: usuarioSolicitado,
            etapa: 'ACTUALIZAR_AUTH',
            error: updateError.message,
          },
          { status: 500 }
        )
      }

      authUserId =
        authActualizado.user.id

      accion =
        'AUTH_ACTUALIZADO'
    } else {
      // --------------------------------------------------
      // 4. CREAR AUTH
      // --------------------------------------------------

      const {
        data: authCreado,
        error: createError,
      } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,

          user_metadata: {
            usuario_almacen:
              usuarioSolicitado,

            nombre:
              perfil.nombre || '',
          },
        })

      if (createError) {
        return Response.json(
          {
            ok: false,
            usuario: usuarioSolicitado,
            etapa: 'CREAR_AUTH',
            error: createError.message,
            aviso:
              'No se realizó ninguna vinculación automática. Si el correo ya existe en Auth, debe revisarse antes de continuar.',
          },
          { status: 500 }
        )
      }

      if (!authCreado?.user?.id) {
        return Response.json(
          {
            ok: false,
            usuario: usuarioSolicitado,
            etapa: 'CREAR_AUTH',
            error:
              'Supabase no devolvió el ID del usuario creado.',
          },
          { status: 500 }
        )
      }

      authUserId =
        authCreado.user.id

      accion =
        'AUTH_CREADO'

      // --------------------------------------------------
      // 5. VINCULAR CON almacen_usuarios
      // --------------------------------------------------

      const {
        data: perfilVinculado,
        error: vincularError,
      } = await admin
        .from('almacen_usuarios')
        .update({
          auth_user_id: authUserId,
        })
        .eq(
          'usuario_almacen',
          usuarioSolicitado
        )
        .is(
          'auth_user_id',
          null
        )
        .select(
          'usuario_almacen, auth_user_id'
        )
        .maybeSingle()

      if (vincularError || !perfilVinculado) {
        // Evita dejar un usuario Auth huérfano.
        await admin.auth.admin.deleteUser(
          authUserId
        )

        return Response.json(
          {
            ok: false,
            usuario: usuarioSolicitado,
            etapa: 'VINCULAR_PERFIL',
            error:
              vincularError?.message ||
              'No fue posible vincular el usuario.',
          },
          { status: 500 }
        )
      }
    }

    // ----------------------------------------------------
    // 6. VERIFICAR VÍNCULO
    // ----------------------------------------------------

    const {
      data: verificacion,
      error: verificarError,
    } = await admin
      .from('almacen_usuarios')
      .select(
        'usuario_almacen, nombre, activo, auth_user_id'
      )
      .eq(
        'usuario_almacen',
        usuarioSolicitado
      )
      .maybeSingle()

    if (verificarError) {
      return Response.json(
        {
          ok: false,
          usuario: usuarioSolicitado,
          etapa: 'VERIFICAR',
          error: verificarError.message,
        },
        { status: 500 }
      )
    }

    if (
      !verificacion ||
      verificacion.auth_user_id !== authUserId
    ) {
      return Response.json(
        {
          ok: false,
          usuario: usuarioSolicitado,
          etapa: 'VERIFICAR',
          error:
            'El auth_user_id no quedó vinculado correctamente.',
        },
        { status: 500 }
      )
    }

    // ----------------------------------------------------
    // 7. RESULTADO
    // ----------------------------------------------------

    return Response.json({
      ok: true,
      usuario: usuarioSolicitado,
      nombre: perfil.nombre || '',
      email,
      auth_user_id: authUserId,
      accion,
      vinculado: true,
      mensaje:
        'Usuario de prueba preparado correctamente.',
    })

  } catch (error) {
    return Response.json(
      {
        ok: false,
        etapa: 'ERROR_GENERAL',
        error:
          error?.message ||
          'Error interno',
      },
      { status: 500 }
    )
  }
}
