import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const norm = value => String(value ?? '').trim().toUpperCase()
const digits4 = value => {
  const digits = String(value ?? '').trim().replace(/\D/g, '')
  return /^\d{1,4}$/.test(digits) ? digits.padStart(4, '0') : ''
}
const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

export async function POST(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !anon || !service) {
      return json({ ok: false, error: 'Falta configurar Supabase en Vercel.' }, 503)
    }

    const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ ok: false, error: 'Inicia sesión nuevamente.' }, 401)

    const publicDb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData, error: authError } = await publicDb.auth.getUser(jwt)
    if (authError || !authData?.user) return json({ ok: false, error: 'Sesión inválida.' }, 401)

    let body
    try { body = await request.json() } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400) }
    const almacen = digits4(body?.almacen)
    const distrito = norm(body?.distrito)
    if (!almacen || !distrito || distrito === 'TODOS') {
      return json({ ok: false, error: 'Almacén o distrito inválido.' }, 400)
    }

    const adminDb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: actor, error: actorError } = await adminDb
      .from('almacen_usuarios')
      .select('distrito,puesto,activo')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle()

    if (actorError || !actor || actor.activo !== true) {
      return json({ ok: false, error: 'No se encontró un usuario activo.' }, 403)
    }
    if (norm(actor.puesto) !== 'ADMIN_PADRE' && norm(actor.distrito) !== distrito) {
      return json({ ok: false, error: `No tienes autorización para consultar ${distrito}.` }, 403)
    }
    if (norm(actor.puesto) === 'ADMIN_PADRE' && !norm(actor.distrito)) {
      return json({ ok: false, error: 'ADMIN_PADRE debe usar una cuenta administradora con distrito asignado para realizar recepciones.' }, 403)
    }

    const { data: users, error: usersError } = await adminDb
      .from('almacen_usuarios')
      .select('usuario_almacen,nombre,distrito,puesto,activo,telefono')
      .eq('distrito', distrito)
      .eq('activo', true)
      .limit(10000)

    if (usersError) return json({ ok: false, error: `No se pudo consultar el catálogo: ${usersError.message}` }, 500)

    const matches = (users || []).filter(row =>
      digits4(row.usuario_almacen) === almacen &&
      norm(row.distrito) === distrito &&
      norm(row.puesto) === 'TECNICO' &&
      row.activo === true
    )

    if (!matches.length) {
      return json({ ok: false, error: `El almacén ${almacen} no existe como técnico activo en ${distrito}.` }, 404)
    }
    if (matches.length > 1) {
      return json({ ok: false, error: `Hay más de un técnico activo con el almacén ${almacen} en ${distrito}. Revisa el catálogo.` }, 409)
    }

    const row = matches[0]
    return json({
      ok: true,
      tecnico: {
        usuario_almacen: digits4(row.usuario_almacen),
        nombre: row.nombre,
        distrito: norm(row.distrito),
        puesto: norm(row.puesto),
        activo: row.activo,
        telefono: row.telefono || '',
      },
    })
  } catch (error) {
    console.error('QIORA validar almacén:', error?.message || error)
    return json({ ok: false, error: 'Error interno al validar el almacén.' }, 500)
  }
}
