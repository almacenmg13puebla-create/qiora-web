import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const respuesta = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})
const normalizar = value => String(value ?? '').trim().toUpperCase()

export async function GET(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    return respuesta({ ok: false, error: 'Falta configurar Supabase en el servidor.' }, 503)
  }

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return respuesta({ ok: false, error: 'Inicia sesión para consultar el historial.' }, 401)

  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await authClient.auth.getUser(jwt)
  if (authError || !authData?.user) return respuesta({ ok: false, error: 'Sesión inválida o vencida.' }, 401)

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor, error: actorError } = await admin.from('almacen_usuarios')
    .select('distrito,puesto,activo')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (actorError || !actor || actor.activo !== true) {
    return respuesta({ ok: false, error: 'No se encontró un perfil activo.' }, 403)
  }

  const params = new URL(request.url).searchParams
  const desde = params.get('desde') || ''
  const hasta = params.get('hasta') || ''
  const almacen = params.get('almacen') || ''
  const folio = params.get('folio') || ''
  const serie = params.get('serie') || ''
  if ((desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) || (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) || (desde && hasta && desde > hasta)) {
    return respuesta({ ok: false, error: 'El rango de fechas no es válido.' }, 400)
  }

  let query = admin.from('recolecciones_equipos').select(
    'id,folio,fecha,almacen,tecnico,recibe,telefono,serie,material,descripcion,lote,dias_en_cajuela,estado,actualizado_en,distrito'
  ).order('fecha', { ascending: false }).order('folio', { ascending: false }).limit(10000)

  // El distrito se toma del perfil autenticado, nunca de un parámetro del navegador.
  const puesto = normalizar(actor.puesto)
  if (puesto !== 'ADMIN_PADRE') {
    const distrito = normalizar(actor.distrito)
    if (!distrito) return respuesta({ ok: false, error: 'Tu usuario no tiene distrito configurado.' }, 403)
    query = query.eq('distrito', distrito)
  }

  if (desde) query = query.gte('fecha', `${desde}T00:00:00-06:00`)
  if (hasta) {
    const next = new Date(`${hasta}T00:00:00-06:00`)
    next.setDate(next.getDate() + 1)
    const y = next.getFullYear()
    const m = String(next.getMonth() + 1).padStart(2, '0')
    const d = String(next.getDate()).padStart(2, '0')
    query = query.lt('fecha', `${y}-${m}-${d}T00:00:00-06:00`)
  }
  if (almacen) query = query.ilike('almacen', `%${almacen.trim()}%`)
  if (folio) query = query.ilike('folio', `%${folio.trim()}%`)
  if (serie) query = query.ilike('serie', `%${serie.trim()}%`)

  const { data, error } = await query
  if (error) {
    console.error('Error historial recolecciones:', error.code || error.message)
    return respuesta({ ok: false, error: 'No se pudo consultar el historial de recolecciones.' }, 500)
  }

  return respuesta({ ok: true, distrito: puesto === 'ADMIN_PADRE' ? 'TODOS' : normalizar(actor.distrito), data: data || [] })
}
