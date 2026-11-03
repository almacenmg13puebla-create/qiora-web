import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})
const norm = value => String(value ?? '').trim().toUpperCase()

export async function GET(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !anonKey || !serviceKey) {
    return json({ ok: false, error: 'Falta configurar Supabase en Vercel.' }, 503)
  }

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ ok: false, error: 'Inicia sesión.' }, 401)

  const publicDb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await publicDb.auth.getUser(jwt)
  if (authError || !authData?.user) return json({ ok: false, error: 'Sesión inválida.' }, 401)

  const adminDb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: actor, error: actorError } = await adminDb
    .from('almacen_usuarios')
    .select('distrito,puesto,activo,recolecciones')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (actorError || !actor || actor.activo !== true) {
    return json({ ok: false, error: 'No se encontró un perfil activo.' }, 403)
  }

  const puesto = norm(actor.puesto)
  if (puesto !== 'ADMIN_PADRE' && actor.recolecciones !== true) {
    return json({ ok: false, error: 'Tu perfil no tiene permiso para consultar Recolecciones.' }, 403)
  }

  const distrito = norm(actor.distrito)
  if (!distrito || distrito === 'TODOS') {
    return json({ ok: false, error: 'El perfil debe tener un distrito específico para cargar el catálogo de almacenes.' }, 400)
  }

  const { data: tecnicos, error: tecnicosError } = await adminDb
    .from('almacen_usuarios')
    .select('usuario_almacen,nombre,distrito')
    .eq('distrito', distrito)
    .eq('activo', true)
    .eq('puesto', 'TECNICO')
    .order('usuario_almacen', { ascending: true })

  if (tecnicosError) {
    console.error('Error cargando técnicos de recolecciones:', tecnicosError.message)
    return json({ ok: false, error: 'No se pudo consultar el catálogo de técnicos del distrito.' }, 500)
  }

  const almacenes = (tecnicos || [])
    .filter(row => String(row.usuario_almacen ?? '').trim())
    .map(row => ({
      usuario_almacen: String(row.usuario_almacen).trim(),
      nombre: String(row.nombre ?? '').trim(),
      distrito: norm(row.distrito),
    }))

  return json({ ok: true, distrito, almacenes })
}
