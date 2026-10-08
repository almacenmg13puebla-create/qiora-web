import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Procesará hasta 100 usuarios pendientes en una sola ejecución.
// Actualmente es suficiente para completar la migración.
const TAMANO_LOTE = 100

function passwordQiora(clave) {
  const c = String(clave ?? '')

  // La clave que escribe el usuario NO cambia.
  // Esta transformación se utiliza únicamente en Supabase Auth.
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

    // ====================================================
    // 1. CONFIRMACIÓN
    // ====================================================

    if (body?.confirmar !== 'MIGRAR_USUARIOS_QIORA') {
      return Response.json(
        {
          ok: false,
          error: 'Confirmación incorrecta',
        },
        {
          status: 400,
        }
      )
    }

    // ====================================================
    // 2. VARIABLES DE SUPABASE
    // ====================================================

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
        {
          status: 500,
        }
      )
    }

    // ====================================================
    // 3. CLIENTE ADMINISTRADOR
    // ====================================================

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

    // ====================================================
    // 4. CONTAR USUARIOS PENDIENTES
    // ====================================================

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
        {
          status: 500,
        }
      )
    }

    // ====================================================
    // 5. OBTENER USUARIOS ACTIVOS SIN AUTH
    // ====================================================

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
        {
          status: 500,
        }
      )
    }

    // ====================================================
    // 6. SI YA NO QUEDA NADIE
    // ====================================================

    if (!usuarios || usuarios.length === 0) {
      return Response.json({
        ok: true,
        terminado: true,

        pendientes_antes:
          pendientesAntes || 0,

        procesados: 0,
        creados: 0,
        vinculados_existentes: 0,
        omitidos: 0,
        errores: 0,
        pendientes_despues: 0,

        resultados: [],

        mensaje:
          'No quedan usuarios activos pendientes de migración.',
      })
    }

    // ====================================================
    // 7. CONTADORES
    // ====================================================

    const resultados = []

    let creados = 0
    let vinculadosExistentes = 0
    let omitidos = 0
    let errores = 0

    // ====================================================
    // 8. PROCESAR USUARIOS
    // ====================================================

    for (const perfil of usuarios) {
      const usuario =
        limpiarUsuario(
          perfil.usuario_almacen
        )

      const claveOriginal =
        String(perfil.clave ?? '')

      // Nunca devolvemos ni imprimimos:
      // - claveOriginal
      // - password
      // - QIORA# + clave

      // --------------------------------------------------
      // VALIDAR USUARIO
      // --------------------------------------------------

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

      // --------------------------------------------------
      // VALIDAR CLAVE
      // --------------------------------------------------

      if (!claveOriginal) {
        omitidos++

        resultados.push({
          usuario,
          nombre:
            perfil.nombre || '',
          ok: false,
          accion: 'OMITIDO',
          error: 'Clave vacía',
        })

        continue
      }

      // --------------------------------------------------
      // PREPARAR AUTH
      // --------------------------------------------------

      const email =
        `${usuario.toLowerCase()}@qiora.local`

      const password =
        passwordQiora(
          claveOriginal
        )

      try {
        // ==================================================
        // 9. INTENTAR CREAR AUTH
        // ==================================================

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
                usuario,

              nombre:
                perfil.nombre || '',
            },
          })

        // ==================================================
        // 10. AUTH NUEVO CREADO
        // ==================================================

        if (
          !createError &&
          authCreado?.user?.id
        ) {
          const authUserId =
            authCreado.user.id

          // -----------------------------------------------
          // VINCULAR CON almacen_usuarios
          // -----------------------------------------------

          const {
            data: vinculado,
            error: vincularError,
          } = await admin
            .from('almacen_usuarios')
            .update({
              auth_user_id:
                authUserId,
            })
            .eq(
              'usuario_almacen',
              usuario
            )
            .eq(
              'activo',
              true
            )
            .is(
              'auth_user_id',
              null
            )
            .select(
              'usuario_almacen, auth_user_id'
            )
            .maybeSingle()

          // -----------------------------------------------
          // SI NO PUDO VINCULAR
          // -----------------------------------------------

          if (
            vincularError ||
            !vinculado
          ) {
            // Evitamos dejar un Auth huérfano.

            const {
              error: deleteError,
            } =
              await admin.auth.admin.deleteUser(
                authUserId
              )

            errores++

            resultados.push({
              usuario,

              nombre:
                perfil.nombre || '',

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

          // -----------------------------------------------
          // TODO CORRECTO
          // -----------------------------------------------

          creados++

          resultados.push({
            usuario,

            nombre:
              perfil.nombre || '',

            ok: true,

            accion:
              'AUTH_CREADO',

            auth_user_id:
              authUserId,
          })

          continue
        }

        // ==================================================
        // 11. NO SE PUDO CREAR AUTH
        //
        // Puede significar que ese correo ya existe.
        // Buscamos el usuario existente.
        // ==================================================

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

            nombre:
              perfil.nombre || '',

            ok: false,

            accion:
              'ERROR_CREAR_AUTH',

            error:
              mensajeError(
                createError
              ),

            detalle:
              `No fue posible comprobar Auth: ${listarError.message}`,
          })

          continue
        }

        // ==================================================
        // 12. BUSCAR AUTH POR EMAIL
        // ==================================================

        const authExistente =
          listaAuth?.users?.find(
            (u) =>
              String(
                u.email || ''
              ).toLowerCase() ===
              email.toLowerCase()
          )

        if (!authExistente?.id) {
          errores++

          resultados.push({
            usuario,

            nombre:
              perfil.nombre || '',

            ok: false,

            accion:
              'ERROR_CREAR_AUTH',

            error:
              mensajeError(
                createError
              ),
          })

          continue
        }

        // ==================================================
        // 13. AUTH YA EXISTE
        //
        // Actualizamos:
        // - email
        // - password interno
        // - metadata
        //
        // Después lo vinculamos.
        // ==================================================

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
                usuario_almacen:
                  usuario,

                nombre:
                  perfil.nombre || '',
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

            nombre:
              perfil.nombre || '',

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

        // ==================================================
        // 14. VINCULAR AUTH EXISTENTE
        // ==================================================

        const {
          data: perfilVinculado,
          error:
            vincularExistenteError,
        } = await admin
          .from('almacen_usuarios')
          .update({
            auth_user_id:
              authUserId,
          })
          .eq(
            'usuario_almacen',
            usuario
          )
          .eq(
            'activo',
            true
          )
          .is(
            'auth_user_id',
            null
          )
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

            nombre:
              perfil.nombre || '',

            ok: false,

            accion:
              'ERROR_VINCULAR_AUTH_EXISTENTE',

            error:
              vincularExistenteError?.message ||
              'No fue posible vincular el Auth existente.',
          })

          continue
        }

        // ==================================================
        // 15. AUTH EXISTENTE VINCULADO
        // ==================================================

        vinculadosExistentes++

        resultados.push({
          usuario,

          nombre:
            perfil.nombre || '',

          ok: true,

          accion:
            'AUTH_EXISTENTE_VINCULADO',

          auth_user_id:
            authUserId,
        })
      } catch (errorUsuario) {
        // ==================================================
        // ERROR INDIVIDUAL
        //
        // No detenemos la migración de los demás.
        // ==================================================

        errores++

        resultados.push({
          usuario,

          nombre:
            perfil.nombre || '',

          ok: false,

          accion:
            'ERROR_USUARIO',

          error:
            mensajeError(
              errorUsuario
            ),
        })
      }
    }

    // ====================================================
    // 16. CONTAR PENDIENTES DESPUÉS
    // ====================================================

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

          etapa:
            'CONTAR_RESULTADO',

          error:
            countFinalError.message,

          resultados,
        },
        {
          status: 500,
        }
      )
    }

    // ====================================================
    // 17. RESULTADO FINAL
    // ====================================================

    const terminado =
      (pendientesDespues || 0) === 0

    return Response.json({
      ok: true,

      terminado,

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
        terminado
          ? 'Migración terminada.'
          : 'Migración ejecutada, pero todavía quedan usuarios pendientes.',
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,

        etapa:
          'ERROR_GENERAL',

        error:
          mensajeError(error),
      },
      {
        status: 500,
      }
    )
  }
}
