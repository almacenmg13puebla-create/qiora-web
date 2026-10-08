import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function passwordQiora(clave) {
  const c = String(clave ?? '')

  // La clave que conoce el usuario NO cambia.
  // Esta transformación existe únicamente dentro de Supabase Auth.
  return `QIORA#${c}`
}

export async function POST(request) {
  try {
    const body = await request.json()

    // Seguridad: esta ruta solo permite migrar UN usuario de prueba.
    if (body?.confirmar !== 'MIGRAR_USUARIO_PRUEBA_QIORA') {
      return Response.json(
        {
          ok: false,
          error: 'Confirmación incorrecta'
        },
        { status: 400 }
      )
    }

    const usuarioSolicitado = String(
      body?.usuario ?? ''
    ).trim()

    // Por ahora SOLO permitimos probar con 1903.
    if (usuarioSolicitado !== '1903') {
      return Response.json(
        {
          ok: false,
          error: 'Por seguridad, esta prueba solamente permite el usuario 1903.'
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
          error: 'Faltan variables de Supabase en Vercel.'
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
          persistSession: false
        }
      }
    )

    // ----------------------------------------------------
    // 1. BUSCAR EL USUARIO EN almacen_usuarios
    // ----------------------------------------------------

    const {
      data: perfil,
      error: perfilError
    } = await admin
      .from('almacen_usuarios')
      .select(
        'usuario_almacen, nombre, clave, activo, auth_user_id'
      )
      .eq('usuario_almacen', usuarioSolicitado)
      .maybeSingle()

    if (perfilError) {
      return Response.json(
        {
          ok: false,
          etapa: 'BUSCAR_PERFIL',
          error: perfilError.message
        },
        { status: 500 }
      )
    }

    if (!perfil) {
      return Response.json(
        {
          ok: false,
          error: `No existe el usuario ${usuarioSolicitado} en almacen_usuarios.`
        },
        { status: 404 }
      )
    }

    if (!perfil.activo) {
      return Response.json(
        {
          ok: false,
          error: `El usuario ${usuarioSolicitado} está inactivo.`
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
          error: `El usuario ${usuarioSolicitado} no tiene clave.`
        },
        { status: 400 }
      )
    }

    // ----------------------------------------------------
    // 2. DATOS DE AUTH
    // ----------------------------------------------------

    const email =
      `${usuarioSolicitado}@qiora.local`.toLowerCase()

    const password =
      passwordQiora(claveOriginal)

    let authUserId =
      perfil.auth_user_id || null

    let accion = ''

    // ----------------------------------------------------
    // 3. SI YA ESTÁ VINCULADO, ACTUALIZAR PASSWORD
    // ----------------------------------------------------

    if (authUserId) {
      const {
        data: authActualizado,
        error: updateError
      } = await admin.auth.admin.updateUserById(
        authUserId,
        {
          email,
          password,
          email_confirm: true
        }
      )

      if (updateError) {
        return Response.json(
          {
            ok: false,
            etapa: 'ACTUALIZAR_AUTH',
            error: updateError.message
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
      // 4. CREAR USUARIO AUTH
      // --------------------------------------------------

      const {
        data: authCreado,
        error: createError
      } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          usuario_almacen:
            usuarioSolicitado,
          nombre:
            perfil.nombre || ''
        }
      })

      if (createError) {

        // Si el correo ya existe, NO intentamos adivinar
        // ni vincular automáticamente otro UUID.
        return Response.json(
          {
            ok: false,
            etapa: 'CREAR_AUTH',
            error: createError.message,
            aviso:
              'El usuario no fue vinculado automáticamente. Si el correo ya existe en Auth, hay que revisar ese registro antes de continuar.'
          },
          { status: 500 }
        )
      }

      authUserId =
        authCreado.user.id

      accion =
        'AUTH_CREADO'

      // --------------------------------------------------
      // 5. VINCULAR AUTH CON almacen_usuarios
      // --------------------------------------------------

      const {
        error: vincularError
      } = await admin
        .from('almacen_usuarios')
        .update({
          auth_user_id:
            authUserId
        })
        .eq(
          'usuario_almacen',
          usuarioSolicitado
        )

      if (vincularError) {

        // Si falla el vínculo, eliminamos el Auth recién
        // creado para no dejar un usuario huérfano.
        await admin.auth.admin.deleteUser(
          authUserId
        )

        return Response.json(
          {
            ok: false,
            etapa: 'VINCULAR_PERFIL',
            error: vincularError.message
          },
          { status: 500 }
        )
      }
    }

    // ----------------------------------------------------
    // 6. RESULTADO
    // ----------------------------------------------------

    return Response.json({
      ok: true,
      usuario:
        usuarioSolicitado,
      nombre:
        perfil.nombre || '',
      email,
      auth_user_id:
        authUserId,
      accion,
      mensaje:
        'Usuario de prueba preparado correctamente para Supabase Auth.'
    })

  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error?.message ||
          'Error interno'
      },
      { status: 500 }
    )
  }
}
