import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Máximo de usuarios que procesaremos por ejecución.
// Si quedan más, simplemente se vuelve a ejecutar la ruta.
const TAMANO_LOTE = 100

function passwordQiora(clave) {
  const c = String(clave ?? '')

  // La clave visible para el usuario NO cambia.
  // Esta transformación solamente existe dentro de Supabase Auth.
  return `QIORA#${c}`
}

function limpiarUsuario(valor) {
  return String(valor ?? '').trim()
}

function mensajeError(error) {
  return error?.message || String(error || 'Error desconocido')
}

export async function POST(request) {
  try {
    const body = await request.json()

    // ----------------------------------------------------
    // 1. CONFIRMACIÓN
    // ----------------------------------------------------

    if (body?.confirmar !== 'MIGRAR_USUARIOS_QIORA') {
      return Response.json(
        {
          ok: false,
          error: 'Confirmación incorrecta',
        },
        { status: 400 }
      )
    }

    // ----------------------------------------------------
    // 2. VARIABLES SUPABASE
    // ----------------------------------------------------

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
    // 3. CONTAR USUARIOS PENDIENTES
    // ----------------------------------------------------

    const {
      count: pendientesAntes,
      error: countError,
    } = await admin
      .from('almacen_usuarios')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('activo', true)
      .is('auth_user_id', null)

    if (countError) {
      return Response.json(
        {
          ok: false,
          etapa: 'CONTAR_PENDIENTES',
          error: countError.message,
        },
        { status: 500 }
      )
    }

    // ----------------------------------------------------
    // 4. OBTENER SOLO UN LOTE
    // ----------------------------------------------------

    const {
      data: usuarios,
      error: usuariosError,
    } = await admin
      .from('almacen_usuarios')
      .select(
        'usuario_almacen, nombre, clave, activo, auth_user_id'
      )
      .eq('activo', true)
      .is('auth_user_id', null)
      .order('usuario_almacen')
      .limit(TAMANO_LOTE)

    if (usuariosError) {
      return Response.json(
        {
          ok: false,
          etapa: 'BUSCAR_PENDIENTES',
          error: usuariosError.message,
        },
        { status: 500 }
      )
    }

    if (!usuarios || usuarios.length === 0) {
      return Response.json({
        ok: true,
        terminado: true,
        pendientes_antes: 0,
        procesados: 0,
        creados: 0,
        vinculados_existentes: 0,
        omitidos: 0,
        errores: 0,
        resultados: [],
        mensaje:
          'No quedan usuarios activos pendientes de migración.',
      })
    }

    const resultados = []

    let creados = 0
    let vinculadosExistentes = 0
    let omitidos = 0
    let errores = 0

    // ----------------------------------------------------
    // 5. PROCESAR USUARIOS
    // ----------------------------------------------------

    for (const perfil of usuarios) {
      const usuario =
        limpiarUsuario(perfil.usuario_almacen)

      const claveOriginal =
        String(perfil.clave ?? '')

      // Nunca devolver la clave original.
      // Nunca devolver la contraseña transformada.

      if (!usuario) {
        omitidos++

        resultados.push({
          usuario: '',
          ok: false,
          accion: 'OMITIDO',
          error: 'Usuario vacío',
        })

        continue
      }

      if (!claveOriginal) {
        omitidos++

        resultados.push({
          usuario,
          nombre: perfil.nombre || '',
          ok: false,
          accion: 'OMITIDO',
          error: 'Clave vacía',
        })

        continue
      }

      const email =
        `${usuario.toLowerCase()}@qiora.local`

      const password =
        passwordQiora(claveOriginal)

      try {
        // ------------------------------------------------
        // 6. CREAR USUARIO EN AUTH
        // ------------------------------------------------

        const {
          data: authCreado,
          error: createError,
        } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,

            user_metadata: {
              usuario_almacen: usuario,
              nombre: perfil.nombre || '',
            },
          })

        // ------------------------------------------------
        // 7. SI SE CREÓ CORRECTAMENTE
        // ------------------------------------------------

        if (!createError && authCreado?.user?.id) {
          const authUserId =
            authCreado.user.id

          const {
            data: vinculado,
            error: vincularError,
          } = await admin
            .from('almacen_usuarios')
            .update({
              auth_user_id: authUserId,
            })
            .eq('usuario_almacen', usuario)
            .eq('activo', true)
            .is('auth_user_id', null)
            .select(
              'usuario_almacen, auth_user_id'
            )
            .maybeSingle()

          if (vincularError || !vinculado) {
            // Si no podemos vincular el perfil,
            // eliminamos el Auth recién creado.
            const {
              error: deleteError,
            } =
              await admin.auth.admin.deleteUser(
                authUserId
              )

            errores++

            resultados.push({
              usuario,
              nombre: perfil.nombre || '',
              ok: false,
              accion:
                'ERROR_VINCULAR_PERFIL',
              error:
                vincularError?.message ||
                'No fue posible vincular el perfil.',
              auth_eliminado:
                !deleteError,
            })

            continue
          }

          creados++

          resultados.push({
            usuario,
            nombre: perfil.nombre || '',
            ok: true,
            accion: 'AUTH_CREADO',
            auth_user_id: authUserId,
          })

          continue
        }

        // ------------------------------------------------
        // 8. CREATEUSER FALLÓ
        //
        // Puede ser porque el correo ya existe en Auth.
        // Buscaremos ese correo para poder reanudar una
        // migración que haya quedado a medias.
        // ------------------------------------------------

        const {
          data: listaAuth,
          error: listarError,
        } =
          await admin.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          })

        if (listarError) {
          errores++

          resultados.push({
            usuario,
            nombre: perfil.nombre || '',
            ok: false,
            accion: 'ERROR_CREAR_AUTH',
            error: mensajeError(createError),
            detalle:
              `No fue posible comprobar Auth: ${listarError.message}`,
          })

          continue
        }

        const authExistente =
          listaAuth?.users?.find(
            (u) =>
              String(u.email || '')
                .toLowerCase() ===
              email.toLowerCase()
          )

        if (!authExistente?.id) {
          errores++

          resultados.push({
            usuario,
            nombre: perfil.nombre || '',
            ok: false,
            accion: 'ERROR_CREAR_AUTH',
            error: mensajeError(createError),
          })

          continue
        }

        // ------------------------------------------------
        // 9. AUTH YA EXISTE
        //
        // Lo actualizamos con la contraseña QIORA actual
        // y después lo vinculamos al perfil.
        // ------------------------------------------------

        const {
          data: authActualizado,
          error: actualizarError,
        } =
          await admin.auth.admin.updateUserById(
            authExistente.id,
            {
              email,
              password,
              email_confirm: true,

              user_metadata: {
                usuario_almacen: usuario,
                nombre: perfil.nombre || '',
              },
            }
          )

        if (
          actualizarError ||
          !authActualizado?.user?.id
        ) {
          errores++

          resultados.push({
            usuario,
            nombre: perfil.nombre || '',
            ok: false,
            accion:
              'ERROR_ACTUALIZAR_AUTH_EXISTENTE',
            error:
              actualizarError?.message ||
              'No fue posible actualizar el Auth existente.',
          })

          continue
        }

        const authUserId =
          authActualizado.user.id

        const {
          data: perfilVinculado,
          error: vincularExistenteError,
        } = await admin
          .from('almacen_usuarios')
          .update({
            auth_user_id: authUserId,
          })
          .eq('usuario_almacen', usuario)
          .eq('activo', true)
          .is('auth_user_id', null)
          .select(
            'usuario_almacen, auth_user_id'
          )
          .maybeSingle()

        if (
          vincularExistenteError ||
          !perfilVinculado
        ) {
          errores++

          resultados.push({
            usuario,
            nombre: perfil.nombre || '',
            ok: false,
            accion:
              'ERROR_VINCULAR_AUTH_EXISTENTE',
            error:
              vincularExistenteError?.message ||
              'No fue posible vincular el Auth existente.',
          })

          continue
        }

        vinculadosExistentes++

        resultados.push({
          usuario,
          nombre: perfil.nombre || '',
          ok: true,
          accion:
            'AUTH_EXISTENTE_VINCULADO',
          auth_user_id: authUserId,
        })
      } catch (errorUsuario) {
        errores++

        resultados.push({
          usuario,
          nombre: perfil.nombre || '',
          ok: false,
          accion: 'ERROR_USUARIO',
          error: mensajeError(errorUsuario),
        })
      }
    }

    // ----------------------------------------------------
    // 10. CONTAR QUÉ QUEDA
    // ----------------------------------------------------

    const {
      count: pendientesDespues,
      error: countFinalError,
    } = await admin
      .from('almacen_usuarios')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('activo', true)
      .is('auth_user_id', null)

    if (countFinalError) {
      return Response.json(
        {
          ok: false,
          etapa: 'CONTAR_RESULTADO',
          error: countFinalError.message,
          resultados,
        },
        { status: 500 }
      )
    }

    // ----------------------------------------------------
    // 11. RESULTADO DEL LOTE
    // ----------------------------------------------------

    return Response.json({
      ok: true,

      terminado:
        (pendientesDespues || 0) === 0,

      lote_maximo:
        TAMANO_LOTE,

      pendientes_antes:
        pendientesAntes || 0,

      procesados:
        usuarios.length,

      creados,

      vinculados_existentes:
        vinculadosExistentes,

      omitidos,

      errores,

      pendientes_despues:
        pendientesDespues || 0,

      resultados,

      mensaje:
        (pendientesDespues || 0) === 0
          ? 'Migración terminada.'
          : 'Lote terminado. Todavía quedan usuarios pendientes.',
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        etapa: 'ERROR_GENERAL',
        error: mensajeError(error),
      },
      { status: 500 }
    )
  }
}
