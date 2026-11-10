import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROCESOS = [
  'MB52', 'IQ09', 'STOCK_TECNICOS', 'ACTUALIZAR_SUPABASE',
  'CONSULTAS_SAP', 'TRASPASOS', 'RECOLECCIONES',
  'MOVIMIENTOS_ALMACEN', 'AUDITORIAS'
]
const NIVELES = ['BLOQUEADO', 'CONSULTAR', 'PREPARAR', 'EJECUTAR']
const S = value => String(value ?? '').trim()
const U = value => S(value).toUpperCase()
const json = (data, status = 200) => NextResponse.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' }
})

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !publicKey || !serviceKey) throw Object.assign(new Error('Faltan variables de Supabase en Vercel.'), { status: 503 })
  return {
    publicClient: createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  }
}

async function requirePadre(request, publicClient, admin) {
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Inicia sesión nuevamente.'), { status: 401 })
  const { data, error } = await publicClient.auth.getUser(auth.slice(7).trim())
  if (error || !data?.user) throw Object.assign(new Error('La sesión no es válida.'), { status: 401 })
  const { data: perfil, error: perfilError } = await admin
    .from('almacen_usuarios').select('puesto,activo').eq('auth_user_id', data.user.id).maybeSingle()
  if (perfilError) throw perfilError
  if (!perfil || perfil.activo !== true || U(perfil.puesto) !== 'ADMIN_PADRE') {
    throw Object.assign(new Error('Solo ADMIN_PADRE puede administrar la macro de emergencia.'), { status: 403 })
  }
  return data.user
}

function fail(error) {
  console.error('[QIORA MACRO EMERGENCIA CONFIG]', error)
  return json({ ok: false, error: S(error?.message) || 'Error interno.' }, Number(error?.status) || 500)
}

export async function GET(request) {
  try {
    const { publicClient, admin } = clients()
    await requirePadre(request, publicClient, admin)
    const [districts, permissions, token] = await Promise.all([
      admin.from('qiora_distritos').select('centro,nombre_region,activo').order('centro'),
      admin.from('qiora_macro_emergencia_permisos').select('centro,proceso,nivel,requiere_aprobacion'),
      admin.from('qiora_macro_emergencia_token').select('activo,actualizado_en').eq('singleton', true).maybeSingle()
    ])
    if (districts.error) throw districts.error
    if (permissions.error) throw permissions.error
    if (token.error) throw token.error
    const { data: authorized, error: authorizedError } = await admin
      .from('qiora_macro_emergencia_distritos').select('centro,autorizado')
    if (authorizedError) throw authorizedError
    return json({
      ok: true,
      distritos: (districts.data || []).map(d => ({
        ...d,
        autorizado: Boolean((authorized.data || []).find(x => x.centro === d.centro)?.autorizado)
      })),
      permisos: permissions.data || [],
      token: { configurado: Boolean(token.data), activo: Boolean(token.data?.activo), actualizado_en: token.data?.actualizado_en || null },
      procesos: PROCESOS,
      niveles: NIVELES
    })
  } catch (error) { return fail(error) }
}

export async function POST(request) {
  try {
    const { publicClient, admin } = clients()
    const user = await requirePadre(request, publicClient, admin)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'JSON_INVALIDO' }, 400)
    const action = U(body.action)

    if (action === 'GENERAR_TOKEN') {
      const token = `QIORA-ME-${randomBytes(32).toString('base64url')}`
      const token_hash = createHash('sha256').update(token, 'utf8').digest('hex')
      const { error } = await admin.from('qiora_macro_emergencia_token').upsert({
        singleton: true, token_hash, activo: true, actualizado_en: new Date().toISOString(), actualizado_por: user.id
      }, { onConflict: 'singleton' })
      if (error) throw error
      return json({ ok: true, token, mensaje: 'Token generado. Copialo ahora; no se volvera a mostrar.' })
    }

    if (action === 'REVOCAR_TOKEN') {
      const { error } = await admin.from('qiora_macro_emergencia_token')
        .update({ activo: false, actualizado_en: new Date().toISOString(), actualizado_por: user.id })
        .eq('singleton', true)
      if (error) throw error
      return json({ ok: true, mensaje: 'Token maestro revocado.' })
    }

    if (action === 'GUARDAR_PERMISOS') {
      if (!Array.isArray(body.distritos) || !Array.isArray(body.permisos)) {
        return json({ ok: false, error: 'DISTRITOS_Y_PERMISOS_REQUERIDOS' }, 400)
      }
      const { data: existentes, error: eDistritos } = await admin.from('qiora_distritos').select('centro')
      if (eDistritos) throw eDistritos
      const validos = new Set((existentes || []).map(x => U(x.centro)))
      const rowsDistritos = body.distritos.map(x => ({
        centro: U(x.centro), autorizado: x.autorizado === true,
        actualizado_en: new Date().toISOString(), actualizado_por: user.id
      }))
      const rowsPermisos = body.permisos.map(x => ({
        centro: U(x.centro), proceso: U(x.proceso), nivel: U(x.nivel || 'BLOQUEADO'),
        requiere_aprobacion: x.requiere_aprobacion === true,
        actualizado_en: new Date().toISOString(), actualizado_por: user.id
      }))
      if (rowsDistritos.some(x => !validos.has(x.centro)) || rowsPermisos.some(x => !validos.has(x.centro))) {
        return json({ ok: false, error: 'DISTRITO_DESCONOCIDO' }, 400)
      }
      if (rowsPermisos.some(x => !PROCESOS.includes(x.proceso) || !NIVELES.includes(x.nivel))) {
        return json({ ok: false, error: 'PERMISO_INVALIDO' }, 400)
      }
      if (rowsDistritos.length) {
        const { error } = await admin.from('qiora_macro_emergencia_distritos').upsert(rowsDistritos, { onConflict: 'centro' })
        if (error) throw error
      }
      if (rowsPermisos.length) {
        const { error } = await admin.from('qiora_macro_emergencia_permisos').upsert(rowsPermisos, { onConflict: 'centro,proceso' })
        if (error) throw error
      }
      return json({ ok: true, mensaje: 'Autorizaciones guardadas.' })
    }

    return json({ ok: false, error: 'ACCION_INVALIDA' }, 400)
  } catch (error) { return fail(error) }
}
