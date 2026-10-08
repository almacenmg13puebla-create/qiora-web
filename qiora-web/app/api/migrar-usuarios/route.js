import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const body = await request.json()

    if (body?.confirmar !== 'VALIDAR_USUARIOS_QIORA') {
      return Response.json(
        { ok: false, error: 'Confirmación incorrecta' },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return Response.json(
        {
          ok: false,
          error: 'Faltan variables de Supabase en Vercel'
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

    const { data: usuarios, error } = await admin
      .from('almacen_usuarios')
      .select('usuario_almacen, nombre, clave')
      .eq('activo', true)
      .is('auth_user_id', null)
      .order('usuario_almacen')

    if (error) {
      return Response.json(
        {
          ok: false,
          error: error.message
        },
        { status: 500 }
      )
    }

    const validos = []
    const problematicos = []

    for (const fila of usuarios || []) {
      const usuario = String(
        fila.usuario_almacen ?? ''
      ).trim()

      const clave = String(
        fila.clave ?? ''
      )

      const problemas = []

      if (!usuario) {
        problemas.push('Usuario vacío')
      }

      if (!clave) {
        problemas.push('Clave vacía')
      }

      // Supabase Auth normalmente requiere
      // una contraseña de al menos 6 caracteres.
      if (clave && clave.length < 6) {
        problemas.push('Clave menor de 6 caracteres')
      }

      if (problemas.length) {
        problematicos.push({
          usuario,
          nombre: fila.nombre || '',
          problemas
        })
      } else {
        validos.push(usuario)
      }
    }

    return Response.json({
      ok: true,
      modo: 'SOLO_VALIDACION',
      aviso: 'No se creó ni modificó ningún usuario.',
      activos_sin_auth: usuarios?.length || 0,
      claves_validas: validos.length,
      claves_problematicas: problematicos.length,
      usuarios_problematicos: problematicos
    })

  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error?.message || 'Error interno'
      },
      { status: 500 }
    )
  }
}
